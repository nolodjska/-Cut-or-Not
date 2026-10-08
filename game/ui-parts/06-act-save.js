/* ===== part: 06-act-save.js ===== */
function A(name, payload, quiet) {
  const r = G.act(G.s.humanId, name, payload || {});
  if (!r.ok) toast(r.msg || '这个操作不行', 'err');
  else if (r.msg && !quiet) toast(r.msg, 'ok');
  render(true);
  return r;
}

/* ---------- 存档 ---------- */
function autosave() {
  if (!G || G.s.over) return;
  const nav = G.nav(HUMAN), ratio = nav / (HUMAN.initNav || 10000);
  store.set(LS.save, {
    v: 1, at: Date.now(), over: false,
    summary: {
      seed: G.s.seed, corp: HUMAN.corp, corpName: HUMAN.corpName,
      t: Math.round(G.s.t), day: dayOf(G.s.t), nav: Math.round(nav),
      ratio: Math.round(ratio * 100) / 100, died: false,
    },
    blob: GG.save(G),
  });
}
function finishSave(sum) {
  const prev = store.get(LS.save, {});
  store.set(LS.save, Object.assign({}, prev, { over: true, summary: Object.assign({}, prev.summary, sum || {}) }));
}
function continueSave() {
  const sv = store.get(LS.save, null);
  if (!sv || !sv.blob) { toast('没有找到存档', 'err'); return false; }
  try {
    G = GG.load(sv.blob);
    HUMAN = G.s.players.find(p => p.id === G.s.humanId);
    ui.seen = G.s.feed.length; ui.qty = {}; ui.recorded = false;
    $('#ovStart').classList.add('hide'); $('#ovEnd').classList.add('hide');
    $('#corp').textContent = HUMAN.corpName;
    setSpeed(G.s.over ? 0 : 1);
    view = G.s.over ? 'end' : 'farm';
    toast('接着上局继续（第 ' + dayOf(G.s.t) + ' 天）', 'info', 2600);
    render(true);
    return true;
  } catch (e) { toast('存档读不出来：' + e.message, 'err', 4000); return false; }
}
function clearSave() { store.del(LS.save); }

/* ---------- 开局 ---------- */
