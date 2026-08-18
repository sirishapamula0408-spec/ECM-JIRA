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

// Mirrors --font-family-sans.
const FONT_FAMILY = [
  '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto', 'Oxygen',
  'Ubuntu', '"Fira Sans"', '"Droid Sans"', '"Helvetica Neue"', 'sans-serif',
].join(', ')

// --font-size-* / --line-height-* / --font-weight-*
const SIZE = { xs: 11, sm: 12, base: 14, md: 16, lg: 20, xl: 24, xxl: 29 }
const LEADING = { xs: 16, sm: 16, base: 20, md: 20, lg: 24, xl: 28, xxl: 32 }
const WEIGHT = { regular: 400, medium: 500, semibold: 600, bold: 700 }

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
      primary: { main: '#0052cc' },      // --jira-blue
      error: { main: '#de350b' },        // --jira-danger
      warning: { main: '#ff991f' },      // --jira-warning
      success: { main: '#00875a' },      // --jira-success
      background: { default: c.bg, paper: c.paper },
      text: { primary: c.text, secondary: c.muted },
      divider: c.divider,
    },
    components: {
      // MUI's size variants carry their OWN rem font-sizes, independent of
      // typography.button — size="small" is 0.8125rem, which computed to
      // 11.375px against the 14px root and stayed off-scale even after the
      // typography fix above. Pin both ends onto the token scale.
      MuiButton: {
        styleOverrides: {
          sizeSmall: { fontSize: SIZE.sm + 'px' },
          sizeLarge: { fontSize: SIZE.md + 'px' },
        },
      },
      MuiTableCell: {
        styleOverrides: { sizeSmall: { fontSize: SIZE.sm + 'px' } },
      },
    },
    typography: {
      fontFamily: FONT_FAMILY,
      fontSize: SIZE.base,
      // Headings descend through the scale. Note h5 lands at 14px rather than
      // MUI's 21px — pages that used `variant="h5"` as a PAGE TITLE are being
      // moved to h1 in JL-409, which is where that treatment belongs.
      h1: variant('xxl', WEIGHT.semibold),
      h2: variant('xl', WEIGHT.semibold),
      h3: variant('lg', WEIGHT.semibold),
      h4: variant('md', WEIGHT.semibold),
      h5: variant('base', WEIGHT.semibold),
      h6: variant('sm', WEIGHT.semibold),
      subtitle1: variant('base', WEIGHT.medium),
      subtitle2: variant('sm', WEIGHT.medium),
      body1: variant('base'),
      body2: variant('sm'),
      // 14px matches this project's own `.btn` class, so MUI buttons and CSS
      // buttons finally agree instead of differing by ~2px.
      button: { ...variant('base', WEIGHT.medium), textTransform: 'none' },
      caption: variant('xs'),
      overline: { ...variant('xs', WEIGHT.medium), textTransform: 'uppercase' },
    },
  })
}

export { FONT_FAMILY, SIZE, LEADING, WEIGHT }
