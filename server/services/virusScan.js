// JL-137: Virus-scan hook for uploaded attachments.
//
// scanBuffer(buffer) -> { clean: boolean, reason? }
//
// Real anti-virus needs an external daemon (e.g. ClamAV/clamd). This is a
// documented, pluggable hook: by default it ALLOWS everything except the
// standard EICAR test signature, which lets us exercise the reject path in
// tests and smoke-tests without a live scanner. Swap this implementation for a
// clamd client when one is available.

// The EICAR anti-virus test string (industry-standard harmless test file).
// Assembled from fragments so this source file itself is not flagged by AV.
const EICAR_SIGNATURE =
  'X5O!P%@AP[4\\PZX54(P^)7CC)7}' +
  '$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*'

/**
 * Scan a buffer for known-bad signatures.
 * @param {Buffer} buffer
 * @returns {Promise<{ clean: boolean, reason?: string }>}
 */
export async function scanBuffer(buffer) {
  if (!buffer || buffer.length === 0) return { clean: true }
  // EICAR test files are ASCII and small; a substring check is sufficient.
  const text = buffer.toString('latin1')
  if (text.includes(EICAR_SIGNATURE)) {
    return { clean: false, reason: 'EICAR test signature detected' }
  }
  return { clean: true }
}

export { EICAR_SIGNATURE }
