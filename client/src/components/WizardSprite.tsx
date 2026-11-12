export type WizardMode = 'idle' | 'work' | 'chill' | 'cheer';

/**
 * The player's wizard, drawn around (0, 0) at the feet, about 190 units tall.
 * Placeholder art: shapes are grouped (body, arms, head, hat) so the artist can swap each part.
 */
export function WizardSprite({ mode, facing = 1 }: { mode: WizardMode; facing?: 1 | -1 }) {
  return (
    <g className={`wizard wizard--${mode}`}>
      <ellipse cx={0} cy={2} rx={40} ry={9} fill="rgba(0,0,0,0.35)" />
      <g transform={`scale(${facing} 1)`}>
        <g className="wizard__body">
          {/* back arm */}
          <g className="wizard__arm wizard__arm--back">
            <path d="M-14 -88 Q-34 -70 -36 -48 L-24 -46 Q-22 -66 -8 -80 Z" fill="#4630a8" />
            <circle cx={-31} cy={-45} r={6} fill="#ffd9b8" />
          </g>
          {/* robe */}
          <path d="M-36 0 Q-30 -58 -16 -96 L16 -96 Q30 -58 36 0 Q0 7 -36 0 Z" fill="url(#robe)" />
          <path d="M-36 0 Q0 8 36 0 L35 -7 Q0 1 -35 -7 Z" fill="#f5c451" />
          <rect x={-19} y={-62} width={38} height={6} rx={3} fill="#f5c451" />
          <circle cx={0} cy={-59} r={4.5} fill="#7dd3fc" stroke="#f5c451" strokeWidth={1.5} />
          {/* front arm */}
          <g className="wizard__arm wizard__arm--front">
            <path d="M14 -88 Q34 -70 36 -48 L24 -46 Q22 -66 8 -80 Z" fill="#5b3fd1" />
            <circle cx={31} cy={-45} r={6} fill="#ffd9b8" />
            {/* wand */}
            <g className="wizard__wand">
              <line x1={31} y1={-45} x2={56} y2={-70} stroke="#6b4423" strokeWidth={4} strokeLinecap="round" />
              <circle className="wizard__wand-tip" cx={57} cy={-71} r={4} fill="#fde68a" />
            </g>
            {/* tea mug for breaks */}
            <g className="wizard__mug">
              <rect x={24} y={-56} width={18} height={20} rx={4} fill="#e2e8f0" />
              <path d="M42 -50 q8 0 8 6 q0 6 -8 6" fill="none" stroke="#e2e8f0" strokeWidth={3} />
              <path className="steam" d="M30 -62 q-4 -8 0 -14 q4 -6 0 -12" fill="none" stroke="rgba(255,255,255,0.6)" strokeWidth={2.5} strokeLinecap="round" />
              <path className="steam steam--2" d="M37 -62 q-4 -8 0 -14 q4 -6 0 -12" fill="none" stroke="rgba(255,255,255,0.5)" strokeWidth={2.5} strokeLinecap="round" />
            </g>
          </g>
          {/* head */}
          <g className="wizard__head">
            <path d="M-17 -116 Q-22 -92 -12 -86 L-8 -104 Z" fill="#7c4a2d" />
            <path d="M17 -116 Q22 -92 12 -86 L8 -104 Z" fill="#7c4a2d" />
            <circle cx={0} cy={-108} r={17} fill="#ffd9b8" />
            <circle cx={-10} cy={-102} r={3.5} fill="#ffb4a2" opacity={0.7} />
            <circle cx={10} cy={-102} r={3.5} fill="#ffb4a2" opacity={0.7} />
            <g className="wizard__eyes">
              <ellipse cx={-6} cy={-109} rx={2.3} ry={2.8} fill="#2b2140" />
              <ellipse cx={6} cy={-109} rx={2.3} ry={2.8} fill="#2b2140" />
            </g>
            <path d="M-4 -100 Q0 -97 4 -100" fill="none" stroke="#2b2140" strokeWidth={1.6} strokeLinecap="round" />
            {/* hat */}
            <path d="M-34 -118 Q0 -132 34 -118 Q0 -112 -34 -118 Z" fill="#3b2a8f" />
            <path d="M-21 -121 Q-8 -150 4 -178 Q8 -186 14 -180 Q10 -168 12 -150 Q16 -134 21 -121 Q0 -127 -21 -121 Z" fill="url(#robe)" />
            <path d="M-20 -124 Q0 -130 20 -124 L20 -129 Q0 -135 -20 -129 Z" fill="#f5c451" />
            <path className="wizard__star" d="M2 -150 l2.5 5 5.5 .8 -4 3.9 .9 5.5 -4.9 -2.6 -4.9 2.6 .9 -5.5 -4 -3.9 5.5 -.8 Z" fill="#fde68a" />
          </g>
        </g>
      </g>
    </g>
  );
}

/** Shared SVG definitions the sprite relies on. Render once per <svg>. */
export function WizardDefs() {
  return (
    <linearGradient id="robe" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stopColor="#6d4ef0" />
      <stop offset="1" stopColor="#3f2a9e" />
    </linearGradient>
  );
}
