/**
 * TOTP (Time-based One-Time Password) — RFC 6238 / RFC 4226.
 *
 * Implemented with `node:crypto` only (HMAC-SHA1), no third-party deps.
 * Used for the MFA feature (JL-81): a shared base32 secret is stored per user,
 * an authenticator app (Google Authenticator, Authy, 1Password, …) derives a
 * 6-digit code from it every 30 seconds, and the server verifies that code.
 *
 * Verified against the canonical RFC 6238 SHA-1 test vectors (secret
 * "12345678901234567890"): T=59 → 287082, T=1111111109 → 081804,
 * T=1234567890 → 005924. See server/__tests__/mfa-JL81.test.js.
 */
import crypto from 'node:crypto'

// RFC 4648 base32 alphabet (no padding used for otpauth URLs).
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

const DIGITS = 6
const STEP_SECONDS = 30

/**
 * Encode a Buffer to an (unpadded) base32 string.
 */
export function base32Encode(buffer) {
  let bits = 0
  let value = 0
  let output = ''
  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i]
    bits += 8
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  }
  return output
}

/**
 * Decode a base32 string (case-insensitive, padding/spaces tolerated) to a Buffer.
 */
export function base32Decode(input) {
  const clean = String(input || '').toUpperCase().replace(/[=\s]/g, '')
  let bits = 0
  let value = 0
  const bytes = []
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch)
    if (idx === -1) continue // ignore any stray non-alphabet characters
    value = (value << 5) | idx
    bits += 5
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Buffer.from(bytes)
}

/**
 * Generate a random base32 TOTP secret (default 20 bytes → 160 bits, per RFC 4226).
 */
export function generateSecret(byteLength = 20) {
  return base32Encode(crypto.randomBytes(byteLength))
}

/**
 * Build the otpauth:// URL that an authenticator app scans (as a QR code) or
 * accepts via manual entry.
 */
export function getOtpAuthUrl(secret, email, issuer = 'ECM JIRA') {
  const label = encodeURIComponent(`${issuer}:${email}`)
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  })
  return `otpauth://totp/${label}?${params.toString()}`
}

/**
 * HOTP: derive a code from a secret and an integer counter (RFC 4226).
 */
function generateHOTP(secret, counter) {
  const key = base32Decode(secret)

  // 8-byte big-endian counter.
  const counterBuf = Buffer.alloc(8)
  // Split into hi/lo 32-bit words to stay within safe integer range.
  counterBuf.writeUInt32BE(Math.floor(counter / 0x100000000), 0)
  counterBuf.writeUInt32BE(counter >>> 0, 4)

  const hmac = crypto.createHmac('sha1', key).update(counterBuf).digest()

  // Dynamic truncation (RFC 4226 §5.3).
  const offset = hmac[hmac.length - 1] & 0x0f
  const binCode =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff)

  const otp = binCode % 10 ** DIGITS
  return otp.toString().padStart(DIGITS, '0')
}

/**
 * TOTP: derive the 6-digit code for a given time.
 *
 * @param {string} secret            base32 secret
 * @param {number} [timeStepOrTime]  Unix time in SECONDS (defaults to now).
 *                                    Internally floored into 30s steps.
 */
export function generateTOTP(secret, timeStepOrTime) {
  const nowSeconds =
    typeof timeStepOrTime === 'number' ? timeStepOrTime : Math.floor(Date.now() / 1000)
  const counter = Math.floor(nowSeconds / STEP_SECONDS)
  return generateHOTP(secret, counter)
}

/**
 * Verify a submitted token against the secret, allowing a small clock-drift
 * window (default ±1 step = ±30s). Constant-time compare per candidate.
 *
 * @returns {boolean}
 */
export function verifyTOTP(secret, token, { window = 1, time } = {}) {
  const normalized = String(token || '').replace(/\s/g, '')
  if (!/^\d{6}$/.test(normalized)) return false
  if (!secret) return false

  const nowSeconds = typeof time === 'number' ? time : Math.floor(Date.now() / 1000)
  const counter = Math.floor(nowSeconds / STEP_SECONDS)

  for (let offset = -window; offset <= window; offset++) {
    const candidate = generateHOTP(secret, counter + offset)
    // timingSafeEqual requires equal-length buffers; both are 6 ASCII digits.
    if (
      candidate.length === normalized.length &&
      crypto.timingSafeEqual(Buffer.from(candidate), Buffer.from(normalized))
    ) {
      return true
    }
  }
  return false
}

export default {
  base32Encode,
  base32Decode,
  generateSecret,
  getOtpAuthUrl,
  generateTOTP,
  verifyTOTP,
}
