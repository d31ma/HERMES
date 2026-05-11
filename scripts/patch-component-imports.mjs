/**
 * Post-build patch: fix broken component import bindings in compiled pages.
 *
 * The tachyon compiler generates import bindings like:
 *   component:()=>import("../components/X/index.js").then((m)=>m.default||m)
 *
 * These bindings ignore props and return the factory function instead of
 * calling it to get the render function. This causes the factory function
 * source code to be .toString()'d into the rendered HTML.
 *
 * The fix wraps each binding to call the factory with the passed props:
 *   component:(p)=>import("...").then(async(m)=>{const f=m.default||m;return await f(p)})
 *
 * Usage: bun scripts/patch-component-imports.mjs
 */
import { readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const distDir = resolve(__dirname, '..', 'dist')

// Find all page index.js files
const glob = new Bun.Glob('pages/**/index.js')
const pages = [...glob.scanSync({ cwd: distDir, absolute: true })]

// Pattern: componentName:()=>import("path").then((m)=>m.default||m)
const RE = /(\w+):\(\)=>import\(("[^"]+")\)\.then\(\(m\)=>m\.default\|\|m\)/g

let totalPatched = 0
for (const file of pages) {
  let s = readFileSync(file, 'utf8')
  let count = 0
  const updated = s.replace(RE, (match, name, path) => {
    count++
    return `${name}:(p)=>import(${path}).then(async(m)=>{const f=m.default||m;return await f(p)})`
  })
  if (count > 0) {
    writeFileSync(file, updated)
    console.log(`patched ${count} imports: ${file}`)
    totalPatched += count
  }
}

console.log(`\nPatched ${totalPatched} import binding(s) across ${pages.length} page(s).`)
