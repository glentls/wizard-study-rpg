import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ApiError, api, errorMessage, newIdempotencyKey } from '../api/client';
import type { CurrentFocus, FocusSession, Preferences, ResearchTree } from '../api/types';
import { useAuth, useMe } from '../auth/AuthContext';
import { Alert, Loading, PageHeader } from '../components/ui';
import { isAmbientPlaying, startAmbient, stopAmbient } from '../lib/ambient';
import { clock, humanMinutes, minutes } from '../lib/format';
import { notify } from '../lib/notify';
import { useLoad } from '../lib/useLoad';

function deviceId(): string {
  try {
    let id = localStorage.getItem('wsr_device');
    if (!id) {
      id = crypto.randomUUID().slice(0, 12);
      localStorage.setItem('wsr_device', id);
    }
    return id;
  } catch {
    return 'unknown';
  }
}

export function Focus() {
  const { reload: reloadMe } = useAuth();
  const me = useMe();
  const current = useLoad(() => api.get<CurrentFocus>('/v1/focus-sessions/current'));
  const tree = useLoad(() => api.get<ResearchTree>('/v1/research/tree'));

  const { reload: reloadCurrent } = current;
  const { reload: reloadTree } = tree;
  const refresh = useCallback(async () => {
    await Promise.all([reloadCurrent(), reloadMe(), reloadTree()]);
  }, [reloadCurrent, reloadMe, reloadTree]);

  if (!current.data) return current.error ? <Alert kind="error">{current.error}</Alert> : <Loading />;
  const { active, last } = current.data;

  return (
    <div className={active ? 'focus-page focus-quiet' : 'focus-page'}>
      {active ? (
        <ActiveSession key={active.id} session={active} prefs={me.preferences} onEnded={refresh} />
      ) : current.data.break.break_required ? (
        <BreakPanel status={current.data} prefs={me.preferences} onDone={refresh} />
      ) : (
        <StartPanel status={current.data} tree={tree.data} onStarted={refresh} />
      )}
      {!active && last && <SessionResult session={last} />}
    </div>
  );
}

