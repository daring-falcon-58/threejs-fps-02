// Procedural sound: every effect is synthesised with WebAudio, so the game ships no
// audio files and makes no network request. Sounds are short, pooled by design: one
// AudioContext, one master gain, and small helper envelopes.
export function createAudio() {
  let context = null;
  let master = null;
  let muted = false;

  function ensure() {
    if (context) return true;
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      context = new AC();
      master = context.createGain();
      master.gain.value = 0.5;
      master.connect(context.destination);
    } catch {
      return false;
    }
    return true;
  }

  function resume() {
    if (ensure() && context.state === 'suspended') context.resume();
  }

  // A filtered noise burst: the body of a gunshot, a footstep, an explosion.
  function noiseBurst(duration, filterFreq, filterQ, gainValue, when = 0) {
    if (!ensure()) return;
    const t = context.currentTime + when;
    const length = Math.max(1, Math.floor(context.sampleRate * duration));
    const buffer = context.createBuffer(1, length, context.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const source = context.createBufferSource();
    source.buffer = buffer;
    const filter = context.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = filterFreq;
    filter.Q.value = filterQ;
    const gain = context.createGain();
    gain.gain.setValueAtTime(gainValue, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    source.connect(filter).connect(gain).connect(master);
    source.start(t);
    source.stop(t + duration);
  }

  // A short oscillator blip: clicks, beeps, ticks, stingers.
  function blip(freq, duration, gainValue, type = 'sine', when = 0, slideTo = 0) {
    if (!ensure()) return;
    const t = context.currentTime + when;
    const osc = context.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + duration);
    const gain = context.createGain();
    gain.gain.setValueAtTime(gainValue, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);
    osc.connect(gain).connect(master);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  const SHOTS = {
    rifle: { noise: 0.11, freq: 1500, q: 0.8, gain: 0.5, thump: 140 },
    smg: { noise: 0.08, freq: 1900, q: 0.9, gain: 0.4, thump: 170 },
    pistol: { noise: 0.09, freq: 1300, q: 0.8, gain: 0.42, thump: 150 },
    dmr: { noise: 0.22, freq: 900, q: 0.6, gain: 0.62, thump: 90 },
  };

  return {
    unlock() {
      resume();
    },
    toggleMute() {
      muted = !muted;
      if (master) master.gain.value = muted ? 0 : 0.5;
      return muted;
    },
    shot(kind, distant = false) {
      const s = SHOTS[kind] || SHOTS.rifle;
      const g = distant ? s.gain * 0.35 : s.gain;
      noiseBurst(s.noise, s.freq, s.q, g);
      blip(s.thump, 0.09, g * 0.7, 'sine', 0, 55);
    },
    dryFire() {
      blip(2200, 0.03, 0.12, 'square');
    },
    reload() {
      blip(900, 0.05, 0.16, 'square');
      blip(600, 0.05, 0.16, 'square', 0.22);
      blip(1200, 0.04, 0.14, 'square', 0.55);
    },
    hit() {
      blip(2400, 0.05, 0.2, 'sine');
    },
    kill() {
      blip(1800, 0.07, 0.22, 'sine');
      blip(2700, 0.09, 0.2, 'sine', 0.07);
    },
    hurt() {
      noiseBurst(0.12, 300, 1, 0.3);
      blip(110, 0.14, 0.3, 'sawtooth', 0, 70);
    },
    step() {
      noiseBurst(0.05, 420, 1, 0.07);
    },
    beep(final = false) {
      blip(final ? 1500 : 1050, 0.09, 0.25, 'square');
    },
    plant() {
      blip(700, 0.08, 0.2, 'square');
      blip(1050, 0.08, 0.2, 'square', 0.12);
    },
    explode() {
      noiseBurst(0.7, 220, 0.5, 0.9);
      blip(70, 0.6, 0.7, 'sine', 0, 32);
    },
    roundWin() {
      blip(523, 0.14, 0.25, 'triangle');
      blip(659, 0.14, 0.25, 'triangle', 0.13);
      blip(784, 0.22, 0.28, 'triangle', 0.26);
    },
    roundLose() {
      blip(392, 0.16, 0.25, 'triangle');
      blip(330, 0.16, 0.25, 'triangle', 0.15);
      blip(262, 0.3, 0.28, 'triangle', 0.3);
    },
    buy() {
      blip(1400, 0.05, 0.18, 'square');
    },
    denied() {
      blip(220, 0.12, 0.2, 'square', 0, 160);
    },
    grenadePin() {
      blip(1800, 0.03, 0.15, 'square');
      blip(1400, 0.03, 0.12, 'square', 0.08);
    },
  };
}
