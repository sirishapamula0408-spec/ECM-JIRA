// Project-logo helpers shared by the create form, Project Settings and the
// sidebar. Kept apart from api/projectApi.js on purpose: dozens of tests mock
// that module wholesale, and constants read at render time must not vanish
// with the mock.

// Mirrors server/services/projectLogo.js. The server re-checks everything.
export const PROJECT_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']
export const PROJECT_LOGO_MAX_BYTES = 1024 * 1024

const NOT_AN_IMAGE = 'Use a PNG, JPEG, GIF or WebP image'

/** The image type the bytes say (same magic numbers as the server), or null. */
export function sniffImageBytes(bytes) {
  const b = bytes
  if (!b || b.length < 12) return null
  const ascii = (from, to) => String.fromCharCode(...b.slice(from, to))
  if (b[0] === 0x89 && ascii(1, 4) === 'PNG' && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return 'image/png'
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg'
  if (ascii(0, 6) === 'GIF87a' || ascii(0, 6) === 'GIF89a') return 'image/gif'
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp'
  return null
}

function readHead(file, length = 12) {
  return new Promise((resolve) => {
    try {
      const reader = new FileReader()
      reader.onload = () => resolve(new Uint8Array(reader.result || new ArrayBuffer(0)))
      reader.onerror = () => resolve(new Uint8Array(0))
      reader.readAsArrayBuffer(file.slice(0, length))
    } catch {
      resolve(new Uint8Array(0))
    }
  })
}

/**
 * A user-facing reason this file can't be a project logo, or '' when it can.
 * Checks the declared type and size, then the file's actual first bytes — a
 * text file renamed logo.png is refused here, before anything is uploaded.
 */
export async function projectLogoProblem(file) {
  if (!file) return 'Choose an image'
  if (!PROJECT_LOGO_TYPES.includes(file.type)) return NOT_AN_IMAGE
  if (file.size > PROJECT_LOGO_MAX_BYTES) return 'The logo must be 1 MB or smaller'
  if (!sniffImageBytes(await readHead(file))) return NOT_AN_IMAGE
  return ''
}

/**
 * Tell other parts of the app (the sidebar's project list) that a project's
 * details changed, so they re-fetch. Detail is the updated project.
 */
export const PROJECT_CHANGED_EVENT = 'project-changed'
export function announceProjectChanged(project) {
  window.dispatchEvent(new CustomEvent(PROJECT_CHANGED_EVENT, { detail: project }))
}
