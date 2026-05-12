// HERMES entry point — single binary for all deployment modes.
// Compiled to binary via: bun build --compile scripts/entry.mjs --outfile hermes
//
// Commands:
//   ./hermes serve                       Standalone server (Fargate, ECS, plain Docker)
//   ./hermes lambda                      Lambda mode — starts the Runtime API handler
//   ./hermes admin:create --email=...    Create admin user
//   ./hermes domain:migrate --from=...   Migrate domain
//   ./hermes help                        Show help

const command = process.argv[2] || 'serve'
const args = process.argv.slice(3)

if (command === 'lambda') {
  // Delegate to the Lambda Runtime API handler. This mode is used when the
  // container runs in AWS Lambda (custom runtime). It starts the tachyon
  // server, waits for readiness, then enters the Lambda Runtime API loop.
  await import('./lambda.mjs')
} else if (command === 'serve') {
  // ── Startup configuration summary ──────────────────────────────────────
  const sms = process.env.SMS_ADAPTER || 'console'
  const smtp = process.env.SMTP_ADAPTER || 'console'
  const pushDisabled = process.env.WEB_PUSH_DISABLED === 'true'
  const pushKeys = !!(process.env.VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY)
  const oauth = ['google','microsoft','apple'].filter(p =>
    process.env[`OAUTH_${p.toUpperCase()}_CLIENT_ID`] && process.env[`OAUTH_${p.toUpperCase()}_CLIENT_SECRET`]
  )
  const hasJwt = !!process.env.JWT_SECRET
  const hasInbound = !!process.env.INBOUND_WEBHOOK_SECRET

  console.log('')
  console.log('╔══════════════════════════════════════╗')
  console.log('║         HERMES mail server           ║')
  console.log('╚══════════════════════════════════════╝')
  console.log('')
  console.log('Secrets:')
  console.log(`  JWT_SECRET              ${hasJwt ? '✓' : '✗ MISSING (required)'}`)
  console.log(`  INBOUND_WEBHOOK_SECRET  ${hasInbound ? '✓' : '✗ MISSING (required)'}`)
  console.log('')
  console.log('Adapters:')
  console.log(`  SMS  → ${sms}${sms === 'console' ? ' (logs only, no delivery)' : ''}`)
  console.log(`  SMTP → ${smtp}${smtp === 'console' ? ' (logs only, no delivery)' : ''}`)
  if (sms === 'console' || smtp === 'console') {
    console.log('  Set SMS_ADAPTER and SMTP_ADAPTER for production delivery.')
  }
  console.log('')
  console.log('Push notifications:')
  console.log(`  ${pushDisabled ? 'Disabled (WEB_PUSH_DISABLED=true)' : pushKeys ? 'Enabled (VAPID keys configured)' : 'Disabled (no VAPID keys set)'}`)
  console.log('')
  if (oauth.length > 0) {
    console.log(`OAuth providers: ${oauth.join(', ')}`)
    console.log('')
  }
  if (!hasJwt || !hasInbound) {
    console.error('ERROR: JWT_SECRET and INBOUND_WEBHOOK_SECRET are required.')
    console.error('Set them as environment variables before starting HERMES.')
    process.exit(1)
  }

  // Start the tachyon server.
  // Dynamic import bundles the server at compile time for standalone binaries.
  // In distroless Docker images, package subpath imports may not resolve;
  // fall back to spawning the bin entry as a child process.
  try {
    process.argv = ['bun', 'yon.serve', ...args]
    await import('@d31ma/tachyon/src/cli/serve.js')
  } catch (e) {
    console.error('[entry] dynamic import failed, falling back to child process:', e)
    const { spawn } = await import('node:child_process')
    const child = spawn(process.execPath, ['node_modules/.bin/yon.serve', ...args], {
      cwd: process.cwd(),
      stdio: 'inherit',
      env: process.env,
    })
    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.on(signal, () => child.kill(signal))
    }
    process.exit(await new Promise(resolve => child.on('exit', resolve)))
  }
} else if (command === 'admin:create') {
  process.argv = ['bun', 'scripts/create-admin.mjs', ...args]
  await import('./create-admin.mjs')
} else if (command === 'domain:migrate') {
  process.argv = ['bun', 'scripts/migrate-domain.mjs', ...args]
  await import('./migrate-domain.mjs')
} else if (command === 'help' || command === '--help' || command === '-h') {
  console.log([
    'Hermes container commands:',
    '  serve           Start the Hermes API and frontend server',
'  lambda          Start in AWS Lambda mode (Runtime API handler)',
    '  admin:create    Create the first admin for a domain',
    '  domain:migrate  Promote users from one domain suffix to another',
    '',
    'Examples:',
    '  docker run ghcr.io/d31ma/hermes:latest',
'  docker run ghcr.io/d31ma/hermes:latest lambda',
    '  docker run -v hermes-data:/data ghcr.io/d31ma/hermes:latest admin:create --email=admin@example.com --phone=+14165550100 --domain=example.com',
    '  docker run -v hermes-data:/data ghcr.io/d31ma/hermes:latest domain:migrate --from=old.example --to=new.example --apply',
  ].join('\n'))
  process.exit(0)
} else {
  console.error(`Unsupported Hermes container command: ${command}`)
  console.error('Allowed commands: serve, lambda, admin:create, domain:migrate')
  process.exit(64)
}
