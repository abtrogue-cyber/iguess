/* =====================================================================
 * App shell: state, persistence, formatting, tooltips, modal, command
 * palette, ticker tape, odometer, chart plugins, treemap, router.
 * Views live in app-views.js / app-data.js.
 * ===================================================================== */
(function () {
  'use strict';
  const PT = window.PT;
  const LS_KEY = 'conviction.portfolio.v1';
  const App = window.App = {
    state: null, res: null, charts: [], observers: [], mcache: {},
    ui: {
      route: 'dashboard', param: null,
      eqPeriod: '1Y', eqMode: 'value', eqBench: ['b_msci', 'b_ndx', 'b_sox'],
      perfPeriod: 'ALL', posSort: { k: 'value', dir: -1 }, posQuery: '', posOptions: true, posView: 'table',
      closedSort: { k: 'end', dir: -1 }, actTab: 'trades', actQuery: '', actType: '', dataTab: 'import',
      detailPeriod: 'ALL', counted: {}, mapColor: 'pnl', allocGroup: 'theme'
    }
  };

  /* ------------------------------------------------------------ icons */
  const P = {
    dashboard: '<rect x="3" y="3" width="7.5" height="9" rx="1"/><rect x="13.5" y="3" width="7.5" height="5" rx="1"/><rect x="13.5" y="11" width="7.5" height="10" rx="1"/><rect x="3" y="15" width="7.5" height="6" rx="1"/>',
    positions: '<path d="M4 6h16M4 12h16M4 18h10"/>',
    allocation: '<rect x="3" y="3" width="18" height="18" rx="1"/><path d="M12 3v18M12 12h9M3 9h9"/>',
    performance: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
    closed: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 10"/>',
    activity: '<path d="M7 4v16M7 20l-3-3M7 20l3-3M17 20V4M17 4l-3 3M17 4l3 3"/>',
    data: '<ellipse cx="12" cy="5.5" rx="8" ry="2.8"/><path d="M4 5.5v6c0 1.5 3.6 2.8 8 2.8s8-1.3 8-2.8v-6M4 11.5v6c0 1.5 3.6 2.8 8 2.8s8-1.3 8-2.8v-6"/>',
    checks: '<path d="M12 3l7.5 3v5.5c0 4.6-3.2 8.3-7.5 9.5-4.3-1.2-7.5-4.9-7.5-9.5V6z"/><path d="M8.8 12l2.2 2.2 4.4-4.4"/>',
    settings: '<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>',
    more: '<circle cx="5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="19" cy="12" r="1.4" fill="currentColor"/>',
    plus: '<path d="M12 5v14M5 12h14"/>', upload: '<path d="M12 16V4M7 9l5-5 5 5M4 20h16"/>', download: '<path d="M12 4v12M7 11l5 5 5-5M4 20h16"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.6-4.5L4 8M4 4v4h4M4 13a8 8 0 0 0 14.6 4.5L20 16M20 20v-4h-4"/>', trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>', x: '<path d="M6 6l12 12M18 6L6 18"/>', back: '<path d="M15 5l-7 7 7 7"/>', arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5z"/>', alert: '<path d="M12 3l9.5 17h-19z"/><path d="M12 10v4M12 17.5v.5"/>',
    spark: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/>', file: '<path d="M6 3h8l4 4v14H6z"/><path d="M14 3v4h4"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
    search: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>'
  };
  App.icon = (n, sw) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${sw || 1.7}" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${P[n] || ''}</svg>`;

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
  App.exportBackup = function () {
    App.download(`portfolio-backup-${PT.todayISO()}.json`, JSON.stringify(Object.assign({ app: 'conviction-portfolio', exportedAt: new Date().toISOString() }, App.state)));
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
      if (o.compact && Math.abs(v) >= 10000) {
        // German compact notation only abbreviates millions ("Mio."); below that show whole euros instead of "74.887,3 €"
        if (App.state.settings.locale !== 'en' && Math.abs(v) < 1e6) return nf({ style: 'currency', currency: 'EUR', maximumFractionDigits: 0, signDisplay: o.sign ? 'exceptZero' : 'auto' }).format(v);
        return nf({ style: 'currency', currency: 'EUR', notation: 'compact', maximumFractionDigits: 1, signDisplay: o.sign ? 'exceptZero' : 'auto' }).format(v);
      }
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
      if (s == null || s === '') return '—';
      const d = typeof s === 'number' ? new Date(s * PT.DAY) : new Date(s + 'T00:00:00Z');
      const opts = style === 'month' ? { month: 'short', year: '2-digit', timeZone: 'UTC' }
        : style === 'long' ? { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }
          : style === 'med' ? { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }
            : style === 'dm' ? { day: '2-digit', month: '2-digit', timeZone: 'UTC' }
              : { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' };
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
    arrow: v => (!isFinite(v) || Math.abs(v) < 1e-12) ? '■' : (v > 0 ? '▲' : '▼'),
    esc: s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    seur: (v, o) => `<span class="num ${F.cls(v)}">${F.eur(v, Object.assign({ sign: true }, o || {}))}</span>`,
    spct: (v, o) => `<span class="num ${F.cls(v)}">${F.pct(v, o)}</span>`,
    /** Parse user input: English uses "." as decimal; German uses "," when present, otherwise "." (so 1,163 = 1.163 and 1.5 = 1.5). */
    parseIn(s) {
      const str = String(s == null ? '' : s).trim();
      if (App.state.settings.locale === 'en') return PT.parseNum(str, '.');
      return PT.parseNum(str, str.includes(',') ? ',' : '.');
    }
  };
  const esc = F.esc;
  /** Short axis labels: 160k €, 1,2 Mio. € (de) / €160k, €1.2M (en). */
  App.axisEur = function (v) {
    const a = Math.abs(v), en = App.state.settings.locale === 'en';
    if (a >= 1e6) return en ? '€' + F.num(v / 1e6, 1) + 'M' : F.num(v / 1e6, 1) + ' Mio. €';
    if (a >= 1e3) return en ? '€' + F.num(v / 1e3, 0) + 'k' : F.num(v / 1e3, 0) + 'k €';
    return F.eur(v, { dec: 0 });
  };
  App.shortBench = n => { const m = String(n || '').match(/\(([^)]+)\)/); return m ? m[1] : (n.length > 13 ? n.slice(0, 12) + '…' : n); };

  /* ------------------------------------------------------ formula tips */
  App.TIPS = {
    lots: '<b>Which lots a sale closes</b><br><b>FIFO</b> (default): the oldest purchase first — the rule German tax law applies.<br><b>LIFO</b>: the newest purchase first, as you can choose per sale at IBKR. It changes realised vs. unrealised P&amp;L and the cost basis of what you keep, not the total.',
    value: '<b>Total value</b><br><code>Σ qty × price × multiplier ÷ FX + cash</code><br>FX is quoted as local currency per 1 EUR (e.g. USD 1.16). Prices are the latest stored price on or before the valuation date.',
    invested: '<b>Net invested capital</b><br><code>deposits − withdrawals</code><br>plus securities transferred in without a matching transfer-out (valued at market). In “securities only” basis: purchases − sale proceeds − income.',
    pnl: '<b>Absolute return</b><br><code>total value − net invested</code><br><b>Simple return</b> <code>absolute return ÷ net invested</code>',
    twr: '<b>Time-weighted return (TWR)</b><br>Daily returns, chained:<br><code>r_t = (V_t − V_t−1 − F_t) ÷ (V_t−1 + max(F_t, 0))</code><br><code>TWR = Π(1 + r_t) − 1</code><br>F = external cash flows (deposits/withdrawals). Neutralises the size and timing of your flows — it measures the investments.',
    xirr: '<b>Money-weighted return (XIRR)</b><br>The annual rate r that solves<br><code>Σ CF_i ÷ (1 + r)^((t_i − t_0)/365) = 0</code><br>with deposits negative, withdrawals and the end value positive. Includes the timing of your flows — it measures your experience as an investor.',
    twrvsmwr: '<b>TWR vs. XIRR</b> — TWR judges the investments, XIRR judges your timing: they differ when you add or withdraw money ahead of big moves.',
    ann: '<b>Annualised TWR</b><br><code>(1 + TWR)^(365 / days) − 1</code><br>Only shown as “p.a.” for periods ≥ 1 year.',
    day: '<b>1D</b> — change versus the previous trading day before your latest stored prices, net of cash flows.',
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
    map: '<b>Portfolio map</b> — tile area = market value (long positions). Colour = unrealised P&L % (or the last price move in 1D mode), on a diverging scale with grey at zero.',
    movers: '<b>Movers</b> — change between the two most recent stored prices of each holding, in its own currency.',
    mwr_period: 'XIRR for a sub-period starts with the portfolio value at the beginning of the period as the initial investment.'
  };
  App.tip = (key) => `<i class="info" tabindex="0" data-tip-key="${key}" aria-label="Formula">i</i>`;

  function initTooltips() {
    const tip = document.getElementById('tip');
    let cur = null;
    const show = (el) => {
      const key = el.getAttribute('data-tip-key');
      const html = key ? App.TIPS[key] : (el.getAttribute('data-tip-html') || esc(el.getAttribute('data-tip')));
      if (!html) return;
      cur = el;
      tip.innerHTML = html;
      tip.classList.add('on');
      const r = el.getBoundingClientRect();
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      let x = r.left + r.width / 2 - tw / 2, y = r.bottom + 8;
      if (y + th > window.innerHeight - 8) y = r.top - th - 8;
      x = Math.max(8, Math.min(x, window.innerWidth - tw - 8));
      tip.style.left = x + 'px'; tip.style.top = Math.max(8, y) + 'px';
    };
    const hide = () => { cur = null; tip.classList.remove('on'); };
    const SEL = '[data-tip-key],[data-tip],[data-tip-html]';
    document.addEventListener('mouseover', e => { const el = e.target.closest(SEL); if (el && el !== cur) show(el); else if (!el && cur) hide(); });
    document.addEventListener('focusin', e => { const el = e.target.closest(SEL); if (el) show(el); });
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
    App.modal(`<div class="label" style="margin-bottom:10px">Confirm</div><h2>${esc(title)}</h2><p class="text-2">${text}</p><div class="foot"><button class="btn" data-close>Cancel</button><button class="btn ${danger ? 'danger' : 'primary'}" id="cf-ok">${esc(okLabel)}</button></div>`, m => {
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
      const txt = r.result;
      // Some broker exports are Windows-1252; if UTF-8 decoding produced replacement chars, re-read.
      if (/�/.test(txt)) { const r2 = new FileReader(); r2.onload = () => res(r2.result); r2.onerror = rej; r2.readAsText(file, 'windows-1252'); }
      else res(txt);
    };
    r.onerror = rej;
    r.readAsText(file, 'utf-8');
  });
  App.instById = id => App.state.instruments.find(i => i.id === id);
  App.instLabel = (inst) => inst ? (inst.type === 'option' ? (inst.name || inst.ticker) : inst.ticker) : '?';

  /* ------------------------------------------------- odometer & count-up */
  const reduceMotion = () => window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  App.odoHTML = function (text) {
    let k = 0;
    return Array.from(String(text)).map(ch => {
      if (/[0-9]/.test(ch)) {
        return `<span class="odo"><span class="odo-s" style="--d:${ch};--k:${k++}"><i>0</i><i>1</i><i>2</i><i>3</i><i>4</i><i>5</i><i>6</i><i>7</i><i>8</i><i>9</i></span></span>`;
      }
      return `<span class="odo-c">${esc(ch)}</span>`;
    }).join('');
  };
  App.heroParts = function (v) {
    const s = F.eur(v);
    const m = s.match(/^(.*?)([.,]\d{2})(\s?€?)$/);
    return m ? [m[1], m[2] + m[3]] : [s, ''];
  };
  App.heroHTML = function (v) { const [a, b] = App.heroParts(v); return `${esc(a)}<span class="cents">${esc(b)}</span>`; };
  App.odoHeroHTML = function (v) { const [a, b] = App.heroParts(v); return `${App.odoHTML(a)}<span class="cents">${App.odoHTML(b)}</span>`; };
  App.odoGo = function (root) {
    const strips = (root || document).querySelectorAll('.odo-s:not(.go)');
    if (!strips.length) return;
    void document.body.offsetHeight; // lay out the start position before transitioning
    requestAnimationFrame(() => requestAnimationFrame(() => strips.forEach(s => s.classList.add('go'))));
  };
  App.countUp = function (root) {
    const els = (root || document).querySelectorAll('[data-count]');
    els.forEach(el => {
      const to = +el.getAttribute('data-count');
      const kind = el.getAttribute('data-fmt') || 'eur';
      const fmt = v => kind === 'pct' ? F.pct(v) : kind === 'seur' ? F.eur(v, { sign: true }) : F.eur(v);
      if (reduceMotion() || !isFinite(to)) { el.innerHTML = fmt(to); return; }
      const dur = 900, t0 = performance.now();
      const step = (t) => { const k = Math.min(1, (t - t0) / dur); el.innerHTML = fmt(to * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(step); };
      requestAnimationFrame(step);
    });
  };

  /* ------------------------------------------------------------ colour */
  const cssVar = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
  App.theme = function () {
    const light = App.state.settings.theme === 'light';
    return {
      light, text: cssVar('--text'), text2: cssVar('--text-2'), muted: cssVar('--muted'), grid: cssVar('--line'), axis: cssVar('--line-2'),
      surface: cssVar('--panel-solid'), surface3: cssVar('--panel-3'), border: cssVar('--line-2'), accent: cssVar('--accent'), accent2: cssVar('--accent-2'),
      accentInk: cssVar('--accent-ink'), glow: light ? null : cssVar('--glow'), gain: cssVar('--gain'), loss: cssVar('--loss'), warn: cssVar('--warn'),
      mid: cssVar('--neutral-mid'), tmMid: cssVar('--tm-mid'), mono: cssVar('--mono'), font: cssVar('--font'),
      bench: { b_msci: cssVar('--bench-1'), b_ndx: cssVar('--bench-2'), b_sox: cssVar('--bench-3') },
      dash: { b_msci: [], b_ndx: [6, 4], b_sox: [2, 3] }
    };
  };
  App.benchColor = (id, T, i) => (T.bench[id]) || [T.bench.b_msci, T.bench.b_ndx, T.bench.b_sox][i % 3];
  App.benchDash = (id, T, i) => (T.dash[id]) || [[], [6, 4], [2, 3]][i % 3];
  App.benchSwClass = (id, i) => { const m = { b_msci: '', b_ndx: 'dash', b_sox: 'dot2' }; return m[id] != null ? m[id] : ['', 'dash', 'dot2'][i % 3]; };
  const hexRGB = h => { h = h.replace('#', ''); if (h.length === 3) h = h.split('').map(c => c + c).join(''); return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]; };
  App.alpha = function (hex, a) {
    if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(hex || '')) return hex;
    const [r, g, b] = hexRGB(hex);
    return `rgba(${r},${g},${b},${a})`;
  };
  App.mix = function (a, b, t) {
    const A = hexRGB(a), B = hexRGB(b);
    const c = A.map((x, i) => Math.round(x + (B[i] - x) * t));
    return `rgb(${c[0]},${c[1]},${c[2]})`;
  };
  const lum = rgb => { const m = rgb.match(/\d+/g).map(Number).map(v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }); return 0.2126 * m[0] + 0.7152 * m[1] + 0.0722 * m[2]; };
  /** Diverging colour (grey at zero → gain/loss hue) plus an ink colour that stays readable on it. */
  App.divColor = function (m, cap, T) {
    T = T || App.theme();
    if (!isFinite(m)) return { bg: T.tmMid, ink: T.text };
    const a = Math.pow(Math.min(1, Math.abs(m) / cap), 0.72);
    // deep, saturated-but-not-neon fills: the strongest tile stops short of the full signal colour
    const bg = App.mix(T.tmMid, m >= 0 ? T.gain : T.loss, (T.light ? 0.12 : 0.1) + (T.light ? 0.7 : 0.56) * a);
    return { bg, ink: lum(bg) > 0.33 ? '#07090d' : '#ffffff' };
  };

  /* ------------------------------------------------------------ charts */
  App.destroyCharts = function () {
    App.charts.forEach(c => { try { c.destroy(); } catch (e) { /* noop */ } });
    App.charts = [];
    App.observers.forEach(o => { try { o.disconnect(); } catch (e) { /* noop */ } });
    App.observers = [];
  };
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
  function pill(ctx, x, y, text, bg, fg, align, T) {
    ctx.save();
    ctx.font = `500 10.5px ${T.mono}`;
    const w = ctx.measureText(text).width + 12, h = 19;
    const px = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
    ctx.fillStyle = bg;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(px, y - h / 2, w, h, 2); else ctx.rect(px, y - h / 2, w, h);
    ctx.fill();
    ctx.fillStyle = fg; ctx.textBaseline = 'middle'; ctx.textAlign = 'left';
    ctx.fillText(text, px + 6, y + 0.5);
    ctx.restore();
    return w;
  }
  /** Neon glow under a dataset (dark theme only). */
  App.glowPlugin = {
    id: 'glow',
    beforeDatasetDraw(chart, args) { const ds = chart.data.datasets[args.index]; if (!ds.glow) return; chart.ctx.save(); chart.ctx.shadowColor = ds.glow; chart.ctx.shadowBlur = 14; },
    afterDatasetDraw(chart, args) { const ds = chart.data.datasets[args.index]; if (ds.glow) chart.ctx.restore(); }
  };
  /** Crosshair with value and date tags on the axes (TradingView style). */
  App.xhair = {
    id: 'xhair',
    afterDatasetsDraw(chart, args, o) {
      const act = chart.tooltip && chart.tooltip.getActiveElements ? chart.tooltip.getActiveElements() : [];
      if (!act.length || !o || o.enabled === false) return;
      const T = App.theme();
      const a0 = act.find(a => a.datasetIndex === 0) || act[0];
      const { top, bottom, left, right } = chart.chartArea, ctx = chart.ctx;
      const x = a0.element.x, y = a0.element.y;
      ctx.save();
      ctx.strokeStyle = T.axis; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(Math.round(x) + 0.5, top); ctx.lineTo(Math.round(x) + 0.5, bottom); ctx.stroke();
      ctx.setLineDash([2, 3]);
      ctx.beginPath(); ctx.moveTo(left, Math.round(y) + 0.5); ctx.lineTo(right, Math.round(y) + 0.5); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = T.surface; ctx.beginPath(); ctx.arc(x, y, 5.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = o.color || T.accent; ctx.beginPath(); ctx.arc(x, y, 3.5, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      const raw = chart.data.datasets[a0.datasetIndex].data[a0.index];
      if (raw && o.fmtY) pill(ctx, right + 4, y, o.fmtY(raw.y), o.color || T.accent, T.accentInk, 'left', T);
      if (raw && o.fmtX) pill(ctx, Math.min(Math.max(x, left + 44), right - 44), bottom + 13, o.fmtX(raw.x), T.text, T.surface, 'center', T);
    }
  };
  /** Direct labels at the right end of each series; the portfolio gets a filled tag. */
  App.endLabels = {
    id: 'endLabels',
    afterDatasetsDraw(chart, args, o) {
      if (!o || !o.enabled) return;
      if (o.hideOnHover && chart.tooltip && chart.tooltip.getActiveElements && chart.tooltip.getActiveElements().length) return;
      const T = App.theme(), ctx = chart.ctx, area = chart.chartArea;
      const L = [];
      chart.data.datasets.forEach((ds, i) => {
        if (!ds.endLabel) return;
        const meta = chart.getDatasetMeta(i);
        if (meta.hidden || !meta.data.length) return;
        const last = meta.data[meta.data.length - 1];
        L.push({ y0: last.y, y: last.y, x: last.x, text: ds.endLabel, color: ds.borderColor, pill: !!ds.endPill });
      });
      L.sort((a, b) => a.y - b.y);
      for (let i = 1; i < L.length; i++) if (L[i].y - L[i - 1].y < 20) L[i].y = L[i - 1].y + 20;
      const over = L.length ? L[L.length - 1].y - (area.bottom - 8) : 0;
      if (over > 0) L.forEach(l => { l.y -= over; });
      for (let i = L.length - 2; i >= 0; i--) if (L[i + 1].y - L[i].y < 20) L[i].y = L[i + 1].y - 20;
      L.forEach(l => {
        const x = area.right + 6;
        if (Math.abs(l.y - l.y0) > 1) {
          ctx.save(); ctx.strokeStyle = l.color; ctx.globalAlpha = 0.55; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.moveTo(l.x + 2, l.y0); ctx.lineTo(x - 2, l.y); ctx.stroke(); ctx.restore();
        }
        if (l.pill) pill(ctx, x, l.y, l.text, T.accent, T.accentInk, 'left', T);
        else {
          ctx.save(); ctx.font = `500 10.5px ${T.mono}`; ctx.textBaseline = 'middle';
          ctx.fillStyle = l.color; ctx.fillRect(x, l.y - 1, 8, 2);
          ctx.fillStyle = T.text2; ctx.fillText(l.text, x + 12, l.y + 0.5); ctx.restore();
        }
      });
    }
  };
  App.crosshair = App.xhair;
  App.tooltipStyle = function (T) {
    return {
      backgroundColor: T.surface, borderColor: T.border, borderWidth: 1, titleColor: T.text, bodyColor: T.text2, footerColor: T.muted,
      padding: 11, cornerRadius: 2, boxWidth: 10, boxHeight: 2, boxPadding: 5, usePointStyle: false,
      titleFont: { weight: '600', family: T.mono, size: 11 }, bodyFont: { family: T.mono, size: 11 }, caretSize: 0, displayColors: true
    };
  };
  App.timeAxis = function (T, extra, range) {
    return Object.assign({
      type: 'linear', min: range ? range[0] : undefined, max: range ? range[1] : undefined, grid: { display: false }, border: { color: T.axis },
      ticks: { color: T.muted, maxTicksLimit: 7, maxRotation: 0, autoSkipPadding: 22, font: { family: T.mono, size: 10 }, callback: v => F.date(Math.round(v / PT.DAY), 'month').toUpperCase() }
    }, extra || {});
  };
  App.valueAxis = function (T, fmt, extra) {
    return Object.assign({ position: 'left', grid: { color: T.grid, drawTicks: false }, border: { display: false }, ticks: { color: T.muted, padding: 10, maxTicksLimit: 6, font: { family: T.mono, size: 10 }, callback: fmt } }, extra || {});
  };
  App.gradientFill = function (hex, a1, a0) {
    return (ctx) => {
      const ch = ctx.chart, area = ch.chartArea;
      if (!area) return App.alpha(hex, a1 * 0.4);
      const g = ch.ctx.createLinearGradient(0, area.top, 0, area.bottom);
      g.addColorStop(0, App.alpha(hex, a1)); g.addColorStop(1, App.alpha(hex, a0 || 0));
      return g;
    };
  };
  function applyChartDefaults() {
    if (!window.Chart) return;
    const C = window.Chart, T = App.theme();
    C.defaults.font.family = T.mono || 'monospace';
    C.defaults.font.size = 10.5;
    C.defaults.color = T.muted;
    C.defaults.animation.duration = 900;
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
    return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="var(${up ? '--gain' : '--loss'})" stroke-width="1.4" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  };

  /* ----------------------------------------------------------- treemap */
  function worst(row, sum, side) {
    let mx = 0, mn = Infinity;
    row.forEach(n => { if (n.area > mx) mx = n.area; if (n.area < mn) mn = n.area; });
    const s2 = side * side, q = sum * sum;
    return Math.max(s2 * mx / q, q / (s2 * mn));
  }
  /** Squarified treemap layout (Bruls, Huizing & van Wijk). nodes: [{ref, area}] */
  App.squarify = function (nodes, x, y, w, h) {
    const out = [];
    nodes = nodes.filter(n => n.area > 0).sort((a, b) => b.area - a.area);
    let i = 0;
    while (i < nodes.length) {
      const side = Math.min(w, h);
      if (side <= 0.5) break;
      let row = [nodes[i]], sum = nodes[i].area, best = worst(row, sum, side), j = i + 1;
      while (j < nodes.length) {
        const r2 = row.concat(nodes[j]), s2 = sum + nodes[j].area, w2 = worst(r2, s2, side);
        if (w2 > best) break;
        row = r2; sum = s2; best = w2; j++;
      }
      if (w >= h) { const cw = sum / h; let cy = y; row.forEach(n => { const nh = n.area / cw; out.push({ ref: n.ref, x, y: cy, w: cw, h: nh }); cy += nh; }); x += cw; w -= cw; }
      else { const rh = sum / w; let cx = x; row.forEach(n => { const nw = n.area / rh; out.push({ ref: n.ref, x: cx, y, w: nw, h: rh }); cx += nw; }); y += rh; h -= rh; }
      i = j;
    }
    return out;
  };
  /**
   * items: [{v, label, metricText, sub, href, tip, color:{bg,ink}, g?}] — v = area weight.
   * opts.groups: nest by item.g with a header strip per group.
   */
  App.treemap = function (el, items, opts) {
    opts = opts || {};
    const tot = items.reduce((s, x) => s + Math.max(0, x.v), 0);
    const tile = (t) => {
      const it = t.ref;
      const x0 = Math.round(t.x), y0 = Math.round(t.y), w = Math.max(0, Math.round(t.x + t.w) - x0 - 1), h = Math.max(0, Math.round(t.y + t.h) - y0 - 1);
      if (w < 2 || h < 2) return '';
      const area = Math.sqrt(w * h);
      const fsM = Math.max(13, Math.min(34, area / 6.2)), fsT = Math.max(10, Math.min(15, area / 11));
      const big = w > 92 && h > 66, mid = w > 46 && h > 30;
      const inner = (mid ? `<div class="tm-t" style="font-size:${fsT}px">${esc(it.label)}</div>` : '') +
        (big ? `<div><div class="tm-m" style="font-size:${fsM}px">${esc(it.metricText)}</div><div class="tm-w">${esc(it.sub)}</div></div>` : (mid && h > 44 ? `<div class="tm-w">${esc(it.metricText)}</div>` : ''));
      return `<a class="tm-tile" href="${it.href}" style="left:${x0}px;top:${y0}px;width:${w}px;height:${h}px;background:${it.color.bg};color:${it.color.ink}" data-tip-html="${esc(it.tip)}" aria-label="${esc(it.label + ' ' + it.metricText)}">${inner}</a>`;
    };
    const draw = () => {
      const W = el.clientWidth, H = el.clientHeight;
      if (!W || !H) return;
      if (!(tot > 0)) { el.innerHTML = '<div class="chart-fallback">No long positions to map.</div>'; return; }
      let html = '';
      if (opts.groups) {
        const gm = {};
        items.forEach(it => { const k = it.g || 'Other'; (gm[k] = gm[k] || { k, v: 0, items: [] }); gm[k].v += it.v; gm[k].items.push(it); });
        App.squarify(Object.values(gm).map(g => ({ ref: g, area: g.v / tot * W * H })), 0, 0, W, H).forEach(R => {
          const gh = R.h > 50 && R.w > 70 ? 20 : 0;
          const gx = Math.round(R.x), gy = Math.round(R.y), gw = Math.round(R.x + R.w) - gx - 1;
          if (gh) html += `<div class="tm-g" style="left:${gx}px;top:${gy}px;width:${gw}px;height:${gh}px"><b>${esc(R.ref.k)}</b><span>${F.pct(R.ref.v / tot, { sign: false, dec: 1 })}</span></div>`;
          App.squarify(R.ref.items.map(it => ({ ref: it, area: it.v / R.ref.v * R.w * (R.h - gh) })), R.x, R.y + gh, R.w, R.h - gh).forEach(t => { html += tile(t); });
        });
      } else {
        App.squarify(items.map(it => ({ ref: it, area: it.v / tot * W * H })), 0, 0, W, H).forEach(t => { html += tile(t); });
      }
      el.innerHTML = html;
    };
    draw();
    if (window.ResizeObserver) {
      let lastW = el.clientWidth;
      const ro = new ResizeObserver(() => { if (el.clientWidth !== lastW) { lastW = el.clientWidth; draw(); } });
      ro.observe(el); App.observers.push(ro);
    }
  };
  App.mapLegend = function (cap, label) {
    const T = App.theme();
    const stops = [-1, -0.5, 0, 0.5, 1].map(v => App.divColor(v * cap, cap, T).bg);
    return `<div class="tm-legend"><span>${F.pct(-cap, { dec: 0 })}</span><span class="scale" style="background:linear-gradient(90deg,${stops.join(',')})"></span><span>${F.pct(cap, { dec: 0 })}</span><span>${esc(label || '')}</span></div>`;
  };

  /* ------------------------------------------------------- router/layout */
  const NAV = [
    ['dashboard', 'Overview'], ['positions', 'Positions'], ['allocation', 'Allocation'], ['performance', 'Performance'], ['closed', 'Closed'],
    ['activity', 'Activity'], ['data', 'Data'], ['checks', 'Checks']
  ];
  const PAGES = {
    dashboard: ['01', 'Overview'], positions: ['02', 'Holdings'], position: ['02', 'Holdings · detail'], allocation: ['03', 'Exposure'], performance: ['04', 'Returns & risk'],
    closed: ['05', 'Realised'], activity: ['06', 'Ledger'], data: ['07', 'Data & prices'], checks: ['08', 'Verification'], settings: ['09', 'Preferences']
  };
  App.NAV = NAV;
  function renderShell() {
    document.getElementById('nav').innerHTML = NAV.map(n => `<a href="#/${n[0]}" data-route="${n[0]}">${App.icon(n[0])}<span>${n[1]}</span></a>`).join('') + `<a href="#/settings" data-route="settings" class="nav-icon" title="Settings">${App.icon('settings')}<span>Settings</span></a>`;
    document.getElementById('tabbar').innerHTML = [['dashboard', 'Overview'], ['positions', 'Positions'], ['performance', 'Returns'], ['allocation', 'Exposure']]
      .map(n => `<a href="#/${n[0]}" data-route="${n[0]}">${App.icon(n[0])}<span>${n[1]}</span></a>`).join('') + `<button type="button" id="tab-more">${App.icon('more')}<span>More</span></button>`;
    document.getElementById('tab-more').addEventListener('click', () => App.palette());
    document.getElementById('tb-add').innerHTML = `${App.icon('plus', 2)}<span class="t">Add</span>`;
    const mac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
    document.getElementById('kbar-key').textContent = mac ? '⌘K' : 'Ctrl K';
    document.getElementById('kbar').addEventListener('click', () => App.palette());
    document.getElementById('price-status').addEventListener('click', () => { App.ui.dataTab = 'prices'; App.go('data'); });
    syncShellControls();
  }
  function syncShellControls() {
    const s = App.state.settings;
    document.documentElement.setAttribute('data-theme', s.theme === 'light' ? 'light' : 'dark');
    document.documentElement.setAttribute('data-cb', s.cb ? '1' : '0');
    const tc = document.querySelector('meta[name="theme-color"]'); if (tc) tc.setAttribute('content', s.theme === 'light' ? '#f2f1ec' : '#04060a');
    document.getElementById('theme-seg').innerHTML = `<button class="${s.theme !== 'light' ? 'on' : ''}" data-theme-set="dark" aria-label="Dark mode" title="Dark">${App.icon('moon')}</button><button class="${s.theme === 'light' ? 'on' : ''}" data-theme-set="light" aria-label="Light mode" title="Light">${App.icon('sun')}</button>`;
    document.getElementById('loc-seg').innerHTML = `<button class="${s.locale !== 'en' ? 'on' : ''}" data-loc="de" title="German number format (1.234,56)">DE</button><button class="${s.locale === 'en' ? 'on' : ''}" data-loc="en" title="English number format (1,234.56)">EN</button>`;
    applyChartDefaults();
    const tape = document.getElementById('tape'); if (tape) tape._sig = null;
  }
  App.syncShellControls = syncShellControls;

  App.parseRoute = function () {
    const h = location.hash.replace(/^#\/?/, '');
    const [r, p] = h.split('/');
    App.ui.route = App.views[r] ? r : 'dashboard';
    App.ui.param = p ? decodeURIComponent(p) : null;
  };
  App.go = function (route) { if (location.hash === '#/' + route) { App.parseRoute(); App.render(); } else location.hash = '#/' + route; };

  App.renderTape = function () {
    const el = document.getElementById('tape');
    const r = App.res;
    const items = r && !r.empty ? r.positions.filter(p => !p.missingPrice).sort((a, b) => b.weight - a.weight) : [];
    if (!items.length) { el.style.display = 'none'; el._sig = null; return; }
    el.style.display = '';
    const sig = items.map(p => p.id + ':' + p.price + ':' + (p.dayFresh ? p.dayPct.toFixed(5) : '')).join('|') + App.state.settings.locale + ((App.live && App.live.tapeLabel()) || '');
    if (el._sig === sig) return;
    el._sig = sig;
    const one = items.map(p => `<a href="#/position/${p.id}"><b>${esc(App.instLabel(p.inst))}</b><span>${F.price(p.price, p.currency)}</span>${p.dayFresh && isFinite(p.dayPct) ? `<span class="${F.cls(p.dayPct)}">${F.arrow(p.dayPct)} ${F.pct(p.dayPct)}</span>` : '<span class="muted">·</span>'}</a>`).join('');
    const lbl = (App.live && App.live.tapeLabel()) || `<span class="lbl"><span class="pulse"></span>LAST · ${F.date(PT.iso(r.lastPriceDay), 'dm')}</span>`;
    const reps = Math.max(1, Math.ceil(2200 / Math.max(1, items.length * 180)));
    const copy = (lbl + one).repeat(reps);
    el.innerHTML = `<div class="tape-track" style="--tape-dur:${Math.max(40, items.length * reps * 5)}s">${copy}${copy}</div>`;
  };
  function renderStatus() {
    const el = document.getElementById('price-status');
    const r = App.res;
    if (!r || r.empty) { el.style.display = 'none'; return; }
    if (App.live && App.live.pill(el)) return;
    el.style.display = '';
    const missing = r.positions.some(p => p.missingPrice);
    const age = r.asOf - r.lastPriceDay;
    const stale = age > 4;
    el.className = 'status' + (missing ? ' bad' : stale ? ' stale' : '');
    el.innerHTML = `<i></i><span class="t">Prices</span><span>${F.date(PT.iso(r.lastPriceDay), 'dm')}</span>`;
    el.title = missing ? 'Some positions have no price — click to update' : stale ? `Latest stored prices are ${age} days old — click to update` : 'Prices up to date';
  }

  App.render = function () {
    const view = App.views[App.ui.route] || App.views.dashboard;
    App.destroyCharts();
    document.querySelectorAll('#nav a, #tabbar a').forEach(a => {
      const r = a.getAttribute('data-route');
      a.classList.toggle('active', r === App.ui.route || (App.ui.route === 'position' && r === 'positions'));
    });
    let out;
    try { out = view(App.ui.param); }
    catch (e) { console.error(e); out = { title: 'Something went wrong', html: `<div class="card solo"><p>${esc(e.message)}</p><pre class="code small">${esc(e.stack)}</pre></div>` }; }
    const r = App.res;
    const pg = PAGES[App.ui.route] || PAGES.dashboard;
    document.getElementById('page-idx').textContent = `${pg[0]} / ${pg[1]}`;
    document.getElementById('page-title').textContent = out.title;
    const brokers = r && !r.empty ? [...new Set(r.positions.map(p => p.broker).filter(Boolean))] : [];
    document.getElementById('page-sub').innerHTML = out.sub != null ? out.sub :
      (r && !r.empty ? `Valuation ${F.date(r.asOfISO)} · Base EUR · ${r.positions.length} positions${brokers.length ? ' · ' + brokers.map(esc).join(' + ') : ''}` : 'No data yet');
    document.getElementById('page-actions').innerHTML = out.actions != null ? out.actions : App.defaultActions();
    document.getElementById('banner').innerHTML = out.noBanner ? '' : App.bannerHTML();
    document.title = `${out.title} · Conviction`;
    const v = document.getElementById('view');
    v.innerHTML = `<div class="fade-in">${out.html}</div>`;
    v.querySelectorAll('.grid.g-12, .tiles').forEach(g => Array.from(g.children).forEach((c, i) => c.style.setProperty('--i', i)));
    if (out.mount) { try { out.mount(v); } catch (e) { console.error(e); App.toast('Render error: ' + e.message, true); } }
    App.countUp(v);
    App.odoGo(v);
    bindCommon(document);
    App.renderTape();
    renderStatus();
    navOverflow();
    const m1 = r && !r.empty ? App.metrics('1D') : null;
    document.body.setAttribute('data-mood', m1 && isFinite(m1.pnl) && Math.abs(m1.pnl) > 0.5 ? (m1.pnl > 0 ? 'up' : 'down') : 'flat');
  };
  App.renderStatus = renderStatus;
  // the top navigation scrolls sideways when it does not fit; fade its edge so a cut-off link looks intended
  function navOverflow() { const n = document.getElementById('nav'); if (n) n.classList.toggle('more', n.scrollWidth > n.clientWidth + 1); }
  App.defaultActions = () => `<button class="btn" data-act="prices">${App.icon('refresh')}Update prices</button><button class="btn" data-act="add-cash">${App.icon('plus')}Cash</button>`;
  App.bannerHTML = function () {
    let h = '';
    if (App.state.meta && App.state.meta.demo) {
      h += `<div class="banner demo"><div class="ico">${App.icon('spark')}</div><div class="grow"><b>Demo portfolio.</b> <span class="text-2">Synthetic prices and trades — not market data. Explore freely, then clear it and import your DEGIRO/IBKR exports.</span></div><button class="btn sm" data-act="clear-demo">Clear demo</button><button class="btn sm primary" data-act="goto-import">Import my data</button></div>`;
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
      case 'palette': return App.palette();
      case 'clear-demo': return App.confirm('Clear demo data?', 'All demo positions, prices and benchmark series are removed. Anything you added yourself stays.', 'Clear demo data', () => { App.commit(s => PT.stripDemo(s)); App.toast('Demo data removed.'); });
      default: if (App.actions[act]) return App.actions[act](el);
    }
  };
  App.actions = {};
  App.setTheme = function (t) { App.state.settings.theme = t; App.save(); syncShellControls(); App.render(); };
  App.setLocale = function (l) { App.state.settings.locale = l; App.save(); syncShellControls(); App.render(); };

  /* ---------------------------------------------------- command palette */
  App.palette = function () {
    if (document.querySelector('.pal-back')) return;
    const r = App.res, s = App.state;
    const open = r && !r.empty ? r.positions : [];
    const openIds = new Set(open.map(p => p.id));
    const items = [
      ...NAV.concat([['settings', 'Settings']]).map(([k, l]) => ({ g: 'Go to', t: l, d: (PAGES[k] || [])[1] || '', run: () => App.go(k) })),
      ...open.map(p => ({ g: 'Positions', t: App.instLabel(p.inst), d: p.inst.type === 'option' ? p.inst.ticker : p.inst.name, x: F.eur(p.value, { dec: 0 }), run: () => App.go('position/' + p.id) })),
      ...s.instruments.filter(i => !openIds.has(i.id)).map(i => ({ g: 'Instruments', t: App.instLabel(i), d: (i.name || '') + ' · closed', run: () => App.go('position/' + i.id) })),
      { g: 'Actions', t: 'Add transaction', d: 'Buy, sell, split, broker transfer', run: () => App.tradeForm() },
      { g: 'Actions', t: 'Add cash movement', d: 'Deposit, withdrawal, dividend, interest, fee', run: () => App.cashForm() },
      { g: 'Actions', t: 'Update prices', d: 'Manual price table, JSON paste, history', run: () => { App.ui.dataTab = 'prices'; App.go('data'); } },
      { g: 'Actions', t: 'Import CSV', d: 'DEGIRO · IBKR · generic', run: () => { App.ui.dataTab = 'import'; App.go('data'); } },
      { g: 'Actions', t: 'Toggle theme', d: s.settings.theme === 'light' ? 'Switch to dark' : 'Switch to light', run: () => App.setTheme(s.settings.theme === 'light' ? 'dark' : 'light') },
      { g: 'Actions', t: 'Number format', d: s.settings.locale === 'en' ? 'Switch to German 1.234,56' : 'Switch to English 1,234.56', run: () => App.setLocale(s.settings.locale === 'en' ? 'de' : 'en') },
      { g: 'Actions', t: 'Colour-blind palette', d: s.settings.cb ? 'Turn off (green/red)' : 'Turn on (blue/orange)', run: () => { s.settings.cb = !s.settings.cb; App.save(); syncShellControls(); App.render(); } },
      { g: 'Actions', t: 'Export JSON backup', d: 'Download the full dataset', run: () => App.exportBackup() },
      { g: 'Actions', t: 'Run calculation checks', d: 'Hand-calculated TWR, XIRR, FIFO cases', run: () => App.go('checks') }
    ];
    const back = document.createElement('div');
    back.className = 'pal-back';
    back.innerHTML = `<div class="pal" role="dialog" aria-modal="true" aria-label="Command palette"><div class="pal-in">${App.icon('search', 2)}<input type="text" placeholder="Jump to a position, view or action…" aria-label="Search"><kbd>esc</kbd></div><div class="pal-list" role="listbox"></div><div class="pal-foot"><span>↑↓ navigate</span><span>↵ open</span><span>esc close</span></div></div>`;
    document.getElementById('palette-root').appendChild(back);
    const input = back.querySelector('input'), list = back.querySelector('.pal-list');
    let sel = 0, shown = [];
    const close = () => back.remove();
    const score = (it, q, raw) => {
      const t = it.t.toLowerCase();
      if (!raw) return 0;
      if (t === raw) return 300;
      if (t.startsWith(raw)) return 200;
      if (q.every(w => t.includes(w))) return 100;
      return 10;
    };
    const draw = () => {
      const raw = input.value.trim().toLowerCase();
      const q = raw.split(/\s+/).filter(Boolean);
      const hits = items.map((it, i) => ({ it, i, s: score(it, q, raw) })).filter(x => { const h = (x.it.t + ' ' + x.it.d + ' ' + x.it.g).toLowerCase(); return q.every(w => h.includes(w)); });
      // groups ordered by their best match, items by score then original order
      const best = {};
      hits.forEach(x => { best[x.it.g] = Math.max(best[x.it.g] || 0, x.s); });
      const gOrder = {}; items.forEach((it, i) => { if (gOrder[it.g] == null) gOrder[it.g] = i; });
      hits.sort((a, b) => (best[b.it.g] - best[a.it.g]) || (gOrder[a.it.g] - gOrder[b.it.g]) || (b.s - a.s) || (a.i - b.i));
      shown = hits.slice(0, 60).map(x => x.it);
      sel = Math.min(sel, Math.max(0, shown.length - 1));
      let g = null, html = '';
      shown.forEach((it, i) => {
        if (it.g !== g) { g = it.g; html += `<div class="pal-grp">${esc(g)}</div>`; }
        html += `<div class="pal-item ${i === sel ? 'on' : ''}" data-i="${i}" role="option" aria-selected="${i === sel}"><span class="t">${esc(it.t)}</span><span class="d">${esc(it.d)}</span>${it.x ? `<span class="x">${esc(it.x)}</span>` : ''}</div>`;
      });
      list.innerHTML = html || '<div class="pal-empty">Nothing found.</div>';
      const on = list.querySelector('.pal-item.on'); if (on) on.scrollIntoView({ block: 'nearest' });
    };
    const run = i => { const it = shown[i]; if (!it) return; close(); it.run(); };
    input.addEventListener('input', () => { sel = 0; draw(); });
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { sel = Math.min(shown.length - 1, sel + 1); draw(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); draw(); e.preventDefault(); }
      else if (e.key === 'Enter') { run(sel); e.preventDefault(); }
      else if (e.key === 'Escape') { close(); e.preventDefault(); }
    });
    list.addEventListener('mousemove', e => { const it = e.target.closest('.pal-item'); if (it && +it.dataset.i !== sel) { sel = +it.dataset.i; list.querySelectorAll('.pal-item').forEach(x => x.classList.toggle('on', +x.dataset.i === sel)); } });
    list.addEventListener('click', e => { const it = e.target.closest('.pal-item'); if (it) run(+it.dataset.i); });
    back.addEventListener('mousedown', e => { if (e.target === back) close(); });
    draw();
    setTimeout(() => input.focus(), 10);
  };

  /* ------------------------------------------------------------- boot */
  App.boot = function () {
    let s = App.load();
    if (!s) { s = PT.buildDemo(); App.state = migrate(s); App.save(); }
    else App.state = s;
    renderShell();
    initTooltips();
    document.getElementById('theme-seg').addEventListener('click', e => { const b = e.target.closest('[data-theme-set]'); if (b) App.setTheme(b.getAttribute('data-theme-set')); });
    document.getElementById('loc-seg').addEventListener('click', e => { const b = e.target.closest('[data-loc]'); if (b) App.setLocale(b.getAttribute('data-loc')); });
    window.addEventListener('hashchange', () => { App.parseRoute(); App.render(); window.scrollTo(0, 0); });
    document.addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); App.palette(); return; }
      if (e.key === 'Escape') { App.closeModal(); const p = document.querySelector('.pal-back'); if (p) p.remove(); return; }
      if (e.key === '/' && !/INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || '') && !document.querySelector('.modal-back')) { e.preventDefault(); App.palette(); }
    });
    // cursor spotlight on panels
    let raf = 0, lastEv = null;
    document.addEventListener('pointermove', e => {
      lastEv = e;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        const c = lastEv.target && lastEv.target.closest ? lastEv.target.closest('.card') : null;
        if (!c) return;
        const r = c.getBoundingClientRect();
        c.style.setProperty('--mx', (lastEv.clientX - r.left) + 'px');
        c.style.setProperty('--my', (lastEv.clientY - r.top) + 'px');
      });
    }, { passive: true });
    window.addEventListener('resize', navOverflow, { passive: true });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { App.charts.forEach(c => { try { c.update('none'); } catch (e) { /* noop */ } }); });
    App.recompute();
    App.parseRoute();
    App.render();
    if (App.live) App.live.boot();
  };
})();
