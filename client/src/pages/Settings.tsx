import { useState, type FormEvent } from 'react';
import { api, errorMessage } from '../api/client';
import type { Preferences } from '../api/types';
import { useAuth, useMe } from '../auth/AuthContext';
import { Alert, PageHeader } from '../components/ui';
import { notificationsSupported, requestNotificationPermission } from '../lib/notify';

const TIMEZONES: string[] = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf('timeZone');
  } catch {
    return ['UTC'];
  }
})();

export function Settings() {
  const me = useMe();
  const { reload, logout } = useAuth();
  const [prefs, setPrefs] = useState<Preferences>(me.preferences);
  const [notice, setNotice] = useState<{ kind: 'success' | 'error' | 'info'; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [permission, setPermission] = useState(notificationsSupported() ? Notification.permission : 'unsupported');

  const update = <K extends keyof Preferences>(key: K, value: Preferences[K]) => setPrefs((p) => ({ ...p, [key]: value }));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api.patch('/v1/me/preferences', prefs);
      await reload();
      setNotice({ kind: 'success', text: 'Settings saved.' });
    } catch (err) {
      setNotice({ kind: 'error', text: errorMessage(err) });
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    try {
      await api.post('/v1/auth/verify-email/resend');
      setNotice({ kind: 'info', text: 'Verification link sent. (In development it is printed in the server log.)' });
    } catch (err) {
      setNotice({ kind: 'error', text: errorMessage(err) });
    }
  };

  return (
    <div className="stack-lg">
      <PageHeader title="Settings" subtitle="Privacy, notifications, accessibility and your account." />
      {notice && <Alert kind={notice.kind}>{notice.text}</Alert>}

      <form className="stack-lg" onSubmit={save}>
        <fieldset className="card stack">
          <legend className="h3">Study</legend>
          <label className="field">
            <span>Timezone (decides when your study day starts)</span>
            <select value={prefs.timezone} onChange={(e) => update('timezone', e.target.value)}>
              {TIMEZONES.map((tz) => (
                <option key={tz}>{tz}</option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Learning goal (private)</span>
            <input value={prefs.learningGoal ?? ''} maxLength={120} onChange={(e) => update('learningGoal', e.target.value || null)} />
          </label>
          <label className="field">
            <span>Optional daily goal in minutes (no penalty for missing it)</span>
            <input
              type="number"
              min={10}
              max={240}
              value={prefs.dailyGoalMinutes ?? ''}
              onChange={(e) => update('dailyGoalMinutes', e.target.value ? Number(e.target.value) : null)}
            />
          </label>
        </fieldset>

        <fieldset className="card stack">
          <legend className="h3">Notifications</legend>
          <label className="check">
            <input
              type="checkbox"
              checked={prefs.notifications.breakReminders}
              onChange={(e) => update('notifications', { ...prefs.notifications, breakReminders: e.target.checked })}
            />
            <span>Break reminders</span>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={prefs.notifications.sessionComplete}
              onChange={(e) => update('notifications', { ...prefs.notifications, sessionComplete: e.target.checked })}
            />
            <span>Session complete</span>
          </label>
          <div className="grid-2">
            <label className="field">
              <span>Quiet hours from</span>
              <input
                type="time"
                value={prefs.notifications.quietHoursStart ?? ''}
                onChange={(e) => update('notifications', { ...prefs.notifications, quietHoursStart: e.target.value || null })}
              />
            </label>
            <label className="field">
              <span>Quiet hours until</span>
              <input
                type="time"
                value={prefs.notifications.quietHoursEnd ?? ''}
                onChange={(e) => update('notifications', { ...prefs.notifications, quietHoursEnd: e.target.value || null })}
              />
            </label>
          </div>
          {permission === 'unsupported' ? (
            <p className="muted small">This browser does not support notifications.</p>
          ) : permission !== 'granted' ? (
            <button type="button" className="btn btn-ghost" onClick={async () => setPermission(await requestNotificationPermission())}>
              Allow browser notifications
            </button>
          ) : (
            <p className="muted small">Browser notifications are allowed.</p>
          )}
        </fieldset>

        <fieldset className="card stack">
          <legend className="h3">Privacy</legend>
          <label className="field">
            <span>Who can see my study statistics (for future social features)</span>
            <select
              value={prefs.privacy.statsVisibility}
              onChange={(e) => update('privacy', { ...prefs.privacy, statsVisibility: e.target.value as Preferences['privacy']['statsVisibility'] })}
            >
              <option value="private">Only me</option>
              <option value="friends">Friends</option>
            </select>
          </label>
          <label className="check">
            <input type="checkbox" checked={prefs.privacy.analyticsOptIn} onChange={(e) => update('privacy', { ...prefs.privacy, analyticsOptIn: e.target.checked })} />
            <span>Share anonymous usage analytics (never includes what you study)</span>
          </label>
        </fieldset>

        <fieldset className="card stack">
          <legend className="h3">Accessibility</legend>
          {(
            [
              ['reducedMotion', 'Reduce motion'],
              ['highContrast', 'High contrast'],
              ['largeText', 'Larger text'],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="check">
              <input
                type="checkbox"
                checked={prefs.accessibility[key]}
                onChange={(e) => update('accessibility', { ...prefs.accessibility, [key]: e.target.checked })}
              />
              <span>{label}</span>
            </label>
          ))}
        </fieldset>

        <div>
          <button className="btn btn-primary" disabled={busy}>
            Save settings
          </button>
        </div>
      </form>

      <section className="card stack" aria-labelledby="account-title">
        <h2 id="account-title" className="h3">
          Account
        </h2>
        <p>
          {me.account.email} {me.account.email_verified ? <span className="pill">Verified</span> : <span className="pill">Not verified</span>}
        </p>
        {!me.account.email_verified && (
          <button className="btn btn-ghost" onClick={resend}>
            Resend verification email
          </button>
        )}
        <div className="row">
          <button className="btn" onClick={() => logout(false)}>
            Sign out
          </button>
          <button className="btn" onClick={() => logout(true)}>
            Sign out on all devices
          </button>
        </div>
      </section>

      <DeleteAccount />
    </div>
  );
}

function DeleteAccount() {
  const { signedOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await api.delete('/v1/me', { password });
      signedOut();
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  return (
    <section className="card danger stack" aria-labelledby="delete-title">
      <h2 id="delete-title" className="h3">
        Delete account
      </h2>
      <p className="muted">
        Erases your email, password, preferences and study objectives. Anonymous reward records are kept for audit. This cannot be undone.
      </p>
      {!open ? (
        <div>
          <button className="btn btn-danger" onClick={() => setOpen(true)}>
            Delete my account…
          </button>
        </div>
      ) : (
        <form onSubmit={submit} className="stack">
          {error && <Alert kind="error">{error}</Alert>}
          <label className="field">
            <span>Confirm with your password</span>
            <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
          </label>
          <div className="row">
            <button className="btn btn-danger">Permanently delete</button>
            <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}
    </section>
  );
}
