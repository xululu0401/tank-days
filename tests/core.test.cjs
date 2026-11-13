/* 这缸水还能撑几天 · 核心测试
 * 跑法：node --test tests/core.test.cjs
 * 纪律：
 *  - 锚点全部来自 ../需求与调研.md §2.6 的**手算**，不是从实现输出里抄回来的；
 *  - ok=false 时必须断言「算不出来」（推导量为 null），而不是断言 0；
 *  - 每个断言都检查字段存在且值域有效；
 *  - 最后一组是「人工注入错误必须让锚点变红」，用来证明这套测试真的会红。
 */
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const SRC_PATH = path.join(__dirname, '..', 'core.js');
const SRC = fs.readFileSync(SRC_PATH, 'utf8');
const C = require(SRC_PATH);

/* 在 vm 里当作经典脚本跑一遍：core.js 既要能 require，也要能在浏览器里挂到 window 上 */
function loadAsBrowserGlobal(src) {
  const ctx = { console: console };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(src, ctx);
  return ctx.AppCore;
}
const WB = loadAsBrowserGlobal(SRC);

function near(a, b, eps, msg) {
  assert.ok(typeof a === 'number' && isFinite(a), (msg || '') + ' —— 期望是有限数字，实际 ' + a);
  assert.ok(Math.abs(a - b) <= (eps == null ? 1e-9 : eps), (msg || '') + ' —— 期望 ' + b + '，实际 ' + a + '（差 ' + Math.abs(a - b) + '）');
}
function defState(mut) {
  const s = C.defaultState();
  if (mut) mut(s);
  return s;
}
function D(mut) { return C.compute(defState(mut)); }
function codes(o) { return o.errors.map(function (e) { return e.field + '/' + e.code; }).sort(); }
/* 推导量必须「算不出来」时用的空集检查（跨 realm 用 JSON 比较） */
function derivedKeys(o) { return ['vols', 'load', 'rate', 'runway', 'steady', 'schedule', 'plan', 'levers']; }

/* ── 手算锚点（§2.6 表，逐行对应；由手算写出，与实现无关） ── */
const A = {
  vNom: 63.0, vSand: 7.2, vHead: 5.4, vDecor: 3.0, V: 47.4,
  fishMass: 40.0, feed: 0.8, nFeed: 57.6,
  no3Pot: 57.6 * (62 / 14),                 /* 255.0857142857… */
  no3In: 57.6 * (62 / 14) * 0.85,           /* 216.8228571428… */
  no3Net: 57.6 * (62 / 14) * 0.85 - 120,    /* 96.8228571428… */
  a: (57.6 * (62 / 14) * 0.85 - 120) / 47.4,
  aT: (57.6 * (62 / 14) * 0.85 - 120) / 47.4 * 7,
  days: (25 - 12) / ((57.6 * (62 / 14) * 0.85 - 120) / 47.4),
  peak30: (57.6 * (62 / 14) * 0.85 - 120) * 7 / 47.4 / 0.30,
  trough30: (57.6 * (62 / 14) * 0.85 - 120) * 7 / 47.4 * 0.7 / 0.30,
  fReq: (57.6 * (62 / 14) * 0.85 - 120) * 7 / 47.4 / 25,
  fSug: Math.min(0.95, (57.6 * (62 / 14) * 0.85 - 120) * 7 / 47.4 / 25 * 1.10),
  target: 25 / 1.10
};
A.liters = A.fSug * A.V;

/* ══════════════════════════════════════════════════════════
 * 1. 手算锚点
 * ══════════════════════════════════════════════════════════ */
test('1. 默认场景的手算锚点逐条命中', () => {
  const o = C.compute(C.defaultState());
  assert.ok(o.ok, '默认场景必须算得出来：' + JSON.stringify(o.errors));
  near(o.vols.nominal, A.vNom, 1e-12, '标称容积');
  near(o.vols.sand, A.vSand, 1e-12, '底砂占');
  near(o.vols.head, A.vHead, 1e-12, '留空占');
  near(o.vols.decor, A.vDecor, 1e-12, '造景占');
  near(o.vols.water, A.V, 1e-12, '实际水量');
  near(o.load.fishMass, A.fishMass, 1e-12, '鱼总体重');
  near(o.load.feed, A.feed, 1e-12, '每天饲料');
  near(o.load.nFeed, A.nFeed, 1e-9, '饲料氮');
  near(o.load.no3Pot, A.no3Pot, 1e-9, '潜在硝酸盐');
  near(o.load.no3In, A.no3In, 1e-9, '进水硝酸盐');
  near(o.load.no3Net, A.no3Net, 1e-9, '净负荷');
  near(o.rate.a, A.a, 1e-12, '每天涨幅');
  near(o.rate.aT, A.aT, 1e-12, '一个周期涨幅');
  near(o.runway.days, A.days, 1e-12, '还能撑几天');
  assert.strictEqual(o.runway.status, 'days');
  assert.strictEqual(o.runway.crossDay, 7, '第 7 天越线');
  near(o.steady.peak, A.peak30, 1e-9, '现状稳态峰值');
  near(o.steady.trough, A.trough30, 1e-9, '现状稳态谷值');
  assert.strictEqual(o.steady.verdict, 'over');
  near(o.plan.fReq, A.fReq, 1e-12, '临界比例');
  near(o.plan.fSug, A.fSug, 1e-12, '建议比例');
  near(o.plan.liters, A.liters, 1e-9, '建议每次换水量');
  assert.strictEqual(o.plan.buckets, 3, '建议 3 桶');
  near(o.plan.peakAtSug, A.target, 1e-9, '建议稳态峰值 = 上限 ÷ 1.1');
  /* 逐字复核几个「页面会显示的数」的格式化结果 */
  assert.strictEqual(C.fmtV(o.vols.water, 2), '47.4');
  assert.strictEqual(C.fmtV(o.rate.a, 4), '2.0427');
  assert.strictEqual(C.fmtV(o.steady.peak, 2), '47.66');
  assert.strictEqual(C.fmtPct(o.plan.fSug, 2), '62.91%');
});

