import { useRef, useState } from 'react';
import { NamePrompt } from '../components/NamePrompt';
import { BackButton, Bar, Modal } from '../components/ui';
import { POTIONS } from '../game/content';
import { duration, hours } from '../game/format';
import { levelFromXp } from '../game/progression';
import { computeStats, createInitialState } from '../game/state';
import { exportSave, readSaveFile } from '../game/storage';
import { useGame } from '../game/store';
import type { Nav } from './nav';

/** Profile: nickname, a small stats dashboard (study hours, streak, collection) and settings. */
export function ProfileScene({ nav }: { nav: Nav }) {
  const { state, dispatch, toast } = useGame();
  const [renaming, setRenaming] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const lvl = levelFromXp(state.xpTotal);
  const stats = computeStats(state, Date.now());
  const maxDay = Math.max(30, ...stats.last7Days.map((d) => d.minutes));
  const recent = [...state.sessions].reverse().slice(0, 5);

  const toggleNotifications = async (on: boolean) => {
    if (on && typeof Notification !== 'undefined' && Notification.permission === 'default') {
      const res = await Notification.requestPermission().catch(() => 'denied' as const);
      if (res !== 'granted') {
        toast('Notifications are blocked in this browser.');
        return;
      }
    }
    if (on && typeof Notification !== 'undefined' && Notification.permission === 'denied') {
      toast('Notifications are blocked in this browser.');
      return;
    }
    dispatch({ type: 'updateSettings', settings: { notifications: on } });
  };

  const importSave = async (file: File | undefined) => {
    if (!file) return;
    const next = await readSaveFile(file, Date.now());
    if (!next) {
      toast("That file isn't a Wizard Study save.");
      return;
    }
    dispatch({ type: 'replace', state: next });
    toast('Save loaded.');
  };

  return (
    <div className="page">
      <div className="page__inner">
        <BackButton onClick={nav.back} />

        <section className="card profile-head">
          <div className="profile-head__avatar" aria-hidden="true">
            🧙
          </div>
          <div className="profile-head__info">
            <h1 className="profile-head__name">{state.name}</h1>
            <p className="muted">
              Level {lvl.level} wizard · {state.xpTotal} XP earned in total
            </p>
            <Bar value={lvl.into} max={lvl.needed} className="bar--xp" label={`Level ${lvl.level} progress`} />
            <p className="small muted">
              {lvl.needed - lvl.into} XP to level {lvl.level + 1}
            </p>
          </div>
          <button type="button" className="btn btn--secondary" onClick={() => setRenaming(true)}>
            Change name
          </button>
        </section>

        <section className="stats-grid" aria-label="Your stats">
          <Stat label="Time studied" value={stats.totalMinutes < 60 ? duration(stats.totalMinutes) : hours(stats.totalMinutes)} icon="⏳" />
          <Stat label="Sessions completed" value={String(stats.sessionsCompleted)} icon="✅" />
          <Stat label="Day streak" value={String(stats.streakDays)} icon="🔥" />
          <Stat label="Longest session" value={stats.longestSession ? duration(stats.longestSession) : '—'} icon="🏆" />
          <Stat label="Spells learned" value={String(stats.spellsLearned)} icon="📜" />
          <Stat label="Gold" value={String(state.gold)} icon="🪙" />
        </section>

        <section className="card">
          <h2 className="card__title">Last 7 days</h2>
          <div className="week-chart" role="img" aria-label={`Minutes studied per day: ${stats.last7Days.map((d) => `${d.label} ${d.minutes}`).join(', ')}`}>
            {stats.last7Days.map((d) => (
              <div key={d.key} className="week-chart__col">
                <span className="week-chart__val">{d.minutes > 0 ? duration(d.minutes) : ''}</span>
                <div className="week-chart__bar" style={{ height: `${(d.minutes / maxDay) * 100}%` }} />
                <span className="week-chart__label">{d.label}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="card">
          <h2 className="card__title">Potion collection</h2>
          <ul className="potions">
            {POTIONS.map((p) => {
              const n = state.potions[p.id] ?? 0;
              return (
                <li key={p.id} className={`potion${n ? '' : ' potion--empty'}`}>
                  <svg viewBox="-50 -80 100 140" className="potion__svg" aria-hidden="true">
                    <path d="M-14 -60 H14 V-30 Q42 -14 42 16 Q42 52 0 52 Q-42 52 -42 16 Q-42 -14 -14 -30 Z" fill={n ? p.color : '#3a2f5a'} stroke="#fff" strokeOpacity={0.6} strokeWidth={4} />
                    <rect x={-18} y={-72} width={36} height={14} rx={4} fill="#a16207" />
                  </svg>
                  <span className="potion__name">{p.name}</span>
                  <span className="potion__count">×{n}</span>
                  <span className="potion__req small muted">{p.minMinutes ? `${duration(p.minMinutes)}+ session` : 'Any session'}</span>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="card">
          <h2 className="card__title">Recent sessions</h2>
          {recent.length === 0 ? (
            <p className="muted">No sessions yet. Head to the Laboratory to start your first one.</p>
          ) : (
            <ul className="history">
              {recent.map((s) => (
                <li key={s.id} className="history__row">
                  <span>{new Date(s.endedAt).toLocaleString(undefined, { weekday: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                  <span>
                    {duration(s.minutes)}
                    {!s.completed && <span className="muted"> (ended early)</span>}
                  </span>
                  <span className="history__xp">+{s.xp} XP</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card settings">
          <h2 className="card__title">Settings</h2>
          <Toggle label="Sound effects" checked={state.settings.sound} onChange={(v) => dispatch({ type: 'updateSettings', settings: { sound: v } })} />
          <Toggle
            label="Notify me when a session or break ends"
            hint="Only shows when this tab is in the background."
            checked={state.settings.notifications}
            onChange={(v) => void toggleNotifications(v)}
          />
          <Toggle
            label="Demo speed"
            hint="One minute passes every second, so you can show the whole loop quickly. Applies to the next session or break."
            checked={state.settings.demoSpeed}
            onChange={(v) => dispatch({ type: 'updateSettings', settings: { demoSpeed: v } })}
          />

          <h3 className="settings__sub">Your save</h3>
          <p className="small muted">Progress is saved in this browser only. Download a backup to keep it safe or move it to another device.</p>
          <div className="settings__row">
            <button type="button" className="btn btn--secondary" onClick={() => exportSave(state)}>
              Download save
            </button>
            <button type="button" className="btn btn--secondary" onClick={() => fileRef.current?.click()}>
              Load save
            </button>
            <input ref={fileRef} type="file" accept="application/json,.json" hidden onChange={(e) => void importSave(e.target.files?.[0]).finally(() => (e.target.value = ''))} />
            <button type="button" className="btn btn--danger" onClick={() => setConfirmReset(true)}>
              Reset progress
            </button>
          </div>
        </section>
      </div>

      {renaming && (
        <NamePrompt
          initial={state.name ?? ''}
          title="Change your wizard name"
          onClose={() => setRenaming(false)}
          onSubmit={(name) => {
            dispatch({ type: 'setName', name });
            setRenaming(false);
            toast('Name updated.');
          }}
        />
      )}

      {confirmReset && (
        <Modal title="Reset all progress?" onClose={() => setConfirmReset(false)}>
          <p>This deletes your level, XP, gold, spells, potions and history from this browser. It can't be undone unless you downloaded a save.</p>
          <div className="modal__actions">
            <button type="button" className="btn btn--ghost" onClick={() => setConfirmReset(false)} autoFocus>
              Cancel
            </button>
            <button
              type="button"
              className="btn btn--danger"
              onClick={() => {
                dispatch({ type: 'replace', state: createInitialState(Date.now()) });
                setConfirmReset(false);
                nav.go('title');
              }}
            >
              Reset everything
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function Stat({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="stat card">
      <span className="stat__icon" aria-hidden="true">
        {icon}
      </span>
      <span className="stat__value">{value}</span>
      <span className="stat__label">{label}</span>
    </div>
  );
}

function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="toggle">
      <span className="toggle__text">
        <span>{label}</span>
        {hint && <span className="small muted">{hint}</span>}
      </span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle__track" aria-hidden="true" />
    </label>
  );
}
