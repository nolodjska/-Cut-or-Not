/* ===== part: 02-codex.js ===== */
function emptyCodex() {
  return { games: 0, wins: 0, bestRatio: 0, dead: 0, crops: {}, corps: {}, talents: {}, noms: {}, seeds: {} };
}
function codex() { return Object.assign(emptyCodex(), store.get(LS.codex, {})); }
function bump(obj, key) { if (key) obj[key] = (obj[key] || 0) + 1; }
function recordRun() {
  if (!G || !G.s.settlement || ui.recorded) return;
  ui.recorded = true;
  const st = G.s.settlement, c = codex();
  c.games++;
  const me = st.rows.find(r => r.id === G.s.humanId);
  if (me) {
    if (st.chief.pid === G.s.humanId) c.wins++;
    if (!me.alive) c.dead++;
    if (me.ratio > c.bestRatio) c.bestRatio = Math.round(me.ratio * 100) / 100;
  }
  for (const cid of Object.keys(HUMAN.m.cropTraded)) bump(c.crops, cid);
  for (const cid in HUMAN.storage) bump(c.crops, cid);
  for (const t of HUMAN.talents) bump(c.talents, t);
  bump(c.corps, HUMAN.corp);
  for (const n of st.nominations) if (n.pid === G.s.humanId) bump(c.noms, n.title);
  c.seeds[G.s.seed] = 1;
  store.set(LS.codex, c);
}

/* 音效：全部用 WebAudio 现场合成，不依赖任何音频文件（单文件交付的前提） */