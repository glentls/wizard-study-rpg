import { useCallback, useEffect, useState } from 'react';
import { Hotspot, SceneLabel } from '../components/Hotspot';
import { SpellCard } from '../components/SpellCard';
import { Bar } from '../components/ui';
import { WizardDefs, WizardSprite } from '../components/WizardSprite';
import { MAX_UPGRADE_LEVEL } from '../game/config';
import { ELEMENTS, MANA_UPGRADES, getUpgrade, spellsFor, type ElementId, type UpgradeDef } from '../game/content';
import { upgradeCost } from '../game/progression';
import { upgradeState, type GameState } from '../game/state';
import { useGame } from '../game/store';
import type { Nav } from './nav';

type Shelf = 'spell' | 'mana';
const ANIM_MS = 380;

/**
 * The library: a glowing tree in the middle, bookshelves around it.
 * Spell Scrolls and Mana Scrolls open; a third, chained shelf is sealed for later.
 * Shelf → scroll unrolls into a menu → pick a spell → it zooms into a card where you invest XP.
 * Back folds everything up again in reverse; one more back returns to the island.
 */
export function LibraryScene({ nav }: { nav: Nav }) {
  const { state, toast } = useGame();
  const [shelf, setShelf] = useState<Shelf | null>(null);
  const [scrollClosing, setScrollClosing] = useState(false);
  const [expanded, setExpanded] = useState<ElementId | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [cardClosing, setCardClosing] = useState(false);

  const closeCard = useCallback(() => {
    setCardClosing(true);
    setTimeout(() => {
      setSelected(null);
      setCardClosing(false);
    }, ANIM_MS);
  }, []);

  const closeScroll = useCallback(() => {
    setScrollClosing(true);
    setTimeout(() => {
      setShelf(null);
      setScrollClosing(false);
    }, ANIM_MS);
  }, []);

  const back = useCallback(() => {
    if (selected) closeCard();
    else if (shelf) closeScroll();
  }, [selected, shelf, closeCard, closeScroll]);

  useEffect(() => {
    if (!shelf) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && back();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [shelf, back]);

  const openShelf = (s: Shelf) => {
    setShelf(s);
    setSelected(null);
    // Open the first element with something to do, so the menu never starts empty-looking.
    if (s === 'spell') setExpanded((e) => e ?? 'fire');
  };

  return (
    <div className="room library">
      <svg className="room__svg" viewBox="0 0 1000 800" preserveAspectRatio="xMidYMid meet" role="img" aria-label="The library: a glowing tree surrounded by bookshelves">
        <defs>
          <WizardDefs />
          <linearGradient id="libWall" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#2a1810" />
            <stop offset="1" stopColor="#4a2c1a" />
          </linearGradient>
          <linearGradient id="libFloor" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#5a3820" />
            <stop offset="1" stopColor="#2a1a10" />
          </linearGradient>
          <radialGradient id="canopy" cx="0.5" cy="0.4" r="0.6">
            <stop offset="0" stopColor="#a7f3d0" />
            <stop offset="0.6" stopColor="#34d399" />
            <stop offset="1" stopColor="#047857" />
          </radialGradient>
          <radialGradient id="treeGlow">
            <stop offset="0" stopColor="#6ee7b7" stopOpacity="0.45" />
            <stop offset="1" stopColor="#6ee7b7" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="moonlight" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#1e3a8a" />
            <stop offset="1" stopColor="#0b1033" />
          </linearGradient>
        </defs>

        <rect width={1000} height={580} fill="url(#libWall)" />
        {Array.from({ length: 11 }, (_, i) => (
          <line key={i} x1={i * 100} y1={0} x2={i * 100} y2={580} stroke="#000" strokeOpacity={0.15} strokeWidth={3} />
        ))}
        <rect y={560} width={1000} height={240} fill="url(#libFloor)" />
        <path d="M400 380 V170 Q400 60 500 60 Q600 60 600 170 V380 Z" fill="url(#moonlight)" stroke="#7a5236" strokeWidth={10} />
        <ellipse cx={500} cy={690} rx={330} ry={72} fill="#7f1d1d" opacity={0.55} />
        <ellipse cx={500} cy={690} rx={300} ry={60} fill="none" stroke="#fbbf24" strokeOpacity={0.35} strokeWidth={4} />

        {/* floating candles */}
        {[
          [250, 90],
          [760, 110],
          [340, 60],
          [670, 70],
        ].map(([x, y], i) => (
          <g key={i} className={`float float--candle-${i % 2}`}>
            <rect x={x! - 5} y={y} width={10} height={26} rx={2} fill="#fef3c7" />
            <ellipse cx={x} cy={y! - 6} rx={4} ry={8} fill="#fbbf24" className="flicker" />
          </g>
        ))}

        {/* the tree */}
        <g>
          <circle cx={500} cy={300} r={260} fill="url(#treeGlow)" />
          <path d="M440 640 Q470 600 475 520 Q480 420 460 360 L540 360 Q520 420 525 520 Q530 600 560 640 Z" fill="#6b4423" />
          <path d="M440 640 Q400 650 380 664 M560 640 Q600 650 625 662 M480 640 Q470 660 455 675 M520 640 Q530 662 548 676" stroke="#6b4423" strokeWidth={14} strokeLinecap="round" fill="none" />
          <path d="M480 420 Q430 380 400 330 M520 410 Q570 370 600 320" stroke="#6b4423" strokeWidth={16} strokeLinecap="round" fill="none" />
          <circle cx={500} cy={250} r={120} fill="url(#canopy)" />
          <circle cx={400} cy={300} r={80} fill="url(#canopy)" />
          <circle cx={600} cy={295} r={82} fill="url(#canopy)" />
          <circle cx={460} cy={180} r={70} fill="url(#canopy)" />
          <circle cx={555} cy={185} r={66} fill="url(#canopy)" />
          {[
            [430, 240],
            [560, 230],
            [500, 160],
            [380, 320],
            [620, 310],
            [510, 320],
          ].map(([x, y], i) => (
            <circle key={i} cx={x} cy={y} r={6} fill="#fef08a" className={`twinkle twinkle--${(i % 2) + 1}`} />
          ))}
          {/* book stacks around the base */}
          {[
            [395, 640],
            [610, 645],
            [445, 670],
            [565, 672],
          ].map(([x, y], i) => (
            <g key={i}>
              <rect x={x! - 22} y={y! - 10} width={44} height={10} rx={2} fill="#7c3aed" />
              <rect x={x! - 18} y={y! - 20} width={38} height={10} rx={2} fill="#b91c1c" />
              <rect x={x! - 20} y={y! - 30} width={36} height={10} rx={2} fill="#0f766e" />
            </g>
          ))}
          <circle cx={470} cy={430} r={4} fill="#a7f3d0" className="mote" />
          <circle cx={530} cy={470} r={3} fill="#a7f3d0" className="mote mote--2" />
          <circle cx={500} cy={520} r={3.5} fill="#a7f3d0" className="mote mote--3" />
        </g>

        {/* Spell Scrolls shelf */}
        <Hotspot label="Open the Spell Scrolls" onActivate={() => openShelf('spell')} className="shelf">
          <Bookshelf x={50} tint="#f97316" />
          <SceneLabel x={170} y={135} size={26}>
            Spell Scrolls
          </SceneLabel>
        </Hotspot>

        {/* Mana Scrolls shelf */}
        <Hotspot label="Open the Mana Scrolls" onActivate={() => openShelf('mana')} className="shelf">
          <Bookshelf x={710} tint="#38bdf8" />
          <SceneLabel x={830} y={135} size={26}>
            Mana Scrolls
          </SceneLabel>
        </Hotspot>

        {/* Sealed shelf: unavailable for now */}
        <Hotspot label="Sealed shelf (coming soon)" disabled onActivate={() => toast('🔒 This shelf is sealed. More scrolls are coming soon.')} className="shelf shelf--sealed">
          <g transform="translate(790 640)">
            <rect x={0} y={0} width={150} height={110} rx={8} fill="#3b2416" stroke="#1c1009" strokeWidth={4} />
            <rect x={10} y={12} width={130} height={38} fill="#24150c" />
            <rect x={10} y={58} width={130} height={38} fill="#24150c" />
            <path d="M-4 10 L154 100 M154 10 L-4 100" stroke="#9ca3af" strokeWidth={6} strokeDasharray="10 4" />
            <rect x={60} y={42} width={30} height={26} rx={4} fill="#facc15" stroke="#1f1f1f" strokeWidth={2} />
            <SceneLabel x={75} y={-12} size={20} className="scene-label--muted">
              Sealed
            </SceneLabel>
          </g>
        </Hotspot>

        <g transform="translate(250 735) scale(0.75)">
          <WizardSprite mode="idle" />
        </g>
      </svg>

      {!shelf && (
        <>
          <div className="room__top">
            <button type="button" className="btn btn--ghost back-btn" onClick={(e) => nav.go('island', e.currentTarget)}>
              <span aria-hidden="true">←</span> Island
            </button>
          </div>
          <p className="room__hint">
            {state.xpUnspent > 0 ? `You have ${state.xpUnspent} XP to invest. Pick a shelf.` : 'Pick a shelf to browse your spells. Study in the Laboratory to earn XP.'}
          </p>
        </>
      )}

      {shelf && (
        <div className="scroll-layer" onClick={(e) => e.target === e.currentTarget && back()}>
          <div className={`scroll${scrollClosing ? ' scroll--closing' : ''}`} role="dialog" aria-modal="true" aria-labelledby="scroll-title">
            <div className="scroll__roller" aria-hidden="true" />
            <div className="scroll__paper">
              {selected ? (
                <SpellCard id={selected} onBack={closeCard} closing={cardClosing} />
              ) : (
                <div className="scroll__menu">
                  <div className="scroll__head">
                    <button type="button" className="btn btn--ghost back-btn" onClick={closeScroll}>
                      <span aria-hidden="true">←</span> Back
                    </button>
                    <h2 id="scroll-title" className="scroll__title">
                      {shelf === 'spell' ? 'Spell Scrolls' : 'Mana Scrolls'}
                    </h2>
                    <span className="chip chip--xp">
                      <span aria-hidden="true">✨</span> {state.xpUnspent}
                    </span>
                  </div>

                  {shelf === 'spell' ? (
                    <ul className="element-list">
                      {ELEMENTS.map((el) => {
                        const open = expanded === el.id;
                        return (
                          <li key={el.id} className={`element${el.available ? '' : ' element--sealed'}`} style={{ ['--el' as string]: el.color }}>
                            <button
                              type="button"
                              className="element__head"
                              aria-expanded={el.available ? open : undefined}
                              aria-disabled={!el.available || undefined}
                              onClick={() => (el.available ? setExpanded(open ? null : el.id) : toast(`🔒 ${el.name} magic is sealed for now. Coming soon!`))}
                            >
                              <span className="element__icon" aria-hidden="true">
                                {el.icon}
                              </span>
                              <span className="element__name">{el.name}</span>
                              <span className="element__meta">{el.available ? learnedSummary(state, spellsFor(el.id)) : '🔒 Sealed'}</span>
                              {el.available && (
                                <span className={`element__chev${open ? ' element__chev--open' : ''}`} aria-hidden="true">
                                  ▾
                                </span>
                              )}
                            </button>
                            {el.available && open && (
                              <ul className="upgrade-list">
                                {spellsFor(el.id).map((u) => (
                                  <UpgradeRow key={u.id} def={u} state={state} onOpen={() => setSelected(u.id)} />
                                ))}
                              </ul>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  ) : (
                    <ul className="upgrade-list upgrade-list--flat">
                      {MANA_UPGRADES.map((u) => (
                        <UpgradeRow key={u.id} def={u} state={state} onOpen={() => setSelected(u.id)} />
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
            <div className="scroll__roller" aria-hidden="true" />
          </div>
        </div>
      )}
    </div>
  );
}

function learnedSummary(state: GameState, defs: UpgradeDef[]): string {
  const learned = defs.filter((d) => upgradeState(state, d.id).level > 0).length;
  return `${learned}/${defs.length} learned`;
}

function UpgradeRow({ def, state, onOpen }: { def: UpgradeDef; state: GameState; onOpen: () => void }) {
  const cur = upgradeState(state, def.id);
  const locked = def.requires ? upgradeState(state, def.requires).level < 1 : false;
  const maxed = cur.level >= MAX_UPGRADE_LEVEL;
  const cost = maxed ? 1 : upgradeCost(def, cur.level);
  return (
    <li>
      <button type="button" className={`upgrade${locked ? ' upgrade--locked' : ''}`} onClick={onOpen}>
        <span className="upgrade__icon" aria-hidden="true">
          {locked ? '🔒' : def.icon}
        </span>
        <span className="upgrade__body">
          <span className="upgrade__name">{def.name}</span>
          <span className="upgrade__sub">
            {locked ? `Learn ${getUpgrade(def.requires!)?.name} first` : maxed ? 'Mastered' : cur.level === 0 ? 'Not learned' : `Level ${cur.level}`}
          </span>
          {!locked && <Bar value={maxed ? 1 : cur.progress} max={cost} className="bar--spell bar--thin" label={`${def.name} progress`} />}
        </span>
        <span className="upgrade__lvl">{cur.level > 0 ? `Lv ${cur.level}` : ''}</span>
      </button>
    </li>
  );
}

function Bookshelf({ x, tint }: { x: number; tint: string }) {
  const books = ['#7c3aed', '#b91c1c', '#0f766e', '#a16207', '#1d4ed8', '#be185d'];
  return (
    <g transform={`translate(${x} 150)`}>
      <rect x={0} y={0} width={240} height={460} rx={8} fill="#3b2416" stroke="#1c1009" strokeWidth={6} />
      {[0, 1, 2, 3].map((row) => {
        const y = 20 + row * 110;
        return (
          <g key={row}>
            <rect x={12} y={y} width={216} height={92} fill="#24150c" />
            {row % 2 === 0
              ? Array.from({ length: 9 }, (_, i) => (
                  <rect key={i} x={18 + i * 23} y={y + 18 + (i % 3) * 4} width={19} height={74 - (i % 3) * 4} rx={2} fill={books[(i + row) % books.length]} />
                ))
              : [0, 1, 2].map((i) => (
                  <g key={i}>
                    <rect x={28 + i * 66} y={y + 50} width={54} height={36} rx={18} fill="#f5e6c8" />
                    <rect x={50 + i * 66} y={y + 50} width={10} height={36} fill={tint} />
                  </g>
                ))}
            <rect x={6} y={y + 92} width={228} height={10} fill="#5a3820" />
          </g>
        );
      })}
    </g>
  );
}
