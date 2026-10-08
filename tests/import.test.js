/* Importer tests on synthetic fixtures that mirror the real export layouts. */
'use strict';
const fs = require('fs');
const path = require('path');
module.exports = function (PT) {
  let fails = 0;
  const fx = f => fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8');
  const check = (label, cond, info) => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'}  [Import] ${label}${info ? '  → ' + info : ''}`); };
  const close = (a, b, t) => Math.abs(a - b) <= (t || 0.01);

  // DEGIRO transactions
  let R = PT.importCSV(fx('degiro-transactions-de.csv'));
  check('DEGIRO tx detected', R.format === 'degiro-tx', R.format);
  check('Zero-price product-change pairs dropped', R.skipped['Product change (zero-price pair)'] === 4, JSON.stringify(R.skipped));
  const tr = R.trades.filter(t => t.type.startsWith('transfer'));
  check('Two 00:00 rows without order ID → transfers', tr.length === 2 && tr.every(t => t.type === 'transfer_out'));
  const buy = R.trades.find(t => t.type === 'buy' && t.currency === 'USD');
  check('German decimals + fees (2,00 + AutoFX 16,03)', buy && buy.price === 150 && close(buy.fee, 18.03) && close(buy.fx, 1.17), JSON.stringify(buy));
  check('Chronological order (oldest first)', R.trades[0].date === '2026-01-05');

  let s = PT.emptyState();
  PT.applyImport(s, R);
  let r = PT.compute(s, { asOf: '2026-06-01' });
  const acme = r.positions.find(p => p.inst.isin === 'US0000000001');
  check('Transferred-out position stays in portfolio (40 shares)', acme && close(acme.qty, 40), acme && acme.qty);
  const rz = r.realized.reduce((a, b) => a + b.pnl, 0);
  // sold 10 @190/1.15 − fee 6.13 ; cost 10 × (150/1.17) + fees 10/50×18.03
  const hand = 1900 / 1.15 - 6.13 - (1500 / 1.17 + 18.03 / 5);
  check('Realized P&L of the partial sell (FIFO, EUR)', close(rz, hand), rz.toFixed(2) + ' vs ' + hand.toFixed(2));

  // DEGIRO account
  R = PT.importCSV(fx('degiro-account-de.csv'));
  check('DEGIRO account detected', R.format === 'degiro-account', R.format);
  const types = R.cash.map(c => c.type).sort().join(',');
  check('Cash classified: deposit, dividend, fee, interest, tax, withdrawal', types === 'deposit,dividend,fee,interest,tax,withdrawal', types);
  check('Reservation, trade cash, trade fee and FX legs skipped', R.skipped['Internal cash sweep / reservation'] === 1 && R.skipped['Trade cash (in Transactions file)'] === 1 && R.skipped['Trade fee (in Transactions file)'] === 1 && R.skipped['FX conversion leg'] === 1, JSON.stringify(R.skipped));
  const sum1 = PT.applyImport(s, R);
  check('Dividend linked to the existing instrument by ISIN', s.cash.filter(c => c.type === 'dividend')[0].instId === acme.id);
  const sum2 = PT.applyImport(s, PT.importCSV(fx('degiro-account-de.csv')));
  check('Re-importing the same file adds nothing (dedupe)', sum2.cash === 0 && sum2.duplicates === sum1.cash, JSON.stringify(sum2));

  // IBKR transaction history
  R = PT.importCSV(fx('ibkr-transaction-history.csv'));
  check('IBKR Transaction History detected', R.format === 'ibkr-history', R.format);
  const hy = R.trades.find(t => t.type === 'sell' && t.currency === 'KRW');
  check('KRW trade: FX derived from EUR gross (≈1546.4 KRW/EUR)', hy && close(hy.fx, 10 * 1819000 / 11763.29, 0.01), hy && hy.fx);
  const opt = R.protos['OPT:QQQ 261120P00720000'];
  check('OCC option parsed (expiry 2026-11-20, strike 720, ×100)', opt && opt.expiry === '2026-11-20' && opt.strike === 720 && opt.multiplier === 100);
  const cts = R.cash.map(c => c.type).sort().join(',');
  check('Cash types: deposits, dividend, WHT, interest, fees, FX adj.', cts === 'deposit,deposit,dividend,fee,fee,fxadj,interest,tax,withdrawal', cts);
  check('Oldest-first ordering for same-day trades', R.trades[0].date === '2026-07-31');

  // IBKR activity
  R = PT.importCSV(fx('ibkr-activity.csv'));
  check('IBKR Activity Statement detected', R.format === 'ibkr-activity', R.format);
  check('Order rows only (SubTotal ignored), forex skipped', R.trades.filter(t => t.type === 'buy' || t.type === 'sell').length === 3, R.trades.length);
  const split = R.trades.find(t => t.type === 'split');
  check('Split 2 for 1 → ratio 2', split && split.ratio === 2);
  check('ISIN from Financial Instrument Information', R.protos['TICKER:ACME'].isin === 'US0000000001');
  check('Dividend + WHT + deposit + interest + FX commission', R.cash.length === 5, R.cash.map(c => c.type).join(','));

  // Cross-broker linking: DEGIRO ISIN instrument ↔ IBKR ticker
  s = PT.emptyState();
  PT.applyImport(s, PT.importCSV(fx('degiro-transactions-de.csv')));
  const sum3 = PT.applyImport(s, PT.importCSV(fx('ibkr-activity.csv')));
  check('IBKR ACME linked to DEGIRO ACME via ISIN', s.instruments.filter(i => i.isin === 'US0000000001').length === 1 && sum3.linked.length >= 1, JSON.stringify(sum3.linked));
  check('Broker symbol replaces guessed ticker', s.instruments.find(i => i.isin === 'US0000000001').ticker === 'ACME');

  // Flex
  R = PT.importCSV(fx('ibkr-flex.csv'));
  check('IBKR Flex detected', R.format === 'ibkr-flex', R.format);
  const sive = R.trades.find(t => t.currency === 'SEK');
  check('Flex FX = 1 / FXRateToBase', sive && close(sive.fx, 1 / 0.0887, 1e-6) && R.trades.length === 2);

  // Generic
  R = PT.importCSV(fx('generic-semicolon.csv'));
  check('Generic semicolon file auto-mapped', R.format === 'generic' && !R.needsMapping && R.trades.length === 2, JSON.stringify(R.mapping));
  check('German side words + dates + decimals', R.trades[1].type === 'sell' && R.trades[0].date === '2025-02-03' && R.trades[0].price === 118.5 && R.trades[0].fx === 1.035);

  // Misc parsing
  check('parseNum("1.234,56") = 1234.56', PT.parseNum('1.234,56') === 1234.56);
  check('parseNum("1,819,000.00") = 1819000', PT.parseNum('1,819,000.00') === 1819000);
  check('parseNum("(12.5)") = -12.5', PT.parseNum('(12.5)') === -12.5);
  check('Price JSON paste', PT.parsePriceInput('{"NVDA": 182.5, "ASML": {"price": 812, "date": "2026-10-07"}}').length === 2);
  return fails;
};
