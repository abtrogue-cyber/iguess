/* =====================================================================
 * CSV importers: DEGIRO (Transactions + Account statement),
 * IBKR (Activity Statement, Transaction History, Flex Query) and a
 * generic mapper. Every importer returns
 *   { format, label, protos:{key:proto}, trades:[], cash:[], skipped:{reason:n}, warnings:[] }
 * where trades/cash reference protos by `key`. applyImport() resolves keys
 * to instruments in the state (matching by ISIN, alias, ticker, name).
 * ===================================================================== */
(function (root) {
  'use strict';
  const PT = root.PT;
  const { parseNum, parseDate, detectDecimal, detectDateFmt } = PT;

  const findCol = (headers, re, from) => {
    for (let i = from || 0; i < headers.length; i++) if (re.test(headers[i] || '')) return i;
    return -1;
  };
  const isCcy = s => /^[A-Z]{3}$/.test(String(s || '').trim());
  /** Money cells in DEGIRO exports are an amount + an adjacent unnamed currency cell (either order). */
  function moneyAt(row, i, dec) {
    if (i < 0) return { v: NaN, c: null };
    const a = row[i], b = row[i + 1];
    if (isCcy(a)) return { v: parseNum(b, dec), c: a.trim() };
    const v = parseNum(a, dec);
    return { v, c: isCcy(b) ? b.trim() : null };
  }
  function result(format, label) {
    return { format, label, protos: {}, trades: [], cash: [], skipped: {}, warnings: [], notes: [] };
  }
  const skip = (R, reason) => { R.skipped[reason] = (R.skipped[reason] || 0) + 1; };

  /* ---------------------------------------------------------- detection */
  PT.detectFormat = function (rows) {
    if (!rows.length) return 'empty';
    const sectioned = rows.filter(r => r[1] === 'Header' || r[1] === 'Data').length > rows.length * 0.5;
    if (sectioned) {
      const names = new Set(rows.map(r => r[0]));
      if (names.has('Transaction History')) return 'ibkr-history';
      if (names.has('Trades') || names.has('Dividends') || names.has('Deposits & Withdrawals') || names.has('Interest') || names.has('Transfers')) return 'ibkr-activity';
    }
    const hi = PT.findHeaderRow(rows);
    const h = (rows[hi] || []).map(x => String(x).toLowerCase());
    const has = re => h.some(x => re.test(x));
    if (has(/^transaction type$/) && has(/net amount/)) return 'ibkr-history';
    if (has(/^tradeprice$/) || (has(/^buy\/sell$/) && has(/ibcommission/)) || has(/fxratetobase/)) return 'ibkr-flex';
    if (has(/^isin$/) && has(/venue|ausführungsort|uitvoeringsplaats|reference exchange|referenzb|^beurs$/) && has(/quantity|anzahl|aantal/)) return 'degiro-tx';
    if (has(/^isin$/) && has(/description|beschreibung|omschrijving/) && has(/value date|valutadatum|valuta/)) return 'degiro-account';
    return 'generic';
  };
  PT.findHeaderRow = function (rows) {
    for (let i = 0; i < Math.min(rows.length, 15); i++) {
      const r = rows[i];
      const textCells = r.filter(c => c && isNaN(parseNum(c)) && !parseDate(c)).length;
      if (textCells >= Math.max(3, r.filter(Boolean).length * 0.6)) return i;
    }
    return 0;
  };
  PT.FORMAT_LABELS = {
    'degiro-tx': 'DEGIRO · Transactions', 'degiro-account': 'DEGIRO · Account statement',
    'ibkr-activity': 'IBKR · Activity Statement', 'ibkr-history': 'IBKR · Transaction History', 'ibkr-flex': 'IBKR · Flex Query',
    generic: 'Generic CSV (manual mapping)', empty: 'Empty file'
  };

  PT.importCSV = function (text, opts) {
    opts = opts || {};
    const rows = PT.parseCSV(text);
    const format = opts.format || PT.detectFormat(rows);
    let R;
    switch (format) {
      case 'degiro-tx': R = PT.importDegiroTx(rows, opts); break;
      case 'degiro-account': R = PT.importDegiroAccount(rows, opts); break;
      case 'ibkr-activity': R = PT.importIbkrActivity(rows, opts); break;
      case 'ibkr-history': R = PT.importIbkrHistory(rows, opts); break;
      case 'ibkr-flex': R = PT.importIbkrFlex(rows, opts); break;
      default: R = PT.importGeneric(rows, opts);
    }
    R.rows = rows;
    return R;
  };

  /* --------------------------------------------------------- protos */
  function proto(R, key, p) {
    const ex = R.protos[key];
    if (ex) { Object.keys(p).forEach(k => { if (p[k] != null && p[k] !== '' && (ex[k] == null || ex[k] === '')) ex[k] = p[k]; }); return ex; }
    const o = Object.assign({ key, ticker: '', name: '', isin: '', currency: '', exchange: '', type: 'stock', multiplier: 1 }, p);
    R.protos[key] = o;
    return o;
  }
  function optionProto(R, sym, cur, broker, desc) {
    const o = PT.parseOption(sym) || PT.parseOption(desc);
    if (!o) return null;
    const occ = PT.occSymbol(o.underlying, o.expiry, o.right, o.strike);
    return proto(R, 'OPT:' + occ, { ticker: occ, name: PT.optionLabel(o), currency: cur, type: 'option', multiplier: 100, expiry: o.expiry, strike: o.strike, right: o.right, underlying: o.underlying });
  }

  /* =========================================================== DEGIRO tx */
  PT.importDegiroTx = function (rows, opts) {
    const R = result('degiro-tx', PT.FORMAT_LABELS['degiro-tx']);
    const hi = PT.findHeaderRow(rows);
    const H = rows[hi].map(x => String(x || '').trim());
    const body = rows.slice(hi + 1).filter(r => r.length >= 6);
    const dec = opts.decimal || detectDecimal(body.flatMap(r => r.slice(6)));
    const c = {
      date: findCol(H, /^(date|datum)$/i), time: findCol(H, /^(time|uhrzeit|tijd)$/i), product: findCol(H, /^(product|produkt)$/i),
      isin: findCol(H, /^isin$/i), ref: findCol(H, /reference|referenzb|^beurs$/i), venue: findCol(H, /venue|ausführungsort|uitvoeringsplaats/i),
      qty: findCol(H, /quantity|anzahl|aantal/i), price: findCol(H, /^(price|kurs|koers)$/i), local: findCol(H, /local value|lokalw|lokale waarde/i),
      value: findCol(H, /^(value|wert|waarde)(\s+eur)?$/i), fx: findCol(H, /exchange rate|wechselkurs|wisselkoers/i), autofx: findCol(H, /autofx/i),
      fee: findCol(H, /transaction|transaktionskosten|transactiekosten|kosten/i), total: findCol(H, /^(total|gesamt|totaal)/i), order: findCol(H, /order/i)
    };
    if (c.date < 0 || c.qty < 0 || c.price < 0 || c.isin < 0) { R.warnings.push('Could not find the DEGIRO columns — use manual mapping.'); R.needsMapping = true; return R; }
    const zero = {};
    const parsed = [];
    body.forEach((r, idx) => {
      const date = parseDate(r[c.date], 'DMY');
      if (!date) { skip(R, 'Unreadable date'); return; }
      const qty = parseNum(r[c.qty], dec);
      const pr = moneyAt(r, c.price, dec);
      if (!isFinite(qty) || qty === 0 || !isFinite(pr.v)) { skip(R, 'Missing quantity/price'); return; }
      const loc = moneyAt(r, c.local, dec), val = moneyAt(r, c.value, dec), tot = moneyAt(r, c.total, dec);
      const fee = moneyAt(r, c.fee, dec), afx = moneyAt(r, c.autofx, dec);
      let fx = parseNum(r[c.fx], dec);
      const cur = pr.c || loc.c || 'EUR';
      let mult = 1;
      if (isFinite(loc.v) && pr.v > 0 && Math.abs(Math.abs(loc.v) - Math.abs(qty * pr.v * 100)) < Math.abs(qty * pr.v) * 0.5) mult = 100;
      if (!(fx > 0)) fx = cur === 'EUR' ? 1 : (isFinite(loc.v) && isFinite(val.v) && val.v !== 0 ? Math.abs(loc.v / val.v) : NaN);
      const isin = (r[c.isin] || '').trim();
      const name = PT.cleanName(r[c.product]);
      const orderId = c.order >= 0 ? (r[c.order] || '').trim() : '';
      const time = c.time >= 0 ? (r[c.time] || '').trim() : '';
      const feeEUR = Math.abs(isFinite(fee.v) ? fee.v : 0) + Math.abs(isFinite(afx.v) ? afx.v : 0);
      const ex = (r[c.ref] || '').trim();
      const p = { date, qty, price: pr.v, cur, fx, mult, isin, name, orderId, time, feeEUR, ex, total: tot.v, idx };
      if (pr.v === 0 && (!isFinite(tot.v) || tot.v === 0)) { const k = isin + '|' + date; (zero[k] = zero[k] || []).push(p); return; }
      parsed.push(p);
    });
    // Zero-price rows: DEGIRO "product change" (tradeable ↔ non-tradeable) pairs net to zero → drop.
    Object.values(zero).forEach(list => {
      const net = list.reduce((s, p) => s + p.qty, 0);
      if (Math.abs(net) < 1e-9) { list.forEach(() => skip(R, 'Product change (zero-price pair)')); return; }
      list.forEach(p => { p.zeroCost = true; parsed.push(p); });
      R.warnings.push(`${list[0].name}: zero-price rows that do not net out were imported as zero-cost lots (e.g. spin-off / bonus shares).`);
    });
    parsed.sort((a, b) => a.idx - b.idx);
    // DEGIRO lists newest first → reverse so file order is chronological for same-day sequencing
    if (parsed.length > 1 && parsed[0].date > parsed[parsed.length - 1].date) parsed.reverse();
    const transferHeuristic = opts.degiroTransfers !== false;
    parsed.forEach((p, i) => {
      const key = p.isin ? 'ISIN:' + p.isin : 'NAME:' + PT.nameKey(p.name);
      const isOpt = p.mult === 100 || /\b(call|put)\b|\s[CP]\d/i.test(p.name);
      proto(R, key, { isin: p.isin, name: p.name, ticker: PT.guessTicker(p.name, p.isin), currency: p.cur, exchange: PT.DEGIRO_EXCHANGES[p.ex] || p.ex, type: isOpt ? 'option' : (/\bETF\b|UCITS/i.test(p.name) ? 'etf' : 'stock'), multiplier: p.mult });
      let type = p.qty > 0 ? 'buy' : 'sell';
      if (transferHeuristic && !p.orderId && !p.zeroCost && (p.time === '00:00' || p.time === '') && p.feeEUR === 0) type = p.qty > 0 ? 'transfer_in' : 'transfer_out';
      R.trades.push({ key, date: p.date, type, qty: Math.abs(p.qty), price: p.price, currency: p.cur, fx: p.fx, fee: p.feeEUR, broker: 'DEGIRO', extId: p.orderId || '', seq: i, note: type.startsWith('transfer') ? 'Broker transfer (no order ID)' : '' });
    });
    const nT = R.trades.filter(t => t.type.startsWith('transfer')).length;
    if (nT) R.notes.push(`${nT} row(s) without an order ID at 00:00 were classified as broker transfers (cost basis is carried over, not realised).`);
    return R;
  };

  /* ====================================================== DEGIRO account */
  PT.classifyDegiroCash = function (desc, amount) {
    const d = String(desc || '').toLowerCase();
    if (/reserv|sweep|cash account|geldmarkt|money ?market|flatex.*konto|überweisung auf ihr|transfer (from|to) your/.test(d)) return 'skip:Internal cash sweep / reservation';
    if (/^(kauf|verkauf|buy|sell|koop|verkoop)\b/.test(d)) return 'skip:Trade cash (in Transactions file)';
    if (/transaktionsgeb|transaction fee|transactiekosten|transaktionskosten|courtage|handelskosten/.test(d)) return 'skip:Trade fee (in Transactions file)';
    if (/währungswechsel|wahrungswechsel|fx (credit|debit)|valuta (creditering|debitering)|currency exchange|autofx|fx withdrawal|fx deposit/.test(d)) return 'skip:FX conversion leg';
    if (/produktänderung|product change|übertrag|ubertrag|transfer of|productwijziging|stock transfer|isin-änderung|isin change/.test(d)) return 'skip:Product change / securities transfer';
    if (/dividendensteuer|dividend tax|dividendbelasting|quellensteuer|withholding/.test(d)) return 'tax';
    if (/kapitalrückzahlung|return of capital|kapitaalsuitkering/.test(d)) return 'dividend';
    if (/dividend/.test(d)) return 'dividend';
    if (/auszahlung|withdrawal|terugstorting|opname/.test(d)) return 'withdrawal';
    if (/einzahlung|deposit|storting|ideal|sofort|sepa|überweisung|gutschrift/.test(d)) return amount < 0 ? 'withdrawal' : 'deposit';
    if (/zinsen|interest|rente/.test(d)) return 'interest';
    if (/steuer|tax|belasting/.test(d)) return 'tax';
    if (/geb(ü|u)hr|fee|kosten|costs|einrichtung von handelsmodalit|connect|aansluiting|realtime|abonnement|subscription/.test(d)) return 'fee';
    return 'skip:Unrecognised description';
  };
  PT.importDegiroAccount = function (rows, opts) {
    const R = result('degiro-account', PT.FORMAT_LABELS['degiro-account']);
    const hi = PT.findHeaderRow(rows);
    const H = rows[hi].map(x => String(x || '').trim());
    const body = rows.slice(hi + 1);
    const dec = opts.decimal || detectDecimal(body.flatMap(r => r.slice(6)));
    const c = {
      date: findCol(H, /^(date|datum)$/i), vdate: findCol(H, /value date|valutadatum/i), product: findCol(H, /^(product|produkt)$/i),
      isin: findCol(H, /^isin$/i), desc: findCol(H, /description|beschreibung|omschrijving/i), fx: findCol(H, /^fx$/i),
      change: findCol(H, /^(change|änderung|mutatie|anderung)$/i), order: findCol(H, /order/i)
    };
    if (c.date < 0 || c.desc < 0 || c.change < 0) { R.warnings.push('Could not find the DEGIRO account columns.'); R.needsMapping = true; return R; }
    const unknown = new Set();
    body.forEach(r => {
      const date = parseDate(r[c.vdate >= 0 && r[c.vdate] ? c.vdate : c.date], 'DMY') || parseDate(r[c.date], 'DMY');
      if (!date) return;
      const m = moneyAt(r, c.change, dec);
      if (!isFinite(m.v) || m.v === 0) { skip(R, 'Zero amount'); return; }
      const desc = r[c.desc] || '';
      const cls = PT.classifyDegiroCash(desc, m.v);
      if (cls.startsWith('skip:')) { skip(R, cls.slice(5)); if (cls === 'skip:Unrecognised description') unknown.add(desc); return; }
      const isin = c.isin >= 0 ? (r[c.isin] || '').trim() : '';
      let key = null;
      if (isin && (cls === 'dividend' || cls === 'tax')) {
        key = 'ISIN:' + isin;
        proto(R, key, { isin, name: PT.cleanName(r[c.product]), ticker: PT.guessTicker(r[c.product], isin), currency: m.c || 'EUR' });
      }
      let amount = m.v;
      if (cls === 'withdrawal') amount = -Math.abs(amount);
      if (cls === 'deposit') amount = Math.abs(amount);
      R.cash.push({ key, date, type: cls, amount, currency: m.c || 'EUR', fx: null, broker: 'DEGIRO', note: desc });
    });
    if (unknown.size) R.warnings.push('Unrecognised descriptions (skipped): ' + [...unknown].slice(0, 6).join(' · '));
    return R;
  };

  /* ======================================================= IBKR sections */
  function sections(rows) {
    const out = {};
    let cur = null;
    rows.forEach(r => {
      if (r[1] === 'Header') { cur = { header: r.slice(2), rows: [] }; (out[r[0]] = out[r[0]] || []).push(cur); }
      else if (r[1] === 'Data' && cur && out[r[0]]) {
        const blk = out[r[0]][out[r[0]].length - 1];
        const o = {}; blk.header.forEach((h, i) => { o[h.trim()] = r[i + 2]; });
        blk.rows.push(o);
      }
    });
    return out;
  }
  const ibDate = s => parseDate(String(s || '').split(',')[0].trim(), 'YMD');
  const descSymIsin = d => { const m = String(d || '').match(/^([A-Z0-9.\- ]+?)\s?\(([A-Z]{2}[A-Z0-9]{9}\d)\)/); return m ? { sym: m[1].trim(), isin: m[2] } : null; };

  PT.importIbkrActivity = function (rows, opts) {
    const R = result('ibkr-activity', PT.FORMAT_LABELS['ibkr-activity']);
    const S = sections(rows);
    const all = name => (S[name] || []).flatMap(b => b.rows);
    // Instrument info
    const info = {};
    all('Financial Instrument Information').forEach(o => {
      if (!o.Symbol) return;
      info[o.Symbol] = { name: o.Description, isin: /^[A-Z]{2}[A-Z0-9]{9}\d$/.test(o['Security ID'] || '') ? o['Security ID'] : '', mult: parseNum(o.Multiplier) || 1, ex: o['Listing Exch'] || '', cat: o['Asset Category'] };
    });
    const instKey = (sym, cur, cat) => {
      if (/option/i.test(cat || '')) { const p = optionProto(R, sym, cur); if (p) return p.key; }
      const inf = info[sym] || {};
      const key = 'TICKER:' + sym;
      proto(R, key, { ticker: sym, name: inf.name || sym, isin: inf.isin || '', currency: cur, exchange: inf.ex || '', type: /warrant/i.test(cat || '') ? 'warrant' : (/etf|fund/i.test(cat || '') ? 'etf' : 'stock'), multiplier: inf.mult || 1 });
      return key;
    };
    let seq = 0;
    all('Trades').forEach(o => {
      const disc = o.DataDiscriminator;
      if (disc && !/^(order|trade)$/i.test(disc)) return;
      const cat = o['Asset Category'] || '';
      if (/^total/i.test(o['Asset Category'] || '') || /^total/i.test(o.Currency || '')) return;
      if (/forex/i.test(cat)) {
        const comm = parseNum(o['Comm in EUR'] || o['Comm/Fee']);
        if (comm) R.cash.push({ key: null, date: ibDate(o['Date/Time']), type: 'fee', amount: -Math.abs(comm), currency: 'EUR', fx: 1, broker: 'IBKR', note: 'FX conversion commission ' + (o.Symbol || '') });
        skip(R, 'Forex conversions (commission kept as fee)');
        return;
      }
      const date = ibDate(o['Date/Time']);
      const qty = parseNum(o.Quantity), price = parseNum(o['T. Price'] || o.Price), cur = o.Currency;
      if (!date || !isFinite(qty) || qty === 0) { skip(R, 'Unreadable trade row'); return; }
      const key = instKey(o.Symbol, cur, cat);
      const comm = Math.abs(parseNum(o['Comm/Fee']) || 0);
      R.trades.push({ key, date, type: qty > 0 ? 'buy' : 'sell', qty: Math.abs(qty), price, currency: cur, fx: null, feeLocal: comm, broker: 'IBKR', seq: seq++, note: o.Code || '' });
    });
    const cashSec = (name, type) => all(name).forEach(o => {
      if (!o.Currency || /^total/i.test(o.Currency) || /^total/i.test(o.Description || '')) return;
      const date = ibDate(o.Date || o['Settle Date']);
      const amount = parseNum(o.Amount);
      if (!date || !isFinite(amount) || amount === 0) return;
      let t = type;
      if (type === 'depwd') t = amount > 0 ? 'deposit' : 'withdrawal';
      let key = null;
      const si = descSymIsin(o.Description);
      if (si && (t === 'dividend' || t === 'tax')) {
        key = info[si.sym] ? instKey(si.sym, o.Currency, info[si.sym].cat) : 'ISIN:' + si.isin;
        proto(R, key, { isin: si.isin, ticker: si.sym, currency: o.Currency, name: (info[si.sym] || {}).name || si.sym });
      }
      R.cash.push({ key, date, type: t, amount, currency: o.Currency, fx: o.Currency === 'EUR' ? 1 : null, broker: 'IBKR', note: o.Description || '' });
    });
    cashSec('Dividends', 'dividend');
    cashSec('Payment In Lieu Of Dividends', 'dividend');
    cashSec('Withholding Tax', 'tax');
    cashSec('Deposits & Withdrawals', 'depwd');
    cashSec('Interest', 'interest');
    cashSec('Fees', 'fee');
    all('Transfers').forEach(o => {
      if (!o.Symbol || /^total/i.test(o['Asset Category'] || '')) return;
      const date = ibDate(o.Date), qty = parseNum(o.Qty);
      if (!date || !isFinite(qty) || !qty) return;
      const key = instKey(o.Symbol, o.Currency, o['Asset Category']);
      const dir = /out/i.test(o.Direction || '') || qty < 0 ? 'transfer_out' : 'transfer_in';
      R.trades.push({ key, date, type: dir, qty: Math.abs(qty), price: parseNum(o['Xfer Price']) || 0, currency: o.Currency, fx: null, fee: 0, broker: 'IBKR', seq: seq++, note: 'Transfer ' + (o['Xfer Company'] || '') });
    });
    all('Corporate Actions').forEach(o => {
      const m = String(o.Description || '').match(/split\s+(\d+(?:\.\d+)?)\s+for\s+(\d+(?:\.\d+)?)/i);
      if (!m) { if (o.Description && !/^total/i.test(o['Asset Category'] || '')) skip(R, 'Corporate action (not a split)'); return; }
      const si = descSymIsin(o.Description);
      const sym = si ? si.sym : (o.Symbol || '');
      const key = instKey(sym, o.Currency, 'Stocks');
      R.trades.push({ key, date: ibDate(o['Date/Time'] || o['Report Date']), type: 'split', qty: 0, price: 0, ratio: +m[1] / +m[2], currency: o.Currency, fx: 1, fee: 0, broker: 'IBKR', seq: seq++, note: o.Description });
    });
    if (R.trades.some(t => t.fx == null && t.currency !== 'EUR')) R.notes.push('The Activity Statement has no per-trade FX rate — the app uses its FX history (rates from other imports or Data → FX rates). For exact EUR amounts import the Transaction History or a Flex Query with FXRateToBase.');
    return R;
  };

  /* ================================================= IBKR transaction history */
  PT.importIbkrHistory = function (rows, opts) {
    const R = result('ibkr-history', PT.FORMAT_LABELS['ibkr-history']);
    let recs = [];
    if (rows.some(r => r[0] === 'Transaction History' && r[1] === 'Header')) {
      recs = (sections(rows)['Transaction History'] || []).flatMap(b => b.rows);
      const sum = (sections(rows).Summary || []).flatMap(b => b.rows);
      const base = sum.find(o => o['Base Currency']);
      if (base && base['Base Currency'] !== 'EUR') R.warnings.push('Base currency of this statement is ' + base['Base Currency'] + ', amounts are assumed to be EUR.');
    } else {
      const hi = PT.findHeaderRow(rows);
      const H = rows[hi].map(h => h.trim());
      recs = rows.slice(hi + 1).map(r => { const o = {}; H.forEach((h, i) => { o[h] = r[i]; }); return o; });
    }
    const g = (o, re) => { const k = Object.keys(o).find(k => re.test(k.trim())); return k ? o[k] : ''; };
    let seq = 0;
    // Newest-first listing → process oldest first so same-day order is chronological
    const list = recs.slice().reverse();
    list.forEach(o => {
      const date = parseDate(g(o, /^date$/i), 'YMD');
      const type = String(g(o, /^transaction type$/i) || '').trim();
      if (!date || !type) return;
      const sym = String(g(o, /^symbol$/i) || '').trim();
      const desc = String(g(o, /^description$/i) || '').replace(/\s+/g, ' ').trim();
      const qty = parseNum(g(o, /^quantity$/i)), price = parseNum(g(o, /^price$/i)), pcur = String(g(o, /^price currency$/i) || '').trim();
      const gross = parseNum(g(o, /^gross amount/i)), comm = parseNum(g(o, /^commission/i)), net = parseNum(g(o, /^net amount/i));
      const amt = isFinite(net) ? net : gross;
      const T = type.toLowerCase();
      if (T === 'buy' || T === 'sell') {
        if (!isFinite(qty) || !qty) { skip(R, 'Trade without quantity'); return; }
        let key;
        const op = optionProto(R, sym, pcur, 'IBKR', desc);
        if (op) key = op.key;
        else { key = 'TICKER:' + sym; proto(R, key, { ticker: sym, name: desc, currency: pcur, type: 'stock', multiplier: 1 }); }
        const mult = R.protos[key].multiplier || 1;
        const fx = pcur === 'EUR' ? 1 : (isFinite(gross) && gross !== 0 && price > 0 ? Math.abs(qty * price * mult / gross) : null);
        R.trades.push({ key, date, type: qty > 0 ? 'buy' : 'sell', qty: Math.abs(qty), price, currency: pcur, fx, fee: Math.abs(comm || 0), broker: 'IBKR', seq: seq++, note: '' });
        return;
      }
      if (!isFinite(amt) || amt === 0) { skip(R, 'Zero amount'); return; }
      let cls = null, key = null;
      if (T === 'dividend' || T === 'payment in lieu of dividends') cls = 'dividend';
      else if (/withholding/.test(T)) cls = 'tax';
      else if (T === 'deposit') cls = 'deposit';
      else if (T === 'withdrawal') cls = 'withdrawal';
      else if (/interest/.test(T)) cls = 'interest';
      else if (/fee|sales tax|commission adj/.test(T)) cls = 'fee';
      else if (/forex trade component/.test(T)) cls = 'fee';
      else if (/adjustment/.test(T)) cls = 'fxadj';
      if (!cls) { skip(R, 'Unsupported type: ' + type); return; }
      if ((cls === 'dividend' || cls === 'tax') && sym && sym !== '-') {
        const si = descSymIsin(desc);
        key = 'TICKER:' + sym;
        proto(R, key, { ticker: sym, isin: si ? si.isin : '', name: sym });
      }
      R.cash.push({ key, date, type: cls, amount: cls === 'withdrawal' ? -Math.abs(amt) : (cls === 'deposit' ? Math.abs(amt) : amt), currency: 'EUR', fx: 1, broker: 'IBKR', note: (/forex/.test(T) ? 'FX conversion: ' : '') + desc });
    });
    R.notes.push('Amounts in this report are in your base currency (EUR); per-trade FX rates were derived as local value ÷ EUR gross amount.');
    return R;
  };

  /* ====================================================== IBKR flex query */
  PT.importIbkrFlex = function (rows, opts) {
    const R = result('ibkr-flex', PT.FORMAT_LABELS['ibkr-flex']);
    const hi = PT.findHeaderRow(rows);
    const H = rows[hi].map(h => h.trim());
    const col = n => H.findIndex(h => h.toLowerCase() === n.toLowerCase());
    const ix = { sym: col('Symbol'), desc: col('Description'), isin: col('ISIN'), cur: col('CurrencyPrimary') >= 0 ? col('CurrencyPrimary') : col('Currency'), fx: col('FXRateToBase'), cat: col('AssetClass'), mult: col('Multiplier'), date: col('TradeDate') >= 0 ? col('TradeDate') : col('DateTime'), qty: col('Quantity'), price: col('TradePrice'), comm: col('IBCommission'), commCur: col('IBCommissionCurrency'), bs: col('Buy/Sell'), ex: col('ListingExchange') };
    let seq = 0;
    rows.slice(hi + 1).forEach(r => {
      if (r[0] === H[0]) return; // repeated header
      const date = parseDate(r[ix.date], 'YMD');
      const qty = parseNum(r[ix.qty]);
      if (!date || !isFinite(qty) || !qty) { skip(R, 'Not a trade row'); return; }
      const cat = r[ix.cat] || 'STK';
      if (/CASH/i.test(cat)) { skip(R, 'Forex conversions'); return; }
      const cur = r[ix.cur] || 'USD';
      const sym = r[ix.sym];
      let key;
      if (/OPT/i.test(cat)) { const p = optionProto(R, sym, cur, 'IBKR', r[ix.desc]); key = p ? p.key : null; }
      if (!key) { key = 'TICKER:' + sym; proto(R, key, { ticker: sym, name: r[ix.desc] || sym, isin: r[ix.isin] || '', currency: cur, exchange: r[ix.ex] || '', type: /WAR/i.test(cat) ? 'warrant' : 'stock', multiplier: parseNum(r[ix.mult]) || 1 }); }
      const fxb = parseNum(r[ix.fx]);
      const fx = cur === 'EUR' ? 1 : (fxb > 0 ? 1 / fxb : null);
      const comm = Math.abs(parseNum(r[ix.comm]) || 0);
      const commCur = r[ix.commCur] || cur;
      const t = { key, date, type: qty > 0 ? 'buy' : 'sell', qty: Math.abs(qty), price: parseNum(r[ix.price]), currency: cur, fx, broker: 'IBKR', seq: seq++ };
      if (commCur === 'EUR') t.fee = comm; else t.feeLocal = comm;
      R.trades.push(t);
    });
    return R;
  };

  /* ========================================================= generic CSV */
  PT.GENERIC_FIELDS = {
    trades: [
      { k: 'date', label: 'Date', req: true, re: /^(trade ?)?date|datum|^tag$|date\/time|datetime/i },
      { k: 'ticker', label: 'Ticker / symbol', req: true, re: /ticker|symbol|^wkn$|^code$/i },
      { k: 'name', label: 'Name / product', re: /^name$|product|produkt|description|bezeichnung|security|wertpapier/i },
      { k: 'isin', label: 'ISIN', re: /^isin$/i },
      { k: 'exchange', label: 'Exchange', re: /exchange|börse|venue|market/i },
      { k: 'side', label: 'Buy/Sell column', re: /^(buy\/sell|side|type|action|transaction|typ|art|richtung)$/i },
      { k: 'qty', label: 'Quantity', req: true, re: /quantity|qty|shares|anzahl|stück|units|amount of shares/i },
      { k: 'price', label: 'Price', req: true, re: /^(price|kurs|preis|trade ?price|unit price)/i },
      { k: 'currency', label: 'Currency', re: /currency|währung|ccy|cur$/i },
      { k: 'fee', label: 'Fees', re: /fee|commission|gebühr|kosten|comm/i },
      { k: 'fx', label: 'FX rate (local per EUR)', re: /fx|exchange rate|wechselkurs|devisenkurs/i },
      { k: 'broker', label: 'Broker', re: /broker|account|depot/i }
    ],
    cash: [
      { k: 'date', label: 'Date', req: true, re: /date|datum/i },
      { k: 'type', label: 'Type', req: true, re: /type|typ|art|description|beschreibung/i },
      { k: 'amount', label: 'Amount', req: true, re: /amount|betrag|value|wert|change/i },
      { k: 'currency', label: 'Currency', re: /currency|währung|ccy/i },
      { k: 'ticker', label: 'Ticker (dividends)', re: /ticker|symbol/i },
      { k: 'wht', label: 'Withholding tax', re: /withholding|quellensteuer|tax|steuer/i },
      { k: 'broker', label: 'Broker', re: /broker|account|depot/i }
    ]
  };
  PT.guessMapping = function (headers, kind) {
    const map = {};
    const used = new Set();
    PT.GENERIC_FIELDS[kind].forEach(f => {
      const i = headers.findIndex((h, j) => !used.has(j) && f.re.test(String(h || '').trim()));
      if (i >= 0) { map[f.k] = i; used.add(i); }
    });
    return map;
  };
  PT.importGeneric = function (rows, opts) {
    const kind = opts.kind || 'trades';
    const R = result('generic', PT.FORMAT_LABELS.generic);
    const hi = opts.headerRow != null ? opts.headerRow : PT.findHeaderRow(rows);
    const H = rows[hi] || [];
    R.headers = H; R.headerRow = hi; R.kind = kind;
    const map = opts.mapping || PT.guessMapping(H, kind);
    R.mapping = map;
    const missing = PT.GENERIC_FIELDS[kind].filter(f => f.req && map[f.k] == null).map(f => f.label);
    if (missing.length) { R.needsMapping = true; R.warnings.push('Please map: ' + missing.join(', ')); return R; }
    const body = rows.slice(hi + 1);
    const dec = opts.decimal || detectDecimal(body.flatMap(r => [r[map.qty], r[map.price], r[map.amount], r[map.fee]]));
    const dfmt = opts.dateFmt && opts.dateFmt !== 'auto' ? opts.dateFmt : detectDateFmt(body.map(r => r[map.date]));
    const get = (r, k) => map[k] == null ? '' : (r[map[k]] || '').trim();
    let seq = 0;
    body.forEach(r => {
      const date = parseDate(get(r, 'date'), dfmt);
      if (!date) { skip(R, 'Unreadable date'); return; }
      if (kind === 'trades') {
        let qty = parseNum(get(r, 'qty'), dec);
        const price = parseNum(get(r, 'price'), dec);
        if (!isFinite(qty) || !qty || !isFinite(price)) { skip(R, 'Missing quantity/price'); return; }
        const sideS = get(r, 'side').toLowerCase();
        let type = qty > 0 ? 'buy' : 'sell';
        if (/sell|verkauf|^s$|verkoop|short/.test(sideS)) type = 'sell';
        else if (/buy|kauf|^b$|koop/.test(sideS)) type = 'buy';
        else if (/split/.test(sideS)) type = 'split';
        const ticker = get(r, 'ticker').toUpperCase(), isin = get(r, 'isin').toUpperCase(), cur = (get(r, 'currency') || 'EUR').toUpperCase().slice(0, 3);
        const op = PT.parseOption(ticker);
        let key;
        if (op) key = optionProto(R, ticker, cur).key;
        else { key = isin ? 'ISIN:' + isin : 'TICKER:' + ticker; proto(R, key, { ticker: ticker || PT.guessTicker(get(r, 'name'), isin), name: get(r, 'name') || ticker, isin, currency: cur, exchange: get(r, 'exchange') }); }
        const fx = parseNum(get(r, 'fx'), dec);
        R.trades.push({ key, date, type, qty: Math.abs(qty), price, currency: cur, fx: cur === 'EUR' ? 1 : (fx > 0 ? fx : null), fee: Math.abs(parseNum(get(r, 'fee'), dec) || 0), broker: get(r, 'broker') || opts.broker || 'Manual', seq: seq++ });
      } else {
        const amount = parseNum(get(r, 'amount'), dec);
        if (!isFinite(amount) || !amount) { skip(R, 'Zero amount'); return; }
        const tS = get(r, 'type');
        let type = PT.classifyDegiroCash(tS, amount);
        if (type.startsWith('skip:')) { const t = tS.toLowerCase(); type = PT.CASH_TYPES.find(x => t.includes(x)) || null; }
        if (!type) { skip(R, 'Unknown type'); return; }
        const ticker = get(r, 'ticker').toUpperCase();
        let key = null;
        if (ticker && (type === 'dividend' || type === 'tax')) { key = 'TICKER:' + ticker; proto(R, key, { ticker, name: ticker }); }
        const cur = (get(r, 'currency') || 'EUR').toUpperCase().slice(0, 3);
        R.cash.push({ key, date, type, amount: type === 'withdrawal' ? -Math.abs(amount) : amount, currency: cur, fx: cur === 'EUR' ? 1 : null, wht: Math.abs(parseNum(get(r, 'wht'), dec) || 0), broker: get(r, 'broker') || opts.broker || 'Manual' });
      }
    });
    return R;
  };

  /* ================================================ apply import to state */
  PT.findInstrument = function (state, p) {
    const I = state.instruments;
    if (p.isin) { const m = I.find(i => i.isin && i.isin === p.isin); if (m) return { inst: m, how: 'ISIN' }; }
    { const m = I.find(i => (i.aliases || []).includes(p.key)); if (m) return { inst: m, how: 'alias' }; }
    if (p.type === 'option') { const m = I.find(i => i.type === 'option' && i.ticker === p.ticker); return m ? { inst: m, how: 'option' } : null; }
    if (p.ticker && p.key.startsWith('TICKER:')) {
      const m = I.find(i => i.ticker && i.ticker.toUpperCase() === p.ticker.toUpperCase() && (!p.currency || !i.currency || i.currency === p.currency));
      if (m) return { inst: m, how: 'ticker' };
    }
    const nk = PT.nameKey(p.name);
    if (nk && nk.length >= 4) {
      const m = I.find(i => i.type !== 'option' && PT.nameKey(i.name) === nk && (!p.currency || !i.currency || i.currency === p.currency));
      if (m) return { inst: m, how: 'name' };
    }
    return null;
  };
  PT.makeInstrument = function (p) {
    return {
      id: PT.uid('i'), ticker: p.ticker || PT.guessTicker(p.name, p.isin), name: p.name || p.ticker, isin: p.isin || '', currency: p.currency || 'EUR',
      exchange: p.exchange || '', type: p.type || 'stock', multiplier: p.multiplier || (p.type === 'option' ? 100 : 1),
      expiry: p.expiry || null, strike: p.strike || null, right: p.right || null, underlying: p.underlying || null,
      country: PT.countryFor(p.isin, p.currency), sector: '', tags: [], aliases: [p.key]
    };
  };
  function tradeKey(t) { return [t.date, t.instId, t.type, (+t.qty).toFixed(6), (+t.price || 0).toFixed(6), t.broker || ''].join('|'); }
  function cashKey(c) { return [c.date, c.type, (+c.amount).toFixed(2), c.currency, c.instId || '', c.broker || ''].join('|'); }
  PT.tradeKey = tradeKey; PT.cashKey = cashKey;

  /** Mutates state. Returns a summary. */
  PT.applyImport = function (state, R, opts) {
    opts = opts || {};
    const sum = { instrumentsNew: 0, linked: [], trades: 0, cash: 0, duplicates: 0 };
    const keyToId = {};
    Object.values(R.protos).forEach(p => {
      const f = PT.findInstrument(state, p);
      if (f) {
        keyToId[p.key] = f.inst.id;
        f.inst.aliases = Array.from(new Set([...(f.inst.aliases || []), p.key]));
        if (!f.inst.isin && p.isin) f.inst.isin = p.isin;
        if (f.how === 'name' || (f.how === 'ISIN' && p.key.startsWith('TICKER:'))) sum.linked.push(`${p.name || p.ticker} → ${f.inst.ticker}`);
        if (p.key.startsWith('TICKER:') && f.inst.ticker !== p.ticker && f.how !== 'ticker' && p.type !== 'option' && /^(ISIN|NAME):/.test((f.inst.aliases || [])[0] || '') && !f.inst.userTicker) {
          f.inst.ticker = p.ticker; // a broker symbol beats a guessed ticker
        }
        if (p.currency && p.key.startsWith('TICKER:') && !f.inst.userCurrency) f.inst.currency = p.currency;
      } else {
        const inst = PT.makeInstrument(p);
        state.instruments.push(inst);
        keyToId[p.key] = inst.id;
        sum.instrumentsNew++;
      }
    });
    const have = {};
    state.transactions.forEach(t => { const k = tradeKey(t); have[k] = (have[k] || 0) + 1; });
    state.cash.forEach(c => { const k = cashKey(c); have[k] = (have[k] || 0) + 1; });
    const src = opts.source || R.format;
    const batch = PT.uid('b');
    R.trades.forEach(t => {
      const inst = state.instruments.find(i => i.id === keyToId[t.key]);
      const rec = {
        id: PT.uid('t'), date: t.date, instId: keyToId[t.key], type: t.type, qty: t.qty, price: t.price || 0, currency: t.currency || (inst && inst.currency) || 'EUR',
        fx: t.fx > 0 ? t.fx : null, fee: t.fee || 0, broker: t.broker || '', note: t.note || '', src, batch, seq: t.seq, extId: t.extId || ''
      };
      if (t.ratio) rec.ratio = t.ratio;
      if (t.feeLocal) rec.feeLocal = t.feeLocal; // converted to EUR once FX is known (see normalizeFees)
      const k = tradeKey(rec);
      if (have[k] > 0) { have[k]--; sum.duplicates++; return; }
      state.transactions.push(rec); sum.trades++;
    });
    R.cash.forEach(c => {
      const rec = { id: PT.uid('c'), date: c.date, type: c.type, amount: c.amount, currency: c.currency || 'EUR', fx: c.fx > 0 ? c.fx : null, instId: c.key ? keyToId[c.key] || null : null, wht: c.wht || 0, broker: c.broker || '', note: c.note || '', src, batch };
      const k = cashKey(rec);
      if (have[k] > 0) { have[k]--; sum.duplicates++; return; }
      state.cash.push(rec); sum.cash++;
    });
    PT.normalizeFees(state);
    sum.batch = batch;
    return sum;
  };
  /** Convert fees given in trade currency (IBKR Activity) to EUR using the FX history. */
  PT.normalizeFees = function (state) {
    const pending = state.transactions.filter(t => t.feeLocal && !t.fee);
    if (!pending.length) return;
    const r = PT.compute(Object.assign({}, state, { transactions: state.transactions.filter(t => !t.feeLocal || t.fee) }), {});
    pending.forEach(t => {
      const fx = t.fx > 0 ? t.fx : (r.fxAt ? r.fxAt(t.currency, PT.dn(t.date)) : NaN);
      if (fx > 0) { t.fee = t.feeLocal / fx; delete t.feeLocal; }
    });
  };

  /** Merge instrument `fromId` into `toId` (re-points all records). */
  PT.mergeInstruments = function (state, toId, fromId) {
    if (toId === fromId) return;
    const to = state.instruments.find(i => i.id === toId), from = state.instruments.find(i => i.id === fromId);
    if (!to || !from) return;
    state.transactions.forEach(t => { if (t.instId === fromId) t.instId = toId; });
    state.cash.forEach(c => { if (c.instId === fromId) c.instId = toId; });
    if (state.prices[fromId]) {
      state.prices[toId] = (state.prices[toId] || []).concat(state.prices[fromId]).sort((a, b) => a[0] < b[0] ? -1 : 1);
      delete state.prices[fromId];
    }
    to.aliases = Array.from(new Set([...(to.aliases || []), ...(from.aliases || [])]));
    if (!to.isin && from.isin) to.isin = from.isin;
    to.tags = Array.from(new Set([...(to.tags || []), ...(from.tags || [])]));
    state.instruments = state.instruments.filter(i => i.id !== fromId);
  };

  /** Suggest pairs that look like the same security (e.g. DEGIRO name vs IBKR ticker). */
  PT.suggestMerges = function (state) {
    const out = [];
    const I = state.instruments.filter(i => i.type !== 'option');
    for (let a = 0; a < I.length; a++) for (let b = a + 1; b < I.length; b++) {
      const x = I[a], y = I[b];
      if (x.isin && y.isin && x.isin !== y.isin) continue;
      const same = (x.isin && x.isin === y.isin) || (PT.nameKey(x.name) && PT.nameKey(x.name) === PT.nameKey(y.name)) || (x.ticker && x.ticker.toUpperCase() === y.ticker.toUpperCase());
      if (same) out.push([x, y]);
    }
    return out;
  };

  /** Parse "TICKER price [date]" lines or JSON {"NVDA": 182.1} / [{ticker, price, date}] */
  PT.parsePriceInput = function (text) {
    const out = [];
    const t = String(text || '').trim();
    if (!t) return out;
    if (/^[[{]/.test(t)) {
      const j = JSON.parse(t);
      if (Array.isArray(j)) j.forEach(o => out.push({ ticker: String(o.ticker || o.symbol || '').trim(), price: +o.price || +o.close || +o.last, date: o.date || null, currency: o.currency || null }));
      else Object.keys(j).forEach(k => { const v = j[k]; if (typeof v === 'object' && v) out.push({ ticker: k, price: +v.price || +v.close, date: v.date || null, currency: v.currency || null }); else out.push({ ticker: k, price: +v, date: null }); });
      return out.filter(o => o.ticker && o.price >= 0);
    }
    PT.parseCSV(t).forEach(r => {
      if (r.length === 1) r = r[0].split(/\s+/);
      if (r.length < 2) return;
      const d = parseDate(r[0]);
      if (d && r.length >= 3) out.push({ ticker: r[1].trim(), price: parseNum(r[2]), date: d });
      else out.push({ ticker: r[0].trim(), price: parseNum(r[1]), date: r[2] ? parseDate(r[2]) : null });
    });
    return out.filter(o => o.ticker && isFinite(o.price));
  };
  /** "date,value" series (benchmarks / price history / FX). Accepts Yahoo-style CSV (Date,Open,High,Low,Close,Adj Close). */
  PT.parseSeriesInput = function (text) {
    const rows = PT.parseCSV(text);
    if (!rows.length) return [];
    let vi = 1;
    const h = rows[0].map(x => String(x).toLowerCase());
    const hasHeader = !parseDate(rows[0][0]);
    if (hasHeader) { const ci = h.findIndex(x => x === 'close' || x === 'schluss' || x === 'value' || x === 'price' || x === 'rate'); if (ci >= 0) vi = ci; }
    const dfmt = detectDateFmt(rows.map(r => r[0]));
    const body = hasHeader ? rows.slice(1) : rows;
    const dec = detectDecimal(body.map(r => r[vi]));
    return body.map(r => [parseDate(r[0], dfmt), parseNum(r[vi], dec)]).filter(o => o[0] && isFinite(o[1]) && o[1] > 0).sort((a, b) => a[0] < b[0] ? -1 : 1);
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = PT;
})(typeof window !== 'undefined' ? window : globalThis);
