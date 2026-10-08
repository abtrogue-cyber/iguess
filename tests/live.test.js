/* Live prices: symbol choice, provider answers, currency translation, storage, market hours. */
'use strict';
module.exports = function (PT) {
  let fails = 0;
  const check = (label, cond, info) => { if (!cond) fails++; console.log(`${cond ? 'PASS' : 'FAIL'}  [Live] ${label}${info ? '  → ' + info : ''}`); };
  const close = (a, b, t) => Math.abs(a - b) <= (t || 1e-9);

  const stock = (ticker, currency, extra) => Object.assign({ id: ticker, ticker, currency, type: 'stock' }, extra || {});
  check('US share: asked for by its ticker', JSON.stringify(PT.liveSymbol(stock('AMD', 'USD'))) === '{"symbol":"AMD","currency":"USD"}');
  check('Options and warrants: no symbol', PT.liveSymbol(stock('SOFI 281215C00015000', 'USD', { type: 'option' })) === null && PT.liveSymbol(stock('PX0AAA', 'EUR', { type: 'warrant' })) === null);
  check('Non-US listing without a live symbol: not asked for', PT.liveSymbol(stock('PNG', 'CAD')) === null && PT.liveSymbol(stock('XEON', 'EUR')) === null);
  check('Own live symbol and currency win', JSON.stringify(PT.liveSymbol(stock('PNG', 'CAD', { quoteSymbol: 'KRKNF', quoteCurrency: 'USD' }))) === '{"symbol":"KRKNF","currency":"USD"}');

  const fh = PT.parseLiveQuote.finnhub({ c: 171.42, d: 2.1, dp: 1.24, h: 172, l: 168.5, o: 169, pc: 169.32, t: 1791489600 });
  check('Finnhub quote read (price, previous close, time)', fh && fh.price === 171.42 && fh.prevClose === 169.32 && fh.time === 1791489600000, JSON.stringify(fh));
  check('Finnhub unknown symbol (all zeros) → no quote', PT.parseLiveQuote.finnhub({ c: 0, d: null, dp: null, h: 0, l: 0, o: 0, pc: 0, t: 0 }) === null);
  const td = PT.parseLiveQuote.twelvedata({ symbol: 'AMD', close: '171.42', previous_close: '169.32', last_quote_at: 1791489600, timestamp: 1791466200 });
  check('Twelve Data quote read (strings, last_quote_at)', td && td.price === 171.42 && td.prevClose === 169.32 && td.time === 1791489600000, JSON.stringify(td));
  check('Twelve Data error object → no quote', PT.parseLiveQuote.twelvedata({ code: 404, message: 'symbol not found', status: 'error' }) === null);

  // 4,50 USD at 1,16 USD/EUR and 1,62 CAD/EUR = 4,50 / 1,16 × 1,62 CAD
  check('Quote translated USD → CAD through EUR', close(PT.convertQuote(4.5, 'USD', 'CAD', 1.16, 1.62), 4.5 / 1.16 * 1.62));
  check('Same currency: unchanged; missing rate: NaN', PT.convertQuote(10, 'USD', 'USD') === 10 && isNaN(PT.convertQuote(10, 'USD', 'CAD', 1.16, NaN)));

  check('Previous weekday: Monday → Friday, Wednesday → Tuesday', PT.prevWeekdayISO('2026-10-05') === '2026-10-02' && PT.prevWeekdayISO('2026-10-07') === '2026-10-06');
  const s = { prices: { A: [['2026-10-06', 160, 'm']] }, fx: { USD: [['2026-10-07', 1.17]] } };
  const day = PT.storeLiveQuote(s, 'A', { price: 171.42, prevClose: 169.32, time: Date.UTC(2026, 9, 7, 19, 59) });
  check('Quote stored on its trading day; a price you entered for the day before is kept', day === '2026-10-07' && JSON.stringify(s.prices.A) === JSON.stringify([['2026-10-06', 160, 'm'], ['2026-10-07', 171.42, 'live']]), JSON.stringify(s.prices.A));
  PT.storeLiveQuote(s, 'A', { price: 172.1, prevClose: 169.32, time: Date.UTC(2026, 9, 7, 20, 0) });
  PT.storeLiveQuote(s, 'B', { price: 50, prevClose: 49, time: Date.UTC(2026, 9, 5, 15, 0) });
  check('A later quote replaces the day’s price; previous close lands on Friday', s.prices.A.length === 2 && s.prices.A[1][1] === 172.1 && JSON.stringify(s.prices.B) === JSON.stringify([['2026-10-02', 49, 'close'], ['2026-10-05', 50, 'live']]), JSON.stringify(s.prices.B));

  const ecb = PT.parseEcbRates({ amount: 1, base: 'EUR', date: '2026-10-07', rates: { USD: 1.1612, CAD: 1.6201, JPY: 172.3 } });
  PT.storeFxRates(s, ecb.date, ecb.rates, ['USD', 'CAD']);
  check('ECB rates stored for the currencies needed; your own rate for the day is kept', JSON.stringify(s.fx.USD) === JSON.stringify([['2026-10-07', 1.17]]) && JSON.stringify(s.fx.CAD) === JSON.stringify([['2026-10-07', 1.6201, 'ecb']]) && !s.fx.JPY, JSON.stringify(s.fx));
  check('Rates with another base are refused', PT.parseEcbRates({ base: 'USD', date: '2026-10-07', rates: { EUR: 0.86 } }) === null);

  check('US market open: Wed 10:00 New York', PT.usMarketOpen(new Date('2026-10-07T14:00:00Z')) === true);
  check('US market closed: Wed 17:00 New York, Saturday, 9:00 before the open', !PT.usMarketOpen(new Date('2026-10-07T21:00:00Z')) && !PT.usMarketOpen(new Date('2026-10-10T15:00:00Z')) && !PT.usMarketOpen(new Date('2026-10-07T13:00:00Z')));
  check('Winter time handled (EST): Tue 9 Dec 2025 14:45 UTC = 9:45 New York', PT.usMarketOpen(new Date('2025-12-09T14:45:00Z')) === true && !PT.usMarketOpen(new Date('2025-12-09T14:15:00Z')));
  return fails;
};
