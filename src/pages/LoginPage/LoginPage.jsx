import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { forgotPassword, resetPassword, fetchSsoStatus, startOidcLogin, startSamlLogin } from '../../api/authApi'
import sedinLogo from '../../assets/sedin-logo.svg'
import sedinLogoFull from '../../assets/sedin-logo-full.svg'
import './LoginPage.css'

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
  // JL-267: full list of password-policy violations (400 with { errors: [...] }).
  const [authErrors, setAuthErrors] = useState([])
  const [authLoading, setAuthLoading] = useState(false)

  // JL-265: inline email validation + Caps Lock hint.
  const [emailError, setEmailError] = useState('')
  const [capsLockOn, setCapsLockOn] = useState(false)

  // JL-266: lockout (429) live countdown. `lockoutRemaining` seconds > 0 disables submit.
  const [lockoutRemaining, setLockoutRemaining] = useState(0)
  const lockoutTimerRef = useRef(null)

  // JL-265: refs used to autofocus the first field on mount + after mode switches.
  const emailRef = useRef(null)
  const forgotEmailRef = useRef(null)

  // JL-81: MFA — when the backend replies mfaRequired, reveal a code field.
  const [mfaRequired, setMfaRequired] = useState(false)
  const [mfaCode, setMfaCode] = useState('')

  // Forgot password state
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotLoading, setForgotLoading] = useState(false)
  const [forgotError, setForgotError] = useState('')
  // JL-267: password-policy violations on the reset form.
  const [forgotErrors, setForgotErrors] = useState([])
  const [resetToken, setResetToken] = useState('')
  const [forgotStep, setForgotStep] = useState('email') // 'email' | 'token' | 'done'
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showNewPassword, setShowNewPassword] = useState(false)
  const [resetSuccess, setResetSuccess] = useState('')

  // JL-129: Live SSO — reveal buttons only when the backend reports a method configured.
  const [sso, setSso] = useState({ oidc: false, saml: false })
  const [ssoError, setSsoError] = useState('')

  useEffect(() => {
    let active = true
    if (typeof fetchSsoStatus !== 'function') return undefined
    Promise.resolve()
      .then(() => fetchSsoStatus())
      .then((status) => {
        if (active && status) setSso({ oidc: Boolean(status.oidc), saml: Boolean(status.saml) })
      })
      .catch(() => { /* SSO discovery is best-effort — keep buttons hidden on failure */ })
    return () => { active = false }
  }, [])

  async function startSso(kind) {
    setSsoError('')
    try {
      const start = kind === 'saml' ? startSamlLogin : startOidcLogin
      const { authorizeUrl } = await start()
      if (authorizeUrl) window.location.href = authorizeUrl
    } catch (error) {
      setSsoError(error?.message || 'Unable to start single sign-on')
    }
  }

  // JL-265: descriptive document title for the login screen (other pages reset it).
  useEffect(() => {
    const titles = {
      login: 'Sign in — ECM JIRA',
      signup: 'Sign up — ECM JIRA',
      forgot: 'Reset password — ECM JIRA',
    }
    document.title = titles[mode] || 'Sign in — ECM JIRA'
  }, [mode])

  // JL-265: autofocus the first field on initial render and after every mode switch.
  useEffect(() => {
    if (mode === 'login' || mode === 'signup') {
      emailRef.current?.focus()
    } else if (mode === 'forgot' && forgotStep === 'email') {
      forgotEmailRef.current?.focus()
    }
  }, [mode, forgotStep])

  // JL-266: clear any running lockout timer on unmount to avoid leaks.
  useEffect(() => () => {
    if (lockoutTimerRef.current) clearInterval(lockoutTimerRef.current)
  }, [])

  function clearLockout() {
    if (lockoutTimerRef.current) {
      clearInterval(lockoutTimerRef.current)
      lockoutTimerRef.current = null
    }
    setLockoutRemaining(0)
  }

  // JL-266: start a live m:ss countdown; submit stays disabled until it elapses.
  function startLockout(seconds) {
    clearLockout()
    setLockoutRemaining(seconds)
    lockoutTimerRef.current = setInterval(() => {
      setLockoutRemaining((s) => {
        if (s <= 1) {
          clearInterval(lockoutTimerRef.current)
          lockoutTimerRef.current = null
          return 0
        }
        return s - 1
      })
    }, 1000)
  }

  function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim())
  }

  function handleEmailBlur() {
    const value = form.email.trim()
    if (value && !isValidEmail(value)) {
      setEmailError('Enter a valid email address.')
    } else {
      setEmailError('')
    }
  }

  // JL-265: reflect Caps Lock state from any password key event.
  function handleCapsLock(e) {
    if (typeof e.getModifierState === 'function') {
      setCapsLockOn(e.getModifierState('CapsLock'))
    }
  }

  function formatCountdown(totalSeconds) {
    const m = Math.floor(totalSeconds / 60)
    const s = totalSeconds % 60
    return `${m}:${String(s).padStart(2, '0')}`
  }

  const lockoutMessage = lockoutRemaining > 0
    ? `Too many failed attempts. Try again in ${formatCountdown(lockoutRemaining)}.`
    : ''
  // JL-266/267: the auth error region shows (in priority): live lockout, policy list, or message.
  const displayAuthError = lockoutMessage || (authErrors.length ? '' : authError)

  const canSubmit = form.email.trim() && form.password.trim()

  function switchMode(newMode) {
    setMode(newMode)
    setAuthError('')
    setAuthErrors([])
    setEmailError('')
    setCapsLockOn(false)
    setMfaRequired(false)
    setMfaCode('')
    clearLockout()
  }

  // JL-264: Left/Right arrow navigation between the Log In / Sign Up tabs.
  function onTabsKeyDown(e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
    e.preventDefault()
    const next = mode === 'login' ? 'signup' : 'login'
    switchMode(next)
    // Move focus to the newly selected tab (roving tabindex).
    const id = next === 'login' ? 'login-tab-login' : 'login-tab-signup'
    requestAnimationFrame(() => document.getElementById(id)?.focus())
  }

  function openForgotPassword(e) {
    e.preventDefault()
    clearLockout()
    setForgotEmail(form.email)
    setForgotError('')
    setForgotErrors([])
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
    setAuthErrors([])
    setForgotError('')
    setForgotErrors([])
    clearLockout()
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
    setForgotErrors([])
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
      // JL-267: render every password-policy violation when the API returns a list.
      const errors = error?.data?.errors
      if (Array.isArray(errors) && errors.length > 1) {
        setForgotErrors(errors)
      } else {
        setForgotError(error?.message || 'Failed to reset password')
      }
    } finally {
      setForgotLoading(false)
    }
  }

  async function onSubmit(e) {
    e.preventDefault()
    setAuthError('')
    setAuthErrors([])
    setAuthLoading(true)
    try {
      const credentials = { email: form.email.trim(), password: form.password, remember: form.remember }
      // Include the MFA code once the field is shown.
      if (mfaRequired && mfaCode.trim()) credentials.mfaCode = mfaCode.trim()
      await handleAuth(mode, credentials)
      // Success — reset any MFA prompt / lockout state.
      setMfaRequired(false)
      setMfaCode('')
      clearLockout()
    } catch (error) {
      // Backend signals a second factor is needed via { mfaRequired: true }.
      if (error?.data?.mfaRequired) {
        setMfaRequired(true)
        setAuthError(mfaCode ? (error?.message || 'Invalid MFA code') : '')
      } else if (error?.status === 429) {
        // JL-266: account lockout — start a live countdown from retryAfter (seconds).
        const secs = Number(error?.data?.retryAfter)
        if (Number.isFinite(secs) && secs > 0) {
          setAuthError('')
          startLockout(Math.ceil(secs))
        } else {
          // retryAfter missing/unparsable — show the server message, leave submit enabled.
          setAuthError(error?.message || 'Too many failed attempts. Please try again later.')
        }
      } else if (Array.isArray(error?.data?.errors) && error.data.errors.length > 1) {
        // JL-267: render every password-policy violation from signup.
        setAuthErrors(error.data.errors)
      } else {
        setAuthError(error?.message || 'Authentication failed')
      }
    } finally {
      setAuthLoading(false)
    }
  }

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
        <div className="login-form-wrapper">
          {/* Mobile logo (hidden on desktop) */}
          <div className="login-mobile-logo">
            <img src={sedinLogo} alt="Sedin logo" />
            <span>Sedin</span>
          </div>

          {mode !== 'forgot' ? (
            <>
              <div className="login-form-header">
                <h2>{mode === 'login' ? 'Welcome back' : 'Create your account'}</h2>
                <p>{mode === 'login' ? 'Sign in to continue to your workspace.' : 'Get started with your free account today.'}</p>
              </div>

              <div className="login-tabs" role="group" aria-label="Authentication mode" onKeyDown={onTabsKeyDown}>
                <button
                  type="button"
                  id="login-tab-login"
                  aria-pressed={mode === 'login'}
                  className={`login-tab${mode === 'login' ? ' active' : ''}`}
                  onClick={() => switchMode('login')}
                >
                  Log In
                </button>
                <button
                  type="button"
                  id="login-tab-signup"
                  aria-pressed={mode === 'signup'}
                  className={`login-tab${mode === 'signup' ? ' active' : ''}`}
                  onClick={() => switchMode('signup')}
                >
                  Sign Up
                </button>
              </div>

              <form className="login-form" onSubmit={onSubmit}>
                <div className="login-field">
                  <label htmlFor="login-email">Email address</label>
                  <div className="login-input-wrap">
                    <span className="login-input-icon">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
                    </span>
                    <input
                      id="login-email"
                      ref={emailRef}
                      value={form.email}
                      onChange={(e) => {
                        setForm((c) => ({ ...c, email: e.target.value }))
                        if (emailError) setEmailError('')
                      }}
                      onBlur={handleEmailBlur}
                      placeholder="name@company.com"
                      type="email"
                      autoComplete="username email"
                      aria-invalid={emailError ? 'true' : undefined}
                      aria-describedby={emailError ? 'login-email-error' : undefined}
                    />
                  </div>
                  {emailError && (
                    <div className="login-field-error" id="login-email-error" role="alert" aria-live="assertive">
                      {emailError}
                    </div>
                  )}
                </div>

                <div className="login-field">
                  <div className="login-field-row">
                    <label htmlFor="login-password">Password</label>
                    {mode === 'login' && (
                      <button type="button" className="login-forgot-link" onClick={openForgotPassword}>Forgot password?</button>
                    )}
                  </div>
                  <div className="login-input-wrap">
                    <span className="login-input-icon">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                    </span>
                    <input
                      id="login-password"
                      value={form.password}
                      onChange={(e) => setForm((c) => ({ ...c, password: e.target.value }))}
                      onKeyDown={handleCapsLock}
                      onKeyUp={handleCapsLock}
                      placeholder={mode === 'signup' ? 'Min. 6 characters' : 'Enter your password'}
                      type={showPassword ? 'text' : 'password'}
                      autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                      aria-describedby={mode === 'signup' ? 'login-password-hint' : undefined}
                    />
                    <button
                      type="button"
                      className="login-password-toggle"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                      aria-pressed={showPassword}
                    >
                      {showPassword ? (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                      ) : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                      )}
                    </button>
                  </div>
                  {capsLockOn && (
                    <div className="login-caps-hint" role="alert" aria-live="assertive">
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 8 6-6 6 6"/><path d="M6 12v-2h12v2"/><rect x="6" y="16" width="12" height="4" rx="1"/></svg>
                      <span>Caps Lock is on</span>
                    </div>
                  )}
                  {mode === 'signup' && (
                    <small className="login-hint" id="login-password-hint">
                      Use at least 6 characters. A mix of letters, numbers, and symbols is recommended.
                    </small>
                  )}
                </div>

                {mode === 'login' && (
                  <label className="login-remember">
                    <input
                      type="checkbox"
                      checked={form.remember}
                      onChange={(e) => setForm((c) => ({ ...c, remember: e.target.checked }))}
                    />
                    <span>Keep me signed in</span>
                  </label>
                )}

                {mode === 'login' && mfaRequired && (
                  <div className="login-field">
                    <label htmlFor="login-mfa">Authentication code</label>
                    <div className="login-input-wrap">
                      <span className="login-input-icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                      </span>
                      <input
                        id="login-mfa"
                        value={mfaCode}
                        onChange={(e) => setMfaCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="6-digit code"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        autoFocus
                        aria-invalid={authError ? 'true' : undefined}
                        aria-describedby={authError ? 'login-auth-error' : undefined}
                      />
                    </div>
                    <small className="login-hint">Enter the code from your authenticator app.</small>
                  </div>
                )}

                {(displayAuthError || authErrors.length > 0) && (
                  <div className="login-error" id="login-auth-error" role="alert" aria-live="assertive">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                    {authErrors.length > 0 ? (
                      <ul className="login-error-list">
                        {authErrors.map((msg, i) => <li key={i}>{msg}</li>)}
                      </ul>
                    ) : (
                      <span>{displayAuthError}</span>
                    )}
                  </div>
                )}

                <button
                  className="login-submit-btn"
                  type="submit"
                  disabled={!canSubmit || authLoading || lockoutRemaining > 0 || (mfaRequired && mfaCode.length !== 6)}
                >
                  {authLoading ? (
                    <span className="login-spinner" />
                  ) : null}
                  {authLoading ? 'Please wait...' : mode === 'login' ? 'Log In \u2192' : 'Create Account \u2192'}
                </button>
              </form>

              {mode === 'login' && (sso.oidc || sso.saml) && (
                <div className="login-sso-options">
                  <div className="login-sso-separator"><span>or</span></div>
                  {sso.oidc && (
                    <button
                      type="button"
                      className="login-sso-action"
                      onClick={() => startSso('oidc')}
                    >
                      Sign in with SSO
                    </button>
                  )}
                  {sso.saml && (
                    <button
                      type="button"
                      className="login-sso-action"
                      onClick={() => startSso('saml')}
                    >
                      Sign in with SAML
                    </button>
                  )}
                  {ssoError && (
                    <div className="login-error" role="alert" aria-live="assertive">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                      <span>{ssoError}</span>
                    </div>
                  )}
                </div>
              )}

              <p className="login-toggle-link">
                {mode === 'login' ? (
                  <>Don't have an account? <button type="button" onClick={() => switchMode('signup')}>Sign up</button></>
                ) : (
                  <>Already have an account? <button type="button" onClick={() => switchMode('login')}>Log in</button></>
                )}
              </p>
            </>
          ) : (
            <>
              <div className="login-form-header">
                <h2>
                  {forgotStep === 'done' ? 'Password reset' : 'Reset your password'}
                </h2>
                <p>
                  {forgotStep === 'email' && 'Enter your email address and we\'ll send you a reset token.'}
                  {forgotStep === 'token' && 'Enter the reset token and choose a new password.'}
                  {forgotStep === 'done' && 'Your password has been updated successfully.'}
                </p>
              </div>

              {forgotStep === 'email' && (
                <form className="login-form" onSubmit={handleForgotSubmit}>
                  <div className="login-field">
                    <label htmlFor="forgot-email">Email address</label>
                    <div className="login-input-wrap">
                      <span className="login-input-icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
                      </span>
                      <input
                        id="forgot-email"
                        ref={forgotEmailRef}
                        value={forgotEmail}
                        onChange={(e) => setForgotEmail(e.target.value)}
                        placeholder="name@company.com"
                        type="email"
                        autoComplete="email"
                        required
                      />
                    </div>
                  </div>

                  {forgotError && (
                    <div className="login-error" role="alert" aria-live="assertive">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                      <span>{forgotError}</span>
                    </div>
                  )}

                  <button
                    className="login-submit-btn"
                    type="submit"
                    disabled={!forgotEmail.trim() || forgotLoading}
                  >
                    {forgotLoading ? <span className="login-spinner" /> : null}
                    {forgotLoading ? 'Sending...' : 'Send Reset Token'}
                  </button>
                </form>
              )}

              {forgotStep === 'token' && (
                <form className="login-form" onSubmit={handleResetSubmit}>
                  <div className="login-field">
                    <label htmlFor="reset-token">Reset token</label>
                    <div className="login-input-wrap">
                      <span className="login-input-icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"/></svg>
                      </span>
                      <input
                        id="reset-token"
                        value={resetToken}
                        onChange={(e) => setResetToken(e.target.value)}
                        placeholder="Paste reset token"
                        type="text"
                        autoComplete="off"
                        required
                      />
                    </div>
                  </div>

                  <div className="login-field">
                    <label htmlFor="new-password">New password</label>
                    <div className="login-input-wrap">
                      <span className="login-input-icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                      </span>
                      <input
                        id="new-password"
                        value={newPassword}
                        onChange={(e) => setNewPassword(e.target.value)}
                        onKeyDown={handleCapsLock}
                        onKeyUp={handleCapsLock}
                        placeholder="Min. 6 characters"
                        type={showNewPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        required
                      />
                      <button
                        type="button"
                        className="login-password-toggle"
                        onClick={() => setShowNewPassword(!showNewPassword)}
                        aria-label={showNewPassword ? 'Hide password' : 'Show password'}
                      >
                        {showNewPassword ? (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                        ) : (
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                        )}
                      </button>
                    </div>
                    {capsLockOn && (
                      <div className="login-caps-hint" role="alert" aria-live="assertive">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 8 6-6 6 6"/><path d="M6 12v-2h12v2"/><rect x="6" y="16" width="12" height="4" rx="1"/></svg>
                        <span>Caps Lock is on</span>
                      </div>
                    )}
                  </div>

                  <div className="login-field">
                    <label htmlFor="confirm-password">Confirm password</label>
                    <div className="login-input-wrap">
                      <span className="login-input-icon">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
                      </span>
                      <input
                        id="confirm-password"
                        value={confirmPassword}
                        onChange={(e) => setConfirmPassword(e.target.value)}
                        onKeyDown={handleCapsLock}
                        onKeyUp={handleCapsLock}
                        placeholder="Re-enter new password"
                        type={showNewPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        required
                        aria-invalid={forgotError ? 'true' : undefined}
                        aria-describedby={forgotError ? 'reset-error' : undefined}
                      />
                    </div>
                  </div>

                  {(forgotError || forgotErrors.length > 0) && (
                    <div className="login-error" id="reset-error" role="alert" aria-live="assertive">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                      {forgotErrors.length > 0 ? (
                        <ul className="login-error-list">
                          {forgotErrors.map((msg, i) => <li key={i}>{msg}</li>)}
                        </ul>
                      ) : (
                        <span>{forgotError}</span>
                      )}
                    </div>
                  )}

                  <button
                    className="login-submit-btn"
                    type="submit"
                    disabled={!resetToken.trim() || !newPassword || !confirmPassword || forgotLoading}
                  >
                    {forgotLoading ? <span className="login-spinner" /> : null}
                    {forgotLoading ? 'Resetting...' : 'Reset Password'}
                  </button>
                </form>
              )}

              {forgotStep === 'done' && (
                <div className="login-form">
                  <div className="login-success" role="alert" aria-live="assertive">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
                    <span>{resetSuccess}</span>
                  </div>
                  <button
                    className="login-submit-btn"
                    type="button"
                    onClick={backToLogin}
                  >
                    Back to Log In
                  </button>
                </div>
              )}

              {forgotStep !== 'done' && (
                <p className="login-toggle-link">
                  Remember your password? <button type="button" onClick={backToLogin}>Back to Log In</button>
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
