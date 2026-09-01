import { createTheme } from '@mui/material/styles'

/**
 * JL-408 — the MUI theme this project always assumed it had.
 *
 * Until now no theme existed and `createTheme` was never called, so every MUI
 * component used MUI's DEFAULT theme. That caused two faults:
 *
 *   1. MUI's default fontFamily is Roboto, which this app never loads — it
 *      appears only as one fallback name inside the -apple-system stack in
 *      index.css. So MUI text asked for an absent font while the rest of the app
 *      rendered -apple-system.
 *   2. MUI's default type scale is in rem, so it multiplies against the root
 *      font size. With :root at 14px (JL-396), h5 (1.5rem) computed to 21px,
 *      h4 (2.125rem) to 29.75px and body2 (0.875rem) to 12.25px — none of them
 *      on this project's scale.
 *
 * Every value below is therefore in PX and taken from the same scale as
 * src/styles/variables.css. Keeping px is deliberate: a rem-based theme would
 * re-scale the moment anyone touches the root size again, which is exactly how
 * the drift happened.
 *
 * Keep in sync with variables.css. The JL408 test suite fails if they diverge.
 */

// JL-414: consume --font-family-sans instead of restating it. This used to be
// a third copy of the same stack (index.css and variables.css held the others),
// so a change to one silently left MUI on the old value. Emotion emits this
// verbatim and the browser resolves it from :root.
const FONT_FAMILY = 'var(--font-family-sans, sans-serif)'

// --font-size-* / --line-height-* / --font-weight-*
// JL-414: xs (11px) retired — Atlassian raised it to 12px for accessibility
// and dropped the step, so former xs consumers use sm. xxl corrected 29->28
// (29 was the legacy ADG3 value) and the missing 32px step added.
const SIZE = { xs: 12, sm: 14, base: 16, md: 20, lg: 24, xl: 28, xxl: 32 }
const LEADING = { xs: 16, sm: 20, base: 24, md: 28, lg: 32, xl: 32, xxl: 36 }
// JL-414 (option B): `heading` is Atlassian's optical 653. It is expressible
// only because Inter is a VARIABLE font (wght axis 100-900) — under the old
// static system stack it would have rounded to whatever the platform had.
// Keep in sync with --font-weight-heading in variables.css.
const WEIGHT = { regular: 400, medium: 500, semibold: 600, heading: 653, bold: 700 }

// JL-439 — control geometry, mirroring the --control-height-* / --radius-*
// tokens in variables.css. MUI cannot read a CSS custom property for a value
// it needs to compute against (and `height: var(...)` on a Button works, but
// the numbers are wanted here for the shape/spacing maths anyway), so these
// are the one place the numbers are repeated. MuiThemeTokens.JL408 fails if
// they drift from the stylesheet.
const CONTROL_HEIGHT = 40
const CONTROL_HEIGHT_SM = 32
const RADIUS = { xs: 3, sm: 6, md: 8, lg: 12 }

const variant = (step, weight = WEIGHT.regular) => ({
  fontSize: `${SIZE[step]}px`,
  lineHeight: `${LEADING[step]}px`,
  fontWeight: weight,
})

/** Colour tokens that MUI needs to know about, per theme mode. */
const PALETTE = {
  light: { bg: '#ffffff', paper: '#ffffff', text: '#172b4d', muted: '#5e6c84', divider: '#dfe1e6' },
  dark: { bg: '#1d2125', paper: '#22272b', text: '#dfe1e6', muted: '#9fadbc', divider: '#2c333a' },
}

