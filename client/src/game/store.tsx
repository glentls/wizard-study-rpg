import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react';
import { SAVE_KEY } from './config';
import { playBreakOver, playComplete } from './sound';
import { gameReducer, isSessionDue, sessionEndsAt, type GameAction, type GameState } from './state';
import { loadState, sanitizeState, saveState } from './storage';

interface Toast {
  id: number;
  text: string;
}

interface GameContextValue {
  state: GameState;
  dispatch: (action: GameAction) => void;
  toast: (text: string) => void;
}

const GameContext = createContext<GameContextValue | null>(null);

function notify(title: string, body: string, enabled: boolean) {
  if (!enabled || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  if (document.visibilityState === 'visible') return;
  try {
    new Notification(title, { body });
  } catch {
    /* some mobile browsers only allow notifications from a service worker */
  }
}

export function GameProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(gameReducer, undefined, () => loadState(Date.now()));
  const [toasts, setToasts] = useState<Toast[]>([]);
  const stateRef = useRef(state);
  stateRef.current = state;

  const toast = useCallback((text: string) => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, text }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3600);
  }, []);

  // Persist every change.
  useEffect(() => saveState(state), [state]);

  // Another tab changed the save: adopt it so two tabs never overwrite each other's progress.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== SAVE_KEY || !e.newValue) return;
      try {
        const next = sanitizeState(JSON.parse(e.newValue), Date.now());
        if (next) dispatch({ type: 'replace', state: next });
      } catch {
        /* ignore */
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  // Finish the session when its time is up. Time is computed from timestamps, so a refresh,
  // a sleeping laptop or a closed tab never loses or double-counts study time.
  const session = state.activeSession;
  useEffect(() => {
    if (!session) return;
    const check = () => {
      const now = Date.now();
      if (!isSessionDue(session, now)) return;
      const live = now - sessionEndsAt(session) < 10_000; // don't chime for sessions that ended while the app was closed
      if (live && stateRef.current.settings.sound) playComplete();
      if (live) notify('Session complete! 🧪', 'Your potion is ready. Come collect your rewards.', stateRef.current.settings.notifications);
      dispatch({ type: 'completeSession', now });
    };
    check();
    const timer = setInterval(check, 250);
    document.addEventListener('visibilitychange', check);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
    };
  }, [session]);

  // End the break when its timer runs out.
  const breakEndsAt = state.breakEndsAt;
  useEffect(() => {
    if (breakEndsAt === null) return;
    const remaining = breakEndsAt - Date.now();
    if (remaining <= 0) {
      dispatch({ type: 'skipBreak' });
      return;
    }
    const timer = setTimeout(() => {
      if (stateRef.current.settings.sound) playBreakOver();
      notify('Break is over ⏳', 'Ready for another study session?', stateRef.current.settings.notifications);
      toast('Break is over. Ready for another session?');
      dispatch({ type: 'skipBreak' });
    }, remaining);
    return () => clearTimeout(timer);
  }, [breakEndsAt, toast]);

  const value = useMemo(() => ({ state, dispatch, toast }), [state, toast]);

  return (
    <GameContext.Provider value={value}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className="toast">
            {t.text}
          </div>
        ))}
      </div>
    </GameContext.Provider>
  );
}

export function useGame(): GameContextValue {
  const ctx = useContext(GameContext);
  if (!ctx) throw new Error('useGame must be used inside GameProvider');
  return ctx;
}

/** Re-renders the caller every `ms` while `active` is true, returning the current time. */
export function useNow(ms: number, active = true): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms, active]);
  return now;
}

export function newId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}
