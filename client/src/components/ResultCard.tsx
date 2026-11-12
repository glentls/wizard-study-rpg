import { BREAK_MINUTES } from '../game/config';
import { potionDef } from '../game/content';
import { duration } from '../game/format';
import type { SessionResult } from '../game/state';
import { Modal } from './ui';

/** Shown after a session: time studied, XP and gold earned, any level up, then the break choice. */
export function ResultCard({ result, xpUnspent, onBreak, onSkip }: { result: SessionResult; xpUnspent: number; onBreak: () => void; onSkip: () => void }) {
  const potion = result.potion ? potionDef(result.potion) : null;
  const leveled = result.levelAfter > result.levelBefore;
  const nothing = result.minutes === 0;

  return (
    <Modal className="result-card" labelledBy="result-title">
      <p className="result-card__kicker">{result.completed ? 'Session complete' : 'Session ended early'}</p>
      <h2 id="result-title" className="result-card__time">
        {nothing ? 'Less than a minute' : duration(result.minutes)}
      </h2>
      {potion && (
        <p className="result-card__potion">
          <span className="potion-dot" style={{ background: potion.color }} aria-hidden="true" /> You brewed a <strong>{potion.name}</strong>
        </p>
      )}

      {nothing ? (
        <p className="note">Study for at least one minute to earn XP and gold.</p>
      ) : (
        <ul className="rewards">
          <li className="reward reward--xp">
            <span className="reward__icon" aria-hidden="true">
              ✨
            </span>
            <span className="reward__value">+{result.xp} XP</span>
            {result.bonusXp > 0 && <span className="reward__note">includes +{result.bonusXp} focus bonus</span>}
          </li>
          <li className="reward reward--gold">
            <span className="reward__icon" aria-hidden="true">
              🪙
            </span>
            <span className="reward__value">+{result.gold} gold</span>
          </li>
        </ul>
      )}

      {leveled && (
        <p className="level-up" role="status">
          <span aria-hidden="true">⭐</span> Level up! You are now level {result.levelAfter}
        </p>
      )}
      {!result.completed && !nothing && <p className="note">Finish a full session to brew a potion and earn the focus bonus.</p>}
      {xpUnspent > 0 && <p className="note">You have {xpUnspent} XP to invest in spells at the Library.</p>}

      <div className="modal__actions modal__actions--stack">
        {nothing ? (
          <button type="button" className="btn btn--primary" onClick={onSkip} autoFocus>
            Back to the lab
          </button>
        ) : (
          <>
            <button type="button" className="btn btn--primary btn--big" onClick={onBreak} autoFocus>
              ☕ Take a {BREAK_MINUTES}-minute break
            </button>
            <button type="button" className="btn btn--ghost" onClick={onSkip}>
              Skip break
            </button>
          </>
        )}
      </div>
    </Modal>
  );
}
