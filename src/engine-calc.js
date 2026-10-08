/* =====================================================================
 * Portfolio engine — positions (FIFO), cash, daily valuation, TWR/XIRR,
 * risk, attribution. Pure functions; see engine-core.js for conventions.
 * ===================================================================== */
(function (root) {
  'use strict';
  const PT = root.PT;
  const { dn, iso, isWeekend, EPS } = PT;

  PT.DEFAULT_SETTINGS = {
    locale: 'de', theme: 'dark', cb: false,
    rf: 0.0219,            // €STR ≈ 2.19 % (ECB, Aug 2026) — editable
    concThreshold: 0.15,
    basis: 'auto',          // 'auto' | 'portfolio' | 'securities'
    priceGap: 'locf',       // 'locf' | 'interp'
    asOf: null,             // null = today
    benchmark: 'b_ndx',
    showCashInAlloc: false
  };

  // A transfer-out leaves the lots in place, so it can sort first: a same-day transfer-in then finds its match.
  const TYPE_ORDER = { split: 0, transfer_out: 1, transfer_in: 2, buy: 3, sell: 4 };
  const TRADE_TYPES = ['buy', 'sell', 'split', 'transfer_in', 'transfer_out'];
  const CASH_TYPES = ['deposit', 'withdrawal', 'dividend', 'tax', 'interest', 'fee', 'fxadj'];
  PT.TRADE_TYPES = TRADE_TYPES; PT.CASH_TYPES = CASH_TYPES;

  PT.emptyState = function () {
    return { version: 1, instruments: [], transactions: [], cash: [], prices: {}, fx: {}, benchmarks: PT.defaultBenchmarks(), settings: Object.assign({}, PT.DEFAULT_SETTINGS), meta: {} };
  };
  PT.defaultBenchmarks = function () {
    return [
      { id: 'b_msci', name: 'MSCI World', currency: 'EUR', series: [] },
      { id: 'b_ndx', name: 'Nasdaq-100', currency: 'USD', series: [] },
      { id: 'b_sox', name: 'PHLX Semiconductor (SOX)', currency: 'USD', series: [] }
    ];
  };

  /* =================================================================
   * compute(state) → full analytics result
   * ================================================================= */
  PT.compute = function (state, opts) {
    opts = opts || {};
    const S = Object.assign({}, PT.DEFAULT_SETTINGS, state.settings || {});
    const asOfISO = opts.asOf || S.asOf || PT.todayISO();
    const asOf = dn(asOfISO);
    const gap = S.priceGap === 'interp' ? 'interp' : 'locf';
    const instById = {};
    (state.instruments || []).forEach(i => { instById[i.id] = i; });
    const warnings = [];
    const cashRecs = (state.cash || []).filter(c => c && c.date && dn(c.date) <= asOf);
    const basis = S.basis === 'auto' ? (cashRecs.some(c => c.type === 'deposit') ? 'portfolio' : 'securities') : S.basis;

    /* ---------- FX series (stored table + every rate seen on a transaction) */
    const fxObs = {};
    const addFx = (c, d, r, stored) => { if (!c || c === 'EUR' || !(r > 0)) return; (fxObs[c] = fxObs[c] || []).push([d, +r, stored ? 1 : 0]); };
    Object.keys(state.fx || {}).forEach(c => (state.fx[c] || []).forEach(o => addFx(c, dn(o[0]), o[1], true)));
    (state.transactions || []).forEach(t => { if (t.fx > 0 && t.currency && t.currency !== 'EUR') addFx(t.currency, dn(t.date), t.fx); });
    (state.cash || []).forEach(c => { if (c.fx > 0 && c.currency !== 'EUR') addFx(c.currency, dn(c.date), c.fx); });
    const fxSeries = {};
    // like prices, a stored rate (yours or the ECB's) wins over one derived from a trade on the same day
    Object.keys(fxObs).forEach(c => { fxSeries[c] = PT.makeSeries(fxObs[c].sort((a, b) => a[0] - b[0] || a[2] - b[2]), gap); });
    const missingFx = new Set();
    const fxAt = (c, d) => {
      if (!c || c === 'EUR') return 1;
      const s = fxSeries[c];
      if (!s || !s.n) { missingFx.add(c); return NaN; }
      return s.at(d);
    };

    /* ---------- resolve transactions */
    const skippedTx = [];
    const txs = [];
    (state.transactions || []).forEach((t, i) => {
      const inst = instById[t.instId];
      if (!inst || !t.date) return;
      const d = dn(t.date);
      if (d > asOf) return;
      const cur = t.currency || inst.currency || 'EUR';
      const fx = cur === 'EUR' ? 1 : (t.fx > 0 ? +t.fx : fxAt(cur, d));
      if (t.type !== 'split' && !(fx > 0)) { skippedTx.push(t); return; }
      txs.push(Object.assign({}, t, {
        d, cur, fxEff: fx, mult: +(inst.multiplier || 1), qty: Math.abs(+t.qty || 0), price: +t.price || 0, fee: Math.abs(+t.fee || 0),
        ord: TYPE_ORDER[t.type] == null ? 9 : TYPE_ORDER[t.type], seq: t.seq == null ? i : t.seq
      }));
    });
    if (skippedTx.length) warnings.push({ level: 'error', code: 'fx', text: `${skippedTx.length} transaction(s) ignored — no FX rate for ${[...new Set(skippedTx.map(t => t.currency))].join(', ')}. Add one under Data → FX rates.` });
    txs.sort((a, b) => a.d - b.d || a.ord - b.ord || a.seq - b.seq);

    /* ---------- price series per instrument (stored + transaction prices) */
    const priceObs = {};
    Object.keys(state.prices || {}).forEach(id => { priceObs[id] = (state.prices[id] || []).map(o => [dn(o[0]), +o[1]]); });
    txs.forEach(t => {
      const inst = instById[t.instId];
      if (!(t.type === 'buy' || t.type === 'sell' || t.type === 'transfer_in' || t.type === 'transfer_out') || !(t.price > 0) || t.synthetic) return;
      const ic = inst.currency || t.cur;
      let p = t.price;
      if (t.cur !== ic) {
        // a trade on another listing of the same security (USD on NASDAQ, EUR on Tradegate): translate through EUR
        const fi = fxAt(ic, t.d);
        if (!(fi > 0) || !(t.fxEff > 0)) return;
        p = t.price / t.fxEff * fi;
      }
      (priceObs[t.instId] = priceObs[t.instId] || []).push([t.d, p, 'tx']);
    });
    // stored observations must win over transaction prices on the same day
    const priceSeries = {};
    Object.keys(priceObs).forEach(id => {
      const arr = priceObs[id].slice().sort((a, b) => a[0] - b[0] || (a[2] === 'tx' ? -1 : 0) - (b[2] === 'tx' ? -1 : 0));
      priceSeries[id] = PT.makeSeries(arr, gap);
    });
    const storedPriceSeries = {};
    Object.keys(state.prices || {}).forEach(id => { storedPriceSeries[id] = PT.makeSeries((state.prices[id] || []).map(o => [dn(o[0]), +o[1]]), 'locf'); });

    /* ---------- per-instrument FIFO pass */
    const byInst = {};
    txs.forEach(t => { (byInst[t.instId] = byInst[t.instId] || []).push(t); });
    const realized = [];       // closed lot slices
    const trips = [];          // completed round trips (flat → flat)
    const qtyEvents = [];      // [day, instId, qtyAfter]
    const tradeCash = [];      // [day, eurAmount]  (non-external cash)
    const inKind = [];         // [day, eurValue]  securities deposited without a matching transfer-out (external flow)
    const instState = {};
    let tradeFeesTotal = 0;

    Object.keys(byInst).forEach(id => {
      const inst = instById[id];
      const list = byInst[id];
      const st = { lots: [], trip: null, pendingOut: [], broker: null, realized: [], trips: [], fees: 0, expired: false, firstTx: list[0].d, splitFactor: 1 };
      instState[id] = st;
      const optExp = inst.type === 'option' && inst.expiry ? dn(inst.expiry) : null;
      const qNow = () => st.lots.reduce((s, l) => s + l.q, 0);

      const closeAndOpen = (t, sign /* +1 buy, -1 sell */, opts2) => {
        const mult = t.mult;
        let rem = t.qty;
        const unitFee = t.qty > 0 ? t.fee / t.qty : 0;
        const closeUnit = t.price * mult / t.fxEff;
        const q0 = qNow();
        while (rem > EPS && st.lots.length && Math.sign(st.lots[0].q) === -sign) {
          const lot = st.lots[0];
          const m = Math.min(rem, Math.abs(lot.q));
          const isLong = lot.q > 0;
          const gross = isLong ? m * (closeUnit - lot.uc) : m * (lot.uc - closeUnit);
          let pe;
          if (lot.cur === t.cur) pe = isLong ? m * mult * (t.price - lot.p) / lot.fx : m * mult * (lot.p - t.price) / lot.fx;
          else pe = gross; // cross-listed: currency effect not separable
          const fees = m * lot.uf + m * unitFee;
          const r = {
            instId: id, d: t.d, openD: lot.d, qty: m, side: isLong ? 'long' : 'short',
            openUnit: lot.uc, closeUnit, cost: m * lot.uc, proceeds: m * closeUnit,
            gross, pe, fe: gross - pe, fees, pnl: gross - fees, days: t.d - lot.d, synthetic: !!t.synthetic, txId: t.id
          };
          realized.push(r); st.realized.push(r);
          if (st.trip) { st.trip.pnl += r.pnl; st.trip.gross += gross; st.trip.fees += fees; st.trip.cost += m * lot.uc + m * lot.uf; st.trip.units += m; st.trip.wdays += m * (t.d - lot.d); st.trip.pe += pe; st.trip.fe += r.fe; }
          lot.q += isLong ? -m : m;
          rem -= m;
          if (Math.abs(lot.q) < EPS) st.lots.shift();
        }
        if (rem > EPS) {
          st.lots.push({ q: sign * rem, d: t.d, p: t.price, cur: t.cur, fx: t.fxEff, uc: t.price * mult / t.fxEff, uf: unitFee, mult, txId: t.id, inKind: !!(opts2 && opts2.inKind) });
        }
        const q1 = qNow();
        // round-trip bookkeeping
        if (st.trip && (Math.abs(q1) < EPS || Math.sign(q1) !== Math.sign(q0))) {
          st.trip.end = t.d; st.trip.closed = true;
          trips.push(st.trip); st.trips.push(st.trip); st.trip = null;
        }
        if (!st.trip && Math.abs(q1) > EPS) {
          st.trip = { instId: id, start: t.d, end: null, side: q1 > 0 ? 'long' : 'short', pnl: 0, gross: 0, fees: 0, cost: 0, units: 0, wdays: 0, pe: 0, fe: 0, closed: false, expired: false };
          // the opening fee belongs to the trip (it is part of lot.uf and flows in when closed)
        }
        qtyEvents.push([t.d, id, q1]);
      };

      const expire = () => {
        const q = qNow();
        st.expired = true;
        if (Math.abs(q) < EPS) return;
        const fx = fxAt(st.lots[0].cur, optExp) || st.lots[0].fx;
        const syn = { id: 'exp_' + id, instId: id, d: optExp, date: iso(optExp), type: q > 0 ? 'sell' : 'buy', qty: Math.abs(q), price: 0, fee: 0, fxEff: fx, cur: st.lots[0].cur, mult: +(inst.multiplier || 100), synthetic: true };
        const tripRef = st.trip;
        closeAndOpen(syn, q > 0 ? -1 : 1);
        if (tripRef) tripRef.expired = true;
      };

      for (const t of list) {
        if (optExp !== null && !st.expired && t.d > optExp && optExp <= asOf) expire();
        if (t.type === 'buy' || t.type === 'sell') {
          const sign = t.type === 'buy' ? 1 : -1;
          closeAndOpen(t, sign);
          const gross = t.qty * t.price * t.mult / t.fxEff;
          tradeCash.push([t.d, sign === 1 ? -gross - t.fee : gross - t.fee]);
          tradeFeesTotal += t.fee; st.fees += t.fee;
          if (t.broker) st.broker = t.broker;
        } else if (t.type === 'split') {
          const r = +t.ratio || (t.ratioNew && t.ratioOld ? t.ratioNew / t.ratioOld : 1);
          if (r > 0 && r !== 1) {
            st.lots.forEach(l => { l.q *= r; l.p /= r; l.uc /= r; l.uf /= r; });
            st.splitFactor *= r;
            qtyEvents.push([t.d, id, qNow()]);
          }
        } else if (t.type === 'transfer_out') {
          st.pendingOut.push({ d: t.d, q: t.qty });
          if (t.fee) { tradeCash.push([t.d, -t.fee]); tradeFeesTotal += t.fee; st.fees += t.fee; }
        } else if (t.type === 'transfer_in') {
          let need = t.qty;
          for (const po of st.pendingOut) {
            if (need <= EPS) break;
            if (po.q <= EPS || t.d - po.d > 120 || po.d > t.d) continue;
            const m = Math.min(need, po.q); po.q -= m; need -= m;
          }
          if (t.fee) { tradeCash.push([t.d, -t.fee]); tradeFeesTotal += t.fee; st.fees += t.fee; }
          if (need > EPS) {
            // Securities arriving without a recorded transfer-out: an external in-kind contribution.
            const part = Object.assign({}, t, { qty: need, fee: 0 });
            closeAndOpen(part, 1, { inKind: true });
            const ps = priceSeries[id];
            const pm = ps && ps.n ? ps.at(t.d) : t.price;
            inKind.push([t.d, need * t.mult * (pm > 0 ? pm : t.price) / t.fxEff]);
          }
          if (t.broker) st.broker = t.broker;
        }
      }
      if (optExp !== null && !st.expired && optExp <= asOf) expire();
      st.qty = qNow();
    });

    /* ---------- cash records → EUR */
    const cashEUR = [];
    const att = { dividends: 0, taxes: 0, interest: 0, fees: 0, fxadj: 0, deposits: 0, withdrawals: 0 };
    const divByInst = {};
    let cashSkipped = 0;
    cashRecs.forEach(c => {
      const d = dn(c.date);
      const fx = c.currency && c.currency !== 'EUR' ? (c.fx > 0 ? +c.fx : fxAt(c.currency, d)) : 1;
      if (!(fx > 0)) { cashSkipped++; return; }
      const amt = (+c.amount || 0) / fx;
      const wht = Math.abs(+c.wht || 0) / fx;
      let ext = 0, nonext = 0;
      switch (c.type) {
        case 'deposit': ext = Math.abs(amt); att.deposits += Math.abs(amt); break;
        case 'withdrawal': ext = -Math.abs(amt); att.withdrawals += Math.abs(amt); break;
        case 'dividend':
          nonext = amt - wht; att.dividends += amt; att.taxes -= wht;
          if (c.instId) { const o = divByInst[c.instId] = divByInst[c.instId] || { gross: 0, tax: 0 }; o.gross += amt; o.tax += wht; }
          break;
        case 'tax':
          nonext = amt; att.taxes += amt;
          if (c.instId) { const o = divByInst[c.instId] = divByInst[c.instId] || { gross: 0, tax: 0 }; o.tax -= amt; }
          break;
        case 'interest': nonext = amt; att.interest += amt; break;
        case 'fee': nonext = amt; att.fees += amt; break;
        case 'fxadj': nonext = amt; att.fxadj += amt; break;
        default: break;
      }
      cashEUR.push({ d, ext, nonext, rec: c, eur: amt });
    });
    if (cashSkipped) warnings.push({ level: 'error', code: 'fx', text: `${cashSkipped} cash movement(s) ignored — missing FX rate.` });

    /* ---------- daily valuation loop */
    const allDays = [];
    txs.forEach(t => allDays.push(t.d));
    cashEUR.forEach(c => allDays.push(c.d));
    if (!allDays.length) {
      return { empty: true, asOf, asOfISO, basis, warnings, positions: [], realized: [], trips: [], days: [], settings: S, fxAt, priceSeries, instById, att: null, missingFx: [...missingFx] };
    }
    const start = Math.min.apply(null, allDays);
    const N = asOf - start + 1;
    const ext = new Float64Array(N), nonext = new Float64Array(N), kind = new Float64Array(N);
    tradeCash.forEach(([d, a]) => { nonext[d - start] += a; });
    cashEUR.forEach(c => { ext[c.d - start] += c.ext; nonext[c.d - start] += c.nonext; });
    inKind.forEach(([d, a]) => { kind[d - start] += a; });
    const qEvByDay = {};
    qtyEvents.forEach(([d, id, q]) => { (qEvByDay[d] = qEvByDay[d] || []).push([id, q]); });

    const days = new Array(N), V = new Float64Array(N), Vsec = new Float64Array(N), CASH = new Float64Array(N), F = new Float64Array(N), R = new Float64Array(N), IDX = new Float64Array(N), NETINV = new Float64Array(N);
    const qty = {};
    const missingPrice = new Set();
    let cash = 0, netInv = 0, prevV = 0, idx = 1, badDays = 0, minCash = 0, minCashDay = null;
    for (let k = 0; k < N; k++) {
      const d = start + k;
      days[k] = d;
      (qEvByDay[d] || []).forEach(([id, q]) => { if (Math.abs(q) < EPS) delete qty[id]; else qty[id] = q; });
      cash += ext[k] + nonext[k];
      let vs = 0;
      for (const id in qty) {
        const inst = instById[id];
        const ps = priceSeries[id];
        let p = ps && ps.n ? ps.at(d) : NaN;
        if (!(p >= 0)) { missingPrice.add(id); continue; }
        const x = fxAt(inst.currency || 'EUR', d);
        if (!(x > 0)) continue;
        vs += qty[id] * (+inst.multiplier || 1) * p / x;
      }
      Vsec[k] = vs; CASH[k] = cash;
      if (cash < minCash) { minCash = cash; minCashDay = d; }
      let v, f;
      if (basis === 'portfolio') { v = vs + cash; f = ext[k] + kind[k]; }
      else { v = vs; f = -nonext[k] + kind[k]; }
      V[k] = v; F[k] = f;
      netInv += f; NETINV[k] = netInv;
      const denom = prevV + Math.max(f, 0);
      let r = 0;
      if (denom > 1e-6) r = (v - prevV - f) / denom;
      else if (Math.abs(v) > 1e-6 || Math.abs(f) > 1e-6) badDays++;
      if (!isFinite(r) || r < -1) { r = Math.max(-1, isFinite(r) ? r : 0); }
      R[k] = r; idx *= (1 + r); IDX[k] = idx;
      prevV = v;
    }
    if (basis === 'portfolio' && minCash < -1) {
      warnings.push({ level: 'warn', code: 'cash', text: `Cash balance falls to ${minCash.toFixed(0)} € on ${iso(minCashDay)}. If you did not record all deposits, switch “Performance basis” to “Securities only” in Settings.` });
    }
    if (badDays > 3) warnings.push({ level: 'warn', code: 'twr', text: `${badDays} day(s) had a non-positive starting value and were excluded from TWR chaining.` });
    if (missingFx.size) warnings.push({ level: 'error', code: 'fx', text: `No FX history for ${[...missingFx].join(', ')}.` });

    // most recent day with any price/FX observation (for a meaningful “1D” when today has no prices yet)
    let lastPriceDay = start;
    Object.keys(priceSeries).forEach(id => { const ps = priceSeries[id]; if (ps.n) { const d = ps.dateAt(asOf); if (d != null && d <= asOf && d > lastPriceDay) lastPriceDay = d; } });
    /* ---------- open positions */
    const nav = V[N - 1];
    const positions = [];
    Object.keys(instState).forEach(id => {
      const st = instState[id];
      const inst = instById[id];
      const divs = divByInst[id] || { gross: 0, tax: 0 };
      const realizedPnl = st.realized.reduce((s, r) => s + r.pnl, 0);
      if (!st.lots.length || Math.abs(st.qty) < EPS) {
        st.summary = { realized: realizedPnl, dividends: divs.gross - divs.tax };
        return;
      }
      const ps = priceSeries[id];
      const P = ps && ps.n ? ps.at(asOf) : NaN;
      const pDate = ps && ps.n ? ps.dateAt(asOf) : null;
      const sps = storedPriceSeries[id];
      const hasStored = sps && sps.n && sps.first <= asOf;
      const cur = inst.currency || st.lots[0].cur;
      const X = fxAt(cur, asOf);
      const mult = +(inst.multiplier || 1);
      const q = st.qty;
      let costGross = 0, fees = 0, pe = 0, fe = 0, qp = 0, wAge = 0, absQ = 0;
      st.lots.forEach(l => {
        costGross += l.q * l.uc; fees += Math.abs(l.q) * l.uf; qp += l.q * l.p; absQ += Math.abs(l.q); wAge += Math.abs(l.q) * (asOf - l.d);
        if (P >= 0 && X > 0) {
          const lotGross = l.q * (mult * P / X - l.uc);
          const lpe = l.cur === cur ? l.q * mult * (P - l.p) / l.fx : lotGross;
          pe += lpe; fe += lotGross - lpe;
        }
      });
      const priced = P >= 0 && X > 0;
      // last price move (previous observation → latest), used by the ticker tape, movers and the map
      let dayPct = NaN, dayEUR = NaN, dayFresh = false, dayTo = null;
      if (ps && ps.n) {
        let k = -1;
        for (let j = ps.n - 1; j >= 0; j--) if (ps.xs[j] <= asOf) { k = j; break; }
        if (k >= 1 && ps.ys[k - 1] > 0) {
          const d1 = ps.xs[k], d0 = ps.xs[k - 1];
          const X1 = fxAt(cur, d1), X0 = fxAt(cur, d0);
          dayPct = ps.ys[k] / ps.ys[k - 1] - 1;
          if (X1 > 0 && X0 > 0) dayEUR = q * mult * (ps.ys[k] / X1 - ps.ys[k - 1] / X0);
          dayFresh = lastPriceDay - d1 <= 4 && d1 - d0 <= 5;
          dayTo = iso(d1);
        }
      }
      const value = priced ? q * mult * P / X : 0;
      const unreal = priced ? value - costGross - fees : NaN;
      const basisAbs = Math.abs(costGross) + fees;
      positions.push({
        id, inst, qty: q, side: q > 0 ? 'long' : 'short', price: P, priceDate: pDate != null ? iso(pDate) : null,
        priceSource: hasStored ? 'stored' : 'transaction', stale: pDate != null ? (asOf - pDate) > 7 : true,
        missingPrice: !priced, fx: X, currency: cur, mult,
        value, costGross, fees, cost: costGross + fees, unreal, unrealPct: basisAbs > EPS ? unreal / basisAbs : NaN,
        pe, fe, avgCostLocal: qp / q, avgCostEUR: (costGross + fees) / q,
        realized: realizedPnl, dividends: divs.gross - divs.tax, divGross: divs.gross, divTax: divs.tax,
        totalReturn: (priced ? unreal : 0) + realizedPnl + divs.gross - divs.tax,
        since: st.trip ? iso(st.trip.start) : iso(st.lots[0].d), holdDays: st.trip ? asOf - st.trip.start : asOf - st.lots[0].d,
        avgAge: absQ ? wAge / absQ : 0, lots: st.lots.map(l => Object.assign({}, l, { date: iso(l.d) })),
        weight: 0, broker: st.broker, zeroCost: Math.abs(costGross) < EPS, expiry: inst.expiry || null,
        dayPct, dayEUR, dayFresh, dayTo
      });
    });
    const grossLong = positions.reduce((s, p) => s + Math.max(0, p.value), 0);
    const weightBase = basis === 'portfolio' ? nav : positions.reduce((s, p) => s + p.value, 0);
    positions.forEach(p => { p.weight = weightBase > EPS ? p.value / weightBase : 0; });
    positions.sort((a, b) => b.value - a.value);

    /* ---------- closed round-trips */
    const closed = trips.map(t => Object.assign({}, t, {
      inst: instById[t.instId], startISO: iso(t.start), endISO: iso(t.end),
      holdDays: t.units > EPS ? t.wdays / t.units : t.end - t.start,
      ret: t.cost > EPS ? t.pnl / t.cost : NaN
    })).sort((a, b) => b.end - a.end);

    /* ---------- attribution (all-time, EUR) */
    const rz = realized.reduce((o, r) => { o.pe += r.pe; o.fe += r.fe; o.gross += r.gross; o.fees += r.fees; o.pnl += r.pnl; return o; }, { pe: 0, fe: 0, gross: 0, fees: 0, pnl: 0 });
    const ur = positions.reduce((o, p) => { o.pe += p.pe; o.fe += p.fe; o.pnl += isFinite(p.unreal) ? p.unreal : 0; o.fees += p.fees; return o; }, { pe: 0, fe: 0, pnl: 0, fees: 0 });
    const attribution = {
      pricePE: rz.pe + ur.pe, fxFE: rz.fe + ur.fe,
      realizedPE: rz.pe, realizedFE: rz.fe, unrealPE: ur.pe, unrealFE: ur.fe,
      tradeFees: -tradeFeesTotal, dividends: att.dividends, taxes: att.taxes, interest: att.interest, otherFees: att.fees, fxadj: att.fxadj
    };
    attribution.total = attribution.pricePE + attribution.fxFE + attribution.tradeFees + attribution.dividends + attribution.taxes + attribution.interest + attribution.otherFees + attribution.fxadj;
    attribution.pnl = V[N - 1] - NETINV[N - 1];
    attribution.residual = attribution.pnl - attribution.total;

    /* ---------- benchmarks aligned to days */
    const benchmarks = (state.benchmarks || []).map(b => {
      const s = PT.makeSeries((b.series || []).map(o => [dn(o[0]), +o[1]]), gap);
      const vals = new Float64Array(N);
      let has = false;
      for (let k = 0; k < N; k++) {
        const d = days[k];
        if (!s.n || d < s.first) { vals[k] = NaN; continue; }
        let v = s.at(d);
        if (b.currency && b.currency !== 'EUR') { const x = fxAt(b.currency, d); v = x > 0 ? v / x : NaN; }
        vals[k] = v; if (isFinite(v)) has = true;
      }
      return { id: b.id, name: b.name, currency: b.currency, vals, has, n: s.n, last: s.last != null ? iso(s.last) : null };
    });

    const realizedTotal = rz.pnl;
    const res = {
      empty: false, asOf, asOfISO, start, lastPriceDay, startISO: iso(start), N, days, V, Vsec, CASH, F, R, IDX, NETINV,
      basis, positions, realized, trips: closed, attribution, benchmarks, warnings, settings: S,
      nav, cash: CASH[N - 1], netInvested: NETINV[N - 1], grossLong,
      totals: {
        value: nav, securities: Vsec[N - 1], cash: CASH[N - 1], netInvested: NETINV[N - 1],
        pnl: V[N - 1] - NETINV[N - 1], realized: realizedTotal, unrealized: ur.pnl,
        dividendsNet: att.dividends + att.taxes, deposits: att.deposits, withdrawals: att.withdrawals,
        tradeFees: tradeFeesTotal, otherFees: -att.fees, interest: att.interest
      },
      instState, instById, priceSeries, fxSeries, fxAt, missingFx: [...missingFx], missingPrice: [...missingPrice], inKind
    };
    res.totals.simpleReturn = res.totals.netInvested > EPS ? res.totals.pnl / res.totals.netInvested : NaN;
    return res;
  };

  /* =================================================================
   * Period helpers & metrics
   * ================================================================= */
  /** Returns the base day (value at end of that day is the starting point). */
  PT.periodBase = function (key, asOf, start, lastPriceDay) {
    const d = new Date(asOf * PT.DAY);
    const y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate();
    const back = (mm) => { const t = new Date(Date.UTC(y, m - mm, 1)); const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate(); return Math.round(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), Math.min(day, last)) / PT.DAY); };
    let b;
    switch (key) {
      case '1D': { b = (lastPriceDay != null ? Math.min(lastPriceDay, asOf) : asOf) - 1; while (isWeekend(b)) b--; break; }
      case '1W': b = asOf - 7; break;
      case '1M': b = back(1); break;
      case '3M': b = back(3); break;
      case '6M': b = back(6); break;
      case 'YTD': b = Math.round(Date.UTC(y, 0, 1) / PT.DAY) - 1; break;
      case '1Y': b = back(12); break;
      case '3Y': b = back(36); break;
      default: b = start - 1;
    }
    return Math.max(b, start - 1);
  };

  PT.metrics = function (res, baseDay, endDay, opts) {
    opts = opts || {};
    if (res.empty) return null;
    const rf = opts.rf != null ? opts.rf : res.settings.rf;
    const start = res.start;
    endDay = Math.min(endDay == null ? res.asOf : endDay, res.asOf);
    const i0 = Math.max(0, baseDay - start + 1), i1 = endDay - start;
    if (i1 < i0) return null;
    const baseIdx = i0 > 0 ? res.IDX[i0 - 1] : 1;
    const baseV = i0 > 0 ? res.V[i0 - 1] : 0;
    const twr = res.IDX[i1] / baseIdx - 1;
    const days = i1 - i0 + 1;
    const ann = Math.pow(1 + twr, 365 / days) - 1;
    const rets = [];
    for (let i = i0; i <= i1; i++) if (!isWeekend(res.days[i])) rets.push(res.R[i]);
    const vol = PT.stdev(rets) * Math.sqrt(252);
    const rfd = Math.pow(1 + rf, 1 / 252) - 1;
    const down = rets.length ? Math.sqrt(rets.reduce((s, r) => s + Math.pow(Math.min(0, r - rfd), 2), 0) / rets.length) * Math.sqrt(252) : NaN;
    let peak = baseIdx, mdd = 0, peakDay = i0 - 1, troughDay = null, mddPeakDay = null;
    for (let i = i0; i <= i1; i++) {
      if (res.IDX[i] > peak) { peak = res.IDX[i]; peakDay = i; }
      const dd = res.IDX[i] / peak - 1;
      if (dd < mdd) { mdd = dd; troughDay = i; mddPeakDay = peakDay; }
    }
    // XIRR for the period
    const cfs = [];
    if (baseV > EPS) cfs.push({ d: start + i0 - 1, a: -baseV });
    let flows = 0;
    for (let i = i0; i <= i1; i++) if (Math.abs(res.F[i]) > 1e-9) { cfs.push({ d: start + i, a: -res.F[i] }); flows += res.F[i]; }
    cfs.push({ d: start + i1, a: res.V[i1] });
    const irr = PT.xirr(cfs);
    const pnl = res.V[i1] - baseV - flows;
    // benchmark-relative stats (weekly returns)
    const bench = {};
    res.benchmarks.forEach(b => {
      if (!b.has) return;
      const bv = b.vals;
      const b0 = i0 > 0 ? bv[i0 - 1] : bv[i0];
      const b1 = bv[i1];
      const out = { twr: isFinite(b0) && isFinite(b1) && b0 > 0 ? b1 / b0 - 1 : NaN };
      const pw = [], bw = [], bd = [];
      let lastI = i0 > 0 ? i0 - 1 : i0;
      for (let i = i0; i <= i1; i++) {
        if (!isWeekend(res.days[i]) && i > 0 && isFinite(bv[i]) && isFinite(bv[i - 1]) && bv[i - 1] > 0) bd.push(bv[i] / bv[i - 1] - 1);
        if (PT.dow(res.days[i]) === 5 || i === i1) {
          if (i > lastI && isFinite(bv[i]) && isFinite(bv[lastI]) && bv[lastI] > 0) {
            pw.push(res.IDX[i] / (lastI >= 0 ? res.IDX[lastI] : 1) - 1);
            bw.push(bv[i] / bv[lastI] - 1);
          }
          lastI = i;
        }
      }
      if (pw.length > 4) {
        const mp = PT.mean(pw), mb = PT.mean(bw);
        let cov = 0, vb = 0, vp = 0;
        for (let k = 0; k < pw.length; k++) { cov += (pw[k] - mp) * (bw[k] - mb); vb += (bw[k] - mb) ** 2; vp += (pw[k] - mp) ** 2; }
        out.beta = vb > 0 ? cov / vb : NaN;
        out.corr = vb > 0 && vp > 0 ? cov / Math.sqrt(vb * vp) : NaN;
      }
      out.vol = PT.stdev(bd) * Math.sqrt(252);
      let pk = isFinite(b0) ? b0 : -Infinity, m = 0;
      for (let i = i0; i <= i1; i++) { if (!isFinite(bv[i])) continue; if (bv[i] > pk) pk = bv[i]; const dd = bv[i] / pk - 1; if (dd < m) m = dd; }
      out.maxDD = m;
      out.ann = Math.pow(1 + out.twr, 365 / days) - 1;
      bench[b.id] = out;
    });
    return {
      i0, i1, baseDay, endDay, days, twr, ann, annualizedMeaningful: days >= 365, vol, downside: down,
      sharpe: (ann - rf) / vol, sortino: (ann - rf) / down, maxDD: mdd,
      maxDDPeak: mddPeakDay != null && mddPeakDay >= 0 ? iso(res.days[mddPeakDay]) : null, maxDDTrough: troughDay != null ? iso(res.days[troughDay]) : null,
      xirr: irr, pnl, baseV, endV: res.V[i1], flows, n: rets.length, active: rets.filter(x => Math.abs(x) > 1e-12).length, rf, bench
    };
  };

  PT.monthlyReturns = function (res) {
    if (res.empty) return [];
    const out = [];
    let prevIdx = 1, cur = null;
    for (let k = 0; k < res.N; k++) {
      const s = iso(res.days[k]);
      const ym = s.slice(0, 7);
      if (cur && ym !== cur.ym) { out.push(cur); prevIdx = cur.endIdx; cur = null; }
      if (!cur) cur = { ym, y: +ym.slice(0, 4), m: +ym.slice(5, 7), startIdx: prevIdx, endIdx: res.IDX[k], startDay: s };
      cur.endIdx = res.IDX[k]; cur.endDay = s;
    }
    if (cur) out.push(cur);
    out.forEach(o => { o.r = o.endIdx / o.startIdx - 1; const last = new Date(Date.UTC(o.y, o.m, 0)).toISOString().slice(0, 10); o.partial = o.endDay !== last || o.startDay.slice(8) !== '01'; });
    return out;
  };

  PT.rolling = function (res, windowDays) {
    const out = [];
    if (res.empty) return out;
    for (let k = windowDays; k < res.N; k++) out.push([res.days[k], res.IDX[k] / res.IDX[k - windowDays] - 1]);
    return out;
  };

  PT.drawdownSeries = function (res, i0, i1) {
    const out = [];
    if (res.empty) return out;
    i0 = i0 || 0; i1 = i1 == null ? res.N - 1 : i1;
    let peak = i0 > 0 ? res.IDX[i0 - 1] : 1;
    for (let k = i0; k <= i1; k++) { if (res.IDX[k] > peak) peak = res.IDX[k]; out.push([res.days[k], res.IDX[k] / peak - 1]); }
    return out;
  };

  PT.concentration = function (positions, threshold) {
    const longs = positions.filter(p => p.value > 0).sort((a, b) => b.weight - a.weight);
    const top3 = longs.slice(0, 3).reduce((s, p) => s + p.weight, 0);
    const tot = longs.reduce((s, p) => s + p.value, 0);
    const hhi = tot > 0 ? longs.reduce((s, p) => s + Math.pow(p.value / tot, 2), 0) : 0;
    return { top3, hhi, effectiveN: hhi > 0 ? 1 / hhi : 0, breaches: longs.filter(p => p.weight > threshold), largest: longs[0] || null };
  };

  PT.closedStats = function (trips) {
    const n = trips.length;
    if (!n) return { n: 0 };
    const wins = trips.filter(t => t.pnl > 0), losses = trips.filter(t => t.pnl <= 0);
    const sum = a => a.reduce((s, t) => s + t.pnl, 0);
    const sorted = trips.slice().sort((a, b) => b.pnl - a.pnl);
    return {
      n, wins: wins.length, losses: losses.length, winRate: wins.length / n,
      total: sum(trips), avgWin: wins.length ? sum(wins) / wins.length : 0, avgLoss: losses.length ? sum(losses) / losses.length : 0,
      profitFactor: losses.length && sum(losses) !== 0 ? sum(wins) / Math.abs(sum(losses)) : Infinity,
      avgHold: PT.mean(trips.map(t => t.holdDays)), best: sorted[0], worst: sorted[sorted.length - 1]
    };
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = PT;
})(typeof window !== 'undefined' ? window : globalThis);
