// Mock soundtrack: a dark, slow synth loop generated in the browser with
// WebAudio - no files, no licenses. When a licensed track is bought later,
// replace this module with an <audio> element behind the same start/stop API.

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let timer: number | null = null;

const BPM = 88;
const STEP = 60 / BPM / 4; // 16th note
// A harmonic-minor city: two 8-bar halves that alternate forever.
const BASS = [45, 45, 48, 45, 43, 43, 41, 43]; // A2 A2 C3 A2 G2 G2 F2 G2 (midi)
const ARP = [69, 72, 76, 72, 69, 76, 74, 72, 69, 72, 77, 76, 74, 72, 71, 72];

function midi(n: number): number {
  return 440 * Math.pow(2, (n - 69) / 12);
}

function note(t: number, freq: number, dur: number, type: OscillatorType,
              gain: number, dest: AudioNode) {
  if (!ctx) return;
  const osc = ctx.createOscillator();
  const env = ctx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  env.gain.setValueAtTime(0, t);
  env.gain.linearRampToValueAtTime(gain, t + 0.01);
  env.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(env).connect(dest);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

function noiseHit(t: number, dur: number, gain: number, freq: number, dest: AudioNode) {
  if (!ctx) return;
  const len = Math.ceil(ctx.sampleRate * dur);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filter = ctx.createBiquadFilter();
  filter.type = "bandpass";
  filter.frequency.value = freq;
  const env = ctx.createGain();
  env.gain.value = gain;
  src.connect(filter).connect(env).connect(dest);
  src.start(t);
}

let nextStep = 0;
let stepIx = 0;

function schedule() {
  if (!ctx || !master) return;
  const echo = master; // arp shares the master; keep it simple
  while (nextStep < ctx.currentTime + 0.4) {
    const t = nextStep;
    const beat = Math.floor(stepIx / 4) % 8;
    const sixteenth = stepIx % 16;
    if (stepIx % 4 === 0) {
      note(t, midi(BASS[beat] - 12), STEP * 4.2, "sawtooth", 0.16, master);
      note(t, midi(BASS[beat]), STEP * 3.5, "triangle", 0.12, master);
    }
    if (stepIx % 2 === 0) {
      const arpNote = ARP[(sixteenth / 2 + Math.floor(stepIx / 32)) % ARP.length | 0];
      note(t, midi(arpNote), STEP * 1.6, "square", 0.028, echo);
    }
    if (stepIx % 8 === 4) noiseHit(t, 0.14, 0.20, 1800, master);  // snare-ish
    if (stepIx % 4 === 2) noiseHit(t, 0.03, 0.10, 7000, master);  // hat tick
    if (stepIx % 64 === 0) noiseHit(t, 1.2, 0.05, 300, master);   // distant rumble
    nextStep += STEP;
    stepIx += 1;
  }
}

export function musicPlaying(): boolean {
  return timer !== null;
}

export async function startMusic(): Promise<void> {
  if (timer !== null) return;
  if (!ctx) {
    ctx = new AudioContext();
    master = ctx.createGain();
    master.gain.value = 0.5;
    const comp = ctx.createDynamicsCompressor();
    master.connect(comp).connect(ctx.destination);
  }
  await ctx.resume();
  nextStep = ctx.currentTime + 0.05;
  timer = window.setInterval(schedule, 120);
  localStorage.setItem("cero-music", "on");
}

export function stopMusic(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
  ctx?.suspend();
  localStorage.setItem("cero-music", "off");
}

export function musicPreferred(): boolean {
  return localStorage.getItem("cero-music") === "on";
}
