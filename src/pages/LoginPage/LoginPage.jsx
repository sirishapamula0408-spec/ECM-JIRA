import { useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { forgotPassword, resetPassword } from '../../api/authApi'
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

              <div className="login-tabs">
                <button
                  type="button"
                  className={`login-tab${mode === 'login' ? ' active' : ''}`}
                  onClick={() => switchMode('login')}
                >
                  Log In
                </button>
                <button
                  type="button"
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
                      value={form.email}
                      onChange={(e) => setForm((c) => ({ ...c, email: e.target.value }))}
                      placeholder="name@company.com"
                      type="email"
                      autoComplete="email"
                    />
                  </div>
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
                      placeholder={mode === 'signup' ? 'Min. 6 characters' : 'Enter your password'}
                      type={showPassword ? 'text' : 'password'}
                      autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                    />
                    <button
                      type="button"
                      className="login-password-toggle"
                      onClick={() => setShowPassword(!showPassword)}
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/><path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/><line x1="1" y1="1" x2="23" y2="23"/></svg>
                      ) : (
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                      )}
                    </button>
                  </div>
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

                {authError && (
                  <div className="login-error">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                    <span>{authError}</span>
                  </div>
                )}

                <button
                  className="login-submit-btn"
                  type="submit"
                  disabled={!canSubmit || authLoading}
                >
                  {authLoading ? (
                    <span className="login-spinner" />
                  ) : null}
                  {authLoading ? 'Please wait...' : mode === 'login' ? 'Log In \u2192' : 'Create Account \u2192'}
                </button>
              </form>

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
                    <div className="login-error">
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
                        placeholder="Re-enter new password"
                        type={showNewPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        required
                      />
                    </div>
                  </div>

                  {forgotError && (
                    <div className="login-error">
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
                      <span>{forgotError}</span>
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
                  <div className="login-success">
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