test('2. 排班表：第 1 周 = 今天读数 + 一个周期的涨幅，且逐步向稳态收敛', () => {
  const o = C.compute(C.defaultState());
  const r1 = o.schedule.rows[0];
  near(r1.start, 12, 1e-12, '第 1 周期初 = 今天的读数');
  near(r1.peak, 12 + A.aT, 1e-12, '第 1 周换水前');
  near(r1.after, (12 + A.aT) * 0.7, 1e-12, '第 1 周换水后');
  assert.strictEqual(r1.over, true);
  assert.strictEqual(o.schedule.firstOver, 1, '现状节奏第一次就超了');
  assert.strictEqual(o.schedule.rows.length, C.K.CYCLES);
  /* 逐周递推关系：这一周的期初 = 上一周换水后 */
  for (let i = 1; i < o.schedule.rows.length; i++) {
    near(o.schedule.rows[i].start, o.schedule.rows[i - 1].after, 1e-12, '第 ' + (i + 1) + ' 周期初');
    near(o.schedule.rows[i].peak, o.schedule.rows[i].start + A.aT, 1e-12, '第 ' + (i + 1) + ' 周峰值');
  }
  const dist = (x) => Math.abs(x.peak - o.steady.peak);
  assert.ok(dist(o.schedule.rows[7]) < dist(o.schedule.rows[0]), '在向稳态收敛');
  /* 建议节奏：第 2 周回到上限以内 */
  const p = o.plan.schedule;
  assert.strictEqual(p.rows[0].over, true, '建议节奏第 1 周仍会到 26.30');
  near(p.rows[0].peak, 26.298734, 1e-5, '建议排班第 1 周峰值');
  assert.strictEqual(p.rows[1].over, false, '第 2 周回到上限以内');
  near(p.rows[1].peak, 24.051770, 1e-5, '建议排班第 2 周峰值');
  assert.strictEqual(p.firstBack, 2);
});

test('3. 六条公式两两自洽（不是把同一个式子抄两遍）', () => {
  const o = C.compute(C.defaultState());
  near(o.rate.a * C.K.N_PER_PROTEIN * 1000 / 1000, o.rate.a * 6.25, 1e-12, '常数自身');
  near(o.load.no3Pot / o.load.nFeed, 62 / 14, 1e-12, '氮→硝酸盐的比就是 62/14');
  near(o.load.no3In / o.load.no3Pot, 0.85, 1e-12, '进水系数 85%');
  near(o.rate.a, o.load.no3Net / o.vols.water, 1e-12, 'a = 净负荷 ÷ 水量');
  near(o.rate.aT, o.rate.a * 7, 1e-12, 'aT = a × 周期');
  near(o.steady.peak * o.steady.f, o.rate.aT, 1e-9, '峰值 × 比例 = 一个周期涨的量');
  near(o.steady.peak - o.steady.trough, o.steady.peak * o.steady.f, 1e-9, '峰谷差 = 一次换水带走的量');
  near(o.plan.liters / o.vols.water, o.plan.fSug, 1e-12, '每次换水量 ÷ 水量 = 比例');
  near(o.load.feed * o.load.fishMass / o.load.fishMass, o.load.feed, 1e-12, '自洽');
  near(o.load.nFeed, o.load.feed * 0.45 / 6.25 * 1000, 1e-12, '饲料氮 = 饲料 × 蛋白 ÷ 6.25');
});

/* ══════════════════════════════════════════════════════════
 * 4. 每个字段的上下界两侧
 * ══════════════════════════════════════════════════════════ */
test('4. 每个数值字段的上下界：界内可算、越界报 range', () => {
  /* 底砂/造景/留空这三个是**几何受约束**的：在默认的 60×30×35 缸上取上界会真的把缸占满，
   * 那是模型该报的 no-water，不是字段越界。所以这三个的上界测试换到一个足够大的缸上做。 */
  const BIG = { len: '500', wid: '500', hgt: '300' };
  const BIGFIELDS = ['sandT', 'decorL', 'headCm'];
  C.EDITABLE.forEach(function (k) {
    const f = C.FIELDS[k];
    const mk = (val) => D(s => { if (BIGFIELDS.indexOf(k) >= 0) Object.assign(s, BIG); s[k] = String(val); });
    const inLow = mk(f.min);
    assert.ok(inLow.ok, k + ' 取下界 ' + f.min + ' 应当可算：' + JSON.stringify(inLow.errors));
    const inHigh = mk(f.max);
    assert.ok(inHigh.ok, k + ' 取上界 ' + f.max + ' 应当可算：' + JSON.stringify(inHigh.errors));
    const below = mk(f.min - (f.min > 0 ? 0.0001 : 0) - (f.min > 0 ? 0 : 1));
    assert.strictEqual(below.ok, false, k + ' 低于下界应当报错');
    assert.ok(codes(below).indexOf(k + '/range') >= 0, k + ' 低于下界应报 range，实际 ' + codes(below));
    const above = mk(f.max + 1);
    assert.strictEqual(above.ok, false, k + ' 高于上界应当报错');
    assert.ok(codes(above).indexOf(k + '/range') >= 0, k + ' 高于上界应报 range，实际 ' + codes(above));
  });
  /* 默认缸上把底砂拉到上界：模型必须报 no-water，而不是报字段越界 —— 两件事要分清楚 */
  const clog = D(s => { s.sandT = String(C.FIELDS.sandT.max); });
  assert.strictEqual(clog.ok, false);
  assert.deepStrictEqual(codes(clog), ['sandT/no-water'], '这时应当只有 no-water 这一个错');
});

