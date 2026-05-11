import { randomBytes, createHash } from 'node:crypto'

/**
 * WebAuthn / FIDO2 Passkey service.
 * Handles server-side challenge generation, credential creation options,
 * credential request options, and verification of authenticator responses.
 */

/** @returns {string} */
export function generateChallenge() {
  return randomBytes(32).toString('base64url')
}

/**
 * Get the Relying Party ID and origin for the current environment.
 * @returns {{ rpId: string, rpName: string, origin: string }}
 */
export function getRpInfo() {
  const publicUrl = process.env.PUBLIC_URL
  if (publicUrl) {
    const u = new URL(publicUrl)
    return { rpName: 'HERMES', rpId: u.hostname, origin: u.origin }
  }
  // Fallback for local dev
  const host = process.env.HOST || 'localhost'
  const port = process.env.PORT || '8080'
  const isLocal = host === '127.0.0.1' || host === 'localhost' || host === '::1'
  return {
    rpName: 'HERMES',
    rpId: isLocal ? 'localhost' : host,
    origin: isLocal ? `http://${host}:${port}` : `https://${host}`,
  }
}

/**
 * Build PublicKeyCredentialCreationOptions for the WebAuthn registration ceremony.
 * @param {string} userEmail
 * @param {string} userName
 * @param {Array<{ credentialId: string }>} excludeCredentials
 * @returns {{ challenge: string, options: object }}
 */
export function buildRegistrationOptions(userEmail, userName, excludeCredentials = []) {
  const { rpId, rpName, origin } = getRpInfo()
  const challenge = generateChallenge()

  const userId = createHash('sha256').update(userEmail).digest()

  const options = {
    challenge: base64urlToBuffer(challenge),
    rp: { name: rpName, id: rpId },
    user: {
      id: userId,
      name: userEmail,
      displayName: userName || userEmail,
    },
    pubKeyCredParams: [
      { type: 'public-key', alg: -7 },   // ES256
      { type: 'public-key', alg: -257 }, // RS256
    ],
    timeout: 60000,
    attestation: 'none',
    excludeCredentials: excludeCredentials.map(cred => ({
      type: 'public-key',
      id: base64urlToBuffer(cred.credentialId),
    })),
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  }

  return { challenge, options }
}

/**
 * Build PublicKeyCredentialRequestOptions for the WebAuthn authentication ceremony.
 * @param {Array<{ credentialId: string }>} allowCredentials
 * @returns {{ challenge: string, options: object }}
 */
export function buildAuthOptions(allowCredentials = []) {
  const { rpId } = getRpInfo()
  const challenge = generateChallenge()

  const options = {
    challenge: base64urlToBuffer(challenge),
    rpId,
    timeout: 60000,
    userVerification: 'preferred',
  }

  if (allowCredentials.length > 0) {
    options.allowCredentials = allowCredentials.map(cred => ({
      type: 'public-key',
      id: base64urlToBuffer(cred.credentialId),
    }))
  }

  return { challenge, options }
}

/**
 * Verify an authenticator registration response.
 * @param {object} credential - The PublicKeyCredential from navigator.credentials.create()
 * @param {string} expectedChallenge - The challenge that was sent
 * @returns {{ valid: true, credentialId: string, publicKey: Buffer, signCount: number } | { valid: false, error: string }}
 */
export function verifyRegistration(credential, expectedChallenge) {
  try {
    const response = credential.response
    const clientDataJSON = JSON.parse(Buffer.from(response.clientDataJSON, 'base64url').toString('utf8'))

    // Verify challenge
    if (clientDataJSON.challenge !== expectedChallenge) {
      return { valid: false, error: 'Challenge mismatch' }
    }

    // Verify origin
    const { origin } = getRpInfo()
    if (clientDataJSON.origin !== origin) {
      return { valid: false, error: 'Origin mismatch' }
    }

    // Verify type
    if (clientDataJSON.type !== 'webauthn.create') {
      return { valid: false, error: 'Invalid ceremony type' }
    }

    // Parse attestationObject to get public key
    const attestationObject = cborDecode(Buffer.from(response.attestationObject, 'base64url'))
    const authData = parseAuthData(attestationObject.authData)

    if (!authData.credentialPublicKey) {
      return { valid: false, error: 'No public key in attestation' }
    }

    return {
      valid: true,
      credentialId: credential.id,
      publicKey: authData.credentialPublicKey,
      signCount: authData.signCount,
    }
  } catch (e) {
    return { valid: false, error: /** @type {Error} */(e).message }
  }
}

/**
 * Verify an authenticator authentication response.
 * @param {object} credential - The PublicKeyCredential from navigator.credentials.get()
 * @param {string} expectedChallenge - The challenge that was sent
 * @param {Buffer} storedPublicKey - The public key stored during registration
 * @param {number} storedSignCount - The previous signature counter
 * @returns {{ valid: true, signCount: number } | { valid: false, error: string }}
 */
