import { writeFile, readFile, access, copyFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'

const projectRoot = new URL('../', import.meta.url).pathname
const args = process.argv.slice(2)
const isWatch = args.includes('--watch')
const bin = name => new URL(`../node_modules/.bin/${name}`, import.meta.url).pathname

function run(cmd, cmdArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, cmdArgs, { cwd: projectRoot, stdio: 'inherit' })
    child.on('error', reject)
    child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`)))
  })
}

function start(cmd, cmdArgs) {
  return spawn(cmd, cmdArgs, { cwd: projectRoot, stdio: 'inherit' })
}

async function ensureConfigJs() {
  const configPath = new URL('../browser/shared/assets/config.js', import.meta.url).pathname
  try { await access(configPath) } catch {
    const apiUrl = process.env.CADUCEUS_API_URL || ''
    await writeFile(configPath, `window.CADUCEUS_CONFIG={apiUrl:"${apiUrl}"};\n`)
  }
}

async function patchHtmlShells() {
  const distRoot = new URL('../dist/', import.meta.url).pathname
  const htmlFiles = Array.from(new Bun.Glob('**/*.html').scanSync({ cwd: distRoot }))

  for (const file of htmlFiles) {
    const htmlPath = new URL(`../dist/${file}`, import.meta.url).pathname
    let html = await readFile(htmlPath, 'utf8')
    const headEnd = html.indexOf('</head>')
    const outerHead = headEnd >= 0 ? html.slice(0, headEnd) : html

    if (!outerHead.includes('/shared/assets/manifest.webmanifest')) {
      const pwaHead = [
        '    <meta name="theme-color" content="#6750a4">',
        '    <meta name="color-scheme" content="light">',
        '    <meta name="mobile-web-app-capable" content="yes">',
        '    <meta name="apple-mobile-web-app-capable" content="yes">',
        '    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">',
        '    <meta name="apple-mobile-web-app-title" content="CADUCEUS">',
        '    <link rel="manifest" href="/shared/assets/manifest.webmanifest">',
        '    <link rel="icon" href="/shared/assets/favicon.svg" type="image/svg+xml">',
        '    <link rel="apple-touch-icon" href="/shared/assets/icon-192.png">',
        '    <link rel="stylesheet" href="/shared/assets/styles.css">',
        '    <link rel="stylesheet" href="/shared/assets/themes.css">',
      ].join('\n')
      html = html.replace('</head>', `${pwaHead}\n</head>`)
    }

    html = html.replace(
      /<meta\s+name=["']viewport["']\s+content=["']width=device-width,\s*initial-scale=1\.0["']\s*\/?>/i,
      '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">',
    )
    html = html.replace('<title>Tachyon</title>', '<title>CADUCEUS</title>')

    if (!outerHead.includes('/shared/assets/config.js')) {
      html = html.replace(
        /<script[^>]*src="\/shared\/scripts\/imports\.js"[^>]*><\/script>/,
        '<script src="/shared/assets/config.js"></script>\n    $&',
      )
    }

    await writeFile(htmlPath, html)
  }
}

async function copyServiceWorker() {
  const sourcePath = new URL('../browser/shared/assets/sw.js', import.meta.url).pathname
  const outputPath = new URL('../dist/sw.js', import.meta.url).pathname
  await copyFile(sourcePath, outputPath)
}

async function copyMousetrap() {
  const { mkdir } = await import('node:fs/promises')
  const sourcePath = new URL('../node_modules/mousetrap/mousetrap.js', import.meta.url).pathname
  const outputDir = new URL('../dist/shared/scripts/', import.meta.url).pathname
  await mkdir(outputDir, { recursive: true })
  const outputPath = new URL('../dist/shared/scripts/mousetrap.js', import.meta.url).pathname
  await copyFile(sourcePath, outputPath)
}

async function copyKeyboard() {
  const { mkdir } = await import('node:fs/promises')
  const sourcePath = new URL('../browser/shared/scripts/keyboard.js', import.meta.url).pathname
  const outputDir = new URL('../dist/shared/scripts/', import.meta.url).pathname
  await mkdir(outputDir, { recursive: true })
  const outputPath = new URL('../dist/shared/scripts/keyboard.js', import.meta.url).pathname
  await copyFile(sourcePath, outputPath)
}

async function copyKeymap() {
  const { mkdir } = await import('node:fs/promises')
  const sourcePath = new URL('../browser/shared/data/keymap.json', import.meta.url).pathname
  const outputDir = new URL('../dist/shared/data/', import.meta.url).pathname
  await mkdir(outputDir, { recursive: true })
  const outputPath = new URL('../dist/shared/data/keymap.json', import.meta.url).pathname
  await copyFile(sourcePath, outputPath)
}

if (isWatch) {
  await ensureConfigJs()
  const tach = start(bin('tac.bundle'), ['--watch'])
  const shutdown = sig => { tach.kill(sig); process.exit(0) }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
  tach.on('exit', code => process.exit(code ?? 0))
} else {
  await ensureConfigJs()
  await run(bin('tac.bundle'), [])
  await patchHtmlShells()
  await copyServiceWorker()
  await copyMousetrap()
  await copyKeyboard()
  await copyKeymap()
}
