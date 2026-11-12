import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Hud } from './components/Hud';
import { NamePrompt } from './components/NamePrompt';
import { primeAudio } from './game/sound';
import { useGame } from './game/store';
import { IslandScene } from './scenes/IslandScene';
import { LabScene } from './scenes/LabScene';
import { LibraryScene } from './scenes/LibraryScene';
import type { Nav, SceneId } from './scenes/nav';
import { ProfileScene } from './scenes/ProfileScene';

type Phase = 'idle' | 'out' | 'in';
const TRANSITION_MS = 450;

/**
 * Scene director. Scenes swap with a camera zoom towards whatever was clicked
 * (zooming into a building) or back out again (returning to the island).
 */
export function App() {
  const { state, dispatch } = useGame();
  // Mid-session (or with unclaimed rewards) the game reopens straight into the lab.
  const [scene, setScene] = useState<SceneId>(() => (state.activeSession || state.pendingResult ? 'lab' : 'title'));
  const [phase, setPhase] = useState<Phase>('idle');
  const [direction, setDirection] = useState<'in' | 'out'>('in');
  const [origin, setOrigin] = useState({ x: 50, y: 50 });
  const [askName, setAskName] = useState(false);
  const returnTo = useRef<SceneId>('island');
  const busy = useRef(false);

  const go = useCallback(
    (to: SceneId, from?: Element | null) => {
      if (busy.current || to === scene) return;
      const islandish = (s: SceneId) => s === 'title' || s === 'island';
      if (to === 'profile') returnTo.current = scene === 'title' ? 'island' : scene;

      // Title <-> island is the same scene; the island camera animates on its own.
      if (islandish(scene) && islandish(to)) {
        setScene(to);
        return;
      }

      if (from) {
        const r = from.getBoundingClientRect();
        setOrigin({ x: ((r.left + r.width / 2) / window.innerWidth) * 100, y: ((r.top + r.height / 2) / window.innerHeight) * 100 });
      } else {
        setOrigin({ x: 50, y: 50 });
      }
      const goingDeeper = islandish(scene) && !islandish(to);
      setDirection(goingDeeper || to === 'profile' ? 'in' : 'out');
      busy.current = true;
      setPhase('out');
      setTimeout(() => {
        setScene(to);
        setPhase('in');
        setTimeout(() => {
          setPhase('idle');
          busy.current = false;
        }, TRANSITION_MS);
      }, TRANSITION_MS);
    },
    [scene],
  );

  const nav: Nav = useMemo(() => ({ go, back: () => go(returnTo.current) }), [go]);

  // If a session is running, always show the lab (e.g. another tab started one).
  useEffect(() => {
    if ((state.activeSession || state.pendingResult) && scene !== 'lab' && phase === 'idle') setScene('lab');
  }, [state.activeSession, state.pendingResult, scene, phase]);

  const tapTitle = () => {
    primeAudio();
    if (!state.name) setAskName(true);
    else go('island');
  };

  const focusMode = scene === 'lab' && (state.activeSession !== null || (state.pendingResult?.completed ?? false));
  const showHud = scene !== 'title' && scene !== 'profile' && !focusMode;

  return (
    <div className="app">
      {showHud && <Hud onProfile={() => go('profile')} />}
      <main
        className={`stage stage--${phase} stage--dir-${direction}`}
        style={{ ['--ox' as string]: `${origin.x}%`, ['--oy' as string]: `${origin.y}%` }}
        aria-busy={phase !== 'idle'}
      >
        {(scene === 'title' || scene === 'island') && <IslandScene zoomed={scene === 'island'} onTapTitle={tapTitle} nav={nav} />}
        {scene === 'lab' && <LabScene nav={nav} />}
        {scene === 'library' && <LibraryScene nav={nav} />}
        {scene === 'profile' && <ProfileScene nav={nav} />}
      </main>

      {askName && (
        <NamePrompt
          onSubmit={(name) => {
            dispatch({ type: 'setName', name });
            setAskName(false);
            go('island');
          }}
        />
      )}
    </div>
  );
}
