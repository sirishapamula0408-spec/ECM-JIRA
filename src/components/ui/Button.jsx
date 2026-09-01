import MuiButton from '@mui/material/Button'

/**
 * Button — the one button in the design system (JL-439).
 *
 * A thin wrapper over MUI's Button rather than a hand-rolled `<button>`, and
 * deliberately so: MUI's already carries the ripple, the disabled semantics,
 * the `component`/`href` polymorphism and the focus handling, and `muiTheme.js`
 * already states this project's geometry for it (40px, radius 6, 14px padding,
 * no elevation). Re-implementing that in a bare element would mean a second
 * place where "what a button looks like" is decided, which is the thing this
 * epic removes.
 *
 * What this file adds on top is the project's OWN vocabulary. MUI's variants
 * are text/outlined/contained, which say how a button is painted; ours say what
 * it is for, so a page picks a role and the design system picks the paint:
 *
 *   primary    the one affirmative action  — filled brand blue
 *   secondary  the default                 — white, bordered   (MUI: outlined)
 *   subtle     low-emphasis / toolbar      — transparent       (MUI: text)
 *   danger     destructive                 — bordered, red TEXT, not a red fill
 *
 * `danger` is bordered rather than filled on purpose: the brief says not to
 * make Delete completely red. Pass `variant="primary" color="error"` if you
 * genuinely need a filled destructive button.
 *
 * Props: `variant` (above), plus everything MUI Button takes.
 */
const VARIANTS = {
  primary: { variant: 'contained', color: 'primary' },
  secondary: { variant: 'outlined', color: 'inherit' },
  subtle: { variant: 'text', color: 'inherit' },
  danger: { variant: 'outlined', color: 'error' },
}

export function Button({ variant = 'secondary', className = '', ...rest }) {
  const mapped = VARIANTS[variant] ?? VARIANTS.secondary
  return (
    <MuiButton
      {...mapped}
      className={`ds-button ds-button--${variant} ${className}`.trim()}
      {...rest}
    />
  )
}
