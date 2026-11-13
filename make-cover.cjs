/* 生成封面 cover.svg（1200×1200），再用浏览器截图成 cover.png。
 * 纪律：封面上的每个数字都来自 core.js 对默认场景的真实计算，不写死。
 * 没有第三方图片库，所以封面走「矢量 SVG → 浏览器截图」的路线。 */
const fs = require('node:fs');
const path = require('node:path');
const A = require('./core.js');
const out = A.compute(A.defaultState());
if (!out.ok) throw new Error('默认场景算不出来，封面不生成：' + JSON.stringify(out.errors));

const W = 1200, H = 1200;
/* 字体名里的双引号必须换成单引号：SVG 是 XML，属性值里的裸双引号会把标签截断 ——
 * 浏览器直接报 "Unexpected token inside opening tag"，封面会变成一张错误页（本轮实测撞到，
 * 之前几轮的 cover.png 也一直是那张错误页，只是没人打开看过）。 */
const F = "-apple-system,'PingFang SC','Microsoft YaHei',sans-serif";
const M = 'ui-monospace,Menlo,Consolas,monospace';
const v = out.vols, L = out.load, R = out.rate;
const lines = [
  ['实际水量 ' + A.fmtV(v.water, 1) + ' L', '标称 ' + A.fmtV(v.nominal, 1) + ' L'],
  ['鱼重 ' + A.fmtV(L.fishMass, 0) + ' g / 饲料 ' + A.fmtV(L.feed, 2) + ' g 天', '净负荷 ' + A.fmtV(L.no3Net, 1) + ' mg/天'],
  ['每天涨 ' + A.fmtV(R.a, 2) + ' mg/L', '上限 ' + A.fmtV(out.raw.maxNo3, 0) + ' mg/L']
];
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="#e9f1f3"/>
  <rect x="48" y="48" width="${W - 96}" height="${H - 96}" fill="#ffffff" stroke="#d7e4e8"/>
  <rect x="48" y="48" width="${W - 96}" height="16" fill="#12707f"/>
  <text x="104" y="182" font-family="${F}" font-size="60" font-weight="700" fill="#12333f">这缸水还能撑几天</text>
  <text x="104" y="244" font-family="${F}" font-size="29" fill="#6b8590">鱼缸硝酸盐的累积速度 · 换水节奏的稳态 · 四条反解路</text>
  <line x1="104" y1="292" x2="${W - 104}" y2="292" stroke="#d7e4e8" stroke-dasharray="8 8"/>
  <text x="104" y="382" font-family="${F}" font-size="30" fill="#425c66">不换水还能撑</text>
  <text x="104" y="512" font-family="${M}" font-size="126" font-weight="700" fill="#a9631a">${out.runway.status === 'days' ? out.runway.daysText : (out.runway.status === 'over' ? '0 天' : '不会再涨')}</text>
  <text x="104" y="606" font-family="${F}" font-size="30" fill="#425c66">现在这个节奏，换水前会稳在</text>
  <text x="104" y="736" font-family="${M}" font-size="126" font-weight="700" fill="#b3261e">${A.fmtV(out.steady.peak, 1)} mg/L</text>
  <text x="104" y="820" font-family="${F}" font-size="28" fill="#425c66">是你定的上限 ${A.fmtV(out.raw.maxNo3, 0)} 的 ${A.fmtV(out.steady.ratioToMax, 2)} 倍 · 建议每次换 ${A.fmtV(out.plan.liters, 1)} L</text>
  <text x="104" y="864" font-family="${F}" font-size="28" fill="#425c66">临界比例 ${A.fmtPct(out.plan.fReq, 1)} → 建议 ${A.fmtPct(out.plan.fSug, 1)}（留 10% 余量）</text>
  <line x1="104" y1="908" x2="${W - 104}" y2="908" stroke="#eef4f6"/>
  ${lines.map((r, i) => `<text x="104" y="${968 + i * 46}" font-family="${F}" font-size="27" fill="#6b8590">${r[0]}</text>
  <text x="${W - 104}" y="${968 + i * 46}" text-anchor="end" font-family="${F}" font-size="27" fill="#6b8590">${r[1]}</text>`).join('\n  ')}
  <text x="104" y="${H - 92}" font-family="${F}" font-size="23" fill="#6b8590">只算硝酸盐的累积与换水节奏，不做鱼病与能不能养的判断 · 默认场景为虚构示例</text>
</svg>`;
fs.writeFileSync(path.join(__dirname, 'cover.svg'), svg);
console.log('cover.svg', fs.statSync(path.join(__dirname, 'cover.svg')).size, 'bytes');
console.log('封面数字（全部来自这次 compute）：撑 ' + out.runway.daysText + ' / 峰值 ' + A.fmtV(out.steady.peak, 1) +
  ' mg/L / 建议 ' + A.fmtPct(out.plan.fSug, 1) + ' / 每次 ' + A.fmtV(out.plan.liters, 2) + ' L');
