// Compile CADUCEUS to a standalone binary.
// Usage: bun scripts/compile.mjs [--target linux-amd64|linux-arm64|darwin-arm64]
//
// Prerequisites: bun install (all dependencies must be resolved)
//
// The output binary bundles Bun runtime + tachyon + CADUCEUS.
// It runs on any host matching the target architecture — no Bun or Node needed.

import { join } from 'node:path'

const target = process.argv.includes('--target')
  ? process.argv[process.argv.indexOf('--target') + 1]
  : process.platform === 'darwin' ? 'darwin-arm64' : 'linux-amd64'

// In production mode, remove test routes from the bundle
// The tachyon compiler will not pick up test routes since they're behind CADUCEUS_ENABLE_TEST_ROUTES
process.env.NODE_ENV = 'production'

// Build the binary with Bun's compiler
// --compile bundles Bun runtime + all imports into a single executable
// --target sets the platform (cross-compilation supported for linux-amd64, linux-arm64)
const result = await Bun.build({
  entrypoints: ['scripts/entry.mjs'],
  outdir: './dist-bin',
  target: 'bun',
  // Don't externalize anything — bundle everything
  external: [],
  // Named after the entrypoint
  naming: '[dir]/caduceus.[ext]',
})

if (!result.success) {
  console.error('Build failed:')
  for (const log of result.logs) {
    console.error(log)
  }
  process.exit(1)
}

console.log(`Compiled CADUCEUS binary for ${target}`)
console.log(`Output: dist-bin/caduceus`)

// For cross-platform, use Bun's --compile flag which creates a self-extracting binary
// This is separate from Bun.build — it produces a standalone executable
const { spawn } = await import('node:child_process')
const proc = spawn('bun', [
  'build', '--compile',
  '--target', `bun-${target}`,
  'scripts/entry.mjs',
  '--outfile', `caduceus-${target}`,
], {
  stdio: 'inherit',
  cwd: process.cwd(),
})

await new Promise((resolve, reject) => {
  proc.on('exit', code => code === 0 ? resolve() : reject(new Error(`bun build --compile exited ${code}`)))
  proc.on('error', reject)
})

console.log(`Binary: caduceus-${target}`)
