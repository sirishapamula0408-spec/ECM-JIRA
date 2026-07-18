/**
 * SkipToContent (JL-220) — WCAG 2.4.1 "Bypass Blocks".
 *
 * Visually hidden until keyboard-focused (see .skip-to-content in
 * src/styles/interactions.css). Rendered as the first focusable element
 * in the app shell so the very first Tab press reveals it; activating it
 * jumps focus past the Topbar/Sidebar into <main id="main-content">.
 */
export function SkipToContent() {
  const handleClick = (event) => {
    const main = document.getElementById('main-content')
    if (main) {
      event.preventDefault()
      main.focus()
      main.scrollIntoView?.({ block: 'start' })
    }
  }

  return (
    <a className="skip-to-content" href="#main-content" onClick={handleClick}>
      Skip to main content
    </a>
  )
}
