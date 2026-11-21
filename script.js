'use strict';

/* =========================================================
   Helpers
   ========================================================= */
const $ = (s) => document.querySelector(s);
const rnd = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
const shuffle = (arr) => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};
const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a; };
const fracStr = (n, d) => {
  if (d < 0) { n = -n; d = -d; }
  const g = gcd(n, d) || 1; n /= g; d /= g;
  return d === 1 ? `${n}` : `${n}/${d}`;
};
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => (n < 0 ? '−' + Math.abs(n) : String(n)); // pretty minus sign
const round = (x, d) => Math.round(x * 10 ** d) / 10 ** d;

// HTML maths snippets
const F = (n, d) => `<span class="frac"><span>${n}</span><span>${d}</span></span>`;
// Radical sign that stretches to the height of whatever is under it (e.g. a whole fraction)
const RSIGN = '<svg class="rsign" viewBox="0 0 12 40" preserveAspectRatio="none" aria-hidden="true"><path d="M0.5 25 L3.5 22.5 L7 39 L11.5 0.75 L12 0.75"/></svg>';
const SQ = (x) => `<span class="radical">${RSIGN}<span class="rad">${x}</span></span>`;
const CB = (x) => `<span class="radical"><span class="root-i">3</span>${RSIGN}<span class="rad">${x}</span></span>`;

/* =========================================================
   Answer normalising + expression parsing
   ========================================================= */
function norm(s) {
  return String(s).toLowerCase()
    .replace(/[−–—‒]/g, '-')
    .replace(/[×·⋅✕]/g, '*')
    .replace(/÷/g, '/')
    .replace(/≤|⩽|=</g, '<=')
    .replace(/≥|⩾|=>/g, '>=')
    .replace(/⁻¹/g, '^(-1)')
    .replace(/²/g, '^2').replace(/³/g, '^3')
    .replace(/½/g, '(1/2)').replace(/¼/g, '(1/4)').replace(/¾/g, '(3/4)')
    .replace(/π/g, 'pi')
    .replace(/[°º]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// "6 7/8" -> "(6+7/8)"
const mixed = (s) => s.replace(/(\d+)\s+(\d+)\s*\/\s*(\d+)/g, '($1+$2/$3)');

function tokenize(s) {
  const t = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    const rest = s.slice(i);
    let m;
    if (/\s/.test(c)) { i++; continue; }
    if ((m = /^(\d+\.?\d*|\.\d+)/.exec(rest))) { t.push({ k: 'n', v: parseFloat(m[0]) }); i += m[0].length; continue; }
    if ((m = /^(sqrt|cbrt|pi)/.exec(rest))) {
      t.push(m[0] === 'pi' ? { k: 'n', v: Math.PI } : { k: 'f', v: m[0] });
      i += m[0].length; continue;
    }
    if (c === '√') { t.push({ k: 'f', v: 'sqrt' }); i++; continue; }
    if (c === '∛') { t.push({ k: 'f', v: 'cbrt' }); i++; continue; }
    if (/[a-z]/.test(c)) { t.push({ k: 'v', v: c }); i++; continue; }
    if ('+-*/^()'.includes(c)) { t.push({ k: c }); i++; continue; }
    if (c === '[' || c === '{') { t.push({ k: '(' }); i++; continue; }
    if (c === ']' || c === '}') { t.push({ k: ')' }); i++; continue; }
    throw new Error('Unexpected ' + c);
  }
  return t;
}

/* Compile an expression into a function of a variables object.
   tight=false: implicit multiplication has the same precedence as * and /  (1/2x = x/2)
   tight=true:  implicit multiplication binds tighter (3/4w = 3/(4w))
   Answers are accepted if EITHER reading matches, so both typing habits work. */
function compile(str, tight) {
  const toks = tokenize(str);
  let p = 0;
  const peek = () => toks[p];
  const next = () => toks[p++];
  const startsAtom = (t) => t && (t.k === 'n' || t.k === 'v' || t.k === '(' || t.k === 'f');

  function expr() {
    let a = term();
    while (peek() && (peek().k === '+' || peek().k === '-')) {
      const op = next().k, b = term(), x = a;
      a = op === '+' ? (v) => x(v) + b(v) : (v) => x(v) - b(v);
    }
    return a;
  }
  function term() {
    let a = tight ? chain() : unary();
    for (;;) {
      const t = peek();
      if (t && (t.k === '*' || t.k === '/')) {
        next();
        const b = tight ? chain() : unary(), x = a;
        a = t.k === '*' ? (v) => x(v) * b(v) : (v) => x(v) / b(v);
      } else if (!tight && startsAtom(t)) {
        const b = unary(), x = a;
        a = (v) => x(v) * b(v);
      } else break;
    }
    return a;
  }
  function chain() {
    let a = unary();
    while (startsAtom(peek())) { const b = power(), x = a; a = (v) => x(v) * b(v); }
    return a;
  }
  function unary() {
    const t = peek();
    if (t && t.k === '-') { next(); const a = unary(); return (v) => -a(v); }
    if (t && t.k === '+') { next(); return unary(); }
    return power();
  }
  function power() {
    const base = atom();
    if (peek() && peek().k === '^') { next(); const e = unary(); return (v) => Math.pow(base(v), e(v)); }
    return base;
  }
  function atom() {
    const t = next();
    if (!t) throw new Error('end');
    if (t.k === 'n') return () => t.v;
    if (t.k === 'v') return (v) => (t.v in v ? v[t.v] : NaN);
    if (t.k === '(') {
      const e = expr();
      if (!peek()) return e; // forgive a missing closing bracket at the end
      if (peek().k !== ')') throw new Error('bracket');
      next();
      return e;
    }
    if (t.k === 'f') {
      const a = atom();
      return t.v === 'sqrt' ? (v) => Math.sqrt(a(v)) : (v) => Math.cbrt(a(v));
    }
    throw new Error('syntax');
  }
  const f = expr();
  if (p !== toks.length) throw new Error('trailing');
  return f;
}

function compileBoth(str) {
  const out = [];
  for (const tight of [false, true]) {
    try { out.push(compile(str, tight)); } catch (e) { /* ignore */ }
  }
  return out;
}

function varsIn(str) {
  try { return tokenize(str).filter((t) => t.k === 'v').map((t) => t.v); } catch (e) { return ['?']; }
}

const closeEnough = (a, b) => Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(b));

/* =========================================================
   Checkers
   ========================================================= */
const UNIT_RE = /\s*(degrees?|deg|boxes|box|years?\s*old|years?|yrs?|oranges?|th|st|nd|rd|term)\s*$/;

// Single numeric answer. Accepts fractions, mixed numbers, decimals, percentages, simple expressions.
function numOK(input, target, o = {}) {
  let s = norm(input).replace(/^[a-z]+\s*=\s*/, '').replace(UNIT_RE, '').replace(UNIT_RE, '').trim();
  if (!s) return false;
  s = s.replace(/^(-?\d+),(\d+)$/, '$1.$2'); // decimal comma from some number pads
  let scale = 1;
  if (/%$/.test(s)) { scale = 100; s = s.slice(0, -1).trim(); }
  if (/[a-z]/.test(s.replace(/sqrt|cbrt|pi/g, ''))) return false;
  const t = target * scale;
  for (const f of compileBoth(mixed(s))) {
    let v;
    try { v = f({}); } catch (e) { continue; }
    if (!isFinite(v)) continue;
    if (o.tol != null) { if (Math.abs(v - t) <= o.tol * scale + 1e-9) return true; continue; }
    if (closeEnough(v, t)) return true;
    // Accept rounded decimals (2+ dp) for answers that don't terminate nicely, e.g. 31/36 ≈ 0.861
    const m = /^-?\d*\.(\d+)$/.exec(s);
    const nonTerminating = Math.abs(t - round(t, 3)) > 1e-9;
    if (m && nonTerminating && m[1].length >= (scale === 100 ? 1 : 2) && Math.abs(v - round(t, m[1].length)) < 1e-9) return true;
  }
  return false;
}

