// JL-137: Image thumbnail generation using `sharp`.
//
// generateThumbnail(buffer, mime, { width }) resizes image mimes to a
// thumbnail buffer (PNG). Non-image mimes return null. Any sharp failure is
// swallowed (logged + null) so a bad/corrupt image never breaks an upload.

const DEFAULT_WIDTH = 200

export function isImageMime(mime) {
  return /^image\//i.test(String(mime || ''))
}

/**
 * Generate a thumbnail for image content.
 * @returns {Promise<Buffer|null>} resized buffer, or null for non-images / failures.
 */
export async function generateThumbnail(buffer, mime, { width = DEFAULT_WIDTH } = {}) {
  if (!isImageMime(mime)) return null
  if (!buffer || buffer.length === 0) return null
  try {
    // Dynamic import so environments/tests can mock 'sharp' and so a missing
    // native binding never crashes module load for the whole route file.
    const sharpMod = await import('sharp')
    const sharp = sharpMod.default || sharpMod
    return await sharp(buffer)
      .resize({ width, withoutEnlargement: true })
      .png()
      .toBuffer()
  } catch (err) {
    console.warn('[thumbnails] thumbnail generation failed:', err?.message || err)
    return null
  }
}
