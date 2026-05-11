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

// Trust the local loopback proxy so the tachyon server reads the real client
// IP from X-Forwarded-For (forwarded by CloudFront through the Lambda handler).
// Without this, getClientInfo() returns the loopback IP for every request.
process.env.YON_TRUST_PROXY = process.env.YON_TRUST_PROXY || 'loopback'

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

// ── Static asset cache ───────────────────────────────────────────────────
// Compiled frontend assets live in YON_DIST_PATH. They never change for a
// given deployment, so GET/HEAD requests can be served directly without
// touching the tachyon server — bypassing the reservedConcurrentExecutions=1
// bottleneck for static files.
const DIST = process.env.YON_DIST_PATH || '/tmp/dist'

const MIME = {
  '.js':    'application/javascript; charset=utf-8',
  '.mjs':   'application/javascript; charset=utf-8',
  '.html':  'text/html; charset=utf-8',
  '.css':   'text/css; charset=utf-8',
  '.json':  'application/json; charset=utf-8',
  '.png':   'image/png',
  '.svg':   'image/svg+xml',
  '.ico':   'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.xml':   'application/xml; charset=utf-8',
  '.txt':   'text/plain; charset=utf-8',
}

/** Serve a static file from dist, or null if not found. */
function serveStatic(rawPath) {
  // Normalise: strip leading slash, map root to index.html
  let rel = rawPath === '/' ? 'index.html' : rawPath.replace(/^\/+/, '')

  // Path traversal guard
  if (rel.includes('..') || rel.includes('~') || rel.includes('\0')) return null

  const file = Bun.file(`${DIST}/${rel}`)

  // Bun.file returns a 0-size object for missing paths. All dist files
  // are non-empty (even shells.json and routes.json have content).
  if (file.size === 0) return null

  const ext = (rel.match(/\.[a-z]+$/i) || [''])[0].toLowerCase()
  // index.html files (SPA shell routes like /inbox/) may not carry an ext
  const ct = MIME[ext] || (rel.endsWith('index.html') ? 'text/html; charset=utf-8' : null)
  if (!ct) return null

  return new Response(file, {
    status: 200,
    headers: {
      'content-type': ct,
      'cache-control': ext === '.html' || ext === '.json'
        ? 'public, max-age=0, must-revalidate'
        : 'public, max-age=86400, immutable',
    },
  })
}

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

  // ── CloudFront proxy verification ──────────────────────────────────────
  // When TRUSTED_PROXY_SECRET is configured, reject requests that did not
  // pass through CloudFront. CloudFront adds the x-trusted-proxy-secret
  // header as a custom origin header (configured in the CloudFront
  // distribution). Direct hits to the Lambda Function URL lack this header
  // and are rejected to prevent CloudFront bypass.
  const TRUSTED_PROXY_SECRET = process.env.TRUSTED_PROXY_SECRET
  if (TRUSTED_PROXY_SECRET) {
    const provided = headers?.["x-trusted-proxy-secret"] ?? headers?.["X-Trusted-Proxy-Secret"]
    if (provided !== TRUSTED_PROXY_SECRET) {
      return {
        statusCode: 403,
        isBase64Encoded: false,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ detail: "Direct access not allowed" }),
      }
    }
  }

  const method = requestContext?.http?.method || 'GET'

  // ── Static asset fast path ────────────────────────────────────────────
  // Serve compiled frontend assets directly, bypassing the tachyon server.
  // This keeps static files from consuming the single Lambda concurrency slot
  // needed for Fylo-dependent API requests.
  if (method === 'GET' || method === 'HEAD') {
    const staticResponse = serveStatic(rawPath)
    if (staticResponse) {
      return {
        statusCode: 200,
        isBase64Encoded: false,
        headers: Object.fromEntries(staticResponse.headers),
        body: await staticResponse.text(),
      }
    }
  }

  // ── API / dynamic requests → tachyon server ──────────────────────────
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
    method,
    headers: reqHeaders,
    body: method !== 'GET' && method !== 'HEAD' ? (body || undefined) : undefined,
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
