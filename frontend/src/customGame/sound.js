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

// `new AudioContext()` is measurably slow the first time a page creates one
// (200-300ms+ to negotiate with the OS audio backend, even though every
// call after that is instant) - calling this once, early, while the game
// screen is mounting but before the player has had a chance to actually
// make a move, pays that cost somewhere it's invisible instead of having it
// silently eat into the very first move's optimistic-update latency (the
// "moving a piece isn't instant" bug this fixes: the piece's own state
// update was already scheduled, but sat blocked behind a synchronous
// playMoveSound() call cold-constructing this exact context).
export function warmUpAudio() {
  getContext();
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

// A short downward pitch sweep - deliberately NOT playClick's percussive
// texture, so stepping backward through move history reads as distinct
// from an actual move landing (playMoveSound), matching how chess.com-style
// move-history scrubbing sounds different from playing a real move.
export function playRewindSound() {
  playSweep({ from: 520, to: 260, duration: 0.09, gain: 0.22 });
}

// The forward-navigation counterpart to playRewindSound - same texture, an
// upward sweep instead of downward, so back/forward read as opposite
// actions rather than identical clicks.
export function playForwardSound() {
  playSweep({ from: 260, to: 520, duration: 0.09, gain: 0.22 });
}

function playSweep({ from, to, duration, gain }) {
  const ctx = getContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(from, now);
    osc.frequency.exponentialRampToValueAtTime(to, now + duration);
    const gainNode = ctx.createGain();
    gainNode.gain.setValueAtTime(gain, now);
    gainNode.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(gainNode).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration);
  } catch {
    // Sound is a nice-to-have, never worth breaking navigation over.
  }
}

// A sharp double-blip - urgent but brief, distinct from a normal move so a
// check registers as "something just happened" without being alarming.
export function playCheckSound() {
  const ctx = getContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    [0, 0.09].forEach((delay) => {
      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.setValueAtTime(740, now + delay);
      const gainNode = ctx.createGain();
      gainNode.gain.setValueAtTime(0.18, now + delay);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + delay + 0.07);
      osc.connect(gainNode).connect(ctx.destination);
      osc.start(now + delay);
      osc.stop(now + delay + 0.07);
    });
  } catch {
    // Sound is a nice-to-have, never worth breaking gameplay over.
  }
}

// A longer, descending three-note cue - deliberately more dramatic/final
// than playCheckSound, so a checkmate is unmistakably "the game just ended"
// rather than just another check.
export function playCheckmateSound() {
  const ctx = getContext();
  if (!ctx) return;
  try {
    const now = ctx.currentTime;
    const notes = [520, 390, 260];
    notes.forEach((freq, i) => {
      const delay = i * 0.14;
      const duration = 0.22;
      const osc = ctx.createOscillator();
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(freq, now + delay);
      const filter = ctx.createBiquadFilter();
      filter.type = "lowpass";
      filter.frequency.value = 1200;
      const gainNode = ctx.createGain();
      gainNode.gain.setValueAtTime(0.16, now + delay);
      gainNode.gain.exponentialRampToValueAtTime(0.001, now + delay + duration);
      osc.connect(filter).connect(gainNode).connect(ctx.destination);
      osc.start(now + delay);
      osc.stop(now + delay + duration);
    });
  } catch {
    // Sound is a nice-to-have, never worth breaking gameplay over.
  }
}
