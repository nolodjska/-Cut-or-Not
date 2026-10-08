/* ===== part: 02-util.js ===== */
function hash32(str, salt) {
  let h = 2166136261 >>> 0;
  const s = String(str) + '|' + String(salt == null ? '' : salt);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  h ^= h >>> 16; h = Math.imul(h, 2246822507) >>> 0;
  h ^= h >>> 13; h = Math.imul(h, 3266489909) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}
function Rng(seedNum) { this.s = (seedNum >>> 0) || 1; }
Rng.prototype.next = function () {
  let t = (this.s = (this.s + 0x6D2B79F5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
Rng.prototype.range = function (a, b) { return a + (b - a) * this.next(); };
Rng.prototype.int = function (a, b) { return Math.floor(this.range(a, b + 1)); };
Rng.prototype.pick = function (arr) { return arr[Math.floor(this.next() * arr.length)]; };
Rng.prototype.chance = function (p) { return this.next() < p; };
Rng.prototype.shuffle = function (arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = this.int(0, i); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
};

let SEEDCHARS = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function makeSeed(rng) {
  let s = 'GG-';
  for (let i = 0; i < 7; i++) s += SEEDCHARS[rng.int(0, 31)];
  s += SEEDCHARS[rng.int(0, 31)];
  return s;
}

/* ---------------------------------------------------------------------------
 * 2. 工具
 * -------------------------------------------------------------------------*/
const clamp = (v, a, b) => v < a ? a : (v > b ? b : v);
const round2 = v => Math.round(v * 100) / 100;
function money(v) { return (Math.round(v * 10) / 10).toLocaleString('zh-CN'); }

/* ---------------------------------------------------------------------------
 * 3. 核心引擎
 * -------------------------------------------------------------------------*/
