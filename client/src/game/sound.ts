/** Tiny synthesized chimes, so the game needs no audio files. */
let ctx: AudioContext | null = null;

function audio(): AudioContext | null {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
    return ctx;
  } catch {
    return null;
  }
}

function tone(ac: AudioContext, freq: number, start: number, length: number, gain = 0.12) {
  const osc = ac.createOscillator();
  const g = ac.createGain();
  osc.type = 'sine';
  osc.frequency.value = freq;
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(gain, start + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, start + length);
  osc.connect(g).connect(ac.destination);
  osc.start(start);
  osc.stop(start + length + 0.05);
}

/** Played when a study session finishes. */
export function playComplete() {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime;
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => tone(ac, f, t + i * 0.12, 0.9));
}

/** Played when a break ends. */
export function playBreakOver() {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime;
  [783.99, 659.25].forEach((f, i) => tone(ac, f, t + i * 0.18, 0.7));
}

/** Soft click for investing XP. */
export function playInvest(levelUp: boolean) {
  const ac = audio();
  if (!ac) return;
  const t = ac.currentTime;
  if (levelUp) [659.25, 987.77, 1318.5].forEach((f, i) => tone(ac, f, t + i * 0.08, 0.5, 0.1));
  else tone(ac, 880, t, 0.15, 0.06);
}

/** Unlocks audio on the first user gesture (browsers block it before that). */
export function primeAudio() {
  audio();
}
