/**
 * Breadcrumb — the trail above a page title (JL-439).
 *
 * Renders the shared `.breadcrumbs` / `.breadcrumb-*` classes from
 * styles/shared.css, which ProjectTopPanel and IssueDetailPage already render.
 * Before this epic those two had SEPARATE class families that had drifted apart
 * on separator colour, current-item weight and hover; this component is the
 * third consumer of the one that replaced them, not a fourth family.
 *
 * `items` is a list of `{ label, href?, onClick? }`. The LAST item is the
 * current page: it renders as text, not a link, and carries `aria-current`.
 * Separators are `aria-hidden` so a screen reader hears the trail, not slashes.
 */
export function Breadcrumb({ items = [], ariaLabel = 'Breadcrumb', className = '' }) {
  if (items.length === 0) return null

  return (
    <nav className={`breadcrumbs ${className}`.trim()} aria-label={ariaLabel}>
      {items.map((item, i) => {
        const isCurrent = i === items.length - 1
        return (
          <span key={`${item.label}-${i}`} className="breadcrumb-item">
            {i > 0 && <span className="breadcrumb-sep" aria-hidden="true">/</span>}
            {isCurrent || (!item.href && !item.onClick) ? (
              <span className="breadcrumb-current" aria-current={isCurrent ? 'page' : undefined}>
                {item.label}
              </span>
            ) : item.href ? (
              <a className="breadcrumb-link" href={item.href}>{item.label}</a>
            ) : (
              <button type="button" className="breadcrumb-link" onClick={item.onClick}>
                {item.label}
              </button>
            )}
          </span>
        )
      })}
    </nav>
  )
}
