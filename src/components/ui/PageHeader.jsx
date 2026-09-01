import { Breadcrumb } from './Breadcrumb'

/**
 * PageHeader — breadcrumb, key, title, actions (JL-439).
 *
 * The title is a plain `<h1>`, and that is load-bearing rather than stylistic.
 * `PageHeadingLevel.JL409` enumerates all 42 page directories and fails if a
 * page has no level-1 heading; the shared `.page h1` rule in layout.css owns
 * the treatment. A `<Typography variant="h4">` bypasses that rule and leaves
 * the page with no h1, and `Typography component="h1"` is not a fix either —
 * it emits an emotion class the shared rule then has to out-specify.
 *
 * `standalone` is for the four pages that root OUTSIDE `.page`
 * (AcceptInvite, ResetPassword, Assets, Portal): it swaps in the
 * `.page-title-standalone` class, which is the one shared rule that reaches
 * them. Do not restate that treatment per page.
 */
export function PageHeader({
  breadcrumbs,
  eyebrow,
  title,
  description,
  actions,
  standalone = false,
  className = '',
}) {
  return (
    <header className={`page-header ${className}`.trim()}>
      {breadcrumbs?.length > 0 && <Breadcrumb items={breadcrumbs} />}
      <div className="page-header-row">
        <div className="page-header-main">
          {eyebrow != null && <div className="page-header-eyebrow">{eyebrow}</div>}
          <h1 className={standalone ? 'page-title-standalone' : undefined}>{title}</h1>
          {description != null && description !== '' && (
            <p className="page-header-description">{description}</p>
          )}
        </div>
        {actions != null && <div className="page-header-actions">{actions}</div>}
      </div>
    </header>
  )
}