export function buildMuiTheme(mode = 'light') {
  const c = PALETTE[mode] ?? PALETTE.light
  return createTheme({
    palette: {
      mode,
      primary: { main: '#0c66e4' },      // --jira-blue (JL-438: refreshed)
      error: { main: '#de350b' },        // --jira-danger
      warning: { main: '#ff991f' },      // --jira-warning
      success: { main: '#00875a' },      // --jira-success
      background: { default: c.bg, paper: c.paper },
      text: { primary: c.text, secondary: c.muted },
      divider: c.divider,
    },
    shape: { borderRadius: RADIUS.sm },
    components: {
      // ── JL-439 ────────────────────────────────────────────────────────
      // Why this block exists: 25 of the 44 pages render MUI Button, Select,
      // TextField, Table and Dialog, and the other 19 hand-roll the same
      // controls in page CSS. styles/shared.css now states one contract for
      // the hand-rolled half; this states the SAME contract for the MUI half,
      // once, instead of each page passing sx props. Adding a component here
      // is how a control changes app-wide — not by editing a page.
      //
      // MUI's size variants also carry their OWN rem font-sizes, independent
      // of typography.button — size="small" is 0.8125rem, which computed to
      // 11.375px against the 14px root and stayed off-scale even after the
      // typography fix below. Pinning both ends onto the token scale (JL-408)
      // is still done here.
      MuiButton: {
        defaultProps: { disableElevation: true },
        styleOverrides: {
          root: {
            minHeight: CONTROL_HEIGHT,
            borderRadius: RADIUS.sm,
            padding: '0 14px',
            fontWeight: WEIGHT.medium,
          },
          sizeSmall: { fontSize: SIZE.sm + 'px', minHeight: CONTROL_HEIGHT_SM, padding: '0 10px' },
          sizeLarge: { fontSize: SIZE.md + 'px', minHeight: 48 },
          contained: { fontWeight: WEIGHT.semibold },
        },
      },
      MuiIconButton: {
        styleOverrides: {
          root: { borderRadius: RADIUS.sm },
        },
      },
      // Brief §36: 40px tall, radius 6, the stronger hairline on the control
      // itself so a field reads as interactive against a bordered card.
      MuiOutlinedInput: {
        styleOverrides: {
          root: { borderRadius: RADIUS.sm },
          input: { fontSize: SIZE.base + 'px' },
          inputSizeSmall: { fontSize: SIZE.sm + 'px' },
        },
      },
      MuiInputLabel: {
        styleOverrides: { root: { fontSize: SIZE.sm + 'px', fontWeight: WEIGHT.medium } },
      },
      MuiFormHelperText: {
        styleOverrides: { root: { fontSize: SIZE.xs + 'px' } },
      },
      MuiSelect: {
        styleOverrides: { select: { minHeight: 0 } },
      },
      MuiMenuItem: {
        styleOverrides: { root: { fontSize: SIZE.base + 'px', minHeight: CONTROL_HEIGHT_SM } },
      },
      // Brief §35: one table design app-wide. Sunken header, 14/600 header
      // text, 12x16 cells.
      MuiTableCell: {
        styleOverrides: {
          root: { padding: '12px 16px', fontSize: SIZE.base + 'px' },
          head: {
            fontSize: SIZE.sm + 'px',
            fontWeight: WEIGHT.semibold,
            textTransform: 'uppercase',
            letterSpacing: '0.03em',
          },
          sizeSmall: { fontSize: SIZE.sm + 'px', padding: '8px 12px' },
        },
      },
      // Brief §37: radius 8, 24px padding, the overlay shadow — not MUI’s
      // default elevation stack, which the brief rules out (§34).
      MuiDialog: {
        styleOverrides: {
          paper: {
            borderRadius: RADIUS.md,
            boxShadow: 'var(--shadow-overlay, 0 4px 8px rgba(9, 30, 66, 0.15))',
          },
        },
      },
      MuiDialogTitle: {
        styleOverrides: { root: { fontSize: SIZE.md + 'px', fontWeight: WEIGHT.semibold, padding: '24px 24px 8px' } },
      },
      MuiDialogContent: {
        styleOverrides: { root: { padding: '8px 24px' } },
      },
      MuiDialogActions: {
        styleOverrides: { root: { padding: '16px 24px 24px' } },
      },
      MuiMenu: {
        styleOverrides: {
          paper: { borderRadius: RADIUS.md, boxShadow: 'var(--shadow-overlay, 0 4px 8px rgba(9, 30, 66, 0.15))' },
        },
      },
      MuiTooltip: {
        styleOverrides: { tooltip: { fontSize: SIZE.xs + 'px', borderRadius: RADIUS.xs } },
      },
      // Brief §38: 48px tall, 14/500, no shouting caps.
      MuiTab: {
        styleOverrides: {
          root: {
            minHeight: 48,
            textTransform: 'none',
            fontSize: SIZE.sm + 'px',
            fontWeight: WEIGHT.medium,
          },
        },
      },
      MuiTabs: {
        styleOverrides: { root: { minHeight: 48 } },
      },
      MuiChip: {
        styleOverrides: { root: { borderRadius: RADIUS.xs, fontSize: SIZE.sm + 'px' } },
      },
      MuiAlert: {
        styleOverrides: { root: { borderRadius: RADIUS.sm, fontSize: SIZE.base + 'px' } },
      },
      MuiPaper: {
        styleOverrides: { rounded: { borderRadius: RADIUS.md } },
      },
    },
    typography: {
      fontFamily: FONT_FAMILY,
      fontSize: SIZE.base,
      // Headings descend through the scale. Note h5 lands at 14px rather than
      // MUI's 21px — pages that used `variant="h5"` as a PAGE TITLE are being
      // moved to h1 in JL-409, which is where that treatment belongs.
      h1: variant('xxl', WEIGHT.heading),
      h2: variant('xl', WEIGHT.heading),
      h3: variant('lg', WEIGHT.heading),
      h4: variant('md', WEIGHT.heading),
      h5: variant('base', WEIGHT.semibold),
      h6: variant('sm', WEIGHT.semibold),
      subtitle1: variant('base', WEIGHT.medium),
      subtitle2: variant('sm', WEIGHT.medium),
      body1: variant('base'),
      body2: variant('sm'),
      // 14px matches this project's own `.btn` class, so MUI buttons and CSS
      // buttons finally agree instead of differing by ~2px.
      button: { ...variant('base', WEIGHT.medium), textTransform: 'none' },
      // JL-414: were variant('xs') at 11px; xs is retired, so both move to the
      // 12px step. This is the same accessibility raise, applied to MUI.
      caption: variant('sm'),
      overline: { ...variant('sm', WEIGHT.medium), textTransform: 'uppercase' },
    },
  })
}

export { FONT_FAMILY, SIZE, LEADING, WEIGHT, CONTROL_HEIGHT, CONTROL_HEIGHT_SM, RADIUS }
