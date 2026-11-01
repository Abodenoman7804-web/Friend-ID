// Web Audio API synthesized sounds (zero network dependencies, works offline)

let ctx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return null;
  if (!ctx || ctx.state === "closed") {
    ctx = new AudioCtx();
  }
  if (ctx.state === "suspended") {
    void ctx.resume();
  }
  return ctx;
}

/** Play a light pop for message sent */
export function playSentSound() {
  try {
    const c = getAudioContext();
    if (!c) return;
    const osc = c.createOscillator();
    const gain = c.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(600, c.currentTime);
    osc.frequency.exponentialRampToValueAtTime(900, c.currentTime + 0.05);
    gain.gain.setValueAtTime(0.08, c.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, c.currentTime + 0.06);
    osc.connect(gain);
    gain.connect(c.destination);
    osc.start();
    osc.stop(c.currentTime + 0.07);
  } catch {
    /* ignore */
  }
}

/** Play a pleasant WhatsApp-style double-ding for incoming message */
export function playReceivedSound() {
  try {
    const c = getAudioContext();
    if (!c) return;
    const now = c.currentTime;
    [
      { f: 880, t: 0, d: 0.08 },
      { f: 1320, t: 0.09, d: 0.12 },
    ].forEach(({ f, t, d }) => {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(f, now + t);
      gain.gain.setValueAtTime(0.12, now + t);
      gain.gain.exponentialRampToValueAtTime(0.001, now + t + d);
      osc.connect(gain);
      gain.connect(c.destination);
      osc.start(now + t);
      osc.stop(now + t + d + 0.01);
    });
  } catch {
    /* ignore */
  }
}

let ringtoneInterval: number | null = null;

/** Play looping incoming call ringtone */
export function startRingtone() {
  stopRingtone();
  const playPattern = () => {
    try {
      const c = getAudioContext();
      if (!c) return;
      const notes = [
        { f: 523.25, t: 0, d: 0.15 }, // C5
        { f: 659.25, t: 0.16, d: 0.15 }, // E5
        { f: 783.99, t: 0.32, d: 0.25 }, // G5
        { f: 1046.5, t: 0.58, d: 0.35 }, // C6
      ];
      const now = c.currentTime;
      notes.forEach(({ f, t, d }) => {
        const osc = c.createOscillator();
        const gain = c.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(f, now + t);
        gain.gain.setValueAtTime(0.18, now + t);
        gain.gain.exponentialRampToValueAtTime(0.001, now + t + d);
        osc.connect(gain);
        gain.connect(c.destination);
        osc.start(now + t);
        osc.stop(now + t + d + 0.02);
      });
    } catch {
      /* ignore */
    }
  };

  playPattern();
  ringtoneInterval = window.setInterval(playPattern, 2000);
}

export function stopRingtone() {
  if (ringtoneInterval) {
    clearInterval(ringtoneInterval);
    ringtoneInterval = null;
  }
}
