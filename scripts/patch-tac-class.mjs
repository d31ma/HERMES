/**
 * Post-build patch: inject missing `class Tac` + `init_tac` into compiled
 * component modules that reference `_base=Tac` but lack the base class.
 *
 * The tachyon compiler omits the Tac base class injection for some components
 * (typically larger ones), causing "Class extends value #<Object> is not a
 * constructor or null" at runtime.
 *
 * Usage: bun scripts/patch-tac-class.mjs
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs'
import { resolve, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const distDir = resolve(__dirname, '..', 'dist', 'components')

// Read all compiled component files
const files = (existsSync(distDir) ? readdirSync(distDir, { withFileTypes: true }) : [])
  .filter(d => d.isDirectory())
  .map(d => join(distDir, d.name, 'index.js'))
  .filter(f => existsSync(f))

const tacDef = 'class Tac{props;tac;constructor(props={},tac=noopHelpers){this.props=props,this.tac=tac}}'
const noopHelpersInit = 'var noopHelpers;var init_tac=__esm(()=>{noopHelpers={isBrowser:!1,isServer:!0,bindPersistentFields:()=>{},env:(_,fallback)=>fallback,props:{},emit:()=>!1,fetch:(input,init)=>fetch(input,init),inject:(_,fallback)=>fallback,onMount:()=>{},provide:()=>{},rerender:()=>{}}})'

let patched = 0
for (const file of files) {
  let s = readFileSync(file, 'utf8')

  if (s.includes('class Tac{')) continue
  if (!s.includes('_base=Tac')) continue

  const esmMarker = '__esm=(fn,res)=>()=>(fn&&(res=fn(fn=0)),res);'
  if (s.includes(esmMarker)) {
    s = s.replace(esmMarker, `${esmMarker}${tacDef}${noopHelpersInit};`)
    writeFileSync(file, s)
    console.log(`patched: ${file}`)
    patched++
  } else {
    console.log(`WARN: __esm marker not found in ${file}`)
  }
}

console.log(`\nPatched ${patched} component(s).`)
