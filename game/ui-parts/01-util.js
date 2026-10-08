/* ===== part: 01-util.js ===== */
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fmt = n => Math.round(n).toLocaleString('zh-CN');
const fmt1 = n => (Math.round(n * 10) / 10).toLocaleString('zh-CN');

let G = null, HUMAN = null, view = 'farm', raf = null;

/* ============ 本地持久化（docs/07 定的 Demo 形态：单文件 H5 + localStorage，无后端） ============ */
const LS = { save: 'gg.save.v1', codex: 'gg.codex.v1', mute: 'gg.mute.v1' };
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 隐私模式等，忽略 */ } },
  del(k) { try { localStorage.removeItem(k); } catch (e) { } },
};

/* 图鉴：跨局只保留"广度"，不保留"强度"（docs/04 的硬约束 —— 任何跨局因素对单局净资产的加成 ≤ +5%） */
