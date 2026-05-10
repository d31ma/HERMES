// AWS Lambda handler for HERMES
// Compile with: bun build --compile scripts/lambda.mjs --outfile hermes-lambda
//
// Deploy as a Lambda function with:
//   - Runtime: Custom runtime on Amazon Linux 2023
//   - Handler: lambda.handler (or just the binary path in bootstrap)
//   - Architecture: arm64 or x86_64
//   - Environment: JWT_SECRET, INBOUND_WEBHOOK_SECRET, FYLO_ROOT=/tmp/data
//
// For Lambda, use API Gateway HTTP API or Lambda Function URL in front.
// Set FYLO_ROOT to /tmp (Lambda's only writable directory).

// Bootstrap the Lambda runtime API
const RUNTIME_API = `http://${process.env.AWS_LAMBDA_RUNTIME_API || '127.0.0.1:9001'}/2018-06-01`

// Start the HERMES server in the background
import '@d31ma/tachyon/src/cli/serve.js'

// Give the server a moment to start
await new Promise(resolve => setTimeout(resolve, 500))

// Lambda handler
export async function handler(event, context) {
  // Convert Lambda event to HTTP request
  const { rawPath, rawQueryString, headers, body, requestContext } = event

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
    method: event.requestContext?.http?.method || 'GET',
    headers: reqHeaders,
    body: event.requestContext?.http?.method !== 'GET' ? (body || undefined) : undefined,
  })

  const responseBody = await response.text()

  return {
    statusCode: response.status,
    headers: {
      'content-type': response.headers.get('content-type') || 'application/json',
      'access-control-allow-origin': '*',
    },
    body: responseBody,
  }
}

// Lambda Runtime API — keeps the function alive between invocations
// For Lambda Function URL, we need to use the streaming response format
if (process.env.AWS_LAMBDA_RUNTIME_API) {
  // Poll for invocations
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
      // Runtime API error — wait and retry
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }
}
