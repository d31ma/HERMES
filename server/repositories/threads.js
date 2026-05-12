import { listEmails } from './emails.js'

/**
 * Strip Re:/Fwd: prefixes to get the base subject for threading.
 * @param {string} subject
 * @returns {string}
 */
function baseSubject(subject) {
  const stripped = subject.replace(/^(?:Re|Fwd|RE|FWD):\s*/i, '').trim()
  return stripped || subject.trim()
}

/**
 * Group emails by base subject (with Re:/Fwd: stripped) into threads.
 * @param {import('@d31ma/fylo').default} fylo
 * @param {string[]} allowedDomains
 * @param {string} [folder]
 * @returns {Promise<Array<{ subject: string, count: number, latestEmail: import('@/types').StoredEmail, emails: import('@/types').StoredEmail[] }>>}
 */
export async function findThreads(fylo, allowedDomains, folder) {
  const emails = await listEmails(fylo, allowedDomains, { folder })

  // Group by base subject
  const groups = new Map()
  for (const email of emails) {
    const base = baseSubject(email.subject)
    if (!groups.has(base)) {
      groups.set(base, [])
    }
    groups.get(base).push(email)
  }

  // Build thread objects
  const threads = []
  for (const [subject, threadEmails] of groups) {
    // Sort emails in thread by receivedAt ascending (oldest first)
    threadEmails.sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
    const latestEmail = threadEmails[threadEmails.length - 1]
    threads.push({
      subject,
      count: threadEmails.length,
      latestEmail,
      emails: threadEmails,
    })
  }

  // Sort threads by latest email receivedAt descending
  threads.sort((a, b) => b.latestEmail.receivedAt.localeCompare(a.latestEmail.receivedAt))

  return threads
}
