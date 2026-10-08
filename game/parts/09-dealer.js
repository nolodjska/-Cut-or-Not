/* ===== part: 09-dealer.js ===== */
Game.prototype.dealerQuota = function (cid) {
  const c = this.good(cid);
  if (!c || !c.absorbDay || this.isProduct(cid)) return 0;
  return Math.max(BAL.dealerQuotaMin, Math.round(c.absorbDay * BAL.dealerQuotaMult));
};
/** 你今天已经卖给他多少（跨天自动归零，不看日历只算差值） */
Game.prototype.dealerSoldToday = function (p, cid) {
  if (!p) return 0;
  const today = Math.floor(this.s.t / 1440);
  if (p.dealerSoldDay !== today) return 0;
  return p.dealerSold[cid] || 0;
};

/* ---- §17.2 ② 上门的买家 ----------------------------------------------
   三类人：街坊（买得多、出价低）/ 作坊主（贵也得买）/ 豪客（出价高、量小、只来一次）。

   ⚠ 三个关键设计决定（写下来防止后人“优化”掉）：

   1. **报价是纯函数，不存隐藏状态**。他今天来不来、买什么、出多少，
      全由（世界种子 + 游戏日 + 你手里的货 + 见过的次数）算出来。
      这是 §17.0 判据 3 的要求：**不能有玩家看不到的原因**。

   2. **绝不动主 RNG 流**。用 FNV-1a 自己算一个确定值 ——
      若消耗 `this.rng.main.next()`，每帧渲染都会扰动全局随机序列，
      直接搞坏“同种子同结果”的仿真复现（工具链靠它跑 660 局）。 */
function buyerRoll(seed, day, type, pid) {
  let h = 2166136261;
  const str = seed + '|' + day + '|' + type + '|' + pid;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
}

/** 算出某个买家此刻摆在门口的那张报价（纯函数，不修改任何状态）。
 *  返回 null = 他今天没来 / 已经买过 / 你手里没货 / 你今天请过他回去。 */
Game.prototype.buyerOffer = function (p, type) {
  const cfg = BAL.buyers[type];
  if (!cfg || !p || !p.buyers) return null;
  const b = p.buyers[type];
  if (cfg.once && b.used) return null;
  const today = Math.floor(this.s.t / 1440);
  if (b.refusedDay === today) return null;
  if (buyerRoll(this.s.seed, today, type, p.id) >= BAL.buyerComeChance) return null;

  /* 买什么：挑你手里最多的一种作物（“货压手里”→ 他就来）。
     街坊“**只认便宜货**”：行价高于基准（=贵了）的他不买，一件便宜的都没有就不来。
     ⚠ 这是三个人**性格上的真差别** —— 不是只有数字不同。
        （2026-10-08 试玩员实测：“三张卡文案几乎一字不差，看不出他们有任何别的差别”） */
  const pool = CROP_IDS.filter(cid => (p.storage[cid] || 0) > 0);
  const held = cfg.cheapOnly
    ? pool.filter(cid => this.good(cid).price <= this.good(cid).base)
    : pool;
  if (!held.length) return null;
  const cid = type === 'hood'
    ? held.slice().sort((a, b2) => this.good(a).price - this.good(b2).price)[0]
    : held.slice().sort((a, b2) => (p.storage[b2] || 0) - (p.storage[a] || 0))[0];

  const boughtToday = (b.day === today) ? b.boughtToday : 0;
  const cap = Math.floor(cfg.cap + cfg.growPerDay * today);   // “总需求每天略多一点”
  const qty = Math.min(p.storage[cid] || 0, cap);
  if (qty <= 0) return null;

  const c = this.good(cid);
  let px = c.price * cfg.px;
  const regular = b.met >= BAL.buyerRegularAt;
  if (regular) px *= BAL.buyerRegularBonus;
  /* “吃腻了”的力度按人不同：作坊主是**拿去用的**，少吃一点不影响他下逐客令 */
  px *= Math.max(0.55, 1 - BAL.buyerSat * (cfg.satMult == null ? 1 : cfg.satMult) * boughtToday);
  /* ⚠ 这里**故意不设“至少比砸盘好”的地板**。
     我一开始加了，随后发现它把三个人的差价全抹平：
     小单砸盘滑点极小 → 地板（砸盘均价 ×1.01）永远盖过街坊的 0.88×，
     于是「街坊出价低」这条脾气消失、`吃腻了` 也再也看不见（测试 B4 会当场抓出来）。
     §17.4 说的「还比市场价好」由**作坊主（1.02×）和豪客（1.25×）**兑现；
     街坊就是**低价**那一个 —— 他的价值不是单价，是**买走你的大单却不砸价**。
     三个人差价分明，玩家才能学到“看人下菜”；全抬到市价之上反而教不出东西。 */
  /* ⚠ 天花板：夹在价格带内 —— 防印钱机的第三道夹子 */
  px = clamp(px, c.base * 0.30, c.base * BAL.importValveMult);

  return {
    type: type, cid: cid, qty: qty,
    /* ⚠ 量化到 1 位小数：卡片上“他出的价 × 买多少”必须能**当场验算**。
       2026-10-08 试玩员实测：9.5×30=285 但卡上写 284，差 1 G 无解释。
       看不出来的差价会直接把玩家教成“这游戏数字不准”。 */
    price: Math.round(px * 10) / 10,
    met: b.met, regular: regular, boughtToday: boughtToday,
  };
};

/** 卖给他。
 *  ⚠ 货**离开这个世界**（不回做市商库存）→ 是一条需求沉淀，**不砸价**。
 *    这就是“上门出价比市场好”的全部道理：不是单价高，是**没有滑点**。 */
