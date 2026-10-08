/* ===== part: 03-sfx.js ===== */
const sfx = (() => {
  let ctx = null;
  const on = () => { try { return localStorage.getItem(LS.mute) !== '1'; } catch (e) { return true; } };
  function tone(freq, dur, type, gain, delay) {
    if (!on()) return;
    try {
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      const t0 = ctx.currentTime + (delay || 0);
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type || 'sine'; o.frequency.setValueAtTime(freq, t0);
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(gain || 0.06, t0 + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(ctx.destination);
      o.start(t0); o.stop(t0 + dur + 0.02);
    } catch (e) { /* 用户还没交互过，浏览器会拒绝，忽略即可 */ }
  }
  return {
    ok: () => tone(660, 0.10, 'triangle', 0.05),
    err: () => tone(180, 0.16, 'sawtooth', 0.04),
    money: () => { tone(880, 0.09, 'triangle', 0.05); tone(1320, 0.10, 'triangle', 0.04, 0.07); },
    harvest: () => tone(520, 0.12, 'sine', 0.05),
    event: () => { tone(300, 0.20, 'sine', 0.05); tone(420, 0.24, 'sine', 0.04, 0.12); },
    alert: () => { tone(220, 0.22, 'square', 0.05); tone(180, 0.26, 'square', 0.04, 0.14); },
    award: () => { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.34, 'triangle', 0.05, i * 0.13)); },
    bid: () => tone(760, 0.12, 'square', 0.045),
    toggle() {
      const m = !on();
      try { localStorage.setItem(LS.mute, m ? '0' : '1'); } catch (e) { }
      return m;
    },
    isOn: on,
  };
})();
