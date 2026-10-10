/* Holdings timeline behind the portfolio map's time machine. */
'use strict';
module.exports = function (PT) {
  let fails = 0;
  const check = (label, cond, info) => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'}  [Map] ${label}${info !== undefined ? '  → ' + info : ''}`); };
  const close = (a, b, t) => Math.abs(a - b) <= (t || 1e-6);
  const s = PT.emptyState();
  s.benchmarks = [];
  s.instruments = [{ id: 'A', ticker: 'A', name: 'A', currency: 'USD', type: 'stock', multiplier: 1, tags: [] }];
  const tx = (id, date, type, qty, price, fx, broker) => ({ id, date, instId: 'A', type, qty, price, fee: 0, currency: 'USD', fx, broker });
  s.transactions = [
    tx('t1', '2025-01-02', 'buy', 10, 100, 1.1, 'DEGIRO'),
    tx('t2', '2025-03-03', 'buy', 5, 120, 1.2, 'DEGIRO'),
    tx('t3', '2025-06-02', 'sell', 8, 130, 1.25, 'DEGIRO'),
    tx('t4', '2025-07-01', 'transfer_out', 7, 140, 1.2, 'DEGIRO'),
    tx('t5', '2025-07-01', 'transfer_in', 7, 140, 1.2, 'IBKR'),
    tx('t6', '2025-09-01', 'sell', 7, 150, 1.2, 'IBKR')
  ];
  s.prices = { A: [['2025-04-01', 125, 'm']] };
  s.fx = { USD: [['2025-04-01', 1.15]] };
  const r = PT.compute(s, { asOf: '2025-10-01' });
  const tl = r.timeline.A;
  check('One timeline row per event day', tl.length === 5, JSON.stringify(tl.map(x => [PT.iso(x[0]), x[1]])));
  check('Cost of open lots after the second buy: 10×100/1,1 + 5×120/1,2', close(tl[1][2], 1000 / 1.1 + 500));
  check('FIFO sale of 8 leaves 2 old + 5 new lots', tl[2][1] === 7 && close(tl[2][2], 200 / 1.1 + 500));
  check('Broker switches to IBKR on the transfer day', tl[3][3] === 'IBKR' && tl[2][3] === 'DEGIRO');
  const h = PT.holdingsAt(r, PT.dn('2025-04-01'));
  check('Holdings on 01.04.2025: 15 shares at 125 $ ÷ 1,15', h.length === 1 && h[0].qty === 15 && close(h[0].value, 15 * 125 / 1.15), h[0] && h[0].value);
  check('Return on cost on that day', close(h[0].ret, (15 * 125 / 1.15) / (1000 / 1.1 + 500) - 1));
  check('Move since the 03.03 trade, in EUR', close(h[0].move(PT.dn('2025-03-03')), (125 / 1.15) / (120 / 1.2) - 1));
  check('Holding period starts at the first buy', PT.iso(h[0].since) === '2025-01-02');
  check('Nothing held before the first buy or after the last sale', PT.holdingsAt(r, PT.dn('2024-12-31')).length === 0 && PT.holdingsAt(r, PT.dn('2025-09-02')).length === 0);
  check('Broker on a given day', PT.holdingsAt(r, PT.dn('2025-06-30'))[0].broker === 'DEGIRO' && PT.holdingsAt(r, PT.dn('2025-07-02'))[0].broker === 'IBKR');

  // a move needs a price observed within a week before each end of the period
  const s2 = PT.emptyState();
  s2.benchmarks = [];
  s2.instruments = [
    { id: 'W', ticker: 'W', name: 'ACME CALL 50', currency: 'EUR', type: 'warrant', multiplier: 1, tags: [] },
    { id: 'S', ticker: 'S', name: 'S', currency: 'EUR', type: 'stock', multiplier: 1, tags: [] },
    { id: 'T', ticker: 'T', name: 'T', currency: 'EUR', type: 'stock', multiplier: 1, tags: [] },
    { id: 'D', ticker: 'D', name: 'D', currency: 'EUR', type: 'stock', multiplier: 1, tags: [] }
  ];
  const buy = (id, instId, qty, price, date) => ({ id, date: date || '2025-03-10', instId, type: 'buy', qty, price, fee: 0, currency: 'EUR', fx: 1, broker: 'DEGIRO' });
  s2.transactions = [buy('w1', 'W', 100, 2), buy('s1', 'S', 10, 50), buy('t1', 'T', 10, 10, '2025-01-02'), buy('d1', 'D', 10, 50)];
  s2.prices = { S: [['2025-02-28', 48, 'm'], ['2025-03-31', 55, 'm']], T: [['2025-03-31', 12, 'm']], D: [['2025-03-27', 50, 'm'], ['2025-03-28', 52, 'm']] };
  const r2 = PT.compute(s2, { asOf: '2025-04-30' });
  const hold = d => Object.fromEntries(PT.holdingsAt(r2, PT.dn(d)).map(x => [x.id, x]));
  const on = hold('2025-03-31');
  check('No move for a warrant valued only at its purchase price', isNaN(on.W.move(PT.dn('2025-03-01'))) && isNaN(on.W.move(PT.dn('2025-03-20'))));
  check('Move of a stock priced before the period began: 55 / 48', close(on.S.move(PT.dn('2025-03-01')), 55 / 48 - 1), on.S.move(PT.dn('2025-03-01')));
  check('No move when the period starts before the first price', isNaN(on.S.move(PT.dn('2025-02-01'))));
  check('No move when the price before the period is weeks old', isNaN(on.T.move(PT.dn('2025-03-01'))));
  check('No move when the latest price is weeks old', isNaN(hold('2025-04-15').S.move(PT.dn('2025-03-01'))));
  check('Saturday shows Friday\'s move: 52 / 50', close(hold('2025-03-29').D.dayPct, 52 / 50 - 1), hold('2025-03-29').D.dayPct);
  check('No day move from a stale price', isNaN(hold('2025-04-07').D.dayPct) && isNaN(on.T.dayPct));
  return fails;
};
