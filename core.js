/* 这缸水还能撑几天 · 核心（core.js）
 * 纯函数，不碰 DOM、不读时间、不用随机：同样的输入永远给同样的输出。
 *
 * 模型只有一条链：
 *   缸体几何 → 实际水量 V → 鱼重×投喂率的氮负荷 → 每天涨多少 mg/L（a）
 *   → ①不换水还能撑几天 ②换水节奏的稳态峰值/谷值 ③逐周排班 ④四条反解路
 *
 * 所有"达不到"的情形都返回 ok=false（或对应的 status），绝不返回 0 冒充结果。
 * 页面上的每个数字都必须能从这里同一次 compute 的输出里找到。
 */
(function (root) {
  'use strict';

  /* ── 建模假设常量（本页自定，无外部来源；页面文案里逐条写明） ── */
  var K = {
    N_PER_PROTEIN: 6.25,          /* 粗蛋白 → 氮：蛋白含氮按 16% 折算 */
    NO3_PER_N: 62 / 14,           /* 硝酸盐/氮 摩尔质量比 = 4.428571… */
    MARGIN: 1.10,                 /* 建议值在上限上留 10% 余量（本页设计选择） */
    F_MAX: 0.95,                  /* 建议比例上限：不主张整缸换水 */
    CYCLES: 8                     /* 排班表周数 */
  };

  /* ── 字段元数据 ── */
  var FIELDS = {
    len:      { label: '缸内长', unit: 'cm', min: 10, max: 1000, def: 60, comfy: [20, 200] },
    wid:      { label: '缸内宽', unit: 'cm', min: 10, max: 1000, def: 30, comfy: [20, 100] },
    hgt:      { label: '缸内高', unit: 'cm', min: 10, max: 300, def: 35, comfy: [20, 80] },
    sandT:    { label: '底砂厚度', unit: 'cm', min: 0, max: 100, def: 4, comfy: [0, 10] },
    decorL:   { label: '造景石头沉木占容积', unit: 'L', min: 0, max: 2000, def: 3, comfy: [0, 30] },
    headCm:   { label: '水面离缸口留空', unit: 'cm', min: 0, max: 100, def: 3, comfy: [0, 10] },
    fishMass: { label: '鱼总体重（自动求和）', unit: 'g', min: 0, max: 200000, def: 40, comfy: [0, 2000], derivedInput: true },
    feedRate: { label: '每天投喂量占鱼重', unit: '%体重/天', min: 0, max: 20, def: 2, comfy: [0, 5] },
    protein:  { label: '饲料粗蛋白占比', unit: '%', min: 1, max: 100, def: 45, comfy: [20, 60] },
    intoWater:{ label: '其中最终变成硝酸盐', unit: '%', min: 0, max: 100, def: 85, comfy: [50, 100] },
    plantUptake: { label: '水草每天吸走', unit: 'mg/天', min: 0, max: 100000, def: 120, comfy: [0, 1000] },
    nowNo3:   { label: '今天测到的读数', unit: 'mg/L', min: 0, max: 1000, def: 12, comfy: [0, 100] },
    maxNo3:   { label: '换水前不超过', unit: 'mg/L', min: 0.1, max: 1000, def: 25, comfy: [5, 80] },
    period:   { label: '多少天换一次', unit: '天', min: 1, max: 90, def: 7, comfy: [3, 30] },
    changePct:{ label: '每次换掉实际水量', unit: '%', min: 0, max: 100, def: 30, comfy: [5, 80] },
    bucketL:  { label: '你的桶多少升', unit: 'L', min: 0.5, max: 200, def: 10, comfy: [1, 50] }
  };
  var ORDER = ['len', 'wid', 'hgt', 'sandT', 'decorL', 'headCm', 'fishMass', 'feedRate', 'protein',
    'intoWater', 'plantUptake', 'nowNo3', 'maxNo3', 'period', 'changePct', 'bucketL'];
  /* 用户手填的（fishMass 是自动求和的只读显示） */
  var EDITABLE = ORDER.filter(function (k) { return !FIELDS[k].derivedInput; });

  /* ── 预设（全部虚构，写明在页面上与说明里） ── */
  var PRESETS = [
    {
      key: 'default', name: '默认：60 缸 + 三种小鱼',
      note: '60×30×35 内径、底砂 4 cm、造景 3 L；灯科鱼 / 鼠鱼 / 小精灵鱼；每周换 30%。虚构示例。',
      state: {}
    },
    {
      key: 'small', name: '小缸喂得偏多',
      note: '40×25×30 的小缸，鱼不多但投喂率 3%，水草只有 30 mg/天 —— 看它怎么给出「少喂」这条路。虚构。',
      state: {
        len: '40', wid: '25', hgt: '30', sandT: '3', decorL: '2', headCm: '2.5',
        feedRate: '3', plantUptake: '30', nowNo3: '18', maxNo3: '20', changePct: '25', bucketL: '8',
        fish: [{ name: '孔雀鱼', n: '10', g: '2.5' }, { name: '鼠鱼', n: '3', g: '5' }]
      }
    },
    {
      key: 'planted', name: '水草多的草缸',
      note: '水草吸得比鱼拉得快：看「按这个喂食量不会再涨」这一支。虚构。',
      state: {
        len: '80', wid: '40', hgt: '40', sandT: '6', decorL: '8', headCm: '4',
        feedRate: '1.2', plantUptake: '900', nowNo3: '8', maxNo3: '25', changePct: '30', bucketL: '12',
        fish: [{ name: '灯科鱼', n: '40', g: '1.2' }, { name: '小精灵鱼', n: '3', g: '3' }]
      }
    },
    {
      key: 'over', name: '已经超了',
      note: '今天读数就已经高过你定的上限：看它怎么算「还要按这个节奏换几周才压得回去」。虚构。',
      state: {
        nowNo3: '46', maxNo3: '25', changePct: '45', period: '7', bucketL: '15',
        len: '75', wid: '35', hgt: '40', sandT: '5', decorL: '5', headCm: '3',
        feedRate: '2', plantUptake: '150',
        fish: [{ name: '灯科鱼', n: '20', g: '1.5' }, { name: '鼠鱼', n: '6', g: '4.5' }]
      }
    },
    {
      key: 'nolimit', name: '不换水也不涨',
      note: '大水体 + 大量水草：硝酸盐涨不起来，撑几天这一问没有意义 —— 看它如实说「不会再涨」。虚构。',
      state: {
        len: '120', wid: '50', hgt: '50', sandT: '5', decorL: '10', headCm: '4',
        feedRate: '1', plantUptake: '600', nowNo3: '6', maxNo3: '25', changePct: '20', bucketL: '20',
        fish: [{ name: '灯科鱼', n: '30', g: '1.5' }]
      }
    }
  ];

  var DEF_FISH = [
    { name: '灯科鱼', n: '12', g: '1.5' },
    { name: '鼠鱼', n: '4', g: '4' },
    { name: '小精灵鱼', n: '2', g: '3' }
  ];

  function cloneRows(rows) {
    return rows.map(function (r) { return { name: String(r.name), n: String(r.n), g: String(r.g) }; });
  }
  function defaultState() {
    var s = { fish: cloneRows(DEF_FISH) };
    EDITABLE.forEach(function (k) { s[k] = String(FIELDS[k].def); });
    return s;
  }
  function stateFromPreset(key) {
    var p = PRESETS.filter(function (x) { return x.key === key; })[0];
    var s = defaultState();
    if (!p) return s;
    Object.keys(p.state).forEach(function (k) {
      if (k === 'fish') s.fish = cloneRows(p.state.fish);
      else s[k] = String(p.state[k]);
    });
    return s;
  }
  function presetKey(state) {
    for (var i = 0; i < PRESETS.length; i++) {
      var p = PRESETS[i];
      var keys = Object.keys(p.state);
      if (!keys.length) continue;
      var same = keys.every(function (k) {
        if (k === 'fish') return JSON.stringify(state.fish) === JSON.stringify(cloneRows(p.state.fish));
        return String(state[k]) === String(p.state[k]);
      });
      if (same) return p.key;
    }
    return null;
  }

  /* ── 数字解析：非数字一律报错并保留原文，绝不静默吞掉 ── */
  function parseNum(raw, f, key, errors) {
    var t = String(raw == null ? '' : raw).trim();
    if (t === '') { errors.push({ field: key, code: 'empty', message: '这一格是空的。' }); return null; }
    if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(t)) {
      errors.push({ field: key, code: 'not-number', message: '「' + t + '」不是一个数字（只接受十进制数字，可带小数点）。原文已保留，没有替你改。' });
      return null;
    }
    var v = Number(t);
    if (!isFinite(v)) { errors.push({ field: key, code: 'not-finite', message: '这个数算不出来。' }); return null; }
    if (v < f.min || v > f.max) {
      errors.push({ field: key, code: 'range', message: f.label + '要在 ' + f.min + '–' + f.max + ' ' + (f.unit || '') + ' 之间，你填的是 ' + t + '。' });
      return null;
    }
    return v;
  }
  function parseRows(rows, errors) {
    var list = Array.isArray(rows) ? rows : [];
    if (!list.length) { errors.push({ field: 'fish', code: 'no-rows', message: '至少要有一行鱼（就算只有一条）。' }); return []; }
    if (list.length > 12) { errors.push({ field: 'fish', code: 'too-many-rows', message: '最多 12 行，现在有 ' + list.length + ' 行。' }); return []; }
    return list.map(function (r, i) {
      var no = i + 1, name = String(r && r.name == null ? '' : r.name).trim();
      if (!name) errors.push({ field: 'fish', row: i, sub: 'name', code: 'row-name', message: '第 ' + no + ' 行没写是什么鱼。' });
      else if (name.length > 20) errors.push({ field: 'fish', row: i, sub: 'name', code: 'row-name-long', message: '第 ' + no + ' 行的名字超过 20 个字。' });
      var nt = String(r && r.n == null ? '' : r.n).trim();
      var gt = String(r && r.g == null ? '' : r.g).trim();
      var n = null, g = null;
      if (!/^\d+$/.test(nt)) errors.push({ field: 'fish', row: i, sub: 'n', code: 'row-n', message: '第 ' + no + ' 行的条数要填整数，你填的是「' + nt + '」。' });
      else { n = Number(nt); if (n < 1 || n > 10000) { errors.push({ field: 'fish', row: i, sub: 'n', code: 'row-n-range', message: '第 ' + no + ' 行的条数要在 1–10000 之间。' }); n = null; } }
      if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(gt)) errors.push({ field: 'fish', row: i, sub: 'g', code: 'row-g', message: '第 ' + no + ' 行的单条体重「' + gt + '」不是数字。' });
      else { g = Number(gt); if (g < 0.05 || g > 10000) { errors.push({ field: 'fish', row: i, sub: 'g', code: 'row-g-range', message: '第 ' + no + ' 行的单条体重要在 0.05–10000 g 之间。' }); g = null; } }
      return { name: name, n: n, g: g, rawN: nt, rawG: gt };
    });
  }

  /* ── 格式化（页面、排班表、导出、结果卡共用同一套口径） ── */
  function fmt(v, d) {
    if (v == null || !isFinite(v)) return '—';
    return Number(v).toFixed(d == null ? 2 : d);
  }
  /* 变量位：最多 d 位，去掉末尾多余的 0（12.00 → 12；35.9400 → 35.94） */
  function fmtV(v, d) {
    if (v == null || !isFinite(v)) return '—';
    var s = Number(v).toFixed(d == null ? 2 : d);
    if (s.indexOf('.') >= 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
    return s === '-0' ? '0' : s;
  }
  function fmtPct(frac, d) { return frac == null || !isFinite(frac) ? '—' : fmt(frac * 100, d == null ? 1 : d) + '%'; }
  function fmtDays(v, d) { return v == null || !isFinite(v) ? '—' : fmtV(v, d == null ? 1 : d); }

  /* 判「有没有越过上限」统一走这里：**相对**容差 1e-12。
   * 用绝对容差（比如 +1e-9）会把「临界比例再低一点点」误判成没越线 —— 实测过：
   * changePct = 临界值 − 1e-9 时峰值只比上限高 4.3e-10，绝对值容差会把它吞掉。 */
  function overLimit(x, lim) { return (x - lim) > Math.abs(lim) * 1e-12; }

  /* ── 主计算 ── */
  function compute(state) {
    state = state || defaultState();
    var errors = [], warnings = [], checks = [];

    /* 1. 标量字段 */
    var raw = {};
    EDITABLE.forEach(function (k) { raw[k] = parseNum(state[k], FIELDS[k], k, errors); });

    /* 2. 鱼的行 */
    var rows = parseRows(state.fish, errors);

    if (errors.length) {
      return {
        ok: false, errors: errors, warnings: [], checks: [],
        vols: null, load: null, rate: null, runway: null, steady: null,
        schedule: null, plan: null, levers: null, per: null
      };
    }

    /* 3. 几何 → 实际水量 */
    var vNom = raw.len * raw.wid * raw.hgt / 1000;
    var vSand = raw.len * raw.wid * raw.sandT / 1000;
    var vHead = raw.len * raw.wid * raw.headCm / 1000;
    var vDecor = raw.decorL;
    var V = vNom - vSand - vHead - vDecor;
    var vols = { nominal: vNom, sand: vSand, head: vHead, decor: vDecor, water: V };

    if (V <= 0) {
      /* 跨字段无解：指到三个占位里最大的那个，并说清是哪几项加起来超了 */
      var parts = [
        { key: 'sandT', val: vSand, label: '底砂' },
        { key: 'decorL', val: vDecor, label: '造景' },
        { key: 'headCm', val: vHead, label: '水面留空' }
      ].sort(function (a, b) { return b.val - a.val; });
      return {
        ok: false,
        errors: [{
          field: parts[0].key, code: 'no-water',
          message: '没有装水的空间了：标称容积 ' + fmt(vNom, 1) + ' L，底砂 ' + fmt(vSand, 1) + ' L + 造景 ' + fmt(vDecor, 1) +
            ' L + 留空 ' + fmt(vHead, 1) + ' L = ' + fmt(vSand + vDecor + vHead, 1) + ' L，已经不小于缸容。把底砂/造景/留空改小一点。'
        }],
        warnings: [], checks: [],
        vols: vols, load: null, rate: null, runway: null, steady: null,
        schedule: null, plan: null, levers: null, per: null
      };
    }

    /* 4. 负荷 */
    var fishMass = rows.reduce(function (s, r) { return s + r.n * r.g; }, 0);
    var feed = fishMass * raw.feedRate / 100;                     /* g/天 */
    var nFeed = feed * raw.protein / 100 / K.N_PER_PROTEIN * 1000; /* mg N/天 */
    var no3Pot = nFeed * K.NO3_PER_N;                             /* mg/天 */
    var no3In = no3Pot * raw.intoWater / 100;                     /* mg/天 */
    var no3Net = no3In - raw.plantUptake;                         /* mg/天 */
    /* 数值清理（不是模型）：净负荷相对进水小到 1e-12 量级时按 0 处理。
     * 不清理的话，「水草吸得正好等于进来的」这种输入会留下 1e-14 的残渣，
     * 「还能撑几天」就会算出 5.6e14 天这种读数（实测撞到过）。 */
    if (Math.abs(no3Net) <= Math.abs(no3In) * 1e-12) no3Net = 0;
    var a = no3Net / V;                                           /* mg/L/天 */
    var aT = a * raw.period;                                      /* mg/L/周期 */
    var load = {
      fishMass: fishMass, feed: feed, nFeed: nFeed, no3Pot: no3Pot,
      no3In: no3In, uptake: raw.plantUptake, no3Net: no3Net
    };
    var rate = { a: a, aT: aT, V: V, period: raw.period };

    /* 5. 还能撑几天（label / daysText 在这里一次算好：页面、结果卡、导出共用同一串字） */
    var runway;
    if (a <= 0) {
      runway = { status: 'no-rise', days: null, crossDay: null, daysText: '—', label: '按这套喂食量不会再涨' };
    } else if (raw.nowNo3 >= raw.maxNo3) {
      runway = { status: 'over', days: 0, crossDay: 0, daysText: '0', label: '今天的读数已经到你定的上限了' };
    } else {
      var d = (raw.maxNo3 - raw.nowNo3) / a;
      var txt = d < 0.5 ? '不到半天' : (d < 1 ? '不到 1 天' : (d > 3650 ? '10 年以上' : fmtV(d, 1) + ' 天'));
      runway = {
        status: 'days', days: d, crossDay: Math.ceil(d), daysText: txt,
        label: '不换水还能撑 ' + txt + (d >= 1 && d <= 3650 ? '（第 ' + Math.ceil(d) + ' 天越线）' : '')
      };
    }

    /* 6. 换水节奏的稳态 */
    var f = raw.changePct / 100;
    var steady;
    if (a <= 0) steady = { status: 'no-rise', f: f, peak: 0, trough: 0, verdict: 'ok', overBy: -raw.maxNo3 };
    else if (f <= 0) steady = { status: 'no-steady', f: f, peak: null, trough: null, verdict: 'over', overBy: null };
    else {
      var peak = aT / f, trough = aT * (1 - f) / f;
      steady = {
        status: 'ok', f: f, peak: peak, trough: trough,
        verdict: overLimit(peak, raw.maxNo3) ? 'over' : 'ok',
        overBy: peak - raw.maxNo3,
        ratioToMax: peak / raw.maxNo3
      };
    }

    /* 7. 排班递推（给定 f，从今天的读数开始） */
    function schedule(fx) {
      var out = [], after = raw.nowNo3, firstOver = null, firstBack = null;
      for (var k = 1; k <= K.CYCLES; k++) {
        var pk = after + aT;
        var over = overLimit(pk, raw.maxNo3);
        if (over && firstOver === null) firstOver = k;
        if (!over && firstBack === null && k > 1) firstBack = k;
        var af = pk * (1 - fx);
        out.push({ k: k, start: after, peak: pk, over: over, after: af, removed: pk - af });
        after = af;
      }
      return { rows: out, firstOver: firstOver, firstBack: firstBack, end: after };
    }
    var sched = steady.status === 'ok' ? schedule(f) : null;

    /* 8. 反解：建议节奏 + 四条路
     * 统一口径：目标稳态峰值 = maxNo3 / MARGIN（上限上留 10% 余量）。
     * f_req 是临界值（峰值正好等于上限），单独给出并标注「临界」。 */
    var target = raw.maxNo3 / K.MARGIN;
    var plan = null, levers = null;
    if (a > 0) {
      var fReq = aT / raw.maxNo3;
      var fSug = Math.min(K.F_MAX, fReq * K.MARGIN);
      var liters = fSug * V, buckets = Math.ceil(liters / raw.bucketL - 1e-9);
      var planSched = schedule(fSug);
      var peakAtSug = aT / fSug;
      /* 三档，页面必须分开说（实测撞到过：把「余量没留满」和「压不回上限」混成一档，
       * 自检会在明明达标的情况下报红）：A 达标且留满余量；B 达标但余量不足；
       * C 连本页建议上限 95% 都压不回上限（提示条负责说清楚）。 */
      var tier = fReq * K.MARGIN <= K.F_MAX ? 'A' : (fReq <= K.F_MAX ? 'B' : 'C');
      plan = {
        target: target, fReq: fReq, fReqPct: fReq * 100, fSug: fSug, fSugPct: fSug * 100,
        liters: liters, buckets: buckets,
        peakAtSug: peakAtSug,
        tier: tier,
        meetsLimit: !overLimit(peakAtSug, raw.maxNo3),
        marginMet: Math.abs(peakAtSug - target) < 1e-9,
        cappedByMax: tier !== 'A',
        schedule: planSched,
        litersNow: f * V, bucketsNow: f > 0 ? Math.ceil(f * V / raw.bucketL - 1e-9) : 0,
        monthlyNow: f > 0 ? (30 / raw.period) * f * V : 0,
        monthlySug: (30 / raw.period) * liters
      };

      /* 允许的每天涨幅：使 aT/f = target ⇒ a_allowed = f×target/period */
      var aAllowed = f * target / raw.period;
      var netAllowed = aAllowed * V;

      /* 路 2：少喂 —— 净负荷要降到 netAllowed ⇒ 允许进水 = netAllowed + uptake ⇒ 反推饲料 */
      var intoAllowed = netAllowed + raw.plantUptake;
      var potAllowed = intoAllowed / (raw.intoWater / 100);
      var nAllowed = potAllowed / K.NO3_PER_N;
      var feedAllowed = nAllowed / (raw.protein / 100) * K.N_PER_PROTEIN / 1000;  /* g/天 */
      var rateAllowed = fishMass > 0 ? feedAllowed / fishMass * 100 : null;       /* %体重/天 */
      /* 路 3：加水草 —— 吸收 = 进水 − 允许净负荷 */
      var uptakeNeed = no3In - netAllowed;
      /* 路 4：换更大的缸 —— V_req = 净负荷 / 允许涨幅
       * 页面上「换更大的缸」只能通过改长宽高来做，所以这里把「实际水量做到 V_req」反解成
       * 「长宽高等比例放大 r 倍（底砂厚度、水面留空、造景容积不变）」——
       * 注意 V_water(r) = r³·V_nom0 − r²·(V_sand0 + V_head0) − decorL 不是纯三次，用二分求 r。 */
      var vNeed = aAllowed > 0 ? no3Net / aAllowed : null;
      var scaleR = null, dims = null, scaleFits = false;
      if (vNeed != null && vNeed > V) {
        var waterAt = function (r) { return r * r * r * vNom - r * r * (vSand + vHead) - vDecor; };
        var lo = 1, hi = 1;
        while (waterAt(hi) < vNeed && hi < 1e6) hi *= 2;
        if (waterAt(hi) >= vNeed) {
          for (var it = 0; it < 200; it++) {
            var mid = (lo + hi) / 2;
            if (waterAt(mid) < vNeed) lo = mid; else hi = mid;
          }
          scaleR = (lo + hi) / 2;
          dims = {
            len: raw.len * scaleR, wid: raw.wid * scaleR, hgt: raw.hgt * scaleR,
            fit: raw.len * scaleR <= FIELDS.len.max && raw.wid * scaleR <= FIELDS.wid.max && raw.hgt * scaleR <= FIELDS.hgt.max
          };
          scaleFits = dims.fit;
        }
      }

      levers = {
        change: {
          feasible: true, nowPct: raw.changePct, toPct: fSug * 100,
          nowL: f * V, toL: liters, buckets: buckets
        },
        feed: {
          feasible: rateAllowed != null && rateAllowed < raw.feedRate - 1e-12 && feedAllowed > 0,
          alreadyOk: rateAllowed != null && rateAllowed >= raw.feedRate - 1e-12,
          nowPct: raw.feedRate, toPct: rateAllowed, nowG: feed, toG: feedAllowed,
          impossibleNoFeed: raw.intoWater <= 0
        },
        plant: {
          feasible: uptakeNeed > raw.plantUptake + 1e-12 && uptakeNeed < no3In,
          alreadyOk: uptakeNeed <= raw.plantUptake + 1e-12,
          nowMg: raw.plantUptake, toMg: uptakeNeed, ceiling: no3In
        },
        volume: {
          feasible: vNeed != null && vNeed > V + 1e-9 && scaleFits,
          alreadyOk: vNeed != null && vNeed <= V + 1e-9,
          tooBig: vNeed != null && vNeed > V + 1e-9 && !scaleFits,
          nowL: V, toL: vNeed, scale: scaleR, dims: dims,
          hugeFactor: vNeed != null ? vNeed / V : null
        },
        targetPeak: target
      };
    } else {
      plan = { status: 'no-rise', target: target };
      levers = { targetPeak: target, allOk: true };
    }

    /* 9. 提示（不阻断计算） */
    EDITABLE.forEach(function (k) {
      var f2 = FIELDS[k], v = raw[k];
      if (!f2.comfy) return;
      if (v < f2.comfy[0] || v > f2.comfy[1]) {
        warnings.push({ field: k, code: 'comfy', message: f2.label + ' 在常用区间 ' + f2.comfy[0] + '–' + f2.comfy[1] + ' ' + (f2.unit || '') + ' 之外，本页照算，但结果仅供参考。' });
      }
    });
    if (raw.changePct >= 100) warnings.push({ field: 'changePct', code: 'full-change', message: '每次换 100% 等于整缸换新水，鱼和硝化系统都受不了 —— 本页照算，但通常不该这么做。' });
    if (steady.status === 'ok' && plan && plan.fReq != null && steady.verdict === 'over') {
      if (plan.tier === 'B') {
        warnings.push({ field: 'changePct', code: 'cap-margin', message: '留满 ' + fmt((K.MARGIN - 1) * 100, 0) + '% 余量需要每次换 ' + fmt(plan.fReqPct * K.MARGIN, 1) + '%，超过本页建议的上限 ' + fmt(K.F_MAX * 100, 0) + '%；按 ' + fmt(plan.fSugPct, 1) + '% 换也能压回上限（' + fmt(plan.peakAtSug, 2) + ' mg/L），只是余量比 10% 小。' });
      } else if (plan.tier === 'C' && plan.fReq >= 1) {
        warnings.push({ field: 'maxNo3', code: 'cap-impossible', message: '就算每次把水全换掉（100%），换水前的峰值也会稳在 ' + fmt(aT, 2) + ' mg/L，还是超过你定的 ' + fmt(raw.maxNo3, 2) + ' mg/L —— 光靠换水压不住，得少喂、加水草或者换更大的缸。' });
      } else if (plan.tier === 'C') {
        warnings.push({ field: 'changePct', code: 'cap', message: '临界比例是 ' + fmt(plan.fReqPct, 1) + '%，已经超过本页建议的上限 ' + fmt(K.F_MAX * 100, 0) + '%（按 ' + fmt(K.F_MAX * 100, 0) + '% 换，峰值还是 ' + fmt(plan.peakAtSug, 2) + ' mg/L，压不到 ' + fmt(raw.maxNo3, 2) + ' 以内）：看看少喂 / 加水草 / 换大缸那三条。' });
      }
    }
    if (a <= 0) warnings.push({ field: 'plantUptake', code: 'absorb-enough', message: '水草吸走的已经不小于进来的（' + fmt(no3In, 1) + ' mg/天）：按这套喂食量，硝酸盐不会再涨。' });

    /* 10. 自检（页面「结构自检」区，每条都能在导出里看到） */
    function chk(name, pass, detail) { checks.push({ name: name, pass: !!pass, detail: detail || '' }); }
    chk('实际水量 = 标称 − 底砂 − 留空 − 造景',
      Math.abs(V - (vNom - vSand - vHead - vDecor)) < 1e-9,
      fmt(vNom, 1) + ' − ' + fmt(vSand, 1) + ' − ' + fmt(vHead, 1) + ' − ' + fmt(vDecor, 1) + ' = ' + fmt(V, 2) + ' L');
    chk('鱼总体重 = Σ 条数 × 单条体重',
      Math.abs(fishMass - rows.reduce(function (s, r) { return s + r.n * r.g; }, 0)) < 1e-9,
      rows.map(function (r) { return r.n + '×' + r.g; }).join(' + ') + ' = ' + fmt(fishMass, 1) + ' g');
    chk('每天涨幅 = 净负荷 ÷ 实际水量',
      Math.abs(a - no3Net / V) < 1e-12,
      fmt(no3Net, 2) + ' mg/天 ÷ ' + fmt(V, 2) + ' L = ' + fmt(a, 6) + ' mg/L/天');
    chk('稳态峰值 = 一个周期涨幅 ÷ 换水比例',
      steady.status !== 'ok' || Math.abs(steady.peak - aT / f) < 1e-9,
      steady.status === 'ok' ? fmt(aT, 4) + ' ÷ ' + fmt(f, 4) + ' = ' + fmt(steady.peak, 4) + ' mg/L' : '不适用（' + steady.status + '）');
    chk('峰值 − 谷值 = 一次换水带走的量',
      steady.status !== 'ok' || Math.abs((steady.peak - steady.trough) - steady.peak * f) < 1e-9,
      steady.status === 'ok' ? fmt(steady.peak, 4) + ' × ' + fmt(f, 4) + ' = ' + fmt(steady.peak * f, 4) + ' mg/L' : '不适用');
    chk('排班递推最后一周的峰值在向稳态峰值收敛',
      !sched || steady.status !== 'ok' || Math.abs(sched.rows[K.CYCLES - 1].peak - steady.peak) <= Math.abs(sched.rows[0].peak - steady.peak) + 1e-9,
      sched && steady.status === 'ok' ? '第 1 周峰值 ' + fmt(sched.rows[0].peak, 4) + ' → 第 ' + K.CYCLES + ' 周 ' + fmt(sched.rows[K.CYCLES - 1].peak, 4) + ' vs 稳态 ' + fmt(steady.peak, 4) : '不适用');
    chk('建议比例重算后峰值落在上限以内（余量留没留满单独判）',
      !plan || plan.status === 'no-rise' || (plan.tier === 'C'
        ? !plan.meetsLimit            /* 95% 都压不住：必须如实报「没达标」，由提示条说明，不能假装达标 */
        : (plan.meetsLimit && (plan.tier === 'B' || plan.marginMet))),
      plan && plan.status !== 'no-rise'
        ? fmt(aT, 4) + ' ÷ ' + fmt(plan.fSug, 6) + ' = ' + fmt(plan.peakAtSug, 4) + ' mg/L（上限 ' + fmt(raw.maxNo3, 1) + '；' +
          (plan.tier === 'A' ? '达标且留满余量' : plan.tier === 'B' ? '达标，余量不足' : '未达标，页面有提示') + '）'
        : '不适用');
    chk('四条反解路的目标都是同一个峰值',
      !levers || levers.allOk || Math.abs(levers.targetPeak - target) < 1e-12,
      levers && levers.change ? '目标峰值 = ' + fmt(raw.maxNo3, 2) + ' ÷ ' + K.MARGIN + ' = ' + fmt(target, 4) + ' mg/L' : '不适用');
    chk('换大缸那条路：按比例放大的缸，实际水量必须等于目标水量',
      !levers || !levers.volume || levers.volume.scale == null ||
        Math.abs((function () {
          var r = levers.volume.scale;
          return r * r * r * vNom - r * r * (vSand + vHead) - vDecor;
        })() - levers.volume.toL) < 1e-6,
      levers && levers.volume && levers.volume.scale != null
        ? '放大 ' + fmt(levers.volume.scale, 6) + ' 倍 → ' + fmt(levers.volume.dims.len, 1) + '×' + fmt(levers.volume.dims.wid, 1) + '×' + fmt(levers.volume.dims.hgt, 1) + ' cm，水量 ' + fmt(levers.volume.toL, 2) + ' L'
        : '不适用');

    return {
      ok: true, errors: [], warnings: warnings, checks: checks,
      vols: vols, load: load, rate: rate, runway: runway, steady: steady,
      schedule: sched, plan: plan, levers: levers, raw: raw, rows: rows, fishMass: fishMass,
      per: { cycle: raw.period, litersNow: f * V, litersSug: plan && plan.liters != null ? plan.liters : null }
    };
  }

  /* ── 导出 ── */
  function stampText(d) {
    var p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes()) + ':' + p(d.getSeconds());
  }
  function toCSV(state, out, now) {
    var L = [];
    L.push('这缸水还能撑几天 · 导出');
    L.push('导出时间,' + stampText(now || new Date()));
    L.push('说明,本页只算硝酸盐的累积与换水节奏；默认场景与内置预设全部是虚构示例；不做鱼病/氨氮/能不能养的判断');
    if (!out.ok) {
      L.push('状态,算不出来');
      out.errors.forEach(function (e) { L.push('错误,' + csvCell(e.message)); });
      return L.join('\r\n') + '\r\n';
    }
    var v = out.vols, ld = out.load, r = out.rate;
    L.push('');
    L.push('一、缸与水量');
    L.push('项目,数值,单位');
    L.push('缸内长×宽×高,' + state.len + '×' + state.wid + '×' + state.hgt + ',cm');
    L.push('标称容积,' + fmt(v.nominal, 2) + ',L');
    L.push('底砂占,' + fmt(v.sand, 2) + ',L');
    L.push('水面留空占,' + fmt(v.head, 2) + ',L');
    L.push('造景占,' + fmt(v.decor, 2) + ',L');
    L.push('实际水量,' + fmt(v.water, 2) + ',L');
    L.push('');
    L.push('二、负荷');
    L.push('鱼总体重,' + fmt(ld.fishMass, 2) + ',g');
    L.push('每天饲料,' + fmt(ld.feed, 4) + ',g/天');
    L.push('饲料里的氮,' + fmt(ld.nFeed, 4) + ',mg N/天');
    L.push('潜在硝酸盐,' + fmt(ld.no3Pot, 4) + ',mg/天');
    L.push('真正进水,' + fmt(ld.no3In, 4) + ',mg/天');
    L.push('水草吸走,' + fmt(ld.uptake, 2) + ',mg/天');
    L.push('净负荷,' + fmt(ld.no3Net, 4) + ',mg/天');
    L.push('每天涨,' + fmt(r.a, 6) + ',mg/L/天');
    L.push('一个周期涨,' + fmt(r.aT, 6) + ',mg/L');
    L.push('');
    L.push('三、结论');
    L.push('内容,数值');
    if (out.runway.status === 'no-rise') L.push('不换水还能撑,按这套喂食量不会再涨');
    else if (out.runway.status === 'over') L.push('不换水还能撑,已经超了');
    else L.push('不换水还能撑,' + fmt(out.runway.days, 3) + ' 天（第 ' + out.runway.crossDay + ' 天越线）');
    if (out.steady.status === 'no-steady') L.push('现状节奏稳态,不换水没有稳态');
    else if (out.steady.status === 'no-rise') L.push('现状节奏稳态,0（不会再涨）');
    else {
      L.push('现状峰值（换水前）,' + fmt(out.steady.peak, 4) + ' mg/L');
      L.push('现状谷值（换水后）,' + fmt(out.steady.trough, 4) + ' mg/L');
      L.push('上限,' + fmt(out.raw.maxNo3, 2) + ' mg/L');
    }
    if (out.plan && out.plan.fSug != null) {
      L.push('临界换水比例,' + fmtPct(out.plan.fReq, 2));
      L.push('建议换水比例,' + fmtPct(out.plan.fSug, 2));
      L.push('建议每次换水量,' + fmt(out.plan.liters, 2) + ' L（' + out.plan.buckets + ' 桶）');
      L.push('建议稳态峰值,' + fmt(out.plan.peakAtSug, 4) + ' mg/L');
      L.push('建议是否达标,' + (out.plan.meetsLimit ? '达标' : '未达标') + '（' +
        (out.plan.tier === 'A' ? '留满 ' + fmt((K.MARGIN - 1) * 100, 0) + '% 余量' : out.plan.tier === 'B' ? '达标但余量不足' : '连本页建议上限 ' + fmt(K.F_MAX * 100, 0) + '% 都压不回上限') + '）');
    }
    L.push('');
    L.push('四、排班表（现状节奏）');
    L.push('周次,期初读数 mg/L,换水前 mg/L,是否越线,换水后 mg/L');
    if (out.schedule) out.schedule.rows.forEach(function (x) {
      L.push([x.k, fmt(x.start, 4), fmt(x.peak, 4), x.over ? '越线' : '未越线', fmt(x.after, 4)].join(','));
    });
    if (out.plan && out.plan.schedule) {
      L.push('');
      L.push('五、排班表（建议节奏 ' + fmtPct(out.plan.fSug, 2) + '）');
      L.push('周次,期初读数 mg/L,换水前 mg/L,是否越线,换水后 mg/L');
      out.plan.schedule.rows.forEach(function (x) {
        L.push([x.k, fmt(x.start, 4), fmt(x.peak, 4), x.over ? '越线' : '未越线', fmt(x.after, 4)].join(','));
      });
    }
    L.push('');
    L.push('六、四条路（都按上限留 ' + fmt((K.MARGIN - 1) * 100, 0) + '% 余量算）');
    if (out.levers && out.levers.change) {
      var lv = out.levers;
      L.push('换水比例,' + fmt(lv.change.nowPct, 2) + '% → ' + fmt(lv.change.toPct, 2) + '%（每次 ' + fmt(lv.change.nowL, 2) + ' → ' + fmt(lv.change.toL, 2) + ' L）');
      L.push('投喂率,' + fmt(lv.feed.nowPct, 4) + '% → ' + (lv.feed.feasible ? fmt(lv.feed.toPct, 4) + '%（' + fmt(lv.feed.nowG, 4) + ' → ' + fmt(lv.feed.toG, 4) + ' g/天）' : '当前节奏下这条路走不通'));
      L.push('水草吸收,' + fmt(lv.plant.nowMg, 2) + ' → ' + (lv.plant.feasible ? fmt(lv.plant.toMg, 2) + ' mg/天' : '当前节奏下这条路走不通') + '（上限 ' + fmt(lv.plant.ceiling, 2) + '，不能超过进水总量）');
      L.push('实际水量,' + fmt(lv.volume.nowL, 2) + ' → ' + (lv.volume.feasible ? fmt(lv.volume.toL, 2) + ' L' : '当前节奏下这条路走不通'));
    }
    return '\ufeff' + L.join('\r\n') + '\r\n';   /* BOM：Excel 直接打开中文不乱码 */
  }
  function csvCell(s) {
    s = String(s == null ? '' : s);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toMarkdown(state, out, now) {
    var L = [];
    L.push('# 这缸水还能撑几天 · 小结');
    L.push('');
    L.push('- 导出时间：' + stampText(now || new Date()));
    L.push('- 说明：本页只算硝酸盐的累积与换水节奏。默认与预设场景**全部是虚构示例**；不判断能不能养、不预测氨氮/亚硝酸盐、不涉及鱼病。');
    if (!out.ok) {
      L.push('');
      L.push('## 这次算不出来');
      out.errors.forEach(function (e) { L.push('- ' + e.message); });
      return L.join('\n') + '\n';
    }
    var v = out.vols, ld = out.load, r = out.rate;
    L.push('');
    L.push('## 结论');
    if (out.runway.status === 'no-rise') L.push('- 不换水还能撑：**按这套喂食量不会再涨**');
    else if (out.runway.status === 'over') L.push('- 不换水还能撑：**已经超过你定的上限**');
    else L.push('- 不换水还能撑：**' + fmt(out.runway.days, 2) + ' 天**（第 ' + out.runway.crossDay + ' 天越线）');
    if (out.steady.status === 'ok') {
      L.push('- 现状节奏（每 ' + fmt(r.period, 0) + ' 天换 ' + fmtPct(out.steady.f, 1) + '）峰值稳态：**' + fmt(out.steady.peak, 2) + ' mg/L**' +
        (out.steady.verdict === 'over' ? '（超出上限 ' + fmt(out.steady.overBy, 2) + ' mg/L）' : '（在上限以内）'));
      L.push('- 谷值稳态：' + fmt(out.steady.trough, 2) + ' mg/L；上限：' + fmt(out.raw.maxNo3, 2) + ' mg/L');
    } else if (out.steady.status === 'no-steady') L.push('- 现状节奏：换水比例是 0，没有稳态，浓度会一直涨。');
    else L.push('- 现状节奏：按这套喂食量不会再涨，稳态是 0。');
    L.push('');
    L.push('## 证据');
    L.push('- 实际水量 **' + fmt(v.water, 2) + ' L** = 标称 ' + fmt(v.nominal, 2) + ' − 底砂 ' + fmt(v.sand, 2) + ' − 留空 ' + fmt(v.head, 2) + ' − 造景 ' + fmt(v.decor, 2));
    L.push('- 鱼总体重 ' + fmt(ld.fishMass, 2) + ' g → 每天饲料 ' + fmt(ld.feed, 4) + ' g → 饲料氮 ' + fmt(ld.nFeed, 4) + ' mg N/天');
    L.push('- 潜在硝酸盐 ' + fmt(ld.no3Pot, 4) + ' mg/天 × ' + fmt(state.intoWater, 0) + '% = 进水 ' + fmt(ld.no3In, 4) + ' mg/天；减水草 ' + fmt(ld.uptake, 2) + ' → 净负荷 **' + fmt(ld.no3Net, 4) + ' mg/天**');
    L.push('- 每天涨 **' + fmt(r.a, 6) + ' mg/L**；每 ' + fmt(r.period, 0) + ' 天涨 **' + fmt(r.aT, 6) + ' mg/L**');
    L.push('');
    if (out.plan && out.plan.fSug != null) {
      L.push('## 建议（上限 ' + fmt(out.raw.maxNo3, 2) + ' 留 ' + fmt((K.MARGIN - 1) * 100, 0) + '% 余量 ⇒ 目标峰值 ' + fmt(out.plan.target, 2) + ' mg/L）');
      L.push('- 临界换水比例 **' + fmtPct(out.plan.fReq, 2) + '**（按它峰值正好贴上上限，不会再低）');
      L.push('- 建议换水比例 **' + fmtPct(out.plan.fSug, 2) + '**，每次 **' + fmt(out.plan.liters, 2) + ' L（' + out.plan.buckets + ' 桶）**，稳态峰值 ' + fmt(out.plan.peakAtSug, 2) + ' mg/L');
      L.push('- 这个建议' + (out.plan.meetsLimit ? '**达标**' : '**未达标**') + '：' +
        (out.plan.tier === 'A' ? '留满了 ' + fmt((K.MARGIN - 1) * 100, 0) + '% 余量' :
          out.plan.tier === 'B' ? '能压回上限，但余量比 ' + fmt((K.MARGIN - 1) * 100, 0) + '% 小' :
            '连本页建议的上限 ' + fmt(K.F_MAX * 100, 0) + '% 都压不回上限，得靠下面那三条'))
      L.push('- 排班：现状第 ' + (out.schedule && out.schedule.firstOver ? out.schedule.firstOver : '—') + ' 周就第一次越线；建议节奏第 ' +
        (out.plan.schedule && out.plan.schedule.firstBack ? out.plan.schedule.firstBack : '—') + ' 周回到上限以内');
      var lv = out.levers;
      L.push('- 不想换这么多水，还有三条（保持现状节奏不变）：');
      L.push('  - 投喂率 ' + fmt(lv.feed.nowPct, 4) + '% → ' + (lv.feed.feasible ? '**' + fmt(lv.feed.toPct, 4) + '%**' : '（走不通）'));
      L.push('  - 水草吸收 ' + fmt(lv.plant.nowMg, 2) + ' → ' + (lv.plant.feasible ? '**' + fmt(lv.plant.toMg, 2) + ' mg/天**' : '（走不通）'));
      L.push('  - 实际水量 ' + fmt(lv.volume.nowL, 2) + ' → ' + (lv.volume.feasible ? '**' + fmt(lv.volume.toL, 2) + ' L**' : '（走不通）'));
    }
    L.push('');
    L.push('## 排班表（现状节奏）');
    L.push('| 周次 | 期初 | 换水前 | 是否越线 | 换水后 |');
    L.push('|---|---|---|---|---|');
    if (out.schedule) out.schedule.rows.forEach(function (x) {
      L.push('| ' + x.k + ' | ' + fmt(x.start, 3) + ' | ' + fmt(x.peak, 3) + ' | ' + (x.over ? '**越线**' : '未越线') + ' | ' + fmt(x.after, 3) + ' |');
    });
    if (out.plan && out.plan.schedule) {
      L.push('');
      L.push('## 排班表（建议节奏 ' + fmtPct(out.plan.fSug, 2) + '）');
      L.push('| 周次 | 期初 | 换水前 | 是否越线 | 换水后 |');
      L.push('|---|---|---|---|---|');
      out.plan.schedule.rows.forEach(function (x) {
        L.push('| ' + x.k + ' | ' + fmt(x.start, 3) + ' | ' + fmt(x.peak, 3) + ' | ' + (x.over ? '**越线**' : '未越线') + ' | ' + fmt(x.after, 3) + ' |');
      });
    }
    L.push('');
    L.push('## 结构自检');
    out.checks.forEach(function (c) { L.push('- ' + (c.pass ? '✅' : '❌') + ' ' + c.name + (c.detail ? '：' + c.detail : '')); });
    L.push('');
    L.push('## 边界');
    L.push('- 不判断能不能养、养几条合适、鱼健不健康；上限是你自己填的数。');
    L.push('- 不预测氨氮与亚硝酸盐峰值，不模拟开缸养水过程，不涉及鱼病与用药。');
    L.push('- pH / 硬度 / 温度 / 溶解氧 / 反硝化都不在模型里；水草吸收按固定 mg/天（不随浓度变）。');
    L.push('- 蛋白含氮 16%（÷6.25）、氮→硝酸盐 62/14、进水系数、' + fmt((K.MARGIN - 1) * 100, 0) + '% 余量都是**本页假设值**，不引用任何机构或标准。');
    L.push('- AI 自行复核，未做人工校核。');
    return L.join('\n') + '\n';
  }

  function toJSON(state, out, now) {
    return JSON.stringify({
      app: '这缸水还能撑几天', slug: 'tank-days',
      exported_at: (now || new Date()).toISOString(),
      note: '本文件是输入 + 这一次计算的完整快照；默认与预设场景全部是虚构示例。',
      state: state,
      out: out
    }, null, 2);
  }

  root.AppCore = {
    K: K, FIELDS: FIELDS, ORDER: ORDER, EDITABLE: EDITABLE, PRESETS: PRESETS,
    defaultState: defaultState, stateFromPreset: stateFromPreset, presetKey: presetKey,
    compute: compute, fmt: fmt, fmtV: fmtV, fmtPct: fmtPct, fmtDays: fmtDays,
    toCSV: toCSV, toMarkdown: toMarkdown, toJSON: toJSON
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.AppCore;
})(typeof window !== 'undefined' ? window : (typeof globalThis !== 'undefined' ? globalThis : this));
