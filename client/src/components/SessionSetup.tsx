import { useState } from 'react';
import { BREAK_MINUTES, SESSION_MAX_MINUTES, SESSION_MIN_MINUTES, SESSION_STEP_MINUTES } from '../game/config';
import { potionFor } from '../game/content';
import { duration } from '../game/format';
import { sessionRewards } from '../game/progression';
import { Modal } from './ui';

/**
 * The "Start session" pop-up: one slider for study time (up to 1.5 hours) and a start button.
 * No spell choices here on purpose. You study first and decide what to level up afterwards.
 */
export function SessionSetup({ initial, demo, onStart, onClose }: { initial: number; demo: boolean; onStart: (minutes: number) => void; onClose: () => void }) {
  const [minutes, setMinutes] = useState(initial);
  const reward = sessionRewards(minutes, true);
  const potion = potionFor(minutes);

  return (
    <Modal title="How long will you study?" onClose={onClose} className="session-setup">
      <output className="session-setup__time" htmlFor="study-time" aria-live="polite">
        {duration(minutes)}
      </output>
      <input
        id="study-time"
        className="slider"
        type="range"
        min={SESSION_MIN_MINUTES}
        max={SESSION_MAX_MINUTES}
        step={SESSION_STEP_MINUTES}
        value={minutes}
        onChange={(e) => setMinutes(Number(e.target.value))}
        aria-label="Study time in minutes"
        style={{ ['--fill' as string]: `${((minutes - SESSION_MIN_MINUTES) / (SESSION_MAX_MINUTES - SESSION_MIN_MINUTES)) * 100}%` }}
      />
      <div className="slider__ticks" aria-hidden="true">
        <span>{SESSION_MIN_MINUTES} min</span>
        <span>45 min</span>
        <span>1 h 30</span>
      </div>

      <ul className="session-setup__info">
        <li>
          <span aria-hidden="true">✨</span> Up to <strong>{reward.xp} XP</strong> and <strong>{reward.gold} gold</strong>
        </li>
        <li>
          <span aria-hidden="true">🧪</span> Brews a <strong>{potion.name}</strong> when you finish
        </li>
        <li>
          <span aria-hidden="true">☕</span> A {BREAK_MINUTES}-minute break follows. You can skip it.
        </li>
      </ul>
      {demo && <p className="note">Demo speed is on: one minute passes every second.</p>}

      <div className="modal__actions">
        <button type="button" className="btn btn--ghost" onClick={onClose}>
          Not yet
        </button>
        <button type="button" className="btn btn--primary btn--big" onClick={() => onStart(minutes)} autoFocus>
          Start
        </button>
      </div>
    </Modal>
  );
}
