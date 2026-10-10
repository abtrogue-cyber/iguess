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
  return fails;
};
