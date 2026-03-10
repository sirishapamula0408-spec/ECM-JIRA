import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { forgotPassword, resetPassword } from '../../api/authApi'
import sedinLogo from '../../assets/sedin-logo.svg'
import sedinLogoFull from '../../assets/sedin-logo-full.svg'
import './LoginPage.css'

// MUI components
import Box from '@mui/material/Box'
import Stack from '@mui/material/Stack'
import Card from '@mui/material/Card'
import TextField from '@mui/material/TextField'
import Button from '@mui/material/Button'
import Typography from '@mui/material/Typography'
import Tabs from '@mui/material/Tabs'
import Tab from '@mui/material/Tab'
import FormControlLabel from '@mui/material/FormControlLabel'
import Checkbox from '@mui/material/Checkbox'
import Alert from '@mui/material/Alert'
import Link from '@mui/material/Link'
import CircularProgress from '@mui/material/CircularProgress'
import InputAdornment from '@mui/material/InputAdornment'
import IconButton from '@mui/material/IconButton'

// MUI icons
import EmailIcon from '@mui/icons-material/Email'
import LockIcon from '@mui/icons-material/Lock'
import VisibilityIcon from '@mui/icons-material/Visibility'
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff'
import PersonIcon from '@mui/icons-material/Person'
import VpnKeyIcon from '@mui/icons-material/VpnKey'
import CheckCircleOutlineIcon from '@mui/icons-material/CheckCircleOutline'