function ActiveSession({ session, prefs, onEnded }: { session: FocusSession; prefs: Preferences; onEnded: () => Promise<void> }) {
  const [view, setView] = useState(session);
  const offset = useRef(Date.parse(session.server_time) - Date.now());
  const [now, setNow] = useState(Date.now());
  const [connection, setConnection] = useState<'ok' | 'reconnecting'>('ok');
  const [confirming, setConfirming] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('Focus session started.');
  const [sound, setSound] = useState(isAmbientPlaying());
  const sequence = useRef(Math.floor(Date.now() / 1000));
  // One key per "finish" intent, reused on retries so a flaky network can never double-claim.
  const finishKey = useRef(newIdempotencyKey());
  const ended = useRef(false);

  const started = Date.parse(view.started_at);
  const cap = Date.parse(view.cap_at);
  const serverNow = now + offset.current;
  const elapsed = Math.max(0, Math.min(serverNow, cap) - started) / 1000;
  const remaining = Math.max(0, cap - serverNow) / 1000;
  const total = (cap - started) / 1000;

  const end = useCallback(async () => {
    if (ended.current) return;
    ended.current = true;
    await onEnded();
  }, [onEnded]);

  const beat = useCallback(async () => {
    try {
      const res = await api.post<FocusSession>(`/v1/focus-sessions/${session.id}/heartbeat`, { sequence: sequence.current++, device_id: deviceId() });
      offset.current = Date.parse(res.server_time) - Date.now();
      setView(res);
      setConnection('ok');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'SESSION_NOT_ACTIVE') void end();
      else setConnection('reconnecting');
    }
  }, [session.id, end]);

  useEffect(() => {
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const heartbeat = setInterval(beat, view.heartbeat_interval_seconds * 1000);
    const onVisible = () => document.visibilityState === 'visible' && void beat();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(tick);
      clearInterval(heartbeat);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [beat, view.heartbeat_interval_seconds]);

  // The server closes the session at the cap; we just notice and refresh.
  const capReached = remaining <= 0;
  useEffect(() => {
    if (!capReached) return;
    notify(prefs, 'breakReminders', 'Time for a break', 'You reached your focus limit. Take at least 20 minutes to rest.');
    const t = setTimeout(() => void end(), 1500);
    return () => clearTimeout(t);
  }, [capReached, prefs, end]);

  const elapsedMinutes = Math.floor(elapsed / 60);
  useEffect(() => {
    if (elapsedMinutes > 0 && elapsedMinutes % 5 === 0) setAnnouncement(`${elapsedMinutes} minutes focused.`);
  }, [elapsedMinutes]);

  useEffect(() => () => stopAmbient(), []);

  const finish = async () => {
    setFinishing(true);
    setError(null);
    try {
      await api.post(`/v1/focus-sessions/${session.id}/finish`, {}, { idempotencyKey: finishKey.current });
      notify(prefs, 'sessionComplete', 'Session complete', 'Your research points are ready.');
      await end();
    } catch (err) {
      setError(errorMessage(err));
      setFinishing(false);
    }
  };

  const toggleSound = () => {
    if (sound) stopAmbient();
    else startAmbient();
    setSound(!sound);
  };

  const pct = total > 0 ? elapsed / total : 0;
  const R = 110;
  const C = 2 * Math.PI * R;
  const nextBand = view.estimate && view.estimate.multiplier < 1.2 ? (view.estimate.multiplier < 1.1 ? 30 : 60) : null;

  return (
    <section className="focus-active" aria-labelledby="focus-title">
      <h1 id="focus-title" className="visually-hidden">
        Focus session in progress
      </h1>
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
      {connection === 'reconnecting' && (
        <Alert kind="warning">Reconnecting… your session is safe for up to {minutes(view.heartbeat_grace_seconds)} minutes offline.</Alert>
      )}
      <div className="timer-ring" aria-hidden="true">
        <svg viewBox="0 0 260 260">
          <circle cx="130" cy="130" r={R} className="ring-bg" />
          <circle cx="130" cy="130" r={R} className="ring-fg" strokeDasharray={C} strokeDashoffset={C * (1 - pct)} />
        </svg>
        <div className="timer-center">
          <span className="timer-value">{clock(elapsed)}</span>
          <span className="muted">{clock(remaining)} until break</span>
        </div>
      </div>
      <p className="timer-text visually-hidden">
        {elapsedMinutes} minutes focused, {Math.ceil(remaining / 60)} minutes until your break.
      </p>
      {view.objective && <p className="objective">“{view.objective}”</p>}
      {view.research_target && (
        <p className="muted">
          Milestone attempt: <strong>{view.research_target.name}</strong>. Stay connected to count it.
        </p>
      )}
      <p className="estimate">
        ≈ <strong>{view.estimate?.awarded_points ?? 0} RP</strong> so far
        {nextBand !== null && <span className="muted"> · bonus multiplier at {nextBand} min</span>}
      </p>
      {error && <Alert kind="error">{error}</Alert>}
      <div className="focus-actions">
        {!confirming ? (
          <button className="btn" onClick={() => setConfirming(true)} disabled={finishing}>
            End session
          </button>
        ) : (
          <div className="confirm-row" role="group" aria-label="Confirm ending session">
            <span>End now and claim {view.estimate?.awarded_points ?? 0} RP?</span>
            <button className="btn btn-primary" onClick={finish} disabled={finishing} autoFocus>
              {finishing ? 'Claiming…' : 'Yes, end session'}
            </button>
            <button className="btn btn-ghost" onClick={() => setConfirming(false)} disabled={finishing}>
              Keep focusing
            </button>
          </div>
        )}
        <button className="btn btn-ghost" aria-pressed={sound} onClick={toggleSound}>
          {sound ? '🔊 Ambient on' : '🔈 Ambient off'}
        </button>
      </div>
      <p className="muted small">Pausing ends the session; you keep every minute you have earned.</p>
    </section>
  );
}

function BreakPanel({ status, prefs, onDone }: { status: CurrentFocus; prefs: Preferences; onDone: () => Promise<void> }) {
  const offset = useRef(Date.parse(status.server_time) - Date.now());
  const [now, setNow] = useState(Date.now());
  const until = Date.parse(status.break.break_until!);
  const remaining = Math.max(0, until - (now + offset.current)) / 1000;

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (remaining > 0) return;
    notify(prefs, 'breakReminders', 'Break complete', 'Ready for another focus session whenever you are.');
    void onDone();
  }, [remaining, prefs, onDone]);

  return (
    <section className="card break-panel" aria-labelledby="break-title">
      <h1 id="break-title">Break time</h1>
      <p className="lead">You focused for {status.rules.max_continuous_minutes} minutes. Rest is part of the practice.</p>
      <p className="break-timer" role="timer" aria-live="off">
        {clock(remaining)}
      </p>
      <ul className="break-ideas">
        <li>Stand up and stretch</li>
        <li>Drink some water</li>
        <li>Look at something far away</li>
      </ul>
      <p className="muted">
        While you rest you can spend points in <Link to="/research">Research</Link> or test your spells in{' '}
        <Link to="/adventure">Adventure</Link>.
      </p>
    </section>
  );
}

