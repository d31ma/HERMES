// AWS Lambda handler for HERMES
// Compile with: bun build --compile scripts/lambda.mjs --outfile hermes-lambda
//
// Deploy as a Lambda function with:
//   - Runtime: Custom runtime on Amazon Linux 2023
//   - Architecture: arm64 or x86_64
//   - Environment: JWT_SECRET, INBOUND_WEBHOOK_SECRET, FYLO_ROOT=/tmp/data
//
// Supports API Gateway HTTP API v2, Lambda Function URL, and ALB event formats.
// For Lambda, set FYLO_ROOT to /tmp (Lambda's only writable directory).

// Redirect tachyon build artifacts to /tmp (Lambda's container FS is read-only
// except /tmp). Prevents EROFS errors on cold start manifest writes.
process.env.YON_DIST_PATH = process.env.YON_DIST_PATH || '/tmp/dist'

// Bootstrap the Lambda runtime API
const RUNTIME_API = `http://${process.env.AWS_LAMBDA_RUNTIME_API || '127.0.0.1:9001'}/2018-06-01`

// Start the HERMES server in the background.
// Use a relative import to bypass the @d31ma/tachyon exports map, which does
// not expose ./src/cli/serve.js (see package.json "exports" field). The
// relative path works because Bun resolves it at compile time before the
// exports map check applies.
import '../node_modules/@d31ma/tachyon/src/cli/serve.js'

// Give the server a moment to start
await new Promise(resolve => setTimeout(resolve, 500))

/**
 * Normalize an ALB event to the API Gateway HTTP API v2 format.
 * Detects ALB format by the presence of `httpMethod` / `path`.
 */
function normalizeEvent(event) {
  // API Gateway v2 (already in expected format)
  if (event.rawPath || event.requestContext?.http) return event

  // ALB format — convert to v2 shape
  return {
    rawPath: event.path || '/',
    rawQueryString: event.queryStringParameters
      ? new URLSearchParams(event.queryStringParameters).toString()
      : '',
    headers: event.headers || event.multiValueHeaders || {},
    body: event.body || null,
    isBase64Encoded: event.isBase64Encoded || false,
    requestContext: {
      http: {
        method: event.httpMethod || 'GET',
      },
    },
  }
}

// Lambda handler
export async function handler(event, context) {
  const ev = normalizeEvent(event)
  const { rawPath, rawQueryString, headers, body, requestContext } = ev

  const url = `http://127.0.0.1:${process.env.PORT || 8080}${rawPath}${rawQueryString ? '?' + rawQueryString : ''}`

  const reqHeaders = new Headers()
  for (const [k, v] of Object.entries(headers || {})) {
    if (k !== 'host' && k !== 'connection') reqHeaders.set(k, v)
  }

  // Add the JWT from the Lambda authorizer if present
  if (requestContext?.authorizer?.jwt?.claims) {
    const claims = requestContext.authorizer.jwt.claims
    reqHeaders.set('X-User-Email', claims.email || '')
    reqHeaders.set('X-User-Role', claims.role || '')
  }

  const response = await fetch(url, {
    method: requestContext?.http?.method || 'GET',
    headers: reqHeaders,
    body: requestContext?.http?.method !== 'GET' ? (body || undefined) : undefined,
  })

  const responseBody = await response.text()

  return {
    statusCode: response.status,
    isBase64Encoded: false,
    headers: {
      'content-type': response.headers.get('content-type') || 'application/json',
      'access-control-allow-origin': '*',
    },
    body: responseBody,
  }
}

// Lambda Runtime API — keeps the function alive between invocations
if (process.env.AWS_LAMBDA_RUNTIME_API) {
  while (true) {
    try {
      const nextResp = await fetch(`${RUNTIME_API}/runtime/invocation/next`)
      const event = await nextResp.json()
      const requestId = nextResp.headers.get('lambda-runtime-aws-request-id')

      try {
        const result = await handler(event, { awsRequestId: requestId })
        await fetch(`${RUNTIME_API}/runtime/invocation/${requestId}/response`, {
          method: 'POST',
          body: JSON.stringify(result),
        })
      } catch (err) {
        await fetch(`${RUNTIME_API}/runtime/invocation/${requestId}/error`, {
          method: 'POST',
          body: JSON.stringify({ errorMessage: err.message, errorType: 'Error' }),
        })
      }
    } catch {
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }
}
