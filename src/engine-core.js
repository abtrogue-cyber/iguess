/* =====================================================================
 * Portfolio engine — pure calculation code (no DOM).
 * Shared by the app (browser) and the Node test-suite.
 * Conventions
 *   - Dates are ISO strings 'YYYY-MM-DD'; arithmetic uses integer day numbers.
 *   - FX rates are quoted as units of LOCAL currency per 1 EUR (ECB/DEGIRO style,
 *     e.g. USD 1.1618). EUR value = local amount / fx.
 *   - Transaction quantities are positive; `type` carries the direction.
 *   - Fees on trades are stored in EUR.
 * ===================================================================== */
(function (root) {
  'use strict';
  const PT = root.PT || (root.PT = {});
  const EPS = 1e-9;
  PT.EPS = EPS;

  /* ------------------------------------------------------------ dates */
  const DAY = 86400000;
  function dn(s) {
    return Math.round(Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / DAY);
  }
  function iso(n) { return new Date(n * DAY).toISOString().slice(0, 10); }
  function dow(n) { return (((n + 4) % 7) + 7) % 7; } // 0 = Sunday (1970-01-01 was a Thursday)
  function isWeekend(n) { const w = dow(n); return w === 0 || w === 6; }
  function todayISO() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function addDaysISO(s, k) { return iso(dn(s) + k); }
  function nextBizISO(s) { let n = dn(s); while (isWeekend(n)) n++; return iso(n); }
  Object.assign(PT, { dn, iso, dow, isWeekend, todayISO, addDaysISO, nextBizISO, DAY });

  let _uid = 0;
  PT.uid = function (p) {
    _uid = (_uid + 1) % 1e6;
    return (p || 'x') + Date.now().toString(36) + Math.random().toString(36).slice(2, 7) + _uid.toString(36);
  };

  /* -------------------------------------------------------- numbers */
  function guessDec(s) {
    const lc = s.lastIndexOf(','), ld = s.lastIndexOf('.');
    if (lc >= 0 && ld >= 0) return lc > ld ? ',' : '.';
    if (lc >= 0) return /^-?\d{1,3}(,\d{3})+$/.test(s) ? '.' : ',';
    return '.';
  }
  /** Parse a number written in either German (1.234,56) or English (1,234.56) style. */
  function parseNum(v, dec) {
    if (v == null) return NaN;
    if (typeof v === 'number') return v;
    let s = String(v).trim().replace(/[\s  ']/g, '');
    s = s.replace(/[A-Za-z€$£¥₩%]+/g, '');
    if (!s || s === '-' || s === '--' || s === '—') return NaN;
    let neg = false;
    if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
    if (s.endsWith('-') && s.length > 1) { neg = true; s = s.slice(0, -1); }
    if (s.startsWith('+')) s = s.slice(1);
    if (!dec) dec = guessDec(s);
    if (dec === ',') s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
    if (!/^-?\d*\.?\d+(e-?\d+)?$/i.test(s)) return NaN;
    const x = parseFloat(s);
    return isNaN(x) ? NaN : (neg ? -x : x);
  }
  /** Decide the decimal separator used by a whole file from a sample of cells. */
  function detectDecimal(cells) {
    let c = 0, d = 0;
    for (const v of cells) {
      if (v == null) continue;
      const s = String(v).trim();
      if (!/^[-+(]?[\d.,]+\)?$/.test(s)) continue;
      if (/\d\.\d{3},\d+$/.test(s) || /^[-(]?\d+,\d{1,2}\)?$/.test(s) || /^[-(]?\d+,\d{4,}\)?$/.test(s)) c++;
      else if (/\d,\d{3}\.\d+$/.test(s) || /^[-(]?\d+\.\d{1,2}\)?$/.test(s) || /^[-(]?\d+\.\d{4,}\)?$/.test(s)) d++;
    }
    return c > d ? ',' : '.';
  }
  Object.assign(PT, { parseNum, detectDecimal });

  /* ----------------------------------------------------------- dates (parse) */
  const MONTHS = { jan: 1, feb: 2, mar: 3, mär: 3, apr: 4, may: 5, mai: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, okt: 10, nov: 11, dec: 12, dez: 12 };
  function mk(y, m, d) {
    y = +y; m = +m; d = +d;
    if (y < 100) y += 2000;
    if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31 && y > 1900 && y < 2200)) return null;
    return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  }
  /** fmt: 'auto' | 'DMY' | 'MDY' | 'YMD' */
  function parseDate(v, fmt) {
    const s = String(v == null ? '' : v).trim();
    if (!s) return null;
    let m;
    if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/))) return mk(m[1], m[2], m[3]);
    if ((m = s.match(/^(\d{4})(\d{2})(\d{2})(?:$|[;,\sT])/))) return mk(m[1], m[2], m[3]);
    if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/))) {
      const a = +m[1], b = +m[2];
      if (fmt === 'MDY') return mk(m[3], a, b);
      if (fmt === 'DMY') return mk(m[3], b, a);
      if (a > 12) return mk(m[3], b, a);
      if (b > 12) return mk(m[3], a, b);
      return mk(m[3], b, a); // ambiguous → day-first (European default)
    }
    if ((m = s.match(/^(\d{1,2})[\s.-]+([A-Za-zä]{3})[A-Za-z]*[\s.-]+(\d{2,4})/))) {
      const mo = MONTHS[m[2].toLowerCase()];
      if (mo) return mk(m[3], mo, m[1]);
    }
    if ((m = s.match(/^([A-Za-zä]{3})[A-Za-z]*\.?\s+(\d{1,2}),?\s+(\d{4})/))) {
      const mo = MONTHS[m[1].toLowerCase()];
      if (mo) return mk(m[3], mo, m[2]);
    }
    return null;
  }
  function detectDateFmt(cells) {
    let dmy = 0, mdy = 0;
    for (const v of cells) {
      const m = String(v || '').trim().match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
      if (!m) continue;
      if (+m[1] > 12) dmy++;
      if (+m[2] > 12) mdy++;
    }
    return mdy > dmy ? 'MDY' : 'DMY';
  }
  Object.assign(PT, { parseDate, detectDateFmt });

  /* ------------------------------------------------------------- CSV */
  function detectDelimiter(text) {
    const lines = text.split(/\r?\n/).filter(l => l.trim()).slice(0, 25);
    const cands = [',', ';', '\t', '|'];
    let best = ',', bestScore = -1;
    for (const c of cands) {
      const counts = lines.map(l => {
        let n = 0, q = false;
        for (const ch of l) { if (ch === '"') q = !q; else if (ch === c && !q) n++; }
        return n;
      });
      const nonZero = counts.filter(x => x > 0);
      if (!nonZero.length) continue;
      const avg = nonZero.reduce((a, b) => a + b, 0) / nonZero.length;
      const score = nonZero.length * 10 + avg;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    return best;
  }
  function parseCSV(text, delim) {
    text = String(text || '').replace(/^﻿/, '');
    delim = delim || detectDelimiter(text);
    const rows = [];
    let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const ch = text[i];
      if (q) {
        if (ch === '"') {
          if (text[i + 1] === '"') { cell += '"'; i++; } else q = false;
        } else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === delim) { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); cell = '';
        if (row.length > 1 || row[0].trim() !== '') rows.push(row);
        row = [];
      } else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); if (row.length > 1 || row[0].trim() !== '') rows.push(row); }
    return rows.map(r => r.map(c => c.trim()));
  }
  Object.assign(PT, { parseCSV, detectDelimiter });

  /* ------------------------------------------------------ instruments */
  // Best-effort ISIN → ticker hints for names common in this kind of portfolio.
  PT.ISIN_TICKERS = {
    US67066G1040: 'NVDA', US0079031078: 'AMD', NL0009805522: 'NBIS', US7811541090: 'RBRK',
    NL0010273215: 'ASML', US0378331005: 'AAPL', US5949181045: 'MSFT', US8740391003: 'TSM',
    US11135F1012: 'AVGO', KR7000660001: '000660.KS', KR7005930003: '005930.KS', TW0002330008: '2330.TW',
    US69608A1088: 'PLTR', US5951121038: 'MU', US02079K3059: 'GOOGL', US30303M1027: 'META',
    US0231351067: 'AMZN', US88160R1014: 'TSLA', IE000L00POB4: 'UONS', LU0290358497: 'XEON'
  };
  const COUNTRY_BY_ISIN = { US: 'United States', NL: 'Netherlands', DE: 'Germany', KR: 'South Korea', TW: 'Taiwan', JP: 'Japan', SE: 'Sweden', CA: 'Canada', IE: 'Ireland', LU: 'Luxembourg', GB: 'United Kingdom', FR: 'France', CH: 'Switzerland', KY: 'Cayman Islands', HK: 'Hong Kong', CN: 'China', DK: 'Denmark', NO: 'Norway', FI: 'Finland', IL: 'Israel', AU: 'Australia', BE: 'Belgium', IT: 'Italy', ES: 'Spain', AT: 'Austria', BM: 'Bermuda', JE: 'Jersey' };
  const COUNTRY_BY_CCY = { USD: 'United States', KRW: 'South Korea', TWD: 'Taiwan', JPY: 'Japan', SEK: 'Sweden', CAD: 'Canada', HKD: 'Hong Kong', GBP: 'United Kingdom', CHF: 'Switzerland', DKK: 'Denmark', NOK: 'Norway', AUD: 'Australia' };
  PT.countryFor = function (isin, ccy) {
    if (isin && /^[A-Z]{2}/.test(isin) && COUNTRY_BY_ISIN[isin.slice(0, 2)]) return COUNTRY_BY_ISIN[isin.slice(0, 2)];
    return COUNTRY_BY_CCY[ccy] || (ccy === 'EUR' ? 'Eurozone' : '');
  };
  PT.DEGIRO_EXCHANGES = { NDQ: 'NASDAQ', NSY: 'NYSE', XET: 'XETRA', TDG: 'Tradegate', EAM: 'Euronext Amsterdam', EPA: 'Euronext Paris', LSE: 'LSE', KSC: 'KRX', TOR: 'TSX', TSV: 'TSX-V', TSE: 'Tokyo', OMX: 'Nasdaq Stockholm', HKS: 'HKEX', FRA: 'Frankfurt', DEG: 'DEGIRO (internal)', ASE: 'NYSE American', SWX: 'SIX', MIL: 'Borsa Italiana', BRU: 'Euronext Brussels', TAI: 'TWSE', XHKG: 'HKEX' };

  const NAME_STOP = new Set(['INC', 'CORP', 'CORPORATION', 'NV', 'N', 'V', 'SA', 'AG', 'SE', 'PLC', 'LTD', 'LIMITED', 'CLASS', 'CL', 'A', 'B', 'C', 'CO', 'THE', 'NON', 'TRADEABLE', 'HOLDINGS', 'HOLDING', 'COMPANY', 'AB', 'ASA', 'OYJ', 'SPA', 'KGAA', 'ADR', 'ORD', 'SHS', 'REG']);
  /** Normalised name key used to link the same company across brokers. */
  PT.nameKey = function (name) {
    const toks = String(name || '').toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').split(/\s+/).filter(t => t && !NAME_STOP.has(t));
    return toks.slice(0, 2).join(' ');
  };
  PT.cleanName = function (name) {
    return String(name || '').replace(/\s*-\s*NON TRADEABLE\s*$/i, '').replace(/\s+/g, ' ').trim();
  };
  PT.guessTicker = function (name, isin) {
    if (isin && PT.ISIN_TICKERS[isin]) return PT.ISIN_TICKERS[isin];
    const t = String(name || '').toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').split(/\s+/).filter(x => x && !NAME_STOP.has(x));
    return (t[0] || 'NEW').slice(0, 8);
  };

  const MON3 = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12 };
  /** Parse OCC style ("QQQ 261120P00720000") or IB style ("QQQ 20NOV26 720 P") option symbols. */
  PT.parseOption = function (sym) {
    const s = String(sym || '').trim().toUpperCase();
    let m = s.match(/^([A-Z0-9.]{1,8})\s*(\d{2})(\d{2})(\d{2})([CP])(\d{8})$/);
    if (m) return { underlying: m[1], expiry: mk(m[2], m[3], m[4]), right: m[5], strike: +m[6] / 1000 };
    m = s.match(/^([A-Z0-9.]{1,8})\s+(\d{1,2})([A-Z]{3})(\d{2})\s+([\d.]+)\s+([CP])$/);
    if (m && MON3[m[3]]) return { underlying: m[1], expiry: mk(m[4], MON3[m[3]], m[2]), right: m[6], strike: +m[5] };
    return null;
  };
  PT.optionLabel = function (o) {
    if (!o) return '';
    const d = o.expiry ? new Date(o.expiry + 'T00:00:00Z') : null;
    const mon = d ? d.toLocaleString('en', { month: 'short', timeZone: 'UTC' }).toUpperCase() : '';
    return `${o.underlying} ${d ? String(d.getUTCDate()).padStart(2, '0') + mon + String(d.getUTCFullYear()).slice(2) : ''} ${o.strike} ${o.right}`;
  };
  PT.occSymbol = function (u, expiry, right, strike) {
    return `${u} ${expiry.slice(2, 4)}${expiry.slice(5, 7)}${expiry.slice(8, 10)}${right}${String(Math.round(strike * 1000)).padStart(8, '0')}`;
  };

  /* ------------------------------------------------ time-series lookup */
  /** Build a lookup over [[iso, value], ...]. mode: 'locf' | 'interp'. */
  PT.makeSeries = function (obs, mode) {
    const pts = obs.filter(o => o && isFinite(o[1])).map(o => [typeof o[0] === 'number' ? o[0] : dn(o[0]), +o[1]]).sort((a, b) => a[0] - b[0]);
    // collapse duplicates: keep last value of the day
    const xs = [], ys = [];
    for (const [d, v] of pts) {
      if (xs.length && xs[xs.length - 1] === d) ys[ys.length - 1] = v; else { xs.push(d); ys.push(v); }
    }
    function idx(d) { // last index with xs[i] <= d, or -1
      let lo = 0, hi = xs.length - 1, r = -1;
      while (lo <= hi) { const m = (lo + hi) >> 1; if (xs[m] <= d) { r = m; lo = m + 1; } else hi = m - 1; }
      return r;
    }
    return {
      n: xs.length, xs, ys,
      first: xs.length ? xs[0] : null, last: xs.length ? xs[xs.length - 1] : null,
      at(d) {
        if (!xs.length) return NaN;
        const i = idx(d);
        if (i < 0) return ys[0];
        if (mode === 'interp' && i < xs.length - 1 && xs[i] !== d) {
          const w = (d - xs[i]) / (xs[i + 1] - xs[i]);
          return ys[i] + w * (ys[i + 1] - ys[i]);
        }
        return ys[i];
      },
      dateAt(d) { const i = idx(d); return i < 0 ? (xs.length ? xs[0] : null) : xs[i]; },
      exactOrBefore(d) { const i = idx(d); return i < 0 ? null : [xs[i], ys[i]]; }
    };
  };

  /* ------------------------------------------------------------ math */
  PT.mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN;
  PT.stdev = function (a) {
    if (a.length < 2) return NaN;
    const m = PT.mean(a);
    return Math.sqrt(a.reduce((s, x) => s + (x - m) * (x - m), 0) / (a.length - 1));
  };

  /** XIRR: cfs = [{d: dayNumber, a: amount}] (investor view: contributions negative). */
  PT.xirr = function (cfs) {
    const f = cfs.filter(c => Math.abs(c.a) > 1e-9).sort((x, y) => x.d - y.d);
    if (f.length < 2 || !f.some(c => c.a > 0) || !f.some(c => c.a < 0)) return NaN;
    const t0 = f[0].d;
    const ts = f.map(c => (c.d - t0) / 365);
    if (ts[ts.length - 1] <= 0) return NaN;
    const npv = r => f.reduce((s, c, i) => s + c.a / Math.pow(1 + r, ts[i]), 0);
    const dnpv = r => f.reduce((s, c, i) => s - ts[i] * c.a / Math.pow(1 + r, ts[i] + 1), 0);
    // Newton first
    let r = 0.1;
    for (let k = 0; k < 60; k++) {
      const v = npv(r), dv = dnpv(r);
      if (!isFinite(v) || !isFinite(dv) || dv === 0) break;
      const nr = r - v / dv;
      if (!isFinite(nr) || nr <= -0.999999) break;
      if (Math.abs(nr - r) < 1e-12) { if (Math.abs(npv(nr)) < 1e-6 * Math.max(1, Math.abs(f[0].a))) return nr; break; }
      r = nr;
    }
    // Bisection fallback
    let lo = -0.999999, hi = 1, flo = npv(lo), fhi = npv(hi);
    let guard = 0;
    while (flo * fhi > 0 && guard++ < 60) { hi *= 2; fhi = npv(hi); if (hi > 1e7) return NaN; }
    if (flo * fhi > 0) return NaN;
    for (let k = 0; k < 300; k++) {
      const mid = (lo + hi) / 2, fm = npv(mid);
      if (Math.abs(fm) < 1e-10 || (hi - lo) < 1e-13) return mid;
      if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
    }
    return (lo + hi) / 2;
  };

  /* ------------------------------------------------------- PRNG / demo helpers */
  PT.rng = function (seed) {
    let a = seed >>> 0;
    const next = () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    let spare = null;
    next.normal = () => {
      if (spare !== null) { const s = spare; spare = null; return s; }
      let u = 0, v = 0; while (u === 0) u = next(); while (v === 0) v = next();
      const r = Math.sqrt(-2 * Math.log(u)); spare = r * Math.sin(2 * Math.PI * v); return r * Math.cos(2 * Math.PI * v);
    };
    return next;
  };
  function ncdf(x) { // Abramowitz-Stegun
    const t = 1 / (1 + 0.2316419 * Math.abs(x));
    const d = 0.3989423 * Math.exp(-x * x / 2);
    const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
    return x > 0 ? 1 - p : p;
  }
  PT.blackScholes = function (S, K, T, sigma, r, right) {
    if (T <= 0) return Math.max(0, right === 'C' ? S - K : K - S);
    const d1 = (Math.log(S / K) + (r + sigma * sigma / 2) * T) / (sigma * Math.sqrt(T));
    const d2 = d1 - sigma * Math.sqrt(T);
    return right === 'C' ? S * ncdf(d1) - K * Math.exp(-r * T) * ncdf(d2) : K * Math.exp(-r * T) * ncdf(-d2) - S * ncdf(-d1);
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = PT;
})(typeof window !== 'undefined' ? window : globalThis);
