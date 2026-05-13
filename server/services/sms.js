/**
 * SMS adapter interface.
 * @typedef {{ send: (to: string, body: string) => Promise<void> }} SmsAdapter
 */

/** @returns {SmsAdapter} */
export function getSmsAdapter() {
  const adapter = process.env.SMS_ADAPTER || 'console'
  if (adapter === 'console' && process.env.NODE_ENV === 'production') {
    console.error('[hermes] WARNING: SMS_ADAPTER=console — SMS messages will be logged but NOT delivered.')
    console.error('[hermes] Set SMS_ADAPTER to aws, azure, or twilio for production SMS delivery.')
  }
  switch (adapter) {
    case 'console': return new ConsoleSmsAdapter()
    case 'aws':     return new AwsSnsAdapter()
    case 'azure':   return new AzureSmsAdapter()
    case 'twilio':  return new TwilioAdapter()
    default: throw new Error(`Unknown SMS adapter: ${adapter}. Use aws, azure, twilio, or console.`)
  }
}

// ── Console (dev) ───────────────────────────────────────────────────────────

class ConsoleSmsAdapter {
  async send(to, body) { console.log(`[sms] to=${to} body="${body}"`); return Promise.resolve() }
}

// ── AWS SNS ────────────────────────────────────────────────────────────────

class AwsSnsAdapter {
  async send(to, body) {
    try {
      const { SNSClient, PublishCommand } = await import('@aws-sdk/client-sns')
      const endpoint = process.env.AWS_ENDPOINT_URL || process.env.LOCALSTACK_ENDPOINT
      const client = new SNSClient({
        region: process.env.AWS_REGION || 'us-east-1',
        ...(endpoint ? { endpoint } : {}),
      })
      await client.send(new PublishCommand({
        PhoneNumber: to,
        Message: body,
        MessageAttributes: {
          'AWS.SNS.SMS.SenderID': { DataType: 'String', StringValue: 'HERMES' },
          'AWS.SNS.SMS.SMSType': { DataType: 'String', StringValue: 'Transactional' },
        },
      }))
    } catch (e) {
      // Fallback: REST API call if SDK not installed
      await awsSnsRest(to, body)
    }
  }
}

async function awsSnsRest(to, body) {
  const region = process.env.AWS_REGION || 'us-east-1'
  const endpoint = process.env.AWS_ENDPOINT_URL || `https://sns.${region}.amazonaws.com`
  const params = new URLSearchParams({
    Action: 'Publish',
    Version: '2010-03-31',
    PhoneNumber: to,
    Message: body,
  })
  // @ts-ignore - signAwsRequest returns Promise but fetch headers expects HeadersInit
  const res = await fetch(`${endpoint}?${params}`, {
    method: 'POST',
    // @ts-ignore
    headers: signAwsRequest('sns', region, endpoint, params.toString()),
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`SNS publish failed: ${res.status} ${text}`)
  }
}

// ── Azure Communication Services ────────────────────────────────────────────

class AzureSmsAdapter {
  async send(to, body) {
    const endpoint = process.env.AZURE_COMMUNICATION_ENDPOINT
    const key = process.env.AZURE_COMMUNICATION_KEY
    if (!endpoint || !key) throw new Error('AZURE_COMMUNICATION_ENDPOINT and AZURE_COMMUNICATION_KEY are required for Azure SMS')

    try {
      // @ts-ignore - optional dependency, may not have type declarations
      const { SmsClient } = await import('@azure/communication-sms')
      const client = new SmsClient(endpoint, { key })
      await client.send({ from: process.env.AZURE_SMS_FROM || 'HERMES', to: [to], message: body })
    } catch (e) {
      console.error('[sms] Azure SMS SDK send failed, falling back to REST:', e)
      await fetch(`${endpoint}/sms?api-version=2023-03-31`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${key}` },
        body: JSON.stringify({ from: process.env.AZURE_SMS_FROM || 'HERMES', to: [{ phone: to }], message: body }),
      })
    }
  }
}

// ── Twilio ──────────────────────────────────────────────────────────────────

class TwilioAdapter {
  async send(to, body) {
    const sid = process.env.TWILIO_ACCOUNT_SID
    const token = process.env.TWILIO_AUTH_TOKEN
    const from = process.env.TWILIO_PHONE_NUMBER
    if (!sid || !token || !from) throw new Error('TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_PHONE_NUMBER are required')

    const auth = btoa(`${sid}:${token}`)
    await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
      method: 'POST',
      headers: { 'Authorization': `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ To: to, From: from, Body: body }).toString(),
    })
  }
}

// ── AWS SigV4 helper (for REST fallback) ───────────────────────────────────

async function signAwsRequest(service, region, endpoint, body) {
  try {
    const [{ SignatureV4 }, { Sha256 }, { defaultProvider }] = await Promise.all([
      // @ts-ignore - optional dependency, may not have type declarations
      import('@aws-sdk/signature-v4'),
      import('@aws-crypto/sha256-js'),
      import('@aws-sdk/credential-provider-node').catch(() => ({ defaultProvider: null })),
    ])
    // Use the AWS credential provider chain (env vars → metadata service →
    // container credentials) so this works in Lambda, ECS, and EC2 without
    // hardcoding AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY env vars.
    const credentials = defaultProvider
      ? defaultProvider()
      : { accessKeyId: process.env.AWS_ACCESS_KEY_ID || '', secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY || '' }
    const signer = new SignatureV4({ service, region, credentials, sha256: Sha256 })
    const { headers } = await signer.sign({
      method: 'POST',
      hostname: new URL(endpoint).hostname,
      path: '/',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    })
    return headers
  } catch (e) { console.error('[sms] AWS SigV4 signing failed:', e); return {} }
}