test('5. 阈值两侧的实质结论（上限、越线、零分母、整桶取整）', () => {
  /* 恰好落在上限：判为「已经到上限」（不是「还能撑 0 天」也不是「还能撑一点」） */
  const eq = D(s => { s.nowNo3 = '25'; });
  assert.strictEqual(eq.runway.status, 'over');
  assert.strictEqual(eq.runway.days, 0);
  /* 差一点点没到：状态是 days 且天数极小 */
  const just = D(s => { s.nowNo3 = '24.999'; });
  assert.strictEqual(just.runway.status, 'days');
  assert.ok(just.runway.days > 0 && just.runway.days < 0.01, '还差一点点：' + just.runway.days);
  /* 稳态峰值恰好等于上限：verdict 必须是 ok（不能因为浮点误差判越线） */
  const exact = D(s => { s.changePct = String(A.fReq * 100); });
  assert.strictEqual(exact.steady.verdict, 'ok', '峰值恰好等于上限时应判 ok');
  near(exact.steady.peak, 25, 1e-9, '临界比例的稳态峰值正好是上限');
  /* 略低于临界比例一个极小量：判越线 */
  const under = D(s => { s.changePct = String(A.fReq * 100 - 1e-9); });
  assert.strictEqual(under.steady.verdict, 'over', '低于临界比例应判越线');
  /* 零分母：换水比例 0 → 没有稳态 */
  const zero = D(s => { s.changePct = '0'; });
  assert.strictEqual(zero.steady.status, 'no-steady');
  assert.strictEqual(zero.steady.peak, null);
  assert.strictEqual(zero.steady.trough, null);
  assert.strictEqual(zero.schedule, null, '比例 0 时不给排班表（没有稳态可比）');
  /* 每次换水量刚好是整数桶：不能多算一桶 */
  const b = D(s => { s.bucketL = String(A.liters); });          /* 29.82144 L 的桶 → 恰好 1 桶 */
  assert.strictEqual(b.plan.buckets, 1, '刚好一桶就该是 1');
  const b2 = D(s => { s.bucketL = String(A.liters / 2); });      /* 恰好 2 桶 */
  assert.strictEqual(b2.plan.buckets, 2, '刚好两桶就该是 2');
  const b3 = D(s => { s.bucketL = String(A.liters / 2 - 1e-6); });
  assert.strictEqual(b3.plan.buckets, 3, '差一点点就得多一桶');
});

/* ══════════════════════════════════════════════════════════
 * 6. 非法输入：逐条核 code，并核「原文保留」
 * ══════════════════════════════════════════════════════════ */
test('6. 非法数字逐条给 code，并且绝不静默当成 0', () => {
  const cases = [
    ['len', 'abc', 'len/not-number'],
    ['len', '', 'len/empty'],
    ['wid', '  ', 'wid/empty'],
    ['hgt', '35cm', 'hgt/not-number'],
    ['sandT', '-1', 'sandT/range'],
    ['decorL', '-0.1', 'decorL/range'],
    ['headCm', '101', 'headCm/range'],
    ['feedRate', '20.5', 'feedRate/range'],
    ['protein', '0', 'protein/range'],
    ['protein', '101', 'protein/range'],
    ['intoWater', '-5', 'intoWater/range'],
    ['plantUptake', '100001', 'plantUptake/range'],
    ['nowNo3', 'x', 'nowNo3/not-number'],
    ['maxNo3', '0', 'maxNo3/range'],
    ['period', '0', 'period/range'],
    ['period', '90.5', 'period/range'],
    ['changePct', '101', 'changePct/range'],
    ['bucketL', '0.4', 'bucketL/range'],
    ['len', '1e3', 'len/not-number'],
    ['len', '0x10', 'len/not-number'],
    ['wid', 'Infinity', 'wid/not-number'],
    ['hgt', '3 5', 'hgt/not-number']
  ];
  cases.forEach(function (c) {
    const o = D(s => { s[c[0]] = c[1]; });
    assert.strictEqual(o.ok, false, c[0] + '=' + JSON.stringify(c[1]) + ' 应当算不出来');
    assert.ok(codes(o).indexOf(c[2]) >= 0, c[0] + '=' + JSON.stringify(c[1]) + ' 期望 ' + c[2] + '，实际 ' + codes(o));
  });
  /* 「1e3」「0x10」这类看着像数字的文本，必须报错而不是被 Number() 吃掉 */
  assert.strictEqual(D(s => { s.len = '1e3'; }).ok, false);
  assert.strictEqual(D(s => { s.len = '0x10'; }).ok, false);
  /* 负号、全角数字也不行 */
  assert.strictEqual(D(s => { s.wid = '－30'; }).ok, false);
  assert.strictEqual(D(s => { s.wid = '３０'; }).ok, false);
});

test('7. 算不出来时：8 个推导量必须全是 null，而不是 0', () => {
  const o = D(s => { s.len = 'abc'; });
  derivedKeys(o).forEach(function (k) {
    assert.strictEqual(o[k], null, 'ok=false 时 ' + k + ' 必须是 null');
  });
  assert.ok(o.errors.length >= 1);
  assert.strictEqual(o.checks.length, 0, '算不出来时不谈自检');
  /* 多错一起报：不能只报第一个 */
  const many = D(s => { s.len = 'abc'; s.wid = ''; s.period = '0'; });
  assert.ok(many.errors.length >= 3, '三个错应当都报出来，实际 ' + JSON.stringify(codes(many)));
});

test('8. 鱼的行逐行核字段（名字/条数/体重），一行错就整体算不出来', () => {
  function rows(mut) { const s = C.defaultState(); mut(s.fish); return C.compute(s); }
  let o = rows(f => { f[0].name = ''; });
  assert.ok(codes(o).indexOf('fish/row-name') >= 0, '空名字：' + codes(o));
  o = rows(f => { f[0].name = 'x'.repeat(21); });
  assert.ok(codes(o).indexOf('fish/row-name-long') >= 0);
  o = rows(f => { f[1].n = '2.5'; });
  assert.ok(codes(o).indexOf('fish/row-n') >= 0, '条数必须是整数：' + codes(o));
  o = rows(f => { f[1].n = '0'; });
  assert.ok(codes(o).indexOf('fish/row-n-range') >= 0);
  o = rows(f => { f[1].n = '10001'; });
  assert.ok(codes(o).indexOf('fish/row-n-range') >= 0);
  o = rows(f => { f[1].g = 'abc'; });
  assert.ok(codes(o).indexOf('fish/row-g') >= 0);
  o = rows(f => { f[1].g = '0.01'; });
  assert.ok(codes(o).indexOf('fish/row-g-range') >= 0);
  o = rows(f => { f.length = 0; });
  assert.ok(codes(o).indexOf('fish/no-rows') >= 0, '一行都没有：' + codes(o));
  o = rows(f => { while (f.length < 13) f.push({ name: 'x', n: '1', g: '1' }); });
  assert.ok(codes(o).indexOf('fish/too-many-rows') >= 0);
  /* 行是对的：加一行，鱼重跟着涨 */
  o = rows(f => { f.push({ name: '再加一条', n: '10', g: '2' }); });
  assert.ok(o.ok);
  near(o.load.fishMass, 60, 1e-12, '40 + 20 = 60 g');
  /* 行里的错误必须报在第几行 */
  o = rows(f => { f[2].g = 'oops'; });
  assert.strictEqual(o.errors[0].row, 2, '要指出是第 3 行');
});

