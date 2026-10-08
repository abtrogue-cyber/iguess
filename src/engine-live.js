/* =====================================================================
 * Live prices: which symbol to ask a quote provider for, how to read its
 * answer, and how quotes and ECB rates are stored. No network code here
 * (that is app-live.js), so all of it runs in the Node tests.
 * ===================================================================== */
(function (root) {
  'use strict';
  const PT = root.PT;

  PT.LIVE_PROVIDERS = {
    finnhub: { label: 'Finnhub', signup: 'https://finnhub.io/register', every: 60, note: 'Free plan: real-time US stocks and ETFs, 60 requests a minute.' },
    twelvedata: { label: 'Twelve Data', signup: 'https://twelvedata.com/register', every: 300, batch: 8, note: 'Free plan: US stocks, 8 requests a minute and 800 a day.' }
  };
  // currencies in the ECB reference rates (served by Frankfurter)
  PT.ECB_CCY = ['USD', 'JPY', 'BGN', 'CZK', 'DKK', 'GBP', 'HUF', 'PLN', 'RON', 'SEK', 'CHF', 'ISK', 'NOK', 'TRY', 'AUD', 'BRL', 'CAD', 'CNY', 'HKD', 'IDR', 'ILS', 'INR', 'KRW', 'MXN', 'MYR', 'NZD', 'PHP', 'SGD', 'THB', 'ZAR'];

  /** The symbol and currency to request for an instrument, or null when it has none.
   *  Without an explicit live symbol only US-dollar shares and ETFs are asked for, by their ticker. */
  PT.liveSymbol = function (inst) {
    if (!inst) return null;
    const own = String(inst.quoteSymbol || '').trim();
    if (own) return { symbol: own, currency: inst.quoteCurrency || inst.currency };
    if (inst.type === 'option' || inst.type === 'warrant') return null;
    if (inst.currency === 'USD' && /^[A-Z][A-Z0-9.\-]{0,9}$/.test(inst.ticker || '')) return { symbol: inst.ticker, currency: 'USD' };
    return null;
  };

  /** Provider answers → { price, prevClose, time (ms) } or null. */
  PT.parseLiveQuote = {
    // GET /api/v1/quote → { c, d, dp, h, l, o, pc, t }; an unknown symbol comes back as zeros
    finnhub(j) {
      if (!j || !(+j.c > 0) || !(+j.t > 0)) return null;
      return { price: +j.c, prevClose: +j.pc > 0 ? +j.pc : null, time: +j.t * 1000 };
    },
    // GET /quote → { symbol, close, previous_close, last_quote_at, timestamp, ... } or { code, message, status: 'error' }
    twelvedata(j) {
      if (!j || j.status === 'error' || !(+j.close > 0)) return null;
      const t = +j.last_quote_at || +j.timestamp;
      return { price: +j.close, prevClose: +j.previous_close > 0 ? +j.previous_close : null, time: t > 0 ? t * 1000 : Date.now() };
    }
  };

  /** A price in currency `from` expressed in `to` (FX rates are units per EUR). */
  PT.convertQuote = function (price, from, to, fxFrom, fxTo) {
    if (!from || !to || from === to) return price;
    if (!(fxFrom > 0) || !(fxTo > 0)) return NaN;
    return price / fxFrom * fxTo;
  };

  /** The weekday before an ISO date (exchange holidays are not modelled). */
  PT.prevWeekdayISO = function (isoDate) {
    let d = PT.dn(isoDate) - 1;
    while (PT.isWeekend(d)) d--;
    return PT.iso(d);
  };

  function upsert(list, row, keepTags) {
    const i = list.findIndex(o => o[0] === row[0]);
    if (i >= 0) { if (keepTags && keepTags.includes(list[i][2])) return false; list[i] = row; }
    else { list.push(row); list.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0); }
    return true;
  }

  /** Store a quote: the latest price on its trading day (US trading days are the same date in UTC), and the
   *  previous close on the weekday before, unless a price you entered or imported is already there. */
  PT.storeLiveQuote = function (state, instId, q) {
    const day = new Date(q.time).toISOString().slice(0, 10);
    const list = state.prices[instId] = state.prices[instId] || [];
    upsert(list, [day, q.price, 'live']);
    if (q.prevClose > 0) upsert(list, [PT.prevWeekdayISO(day), q.prevClose, 'close'], ['m', 'i']);
    return day;
  };

  /** Frankfurter /latest → { date, rates } (EUR base). */
  PT.parseEcbRates = function (j) {
    if (!j || !j.rates || !j.date || (j.base && j.base !== 'EUR')) return null;
    return { date: j.date, rates: j.rates };
  };
  PT.storeFxRates = function (state, date, rates, only) {
    Object.keys(rates).forEach(c => {
      if (only && !only.includes(c)) return;
      if (!(+rates[c] > 0)) return;
      upsert(state.fx[c] = state.fx[c] || [], [date, +rates[c], 'ecb'], [undefined, 'm']); // rates typed in the FX tab carry no tag
    });
  };

  /** Regular US session (9:30–16:00 New York time, Mon–Fri; holidays not modelled), plus a few minutes for the closing print. */
  PT.usMarketOpen = function (when) {
    const parts = {};
    new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' })
      .formatToParts(when || new Date()).forEach(p => { parts[p.type] = p.value; });
    if (parts.weekday === 'Sat' || parts.weekday === 'Sun') return false;
    const m = (+parts.hour % 24) * 60 + +parts.minute;
    return m >= 9 * 60 + 30 && m < 16 * 60 + 5;
  };
})(typeof window !== 'undefined' ? window : globalThis);
