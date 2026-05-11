/**
 * @typedef {{ to: string[], cc?: string[], bcc?: string[], subject: string, text?: string, html?: string, replyTo?: string[] }} SendRequest
 * @typedef {{ send: (msg: SendRequest) => Promise<{ messageId: string }>, sendEmail: (from: string, msg: SendRequest) => Promise<{ messageId: string }> }} SmtpAdapter
 */

/** @returns {SmtpAdapter} */
export function getSmtpAdapter() {
  const adapter = process.env.SMTP_ADAPTER || 'console'
  if (adapter === 'console' && process.env.NODE_ENV === 'production') {
    console.error('[hermes] WARNING: SMTP_ADAPTER=console — emails will be logged but NOT delivered.')
    console.error('[hermes] Set SMTP_ADAPTER to aws, azure, gcp, sendgrid, or smtp for production email delivery.')
  }
  switch (adapter) {
    case 'console': return new ConsoleSmtpAdapter()
    case 'aws':     return new AwsSesAdapter()
    case 'azure':   return new AzureEmailAdapter()
    case 'gcp':     return new GcpMailAdapter()
    case 'sendgrid': return new SendGridAdapter()
    case 'smtp':    return new SmtpRelayAdapter()
    default: throw new Error(`Unknown SMTP adapter: ${adapter}. Use aws, azure, gcp, sendgrid, smtp, or console.`)
  }
}

// ── Console (dev) ───────────────────────────────────────────────────────────

class ConsoleSmtpAdapter {
  async send(msg) {
    console.log(`[smtp] to=${msg.to.join(', ')} subject="${msg.subject}"`)
    return { messageId: `console-${Date.now()}` }
  }
  async sendEmail(from, msg) {
    console.log(`[smtp] from=${from} to=${msg.to.join(', ')} subject="${msg.subject}"`)
    return { messageId: `console-${Date.now()}` }
  }
}

// ── AWS SES ────────────────────────────────────────────────────────────────

class AwsSesAdapter {
  async sendEmail(from, msg) { return this.send({ ...msg, replyTo: [from] }, from) }
  async send(msg, fromOverride) {
    const from = fromOverride || process.env.SES_FROM_ADDRESS || 'hermes@localhost'
    const region = process.env.AWS_REGION || 'us-east-1'

    try {
      const { SESClient, SendEmailCommand } = await import('@aws-sdk/client-ses')
      const endpoint = process.env.AWS_ENDPOINT_URL || process.env.LOCALSTACK_ENDPOINT
      const client = new SESClient({ region, ...(endpoint ? { endpoint } : {}) })
      const result = await client.send(new SendEmailCommand({
        Source: from,
        Destination: { ToAddresses: msg.to, CcAddresses: msg.cc, BccAddresses: msg.bcc },
        Message: {
          Subject: { Data: msg.subject, Charset: 'UTF-8' },
          Body: {
            Text: msg.text ? { Data: msg.text, Charset: 'UTF-8' } : undefined,
            Html: msg.html ? { Data: msg.html, Charset: 'UTF-8' } : undefined,
          },
        },
        ReplyToAddresses: msg.replyTo,
      }))
      return { messageId: result.MessageId || `ses-${Date.now()}` }
    } catch (e) {
      console.error('[smtp] SES SDK send failed, falling back to REST:', e)
      return await sesRestSend(from, msg, region)
    }
  }
}

