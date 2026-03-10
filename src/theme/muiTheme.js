import { createTheme } from '@mui/material/styles'

const commonTypography = {
  fontFamily: [
    '-apple-system', 'BlinkMacSystemFont', '"Segoe UI"', 'Roboto',
    'Oxygen', 'Ubuntu', '"Fira Sans"', '"Droid Sans"', '"Helvetica Neue"', 'sans-serif',
  ].join(','),
  fontSize: 13,
  h1: { fontSize: 22, fontWeight: 500, lineHeight: '26px' },
  h2: { fontSize: 18, fontWeight: 500, lineHeight: '22px' },
  h3: { fontSize: 14, fontWeight: 600, lineHeight: '18px' },
  h4: { fontSize: 12, fontWeight: 600, lineHeight: '18px' },
  body1: { fontSize: 13, lineHeight: '18px' },
  body2: { fontSize: 12, lineHeight: '18px' },
  caption: { fontSize: 10, lineHeight: '14px', fontWeight: 600, letterSpacing: '0.03em' },
  button: { fontSize: 12, fontWeight: 500, textTransform: 'none' },
}

const commonComponents = {
  MuiButton: {
    defaultProps: { disableElevation: true, size: 'small' },
    styleOverrides: {
      root: { borderRadius: 4, padding: '6px 12px', minHeight: 32 },
      sizeSmall: { padding: '4px 10px', fontSize: 12 },
    },
  },
  MuiIconButton: {
    defaultProps: { size: 'small' },
    styleOverrides: {
      root: { borderRadius: 6 },
      sizeSmall: { padding: 6 },
    },
  },
  MuiChip: {
    defaultProps: { size: 'small' },
    styleOverrides: {
      root: { borderRadius: 4, height: 22, fontSize: 11, fontWeight: 600 },
    },
  },
  MuiCard: {
    defaultProps: { variant: 'outlined' },
    styleOverrides: {
      root: { borderRadius: 6, boxShadow: '0 2px 10px rgba(9, 30, 66, 0.06)' },
    },
  },
  MuiTextField: {
    defaultProps: { size: 'small', variant: 'outlined' },
    styleOverrides: {
      root: { '& .MuiOutlinedInput-root': { borderRadius: 4, fontSize: 12 } },
    },
  },
  MuiSelect: {
    defaultProps: { size: 'small' },
    styleOverrides: {
      root: { borderRadius: 4, fontSize: 12 },
    },
  },
  MuiTableCell: {
    styleOverrides: {
      head: { fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em' },
      body: { fontSize: 12 },
    },
  },
  MuiTooltip: {
    defaultProps: { arrow: true },
    styleOverrides: {
      tooltip: { fontSize: 11, borderRadius: 4 },
    },
  },
  MuiDialog: {
    styleOverrides: {
      paper: { borderRadius: 8 },
    },
  },
  MuiLinearProgress: {
    styleOverrides: {
      root: { borderRadius: 4, height: 6 },
    },
  },
  MuiAvatar: {
    styleOverrides: {
      root: { fontSize: 13, fontWeight: 700, width: 32, height: 32 },
    },
  },
  MuiTab: {
    styleOverrides: {
      root: { fontSize: 12, fontWeight: 500, textTransform: 'none', minHeight: 36, padding: '6px 12px' },
    },
  },
  MuiTabs: {
    styleOverrides: {
      root: { minHeight: 36 },
      indicator: { height: 2 },
    },
  },
}

export const lightTheme = createTheme({
  palette: {
    mode: 'light',
    primary: { main: '#0052cc', light: '#deebff', dark: '#0747a6' },
    secondary: { main: '#6554c0', light: '#eae6ff', dark: '#403294' },
    success: { main: '#00875a', light: '#e3fcef', dark: '#006644' },
    warning: { main: '#ff991f', light: '#fff3e0', dark: '#ff8b00' },
    error: { main: '#de350b', light: '#ffebe6', dark: '#bf2600' },
    info: { main: '#0065ff', light: '#deebff', dark: '#0747a6' },
    background: { default: '#ffffff', paper: '#ffffff' },
    text: { primary: '#172b4d', secondary: '#5e6c84' },
    divider: '#dfe1e6',
    grey: {
      50: '#fafbfc', 100: '#f4f5f7', 200: '#ebecf0', 300: '#dfe1e6',
      400: '#c1c7d0', 500: '#97a0af', 600: '#6b778c', 700: '#5e6c84',
      800: '#42526e', 900: '#253858',
    },
  },
  typography: commonTypography,
  shape: { borderRadius: 4 },
  shadows: [
    'none',
    '0 1px 2px rgba(9,30,66,0.25)',
    '0 2px 10px rgba(9,30,66,0.06)',
    '0 4px 12px rgba(9,30,66,0.1)',
    '0 8px 16px rgba(9,30,66,0.15)',
    ...Array(20).fill('0 8px 16px rgba(9,30,66,0.15)'),
  ],
  components: commonComponents,
})

export const darkTheme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: '#4c9aff', light: '#1c2b41', dark: '#0052cc' },
    secondary: { main: '#998dd9', light: '#2a2541', dark: '#6554c0' },
    success: { main: '#57d9a3', light: '#1c3329', dark: '#36b37e' },
    warning: { main: '#ffab00', light: '#3d2e00', dark: '#ff991f' },
    error: { main: '#ff8f73', light: '#3d1f1f', dark: '#ff5630' },
    info: { main: '#4c9aff', light: '#1c2b41', dark: '#0065ff' },
    background: { default: '#1d2125', paper: '#22272b' },
    text: { primary: '#dfe1e6', secondary: '#9fadbc' },
    divider: '#2c333a',
    grey: {
      50: '#1d2125', 100: '#22272b', 200: '#282e33', 300: '#2c333a',
      400: '#3b444c', 500: '#5e6c84', 600: '#8c9bab', 700: '#9fadbc',
      800: '#b8c7d1', 900: '#dfe1e6',
    },
  },
  typography: commonTypography,
  shape: { borderRadius: 4 },
  shadows: [
    'none',
    '0 1px 2px rgba(0,0,0,0.4)',
    '0 2px 10px rgba(0,0,0,0.2)',
    '0 4px 12px rgba(0,0,0,0.3)',
    '0 8px 16px rgba(0,0,0,0.4)',
    ...Array(20).fill('0 8px 16px rgba(0,0,0,0.4)'),
  ],
  components: {
    ...commonComponents,
    MuiCard: {
      ...commonComponents.MuiCard,
      styleOverrides: {
        root: { borderRadius: 6, boxShadow: 'none', borderColor: '#2c333a' },
      },
    },
  },
})
