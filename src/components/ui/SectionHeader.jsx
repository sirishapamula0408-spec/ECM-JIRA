import { createElement } from 'react'

/**
 * SectionHeader — the "DESCRIPTION" / "DETAILS" heading above a block
 * (JL-439).
 *
 * Renders the shared `.section-label` class, which carries the treatment the
 * brief specifies (18/600, muted, 0.3px tracking, uppercase).
 *
 * `level` defaults to 2. Pass the level that is correct for where the section
 * sits in the document — a section inside a page whose title is the `<h1>` is
 * an `h2`, one nested inside that is an `h3`. The visual treatment does not
 * change with the level, which is the point: heading level is document
 * structure, and picking one for its size is how heading order gets broken.
 *
 * The element is built with createElement rather than a `<Tag>` capitalised
 * binding because ESLint's no-unused-vars does not count JSX usage of a
 * destructured parameter here and flags the binding as dead.
 */
export function SectionHeader({ level = 2, children, actions, id, className = '' }) {
  const heading = createElement(
    `h${level}`,
    { id, className: `section-label ${className}`.trim() },
    children,
  )

  if (actions == null) return heading

  return (
    <div className="section-header-row">
      {heading}
      <div className="section-header-actions">{actions}</div>
    </div>
  )
}
