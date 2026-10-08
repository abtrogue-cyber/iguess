/* =====================================================================
 * Demo dataset — deterministic, synthetic prices (NOT market data).
 * 14 open positions, 5 closed round trips, ~2 years, 8 currencies,
 * a 2:1 split, long + short options, DEGIRO → IBKR transfer.
 * ===================================================================== */
(function (root) {
  'use strict';
  const PT = root.PT;
  const { dn, iso, isWeekend } = PT;

  const START = '2024-10-01', END = '2026-10-07';

  const SPECS = [
    // ticker, name, ccy, exchange, country, sector, tags, start, end, vol, beta(m, semi, energy)
    ['NVDA', 'NVIDIA Corp', 'USD', 'NASDAQ', 'United States', 'Semiconductors', ['AI Compute'], 121, 186, 0.48, [1.2, 1.0, 0]],
    ['AVGO', 'Broadcom Inc', 'USD', 'NASDAQ', 'United States', 'Semiconductors', ['AI Compute', 'CPO/Optics'], 168, 342, 0.42, [1.1, 0.9, 0]],
    ['ASML', 'ASML Holding NV', 'EUR', 'Euronext Amsterdam', 'Netherlands', 'Semicap equipment', ['Semicap'], 690, 836, 0.36, [0.9, 0.9, 0]],
    ['2330.TW', 'Taiwan Semiconductor Mfg', 'TWD', 'TWSE', 'Taiwan', 'Semiconductors', ['Foundry'], 985, 1420, 0.30, [0.8, 0.8, 0]],
    ['VST', 'Vistra Corp', 'USD', 'NYSE', 'United States', 'Utilities', ['AI Energy'], 126, 151, 0.52, [0.8, 0, 1.0]],
    ['000660.KS', 'SK Hynix Inc', 'KRW', 'KRX', 'South Korea', 'Semiconductors', ['HBM/Memory'], 186000, 515000, 0.50, [0.9, 1.1, 0]],
    ['NBIS', 'Nebius Group NV', 'USD', 'NASDAQ', 'Netherlands', 'Cloud infrastructure', ['AI Infra'], 21.5, 204, 0.80, [1.4, 0.4, 0]],
    ['6857.T', 'Advantest Corp', 'JPY', 'Tokyo', 'Japan', 'Semicap equipment', ['Semicap'], 4100, 7350, 0.46, [0.9, 1.0, 0]],
    ['ENR', 'Siemens Energy AG', 'EUR', 'XETRA', 'Germany', 'Industrials', ['AI Energy'], 34.5, 112, 0.44, [0.7, 0, 0.9]],
    ['COHR', 'Coherent Corp', 'USD', 'NYSE', 'United States', 'Optical components', ['CPO/Optics'], 90, 158, 0.56, [1.1, 0.8, 0]],
    ['SIVE', 'Sivers Semiconductors AB', 'SEK', 'Nasdaq Stockholm', 'Sweden', 'Semiconductors', ['CPO/Optics'], 7.4, 34.5, 0.85, [1.0, 0.7, 0]],
    ['PNG', 'Kraken Robotics Inc', 'CAD', 'TSX-V', 'Canada', 'Marine robotics', ['Robotics'], 2.05, 6.05, 0.62, [0.8, 0, 0]],
    ['AMD', 'Advanced Micro Devices', 'USD', 'NASDAQ', 'United States', 'Semiconductors', ['AI Compute'], 152, 236, 0.50, [1.2, 1.0, 0]],
    ['PLTR', 'Palantir Technologies', 'USD', 'NASDAQ', 'United States', 'Software', ['AI Software'], 39, 150, 0.62, [1.3, 0, 0]],
    ['FCEL', 'FuelCell Energy', 'USD', 'NASDAQ', 'United States', 'Clean energy', ['AI Energy'], 9.5, 2.9, 0.80, [1.0, 0, 0.8]]
  ];
  const FX = [['USD', 1.094, 1.163, 0.07], ['TWD', 35.3, 34.4, 0.06], ['KRW', 1462, 1556, 0.08], ['JPY', 162.5, 171.0, 0.09], ['SEK', 11.45, 10.95, 0.07], ['CAD', 1.488, 1.612, 0.06]];
  const SPLIT = { ticker: '6857.T', date: '2025-10-01', ratio: 2 };

  function bizDays(a, b) { const out = []; for (let d = dn(a); d <= dn(b); d++) if (!isWeekend(d)) out.push(d); return out; }

  function bridge(rng, n, start, end, vol, factors, betas) {
    const sd = vol / Math.sqrt(252);
    const c = [0];
    for (let k = 1; k < n; k++) {
      let r = 0;
      if (factors && betas) betas.forEach((b, j) => { r += b * factors[j][k]; });
      const idioSd = Math.sqrt(Math.max(sd * sd - (betas ? betas.reduce((s, b, j) => s + (b * 0.011) ** 2 * (j === 0 ? 1 : 0.6), 0) : 0), (sd * 0.45) ** 2));
      r += idioSd * rng.normal();
      c.push(c[k - 1] + r);
    }
    const target = Math.log(end / start);
    return c.map((x, k) => start * Math.exp(x + (target - c[n - 1]) * k / (n - 1)));
  }

  PT.buildDemo = function () {
    const rng = PT.rng(20241001);
    const days = bizDays(START, END);
    const n = days.length;
    const pos = {}; days.forEach((d, k) => { pos[d] = k; });
    const factors = [0, 1, 2].map(j => { const a = [0]; for (let k = 1; k < n; k++) a.push(rng.normal() * (j === 0 ? 0.011 : 0.0085)); return a; });
    const kAt = s => { let d = dn(s); while (pos[d] == null && d < days[n - 1]) d++; return pos[d] != null ? pos[d] : n - 1; };

    const state = PT.emptyState();
    state.meta = { demo: true, createdAt: PT.todayISO() };
    const insts = {};
    const series = {};
    SPECS.forEach(sp => {
      const [ticker, name, ccy, ex, country, sector, tags, s0, s1, vol, betas] = sp;
      const id = 'demo_' + ticker.replace(/\W/g, '');
      insts[ticker] = { id, ticker, name, isin: '', currency: ccy, exchange: ex, type: 'stock', multiplier: 1, country, sector, tags, aliases: [], demo: true };
      let path = bridge(rng, n, s0, s1, vol, factors, betas);
      if (ticker === SPLIT.ticker) { const ks = kAt(SPLIT.date); path = path.map((p, k) => k < ks ? p * SPLIT.ratio : p); }
      series[ticker] = path;
    });
    // hidden underlying for the QQQ put
    const qqq = bridge(rng, n, 488, 642, 0.21, factors, [1, 0, 0]);
    const fxs = {};
    FX.forEach(([c, a, b, v]) => { fxs[c] = bridge(rng, n, a, b, v); });
    const fxAt = (c, k) => c === 'EUR' ? 1 : fxs[c][k];
    const r2 = x => Math.round(x * 100) / 100;
    const rp = (x) => x >= 1000 ? Math.round(x) : x >= 100 ? Math.round(x * 10) / 10 : Math.round(x * 100) / 100;

    // Options (priced with Black–Scholes on the synthetic underlying)
    // strikes are set relative to the synthetic underlying on the trade date (OTM), so the demo stays plausible
    const round5 = x => Math.max(5, Math.round(x / 5) * 5);
    const optDefs = [
      { key: 'NVDA_C200', u: 'NVDA', exp: '2027-12-17', right: 'C', at: '2026-02-10', m: 1.15, sigma: 0.52, under: () => series.NVDA },
      { key: 'QQQ_P600', u: 'QQQ', exp: '2026-11-20', right: 'P', at: '2026-07-07', m: 0.92, sigma: 0.24, under: () => qqq },
      { key: 'NBIS_C60', u: 'NBIS', exp: '2025-12-19', right: 'C', at: '2025-07-08', m: 1.2, sigma: 0.85, under: () => series.NBIS },
      { key: 'NVDA_P150', u: 'NVDA', exp: '2026-03-20', right: 'P', at: '2025-11-04', m: 0.85, sigma: 0.5, under: () => series.NVDA }
    ];
    optDefs.forEach(o => { o.K = round5(o.under()[kAt(o.at)] * o.m); });
    optDefs.forEach(o => {
      const occ = PT.occSymbol(o.u, o.exp, o.right, o.K);
      const id = 'demo_opt_' + o.key;
      insts[o.key] = { id, ticker: occ, name: PT.optionLabel({ underlying: o.u, expiry: o.exp, strike: o.K, right: o.right }), isin: '', currency: 'USD', exchange: 'OPRA', type: 'option', multiplier: 100, expiry: o.exp, strike: o.K, right: o.right, underlying: o.u, country: 'United States', sector: 'Options', tags: o.u === 'QQQ' ? ['Hedge'] : (insts[o.u] ? insts[o.u].tags.slice() : ['Options']), aliases: [], demo: true };
      const und = o.under();
      const ex = dn(o.exp);
      series[o.key] = days.map((d, k) => d > ex ? NaN : Math.max(0.01, PT.blackScholes(und[k], o.K, (ex - d) / 365, o.sigma, 0.04, o.right)));
    });
    state.instruments = Object.values(insts);

    // ---- transactions
    let seq = 0;
    const T = [];
    const broker = s => s < '2026-05-20' ? 'DEGIRO' : 'IBKR';
    const feeFor = (ticker, qty, ccy, gross, s) => {
      const isOpt = !!optDefs.find(o => o.key === ticker);
      if (broker(s) === 'DEGIRO') return isOpt ? 0.75 * qty + 1 : (ccy === 'EUR' ? 3.9 : (['USD', 'CAD'].includes(ccy) ? 2 : 4.9)) + (ccy === 'EUR' ? 0 : gross * 0.0025);
      return isOpt ? 0.65 * qty * 1.0 : Math.max(0.9, gross * (ccy === 'USD' ? 0.0002 : 0.0008)) + (ccy === 'EUR' ? 0 : 1.7);
    };
    const trade = (s, ticker, type, qty) => {
      const k = kAt(s);
      const inst = insts[ticker];
      const d = iso(days[k]);
      const spread = type === 'buy' ? 1.0008 : 0.9992;
      const p = rp(series[ticker][k] * spread);
      const fx = r2(fxAt(inst.currency, k) * 10000) / 10000;
      const gross = qty * p * inst.multiplier / fx;
      T.push({ id: 'dt' + (++seq), date: d, instId: inst.id, type, qty, price: p, currency: inst.currency, fx: inst.currency === 'EUR' ? 1 : fx, fee: r2(feeFor(ticker, qty, inst.currency, gross, d)), broker: broker(d), src: 'demo', seq, note: '', demo: true });
    };
    const plan = [
      ['2024-10-02', 'NVDA', 'buy', 60], ['2024-10-02', 'AVGO', 'buy', 30], ['2024-10-02', 'ASML', 'buy', 7], ['2024-10-03', '2330.TW', 'buy', 150], ['2024-10-03', 'VST', 'buy', 30],
      ['2024-10-15', '000660.KS', 'buy', 22], ['2024-10-15', 'AMD', 'buy', 30],
      ['2024-11-05', 'NBIS', 'buy', 200], ['2024-11-05', '6857.T', 'buy', 100],
      ['2024-12-03', 'ENR', 'buy', 140],
      ['2025-01-14', 'COHR', 'buy', 40], ['2025-01-14', 'PLTR', 'buy', 60],
      ['2025-02-11', 'FCEL', 'buy', 350],
      ['2025-03-04', 'NVDA', 'buy', 20],
      ['2025-04-08', 'SIVE', 'buy', 3000],
      ['2025-05-06', 'PLTR', 'sell', 60],
      ['2025-06-10', 'AMD', 'sell', 15],
      ['2025-06-17', 'PNG', 'buy', 2500],
      ['2025-07-08', 'NBIS_C60', 'buy', 2],
      ['2025-08-05', 'NVDA', 'sell', 25],
      ['2025-09-16', 'FCEL', 'sell', 350],
      ['2025-10-14', 'NBIS_C60', 'sell', 2],
      ['2025-11-04', 'NVDA_P150', 'sell', 2],
      ['2025-12-02', '000660.KS', 'buy', 8], ['2025-12-02', 'COHR', 'buy', 20],
      ['2026-01-13', 'VST', 'buy', 20], ['2026-01-13', 'ENR', 'buy', 50],
      ['2026-02-10', 'NVDA_C200', 'buy', 2],
      ['2026-03-03', 'AMD', 'sell', 15],
      ['2026-03-17', 'SIVE', 'buy', 2000],
      ['2026-04-14', 'NBIS', 'sell', 80],
      ['2026-06-09', 'ASML', 'buy', 3],
      ['2026-07-07', 'QQQ_P600', 'sell', 2],
      ['2026-08-04', 'PNG', 'buy', 1500],
      ['2026-09-08', '2330.TW', 'sell', 50],
      ['2026-09-22', 'NBIS', 'buy', 30]
    ];
    plan.filter(p => p[0] < SPLIT.date).forEach(p => trade(...p));
    T.push({ id: 'dt' + (++seq), date: SPLIT.date, instId: insts[SPLIT.ticker].id, type: 'split', qty: 0, price: 0, ratio: SPLIT.ratio, currency: 'JPY', fx: null, fee: 0, broker: 'DEGIRO', src: 'demo', seq, note: '2:1 stock split', demo: true });
    plan.filter(p => p[0] >= SPLIT.date && p[0] < '2026-05-20').forEach(p => trade(...p));

    // DEGIRO → IBKR transfer of every open stock position on 2026-05-20
    const tmp = PT.emptyState(); tmp.instruments = state.instruments; tmp.transactions = T.slice(); tmp.benchmarks = [];
    const before = PT.compute(tmp, { asOf: '2026-05-19' });
    const kT = kAt('2026-05-20');
    before.positions.forEach(p => {
      const inst = p.inst;
      const skey = Object.keys(insts).find(k => insts[k].id === inst.id);
      const px = inst.type === 'option' ? r2(series[skey][kT]) : rp(series[skey][kT]);
      const fx = inst.currency === 'EUR' ? 1 : r2(fxAt(inst.currency, kT) * 10000) / 10000;
      T.push({ id: 'dt' + (++seq), date: '2026-05-20', instId: inst.id, type: 'transfer_out', qty: p.qty, price: px, currency: inst.currency, fx, fee: 0, broker: 'DEGIRO', src: 'demo', seq, note: 'Portfolio transfer to IBKR', demo: true });
      T.push({ id: 'dt' + (++seq), date: '2026-05-21', instId: inst.id, type: 'transfer_in', qty: p.qty, price: px, currency: inst.currency, fx, fee: 0, broker: 'IBKR', src: 'demo', seq, note: 'Portfolio transfer from DEGIRO', demo: true });
    });
    plan.filter(p => p[0] >= '2026-05-20').forEach(p => trade(...p));
    state.transactions = T;

    // ---- cash: deposits, dividends, interest, fees
    const C = [];
    let cid = 0;
    const cash = (date, type, amount, currency, extra) => C.push(Object.assign({ id: 'dc' + (++cid), date: PT.nextBizISO(date), type, amount: r2(amount), currency, fx: null, broker: broker(date), src: 'demo', note: '', demo: true }, extra || {}));
    cash('2024-10-01', 'deposit', 52000, 'EUR', { note: 'Initial funding' });
    for (let y = 2024, m = 11; y < 2026 || (y === 2026 && m <= 10); m++) {
      if (m > 12) { m = 1; y++; }
      if (y === 2026 && m > 10) break;
      const ds = `${y}-${String(m).padStart(2, '0')}-01`;
      if (ds > END) break;
      cash(ds, 'deposit', 1500, 'EUR', { note: 'Monthly savings plan' });
    }
    cash('2025-02-03', 'deposit', 8000, 'EUR', { note: 'Bonus' });
    cash('2026-08-17', 'withdrawal', -6000, 'EUR', { note: 'Withdrawal' });

    // Dividends: qty held on the pay date × DPS, withholding tax by country
    const divSpecs = [
      { t: 'AVGO', dps: 0.59, months: [3, 6, 9, 12], day: 30, wht: 0.15 },
      { t: 'ASML', dps: 1.60, months: [5, 11], day: 6, wht: 0.15 },
      { t: '2330.TW', dps: 4.5, months: [1, 4, 7, 10], day: 9, wht: 0.21 },
      { t: '000660.KS', dps: 375, months: [2, 5, 8, 11], day: 20, wht: 0.22 },
      { t: 'VST', dps: 0.22, months: [3, 6, 9, 12], day: 30, wht: 0.15 }
    ];
    const tmp2 = PT.emptyState(); tmp2.instruments = state.instruments; tmp2.transactions = T; tmp2.benchmarks = [];
    divSpecs.forEach(ds => {
      const inst = insts[ds.t];
      for (let y = 2024; y <= 2026; y++) ds.months.forEach(m => {
        const date = PT.nextBizISO(`${y}-${String(m).padStart(2, '0')}-${String(ds.day).padStart(2, '0')}`);
        if (date <= START || date > END) return;
        const r = PT.compute(tmp2, { asOf: date });
        const p = r.positions.find(x => x.id === inst.id);
        if (!p || p.qty <= 0) return;
        const gross = p.qty * ds.dps;
        const k = kAt(date);
        const fx = inst.currency === 'EUR' ? 1 : Math.round(fxAt(inst.currency, k) * 10000) / 10000;
        C.push({ id: 'dc' + (++cid), date, type: 'dividend', amount: r2(gross), wht: r2(gross * ds.wht), currency: inst.currency, fx, instId: inst.id, broker: broker(date), src: 'demo', note: `${ds.t} dividend ${ds.dps} ${inst.currency}/sh`, demo: true });
      });
    });
    // Monthly interest & market-data fees; DEGIRO annual exchange connection fees
    for (let d = dn('2024-11-03'); d <= dn(END); d += 30) {
      const s = iso(d);
      if (broker(s) === 'IBKR') {
        cash(s, 'fee', -1.57, 'EUR', { note: 'Market data subscription (incl. VAT)' });
        cash(s, 'interest', -(2 + Math.round(rng() * 4000) / 100), 'EUR', { note: 'Debit interest' });
      } else cash(s, 'interest', Math.round(rng() * 300) / 100, 'EUR', { note: 'Interest on cash' });
    }
    ['2025-01-06', '2026-01-05'].forEach(s => { cash(s, 'fee', -2.5, 'EUR', { note: 'Exchange connection fee (US)' }); cash(s, 'fee', -2.5, 'EUR', { note: 'Exchange connection fee (Asia)' }); });
    state.cash = C.sort((a, b) => a.date < b.date ? -1 : 1);

    // ---- stored price history (daily closes), FX, benchmarks
    const r4 = x => Math.round(x * 10000) / 10000;
    Object.keys(insts).forEach(t => {
      const inst = insts[t];
      const ser = series[t];
      state.prices[inst.id] = days.map((d, k) => [iso(d), ser[k]]).filter(o => isFinite(o[1])).map(o => [o[0], inst.type === 'option' ? r2(o[1]) : rp(o[1])]);
    });
    FX.forEach(([c]) => { state.fx[c] = days.map((d, k) => [iso(d), r4(fxs[c][k]), 'demo']); });
    const msci = bridge(rng, n, 100, 129.5, 0.13, factors, [0.65, 0.1, 0.05]);
    const ndx = bridge(rng, n, 20150, 26900, 0.21, factors, [1.05, 0.2, 0]);
    const sox = bridge(rng, n, 5150, 8350, 0.34, factors, [1.0, 1.0, 0]);
    const B = { b_msci: msci, b_ndx: ndx, b_sox: sox };
    state.benchmarks.forEach(b => { b.series = days.map((d, k) => [iso(d), r2(B[b.id][k]), 'demo']); b.demo = true; });
    state.settings = Object.assign({}, PT.DEFAULT_SETTINGS);
    return state;
  };

  /** Remove every demo record, keep user data. */
  PT.stripDemo = function (state) {
    const demoIds = new Set(state.instruments.filter(i => i.demo).map(i => i.id));
    state.instruments = state.instruments.filter(i => !i.demo);
    state.transactions = state.transactions.filter(t => !t.demo && !demoIds.has(t.instId));
    state.cash = state.cash.filter(c => !c.demo);
    demoIds.forEach(id => { delete state.prices[id]; });
    Object.keys(state.fx).forEach(c => { state.fx[c] = state.fx[c].filter(o => o[2] !== 'demo'); if (!state.fx[c].length) delete state.fx[c]; });
    state.benchmarks.forEach(b => { b.series = (b.series || []).filter(o => o[2] !== 'demo'); delete b.demo; });
    state.meta = Object.assign({}, state.meta, { demo: false });
    return state;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = PT;
})(typeof window !== 'undefined' ? window : globalThis);