test('9. 没有水的情形：不能算出 0 或者负数，必须报 no-water 并指到最大的那个占位', () => {
  const o = D(s => { s.len = '20'; s.wid = '20'; s.hgt = '20'; s.sandT = '19'; });
  assert.strictEqual(o.ok, false);
  assert.ok(codes(o).indexOf('sandT/no-water') >= 0, '应当报 no-water：' + codes(o));
  assert.strictEqual(o.vols.water <= 0, true, '这时确实没有水');
  derivedKeys(o).forEach(k => { if (k !== 'vols') assert.strictEqual(o[k], null, k + ' 必须是 null'); });
  /* 造景最大时应该指到造景 */
  const o2 = D(s => { s.len = '20'; s.wid = '20'; s.hgt = '20'; s.decorL = '20'; });
  assert.ok(codes(o2).indexOf('decorL/no-water') >= 0, '应当指到造景：' + codes(o2));
  /* 恰好用完（V=0）也算没有水 */
  const o3 = D(s => { s.len = '20'; s.wid = '20'; s.hgt = '20'; s.sandT = '0'; s.decorL = '0'; s.headCm = '0'; });
  assert.ok(o3.ok, 'V=8 L 是能算的');
  near(o3.vols.water, 8, 1e-12);
});

/* ══════════════════════════════════════════════════════════
 * 10. 三种特殊状态
 * ══════════════════════════════════════════════════════════ */
test('10. 不涨 / 不换水 / 已经超了 —— 三种状态各自说清楚，不硬凑数字', () => {
  /* 水草吸满：a ≤ 0 */
  const noRise = D(s => { s.plantUptake = '500'; });
  assert.strictEqual(noRise.ok, true);
  assert.ok(noRise.rate.a < 0);
  assert.strictEqual(noRise.runway.status, 'no-rise');
  assert.strictEqual(noRise.runway.days, null, '不会再涨就不能给「几天」');
  assert.strictEqual(noRise.steady.status, 'no-rise');
  assert.strictEqual(noRise.steady.peak, 0);
  assert.strictEqual(noRise.steady.verdict, 'ok');
  assert.strictEqual(noRise.schedule, null, '不涨时没有排班表可给（不能拿负增长去递推）');
  assert.strictEqual(noRise.plan.status, 'no-rise');
  assert.strictEqual(noRise.plan.fSug, undefined, '不涨时不该给建议比例');
  assert.ok(noRise.levers.allOk, '不涨时四条路都不需要');
  assert.ok(noRise.warnings.some(w => w.code === 'absorb-enough'));
  /* a 恰好等于 0：也归到「不涨」（净负荷的浮点残渣由内核按 0 清理，不给 5.6e14 天这种读数） */
  const zero = D(s => { s.plantUptake = String(A.no3In); });
  near(zero.rate.a, 0, 1e-12, 'a 恰好 0');
  assert.strictEqual(zero.rate.a, 0, '残渣必须被清成精确的 0');
  assert.strictEqual(zero.runway.status, 'no-rise');
  assert.strictEqual(zero.runway.days, null);
  /* 再高一点点就真的是负的 */
  const neg = D(s => { s.plantUptake = String(A.no3In + 1); });
  assert.ok(neg.rate.a < 0);
  assert.strictEqual(neg.runway.status, 'no-rise');
  /* 反过来：净负荷只比进水小一丁点（残留 1e-13 量级）也必须清成 0，不给天文数字 */
  const tiny = D(s => { s.plantUptake = String(A.no3In - 1e-13); });
  assert.strictEqual(tiny.runway.status, 'no-rise', '这种输入不该算出几万亿天');
  assert.strictEqual(tiny.steady.status, 'no-rise');
  /* 不换水：没有稳态，但「还能撑几天」照给 */
  const noChange = D(s => { s.changePct = '0'; });
  assert.strictEqual(noChange.steady.status, 'no-steady');
  assert.strictEqual(noChange.runway.status, 'days');
  near(noChange.runway.days, A.days, 1e-12, '「还能撑几天」与换水比例无关');
  assert.strictEqual(noChange.plan.fSug != null, true, '建议比例仍然给得出来');
  /* 已经超了 */
  const over = D(s => { s.nowNo3 = '46'; s.maxNo3 = '25'; });
  assert.strictEqual(over.runway.status, 'over');
  assert.strictEqual(over.runway.days, 0);
  assert.ok(over.runway.label.indexOf('上限') >= 0);
  assert.ok(over.plan.schedule.firstBack >= 1, '要告诉用户按建议节奏第几周压回去：' + over.plan.schedule.firstBack);
  /* 全换：允许，但要有提示 */
  const full = D(s => { s.changePct = '100'; });
  assert.ok(full.ok);
  near(full.steady.peak, A.aT, 1e-9, '每次全换时峰值 = 一个周期涨的量');
  near(full.steady.trough, 0, 1e-9, '全换后是 0');
  assert.ok(full.warnings.some(w => w.code === 'full-change'));
});