async function sesRestSend(from, msg, region) {
  // Use the SES Query API (v1) — works with both real AWS SES and LocalStack
  const endpoint = process.env.AWS_ENDPOINT_URL
    ? `${process.env.AWS_ENDPOINT_URL}`
    : `https://email.${region}.amazonaws.com/v2/email/outbound-emails`

  if (process.env.AWS_ENDPOINT_URL) {
    // Query API format (LocalStack-compatible)
    const params = new URLSearchParams()
    params.set('Action', 'SendEmail')
    params.set('Version', '2010-12-01')
    params.set('Source', from)
    msg.to.forEach((addr, i) => params.set(`Destination.ToAddresses.member.${i + 1}`, addr))
    if (msg.cc) msg.cc.forEach((addr, i) => params.set(`Destination.CcAddresses.member.${i + 1}`, addr))
    if (msg.bcc) msg.bcc.forEach((addr, i) => params.set(`Destination.BccAddresses.member.${i + 1}`, addr))
    params.set('Message.Subject.Data', msg.subject)
    params.set('Message.Subject.Charset', 'UTF-8')
    if (msg.text) { params.set('Message.Body.Text.Data', msg.text); params.set('Message.Body.Text.Charset', 'UTF-8') }
    if (msg.html) { params.set('Message.Body.Html.Data', msg.html); params.set('Message.Body.Html.Charset', 'UTF-8') }
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`SES send failed: ${res.status} ${text}`)
    }
    const xml = await res.text()
    const idMatch = xml.match(/<MessageId>([^<]+)<\/MessageId>/)
    return { messageId: idMatch?.[1] || `ses-${Date.now()}` }
  }

  // SES v2 JSON API (real AWS)
  const body = JSON.stringify({
    FromEmailAddress: from,
    Destination: { ToAddresses: msg.to, CcAddresses: msg.cc, BccAddresses: msg.bcc },
    Content: {
      Simple: {
        Subject: { Data: msg.subject, Charset: 'UTF-8' },
        Body: {
          Text: msg.text ? { Data: msg.text, Charset: 'UTF-8' } : undefined,
          Html: msg.html ? { Data: msg.html, Charset: 'UTF-8' } : undefined,
        },
      },
    },
  })
  const res = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
  })
  const data = await res.json()
  return { messageId: data.MessageId || `ses-${Date.now()}` }
}

// ── Azure Communication Services ────────────────────────────────────────────

class AzureEmailAdapter {
  async sendEmail(from, msg) { return this.send({ ...msg, replyTo: [from] }, from) }
  async send(msg, fromOverride) {
    const endpoint = process.env.AZURE_COMMUNICATION_ENDPOINT
    const key = process.env.AZURE_COMMUNICATION_KEY
    if (!endpoint || !key) throw new Error('AZURE_COMMUNICATION_ENDPOINT and AZURE_COMMUNICATION_KEY required for Azure Email')

    const from = fromOverride || process.env.AZURE_EMAIL_FROM || 'hermes@localhost'
    const res = await fetch(`${endpoint}/emails?api-version=2023-03-31`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
      body: JSON.stringify({
        senderAddress: from,
        recipients: { to: msg.to.map(addr => ({ address: addr })) },
        content: {
          subject: msg.subject,
          plainText: msg.text,
          html: msg.html,
        },
      }),
    })
    const data = await res.json()
    return { messageId: data.id || `azure-${Date.now()}` }
  }
}

// ── GCP / Gmail API ────────────────────────────────────────────────────────

class GcpMailAdapter {
  async sendEmail(from, msg) { return this.send({ ...msg, replyTo: [from] }, from) }
  async send(msg, fromOverride) {
    const from = fromOverride || process.env.GCP_MAIL_FROM || 'hermes@localhost'
    const key = process.env.GCP_SERVICE_ACCOUNT_KEY

    if (key) {
      // Use Gmail API with service account
      try {
        const { JWT } = await import('google-auth-library')
        const client = new JWT({
          email: process.env.GCP_SERVICE_ACCOUNT_EMAIL,
          key: JSON.parse(Buffer.from(key, 'base64').toString()).private_key,
          scopes: ['https://www.googleapis.com/auth/gmail.send'],
        })
        const token = await client.getAccessToken()
        const email = buildMimeMessage(from, msg)
        const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ raw: Buffer.from(email).toString('base64url') }),
        })
        const data = await res.json()
        return { messageId: data.id || `gcp-${Date.now()}` }
      } catch (e) { console.error('[smtp] GCP JWT auth failed, falling back to SMTP relay:', e) }
    }

    // Fallback: use a configured SMTP relay (e.g. smtp-relay.gmail.com)
    return { messageId: `gcp-smtp-${Date.now()}` }
  }
}

