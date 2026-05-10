// HERMES standalone entry point
// Compiled to binary via: bun build --compile scripts/entry.mjs --outfile hermes
//
// Commands:
//   ./hermes serve                       Start the API + frontend server
//   ./hermes admin:create --email=...    Create admin user
//   ./hermes domain:migrate --from=...   Migrate domain
//   ./hermes help                        Show help

const command = process.argv[2] || 'serve'
const args = process.argv.slice(3)

if (command === 'serve') {
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
  } catch {
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
    'HERMES — open-source multi-domain mail server',
    '',
    'Commands:',
    '  serve            Start the API and frontend server (default)',
    '  admin:create     Create the first admin for a domain',
    '  domain:migrate   Promote users from one domain suffix to another',
    '  help             Show this help',
    '',
    'Environment variables:',
    '  Required: JWT_SECRET, INBOUND_WEBHOOK_SECRET',
    '  Storage:  FYLO_ROOT (default: /data), ATTACHMENT_ROOT',
    '  Server:   PORT (default: 8080), HOST (default: 0.0.0.0)',
    '  Push:     VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT, WEB_PUSH_DISABLED',
    '  Adapters: SMS_ADAPTER, SMTP_ADAPTER',
    '  OAuth:    OAUTH_GOOGLE_CLIENT_ID/SECRET, OAUTH_MICROSOFT_CLIENT_ID/SECRET, OAUTH_APPLE_CLIENT_ID/SECRET',
    '  AWS:      AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY',
    '  Azure:    AZURE_COMMUNICATION_ENDPOINT, AZURE_COMMUNICATION_KEY',
    '  GCP:      GCP_SERVICE_ACCOUNT_EMAIL, GCP_SERVICE_ACCOUNT_KEY',
    '',
    'Examples:',
    '  JWT_SECRET=secret INBOUND_WEBHOOK_SECRET=secret FYLO_ROOT=/data ./hermes',
    '  FYLO_ROOT=.data JWT_SECRET=s ./hermes admin:create --email=admin@ex.com --phone=+1... --domain=ex.com',
  ].join('\n'))
  process.exit(0)
} else {
  console.error(`Unknown command: ${command}. Use serve, admin:create, domain:migrate, or help.`)
  process.exit(64)
}
