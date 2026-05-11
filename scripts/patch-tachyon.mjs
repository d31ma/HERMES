// Patch tachyon compiler: inject component module imports when the HTML
// template references <component_> tags. Without this, the compiled page
// calls component functions (e.g. login_form(...)) that are never defined
// because the corresponding imports are missing from moduleImports.
import { readFileSync, writeFileSync } from 'fs'

const p = 'node_modules/@d31ma/tachyon/src/compiler/index.js'
let s = readFileSync(p, 'utf8')
let changed = false

// The marker: const factoryBindings = [...dynamicImportBindings];
// We insert our component import injection right before it.
const marker = '        const moduleImports = [...dynamicModuleImports];\n        const factoryBindings = [...dynamicImportBindings];'

if (s.includes(marker)) {
  const injection = `        const moduleImports = [...dynamicModuleImports];
        const factoryBindings = [...dynamicImportBindings];
        // Inject imports for components referenced in the HTML template.
        // The template replacement converts <login-form_> → login_form(...) but
        // does not add the corresponding module import. Scan for data-tac-module
        // attributes and register each unique component module.
        const seenComponents = new Set();
        for (const match of renderSource.matchAll(/data-tac-module="([^"]+)"/g)) {
            const modulePath = match[1];
            if (!seenComponents.has(modulePath)) {
                seenComponents.add(modulePath);
                // Extract component directory name for the binding (matches
                // normalizeComponentName: login-form/index.js → login-form → login_form)
                const dirName = modulePath.replace('/components/', '').split('/')[0];
                const bindingName = dirName.replaceAll('-', '_');
                moduleImports.push(\`\${bindingName}: () => import('\${modulePath}')\`);
                factoryBindings.push(bindingName);
            }
        }`
  s = s.replace(marker, injection)
  changed = true
}

if (changed) {
  writeFileSync(p, s)
  console.log('tachyon patched: component imports injected into page module scope')
} else {
  console.log('tachyon already patched or pattern not found — skipping')
}
