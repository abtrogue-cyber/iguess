/* =====================================================================
 * Live prices in the browser: quotes from Finnhub or Twelve Data with
 * your own free API key, ECB exchange rates from Frankfurter (no key).
 * The key is kept in this browser only, never in the portfolio data,
 * so backups do not contain it.
 * ===================================================================== */
(function () {
  'use strict';
  const PT = window.PT, App = window.App, F = App.F, esc = F.esc;
  const LS = 'conviction.live.v1';
  const FX_HOSTS = ['https://api.frankfurter.dev/v1/latest', 'https://api.frankfurter.app/latest'];
  const DEFAULTS = { provider: 'finnhub', key: '', onOpen: true, auto: true };

  const L = App.live = { cfg: load(), status: null, quotes: {}, busy: false, timer: null };
  function load() {
    try { return Object.assign({}, DEFAULTS, JSON.parse(localStorage.getItem(LS) || '{}')); } catch (e) { return Object.assign({}, DEFAULTS); }
  }
  L.saveCfg = function () { try { localStorage.setItem(LS, JSON.stringify(L.cfg)); } catch (e) { /* private window: keep it for this session */ } };
  L.enabled = () => !!L.cfg.key;

  const fail = (kind, msg, status) => Object.assign(new Error(msg), { kind, status });
  async function getJSON(url) {
    let res;
    try { res = await fetch(url, { cache: 'no-store' }); } catch (e) { throw fail('network', 'network'); }
    if (res.status === 401) throw fail('auth', 'key rejected', 401);
    if (res.status === 403) throw fail('plan', 'not in your plan', 403);
    if (res.status === 429) throw fail('rate', 'rate limit', 429);
    if (!res.ok) throw fail('http', 'HTTP ' + res.status, res.status);
    try { return await res.json(); } catch (e) { throw fail('http', 'unreadable answer'); }
  }
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  /* ------------------------------------------------------------ providers */
  const PROVIDERS = {
    async finnhub(targets, key, out) {
      for (const t of targets) {
        try {
          const j = await getJSON(`https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(t.symbol)}&token=${encodeURIComponent(key)}`);
          out[t.id] = PT.parseLiveQuote.finnhub(j) || { error: 'no quote for this symbol' };
        } catch (e) {
          if (e.kind === 'plan') out[t.id] = { error: 'not in your plan' };
          else throw e;
        }
        if (targets.length > 20) await sleep(250);
      }
    },
    async twelvedata(targets, key, out) {
      const size = PT.LIVE_PROVIDERS.twelvedata.batch;
      for (let i = 0; i < targets.length; i += size) {
        if (i) { L.status = Object.assign({}, L.status, { note: 'waiting a minute for the rate limit…' }); renderPill(); await sleep(61000); }
        const chunk = targets.slice(i, i + size);
        const j = await getJSON(`https://api.twelvedata.com/quote?symbol=${chunk.map(t => encodeURIComponent(t.symbol)).join(',')}&apikey=${encodeURIComponent(key)}`);
        // errors arrive as HTTP 200 with { code, message, status: 'error' }
        if (j && j.status === 'error') {
          if (j.code === 401) throw fail('auth', 'key rejected', 401);
          if (j.code === 429) throw fail('rate', 'rate limit', 429);
          if (chunk.length > 1) throw fail('http', j.message || 'error');
        }
        const bySym = chunk.length === 1 ? { [chunk[0].symbol]: j } : (j || {});
        chunk.forEach(t => {
          const a = bySym[t.symbol];
          out[t.id] = PT.parseLiveQuote.twelvedata(a) || { error: a && a.code === 403 ? 'not in your plan' : 'no quote for this symbol' };
        });
      }
    }
  };

  async function fetchEcb() {
    for (const u of FX_HOSTS) {
      try { const r = PT.parseEcbRates(await getJSON(u)); if (r) return r; } catch (e) { /* next host */ }
    }
    return null;
  }

  /** Open positions with a symbol to ask for. */
  L.targets = function () {
    const r = App.res;
    if (!r || r.empty) return [];
    return r.positions.filter(p => !(p.expiry && p.expiry < r.asOfISO)).map(p => {
      const ls = PT.liveSymbol(p.inst);
      return ls ? { id: p.id, symbol: ls.symbol, currency: ls.currency, instCurrency: p.currency, label: App.instLabel(p.inst) } : null;
    }).filter(Boolean);
  };

  L.refresh = async function (opts) {
    opts = opts || {};
    if (!L.enabled() || L.busy) return;
    if (App.state.meta && App.state.meta.demo) { L.status = { at: Date.now(), paused: 'Live prices are paused while the demo portfolio is loaded.' }; renderPill(); return; }
    const targets = L.targets();
    const provider = PT.LIVE_PROVIDERS[L.cfg.provider] ? L.cfg.provider : 'finnhub';
    L.busy = true; renderPill();
    const out = {};
    let error = null;
    try {
      const needFx = [...new Set(targets.flatMap(t => [t.currency, t.instCurrency]).concat((App.res.positions || []).map(p => p.currency)))].filter(c => c && c !== 'EUR');
      const ecb = needFx.length ? await fetchEcb() : null;
      if (targets.length) await PROVIDERS[provider](targets, L.cfg.key, out);
      let n = 0;
      App.commit(s => {
        if (ecb) PT.storeFxRates(s, ecb.date, ecb.rates, needFx);
        targets.forEach(t => {
          const q = out[t.id];
          if (!q || q.error) return;
          let price = q.price, prev = q.prevClose;
          if (t.currency !== t.instCurrency) {
            // e.g. a US OTC listing in USD for a Canadian share priced in CAD
            const x = c => { const a = s.fx[c] || []; return c === 'EUR' ? 1 : (a.length ? +a[a.length - 1][1] : NaN); };
            price = PT.convertQuote(price, t.currency, t.instCurrency, x(t.currency), x(t.instCurrency));
            prev = prev ? PT.convertQuote(prev, t.currency, t.instCurrency, x(t.currency), x(t.instCurrency)) : null;
            if (!(price > 0)) { q.error = 'no exchange rate to convert'; return; }
          }
          PT.storeLiveQuote(s, t.id, { price, prevClose: prev, time: q.time });
          n++;
        });
      }, { render: !editing() });
      L.quotes = Object.assign({}, L.quotes, out);
      const missing = targets.filter(t => !out[t.id] || out[t.id].error).map(t => t.label);
      const unquoted = (App.res.positions || []).filter(p => !targets.some(t => t.id === p.id) && !(p.expiry && p.expiry < App.res.asOfISO)).map(p => App.instLabel(p.inst));
      L.status = { at: Date.now(), ok: n, of: targets.length, missing, unquoted, provider, ecb: ecb ? ecb.date : null };
      if (opts.manual) App.toast(`Live prices updated: ${n} of ${targets.length + unquoted.length} holdings${ecb ? ' · ECB rates of ' + F.date(ecb.date) : ''}.`);
    } catch (e) {
      error = e.kind === 'auth' ? `${PT.LIVE_PROVIDERS[provider].label} rejected the API key.`
        : e.kind === 'rate' ? 'The provider’s rate limit was reached — the next refresh will try again.'
        : e.kind === 'network' ? `Could not reach ${PT.LIVE_PROVIDERS[provider].label} (offline, or blocked by the browser).`
        : `Live prices failed: ${e.message}.`;
      L.status = { at: Date.now(), error };
      if (e.kind === 'auth') { L.cfg.auto = false; schedule(); }
      if (opts.manual || opts.boot) App.toast(error, true);
    } finally {
      L.busy = false;
      renderPill();
      if (App.ui.route === 'data' && App.ui.dataTab === 'prices' && !editing()) App.render();
    }
  };

  /* ------------------------------------------------------------ schedule */
  function editing() {
    const a = document.activeElement;
    return !!document.querySelector('.modal-back') || !!(a && /INPUT|TEXTAREA|SELECT/.test(a.tagName) && a.closest('#view'));
  }
  function schedule() {
    clearInterval(L.timer); L.timer = null;
    if (!L.enabled() || !L.cfg.auto) return;
    const every = (PT.LIVE_PROVIDERS[L.cfg.provider] || PT.LIVE_PROVIDERS.finnhub).every * 1000;
    L.timer = setInterval(() => {
      if (document.visibilityState === 'visible' && PT.usMarketOpen() && !editing()) L.refresh({ auto: true });
    }, every);
  }
  L.schedule = schedule;
  L.boot = function () {
    // a tab left open in the background catches up when you come back to it
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState !== 'visible' || !L.enabled() || !L.cfg.onOpen) return;
      const every = (PT.LIVE_PROVIDERS[L.cfg.provider] || PT.LIVE_PROVIDERS.finnhub).every * 1000;
      if (!L.status || Date.now() - L.status.at > every) L.refresh({ auto: true });
    });
    if (!L.enabled()) return;
    schedule();
    if (L.cfg.onOpen) L.refresh({ boot: true });
  };

  /* ------------------------------------------------------- shell widgets */
  const hm = t => new Date(t).toLocaleTimeString(F.loc(), { hour: '2-digit', minute: '2-digit' });
  const fresh = () => L.status && !L.status.error && !L.status.paused && L.status.ok > 0 && Date.now() - L.status.at < 30 * 60e3;
  /** Draws the top-bar status pill when live prices are set up; returns false to fall back to the stored-prices pill. */
  L.pill = function (el) {
    if (!L.enabled()) return false;
    el.style.display = '';
    if (L.busy) { el.className = 'status live busy'; el.innerHTML = '<i></i><span class="t">Live</span><span>…</span>'; el.title = 'Fetching live prices'; return true; }
    if (L.status && L.status.error) { el.className = 'status bad'; el.innerHTML = '<i></i><span class="t">Live</span><span>off</span>'; el.title = L.status.error + ' Click for details.'; return true; }
    if (fresh()) {
      const s = L.status, gaps = s.missing.length + s.unquoted.length;
      el.className = 'status live' + (gaps ? ' partial' : '');
      el.innerHTML = `<i></i><span class="t">Live</span><span>${hm(s.at)}</span>`;
      el.title = `Live prices at ${hm(s.at)} for ${s.ok} holding(s)${gaps ? ' · no live quote: ' + s.missing.concat(s.unquoted).join(', ') : ''}${s.ecb ? ' · ECB rates of ' + F.date(s.ecb) : ''}`;
      return true;
    }
    return false;
  };
  L.tapeLabel = () => fresh() ? `<span class="lbl"><span class="pulse"></span>LIVE · ${hm(L.status.at)}</span>` : null;
  function renderPill() { const el = document.getElementById('price-status'); if (el && !L.pill(el) && App.renderStatus) App.renderStatus(); }

  /* ------------------------------------------------------ settings card */
  L.card = function () {
    const c = L.cfg, prov = PT.LIVE_PROVIDERS[c.provider] || PT.LIVE_PROVIDERS.finnhub, s = L.status;
    const r = App.res;
    const open = r && !r.empty ? r.positions.filter(p => !(p.expiry && p.expiry < r.asOfISO)) : [];
    const provSel = `<select id="lv-prov">${Object.entries(PT.LIVE_PROVIDERS).map(([k, v]) => `<option value="${k}" ${k === c.provider ? 'selected' : ''}>${v.label}</option>`).join('')}</select>`;
    const keyIn = `<input type="password" id="lv-key" autocomplete="off" spellcheck="false" placeholder="${c.key ? '•••••••• saved — paste to replace' : 'paste your free API key'}" style="min-width:240px">`;
    const statusLine = !c.key ? '' : L.busy ? 'Fetching…'
      : s && s.error ? `<span class="neg">${esc(s.error)}</span>`
      : s && s.paused ? esc(s.paused)
      : s ? `Updated ${hm(s.at)} · ${s.ok} of ${s.of + s.unquoted.length} holdings${s.ecb ? ` · ECB rates of ${F.date(s.ecb)}` : ''}` : 'Not fetched yet in this session.';
    const rows = open.map(p => {
      const ls = PT.liveSymbol(p.inst), q = L.quotes[p.id];
      const st = !ls ? '<span class="muted">no symbol</span>' : q && q.error ? `<span class="neg">${esc(q.error)}</span>` : q ? `<span class="pos">live</span> · ${hm(q.time)}` : '<span class="muted">—</span>';
      const last = q && !q.error ? F.price(q.price, ls ? ls.currency : p.currency) : '';
      return `<tr><td><span class="tk">${esc(App.instLabel(p.inst))}</span><div class="nm">${esc(p.inst.type === 'option' ? p.inst.ticker : p.inst.name || '')}</div></td>
        <td><input type="text" data-lv-sym="${p.id}" value="${esc(p.inst.quoteSymbol || '')}" placeholder="${ls && !p.inst.quoteSymbol ? esc(ls.symbol) : 'none'}" style="width:120px"></td>
        <td><select data-lv-ccy="${p.id}">${[p.currency, 'USD', 'EUR', 'CAD', 'GBP', 'CHF'].filter((x, i, a) => x && a.indexOf(x) === i).map(x => `<option ${x === (p.inst.quoteCurrency || p.currency) ? 'selected' : ''}>${x}</option>`).join('')}</select></td>
        <td class="r num">${last}</td><td class="r small">${st}</td></tr>`;
    }).join('');
    const html = `<div class="card c-12 flush" id="live-card">
      <div class="card-h"><h2>Live prices</h2><span class="sub">fetched by your browser each time the app opens · exchange rates from the ECB</span>
        ${c.key ? `<div class="right"><span class="small text-2" id="lv-status">${statusLine}</span><button class="btn sm primary" id="lv-now">${App.icon('refresh')}Refresh now</button></div>` : ''}</div>
      <div style="padding:4px 18px 16px">
        ${c.key ? '' : `<p class="small text-2" style="margin:0 0 12px;max-width:820px">Get a free API key from <a href="${prov.signup}" target="_blank" rel="noopener">${prov.label}</a> and paste it here. ${esc(prov.note)} The key stays in this browser — it is not part of your data or backups. Prices are requested straight from the provider and stored as one price per day, so your history fills in as you use the app.</p>`}
        <div class="row" style="gap:10px;flex-wrap:wrap;align-items:flex-end">
          <label class="f"><span>Provider</span>${provSel}</label>
          <label class="f"><span>API key</span>${keyIn}</label>
          <button class="btn primary" id="lv-save">${c.key ? 'Save' : 'Save & fetch'}</button>
          ${c.key ? '<button class="btn" id="lv-del">Remove key</button>' : ''}
          ${c.key ? `<label class="check small"><input type="checkbox" id="lv-open" ${c.onOpen ? 'checked' : ''}> Fetch when the app opens</label>
          <label class="check small"><input type="checkbox" id="lv-auto" ${c.auto ? 'checked' : ''}> Refresh every ${prov.every >= 120 ? prov.every / 60 + ' minutes' : 'minute'} while the US market is open</label>` : ''}
        </div>
      </div>
      ${c.key && open.length ? `<div class="table-wrap"><table class="t compact"><thead><tr><th>Holding</th><th>Live symbol</th><th>Quote currency</th><th class="r">Last quote</th><th class="r">Status</th></tr></thead><tbody>${rows}</tbody></table></div>
      <div class="row" style="padding:12px 18px;gap:12px"><span class="small text-2 grow">Free plans cover US-listed shares and ETFs. For another listing, enter the symbol your provider uses, e.g. a US OTC symbol for a Canadian share; a quote in another currency is converted at the ECB rate. Options and warrants keep the prices you enter.</span><button class="btn" id="lv-map">Save symbols</button></div>` : ''}
    </div>`;
    return {
      html, mount(root) {
        const $ = id => root.querySelector('#' + id);
        $('lv-save').addEventListener('click', () => {
          const k = $('lv-key').value.trim();
          const p = $('lv-prov').value;
          if (!k && !c.key) return App.toast('Paste your API key first.', true);
          const changed = (k && k !== c.key) || p !== c.provider;
          if (k) c.key = k;
          c.provider = p;
          if (changed) { c.auto = true; L.quotes = {}; L.status = null; }
          L.saveCfg(); schedule(); App.render();
          if (changed || !L.status) L.refresh({ manual: true });
        });
        if ($('lv-del')) $('lv-del').addEventListener('click', () => { c.key = ''; L.saveCfg(); schedule(); L.status = null; L.quotes = {}; App.render(); App.toast('API key removed from this browser.'); });
        if ($('lv-now')) $('lv-now').addEventListener('click', () => L.refresh({ manual: true }));
        if ($('lv-open')) $('lv-open').addEventListener('change', e => { c.onOpen = e.target.checked; L.saveCfg(); });
        if ($('lv-auto')) $('lv-auto').addEventListener('change', e => { c.auto = e.target.checked; L.saveCfg(); schedule(); });
        if ($('lv-map')) $('lv-map').addEventListener('click', () => {
          App.commit(s => root.querySelectorAll('[data-lv-sym]').forEach(inp => {
            const i = s.instruments.find(x => x.id === inp.dataset.lvSym); if (!i) return;
            const sym = inp.value.trim().toUpperCase(), ccy = root.querySelector(`[data-lv-ccy="${i.id}"]`).value;
            if (sym) { i.quoteSymbol = sym; i.quoteCurrency = ccy; } else { delete i.quoteSymbol; delete i.quoteCurrency; }
          }));
          App.toast('Live symbols saved.');
          L.refresh({ manual: true });
        });
      }
    };
  };
})();
