import { useEffect, useRef, useState } from 'react';
import { MAX_UPGRADE_LEVEL } from '../game/config';
import { elementDef, getUpgrade } from '../game/content';
import { statAt, upgradeCost } from '../game/progression';
import { playInvest } from '../game/sound';
import { investBlock, maxInvestAmount, upgradeState } from '../game/state';
import { useGame } from '../game/store';
import { Bar } from './ui';

/**
 * The zoomed-in view of one spell (or mana upgrade): name, level, XP bar and two buttons.
 * "Invest 1" adds a single XP. "Invest max" adds everything you have, or just enough to reach
 * the next level. After a level up the bar empties, so you can keep pressing to spend a big pile.
 */
export function SpellCard({ id, onBack, closing }: { id: string; onBack: () => void; closing: boolean }) {
  const { state, dispatch } = useGame();
  const def = getUpgrade(id)!;
  const cur = upgradeState(state, id);
  const block = investBlock(state, id);
  const maxed = cur.level >= MAX_UPGRADE_LEVEL;
  const cost = maxed ? 0 : upgradeCost(def, cur.level);
  const maxAmount = maxInvestAmount(state, id);
  const color = def.element ? elementDef(def.element).color : '#60a5fa';
  const requiresName = def.requires ? getUpgrade(def.requires)?.name : undefined;

  const [flash, setFlash] = useState(0);
  const prevLevel = useRef(cur.level);
  useEffect(() => {
    if (cur.level > prevLevel.current) setFlash((f) => f + 1);
    prevLevel.current = cur.level;
  }, [cur.level]);

  const invest = (amount: number | 'max') => {
    const toNext = cost - cur.progress;
    const spend = amount === 'max' ? maxAmount : Math.min(amount, toNext, state.xpUnspent);
    if (state.settings.sound) playInvest(spend >= toNext);
    dispatch({ type: 'invest', id, amount });
  };

  const fmtStat = (lvl: number) => `${statAt(def, lvl)}${def.stat.suffix ?? ''}`;

  let hint: string | null = null;
  if (block === 'requires') hint = `Learn ${requiresName} first to unlock this.`;
  else if (block === 'no-xp') hint = 'No XP left. Study in the Laboratory to earn more.';
  else if (block === 'maxed') hint = 'Mastered! This one is at its highest level.';

  return (
    <section className={`spell-card${closing ? ' spell-card--closing' : ''}`} style={{ ['--el' as string]: color }} aria-labelledby="spell-card-title">
      <button type="button" className="btn btn--ghost back-btn spell-card__back" onClick={onBack}>
        <span aria-hidden="true">←</span> Back to scroll
      </button>

      <div className="spell-card__icon" key={flash} data-flash={flash > 0 || undefined} aria-hidden="true">
        {def.icon}
      </div>
      {flash > 0 && (
        <p className="spell-card__levelup" key={`l${flash}`} role="status">
          Level {cur.level}!
        </p>
      )}

      <h3 id="spell-card-title" className="spell-card__name">
        {def.name}
      </h3>
      <p className="spell-card__desc">{def.description}</p>

      <div className="spell-card__level">
        {cur.level === 0 ? 'Not learned yet' : `Level ${cur.level}`} <span className="muted">/ {MAX_UPGRADE_LEVEL}</span>
      </div>

      {!maxed && (
        <>
          <Bar value={cur.progress} max={cost} className="bar--spell" label={`${cur.progress} of ${cost} XP towards level ${cur.level + 1}`} />
          <p className="spell-card__xp">
            {cur.progress} / {cost} XP to {cur.level === 0 ? 'learn' : `level ${cur.level + 1}`}
          </p>
        </>
      )}

      <p className="spell-card__stat">
        {def.stat.label}: <strong>{cur.level > 0 ? fmtStat(cur.level) : '—'}</strong>
        {!maxed && (
          <>
            {' '}
            <span aria-hidden="true">→</span> <strong className="up">{fmtStat(cur.level + 1)}</strong>
          </>
        )}
      </p>

      <p className="spell-card__wallet">
        <span aria-hidden="true">✨</span> {state.xpUnspent} XP to invest
      </p>

      <div className="spell-card__actions">
        <button type="button" className="btn btn--secondary" disabled={block !== null} onClick={() => invest(1)}>
          Invest 1
        </button>
        <button type="button" className="btn btn--primary" disabled={block !== null} onClick={() => invest('max')}>
          Invest max{maxAmount > 0 ? ` (+${maxAmount})` : ''}
        </button>
      </div>
      {hint && <p className="note spell-card__hint">{hint}</p>}
    </section>
  );
}