export async function verifyAuthentication(credential, expectedChallenge, storedPublicKey, storedSignCount = 0) {
  try {
    const response = credential.response
    const clientDataJSON = JSON.parse(Buffer.from(response.clientDataJSON, 'base64url').toString('utf8'))

    // Verify challenge
    if (clientDataJSON.challenge !== expectedChallenge) {
      return { valid: false, error: 'Challenge mismatch' }
    }

    // Verify origin
    const { origin } = getRpInfo()
    if (clientDataJSON.origin !== origin) {
      return { valid: false, error: 'Origin mismatch' }
    }

    // Verify type
    if (clientDataJSON.type !== 'webauthn.get') {
      return { valid: false, error: 'Invalid ceremony type' }
    }

    // Parse authenticator data
    const authenticatorData = Buffer.from(response.authenticatorData, 'base64url')
    const authData = parseAuthData(authenticatorData)

    // Verify signature counter
    if (authData.signCount !== 0 && authData.signCount <= storedSignCount) {
      return { valid: false, error: 'Signature counter replay' }
    }

    // Verify that user was present
    if (!(authData.flags & 0x01)) {
      return { valid: false, error: 'User not present' }
    }

    // Build the signed data: authenticatorData + SHA-256(clientDataJSON)
    const clientDataHash = createHash('sha256').update(Buffer.from(response.clientDataJSON, 'base64url')).digest()
    const signedData = Buffer.concat([authenticatorData, clientDataHash])

    // Verify signature
    const signature = Buffer.from(response.signature, 'base64url')
    const validSig = await verifyCoseSignature(storedPublicKey, signedData, signature)

    if (!validSig) {
      return { valid: false, error: 'Invalid signature' }
    }

    return { valid: true, signCount: authData.signCount }
  } catch (e) {
    return { valid: false, error: /** @type {Error} */(e).message }
  }
}

// ── Utility functions ──────────────────────────────────────────────────────

function base64urlToBuffer(str) {
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

/** @param {Buffer} authData @returns {{ flags: number, signCount: number, credentialPublicKey: Buffer | null }} */
function parseAuthData(authData) {
  // RP ID hash (32 bytes)
  const rpIdHash = authData.slice(0, 32)
  // Flags (1 byte)
  const flags = authData[32]
  // Sign count (4 bytes)
  const signCount = authData.readUInt32BE(33)

  // Attested credential data (if AT flag is set)
  let credentialPublicKey = null
  if (flags & 0x40) {
    // AAGUID (16 bytes)
    const aaguid = authData.slice(37, 53)
    // Credential ID length (2 bytes)
    const credIdLen = authData.readUInt16BE(53)
    // Credential ID (variable)
    const credentialId = authData.slice(55, 55 + credIdLen)
    // Public key (COSE format, rest of the buffer)
    const pubKeyBytes = authData.slice(55 + credIdLen)
    credentialPublicKey = pubKeyBytes
  }

  return { flags, signCount, credentialPublicKey }
}

/**
 * Minimal CBOR decoder for WebAuthn attestation objects.
 * Only handles the CBOR types needed for attestation objects.
 * @param {Buffer} buf
 * @returns {object}
 */
function cborDecode(buf) {
  let pos = 0
  return decodeItem()

  function readByte() { return buf[pos++] }
  function readBytes(n) { const b = buf.slice(pos, pos + n); pos += n; return b }

  function decodeItem() {
    const major = buf[pos] >> 5
    const minor = buf[pos] & 0x1f
    let value, len
    pos++

    if (minor < 24) { value = minor }
    else if (minor === 24) { value = readByte() }
    else if (minor === 25) { value = buf.readUInt16BE(pos); pos += 2 }
    else if (minor === 26) { value = buf.readUInt32BE(pos); pos += 4 }
    else { value = 0 }

    switch (major) {
      case 0: return value // uint
      case 1: return -1 - value // nint
      case 2: return readBytes(value) // bytes
      case 3: return readBytes(value).toString('utf8') // text
      case 4: { // array
        const arr = []
        for (let i = 0; i < value; i++) arr.push(decodeItem())
        return arr
      }
      case 5: { // map
        const obj = {}
        for (let i = 0; i < value; i++) {
          const k = decodeItem()
          const v = decodeItem()
          obj[k] = v
        }
        return obj
      }
      case 7: { // float/special
        if (minor === 20) return false
        if (minor === 21) return true
        if (minor === 22) return null
        return value
      }
      default: return readBytes(len || 0)
    }
  }
}

/**
 * Verify a COSE ES256 (alg -7) signature using Web Crypto API.
 * @param {Buffer} publicKeyCose - The public key in COSE format
 * @param {Buffer} data - The data that was signed
 * @param {Buffer} signature - The signature to verify
 * @returns {Promise<boolean>}
 */
async function verifyCoseSignature(publicKeyCose, data, signature) {
  try {
    const key = cborDecode(publicKeyCose)
    if (key[3] !== -7) return false

    const rawSig = derToRaw(signature)
    if (!rawSig) return false

    const { subtle } = globalThis.crypto

    const publicKey = await subtle.importKey(
      'jwk',
      {
        kty: 'EC',
        crv: 'P-256',
        x: key[-2].toString('base64url'),
        y: key[-3].toString('base64url'),
      },
      { name: 'ECDSA', namedCurve: 'P-256' },
      true,
      ['verify']
    )

    return await subtle.verify(
      { name: 'ECDSA', hash: { name: 'SHA-256' } },
      publicKey,
      rawSig,
      data
    )
  } catch (e) {
    console.error('[webauthn] signature verification error:', e)
    return false
  }
}

/**
 * Convert ASN.1 DER-encoded ECDSA signature to raw (r, s).
 * DER format: 0x30 <len> 0x02 <r_len> <r> 0x02 <s_len> <s>
 * @param {Buffer} der
 * @returns {Buffer | null}
 */
function derToRaw(der) {
  try {
    if (der[0] !== 0x30) return null
    const rLen = der[3]
    const r = der.slice(4, 4 + rLen)
    const sLen = der[4 + rLen + 1]
    const s = der.slice(4 + rLen + 2, 4 + rLen + 2 + sLen)
    // Pad to 32 bytes
    function pad(b, len = 32) {
      if (b.length === len) return b
      if (b.length > len) return b.slice(b.length - len)
      const p = Buffer.alloc(len)
      b.copy(p, len - b.length)
      return p
    }
    return Buffer.concat([pad(r), pad(s)])
  } catch (e) {
    console.error('[webauthn] DER-to-raw conversion error:', e)
    return null
  }
}
