// Short, synthesized UI sounds (Web Audio API) - deliberately not external
// audio files, so there's nothing to source, license, or bundle. A single
// lazily-created AudioContext is reused for the life of the tab; browsers
// require a user gesture before audio can actually play, which every call
// site here already has (a drag-drop, a keypress, a click).
let audioCtx = null;

function getContext() {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) audioCtx = new Ctx();
  if (audioCtx.state === "suspended") audioCtx.resume().catch(() => {});
  return audioCtx;
}

// A short percussive "click"/"knock" - a burst of bandpass-filtered noise
// (the actual percussive texture) layered with a quick pitched triangle
// tone (a bit of "body" so it doesn't sound like pure static). Never lets
// a synthesis failure interrupt gameplay.
function playClick({ freq, duration, noiseAmount, gain }) {
  const ctx = getContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;

    const bufferSize = Math.max(1, Math.floor(ctx.sampleRate * duration));
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize);
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const noiseFilter = ctx.createBiquadFilter();
    noiseFilter.type = "bandpass";
    noiseFilter.frequency.value = freq;
    noiseFilter.Q.value = 1.2;
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(gain * noiseAmount, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    noise.connect(noiseFilter).connect(noiseGain).connect(ctx.destination);

    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.setValueAtTime(freq * 0.6, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq * 0.3), now + duration);
    const oscGain = ctx.createGain();
    oscGain.gain.setValueAtTime(gain * (1 - noiseAmount), now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(oscGain).connect(ctx.destination);

    noise.start(now);
    noise.stop(now + duration);
    osc.start(now);
    osc.stop(now + duration);
  } catch {
    // Sound is a nice-to-have, never worth breaking a move over.
  }
}

export function playMoveSound() {
  playClick({ freq: 850, duration: 0.05, noiseAmount: 0.55, gain: 0.3 });
}

export function playCaptureSound() {
  playClick({ freq: 500, duration: 0.075, noiseAmount: 0.6, gain: 0.32 });
}

export function playHopSound() {
  playClick({ freq: 320, duration: 0.06, noiseAmount: 0.7, gain: 0.2 });
}
