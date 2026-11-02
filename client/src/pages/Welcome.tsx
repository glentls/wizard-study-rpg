import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Alert } from '../components/ui';

export function Welcome() {
  const [mode, setMode] = useState<'register' | 'login'>('register');
  return (
    <div className="welcome">
      <section className="hero" aria-labelledby="hero-title">
        <p className="eyebrow">Study-powered fantasy RPG</p>
        <h1 id="hero-title">Your focus is the magic.</h1>
        <p className="lead">
          Every focused minute you study becomes research points. Spend them to unlock spells, grow your mana and take on
          turn-based adventures when you are done. No playing during study time.
        </p>
        <ul className="feature-list">
          <li>
            <strong>Focus timer</strong> with gentle breaks: sessions cap at 90 minutes, then a 20-minute rest.
          </li>
          <li>
            <strong>Research tree</strong> across Fire, Lightning and Light.
          </li>
          <li>
            <strong>Turn-based battles</strong> that test your spell loadout, not your wallet.
          </li>
        </ul>
      </section>

      <section className="card auth-card" aria-labelledby="auth-title">
        <div className="tabs" role="tablist" aria-label="Account">
          <button role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'tab active' : 'tab'} onClick={() => setMode('register')}>
            Create account
          </button>
          <button role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'tab active' : 'tab'} onClick={() => setMode('login')}>
            Sign in
          </button>
        </div>
        <h2 id="auth-title" className="visually-hidden">
          {mode === 'register' ? 'Create account' : 'Sign in'}
        </h2>
        {mode === 'register' ? <RegisterForm /> : <LoginForm />}
      </section>
    </div>
  );
}

function LoginForm() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="stack">
      {error && <Alert kind="error">{error}</Alert>}
      <label className="field">
        <span>Email</span>
        <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="field">
        <span>Password</span>
        <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
      <button className="btn btn-primary" disabled={busy}>
        {busy ? 'Signing in…' : 'Sign in'}
      </button>
      <Link to="/auth/reset" className="small-link">
        Forgot your password?
      </Link>
    </form>
  );
}

function RegisterForm() {
  const { register } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [analytics, setAnalytics] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await register({ email, password, timezone, accept_terms: acceptTerms, analytics_opt_in: analytics });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="stack">
      {error && <Alert kind="error">{error}</Alert>}
      <label className="field">
        <span>Email</span>
        <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="field">
        <span>Password</span>
        <input
          type="password"
          autoComplete="new-password"
          minLength={10}
          required
          aria-describedby="pw-hint"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <small id="pw-hint" className="muted">
          At least 10 characters. A short phrase works well.
        </small>
      </label>
      <p className="muted small">Study days follow your timezone: {timezone}.</p>
      <label className="check">
        <input type="checkbox" required checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)} />
        <span>I accept the terms and privacy notice.</span>
      </label>
      <label className="check">
        <input type="checkbox" checked={analytics} onChange={(e) => setAnalytics(e.target.checked)} />
        <span>Share anonymous usage analytics to help improve the app (optional; never includes what you study).</span>
      </label>
      <button className="btn btn-primary" disabled={busy}>
        {busy ? 'Creating…' : 'Create account'}
      </button>
    </form>
  );
}
