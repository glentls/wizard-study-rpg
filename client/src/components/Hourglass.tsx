import { useId } from 'react';

const GLASS =
  'M-50 -122 C-52 -60 -10 -28 -6 0 C-10 28 -52 60 -50 122 L50 122 C52 60 10 28 6 0 C10 -28 52 -60 50 -122 Z';
const BULB = 118;

/**
 * The giant hourglass in the middle of the laboratory, centred on (0, 0), about 280 units tall.
 * `progress` is the fraction of sand that has fallen (0 = all on top, 1 = all at the bottom).
 * When `flipping` is set the glass rotates 180 degrees. It flips a full-bottom glass, which looks
 * identical to a full-top one, so the switch to the running state afterwards is seamless.
 */
export function Hourglass({ progress, running, flipping, done }: { progress: number; running: boolean; flipping: boolean; done: boolean }) {
  const clip = useId().replace(/:/g, '');
  const p = flipping ? 1 : Math.min(1, Math.max(0, progress));
  const top = (1 - p) * BULB;
  const bottom = p * BULB;
  const streaming = running && !flipping && p < 1;

  return (
    <g className={`hourglass${flipping ? ' hourglass--flip' : ''}${done ? ' hourglass--done' : ''}`}>
      <defs>
        <clipPath id={`glass-${clip}`}>
          <path d={GLASS} />
        </clipPath>
        <linearGradient id={`sand-${clip}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffe08a" />
          <stop offset="1" stopColor="#e8a93a" />
        </linearGradient>
        <linearGradient id={`wood-${clip}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#a86b3c" />
          <stop offset="1" stopColor="#6b3f1f" />
        </linearGradient>
      </defs>
      <g className="hourglass__body">
        {/* glass */}
        <path d={GLASS} fill="rgba(200, 230, 255, 0.12)" />
        <g clipPath={`url(#glass-${clip})`}>
          <rect x={-60} y={-top} width={120} height={top} fill={`url(#sand-${clip})`} />
          <rect x={-60} y={122 - bottom} width={120} height={bottom + 2} fill={`url(#sand-${clip})`} />
          {bottom > 2 && <ellipse cx={0} cy={122 - bottom} rx={18 + bottom * 0.25} ry={6} fill="#ffe08a" />}
          {streaming && <line className="hourglass__stream" x1={0} y1={-2} x2={0} y2={122 - bottom} stroke="#ffd36b" strokeWidth={3} />}
        </g>
        <path d={GLASS} fill="none" stroke="rgba(220, 240, 255, 0.55)" strokeWidth={3} />
        <path d="M-40 -110 C-40 -70 -20 -45 -12 -30" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth={4} strokeLinecap="round" />
        {/* frame */}
        <rect x={-70} y={-140} width={140} height={18} rx={6} fill={`url(#wood-${clip})`} />
        <rect x={-70} y={122} width={140} height={18} rx={6} fill={`url(#wood-${clip})`} />
        <rect x={-64} y={-124} width={9} height={248} rx={4} fill="#7a4a26" />
        <rect x={55} y={-124} width={9} height={248} rx={4} fill="#7a4a26" />
        <circle cx={-59.5} cy={-131} r={5} fill="#f5c451" />
        <circle cx={59.5} cy={-131} r={5} fill="#f5c451" />
        <circle cx={-59.5} cy={131} r={5} fill="#f5c451" />
        <circle cx={59.5} cy={131} r={5} fill="#f5c451" />
      </g>
    </g>
  );
}