Game.prototype._a_sellTo = function (p, d) {
  const cfg = BAL.buyers[d.type];
  if (!cfg) return { ok: false, msg: '没有这个人' };
  const off = this.buyerOffer(p, d.type);
  if (!off) return { ok: false, msg: cfg.name + '现在没在门口' };
  const have = p.storage[off.cid] || 0;
  if (have < off.qty) return { ok: false, msg: '你手里只剩 ' + have + ' 单位 ' + this.good(off.cid).name };

  const c = this.good(off.cid);
  const gross = off.qty * off.price;
  p.storage[off.cid] = have - off.qty;
  if (p.storage[off.cid] <= 0) delete p.storage[off.cid];
  p.cash += gross;
  p.m.volume += gross;
  p.m.publicTrades += 1;
  this.s.stats.trades += 1;

  const b = p.buyers[d.type];
  const today = Math.floor(this.s.t / 1440);
  if (b.day !== today) { b.day = today; b.boughtToday = 0; }
  b.boughtToday += off.qty;
  b.met += 1;
  if (cfg.once) b.used = true;

  /* 归因句（格式取自 docs/13 §17.2，逐字落地）。
     ⚠ 只对玩家发 —— NPC 不参与上门买家，但保险起见仍然守一道。
     ⚠ 零术语（§17.2 明令）：不说 需求曲线/价格弹性/派生需求/边际消费倾向/饱和/需求侧。 */
  if (p.isHuman) {
    const next = this.buyerOffer(p, d.type);
    this._log('trade', cfg.name + '今天已经买了 ' + b.boughtToday + ' 单位' + c.name +
      ' —— 再卖他，' + (next ? '他只肯出 ' + round2(next.price) : '他今天不再收了'), p.id);
  }
  return { ok: true, msg: cfg.name + '把 ' + off.qty + ' 单位' + c.name + '带走了，到手 ' + money(gross) + ' G' };
};

/** 把今天上门的人请回去（免得他一直杵在门口） */
Game.prototype._a_declineBuyer = function (p, d) {
  const cfg = BAL.buyers[d.type];
  if (!cfg) return { ok: false, msg: '没有这个人' };
  p.buyers[d.type].refusedDay = Math.floor(this.s.t / 1440);
  return { ok: true, msg: cfg.name + '耸耸肩走了' };
};

Game.prototype._a_sell = function (p, d) {
  const g = this.good(d.crop);
  const r = this.sell(p, d.crop, d.qty);
  if (r.ok) {
    this._log('trade', p.name + ' 卖出 ' + d.qty + ' ' + this.good(d.crop).name + ' @' + round2(r.price) +
      '（价格被砸低 ' + (r.impact * 100).toFixed(1) + '%）', p.id);
    /* §17.1 收货商 · 归因句（docs/13 §17.1 给了格式，此处逐字落地）。
       目的：让玩家能自己把「我卖得多 → 他压价」这条因果连起来。
       ⚠ 只对玩家本人发 —— NPC 每 30 分钟就卖一笔，给他们也发会直接洗版。
       ⚠ 零术语（lint-copy 会查）：不说“做市商/库存偏离/保留价/逆向选择/流动性”。 */
    if (p.isHuman && g) {
      const left = Math.max(0, this.dealerQuota(d.crop) - this.dealerSoldToday(p, d.crop));
      /* ⚠ 文案必须短到**一行读得完**：折叠状态只给 29px（一行）。
         2026-10-08 试玩员实测：「括号后面到底写了什么，我到现在都不知道」
         —— 解释写了但读不到，等于没写。
         ⚠ 也**不说“明天再来”**：他并不拒绝成交，只是往死里压价。
           写着“明天再来”却能卖，会直接教出“规则在骗我”。 */
      this._log('trade', '你卖了 ' + d.qty + ' ' + g.name + '，老赵压到 ' + round2(g.price) +
        (left > 0 ? '（今天还能收 ' + left + '）' : '（他今天收够了）'), p.id);
    }
  }
  return r;
};

Game.prototype._a_limit = function (p, d) {
  /* 挂单只支持作物：加工品走到这里会读到不存在的字段并抛异常，
     而异常会打断 requestAnimationFrame 链 —— 整个游戏当场卡死（审核实测）。 */
  if (!CROP_IDS.includes(d.crop)) return { ok: false, msg: '这个品种不能挂单，直接买卖就行' };
  const c = this.s.crops[d.crop];
  const qty = Math.floor(d.qty), price = d.price;
  if (!qty || !price || price <= 0) return { ok: false, msg: '价格和数量都要填' };
  const o = { id: ++this.s.seq, crop: d.crop, side: d.side, qty, price, t: this.s.t, expireT: this.s.t + 24 * 60 };
  if (d.side === 'buy') {
    const cost = qty * price * (1 + BAL.marketFee);
    if (p.cash < cost) return { ok: false, msg: '挂买单需要先冻结 ' + money(cost) + ' G' };
    p.cash -= cost; o.locked = cost;
  } else if ((p.storage[d.crop] || 0) < qty) return { ok: false, msg: '库存不足' };
  p.limitOrders.push(o);
  return { ok: true, msg: '挂单成功：' + (d.side === 'buy' ? '买' : '卖') + ' ' + qty + ' ' + c.name + ' @' + price };
};
Game.prototype._a_cancelOrder = function (p, d) {
  const o = p.limitOrders.find(x => x.id === d.id);
  if (!o) return { ok: false, msg: '没有这个挂单' };
  if (o.side === 'buy' && o.locked) p.cash += o.locked;
  p.limitOrders = p.limitOrders.filter(x => x.id !== d.id);
  return { ok: true, msg: '挂单已撤，冻结资金退回' };
};