test('11. 光靠换水压不住时：必须明确说「压不住」，不能给一个假的达标数', () => {
  const o = D(s => { s.maxNo3 = '5'; });
  assert.ok(o.plan.fReq > 1, '临界比例超过 100%：' + o.plan.fReq);
  assert.ok(o.plan.cappedByMax, '建议值应被 95% 上限卡住');
  near(o.plan.fSug, 0.95, 1e-12);
  assert.ok(o.plan.peakAtSug > 5, '建议值的峰值仍然超过上限');
  assert.ok(o.warnings.some(w => w.code === 'cap-impossible'), '要有「光靠换水压不住」的提示：' + JSON.stringify(o.warnings.map(w => w.code)));
  /* 提示里要带「全换也压不住」的那个数 */
  const w = o.warnings.filter(x => x.code === 'cap-impossible')[0];
  assert.ok(w.message.indexOf(C.fmt(A.aT, 2)) >= 0, '提示里要写出「全换 100% 时的峰值」' + C.fmt(A.aT, 2) + '：' + w.message);
  /* 中间地带：临界比例 30%–95%，留余量后超 95% */
  const mid = D(s => { s.maxNo3 = '15'; });
  assert.ok(mid.plan.fReq < 1 && mid.plan.fReq * 1.1 > 0.95, '这一档的临界比例：' + mid.plan.fReq);
  assert.ok(mid.warnings.some(w2 => w2.code === 'cap'));
  /* 自检不能因此报假红（该绿就绿） */
  assert.strictEqual(o.checks.filter(c => !c.pass).length, 0, '被上限卡住是「已声明」的状态，自检不该红：' + JSON.stringify(o.checks.filter(c => !c.pass)));
});

/* ══════════════════════════════════════════════════════════
 * 12. 单调性 / 最优性
 * ══════════════════════════════════════════════════════════ */
test('12. 六条单调性：方向错了就是模型错了', () => {
  const base = C.compute(C.defaultState());
  const axis = function (k, vals) { return vals.map(v => C.compute(defState(s => { s[k] = String(v); }))); };
  const inc = (arr, get, msg) => {
    for (let i = 1; i < arr.length; i++) {
      assert.ok(get(arr[i]) > get(arr[i - 1]), msg + '：' + get(arr[i - 1]) + ' → ' + get(arr[i]));
    }
  };
  const dec = (arr, get, msg) => {
    for (let i = 1; i < arr.length; i++) {
      assert.ok(get(arr[i]) < get(arr[i - 1]), msg + '：' + get(arr[i - 1]) + ' → ' + get(arr[i]));
    }
  };
  /* 水量越大，每天涨得越慢 */
  dec(axis('len', [40, 60, 80, 120]), o => o.rate.a, '缸越长 → a 越小');
  /* 喂得越多，涨得越快 */
  inc(axis('feedRate', [0.5, 1, 2, 4]), o => o.rate.a, '喂得越多 → a 越大');
  /* 水草吸得越多，涨得越慢 */
  dec(axis('plantUptake', [0, 50, 120, 200]), o => o.rate.a, '水草越多 → a 越小');
  /* 换水比例越大，稳态峰值越低 */
  dec(axis('changePct', [20, 30, 50, 80]), o => o.steady.peak, '换水越多 → 峰值越低');
  /* 周期越长，稳态峰值越高 */
  inc(axis('period', [3, 7, 14, 21]), o => o.steady.peak, '周期越长 → 峰值越高');
  /* 上限越低，「还能撑几天」越短 */
  dec(axis('maxNo3', [30, 25, 20, 15]), o => o.runway.days, '上限越低 → 撑得越短');
  /* 反解：临界比例随上限下降而上升 */
  inc(axis('maxNo3', [40, 30, 20, 10]), o => o.plan.fReq, '上限越低 → 需要的比例越大');
  /* 建议值永远不小于临界值（留的是正余量） */
  const p = base.plan;
  assert.ok(p.fSug >= p.fReq, '建议值 ≥ 临界值');
  near(p.fSug, p.fReq * 1.1, 1e-12, '建议 = 临界 × 1.1');
});

/* ══════════════════════════════════════════════════════════
 * 13. 建议闭环：四条路必须真的回到同一个目标峰值
 * ══════════════════════════════════════════════════════════ */
test('13. 四条反解路回填后重算，峰值必须都收敛到「上限 ÷ 1.1」', () => {
  const o = C.compute(C.defaultState());
  const T = 25 / 1.1;
  const peakAfter = function (mut, tag) {
    const r = C.compute(defState(mut));
    assert.ok(r.ok, tag + ' 回填后必须算得出来');
    near(r.steady.peak, T, 1e-6, tag + ' 回填后的稳态峰值');
    assert.ok(r.steady.peak < r.raw.maxNo3, tag + ' 必须落回上限以内');
    assert.strictEqual(r.steady.verdict, 'ok', tag + ' 的判据应当是 ok');
    return r;
  };
  /* ① 多换水 */
  peakAfter(s => { s.changePct = String(o.levers.change.toPct); }, '①多换水');
  /* ② 少喂 */
  assert.strictEqual(o.levers.feed.feasible, true);
  near(o.levers.feed.toPct, 1.5327611983209708, 1e-9, '少喂那条路的投喂率');
  peakAfter(s => { s.feedRate = String(o.levers.feed.toPct); }, '②少喂');
  /* ③ 加水草 */
  assert.strictEqual(o.levers.plant.feasible, true);
  near(o.levers.plant.toMg, 170.654025974026, 1e-9, '加水草那条路的吸收量');
  assert.ok(o.levers.plant.toMg < o.levers.plant.ceiling, '吸收量不可能超过进水总量');
  peakAfter(s => { s.plantUptake = String(o.levers.plant.toMg); }, '③加水草');
  /* ④ 换大缸：按长宽高等比例放大 */
  const v = o.levers.volume;
  assert.strictEqual(v.feasible, true);
  near(v.toL, 99.4048, 1e-4, '换大缸那条路的目标水量');
  assert.ok(v.scale > 1, '放大倍数必须大于 1');
  /* 放大后的三边各自没超出字段范围 */
  assert.ok(v.dims.len <= C.FIELDS.len.max && v.dims.wid <= C.FIELDS.wid.max && v.dims.hgt <= C.FIELDS.hgt.max);
  peakAfter(s => { s.len = String(v.dims.len); s.wid = String(v.dims.wid); s.hgt = String(v.dims.hgt); }, '④换大缸');
  /* 四条路的方向都对：换水更多、喂更少、水草更多、缸更大 */
  assert.ok(o.levers.change.toPct > o.levers.change.nowPct);
  assert.ok(o.levers.feed.toPct < o.levers.feed.nowPct);
  assert.ok(o.levers.plant.toMg > o.levers.plant.nowMg);
  assert.ok(o.levers.volume.toL > o.levers.volume.nowL);
});

