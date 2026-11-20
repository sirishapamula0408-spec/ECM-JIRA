/*
 * Project logos.
 *
 * Stored through the same storage service as attachments and team photos
 * (local disk, or S3), uploaded base64-over-JSON like they are, so there is no
 * second upload path. The project row keeps only the storage key and the type;
 * clients get `logo_url`, a versioned link to GET /api/projects/:id/logo.
 *
 * The type is decided by the file's own bytes, never by the name or the
 * client-declared MIME type, and only PNG, JPEG, GIF and WebP are accepted.
 * In particular SVG is refused: an SVG is a document that can carry script,
 * and the logo is served from the app's own origin.
 */

export const MAX_LOGO_BYTES = 1024 * 1024 // 1 MB — a logo is shown at most 80px wide
export const LOGO_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

/** The image type the bytes actually are, or null when not an accepted image. */
export function sniffImageType(buffer) {
  if (!buffer || buffer.length < 12) return null
  const b = buffer
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png'
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  const head6 = b.subarray(0, 6).toString('ascii')
  if (head6 === 'GIF87a' || head6 === 'GIF89a') return 'image/gif'
  if (b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp'
  return null
}

/**
 * Decode and check an upload body { dataBase64 }. Returns { buffer, mime } or
 * { status, error } for a refusal.
 */
export function validateLogoUpload(body) {
  const raw = String(body?.dataBase64 || '').replace(/^data:[^,]*,/, '')
  if (!raw) return { status: 400, error: 'dataBase64 is required' }
  // Cheap size check before decoding: base64 is 4 chars per 3 bytes.
  if (Math.floor((raw.length * 3) / 4) > MAX_LOGO_BYTES + 3) {
    return { status: 413, error: 'Project logo is too large. Maximum allowed size is 1 MB' }
  }
  const buffer = Buffer.from(raw, 'base64')
  if (buffer.length === 0) return { status: 400, error: 'Empty file' }
  if (buffer.length > MAX_LOGO_BYTES) {
    return { status: 413, error: 'Project logo is too large. Maximum allowed size is 1 MB' }
  }
  const mime = sniffImageType(buffer)
  if (!mime) return { status: 400, error: 'Project logo must be a PNG, JPEG, GIF or WebP image' }
  return { buffer, mime }
}

/**
 * The public shape of a project row: storage internals removed, `logo_url`
 * added (null when there is no logo). The `?v=` changes with every new logo.
 */
export function withLogoUrl(row) {
  if (!row || typeof row !== 'object') return row
  const { logo_key: key, logo_mime: _mime, logo_updated_at: updated, ...rest } = row
  const version = updated ? new Date(updated).getTime() : 0
  return { ...rest, logo_url: key ? `/api/projects/${row.id}/logo?v=${version}` : null }
}
