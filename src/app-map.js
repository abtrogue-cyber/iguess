/* =====================================================================
 * Portfolio map: a zoomable treemap you can walk into and through time.
 *   portfolio → group → holding → its purchase lots
 * Area = the size lens (value, gain or cost), colour = the colour lens
 * (return since bought, 1 day, 1 month, YTD) on the diverging gain/loss
 * scale. Tiles are keyed, so every change (zoom, lens, date) animates.
 * The immersive mode adds a time machine (replay every holding since the
 * first trade) and a dossier for the holding you are looking at.
 * ===================================================================== */
(function () {
  'use strict';
  const PT = window.PT, App = window.App, F = App.F, esc = F.esc, icon = App.icon;

  const COLORS = {
    ret: { label: 'Return', cap: 1, legend: 'return since bought' },
    d1: { label: '1D', cap: 0.05, legend: 'last trading day' },
    m1: { label: '1M', cap: 0.2, legend: 'last month' },
    ytd: { label: 'YTD', cap: 0.6, legend: 'this year' }
  };
  const SIZES = {
    value: { label: 'Value', f: n => n.value, legend: 'area = value' },
    gain: { label: 'Gain', f: n => Math.abs(n.gain), legend: 'area = unrealised gain or loss' },
    cost: { label: 'Cost', f: n => n.cost, legend: 'area = money put in' }
  };
  const GROUPS = {
    none: ['None', null],
    theme: ['Theme', h => (h.inst.tags || [])[0] || 'Untagged'],
    sector: ['Sector', h => h.inst.sector || 'Unclassified'],
    currency: ['Currency', h => h.cur],
    country: ['Country', h => h.inst.country || PT.countryFor(h.inst.isin, h.cur) || 'Unknown'],
    broker: ['Broker', h => h.broker || '—']
  };
  const ui = () => (App.ui.pm = App.ui.pm || { group: 'none', size: 'value', color: 'ret' });
  const reduced = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ================================================================= data */
  function mover(id, cur, d) {
    const r = App.res;
    return base => PT.periodMove(r, id, cur, d, base);
  }
  /** Bank warrants are known by their WKN; on the map they read better as "AMD CALL 200". */
  function shortName(inst) {
    if (inst.type !== 'warrant') return App.instLabel(inst);
    let n = String(inst.name || '').toUpperCase().replace(/^(BNP( PAR\.EHG)?|SG|HSBC|UBS|VONT(OBEL)?|CITI|DZ|HVB|MS|GS|JPM)\s+/, '');
    let kind26 = null;
    const k26 = n.match(/\b(CALL|PUT)\d{2}\s+\S+\s+/); // "CALL26 XYZ ACME …": product code before the underlying
    if (k26) { kind26 = k26[1]; n = n.replace(k26[0], ''); }
    const KW = /\b(CALL|PUT|TURBOL?|FAKTOR|FACTOR|MINI|UNLIMITED|KNOCK-?OUT|STR|BAR)\b/;
    let m = n.match(KW), under = '';
    if (m && m.index === 0) { // "TURBOL X12 ACME INC. STR 50": the product word comes first
      const rest = n.slice(m[0].length).replace(/^\s+[A-Z0-9]{2,4}\s+/, ' ');
      const m2 = rest.match(KW);
      under = (m2 ? rest.slice(0, m2.index) : rest);
    } else if (m) under = n.slice(0, m.index);
    else under = n;
    under = under.replace(/[^A-Z0-9& ]+/g, ' ').trim().split(/\s+/)[0] || '';
    const turbo = /\b(TURBOL?|UNLIMITED|MINI|KNOCK-?OUT)\b/.test(n);
    const kind = turbo ? (/\b(PUT|SHORT)\b/.test(n) ? 'TURBO SHORT' : 'TURBO') : kind26 || (/\bPUT\b/.test(n) ? 'PUT' : /\bCALL\b/.test(n) ? 'CALL' : /\b(FAKTOR|FACTOR)\b/.test(n) ? 'FAKTOR' : '');
    const lev = (n.match(/\b(?:FAKTOR|FACTOR)\s+(\d+)/) || [])[1];
    const lvl = (n.match(/\b(?:STR|BAR)\s+([\d.]+)/) || [])[1];
    const num = v => { const x = +v; return Number.isInteger(x) ? String(x) : F.num(x, 2); };
    const parts = kind === 'FAKTOR' ? [under, lev ? lev + '× LONG' : 'FAKTOR'] : [under, kind, lvl ? num(lvl) : ''];
    return under && kind ? parts.filter(Boolean).join(' ') : App.instLabel(inst);
  }
  /** Holdings today, from the computed positions (long positions with a value). */
  function holdingsNow() {
    const r = App.res;
    return r.positions.filter(p => p.value > 0).map(p => ({
      key: 'h:' + p.id, kind: 'h', id: p.id, inst: p.inst, label: shortName(p.inst), name: p.inst.type === 'option' ? p.inst.ticker : (p.inst.name || ''),
      value: p.value, cost: p.cost, gain: p.unreal, ret: p.unrealPct, qty: p.qty, price: p.price, cur: p.currency, fx: p.fx, mult: p.mult,
      broker: p.broker, since: PT.dn(p.since), dayPct: p.dayFresh ? p.dayPct : NaN, lots: p.lots, realized: p.realized, dividends: p.dividends,
      move: mover(p.id, p.currency, r.asOf)
    }));
  }
  /** Holdings on a past day, rebuilt from the engine's timeline. Lots are computed when you zoom in. */
  function holdingsOn(d) {
    return PT.holdingsAt(App.res, d).filter(h => h.value > 0).map(h => ({
      key: 'h:' + h.id, kind: 'h', id: h.id, inst: h.inst, label: shortName(h.inst), name: h.inst.type === 'option' ? h.inst.ticker : (h.inst.name || ''),
      value: h.value, cost: h.cost, gain: h.gain, ret: h.ret, qty: h.qty, price: h.price, cur: h.currency, fx: h.fx, mult: +(h.inst.multiplier || 1),
      broker: h.broker, since: h.since, dayPct: h.dayPct, lots: null, move: h.move
    }));
  }
  const atCache = new Map();
  /** Full engine state on a past day (for lots); cached because it costs a full recompute. */
  function computeAt(d) {
    if (!atCache.has(d)) { if (atCache.size > 12) atCache.clear(); atCache.set(d, PT.compute(App.state, { asOf: PT.iso(d) })); }
    return atCache.get(d);
  }
  function lotsOf(h, day) {
    let lots = h.lots;
    if (!lots && day != null) { const pos = computeAt(day).positions.find(p => p.id === h.id); lots = pos ? pos.lots : []; }
    const mult = +(h.inst.multiplier || 1);
    return (lots || []).filter(l => l.q > 0).map((l, i) => {
      const value = l.q * mult * h.price / h.fx, cost = l.q * l.uc + Math.abs(l.q) * l.uf;
      return { key: `l:${h.id}:${l.d}:${i}`, kind: 'l', parent: h, label: F.date(PT.iso(l.d)), date: l.d, qty: l.q, buy: l.p, bcur: l.cur, value, cost, gain: value - cost, ret: cost > 0 ? value / cost - 1 : NaN, inKind: !!l.inKind };
    });
  }
  function colorMetric(n, lens, day) {
    if (n.kind === 'l' || lens === 'ret') return n.ret;
    const base = lens === 'd1' ? null : lens === 'm1' ? day - 30 : PT.dn(PT.iso(day).slice(0, 4) + '-01-01') - 1;
    if (n.kind === 'g') {
      // value-weighted move of the group
      let w = 0, s = 0;
      n.children.forEach(h => { const m = lens === 'd1' ? h.dayPct : h.move(base); if (isFinite(m)) { s += m * h.value; w += h.value; } });
      return w ? s / w : NaN;
    }
    return lens === 'd1' ? n.dayPct : n.move(base);
  }
  function tree(hs, group) {
    const g = GROUPS[group] && GROUPS[group][1];
    if (!g) return { key: 'root', kind: 'root', label: 'Portfolio', children: hs };
    const m = new Map();
    hs.forEach(h => { const k = String(g(h)); if (!m.has(k)) m.set(k, { key: 'g:' + k, kind: 'g', label: k, children: [] }); m.get(k).children.push(h); });
    m.forEach(gn => { gn.value = gn.children.reduce((s, h) => s + h.value, 0); gn.cost = gn.children.reduce((s, h) => s + h.cost, 0); gn.gain = gn.value - gn.cost; gn.ret = gn.cost > 0 ? gn.value / gn.cost - 1 : NaN; });
    return { key: 'root', kind: 'root', label: 'Portfolio', grouped: true, children: [...m.values()] };
  }
  const sizeOf = (n, lens) => n.kind === 'g' ? n.children.reduce((s, h) => s + Math.max(0, SIZES[lens].f(h) || 0), 0) : Math.max(0, SIZES[lens].f(n) || 0);

  /* ============================================================== layout */
  function grid(nodes, x, y, w, h, lens) {
    const tot = nodes.reduce((s, n) => s + sizeOf(n, lens), 0);
    if (!(tot > 0) || w < 2 || h < 2) return [];
    return App.squarify(nodes.map(n => ({ ref: n, area: sizeOf(n, lens) / tot * w * h })), x, y, w, h);
  }
  /** Rects for the focused level. Grouped portfolio: a header strip per group with its holdings inside. */
  function layoutLevel(focus, kids, X, Y, W, H, lens) {
    const out = [];
    const px = r => { const x0 = Math.round(r.x), y0 = Math.round(r.y); return { x: x0 + 1, y: y0 + 1, w: Math.max(0, Math.round(r.x + r.w) - x0 - 2), h: Math.max(0, Math.round(r.y + r.h) - y0 - 2) }; };
    if (focus.kind === 'root' && focus.grouped) {
      grid(kids, X, Y, W, H, lens).forEach(G => {
        const gh = G.h > 60 && G.w > 80 ? 22 : 0;
        if (gh) out.push(Object.assign({ key: 'gh:' + G.ref.key, kind: 'gh', node: G.ref }, px({ x: G.x, y: G.y, w: G.w, h: gh })));
        grid(G.ref.children, G.x, G.y + gh, G.w, G.h - gh, lens).forEach(t => out.push(Object.assign({ key: t.ref.key, kind: 'tile', node: t.ref }, px(t))));
      });
    } else {
      grid(kids, X, Y, W, H, lens).forEach(t => out.push(Object.assign({ key: t.ref.key, kind: 'tile', node: t.ref }, px(t))));
    }
    return out;
  }

  /* ================================================================ view */
  /**
   * A map bound to an element.
   * opts: { immersive, crumbs: element for the breadcrumb, onFocus(node), onSelect(node), lensColor, lensSize, group }
   */
  function MapView(el, opts) {
    this.el = el; this.opts = opts || {};
    this.path = []; this.day = null; this.els = new Map(); this.selected = null; this.rects = [];
    el.classList.add('pm');
    el.setAttribute('role', 'application');
    el.setAttribute('aria-roledescription', 'portfolio map');
    if (!this.opts.crumbs) { this.crumbsEl = document.createElement('div'); this.crumbsEl.className = 'pm-crumbs floating'; el.appendChild(this.crumbsEl); }
    else this.crumbsEl = this.opts.crumbs;
    this.bind();
    if (window.ResizeObserver) {
      let lw = el.clientWidth, lh = el.clientHeight;
      this.ro = new ResizeObserver(() => { if (el.clientWidth !== lw || el.clientHeight !== lh) { lw = el.clientWidth; lh = el.clientHeight; this.render({ instant: true }); } });
      this.ro.observe(el);
      if (!this.opts.immersive) App.observers.push(this.ro);
    }
  }
  MapView.prototype.lens = function () { const u = ui(); return { color: this.opts.color || u.color, size: this.opts.size || u.size, group: this.opts.group != null ? this.opts.group : u.group }; };
  MapView.prototype.dayNum = function () { return this.day != null ? this.day : App.res.asOf; };
  MapView.prototype.data = function () {
    const L = this.lens();
    const hs = this.day != null ? holdingsOn(this.day) : holdingsNow();
    this.total = hs.reduce((s, h) => s + h.value, 0);
    hs.forEach(h => { h.weight = this.total ? h.value / this.total : 0; });
    this.root = tree(hs, L.group);
    return this.root;
  };
  /** Walk the zoom path; drops levels that no longer exist (e.g. a holding not yet bought on the chosen day). */
  MapView.prototype.resolve = function () {
    const chain = [this.root];
    let node = this.root;
    for (let i = 0; i < this.path.length; i++) {
      const k = this.path[i];
      let next = null;
      if (node.kind === 'h') break;
      next = (node.children || []).find(c => c.key === k);
      if (!next && node.kind === 'root' && node.grouped && k.startsWith('h:')) {
        // a holding addressed without its group (grouping changed): find it in any group
        for (const g of node.children) { const h = g.children.find(c => c.key === k); if (h) { chain.push(g); next = h; break; } }
      }
      if (!next) { this.path = this.path.slice(0, i); break; }
      chain.push(next); node = next;
    }
    this.path = chain.slice(1).map(n => n.key);
    return chain;
  };
  MapView.prototype.kidsOf = function (node) {
    if (node.kind === 'h') { if (!node._lots) node._lots = lotsOf(node, this.day); return node._lots; }
    return node.children || [];
  };
  MapView.prototype.layout = function (focus, X, Y, W, H) {
    const L = this.lens();
    return layoutLevel(focus, this.kidsOf(focus), X, Y, W, H, focus.kind === 'h' && L.size === 'gain' ? 'gain' : L.size);
  };

  MapView.prototype.render = function (o) {
    o = o || {};
    if (!App.res || App.res.empty) { this.el.innerHTML = '<div class="chart-fallback">Nothing to map yet.</div>'; return; }
    const W = this.el.clientWidth, H = this.el.clientHeight;
    if (!W || !H) return;
    this.data();
    const chain = this.resolve();
    const focus = chain[chain.length - 1];
    this.focus = focus;
    const band = !this.opts.immersive && this.path.length ? 38 : 0;
    this.band = band;
    const items = this.layout(focus, 0, band, W, H - band);
    const L = this.lens(), day = this.dayNum();
    const instant = o.instant || reduced();
    const dur = instant ? 0 : o.fast ? 150 : 560;
    this.el.style.setProperty('--pm-dur', dur + 'ms');
    const next = new Map();
    const origin = o.origin || null, exitTo = o.exitTo || null;
    items.forEach(it => {
      let el = this.els.get(it.key);
      const fresh = !el;
      if (fresh) {
        el = document.createElement('button');
        el.className = it.kind === 'gh' ? 'pm-gh' : 'pm-t';
        el.type = 'button';
        el.dataset.key = it.key;
        el.classList.add('no-tr');
        const from = origin && origin(it);
        place(el, from || it);
        el.style.opacity = from ? '1' : '0';
        if (!from && !instant) el.style.transform += ' scale(.94)';
        this.el.appendChild(el);
      }
      this.paint(el, it, L, day, fresh);
      next.set(it.key, el);
    });
    // leaving tiles fade out (and shrink into their parent when zooming out)
    this.els.forEach((el, key) => {
      if (next.has(key)) return;
      const to = exitTo && exitTo(key);
      el.classList.remove('no-tr');
      el.classList.add('leaving');
      el.removeAttribute('data-key');
      el.tabIndex = -1;
      if (to) place(el, to);
      el.style.opacity = '0';
      if (!dur) el.remove(); else setTimeout(() => el.remove(), dur + 60);
    });
    this.els = next;
    this.rects = items;
    const settle = () => items.forEach(it => { const el = next.get(it.key); if (!el) return; el.classList.remove('no-tr'); place(el, it); el.style.opacity = '1'; });
    if (instant) settle(); else requestAnimationFrame(() => requestAnimationFrame(settle));
    this.renderCrumbs(chain);
    this.markSelected();
    if (this.opts.onRender) this.opts.onRender(this);
  };
  function place(el, r) {
    el.style.transform = `translate(${r.x}px,${r.y}px)`;
    el.style.width = r.w + 'px'; el.style.height = r.h + 'px';
  }

  /* -------------------------------------------------------------- paint */
  MapView.prototype.paint = function (el, it, L, day, fresh) {
    const n = it.node, T = App.theme();
    if (it.kind === 'gh') {
      const share = F.pct(this.total ? n.value / this.total : NaN, { sign: false, dec: 1 });
      // a narrow group keeps its name; the share moves to the tooltip
      el.innerHTML = it.w >= 170 ? `<b>${esc(n.label)}</b><span>${share} · ${F.eur(n.value, { dec: 0, compact: true })}</span>` : it.w >= 90 ? `<b>${esc(n.label)}</b><span>${share}</span>` : `<b>${esc(n.label)}</b>`;
      el.setAttribute('aria-label', `${n.label}, ${share}`);
      el.title = `${n.label} · ${share} · ${F.eur(n.value, { dec: 0 })} — zoom in`;
      return;
    }
    const lensC = n.kind === 'l' ? 'ret' : L.color;
    const m = colorMetric(n, lensC, day);
    const col = App.divColor(m, COLORS[lensC].cap, T);
    el.style.backgroundColor = col.bg;
    el.style.color = col.ink;
    el.classList.toggle('lot', n.kind === 'l');
    el.classList.toggle('grp', n.kind === 'g');
    const w = it.w, h = it.h, area = Math.sqrt(w * h);
    const big = w > 104 && h > 72, mid = w > 50 && h > 32;
    const fsM = Math.max(14, Math.min(44, area / 5.6)), fsT = Math.max(10, Math.min(16, area / 10.5));
    const mt = isFinite(m) ? F.pct(m, { dec: Math.abs(m) >= 10 ? 0 : 1 }) : '—';
    let title = n.label, sub = '';
    if (n.kind === 'h') sub = `${F.pct(n.weight, { sign: false, dec: 1 })} · ${F.eur(n.value, { dec: 0, compact: true })}`;
    else if (n.kind === 'g') sub = `${n.children.length} holding${n.children.length === 1 ? '' : 's'} · ${F.eur(n.value, { dec: 0, compact: true })}`;
    else if (n.kind === 'l') { title = n.label; sub = `${F.qty(n.qty)} @ ${F.price(n.buy, n.bcur)}`; }
    let html = '';
    if (mid) html += `<div class="pm-tt" style="font-size:${fsT}px">${esc(title)}${n.kind === 'l' && n.inKind ? ' <i>in</i>' : ''}</div>`;
    if (big) html += `<div class="pm-ft"><div class="pm-m" style="font-size:${fsM}px">${esc(mt)}</div><div class="pm-s">${esc(sub)}</div></div>`;
    else if (mid && h > 46) html += `<div class="pm-s">${esc(mt)}</div>`;
    if (n.kind === 'h' && w >= 150 && h >= 104 && !this.fastPaint) html += spark(n, lensC, day);
    el.innerHTML = html;
    el.setAttribute('aria-label', `${n.kind === 'l' ? 'Lot bought ' : ''}${title}, ${F.eur(n.value, { dec: 0 })}, ${COLORS[lensC].label} ${mt}`);
    el._node = n;
  };
  /** The holding's price path behind the numbers: since bought, or over the colour lens' period. */
  function spark(h, lens, day) {
    const ps = App.res.priceSeries[h.id];
    if (!ps || ps.n < 3) return '';
    const from = lens === 'ret' ? Math.max(h.since - 7, day - 730) : lens === 'ytd' ? PT.dn(PT.iso(day).slice(0, 4) + '-01-01') - 1 : day - 62;
    const xs = [], ys = [];
    for (let i = 0; i < ps.n; i++) if (ps.xs[i] >= from && ps.xs[i] <= day) { xs.push(ps.xs[i]); ys.push(ps.ys[i]); }
    if (xs.length < 3) return '';
    const step = Math.max(1, Math.ceil(xs.length / 90));
    const pts = [];
    for (let i = 0; i < xs.length; i += step) pts.push([xs[i], ys[i]]);
    if (pts[pts.length - 1][0] !== xs[xs.length - 1]) pts.push([xs[xs.length - 1], ys[ys.length - 1]]);
    const x0 = pts[0][0], x1 = pts[pts.length - 1][0] || x0 + 1;
    let lo = Infinity, hi = -Infinity;
    pts.forEach(p => { lo = Math.min(lo, p[1]); hi = Math.max(hi, p[1]); });
    const span = hi - lo || 1;
    const P = pts.map(p => [((p[0] - x0) / (x1 - x0 || 1)) * 100, 96 - ((p[1] - lo) / span) * 88]);
    const line = P.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(2) + ' ' + p[1].toFixed(2)).join('');
    return `<svg class="pm-spark" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><path class="a" d="${line}L100 100L0 100Z"/><path class="l" d="${line}" vector-effect="non-scaling-stroke"/></svg>`;
  }

  /* ------------------------------------------------------- interaction */
  MapView.prototype.bind = function () {
    const el = this.el;
    el.addEventListener('click', e => {
      const t = e.target.closest('.pm-t, .pm-gh');
      if (!t || !t.dataset.key || !el.contains(t)) return;
      this.activate(t.dataset.key);
    });
    el.addEventListener('keydown', e => {
      const t = document.activeElement && document.activeElement.closest ? document.activeElement.closest('.pm-t') : null;
      if (/^Arrow/.test(e.key) && t) { e.preventDefault(); this.moveFocus(t, e.key); }
      else if ((e.key === 'Escape' || e.key === 'Backspace') && this.path.length) { e.preventDefault(); e.stopPropagation(); this.zoomOut(); }
    });
    const tip = document.getElementById('tip');
    let cur = null;
    el.addEventListener('pointermove', e => {
      const t = e.target.closest('.pm-t');
      if (!t || !t._node || e.pointerType === 'touch') { if (cur) { tip.classList.remove('on'); cur = null; } return; }
      if (t !== cur) { cur = t; tip.innerHTML = this.tipHTML(t._node); tip.classList.add('on'); }
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      let x = e.clientX + 16, y = e.clientY + 18;
      if (x + tw > window.innerWidth - 8) x = e.clientX - tw - 16;
      if (y + th > window.innerHeight - 8) y = e.clientY - th - 14;
      tip.style.left = Math.max(8, x) + 'px'; tip.style.top = Math.max(8, y) + 'px';
    });
    el.addEventListener('pointerleave', () => { tip.classList.remove('on'); cur = null; });
    el.addEventListener('focusin', e => { const t = e.target.closest('.pm-t'); if (t && t._node && this.opts.onFocus) this.opts.onFocus(t._node); });
  };
  MapView.prototype.tipHTML = function (n) {
    const L = this.lens(), day = this.dayNum();
    const rows = [];
    if (n.kind === 'l') {
      rows.push(`Bought ${F.date(PT.iso(n.date))} · ${F.qty(n.qty)} @ ${F.price(n.buy, n.bcur)}`);
      rows.push(`Cost ${F.eur(n.cost, { dec: 0 })} · gain ${F.eur(n.gain, { sign: true, dec: 0 })} (${F.pct(n.ret, { dec: 1 })})`);
      rows.push(`Held ${F.dur(day - n.date)}`);
      return `<div class="tt-h">${esc(n.parent.label)} · lot</div><div class="tt-big">${F.eur(n.value)}</div>${rows.join('<br>')}`;
    }
    if (n.kind === 'g') {
      rows.push(`${F.pct(this.total ? n.value / this.total : NaN, { sign: false, dec: 1 })} of the portfolio · ${n.children.length} holdings`);
      rows.push(`Unrealised ${F.eur(n.gain, { sign: true, dec: 0 })} (${F.pct(n.ret, { dec: 1 })})`);
      return `<div class="tt-h">${esc(n.label)}</div><div class="tt-big">${F.eur(n.value)}</div>${rows.join('<br>')}<div class="tt-k">Click to zoom in</div>`;
    }
    const m = colorMetric(n, L.color, day);
    rows.push(`${F.pct(n.weight, { sign: false, dec: 1 })} of the portfolio · ${F.qty(n.qty)} × ${F.price(n.price, n.cur)}`);
    rows.push(`Cost ${F.eur(n.cost, { dec: 0 })} · unrealised ${F.eur(n.gain, { sign: true, dec: 0 })} (${F.pct(n.ret, { dec: 1 })})`);
    if (L.color !== 'ret') rows.push(`${COLORS[L.color].label}: ${isFinite(m) ? F.pct(m, { dec: 1 }) : '—'}`);
    rows.push(`Held since ${F.date(PT.iso(n.since))}${n.broker ? ' · ' + esc(n.broker) : ''}`);
    return `<div class="tt-h">${esc(n.label)} · ${esc(n.name)}</div><div class="tt-big">${F.eur(n.value)}</div>${rows.join('<br>')}<div class="tt-k">Click to see its lots</div>`;
  };
  MapView.prototype.activate = function (key) {
    const it = this.rects.find(r => r.key === key);
    if (!it) return;
    const n = it.node;
    if (n.kind === 'l') { this.selected = this.selected === key ? null : key; this.markSelected(); if (this.opts.onSelect) this.opts.onSelect(n); return; }
    this.zoomIn(n, it);
  };
  MapView.prototype.zoomIn = function (n, it) {
    const W = this.el.clientWidth, H = this.el.clientHeight;
    const from = it || this.rects.find(r => r.node === n) || { x: 0, y: 0, w: W, h: H };
    const band = !this.opts.immersive ? 38 : 0;
    const inner = this.layout(n, from.x, from.y, from.w, from.h);
    const byKey = new Map(inner.map(r => [r.key, r]));
    this.path = this.path.concat(n.key);
    this.selected = null;
    document.getElementById('tip').classList.remove('on');
    this.render({ origin: r => byKey.get(r.key) || null, exitTo: k => k === n.key ? { x: 0, y: band, w: W, h: H - band } : null });
    if (this.opts.onZoom) this.opts.onZoom(this.focus);
    this.focusFirst();
  };
  MapView.prototype.zoomOut = function (depth) {
    if (!this.path.length) return;
    const left = this.focus;
    const W = this.el.clientWidth, H = this.el.clientHeight;
    this.path = this.path.slice(0, depth != null ? depth : this.path.length - 1);
    this.selected = null;
    // the children we leave shrink back into their parent's tile
    this.data();
    const chain = this.resolve();
    const parent = chain[chain.length - 1];
    const band = !this.opts.immersive && this.path.length ? 38 : 0;
    const outer = this.layout(parent, 0, band, W, H - band);
    const target = outer.find(r => r.key === left.key);
    const back = target ? new Map(this.layout(left, target.x, target.y, target.w, target.h).map(r => [r.key, r])) : new Map();
    this.render({ origin: r => r.key === left.key ? { x: 0, y: this.band || 0, w: W, h: H - (this.band || 0) } : null, exitTo: k => back.get(k) || null });
    if (this.opts.onZoom) this.opts.onZoom(this.focus);
    const t = this.els.get(left.key);
    if (t) setTimeout(() => t.focus({ preventScroll: true }), 30);
  };
  MapView.prototype.focusFirst = function () { setTimeout(() => { const f = this.el.querySelector('.pm-t:not(.leaving)'); if (f && this.el.contains(document.activeElement)) f.focus({ preventScroll: true }); }, 40); };
  MapView.prototype.moveFocus = function (from, key) {
    const a = this.rects.find(r => r.key === from.dataset.key);
    if (!a) return;
    const cx = a.x + a.w / 2, cy = a.y + a.h / 2;
    const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[key];
    let best = null, bd = Infinity;
    this.rects.forEach(r => {
      if (r === a || r.kind !== 'tile') return;
      const dx = r.x + r.w / 2 - cx, dy = r.y + r.h / 2 - cy;
      const along = dx * dir[0] + dy * dir[1];
      if (along <= 4) return;
      const across = Math.abs(dx * dir[1]) + Math.abs(dy * dir[0]);
      const d = along + across * 2;
      if (d < bd) { bd = d; best = r; }
    });
    if (best) this.els.get(best.key).focus({ preventScroll: true });
  };
  MapView.prototype.markSelected = function () { this.els.forEach((el, k) => el.classList.toggle('sel', k === this.selected)); };
  MapView.prototype.highlight = function (key) { this.els.forEach((el, k) => el.classList.toggle('hl', k === key)); };
  MapView.prototype.renderCrumbs = function (chain) {
    const c = this.crumbsEl;
    if (!c) return;
    if (chain.length < 2 && !this.opts.immersive) { c.innerHTML = ''; c.classList.remove('on'); return; }
    const parts = chain.map((n, i) => i === chain.length - 1 ? `<span class="cur">${esc(n.label)}</span>` : `<button type="button" data-depth="${i}">${esc(n.label)}</button>`);
    const last = chain[chain.length - 1];
    const extra = last.kind === 'h' ? `<a class="pm-open" href="#/position/${last.id}">Details →</a>` : '';
    c.innerHTML = parts.join('<i>›</i>') + extra;
    c.classList.add('on');
    c.querySelectorAll('[data-depth]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); this.zoomOut(+b.dataset.depth); }));
    const open = c.querySelector('.pm-open');
    if (open) open.addEventListener('click', () => { if (App.mapOverlay) App.mapOverlay.close(); });
  };
  MapView.prototype.destroy = function () { if (this.ro) this.ro.disconnect(); this.els.clear(); };

  /* ======================================================= compact card */
  App.mapLensSeg = function (cur) {
    return `<div class="seg pm-lens" role="group" aria-label="Colour">${Object.entries(COLORS).map(([k, c]) => `<button class="${k === cur ? 'on' : ''}" data-pmc="${k}">${c.label}</button>`).join('')}</div>`;
  };
  App.mapLegendFor = lens => App.mapLegend(COLORS[lens].cap, COLORS[lens].legend);
  /** A map in a page card. opts: { group } (fixed grouping, e.g. on the allocation page) */
  App.pmap = function (el, opts) {
    opts = opts || {};
    const v = new MapView(el, { group: opts.group, crumbs: opts.crumbs, color: null, size: opts.size || 'value' });
    v.render({ instant: true });
    const card = el.closest('.card') || document;
    card.querySelectorAll('[data-pmc]').forEach(b => b.addEventListener('click', () => { ui().color = b.dataset.pmc; App.render(); }));
    card.querySelectorAll('[data-pm-open]').forEach(b => b.addEventListener('click', () => App.openMap()));
    return v;
  };

  /* ===================================================== immersive mode */
  function buildEvents() {
    const s = App.state, by = new Map();
    const inst = id => s.instruments.find(i => i.id === id);
    const add = (d, kind, text) => { const k = PT.dn(d); if (!by.has(k)) by.set(k, []); by.get(k).push({ kind, text }); };
    const trades = {};
    s.transactions.forEach(t => {
      if (t.type !== 'buy' && t.type !== 'sell') return;
      const k = t.date + '|' + t.instId + '|' + t.type;
      (trades[k] = trades[k] || { d: t.date, id: t.instId, type: t.type, q: 0 }).q += +t.qty || 0;
    });
    Object.values(trades).forEach(t => { const i = inst(t.id); if (i) add(t.d, t.type, `${t.type === 'buy' ? 'Bought' : 'Sold'} ${F.qty(t.q)} ${App.instLabel(i)}`); });
    const moves = {};
    s.transactions.filter(t => t.type === 'transfer_in').forEach(t => { const k = t.date + '|' + (t.broker || ''); (moves[k] = moves[k] || { d: t.date, b: t.broker, n: [] }).n.push(App.instLabel(inst(t.instId))); });
    Object.values(moves).forEach(m => add(m.d, 'move', `Moved ${m.n.length > 3 ? m.n.length + ' holdings' : m.n.join(', ')} to ${m.b || 'another broker'}`));
    s.cash.forEach(c => { if ((c.type === 'deposit' || c.type === 'withdrawal') && Math.abs(c.amount) >= 50) add(c.date, c.type, `${c.type === 'deposit' ? 'Deposited' : 'Withdrew'} ${F.price(Math.abs(c.amount), c.currency || 'EUR')}`); });
    return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([d, items]) => ({ d, items }));
  }

  App.openMap = function (opts) {
    if (App.mapOverlay) return App.mapOverlay;
    const r = App.res;
    if (!r || r.empty) return null;
    const prevFocus = document.activeElement;
    const box = document.createElement('div');
    box.className = 'pmx';
    box.setAttribute('role', 'dialog');
    box.setAttribute('aria-modal', 'true');
    box.setAttribute('aria-label', 'Portfolio map');
    const u = ui();
    box.innerHTML = `
      <div class="pmx-top">
        <button class="pmx-x" type="button" aria-label="Close map" title="Close (Esc)">${icon('close')}</button>
        <div class="pmx-title">Portfolio map</div>
        <nav class="pm-crumbs pmx-crumbs" aria-label="Zoom level"></nav>
        <div class="pmx-lenses">
          <label class="pmx-l"><span>Group</span><select data-pmx="group">${Object.entries(GROUPS).map(([k, g]) => `<option value="${k}" ${k === u.group ? 'selected' : ''}>${g[0]}</option>`).join('')}</select></label>
          <div class="pmx-l"><span>Size</span><div class="seg">${Object.entries(SIZES).map(([k, s]) => `<button class="${k === u.size ? 'on' : ''}" data-pmx-size="${k}">${s.label}</button>`).join('')}</div></div>
          <div class="pmx-l"><span>Colour</span><div class="seg">${Object.entries(COLORS).map(([k, c]) => `<button class="${k === u.color ? 'on' : ''}" data-pmx-color="${k}">${c.label}</button>`).join('')}</div></div>
          <div class="pmx-legend"></div>
        </div>
      </div>
      <div class="pmx-main">
        <div class="pmx-canvas"></div>
        <aside class="pmx-dossier" aria-live="polite"></aside>
      </div>
      <div class="pmx-time">
        <button class="pmx-play" type="button" aria-label="Replay your portfolio">${playIcon(false)}</button>
        <div class="pmx-track" tabindex="0" role="slider" aria-label="Date"><svg class="pmx-curve" preserveAspectRatio="none"></svg><div class="pmx-ticks"></div><div class="pmx-head"><i></i><span></span></div></div>
        <button class="pmx-now on" type="button">Now</button>
        <div class="pmx-caption" aria-live="polite"></div>
      </div>`;
    document.body.appendChild(box);
    document.body.classList.add('pmx-open');
    const $ = s => box.querySelector(s);
    const canvas = $('.pmx-canvas'), dossier = $('.pmx-dossier'), track = $('.pmx-track'), head = $('.pmx-head'), caption = $('.pmx-caption');
    const events = buildEvents();
    let playing = false, raf = 0;

    const view = new MapView(canvas, {
      immersive: true, crumbs: $('.pmx-crumbs'),
      onZoom: f => { if (f.kind === 'h') showDossier(f); else hideDossier(); },
      onSelect: n => { if (n.kind === 'l') showDossier(n.parent, n); },
      onRender: () => { refreshLegend(); if (view.focus && view.focus.kind === 'h') showDossier(view.focus, null, true); }
    });
    if (opts && opts.path) view.path = opts.path.slice();

    /* ------ lenses */
    function refreshLegend() { const L = view.lens(); $('.pmx-legend').innerHTML = App.mapLegend(COLORS[L.color].cap, `${COLORS[L.color].legend} · ${SIZES[L.size].legend}`); }
    $('[data-pmx="group"]').addEventListener('change', e => { ui().group = e.target.value; view.render(); });
    box.querySelectorAll('[data-pmx-size]').forEach(b => b.addEventListener('click', () => { ui().size = b.dataset.pmxSize; box.querySelectorAll('[data-pmx-size]').forEach(x => x.classList.toggle('on', x === b)); view.render(); }));
    box.querySelectorAll('[data-pmx-color]').forEach(b => b.addEventListener('click', () => { ui().color = b.dataset.pmxColor; box.querySelectorAll('[data-pmx-color]').forEach(x => x.classList.toggle('on', x === b)); view.render(); }));

    /* ------ dossier */
    function hideDossier() { dossier.classList.remove('on'); dossier.innerHTML = ''; }
    function showDossier(h, lot, quiet) {
      const day = view.dayNum();
      const lots = view.kidsOf(h);
      const m1 = colorMetric(h, 'm1', day), ytd = colorMetric(h, 'ytd', day), d1 = colorMetric(h, 'd1', day);
      const fact = (k, v) => `<div><dt>${k}</dt><dd>${v}</dd></div>`;
      dossier.innerHTML = `
        <button class="pmx-dx" type="button" aria-label="Close details">${icon('close')}</button>
        <div class="pmx-d-h"><span class="tk">${esc(h.label)}</span>${h.broker ? `<span class="badge-broker">${esc(h.broker)}</span>` : ''}</div>
        <div class="nm">${esc(h.name)}</div>
        <div class="pmx-d-big">${F.eur(h.value, { dec: 0 })}</div>
        <div class="small text-2">${F.pct(h.weight, { sign: false, dec: 1 })} of the portfolio · ${F.qty(h.qty)} × ${F.price(h.price, h.cur)}${view.day != null ? ' · on ' + F.date(PT.iso(day)) : ''}</div>
        ${priceChart(h, day, lots, lot)}
        <dl class="pmx-d-facts">
          ${fact('Cost', F.eur(h.cost, { dec: 0 }))}
          ${fact('Unrealised', `${F.seur(h.gain, { dec: 0 })} <span class="${F.cls(h.ret)}">${F.pct(h.ret, { dec: 1 })}</span>`)}
          ${fact('Held since', `${F.date(PT.iso(h.since))} <span class="muted">${F.dur(day - h.since)}</span>`)}
          ${h.realized != null ? fact('Realised so far', F.seur(h.realized, { dec: 0 })) : ''}
          ${fact('1 day', F.spct(d1))}${fact('1 month', F.spct(m1))}${fact('This year', F.spct(ytd))}
        </dl>
        <div class="pmx-d-lots"><div class="label">${lots.length} purchase lot${lots.length === 1 ? '' : 's'} · ${lots.length > 1 ? 'sold first-in, first-out unless marked' : 'one lot'}</div>
          <table class="t compact"><tbody>${lots.map(l => `<tr data-lot="${esc(l.key)}" class="${lot && lot.key === l.key ? 'on' : ''}"><td>${F.date(PT.iso(l.date))}</td><td class="r num">${F.qty(l.qty)} @ ${F.price(l.buy, l.bcur)}</td><td class="r">${F.spct(l.ret, { dec: 0 })}</td></tr>`).join('')}</tbody></table></div>
        <a class="btn sm" href="#/position/${h.id}" data-pmx-close>Open full detail</a>`;
      dossier.classList.add('on');
      dossier.querySelector('.pmx-dx').addEventListener('click', () => { hideDossier(); });
      dossier.querySelectorAll('[data-lot]').forEach(tr => {
        tr.addEventListener('mouseenter', () => view.highlight(tr.dataset.lot));
        tr.addEventListener('mouseleave', () => view.highlight(null));
        tr.addEventListener('click', () => { view.selected = tr.dataset.lot; view.markSelected(); showDossier(h, lots.find(l => l.key === tr.dataset.lot)); });
      });
      const c = dossier.querySelector('[data-pmx-close]'); if (c) c.addEventListener('click', () => close());
      if (!quiet) dossier.scrollTop = 0;
    }
    function priceChart(h, day, lots, lot) {
      const ps = App.res.priceSeries[h.id];
      if (!ps || ps.n < 2) return '';
      const from = Math.max(h.since - 21, day - 1100);
      const pts = [];
      for (let i = 0; i < ps.n; i++) if (ps.xs[i] >= from && ps.xs[i] <= day) pts.push([ps.xs[i], ps.ys[i]]);
      if (pts.length < 2) return '';
      const trades = App.state.transactions.filter(t => t.instId === h.id && (t.type === 'buy' || t.type === 'sell') && t.currency === h.cur && PT.dn(t.date) >= from && PT.dn(t.date) <= day && t.price > 0);
      const own = lots.filter(l => l.bcur === h.cur);
      const avg = own.length ? own.reduce((s, l) => s + l.qty * l.buy, 0) / own.reduce((s, l) => s + l.qty, 0) : NaN;
      let lo = Infinity, hi = -Infinity;
      pts.forEach(p => { lo = Math.min(lo, p[1]); hi = Math.max(hi, p[1]); });
      trades.forEach(t => { lo = Math.min(lo, t.price); hi = Math.max(hi, t.price); });
      if (isFinite(avg)) { lo = Math.min(lo, avg); hi = Math.max(hi, avg); }
      const W = 320, H = 132, pad = 6, span = (hi - lo) || 1;
      const x = d => pad + (d - pts[0][0]) / ((day - pts[0][0]) || 1) * (W - 2 * pad);
      const y = v => pad + (1 - (v - lo) / span) * (H - 2 * pad);
      const line = pts.map((p, i) => (i ? 'L' : 'M') + x(p[0]).toFixed(1) + ' ' + y(p[1]).toFixed(1)).join('');
      const marks = trades.map(t => `<circle class="${t.type}" cx="${x(PT.dn(t.date)).toFixed(1)}" cy="${y(t.price).toFixed(1)}" r="4"><title>${t.type === 'buy' ? 'Bought' : 'Sold'} ${F.qty(t.qty)} @ ${F.price(t.price, t.currency)} · ${F.date(t.date)}</title></circle>`).join('');
      const sel = lot && lot.bcur === h.cur ? `<circle class="lotsel" cx="${x(lot.date).toFixed(1)}" cy="${y(lot.buy).toFixed(1)}" r="7"/>` : '';
      return `<figure class="pmx-d-chart"><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Price of ${esc(h.label)} since ${F.date(PT.iso(pts[0][0]))}, with your trades">
        ${isFinite(avg) ? `<line class="avg" x1="${pad}" x2="${W - pad}" y1="${y(avg).toFixed(1)}" y2="${y(avg).toFixed(1)}"/>` : ''}
        <path class="area" d="${line}L${x(pts[pts.length - 1][0]).toFixed(1)} ${H - pad}L${x(pts[0][0]).toFixed(1)} ${H - pad}Z"/><path class="line" d="${line}"/>${marks}${sel}</svg>
        <figcaption><span>${F.date(PT.iso(pts[0][0]), 'month')}</span><span>${isFinite(avg) ? `<i class="dash"></i>avg cost ${F.price(avg, h.cur)} · ` : ''}<i class="dot"></i>buy <i class="ring"></i>sell</span><span>${F.price(pts[pts.length - 1][1], h.cur)}</span></figcaption></figure>`;
    }

    /* ------ time machine */
    const N = r.N, d0 = r.start, d1 = r.asOf;
    function drawCurve() {
      const svg = $('.pmx-curve');
      const W = track.clientWidth, H = track.clientHeight;
      if (!W || !H) return;
      svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
      const cols = Math.max(2, Math.min(N, Math.floor(W)));
      let mx = 0;
      for (let k = 0; k < N; k++) mx = Math.max(mx, r.V[k], r.NETINV[k]);
      mx = mx * 1.08 || 1;
      const pv = [], pi = [];
      for (let c = 0; c < cols; c++) {
        const k = Math.min(N - 1, Math.round(c / (cols - 1) * (N - 1)));
        const X = (c / (cols - 1) * W).toFixed(1);
        pv.push(X + ' ' + (H - 2 - Math.max(0, r.V[k]) / mx * (H - 8)).toFixed(1));
        pi.push(X + ' ' + (H - 2 - Math.max(0, r.NETINV[k]) / mx * (H - 8)).toFixed(1));
      }
      svg.innerHTML = `<path class="area" d="M0 ${H}L${pv.join('L')}L${W} ${H}Z"/><path class="inv" d="M${pi.join('L')}"/><path class="val" d="M${pv.join('L')}"/>`;
      // broker moves get a mark on the timeline
      $('.pmx-ticks').innerHTML = events.filter(e => e.items.some(i => i.kind === 'move')).map(e => `<i style="left:${((e.d - d0) / (d1 - d0) * 100).toFixed(2)}%" title="${esc(F.date(PT.iso(e.d)) + ' · ' + e.items.filter(i => i.kind === 'move').map(i => i.text).join(' · '))}"></i>`).join('');
      placeHead();
    }
    function placeHead() {
      const d = view.day != null ? view.day : d1;
      const k = Math.max(0, Math.min(N - 1, d - d0));
      head.style.left = ((d - d0) / ((d1 - d0) || 1) * 100) + '%';
      head.querySelector('span').textContent = `${F.date(PT.iso(d))} · ${F.eur(r.V[k], { dec: 0 })}`;
      track.setAttribute('aria-valuemin', 0); track.setAttribute('aria-valuemax', N - 1); track.setAttribute('aria-valuenow', k);
      track.setAttribute('aria-valuetext', `${F.date(PT.iso(d))}, portfolio value ${F.eur(r.V[k], { dec: 0 })}`);
      $('.pmx-now').classList.toggle('on', view.day == null);
      box.classList.toggle('past', view.day != null);
      // the caption tells what happened lately
      if (view.day == null) { caption.innerHTML = `<b>Today</b> · prices of ${F.date(PT.iso(r.lastPriceDay))}`; return; }
      let ev = null;
      for (let i = events.length - 1; i >= 0; i--) if (events[i].d <= d) { if (d - events[i].d <= 21) ev = events[i]; break; }
      caption.innerHTML = ev ? `<b>${F.date(PT.iso(ev.d))}</b> · ${ev.items.slice(0, 3).map(i => `<span class="ev ${i.kind}">${esc(i.text)}</span>`).join(' · ')}${ev.items.length > 3 ? ` · +${ev.items.length - 3} more` : ''}` : `<b>${F.date(PT.iso(d))}</b>`;
    }
    function setDay(d, fast) {
      d = Math.round(d);
      view.day = d >= d1 ? null : Math.max(d0, d);
      placeHead();
      view.fastPaint = !!fast;
      view.render({ fast: true });
    }
    const dayAtX = cx => { const b = track.getBoundingClientRect(); return d0 + Math.max(0, Math.min(1, (cx - b.left) / b.width)) * (d1 - d0); };
    let drag = false;
    track.addEventListener('pointerdown', e => { stop(); drag = true; track.setPointerCapture(e.pointerId); setDay(dayAtX(e.clientX), true); });
    track.addEventListener('pointermove', e => { if (drag) setDay(dayAtX(e.clientX), true); });
    const endDrag = () => { if (!drag) return; drag = false; view.fastPaint = false; view.render({ fast: true }); };
    track.addEventListener('pointerup', endDrag); track.addEventListener('pointercancel', endDrag);
    track.addEventListener('keydown', e => {
      const cur = view.day != null ? view.day : d1;
      const step = e.shiftKey ? 30 : 7;
      const go = { ArrowLeft: cur - step, ArrowRight: cur + step, Home: d0, End: d1, PageUp: cur - 91, PageDown: cur + 91 }[e.key];
      if (go != null) { e.preventDefault(); stop(); setDay(go); }
    });
    $('.pmx-now').addEventListener('click', () => { stop(); setDay(d1); });
    const playBtn = $('.pmx-play');
    function stop() { if (!playing) return; playing = false; cancelAnimationFrame(raf); playBtn.innerHTML = playIcon(false); playBtn.setAttribute('aria-label', 'Replay your portfolio'); view.fastPaint = false; view.render({ fast: true }); }
    function play() {
      if (view.day == null) view.day = d0;
      playing = true; playBtn.innerHTML = playIcon(true); playBtn.setAttribute('aria-label', 'Pause');
      let last = 0;
      const perTick = Math.max(1, Math.round((d1 - d0) / 240)); // the whole history in ~25 s
      const tick = t => {
        if (!playing) return;
        if (t - last > 100) {
          last = t;
          const nd = view.day + perTick;
          if (nd >= d1) { stop(); setDay(d1); return; }
          setDay(nd, true);
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }
    playBtn.addEventListener('click', () => playing ? stop() : play());

    /* ------ open / close */
    function onKey(e) {
      if (e.key === 'Escape') {
        if (view.path.length && box.contains(document.activeElement) && document.activeElement !== box) return; // the map zooms out first
        e.preventDefault(); close();
      } else if (e.key === ' ' && !/INPUT|SELECT|TEXTAREA|BUTTON|A/.test((document.activeElement || {}).tagName || '')) { e.preventDefault(); playing ? stop() : play(); }
    }
    box.addEventListener('keydown', e => { if (e.key === 'Escape' && view.path.length) { e.preventDefault(); e.stopPropagation(); view.zoomOut(); } }, true);
    document.addEventListener('keydown', onKey);
    $('.pmx-x').addEventListener('click', () => close());
    const ro = window.ResizeObserver ? new ResizeObserver(() => drawCurve()) : null;
    if (ro) ro.observe(track);
    function close() {
      stop();
      document.removeEventListener('keydown', onKey);
      if (ro) ro.disconnect();
      view.destroy();
      document.getElementById('tip').classList.remove('on');
      box.classList.add('closing');
      setTimeout(() => box.remove(), reduced() ? 0 : 220);
      document.body.classList.remove('pmx-open');
      App.mapOverlay = null;
      if (prevFocus && prevFocus.focus) prevFocus.focus({ preventScroll: true });
    }
    App.mapOverlay = { close, refresh: () => { atCache.clear(); drawCurve(); view.render({ fast: true }); }, view };
    requestAnimationFrame(() => {
      drawCurve();
      view.render({ instant: true });
      refreshLegend();
      if (view.focus && view.focus.kind === 'h') showDossier(view.focus);
      box.tabIndex = -1; box.focus({ preventScroll: true });
    });
    return App.mapOverlay;
  };
  function playIcon(on) { return on ? '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>' : '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>'; }
})();
