import { useEffect, useState } from 'react';
import { Hourglass } from '../components/Hourglass';
import { ResultCard } from '../components/ResultCard';
import { SessionSetup } from '../components/SessionSetup';
import { Modal } from '../components/ui';
import { WizardDefs, WizardSprite, type WizardMode } from '../components/WizardSprite';
import { potionDef } from '../game/content';
import { clock, duration } from '../game/format';
import { primeAudio } from '../game/sound';
import { newId, useGame, useNow } from '../game/store';
import { breakRemainingMs, sessionProgress, studiedMinutes, type Station } from '../game/state';
import type { Nav } from './nav';

/** Where the wizard stands in each mode (scene units, at the feet). */
const SPOTS = {
  idle: { x: 360, y: 715 },
  potion: { x: 300, y: 690 },
  enchant: { x: 700, y: 690 },
  chill: { x: 640, y: 728 },
  cheer: { x: 360, y: 715 },
};

const FLIP_MS = 1100;
const CELEBRATE_MS = 2300;

/**
 * The laboratory, where studying happens.
 * Idle: the wizard looks around, and a "Start session" button opens the study-time pop-up.
 * Studying (focus mode): the HUD disappears, the hourglass flips and its sand falls for the whole
 * session while the wizard works at a station. Done: a potion pops out, then the rewards card,
 * then an optional break.
 */