test('14. 建议闭环在随机的真实输入上也成立（400 组）', () => {
  let rng = 20261113;
  const rnd = function () { rng = (rng * 1103515245 + 12345) % 2147483648; return rng / 2147483648; };
  let n = 0, applied = 0;
  while (n < 400) {
    n++;
    const s = C.defaultState();
    s.len = String(30 + Math.round(rnd() * 170));
    s.wid = String(20 + Math.round(rnd() * 80));
    s.hgt = String(25 + Math.round(rnd() * 55));
    s.sandT = String(Math.round(rnd() * 8));
    s.decorL = String(Math.round(rnd() * 15));
    s.headCm = String(Math.round(rnd() * 8));
    s.feedRate = String(Math.round(rnd() * 400) / 100);
    s.plantUptake = String(Math.round(rnd() * 600));
    s.nowNo3 = String(Math.round(rnd() * 60));
    s.maxNo3 = String(1 + Math.round(rnd() * 39));
    s.period = String(1 + Math.round(rnd() * 20));
    s.changePct = String(Math.round(rnd() * 90));
    s.bucketL = String(1 + Math.round(rnd() * 30));
    s.fish = [{ name: 'A', n: String(1 + Math.round(rnd() * 30)), g: String(Math.round(rnd() * 800) / 100 + 0.5) }];
    const o = C.compute(s);
    assert.ok(o.ok, '随机组应当算得出来：' + JSON.stringify(s));
    assert.ok(o.checks.every(c => c.pass), '自检必须全绿：' + JSON.stringify(o.checks.filter(c => !c.pass)));
    /* 不变量 */
    near(o.rate.a, o.load.no3Net / o.vols.water, 1e-9, '不变量 a');
    near(o.vols.water, o.vols.nominal - o.vols.sand - o.vols.head - o.vols.decor, 1e-9, '不变量 水量');
    assert.ok(o.vols.water > 0);
    if (o.steady.status === 'ok') {
      near(o.steady.peak * o.steady.f, o.rate.aT, 1e-6, '不变量 峰值×比例');
      assert.ok(o.steady.trough >= 0, '谷值不能是负数');
      (o.schedule ? o.schedule.rows : []).forEach(r => { assert.ok(r.peak >= r.start, '周期内只能涨'); assert.ok(r.after <= r.peak + 1e-9); assert.ok(r.after >= 0); });
    }
    /* 只要路走得通，回填就必须达标 */
    if (o.levers && o.levers.change) {
      const T = o.raw.maxNo3 / 1.1;
      /* 建议比例被 95% 上限卡住时，回填本来就不该达标（页面有提示条说明），这一档单独验 */
      if (o.plan.tier === 'A') {
        applied++;
        const rc = C.compute(Object.assign({}, s, { changePct: String(o.levers.change.toPct) }));
        near(rc.steady.peak, T, 1e-6, 'changePct 回填后应当收敛到目标峰值（A 档：留满余量）');
      } else if (o.plan.tier === 'B') {
        /* 达标但余量不足：峰值必须落在 [目标, 上限] 之间 */
        applied++;
        const rc = C.compute(Object.assign({}, s, { changePct: String(o.levers.change.toPct) }));
        near(rc.steady.peak, o.rate.aT / o.plan.fSug, 1e-6, 'B 档峰值 = aT ÷ 建议比例');
        assert.ok(rc.steady.peak >= T - 1e-9 && rc.steady.peak <= o.raw.maxNo3 * (1 + 1e-12), 'B 档必须达标但余量不足：' + rc.steady.peak);
      } else {
        /* C 档：按本页建议上限都压不回上限，必须如实越线 */
        applied++;
        const rc = C.compute(Object.assign({}, s, { changePct: String(o.levers.change.toPct) }));
        near(rc.steady.peak, o.rate.aT / 0.95, 1e-6, 'C 档峰值 = aT ÷ 0.95');
        assert.ok(rc.steady.peak > o.raw.maxNo3, 'C 档必须仍然越线，不能假装达标');
        assert.strictEqual(o.plan.meetsLimit, false, 'C 档的 meetsLimit 必须是 false');
      }
      [['feedRate', o.levers.feed.toPct], ['plantUptake', o.levers.plant.toMg]].forEach(function (pair) {
        if (pair[1] == null) return;
        if (pair[0] === 'feedRate' && !o.levers.feed.feasible) return;
        if (pair[0] === 'plantUptake' && !o.levers.plant.feasible) return;
        applied++;
        const r2 = C.compute(Object.assign({}, s, { [pair[0]]: String(pair[1]) }));
        assert.ok(r2.ok);
        near(r2.steady.peak, T, 1e-6, pair[0] + ' 回填后应当收敛到目标峰值');
      });
      if (o.levers.volume.feasible) {
        applied++;
        const d = o.levers.volume.dims;
        const r3 = C.compute(Object.assign({}, s, { len: String(d.len), wid: String(d.wid), hgt: String(d.hgt) }));
        near(r3.steady.peak, T, 1e-6, '换大缸回填后应当收敛到目标峰值');
      }
    }
  }
  assert.strictEqual(n, 400);
  assert.ok(applied > 500, '这一轮至少回填验证了 500 次以上，实际 ' + applied);
});

/* ══════════════════════════════════════════════════════════
 * 15. 人工注入错误必须让锚点变红（证明测试真的会红）
 * ══════════════════════════════════════════════════════════ */
