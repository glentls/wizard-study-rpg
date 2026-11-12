import { Hotspot, SceneLabel } from '../components/Hotspot';
import { useGame } from '../game/store';
import type { Nav } from './nav';

/**
 * The floating island. On the title screen it is zoomed out with the game title over it;
 * tapping anywhere zooms in and the buildings become clickable.
 * MVP buildings: Laboratory (study) and Library (spells). The portal is under construction.
 */
export function IslandScene({ zoomed, onTapTitle, nav }: { zoomed: boolean; onTapTitle: () => void; nav: Nav }) {
  const { toast } = useGame();

  return (
    <div
      className={`island-scene${zoomed ? ' island-scene--zoomed' : ''}`}
      onClick={zoomed ? undefined : onTapTitle}
      onKeyDown={zoomed ? undefined : (e) => (e.key === 'Enter' || e.key === ' ') && onTapTitle()}
      role={zoomed ? undefined : 'button'}
      tabIndex={zoomed ? undefined : 0}
      aria-label={zoomed ? undefined : 'Tap anywhere to begin'}
    >
      <div className="sky" aria-hidden="true">
        <div className="stars" />
        <div className="cloud cloud--1" />
        <div className="cloud cloud--2" />
        <div className="cloud cloud--3" />
      </div>

      <div className="island-camera">
        <svg className="island-svg" viewBox="0 0 1000 1000" preserveAspectRatio="xMidYMid meet" role="img" aria-label="A floating island with a laboratory, a library and a portal">
          <defs>
            <linearGradient id="rock" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#7a5236" />
              <stop offset="0.6" stopColor="#4a2f22" />
              <stop offset="1" stopColor="#2a1a16" />
            </linearGradient>
            <radialGradient id="grass" cx="0.5" cy="0.35" r="0.7">
              <stop offset="0" stopColor="#8be08a" />
              <stop offset="1" stopColor="#3f9b57" />
            </radialGradient>
            <linearGradient id="stone" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#9aa0b8" />
              <stop offset="1" stopColor="#5d6380" />
            </linearGradient>
            <linearGradient id="waterfall" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#9be7ff" />
              <stop offset="1" stopColor="#9be7ff" stopOpacity="0" />
            </linearGradient>
            <radialGradient id="portalGlow">
              <stop offset="0" stopColor="#e9d5ff" />
              <stop offset="0.5" stopColor="#8b5cf6" />
              <stop offset="1" stopColor="#3b0764" />
            </radialGradient>
          </defs>

          {/* distant mini islands */}
          <g className="float float--slow" opacity={0.85}>
            <ellipse cx={130} cy={300} rx={60} ry={16} fill="#5fbf6e" />
            <path d="M70 300 Q100 360 130 380 Q160 360 190 300 Z" fill="url(#rock)" />
          </g>
          <g className="float float--slower" opacity={0.8}>
            <ellipse cx={880} cy={250} rx={45} ry={12} fill="#5fbf6e" />
            <path d="M835 250 Q860 300 880 315 Q900 300 925 250 Z" fill="url(#rock)" />
          </g>

          <g className="float">
            {/* underside */}
            <path d="M80 600 Q90 690 200 740 Q260 820 360 850 Q430 960 500 990 Q560 930 640 860 Q760 820 820 730 Q910 690 920 600 Z" fill="url(#rock)" />
            <path d="M150 690 Q300 740 480 735 Q700 735 860 680" fill="none" stroke="#2a1a16" strokeWidth={4} opacity={0.4} />
            <path d="M260 800 Q400 830 560 820 Q680 810 760 770" fill="none" stroke="#2a1a16" strokeWidth={4} opacity={0.35} />
            <circle cx={420} cy={900} r={8} fill="#a78bfa" className="twinkle" />
            <circle cx={610} cy={850} r={6} fill="#7dd3fc" className="twinkle twinkle--2" />
            {/* waterfall */}
            <rect x={846} y={640} width={26} height={300} fill="url(#waterfall)" className="waterfall" />
            {/* grass */}
            <ellipse cx={500} cy={612} rx={424} ry={132} fill="#2f7a45" />
            <ellipse cx={500} cy={600} rx={420} ry={128} fill="url(#grass)" />
            {/* paths */}
            <path d="M500 735 Q480 680 470 640 Q440 610 310 610 M470 640 Q560 610 700 612 M470 640 Q490 590 500 548" fill="none" stroke="#e8d3a2" strokeWidth={22} strokeLinecap="round" opacity={0.75} />

            {/* trees */}
            <Tree x={140} y={600} s={1} />
            <Tree x={190} y={655} s={0.8} />
            <Tree x={860} y={590} s={0.95} />
            <Tree x={810} y={665} s={0.75} />
            <Tree x={590} y={700} s={0.6} />
            <Tree x={385} y={700} s={0.65} />

            {/* Portal: under construction */}
            <Hotspot
              label="Portal (under construction)"
              disabled
              inactive={!zoomed}
              onActivate={() => toast('🚧 The portal is still under construction. Check back soon!')}
              className="building building--portal"
            >
              <path d="M440 548 L440 450 Q440 395 500 395 Q560 395 560 450 L560 548 Z" fill="url(#stone)" />
              <path d="M455 548 L455 455 Q455 412 500 412 Q545 412 545 455 L545 548 Z" fill="url(#portalGlow)" className="portal-swirl" opacity={0.45} />
              <rect x={425} y={470} width={150} height={10} rx={3} fill="#c08a4a" transform="rotate(-12 500 475)" />
              <rect x={425} y={500} width={150} height={10} rx={3} fill="#c08a4a" transform="rotate(10 500 505)" />
              <g transform="translate(500 528)">
                <rect x={-44} y={-14} width={88} height={26} rx={4} fill="#facc15" stroke="#1f1f1f" strokeWidth={2} />
                <text y={4} textAnchor="middle" fontSize={11} fontWeight={700} fill="#1f1f1f">
                  UNDER CONSTRUCTION
                </text>
              </g>
              {zoomed && (
                <SceneLabel x={500} y={380} size={24} className="scene-label--muted">
                  Portal
                </SceneLabel>
              )}
            </Hotspot>

            {/* Laboratory */}
            <Hotspot label="Enter the Laboratory to study" inactive={!zoomed} onActivate={(el) => nav.go('lab', el)} className="building">
              <ellipse cx={290} cy={606} rx={95} ry={20} fill="rgba(0,0,0,0.25)" />
              <rect x={215} y={380} width={150} height={225} rx={8} fill="url(#stone)" />
              <path d="M215 430 H365 M215 480 H365 M215 530 H365" stroke="#4b5068" strokeWidth={2} opacity={0.5} />
              <rect x={330} y={290} width={24} height={70} fill="#5d6380" />
              <circle cx={342} cy={270} r={14} fill="#a7f3d0" opacity={0.5} className="smoke" />
              <circle cx={350} cy={240} r={18} fill="#a7f3d0" opacity={0.35} className="smoke smoke--2" />
              <circle cx={338} cy={205} r={22} fill="#a7f3d0" opacity={0.2} className="smoke smoke--3" />
              <path d="M195 390 L290 255 L385 390 Z" fill="#5b3fd1" />
              <path d="M195 390 L290 255 L300 270 L218 390 Z" fill="#7c5cff" opacity={0.6} />
              <circle cx={290} cy={250} r={7} fill="#fde68a" />
              <circle cx={290} cy={440} r={26} fill="#4ade80" className="glow-window" />
              <path d="M290 420 v40 M270 440 h40" stroke="#14532d" strokeWidth={4} />
              <path d="M262 605 V545 Q262 520 290 520 Q318 520 318 545 V605 Z" fill="#3b2416" />
              <text x={290} y={505} textAnchor="middle" fontSize={22}>
                ⚗️
              </text>
              {zoomed && <SceneLabel x={290} y={665}>Laboratory</SceneLabel>}
            </Hotspot>

            {/* Library */}
            <Hotspot label="Enter the Library to learn spells" inactive={!zoomed} onActivate={(el) => nav.go('library', el)} className="building">
              <ellipse cx={710} cy={606} rx={120} ry={22} fill="rgba(0,0,0,0.25)" />
              <rect x={605} y={425} width={210} height={180} rx={4} fill="#d8c3a0" />
              <path d="M590 430 L710 345 L830 430 Z" fill="#8b4a2b" />
              <path d="M612 425 L710 360 L808 425 Z" fill="#a85d36" />
              <rect x={590} y={422} width={240} height={14} fill="#6b3a22" />
              {[625, 665, 755, 795].map((x) => (
                <rect key={x} x={x - 7} y={436} width={14} height={165} fill="#efe3cb" />
              ))}
              <rect x={590} y={598} width={240} height={12} fill="#a89474" />
              <path d="M688 600 V530 Q688 505 710 505 Q732 505 732 530 V600 Z" fill="#5a3518" />
              <rect x={638} y={470} width={22} height={34} rx={11} fill="#fcd34d" className="glow-window glow-window--warm" />
              <rect x={760} y={470} width={22} height={34} rx={11} fill="#fcd34d" className="glow-window glow-window--warm" />
              <text x={710} y={412} textAnchor="middle" fontSize={34}>
                📖
              </text>
              {zoomed && <SceneLabel x={710} y={665}>Library</SceneLabel>}
            </Hotspot>
          </g>
        </svg>
      </div>

      <div className={`title-overlay${zoomed ? ' title-overlay--hidden' : ''}`} aria-hidden={zoomed}>
        <h1 className="title-overlay__title">Wizard Study</h1>
        <p className="title-overlay__subtitle">Study for real. Grow your magic.</p>
        <p className="title-overlay__tap">Tap anywhere to begin</p>
      </div>
    </div>
  );
}

function Tree({ x, y, s }: { x: number; y: number; s: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${s})`}>
      <ellipse cx={0} cy={4} rx={30} ry={8} fill="rgba(0,0,0,0.2)" />
      <rect x={-6} y={-40} width={12} height={44} rx={4} fill="#6b4423" />
      <circle cx={0} cy={-62} r={34} fill="#2f8a4f" />
      <circle cx={-16} cy={-50} r={22} fill="#3aa35d" />
      <circle cx={14} cy={-72} r={20} fill="#4cbb6c" />
    </g>
  );
}
