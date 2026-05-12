/**
 * Parses a Gmail-like search query string into a structured filter object.
 *
 * Supports:
 *   - Field filters: from:, to:, subject:, body:, attachment:, filename:
 *   - Boolean flags: has:attachment, is:unread, is:read, is:starred
 *   - Date filters: before:, after:
 *   - Quoted values: from:"John Doe", subject:"Hello World"
 *   - Plain text: any remaining terms collected into `text`
 *
 * Examples:
 *   from:john subject:hello       -> { from: 'john', subject: 'hello' }
 *   has:attachment is:unread      -> { hasAttachment: true, unread: true }
 *   before:2024-01-01             -> { before: '2024-01-01' }
 *   hello world                   -> { text: 'hello world' }
 *   from:alice meeting notes      -> { from: 'alice', text: 'meeting notes' }
 *
 * @param {string} raw - The raw search query string.
 * @returns {Record<string, any>} A structured filter object.
 */
export function parseSearchQuery(raw) {
  if (!raw || typeof raw !== 'string' || !raw.trim()) return {}

  const result = /** @type {Record<string, any>} */ ({})
  const textParts = []
  const tokens = tokenize(raw)

  for (const token of tokens) {
    // Check for field:value pattern (field name followed by colon and value)
    const fieldMatch = token.match(/^([a-zA-Z]+):(.+)$/)
    if (fieldMatch) {
      const [, field, value] = fieldMatch
      const cleanValue = value.replace(/^["']|["']$/g, '') // strip surrounding quotes
      switch (field.toLowerCase()) {
        case 'from':
          result.from = cleanValue
          break
        case 'to':
          result.to = cleanValue
          break
        case 'subject':
          result.subject = cleanValue
          break
        case 'body':
          result.body = cleanValue
          break
        case 'before':
          result.before = cleanValue
          break
        case 'after':
          result.after = cleanValue
          break
        case 'attachment':
        case 'filename':
          result.attachment = cleanValue
          break
        default:
          // Unknown field — treat the whole token as plain text
          textParts.push(token)
          break
      }
    } else if (/^is:(unread|read|starred)$/i.test(token)) {
      const flag = token.split(':')[1].toLowerCase()
      if (flag === 'unread') result.unread = true
      else if (flag === 'read') result.read = true
      else if (flag === 'starred') result.starred = true
    } else if (/^has:attachment$/i.test(token)) {
      result.hasAttachment = true
    } else {
      textParts.push(token)
    }
  }

  if (textParts.length > 0) {
    result.text = textParts.join(' ')
  }

  return result
}

/**
 * Tokenizes a raw query string, respecting quoted strings.
 *
 * @param {string} raw
 * @returns {string[]}
 */
function tokenize(raw) {
  const tokens = []
  // Match double-quoted, single-quoted, or unquoted sequences of non-whitespace
  const regex = /"([^"]*)"|'([^']*)'|(\S+)/g
  let match
  while ((match = regex.exec(raw)) !== null) {
    tokens.push(match[1] ?? match[2] ?? match[3])
  }
  return tokens
}