function StartPanel({ status, tree, onStarted }: { status: CurrentFocus; tree: ResearchTree | null; onStarted: () => Promise<void> }) {
  const [params] = useSearchParams();
  const guided = params.get('guided') === '1';
  const [objective, setObjective] = useState('');
  const [target, setTarget] = useState(params.get('target') ?? '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const milestoneSpells = (tree?.elements ?? [])
    .flatMap((e) => e.spells)
    .filter((s) => s.milestone && !s.milestone.satisfied && s.state !== 'LOCKED' && s.state !== 'MAXED');
  const starter = tree?.elements.find((e) => e.is_starter)?.spells.find((s) => s.tier === 1);
  const available = minutes(status.break.focus_available_seconds);
  const carried = minutes(status.break.chain_seconds);

  const start = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/v1/focus-sessions', { objective: objective.trim() || null, research_target_spell_id: target || null });
      await onStarted();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="start-title">
      <PageHeader title="Focus" subtitle="Study away from the game. Your wizard grows while you work." />
      {guided && starter && (
        <Alert kind="info">
          <strong>Your first session.</strong> Focus for 25 minutes to earn about {starter.next_cost} research points, which is enough to unlock{' '}
          {starter.name}. Then try it in a tutorial battle. You can stop at any time and keep what you earned.
        </Alert>
      )}
      <form className="card stack" onSubmit={start}>
        <h2 id="start-title">Start a focus session</h2>
        {error && <Alert kind="error">{error}</Alert>}
        <label className="field">
          <span>What will you work on? (optional, only you can see this)</span>
          <input value={objective} maxLength={140} placeholder="e.g. Chapter 6 practice questions" onChange={(e) => setObjective(e.target.value)} />
        </label>
        {milestoneSpells.length > 0 && (
          <label className="field">
            <span>Attempt a research milestone (optional)</span>
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">No milestone this time</option>
              {milestoneSpells.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} (level {s.next_level}): {s.milestone!.minutes} uninterrupted minutes
                </option>
              ))}
            </select>
          </label>
        )}
        {carried > 0 && (
          <p className="muted">
            You focused {carried} minutes recently without a full break, so this session can run up to {available} minutes before a{' '}
            {status.rules.required_break_minutes}-minute break.
          </p>
        )}
        <button className="btn btn-primary btn-large" disabled={busy}>
          {busy ? 'Starting…' : 'Start focusing'}
        </button>
      </form>

      <div className="grid-2">
        <div className="card">
          <h2 className="h3">How rewards work</h2>
          <ul className="plain">
            <li>1 research point per focused minute.</li>
            {status.rules.multiplier_bands
              .filter((b) => b.multiplier > 1)
              .map((b) => (
                <li key={b.min_minutes}>
                  ×{b.multiplier.toFixed(2)} for sessions of {b.min_minutes}+ minutes
                </li>
              ))}
            <li>
              Sessions end at {status.rules.max_continuous_minutes} minutes, then a {status.rules.required_break_minutes}-minute break.
            </li>
            <li>Up to {humanMinutes(status.rules.daily_cap_minutes)} a day earn points; anything beyond is still logged.</li>
          </ul>
        </div>
        <div className="card">
          <h2 className="h3">Today</h2>
          <p>
            <strong>{status.today.focus_minutes}</strong> minutes focused in {status.today.sessions} session{status.today.sessions === 1 ? '' : 's'}.
          </p>
          <p className="muted">{status.today.daily_cap_remaining_minutes} rewarded minutes left today.</p>
        </div>
      </div>
    </section>
  );
}

const END_REASON: Record<string, string> = {
  finished: 'You ended the session.',
  cap_reached: 'You reached the focus limit. Great stamina!',
  disconnected: 'The connection was lost. You kept everything earned up to your last check-in.',
  invalidated: 'This session was reviewed and invalidated.',
};

function SessionResult({ session }: { session: FocusSession }) {
  const award = session.award;
  if (!award) return null;
  const m = award.milestone;
  return (
    <section className="card result-card" aria-labelledby="result-title">
      <h2 id="result-title" className="h3">
        Last session: +{award.awarded_points} RP
      </h2>
      <p className="muted">{END_REASON[session.end_reason ?? ''] ?? ''}</p>
      <dl className="breakdown">
        <div>
          <dt>Focused</dt>
          <dd>{award.validated_minutes} min</dd>
        </div>
        {award.daily_cap_deduction_minutes > 0 && (
          <div>
            <dt>Over daily cap</dt>
            <dd>−{award.daily_cap_deduction_minutes} min</dd>
          </div>
        )}
        <div>
          <dt>Rewarded minutes</dt>
          <dd>{award.credited_minutes}</dd>
        </div>
        <div>
          <dt>Session multiplier</dt>
          <dd>×{award.multiplier.toFixed(2)}</dd>
        </div>
        <div>
          <dt>Research points</dt>
          <dd>
            <strong>{award.awarded_points}</strong>
          </dd>
        </div>
      </dl>
      {m && (
        <Alert kind={m.applied ? 'success' : 'info'}>
          {m.applied
            ? m.leveled_up_to
              ? `Milestone complete: your spell reached level ${m.leveled_up_to}!`
              : 'Milestone complete! Finish funding the research to unlock the spell.'
            : `Milestone not completed: ${m.message} Your focus points were kept.`}
        </Alert>
      )}
      <p className="small muted">Calculated under ruleset {award.ruleset_id}.</p>
    </section>
  );
}
