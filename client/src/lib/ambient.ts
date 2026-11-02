/**
 * Optional ambient "study hall" sound for focus mode: softly filtered brown noise
 * generated with Web Audio, so there is no audio file to download. Off by default.
 */
let ctx: AudioContext | null = null;
let source: AudioBufferSourceNode | null = null;
let gain: GainNode | null = null;

export function startAmbient(volume = 0.25): void {
  if (source) return;
  ctx ??= new AudioContext();
  const length = ctx.sampleRate * 4;
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    data[i] = last * 3.5;
  }
  source = ctx.createBufferSource();
  source.buffer = buffer;
  source.loop = true;
  const filter = ctx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 900;
  gain = ctx.createGain();
  gain.gain.value = volume;
  source.connect(filter).connect(gain).connect(ctx.destination);
  void ctx.resume();
  source.start();
}

export function stopAmbient(): void {
  source?.stop();
  source?.disconnect();
  source = null;
  gain = null;
}

export const isAmbientPlaying = () => source !== null;