export function LabScene({ nav }: { nav: Nav }) {
  const { state, dispatch } = useGame();
  const session = state.activeSession;
  const result = state.pendingResult;
  const onBreak = state.breakEndsAt !== null;
  const now = useNow(200, session !== null || onBreak);

  const [setupOpen, setSetupOpen] = useState(false);
  const [flipping, setFlipping] = useState(false);
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [cardVisible, setCardVisible] = useState(false);

  // When a session ends: let the potion pop out first, then show the rewards card.
  const resultId = result?.id;
  const celebrating = !!result?.completed && !cardVisible;
  useEffect(() => {
    if (!resultId) return;
    setConfirmEnd(false);
    setCardVisible(false);
    const t = setTimeout(() => setCardVisible(true), result?.completed ? CELEBRATE_MS : 0);
    return () => clearTimeout(t);
  }, [resultId]);

  // Focus-mode niceties: countdown in the tab title, and keep the screen awake while studying.
  useEffect(() => {
    if (!session) return;
    const remaining = (session.plannedMinutes - studiedMinutes(session, now)) * 60_000;
    document.title = `⏳ ${clock(remaining)} · Wizard Study`;
  }, [session, now]);
  useEffect(() => {
    if (!session) {
      document.title = 'Wizard Study';
      return;
    }
    let lock: { release: () => Promise<void> } | null = null;
    const nv = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
    nv.wakeLock
      ?.request('screen')
      .then((l) => (lock = l))
      .catch(() => {});
    return () => {
      void lock?.release().catch(() => {});
    };
  }, [session]);

  const start = (minutes: number) => {
    primeAudio();
    setSetupOpen(false);
    const station: Station = Math.random() < 0.5 ? 'potion' : 'enchant';
    dispatch({ type: 'startSession', minutes, now: Date.now(), station, id: newId() });
    setFlipping(true);
    setTimeout(() => setFlipping(false), FLIP_MS);
  };

  const progress = session ? sessionProgress(session, now) : 1;
  const remainingMs = session ? (session.plannedMinutes - studiedMinutes(session, now)) * 60_000 : 0;

  let mode: WizardMode = 'idle';
  let spot = SPOTS.idle;
  if (session) {
    mode = 'work';
    spot = SPOTS[session.station];
  } else if (celebrating) {
    mode = 'cheer';
    spot = SPOTS.cheer;
  } else if (onBreak) {
    mode = 'chill';
    spot = SPOTS.chill;
  }
  const facing: 1 | -1 = session?.station === 'potion' ? -1 : 1;
  const potion = result?.potion ? potionDef(result.potion) : null;

  return (
    <div className={`room lab${session ? ' lab--focus' : ''}`}>
      <svg className="room__svg" viewBox="0 0 1000 800" preserveAspectRatio="xMidYMid meet" role="img" aria-label="The laboratory: a round table with a giant hourglass, a potion station and an enchantment station">
        <defs>
          <WizardDefs />
          <linearGradient id="labWall" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#1d1640" />
            <stop offset="1" stopColor="#2e2360" />
          </linearGradient>
          <linearGradient id="labFloor" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#3b2a4f" />
            <stop offset="1" stopColor="#1f1630" />
          </linearGradient>
          <pattern id="bricks" width="80" height="40" patternUnits="userSpaceOnUse">
            <path d="M0 0 H80 M0 20 H80 M40 0 V20 M0 20 V40 M80 20 V40" stroke="#ffffff" strokeOpacity="0.05" strokeWidth="2" fill="none" />
          </pattern>
          <radialGradient id="tableTop" cx="0.5" cy="0.4" r="0.6">
            <stop offset="0" stopColor="#9a6a43" />
            <stop offset="1" stopColor="#5e3a20" />
          </radialGradient>
          <radialGradient id="candle">
            <stop offset="0" stopColor="#fff7c2" />
            <stop offset="1" stopColor="#fbbf24" stopOpacity="0" />
          </radialGradient>
          <radialGradient id="rays">
            <stop offset="0" stopColor="#fff7c2" stopOpacity="0.9" />
            <stop offset="1" stopColor="#fff7c2" stopOpacity="0" />
          </radialGradient>
        </defs>

        {/* room */}
        <rect width={1000} height={560} fill="url(#labWall)" />
        <rect width={1000} height={560} fill="url(#bricks)" />
        <rect y={540} width={1000} height={260} fill="url(#labFloor)" />
        <ellipse cx={500} cy={690} rx={420} ry={80} fill="#4c1d95" opacity={0.35} />

        {/* windows */}
        {[150, 850].map((x) => (
          <g key={x}>
            <path d={`M${x - 60} 330 V180 Q${x - 60} 110 ${x} 110 Q${x + 60} 110 ${x + 60} 180 V330 Z`} fill="#0b1033" stroke="#6b5aa8" strokeWidth={8} />
            <path d={`M${x} 110 V330 M${x - 60} 220 H${x + 60}`} stroke="#6b5aa8" strokeWidth={5} />
            <circle cx={x + 25} cy={160} r={14} fill="#fef9c3" opacity={x === 150 ? 1 : 0} />
            <circle cx={x - 25} cy={260} r={2} fill="#fff" className="twinkle" />
            <circle cx={x + 30} cy={290} r={2} fill="#fff" className="twinkle twinkle--2" />
          </g>
        ))}

        {/* shelves with jars */}
        <g>
          <rect x={330} y={170} width={340} height={12} rx={3} fill="#6b4423" />
          <rect x={330} y={270} width={340} height={12} rx={3} fill="#6b4423" />
          {[
            [355, '#f472b6'],
            [400, '#60a5fa'],
            [450, '#4ade80'],
            [560, '#facc15'],
            [610, '#c084fc'],
            [645, '#fb923c'],
          ].map(([x, c]) => (
            <g key={x as number}>
              <rect x={(x as number) - 12} y={132} width={24} height={38} rx={6} fill={c as string} opacity={0.75} />
              <rect x={(x as number) - 7} y={124} width={14} height={9} rx={2} fill="#a16207" />
            </g>
          ))}
          {[370, 395, 420, 600, 625, 650].map((x, i) => (
            <rect key={x} x={x - 10} y={226 + (i % 2) * 6} width={20} height={44 - (i % 2) * 6} rx={2} fill={['#7c3aed', '#b91c1c', '#0f766e'][i % 3]} />
          ))}
        </g>

        {/* candles */}
        {[90, 910].map((x) => (
          <g key={x}>
            <circle cx={x} cy={420} r={40} fill="url(#candle)" className="flicker" />
            <rect x={x - 6} y={425} width={12} height={40} rx={3} fill="#fef3c7" />
            <ellipse cx={x} cy={418} rx={4} ry={9} fill="#fbbf24" className="flicker" />
          </g>
        ))}

        {/* potion station (left) */}
        <g className={`station${session?.station === 'potion' ? ' station--active' : ''}`}>
          <ellipse cx={190} cy={655} rx={85} ry={18} fill="rgba(0,0,0,0.3)" />
          <path d="M120 580 Q115 650 190 660 Q265 650 260 580 Z" fill="#23202e" />
          <ellipse cx={190} cy={580} rx={72} ry={16} fill="#3f3a52" />
          <ellipse cx={190} cy={582} rx={62} ry={11} fill="#4ade80" className="brew" />
          <circle cx={170} cy={575} r={6} fill="#bbf7d0" className="bubble" />
          <circle cx={205} cy={572} r={4} fill="#bbf7d0" className="bubble bubble--2" />
          <circle cx={188} cy={578} r={5} fill="#bbf7d0" className="bubble bubble--3" />
          <path d="M150 668 L140 690 M230 668 L240 690" stroke="#23202e" strokeWidth={8} strokeLinecap="round" />
          <text x={190} y={735} className="station-label" textAnchor="middle">
            Potion station
          </text>
        </g>

        {/* enchantment station (right) */}
        <g className={`station${session?.station === 'enchant' ? ' station--active' : ''}`}>
          <ellipse cx={810} cy={660} rx={80} ry={16} fill="rgba(0,0,0,0.3)" />
          <path d="M760 660 L775 590 H845 L860 660 Z" fill="#4a3366" />
          <rect x={750} y={575} width={120} height={18} rx={4} fill="#6d4c8f" />
          <g className="rune-circle">
            <circle cx={810} cy={530} r={38} fill="none" stroke="#a78bfa" strokeWidth={3} strokeDasharray="6 6" />
            <circle cx={810} cy={530} r={24} fill="none" stroke="#c4b5fd" strokeWidth={2} />
            <path d="M810 506 L831 542 H789 Z" fill="none" stroke="#e9d5ff" strokeWidth={2} />
          </g>
          <rect x={790} y={560} width={40} height={14} rx={2} fill="#fef3c7" />
          <text x={810} y={735} className="station-label" textAnchor="middle">
            Enchantment station
          </text>
        </g>

        {/* round table with the giant hourglass */}
        <g>
          <ellipse cx={500} cy={655} rx={215} ry={30} fill="rgba(0,0,0,0.35)" />
          <path d="M300 580 V615 Q500 680 700 615 V580 Z" fill="#4a2c17" />
          <rect x={470} y={600} width={60} height={55} fill="#3d2412" />
          <ellipse cx={500} cy={580} rx={205} ry={52} fill="url(#tableTop)" />
          <ellipse cx={500} cy={580} rx={170} ry={38} fill="none" stroke="#c4a07a" strokeOpacity={0.25} strokeWidth={3} />
          {/* little props on the table */}
          <rect x={345} y={562} width={36} height={10} rx={2} fill="#7c3aed" transform="rotate(-8 363 567)" />
          <rect x={348} y={552} width={30} height={10} rx={2} fill="#0f766e" transform="rotate(-4 363 557)" />
          <path d="M630 570 l10 -28 h8 l10 28 Z" fill="#f472b6" opacity={0.8} />
        </g>

        <g transform="translate(500 425)">
          {celebrating && <circle r={150} fill="url(#rays)" className="rays" />}
          <Hourglass progress={progress} running={session !== null} flipping={flipping} done={celebrating} />
        </g>

        {/* potion popping out at the end of a session */}
        {celebrating && potion && (
          <g transform="translate(500 250)">
            <g className="potion-pop">
              <path d="M-14 -60 H14 V-30 Q42 -14 42 16 Q42 52 0 52 Q-42 52 -42 16 Q-42 -14 -14 -30 Z" fill={potion.color} stroke="#fff" strokeWidth={4} />
              <rect x={-18} y={-72} width={36} height={14} rx={4} fill="#a16207" />
              <path d="M-26 6 Q0 18 26 6" fill="none" stroke="#fff" strokeOpacity={0.6} strokeWidth={4} />
              <circle cx={-14} cy={0} r={6} fill="#fff" opacity={0.7} />
            </g>
            {[0, 60, 120, 180, 240, 300].map((a) => (
              <circle key={a} r={6} fill="#fde68a" className="spark" style={{ ['--a' as string]: `${a}deg` }} />
            ))}
          </g>
        )}

        {/* the wizard */}
        <g className="wizard-pos" style={{ transform: `translate(${spot.x}px, ${spot.y}px)` }}>
          <WizardSprite mode={mode} facing={facing} />
          {mode === 'work' && (
            <g className="work-sparks" transform={`translate(${facing * 60} -75)`}>
              <circle r={4} fill="#fde68a" />
              <circle r={3} fill="#a7f3d0" />
              <circle r={3} fill="#c4b5fd" />
            </g>
          )}
        </g>
      </svg>

      {/* ---------- UI layers ---------- */}

      {!session && !result && (
        <div className="room__top">
          <button type="button" className="btn btn--ghost back-btn" onClick={(e) => nav.go('island', e.currentTarget)}>
            <span aria-hidden="true">←</span> Island
          </button>
        </div>
      )}

      {session && (
        <div className="focus-ui">
          <div className="focus-ui__timer" role="timer" aria-live="off" aria-label="Time remaining">
            {clock(remainingMs)}
          </div>
          <p className="focus-ui__caption">
            {flipping ? 'The hourglass turns…' : `${state.name ?? 'Your wizard'} is ${session.station === 'potion' ? 'brewing at the potion station' : 'enchanting at the enchantment station'}`}
          </p>
          <button type="button" className="btn btn--quiet focus-ui__end" onClick={() => setConfirmEnd(true)}>
            End session
          </button>
        </div>
      )}

      {celebrating && (
        <div className="celebrate" role="status">
          <p className="celebrate__title">Session complete!</p>
        </div>
      )}

      {!session && !result && (
        <div className="room__bottom">
          {onBreak ? (
            <div className="break-panel parchment">
              <div className="break-panel__time">
                <p className="break-panel__label">☕ Break time</p>
                <p className="break-panel__timer" role="timer">
                  {clock(breakRemainingMs(state, now))}
                </p>
              </div>
              <div className="break-panel__body">
                <p className="break-panel__hint">Stretch, drink some water, rest your eyes. Or spend your XP in the Library.</p>
                <div className="break-panel__actions">
                <button type="button" className="btn btn--ghost" onClick={() => dispatch({ type: 'skipBreak' })}>
                  Skip break
                </button>
                <button type="button" className="btn btn--primary" onClick={() => setSetupOpen(true)}>
                  Start next session
                </button>
                </div>
              </div>
            </div>
          ) : (
            <button type="button" className="btn btn--primary btn--huge start-btn" onClick={() => setSetupOpen(true)}>
              <span aria-hidden="true">⏳</span> Start session
            </button>
          )}
        </div>
      )}

      {setupOpen && <SessionSetup initial={state.settings.lastSessionMinutes} demo={state.settings.demoSpeed} onStart={start} onClose={() => setSetupOpen(false)} />}

      {confirmEnd && session && (
        <Modal title="End the session early?" onClose={() => setConfirmEnd(false)}>
          <p>
            You've studied <strong>{duration(Math.floor(studiedMinutes(session, now)))}</strong> of {duration(session.plannedMinutes)}. You keep the XP and gold for every full
            minute, but you won't brew a potion or get the focus bonus.
          </p>
          <div className="modal__actions">
            <button type="button" className="btn btn--ghost" onClick={() => dispatch({ type: 'endSessionEarly', now: Date.now() })}>
              End session
            </button>
            <button type="button" className="btn btn--primary" onClick={() => setConfirmEnd(false)} autoFocus>
              Keep studying
            </button>
          </div>
        </Modal>
      )}

      {result && cardVisible && (
        <ResultCard
          result={result}
          xpUnspent={state.xpUnspent}
          onBreak={() => dispatch({ type: 'acknowledgeResult', takeBreak: true, now: Date.now() })}
          onSkip={() => dispatch({ type: 'acknowledgeResult', takeBreak: false, now: Date.now() })}
        />
      )}
    </div>
  );
}
