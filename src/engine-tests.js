/* =====================================================================
 * Hand-calculated verification cases. Run in the app (Checks view) and
 * in Node (tests/run.js). Each case builds a tiny portfolio, runs the
 * real engine and compares with numbers worked out by hand.
 * ===================================================================== */
(function (root) {
  'use strict';
  const PT = root.PT;

  function st(instruments, transactions, cash, prices, fx) {
    const s = PT.emptyState();
    s.benchmarks = [];
    s.instruments = instruments; s.transactions = transactions; s.cash = cash || []; s.prices = prices || {}; s.fx = fx || {};
    s.settings.basis = 'auto';
    return s;
  }
  const inst = (id, cur, extra) => Object.assign({ id, ticker: id, name: id, currency: cur, type: 'stock', multiplier: 1, tags: [] }, extra || {});
  let n = 0;
  const tx = (date, instId, type, qty, price, fee, fx, extra) => Object.assign({ id: 't' + (++n), date, instId, type, qty, price, fee: fee || 0, currency: (extra && extra.currency) || 'EUR', fx: fx || 1, broker: 'TEST' }, extra || {});

  PT.selfTests = function () {
    const out = [];
    const add = (group, label, hand, engine, tol, fmt, note) => out.push({ group, label, hand, engine, ok: Math.abs(hand - engine) <= (tol || 0.005), fmt: fmt || 'eur', note: note || '' });

    /* ---------- 1. TWR vs XIRR ---------- */
    {
      const s = st([inst('X', 'EUR')], [
        tx('2025-01-01', 'X', 'buy', 10, 100),
        tx('2025-07-01', 'X', 'buy', 5, 120)
      ], [
        { id: 'c1', date: '2025-01-01', type: 'deposit', amount: 1000, currency: 'EUR' },
        { id: 'c2', date: '2025-07-01', type: 'deposit', amount: 600, currency: 'EUR' }
      ], { X: [['2025-06-30', 120], ['2026-01-01', 110]] });
      const r = PT.compute(s, { asOf: '2026-01-01' });
      const m = PT.metrics(r, r.start - 1, r.asOf, { rf: 0 });
      const k = PT.dn('2025-06-30') - r.start;
      add('TWR & XIRR', 'Value on 30 Jun 2025 (10 × 120)', 1200, r.V[k]);
      add('TWR & XIRR', 'Value on 1 Jan 2026 (15 × 110)', 1650, r.V[r.N - 1]);
      add('TWR & XIRR', 'TWR = (1200/1000) × (1650/1800) − 1', 0.10, m.twr, 1e-6, 'pct');
      add('TWR & XIRR', 'XIRR: 1000·(1+r)^(365/365) + 600·(1+r)^(184/365) = 1650', 0.0384724, m.xirr, 1e-6, 'pct',
        'Root found by bisection by hand: r = 3.8472 %. MWR is lower than TWR because 600 € were added right before the price fell.');
      add('TWR & XIRR', 'Absolute P&L = 1650 − 1600', 50, m.pnl);
    }

    /* ---------- 2. FIFO with fees ---------- */
    {
      const s = st([inst('Y', 'EUR')], [
        tx('2025-01-01', 'Y', 'buy', 10, 100, 5),
        tx('2025-02-01', 'Y', 'buy', 5, 120, 5),
        tx('2025-03-01', 'Y', 'sell', 12, 130, 6)
      ], [], { Y: [['2025-04-01', 110]] });
      const r = PT.compute(s, { asOf: '2025-04-01' });
      const p = r.positions[0];
      const realized = r.realized.reduce((a, b) => a + b.pnl, 0);
      add('FIFO', 'Realized: (1560 − 6) − (1005 + 2 × 121)', 307, realized);
      add('FIFO', 'Remaining cost basis: 3 × 121', 363, p.cost);
      add('FIFO', 'Remaining quantity', 3, p.qty, 1e-9, 'num');
      add('FIFO', 'Unrealized: 3 × 110 − 363', -33, p.unreal);
      add('FIFO', 'Fees as a drag: 5 + 5 + 6', -16, r.attribution.tradeFees);
    }

    /* ---------- 3. Price vs currency effect ---------- */
    {
      const s = st([inst('Z', 'USD')], [tx('2025-01-02', 'Z', 'buy', 10, 100, 0, 1.10, { currency: 'USD' })], [],
        { Z: [['2025-06-02', 110]] }, { USD: [['2025-06-02', 1.20]] });
      const r = PT.compute(s, { asOf: '2025-06-02' });
      const p = r.positions[0];
      add('Currency split', 'Total P&L: 1100/1.20 − 1000/1.10', 1100 / 1.2 - 1000 / 1.1, p.unreal);
      add('Currency split', 'Price effect: 10 × (110 − 100) / 1.10', 100 / 1.1, p.pe);
      add('Currency split', 'Currency effect: 1100 × (1/1.20 − 1/1.10)', 1100 * (1 / 1.2 - 1 / 1.1), p.fe);
    }

    /* ---------- 4. Stock split ---------- */
    {
      const s = st([inst('S', 'EUR')], [
        tx('2025-01-02', 'S', 'buy', 10, 100),
        tx('2025-03-03', 'S', 'split', 0, 0, 0, 1, { ratio: 2 }),
        tx('2025-04-01', 'S', 'sell', 5, 60)
      ], [], { S: [['2025-04-02', 60]] });
      const r = PT.compute(s, { asOf: '2025-04-02' });
      add('Split 2:1', 'Quantity after split and sale: 10 × 2 − 5', 15, r.positions[0].qty, 1e-9, 'num');
      add('Split 2:1', 'Realized: 5 × (60 − 50)', 50, r.realized.reduce((a, b) => a + b.pnl, 0));
      add('Split 2:1', 'Average cost per share after split', 50, r.positions[0].avgCostLocal, 1e-9, 'num');
    }

    /* ---------- 5. Short option, closed and expired ---------- */
    {
      const s = st([
        inst('P1', 'EUR', { type: 'option', multiplier: 100, expiry: '2025-06-20' }),
        inst('P2', 'EUR', { type: 'option', multiplier: 100, expiry: '2025-03-21' })
      ], [
        tx('2025-01-02', 'P1', 'sell', 1, 5, 1),
        tx('2025-02-03', 'P1', 'buy', 1, 2, 1),
        tx('2025-01-02', 'P2', 'sell', 2, 3, 0)
      ], [], {});
      const r = PT.compute(s, { asOf: '2025-04-01' });
      const byInst = id => r.realized.filter(x => x.instId === id).reduce((a, b) => a + b.pnl, 0);
      add('Short options', 'Sold to open 1 × 5 × 100, bought back at 2, fees 2', 298, byInst('P1'));
      add('Short options', 'Sold 2 × 3 × 100, expired worthless', 600, byInst('P2'));
      add('Short options', 'Open positions after expiry', 0, r.positions.length, 0, 'num');
    }

    /* ---------- 6. Broker transfer keeps cost basis ---------- */
    {
      const s = st([inst('T', 'EUR')], [
        tx('2025-01-02', 'T', 'buy', 10, 100, 0, 1, { broker: 'DEGIRO' }),
        tx('2025-05-20', 'T', 'transfer_out', 10, 150, 0, 1, { broker: 'DEGIRO' }),
        tx('2025-05-22', 'T', 'transfer_in', 10, 150, 0, 1, { broker: 'IBKR' }),
        tx('2025-06-02', 'T', 'sell', 10, 160, 0, 1, { broker: 'IBKR' })
      ], [], {});
      const r = PT.compute(s, { asOf: '2025-06-03' });
      add('Broker transfer', 'Realized after DEGIRO → IBKR transfer: 10 × (160 − 100)', 600, r.realized.reduce((a, b) => a + b.pnl, 0));
      add('Broker transfer', 'Holding period counted from the original purchase (days)', 151, r.trips[0].holdDays, 0, 'num');
    }
    {
      // both legs on one day, the incoming leg listed first
      const s = st([inst('T2', 'EUR')], [
        tx('2025-01-02', 'T2', 'buy', 10, 100, 0, 1, { broker: 'DEGIRO' }),
        tx('2025-05-20', 'T2', 'transfer_in', 10, 150, 0, 1, { broker: 'IBKR' }),
        tx('2025-05-20', 'T2', 'transfer_out', 10, 150, 0, 1, { broker: 'DEGIRO' })
      ], [], {});
      const r = PT.compute(s, { asOf: '2025-06-03' });
      add('Broker transfer', 'Same-day transfer out and in: shares held (not doubled)', 10, r.positions[0].qty, 0, 'num');
    }

    /* ---------- 6b. Cross-listed security ---------- */
    {
      // priced in EUR (its Tradegate listing) but bought on NASDAQ in USD
      const s = st([inst('CL', 'EUR')], [
        tx('2025-01-02', 'CL', 'buy', 10, 100, 0, 1.1, { currency: 'USD' })
      ], [], {}, { USD: [['2025-01-02', 1.1]] });
      const r = PT.compute(s, { asOf: '2025-01-03' });
      add('Cross-listing', 'Value from the USD trade price: 10 × 100 $ ÷ 1,10', 909.09, r.positions[0].value, 0.01);
    }
    {
      // a stored rate for the trade day (1,25) values the position; the trade keeps its own rate (1,10) for cost
      const s = st([inst('FXS', 'USD')], [
        tx('2025-01-02', 'FXS', 'buy', 10, 100, 0, 1.1, { currency: 'USD' })
      ], [], {}, { USD: [['2025-01-02', 1.25]] });
      const r = PT.compute(s, { asOf: '2025-01-02' });
      add('Cross-listing', 'Stored FX rate wins over the same-day trade rate: 10 × 100 $ ÷ 1,25', 800, r.positions[0].value, 0.01);
    }

    /* ---------- 7. Attribution reconciles ---------- */
    {
      const s = st([inst('A', 'USD')], [
        tx('2025-01-02', 'A', 'buy', 20, 50, 2, 1.04, { currency: 'USD' }),
        tx('2025-04-01', 'A', 'sell', 5, 60, 2, 1.08, { currency: 'USD' })
      ], [
        { id: 'd1', date: '2025-01-02', type: 'deposit', amount: 2000, currency: 'EUR' },
        { id: 'd2', date: '2025-03-15', type: 'dividend', amount: 10, wht: 1.5, currency: 'USD', fx: 1.05, instId: 'A' },
        { id: 'd3', date: '2025-05-01', type: 'fee', amount: -1.3, currency: 'EUR' }
      ], { A: [['2025-06-02', 58]] }, { USD: [['2025-06-02', 1.12]] });
      const r = PT.compute(s, { asOf: '2025-06-02' });
      add('Reconciliation', 'Σ(price + FX + dividends − tax − fees) = value − net deposits', r.attribution.pnl, r.attribution.total, 1e-6);
    }
    return out;
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = PT;
})(typeof window !== 'undefined' ? window : globalThis);
