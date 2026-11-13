/* 这缸水还能撑几天 · 界面层（ui.js）
 * 只做两件事：把 AppCore.compute 的结果画出来、把用户的点击改回输入。
 * 纪律：页面上出现的每个数字都来自同一次 compute 的输出（或用户自己填的原文），
 *       这里不另算一遍、不写死任何数值。导出用的也是同一个 out（不是再算一次）。
 * 全程用字符串拼接，不用模板字面量：`\*` 这类转义会被吞掉（批次 63 踩过）。
 */
(function () {
  'use strict';
  var C = window.AppCore;
  var $ = function (id) { return document.getElementById(id); };
  var LSKEY = 'tank-days-v1';
  var state = C.defaultState();
  var out = null;
  var saveTimer = null;

  var GROUPS = [
    { host: 'g-tank', keys: ['len', 'wid', 'hgt'] },
    { host: 'g-fill', keys: ['sandT', 'decorL', 'headCm'] },
    { host: 'g-feed', keys: ['fishMass', 'feedRate'] },
    { host: 'g-load', keys: ['protein', 'intoWater', 'plantUptake'] },
    { host: 'g-target', keys: ['nowNo3', 'maxNo3'] },
    { host: 'g-change', keys: ['period', 'changePct', 'bucketL'] }
  ];

  var HINTS = {
    len: '量缸内壁到内壁的长度，不是外框。',
    wid: '量缸内壁的宽度。',
    hgt: '量缸内的总高度（从缸底内面到缸口）。',
    sandT: '底砂铺了多厚。它会实打实占掉一部分容积。',
    decorL: '石头/沉木/造景一共占掉多少升。拿不准就按「几块石头大概几升」估一个。',
    headCm: '水面离缸口留了几厘米（防跳缸、防溢出）。这段也不装水。',
    fishMass: '这一栏是自动加出来的（条数 × 单条体重），改上面的行就会变。',
    feedRate: '每天喂的饲料占鱼总体重的百分之几。2% 是很常见的量，喂多了这项要调高。',
    protein: '饲料包装上写的粗蛋白含量。本页假设蛋白含氮 16%（即 ÷6.25）。',
    intoWater: '饲料里的氮有多少最终变成水里的硝酸盐（其余假设被鱼长身体留住了）。本页假设值，可改。',
    plantUptake: '水草每天从水里吸走多少硝酸盐（整缸合计）。按固定值算，不随浓度变化。',
    nowNo3: '你最近一次测到的硝酸盐读数。',
    maxNo3: '你希望换水前的读数不要超过多少 —— 这个数由你定，本页不做「安全浓度」判断。',
    period: '你打算多少天换一次水。',
    changePct: '每次换掉实际水量的百分之几（按实际水量，不是标称容积）。',
    bucketL: '你手上那个桶多少升 —— 只用来算「要提几桶」。'
  };

  var RAMP = '<span class="swatch" style="background:#cfe9ee;border:1px solid #a9d3da"></span>';
  var RSAND = '<span class="swatch" style="background:#dccba4;border:1px solid #c0ab7d"></span>';
  var RDECOR = '<span class="swatch" style="background:#a9b3ae;border:1px solid #8e9995"></span>';
  var RAIR = '<span class="swatch" style="background:#f4f8f9;border:1px dashed #b9ccd1"></span>';

  /* ── 表单 ── */
  function buildInputs() {
    GROUPS.forEach(function (g) {
      var host = $(g.host);
      host.innerHTML = '';
      g.keys.forEach(function (k) {
        var f = C.FIELDS[k];
        var d = document.createElement('div');
        d.className = 'f' + (f.derivedInput ? ' ro' : '');
        d.id = 'f_' + k;
        var lab = document.createElement('label');
        lab.setAttribute('for', 'i_' + k);
        lab.innerHTML = f.label + '<i>' + (f.unit || '') + '</i>';
        var inp = document.createElement('input');
        inp.id = 'i_' + k;
        inp.type = 'text';
        inp.inputMode = 'decimal';
        inp.autocomplete = 'off';
        inp.setAttribute('aria-label', f.label + (f.unit ? '（' + f.unit + '）' : ''));
        inp.title = HINTS[k] || '';
        if (f.derivedInput) { inp.readOnly = true; inp.tabIndex = -1; }
        else {
          inp.addEventListener('input', function () {
            state[k] = inp.value;
            render(false);
            queueSave();
          });
        }
        var msg = document.createElement('div');
        msg.className = 'msg';
        msg.id = 'm_' + k;
        d.appendChild(lab); d.appendChild(inp); d.appendChild(msg);
        host.appendChild(d);
      });
    });
  }

  function fishRowNode(r, i) {
    var row = document.createElement('div');
    row.className = 'fishrow';
    row.id = 'fish_' + i;
    [['name', '是什么鱼', 'text'], ['n', '条数', 'decimal'], ['g', '单条体重 g', 'decimal']].forEach(function (spec) {
      var wrap = document.createElement('div');
      wrap.className = 'f';
      wrap.id = 'frow_' + i + '_' + spec[0];
      var lab = document.createElement('label');
      lab.setAttribute('for', 'fi_' + i + '_' + spec[0]);
      lab.textContent = spec[1];
      var inp = document.createElement('input');
      inp.id = 'fi_' + i + '_' + spec[0];
      inp.type = 'text';
      inp.inputMode = spec[2];
      inp.autocomplete = 'off';
      inp.value = String(r[spec[0]] == null ? '' : r[spec[0]]);
      inp.setAttribute('aria-label', '第 ' + (i + 1) + ' 行 ' + spec[1]);
      inp.addEventListener('input', function () {
        state.fish[i][spec[0]] = inp.value;
        render(false);
        queueSave();
      });
      var msg = document.createElement('div');
      msg.className = 'msg';
      wrap.appendChild(lab); wrap.appendChild(inp); wrap.appendChild(msg);
      row.appendChild(wrap);
    });
    var del = document.createElement('button');
    del.type = 'button';
    del.className = 'btn ghost mini';
    del.id = 'fishDel_' + i;
    del.textContent = '删掉这行';
    del.title = '把这一行鱼去掉';
    del.addEventListener('click', function () {
      state.fish.splice(i, 1);
      if (!state.fish.length) state.fish.push({ name: '鱼', n: '1', g: '1' });
      render(true);
      queueSave();
    });
    row.appendChild(del);
    return row;
  }

  function buildFishRows() {
    var host = $('fishRows');
    host.innerHTML = '';
    state.fish.forEach(function (r, i) { host.appendChild(fishRowNode(r, i)); });
  }

  function buildPresets() {
    var bar = $('presetBar');
    bar.innerHTML = '<span class="lb muted">试一个虚构场景：</span>';
    C.PRESETS.forEach(function (p) {
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.id = 'preset_' + p.key;
      b.textContent = p.name;
      b.title = p.note;
      b.addEventListener('click', function () {
        state = C.stateFromPreset(p.key);
        render(true);
        queueSave();
        $('saveTag').textContent = '已切到预设：' + p.name;
      });
      bar.appendChild(b);
    });
  }

  /* ── 渲染 ── */
  function render(full) {
    if (full) { syncInputs(); buildFishRows(); }
    out = C.compute(state);
    markInputs();
    renderErrors();
    renderWarnings();
    renderSandbox();
    renderHeadline();
    renderConclusion();
    renderSchedules();
    renderChecks();
    renderBoundary();
    highlightPreset();
  }

  function syncInputs() {
    C.EDITABLE.forEach(function (k) { var el = $('i_' + k); if (el) el.value = state[k]; });
  }
  function markInputs() {
    C.EDITABLE.forEach(function (k) {
      var box = $('f_' + k);
      if (!box) return;
      var bad = out.errors.some(function (e) { return e.field === k; });
      var warn = !bad && out.warnings.some(function (w) { return w.field === k; });
      box.classList.toggle('bad', bad);
      var msg = $('m_' + k);
      if (msg) {
        var e = out.errors.filter(function (x) { return x.field === k; })[0];
        var w = out.warnings.filter(function (x) { return x.field === k; })[0];
        msg.textContent = e ? e.message : (warn && w ? w.message : '');
        msg.style.display = e ? 'block' : 'none';
      }
    });
    /* 鱼的行：把该行的错标出来 */
    state.fish.forEach(function (r, i) {
      [['name'], ['n'], ['g']].forEach(function (s) {
        var box = $('frow_' + i + '_' + s[0]);
        if (!box) return;
        var e = out.errors.filter(function (x) { return x.field === 'fish' && x.row === i && x.sub === s[0]; })[0];
        box.classList.toggle('bad', !!e);
        var m = box.querySelector('.msg');
        if (m) { m.textContent = e ? e.message : ''; m.style.display = e ? 'block' : 'none'; }
      });
    });
    var fm = $('i_fishMass');
    if (fm) fm.value = out.ok ? C.fmtV(out.load.fishMass, 2) + ' g' : '—';
  }

  function renderErrors() {
    var bar = $('errBar'), list = $('errList');
    if (out.ok) { bar.classList.add('hide'); list.innerHTML = ''; return; }
    bar.classList.remove('hide');
    list.innerHTML = '';
    var seen = {};
    out.errors.forEach(function (e) {
      if (seen[e.message]) return;
      seen[e.message] = 1;
      var li = document.createElement('li');
      li.textContent = e.message;
      list.appendChild(li);
    });
  }
  function renderWarnings() {
    var bar = $('warnBar'), list = $('warnList');
    if (out.ok && out.warnings.length) {
      bar.classList.remove('hide'); list.innerHTML = '';
      out.warnings.forEach(function (w) {
        var li = document.createElement('li');
        li.textContent = w.message;
        list.appendChild(li);
      });
    } else { bar.classList.add('hide'); list.innerHTML = ''; }
  }

  /* ── 沙盘（按内径比例画剖面） ── */
  function renderSandbox() {
    var svg = $('tankSvg');
    var note = $('sandboxNote');
    var rows = $('volRows');
    if (!out.ok) {
      svg.innerHTML = '<rect x="1" y="1" width="658" height="338" rx="12" fill="#f6fafb" stroke="#d7e4e8"/>' +
        '<text x="330" y="170" text-anchor="middle" font-size="16" fill="#6b8590">这几格还没填对，缸暂时画不出来。</text>';
      rows.innerHTML = '<tr><td colspan="2" class="muted wrapcell">' + (out.errors[0] ? out.errors[0].message : '') + '</td></tr>';
      note.textContent = '';
      return;
    }
    var v = out.vols, R = out.raw;
    var PADL = 48, PADR = 28, PADT = 34, PADB = 42;
    var maxW = 660 - PADL - PADR, maxH = 340 - PADT - PADB;
    var s = Math.min(maxW / R.len, maxH / R.hgt);
    var w = R.len * s, h = R.hgt * s;
    var x0 = PADL + (maxW - w) / 2, y0 = PADT + (maxH - h) / 2;
    var yBot = y0 + h;
    var sandTop = yBot - R.sandT * s;
    var waterTop = y0 + R.headCm * s;
    var decorH = v.decor * 1000 / (R.len * R.wid);   /* 折算成剖面里的等效高度（cm） */
    var decorTop = Math.max(sandTop - decorH * s, waterTop);
    var dw = Math.min(w * 0.34, 150);
    var dx = x0 + w * 0.56;
    var p = [];
    p.push('<defs>');
    p.push('<pattern id="sandHatch" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(35)">');
    p.push('<rect width="7" height="7" fill="#dccba4"/><line x1="0" y1="0" x2="0" y2="7" stroke="#c8b285" stroke-width="2"/></pattern>');
    p.push('</defs>');
    /* 缸内背景（空的部分） */
    p.push('<rect x="' + x0 + '" y="' + y0 + '" width="' + w + '" height="' + h + '" fill="#f7fbfc"/>');
    /* 水 */
    if (sandTop > waterTop) {
      p.push('<rect x="' + x0 + '" y="' + waterTop + '" width="' + w + '" height="' + (sandTop - waterTop) + '" fill="#cfe9ee"/>');
    }
    /* 造景（等效体积化成一个剖面块） */
    p.push('<path d="M' + dx + ' ' + sandTop + ' L' + (dx + dw * 0.18) + ' ' + decorTop + ' L' + (dx + dw * 0.62) + ' ' + (decorTop + decorH * s * 0.25) +
      ' L' + (dx + dw) + ' ' + sandTop + ' Z" fill="#a9b3ae" stroke="#8e9995"/>');
    /* 底砂 */
    if (R.sandT > 0) p.push('<rect x="' + x0 + '" y="' + sandTop + '" width="' + w + '" height="' + (yBot - sandTop) + '" fill="url(#sandHatch)"/>');
    /* 水面线 */
    p.push('<line x1="' + (x0 - 12) + '" y1="' + waterTop + '" x2="' + (x0 + w + 12) + '" y2="' + waterTop + '" stroke="#4a9aa8" stroke-width="2" stroke-dasharray="7 5"/>');
    /* 缸壁 */
    p.push('<rect x="' + x0 + '" y="' + y0 + '" width="' + w + '" height="' + h + '" fill="none" stroke="#12333f" stroke-width="3" rx="3"/>');
    /* 真实水量大字 */
    var midY = (Math.max(waterTop, y0) + sandTop) / 2;
    p.push('<text x="' + (x0 + w / 2) + '" y="' + (midY - 6) + '" text-anchor="middle" font-size="15" fill="#12333f">实际装的水</text>');
    p.push('<text x="' + (x0 + w / 2) + '" y="' + (midY + 26) + '" text-anchor="middle" font-size="26" font-weight="700" fill="#0f5f6c" font-family="ui-monospace,Menlo,monospace">' + C.fmtV(v.water, 1) + ' L</text>');
    /* 留空标注 */
    p.push('<line x1="' + (x0 - 10) + '" y1="' + y0 + '" x2="' + (x0 - 10) + '" y2="' + waterTop + '" stroke="#8fa8ae" stroke-width="1.5"/>');
    p.push('<text x="' + (x0 - 14) + '" y="' + ((y0 + waterTop) / 2 + 4) + '" text-anchor="end" font-size="12.5" fill="#6b8590">留空 ' + C.fmtV(R.headCm, 2) + ' cm</text>');
    /* 底砂标注 */
    p.push('<line x1="' + (x0 - 10) + '" y1="' + sandTop + '" x2="' + (x0 - 10) + '" y2="' + yBot + '" stroke="#8fa8ae" stroke-width="1.5"/>');
    p.push('<text x="' + (x0 - 14) + '" y="' + (sandTop - 6) + '" text-anchor="end" font-size="12.5" fill="#6b8590">底砂 ' + C.fmtV(R.sandT, 2) + ' cm</text>');
    /* 造景标注 */
    p.push('<line x1="' + (dx + dw * 0.5) + '" y1="' + decorTop + '" x2="' + (dx + dw * 0.5) + '" y2="' + (decorTop - 14) + '" stroke="#8fa8ae" stroke-width="1.5"/>');
    p.push('<text x="' + (dx + dw * 0.5) + '" y="' + (decorTop - 18) + '" text-anchor="middle" font-size="12.5" fill="#6b8590">造景 ' + C.fmtV(v.decor, 2) + ' L</text>');
    /* 尺寸底线 */
    p.push('<text x="' + (x0 + w / 2) + '" y="' + (yBot + 22) + '" text-anchor="middle" font-size="12.5" fill="#6b8590">内径 ' + C.fmtV(R.len, 1) + ' × ' + C.fmtV(R.wid, 1) + ' × ' + C.fmtV(R.hgt, 1) + ' cm（标称 ' + C.fmtV(v.nominal, 1) + ' L）</text>');
    svg.innerHTML = p.join('');

    rows.innerHTML = ''
      + '<tr><td>' + RAIR + '标称容积（长×宽×高）</td><td>' + C.fmt(v.nominal, 2) + ' L</td></tr>'
      + '<tr><td>' + RSAND + '− 底砂</td><td>' + C.fmt(v.sand, 2) + ' L</td></tr>'
      + '<tr><td>' + RDECOR + '− 造景/石头/沉木</td><td>' + C.fmt(v.decor, 2) + ' L</td></tr>'
      + '<tr><td>' + RAIR + '− 水面留空</td><td>' + C.fmt(v.head, 2) + ' L</td></tr>'
      + '<tr class="sum"><td>' + RAMP + '＝ 实际装的水</td><td>' + C.fmt(v.water, 2) + ' L</td></tr>';
    note.textContent = '按比例画的侧视示意：造景那一块是把 ' + C.fmtV(v.decor, 2) + ' L 换算成剖面里的一块面积（折算高度约 ' + C.fmtV(decorH, 2) + ' cm），真实石头形状并不长这样。';
  }

  /* ── 顶部三行 ── */
  function renderHeadline() {
    var d = $('hlDays'), ds = $('hlDaysSub'), pk = $('hlPeak'), pks = $('hlPeakSub'), ch = $('hlChange'), chs = $('hlChangeSub');
    if (!out.ok) {
      d.textContent = '—'; ds.textContent = '先改上面的错误'; pk.textContent = '—'; pks.textContent = '';
      ch.textContent = '—'; chs.textContent = ''; return;
    }
    d.textContent = out.runway.status === 'days' ? out.runway.daysText : (out.runway.status === 'over' ? '0 天' : '∞');
    ds.textContent = out.runway.status === 'days'
      ? '从 ' + C.fmtV(out.raw.nowNo3, 1) + ' 涨到上限 ' + C.fmtV(out.raw.maxNo3, 1) + ' mg/L（第 ' + out.runway.crossDay + ' 天越线）'
      : (out.runway.status === 'over' ? '今天的读数已经到上限了' : '按这套喂食量不会再涨（水草吸得比进来的多）');

    if (out.steady.status === 'ok') {
      pk.innerHTML = C.fmtV(out.steady.peak, 1) + ' <span style="font-size:17px">mg/L</span>' +
        '<span class="pill ' + (out.steady.verdict === 'over' ? 'bad' : 'ok') + '">' + (out.steady.verdict === 'over' ? '超上限' : '在上限内') + '</span>';
      pks.textContent = '每 ' + C.fmtV(out.raw.period, 0) + ' 天换 ' + C.fmtPct(out.steady.f, 1) + '；上限 ' + C.fmtV(out.raw.maxNo3, 1) +
        '，' + (out.steady.verdict === 'over' ? '高出 ' + C.fmtV(out.steady.overBy, 1) + ' mg/L' : '还差 ' + C.fmtV(-out.steady.overBy, 1) + ' mg/L');
    } else if (out.steady.status === 'no-steady') {
      pk.textContent = '不换水 → 没有上限';
      pks.textContent = '换水比例是 0：浓度会一直涨，没有稳态可言';
    } else {
      pk.textContent = '不会涨';
      pks.textContent = '水草吸走的已经不小于进来的';
    }

    if (out.plan && out.plan.fSug != null) {
      ch.innerHTML = C.fmtV(out.plan.fSugPct, 1) + '<span style="font-size:17px">%</span>';
      chs.textContent = '每 ' + C.fmtV(out.raw.period, 0) + ' 天换 ' + C.fmtV(out.plan.liters, 1) + ' L（' + out.plan.buckets + ' 桶）' +
        '｜现在 ' + C.fmtV(out.plan.litersNow, 1) + ' L（' + out.plan.bucketsNow + ' 桶）';
    } else {
      ch.textContent = '不用换'; chs.textContent = '按这套喂食量不会再涨';
    }
  }

  /* ── 结论 / 证据 / 四条路 / 边界 ── */
  function renderConclusion() {
    var big = $('conclBig'), verd = $('conclVerdict'), ev = $('evidence'), lv = $('levers');
    if (!out.ok) {
      big.textContent = '算不出来';
      verd.textContent = out.errors[0] ? out.errors[0].message : '';
      /* 算不出来时不要把空的证据格子和空的四条路留在页面上（目检时看到一排空框，像坏了） */
      ev.innerHTML = '<div style="grid-column:1/-1" class="muted">先把上面标红的格子改对 —— 改对了这里会立刻把证据摆出来。</div>';
      lv.innerHTML = '<div class="lever no"><div class="t">先改输入</div><div class="d">' +
        '四条路都要先算得出当前状态才能反解。上面那几格改对之后，这里会给出「多换水 / 少喂 / 加水草 / 换大缸」各自该改成多少。</div></div>';
      return;
    }
    big.textContent = out.runway.label;
    var lines = [];
    if (out.steady.status === 'ok') {
      if (out.steady.verdict === 'over') {
        lines.push('你现在的节奏（每 ' + C.fmtV(out.raw.period, 0) + ' 天换 ' + C.fmtPct(out.steady.f, 1) + '）**不够**：换水前的读数会一路爬到并停在 <b>' +
          C.fmtV(out.steady.peak, 2) + ' mg/L</b>，是你定的上限 ' + C.fmtV(out.raw.maxNo3, 1) + ' 的 ' + C.fmtV(out.steady.ratioToMax, 2) + ' 倍。' +
          (out.plan && out.plan.schedule && out.plan.schedule.firstBack
            ? '按建议改成每次 ' + C.fmtPct(out.plan.fSug, 1) + '，第 ' + out.plan.schedule.firstBack + ' 周换水前就能回到上限以内。'
            : ''));
        if (out.schedule && out.schedule.firstOver) lines.push('而且**第 ' + out.schedule.firstOver + ' 周就已经越线了** —— 不是以后的事。');
      } else {
        lines.push('你现在的节奏（每 ' + C.fmtV(out.raw.period, 0) + ' 天换 ' + C.fmtPct(out.steady.f, 1) + '）**够用**：换水前的读数会稳在 <b>' +
          C.fmtV(out.steady.peak, 2) + ' mg/L</b>，在你定的上限 ' + C.fmtV(out.raw.maxNo3, 1) + ' 以内（还差 ' + C.fmtV(-out.steady.overBy, 2) + ' mg/L 到上限）。');
        lines.push('换水后的低点是 ' + C.fmtV(out.steady.trough, 2) + ' mg/L。');
      }
    } else if (out.steady.status === 'no-steady') {
      lines.push('换水比例填的是 0：浓度会一直涨，没有稳态。至少给一个比例，本页才能算「稳在多少」。');
    } else {
      lines.push('水草吸走的不小于进来的：按这套喂食量，硝酸盐**不会再涨**，不换水也不会积累。');
    }
    var P = [];
    lines.forEach(function (t) { P.push('<span>' + md(t) + '</span>'); });
    verd.innerHTML = P.join('<br>');

    /* 证据：全是同一次 out 里的数 */
    var L2 = out.load, R2 = out.rate, V2 = out.vols;
    var cards = [
      ['鱼总体重', C.fmtV(L2.fishMass, 2) + ' g', out.rows.map(function (r) { return C.fmtV(r.n, 0) + '×' + C.fmtV(r.g, 2); }).join(' + ')],
      ['每天饲料', C.fmtV(L2.feed, 4) + ' g', '鱼重 × 投喂率 ' + C.fmtV(out.raw.feedRate, 2) + '%'],
      ['饲料里的氮', C.fmtV(L2.nFeed, 2) + ' mg N', '÷6.25 折算（本页假设蛋白含氮 16%）'],
      ['进水的硝酸盐', C.fmtV(L2.no3In, 2) + ' mg/天', '潜在 ' + C.fmtV(L2.no3Pot, 1) + ' × ' + C.fmtV(out.raw.intoWater, 0) + '%'],
      ['水草吸走', C.fmtV(L2.uptake, 2) + ' mg/天', '你填的固定值'],
      ['净负荷', C.fmtV(L2.no3Net, 2) + ' mg/天', '进水 − 水草'],
      ['每天涨', C.fmtV(R2.a, 6) + ' mg/L', '净负荷 ÷ 实际水量 ' + C.fmtV(V2.water, 2) + ' L'],
      ['一个周期涨', C.fmtV(R2.aT, 4) + ' mg/L', '每天涨 × ' + C.fmtV(out.raw.period, 0) + ' 天'],
      ['现状每次换水', C.fmtV(out.plan ? out.plan.litersNow : 0, 2) + ' L', out.plan ? (out.plan.bucketsNow + ' 桶 + 每月约 ' + C.fmtV(out.plan.monthlyNow, 0) + ' L') : ''],
      ['建议每次换水', out.plan && out.plan.liters != null ? C.fmtV(out.plan.liters, 2) + ' L' : '—', out.plan && out.plan.liters != null ? (out.plan.buckets + ' 桶 + 每月约 ' + C.fmtV(out.plan.monthlySug, 0) + ' L') : '']
    ];
    ev.innerHTML = cards.map(function (c) {
      return '<div><div class="k">' + c[0] + '</div><div class="v">' + c[1] + '</div><div class="k">' + md(c[2]) + '</div></div>';
    }).join('');

    renderLevers(lv);
  }

  function renderLevers(host) {
    host.innerHTML = '';
    if (!out.levers || !out.levers.change) {
      host.innerHTML = '<div class="lever no"><div class="t">四条路都不需要</div><div class="d">按现在的喂食量，硝酸盐不会再涨。</div></div>';
      return;
    }
    var l = out.levers;
    var defs = [
      {
        key: 'change', t: '① 多换水', ok: true,
        d: '每次从 <b>' + C.fmtV(l.change.nowPct, 2) + '%</b>（' + C.fmtV(l.change.nowL, 1) + ' L）改成 <b>' + C.fmtV(l.change.toPct, 2) + '%</b>（' + C.fmtV(l.change.toL, 1) + ' L / ' + l.change.buckets + ' 桶）',
        note: out.plan.tier === 'A' ? '达标，且留满 10% 余量' : (out.plan.tier === 'B' ? '达标，但余量比 10% 小' : '按本页建议上限也压不回上限'),
        label: '改成这个比例'
      },
      {
        key: 'feed', t: '② 少喂一点', ok: l.feed.feasible,
        d: l.feed.alreadyOk ? '现在这样就已经够低了，不用再减。'
          : (l.feed.feasible
            ? '投喂率从 <b>' + C.fmtV(l.feed.nowPct, 4) + '%</b> 降到 <b>' + C.fmtV(l.feed.toPct, 4) + '%</b>（饲料 ' + C.fmtV(l.feed.nowG, 4) + ' → ' + C.fmtV(l.feed.toG, 4) + ' g/天），换水节奏不动'
            : '按现在的节奏，光靠少喂压不到上限（进水全靠饲料，减到 0 也还差一截）。'),
        note: '保持每 ' + C.fmtV(out.raw.period, 0) + ' 天换 ' + C.fmtPct(out.steady.f, 1) + ' 不变',
        label: '改成这个投喂率'
      },
      {
        key: 'plant', t: '③ 多养点水草', ok: l.plant.feasible,
        d: l.plant.alreadyOk ? '现在的水草已经够了。'
          : (l.plant.feasible
            ? '水草吸收从 <b>' + C.fmtV(l.plant.nowMg, 2) + '</b> 加到 <b>' + C.fmtV(l.plant.toMg, 2) + ' mg/天</b>'
            : '光靠水草不行：进来的最多 ' + C.fmtV(l.plant.ceiling, 2) + ' mg/天，全吸掉也到不了目标。'),
        note: '保持换水节奏不变',
        label: '改成这个吸收量'
      },
      {
        key: 'volume', t: '④ 换更大的缸', ok: l.volume.feasible,
        d: l.volume.alreadyOk ? '现在的水量已经够了。'
          : (l.volume.feasible
            ? '实际水量要从 <b>' + C.fmtV(l.volume.nowL, 1) + ' L</b> 到 <b>' + C.fmtV(l.volume.toL, 1) + ' L</b> —— 按长宽高等比例放大 ' + C.fmtV(l.volume.scale, 4) + ' 倍（' + C.fmtV(l.volume.dims.len, 1) + '×' + C.fmtV(l.volume.dims.wid, 1) + '×' + C.fmtV(l.volume.dims.hgt, 1) + ' cm）'
            : (l.volume.tooBig ? '要的水量太大，按比例放大会超出本页允许的尺寸范围 —— 先考虑前三条。' : '这条算不出来。')),
        note: '底砂厚度、留空、造景容积不变',
        label: '按这个尺寸放大'
      }
    ];
    defs.forEach(function (d) {
      var box = document.createElement('div');
      box.className = 'lever' + (d.ok ? '' : ' no');
      box.id = 'lever_' + d.key;
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'btn';
      b.id = 'leverBtn_' + d.key;
      b.textContent = d.label;
      b.disabled = !d.ok;
      b.addEventListener('click', function () { applyLever(d.key); });
      box.innerHTML = '<div class="t">' + d.t + '</div><div class="d">' + d.d + '</div>';
      var nt = document.createElement('div');
      nt.className = 'muted';
      nt.style.marginBottom = '8px';
      nt.textContent = d.note;
      box.appendChild(nt);
      box.appendChild(b);
      host.appendChild(box);
    });
  }

  function applyLever(key) {
    if (!out || !out.ok || !out.levers || !out.levers.change) return false;
    var l = out.levers, changed = false;
    if (key === 'change') { state.changePct = String(l.change.toPct); changed = true; }
    else if (key === 'feed' && l.feed.feasible) { state.feedRate = String(l.feed.toPct); changed = true; }
    else if (key === 'plant' && l.plant.feasible) { state.plantUptake = String(l.plant.toMg); changed = true; }
    else if (key === 'volume' && l.volume.feasible) {
      state.len = String(l.volume.dims.len); state.wid = String(l.volume.dims.wid); state.hgt = String(l.volume.dims.hgt);
      changed = true;
    }
    if (changed) {
      render(true);
      queueSave();
      $('saveTag').textContent = '已按这条建议改回输入框并重算';
    }
    return changed;
  }

  function renderSchedules() {
    var t1 = $('schedNowTitle'), t2 = $('schedPlanTitle');
    var b1 = $('schedNow').querySelector('tbody'), b2 = $('schedPlan').querySelector('tbody');
    b1.innerHTML = ''; b2.innerHTML = '';
    if (!out.ok) {
      /* 算不出来时整块收起来：留两个只有表头的空表比不显示更难看（目检 375px 无解态时抓到） */
      $('schedWrap').classList.add('hide');
      $('schedHead').classList.add('hide');
      $('schedNowWrap').classList.remove('hide');
      $('schedPlanWrap').classList.remove('hide');
      t1.textContent = ''; t2.textContent = '';
      return;
    }
    $('schedWrap').classList.remove('hide');
    $('schedHead').classList.remove('hide');
    if (!out.schedule) {
      t1.textContent = '（没有稳态可比，这一档不给排班表）';
      t2.textContent = '';
      $('schedNowWrap').classList.add('hide');
      $('schedPlanWrap').classList.add('hide');
      return;
    }
    $('schedNowWrap').classList.remove('hide');
    $('schedPlanWrap').classList.remove('hide');
    t1.innerHTML = '现在的节奏：每 ' + C.fmtV(out.raw.period, 0) + ' 天换 ' + C.fmtPct(out.steady.f, 1) +
      '（每次 ' + C.fmtV(out.plan.litersNow, 1) + ' L）' +
      (out.schedule.firstOver ? ' —— 第 ' + out.schedule.firstOver + ' 周就第一次越线' : ' —— 8 周内都没越线');
    tbl(b1, out.schedule.rows);
    if (out.plan && out.plan.schedule) {
      t2.innerHTML = '建议的节奏：每 ' + C.fmtV(out.raw.period, 0) + ' 天换 ' + C.fmtPct(out.plan.fSug, 1) +
        '（每次 ' + C.fmtV(out.plan.liters, 1) + ' L / ' + out.plan.buckets + ' 桶）' +
        (out.plan.schedule.firstBack ? ' —— 第 ' + out.plan.schedule.firstBack + ' 周回到上限以内' : '');
      tbl(b2, out.plan.schedule.rows);
    } else {
      t2.textContent = out.plan && out.plan.status === 'no-rise' ? '按现在的喂食量不会再涨，不需要排班表。' : '';
    }
  }
  function tbl(host, rows) {
    var html = '';
    rows.forEach(function (r) {
      html += '<tr class="' + (r.over ? 'over' : '') + '"><td>' + r.k + '</td><td>' + C.fmt(r.start, 2) + '</td><td>' + C.fmt(r.peak, 2) +
        '</td><td>' + (r.over ? '越线' : '—') + '</td><td>' + C.fmt(r.after, 2) + '</td></tr>';
    });
    host.innerHTML = html;
  }

  function renderChecks() {
    var host = $('checks');
    if (!out.ok) { host.innerHTML = '<li><span class="st f">✕</span>算不出来时不谈自检：先把上面标红的格子改对。</li>'; return; }
    host.innerHTML = out.checks.map(function (c) {
      return '<li><span class="st ' + (c.pass ? 'p' : 'f') + '">' + (c.pass ? '✓' : '✕') + '</span><span>' + c.name +
        '</span><span class="dt">' + md(c.detail) + '</span></li>';
    }).join('');
  }

  function renderBoundary() {
    var box = $('boundary');
    var items = [
      '不判断能不能养、养几条合适、鱼健不健康；「换水前不超过多少」这个上限是<b>你自己填的数</b>，本页不提供所谓安全浓度。',
      '只看硝酸盐这一条线：<b>不预测氨氮与亚硝酸盐峰值</b>，不模拟开缸养水（硝化系统建立）过程，不涉及新缸综合症。',
      'pH / 硬度 / 温度 / 溶解氧 / 盐浴与药物都不在模型里，<b>不判断鱼病</b>。',
      '水草吸收按固定 mg/天算，不随浓度变化；实际植物在浓度低的时候会吸得慢，这是近似。',
      '换入的新水按硝酸盐 0 计；不做除氮设备、不做反硝化、不投药。',
      '底砂与留空按长方体近似、造景按体积等效 —— 真实缸里的砂面不平、石头异形。',
      '每次换 100% 在数学上算得出来，但那是整缸换新水，鱼和硝化系统都受不了。',
      '不查真实饲料成分表、不查真实水价，不内置任何品牌与配方。'
    ];
    box.innerHTML = '<ul class="tight">' + items.map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ul>' +
      '<p style="margin:8px 0 0">所有假设值（÷6.25、62/14、进水系数、建议值的 10% 余量、'

      + '各档「常用区间」）都是<b>本页自己的建模选择</b>，没有引用任何机构、标准或文献（本轮也没能取得可引用的一手来源）。</p>';
  }

  function highlightPreset() {
    var k = C.presetKey(state);
    /* 默认那一档的 state 是空的，presetKey 认不出来（内核里如实返回 null），
     * 所以这里单独判一次「现在是不是就是默认态」—— 否则默认态下五个按钮一个都不亮。 */
    var isDefault = JSON.stringify(state) === JSON.stringify(C.defaultState());
    C.PRESETS.forEach(function (p) {
      var b = $('preset_' + p.key);
      if (!b) return;
      var on = (p.key === 'default') ? (k === 'default' || isDefault) : (k === p.key);
      b.setAttribute('aria-pressed', String(on));
    });
  }
  function md(s) {
    return String(s == null ? '' : s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  }

  /* ── 保存 / 读回 ── */
  function queueSave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { saveLocal(true); }, 700);
  }
  function saveLocal(quiet) {
    try {
      localStorage.setItem(LSKEY, JSON.stringify(state));
      if (!quiet) $('saveTag').textContent = '已保存到本机 ' + new Date().toLocaleTimeString('zh-CN');
      return true;
    } catch (e) {
      $('saveTag').textContent = '这台设备不让存（' + (e && e.name ? e.name : '未知') + '），只在这一个页面上有效。';
      return false;
    }
  }
  function loadLocal() {
    try {
      var t = localStorage.getItem(LSKEY);
      if (!t) return null;
      var s = JSON.parse(t);
      if (!s || typeof s !== 'object' || !Array.isArray(s.fish)) return null;
      return s;
    } catch (e) { return null; }
  }

  /* ── 下载 ── */
  function shown() { return out || C.compute(state); }
  function stamp() {
    var d = new Date(), p = function (n) { return (n < 10 ? '0' : '') + n; };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds());
  }
  function download(name, text, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
  }

  /* 结果卡 1080×1350：内容全部取自这一次 compute 的输出 */
  function drawCard() {
    var W = 1080, H = 1350;
    var cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    var g = cv.getContext('2d');
    if (!g) return null;
    g.fillStyle = '#eef4f6'; g.fillRect(0, 0, W, H);
    g.fillStyle = '#ffffff'; g.fillRect(44, 44, W - 88, H - 88);
    g.fillStyle = '#12707f'; g.fillRect(44, 44, W - 88, 12);
    var pad = 92, y = 124;
    g.textBaseline = 'top';
    g.fillStyle = '#12333f';
    g.font = '600 52px -apple-system,"PingFang SC","Microsoft YaHei",sans-serif';
    g.fillText('这缸水还能撑几天', pad, y); y += 74;
    g.fillStyle = '#6b8590';
    g.font = '26px -apple-system,"PingFang SC",sans-serif';
    g.fillText('鱼缸硝酸盐与换水节奏 · ' + new Date().toLocaleString('zh-CN'), pad, y); y += 56;

    if (!out.ok) {
      g.fillStyle = '#b3261e';
      g.font = '600 36px -apple-system,"PingFang SC",sans-serif';
      g.fillText('这次算不出来：', pad, y); y += 52;
      g.font = '25px -apple-system,"PingFang SC",sans-serif';
      wrapText(g, out.errors[0].message, pad, y, W - pad * 2, 38);
      g.fillStyle = '#6b8590'; g.font = '22px -apple-system,"PingFang SC",sans-serif';
      g.fillText('本页只算硝酸盐的累积与换水节奏，不做鱼病与能不能养的判断。', pad, H - 150);
      return cv;
    }

    /* 主结论 */
    g.fillStyle = '#12707f';
    g.font = '600 29px -apple-system,"PingFang SC",sans-serif';
    g.fillText('不换水还能撑', pad, y); y += 42;
    g.fillStyle = '#a9631a';
    g.font = '700 96px ui-monospace,Menlo,monospace';
    var bigTxt = out.runway.status === 'days' ? out.runway.daysText : (out.runway.status === 'over' ? '0 天' : '不会再涨');
    g.fillText(bigTxt, pad, y);
    y += 116;
    g.fillStyle = '#12333f';
    g.font = '600 34px -apple-system,"PingFang SC",sans-serif';
    if (out.steady.status === 'ok') {
      g.fillText('现状节奏换水前会稳在 ' + C.fmtV(out.steady.peak, 2) + ' mg/L', pad, y);
      g.font = '26px -apple-system,"PingFang SC",sans-serif';
      g.fillStyle = out.steady.verdict === 'over' ? '#b3261e' : '#1c6b4b';
      g.fillText((out.steady.verdict === 'over' ? '超出' : '低于') + '上限 ' + C.fmtV(out.raw.maxNo3, 2) + ' mg/L ' +
        C.fmtV(Math.abs(out.steady.overBy), 2) + ' mg/L' + (out.steady.verdict === 'over' ? '（第 ' + (out.schedule && out.schedule.firstOver ? out.schedule.firstOver : '—') + ' 周就第一次越线）' : ''), pad, y + 38);
      y += 88;
    } else {
      g.fillText(out.steady.status === 'no-steady' ? '换水比例是 0：没有稳态，会一直涨' : '按这套喂食量不会再涨', pad, y);
      y += 62;
    }

    var lines = [
      '实际水量 ' + C.fmtV(out.vols.water, 2) + ' L（标称 ' + C.fmtV(out.vols.nominal, 1) + ' − 底砂 ' + C.fmtV(out.vols.sand, 1) + ' − 造景 ' + C.fmtV(out.vols.decor, 1) + ' − 留空 ' + C.fmtV(out.vols.head, 1) + '）',
      '鱼重 ' + C.fmtV(out.load.fishMass, 2) + ' g → 饲料 ' + C.fmtV(out.load.feed, 4) + ' g/天 → 进水 ' + C.fmtV(out.load.no3In, 2) + ' mg/天 − 水草 ' + C.fmtV(out.load.uptake, 2) + ' = 净 ' + C.fmtV(out.load.no3Net, 2) + ' mg/天',
      '每天涨 ' + C.fmtV(out.rate.a, 6) + ' mg/L，每 ' + C.fmtV(out.raw.period, 0) + ' 天涨 ' + C.fmtV(out.rate.aT, 4) + ' mg/L'
    ];
    if (out.plan && out.plan.fSug != null) {
      lines.push('建议每次换 ' + C.fmtV(out.plan.liters, 2) + ' L（' + C.fmtV(out.plan.fSugPct, 1) + '% / ' + out.plan.buckets + ' 桶）→ 稳态 ' + C.fmtV(out.plan.peakAtSug, 2) + ' mg/L');
      lines.push('临界比例 ' + C.fmtV(out.plan.fReqPct, 1) + '%' + (out.plan.tier === 'A' ? '（建议值留了 10% 余量）' : out.plan.tier === 'B' ? '（建议值达标但余量不足）' : '（连本页建议上限都压不回上限）'));
    }
    g.fillStyle = '#425c66';
    g.font = '25px -apple-system,"PingFang SC",sans-serif';
    lines.forEach(function (t) { y = wrapText(g, t, pad, y, W - pad * 2, 38) + 8; });

    /* 底部固定块先排，再排排班表（布局守卫：先量页脚高度） */
    var footText = '本页只算硝酸盐的累积与换水节奏：不判断能不能养、不预测氨氮/亚硝酸盐、不涉及鱼病与用药；' +
      '÷6.25、62/14、进水系数与 10% 余量都是本页假设值，未引用任何机构或标准。默认与预设场景全部是虚构示例。';
    var footFont = '21px -apple-system,"PingFang SC",sans-serif';
    var footLh = 31;
    g.font = footFont;
    var footH = measureText(g, footText, W - pad * 2, footLh) + 44;
    var footTop = H - 88 - footH;

    y += 6;
    g.strokeStyle = '#d7e4e8'; g.beginPath(); g.moveTo(pad, y); g.lineTo(W - pad, y); g.stroke();
    y += 22;
    g.fillStyle = '#425c66';
    g.font = '600 27px -apple-system,"PingFang SC",sans-serif';
    var srcRows = (out.schedule ? out.schedule.rows : []);
    var planRows = (out.plan && out.plan.schedule ? out.plan.schedule.rows : []);
    g.fillText('往后 8 周（现状 → 建议）', pad, y); y += 42;
    g.font = '23px ui-monospace,Menlo,monospace';
    var rowLh = 32;
    var shownN = Math.min(srcRows.length, Math.floor((footTop - 14 - y) / rowLh));
    for (var i = 0; i < shownN; i++) {
      var a = srcRows[i], b = planRows[i];
      g.fillStyle = a.over ? '#b3261e' : '#425c66';
      var t1 = '第' + a.k + '周  ' + C.fmt(a.peak, 1);
      var t2 = b ? ('→ ' + C.fmt(b.peak, 1)) : '';
      g.fillText(t1, pad, y);
      g.fillStyle = b && b.over ? '#b3261e' : '#1c6b4b';
      g.fillText(t2, pad + 300, y);
      y += rowLh;
    }
    if (shownN < srcRows.length) {
      g.fillStyle = '#6b8590';
      g.fillText('（还有 ' + (srcRows.length - shownN) + ' 周，完整表看页面或导出 CSV）', pad, y);
    }
    /* 页脚 */
    g.strokeStyle = '#d7e4e8'; g.beginPath();
    g.moveTo(pad, footTop - 14); g.lineTo(W - pad, footTop - 14); g.stroke();
    g.fillStyle = '#6b8590';
    g.font = footFont;
    var fy = wrapText(g, footText, pad, footTop, W - pad * 2, footLh);
    g.fillText('AI 自行复核，未做人工校核。', pad, fy + 4);
    return cv;
  }
  function measureText(g, text, maxW, lh) {
    var line = '', n = 0;
    for (var i = 0; i < text.length; i++) {
      var t = line + text[i];
      if (g.measureText(t).width > maxW && line) { n++; line = text[i]; } else { line = t; }
    }
    if (line) n++;
    return n * lh;
  }
  function wrapText(g, text, x, y, maxW, lh) {
    var line = '';
    for (var i = 0; i < text.length; i++) {
      var t = line + text[i];
      if (g.measureText(t).width > maxW && line) { g.fillText(line, x, y); y += lh; line = text[i]; }
      else { line = t; }
    }
    if (line) { g.fillText(line, x, y); y += lh; }
    return y;
  }
  function downloadCard() {
    var cv = drawCard();
    if (!cv) { $('saveTag').textContent = '这台设备没有可用的 canvas，结果卡没画出来。'; return; }
    cv.toBlob(function (blob) {
      if (!blob) { $('saveTag').textContent = '结果卡导出失败（toBlob 返回空）。'; return; }
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '这缸水还能撑几天-结果卡-1080x1350-' + stamp() + '.png';
      document.body.appendChild(a); a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
      $('saveTag').textContent = '结果卡已导出：1080×1350 PNG，' + Math.round(blob.size / 1024) + ' KB。';
    }, 'image/png');
  }

  /* ── 事件 ── */
  function wire() {
    $('btnAddFish').addEventListener('click', function () {
      if (state.fish.length >= 12) { $('saveTag').textContent = '最多 12 行。'; return; }
      state.fish.push({ name: '新的一行', n: '1', g: '1' });
      render(true); queueSave();
    });
    $('btnReset').addEventListener('click', function () {
      state = C.defaultState(); render(true); queueSave();
      $('saveTag').textContent = '已恢复默认示例（虚构）';
    });
    $('btnSave').addEventListener('click', function () { saveLocal(false); });
    $('btnLoad').addEventListener('click', function () {
      var l = loadLocal();
      if (!l) { $('saveTag').textContent = '本机上还没存过（或这台设备不让读），先用默认示例。'; return; }
      state = l; render(true);
      $('saveTag').textContent = '已读回上次保存的输入';
    });
    $('dlCsv').addEventListener('click', function () {
      download('这缸水还能撑几天-' + stamp() + '.csv', C.toCSV(state, shown()), 'text/csv;charset=utf-8');
    });
    $('dlMd').addEventListener('click', function () {
      download('这缸水还能撑几天-' + stamp() + '.md', C.toMarkdown(state, shown()), 'text/markdown;charset=utf-8');
    });
    $('dlJson').addEventListener('click', function () {
      download('这缸水还能撑几天-备份-' + stamp() + '.json', C.toJSON(state, shown()), 'application/json;charset=utf-8');
    });
    $('dlPng').addEventListener('click', downloadCard);
  }

  /* ── 启动 ── */
  function boot() {
    buildInputs();
    buildPresets();
    var saved = loadLocal();
    if (saved) state = saved;
    render(true);
    wire();
    $('prov').textContent = '本页是单文件网页（index.html + core.js + ui.js），不联网、不上传任何数据；填的数字只存在你自己的浏览器里。';
    if (saved) $('saveTag').textContent = '已读回上次保存在本机的输入';
  }

  /* 给验收脚本用的最小接口（也是自动化测试唯一入口，避免脚本去摸内部变量） */
  window.__tankUi = {
    state: function () { return JSON.parse(JSON.stringify(state)); },
    out: function () { return out; },
    setInput: function (k, v) {
      if (k === 'fish') { state.fish = JSON.parse(JSON.stringify(v)); }
      else state[k] = String(v);
      render(true); queueSave(); return true;
    },
    setFishRow: function (i, field, v) { state.fish[i][field] = String(v); render(true); queueSave(); return true; },
    addFishRow: function () { $('btnAddFish').click(); return state.fish.length; },
    removeFishRow: function (i) { var b = $('fishDel_' + i); if (b) b.click(); return state.fish.length; },
    applyLever: applyLever,
    preset: function (key) { var b = $('preset_' + key); if (b) { b.click(); return true; } return false; },
    reset: function () { $('btnReset').click(); return true; },
    card: function () { return drawCard(); },
    save: function () { return saveLocal(false); },
    boot: boot
  };

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
