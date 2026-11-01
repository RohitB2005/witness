// An original, quiet ambient bed for the demo video, synthesised here (no samples, no licences):
// a warm pad, a soft FM electric piano picking sparse arpeggios and a sine bass over a slow
// four-chord loop, arranged to land on the last chord at the end. build.mjs adds reverb (ffmpeg afir
// with the impulse response written here), filters it and sets a quiet level. Seeded, so every
// build gives the same track.
import { Buffer } from "node:buffer";
import { writeFileSync } from "node:fs";

const RATE = 48_000;
const BEAT = 0.8; // 75 BPM
const CHORD = 8 * BEAT; // two bars per chord

// Fmaj7 → Em7 → Dm9 → Cmaj9 (MIDI notes), with their bass roots.
const CHORDS = [
  { pad: [53, 57, 60, 64], bass: 41 },
  { pad: [52, 55, 59, 62], bass: 40 },
  { pad: [50, 53, 57, 60, 64], bass: 38 },
  { pad: [48, 52, 55, 59, 62], bass: 36 },
];
// Electric-piano pattern: [eighth-note slot in the chord, chord-tone index], an octave up.
const PATTERN = [
  [0, 0],
  [3, 2],
  [6, 1],
  [8, 3],
  [11, 2],
  [13, 4],
];

const freq = (m) => 440 * 2 ** ((m - 69) / 12);
const smooth = (x) => (x <= 0 ? 0 : x >= 1 ? 1 : x * x * (3 - 2 * x));

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function wav(file, L, R) {
  const n = L.length;
  const buf = Buffer.alloc(44 + n * 4);
  buf.write("RIFF", 0);
  buf.writeUInt32LE(36 + n * 4, 4);
  buf.write("WAVEfmt ", 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(RATE, 24);
  buf.writeUInt32LE(RATE * 4, 28);
  buf.writeUInt16LE(4, 32);
  buf.writeUInt16LE(16, 34);
  buf.write("data", 36);
  buf.writeUInt32LE(n * 4, 40);
  let peak = 1e-9;
  for (let i = 0; i < n; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
  const g = 0.7 / peak;
  for (let i = 0; i < n; i++) {
    buf.writeInt16LE(Math.round(Math.tanh(L[i] * g) * 32000), 44 + i * 4);
    buf.writeInt16LE(Math.round(Math.tanh(R[i] * g) * 32000), 46 + i * 4);
  }
  writeFileSync(file, buf);
}

/** Writes the dry track (`seconds` long) to `file`. */
export function writeAmbient(file, seconds, seed = 7) {
  const n = Math.ceil(seconds * RATE);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const rand = rng(seed);
  const count = Math.ceil(seconds / CHORD);
  const offset = (((3 - (count - 1)) % 4) + 4) % 4; // end on Cmaj9

  for (let c = 0; c < count; c++) {
    const chord = CHORDS[(c + offset) % 4];
    const t0 = c * CHORD;
    const last = c === count - 1;
    const start = Math.max(0, t0 - 0.8);
    const end = last ? seconds : t0 + CHORD + 2.5;

    // Pad: soft triangle-like tones, detuned left and right, breathing slowly.
    for (const m of chord.pad) {
      const f = freq(m);
      for (let i = Math.floor(start * RATE); i < Math.min(n, end * RATE); i++) {
        const t = i / RATE;
        const env =
          smooth((t - start) / 2.2) * (last ? 1 : 1 - smooth((t - (t0 + CHORD)) / 2.5)) * 0.035;
        if (env <= 0) continue;
        const breathe = 0.65 + 0.35 * Math.sin(2 * Math.PI * 0.07 * t + m);
        let l = 0;
        let r = 0;
        for (let k = 1; k <= 5; k++) {
          const a = (k === 1 ? 1 : breathe) / k ** 1.8;
          l += a * Math.sin(2 * Math.PI * f * k * 0.99712 * t);
          r += a * Math.sin(2 * Math.PI * f * k * 1.00289 * t);
        }
        L[i] += l * env;
        R[i] += r * env;
      }
    }
    if (c === 0) continue; // the title card: pad only

    // Bass: a sine with a little second harmonic.
    const fb = freq(chord.bass);
    for (let i = Math.floor(t0 * RATE); i < Math.min(n, (t0 + CHORD + 1) * RATE); i++) {
      const t = i / RATE - t0;
      const env = smooth(t / 0.4) * (1 - smooth((t - CHORD + 0.2) / 1)) * 0.11;
      const v = env * (Math.sin(2 * Math.PI * fb * t) + 0.25 * Math.sin(4 * Math.PI * fb * t));
      L[i] += v;
      R[i] += v;
    }

    // Electric piano: two-operator FM, quick bright attack mellowing as it decays.
    const tones = [...chord.pad].sort((a, b) => a - b).map((m) => m + 12);
    const notes = last
      ? [
          [0, tones[0], 0.6],
          [0.05, tones[2], 0.5],
        ]
      : PATTERN.filter(() => rand() > 0.15).map(([slot, idx]) => [
          slot * (BEAT / 2) + (rand() - 0.5) * 0.02,
          tones[idx % tones.length],
          0.55 + rand() * 0.25,
        ]);
    notes.forEach(([at, m, vel], j) => {
      const f = freq(m);
      const pan = j % 2 ? 0.25 : -0.25;
      const s0 = Math.floor((t0 + at) * RATE);
      for (let i = s0; i < Math.min(n, s0 + 4 * RATE); i++) {
        const t = (i - s0) / RATE;
        const index = vel * (1.6 * Math.exp(-t / 0.25) + 0.3);
        const env = (1 - Math.exp(-t / 0.004)) * Math.exp(-t / 1.4) * vel * 0.09;
        const v =
          env *
          Math.sin(2 * Math.PI * f * t + index * Math.sin(2 * Math.PI * f * t)) *
          (1 + 0.1 * Math.sin(2 * Math.PI * 4.5 * t));
        L[i] += v * (1 - pan);
        R[i] += v * (1 + pan);
      }
    });
  }
  wav(file, L, R);
}

/** Writes a stereo reverb impulse response: a short pre-delay, then a darkening, decaying noise tail. */
export function writeImpulse(file, seconds = 2.8, seed = 3) {
  const n = Math.ceil(seconds * RATE);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  const rand = rng(seed);
  const pre = Math.floor(0.025 * RATE);
  let yl = 0;
  let yr = 0;
  for (let i = pre; i < n; i++) {
    const t = (i - pre) / RATE;
    const a = 0.5 * Math.exp(-t / 0.6) + 0.06; // the tail gets darker
    yl += a * (rand() * 2 - 1 - yl);
    yr += a * (rand() * 2 - 1 - yr);
    const env = Math.exp(-t / 0.65) * (1 - Math.exp(-t / 0.01));
    L[i] = yl * env;
    R[i] = yr * env;
  }
  wav(file, L, R);
}
