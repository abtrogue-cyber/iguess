/* =====================================================================
 * App shell: state, persistence, formatting, tooltips, modal, charts,
 * router. Views live in app-views.js / app-data.js.
 * ===================================================================== */
(function () {
  'use strict';
  const PT = window.PT;
  const LS_KEY = 'conviction.portfolio.v1';
  const App = window.App = {
    state: null, res: null, charts: [], mcache: {},
    ui: {
      route: 'dashboard', param: null,
      eqPeriod: '1Y', eqMode: 'perf', eqBench: ['b_msci', 'b_ndx', 'b_sox'],
      perfPeriod: 'ALL', posSort: { k: 'value', dir: -1 }, posQuery: '', posOptions: true,
      closedSort: { k: 'end', dir: -1 }, actTab: 'trades', actQuery: '', actType: '', dataTab: 'import',
      detailPeriod: 'ALL', counted: {}, allocDim: 'position'
    }
  };

  /* ------------------------------------------------------------ icons */
  const P = {
    dashboard: '<rect x="3" y="3" width="7.5" height="9" rx="2"/><rect x="13.5" y="3" width="7.5" height="5" rx="2"/><rect x="13.5" y="11" width="7.5" height="10" rx="2"/><rect x="3" y="15" width="7.5" height="6" rx="2"/>',
    positions: '<path d="M4 6h16M4 12h16M4 18h10"/>',
    allocation: '<path d="M12 3a9 9 0 1 0 9 9h-9z"/><path d="M15 3.5A9 9 0 0 1 20.5 9H15z"/>',
    performance: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    closed: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 10"/>',
    activity: '<path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3"/>',
    data: '<ellipse cx="12" cy="5.5" rx="8" ry="2.8"/><path d="M4 5.5v6c0 1.5 3.6 2.8 8 2.8s8-1.3 8-2.8v-6M4 11.5v6c0 1.5 3.6 2.8 8 2.8s8-1.3 8-2.8v-6"/>',
    checks: '<path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6z"/><path d="M8.8 12l2.2 2.2 4.4-4.4"/>',
    settings: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>', download: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.6-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5L20 16M20 20v-4h-4"/>', trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>', back: '<path d="M15 5l-7 7 7 7"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>', alert: '<path d="M12 3l9.5 17h-19z"/><path d="M12 10v4M12 17.5v.5"/>',
    spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>', file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    logo: '<path d="M4 17l5-6 4 3.5L20 6"/><circle cx="20" cy="6" r="1.6" fill="currentColor"/>'
  };
  App.icon = (n, sw) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw || 1.8}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] || ''}</svg>`;

  /* ------------------------------------------------------ persistence */
  function migrate(s) {
    const base = PT.emptyState();
    s = Object.assign(base, s || {});
    s.settings = Object.assign({}, PT.DEFAULT_SETTINGS, s.settings || {});
    if (!Array.isArray(s.benchmarks) || !s.benchmarks.length) s.benchmarks = PT.defaultBenchmarks();
    s.prices = s.prices || {}; s.fx = s.fx || {}; s.cash = s.cash || []; s.transactions = s.transactions || []; s.instruments = s.instruments || [];
    s.instruments.forEach(i => { i.tags = i.tags || []; i.aliases = i.aliases || []; });
    return s;
  }
  App.migrate = migrate;
  App.load = function () {
    try { const raw = localStorage.getItem(LS_KEY); if (raw) return migrate(JSON.parse(raw)); } catch (e) { console.warn(e); }
    return null;
  };
  let saveT = null;
  App.save = function () {
    clearTimeout(saveT);
    saveT = setTimeout(() => {
      try { localStorage.setItem(LS_KEY, JSON.stringify(App.state)); }
      catch (e) { App.toast('Could not save to browser storage (' + e.name + '). Export a JSON backup.', true); }
    }, 120);
  };
  App.recompute = function () {
    const t0 = performance.now();
    App.res = PT.compute(App.state);
    App.mcache = {};
    App.lastComputeMs = performance.now() - t0;
  };
  /** Mutate state, recompute, persist, re-render. */
  App.commit = function (fn, opts) {
    opts = opts || {};
    if (fn) fn(App.state);
    App.recompute();
    App.save();
    if (opts.render !== false) App.render();
  };
  App.metrics = function (key) {
    if (App.res.empty) return null;
    if (!App.mcache[key]) App.mcache[key] = PT.metrics(App.res, PT.periodBase(key, App.res.asOf, App.res.start, App.res.lastPriceDay), App.res.asOf);
    return App.mcache[key];
  };

  /* ------------------------------------------------------- formatting */
  const nfCache = {};
  const nf = (o) => { const loc = App.state.settings.locale === 'en' ? 'en-IE' : 'de-DE'; const k = loc + JSON.stringify(o); return nfCache[k] || (nfCache[k] = new Intl.NumberFormat(loc, o)); };
  const F = App.F = {
    loc: () => App.state.settings.locale === 'en' ? 'en-IE' : 'de-DE',
    eur(v, o) {
      o = o || {};
      if (v == null || !isFinite(v)) return '—';
      const d = o.dec != null ? o.dec : 2;
      if (o.compact && Math.abs(v) >= 10000) return nf({ style: 'currency', currency: 'EUR', notation: 'compact', maximumFractionDigits: 1, signDisplay: o.sign ? 'exceptZero' : 'auto' }).format(v);
      return nf({ style: 'currency', currency: 'EUR', minimumFractionDigits: d, maximumFractionDigits: d, signDisplay: o.sign ? 'exceptZero' : 'auto' }).format(Math.abs(v) < 0.005 && d >= 2 ? 0 : v);
    },
    pct(v, o) {
      o = o || {};
      if (v == null || !isFinite(v)) return '—';
      const d = o.dec != null ? o.dec : 2;
      return nf({ style: 'percent', minimumFractionDigits: d, maximumFractionDigits: d, signDisplay: o.sign === false ? 'auto' : 'exceptZero' }).format(v);
    },
    num(v, d, o) {
      if (v == null || !isFinite(v)) return '—';
      return nf(Object.assign({ minimumFractionDigits: d == null ? 0 : d, maximumFractionDigits: d == null ? 2 : d }, o || {})).format(v);
    },
    qty(v) { if (!isFinite(v)) return '—'; const a = Math.abs(v); return nf({ maximumFractionDigits: a % 1 === 0 ? 0 : 4 }).format(v); },
    price(v, cur) {
      if (v == null || !isFinite(v)) return '—';
      const zero = ['KRW', 'JPY'].includes(cur);
      const d = zero ? 0 : (Math.abs(v) < 10 ? (Math.abs(v) < 1 ? 4 : 3) : 2);
      try { return nf({ style: 'currency', currency: cur || 'EUR', minimumFractionDigits: zero ? 0 : 2, maximumFractionDigits: d }).format(v); }
      catch (e) { return F.num(v, 2) + ' ' + cur; }
    },
    fx(v) { return isFinite(v) ? nf({ minimumFractionDigits: v >= 100 ? 2 : 4, maximumFractionDigits: v >= 100 ? 2 : 4 }).format(v) : '—'; },
    date(s, style) {
      if (!s) return '—';
      const d = typeof s === 'number' ? new Date(s * PT.DAY) : new Date(s + 'T00:00:00Z');
      const opts = style === 'month' ? { month: 'short', year: '2-digit', timeZone: 'UTC' } : style === 'long' ? { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' } : style === 'med' ? { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' } : { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' };
      return new Intl.DateTimeFormat(F.loc(), opts).format(d);
    },
    dur(days) {
      if (!isFinite(days)) return '—';
      days = Math.round(days);
      if (days < 31) return days + 'd';
      const m = Math.round(days / 30.44);
      if (m < 12) return m + 'm';
      const y = Math.floor(m / 12), mm = m % 12;
      return y + 'y' + (mm ? ' ' + mm + 'm' : '');
    },
    cls: v => (!isFinite(v) || Math.abs(v) < 1e-9) ? '' : (v > 0 ? 'gain' : 'loss'),
    esc: s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    /** euro value with colored sign */
    seur: (v, o) => `<span class="num ${F.cls(v)}">${F.eur(v, Object.assign({ sign: true }, o || {}))}</span>`,
    spct: (v, o) => `<span class="num ${F.cls(v)}">${F.pct(v, o)}</span>`,
    parseIn(s) { return PT.parseNum(s, App.state.settings.locale === 'en' ? '.' : null); }
  };
  const esc = F.esc;

  /* ------------------------------------------------------ formula tips */
  App.TIPS = {
    value: '<b>Total value</b><br><code>Σ qty × price × multiplier ÷ FX + cash</code><br>FX is quoted as local currency per 1 EUR (e.g. USD 1.16). Prices are the latest stored price on or before the valuation date.',
    invested: '<b>Net invested capital</b><br><code>deposits − withdrawals</code><br>plus securities transferred in without a matching transfer-out (valued at market). In “securities only” basis: purchases − sale proceeds − income.',
    pnl: '<b>Absolute return</b><br><code>total value − net invested</code><br><b>Simple return</b> <code>absolute return ÷ net invested</code>',
    twr: '<b>Time-weighted return (TWR)</b><br>Daily returns, chained:<br><code>r_t = (V_t − V_t−1 − F_t) ÷ (V_t−1 + max(F_t, 0))</code><br><code>TWR = Π(1 + r_t) − 1</code><br>F = external cash flows (deposits/withdrawals). Neutralises the size and timing of your flows — it measures the investments.',
    xirr: '<b>Money-weighted return (XIRR)</b><br>The annual rate r that solves<br><code>Σ CF_i ÷ (1 + r)^((t_i − t_0)/365) = 0</code><br>with deposits negative, withdrawals and the end value positive. Includes the timing of your flows — it measures your experience as an investor.',
    twrvsmwr: '<b>TWR vs. XIRR</b> — TWR judges the investments, XIRR judges your timing: they differ when you add or withdraw money ahead of big moves.',
    ann: '<b>Annualised TWR</b><br><code>(1 + TWR)^(365 / days) − 1</code><br>Only shown as “p.a.” for periods ≥ 1 year.',
    day: '<b>1D</b> — change versus the previous trading day, net of cash flows. Uses the latest stored price per instrument on each day; if you did not store prices yesterday, it compares against the last earlier snapshot.',
    ytd: '<b>YTD</b> — TWR since 31 December of last year.',
    unreal: '<b>Unrealised P&L (FIFO)</b><br><code>market value − cost of open lots</code><br>Cost includes purchase fees. For shorts the sign is reversed (proceeds received − cost to buy back).',
    realized: '<b>Realised P&L (FIFO)</b><br><code>proceeds − sale fees − cost of the oldest lots sold</code><br>Cost includes those lots’ purchase fees. Broker transfers are not sales — the original lots and dates carry over.',
    pe: '<b>Price effect</b><br><code>Σ qty × (P_now − P_buy) ÷ FX_buy</code><br>The move in the security’s own currency, translated at the purchase FX rate.',
    fe: '<b>Currency effect</b><br><code>Σ qty × P_now × (1/FX_now − 1/FX_buy)</code><br>What EUR/foreign-currency moves added or cost. Price effect + currency effect = total P&L before fees.',
    vol: '<b>Volatility (annualised)</b><br><code>stdev(daily TWR returns) × √252</code><br>Weekdays only.',
    mdd: '<b>Maximum drawdown</b><br><code>min_t (Index_t ÷ max_s≤t Index_s − 1)</code><br>Measured on the TWR index, so deposits do not hide losses.',
    sharpe: '<b>Sharpe ratio</b><br><code>(annualised TWR − r_f) ÷ volatility</code><br>r_f = risk-free rate (Settings, default €STR).',
    sortino: '<b>Sortino ratio</b><br><code>(annualised TWR − r_f) ÷ downside deviation</code><br><code>DD = √mean(min(0, r_t − r_f,daily)²) × √252</code>',
    beta: '<b>Beta & correlation</b> vs. the selected benchmark, from weekly returns:<br><code>β = cov(r_p, r_b) ÷ var(r_b)</code>',
    weight: '<b>Weight</b><br><code>position value ÷ total portfolio value</code> (incl. cash in portfolio basis).',
    top3: '<b>Concentration</b><br>Top-3 = sum of the three largest weights.<br><code>Effective N = 1 ÷ Σ w_i²</code> (inverse Herfindahl) — how many equally-weighted positions your portfolio behaves like.',
    divs: '<b>Dividends</b> in EUR at the payment-date FX rate. Withholding tax is shown separately as a drag.',
    fees: '<b>Fees</b> = transaction fees (incl. AutoFX) + other fees (market data, custody, exchange connection, FX conversion).',
    rolling: '<b>Rolling 12-month return</b><br><code>Index_t ÷ Index_t−365d − 1</code>',
    hold: '<b>Holding period</b> — open positions: days since the current round trip started. Closed trades: quantity-weighted average of (sell date − buy date) over the FIFO lots.',
    winrate: '<b>Win rate</b><br><code>round trips with realised P&L > 0 ÷ all closed round trips</code><br>A round trip runs from flat to flat; P&L is after fees.',
    pf: '<b>Profit factor</b><br><code>Σ winning P&L ÷ |Σ losing P&L|</code>',
    attribution: '<b>Return attribution</b> — all-time, EUR. Price + currency effects are gross of fees; fees, withholding tax and interest are shown as separate drags. The bars add up to value − net invested; any gap is shown as “Other”.',
    mwr_period: 'XIRR for a sub-period starts with the portfolio value at the beginning of the period as the initial investment.'
  };
  App.tip = (key) => `<i class="info" tabindex="0" data-tip-key="${key}" aria-label="Formula">i</i>`;

  function initTooltips() {
    const tip = document.getElementById('tip');
    let cur = null;
    const show = (el) => {
      const key = el.getAttribute('data-tip-key');
      const html = key ? App.TIPS[key] : esc(el.getAttribute('data-tip'));
      if (!html) return;
      cur = el;
      tip.innerHTML = html;
      tip.classList.add('on');
      const r = el.getBoundingClientRect();
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      let x = r.left + r.width / 2 - tw / 2, y = r.bottom + 8;
      if (y + th > window.innerHeight - 8) y = r.top - th - 8;
      x = Math.max(8, Math.min(x, window.innerWidth - tw - 8));
      tip.style.left = x + 'px'; tip.style.top = y + 'px';
    };
    const hide = () => { cur = null; tip.classList.remove('on'); };
    document.addEventListener('mouseover', e => { const el = e.target.closest('[data-tip-key],[data-tip]'); if (el && el !== cur) show(el); else if (!el && cur) hide(); });
    document.addEventListener('focusin', e => { const el = e.target.closest('[data-tip-key],[data-tip]'); if (el) show(el); });
    document.addEventListener('focusout', hide);
    document.addEventListener('scroll', hide, true);
  }

  /* -------------------------------------------------- modal, toast, misc */
  App.toast = function (msg, err) {
    const el = document.createElement('div');
    el.className = 'toast' + (err ? ' err' : '');
    el.textContent = msg;
    document.getElementById('toast-root').appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .3s'; setTimeout(() => el.remove(), 320); }, err ? 6000 : 3200);
  };
  App.modal = function (html, mount, opts) {
    opts = opts || {};
    App.closeModal();
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `<div class="modal ${opts.wide ? 'wide' : ''}" role="dialog" aria-modal="true">${html}</div>`;
    back.addEventListener('mousedown', e => { if (e.target === back) App.closeModal(); });
    document.getElementById('modal-root').appendChild(back);
    const m = back.querySelector('.modal');
    m.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', App.closeModal));
    if (mount) mount(m);
    const f = m.querySelector('input,select,textarea'); if (f && !opts.noFocus) setTimeout(() => f.focus(), 30);
    return m;
  };
  App.closeModal = function () { document.getElementById('modal-root').innerHTML = ''; };
  App.confirm = function (title, text, okLabel, onOk, danger) {
    App.modal(`<h2>${esc(title)}</h2><p class="text-2">${text}</p><div class="foot"><button class="btn" data-close>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" id="cf-ok">${esc(okLabel)}</button></div>`, m => {
      m.querySelector('#cf-ok').addEventListener('click', () => { App.closeModal(); onOk(); });
    });
  };
  App.download = function (name, text, type) {
    const blob = new Blob([text], { type: type || 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };
  App.readFile = file => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => {
      let txt = r.result;
      // Some broker exports are Windows-1252; if UTF-8 decoding produced replacement chars, re-read.
      if (/�/.test(txt) && !App.readFile._retry) {
        const r2 = new FileReader(); r2.onload = () => res(r2.result); r2.onerror = rej; r2.readAsText(file, 'windows-1252');
      } else res(txt);
    };
    r.onerror = rej;
    r.readAsText(file, 'utf-8');
  });
  App.instById = id => App.state.instruments.find(i => i.id === id);
  App.instLabel = (inst) => inst ? (inst.type === 'option' ? (inst.name || inst.ticker) : inst.ticker) : '?';

  /* --------------------------------------------------------- count-up */
  App.countUp = function (root) {
    const els = (root || document).querySelectorAll('[data-count]');
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    els.forEach(el => {
      const to = +el.getAttribute('data-count');
      const kind = el.getAttribute('data-fmt') || 'eur';
      const fmt = v => kind === 'pct' ? F.pct(v) : kind === 'spct' ? F.pct(v) : kind === 'seur' ? F.eur(v, { sign: true }) : kind === 'hero' ? App.heroHTML(v) : F.eur(v);
      if (reduce || !isFinite(to)) { el.innerHTML = fmt(to); return; }
      const dur = 900, t0 = performance.now();
      const step = (t) => {
        const k = Math.min(1, (t - t0) / dur);
        const e = 1 - Math.pow(1 - k, 3);
        el.innerHTML = fmt(to * e);
        if (k < 1) requestAnimationFrame(step); else el.innerHTML = fmt(to);
      };
      requestAnimationFrame(step);
    });
  };
  App.heroHTML = function (v) {
    const s = F.eur(v);
    const m = s.match(/^(.*?)([.,]\d{2})(\s?€?)$/);
    return m ? `${esc(m[1])}<span class="cents">${esc(m[2])}${esc(m[3])}</span>` : esc(s);
  };

  /* ------------------------------------------------------------ charts */
  const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  App.theme = function () {
    return {
      text: cssVar('--text'), text2: cssVar('--text-2'), muted: cssVar('--muted'), grid: cssVar('--grid'), axis: cssVar('--axis'),
      surface: cssVar('--surface'), surface3: cssVar('--surface-3'), border: cssVar('--border-strong'), accent: cssVar('--accent'), accentSoft: cssVar('--accent-soft'),
      gain: cssVar('--gain'), loss: cssVar('--loss'), gainSoft: cssVar('--gain-soft'), lossSoft: cssVar('--loss-soft'), warn: cssVar('--warn'), mid: cssVar('--neutral-mid'),
      bench: { b_msci: cssVar('--bench-1'), b_ndx: cssVar('--bench-2'), b_sox: cssVar('--bench-3') },
      cats: [cssVar('--cat-1'), cssVar('--cat-2'), cssVar('--cat-3'), cssVar('--cat-4'), cssVar('--cat-5')], other: cssVar('--cat-other')
    };
  };
  App.benchColor = (id, T, i) => (T.bench[id]) || [T.bench.b_msci, T.bench.b_ndx, T.bench.b_sox][i % 3];
  App.alpha = function (hex, a) {
    const h = hex.replace('#', '');
    if (h.length !== 6) return hex;
    return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
  };
  App.destroyCharts = function () { App.charts.forEach(c => { try { c.destroy(); } catch (e) { /* noop */ } }); App.charts = []; };
  App.chart = function (id, config) {
    const el = document.getElementById(id);
    if (!el) return null;
    if (!window.Chart) {
      el.parentElement.innerHTML = '<div class="chart-fallback">Charts need the Chart.js CDN (offline?). All numbers are still available in the tables.</div>';
      return null;
    }
    const c = new window.Chart(el, config);
    App.charts.push(c);
    return c;
  };
  App.crosshair = {
    id: 'crosshair',
    afterDatasetsDraw(chart) {
      const a = chart.tooltip && chart.tooltip.getActiveElements && chart.tooltip.getActiveElements();
      if (!a || !a.length) return;
      const x = a[0].element.x, { top, bottom } = chart.chartArea, ctx = chart.ctx;
      ctx.save(); ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, bottom); ctx.lineWidth = 1; ctx.strokeStyle = cssVar('--axis'); ctx.stroke(); ctx.restore();
    }
  };
  App.tooltipStyle = function (T) {
    return {
      backgroundColor: T.surface3, borderColor: T.border, borderWidth: 1, titleColor: T.text, bodyColor: T.text2, footerColor: T.muted,
      padding: 11, cornerRadius: 9, boxWidth: 8, boxHeight: 8, boxPadding: 4, usePointStyle: true,
      titleFont: { weight: '600', family: cssVar('--font') }, bodyFont: { family: cssVar('--font') }, caretSize: 0
    };
  };
  App.timeAxis = function (T, extra, range) {
    return Object.assign({ min: range ? range[0] : undefined, max: range ? range[1] : undefined,
      type: 'linear', grid: { display: false }, border: { color: T.axis },
      ticks: { color: T.muted, maxTicksLimit: 7, maxRotation: 0, autoSkipPadding: 18, callback: v => F.date(Math.round(v / PT.DAY), 'month') }
    }, extra || {});
  };
  App.valueAxis = function (T, fmt, extra) {
    return Object.assign({ grid: { color: T.grid, drawTicks: false }, border: { display: false }, ticks: { color: T.muted, padding: 8, maxTicksLimit: 6, callback: fmt } }, extra || {});
  };
  function applyChartDefaults() {
    if (!window.Chart) return;
    const C = window.Chart;
    C.defaults.font.family = cssVar('--font');
    C.defaults.font.size = 11.5;
    C.defaults.color = cssVar('--muted');
    C.defaults.animation.duration = 750;
    C.defaults.animation.easing = 'easeOutQuart';
    C.defaults.plugins.legend.display = false;
    C.defaults.maintainAspectRatio = false;
  }
  App.spark = function (vals, w, h) {
    w = w || 72; h = h || 24;
    const v = vals.filter(isFinite);
    if (v.length < 2) return '<span class="muted xs">—</span>';
    const mn = Math.min(...v), mx = Math.max(...v), rg = mx - mn || 1;
    const pts = v.map((y, i) => `${(i / (v.length - 1) * (w - 2) + 1).toFixed(1)},${(h - 2 - (y - mn) / rg * (h - 4)).toFixed(1)}`).join(' ');
    const up = v[v.length - 1] >= v[0];
    return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="var(${up ? '--gain' : '--loss'})" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  };

  /* ------------------------------------------------------- router/layout */
  const NAV = [
    ['dashboard', 'Dashboard'], ['positions', 'Positions'], ['allocation', 'Allocation'], ['performance', 'Performance'], ['closed', 'Closed'],
    ['sep'], ['activity', 'Activity'], ['data', 'Data & prices'], ['checks', 'Checks'], ['settings', 'Settings']
  ];
  function renderShell() {
    document.getElementById('nav').innerHTML = NAV.map(n => n[0] === 'sep' ? '<div class="nav-sep"></div>' :
      `<a href="#/${n[0]}" data-route="${n[0]}">${App.icon(n[0])}<span>${n[1]}</span></a>`).join('');
    document.getElementById('brand-mark').innerHTML = App.icon('logo', 2.2);
    syncShellControls();
  }
  function syncShellControls() {
    const s = App.state.settings;
    document.documentElement.setAttribute('data-theme', s.theme === 'light' ? 'light' : 'dark');
    document.documentElement.setAttribute('data-cb', s.cb ? '1' : '0');
    document.getElementById('theme-seg').innerHTML = `<button class="${s.theme !== 'light' ? 'on' : ''}" data-theme-set="dark" aria-label="Dark mode" title="Dark">${App.icon('moon')}</button><button class="${s.theme === 'light' ? 'on' : ''}" data-theme-set="light" aria-label="Light mode" title="Light">${App.icon('sun')}</button>`;
    document.getElementById('loc-seg').innerHTML = `<button class="${s.locale !== 'en' ? 'on' : ''}" data-loc="de" title="German number format">1.234,56</button><button class="${s.locale === 'en' ? 'on' : ''}" data-loc="en" title="English number format">1,234.56</button>`;
    document.querySelectorAll('#theme-seg svg').forEach(x => { x.style.width = '14px'; x.style.height = '14px'; x.style.display = 'block'; });
    applyChartDefaults();
  }
  App.syncShellControls = syncShellControls;

  App.parseRoute = function () {
    const h = location.hash.replace(/^#\/?/, '');
    const [r, p] = h.split('/');
    App.ui.route = App.views[r] ? r : 'dashboard';
    App.ui.param = p ? decodeURIComponent(p) : null;
  };
  App.go = function (route) { location.hash = '#/' + route; };

  App.render = function () {
    const view = App.views[App.ui.route] || App.views.dashboard;
    App.destroyCharts();
    document.querySelectorAll('#nav a').forEach(a => {
      const r = a.getAttribute('data-route');
      a.classList.toggle('active', r === App.ui.route || (App.ui.route === 'position' && r === 'positions'));
    });
    let out;
    try { out = view(App.ui.param); }
    catch (e) { console.error(e); out = { title: 'Something went wrong', html: `<div class="card"><p>${esc(e.message)}</p><pre class="code small">${esc(e.stack)}</pre></div>` }; }
    const r = App.res;
    const asOf = r && !r.empty ? F.date(r.asOfISO, 'med') : F.date(PT.todayISO(), 'med');
    document.getElementById('page-title').textContent = out.title;
    document.getElementById('page-sub').innerHTML = out.sub != null ? out.sub : `Valuation as of ${asOf} · base currency EUR`;
    document.getElementById('page-actions').innerHTML = out.actions != null ? out.actions : App.defaultActions();
    document.getElementById('banner').innerHTML = out.noBanner ? '' : App.bannerHTML();
    const v = document.getElementById('view');
    v.innerHTML = `<div class="fade-in">${out.html}</div>`;
    if (out.mount) { try { out.mount(v); } catch (e) { console.error(e); App.toast('Render error: ' + e.message, true); } }
    App.countUp(v);
    bindCommon(document);
  };
  App.defaultActions = () => `<button class="btn" data-act="prices">${App.icon('refresh')}Update prices</button><button class="btn primary" data-act="add-trade">${App.icon('plus')}Add transaction</button>`;
  App.bannerHTML = function () {
    let h = '';
    if (App.state.meta && App.state.meta.demo) {
      h += `<div class="banner demo"><div class="ico">${App.icon('spark')}</div><div class="grow"><b>Demo portfolio.</b> <span class="text-2">Synthetic prices and trades — not market data. Explore freely, then clear it and import your DEGIRO/IBKR exports.</span></div><button class="btn sm" data-act="clear-demo">Clear demo data</button><button class="btn sm primary" data-act="goto-import">Import my data</button></div>`;
    }
    const r = App.res;
    if (r && !r.empty) {
      const errs = r.warnings.filter(w => w.level === 'error');
      const miss = r.positions.filter(p => p.missingPrice);
      const stale = r.positions.filter(p => !p.missingPrice && p.stale && !(p.expiry && p.expiry < r.asOfISO));
      const bits = [];
      errs.forEach(w => bits.push(esc(w.text)));
      if (miss.length) bits.push(`No price for ${miss.map(p => esc(App.instLabel(p.inst))).join(', ')}.`);
      if (stale.length && App.ui.route === 'dashboard') bits.push(`${stale.length} position(s) priced with data older than 7 days.`);
      if (bits.length) h += `<div class="banner warn"><div class="ico">${App.icon('alert')}</div><div class="grow">${bits.join(' ')}</div><button class="btn sm" data-act="prices">Update prices</button></div>`;
    }
    return h;
  };

  function bindCommon(root) {
    root.querySelectorAll('[data-act]').forEach(b => {
      if (b._bound) return; b._bound = true;
      b.addEventListener('click', e => { e.preventDefault(); App.action(b.getAttribute('data-act'), b); });
    });
  }
  App.bindCommon = bindCommon;
  App.action = function (act, el) {
    switch (act) {
      case 'add-trade': return App.tradeForm();
      case 'add-cash': return App.cashForm();
      case 'prices': App.ui.dataTab = 'prices'; return App.go('data');
      case 'goto-import': App.ui.dataTab = 'import'; return App.go('data');
      case 'clear-demo': return App.confirm('Clear demo data?', 'All demo positions, prices and benchmark series are removed. Anything you added yourself stays.', 'Clear demo data', () => { App.commit(s => PT.stripDemo(s)); App.toast('Demo data removed.'); });
      default: if (App.actions[act]) return App.actions[act](el);
    }
  };
  App.actions = {};

  /* ------------------------------------------------------------- boot */
  App.boot = function () {
    let s = App.load();
    if (!s) { s = PT.buildDemo(); App.state = migrate(s); App.save(); }
    else App.state = s;
    renderShell();
    initTooltips();
    document.getElementById('theme-seg').addEventListener('click', e => {
      const b = e.target.closest('[data-theme-set]'); if (!b) return;
      App.state.settings.theme = b.getAttribute('data-theme-set'); App.save(); syncShellControls(); App.render();
    });
    document.getElementById('loc-seg').addEventListener('click', e => {
      const b = e.target.closest('[data-loc]'); if (!b) return;
      App.state.settings.locale = b.getAttribute('data-loc'); App.save(); syncShellControls(); App.render();
    });
    window.addEventListener('hashchange', () => { App.parseRoute(); App.render(); window.scrollTo(0, 0); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') App.closeModal(); });
    App.recompute();
    App.parseRoute();
    App.render();
  };
})();
