/* =====================================================================
 * Analytics views: dashboard, positions, position detail, allocation,
 * performance, closed positions.
 * ===================================================================== */
(function () {
  'use strict';
  const PT = window.PT, App = window.App, F = App.F, esc = F.esc;
  const V = App.views = {};
  const tip = App.tip, icon = App.icon;
  const PERIODS = ['1M', '3M', 'YTD', '1Y', 'ALL'];
  const pLabel = k => k === 'ALL' ? 'All' : k;

  function emptyView(title) {
    return {
      title: title || 'Dashboard',
      html: `<div class="card"><div class="empty-state"><div class="ico">${icon('data')}</div><h2>No transactions yet</h2>
        <p>Import a DEGIRO or IBKR CSV export, add trades by hand, or load the demo portfolio.</p>
        <div class="row" style="justify-content:center;margin-top:18px"><button class="btn primary" data-act="goto-import">${icon('upload')}Import CSV</button><button class="btn" data-act="add-trade">${icon('plus')}Add transaction</button><button class="btn" data-act="load-demo">Load demo data</button></div></div></div>`
    };
  }
  App.actions['load-demo'] = () => App.confirm('Load demo data?', 'This replaces the current dataset with the synthetic demo portfolio. Export a backup first if you need your data.', 'Load demo', () => {
    const keep = App.state.settings;
    App.state = App.migrate(PT.buildDemo());
    App.state.settings = Object.assign(App.state.settings, { locale: keep.locale, theme: keep.theme, cb: keep.cb });
    App.commit(); App.toast('Demo portfolio loaded.');
  });
  App.emptyView = emptyView;

  const periodChips = (cur, attr) => `<div class="chips" role="tablist">${PERIODS.map(p => `<button class="chip ${p === cur ? 'on' : ''}" data-${attr}="${p}" role="tab" aria-selected="${p === cur}">${pLabel(p)}</button>`).join('')}</div>`;

  /* ---------------------------------------------------- equity chart */
  App.equityChart = function (canvasId, period, mode, benchIds) {
    const r = App.res, T = App.theme();
    const base = PT.periodBase(period, r.asOf, r.start);
    const i0 = Math.max(0, base - r.start + 1), i1 = r.N - 1;
    const idxs = [];
    for (let i = i0; i <= i1; i++) if (!PT.isWeekend(r.days[i]) || i === i1) idxs.push(i);
    const step = Math.max(1, Math.ceil(idxs.length / 700));
    const pick = idxs.filter((_, k) => k % step === 0 || k === idxs.length - 1);
    const ms = d => d * PT.DAY;
    const ds = [];
    if (mode === 'value') {
      ds.push({ label: 'Portfolio value', data: pick.map(i => ({ x: ms(r.days[i]), y: r.V[i] })), borderColor: T.accent, backgroundColor: App.alpha(T.accent.length === 7 ? T.accent : '#9085e9', 0.10), fill: true, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: 0 });
      ds.push({ label: 'Net invested', data: pick.map(i => ({ x: ms(r.days[i]), y: r.NETINV[i] })), borderColor: T.muted, borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 3, stepped: true, fill: false });
    } else {
      const baseIdx = i0 > 0 ? r.IDX[i0 - 1] : 1;
      const pts = pick.map(i => ({ x: ms(r.days[i]), y: r.IDX[i] / baseIdx - 1 }));
      pts.unshift({ x: ms(r.days[i0] - 1), y: 0 });
      ds.push({ label: 'Portfolio (TWR)', data: pts, borderColor: T.accent, borderWidth: 2.25, pointRadius: 0, pointHoverRadius: 4, tension: 0, order: 0 });
      (benchIds || []).forEach((id, j) => {
        const b = r.benchmarks.find(x => x.id === id);
        if (!b || !b.has) return;
        let b0 = i0 > 0 ? b.vals[i0 - 1] : NaN;
        if (!isFinite(b0)) { for (let i = i0; i <= i1; i++) if (isFinite(b.vals[i])) { b0 = b.vals[i]; break; } }
        if (!isFinite(b0)) return;
        const bp = pick.filter(i => isFinite(b.vals[i])).map(i => ({ x: ms(r.days[i]), y: b.vals[i] / b0 - 1 }));
        bp.unshift({ x: ms(r.days[i0] - 1), y: 0 });
        ds.push({ label: b.name, data: bp, borderColor: App.benchColor(id, T, j), borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 3, tension: 0, order: 1 });
      });
    }
    return App.chart(canvasId, {
      type: 'line', data: { datasets: ds }, plugins: [App.crosshair],
      options: {
        parsing: false, normalized: true, interaction: { mode: 'index', intersect: false },
        scales: {
          x: App.timeAxis(T, null, [ms(r.days[i0] - 1), ms(r.days[i1])]),
          y: App.valueAxis(T, v => mode === 'value' ? F.eur(v, { dec: 0, compact: true }) : F.pct(v, { dec: 0 }))
        },
        plugins: {
          tooltip: Object.assign(App.tooltipStyle(T), {
            callbacks: {
              title: items => items.length ? F.date(Math.round(items[0].parsed.x / PT.DAY), 'med') : '',
              label: c => ` ${c.dataset.label}: ${mode === 'value' ? F.eur(c.parsed.y, { dec: 0 }) : F.pct(c.parsed.y)}`
            }
          })
        }
      }
    });
  };
  function benchLegend(ids, mode) {
    const T = App.theme(), r = App.res;
    if (mode === 'value') return `<div class="legend"><span><i style="background:${T.accent}"></i>Portfolio value</span><span><i style="background:${T.muted}"></i>Net invested</span></div>`;
    return `<div class="legend"><span><i style="background:${T.accent}"></i>Portfolio (TWR)</span>${ids.map((id, j) => { const b = r.benchmarks.find(x => x.id === id); return b && b.has ? `<span><i style="background:${App.benchColor(id, T, j)}"></i>${esc(b.name)}</span>` : ''; }).join('')}</div>`;
  }
  function benchToggles(sel) {
    const T = App.theme();
    return App.res.benchmarks.map((b, j) => `<button class="chip ${sel.includes(b.id) ? 'on' : ''}" data-bench="${b.id}" ${b.has ? '' : 'disabled title="No data — add it under Data & prices → Benchmarks"'}><span class="sw" style="background:${App.benchColor(b.id, T, j)}"></span>${esc(b.name.replace(/\s*\(.*\)/, ''))}</button>`).join('');
  }

  /* ------------------------------------------------ attribution chart */
  App.attributionChart = function (canvasId) {
    const a = App.res.attribution, T = App.theme();
    const items = [
      ['Price effect', a.pricePE], ['Currency effect', a.fxFE], ['Dividends', a.dividends], ['Withholding tax', a.taxes],
      ['Interest', a.interest], ['Fees', a.tradeFees + a.otherFees]
    ];
    if (Math.abs(a.fxadj) > 0.5) items.push(['FX adjustments', a.fxadj]);
    if (Math.abs(a.residual) > 0.5) items.push(['Other', a.residual]);
    let run = 0;
    const bars = items.map(([k, v]) => { const s = run; run += v; return { k, v, lo: s, hi: run }; });
    bars.push({ k: 'Total P&L', v: run, lo: 0, hi: run, total: true });
    const labels = {
      id: 'vlabels',
      afterDatasetsDraw(ch) {
        if (ch.width < 520) return; // too narrow for value labels — tooltip carries them
        const ctx = ch.ctx, meta = ch.getDatasetMeta(0);
        ctx.save(); ctx.font = `600 11px ${getComputedStyle(document.documentElement).getPropertyValue('--font')}`; ctx.fillStyle = T.text2; ctx.textAlign = 'center';
        meta.data.forEach((el, i) => {
          const b = bars[i]; const up = b.v >= 0;
          const y = up ? Math.min(el.y, el.base) - 6 : Math.max(el.y, el.base) + 14;
          ctx.fillText(F.eur(b.v, { dec: 0, compact: true, sign: !b.total }), el.x, y);
        });
        ctx.restore();
      }
    };
    return App.chart(canvasId, {
      type: 'bar', plugins: [labels],
      data: {
        labels: bars.map(b => b.k),
        datasets: [{ data: bars.map(b => [b.lo, b.hi]), backgroundColor: bars.map(b => b.total ? T.accent : (b.v >= 0 ? T.gain : T.loss)), borderRadius: 4, borderSkipped: false, maxBarThickness: 34, categoryPercentage: 0.7 }]
      },
      options: {
        layout: { padding: { top: 18 } },
        scales: {
          x: { grid: { display: false }, border: { color: T.axis }, ticks: { color: T.muted, autoSkip: false, maxRotation: 0, font: { size: 10.5 }, callback: function (v) { const l = this.getLabelForValue(v); return l.length > 11 ? l.split(' ') : l; } } },
          y: App.valueAxis(T, v => F.eur(v, { dec: 0, compact: true }), { grace: '12%' })
        },
        plugins: { tooltip: Object.assign(App.tooltipStyle(T), { displayColors: false, callbacks: { label: c => ' ' + F.eur(bars[c.dataIndex].v, { sign: !bars[c.dataIndex].total }) } }) }
      }
    });
  };

  /* --------------------------------------------------- donut + legend */
  function topSlices(rows, n) {
    rows = rows.filter(x => x.v > 0).sort((a, b) => b.v - a.v);
    const tot = rows.reduce((s, x) => s + x.v, 0);
    const top = rows.slice(0, n), rest = rows.slice(n);
    if (rest.length) top.push({ k: `Other (${rest.length})`, v: rest.reduce((s, x) => s + x.v, 0), other: true });
    return { slices: top, tot, all: rows };
  }
  App.donut = function (canvasId, slices, tot) {
    const T = App.theme();
    return App.chart(canvasId, {
      type: 'doughnut',
      data: { labels: slices.map(s => s.k), datasets: [{ data: slices.map(s => s.v), backgroundColor: slices.map((s, i) => s.other ? T.other : T.cats[i % 5]), borderColor: T.surface, borderWidth: 2, hoverOffset: 4 }] },
      options: { cutout: '72%', plugins: { tooltip: Object.assign(App.tooltipStyle(T), { callbacks: { label: c => ` ${c.label}: ${F.pct(c.parsed / tot, { sign: false })} · ${F.eur(c.parsed, { dec: 0 })}` } }) } }
    });
  };
  function sliceList(slices, tot) {
    const T = App.theme();
    return `<div class="alloc-list">${slices.map((s, i) => `<div class="alloc-row"><span class="sw" style="background:${s.other ? T.other : T.cats[i % 5]}"></span><span class="name" title="${esc(s.k)}">${esc(s.k)}</span><span class="w num">${F.pct(s.v / tot, { dec: 1, sign: false })}</span><span class="eur num">${F.eur(s.v, { dec: 0 })}</span></div>`).join('')}</div>`;
  }

  /* ============================================================ dashboard */
  V.dashboard = function () {
    const r = App.res;
    if (r.empty) return emptyView();
    const ui = App.ui, tot = r.totals;
    const m1d = App.metrics('1D'), mytd = App.metrics('YTD'), mall = App.metrics('ALL');
    const conc = PT.concentration(r.positions, App.state.settings.concThreshold);
    const alloc = topSlices(r.positions.map(p => ({ k: App.instLabel(p.inst), v: p.value })), 5);
    const first = !ui.counted.dashboard; ui.counted.dashboard = true;
    const cnt = (v, f) => first ? `data-count="${v}" data-fmt="${f}"` : '';
    const winners = r.positions.filter(p => isFinite(p.unreal)).sort((a, b) => b.unreal - a.unreal);
    const recent = [...App.state.transactions.map(t => ({ d: t.date, t, kind: 'trade' })), ...App.state.cash.filter(c => c.type !== 'interest' && c.type !== 'fee').map(c => ({ d: c.date, c, kind: 'cash' }))]
      .filter(x => x.d <= r.asOfISO).sort((a, b) => a.d < b.d ? 1 : -1).slice(0, 7);
    const thr = App.state.settings.concThreshold;
    const html = `
    <div class="grid g-12">
      <div class="card c-12">
        <div class="hero">
          <div>
            <div class="label">Total portfolio value ${tip('value')}</div>
            <div class="value num" ${cnt(tot.value, 'hero')}>${App.heroHTML(tot.value)}</div>
            <div class="delta-row">
              <span class="delta" data-tip="Change since the previous trading day before your latest prices (${F.date(PT.iso(r.lastPriceDay))})"><span class="k">1D</span><span class="v ${F.cls(m1d.pnl)}">${F.eur(m1d.pnl, { sign: true })}</span><span class="${F.cls(m1d.twr)} small">${F.pct(m1d.twr)}</span></span>
              <span class="delta"><span class="k">YTD</span><span class="v ${F.cls(mytd.pnl)}">${F.eur(mytd.pnl, { sign: true, dec: 0 })}</span><span class="${F.cls(mytd.twr)} small">${F.pct(mytd.twr)}</span>${tip('ytd')}</span>
              <span class="delta"><span class="k">ALL-TIME</span><span class="v ${F.cls(tot.pnl)}">${F.eur(tot.pnl, { sign: true, dec: 0 })}</span><span class="${F.cls(mall.twr)} small">${F.pct(mall.twr)} TWR</span></span>
            </div>
          </div>
          <div class="stat-grid">
            <div class="stat"><div class="k">Net invested ${tip('invested')}</div><div class="v num" ${cnt(tot.netInvested, 'eur')}>${F.eur(tot.netInvested)}</div><div class="s">since ${F.date(r.startISO, 'med')}</div></div>
            <div class="stat"><div class="k">Absolute return ${tip('pnl')}</div><div class="v num ${F.cls(tot.pnl)}" ${cnt(tot.pnl, 'seur')}>${F.eur(tot.pnl, { sign: true })}</div><div class="s">${F.pct(tot.simpleReturn)} on net invested</div></div>
            <div class="stat"><div class="k">TWR ${tip('twr')}</div><div class="v num ${F.cls(mall.twr)}">${F.pct(mall.twr)}</div><div class="s">${mall.annualizedMeaningful ? F.pct(mall.ann) + ' p.a.' : 'cumulative'}</div></div>
            <div class="stat"><div class="k">XIRR (money-weighted) ${tip('xirr')}</div><div class="v num ${F.cls(mall.xirr)}">${F.pct(mall.xirr)}</div><div class="s">p.a. · ${tip('twrvsmwr')} why it differs</div></div>
          </div>
        </div>
      </div>

      <div class="card c-8">
        <div class="card-h"><h2>${ui.eqMode === 'value' ? 'Portfolio value' : 'Performance vs. benchmarks'}</h2>
          <div class="right">
            <div class="seg"><button class="${ui.eqMode !== 'value' ? 'on' : ''}" data-eqmode="perf">Return</button><button class="${ui.eqMode === 'value' ? 'on' : ''}" data-eqmode="value">Value</button></div>
            ${periodChips(ui.eqPeriod, 'eqp')}
          </div></div>
        <div class="row" style="margin-bottom:10px">${ui.eqMode === 'value' ? '' : `<div class="chips">${benchToggles(ui.eqBench)}</div>`}<div class="spacer"></div>${benchLegend(ui.eqBench, ui.eqMode)}</div>
        <div class="chart h-280"><canvas id="ch-eq" aria-label="Equity curve"></canvas></div>
      </div>

      <div class="card c-4">
        <div class="card-h"><h2>Allocation</h2><span class="sub">by position</span><div class="right"><a href="#/allocation" class="small">Details →</a></div></div>
        <div class="donut-wrap" style="grid-template-columns:1fr">
          <div class="chart" style="height:190px"><canvas id="ch-donut"></canvas><div class="donut-center"><div><div class="k">Securities</div><div class="v num">${F.eur(alloc.tot, { dec: 0, compact: true })}</div></div></div></div>
          ${sliceList(alloc.slices, alloc.tot)}
        </div>
      </div>

      <div class="card c-6">
        <div class="card-h"><h2>Where the return came from</h2>${tip('attribution')}<div class="right"><span class="sub">all-time · EUR</span></div></div>
        <div class="chart h-240"><canvas id="ch-attr"></canvas></div>
      </div>

      <div class="card c-3">
        <div class="card-h"><h2>Risk</h2><div class="right"><span class="sub">since inception</span></div></div>
        <div class="stack" style="gap:12px">
          ${riskRow('Volatility', F.pct(mall.vol, { sign: false }), 'vol')}
          ${riskRow('Max drawdown', `<span class="loss">${F.pct(mall.maxDD)}</span>`, 'mdd')}
          ${riskRow('Sharpe', F.num(mall.sharpe, 2), 'sharpe')}
          ${riskRow('Sortino', F.num(mall.sortino, 2), 'sortino')}
          ${mall.active < 40 ? `<div class="tag warn" style="white-space:normal" data-tip="Risk ratios need a daily price history. Import closes under Data & prices → Prices.">Only ${mall.active} days with price changes — ratios are unreliable</div>` : ''}<div class="xs muted">r<sub>f</sub> = ${F.pct(App.state.settings.rf, { sign: false })} (€STR) · <a href="#/performance">more →</a></div>
        </div>
      </div>

      <div class="card c-3">
        <div class="card-h"><h2>Concentration</h2>${tip('top3')}</div>
        <div class="stack" style="gap:13px">
          <div><div class="row small"><span class="text-2">Largest · ${conc.largest ? esc(App.instLabel(conc.largest.inst)) : '—'}</span><span class="spacer"></span><b class="num">${F.pct(conc.largest ? conc.largest.weight : 0, { sign: false, dec: 1 })}</b></div>
            <div class="meter" style="margin-top:6px"><div class="fill" style="width:${Math.min(100, (conc.largest ? conc.largest.weight : 0) * 100 / Math.max(thr * 2, 0.5) * 1)}%;${conc.breaches.length ? 'background:var(--warn)' : ''}"></div><div class="mark" style="left:${Math.min(99, thr * 100 / Math.max(thr * 2, 0.5))}%" title="Threshold ${F.pct(thr, { sign: false })}"></div></div></div>
          <div><div class="row small"><span class="text-2">Top-3 weight</span><span class="spacer"></span><b class="num">${F.pct(conc.top3, { sign: false, dec: 1 })}</b></div>
            <div class="meter" style="margin-top:6px"><div class="fill" style="width:${Math.min(100, conc.top3 * 100)}%"></div></div></div>
          <div class="row small"><span class="text-2">Effective number of positions</span><span class="spacer"></span><b class="num">${F.num(conc.effectiveN, 1)}</b></div>
          ${conc.breaches.length ? `<div class="tag warn" style="white-space:normal">${icon('alert')} ${conc.breaches.map(p => esc(App.instLabel(p.inst)) + ' ' + F.pct(p.weight, { sign: false, dec: 1 })).join(', ')} above ${F.pct(thr, { sign: false, dec: 0 })}</div>` : `<div class="xs muted">No position above your ${F.pct(thr, { sign: false, dec: 0 })} limit.</div>`}
        </div>
      </div>

      <div class="card c-6">
        <div class="card-h"><h2>Biggest contributors</h2><span class="sub">unrealised P&L</span><div class="right"><a class="small" href="#/positions">All positions →</a></div></div>
        <div class="grid two-col" style="gap:22px">
          <div>${winners.slice(0, 4).map(contribRow).join('')}</div>
          <div>${winners.slice(-4).reverse().filter(p => p.unreal < 0).map(contribRow).join('') || '<div class="muted small" style="padding:10px 0">No losing positions.</div>'}</div>
        </div>
      </div>

      <div class="card c-6">
        <div class="card-h"><h2>Recent activity</h2><div class="right"><a class="small" href="#/activity">All activity →</a></div></div>
        ${recent.map(x => {
          if (x.kind === 'trade') {
            const t = x.t, inst = App.instById(t.instId);
            return `<div class="list-row"><span class="tag ${t.type === 'buy' ? 'accent' : ''}">${typeLabel(t.type)}</span><a href="#/position/${t.instId}" class="tk">${esc(App.instLabel(inst))}</a><span class="muted small">${t.type === 'split' ? '' : F.qty(t.qty) + ' @ ' + F.price(t.price, t.currency)}</span><span class="spacer"></span><span class="muted small">${F.date(t.date)}</span></div>`;
          }
          const c = x.c;
          return `<div class="list-row"><span class="tag">${typeLabel(c.type)}</span><span class="text-2">${c.instId ? esc(App.instLabel(App.instById(c.instId))) : esc(c.note || '')}</span><span class="spacer"></span><span class="num ${F.cls(c.amount)}">${F.price(c.amount, c.currency)}</span><span class="muted small">${F.date(c.date)}</span></div>`;
        }).join('') || '<div class="muted">Nothing yet.</div>'}
      </div>
    </div>`;
    return {
      title: 'Dashboard', html,
      mount(root) {
        App.equityChart('ch-eq', ui.eqPeriod, ui.eqMode, ui.eqBench);
        App.donut('ch-donut', alloc.slices, alloc.tot);
        App.attributionChart('ch-attr');
        root.querySelectorAll('[data-eqp]').forEach(b => b.addEventListener('click', () => { ui.eqPeriod = b.dataset.eqp; App.render(); }));
        root.querySelectorAll('[data-eqmode]').forEach(b => b.addEventListener('click', () => { ui.eqMode = b.dataset.eqmode; App.render(); }));
        root.querySelectorAll('[data-bench]').forEach(b => b.addEventListener('click', () => { const id = b.dataset.bench; ui.eqBench = ui.eqBench.includes(id) ? ui.eqBench.filter(x => x !== id) : [...ui.eqBench, id]; App.render(); }));
      }
    };
  };
  function riskRow(k, v, t) { return `<div class="row"><span class="text-2 small">${k}</span>${tip(t)}<span class="spacer"></span><b class="num">${v}</b></div>`; }
  function contribRow(p) {
    return `<a class="list-row" href="#/position/${p.id}" style="color:inherit;text-decoration:none"><span class="tk">${esc(App.instLabel(p.inst))}</span><span class="spacer"></span><span class="num ${F.cls(p.unreal)}">${F.eur(p.unreal, { sign: true, dec: 0 })}</span><span class="num small ${F.cls(p.unreal)}" style="min-width:58px;text-align:right">${F.pct(p.unrealPct, { dec: 1 })}</span></a>`;
  }
  const typeLabel = t => ({ buy: 'Buy', sell: 'Sell', split: 'Split', transfer_in: 'Transfer in', transfer_out: 'Transfer out', deposit: 'Deposit', withdrawal: 'Withdrawal', dividend: 'Dividend', tax: 'Tax', interest: 'Interest', fee: 'Fee', fxadj: 'FX adj.' }[t] || t);
  App.typeLabel = typeLabel;

  /* ============================================================ positions */
  function sparkVals(id, days) {
    const r = App.res, ps = r.priceSeries[id];
    if (!ps || !ps.n) return [];
    const from = r.asOf - (days || 90);
    const out = [];
    for (let i = 0; i < ps.n; i++) if (ps.xs[i] >= from && ps.xs[i] <= r.asOf) out.push(ps.ys[i]);
    return out;
  }
  V.positions = function () {
    const r = App.res, ui = App.ui;
    if (r.empty) return emptyView('Positions');
    const thr = App.state.settings.concThreshold;
    let rows = r.positions.slice();
    if (!ui.posOptions) rows = rows.filter(p => p.inst.type !== 'option');
    const q = ui.posQuery.trim().toLowerCase();
    if (q) rows = rows.filter(p => [p.inst.ticker, p.inst.name, p.inst.isin, (p.inst.tags || []).join(' '), p.broker, p.currency].join(' ').toLowerCase().includes(q));
    const key = {
      ticker: p => App.instLabel(p.inst).toLowerCase(), weight: p => p.weight, qty: p => p.qty, cost: p => p.cost, value: p => p.value, unreal: p => p.unreal,
      unrealPct: p => p.unrealPct, realized: p => p.realized, currency: p => p.currency, hold: p => p.holdDays, price: p => p.price, total: p => p.totalReturn
    }[ui.posSort.k] || (p => p.value);
    rows.sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * ui.posSort.dir; });
    const th = (k, label, cls, t) => `<th class="sortable ${cls || ''}" data-sort="${k}">${label}${t ? ' ' + tip(t) : ''}${ui.posSort.k === k ? `<span class="arr">${ui.posSort.dir > 0 ? '▲' : '▼'}</span>` : ''}</th>`;
    const sum = rows.reduce((o, p) => { o.cost += p.cost; o.value += p.value; o.unreal += isFinite(p.unreal) ? p.unreal : 0; o.realized += p.realized; o.w += p.weight; return o; }, { cost: 0, value: 0, unreal: 0, realized: 0, w: 0 });
    const html = `
      <div class="card flush">
        <div class="card-h" style="padding-bottom:14px">
          <h2>${rows.length} open position${rows.length === 1 ? '' : 's'}</h2><span class="sub">${F.eur(sum.value, { dec: 0 })} · ${F.pct(sum.w, { sign: false, dec: 1 })} of portfolio</span>
          <div class="right">
            <input type="search" id="pos-q" placeholder="Search ticker, name, tag…" value="${esc(ui.posQuery)}" style="width:220px">
            <label class="check"><input type="checkbox" id="pos-opt" ${ui.posOptions ? 'checked' : ''}> Options & warrants</label>
          </div>
        </div>
        <div class="table-wrap"><table class="t">
          <thead><tr>
            ${th('ticker', 'Instrument')}${th('weight', 'Weight', 'r', 'weight')}${th('qty', 'Qty', 'r')}<th class="r">Avg cost</th>${th('price', 'Price', 'r')}
            ${th('cost', 'Cost basis', 'r')}${th('value', 'Value', 'r', 'value')}${th('unreal', 'P&L € / %', 'r', 'unreal')}${th('realized', 'Realised', 'r', 'realized')}
            ${th('currency', 'Ccy')}${th('hold', 'Held', 'r', 'hold')}<th class="r">90 days</th>
          </tr></thead>
          <tbody>
          ${rows.map(p => {
            const breach = p.weight > thr;
            const badges = [p.side === 'short' ? '<span class="tag">Short</span>' : '', p.missingPrice ? '<span class="tag loss">No price</span>' : (p.stale ? `<span class="tag warn" data-tip="Last price from ${F.date(p.priceDate)} (${p.priceSource === 'stored' ? 'stored' : 'last trade'})">Stale</span>` : ''), p.zeroCost ? '<span class="tag">Zero cost</span>' : ''].join('');
            return `<tr class="click" data-pos="${p.id}">
              <td style="max-width:230px"><div class="row" style="gap:6px;flex-wrap:nowrap"><span class="tk nowrap">${esc(App.instLabel(p.inst))}</span>${badges}</div><div class="nm">${p.broker ? `<span class="badge-broker" style="margin-right:5px">${esc(p.broker)}</span>` : ''}${esc(p.inst.type === 'option' ? p.inst.ticker : p.inst.name)}</div></td>
              <td class="r"><div class="wbar ${breach ? 'breach' : ''}"><span class="num">${F.pct(p.weight, { sign: false, dec: 1 })}</span><span class="track"><span class="fill" style="display:block;width:${Math.min(100, Math.abs(p.weight) / Math.max(thr, 0.0001) * 50)}%"></span></span></div></td>
              <td class="r num">${F.qty(p.qty)}</td>
              <td class="r num">${F.price(p.avgCostLocal, p.currency)}</td>
              <td class="r num">${F.price(p.price, p.currency)}<div class="xs muted">${p.priceDate ? F.date(p.priceDate) : ''}</div></td>
              <td class="r num">${F.eur(p.cost, { dec: 0 })}</td>
              <td class="r num"><b>${F.eur(p.value, { dec: 0 })}</b></td>
              <td class="r" data-tip="Price effect ${F.eur(p.pe, { dec: 0, sign: true })} · currency effect ${F.eur(p.fe, { dec: 0, sign: true })}">${F.seur(p.unreal, { dec: 0 })}<div class="xs">${F.spct(p.unrealPct, { dec: 1 })}</div></td>
              <td class="r">${Math.abs(p.realized) > 0.005 ? F.seur(p.realized, { dec: 0 }) : '<span class="muted">—</span>'}</td>
              <td><span class="muted">${esc(p.currency)}</span></td>
              <td class="r num nowrap" data-tip="Since ${F.date(p.since)} · avg lot age ${F.dur(p.avgAge)}">${F.dur(p.holdDays)}</td>
              <td class="r">${App.spark(sparkVals(p.id, 90))}</td>
            </tr>`;
          }).join('')}
          </tbody>
          <tfoot><tr><td>Total</td><td class="r num">${F.pct(sum.w, { sign: false, dec: 1 })}</td><td></td><td></td><td></td><td class="r num">${F.eur(sum.cost, { dec: 0 })}</td><td class="r num">${F.eur(sum.value, { dec: 0 })}</td><td class="r">${F.seur(sum.unreal, { dec: 0 })}<div class="xs">${F.spct(sum.cost ? sum.unreal / sum.cost : NaN, { dec: 1 })}</div></td><td class="r">${F.seur(sum.realized, { dec: 0 })}</td><td colspan="3"></td></tr></tfoot>
        </table></div>
      </div>
      <p class="xs muted" style="margin-top:12px">FIFO cost basis incl. purchase fees. Written options are short positions — their value is the (negative) cost to buy them back. Cash: ${F.eur(r.cash)}.</p>`;
    return {
      title: 'Positions', html,
      mount(root) {
        root.querySelectorAll('[data-sort]').forEach(t => t.addEventListener('click', () => { const k = t.dataset.sort; ui.posSort = { k, dir: ui.posSort.k === k ? -ui.posSort.dir : (k === 'ticker' || k === 'currency' ? 1 : -1) }; App.render(); }));
        root.querySelectorAll('[data-pos]').forEach(tr => tr.addEventListener('click', e => { if (e.target.closest('a,button')) return; App.go('position/' + tr.dataset.pos); }));
        const qi = root.querySelector('#pos-q');
        qi.addEventListener('input', () => { ui.posQuery = qi.value; clearTimeout(qi._t); qi._t = setTimeout(() => { App.render(); const n = document.getElementById('pos-q'); n.focus(); n.setSelectionRange(n.value.length, n.value.length); }, 180); });
        root.querySelector('#pos-opt').addEventListener('change', e => { ui.posOptions = e.target.checked; App.render(); });
      }
    };
  };

  /* ===================================================== position detail */
  function avgCostPath(txs) {
    let lots = [];
    const out = [];
    txs.forEach(t => {
      const d = PT.dn(t.date);
      if (t.type === 'split') { const r = +t.ratio || 1; lots.forEach(l => { l.q *= r; l.p /= r; }); }
      else if (t.type === 'buy' || t.type === 'sell') {
        const s = t.type === 'buy' ? 1 : -1;
        let rem = +t.qty;
        while (rem > 1e-9 && lots.length && Math.sign(lots[0].q) === -s) { const m = Math.min(rem, Math.abs(lots[0].q)); lots[0].q += s * m; rem -= m; if (Math.abs(lots[0].q) < 1e-9) lots.shift(); }
        if (rem > 1e-9) lots.push({ q: s * rem, p: +t.price });
      } else return;
      const q = lots.reduce((a, l) => a + l.q, 0);
      out.push([d, Math.abs(q) > 1e-9 ? lots.reduce((a, l) => a + l.q * l.p, 0) / q : NaN]);
    });
    return out;
  }
  V.position = function (id) {
    const r = App.res, inst = App.instById(id);
    if (!inst) return { title: 'Not found', html: '<div class="card">This instrument no longer exists. <a href="#/positions">Back to positions</a></div>' };
    const p = r.positions.find(x => x.id === id);
    const st = r.instState ? r.instState[id] : null;
    const ui = App.ui;
    const txs = App.state.transactions.filter(t => t.instId === id).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : (a.seq || 0) - (b.seq || 0));
    const divs = App.state.cash.filter(c => c.instId === id).sort((a, b) => a.date < b.date ? 1 : -1);
    const realized = r.realized ? r.realized.filter(x => x.instId === id) : [];
    const rz = realized.reduce((s, x) => s + x.pnl, 0);
    const divNet = st && st.summary ? st.summary.dividends : (p ? p.dividends : 0);
    const cur = inst.currency;
    const tags = (inst.tags || []).map(t => `<span class="tag accent">${esc(t)}</span>`).join(' ');
    const tiles = p ? [
      ['Market value', `<span class="num">${F.eur(p.value)}</span>`, `${F.pct(p.weight, { sign: false, dec: 1 })} of portfolio`],
      ['Quantity', `<span class="num">${F.qty(p.qty)}</span>`, inst.multiplier > 1 ? `× ${inst.multiplier} multiplier` : (p.side === 'short' ? 'short' : 'shares')],
      ['Avg cost', `<span class="num">${F.price(p.avgCostLocal, cur)}</span>`, `${F.eur(p.avgCostEUR)} / unit incl. fees`],
      ['Last price', `<span class="num">${F.price(p.price, cur)}</span>`, `${p.priceDate ? F.date(p.priceDate) : '—'} · ${p.priceSource === 'stored' ? 'stored' : 'last trade'}`],
      ['Unrealised ' + tip('unreal'), F.seur(p.unreal), `${F.pct(p.unrealPct, { dec: 1 })} · price ${F.eur(p.pe, { sign: true, dec: 0 })} · FX ${F.eur(p.fe, { sign: true, dec: 0 })}`],
      ['Realised ' + tip('realized'), F.seur(rz), `${realized.length} lot slice(s) closed`],
      ['Dividends (net)', F.seur(divNet), `gross ${F.eur(p.divGross)} · tax ${F.eur(-p.divTax)}`],
      ['Total return', F.seur(p.totalReturn), 'unrealised + realised + dividends']
    ] : [
      ['Status', 'Closed', st && st.trips && st.trips.length ? `last closed ${F.date(PT.iso(st.trips[st.trips.length - 1].end))}` : 'no open quantity'],
      ['Realised ' + tip('realized'), F.seur(rz), `${realized.length} lot slice(s)`],
      ['Dividends (net)', F.seur(divNet), ''],
      ['Total return', F.seur(rz + divNet), 'realised + dividends']
    ];
    const lots = p ? p.lots : [];
    const html = `
      <div class="row" style="margin-bottom:14px"><a href="#/positions" class="btn ghost sm">${icon('back')}Positions</a></div>
      <div class="card" style="margin-bottom:18px">
        <div class="row" style="align-items:flex-start;gap:16px">
          <div>
            <div class="row" style="gap:10px"><span style="font-size:24px;font-weight:680;letter-spacing:-0.02em">${esc(App.instLabel(inst))}</span>${p && p.broker ? `<span class="badge-broker">${esc(p.broker)}</span>` : ''}${inst.type !== 'stock' ? `<span class="tag">${esc(inst.type)}</span>` : ''}${tags}</div>
            <div class="text-2" style="margin-top:4px">${esc(inst.type === 'option' ? inst.ticker : inst.name)}</div>
            <div class="xs muted" style="margin-top:6px">${[inst.isin, inst.exchange, cur, inst.country, inst.sector, inst.expiry ? 'expires ' + F.date(inst.expiry) : ''].filter(Boolean).map(esc).join(' · ')}</div>
          </div>
          <div class="spacer"></div>
          <div class="row"><button class="btn" data-pa="price">${icon('plus')}Add price</button><button class="btn" data-pa="trade">${icon('plus')}Trade</button><button class="btn" data-pa="edit">${icon('edit')}Edit instrument</button></div>
        </div>
      </div>
      <div class="tiles ${tiles.length === 8 ? 'eight' : ''}" style="margin-bottom:18px">${tiles.map(t => `<div class="tile"><div class="k">${t[0]}</div><div class="v">${t[1]}</div><div class="s">${t[2]}</div></div>`).join('')}</div>
      <div class="grid g-12">
        <div class="card c-12">
          <div class="card-h"><h2>Price history</h2><span class="sub">${esc(cur)} · buys, sells and average cost</span><div class="right">${periodChips(ui.detailPeriod, 'dp')}</div></div>
          <div class="row" style="margin-bottom:8px"><div class="legend"><span><i style="background:var(--text-2)"></i>Price</span><span><i style="background:var(--accent)"></i>Average cost (FIFO, open lots)</span><span><i class="dot" style="background:var(--accent)"></i>Buy</span><span><i class="dot" style="background:transparent;border:1.5px solid var(--text)"></i>Sell</span></div></div>
          <div class="chart h-320"><canvas id="ch-px"></canvas></div>
        </div>
        ${lots.length ? `<div class="card c-12 flush"><div class="card-h"><h2>Open lots (FIFO)</h2><span class="sub">oldest lot is sold first</span></div><div class="table-wrap"><table class="t compact"><thead><tr><th>Opened</th><th class="r">Qty</th><th class="r">Price</th><th class="r">FX</th><th class="r">Cost €</th><th class="r">Fees €</th><th class="r">Value €</th><th class="r">P&L €</th><th class="r">Age</th></tr></thead><tbody>
          ${lots.map(l => { const val = isFinite(p.price) ? l.q * l.mult * p.price / p.fx : NaN; const pl = val - l.q * l.uc - Math.abs(l.q) * l.uf; return `<tr><td>${F.date(l.date)}${l.inKind ? ' <span class="tag">transfer in</span>' : ''}</td><td class="r num">${F.qty(l.q)}</td><td class="r num">${F.price(l.p, l.cur)}</td><td class="r num">${l.cur === 'EUR' ? '—' : F.fx(l.fx)}</td><td class="r num">${F.eur(l.q * l.uc)}</td><td class="r num">${F.eur(Math.abs(l.q) * l.uf)}</td><td class="r num">${F.eur(val)}</td><td class="r">${F.seur(pl)}</td><td class="r num">${F.dur(r.asOf - l.d)}</td></tr>`; }).join('')}
        </tbody></table></div></div>` : ''}
        <div class="card c-12 flush"><div class="card-h"><h2>Transaction log</h2><span class="sub">${txs.length} trade(s) · ${divs.length} cash item(s)</span></div><div class="table-wrap"><table class="t compact">
          <thead><tr><th>Date</th><th>Type</th><th class="r">Qty</th><th class="r">Price</th><th class="r">FX</th><th class="r">Fees €</th><th class="r">Amount €</th><th>Broker</th><th>Note</th><th></th></tr></thead><tbody>
          ${[...txs.map(t => ({ d: t.date, t })), ...divs.map(c => ({ d: c.date, c }))].sort((a, b) => a.d < b.d ? 1 : -1).map(x => {
            if (x.t) {
              const t = x.t, fx = t.fx > 0 ? t.fx : (t.currency === 'EUR' ? 1 : r.fxAt ? r.fxAt(t.currency, PT.dn(t.date)) : NaN);
              const amt = t.type === 'split' ? NaN : (t.type === 'buy' ? -1 : t.type === 'sell' ? 1 : 0) * t.qty * t.price * (inst.multiplier || 1) / fx - (t.type === 'buy' || t.type === 'sell' ? t.fee : 0);
              return `<tr><td>${F.date(t.date)}</td><td><span class="tag ${t.type === 'buy' ? 'accent' : ''}">${typeLabel(t.type)}</span></td><td class="r num">${t.type === 'split' ? '×' + F.num(t.ratio, 4) : F.qty(t.qty)}</td><td class="r num">${t.type === 'split' ? '' : F.price(t.price, t.currency)}</td><td class="r num">${t.currency === 'EUR' || t.type === 'split' ? '—' : F.fx(fx)}${t.fx > 0 ? '' : (t.type === 'split' ? '' : ' <span class="muted xs" data-tip="Taken from FX history">*</span>')}</td><td class="r num">${t.fee ? F.eur(t.fee) : '—'}</td><td class="r">${t.type.startsWith('transfer') ? '<span class="muted xs">no cash</span>' : (isFinite(amt) && amt !== 0 ? F.seur(amt) : '')}</td><td><span class="badge-broker">${esc(t.broker || '—')}</span></td><td class="muted small">${esc(t.note || '')}</td>
                <td class="r nowrap"><button class="icon-btn" data-edit-tx="${t.id}" aria-label="Edit">${icon('edit')}</button><button class="icon-btn" data-del-tx="${t.id}" aria-label="Delete">${icon('trash')}</button></td></tr>`;
            }
            const c = x.c;
            return `<tr><td>${F.date(c.date)}</td><td><span class="tag">${typeLabel(c.type)}</span></td><td></td><td></td><td></td><td></td><td class="r num ${F.cls(c.amount)}">${F.price(c.amount, c.currency)}${c.wht ? `<div class="xs muted">WHT ${F.price(-c.wht, c.currency)}</div>` : ''}</td><td><span class="badge-broker">${esc(c.broker || '—')}</span></td><td class="muted small">${esc(c.note || '')}</td>
              <td class="r nowrap"><button class="icon-btn" data-edit-cash="${c.id}" aria-label="Edit">${icon('edit')}</button><button class="icon-btn" data-del-cash="${c.id}" aria-label="Delete">${icon('trash')}</button></td></tr>`;
          }).join('')}
        </tbody></table></div></div>
      </div>`;
    return {
      title: App.instLabel(inst), sub: esc(inst.name || ''), html, noBanner: true,
      mount(root) {
        const T = App.theme();
        const ps = r.priceSeries ? r.priceSeries[id] : null;
        const base = PT.periodBase(ui.detailPeriod, r.asOf, ps && ps.n ? ps.first : r.asOf);
        const priceData = [];
        if (ps) for (let i = 0; i < ps.n; i++) if (ps.xs[i] > base && ps.xs[i] <= r.asOf) priceData.push({ x: ps.xs[i] * PT.DAY, y: ps.ys[i] });
        const inRange = t => PT.dn(t.date) > base && t.currency === cur;
        const buys = txs.filter(t => (t.type === 'buy' || t.type === 'transfer_in') && inRange(t) && t.price > 0).map(t => ({ x: PT.dn(t.date) * PT.DAY, y: t.price, t }));
        const sells = txs.filter(t => (t.type === 'sell' || t.type === 'transfer_out') && inRange(t) && t.price > 0).map(t => ({ x: PT.dn(t.date) * PT.DAY, y: t.price, t }));
        const ac = avgCostPath(txs.filter(t => t.currency === cur));
        const acData = [];
        ac.forEach(([d, v]) => { if (d <= base) { acData.length = 0; acData.push({ x: (base + 1) * PT.DAY, y: v }); } else acData.push({ x: d * PT.DAY, y: v }); });
        if (acData.length && isFinite(acData[acData.length - 1].y)) acData.push({ x: r.asOf * PT.DAY, y: acData[acData.length - 1].y });
        App.chart('ch-px', {
          type: 'line', plugins: [App.crosshair],
          data: {
            datasets: [
              { label: 'Price', data: priceData, borderColor: T.text2, borderWidth: 1.75, pointRadius: 0, pointHoverRadius: 3, tension: 0, order: 3 },
              { label: 'Avg cost', data: acData, borderColor: T.accent, borderWidth: 1.5, borderDash: [5, 4], pointRadius: 0, stepped: 'before', spanGaps: false, order: 2 },
              { label: 'Buy', type: 'scatter', data: buys, pointStyle: 'triangle', pointRadius: 7, pointHoverRadius: 9, backgroundColor: T.accent, borderColor: T.surface, borderWidth: 2, order: 0 },
              { label: 'Sell', type: 'scatter', data: sells, pointStyle: 'triangle', rotation: 180, pointRadius: 7, pointHoverRadius: 9, backgroundColor: T.surface, borderColor: T.text, borderWidth: 1.75, order: 0 }
            ]
          },
          options: {
            parsing: false, interaction: { mode: 'nearest', intersect: false, axis: 'x' },
            scales: { x: App.timeAxis(T, null, priceData.length ? [Math.min(priceData[0].x, buys.length ? buys[0].x : Infinity, sells.length ? sells[0].x : Infinity), r.asOf * PT.DAY] : null), y: App.valueAxis(T, v => F.price(v, cur)) },
            plugins: {
              tooltip: Object.assign(App.tooltipStyle(T), {
                callbacks: {
                  title: items => items.length ? F.date(Math.round(items[0].parsed.x / PT.DAY), 'med') : '',
                  label: c => {
                    const raw = c.raw;
                    if (raw && raw.t) return ` ${typeLabel(raw.t.type)} ${F.qty(raw.t.qty)} @ ${F.price(raw.t.price, cur)}`;
                    return ` ${c.dataset.label}: ${F.price(c.parsed.y, cur)}`;
                  }
                }
              })
            }
          }
        });
        root.querySelectorAll('[data-dp]').forEach(b => b.addEventListener('click', () => { ui.detailPeriod = b.dataset.dp; App.render(); }));
        root.querySelector('[data-pa="edit"]').addEventListener('click', () => App.instrumentForm(inst));
        root.querySelector('[data-pa="trade"]').addEventListener('click', () => App.tradeForm(null, inst));
        root.querySelector('[data-pa="price"]').addEventListener('click', () => App.quickPriceForm(inst));
        App.bindRowActions(root);
      }
    };
  };

  /* ============================================================ allocation */
  function groupBy(positions, fn, includeCash) {
    const m = {};
    positions.filter(p => p.value > 0).forEach(p => {
      const ks = fn(p);
      const arr = Array.isArray(ks) ? (ks.length ? ks : ['Untagged']) : [ks || 'Unclassified'];
      arr.forEach(k => { m[k] = (m[k] || 0) + p.value / arr.length; });
    });
    if (includeCash && App.res.cash > 0) m.Cash = (m.Cash || 0) + App.res.cash;
    return Object.keys(m).map(k => ({ k, v: m[k] })).sort((a, b) => b.v - a.v);
  }
  function barList(rows) {
    const tot = rows.reduce((s, x) => s + x.v, 0);
    const mx = Math.max(...rows.map(x => x.v), 1);
    return `<div class="bars">${rows.map(x => `<div class="bar-row"><span class="name" title="${esc(x.k)}">${esc(x.k)}</span><div class="bar-track"><div class="bar-fill" style="width:${(x.v / mx * 100).toFixed(1)}%"></div></div><span class="num right"><b>${F.pct(x.v / tot, { sign: false, dec: 1 })}</b></span><span class="num right muted eur">${F.eur(x.v, { dec: 0 })}</span></div>`).join('')}</div>`;
  }
  V.allocation = function () {
    const r = App.res;
    if (r.empty) return emptyView('Allocation');
    const inc = !!App.state.settings.showCashInAlloc;
    const byPos = groupBy(r.positions, p => App.instLabel(p.inst), inc);
    const top = topSlices(byPos, 5);
    const byCur = topSlices(groupBy(r.positions, p => p.currency, inc), 5);
    const dims = [
      ['Theme', groupBy(r.positions, p => p.inst.tags || [], inc), 'Custom tags. A position with several tags is split equally between them.'],
      ['Sector', groupBy(r.positions, p => p.inst.sector, inc), ''],
      ['Country', groupBy(r.positions, p => p.inst.country, inc), 'Defaults to the ISIN / listing country — edit below.'],
      ['Broker', groupBy(r.positions, p => p.broker, inc), '']
    ];
    const shorts = r.positions.filter(p => p.value < 0);
    const open = r.positions.map(p => p.inst).filter((x, i, a) => a.indexOf(x) === i);
    const allTags = [...new Set(App.state.instruments.flatMap(i => i.tags || []))].sort();
    const html = `
      <div class="row" style="margin-bottom:16px"><label class="check"><input type="checkbox" id="al-cash" ${inc ? 'checked' : ''}> Include cash (${F.eur(r.cash, { dec: 0 })})</label><span class="spacer"></span><span class="xs muted">Long positions at market value${shorts.length ? ` · ${shorts.length} short position(s) excluded (${F.eur(shorts.reduce((s, p) => s + p.value, 0), { dec: 0 })})` : ''}</span></div>
      <div class="grid g-12">
        <div class="card c-7"><div class="card-h"><h2>By position</h2></div>
          <div class="donut-wrap"><div class="chart"><canvas id="ch-al-pos"></canvas><div class="donut-center"><div><div class="k">${top.all.length} holdings</div><div class="v num">${F.eur(top.tot, { dec: 0, compact: true })}</div></div></div></div>${sliceList(top.slices, top.tot)}</div>
          <div class="divider"></div>${barList(byPos)}
        </div>
        <div class="card c-5"><div class="card-h"><h2>By currency</h2><span class="sub">currency of listing</span></div>
          <div class="donut-wrap"><div class="chart"><canvas id="ch-al-cur"></canvas><div class="donut-center"><div><div class="k">${byCur.all.length} currencies</div><div class="v num">${F.pct(1 - (byCur.all.find(x => x.k === 'EUR') || { v: 0 }).v / byCur.tot, { sign: false, dec: 0 })}</div><div class="k">non-EUR</div></div></div></div>${sliceList(byCur.slices, byCur.tot)}</div>
        </div>
        ${dims.map(([t, rows, note]) => `<div class="card c-6"><div class="card-h"><h2>By ${t.toLowerCase()}</h2>${note ? `<span class="sub">${note}</span>` : ''}</div>${rows.length ? barList(rows) : '<div class="muted">No data.</div>'}</div>`).join('')}
        <div class="card c-12 flush"><div class="card-h"><h2>Classification</h2><span class="sub">edit sector, country and theme tags — e.g. “AI Energy”, “CPO/Optics”, “Robotics”</span></div>
          <div class="table-wrap"><table class="t compact"><thead><tr><th>Instrument</th><th>Sector</th><th>Country</th><th>Themes</th><th></th></tr></thead><tbody>
          ${open.map(i => `<tr><td><span class="tk">${esc(App.instLabel(i))}</span><div class="nm">${esc(i.name)}</div></td>
            <td><input type="text" data-cls="sector" data-id="${i.id}" value="${esc(i.sector || '')}" style="width:170px"></td>
            <td><input type="text" data-cls="country" data-id="${i.id}" value="${esc(i.country || '')}" style="width:140px"></td>
            <td><div class="row" style="gap:5px">${(i.tags || []).map(t => `<span class="tag accent">${esc(t)} <span class="x" data-untag="${esc(t)}" data-id="${i.id}" role="button" aria-label="Remove tag">×</span></span>`).join('')}<input type="text" list="tag-list" data-addtag="${i.id}" placeholder="+ tag" style="width:110px;padding:4px 8px"></div></td><td></td></tr>`).join('')}
          </tbody></table></div><datalist id="tag-list">${allTags.map(t => `<option value="${esc(t)}">`).join('')}</datalist>
        </div>
      </div>`;
    return {
      title: 'Allocation', html,
      mount(root) {
        App.donut('ch-al-pos', top.slices, top.tot);
        App.donut('ch-al-cur', byCur.slices, byCur.tot);
        root.querySelector('#al-cash').addEventListener('change', e => App.commit(s => { s.settings.showCashInAlloc = e.target.checked; }));
        root.querySelectorAll('[data-cls]').forEach(inp => inp.addEventListener('change', () => App.commit(s => { const i = s.instruments.find(x => x.id === inp.dataset.id); i[inp.dataset.cls] = inp.value.trim(); })));
        root.querySelectorAll('[data-addtag]').forEach(inp => inp.addEventListener('keydown', e => {
          if (e.key !== 'Enter' || !inp.value.trim()) return;
          const v = inp.value.trim();
          App.commit(s => { const i = s.instruments.find(x => x.id === inp.dataset.addtag); i.tags = [...new Set([...(i.tags || []), v])]; });
        }));
        root.querySelectorAll('[data-untag]').forEach(x => x.addEventListener('click', () => App.commit(s => { const i = s.instruments.find(y => y.id === x.dataset.id); i.tags = (i.tags || []).filter(t => t !== x.dataset.untag); })));
      }
    };
  };

  /* =========================================================== performance */
  V.performance = function () {
    const r = App.res, ui = App.ui;
    if (r.empty) return emptyView('Performance');
    const m = App.metrics(ui.perfPeriod);
    const sel = App.state.settings.benchmark;
    const bm = m.bench[sel];
    const selB = r.benchmarks.find(b => b.id === sel);
    const months = PT.monthlyReturns(r);
    const years = [...new Set(months.map(x => x.y))].sort();
    const T = App.theme();
    const cell = v => {
      if (!isFinite(v)) return 'background:transparent';
      const a = Math.min(1, Math.abs(v) / 0.10);
      return `background:${App.alpha(v >= 0 ? (T.gain.startsWith('#') ? T.gain : '#2fbf71') : (T.loss.startsWith('#') ? T.loss : '#f0616d'), 0.12 + a * 0.62)}`;
    };
    const yearRet = y => { const ms = months.filter(x => x.y === y); return ms.length ? ms[ms.length - 1].endIdx / ms[0].startIdx - 1 : NaN; };
    const mn = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
    const monthNames = Array.from({ length: 12 }, (_, i) => new Intl.DateTimeFormat(F.loc(), { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2020, i, 1))));
    const tile = (k, v, s, t) => `<div class="tile"><div class="k">${k} ${t ? tip(t) : ''}</div><div class="v">${v}</div><div class="s">${s || ''}</div></div>`;
    const html = `
      <div class="row" style="margin-bottom:16px">${periodChips(ui.perfPeriod, 'pp')}<span class="spacer"></span><span class="small muted">${F.date(PT.iso(Math.max(m.baseDay + 1, r.start)), 'med')} – ${F.date(r.asOfISO, 'med')} · ${m.days} days</span></div>
      <div class="tiles eight" style="margin-bottom:12px">
        ${tile('TWR', F.spct(m.twr), m.annualizedMeaningful ? F.pct(m.ann) + ' p.a.' : 'cumulative', 'twr')}
        ${tile('XIRR', F.spct(m.xirr), 'money-weighted, p.a.', 'xirr')}
        ${tile('P&L', F.seur(m.pnl, { dec: 0 }), 'net of flows (' + F.eur(m.flows, { dec: 0, sign: true }) + ')')}
        ${tile('Volatility', `<span class="num">${F.pct(m.vol, { sign: false })}</span>`, 'annualised', 'vol')}
        ${tile('Max drawdown', `<span class="num loss">${F.pct(m.maxDD)}</span>`, m.maxDDTrough ? `${F.date(m.maxDDPeak, 'med')} → ${F.date(m.maxDDTrough, 'med')}` : '', 'mdd')}
        ${tile('Sharpe', `<span class="num">${F.num(m.sharpe, 2)}</span>`, `r<sub>f</sub> ${F.pct(m.rf, { sign: false })}`, 'sharpe')}
        ${tile('Sortino', `<span class="num">${F.num(m.sortino, 2)}</span>`, 'downside risk only', 'sortino')}
        ${tile('Beta', `<span class="num">${bm && isFinite(bm.beta) ? F.num(bm.beta, 2) : '—'}</span>`, selB ? `vs ${esc(selB.name.replace(/\s*\(.*\)/, ''))}${bm && isFinite(bm.corr) ? ' · ρ ' + F.num(bm.corr, 2) : ''}` : '', 'beta')}
      </div>
      ${m.active < 40 ? `<div class="banner warn"><div class="ico">${icon('alert')}</div><div class="grow">Only ${m.active} days in this period have price changes. Volatility, drawdown, Sharpe and Sortino need a daily price history — import closes under Data & prices → Prices.</div></div>` : ''}<div class="explain" style="margin-bottom:18px"><b>TWR ${F.pct(m.twr)} vs. XIRR ${F.pct(m.xirr)} p.a.</b> — TWR judges the investments, XIRR judges your timing: they differ when you add or withdraw money ahead of big moves.</div>
      <div class="grid g-12">
        <div class="card c-12"><div class="card-h"><h2>Cumulative return vs. benchmarks</h2><div class="right"><div class="chips">${benchToggles(ui.eqBench)}</div></div></div>
          <div class="row" style="margin-bottom:8px"><span class="spacer"></span>${benchLegend(ui.eqBench, 'perf')}</div>
          <div class="chart h-320"><canvas id="ch-perf"></canvas></div></div>
        <div class="card c-6"><div class="card-h"><h2>Drawdown</h2>${tip('mdd')}<div class="right"><span class="sub">from running peak of the TWR index</span></div></div><div class="chart h-220"><canvas id="ch-dd"></canvas></div></div>
        <div class="card c-6"><div class="card-h"><h2>Rolling 12-month return</h2>${tip('rolling')}</div><div class="chart h-220"><canvas id="ch-roll"></canvas></div></div>
        <div class="card c-12"><div class="card-h"><h2>Monthly returns</h2><span class="sub">TWR per calendar month · partial months marked *</span></div>
          <div class="heat-wrap"><div class="heat">
            <div></div>${monthNames.map((x, i) => `<div class="hd" title="${x}"><span class="hide-sm">${x}</span></div>`).join('')}<div class="hd">Year</div>
            ${years.map(y => `<div class="yr">${y}</div>${Array.from({ length: 12 }, (_, i) => { const o = months.find(x => x.y === y && x.m === i + 1); return o ? `<div class="cell" style="${cell(o.r)}" data-tip="${monthNames[i]} ${y}: ${F.pct(o.r)}${o.partial ? ' (partial month)' : ''}">${F.num(o.r * 100, 1)}${o.partial ? '*' : ''}</div>` : '<div class="cell empty">·</div>'; }).join('')}<div class="cell tot" style="${cell(yearRet(y))}" data-tip="${y}: ${F.pct(yearRet(y))}">${F.num(yearRet(y) * 100, 1)}</div>`).join('')}
          </div></div>
          <div class="heat-legend"><span>${F.pct(-0.1, { dec: 0 })}</span><div class="scale">${[-1, -0.66, -0.33, 0, 0.33, 0.66, 1].map(v => `<span style="${v === 0 ? 'background:var(--neutral-mid)' : cell(v * 0.1)}"></span>`).join('')}</div><span>${F.pct(0.1, { dec: 0 })}</span><span class="spacer"></span><span>values in %</span></div>
        </div>
        <div class="card c-7 flush"><div class="card-h"><h2>Benchmark comparison</h2><span class="sub">${pLabel(ui.perfPeriod)} · benchmarks converted to EUR</span><div class="right"><select id="bench-sel">${r.benchmarks.map(b => `<option value="${b.id}" ${b.id === sel ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></div></div>
          <div class="table-wrap"><table class="t"><thead><tr><th></th><th class="r">Return</th><th class="r">Annualised</th><th class="r">Volatility</th><th class="r">Max DD</th><th class="r">Beta</th><th class="r">Correlation</th></tr></thead><tbody>
            <tr><td><span class="row" style="gap:8px"><i style="width:10px;height:10px;border-radius:3px;background:${T.accent};display:inline-block"></i><b>Portfolio</b></span></td><td class="r">${F.spct(m.twr)}</td><td class="r">${F.spct(m.ann)}</td><td class="r num">${F.pct(m.vol, { sign: false })}</td><td class="r num">${F.pct(m.maxDD)}</td><td class="r muted">1.00</td><td class="r muted">—</td></tr>
            ${r.benchmarks.map((b, j) => { const x = m.bench[b.id]; return `<tr><td class="nowrap"><i style="width:10px;height:10px;border-radius:3px;background:${App.benchColor(b.id, T, j)};display:inline-block;margin-right:8px"></i>${esc(b.name.replace(/\s*\(.*\)/, ''))}</td>${x ? `<td class="r">${F.spct(x.twr)}</td><td class="r">${F.spct(x.ann)}</td><td class="r num">${F.pct(x.vol, { sign: false })}</td><td class="r num">${F.pct(x.maxDD)}</td><td class="r num">${F.num(x.beta, 2)}</td><td class="r num">${F.num(x.corr, 2)}</td>` : '<td colspan="6" class="muted small">No data — add a price series under Data & prices → Benchmarks</td>'}</tr>`; }).join('')}
            ${bm ? `<tr><td class="muted">Excess vs. ${esc(selB.name.replace(/\s*\(.*\)/, ''))}</td><td class="r">${F.spct(m.twr - bm.twr)}</td><td class="r">${F.spct(m.ann - bm.ann)}</td><td colspan="4"></td></tr>` : ''}
          </tbody></table></div></div>
        <div class="card c-5"><div class="card-h"><h2>Return attribution</h2>${tip('attribution')}<div class="right"><span class="sub">all-time</span></div></div>${attributionTable()}</div>
      </div>`;
    return {
      title: 'Performance', html,
      mount(root) {
        App.equityChart('ch-perf', ui.perfPeriod, 'perf', ui.eqBench);
        const T2 = App.theme();
        const dd = PT.drawdownSeries(r, m.i0, m.i1).filter((x, k, a) => !PT.isWeekend(x[0]) || k === a.length - 1);
        App.chart('ch-dd', {
          type: 'line', plugins: [App.crosshair],
          data: { datasets: [{ label: 'Drawdown', data: dd.map(([d, v]) => ({ x: d * PT.DAY, y: v })), borderColor: T2.loss, backgroundColor: App.alpha(T2.loss.startsWith('#') ? T2.loss : '#f0616d', 0.12), fill: 'origin', borderWidth: 1.5, pointRadius: 0, tension: 0 }] },
          options: { parsing: false, interaction: { mode: 'index', intersect: false }, scales: { x: App.timeAxis(T2, null, dd.length ? [dd[0][0] * PT.DAY, dd[dd.length - 1][0] * PT.DAY] : null), y: App.valueAxis(T2, v => F.pct(v, { dec: 0 }), { max: 0 }) }, plugins: { tooltip: Object.assign(App.tooltipStyle(T2), { displayColors: false, callbacks: { title: it => F.date(Math.round(it[0].parsed.x / PT.DAY), 'med'), label: c => ' ' + F.pct(c.parsed.y) } }) } }
        });
        const roll = PT.rolling(r, 365).filter(x => !PT.isWeekend(x[0]));
        const el = document.getElementById('ch-roll');
        if (!roll.length) el.parentElement.innerHTML = '<div class="chart-fallback">Needs more than 12 months of history.</div>';
        else App.chart('ch-roll', {
          type: 'line', plugins: [App.crosshair],
          data: { datasets: [{ label: 'Rolling 12M', data: roll.map(([d, v]) => ({ x: d * PT.DAY, y: v })), borderColor: T2.accent, borderWidth: 2, pointRadius: 0, tension: 0, fill: { target: { value: 0 }, above: App.alpha(T2.gain.startsWith('#') ? T2.gain : '#2fbf71', 0.10), below: App.alpha(T2.loss.startsWith('#') ? T2.loss : '#f0616d', 0.10) } }] },
          options: { parsing: false, interaction: { mode: 'index', intersect: false }, scales: { x: App.timeAxis(T2, null, [roll[0][0] * PT.DAY, roll[roll.length - 1][0] * PT.DAY]), y: App.valueAxis(T2, v => F.pct(v, { dec: 0 })) }, plugins: { tooltip: Object.assign(App.tooltipStyle(T2), { displayColors: false, callbacks: { title: it => F.date(Math.round(it[0].parsed.x / PT.DAY), 'med'), label: c => ' ' + F.pct(c.parsed.y) } }) } }
        });
        root.querySelectorAll('[data-pp]').forEach(b => b.addEventListener('click', () => { ui.perfPeriod = b.dataset.pp; App.render(); }));
        root.querySelectorAll('[data-bench]').forEach(b => b.addEventListener('click', () => { const id = b.dataset.bench; ui.eqBench = ui.eqBench.includes(id) ? ui.eqBench.filter(x => x !== id) : [...ui.eqBench, id]; App.render(); }));
        root.querySelector('#bench-sel').addEventListener('change', e => App.commit(s => { s.settings.benchmark = e.target.value; }));
      }
    };
  };
  function attributionTable() {
    const a = App.res.attribution;
    const rows = [
      ['Price effect', a.pricePE, 'pe', `realised ${F.eur(a.realizedPE, { dec: 0, sign: true })} · unrealised ${F.eur(a.unrealPE, { dec: 0, sign: true })}`],
      ['Currency effect', a.fxFE, 'fe', `realised ${F.eur(a.realizedFE, { dec: 0, sign: true })} · unrealised ${F.eur(a.unrealFE, { dec: 0, sign: true })}`],
      ['Dividends (gross)', a.dividends, 'divs'], ['Withholding tax', a.taxes], ['Interest', a.interest],
      ['Transaction fees', a.tradeFees, 'fees'], ['Other fees', a.otherFees, 'fees']
    ];
    if (Math.abs(a.fxadj) > 0.005) rows.push(['FX adjustments (broker)', a.fxadj]);
    return `<table class="t compact"><tbody>${rows.map(([k, v, t, s]) => `<tr><td>${k} ${t ? tip(t) : ''}${s ? `<div class="xs muted">${s}</div>` : ''}</td><td class="r">${F.seur(v)}</td></tr>`).join('')}
      ${Math.abs(a.residual) > 0.01 ? `<tr><td>Other / unexplained</td><td class="r">${F.seur(a.residual)}</td></tr>` : ''}</tbody>
      <tfoot><tr><td>Total P&L</td><td class="r">${F.seur(a.pnl)}</td></tr></tfoot></table>
      <div class="xs muted" style="margin-top:8px">Reconciles to value − net invested: residual ${F.eur(a.residual)}.</div>`;
  }

  /* ================================================================ closed */
  V.closed = function () {
    const r = App.res, ui = App.ui;
    if (r.empty) return emptyView('Closed positions');
    const trips = r.trips.slice();
    const S = PT.closedStats(trips);
    const key = { ticker: t => App.instLabel(t.inst).toLowerCase(), end: t => t.end, start: t => t.start, hold: t => t.holdDays, pnl: t => t.pnl, ret: t => t.ret, cost: t => t.cost }[ui.closedSort.k] || (t => t.end);
    trips.sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * ui.closedSort.dir; });
    const th = (k, l, c) => `<th class="sortable ${c || ''}" data-csort="${k}">${l}${ui.closedSort.k === k ? `<span class="arr">${ui.closedSort.dir > 0 ? '▲' : '▼'}</span>` : ''}</th>`;
    const realizedAll = r.realized.reduce((s, x) => s + x.pnl, 0);
    // by year (tax view)
    const yrs = {};
    const Y = y => (yrs[y] = yrs[y] || { realized: 0, gains: 0, losses: 0, divs: 0, tax: 0, fees: 0, interest: 0 });
    r.realized.forEach(x => { const o = Y(PT.iso(x.d).slice(0, 4)); o.realized += x.pnl; if (x.pnl > 0) o.gains += x.pnl; else o.losses += x.pnl; });
    App.state.cash.filter(c => c.date <= r.asOfISO).forEach(c => {
      const fx = c.currency === 'EUR' ? 1 : (c.fx > 0 ? c.fx : r.fxAt(c.currency, PT.dn(c.date)));
      if (!(fx > 0)) return;
      const o = Y(c.date.slice(0, 4)), v = c.amount / fx;
      if (c.type === 'dividend') { o.divs += v; o.tax -= (c.wht || 0) / fx; } else if (c.type === 'tax') o.tax += v; else if (c.type === 'fee') o.fees += v; else if (c.type === 'interest') o.interest += v;
    });
    App.state.transactions.filter(t => t.date <= r.asOfISO && t.fee).forEach(t => { Y(t.date.slice(0, 4)).fees -= t.fee; });
    const ylist = Object.keys(yrs).sort().reverse();
    const best = S.best, worst = S.worst;
    const html = S.n ? `
      <div class="tiles" style="margin-bottom:18px">
        <div class="tile"><div class="k">Realised P&L ${tip('realized')}</div><div class="v">${F.seur(realizedAll, { dec: 0 })}</div><div class="s">${F.eur(S.total, { dec: 0, sign: true })} from closed trades, rest from partial sells</div></div>
        <div class="tile"><div class="k">Closed round trips</div><div class="v num">${S.n}</div><div class="s">${S.wins} won · ${S.losses} lost</div></div>
        <div class="tile"><div class="k">Win rate ${tip('winrate')}</div><div class="v num">${F.pct(S.winRate, { sign: false, dec: 0 })}</div><div class="s">profit factor ${isFinite(S.profitFactor) ? F.num(S.profitFactor, 2) : '∞'} ${tip('pf')}</div></div>
        <div class="tile"><div class="k">Avg holding period ${tip('hold')}</div><div class="v num">${F.dur(S.avgHold)}</div><div class="s">quantity-weighted per trade</div></div>
        <div class="tile"><div class="k">Avg win / avg loss</div><div class="v"><span class="gain num">${F.eur(S.avgWin, { dec: 0, sign: true })}</span> <span class="muted">/</span> <span class="loss num">${F.eur(S.avgLoss, { dec: 0 })}</span></div><div class="s">after fees</div></div>
      </div>
      <div class="grid g-12">
        <div class="card c-6"><div class="card-h"><h2>Best trade</h2></div>${tripCard(best)}</div>
        <div class="card c-6"><div class="card-h"><h2>Worst trade</h2></div>${tripCard(worst)}</div>
        <div class="card c-12"><div class="card-h"><h2>Realised P&L per trade</h2><span class="sub">in order of closing date</span></div><div class="chart h-220"><canvas id="ch-trips"></canvas></div></div>
        <div class="card c-12 flush"><div class="card-h"><h2>Closed round trips</h2><span class="sub">flat → position → flat; broker transfers do not close a trade</span></div>
          <div class="table-wrap"><table class="t"><thead><tr>${th('ticker', 'Instrument')}<th>Side</th>${th('start', 'Opened')}${th('end', 'Closed')}${th('hold', 'Held', 'r')}${th('cost', 'Cost €', 'r')}${th('pnl', 'P&L €', 'r')}${th('ret', 'Return', 'r')}<th class="r">Price / FX effect</th><th class="r">Fees</th></tr></thead><tbody>
          ${trips.map(t => `<tr class="click" data-goto="${t.instId}"><td><span class="tk">${esc(App.instLabel(t.inst))}</span>${t.expired ? ' <span class="tag">expired</span>' : ''}<div class="nm">${esc(t.inst.type === 'option' ? t.inst.ticker : t.inst.name)}</div></td><td><span class="tag">${t.side}</span></td><td>${F.date(t.startISO)}</td><td>${F.date(t.endISO)}</td><td class="r num">${F.dur(t.holdDays)}</td><td class="r num">${F.eur(t.cost, { dec: 0 })}</td><td class="r">${F.seur(t.pnl)}</td><td class="r">${F.spct(t.ret, { dec: 1 })}</td><td class="r small"><span class="${F.cls(t.pe)}">${F.eur(t.pe, { dec: 0, sign: true })}</span> · <span class="${F.cls(t.fe)}">${F.eur(t.fe, { dec: 0, sign: true })}</span></td><td class="r num muted">${F.eur(t.fees)}</td></tr>`).join('')}
          </tbody></table></div></div>
        <div class="card c-12 flush"><div class="card-h"><h2>By calendar year</h2><span class="sub">realised gains/losses, income and costs in EUR — a starting point for your tax return, not tax advice</span></div>
          <div class="table-wrap"><table class="t"><thead><tr><th>Year</th><th class="r">Realised gains</th><th class="r">Realised losses</th><th class="r">Net realised</th><th class="r">Dividends (gross)</th><th class="r">Withholding tax</th><th class="r">Interest</th><th class="r">Fees</th></tr></thead><tbody>
          ${ylist.map(y => { const o = yrs[y]; return `<tr><td><b>${y}</b></td><td class="r">${F.seur(o.gains)}</td><td class="r">${F.seur(o.losses)}</td><td class="r"><b>${F.seur(o.realized)}</b></td><td class="r num">${F.eur(o.divs)}</td><td class="r">${F.seur(o.tax)}</td><td class="r">${F.seur(o.interest)}</td><td class="r">${F.seur(o.fees)}</td></tr>`; }).join('')}
          </tbody></table></div></div>
      </div>` : `<div class="card"><div class="empty-state"><div class="ico">${icon('closed')}</div><h2>No closed positions yet</h2><p>Positions appear here once their quantity returns to zero.</p></div></div>`;
    return {
      title: 'Closed positions', html,
      mount(root) {
        if (!S.n) return;
        const T = App.theme();
        const ordered = r.trips.slice().sort((a, b) => a.end - b.end);
        App.chart('ch-trips', {
          type: 'bar',
          data: { labels: ordered.map(t => App.instLabel(t.inst)), datasets: [{ data: ordered.map(t => t.pnl), backgroundColor: ordered.map(t => t.pnl >= 0 ? T.gain : T.loss), borderRadius: 4, borderSkipped: 'start', maxBarThickness: 24 }] },
          options: { scales: { x: { grid: { display: false }, border: { color: T.axis }, ticks: { color: T.muted, maxRotation: 0, autoSkip: true, callback: function (v) { const l = this.getLabelForValue(v); return l.length > 14 ? l.slice(0, 13) + '…' : l; } } }, y: App.valueAxis(T, v => F.eur(v, { dec: 0, compact: true })) },
            plugins: { tooltip: Object.assign(App.tooltipStyle(T), { displayColors: false, callbacks: { title: it => { const t = ordered[it[0].dataIndex]; return `${App.instLabel(t.inst)} · closed ${F.date(t.endISO)}`; }, label: c => ` ${F.eur(c.parsed.y, { sign: true })} (${F.pct(ordered[c.dataIndex].ret, { dec: 1 })})` } }) } }
        });
        root.querySelectorAll('[data-csort]').forEach(t => t.addEventListener('click', () => { const k = t.dataset.csort; ui.closedSort = { k, dir: ui.closedSort.k === k ? -ui.closedSort.dir : -1 }; App.render(); }));
        root.querySelectorAll('[data-goto]').forEach(tr => tr.addEventListener('click', () => App.go('position/' + tr.dataset.goto)));
      }
    };
  };
  function tripCard(t) {
    if (!t) return '<div class="muted">—</div>';
    return `<a href="#/position/${t.instId}" style="color:inherit;text-decoration:none;display:block"><div class="row"><span class="tk" style="font-size:18px">${esc(App.instLabel(t.inst))}</span><span class="tag">${t.side}</span>${t.expired ? '<span class="tag">expired</span>' : ''}<span class="spacer"></span><span style="font-size:20px;font-weight:650" class="num ${F.cls(t.pnl)}">${F.eur(t.pnl, { sign: true, dec: 0 })}</span></div>
      <div class="row small text-2" style="margin-top:6px"><span>${F.date(t.startISO, 'med')} → ${F.date(t.endISO, 'med')}</span><span>· ${F.dur(t.holdDays)}</span><span class="spacer"></span><span class="${F.cls(t.ret)}">${F.pct(t.ret, { dec: 1 })}</span></div></a>`;
  }
})();