// Break "x = 5 or x = 8", "5, 8", "±3.3", "5 and 8" into parts
function splitList(input) {
  let s = norm(input).replace(/\b[a-z]\s*=\s*/g, ' ');
  const parts = s.split(/,|;|&|\band\b|\bor\b|\n/).map((x) => x.trim()).filter(Boolean);
  const out = [];
  for (const p of parts) {
    const pm = /^(±|\+\/-|\+-)\s*(.+)$/.exec(p);
    if (pm) { out.push(pm[2], '-(' + pm[2] + ')'); continue; }
    if (/\s/.test(p) && !/\d\s+\d+\s*\//.test(p)) out.push(...p.split(/\s+/));
    else out.push(p);
  }
  return out;
}

// Several numeric answers in any order
function multiOK(input, targets, o = {}) {
  const parts = splitList(input);
  if (parts.length !== targets.length) return false;
  const used = new Array(targets.length).fill(false);
  for (const p of parts) {
    const i = targets.findIndex((t, k) => !used[k] && numOK(p, t, o));
    if (i < 0) return false;
    used[i] = true;
  }
  return true;
}

// Coordinates "(−3, 4)", "-3,4", "-3 4"
function coordOK(input, x, y) {
  const s = norm(input).replace(/[()]/g, ' ').trim();
  let parts = s.split(/,|;/).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 1) parts = s.split(/\s+/);
  return parts.length === 2 && numOK(parts[0], x) && numOK(parts[1], y);
}

/* Algebraic expression equivalence by testing at sample points.
   lhs: optional "g =" prefix to strip. allowed: variables the answer may contain. */
function exprOK(input, target, samples, o = {}) {
  let s = norm(input);
  if (o.lhs) s = s.replace(new RegExp('^' + o.lhs + '\\s*=\\s*'), '');
  if (!s || s.includes('=') || /[<>]/.test(s)) return false;
  if (o.forbid && o.forbid.test(s)) return false;
  if (o.require && !o.require.test(s)) return false;
  const vs = varsIn(s);
  if (vs.some((v) => !o.allowed.includes(v))) return false;
  for (const f of compileBoth(s)) {
    let ok = true;
    for (const smp of samples) {
      let v; try { v = f(smp); } catch (e) { ok = false; break; }
      const t = target(smp);
      if (!isFinite(v) || !closeEnough(v, t)) { ok = false; break; }
    }
    if (ok) return true;
  }
  return false;
}

/* Inequality equivalence: target is "G(x,y) op 0".
   Works for any rearrangement, e.g. y<=-1/2x+5, 2y+x<=10, 5-x/2>=y */
function ineqOK(input, G, op) {
  const s = norm(input);
  const ops = s.match(/<=|>=|<|>/g);
  if (!ops || ops.length !== 1 || /[^<>]=/.test(s.replace(/<=|>=/g, ''))) return false;
  const [L, R] = s.split(/<=|>=|<|>/);
  if (!L.trim() || !R.trim()) return false;
  if ([...varsIn(L), ...varsIn(R)].some((v) => v !== 'x' && v !== 'y')) return false;
  const flip = { '<': '>', '>': '<', '<=': '>=', '>=': '<=' };
  const pts = [[1.3, 2.7], [-4.1, 0.6], [3.7, -5.2], [-2.2, -3.3], [6.1, 4.4]];
  for (const fl of compileBoth(L)) {
    for (const fr of compileBoth(R)) {
      let r0 = null, ok = true;
      for (const [x, y] of pts) {
        const g = G(x, y);
        const u = fl({ x, y }) - fr({ x, y });
        if (!isFinite(u)) { ok = false; break; }
        const r = u / g;
        if (r0 === null) r0 = r;
        else if (!closeEnough(r, r0)) { ok = false; break; }
      }
      if (ok && r0 && Math.abs(r0) > 1e-9) {
        const eff = r0 > 0 ? ops[0] : flip[ops[0]];
        if (eff === op) return true;
      }
    }
  }
  return false;
}

// Letters like "B and D", "d,b", "BD"
function lettersOK(input, want) {
  const s = String(input).toUpperCase().replace(/\bAND\b/g, ' ').replace(/[^A-F]/g, '');
  const got = [...new Set(s.split(''))].sort().join('');
  return s.length === want.length && got === [...want].sort().join('');
}

/* =========================================================
   Diagrams (SVG)
   ========================================================= */
function grid(o) {
  const pad = o.pad ?? 22, u = o.u, uy = o.uy ?? o.u;
  const W = (o.xmax - o.xmin) * u + pad * 2, H = (o.ymax - o.ymin) * uy + pad * 2;
  const X = (x) => +(pad + (x - o.xmin) * u).toFixed(2);
  const Y = (y) => +(pad + (o.ymax - y) * uy).toFixed(2);
  const sx = o.sx ?? 1, sy = o.sy ?? 1, lx = o.lx ?? 2, ly = o.ly ?? 2;
  let s = `<svg class="diag" viewBox="0 0 ${W} ${H}" role="img" aria-label="${o.label || 'Grid diagram'}">`;
  const nx = Math.round((o.xmax - o.xmin) / sx), ny = Math.round((o.ymax - o.ymin) / sy);
  for (let i = 0; i <= nx; i++) {
    const x = o.xmin + i * sx;
    const strong = Math.abs(x / lx - Math.round(x / lx)) < 1e-9;
    s += `<line class="${strong ? 'g2' : 'g'}" x1="${X(x)}" y1="${Y(o.ymin)}" x2="${X(x)}" y2="${Y(o.ymax)}"/>`;
  }
  for (let j = 0; j <= ny; j++) {
    const y = o.ymin + j * sy;
    const strong = Math.abs(y / ly - Math.round(y / ly)) < 1e-9;
    s += `<line class="${strong ? 'g2' : 'g'}" x1="${X(o.xmin)}" y1="${Y(y)}" x2="${X(o.xmax)}" y2="${Y(y)}"/>`;
  }
  // axes
  s += `<line class="ax" x1="${X(o.xmin)}" y1="${Y(0)}" x2="${X(o.xmax) + 8}" y2="${Y(0)}"/>`;
  s += `<line class="ax" x1="${X(0)}" y1="${Y(o.ymin)}" x2="${X(0)}" y2="${Y(o.ymax) - 8}"/>`;
  s += `<text class="it" x="${X(o.xmax) + 4}" y="${Y(0) - 6}">x</text>`;
  s += `<text class="it" x="${X(0) - 14}" y="${Y(o.ymax) - 6}">y</text>`;
  for (let x = Math.ceil(o.xmin / lx) * lx; x <= o.xmax; x += lx) {
    if (x === 0) continue;
    s += `<text class="sm" text-anchor="middle" x="${X(x)}" y="${Y(0) + 13}">${fmt(x)}</text>`;
  }
  for (let y = Math.ceil(o.ymin / ly) * ly; y <= o.ymax; y += ly) {
    if (y === 0) continue;
    s += `<text class="sm" text-anchor="end" x="${X(0) - 4}" y="${Y(y) + 3.5}">${fmt(y)}</text>`;
  }
  s += `<text class="sm" text-anchor="end" x="${X(0) - 4}" y="${Y(0) + 13}">0</text>`;
  return { s, X, Y, end: '</svg>' };
}

const poly = (g, pts, cls) => `<polygon class="${cls}" points="${pts.map(([x, y]) => g.X(x) + ',' + g.Y(y)).join(' ')}"/>`;

// Arc in "maths" degrees (anticlockwise from +x), screen coordinates for the centre
function arc(cx, cy, a1, a2, r) {
  const p = (a) => [cx + r * Math.cos(a * Math.PI / 180), cy - r * Math.sin(a * Math.PI / 180)];
  const [x1, y1] = p(a1), [x2, y2] = p(a2);
  const large = ((a2 - a1) % 360 + 360) % 360 > 180 ? 1 : 0;
  return `<path class="thin" d="M${x1.toFixed(1)},${y1.toFixed(1)} A${r},${r} 0 ${large} 0 ${x2.toFixed(1)},${y2.toFixed(1)}"/>`;
}
const polar = (cx, cy, a, r) => [cx + r * Math.cos(a * Math.PI / 180), cy - r * Math.sin(a * Math.PI / 180)];

