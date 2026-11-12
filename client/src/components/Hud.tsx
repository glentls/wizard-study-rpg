import { clock } from '../game/format';
import { levelFromXp } from '../game/progression';
import { breakRemainingMs } from '../game/state';
import { useGame, useNow } from '../game/store';
import { Bar } from './ui';

/**
 * Top bar shown on every screen except the study (focus) screen: level, gold, XP to invest,
 * the break timer when one is running, and the profile button.
 */
export function Hud({ onProfile }: { onProfile: () => void }) {
  const { state, dispatch } = useGame();
  const lvl = levelFromXp(state.xpTotal);
  const now = useNow(1000, state.breakEndsAt !== null);

  return (
    <header className="hud">
      <button type="button" className="hud__wizard" onClick={onProfile} aria-label={`Open profile for ${state.name ?? 'wizard'}`}>
        <span className="hud__avatar" aria-hidden="true">
          🧙
        </span>
        <span className="hud__who">
          <span className="hud__name">{state.name ?? 'Wizard'}</span>
          <span className="hud__level">
            Lv {lvl.level}
            <Bar value={lvl.into} max={lvl.needed} className="bar--xp bar--thin" label={`Level ${lvl.level} progress: ${lvl.into} of ${lvl.needed} XP`} />
          </span>
        </span>
      </button>

      <div className="hud__right">
        {state.breakEndsAt !== null && (
          <span className="chip chip--break" title="Break time">
            ☕ {clock(breakRemainingMs(state, now))}
            <button type="button" className="chip__action" onClick={() => dispatch({ type: 'skipBreak' })}>
              Skip
            </button>
          </span>
        )}
        <span className="chip chip--gold" title="Gold">
          <span aria-hidden="true">🪙</span> {state.gold}
          <span className="sr-only"> gold</span>
        </span>
        <span className="chip chip--xp" title="XP ready to invest in the Library">
          <span aria-hidden="true">✨</span> {state.xpUnspent}
          <span className="sr-only"> XP to invest</span>
        </span>
        <button type="button" className="chip chip--btn" onClick={onProfile} aria-label="Profile, stats and settings">
          <span aria-hidden="true">⚙️</span>
        </button>
      </div>
    </header>
  );
}