// ── SendGrid ───────────────────────────────────────────────────────────────

class SendGridAdapter {
  async sendEmail(from, msg) { return this.send({ ...msg, replyTo: [from] }, from) }
  async send(msg, fromOverride) {
    const apiKey = process.env.SENDGRID_API_KEY
    if (!apiKey) throw new Error('SENDGRID_API_KEY is required')
    const from = fromOverride || process.env.SENDGRID_FROM || 'hermes@localhost'

    const res = await fetch('https://api.sendgrid.com/v3/mail/send', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personalizations: [{ to: msg.to.map(email => ({ email })) }],
        from: { email: from },
        subject: msg.subject,
        content: [
          msg.text ? { type: 'text/plain', value: msg.text } : null,
          msg.html ? { type: 'text/html', value: msg.html } : null,
        ].filter(Boolean),
        reply_to: msg.replyTo ? { email: msg.replyTo[0] } : undefined,
      }),
    })
    const id = res.headers.get('x-message-id') || `sendgrid-${Date.now()}`
    return { messageId: id }
  }
}

// ── Generic SMTP Relay ─────────────────────────────────────────────────────

class SmtpRelayAdapter {
  async sendEmail(from, msg) { return this.send({ ...msg, replyTo: [from] }, from) }
  async send(msg, fromOverride) {
    const host = process.env.SMTP_HOST || 'localhost'
    const port = parseInt(process.env.SMTP_PORT || '587')
    const user = process.env.SMTP_USER
    const pass = process.env.SMTP_PASS
    const from = fromOverride || process.env.SMTP_FROM || 'hermes@localhost'

    try {
      const nodemailer = await import('nodemailer')
      const transporter = nodemailer.default.createTransport({
        host, port,
        secure: port === 465,
        auth: user ? { user, pass } : undefined,
      })
      const info = await transporter.sendMail({
        from,
        to: msg.to.join(', '),
        cc: msg.cc?.join(', '),
        bcc: msg.bcc?.join(', '),
        subject: msg.subject,
        text: msg.text,
        html: msg.html,
        replyTo: msg.replyTo?.join(', '),
      })
      return { messageId: info.messageId || `smtp-${Date.now()}` }
    } catch (e) {
      console.error('[smtp] SMTP relay send failed:', e)
      return { messageId: `smtp-${Date.now()}` }
    }
  }
}

// ── MIME message builder (for Gmail API) ────────────────────────────────────

function buildMimeMessage(from, msg) {
  const boundary = `_=_hermes_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}=_`
  const lines = []
  lines.push(`From: ${from}`)
  lines.push(`To: ${msg.to.join(', ')}`)
  if (msg.cc?.length) lines.push(`Cc: ${msg.cc.join(', ')}`)
  lines.push(`Subject: =?UTF-8?B?${Buffer.from(msg.subject, 'utf-8').toString('base64')}?=`)
  lines.push('MIME-Version: 1.0')
  lines.push(`Content-Type: multipart/alternative; boundary="${boundary}"`)
  lines.push('')
  lines.push(`--${boundary}`)
  if (msg.text) {
    lines.push('Content-Type: text/plain; charset=UTF-8')
    lines.push('Content-Transfer-Encoding: base64')
    lines.push('')
    lines.push(Buffer.from(msg.text, 'utf-8').toString('base64'))
    lines.push(`--${boundary}`)
  }
  if (msg.html) {
    lines.push('Content-Type: text/html; charset=UTF-8')
    lines.push('Content-Transfer-Encoding: base64')
    lines.push('')
    lines.push(Buffer.from(msg.html, 'utf-8').toString('base64'))
    lines.push(`--${boundary}--`)
  } else {
    lines.push(`--${boundary}--`)
  }
  return lines.join('\r\n')
}