function parallelLinesSVG(x, y) {
  // Directions (degrees, maths convention). Angles are drawn to scale.
  const dT = 6 - (y - x) / 2, dP = dT + y, dB = dP - x;
  const u = (d) => [Math.cos(d * Math.PI / 180), -Math.sin(d * Math.PI / 180)];
  const uT = u(dT), uP = u(dP), uB = u(dB);
  const T0 = [205, 58], B0 = [205, 172];
  const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
  const seg = (p, d, L) => `<line class="ln" x1="${p[0] - d[0] * L}" y1="${p[1] - d[1] * L}" x2="${p[0] + d[0] * L}" y2="${p[1] + d[1] * L}"/>`;
  const Ts = [-95, 0, 95].map((s) => [T0[0] + s * uT[0], T0[1] + s * uT[1]]);
  const Bs = Ts.map((P) => {
    const t = cross([B0[0] - P[0], B0[1] - P[1]], uB) / cross(uP, uB);
    return [P[0] + t * uP[0], P[1] + t * uP[1]];
  });
  let s = `<svg class="diag" viewBox="0 0 350 230" role="img" aria-label="Three parallel lines crossed by two lines">`;
  s += seg(T0, uT, 400) + seg(B0, uB, 400);
  Ts.forEach((P) => { s += seg(P, uP, 400); });
  // parallel arrows
  Ts.forEach((P, i) => {
    const B = Bs[i];
    const m = [(P[0] + B[0]) / 2, (P[1] + B[1]) / 2];
    const tip = [m[0] + uP[0] * 6, m[1] + uP[1] * 6];
    const back = [tip[0] - uP[0] * 9, tip[1] - uP[1] * 9];
    const n = [-uP[1], uP[0]];
    s += `<path class="ln" d="M${back[0] + n[0] * 5},${back[1] + n[1] * 5} L${tip[0]},${tip[1]} L${back[0] - n[0] * 5},${back[1] - n[1] * 5}"/>`;
  });
  const lab = (P, a1, a2, text, cls, r = 20) => {
    const mid = (a1 + a2) / 2;
    const [lx, ly] = polar(P[0], P[1], mid, r + 13);
    return arc(P[0], P[1], a1, a2, r) + `<text class="${cls}" text-anchor="middle" x="${lx.toFixed(1)}" y="${(ly + 5).toFixed(1)}">${text}</text>`;
  };
  s += lab(Bs[0], dB, dP, `${x}°`, 'lab');
  s += lab(Bs[1], dB, dP, 'a', 'it');
  s += lab(Ts[1], dT, dP, `${y}°`, 'lab');
  s += lab(Ts[0], dT + 180, dP + 180, 'b', 'it');
  s += lab(Ts[2], dP, dT + 180, 'c', 'it', 16);
  s += `<text class="sm" x="345" y="225" text-anchor="end">Diagram not drawn to scale</text></svg>`;
  return s;
}

function treeSVG(p1, p2) {
  const L = (x1, y1, x2, y2, label, isQ) => {
    const mx = (x1 + x2) / 2, my = (y1 + y2) / 2 - 6;
    return `<line class="ln" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>` +
      `<text class="${isQ ? 'q' : 'lab'}" text-anchor="middle" x="${mx}" y="${my}">${label}</text>`;
  };
  const n = (x, y, t) => `<text class="lab" x="${x}" y="${y + 5}">${t}</text>`;
  let s = `<svg class="diag" viewBox="0 0 350 250" role="img" aria-label="Tree diagram">`;
  s += `<text class="sm" x="85" y="14" text-anchor="middle">Saturday</text><text class="sm" x="235" y="14" text-anchor="middle">Sunday</text>`;
  s += L(15, 130, 140, 70, p1, false) + L(15, 130, 140, 190, 'A', true);
  s += n(145, 70, 'Phone') + n(145, 190, 'Boxes');
  s += L(195, 70, 285, 40, 'B', true) + L(195, 70, 285, 100, p2, false);
  s += L(195, 190, 285, 160, 'B', true) + L(195, 190, 285, 220, p2, false);
  s += n(290, 40, 'Phone') + n(290, 100, 'Boxes') + n(290, 160, 'Phone') + n(290, 220, 'Boxes');
  s += `</svg>`;
  return s;
}

function cyclicSVG(dAng, cAng) {
  const cx = 175, cy = 120, r = 88;
  // arcs AB + BC = 2*D ; DA + AB = 2*C
  const lo = Math.max(20, 2 * dAng + 2 * cAng - 340), hi = Math.min(2 * dAng - 20, 2 * cAng - 20);
  const ab = (lo + hi) / 2, bc = 2 * dAng - ab, cd = 360 - 2 * dAng - 2 * cAng + ab;
  const aA = 70, aB = aA - ab, aC = aB - bc, aD = aC - cd;
  const P = (a) => polar(cx, cy, a, r);
  const A = P(aA), B = P(aB), C = P(aC), D = P(aD);
  const lab = (pt, a, t) => { const [x, y] = polar(cx, cy, a, r + 14); return `<text class="it" text-anchor="middle" x="${x}" y="${y + 5}">${t}</text>`; };
  const inner = (V, U, W, t) => {
    const n1 = [U[0] - V[0], U[1] - V[1]], n2 = [W[0] - V[0], W[1] - V[1]];
    const l1 = Math.hypot(...n1), l2 = Math.hypot(...n2);
    const b = [n1[0] / l1 + n2[0] / l2, n1[1] / l1 + n2[1] / l2], lb = Math.hypot(...b);
    return `<text class="lab" text-anchor="middle" x="${V[0] + b[0] / lb * 32}" y="${V[1] + b[1] / lb * 32 + 5}">${t}</text>`;
  };
  let s = `<svg class="diag" viewBox="0 0 350 240" role="img" aria-label="Cyclic quadrilateral ABCD">`;
  s += `<circle class="ln" cx="${cx}" cy="${cy}" r="${r}"/>`;
  s += `<polygon class="ln" points="${[A, B, C, D].map((p) => p.join(',')).join(' ')}"/>`;
  s += lab(A, aA, 'A') + lab(B, aB, 'B') + lab(C, aC, 'C') + lab(D, aD, 'D');
  s += inner(D, A, C, `${dAng}°`) + inner(C, B, D, `${cAng}°`);
  s += `<text class="sm" x="345" y="235" text-anchor="end">Diagram not drawn to scale</text></svg>`;
  return s;
}

function tangentSVG(theta) {
  const cx = 160, cy = 120, r = 82;
  const aP = 35, aQ = aP - (180 - 2 * theta), aR = aQ + 180;
  const P = polar(cx, cy, aP, r), Q = polar(cx, cy, aQ, r), R = polar(cx, cy, aR, r);
  const t = [-Math.sin(aP * Math.PI / 180), -Math.cos(aP * Math.PI / 180)]; // screen dir, anticlockwise
  const X = [P[0] + t[0] * 75, P[1] + t[1] * 75], Y = [P[0] - t[0] * 95, P[1] - t[1] * 95];
  const deg = (v) => Math.atan2(-v[1], v[0]) * 180 / Math.PI;
  const a1 = deg([cx - Q[0], cy - Q[1]]), a2 = deg([P[0] - Q[0], P[1] - Q[1]]);
  let lo = Math.min(a1, a2), hi = Math.max(a1, a2);
  if (hi - lo > 180) [lo, hi] = [hi, lo + 360];
  const [tx, ty] = polar(Q[0], Q[1], (lo + hi) / 2, 34);
  const L = (a, b) => `<line class="ln" x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}"/>`;
  const T = (p, dx, dy, s) => `<text class="it" x="${p[0] + dx}" y="${p[1] + dy}">${s}</text>`;
  let s = `<svg class="diag" viewBox="0 0 350 250" role="img" aria-label="Circle with tangent XPY">`;
  s += `<circle class="ln" cx="${cx}" cy="${cy}" r="${r}"/>`;
  s += L(R, Q) + L([cx, cy], P) + L(P, Q) + L(X, Y);
  s += `<circle class="dot" cx="${cx}" cy="${cy}" r="3"/>`;
  s += arc(Q[0], Q[1], lo, hi, 20);
  s += `<text class="lab" text-anchor="middle" x="${tx}" y="${ty + 5}">${theta}°</text>`;
  s += T(P, 8, -4, 'P') + T(Q, 6, 16, 'Q') + T(R, -16, -4, 'R') + T([cx, cy], -6, 20, 'O') + T(X, -14, 4, 'X') + T(Y, 6, 8, 'Y');
  s += `<text class="sm" x="345" y="245" text-anchor="end">Diagram not drawn to scale</text></svg>`;
  return s;
}

