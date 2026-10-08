/* =====================================================================
 * Data views & forms: activity, manual entry, CSV import + mapping,
 * prices, FX, benchmarks, instruments, backup, settings, checks.
 * ===================================================================== */
(function () {
  'use strict';
  const PT = window.PT, App = window.App, F = App.F, esc = F.esc, icon = App.icon, tip = App.tip;
  const V = App.views;
  const CCYS = ['EUR', 'USD', 'KRW', 'TWD', 'JPY', 'SEK', 'CAD', 'HKD', 'GBP', 'CHF', 'DKK', 'NOK', 'AUD', 'CNY', 'SGD'];
  const BROKERS = ['DEGIRO', 'IBKR'];
  const num = s => F.parseIn(s);
  const today = () => (App.res && !App.res.empty ? App.res.asOfISO : PT.todayISO());
  const ccyOptions = (sel) => CCYS.concat(CCYS.includes(sel) || !sel ? [] : [sel]).map(c => `<option ${c === sel ? 'selected' : ''}>${c}</option>`).join('');
  const brokerList = () => [...new Set([...BROKERS, ...App.state.transactions.map(t => t.broker), ...App.state.cash.map(c => c.broker)].filter(Boolean))];
  const fmtIn = v => (v == null || v === '' || !isFinite(v)) ? '' : String(+(+v).toFixed(8)).replace('.', App.state.settings.locale === 'en' ? '.' : ',');
  const latestFx = (cur, date) => { if (cur === 'EUR') return 1; const r = App.res; if (!r || !r.fxAt) return NaN; const v = r.fxAt(cur, PT.dn(date || today())); return v; };

  /* ================================================================ forms */
  App.tradeForm = function (tx, presetInst) {
    const editing = !!tx;
    const inst = tx ? App.instById(tx.instId) : presetInst || null;
    const t = tx || { date: PT.todayISO(), type: 'buy', qty: '', price: '', currency: inst ? inst.currency : 'USD', fee: '', fx: null, broker: 'IBKR', note: '' };
    const tickers = App.state.instruments.map(i => `<option value="${esc(i.ticker)}">${esc(i.name || '')}</option>`).join('');
    const fx0 = t.fx > 0 ? t.fx : latestFx(t.currency, t.date);
    App.modal(`
      <div class="label" style="margin-bottom:10px">Ledger · trade</div><h2>${editing ? 'Edit transaction' : 'New transaction'}</h2>
      <p class="small muted" style="margin:0 0 16px">Prices in the security’s currency. FX = units of that currency per 1 EUR (e.g. USD 1,16).</p>
      <div class="form-grid">
        <label class="f"><span>Date</span><input type="date" id="tf-date" value="${t.date}"></label>
        <label class="f"><span>Type</span><select id="tf-type">${[['buy', 'Buy'], ['sell', 'Sell (incl. sell-to-open)'], ['split', 'Stock split'], ['transfer_in', 'Transfer in (broker move)'], ['transfer_out', 'Transfer out (broker move)']].map(([v, l]) => `<option value="${v}" ${t.type === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="f"><span>Broker</span><input type="text" id="tf-broker" list="tf-brokers" value="${esc(t.broker || '')}"><datalist id="tf-brokers">${brokerList().map(b => `<option value="${esc(b)}">`).join('')}</datalist></label>
        <label class="f"><span>Ticker <span class="muted">(or OCC option symbol)</span></span><input type="text" id="tf-ticker" list="tf-tickers" value="${esc(inst ? inst.ticker : '')}" placeholder="NVDA · 000660.KS · QQQ 261120P00720000" autocomplete="off"><datalist id="tf-tickers">${tickers}</datalist></label>
      </div>
      <div id="tf-new" class="form-grid hidden" style="margin-top:14px;padding:14px;border:1px dashed var(--border-strong);border-radius:12px">
        <div class="span2 small text-2" style="grid-column:1/-1">New instrument</div>
        <label class="f"><span>Name</span><input type="text" id="tf-name"></label>
        <label class="f"><span>ISIN <span class="muted">(optional)</span></span><input type="text" id="tf-isin"></label>
        <label class="f"><span>Exchange</span><input type="text" id="tf-ex" placeholder="NASDAQ, XETRA, KRX…"></label>
        <label class="f"><span>Kind</span><select id="tf-kind"><option value="stock">Stock</option><option value="etf">ETF</option><option value="option">Option</option><option value="warrant">Warrant</option><option value="other">Other</option></select></label>
        <label class="f"><span>Multiplier</span><input type="text" inputmode="decimal" id="tf-mult" value="1"></label>
      </div>
      <div class="form-grid" style="margin-top:14px" id="tf-trade-fields">
        <label class="f"><span>Quantity</span><input type="text" inputmode="decimal" id="tf-qty" value="${fmtIn(t.qty)}"></label>
        <label class="f"><span>Price per unit</span><input type="text" inputmode="decimal" id="tf-price" value="${fmtIn(t.price)}"></label>
        <label class="f"><span>Currency</span><select id="tf-cur">${ccyOptions(t.currency)}</select></label>
        <label class="f"><span>FX rate <span class="muted">(per 1 EUR)</span></span><input type="text" inputmode="decimal" id="tf-fx" value="${t.currency === 'EUR' ? '1' : fmtIn(fx0)}"></label>
        <label class="f"><span>Fees</span><input type="text" inputmode="decimal" id="tf-fee" value="${fmtIn(t.fee)}" placeholder="0"></label>
        <label class="f"><span>Fee currency</span><select id="tf-feecur"><option value="EUR">EUR</option><option value="LOCAL">Trade currency</option></select></label>
      </div>
      <div class="form-grid hidden" style="margin-top:14px" id="tf-split-fields">
        <label class="f"><span>New shares</span><input type="text" inputmode="decimal" id="tf-rn" value="${t.ratio ? fmtIn(t.ratio) : '2'}"></label>
        <label class="f"><span>for old shares</span><input type="text" inputmode="decimal" id="tf-ro" value="1"></label>
        <div class="small muted" style="align-self:end">e.g. 10-for-1 split → 10 / 1. Reverse split 1-for-5 → 1 / 5.</div>
      </div>
      <label class="f" style="margin-top:14px"><span>Note</span><input type="text" id="tf-note" value="${esc(t.note || '')}"></label>
      <div class="explain" id="tf-preview" style="margin-top:14px"></div>
      <div class="foot"><button class="btn" data-close>Cancel</button><button class="btn primary" id="tf-save">${editing ? 'Save changes' : 'Add transaction'}</button></div>`, m => {
      const $ = id => m.querySelector('#' + id);
      const findInst = () => { const v = $('tf-ticker').value.trim().toUpperCase(); return App.state.instruments.find(i => i.ticker.toUpperCase() === v); };
      const sync = () => {
        const type = $('tf-type').value;
        $('tf-split-fields').classList.toggle('hidden', type !== 'split');
        $('tf-trade-fields').classList.toggle('hidden', type === 'split');
        const ex = findInst();
        const tk = $('tf-ticker').value.trim();
        $('tf-new').classList.toggle('hidden', !!ex || !tk);
        const opt = PT.parseOption(tk);
        if (!ex && opt) { $('tf-kind').value = 'option'; $('tf-mult').value = '100'; if (!$('tf-name').value) $('tf-name').value = PT.optionLabel(opt); }
        const q = num($('tf-qty').value), p = num($('tf-price').value), fx = $('tf-cur').value === 'EUR' ? 1 : num($('tf-fx').value), fee = num($('tf-fee').value) || 0;
        const mult = ex ? (+ex.multiplier || 1) : (num($('tf-mult').value) || 1);
        const feeEur = $('tf-feecur').value === 'LOCAL' ? fee / fx : fee;
        if (type === 'split') $('tf-preview').innerHTML = 'Lots are multiplied by the ratio; cost basis per share is divided by it. Total cost is unchanged.';
        else if (isFinite(q) && isFinite(p) && fx > 0) {
          const gross = q * p * mult / fx;
          $('tf-preview').innerHTML = type.startsWith('transfer') ? `<b>${F.eur(gross)}</b> market value moved between brokers — no cash, no realised P&L. If the matching transfer-out is missing, the lots are treated as a deposit of securities at this price.`
            : `<b>${type === 'buy' ? 'You pay' : 'You receive'} ${F.eur(type === 'buy' ? gross + feeEur : gross - feeEur)}</b> = ${F.qty(q)} × ${F.price(p, $('tf-cur').value)}${mult !== 1 ? ' × ' + mult : ''}${$('tf-cur').value === 'EUR' ? '' : ' ÷ ' + F.fx(fx)} ${type === 'buy' ? '+' : '−'} ${F.eur(feeEur)} fees`;
        } else $('tf-preview').innerHTML = '<span class="muted">Enter quantity, price and FX to see the EUR amount.</span>';
      };
      $('tf-ticker').addEventListener('input', () => { const ex = findInst(); if (ex) { $('tf-cur').value = ex.currency; const f = latestFx(ex.currency, $('tf-date').value); $('tf-fx').value = ex.currency === 'EUR' ? '1' : fmtIn(f); } sync(); });
      $('tf-cur').addEventListener('change', () => { const c = $('tf-cur').value; const f = latestFx(c, $('tf-date').value); $('tf-fx').value = c === 'EUR' ? '1' : (isFinite(f) ? fmtIn(+f.toFixed(4)) : ''); sync(); });
      m.querySelectorAll('input,select').forEach(el => el.addEventListener('input', sync));
      sync();
      $('tf-save').addEventListener('click', () => {
        const type = $('tf-type').value, date = $('tf-date').value, tk = $('tf-ticker').value.trim();
        if (!date || !tk) return App.toast('Date and ticker are required.', true);
        let ex = findInst();
        const cur = $('tf-cur').value;
        const rec = { date, type, broker: $('tf-broker').value.trim(), note: $('tf-note').value.trim(), currency: cur };
        if (type === 'split') {
          const rn = num($('tf-rn').value), ro = num($('tf-ro').value);
          if (!(rn > 0 && ro > 0)) return App.toast('Enter a valid split ratio.', true);
          Object.assign(rec, { qty: 0, price: 0, fee: 0, fx: null, ratio: rn / ro });
        } else {
          const q = num($('tf-qty').value), p = num($('tf-price').value), fx = cur === 'EUR' ? 1 : num($('tf-fx').value), fee = num($('tf-fee').value) || 0;
          if (!(q > 0)) return App.toast('Quantity must be positive (use “Sell” for sales / short sales).', true);
          if (!(p >= 0)) return App.toast('Enter a price (0 for free shares).', true);
          if (!(fx > 0)) return App.toast('Enter the FX rate (units of ' + cur + ' per 1 EUR).', true);
          Object.assign(rec, { qty: q, price: p, fx, fee: Math.abs($('tf-feecur').value === 'LOCAL' ? fee / fx : fee) });
        }
        App.commit(s => {
          if (!ex) {
            const opt = PT.parseOption(tk);
            const p = { key: 'MANUAL:' + tk.toUpperCase(), ticker: opt ? PT.occSymbol(opt.underlying, opt.expiry, opt.right, opt.strike) : tk.toUpperCase(), name: $('tf-name').value.trim() || tk.toUpperCase(), isin: $('tf-isin').value.trim().toUpperCase(), currency: cur, exchange: $('tf-ex').value.trim(), type: $('tf-kind').value, multiplier: num($('tf-mult').value) || 1 };
            if (opt) Object.assign(p, { expiry: opt.expiry, strike: opt.strike, right: opt.right, underlying: opt.underlying, multiplier: num($('tf-mult').value) || 100 });
            ex = PT.makeInstrument(p);
            s.instruments.push(ex);
          }
          rec.instId = ex.id;
          if (editing) Object.assign(s.transactions.find(x => x.id === tx.id), rec);
          else s.transactions.push(Object.assign({ id: PT.uid('t'), src: 'manual', seq: Date.now() }, rec));
        });
        App.closeModal();
        App.toast(editing ? 'Transaction updated.' : 'Transaction added.');
      });
    });
  };

  App.cashForm = function (c, presetType) {
    const editing = !!c;
    const x = c || { date: PT.todayISO(), type: presetType || 'deposit', amount: '', currency: 'EUR', fx: null, instId: '', wht: '', broker: 'IBKR', note: '' };
    const insts = App.state.instruments.filter(i => i.type !== 'option').sort((a, b) => a.ticker.localeCompare(b.ticker));
    App.modal(`
      <div class="label" style="margin-bottom:10px">Ledger · cash</div><h2>${editing ? 'Edit cash movement' : 'New cash movement'}</h2>
      <p class="small muted" style="margin:0 0 16px">Deposits and withdrawals are external flows (they drive TWR/XIRR). Dividends, interest and fees are income/costs.</p>
      <div class="form-grid">
        <label class="f"><span>Date</span><input type="date" id="cf-date" value="${x.date}"></label>
        <label class="f"><span>Type</span><select id="cf-type">${[['deposit', 'Deposit'], ['withdrawal', 'Withdrawal'], ['dividend', 'Dividend'], ['tax', 'Tax (withholding / other)'], ['interest', 'Interest'], ['fee', 'Fee'], ['fxadj', 'FX / other adjustment']].map(([v, l]) => `<option value="${v}" ${x.type === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <label class="f"><span>Broker</span><input type="text" id="cf-broker" list="cf-brokers" value="${esc(x.broker || '')}"><datalist id="cf-brokers">${brokerList().map(b => `<option value="${esc(b)}">`).join('')}</datalist></label>
        <label class="f"><span id="cf-amt-l">Amount</span><input type="text" inputmode="decimal" id="cf-amount" value="${fmtIn(Math.abs(x.amount))}"></label>
        <label class="f" id="cf-dir-w"><span>Direction</span><select id="cf-dir"><option value="1">Received (+)</option><option value="-1" ${x.amount < 0 ? 'selected' : ''}>Paid (−)</option></select></label>
        <label class="f"><span>Currency</span><select id="cf-cur">${ccyOptions(x.currency)}</select></label>
        <label class="f"><span>FX rate <span class="muted">(per 1 EUR, optional)</span></span><input type="text" inputmode="decimal" id="cf-fx" value="${x.fx > 0 ? fmtIn(x.fx) : ''}" placeholder="from FX history"></label>
        <label class="f" id="cf-inst-w"><span>Instrument</span><select id="cf-inst"><option value="">—</option>${insts.map(i => `<option value="${i.id}" ${i.id === x.instId ? 'selected' : ''}>${esc(i.ticker)} · ${esc(i.name || '')}</option>`).join('')}</select></label>
        <label class="f" id="cf-wht-w"><span>Withholding tax <span class="muted">(same ccy)</span></span><input type="text" inputmode="decimal" id="cf-wht" value="${fmtIn(x.wht)}" placeholder="0"></label>
      </div>
      <label class="f" style="margin-top:14px"><span>Note</span><input type="text" id="cf-note" value="${esc(x.note || '')}"></label>
      <div class="foot"><button class="btn" data-close>Cancel</button><button class="btn primary" id="cf-save">${editing ? 'Save changes' : 'Add'}</button></div>`, m => {
      const $ = id => m.querySelector('#' + id);
      const sync = () => {
        const t = $('cf-type').value;
        $('cf-inst-w').classList.toggle('hidden', !(t === 'dividend' || t === 'tax'));
        $('cf-wht-w').classList.toggle('hidden', t !== 'dividend');
        $('cf-dir-w').classList.toggle('hidden', !(t === 'interest' || t === 'fxadj' || t === 'fee' || t === 'tax'));
        $('cf-amt-l').textContent = t === 'dividend' ? 'Gross dividend' : 'Amount';
      };
      $('cf-type').addEventListener('change', () => { const t = $('cf-type').value; if (t === 'fee' || t === 'tax') $('cf-dir').value = '-1'; if (t === 'interest') $('cf-dir').value = '1'; sync(); });
      sync();
      $('cf-save').addEventListener('click', () => {
        const type = $('cf-type').value, a = Math.abs(num($('cf-amount').value));
        if (!$('cf-date').value || !(a > 0)) return App.toast('Date and a positive amount are required.', true);
        let sign = 1;
        if (type === 'withdrawal') sign = -1;
        else if (['interest', 'fxadj', 'fee', 'tax'].includes(type)) sign = +$('cf-dir').value;
        const fx = num($('cf-fx').value);
        const rec = { date: $('cf-date').value, type, amount: sign * a, currency: $('cf-cur').value, fx: fx > 0 ? fx : null, instId: (type === 'dividend' || type === 'tax') ? ($('cf-inst').value || null) : null, wht: type === 'dividend' ? Math.abs(num($('cf-wht').value) || 0) : 0, broker: $('cf-broker').value.trim(), note: $('cf-note').value.trim() };
        App.commit(s => {
          if (editing) Object.assign(s.cash.find(y => y.id === c.id), rec);
          else s.cash.push(Object.assign({ id: PT.uid('c'), src: 'manual' }, rec));
        });
        App.closeModal();
        App.toast(editing ? 'Cash movement updated.' : 'Cash movement added.');
      });
    });
  };

  App.instrumentForm = function (inst) {
    const others = App.state.instruments.filter(i => i.id !== inst.id).sort((a, b) => a.ticker.localeCompare(b.ticker));
    const used = App.state.transactions.some(t => t.instId === inst.id) || App.state.cash.some(c => c.instId === inst.id);
    App.modal(`
      <div class="label" style="margin-bottom:10px">Instrument</div><h2>${esc(App.instLabel(inst))}</h2>
      <p class="small muted" style="margin:0 0 16px">Imported names are linked across brokers by ISIN, broker symbol or name. Aliases: ${(inst.aliases || []).map(esc).join(', ') || '—'}</p>
      <div class="form-grid">
        <label class="f"><span>Ticker</span><input type="text" id="if-ticker" value="${esc(inst.ticker)}"></label>
        <label class="f span2"><span>Name</span><input type="text" id="if-name" value="${esc(inst.name || '')}"></label>
        <label class="f"><span>ISIN</span><input type="text" id="if-isin" value="${esc(inst.isin || '')}"></label>
        <label class="f"><span>Kind</span><select id="if-type">${['stock', 'etf', 'option', 'warrant', 'other'].map(k => `<option ${inst.type === k ? 'selected' : ''}>${k}</option>`).join('')}</select></label>
        <label class="f"><span>Quote currency</span><select id="if-cur">${ccyOptions(inst.currency)}</select></label>
        <label class="f"><span>Multiplier</span><input type="text" inputmode="decimal" id="if-mult" value="${fmtIn(inst.multiplier || 1)}"></label>
        <label class="f"><span>Exchange</span><input type="text" id="if-ex" value="${esc(inst.exchange || '')}"></label>
        <label class="f"><span>Country</span><input type="text" id="if-country" value="${esc(inst.country || '')}"></label>
        <label class="f"><span>Sector</span><input type="text" id="if-sector" value="${esc(inst.sector || '')}"></label>
        <label class="f span2"><span>Themes <span class="muted">(comma separated)</span></span><input type="text" id="if-tags" value="${esc((inst.tags || []).join(', '))}"></label>
        <label class="f"><span>Expiry <span class="muted">(options)</span></span><input type="date" id="if-exp" value="${inst.expiry || ''}"></label>
      </div>
      <div class="divider"></div>
      <div class="row"><label class="f" style="flex:1"><span>Merge another instrument into this one <span class="muted">(e.g. the same share imported from DEGIRO and IBKR)</span></span><select id="if-merge"><option value="">—</option>${others.map(o => `<option value="${o.id}">${esc(o.ticker)} · ${esc(o.name || '')}</option>`).join('')}</select></label><button class="btn" id="if-merge-btn" style="align-self:flex-end">${icon('link')}Merge</button></div>
      <div class="foot">${used ? '' : '<button class="btn danger" id="if-del" style="margin-right:auto">Delete instrument</button>'}<button class="btn" data-close>Cancel</button><button class="btn primary" id="if-save">Save</button></div>`, m => {
      const $ = id => m.querySelector('#' + id);
      $('if-save').addEventListener('click', () => {
        App.commit(s => {
          const i = s.instruments.find(x => x.id === inst.id);
          const tk = $('if-ticker').value.trim();
          if (tk !== i.ticker) i.userTicker = true;
          if ($('if-cur').value !== i.currency) i.userCurrency = true;
          Object.assign(i, { ticker: tk, name: $('if-name').value.trim(), isin: $('if-isin').value.trim().toUpperCase(), type: $('if-type').value, currency: $('if-cur').value, multiplier: num($('if-mult').value) || 1, exchange: $('if-ex').value.trim(), country: $('if-country').value.trim(), sector: $('if-sector').value.trim(), tags: $('if-tags').value.split(',').map(x => x.trim()).filter(Boolean), expiry: $('if-exp').value || null });
        });
        App.closeModal(); App.toast('Instrument saved.');
      });
      $('if-merge-btn').addEventListener('click', () => {
        const from = $('if-merge').value; if (!from) return;
        App.commit(s => PT.mergeInstruments(s, inst.id, from));
        App.closeModal(); App.toast('Instruments merged.');
      });
      if ($('if-del')) $('if-del').addEventListener('click', () => { App.commit(s => { s.instruments = s.instruments.filter(x => x.id !== inst.id); delete s.prices[inst.id]; }); App.closeModal(); App.go('positions'); });
    });
  };

  App.quickPriceForm = function (inst) {
    App.modal(`<div class="label" style="margin-bottom:10px">Price observation</div><h2>${esc(App.instLabel(inst))}</h2><p class="small muted">Stored as a price observation. The newest observation on or before the valuation date is used.</p>
      <div class="form-grid" style="margin-top:12px"><label class="f"><span>Date</span><input type="date" id="qp-d" value="${PT.todayISO()}"></label><label class="f"><span>Price (${esc(inst.currency)})</span><input type="text" inputmode="decimal" id="qp-p"></label></div>
      <div class="foot"><button class="btn" data-close>Cancel</button><button class="btn primary" id="qp-save">Save price</button></div>`, m => {
      m.querySelector('#qp-save').addEventListener('click', () => {
        const d = m.querySelector('#qp-d').value, p = num(m.querySelector('#qp-p').value);
        if (!d || !(p >= 0)) return App.toast('Enter a date and a price.', true);
        App.commit(s => App.setPrice(s, inst.id, d, p));
        App.closeModal(); App.toast('Price saved.');
      });
    });
  };
  App.setPrice = function (s, id, d, p) {
    const arr = (s.prices[id] = s.prices[id] || []).filter(o => o[0] !== d);
    arr.push([d, p, 'm']);
    arr.sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);
    s.prices[id] = arr;
  };

  App.bindRowActions = function (root) {
    root.querySelectorAll('[data-edit-tx]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); App.tradeForm(App.state.transactions.find(t => t.id === b.dataset.editTx)); }));
    root.querySelectorAll('[data-del-tx]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); App.confirm('Delete transaction?', 'This cannot be undone (except via a JSON backup).', 'Delete', () => App.commit(s => { s.transactions = s.transactions.filter(t => t.id !== b.dataset.delTx); }), true); }));
    root.querySelectorAll('[data-edit-cash]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); App.cashForm(App.state.cash.find(c => c.id === b.dataset.editCash)); }));
    root.querySelectorAll('[data-del-cash]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); App.confirm('Delete cash movement?', 'This cannot be undone (except via a JSON backup).', 'Delete', () => App.commit(s => { s.cash = s.cash.filter(c => c.id !== b.dataset.delCash); }), true); }));
  };

  /* ============================================================= activity */
  V.activity = function () {
    const ui = App.ui, s = App.state;
    const q = ui.actQuery.trim().toLowerCase();
    const isTr = ui.actTab === 'trades';
    let rows = isTr ? s.transactions.slice() : s.cash.slice();
    if (ui.actType) rows = rows.filter(x => x.type === ui.actType);
    if (q) rows = rows.filter(x => { const i = App.instById(x.instId); return [x.date, x.type, x.broker, x.note, x.currency, i && i.ticker, i && i.name].join(' ').toLowerCase().includes(q); });
    rows.sort((a, b) => a.date < b.date ? 1 : a.date > b.date ? -1 : (b.seq || 0) - (a.seq || 0));
    const shown = rows.slice(0, ui.actLimit || 300);
    const types = isTr ? PT.TRADE_TYPES : PT.CASH_TYPES;
    const html = `
      <div class="tabs"><button class="${isTr ? 'on' : ''}" data-tab="trades">Trades (${s.transactions.length})</button><button class="${!isTr ? 'on' : ''}" data-tab="cash">Cash movements (${s.cash.length})</button></div>
      <div class="row" style="margin-bottom:14px">
        <input type="search" id="act-q" placeholder="Search…" value="${esc(ui.actQuery)}" style="width:240px">
        <select id="act-type"><option value="">All types</option>${types.map(t => `<option value="${t}" ${ui.actType === t ? 'selected' : ''}>${App.typeLabel(t)}</option>`).join('')}</select>
        <span class="small muted">${rows.length} record(s)</span><span class="spacer"></span>
        ${rows.length && (q || ui.actType) ? `<button class="btn sm danger" id="act-delall">Delete ${rows.length} filtered</button>` : ''}
        <button class="btn" data-act="add-cash">${icon('plus')}Cash movement</button><button class="btn primary" data-act="add-trade">${icon('plus')}Trade</button>
      </div>
      <div class="grid g-12"><div class="card c-12 flush"><div class="table-wrap"><table class="t compact">
      ${isTr ? `<thead><tr><th>Date</th><th>Instrument</th><th>Type</th><th class="r">Qty</th><th class="r">Price</th><th class="r">FX</th><th class="r">Fees €</th><th>Broker</th><th>Source</th><th>Note</th><th></th></tr></thead><tbody>
        ${shown.map(t => { const i = App.instById(t.instId); return `<tr><td class="nowrap">${F.date(t.date)}</td><td><a href="#/position/${t.instId}" class="tk">${esc(App.instLabel(i))}</a></td><td><span class="tag ${t.type === 'buy' ? 'accent' : ''}">${App.typeLabel(t.type)}</span></td><td class="r num">${t.type === 'split' ? '×' + F.num(t.ratio, 4) : F.qty(t.qty)}</td><td class="r num">${t.type === 'split' ? '' : F.price(t.price, t.currency)}</td><td class="r num">${t.currency === 'EUR' || t.type === 'split' ? '—' : (t.fx > 0 ? F.fx(t.fx) : '<span class="muted" data-tip="No FX on the record — taken from FX history">auto</span>')}</td><td class="r num">${t.fee ? F.eur(t.fee) : '—'}</td><td><span class="badge-broker">${esc(t.broker || '—')}</span></td><td class="xs muted">${esc(t.src || '')}</td><td class="small muted">${esc(t.note || '')}</td><td class="r nowrap"><button class="icon-btn" data-edit-tx="${t.id}" aria-label="Edit">${icon('edit')}</button><button class="icon-btn" data-del-tx="${t.id}" aria-label="Delete">${icon('trash')}</button></td></tr>`; }).join('')}</tbody>`
      : `<thead><tr><th>Date</th><th>Type</th><th>Instrument</th><th class="r">Amount</th><th class="r">WHT</th><th class="r">FX</th><th>Broker</th><th>Note</th><th></th></tr></thead><tbody>
        ${shown.map(c => { const i = App.instById(c.instId); return `<tr><td class="nowrap">${F.date(c.date)}</td><td><span class="tag">${App.typeLabel(c.type)}</span></td><td>${i ? `<a class="tk" href="#/position/${i.id}">${esc(App.instLabel(i))}</a>` : ''}</td><td class="r num ${F.cls(c.amount)}">${F.price(c.amount, c.currency)}</td><td class="r num">${c.wht ? F.price(-c.wht, c.currency) : ''}</td><td class="r num">${c.currency === 'EUR' ? '—' : (c.fx > 0 ? F.fx(c.fx) : '<span class="muted">auto</span>')}</td><td><span class="badge-broker">${esc(c.broker || '—')}</span></td><td class="small muted">${esc(c.note || '')}</td><td class="r nowrap"><button class="icon-btn" data-edit-cash="${c.id}" aria-label="Edit">${icon('edit')}</button><button class="icon-btn" data-del-cash="${c.id}" aria-label="Delete">${icon('trash')}</button></td></tr>`; }).join('')}</tbody>`}
      </table></div>${rows.length > shown.length ? `<div style="padding:14px;text-align:center"><button class="btn sm" id="act-more">Show more (${rows.length - shown.length})</button></div>` : ''}${!rows.length ? '<div class="empty-state small">No records.</div>' : ''}</div></div>`;
    return {
      title: 'Activity', html,
      mount(root) {
        root.querySelectorAll('[data-tab]').forEach(b => b.addEventListener('click', () => { ui.actTab = b.dataset.tab; ui.actType = ''; App.render(); }));
        const qi = root.querySelector('#act-q');
        qi.addEventListener('input', () => { ui.actQuery = qi.value; clearTimeout(qi._t); qi._t = setTimeout(() => { App.render(); const n = document.getElementById('act-q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 200); });
        root.querySelector('#act-type').addEventListener('change', e => { ui.actType = e.target.value; App.render(); });
        const more = root.querySelector('#act-more'); if (more) more.addEventListener('click', () => { ui.actLimit = (ui.actLimit || 300) + 500; App.render(); });
        const del = root.querySelector('#act-delall');
        if (del) del.addEventListener('click', () => App.confirm(`Delete ${rows.length} records?`, 'All records matching the current filter will be removed.', 'Delete', () => { const ids = new Set(rows.map(x => x.id)); App.commit(s2 => { if (isTr) s2.transactions = s2.transactions.filter(t => !ids.has(t.id)); else s2.cash = s2.cash.filter(c => !ids.has(c.id)); }); }, true));
        App.bindRowActions(root);
      }
    };
  };

  /* ================================================================= data */
  const DATA_TABS = [['import', 'Import CSV'], ['prices', 'Prices'], ['fx', 'FX rates'], ['bench', 'Benchmarks'], ['instruments', 'Instruments'], ['backup', 'Backup']];
  V.data = function () {
    const ui = App.ui;
    const tab = DATA_TABS.find(t => t[0] === ui.dataTab) ? ui.dataTab : 'import';
    const body = { import: importTab, prices: pricesTab, fx: fxTab, bench: benchTab, instruments: instrumentsTab, backup: backupTab }[tab]();
    return {
      title: 'Data & prices', sub: 'Stored locally in this browser · export a JSON backup regularly', actions: `<button class="btn" id="dh-backup">${icon('download')}Backup</button>`,
      html: `<div class="tabs">${DATA_TABS.map(([k, l]) => `<button class="${k === tab ? 'on' : ''}" data-dtab="${k}">${l}</button>`).join('')}</div>${body.html}`,
      mount(root) {
        const bk = document.getElementById('dh-backup'); if (bk) bk.addEventListener('click', () => App.exportBackup());
        root.querySelectorAll('[data-dtab]').forEach(b => b.addEventListener('click', () => { ui.dataTab = b.dataset.dtab; App.render(); }));
        body.mount && body.mount(root);
      }
    };
  };

  /* ------------------------------------------------------------- import */
  const ORDER = { 'degiro-tx': 0, 'ibkr-activity': 1, 'ibkr-flex': 2, 'ibkr-history': 3, generic: 4, 'degiro-account': 5 };
  function importTab() {
    const ui = App.ui;
    const files = ui.importFiles = ui.importFiles || [];
    const demo = App.state.meta && App.state.meta.demo;
    const html = `
      <div class="grid g-12">
        <div class="card c-12">
          <div class="dropzone" id="dz" tabindex="0" role="button" aria-label="Choose CSV files">
            <div class="ico">${icon('upload')}</div>
            <div style="font-weight:600;color:var(--text)">Drop CSV exports here or click to choose</div>
            <div class="small" style="margin-top:6px">DEGIRO: Transactions & Account statement (CSV) · IBKR: Activity Statement, Transaction History or Flex Query (CSV) · any other CSV with manual column mapping</div>
            <input type="file" id="dz-in" accept=".csv,.txt,text/csv" multiple class="hidden">
          </div>
          <details style="margin-top:14px"><summary>Where do I find these exports?</summary>
            <div class="small text-2" style="margin-top:8px;line-height:1.7">
              <b>DEGIRO</b> → Inbox → Transactions → choose the full date range → Export → CSV. Then Inbox → Account statement → same range → Export → CSV (for deposits, dividends, withholding tax, interest, fees).<br>
              <b>IBKR</b> → Performance & Reports → Statements → Activity (period: custom, format: CSV), or Transaction History → Download CSV, or a Flex Query with the Trades section (include FXRateToBase and ISIN).<br>
              Rows already in your data are skipped, so overlapping exports are safe. DEGIRO rows without an order ID at 00:00 (the portfolio move to IBKR) become broker transfers — the original cost basis and holding period are kept.
            </div></details>
        </div>
        ${files.length ? `<div class="c-12 stack">${files.map((f, i) => fileCard(f, i)).join('')}
          <div class="card"><div class="row">${demo ? '<label class="check"><input type="checkbox" id="imp-strip" checked> Remove demo data first</label>' : ''}<span class="spacer"></span><button class="btn" id="imp-clear">Discard</button><button class="btn primary" id="imp-go" ${files.some(f => f.R.needsMapping) ? 'disabled' : ''}>${icon('upload')}Import ${files.reduce((s, f) => s + f.R.trades.length + f.R.cash.length, 0)} record(s)</button></div></div></div>` : ''}
        ${ui.lastImport ? `<div class="card c-12"><div class="card-h"><h2>Last import</h2></div><div class="small text-2">${ui.lastImport}</div></div>` : ''}
        ${mergeSuggestionsCard()}
      </div>`;
    return {
      html, mount(root) {
        const dz = root.querySelector('#dz'), inp = root.querySelector('#dz-in');
        dz.addEventListener('click', () => inp.click());
        dz.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') inp.click(); });
        dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('over'); });
        dz.addEventListener('dragleave', () => dz.classList.remove('over'));
        dz.addEventListener('drop', e => { e.preventDefault(); dz.classList.remove('over'); addFiles(e.dataTransfer.files); });
        inp.addEventListener('change', () => addFiles(inp.files));
        root.querySelectorAll('[data-fmt-sel]').forEach(sel => sel.addEventListener('change', () => { const f = files[+sel.dataset.fmtSel]; f.opts.format = sel.value; reparse(f); App.render(); }));
        root.querySelectorAll('[data-rm]').forEach(b => b.addEventListener('click', () => { files.splice(+b.dataset.rm, 1); App.render(); }));
        root.querySelectorAll('[data-dg-transfer]').forEach(cb => cb.addEventListener('change', () => { const f = files[+cb.dataset.dgTransfer]; f.opts.degiroTransfers = cb.checked; reparse(f); App.render(); }));
        root.querySelectorAll('[data-map]').forEach(sel => sel.addEventListener('change', () => {
          const f = files[+sel.dataset.file]; const k = sel.dataset.map;
          f.opts.mapping = Object.assign({}, f.R.mapping || {}); if (sel.value === '') delete f.opts.mapping[k]; else f.opts.mapping[k] = +sel.value;
          reparse(f); App.render();
        }));
        root.querySelectorAll('[data-mopt]').forEach(sel => sel.addEventListener('change', () => { const f = files[+sel.dataset.file]; f.opts[sel.dataset.mopt] = sel.value; if (sel.dataset.mopt === 'kind') delete f.opts.mapping; reparse(f); App.render(); }));
        const clr = root.querySelector('#imp-clear'); if (clr) clr.addEventListener('click', () => { ui.importFiles = []; App.render(); });
        const go = root.querySelector('#imp-go'); if (go) go.addEventListener('click', () => doImport(root.querySelector('#imp-strip') && root.querySelector('#imp-strip').checked));
        bindMerge(root);
      }
    };
  }
  function reparse(f) { f.R = PT.importCSV(f.text, Object.assign({}, f.opts, f.opts.format === 'auto' ? { format: undefined } : {})); }
  async function addFiles(list) {
    const files = App.ui.importFiles = App.ui.importFiles || [];
    for (const file of list) {
      try {
        const text = await App.readFile(file);
        const f = { name: file.name, text, opts: {} };
        reparse(f);
        files.push(f);
      } catch (e) { App.toast('Could not read ' + file.name + ': ' + e.message, true); }
    }
    files.sort((a, b) => (ORDER[a.R.format] ?? 9) - (ORDER[b.R.format] ?? 9));
    App.render();
  }
  function fileCard(f, i) {
    const R = f.R;
    const fmts = Object.keys(PT.FORMAT_LABELS).filter(k => k !== 'empty');
    const skipped = Object.entries(R.skipped);
    const newProtos = Object.values(R.protos).filter(p => !PT.findInstrument(App.state, p));
    const sample = R.trades.slice(-6).reverse();
    const csample = R.cash.slice(-4).reverse();
    return `<div class="card">
      <div class="card-h"><span class="badge-broker">${icon('file')}</span><h3>${esc(f.name)}</h3>
        <select data-fmt-sel="${i}" aria-label="Format">${['auto', ...fmts].map(k => `<option value="${k}" ${(f.opts.format || 'auto') === k ? 'selected' : ''}>${k === 'auto' ? 'Auto-detect' : PT.FORMAT_LABELS[k]}</option>`).join('')}</select>
        <span class="tag accent">${esc(R.label)}</span>
        <div class="right"><button class="icon-btn" data-rm="${i}" aria-label="Remove">${icon('x')}</button></div></div>
      <div class="row small" style="gap:18px;margin-bottom:10px"><span><b>${R.trades.length}</b> trades</span><span><b>${R.cash.length}</b> cash movements</span><span><b>${Object.keys(R.protos).length}</b> instruments (${newProtos.length} new)</span>${skipped.length ? `<span class="muted">skipped: ${skipped.map(([k, v]) => `${v}× ${esc(k)}`).join(' · ')}</span>` : ''}</div>
      ${R.format === 'degiro-tx' ? `<label class="check small" style="margin-bottom:8px"><input type="checkbox" data-dg-transfer="${i}" ${f.opts.degiroTransfers !== false ? 'checked' : ''}> Treat rows without order ID at 00:00 as broker transfers (recommended for the DEGIRO → IBKR move)</label>` : ''}
      ${R.notes.map(n => `<div class="explain small" style="margin-bottom:8px">${esc(n)}</div>`).join('')}
      ${R.warnings.map(w => `<div class="tag warn" style="white-space:normal;margin-bottom:8px;display:flex">${icon('alert')} ${esc(w)}</div>`).join('')}
      ${R.format === 'generic' ? mappingUI(f, i) : ''}
      ${sample.length ? `<div class="table-wrap"><table class="t compact"><thead><tr><th>Date</th><th>Instrument</th><th>Type</th><th class="r">Qty</th><th class="r">Price</th><th class="r">FX</th><th class="r">Fee €</th></tr></thead><tbody>${sample.map(t => { const p = R.protos[t.key] || {}; return `<tr><td>${F.date(t.date)}</td><td><span class="tk">${esc(p.ticker || '')}</span> <span class="muted small">${esc(p.name || '')}</span></td><td><span class="tag">${App.typeLabel(t.type)}</span></td><td class="r num">${t.type === 'split' ? '×' + t.ratio : F.qty(t.qty)}</td><td class="r num">${F.price(t.price, t.currency)}</td><td class="r num">${t.fx ? F.fx(t.fx) : '<span class="muted">auto</span>'}</td><td class="r num">${t.fee != null ? F.eur(t.fee) : (t.feeLocal ? F.price(t.feeLocal, t.currency) : '')}</td></tr>`; }).join('')}</tbody></table></div><div class="xs muted" style="margin-top:6px">Newest ${sample.length} of ${R.trades.length} trades shown.</div>` : ''}
      ${csample.length ? `<div class="table-wrap" style="margin-top:10px"><table class="t compact"><thead><tr><th>Date</th><th>Type</th><th class="r">Amount</th><th>Description</th></tr></thead><tbody>${csample.map(c => `<tr><td>${F.date(c.date)}</td><td><span class="tag">${App.typeLabel(c.type)}</span></td><td class="r num ${F.cls(c.amount)}">${F.price(c.amount, c.currency)}</td><td class="small muted">${esc(c.note || '')}</td></tr>`).join('')}</tbody></table></div>` : ''}
    </div>`;
  }
  function mappingUI(f, i) {
    const R = f.R, kind = f.opts.kind || 'trades';
    const H = R.headers || [];
    return `<div class="explain" style="margin-bottom:12px"><b>Column mapping.</b> Auto-detected where possible — adjust if needed. Quantities may be signed (negative = sell) or use a Buy/Sell column.</div>
      <div class="row" style="margin-bottom:12px">
        <div class="seg"><button class="${kind === 'trades' ? 'on' : ''}" data-file="${i}" data-mopt-btn="trades">Trades</button><button class="${kind === 'cash' ? 'on' : ''}" data-file="${i}" data-mopt-btn="cash">Cash movements</button></div>
        <select data-file="${i}" data-mopt="kind" class="hidden"><option value="trades" ${kind === 'trades' ? 'selected' : ''}>trades</option><option value="cash" ${kind === 'cash' ? 'selected' : ''}>cash</option></select>
        <label class="small text-2">Decimal <select data-file="${i}" data-mopt="decimal"><option value="">auto</option><option value="," ${f.opts.decimal === ',' ? 'selected' : ''}>1.234,56</option><option value="." ${f.opts.decimal === '.' ? 'selected' : ''}>1,234.56</option></select></label>
        <label class="small text-2">Dates <select data-file="${i}" data-mopt="dateFmt">${['auto', 'DMY', 'MDY', 'YMD'].map(x => `<option ${(f.opts.dateFmt || 'auto') === x ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      </div>
      <div class="form-grid" style="margin-bottom:14px">${PT.GENERIC_FIELDS[kind].map(fd => `<label class="f"><span>${fd.label}${fd.req ? ' *' : ''}</span><select data-file="${i}" data-map="${fd.k}"><option value="">—</option>${H.map((h, j) => `<option value="${j}" ${R.mapping && R.mapping[fd.k] === j ? 'selected' : ''}>${esc(h || 'Column ' + (j + 1))}</option>`).join('')}</select></label>`).join('')}</div>`;
  }
  document.addEventListener('click', e => {
    const b = e.target.closest('[data-mopt-btn]'); if (!b) return;
    const f = App.ui.importFiles[+b.dataset.file]; f.opts.kind = b.dataset.moptBtn; delete f.opts.mapping; reparse(f); App.render();
  });
  function doImport(strip) {
    const files = App.ui.importFiles || [];
    const out = [];
    App.commit(s => {
      if (strip) PT.stripDemo(s);
      files.forEach(f => {
        const sum = PT.applyImport(s, f.R, { source: f.R.format });
        out.push(`<b>${esc(f.name)}</b>: ${sum.trades} trades, ${sum.cash} cash movements, ${sum.instrumentsNew} new instruments${sum.duplicates ? `, ${sum.duplicates} duplicates skipped` : ''}${sum.linked.length ? `<br><span class="muted">Linked: ${sum.linked.map(esc).join(' · ')}</span>` : ''}`);
      });
    }, { render: false });
    App.ui.importFiles = [];
    App.ui.lastImport = out.join('<br>') + '<br><br>Next: update current prices (Data → Prices) and check the Instruments tab for securities that should be merged.';
    App.render();
    App.toast('Import complete.');
  }
  function mergeSuggestionsCard() {
    const sug = PT.suggestMerges(App.state);
    if (!sug.length) return '';
    return `<div class="card c-12"><div class="card-h"><h2>Possible duplicates</h2><span class="sub">the same security imported under two identities (e.g. DEGIRO name vs. IBKR ticker)</span></div>
      ${sug.map(([a, b]) => `<div class="list-row"><span class="tk">${esc(a.ticker)}</span><span class="muted small">${esc(a.name)}</span><span class="muted">↔</span><span class="tk">${esc(b.ticker)}</span><span class="muted small">${esc(b.name)}</span><span class="spacer"></span><button class="btn sm" data-merge="${a.id}|${b.id}">Keep ${esc(a.ticker)}</button><button class="btn sm" data-merge="${b.id}|${a.id}">Keep ${esc(b.ticker)}</button></div>`).join('')}</div>`;
  }
  function bindMerge(root) {
    root.querySelectorAll('[data-merge]').forEach(b => b.addEventListener('click', () => { const [to, from] = b.dataset.merge.split('|'); App.commit(s => PT.mergeInstruments(s, to, from)); App.toast('Merged.'); }));
  }

  /* ------------------------------------------------------------- prices */
  function pricesTab() {
    const r = App.res, s = App.state, ui = App.ui;
    const openIds = new Set(r.empty ? [] : r.positions.map(p => p.id));
    const list = s.instruments.filter(i => ui.priceAll || openIds.has(i.id)).sort((a, b) => (openIds.has(b.id) - openIds.has(a.id)) || App.instLabel(a).localeCompare(App.instLabel(b)));
    const lastStored = id => { const a = s.prices[id] || []; return a.length ? a[a.length - 1] : null; };
    const lastTx = id => { const t = s.transactions.filter(x => x.instId === id && x.price > 0).sort((a, b) => a.date < b.date ? 1 : -1)[0]; return t; };
    const html = `
      <div class="grid g-12">
        <div class="card c-8 flush">
          <div class="card-h"><h2>Update prices</h2><span class="sub">enter today’s prices by hand — nothing is fetched automatically</span>
            <div class="right"><label class="small text-2">Price date <input type="date" id="pr-date" value="${PT.todayISO()}"></label><label class="check small"><input type="checkbox" id="pr-all" ${ui.priceAll ? 'checked' : ''}> All instruments</label></div></div>
          <div class="table-wrap"><table class="t compact"><thead><tr><th>Instrument</th><th>Ccy</th><th class="r">Last stored</th><th class="r">Last trade</th><th class="r" style="width:160px">New price</th></tr></thead><tbody>
          ${list.map(i => { const ls = lastStored(i.id), lt = lastTx(i.id); const expired = i.expiry && i.expiry < (r.asOfISO || PT.todayISO()); return `<tr><td><span class="tk">${esc(App.instLabel(i))}</span>${expired ? ' <span class="tag">expired</span>' : ''}<div class="nm">${esc(i.type === 'option' ? i.ticker : i.name)}</div></td><td class="muted">${esc(i.currency)}</td>
            <td class="r num">${ls ? F.price(ls[1], i.currency) + `<div class="xs muted">${F.date(ls[0])}</div>` : '<span class="muted">—</span>'}</td>
            <td class="r num">${lt ? F.price(lt.price, lt.currency) + `<div class="xs muted">${F.date(lt.date)}</div>` : '—'}</td>
            <td class="r"><input type="text" inputmode="decimal" data-price="${i.id}" placeholder="${ls ? fmtIn(ls[1]) : ''}" style="width:130px;text-align:right"></td></tr>`; }).join('') || '<tr><td colspan="5" class="muted">No open positions.</td></tr>'}
          </tbody></table></div>
          <div class="row end" style="padding:14px 18px"><button class="btn primary" id="pr-save">Save prices</button></div>
        </div>
        <div class="c-4 stack">
          <div class="card"><div class="card-h"><h3>Paste prices</h3></div>
            <p class="small text-2" style="margin-top:0">One per line: <span class="code">NVDA 182,40</span> or <span class="code">2026-10-07,NVDA,182.40</span>, or JSON <span class="code">{"NVDA": 182.4, "ASML": {"price": 812, "date": "2026-10-07"}}</span>. Matched by ticker or ISIN.</p>
            <textarea id="pr-paste" rows="6" placeholder='{"NVDA": 182.4}'></textarea>
            <div class="row end" style="margin-top:10px"><button class="btn" id="pr-copy">Copy current as JSON</button><button class="btn primary" id="pr-apply">Apply</button></div></div>
          <div class="card"><div class="card-h"><h3>Price history</h3></div>
            <p class="small text-2" style="margin-top:0">Daily closes for charts, risk and TWR. Format: <span class="code">date,close</span> — Yahoo-style CSV (Date,Open,High,Low,Close,…) works too.</p>
            <select id="ph-inst" style="width:100%;margin-bottom:8px">${s.instruments.map(i => `<option value="${i.id}">${esc(App.instLabel(i))}</option>`).join('')}</select>
            <textarea id="ph-text" rows="5" placeholder="2026-10-01,180.2&#10;2026-10-02,182.9"></textarea>
            <div class="row" style="margin-top:8px"><input type="file" id="ph-file" accept=".csv,.txt" class="small"></div>
            <label class="check small" style="margin-top:8px"><input type="checkbox" id="ph-adj"> Series is split-adjusted (convert to raw prices using recorded splits)</label>
            <div class="row end" style="margin-top:10px"><button class="btn primary" id="ph-go">Import history</button></div></div>
        </div>
      </div>`;
    return {
      html, mount(root) {
        root.querySelector('#pr-all').addEventListener('change', e => { ui.priceAll = e.target.checked; App.render(); });
        root.querySelector('#pr-save').addEventListener('click', () => {
          const d = root.querySelector('#pr-date').value || PT.todayISO();
          const ups = [...root.querySelectorAll('[data-price]')].map(inp => [inp.dataset.price, num(inp.value)]).filter(x => x[1] >= 0 && String(x[1]) !== 'NaN');
          if (!ups.length) return App.toast('Enter at least one price.', true);
          App.commit(st => ups.forEach(([id, p]) => App.setPrice(st, id, d, p)));
          App.toast(`${ups.length} price(s) saved for ${F.date(d)}.`);
        });
        root.querySelector('#pr-apply').addEventListener('click', () => {
          let items;
          try { items = PT.parsePriceInput(root.querySelector('#pr-paste').value); } catch (e) { return App.toast('Could not parse: ' + e.message, true); }
          const d0 = root.querySelector('#pr-date').value || PT.todayISO();
          const miss = [];
          let n = 0;
          App.commit(st => items.forEach(it => {
            const tk = it.ticker.toUpperCase();
            const i = st.instruments.find(x => x.ticker.toUpperCase() === tk || (x.isin && x.isin === tk) || (x.aliases || []).includes('TICKER:' + it.ticker));
            if (!i) { miss.push(it.ticker); return; }
            App.setPrice(st, i.id, it.date || d0, it.price); n++;
          }));
          App.toast(`${n} price(s) applied.${miss.length ? ' Not found: ' + miss.join(', ') : ''}`, !!miss.length);
        });
        root.querySelector('#pr-copy').addEventListener('click', () => {
          const o = {};
          (App.res.positions || []).forEach(p => { o[p.inst.ticker] = { price: p.price, date: p.priceDate, currency: p.currency }; });
          const txt = JSON.stringify(o, null, 2);
          root.querySelector('#pr-paste').value = txt;
          if (navigator.clipboard) navigator.clipboard.writeText(txt).then(() => App.toast('Copied to clipboard.'), () => {});
        });
        root.querySelector('#ph-file').addEventListener('change', async e => { if (e.target.files[0]) root.querySelector('#ph-text').value = await App.readFile(e.target.files[0]); });
        root.querySelector('#ph-go').addEventListener('click', () => {
          const id = root.querySelector('#ph-inst').value;
          let pts = PT.parseSeriesInput(root.querySelector('#ph-text').value);
          if (!pts.length) return App.toast('No “date,value” rows found.', true);
          if (root.querySelector('#ph-adj').checked) {
            const splits = App.state.transactions.filter(t => t.instId === id && t.type === 'split');
            pts = pts.map(([d, v]) => [d, v * splits.filter(sp => sp.date > d).reduce((f, sp) => f * (+sp.ratio || 1), 1)]);
          }
          App.commit(st => { const m = new Map((st.prices[id] || []).map(o => [o[0], o])); pts.forEach(([d, v]) => m.set(d, [d, v, 'i'])); st.prices[id] = [...m.values()].sort((a, b) => a[0] < b[0] ? -1 : 1); });
          App.toast(`${pts.length} prices imported.`);
        });
      }
    };
  }

  /* ----------------------------------------------------------------- fx */
  function fxTab() {
    const s = App.state, r = App.res;
    const curs = [...new Set([...s.instruments.map(i => i.currency), ...s.cash.map(c => c.currency), ...s.benchmarks.map(b => b.currency), ...Object.keys(s.fx)])].filter(c => c && c !== 'EUR').sort();
    const html = `<div class="grid g-12">
      <div class="card c-7 flush"><div class="card-h"><h2>Current FX rates</h2><span class="sub">units of foreign currency per 1 EUR</span><div class="right"><label class="small text-2">Date <input type="date" id="fx-date" value="${PT.todayISO()}"></label></div></div>
        <div class="table-wrap"><table class="t compact"><thead><tr><th>Currency</th><th class="r">Latest known</th><th class="r">Observations</th><th class="r" style="width:170px">New rate (1 EUR = …)</th></tr></thead><tbody>
        ${curs.map(c => { const ser = r.fxSeries && r.fxSeries[c]; const lastD = ser && ser.n ? ser.last : null; return `<tr><td><b>${c}</b></td><td class="r num">${lastD != null ? F.fx(ser.ys[ser.n - 1]) + `<div class="xs muted">${F.date(PT.iso(lastD))}</div>` : '<span class="loss">missing</span>'}</td><td class="r num muted">${ser ? ser.n : 0}</td><td class="r"><input type="text" inputmode="decimal" data-fx="${c}" style="width:130px;text-align:right" placeholder="${lastD != null ? fmtIn(+ser.ys[ser.n - 1].toFixed(4)) : ''}"></td></tr>`; }).join('') || '<tr><td colspan="4" class="muted">Only EUR in use.</td></tr>'}
        </tbody></table></div>
        <div class="row end" style="padding:14px 18px"><label class="check small"><input type="checkbox" id="fx-inv"> I’m entering EUR per 1 unit (invert)</label><span class="spacer"></span><button class="btn primary" id="fx-save">Save rates</button></div></div>
      <div class="card c-5"><div class="card-h"><h3>FX history</h3></div>
        <p class="small text-2" style="margin-top:0">Every imported trade already contributes its own FX rate. Add a daily history (e.g. ECB reference rates) for smoother valuations and exact dividend conversion. Format <span class="code">date,rate</span>.</p>
        <select id="fxh-cur" style="width:100%;margin-bottom:8px">${curs.map(c => `<option>${c}</option>`).join('')}</select>
        <textarea id="fxh-text" rows="7" placeholder="2026-10-01,1.1642&#10;2026-10-02,1.1608"></textarea>
        <div class="row end" style="margin-top:10px"><button class="btn primary" id="fxh-go">Import history</button></div></div></div>`;
    return {
      html, mount(root) {
        root.querySelector('#fx-save').addEventListener('click', () => {
          const d = root.querySelector('#fx-date').value || PT.todayISO(), inv = root.querySelector('#fx-inv').checked;
          const ups = [...root.querySelectorAll('[data-fx]')].map(i => [i.dataset.fx, num(i.value)]).filter(x => x[1] > 0);
          if (!ups.length) return App.toast('Enter at least one rate.', true);
          App.commit(st => ups.forEach(([c, v]) => { const arr = (st.fx[c] = (st.fx[c] || []).filter(o => o[0] !== d)); arr.push([d, inv ? 1 / v : v]); arr.sort((a, b) => a[0] < b[0] ? -1 : 1); }));
          App.toast('FX rates saved.');
        });
        root.querySelector('#fxh-go').addEventListener('click', () => {
          const c = root.querySelector('#fxh-cur').value; const pts = PT.parseSeriesInput(root.querySelector('#fxh-text').value);
          if (!c || !pts.length) return App.toast('No “date,rate” rows found.', true);
          App.commit(st => { const m = new Map((st.fx[c] || []).map(o => [o[0], o])); pts.forEach(([d, v]) => m.set(d, [d, v])); st.fx[c] = [...m.values()].sort((a, b) => a[0] < b[0] ? -1 : 1); });
          App.toast(`${pts.length} rates imported for ${c}.`);
        });
      }
    };
  }

  /* ---------------------------------------------------------- benchmarks */
  function benchTab() {
    const s = App.state;
    const html = `<div class="explain" style="margin-bottom:16px">Enter or import benchmark prices yourself — index levels or a tracking ETF (e.g. MSCI World UCITS ETF in EUR, a Nasdaq-100 ETF, a semiconductor ETF). Total-return (accumulating) series compare fairly with a portfolio that receives dividends. Non-EUR series are converted with your FX history.</div>
      <div class="grid g-12">${s.benchmarks.map((b, i) => `<div class="card c-4"><div class="card-h"><h3>Benchmark ${i + 1}</h3><div class="right"><span class="small muted">${(b.series || []).length} points${(b.series || []).length ? ' · ' + F.date(b.series[b.series.length - 1][0]) : ''}</span></div></div>
        <div class="stack" style="gap:10px">
          <label class="f"><span>Name</span><input type="text" data-bn="${i}" value="${esc(b.name)}"></label>
          <label class="f"><span>Currency</span><select data-bc="${i}">${ccyOptions(b.currency)}</select></label>
          <label class="f"><span>Series (date,value)</span><textarea rows="5" data-bt="${i}" placeholder="2026-10-01,1234.5"></textarea></label>
          <input type="file" data-bf="${i}" accept=".csv,.txt" class="small">
          <div class="row"><button class="btn sm danger" data-bclr="${i}">Clear</button><span class="spacer"></span><button class="btn sm" data-bapp="${i}">Merge</button><button class="btn sm primary" data-brep="${i}">Replace</button></div>
        </div></div>`).join('')}</div>`;
    return {
      html, mount(root) {
        root.querySelectorAll('[data-bn]').forEach(inp => inp.addEventListener('change', () => App.commit(st => { st.benchmarks[+inp.dataset.bn].name = inp.value.trim() || 'Benchmark'; })));
        root.querySelectorAll('[data-bc]').forEach(sel => sel.addEventListener('change', () => App.commit(st => { st.benchmarks[+sel.dataset.bc].currency = sel.value; })));
        root.querySelectorAll('[data-bf]').forEach(inp => inp.addEventListener('change', async () => { if (inp.files[0]) root.querySelector(`[data-bt="${inp.dataset.bf}"]`).value = await App.readFile(inp.files[0]); }));
        const go = (i, replace) => {
          const pts = PT.parseSeriesInput(root.querySelector(`[data-bt="${i}"]`).value);
          if (!pts.length) return App.toast('No “date,value” rows found.', true);
          App.commit(st => { const b = st.benchmarks[i]; const m = new Map(replace ? [] : (b.series || []).map(o => [o[0], o])); pts.forEach(([d, v]) => m.set(d, [d, v])); b.series = [...m.values()].sort((a, c) => a[0] < c[0] ? -1 : 1); });
          App.toast(`${pts.length} points saved.`);
        };
        root.querySelectorAll('[data-bapp]').forEach(b => b.addEventListener('click', () => go(+b.dataset.bapp, false)));
        root.querySelectorAll('[data-brep]').forEach(b => b.addEventListener('click', () => go(+b.dataset.brep, true)));
        root.querySelectorAll('[data-bclr]').forEach(b => b.addEventListener('click', () => App.confirm('Clear series?', 'Removes all points of this benchmark.', 'Clear', () => App.commit(st => { st.benchmarks[+b.dataset.bclr].series = []; }), true)));
      }
    };
  }

  /* --------------------------------------------------------- instruments */
  function instrumentsTab() {
    const s = App.state;
    const cnt = {}; s.transactions.forEach(t => { cnt[t.instId] = (cnt[t.instId] || 0) + 1; });
    const list = s.instruments.slice().sort((a, b) => App.instLabel(a).localeCompare(App.instLabel(b)));
    const html = `<div class="grid g-12">${mergeSuggestionsCard()}
      <div class="card c-12 flush"><div class="card-h"><h2>${list.length} instruments</h2><span class="sub">click to edit ticker, currency, multiplier, classification or merge</span></div>
      <div class="table-wrap"><table class="t compact"><thead><tr><th>Ticker</th><th>Name</th><th>ISIN</th><th>Kind</th><th>Ccy</th><th class="r">×</th><th class="r">Trades</th><th>Linked identities</th><th></th></tr></thead><tbody>
      ${list.map(i => `<tr class="click" data-inst="${i.id}"><td class="tk">${esc(App.instLabel(i))}</td><td class="small">${esc(i.name || '')}</td><td class="small muted code">${esc(i.isin || '')}</td><td><span class="tag">${esc(i.type)}</span></td><td>${esc(i.currency)}</td><td class="r num">${i.multiplier || 1}</td><td class="r num">${cnt[i.id] || 0}</td><td class="xs muted">${(i.aliases || []).map(esc).join(' · ')}</td><td class="r"><button class="icon-btn" aria-label="Edit">${icon('edit')}</button></td></tr>`).join('')}
      </tbody></table></div></div></div>`;
    return { html, mount(root) { bindMerge(root); root.querySelectorAll('[data-inst]').forEach(tr => tr.addEventListener('click', () => App.instrumentForm(App.instById(tr.dataset.inst)))); } };
  }

  /* -------------------------------------------------------------- backup */
  function backupTab() {
    const s = App.state;
    const size = (JSON.stringify(s).length / 1024).toFixed(0);
    const html = `<div class="grid g-12">
      <div class="card c-6"><div class="card-h"><h2>Export</h2></div><p class="small text-2" style="margin-top:0">Full dataset: ${s.instruments.length} instruments, ${s.transactions.length} trades, ${s.cash.length} cash movements, price/FX/benchmark history and settings (${size} KB).</p>
        <div class="row"><button class="btn primary" id="bk-json">${icon('download')}Download JSON backup</button><button class="btn" id="bk-csv">${icon('download')}Trades as CSV</button></div></div>
      <div class="card c-6"><div class="card-h"><h2>Restore</h2></div><p class="small text-2" style="margin-top:0">Replaces everything in this browser with the contents of a JSON backup.</p>
        <input type="file" id="bk-file" accept=".json,application/json"></div>
      <div class="card c-12"><div class="card-h"><h2>Danger zone</h2></div><div class="row">
        ${s.meta && s.meta.demo ? '<button class="btn" data-act="clear-demo">Clear demo data</button>' : '<button class="btn" data-act="load-demo">Load demo data</button>'}
        <button class="btn danger" id="bk-reset">${icon('trash')}Delete all data</button></div></div></div>`;
    return {
      html, mount(root) {
        root.querySelector('#bk-json').addEventListener('click', () => App.download(`portfolio-backup-${PT.todayISO()}.json`, JSON.stringify(Object.assign({ app: 'conviction-portfolio', exportedAt: new Date().toISOString() }, App.state))));
        root.querySelector('#bk-csv').addEventListener('click', () => {
          const rows = [['date', 'ticker', 'name', 'isin', 'type', 'quantity', 'price', 'currency', 'fx_per_eur', 'fee_eur', 'broker', 'note']];
          App.state.transactions.slice().sort((a, b) => a.date < b.date ? -1 : 1).forEach(t => { const i = App.instById(t.instId) || {}; rows.push([t.date, i.ticker, i.name, i.isin, t.type, t.type === 'split' ? t.ratio : t.qty, t.price, t.currency, t.fx || '', t.fee || 0, t.broker, t.note]); });
          App.download(`trades-${PT.todayISO()}.csv`, rows.map(r => r.map(c => { const v = c == null ? '' : String(c); return /[",;\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(',')).join('\n'), 'text/csv');
        });
        root.querySelector('#bk-file').addEventListener('change', async e => {
          const f = e.target.files[0]; if (!f) return;
          try {
            const j = JSON.parse(await App.readFile(f));
            if (!Array.isArray(j.transactions) || !Array.isArray(j.instruments)) throw new Error('Not a portfolio backup');
            App.confirm('Restore backup?', `${j.transactions.length} trades and ${(j.cash || []).length} cash movements will replace the current data.`, 'Restore', () => { App.state = App.migrate(j); delete App.state.app; delete App.state.exportedAt; App.syncShellControls(); App.commit(); App.toast('Backup restored.'); });
          } catch (err) { App.toast('Could not read backup: ' + err.message, true); }
        });
        root.querySelector('#bk-reset').addEventListener('click', () => App.confirm('Delete all data?', 'Every instrument, trade, cash movement, price and benchmark is removed from this browser.', 'Delete everything', () => { const keep = App.state.settings; App.state = PT.emptyState(); App.state.settings = keep; App.commit(); }, true));
      }
    };
  }

  /* ============================================================ settings */
  V.settings = function () {
    const s = App.state.settings;
    const html = `<div class="grid g-12"><div class="card c-8"><div class="stack" style="gap:20px">
      ${setRow('Number format', 'German (1.234,56 €) or English (€1,234.56).', `<div class="seg"><button class="${s.locale !== 'en' ? 'on' : ''}" data-set="locale" data-v="de">Deutsch</button><button class="${s.locale === 'en' ? 'on' : ''}" data-set="locale" data-v="en">English</button></div>`)}
      ${setRow('Theme', '', `<div class="seg"><button class="${s.theme !== 'light' ? 'on' : ''}" data-set="theme" data-v="dark">Dark</button><button class="${s.theme === 'light' ? 'on' : ''}" data-set="theme" data-v="light">Light</button></div>`)}
      ${setRow('Colour-blind-safe gains/losses', 'Blue for gains, orange for losses instead of green/red.', `<label class="check"><input type="checkbox" id="st-cb" ${s.cb ? 'checked' : ''}> Enabled</label>`)}
      <div class="divider" style="margin:0"></div>
      ${setRow('Risk-free rate', 'Used for Sharpe and Sortino. Default ≈ €STR (2.19 % in Aug 2026, ECB).', `<div class="row"><input type="text" inputmode="decimal" id="st-rf" value="${fmtIn(+(s.rf * 100).toFixed(4))}" style="width:90px;text-align:right"> <span class="muted">% p.a.</span></div>`)}
      ${setRow('Concentration warning', 'Flag any single position above this weight.', `<div class="row"><input type="text" inputmode="decimal" id="st-conc" value="${fmtIn(+(s.concThreshold * 100).toFixed(2))}" style="width:90px;text-align:right"> <span class="muted">%</span></div>`)}
      ${setRow('Performance basis', 'Portfolio = securities + cash, flows are deposits/withdrawals (needs your cash movements). Securities only = every buy/sell is treated as a flow — use it if you only imported trades.', `<select id="st-basis"><option value="auto" ${s.basis === 'auto' ? 'selected' : ''}>Auto (${App.res && App.res.basis === 'portfolio' ? 'portfolio' : 'securities'})</option><option value="portfolio" ${s.basis === 'portfolio' ? 'selected' : ''}>Portfolio incl. cash</option><option value="securities" ${s.basis === 'securities' ? 'selected' : ''}>Securities only</option></select>`)}
      ${setRow('Price gaps', 'Between two stored prices: carry the last price forward (conservative) or interpolate linearly.', `<select id="st-gap"><option value="locf" ${s.priceGap !== 'interp' ? 'selected' : ''}>Carry forward</option><option value="interp" ${s.priceGap === 'interp' ? 'selected' : ''}>Interpolate</option></select>`)}
      ${setRow('Valuation date', 'Leave empty for today. Set a past date to see the portfolio as of that day.', `<div class="row"><input type="date" id="st-asof" value="${s.asOf || ''}"><button class="btn sm ghost" id="st-asof-clr">Today</button></div>`)}
    </div></div>
    <div class="card c-4"><div class="card-h"><h3>Conventions</h3></div><div class="small text-2" style="line-height:1.65">
      <p style="margin-top:0"><b>Base currency</b> EUR. FX rates are quoted as foreign units per EUR (USD 1,16 means 1 € = 1,16 $).</p>
      <p><b>Cost basis</b> FIFO across brokers, including purchase fees. Broker transfers keep the original lots.</p>
      <p><b>Cash</b> is tracked in EUR at each transaction’s FX rate; FX revaluation of foreign cash balances is not modelled (IBKR “FX translation” adjustments can be imported).</p>
      <p><b>Storage</b> localStorage in this browser only. Nothing leaves your machine except the Chart.js and font CDN requests.</p></div></div></div>`;
    return {
      title: 'Settings', html,
      mount(root) {
        root.querySelectorAll('[data-set]').forEach(b => b.addEventListener('click', () => { App.state.settings[b.dataset.set] = b.dataset.v; App.save(); App.syncShellControls(); App.render(); }));
        root.querySelector('#st-cb').addEventListener('change', e => { App.state.settings.cb = e.target.checked; App.save(); App.syncShellControls(); App.render(); });
        root.querySelector('#st-rf').addEventListener('change', e => { const v = num(e.target.value); if (isFinite(v)) App.commit(st => { st.settings.rf = v / 100; }); });
        root.querySelector('#st-conc').addEventListener('change', e => { const v = num(e.target.value); if (v > 0) App.commit(st => { st.settings.concThreshold = v / 100; }); });
        root.querySelector('#st-basis').addEventListener('change', e => App.commit(st => { st.settings.basis = e.target.value; }));
        root.querySelector('#st-gap').addEventListener('change', e => App.commit(st => { st.settings.priceGap = e.target.value; }));
        root.querySelector('#st-asof').addEventListener('change', e => App.commit(st => { st.settings.asOf = e.target.value || null; }));
        root.querySelector('#st-asof-clr').addEventListener('click', () => App.commit(st => { st.settings.asOf = null; }));
      }
    };
  };
  const setRow = (k, d, ctl) => `<div class="row" style="align-items:flex-start;gap:20px"><div style="flex:1;min-width:220px"><div style="font-weight:600">${k}</div>${d ? `<div class="small muted" style="margin-top:2px">${d}</div>` : ''}</div><div>${ctl}</div></div>`;

  /* ================================================================ checks */
  V.checks = function () {
    const tests = PT.selfTests();
    const ok = tests.filter(t => t.ok).length;
    const groups = [...new Set(tests.map(t => t.group))];
    const fmtv = (v, f) => f === 'pct' ? F.pct(v, { dec: 4, sign: false }) : f === 'num' ? F.num(v, 4).replace(/[,.]0000$/, '') : F.eur(v);
    const r = App.res;
    const integrity = [];
    if (!r.empty) {
      integrity.push(['Attribution reconciles to value − net invested', Math.abs(r.attribution.residual) < 0.05, `residual ${F.eur(r.attribution.residual)}`]);
      integrity.push(['Every open position has a price', !r.positions.some(p => p.missingPrice), r.positions.filter(p => p.missingPrice).map(p => App.instLabel(p.inst)).join(', ') || 'all priced']);
      integrity.push(['FX history for every currency', !r.missingFx.length, r.missingFx.join(', ') || 'complete']);
      const stale = r.positions.filter(p => p.stale && !p.missingPrice);
      integrity.push(['Prices not older than 7 days', !stale.length, stale.length ? stale.map(p => App.instLabel(p.inst)).join(', ') : 'fresh']);
      const unmatched = r.inKind.length;
      integrity.push(['Transfers in are matched by a transfer out', !unmatched, unmatched ? `${unmatched} unmatched — treated as securities deposits` : 'all matched']);
      r.warnings.forEach(w => integrity.push([w.code === 'cash' ? 'Cash balance' : 'Warning', false, w.text]));
      integrity.push(['Engine run time', true, `${App.lastComputeMs.toFixed(0)} ms for ${r.N} days`]);
    }
    const html = `
      <div class="explain" style="margin-bottom:18px"><b>How this is verified.</b> Each case below builds a tiny portfolio, runs it through the same engine that powers every screen, and compares the result with numbers worked out by hand (formula shown on each row). <b class="${ok === tests.length ? 'gain' : 'loss'}">${ok}/${tests.length} passed.</b></div>
      <div class="grid g-12">
        ${groups.map((g, gi) => `<div class="card ${groups.length % 2 && gi === groups.length - 1 ? 'c-12' : 'c-6'} flush"><div class="card-h"><h2>${esc(g)}</h2></div><div class="table-wrap"><table class="t compact"><thead><tr><th>Check</th><th class="r">By hand</th><th class="r">Engine</th><th></th></tr></thead><tbody>
          ${tests.filter(t => t.group === g).map(t => `<tr><td class="small">${esc(t.label)}${t.note ? `<div class="xs muted">${esc(t.note)}</div>` : ''}</td><td class="r num">${fmtv(t.hand, t.fmt)}</td><td class="r num">${fmtv(t.engine, t.fmt)}</td><td class="r">${t.ok ? '<span class="pill-ok">✓</span>' : '<span class="pill-bad">✗</span>'}</td></tr>`).join('')}
        </tbody></table></div></div>`).join('')}
        <div class="card c-12"><div class="card-h"><h2>Worked example: TWR vs. XIRR</h2></div><div class="small text-2" style="line-height:1.75">
          1 Jan 2025: deposit 1.000 €, buy 10 × 100 €. 30 Jun: price 120 → value 1.200 €. 1 Jul: deposit 600 €, buy 5 × 120 €. 1 Jan 2026: price 110 → value 15 × 110 = 1.650 €.<br>
          <b>TWR</b> = (1.200 / 1.000) × (1.650 / 1.800) − 1 = 1,2 × 0,91667 − 1 = <b>10,00 %</b> — the investment itself gained 10 %.<br>
          <b>XIRR</b>: solve 1.000·(1+r)<sup>365/365</sup> + 600·(1+r)<sup>184/365</sup> = 1.650 → r = <b>3,85 %</b> — lower, because 600 € arrived just before the price fell from 120 to 110.<br>
          <b>FIFO</b>: buy 10 @ 100 (+5 € fee), buy 5 @ 120 (+5 €), sell 12 @ 130 (−6 €): proceeds 1.554 € − cost (1.005 + 2 × 121) = <b>307 €</b> realised; 3 shares left at 121 € each.</div></div>
        ${integrity.length ? `<div class="card c-12 flush"><div class="card-h"><h2>Your data</h2><span class="sub">live integrity checks on the current dataset</span></div><table class="t compact"><tbody>${integrity.map(([k, okk, d]) => `<tr><td>${esc(k)}</td><td class="small text-2">${esc(d)}</td><td class="r">${okk ? '<span class="pill-ok">✓</span>' : `<span class="tag warn">check</span>`}</td></tr>`).join('')}</tbody></table></div>` : ''}
      </div>`;
    return { title: 'Calculation checks', html };
  };
})();
