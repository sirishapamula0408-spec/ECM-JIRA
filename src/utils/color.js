// JL-324: colour helpers for the Workflow Editor status nodes.
//
// Status fills come from `issue_statuses.color`, which is NOT NULL and has
// historically been seeded with Atlassian *text* tokens (#42526E, #0052CC,
// #6554C0). Painting the default #172B4D body text on those produced ~1.5:1
// contrast. Rather than ignore the stored colour (which would discard
// user-chosen ones), we derive a readable foreground for whatever fill we end
// up with, so both the new light palette and any legacy/custom colour stay
// legible.

const HEX_SHORT = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i
const HEX_FULL = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i

/** Parse `#abc` / `#aabbcc` into {r,g,b} (0-255). Returns null if unparseable. */
export function parseHex(hex) {
  const value = String(hex || '').trim()
  const short = value.match(HEX_SHORT)
  if (short) {
    return {
      r: parseInt(short[1] + short[1], 16),
      g: parseInt(short[2] + short[2], 16),
      b: parseInt(short[3] + short[3], 16),
    }
  }
  const full = value.match(HEX_FULL)
  if (full) {
    return {
      r: parseInt(full[1], 16),
      g: parseInt(full[2], 16),
      b: parseInt(full[3], 16),
    }
  }
  return null
}

/** WCAG 2.1 relative luminance (0 = black, 1 = white). */
export function relativeLuminance(hex) {
  const rgb = parseHex(hex)
  if (!rgb) return 1 // treat unparseable as white so we fall back to dark text
  const channel = (c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4
  }
  return 0.2126 * channel(rgb.r) + 0.7152 * channel(rgb.g) + 0.0722 * channel(rgb.b)
}

/** WCAG contrast ratio between two hex colours (1..21). */
export function contrastRatio(a, b) {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const lighter = Math.max(la, lb)
  const darker = Math.min(la, lb)
  return (lighter + 0.05) / (darker + 0.05)
}

// Atlassian text tokens: N800 for dark-on-light, N0 for light-on-dark.
export const TEXT_DARK = '#172B4D'
export const TEXT_LIGHT = '#FFFFFF'

/**
 * Pick whichever of dark/light text contrasts better against `bg`.
 * Guarantees the node label is readable on any fill, legacy or custom.
 */
export function readableTextColor(bg) {
  return contrastRatio(bg, TEXT_DARK) >= contrastRatio(bg, TEXT_LIGHT) ? TEXT_DARK : TEXT_LIGHT
}

/** Blend `hex` toward `target` by `amount` (0..1). Used to derive borders from fills. */
export function mix(hex, target, amount) {
  const a = parseHex(hex)
  const b = parseHex(target)
  if (!a || !b) return hex
  const t = Math.min(1, Math.max(0, amount))
  const round = (x) => Math.round(x).toString(16).padStart(2, '0')
  return `#${round(a.r + (b.r - a.r) * t)}${round(a.g + (b.g - a.g) * t)}${round(a.b + (b.b - a.b) * t)}`
}

/**
 * A border one step darker than the fill, so the border and fill can never
 * disagree (previously the border came from the category while the fill came
 * from the status colour, e.g. grey Cancelled with a mint-green `done` border).
 */
export function borderFor(bg) {
  return mix(bg, '#091E42', 0.18)
}