function vennSVG(v) {
  let s = `<svg class="diag" viewBox="0 0 320 250" role="img" aria-label="Venn diagram of languages">`;
  s += `<rect class="thin" x="8" y="8" width="304" height="234" rx="4"/>`;
  s += `<text class="lab" x="16" y="28">ε</text>`;
  s += `<circle class="ln" cx="125" cy="95" r="62"/><circle class="ln" cx="195" cy="95" r="62"/><circle class="ln" cx="160" cy="155" r="62"/>`;
  s += `<text class="lab" x="90" y="26" text-anchor="middle">Welsh</text><text class="lab" x="232" y="26" text-anchor="middle">English</text>`;
  s += `<text class="lab" x="160" y="234" text-anchor="middle">Spanish</text>`;
  const T = (x, y, n) => `<text class="lab" x="${x}" y="${y}" text-anchor="middle">${n}</text>`;
  s += T(95, 85, v.w) + T(225, 85, v.e) + T(160, 70, v.we) + T(160, 118, v.wes) + T(122, 142, v.ws) + T(198, 142, v.es) + T(160, 190, v.s) + T(285, 225, v.none);
  s += `</svg>`;
  return s;
}

/* =========================================================
   Questions — each function returns a fresh randomised card
   ========================================================= */
const QUESTIONS = [
  // 1 — linear equation
  () => {
    const d = pick([-9, -8, -7, -6, -5, -4, -3, -2]);
    const a = rnd(10, 16), c = rnd(3, 8);
    const b = rnd(3, 15);
    const e = (c - a) * d - b; // a d + b = c d - e
    return {
      topic: 'Linear equations',
      html: `<p>Solve:</p><div class="big"><i>${a}d</i> + ${b} = <i>${c}d</i> − ${e}</div>`,
      fields: [{ label: 'd =', check: (s) => numOK(s, d), answer: `d = ${fmt(d)}` }],
    };
  },

  // 2 — number machine with fractions
  () => {
    const k = pick([3, 5, 7]);
    let m, N;
    do { m = rnd(2, 9); N = k * m; } while (N % 8 === 0 || N < 10 || N > 38);
    const w = Math.floor(N / 8), rem = N % 8, g = gcd(rem, 8);
    const out = m - 1 / 8;
    return {
      topic: 'Fractions & indices',
      html: `<p>A number machine is shown below.</p>
        <div class="machine">
          <div class="mbox io">INPUT</div><span class="arrow">→</span>
          <div class="mbox">Divide by ${F(k, 8)}</div><span class="arrow">→</span>
          <div class="mbox">Subtract ${F(1, '2<sup>3</sup>')}</div><span class="arrow">→</span>
          <div class="mbox io">OUTPUT</div>
        </div>
        <p>The INPUT number is <b>${w}&nbsp;${F(rem / g, 8 / g)}</b>.</p>
        <p>What is the OUTPUT number? Give your answer as a mixed number.</p>`,
      fields: [{ label: 'Output', num: false, hint: 'e.g. type a mixed number like 3 1/4', check: (s) => numOK(s, out), answer: `${m - 1} 7/8` }],
    };
  },

  // 3 — parallel lines
  () => {
    const x = rnd(36, 52), y = rnd(58, 76);
    return {
      topic: 'Angles in parallel lines',
      html: `<p>Find the size of each of the angles marked <i>a</i>, <i>b</i> and <i>c</i>.</p>${parallelLinesSVG(x, y)}`,
      fields: [
        { label: 'a =', check: (s) => numOK(s, x), answer: `${x}°` },
        { label: 'b =', check: (s) => numOK(s, y), answer: `${y}°` },
        { label: 'c =', check: (s) => numOK(s, 180 - y), answer: `${180 - y}°` },
      ],
    };
  },

  // 4 — beads probability
  () => {
    const pb = pick([24, 28, 32, 36, 40, 44, 48, 52]) / 100;
    const red = round((1 - 1.5 * pb) / 2, 4);
    return {
      topic: 'Probability',
      html: `<p>There is a large number of beads in a bag. There are 4 colours: yellow, red, black and white.</p>
        <p>The number of yellow beads is the same as the number of red beads.<br>There are twice as many black beads as white beads.</p>
        <p>A bead is selected at random. The probability that it is black is <b>${pb}</b>.</p>
        <p>What is the probability that the bead selected is <b>red</b>?</p>`,
      fields: [{ label: 'P(red) =', check: (s) => numOK(s, red), answer: `${red}` }],
    };
  },

  // 5 — transformations
  () => {
    const a = rnd(2, 4), b = rnd(2, 4);
    const g1 = grid({ xmin: -7, xmax: 7, ymin: -7, ymax: 7, u: 20, lx: 2, ly: 2, label: 'Square on a grid' });
    const sq = g1.s + poly(g1, [[a - 2, b - 2], [a + 2, b - 2], [a + 2, b + 2], [a - 2, b + 2]], 'sa') +
      `<circle class="dot" cx="${g1.X(a)}" cy="${g1.Y(b)}" r="4"/>` + g1.end;

    const k = pick([-3, -2, -1, 1, 2]);
    const gap = rnd(2, 4), vy = rnd(-1, 1);
    const right = k - gap;
    const A = [[right - 4, 6], [right - 2, 6], [right, 4], [right, 2]].map(([x, y]) => [x, y + vy]);
    const B = A.map(([x, y]) => [2 * k - x, y]);
    const xs = [...A, ...B].map((p) => p[0]);
    const xmin = Math.min(-1, Math.min(...xs) - 1), xmax = Math.max(1, Math.max(...xs) + 1);
    const g2 = grid({ xmin: xmin - (xmin % 2 ? 1 : 0), xmax: xmax + (xmax % 2 ? 1 : 0), ymin: -2, ymax: 8, u: 17, lx: 2, ly: 2, label: 'Shapes A and B' });
    const cA = A.reduce((p, q) => [p[0] + q[0] / 4, p[1] + q[1] / 4], [0, 0]);
    const cB = [2 * k - cA[0], cA[1]];
    const refl = g2.s + poly(g2, A, 'sa') + poly(g2, B, 'sa') +
      `<text class="lab" text-anchor="middle" x="${g2.X(cA[0])}" y="${g2.Y(cA[1]) + 5}">A</text>` +
      `<text class="lab" text-anchor="middle" x="${g2.X(cB[0])}" y="${g2.Y(cB[1]) + 5}">B</text>` + g2.end;

    const lineOK = (s) => {
      let t = norm(s).replace(/reflection|reflect(ed)?|mirror|\bin\b|\bthe\b|\bline\b|\bof\b|\bat\b|:/g, ' ').trim();
      if (/^y\s*=/.test(t)) return false;
      t = t.replace(/^x\s*=\s*/, '');
      return numOK(t, k);
    };
    return {
      topic: 'Transformations',
      html: `<p><b>(a)</b> A square has its centre marked with a dot. It is rotated 90° <b>anticlockwise</b> about the origin.</p>${sq}
        <p>What are the coordinates of the centre of the square in its new position?</p>`,
      fields: [
        { label: '(a) New centre', hint: 'e.g. (2, -5)', check: (s) => coordOK(s, -b, a), answer: `(${fmt(-b)}, ${a})` },
        {
          label: '(b) Shape A is reflected onto shape B. What is the equation of the mirror line?',
          pre: refl, hint: 'e.g. x = 3', check: lineOK, answer: `x = ${fmt(k)}`,
        },
      ],
    };
  },

  // 6 — LCM boxes
  () => {
    const [kn, fo, sp] = pick([[14, 16, 10], [12, 15, 8], [12, 18, 8], [14, 10, 12], [9, 12, 15], [16, 12, 10], [6, 8, 14], [18, 12, 10]]);
    const lcm = (a, b) => a * b / gcd(a, b);
    const L = lcm(lcm(kn, fo), sp);
    return {
      topic: 'LCM problem',
      html: `<p>Delyth is making packs of wooden cutlery. Each pack contains one knife, one fork and one spoon.</p>
        <p>She buys:</p>
        <ul><li>boxes of <b>${kn}</b> knives</li><li>boxes of <b>${fo}</b> forks</li><li>boxes of <b>${sp}</b> spoons</li></ul>
        <p>She wants to buy the <b>least</b> possible number of boxes so that she uses all of the knives, forks and spoons she has bought.</p>
        <p>How many boxes of each does she need?</p>`,
      fields: [
        { label: `Knives (${kn} per box)`, check: (s) => numOK(s, L / kn), answer: `${L / kn} boxes` },
        { label: `Forks (${fo} per box)`, check: (s) => numOK(s, L / fo), answer: `${L / fo} boxes` },
        { label: `Spoons (${sp} per box)`, check: (s) => numOK(s, L / sp), answer: `${L / sp} boxes` },
      ],
    };
  },

  // 7 — inequality ages
  () => {
    let m, n, T;
    do { m = rnd(20, 28); n = rnd(3, 8); T = pick([90, 100, 110, 120]); } while ((T + 2 * m + n) % 3 === 0);
    const ans = Math.floor((T + 2 * m + n) / 3) + 1;
    return {
      topic: 'Forming inequalities',
      html: `<p>Rhodri works with his 2 daughters in their family business.</p>
        <p>Rhodri is <i>x</i> years old, where <i>x</i> is a whole number.<br>
        Megan, his older daughter, is (<i>x</i> − ${m}) years old.<br>
        Gwenda, his younger daughter, is ${n} years younger than Megan.</p>
        <div class="callout">“The total age of our 3 workers is greater than ${T} years.”</div>
        <p>What is the <b>youngest</b> possible age Rhodri could be for this statement to be true?</p>`,
      fields: [{ label: 'Rhodri’s youngest possible age', check: (s) => numOK(s, ans), answer: `${ans}` }],
    };
  },

  // 8 — relative frequency
  () => {
    let c;
    do { c = [rnd(0, 5), rnd(0, 4), rnd(0, 5), rnd(0, 4)]; } while (c.reduce((a, b) => a + b) < 3);
    const s = c.reduce((a, b) => a + b);
    const N = pick([2000, 4000, 5000, 6000, 8000, 10000]);
    return {
      topic: 'Relative frequency',
      html: `<p>Oranges are transported in boxes. There are 50 oranges in each layer and each box has 4 layers.</p>
        <p>One box is opened. The number of rotten oranges in each of the 4 layers is:</p>
        <div class="terms">${c.map((x) => `<span>${x}</span>`).join('')}</div>`,
      fields: [
        { label: '(a) Best estimate of the relative frequency of rotten oranges', hint: 'A fraction or decimal', check: (x) => numOK(x, s / 200), answer: `${fracStr(s, 200)} (= ${s / 200})` },
        { label: `(b) There are ${N.toLocaleString('en-GB')} oranges on the truck. How many rotten oranges would you expect?`, check: (x) => numOK(x, s * N / 200), answer: `${s * N / 200}` },
      ],
    };
  },

  // 9 — estimation with cube roots
  () => {
    const c = pick([2, 3, 4, 6]);
    const A = c ** 3 * 1000 + pick([-3, -2, 1, 2, 3, 4]);
    const B = pick(['8.05', '7.96', '8.03', '7.98', '8.02']);
    const ans = c * 10 / 4;
    return {
      topic: 'Estimation',
      html: `<p>Use approximation to estimate:</p>
        <div class="big">${CB(F(A, `${B}<sup>2</sup>`))}</div>
        <p>Give your answer correct to 2 significant figures.</p>`,
      fields: [{ label: 'Estimate', check: (s) => numOK(s, ans), answer: ans < 10 ? ans.toFixed(1) : `${ans}` }],
    };
  },

  // 10 — tree diagram
  () => {
    const p1 = pick([0.1, 0.2, 0.3, 0.4]), p2 = pick([0.5, 0.6, 0.7, 0.8]);
    const sat = round(1 - p1, 2), sun = round(1 - p2, 2), both = round(sat * p2, 4);
    return {
      topic: 'Tree diagrams',
      html: `<p>Every weekend Ravi works on Saturday and Sunday. Each day he is given one job: <b>answer the phone</b> or <b>pack boxes</b>.</p>
        <p>The probability he answers the phone on Saturday is ${p1}. The probability he packs boxes on Sunday is ${p2}. The days are independent.</p>${treeSVG(p1, p2)}`,
      fields: [
        { label: 'Probability A (packs boxes on Saturday)', check: (s) => numOK(s, sat), answer: `${sat}` },
        { label: 'Probability B (answers the phone on Sunday)', check: (s) => numOK(s, sun), answer: `${sun}` },
        { label: 'Probability he packs boxes on BOTH Saturday and Sunday', check: (s) => numOK(s, both), answer: `${both}` },
      ],
    };
  },

  // 11 — equal calculations
  () => {
    let a; do { a = rnd(21, 49); } while (a % 10 === 0);
    const b = rnd(3, 9);
    const itemsA = shuffle([
      { h: `${(a / 10).toFixed(1)} × ${b}`, eq: false },
      { h: `${a * 100} × ${(b / 100).toFixed(2)}`, eq: true },
      { h: `${a} × ${b * 10}`, eq: false },
      { h: `${a} ÷ ${F(1, b)}`, eq: true },
      { h: `${a * 10} × ${(b / 1000).toFixed(3)}`, eq: false },
      { h: `${a * 10} ÷ ${F(1, b * 10)}`, eq: false },
    ]);
    const itemsB = shuffle([
      { h: F(1, '2<sup>2</sup>'), eq: false },
      { h: `8<sup>${F(2, 3)}</sup>`, eq: true },
      { h: CB(16), eq: false },
      { h: '64<sup>3</sup>', eq: false },
      { h: F(1, '0.25'), eq: true },
      { h: `0.25<sup>${F(1, 2)}</sup>`, eq: false },
    ]);
    const L = 'ABCDEF';
    const want = (items) => items.map((it, i) => (it.eq ? L[i] : '')).join('');
    const wa = want(itemsA), wb = want(itemsB);
    return {
      topic: 'Number & indices',
      html: `<p><b>(a)</b> When evaluated, which two of these calculations are equal?</p>`,
      fields: [
        { label: 'Tap the two that are equal', choices: itemsA.map((it) => it.h), pickN: 2, check: (s) => lettersOK(s, wa), answer: `${wa[0]} and ${wa[1]}` },
        { label: '(a) What are they both equal to?', check: (s) => numOK(s, a * b), answer: `${a * b}` },
        { label: 'Tap the two that are equal', pre: '<p><b>(b)</b> Which two of the following numbers are equal?</p>', choices: itemsB.map((it) => it.h), pickN: 2, check: (s) => lettersOK(s, wb), answer: `${wb[0]} and ${wb[1]}` },
        { label: '(b) What are they both equal to?', check: (s) => numOK(s, 4), answer: '4' },
      ],
    };
  },

  // 12 — factorise & solve quadratic
  () => {
    let p, q; do { p = rnd(2, 9); q = rnd(2, 9); } while (p === q);
    const S = p + q, P = p * q;
    const smp = [{ x: 1.37 }, { x: -2.6 }, { x: 4.11 }, { x: 11.9 }];
    return {
      topic: 'Quadratics',
      html: `<p>Factorise <b><i>x</i><sup>2</sup> − ${S}<i>x</i> + ${P}</b>.</p><p>Hence, solve <b><i>x</i><sup>2</sup> − ${S}<i>x</i> + ${P} = 0</b>.</p>`,
      keys: KEYS_ALG,
      fields: [
        {
          label: 'Factorised form', hint: 'e.g. (x - 2)(x - 3)',
          check: (s) => exprOK(s, (v) => v.x * v.x - S * v.x + P, smp, { allowed: ['x'], require: /\(/, forbid: /\^|x\s*\*?\s*x/ }),
          answer: `(x − ${Math.min(p, q)})(x − ${Math.max(p, q)})`,
        },
        { label: 'Solutions: x =', hint: 'e.g. 2, 3', check: (s) => multiOK(s, [p, q]), answer: `x = ${Math.min(p, q)} or x = ${Math.max(p, q)}` },
      ],
    };
  },

  // 13 — linear sequence
  () => {
    const d = rnd(11, 19);
    let S; do { S = rnd(1500, 2600); } while (S % d === 0);
    const n = Math.floor((S + d) / d) + 1, val = S + d - d * n;
    return {
      topic: 'Sequences',
      html: `<p>Here is a linear sequence of numbers.</p><div class="terms">${[0, 1, 2, 3].map((i) => `<span>${S - i * d}</span>`).join('<span>,</span>')}<span>…</span></div>`,
      fields: [
        { label: 'The first number in the sequence that is less than zero', check: (s) => numOK(s, val), answer: fmt(val) },
        { label: 'Which term of the sequence is this?', hint: 'e.g. 120 for the 120th term', check: (s) => numOK(s, n), answer: `${n}th term` },
      ],
    };
  },

  // 14 — circle theorems
  () => {
    const dAng = rnd(95, 115), cAng = rnd(100, 120), th = rnd(55, 78);
    return {
      topic: 'Circle theorems',
      html: `<p><b>(a)</b> Points <i>A, B, C</i> and <i>D</i> lie on the circumference of a circle.</p>${cyclicSVG(dAng, cAng)}`,
      fields: [
        { label: '(a) Find the size of angle ABC', check: (s) => numOK(s, 180 - dAng), answer: `${180 - dAng}° (opposite angles in a cyclic quadrilateral add to 180°)` },
        {
          label: '(b) Find the size of angle YPQ',
          pre: `<p><b>(b)</b> Points <i>P, Q</i> and <i>R</i> lie on a circle, centre <i>O</i>. The straight line <i>XPY</i> is a tangent to the circle at <i>P</i>.</p>${tangentSVG(th)}`,
          check: (s) => numOK(s, 90 - th), answer: `${90 - th}°`,
        },
      ],
    };
  },

  // 15 — recurring decimal & indices
  () => {
    const [m, ab] = pick([[7, 21], [7, 42], [7, 63], [7, 84], [5, 15], [5, 45], [5, 75], [11, 33], [13, 39], [13, 78], [5, 60]]);
    const ds = String(ab);
    const ans = (2 * ab) / (3 * m);
    return {
      topic: 'Recurring decimals & indices',
      html: `<p>Evaluate:</p><div class="big">0.<span class="rec">${ds[0]}</span><span class="rec">${ds[1]}</span> × ( ${F(m, `4<sup>${F(1, 2)}</sup> + 2<sup>6</sup>`)} )<sup>−1</sup></div>`,
      fields: [{ label: 'Answer', check: (s) => numOK(s, ans), answer: `${ans}` }],
    };
  },

  // 16 — inequality region
  () => {
    const c = rnd(3, 6), c2 = rnd(3, 5), k = rnd(7, 10);
    const g = grid({ xmin: -15, xmax: 15, ymin: -15, ymax: 15, u: 11, lx: 5, ly: 5, pad: 24, label: 'Shaded region' });
    const xi = 2 * (c + c2) / 3, yi = xi - c2;
    const region = [[-k, -k - c2], [-k, k / 2 + c], [xi, yi]];
    let s = g.s + poly(g, region, 'shade');
    s += `<line class="ln" x1="${g.X(-15)}" y1="${g.Y(7.5 + c)}" x2="${g.X(15)}" y2="${g.Y(-7.5 + c)}"/>`;
    s += `<line class="dash" x1="${g.X(-15 + c2)}" y1="${g.Y(-15)}" x2="${g.X(15)}" y2="${g.Y(15 - c2)}"/>`;
    s += `<line class="dash" x1="${g.X(-k)}" y1="${g.Y(-15)}" x2="${g.X(-k)}" y2="${g.Y(15)}"/>`;
    s += g.end;
    return {
      topic: 'Inequalities & regions',
      keys: KEYS_INEQ,
      html: `<p>The shaded region is described by three inequalities. One of them is <b><i>x</i> &gt; −${k}</b>.</p>${s}
        <p class="note">Solid line = included (≤ or ≥). Dashed line = not included (&lt; or &gt;).</p>`,
      fields: [
        { label: 'Inequality for the solid sloping line', hint: 'e.g. y >= 2x + 1', check: (x) => ineqOK(x, (X, Y) => Y - (-X / 2 + c), '<='), answer: `y ≤ −½x + ${c}` },
        { label: 'Inequality for the dashed sloping line', check: (x) => ineqOK(x, (X, Y) => Y - (X - c2), '>'), answer: `y > x − ${c2}` },
      ],
    };
  },

  // 17 — negative enlargement
  () => {
    const C = [rnd(-4, 1), rnd(-3, 1)];
    const shapes = [[[1, 1], [3, 1], [1, 2]], [[1, 1], [2, 2.5], [3, 1]], [[1, 1], [3, 2], [1, 2]], [[1, 0.5], [3, 1], [2, 2]]];
    const sx = pick([1, -1]), sy = pick([1, -1]);
    const off = pick(shapes).map(([x, y]) => [x * sx, y * sy]);
    const A = off.map(([x, y]) => [C[0] + x, C[1] + y]);
    const B = off.map(([x, y]) => [C[0] - 2 * x, C[1] - 2 * y]);
    const all = [...A, ...B, [0, 0]];
    const xmin = Math.floor(Math.min(...all.map((p) => p[0]))) - 1, xmax = Math.ceil(Math.max(...all.map((p) => p[0]))) + 1;
    const ymin = Math.floor(Math.min(...all.map((p) => p[1]))) - 1, ymax = Math.ceil(Math.max(...all.map((p) => p[1]))) + 1;
    const u = Math.min(26, 360 / (xmax - xmin));
    const g = grid({ xmin, xmax, ymin, ymax, u, lx: 2, ly: 2, label: 'Shapes A and B' });
    const cen = (P) => [P.reduce((s, p) => s + p[0], 0) / 3, P.reduce((s, p) => s + p[1], 0) / 3];
    const [ax, ay] = cen(A), [bx, by] = cen(B);
    const svg = g.s + poly(g, A, 'sa') + poly(g, B, 'sb') +
      `<text class="lab" text-anchor="middle" x="${g.X(ax)}" y="${g.Y(ay) + 5}">A</text>` +
      `<text class="lab" text-anchor="middle" x="${g.X(bx)}" y="${g.Y(by) + 5}">B</text>` + g.end;
    return {
      topic: 'Enlargement',
      html: `<p>Shape <b>A</b> has been enlarged to give shape <b>B</b>.</p>${svg}`,
      fields: [
        { label: 'Scale factor', check: (s) => numOK(s, -2), answer: '−2' },
        { label: 'Centre of enlargement', hint: 'e.g. (1, -3)', check: (s) => coordOK(s, C[0], C[1]), answer: `(${fmt(C[0])}, ${fmt(C[1])})` },
      ],
    };
  },

  // 18 — graph to solve a quadratic
  () => {
    const m = pick([5, 6, 7, 8, 10, 11, 12, 13, 14]);
    const r = Math.sqrt(m), c = m - 16;
    const g = grid({ xmin: -6, xmax: 6, ymin: -20, ymax: 20, u: 26, uy: 5, sx: 0.5, sy: 2, lx: 2, ly: 10, label: 'Graph of y = (x+4)(x−4)' });
    let pts = '';
    for (let x = -6; x <= 6.001; x += 0.1) pts += `${g.X(x)},${g.Y(x * x - 16)} `;
    let s = g.s + `<polyline class="ln" points="${pts}"/>`;
    for (let x = -6; x <= 6; x++) s += `<circle class="dot" cx="${g.X(x)}" cy="${g.Y(x * x - 16)}" r="2.6"/>`;
    s += g.end;
    return {
      topic: 'Solving using graphs',
      html: `<p>The graph of <b><i>y</i> = (<i>x</i> + 4)(<i>x</i> − 4)</b> is shown below.</p>${s}
        <p>You want to solve <b><i>x</i><sup>2</sup> − ${m} = 0</b> by drawing a straight line on the graph.</p>`,
      fields: [
        { label: 'Which horizontal line would you draw? y =', check: (x) => numOK(x, c), answer: `y = ${fmt(c)}` },
        { label: 'Solutions (to 1 decimal place)', hint: 'Give both, e.g. 1.5, -1.5', check: (x) => multiOK(x, [r, -r], { tol: 0.1 }), answer: `x = ${round(r, 1)} or x = −${round(r, 1)}` },
      ],
    };
  },

  // 19 — change the subject
  () => {
    const a = pick([2, 3, 4]), b = pick([5, 7, 10, 11, 13]);
    const a3 = a ** 3;
    const smp = [a + 0.7, a + 1.3, a + 2.9, a + 5.1].map((h) => ({ h }));
    return {
      topic: 'Changing the subject',
      keys: KEYS_ALG,
      html: `<p>Make <i>g</i> the subject of the formula:</p><div class="big"><i>gh</i> = ${CB(`${a3}<i>g</i><sup>3</sup> + ${b}`)}</div>`,
      fields: [{
        label: 'g =', hint: 'Use ∛( ) for a cube root, e.g. ∛(5/(h^3 - 8))',
        check: (s) => exprOK(s, (v) => Math.cbrt(b / (v.h ** 3 - a3)), smp, { lhs: 'g', allowed: ['h'] }),
        answer: `g = ∛( ${b} / (h³ − ${a3}) )`,
      }],
    };
  },

  // 20 — surds
  () => {
    let n, k; do { n = pick([2, 3, 5, 6, 7]); k = pick([3, 4, 5]); } while (k * k * n > 180);
    const ans = n * (k - 1) ** 2;
    return {
      topic: 'Surds',
      html: `<p>Find the value of:</p><div class="big">(${SQ(k * k * n)} − ${SQ(n)})<sup>2</sup></div>`,
      fields: [{ label: 'Answer', check: (s) => numOK(s, ans), answer: `${ans}` }],
    };
  },

  // 21 — algebraic fractions
  () => {
    const [p, q] = pick([[2, 3], [2, 5], [3, 2], [3, 1], [2, 1], [3, 4]]);
    const r = pick([2, 3, 4].filter((x) => x !== p));
    const smp = [1.7, 2.9, -3.4, 5.3].map((w) => ({ w }));
    return {
      topic: 'Algebraic fractions',
      keys: KEYS_ALG,
      html: `<p>Simplify fully:</p><div class="big">${F(`${p * p}<i>w</i><sup>2</sup> − ${q * q}`, `${r * p}<i>w</i><sup>2</sup> − ${r * q}<i>w</i>`)}</div>`,
      fields: [{
        label: 'Simplified', hint: 'Use brackets, e.g. (2w + 1)/(5w)',
        check: (s) => exprOK(s, (v) => (p * v.w + q) / (r * v.w), smp, { allowed: ['w'], forbid: /\^\s*2|w\s*\*?\s*w/ }),
        answer: `(${p}w + ${q}) / (${r}w)`,
      }],
    };
  },

  // 22 — Venn probability, without replacement
  () => {
    let v, N, M;
    do {
      v = { w: rnd(0, 3), e: rnd(2, 5), we: rnd(8, 13), wes: rnd(3, 7), ws: rnd(2, 5), es: rnd(1, 4), s: rnd(0, 3), none: rnd(0, 2) };
      N = Object.values(v).reduce((a, b) => a + b);
      M = N - (v.wes + v.ws + v.es + v.s);
    } while (N < 22 || N > 32 || M < 6);
    const num = N * (N - 1) * (N - 2) - M * (M - 1) * (M - 2), den = N * (N - 1) * (N - 2);
    return {
      topic: 'Venn diagrams & probability',
      html: `<p>${N} students at a climate conference were asked what languages they speak. The results are shown in the Venn diagram.</p>${vennSVG(v)}
        <p>Three students are selected at random.</p><p>What is the probability that <b>at least one</b> of them speaks Spanish?</p>`,
      fields: [{ label: 'Probability', hint: 'A fraction is best, e.g. 5/12', check: (s) => numOK(s, num / den), answer: fracStr(num, den) }],
    };
  },
];

/* =========================================================
   Results messages
   ========================================================= */
const yrs = (n) => `${n} extra year${n === 1 ? '' : 's'}`;

function verdict(name, age, pct) {
  const N = `<b>${esc(name)}</b>`;
  const young = age <= 16;
  let opts;
  if (pct === 100) {
    opts = [
      `Perfect score, ${N}! Either you're a genius or there's a calculator hidden under the table. We'll never know.`,
      `100%, ${N}. Flawless. Now please go outside and touch some grass.`,
    ];
  } else if (pct >= 80) {
    opts = young
      ? [`Great work ${N}! At ${age} you're already GCSE-ready. Insufferable, frankly.`,
         `Brilliant, ${N}. You're smarter than most of your teachers think you are. Low bar, but still.`]
      : [`Great work ${N}, you're as good as a 16 year old — only took you ${yrs(age - 16)}.`,
         `Impressive, ${N}! You'd absolutely smash GCSE maths. Shame you're ${age} and nobody's asking.`];
  } else if (pct >= 60) {
    opts = young
      ? [`Not bad, ${N}! You're on track… if the track is slightly wobbly and has a few potholes.`,
         `Decent effort, ${N}. You're about Year 10 standard — which is great if you're in Year 10.`]
      : [`Good effort ${N} — you're nearly as good as a Year 10. Only took you ${yrs(age - 15)} to get there.`,
         `Solid, ${N}. You'd pass… just. A bit like your driving test, probably.`];
  } else if (pct >= 40) {
    opts = young
      ? [`Well done ${N}, you're smarter than a top set Year 7${age <= 12 ? ' — which, to be fair, you might actually be.' : '. Hmm.'}`,
         `${N}, that was… fine. Your maths teacher would say “shows potential”. They say that to everyone.`]
      : [`Well done ${N}, you're smarter than a top set Year 7!`,
         `${N}, you'd hold your own in a Year 9 maths class — as long as nobody asked you anything.`];
  } else if (pct >= 20) {
    opts = [
      `Nice try, ${N}. You're roughly as sharp as a Year 8 in the last lesson on a Friday afternoon.`,
      `${N}, you're officially smarter than a bottom set Year 8. Every journey starts somewhere.`,
      `Well, ${N}, you got some right. A stopped clock is right twice a day too.`,
    ];
  } else {
    opts = [
      `Oh ${N}… at ${age}, you've just been out-mathsed by a Year 6 with a broken calculator.`,
      `${N}, that was brave. Wrong, but brave. A golden retriever would've scored about the same — and it didn't need ${age} years of practice.`,
      `${N}, we checked: guessing randomly would have been more effective. Impressive in its own way.`,
    ];
  }
  return pick(opts);
}

/* =========================================================
   Quiz flow
   ========================================================= */
const state = { name: '', age: 0, cards: [], i: 0, marks: 0, total: 0, log: [], checked: false, lastInput: null };

function start(e) {
  e.preventDefault();
  const name = $('#name').value.trim();
  const age = parseInt($('#age').value, 10);
  const err = $('#startError');
  if (!name) { err.textContent = 'Please enter your name.'; return; }
  if (!age || age < 5 || age > 120) { err.textContent = 'Please enter a real age (5–120).'; return; }
  err.textContent = '';
  state.name = name; state.age = age;
  newGame();
}

function newGame() {
  state.cards = shuffle(QUESTIONS.slice()).map((q) => q());
  state.i = 0; state.marks = 0; state.log = [];
  state.total = state.cards.reduce((s, c) => s + c.fields.length, 0);
  $('#start').classList.add('hidden');
  $('#end').classList.add('hidden');
  $('#quiz').classList.remove('hidden');
  $('#progress').classList.remove('hidden');
  render();
}

const KEYS_NUM = ['−', '/', '.'];
const KEYS_ALG = ['−', '/', '(', ')', '^', '²', '³', '√', '∛'];
const KEYS_INEQ = ['−', '/', '(', ')', '≤', '≥', '<', '>', '½'];

// Single-number answers get the number pad (− and / are on the symbol buttons)
const isNum = (f) => f.num ?? /numOK\(/.test(f.check.toString());

function render() {
  const card = state.cards[state.i];
  state.checked = false;
  let h = `<div class="qhead"><span class="qnum">Question ${state.i + 1}</span><span class="qtopic">${card.topic}</span></div>`;
  h += `<div class="qbody">${card.html}</div><form id="qform" autocomplete="off" novalidate>`;
  card.fields.forEach((f, k) => {
    if (f.pre) h += `<div class="qbody">${f.pre}</div>`;
    if (f.choices) {
      h += `<div class="field" role="group" aria-labelledby="l${k}"><label id="l${k}">${f.label}</label>
        <div class="opts" data-f="${k}" data-n="${f.pickN || 1}">${f.choices.map((c, i) => `<button type="button" class="opt" data-l="${'ABCDEF'[i]}" aria-pressed="false"><b>${'ABCDEF'[i]}</b><span>${c}</span></button>`).join('')}</div>
        <input id="f${k}" type="hidden" value="">
        <div class="feedback" id="fb${k}"></div></div>`;
      return;
    }
    h += `<div class="field"><label for="f${k}">${f.label}</label>
      <input id="f${k}" type="text" inputmode="${isNum(f) ? 'decimal' : 'text'}" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="${k === card.fields.length - 1 ? 'done' : 'next'}">
      ${f.hint ? `<div class="hint">${f.hint}</div>` : ''}
      <div class="feedback" id="fb${k}"></div></div>`;
  });
  h += `<div class="keys" aria-label="Maths symbols">${(card.keys || KEYS_NUM).map((k) => `<button type="button" data-k="${k}">${k}</button>`).join('')}</div>`;
  h += `<button type="submit" class="btn primary" id="go">Check answer${card.fields.length > 1 ? 's' : ''}</button></form>`;
  const el = $('#card');
  el.innerHTML = h;
  state.lastInput = el.querySelector('input[type=text]');
  el.querySelectorAll('.opts[data-f]').forEach((grp) => {
    const n = +grp.dataset.n, hidden = $('#f' + grp.dataset.f);
    let sel = [];
    grp.querySelectorAll('.opt').forEach((b) => b.addEventListener('click', () => {
      if (state.checked) return;
      const l = b.dataset.l;
      if (sel.includes(l)) sel = sel.filter((x) => x !== l);
      else { sel.push(l); if (sel.length > n) sel.shift(); }
      grp.querySelectorAll('.opt').forEach((o) => o.setAttribute('aria-pressed', sel.includes(o.dataset.l)));
      hidden.value = sel.slice().sort().join('');
    }));
  });
  el.querySelectorAll('input').forEach((inp) => inp.addEventListener('focus', () => { state.lastInput = inp; }));
  el.querySelectorAll('.keys button').forEach((b) => {
    b.addEventListener('pointerdown', (e) => e.preventDefault()); // keep the keyboard open
    b.addEventListener('click', () => insertKey(b.dataset.k));
  });
  $('#qform').addEventListener('submit', onSubmit);
  updateProgress();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function insertKey(k) {
  const inp = state.lastInput;
  if (!inp || inp.disabled) return;
  const map = { '−': '-', '√': '√(', '∛': '∛(' };
  const t = map[k] || k;
  const a = inp.selectionStart ?? inp.value.length, b = inp.selectionEnd ?? inp.value.length;
  inp.value = inp.value.slice(0, a) + t + inp.value.slice(b);
  const pos = a + t.length;
  inp.focus();
  try { inp.setSelectionRange(pos, pos); } catch (e) { /* ignore */ }
}

function onSubmit(e) {
  e.preventDefault();
  if (state.checked) { nextCard(); return; }
  const card = state.cards[state.i];
  // "Enter" on a non-final empty field moves to the next field
  const active = document.activeElement;
  const inputs = [...document.querySelectorAll('#qform input[type=text]')];
  const idx = inputs.indexOf(active);
  if (idx >= 0 && idx < inputs.length - 1 && inputs.some((i) => !i.value.trim())) {
    inputs[idx + 1].focus();
    return;
  }
  card.fields.forEach((f, k) => {
    const inp = $('#f' + k), fb = $('#fb' + k);
    let ok = false;
    try { ok = !!f.check(inp.value); } catch (err) { ok = false; }
    if (ok) state.marks++;
    const given = f.choices ? inp.value.split('').join(' and ') : inp.value;
    state.log.push({ q: state.i + 1, topic: card.topic, label: f.label, given, answer: f.answer, ok });
    if (f.choices) {
      document.querySelectorAll(`.opts[data-f="${k}"] .opt`).forEach((o) => {
        const right = f.answer.includes(o.dataset.l), picked = inp.value.includes(o.dataset.l);
        if (right) o.classList.add('right');
        else if (picked) o.classList.add('wrongpick');
        o.disabled = true;
      });
    }
    inp.classList.add(ok ? 'correct' : 'wrong');
    inp.disabled = true;
    fb.className = 'feedback ' + (ok ? 'good' : 'bad');
    fb.textContent = ok ? '✓ Correct' : `✗ Answer: ${f.answer}`;
  });
  state.checked = true;
  const go = $('#go');
  go.textContent = state.i === state.cards.length - 1 ? 'See my results' : 'Next question →';
  document.querySelector('.keys').classList.add('hidden');
  updateProgress(true);
  go.focus();
}

function nextCard() {
  state.i++;
  if (state.i >= state.cards.length) finish();
  else render();
}

function updateProgress(done) {
  const n = state.cards.length;
  const completed = state.i + (done ? 1 : 0);
  $('#fill').style.width = `${(completed / n) * 100}%`;
  $('#pLabel').textContent = `Question ${Math.min(state.i + 1, n)} of ${n} · ${n - completed} left`;
  $('#pScore').textContent = `Score: ${state.marks}`;
}

function finish() {
  const pct = Math.round((state.marks / state.total) * 100);
  $('#quiz').classList.add('hidden');
  $('#fill').style.width = '100%';
  $('#pLabel').textContent = 'All done!';
  const color = pct >= 80 ? 'var(--good)' : pct >= 40 ? 'var(--text)' : 'var(--bad)';
  const review = state.log.map((l) => `<li><span class="${l.ok ? 'tick' : 'cross'}">${l.ok ? '✓' : '✗'}</span> Q${l.q} ${esc(l.topic)} — ${l.label}<br>
      <span class="muted">You: ${esc(l.given || '(blank)')}${l.ok ? '' : ` · Answer: ${esc(l.answer)}`}</span></li>`).join('');
  $('#end').innerHTML = `<div class="card">
      <h2 class="center">Results</h2>
      <div class="score-box"><div class="pct">${pct}%</div>
        <div class="meter"><div style="width:${pct}%;background:${color}"></div></div>
        <p class="muted">${state.marks} out of ${state.total} marks</p></div>
      <p class="verdict">${verdict(state.name, state.age, pct)}</p>
      <button class="btn primary" id="again">Try again (new numbers)</button>
      <button class="btn secondary" id="change">Change player</button>
      <details class="review"><summary>Review your answers</summary><ol>${review}</ol></details>
    </div>`;
  $('#end').classList.remove('hidden');
  $('#again').addEventListener('click', newGame);
  $('#change').addEventListener('click', () => {
    $('#end').classList.add('hidden');
    $('#progress').classList.add('hidden');
    $('#start').classList.remove('hidden');
  });
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

$('#startForm').addEventListener('submit', start);

/* Light / dark mode toggle (follows the device setting until the player chooses) */
function currentTheme() {
  const t = document.documentElement.dataset.theme;
  if (t) return t;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function syncThemeButton() {
  const dark = currentTheme() === 'dark';
  $('#themeToggle').textContent = dark ? 'Light mode' : 'Dark mode';
  document.querySelector('meta[name="theme-color"]').content = dark ? '#3a3a3a' : '#f7f5f0';
}
$('#themeToggle').addEventListener('click', () => {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('theme', next); } catch (e) { /* private mode */ }
  syncThemeButton();
});
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncThemeButton);
syncThemeButton();

// Expose for testing in the console
window.__quiz = { numOK, multiOK, coordOK, exprOK, ineqOK, lettersOK, QUESTIONS };