export function LoginPage() {
  const { handleAuth } = useAuth()
  const [mode, setMode] = useState('login')
  const [form, setForm] = useState({
    email: '',
    password: '',
    remember: false,
  })
  const [showPassword, setShowPassword] = useState(false)
  const [authError, setAuthError] = useState('')
  const [authLoading, setAuthLoading] = useState(false)

  // Forgot password state
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotLoading, setForgotLoading] = useState(false)
  const [forgotError, setForgotError] = useState('')
  const [resetToken, setResetToken] = useState('')
  const [forgotStep, setForgotStep] = useState('email') // 'email' | 'token' | 'done'
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [resetSuccess, setResetSuccess] = useState('')

  const canSubmit = form.email.trim() && form.password.trim()

  function switchMode(newMode) {
    setMode(newMode)
    setAuthError('')
  }

  function openForgotPassword(e) {
    e.preventDefault()
    setForgotEmail(form.email)
    setForgotError('')
    setResetToken('')
    setNewPassword('')
    setConfirmPassword('')
    setForgotStep('email')
    setResetSuccess('')
    setMode('forgot')
  }

  function backToLogin() {
    setMode('login')
    setAuthError('')
    setForgotError('')
  }

  async function handleForgotSubmit(e) {
    e.preventDefault()
    setForgotError('')
    setForgotLoading(true)
    try {
      const result = await forgotPassword(forgotEmail.trim())
      if (result.resetToken) {
        setResetToken(result.resetToken)
      }
      setForgotStep('token')
    } catch (error) {
      setForgotError(error?.message || 'Failed to send reset request')
    } finally {
      setForgotLoading(false)
    }
  }

  async function handleResetSubmit(e) {
    e.preventDefault()
    setForgotError('')
    if (newPassword.length < 6) {
      setForgotError('Password must be at least 6 characters')
      return
    }
    if (newPassword !== confirmPassword) {
      setForgotError('Passwords do not match')
      return
    }
    setForgotLoading(true)
    try {
      const result = await resetPassword(resetToken, newPassword)
      setResetSuccess(result.message || 'Password reset successfully!')
      setForgotStep('done')
    } catch (error) {
      setForgotError(error?.message || 'Failed to reset password')
    } finally {
      setForgotLoading(false)
    }
  }

  async function onSubmit(e) {
    e.preventDefault()
    setAuthError('')
    setAuthLoading(true)
    try {
      await handleAuth(mode, { email: form.email.trim(), password: form.password, remember: form.remember })
    } catch (error) {
      setAuthError(error?.message || 'Authentication failed')
    } finally {
      setAuthLoading(false)
    }
  }

  const tabIndex = mode === 'login' ? 0 : 1

  return (
    <div className="login-page">
      {/* Left branded panel */}
      <div className="login-brand-panel">
        {/* Constellation network background */}
        <svg className="login-constellation" viewBox="0 0 800 900" preserveAspectRatio="xMidYMid slice">
          {/* Nodes */}
          <circle cx="120" cy="80" r="2.5" fill="rgba(255,255,255,0.5)" />
          <circle cx="300" cy="50" r="1.5" fill="rgba(255,255,255,0.3)" />
          <circle cx="500" cy="90" r="3" fill="rgba(255,255,255,0.45)" />
          <circle cx="680" cy="60" r="2" fill="rgba(255,255,255,0.35)" />
          <circle cx="50" cy="200" r="2" fill="rgba(255,255,255,0.4)" />
          <circle cx="220" cy="220" r="3.5" fill="rgba(255,255,255,0.5)" />
          <circle cx="400" cy="180" r="2" fill="rgba(255,255,255,0.3)" />
          <circle cx="580" cy="210" r="2.5" fill="rgba(255,255,255,0.45)" />
          <circle cx="750" cy="190" r="1.5" fill="rgba(255,255,255,0.3)" />
          <circle cx="100" cy="350" r="2" fill="rgba(255,255,255,0.35)" />
          <circle cx="280" cy="380" r="3" fill="rgba(255,255,255,0.5)" />
          <circle cx="460" cy="340" r="2" fill="rgba(255,255,255,0.4)" />
          <circle cx="640" cy="370" r="2.5" fill="rgba(255,255,255,0.35)" />
          <circle cx="160" cy="500" r="2.5" fill="rgba(255,255,255,0.4)" />
          <circle cx="350" cy="520" r="2" fill="rgba(255,255,255,0.3)" />
          <circle cx="530" cy="480" r="3" fill="rgba(255,255,255,0.5)" />
          <circle cx="700" cy="510" r="2" fill="rgba(255,255,255,0.35)" />
          <circle cx="80" cy="640" r="1.5" fill="rgba(255,255,255,0.3)" />
          <circle cx="240" cy="660" r="2.5" fill="rgba(255,255,255,0.45)" />
          <circle cx="420" cy="630" r="2" fill="rgba(255,255,255,0.35)" />
          <circle cx="600" cy="650" r="3" fill="rgba(255,255,255,0.4)" />
          <circle cx="760" cy="680" r="2" fill="rgba(255,255,255,0.3)" />
          <circle cx="140" cy="790" r="2" fill="rgba(255,255,255,0.35)" />
          <circle cx="320" cy="810" r="2.5" fill="rgba(255,255,255,0.4)" />
          <circle cx="500" cy="780" r="1.5" fill="rgba(255,255,255,0.3)" />
          <circle cx="660" cy="820" r="2.5" fill="rgba(255,255,255,0.45)" />
          <circle cx="380" cy="120" r="1.5" fill="rgba(255,255,255,0.25)" />
          <circle cx="190" cy="440" r="1.5" fill="rgba(255,255,255,0.25)" />
          <circle cx="550" cy="560" r="1.5" fill="rgba(255,255,255,0.25)" />
          <circle cx="720" cy="300" r="1.5" fill="rgba(255,255,255,0.25)" />
          {/* Lines connecting nodes */}
          <line x1="120" y1="80" x2="300" y2="50" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
          <line x1="300" y1="50" x2="500" y2="90" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
          <line x1="500" y1="90" x2="680" y2="60" stroke="rgba(255,255,255,0.07)" strokeWidth="1" />
          <line x1="120" y1="80" x2="220" y2="220" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
          <line x1="300" y1="50" x2="220" y2="220" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
          <line x1="220" y1="220" x2="400" y2="180" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
          <line x1="400" y1="180" x2="580" y2="210" stroke="rgba(255,255,255,0.07)" strokeWidth="1" />
          <line x1="580" y1="210" x2="500" y2="90" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
          <line x1="50" y1="200" x2="220" y2="220" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
          <line x1="220" y1="220" x2="280" y2="380" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
          <line x1="280" y1="380" x2="460" y2="340" stroke="rgba(255,255,255,0.07)" strokeWidth="1" />
          <line x1="460" y1="340" x2="640" y2="370" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
          <line x1="640" y1="370" x2="580" y2="210" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
          <line x1="100" y1="350" x2="280" y2="380" stroke="rgba(255,255,255,0.07)" strokeWidth="1" />
          <line x1="100" y1="350" x2="160" y2="500" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
          <line x1="160" y1="500" x2="350" y2="520" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
          <line x1="350" y1="520" x2="530" y2="480" stroke="rgba(255,255,255,0.1)" strokeWidth="1" />
          <line x1="530" y1="480" x2="700" y2="510" stroke="rgba(255,255,255,0.07)" strokeWidth="1" />
          <line x1="530" y1="480" x2="460" y2="340" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
          <line x1="280" y1="380" x2="350" y2="520" stroke="rgba(255,255,255,0.07)" strokeWidth="1" />
          <line x1="160" y1="500" x2="240" y2="660" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
          <line x1="240" y1="660" x2="420" y2="630" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
          <line x1="420" y1="630" x2="600" y2="650" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
          <line x1="600" y1="650" x2="700" y2="510" stroke="rgba(255,255,255,0.07)" strokeWidth="1" />
          <line x1="80" y1="640" x2="240" y2="660" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
          <line x1="240" y1="660" x2="320" y2="810" stroke="rgba(255,255,255,0.07)" strokeWidth="1" />
          <line x1="320" y1="810" x2="500" y2="780" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
          <line x1="500" y1="780" x2="660" y2="820" stroke="rgba(255,255,255,0.08)" strokeWidth="1" />
          <line x1="600" y1="650" x2="660" y2="820" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
          <line x1="140" y1="790" x2="320" y2="810" stroke="rgba(255,255,255,0.07)" strokeWidth="1" />
          <line x1="380" y1="120" x2="400" y2="180" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
          <line x1="720" y1="300" x2="640" y2="370" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
          <line x1="190" y1="440" x2="280" y2="380" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
          <line x1="550" y1="560" x2="530" y2="480" stroke="rgba(255,255,255,0.05)" strokeWidth="1" />
          <line x1="750" y1="190" x2="680" y2="60" stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
        </svg>

        {/* Top-left corner logo */}
        <div className="login-brand-corner-logo">
          <img src={sedinLogo} alt="" className="login-brand-corner-icon" />
          <span>Sedin</span>
        </div>

        <div className="login-brand-content">
          <div className="login-brand-logo">
            <span className="login-brand-logo-text">ECM Division</span>
          </div>
          <h1 className="login-brand-headline">
            Project management,<br />simplified.
          </h1>
          <p className="login-brand-desc">
            Plan sprints, track issues, and ship products faster with your team — all in one place.
          </p>
          <div className="login-brand-features">
            <div className="login-brand-feature">
              <span className="login-feature-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/></svg>
              </span>
              <span>Kanban &amp; Scrum boards</span>
            </div>
            <div className="login-brand-feature">
              <span className="login-feature-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
              </span>
              <span>Real-time collaboration</span>
            </div>
            <div className="login-brand-feature">
              <span className="login-feature-icon">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              </span>
              <span>Sprint planning &amp; tracking</span>
            </div>
          </div>
        </div>
        <div className="login-brand-footer">
          &copy; 2026 Sedin Technologies. All rights reserved.
        </div>
      </div>

      {/* Right form panel */}
      <div className="login-form-panel">
        <Box sx={{ width: '100%', maxWidth: 360 }}>
          {/* Mobile logo (hidden on desktop) */}
          <div className="login-mobile-logo">
            <img src={sedinLogo} alt="Sedin logo" />
            <span>Sedin</span>
          </div>

          {mode !== 'forgot' ? (
            <>
              <Box sx={{ mb: 3 }}>
                <Typography variant="h5" sx={{ fontWeight: 600, color: '#172b4d', mb: 0.5, letterSpacing: '-0.01em' }}>
                  {mode === 'login' ? 'Welcome back' : 'Create your account'}
                </Typography>
                <Typography variant="body2" sx={{ color: '#6b778c' }}>
                  {mode === 'login' ? 'Sign in to continue to your workspace.' : 'Get started with your free account today.'}
                </Typography>
              </Box>

              <Tabs
                value={tabIndex}
                onChange={(_, newVal) => switchMode(newVal === 0 ? 'login' : 'signup')}
                variant="fullWidth"
                sx={{
                  mb: 2.5,
                  minHeight: 36,
                  bgcolor: '#ebecf0',
                  borderRadius: '8px',
                  p: '3px',
                  '& .MuiTabs-indicator': { display: 'none' },
                  '& .MuiTab-root': {
                    minHeight: 34,
                    fontSize: '11px',
                    fontWeight: 600,
                    textTransform: 'none',
                    borderRadius: '6px',
                    color: '#5e6c84',
                    py: 0,
                    '&.Mui-selected': {
                      bgcolor: '#ffffff',
                      color: '#172b4d',
                      boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                    },
                  },
                }}
              >
                <Tab label="Log In" />
                <Tab label="Sign Up" />
              </Tabs>

              <form onSubmit={onSubmit}>
                <Stack spacing={2}>
                  <TextField
                    id="login-email"
                    label="Email address"
                    value={form.email}
                    onChange={(e) => setForm((c) => ({ ...c, email: e.target.value }))}
                    placeholder="name@company.com"
                    type="email"
                    autoComplete="email"
                    fullWidth
                    size="small"
                    slotProps={{
                      input: {
                        startAdornment: (
                          <InputAdornment position="start">
                            <EmailIcon sx={{ fontSize: 18, color: '#98a2b3' }} />
                          </InputAdornment>
                        ),
                      },
                    }}
                  />

                  <Box>
                    {mode === 'login' && (
                      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 0.5 }}>
                        <Link
                          component="button"
                          type="button"
                          variant="body2"
                          underline="hover"
                          onClick={openForgotPassword}
                          sx={{ fontSize: '11px', color: '#0052cc' }}
                        >
                          Forgot password?
                        </Link>
                      </Box>
                    )}
                    <TextField
                      id="login-password"
                      label="Password"
                      value={form.password}
                      onChange={(e) => setForm((c) => ({ ...c, password: e.target.value }))}
                      placeholder={mode === 'signup' ? 'Min. 6 characters' : 'Enter your password'}
                      type={showPassword ? 'text' : 'password'}
                      autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                      fullWidth
                      size="small"
                      slotProps={{
                        input: {
                          startAdornment: (
                            <InputAdornment position="start">
                              <LockIcon sx={{ fontSize: 18, color: '#98a2b3' }} />
                            </InputAdornment>
                          ),
                          endAdornment: (
                            <InputAdornment position="end">
                              <IconButton
                                onClick={() => setShowPassword(!showPassword)}
                                edge="end"
                                size="small"
                                aria-label={showPassword ? 'Hide password' : 'Show password'}
                              >
                                {showPassword ? <VisibilityOffIcon sx={{ fontSize: 18 }} /> : <VisibilityIcon sx={{ fontSize: 18 }} />}
                              </IconButton>
                            </InputAdornment>
                          ),
                        },
                      }}
                    />
                  </Box>

                  {mode === 'login' && (
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={form.remember}
                          onChange={(e) => setForm((c) => ({ ...c, remember: e.target.checked }))}
                          size="small"
                          sx={{ color: '#5e6c84', '&.Mui-checked': { color: '#0052cc' } }}
                        />
                      }
                      label={
                        <Typography variant="body2" sx={{ fontSize: '10px', fontWeight: 600, color: '#5e6c84', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                          Keep me signed in
                        </Typography>
                      }
                    />
                  )}

                  {authError && (
                    <Alert severity="error" variant="filled" sx={{ fontSize: '11px' }}>
                      {authError}
                    </Alert>
                  )}

                  <Button
                    type="submit"
                    variant="contained"
                    fullWidth
                    disabled={!canSubmit || authLoading}
                    sx={{
                      height: 42,
                      bgcolor: '#0052cc',
                      fontWeight: 600,
                      fontSize: '13px',
                      textTransform: 'none',
                      borderRadius: '6px',
                      letterSpacing: '0.01em',
                      '&:hover': { bgcolor: '#0747a6', boxShadow: '0 2px 8px rgba(0,82,204,0.25)' },
                      '&.Mui-disabled': { opacity: 0.45, bgcolor: '#0052cc', color: '#fff' },
                    }}
                  >
                    {authLoading && <CircularProgress size={16} sx={{ color: '#fff', mr: 1 }} />}
                    {authLoading ? 'Please wait...' : mode === 'login' ? 'Log In \u2192' : 'Create Account \u2192'}
                  </Button>
                </Stack>
              </form>

              <Typography variant="body2" sx={{ mt: 2.5, textAlign: 'center', color: '#6b778c', fontSize: '11px' }}>
                {mode === 'login' ? (
                  <>Don't have an account?{' '}
                    <Link component="button" type="button" underline="hover" onClick={() => switchMode('signup')} sx={{ fontSize: '11px', fontWeight: 600, color: '#0052cc' }}>
                      Sign up
                    </Link>
                  </>
                ) : (
                  <>Already have an account?{' '}
                    <Link component="button" type="button" underline="hover" onClick={() => switchMode('login')} sx={{ fontSize: '11px', fontWeight: 600, color: '#0052cc' }}>
                      Log in
                    </Link>
                  </>
                )}
              </Typography>
            </>
          ) : (
            <>
              <Box sx={{ mb: 3 }}>
                <Typography variant="h5" sx={{ fontWeight: 600, color: '#172b4d', mb: 0.5, letterSpacing: '-0.01em' }}>
                  {forgotStep === 'done' ? 'Password reset' : 'Reset your password'}
                </Typography>
                <Typography variant="body2" sx={{ color: '#6b778c' }}>
                  {forgotStep === 'email' && 'Enter your email address and we\'ll send you a reset token.'}
                  {forgotStep === 'token' && 'Enter the reset token and choose a new password.'}
                  {forgotStep === 'done' && 'Your password has been updated successfully.'}
                </Typography>
              </Box>

              {forgotStep === 'email' && (
                <form onSubmit={handleForgotSubmit}>
                  <Stack spacing={2}>
                    <TextField
                      id="forgot-email"
                      label="Email address"
                      value={forgotEmail}
                      onChange={(e) => setForgotEmail(e.target.value)}
                      placeholder="name@company.com"
                      type="email"
                      autoComplete="email"
                      required
                      fullWidth
                      size="small"
                      slotProps={{
                        input: {
                          startAdornment: (
                            <InputAdornment position="start">
                              <EmailIcon sx={{ fontSize: 18, color: '#98a2b3' }} />
                            </InputAdornment>
                          ),
                        },
                      }}
                    />

                    {forgotError && (
                      <Alert severity="error" variant="filled" sx={{ fontSize: '11px' }}>
                        {forgotError}
                      </Alert>
                    )}

                    <Button
                      type="submit"
                      variant="contained"
                      fullWidth
                      disabled={!forgotEmail.trim() || forgotLoading}
                      sx={{
                        height: 42,
                        bgcolor: '#0052cc',
                        fontWeight: 600,
                        fontSize: '13px',
                        textTransform: 'none',
                        borderRadius: '6px',
                        '&:hover': { bgcolor: '#0747a6', boxShadow: '0 2px 8px rgba(0,82,204,0.25)' },
                        '&.Mui-disabled': { opacity: 0.45, bgcolor: '#0052cc', color: '#fff' },
                      }}
                    >
                      {forgotLoading && <CircularProgress size={16} sx={{ color: '#fff', mr: 1 }} />}
                      {forgotLoading ? 'Sending...' : 'Send Reset Token'}
                    </Button>
                  </Stack>
                </form>
              )}

              {forgotStep === 'token' && (
                <form onSubmit={handleResetSubmit}>
                  <Stack spacing={2}>
                    <TextField
                      id="reset-token"
                      label="Reset token"
                      value={resetToken}
                      onChange={(e) => setResetToken(e.target.value)}
                      placeholder="Paste reset token"
                      type="text"
                      autoComplete="off"
                      required
                      fullWidth
                      size="small"
                      slotProps={{
                        input: {
                          startAdornment: (
                            <InputAdornment position="start">
                              <VpnKeyIcon sx={{ fontSize: 18, color: '#98a2b3' }} />
                            </InputAdornment>
                          ),
                        },
                      }}
                    />

                    <TextField
                      id="new-password"
                      label="New password"
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Min. 6 characters"
                      type={showNewPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      required
                      fullWidth
                      size="small"
                      slotProps={{
                        input: {
                          startAdornment: (
                            <InputAdornment position="start">
                              <LockIcon sx={{ fontSize: 18, color: '#98a2b3' }} />
                            </InputAdornment>
                          ),
                          endAdornment: (
                            <InputAdornment position="end">
                              <IconButton
                                onClick={() => setShowNewPassword(!showNewPassword)}
                                edge="end"
                                size="small"
                                aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                              >
                                {showNewPassword ? <VisibilityOffIcon sx={{ fontSize: 18 }} /> : <VisibilityIcon sx={{ fontSize: 18 }} />}
                              </IconButton>
                            </InputAdornment>
                          ),
                        },
                      }}
                    />

                    <TextField
                      id="confirm-password"
                      label="Confirm password"
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Re-enter new password"
                      type={showNewPassword ? 'text' : 'password'}
                      autoComplete="new-password"
                      required
                      fullWidth
                      size="small"
                      slotProps={{
                        input: {
                          startAdornment: (
                            <InputAdornment position="start">
                              <LockIcon sx={{ fontSize: 18, color: '#98a2b3' }} />
                            </InputAdornment>
                          ),
                        },
                      }}
                    />

                    {forgotError && (
                      <Alert severity="error" variant="filled" sx={{ fontSize: '11px' }}>
                        {forgotError}
                      </Alert>
                    )}

                    <Button
                      type="submit"
                      variant="contained"
                      fullWidth
                      disabled={!resetToken.trim() || !newPassword || !confirmPassword || forgotLoading}
                      sx={{
                        height: 42,
                        bgcolor: '#0052cc',
                        fontWeight: 600,
                        fontSize: '13px',
                        textTransform: 'none',
                        borderRadius: '6px',
                        '&:hover': { bgcolor: '#0747a6', boxShadow: '0 2px 8px rgba(0,82,204,0.25)' },
                        '&.Mui-disabled': { opacity: 0.45, bgcolor: '#0052cc', color: '#fff' },
                      }}
                    >
                      {forgotLoading && <CircularProgress size={16} sx={{ color: '#fff', mr: 1 }} />}
                      {forgotLoading ? 'Resetting...' : 'Reset Password'}
                    </Button>
                  </Stack>
                </form>
              )}

              {forgotStep === 'done' && (
                <Stack spacing={2}>
                  <Alert
                    severity="success"
                    icon={<CheckCircleOutlineIcon sx={{ fontSize: 20 }} />}
                    sx={{ fontSize: '11px' }}
                  >
                    {resetSuccess}
                  </Alert>
                  <Button
                    variant="contained"
                    fullWidth
                    onClick={backToLogin}
                    sx={{
                      height: 42,
                      bgcolor: '#0052cc',
                      fontWeight: 600,
                      fontSize: '13px',
                      textTransform: 'none',
                      borderRadius: '6px',
                      '&:hover': { bgcolor: '#0747a6', boxShadow: '0 2px 8px rgba(0,82,204,0.25)' },
                    }}
                  >
                    Back to Log In
                  </Button>
                </Stack>
              )}

              {forgotStep !== 'done' && (
                <Typography variant="body2" sx={{ mt: 2.5, textAlign: 'center', color: '#6b778c', fontSize: '11px' }}>
                  Remember your password?{' '}
                  <Link component="button" type="button" underline="hover" onClick={backToLogin} sx={{ fontSize: '11px', fontWeight: 600, color: '#0052cc' }}>
                    Back to Log In
                  </Link>
                </Typography>
              )}
            </>
          )}
        </Box>
      </div>
    </div>
  )
}
