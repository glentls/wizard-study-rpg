import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, errorMessage } from '../api/client';
import { Alert, Loading } from '../components/ui';

/** /auth/reset: request a link, or (with ?token=) choose a new password. */
export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (token) {
        await api.post('/v1/auth/password-reset/confirm', { token, password });
        setMessage({ kind: 'success', text: 'Password updated. You have been signed out everywhere; sign in with your new password.' });
      } else {
        const res = await api.post<{ message: string }>('/v1/auth/password-reset/request', { email });
        setMessage({ kind: 'success', text: res.message });
      }
    } catch (err) {
      setMessage({ kind: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="narrow">
      <div className="card">
        <h1>{token ? 'Choose a new password' : 'Reset your password'}</h1>
        <form onSubmit={submit} className="stack">
          {message && <Alert kind={message.kind}>{message.text}</Alert>}
          {token ? (
            <label className="field">
              <span>New password</span>
              <input type="password" autoComplete="new-password" minLength={10} required value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
          ) : (
            <label className="field">
              <span>Email</span>
              <input type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </label>
          )}
          <button className="btn btn-primary" disabled={busy}>
            {token ? 'Update password' : 'Send reset link'}
          </button>
          <Link to="/" className="small-link">
            Back to sign in
          </Link>
        </form>
      </div>
    </div>
  );
}

/** /auth/verify?token=... */
export function VerifyEmail() {
  const [params] = useSearchParams();
  const [state, setState] = useState<'working' | 'done' | 'failed'>('working');
  const [error, setError] = useState('');

  useEffect(() => {
    const token = params.get('token');
    if (!token) {
      setState('failed');
      setError('This link is missing its token.');
      return;
    }
    api
      .post('/v1/auth/verify-email', { token })
      .then(() => setState('done'))
      .catch((err) => {
        setState('failed');
        setError(errorMessage(err));
      });
  }, [params]);

  return (
    <div className="narrow">
      <div className="card">
        <h1>Email verification</h1>
        {state === 'working' && <Loading label="Verifying" />}
        {state === 'done' && <Alert kind="success">Your email is verified. Thank you!</Alert>}
        {state === 'failed' && <Alert kind="error">{error}</Alert>}
        <Link to="/" className="small-link">
          Continue
        </Link>
      </div>
    </div>
  );
}
