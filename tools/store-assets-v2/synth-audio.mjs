/**
 * Pure Node.js studio audio synthesizer for SwiftSelect v2 Promo Video (26.0s).
 * Generates a warm, refined Apple-keynote-style harmonic glass pad + soft rhythmic
 * pluck + timed tactile UI foley (shutter click, magnetic snap, markup pops, finish chime).
 * Output: 44.1 kHz, 16-bit stereo PCM WAV.
 */
import fs from "node:fs";
import path from "node:path";

const SR = 44100;
const DURATION = 26.0;
const SAMPLES = Math.floor(SR * DURATION);
const left = new Float32Array(SAMPLES);
const right = new Float32Array(SAMPLES);

function addTone(tStart, dur, freq, amp, pan = 0, attack = 0.01, harmonic = 0.25) {
  const i0 = Math.max(0, Math.floor(tStart * SR));
  const i1 = Math.min(SAMPLES, Math.floor((tStart + dur) * SR));
  const lGain = amp * Math.cos(((pan + 1) * Math.PI) / 4);
  const rGain = amp * Math.sin(((pan + 1) * Math.PI) / 4);
  for (let i = i0; i < i1; i++) {
    const lt = (i - i0) / SR;
    const env =
      (lt < attack ? lt / attack : 1) *
      Math.exp((-lt / Math.max(0.05, dur)) * 3.6);
    const wave =
      Math.sin(2 * Math.PI * freq * lt) +
      harmonic * Math.sin(2 * Math.PI * freq * 2 * lt) * Math.exp(-lt * 6);
    left[i] += wave * env * lGain;
    right[i] += wave * env * rGain;
  }
}

function addShutterClick(tStart) {
  const i0 = Math.floor(tStart * SR);
  const len = Math.floor(0.055 * SR);
  let seed = 1337;
  for (let k = 0; k < len && i0 + k < SAMPLES; k++) {
    seed = (seed * 16807) % 2147483647;
    const noise = (seed / 2147483647) * 2 - 1;
    const lt = k / SR;
    const env = Math.exp(-lt * 95);
    const click = (noise * 0.45 + Math.sin(2 * Math.PI * 1900 * lt) * 0.55) * env * 0.22;
    left[i0 + k] += click;
    right[i0 + k] += click;
  }
  addTone(tStart + 0.04, 0.35, 880, 0.08, 0.15, 0.005, 0.35);
  addTone(tStart + 0.09, 0.45, 1318.5, 0.07, -0.15, 0.005, 0.3);
}

// 1. Warm evolving harmonic glass pad (Cmaj9 -> Am9 -> Fmaj9 -> G6 -> Cmaj9)
const chords = [
  { t: 0.0, d: 4.5, notes: [130.81, 196.0, 246.94, 293.66, 329.63] },
  { t: 4.2, d: 5.0, notes: [110.0, 164.81, 220.0, 261.63, 329.63] },
  { t: 9.0, d: 5.0, notes: [174.61, 220.0, 261.63, 329.63, 392.0] },
  { t: 13.8, d: 4.8, notes: [196.0, 246.94, 293.66, 329.63, 440.0] },
  { t: 18.2, d: 4.6, notes: [174.61, 220.0, 261.63, 329.63, 392.0] },
  { t: 22.2, d: 3.8, notes: [130.81, 196.0, 261.63, 329.63, 523.25] },
];

for (const ch of chords) {
  ch.notes.forEach((f, idx) => {
    const pan = (idx / (ch.notes.length - 1)) * 0.7 - 0.35;
    addTone(ch.t, ch.d, f, 0.042, pan, 0.55, 0.14);
  });
}

// 2. Subtle crystalline pulse arp (every 0.5s, super clean & restrained)
const arpNotes = [523.25, 659.25, 783.99, 987.77, 783.99, 659.25, 587.33, 659.25];
for (let step = 0; step < 48; step++) {
  const t = 0.4 + step * 0.5;
  if (t > 24.4) break;
  const f = arpNotes[step % arpNotes.length];
  const pan = step % 2 === 0 ? -0.35 : 0.35;
  addTone(t, 0.42, f, 0.032, pan, 0.006, 0.18);
}

// 3. Timed UI Foley aligned to video scenes
addTone(0.25, 0.9, 523.25, 0.07, 0, 0.02, 0.2);      // Opening chime
addShutterClick(7.0);                                 // Scene 2 shutter capture & toast
addTone(9.9, 0.32, 698.46, 0.08, -0.2, 0.005, 0.25);  // Scene 3 Ctrl-Snap magnetic lock
addTone(11.0, 0.42, 880.0, 0.07, 0.2, 0.008, 0.22);   // Scene 3 Liquid Glass dock unfold
addTone(14.5, 0.22, 659.25, 0.06, -0.2, 0.005, 0.2);  // Scene 4 rect draw
addTone(15.2, 0.22, 783.99, 0.06, 0.2, 0.005, 0.2);   // Scene 4 step 1 pop
addTone(15.7, 0.22, 880.0, 0.06, 0.25, 0.005, 0.2);   // Scene 4 step 2 pop
addTone(16.4, 0.28, 587.33, 0.055, 0.0, 0.008, 0.15); // Scene 4 blur redact
addTone(19.5, 0.55, 523.25, 0.07, -0.15, 0.01, 0.25); // Scene 5 compression sweep
addTone(20.1, 0.65, 783.99, 0.075, 0.15, 0.01, 0.25);
addTone(22.5, 2.2, 523.25, 0.08, -0.1, 0.04, 0.2);    // Scene 6 warm closing resolution
addTone(22.7, 2.4, 783.99, 0.07, 0.1, 0.04, 0.18);
addTone(22.9, 2.6, 1046.5, 0.06, 0.0, 0.06, 0.15);

// Master fade in/out & soft limiter
const outBuf = Buffer.alloc(44 + SAMPLES * 4);
outBuf.write("RIFF", 0);
outBuf.writeUInt32LE(36 + SAMPLES * 4, 4);
outBuf.write("WAVE", 8);
outBuf.write("fmt ", 12);
outBuf.writeUInt32LE(16, 16);
outBuf.writeUInt16LE(1, 20);
outBuf.writeUInt16LE(2, 22);
outBuf.writeUInt32LE(SR, 24);
outBuf.writeUInt32LE(SR * 4, 28);
outBuf.writeUInt16LE(4, 32);
outBuf.writeUInt16LE(16, 34);
outBuf.write("data", 36);
outBuf.writeUInt32LE(SAMPLES * 4, 40);

for (let i = 0; i < SAMPLES; i++) {
  const t = i / SR;
  const fade = Math.min(1, t / 0.35) * Math.min(1, (DURATION - t) / 1.1);
  const l = Math.tanh(left[i] * fade * 1.4);
  const r = Math.tanh(right[i] * fade * 1.4);
  outBuf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(l * 32767))), 44 + i * 4);
  outBuf.writeInt16LE(Math.max(-32767, Math.min(32767, Math.round(r * 32767))), 44 + i * 4 + 2);
}

const outPath = path.resolve("tools/store-assets-v2/raw/promo-audio.wav");
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, outBuf);
console.log("Synthesized audio:", outPath, `${(outBuf.length / 1024).toFixed(0)} KB`);