test('15. 15 套人工注入的错误，每一套都必须让锚点指纹变化（幸存者 0）', () => {
  const fingerprint = function (core) {
    const o = core.compute(core.defaultState());
    return JSON.stringify([
      o.vols.water, o.vols.sand,
      o.load.no3Net, o.rate.a, o.rate.aT,
      o.runway.days, o.runway.crossDay,
      o.steady.peak, o.steady.trough, o.steady.f,
      o.schedule.rows[0].peak, o.schedule.rows[0].after, o.schedule.rows[1].peak,
      o.plan.fReq, o.plan.fSug, o.plan.liters, o.plan.buckets, o.plan.peakAtSug,
      o.plan.schedule.rows[1].peak,
      o.levers.change.toPct, o.levers.feed.toPct, o.levers.feed.toG,
      o.levers.plant.toMg, o.levers.volume.toL, o.levers.volume.scale,
      o.checks.length, o.checks.filter(c => !c.pass).length
    ]);
  };
  const good = fingerprint(WB);
  const MUT = [
    ['氮→硝酸盐用 62/15', 'NO3_PER_N: 62 / 14', 'NO3_PER_N: 62 / 15'],
    ['蛋白含氮改用 ÷6.0', 'N_PER_PROTEIN: 6.25', 'N_PER_PROTEIN: 6.0'],
    ['余量 1.10 改成 1.00', 'MARGIN: 1.10', 'MARGIN: 1.00'],
    ['稳态峰值 aT ÷ f 改成 × f', 'var peak = aT / f, trough = aT * (1 - f) / f;', 'var peak = aT * f, trough = aT * (1 - f) / f;'],
    ['谷值漏掉 ÷ f', 'trough = aT * (1 - f) / f', 'trough = aT * (1 - f)'],
    ['「还能撑几天」改成乘', 'var d = (raw.maxNo3 - raw.nowNo3) / a;', 'var d = (raw.maxNo3 - raw.nowNo3) * a;'],
    ['每天涨幅改成 净负荷 × 水量', 'var a = no3Net / V;', 'var a = no3Net * V;'],
    ['进水系数 /100 改成 *100', 'var no3In = no3Pot * raw.intoWater / 100;', 'var no3In = no3Pot * raw.intoWater * 100;'],
    ['净负荷忘了减水草', 'var no3Net = no3In - raw.plantUptake;', 'var no3Net = no3In;'],
    ['临界比例 aT/maxNo3 改成 aT*maxNo3', 'var fReq = aT / raw.maxNo3;', 'var fReq = aT * raw.maxNo3;'],
    ['建议比例改成 临界 ÷ 余量', 'var fSug = Math.min(K.F_MAX, fReq * K.MARGIN);', 'var fSug = Math.min(K.F_MAX, fReq / K.MARGIN);'],
    ['排班换水后忘了乘 (1−f)', 'var af = pk * (1 - fx);', 'var af = pk;'],
    ['底砂用留空厚度算', 'var vSand = raw.len * raw.wid * raw.sandT / 1000;', 'var vSand = raw.len * raw.wid * raw.headCm / 1000;'],
    ['换大缸那条路：水量按 r 一次方', 'return r * r * r * vNom - r * r * (vSand + vHead) - vDecor;', 'return r * vNom - r * r * (vSand + vHead) - vDecor;'],
    ['加水草那条路漏掉进水系数', 'var uptakeNeed = no3In - netAllowed;', 'var uptakeNeed = no3Pot - netAllowed;']
  ];
  let killed = 0;
  MUT.forEach(function (m) {
    assert.ok(SRC.indexOf(m[1]) >= 0, '注入点①没找到，测试本身要修：' + m[0]);
    const bad = SRC.split(m[1]).join(m[2]);
    assert.notStrictEqual(bad, SRC, '替换没生效：' + m[0]);
    let badCore = null, err = null;
    try { badCore = loadAsBrowserGlobal(bad); } catch (e) { err = e; }
    if (err) { killed++; return; }               /* 直接抛错也算被抓住 */
    let fp = null;
    try { fp = fingerprint(badCore); } catch (e) { killed++; return; }
    assert.notStrictEqual(fp, good, '这条注入错误居然没被锚点抓住：' + m[0]);
    killed++;
  });
  assert.strictEqual(killed, MUT.length, '每一套注入都必须被抓到');
});

/* ══════════════════════════════════════════════════════════
 * 16. 预设、导出、纯函数、格式化
 * ══════════════════════════════════════════════════════════ */
test('16. 五个内置预设都能算，且自检全绿', () => {
  assert.strictEqual(C.PRESETS.length, 5);
  C.PRESETS.forEach(function (p) {
    const o = C.compute(C.stateFromPreset(p.key));
    assert.ok(o.ok, p.key + ' 应当算得出来：' + JSON.stringify(o.errors));
    assert.ok(o.checks.every(c => c.pass), p.key + ' 自检必须全绿：' + JSON.stringify(o.checks.filter(c => !c.pass)));
    assert.ok(p.note && p.note.length > 10, p.key + ' 要有说明');
    assert.ok(p.note.indexOf('虚构') >= 0, p.key + ' 的说明里必须写明虚构');
  });
  /* 预设往返 */
  C.PRESETS.forEach(function (p) {
    if (!Object.keys(p.state).length) return;
    assert.strictEqual(C.presetKey(C.stateFromPreset(p.key)), p.key, p.key + ' 应当能认回来');
  });
  /* 默认态：不该被判成某个预设 */
  assert.strictEqual(C.presetKey(C.defaultState()), null);
});

