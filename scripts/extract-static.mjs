/**
 * Extract pre-built static assets from dist/ to a flat directory suitable
 * for S3, CloudFront, or any CDN. Outputs a JSON manifest mapping URL paths
 * to file keys with content types and cache-control directives.
 *
 * Usage: bun scripts/extract-static.mjs [--out <dir>] [--manifest]
 *
 * Output:
 *   <out>/                   Flat asset directory (default: static-out/)
 *   <out>/static-manifest.json  URL path → { key, contentType, cacheControl }
 */
import { mkdirSync, readdirSync, copyFileSync, writeFileSync, existsSync, rmSync } from 'fs'
import { resolve, join, relative, extname, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const projectRoot = resolve(__dirname, '..')
const distDir = join(projectRoot, 'dist')

// Parse args
const args = process.argv.slice(2)
const outArgIdx = args.indexOf('--out')
const outDir = outArgIdx >= 0 ? resolve(args[outArgIdx + 1] || 'static-out') : join(projectRoot, 'static-out')
const wantManifest = args.includes('--manifest')

if (!existsSync(distDir)) {
  console.error(`dist/ not found at ${distDir}. Run 'bun run bundle' first.`)
  process.exit(1)
}

const CONTENT_TYPES = {
  '.js':   'application/javascript; charset=utf-8',
  '.mjs':  'application/javascript; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png',
  '.svg':  'image/svg+xml',
  '.ico':  'image/x-icon',
  '.webmanifest': 'application/manifest+json',
  '.xml':  'application/xml; charset=utf-8',
  '.txt':  'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
}

const CACHE_IMMUTABLE = 'public, max-age=86400, immutable'
const CACHE_VALIDATE  = 'public, max-age=0, must-revalidate'

/** @param {string} ext */
function cacheControl(ext) {
  switch (ext) {
    case '.html': return CACHE_VALIDATE
    case '.json': return 'public, max-age=300'
    case '.js': case '.mjs': return CACHE_IMMUTABLE
    case '.css': return CACHE_IMMUTABLE
    case '.png': case '.svg': case '.ico': case '.woff2': return CACHE_IMMUTABLE
    default: return 'public, max-age=3600'
  }
}

// ── Walk dist and copy assets ────────────────────────────────────────────
/** @type {Array<{ urlPath: string, key: string, contentType: string, cacheControl: string }>} */
const manifest = []

/**
 * @param {string} dir
 * @param {string} urlBase
 */
function walkAndCopy(dir, urlBase) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const src = join(dir, entry.name)
    if (entry.isDirectory()) {
      walkAndCopy(src, urlBase + entry.name + '/')
      continue
    }

    // Map dist file path to URL path:
    //   dist/index.html        → /
    //   dist/spa-renderer.js   → /spa-renderer.js
    //   dist/pages/index.js    → /pages/index.js
    //   dist/inbox/index.html  → /inbox/
    const rel = relative(distDir, src)
    let urlPath = '/' + rel.split('/').join('/')

    // index.html files represent the directory path (SPA shell routes)
    if (urlPath.endsWith('/index.html')) {
      urlPath = urlPath.replace(/\/index\.html$/, '/')
      // For directory-like URLs, the file is copied as index.html inside
      const keyDir = urlPath.replace(/^\//, '') // e.g. "settings/"
      const outPath = join(outDir, keyDir, 'index.html')
      mkdirSync(dirname(outPath), { recursive: true })
      copyFileSync(src, outPath)
    } else {
      const outPath = join(outDir, urlPath.replace(/^\//, ''))
      mkdirSync(dirname(outPath), { recursive: true })
      copyFileSync(src, outPath)
    }

    const ext = extname(entry.name).toLowerCase()
    const contentType = CONTENT_TYPES[ext] || 'application/octet-stream'

    manifest.push({
      urlPath: urlPath || '/',
      key: urlPath.replace(/^\//, '') || 'index.html',
      contentType,
      cacheControl: cacheControl(ext),
    })
  }
}

// Ensure clean output
if (existsSync(outDir)) rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })
walkAndCopy(distDir, '')

// ── Write manifest ───────────────────────────────────────────────────────
if (wantManifest) {
  const manifestPath = join(outDir, 'static-manifest.json')
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
  console.log(`Manifest: ${manifestPath}`)
}

console.log(`Extracted ${manifest.length} static assets → ${outDir}`)

// ── Print CloudFront behavior config (for docs) ──────────────────────────
console.log('\nCloudFront ordered cache behaviors (add after default):\n')
const jsJsonPaths = [...new Set(manifest
  .filter(m => m.urlPath.match(/\.(js|mjs|json)$/))
  .map(m => m.urlPath.replace(/[^/]+$/, '*')))]
for (const p of jsJsonPaths.slice(0, 5)) {
  console.log(`  ${p}`)
}
console.log('  ...')