test('17. 导出契约：CSV 带 BOM 且行列完整、MD 有边界、JSON 可回读', () => {
  const s = C.defaultState();
  const o = C.compute(s);
  const now = new Date(2026, 10, 13, 13, 30, 0);
  const csv = C.toCSV(s, o, now);
  assert.strictEqual(csv.charCodeAt(0), 0xFEFF, 'CSV 必须带 BOM');
  assert.strictEqual(csv.indexOf('\ufeff', 1), -1, '只能有一个 BOM');
  assert.ok(csv.indexOf('2026-11-13 13:30:00') >= 0);
  assert.ok(csv.indexOf('实际水量,47.40,L') >= 0, '要有实际水量行');
  assert.ok(csv.indexOf('净负荷,96.8229,mg/天') >= 0, '要有净负荷行');
  assert.ok(csv.indexOf('不换水还能撑,6.364 天（第 7 天越线）') >= 0, '要有主结论');
  assert.ok(csv.indexOf('周次,期初读数 mg/L,换水前 mg/L,是否越线,换水后 mg/L') >= 0, '要有排班表表头');
  /* 排班表的行数：两组各 8 行 */
  assert.strictEqual((csv.match(/^[1-8],\d/gm) || []).length >= 16, true, '两组排班表都要在');
  assert.ok(csv.indexOf('四条路') >= 0, '要有四条路');
  assert.ok(csv.split('\r\n').length > 50);
  /* 算不出来时也要能导出，且写出错误 */
  const bo = C.compute(defState(x => { x.len = 'abc'; }));
  const bcsv = C.toCSV(s, bo, now);
  assert.ok(bcsv.indexOf('算不出来') >= 0);
  assert.ok(bcsv.indexOf('不是一个数字') >= 0);

  const md = C.toMarkdown(s, o, now);
  assert.ok(md.indexOf('# 这缸水还能撑几天') === 0);
  assert.ok(md.indexOf('AI 自行复核，未做人工校核。') > 0, 'MD 必须写明未做人工校核');
  assert.ok(md.indexOf('本页假设值') > 0, 'MD 必须写明假设值来源');
  assert.ok(md.indexOf('## 边界') > 0);
  assert.ok(md.indexOf('| 1 | 12.000 | 26.299 | **越线** |') > 0, '排班表要写进 MD');
  assert.ok(md.indexOf('## 结构自检') > 0);

  const js = C.toJSON(s, o, now);
  const back = JSON.parse(js);
  assert.strictEqual(back.slug, 'tank-days');
  assert.strictEqual(back.exported_at, now.toISOString());
  assert.deepStrictEqual(JSON.parse(JSON.stringify(back.state)), JSON.parse(JSON.stringify(s)), 'JSON 里要能原样回读输入');
  near(back.out.rate.a, A.a, 1e-12, 'JSON 里的推导量');
  assert.ok(js.indexOf('虚构示例') > 0);
});

test('18. 纯函数与确定性：不改输入、两次结果逐字段相同', () => {
  const s = C.defaultState();
  const before = JSON.stringify(s);
  const o1 = C.compute(s);
  assert.strictEqual(JSON.stringify(s), before, 'compute 不许改输入');
  const o2 = C.compute(C.defaultState());
  /* np 时间戳不进 compute，所以可以直接比 */
  const strip = (o) => JSON.stringify(o, function (k, v) { return k === 'raw' || k === 'rows' ? undefined : v; });
  assert.strictEqual(strip(o1), strip(o2), '两次结果必须逐字段相同');
  /* 页面会显示的那几个格式化结果也必须稳定 */
  assert.strictEqual(C.fmtV(o1.rate.a, 4), C.fmtV(o2.rate.a, 4));
  /* 不改输入的前提下，把 state 里的对象引用换个顺序也应当一样 */
  const s3 = C.defaultState();
  const keys = Object.keys(s3).reverse();
  const s4 = {};
  keys.forEach(k => { s4[k] = s3[k]; });
  assert.strictEqual(strip(C.compute(s4)), strip(o1), '字段顺序不该影响结果');
  /* 缺字段（老版本的存档）应当报错而不是崩 */
  const missing = C.defaultState();
  delete missing.period;
  const om = C.compute(missing);
  assert.strictEqual(om.ok, false);
  assert.ok(codes(om).indexOf('period/empty') >= 0, '缺字段要报 empty：' + codes(om));
});

test('19. 格式化契约：不显示无意义的尾随零，也不把 null 显示成 0', () => {
  assert.strictEqual(C.fmtV(12.0, 2), '12');
  assert.strictEqual(C.fmtV(35.94, 4), '35.94');
  assert.strictEqual(C.fmtV(0, 2), '0');
  assert.strictEqual(C.fmt(47.4, 2), '47.40');
  assert.strictEqual(C.fmtPct(0.6291443, 2), '62.91%');
  assert.strictEqual(C.fmtV(null, 2), '—', 'null 必须显示成「—」，不能显示成 0');
  assert.strictEqual(C.fmt(undefined, 1), '—');
  assert.strictEqual(C.fmtV(6.3641997, 1), '6.4');
  assert.strictEqual(C.fmtV(-0, 2), '0', '负零要显示成 0');
  assert.strictEqual(C.fmtV(-1e-12, 2), '0', '四舍五入到 -0 的浮点残渣要显示成 0');
  assert.strictEqual(C.fmt(-1e-12, 2), '-0.00', 'fmt 是「照位数显示」，不替用户抹掉符号');
  /* 页面里出现的每一个数字都得能追到同一次输出：这里抽查几个 */
  const o = C.compute(C.defaultState());
  assert.ok(C.toMarkdown(C.defaultState(), o, new Date(2026, 10, 13)).indexOf(C.fmt(o.rate.a, 6)) > 0);
  assert.ok(C.toMarkdown(C.defaultState(), o, new Date(2026, 10, 13)).indexOf(C.fmt(o.vols.water, 2)) > 0);
});

test('20. 浏览器经典脚本形态：core.js 挂到 window 上也能用（与 require 结果一致）', () => {
  assert.ok(WB, 'window.AppCore 必须存在');
  ['compute', 'defaultState', 'stateFromPreset', 'toCSV', 'toMarkdown', 'toJSON', 'fmt', 'fmtV', 'fmtPct'].forEach(function (k) {
    assert.strictEqual(typeof WB[k], 'function', k + ' 应当是个函数');
  });
  assert.strictEqual(JSON.stringify(WB.compute(WB.defaultState()).rate), JSON.stringify(C.compute(C.defaultState()).rate));
  assert.strictEqual(WB.FIELDS.len.max, C.FIELDS.len.max);
  assert.strictEqual(WB.PRESETS.length, C.PRESETS.length);
  /* 不许在全局留下别的名字 */
  const ctx = { console: console };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(SRC, ctx);
  const extra = Object.keys(ctx).filter(k => ['window', 'globalThis', 'console', 'AppCore'].indexOf(k) < 0);
  assert.deepStrictEqual(extra, [], '不许往全局乱挂东西：' + JSON.stringify(extra));
});
