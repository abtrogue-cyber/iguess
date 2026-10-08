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
      title: title || 'Overview',
      html: `<div class="grid g-12"><div class="card c-12"><div class="empty-state"><div class="ico">${icon('data')}</div><h2>No transactions yet</h2>
        <p>Import a DEGIRO or IBKR CSV export, add trades by hand, or load the demo portfolio.</p>
        <div class="row" style="justify-content:center;margin-top:22px"><button class="btn primary" data-act="goto-import">${icon('upload')}Import CSV</button><button class="btn" data-act="add-trade">${icon('plus')}Add transaction</button><button class="btn" data-act="load-demo">Load demo data</button></div></div></div></div>`
    };
  }
  App.actions['load-demo'] = () => App.confirm('Load demo data?', 'This replaces the current dataset with the synthetic demo portfolio. Export a backup first if you need your data.', 'Load demo', () => {
    const keep = App.state.settings;
    App.state = App.migrate(PT.buildDemo());
    App.state.settings = Object.assign(App.state.settings, { locale: keep.locale, theme: keep.theme, cb: keep.cb });
    App.ui.counted = {};
    App.commit(); App.toast('Demo portfolio loaded.');
  });
  App.emptyView = emptyView;

  const periodChips = (cur, attr) => `<div class="chips" role="tablist">${PERIODS.map(p => `<button class="chip ${p === cur ? 'on' : ''}" data-${attr}="${p}" role="tab" aria-selected="${p === cur}">${pLabel(p)}</button>`).join('')}</div>`;
  const deltaHTML = (pnl, pct, label) => `<span class="${F.cls(pnl)}">${F.arrow(pnl)} ${F.eur(pnl, { sign: true })}</span><span class="${F.cls(pct)}">${F.pct(pct)}</span><em>${esc(label)}</em>`;
  const typeLabel = t => ({ buy: 'Buy', sell: 'Sell', split: 'Split', transfer_in: 'Transfer in', transfer_out: 'Transfer out', deposit: 'Deposit', withdrawal: 'Withdrawal', dividend: 'Dividend', tax: 'Tax', interest: 'Interest', fee: 'Fee', fxadj: 'FX adj.' }[t] || t);
  App.typeLabel = typeLabel;

  /* ---------------------------------------------------- equity chart */
  App.equityChart = function (canvasId, period, mode, benchIds, o) {
    o = o || {};
    const r = App.res, T = App.theme();
    const cv = document.getElementById(canvasId);
    const narrow = cv && cv.parentElement && cv.parentElement.clientWidth < 600;
    const base = PT.periodBase(period, r.asOf, r.start, r.lastPriceDay);
    const i0 = Math.max(0, base - r.start + 1), i1 = r.N - 1;
    const idxs = [];
    for (let i = i0; i <= i1; i++) if (!PT.isWeekend(r.days[i]) || i === i1) idxs.push(i);
    const step = Math.max(1, Math.ceil(idxs.length / 700));
    const pick = idxs.filter((_, k) => k % step === 0 || k === idxs.length - 1);
    const ms = d => d * PT.DAY;
    const fill = App.gradientFill(T.accent, T.light ? 0.15 : 0.3, 0);
    const ds = [];
    if (mode === 'value') {
      ds.push({ label: 'Portfolio value', data: pick.map(i => ({ x: ms(r.days[i]), y: r.V[i], i })), borderColor: T.accent, backgroundColor: fill, fill: 'start', borderWidth: 2, pointRadius: 0, pointHoverRadius: 0, tension: 0, glow: T.glow, endLabel: F.eur(r.V[i1], { dec: 0, compact: true }), endPill: true });
      ds.push({ label: 'Net invested', data: pick.map(i => ({ x: ms(r.days[i]), y: r.NETINV[i], i })), borderColor: T.bench.b_ndx, borderWidth: 1.25, borderDash: [4, 4], pointRadius: 0, pointHoverRadius: 0, stepped: true, fill: false, endLabel: narrow ? null : 'Invested' });
    } else {
      const baseIdx = i0 > 0 ? r.IDX[i0 - 1] : 1;
      const pts = pick.map(i => ({ x: ms(r.days[i]), y: r.IDX[i] / baseIdx - 1, i }));
      pts.unshift({ x: ms(r.days[i0] - 1), y: 0 });
      ds.push({ label: 'Portfolio (TWR)', data: pts, borderColor: T.accent, backgroundColor: fill, fill: 'origin', borderWidth: 2, pointRadius: 0, pointHoverRadius: 0, tension: 0, glow: T.glow, endLabel: F.pct(pts[pts.length - 1].y, { dec: 1 }), endPill: true, order: 0 });
      (benchIds || []).forEach(id => {
        const b = r.benchmarks.find(x => x.id === id);
        if (!b || !b.has) return;
        let b0 = i0 > 0 ? b.vals[i0 - 1] : NaN;
        if (!isFinite(b0)) { for (let i = i0; i <= i1; i++) if (isFinite(b.vals[i])) { b0 = b.vals[i]; break; } }
        if (!isFinite(b0)) return;
        const bp = pick.filter(i => isFinite(b.vals[i])).map(i => ({ x: ms(r.days[i]), y: b.vals[i] / b0 - 1 }));
        bp.unshift({ x: ms(r.days[i0] - 1), y: 0 });
        const k = r.benchmarks.indexOf(b);
        ds.push({ label: b.name, data: bp, borderColor: App.benchColor(id, T, k), borderDash: App.benchDash(id, T, k), borderWidth: 1.4, pointRadius: 0, pointHoverRadius: 0, tension: 0, order: 1, endLabel: narrow ? null : `${App.shortBench(b.name)} ${F.pct(bp[bp.length - 1].y, { dec: 1 })}` });
      });
    }
    const labelsOn = o.labels !== false;
    // reserve room on the right for the longest direct label (≈ 6.6 px per mono glyph at 10.5 px)
    const longest = Math.max(0, ...ds.filter(d => d.endLabel).map(d => d.endLabel.length + (d.endPill ? 0 : 2)));
    const padRight = labelsOn ? Math.max(narrow ? 62 : 86, Math.ceil(longest * 6.6 + 28)) : 76;
    const fmtY = v => mode === 'value' ? App.axisEur(v) : F.pct(v, { dec: 0 });
    return App.chart(canvasId, {
      type: 'line', data: { datasets: ds }, plugins: [App.glowPlugin, App.xhair, App.endLabels],
      options: {
        parsing: false, normalized: true, interaction: { mode: 'index', intersect: false, axis: 'x' },
        layout: { padding: { right: padRight, top: 16, left: 6, bottom: 2 } },
        scales: { x: App.timeAxis(T, null, [ms(r.days[i0] - 1), ms(r.days[i1])]), y: App.valueAxis(T, fmtY) },
        onHover: (evt, els, chart) => {
          if (!o.scrub) return;
          const a = els.find(e => e.datasetIndex === 0);
          const p = a && chart.data.datasets[0].data[a.index];
          if (p && p.i != null) o.scrub(p.i, i0); else if (o.leave) o.leave();
        },
        plugins: {
          xhair: { enabled: true, color: T.accent, fmtY: v => mode === 'value' ? F.eur(v, { dec: 0 }) : F.pct(v, { dec: 1 }), fmtX: x => F.date(Math.round(x / PT.DAY)) },
          endLabels: { enabled: labelsOn, hideOnHover: true },
          tooltip: (mode === 'value' && o.scrub) ? { enabled: false } : Object.assign(App.tooltipStyle(T), {
            callbacks: {
              title: items => items.length ? F.date(Math.round(items[0].parsed.x / PT.DAY), 'med') : '',
              label: c => ` ${c.dataset.label}  ${mode === 'value' ? F.eur(c.parsed.y, { dec: 0 }) : F.pct(c.parsed.y)}`
            }
          })
        }
      }
    });
  };
  function benchLegend(ids, mode) {
    const T = App.theme(), r = App.res;
    if (mode === 'value') return `<div class="legend"><span><i style="border-color:${T.accent}"></i>Value</span><span><i class="dash" style="border-color:${T.bench.b_ndx}"></i>Net invested</span></div>`;
    return `<div class="legend"><span><i style="border-color:${T.accent}"></i>Portfolio</span>${ids.map(id => { const b = r.benchmarks.find(x => x.id === id); const k = r.benchmarks.indexOf(b); return b && b.has ? `<span><i class="${App.benchSwClass(id, k)}" style="border-color:${App.benchColor(id, T, k)}"></i>${esc(App.shortBench(b.name))}</span>` : ''; }).join('')}</div>`;
  }
  function benchToggles(sel) {
    const T = App.theme();
    return App.res.benchmarks.map((b, j) => `<button class="chip bench ${sel.includes(b.id) ? 'on' : ''}" data-bench="${b.id}" ${b.has ? '' : 'disabled title="No data — add it under Data → Benchmarks"'}><span class="sw ${App.benchSwClass(b.id, j)}" style="border-color:${App.benchColor(b.id, T, j)}"></span>${esc(App.shortBench(b.name))}</button>`).join('');
  }
  App.bindBenchToggles = function (root) {
    root.querySelectorAll('[data-bench]').forEach(b => b.addEventListener('click', () => { const id = b.dataset.bench, ui = App.ui; ui.eqBench = ui.eqBench.includes(id) ? ui.eqBench.filter(x => x !== id) : [...ui.eqBench, id]; App.render(); }));
  };

  /* ------------------------------------------------ attribution chart */
  App.attributionChart = function (canvasId) {
    const a = App.res.attribution, T = App.theme();
    const items = [
      ['Price effect', a.pricePE], ['Currency', a.fxFE], ['Dividends', a.dividends], ['Withh. tax', a.taxes],
      ['Interest', a.interest], ['Fees', a.tradeFees + a.otherFees]
    ];
    if (Math.abs(a.fxadj) > 0.5) items.push(['FX adj.', a.fxadj]);
    if (Math.abs(a.residual) > 0.5) items.push(['Other', a.residual]);
    let run = 0;
    const bars = items.map(([k, v]) => { const s = run; run += v; return { k, v, lo: s, hi: run }; });
    bars.push({ k: 'Total P&L', v: run, lo: 0, hi: run, total: true });
    const labels = {
      id: 'vlabels',
      afterDatasetsDraw(ch) {
        const ctx = ch.ctx, meta = ch.getDatasetMeta(0), xs = ch.scales.x;
        ctx.save(); ctx.font = `500 10.5px ${T.mono}`; ctx.textBaseline = 'middle';
        meta.data.forEach((el, i) => {
          const b = bars[i], lo = xs.getPixelForValue(Math.min(b.lo, b.hi)), hi = xs.getPixelForValue(Math.max(b.lo, b.hi));
          const txt = F.eur(b.v, { dec: 0, compact: true, sign: !b.total });
          ctx.fillStyle = b.total ? T.text : T.text2;
          if (b.v >= 0) { ctx.textAlign = 'left'; ctx.fillText(txt, hi + 6, el.y); } else { ctx.textAlign = 'right'; ctx.fillText(txt, lo - 6, el.y); }
        });
        ctx.restore();
      }
    };
    return App.chart(canvasId, {
      type: 'bar', plugins: [labels],
      data: {
        labels: bars.map(b => b.k.toUpperCase()),
        datasets: [{ data: bars.map(b => [b.lo, b.hi]), backgroundColor: bars.map(b => b.total ? T.accent : (b.v >= 0 ? T.gain : T.loss)), borderRadius: 1, borderSkipped: false, barThickness: 13 }]
      },
      options: {
        indexAxis: 'y', layout: { padding: { right: 70, left: 2, top: 4 } },
        scales: {
          y: { grid: { display: false }, border: { display: false }, ticks: { color: T.text2, font: { family: T.mono, size: 9.5 }, padding: 10 } },
          x: App.valueAxis(T, v => App.axisEur(v), { position: 'bottom', grace: '6%' })
        },
        plugins: { tooltip: Object.assign(App.tooltipStyle(T), { displayColors: false, callbacks: { label: c => ' ' + F.eur(bars[c.dataIndex].v, { sign: !bars[c.dataIndex].total }) } }) }
      }
    });
  };

  /* ----------------------------------------------------- map helpers */
  function mapItems(positions, colorBy, groupFn) {
    const T = App.theme();
    const cap = colorBy === 'day' ? 0.05 : 1;
    return positions.filter(p => p.value > 0).map(p => {
      const m = colorBy === 'day' ? (p.dayFresh ? p.dayPct : NaN) : p.unrealPct;
      return {
        v: p.value, label: App.instLabel(p.inst), metricText: isFinite(m) ? F.pct(m, { dec: 1 }) : '—',
        sub: `${F.pct(p.weight, { sign: false, dec: 1 })} · ${F.eur(p.value, { dec: 0, compact: true })}`, href: '#/position/' + p.id,
        color: App.divColor(m, cap, T), g: groupFn ? groupFn(p) : null,
        tip: `<div class="tt-h">${esc(App.instLabel(p.inst))} · ${esc(p.inst.type === 'option' ? p.inst.ticker : p.inst.name)}</div><div class="tt-big">${F.eur(p.value)}</div>Weight ${F.pct(p.weight, { sign: false, dec: 1 })}<br>Unrealised ${F.eur(p.unreal, { sign: true, dec: 0 })} (${F.pct(p.unrealPct, { dec: 1 })})<br>Last move ${p.dayFresh ? F.pct(p.dayPct) : '—'}${p.dayTo ? ' · ' + F.date(p.dayTo, 'dm') : ''}`
      };
    });
  }
  const mapColorSeg = (cur) => `<div class="seg"><button class="${cur !== 'day' ? 'on' : ''}" data-mapc="pnl">P&L %</button><button class="${cur === 'day' ? 'on' : ''}" data-mapc="day">1D</button></div>`;
  const bindMapColor = root => root.querySelectorAll('[data-mapc]').forEach(b => b.addEventListener('click', () => { App.ui.mapColor = b.dataset.mapc; App.render(); }));

  /* ============================================================ dashboard */
  V.dashboard = function () {
    const r = App.res;
    if (r.empty) return emptyView();
    const ui = App.ui, tot = r.totals, S = App.state.settings;
    const m1d = App.metrics('1D'), mytd = App.metrics('YTD'), mall = App.metrics('ALL');
    const conc = PT.concentration(r.positions, S.concThreshold);
    const first = !ui.counted.dashboard; ui.counted.dashboard = true;
    const odo = (v, f) => first ? App.odoHTML(f(v)) : esc(f(v));
    const dayLabel = `1D · ${F.date(PT.iso(r.lastPriceDay), 'dm')}`;
    const heroDelta = deltaHTML(m1d.pnl, m1d.twr, dayLabel);
    const thr = S.concThreshold;
    const selB = r.benchmarks.find(b => b.id === S.benchmark);
    const bm = mall.bench[S.benchmark];
    const fresh = r.positions.filter(p => p.dayFresh && isFinite(p.dayPct)).sort((a, b) => b.dayPct - a.dayPct);
    const up = fresh.filter(p => p.dayPct > 0).slice(0, 3), down = fresh.filter(p => p.dayPct < 0).slice(-3).reverse();
    const maxMove = Math.max(0.0001, ...fresh.map(p => Math.abs(p.dayPct)));
    const moverRow = (p, val, txt, max) => {
      const w = Math.min(50, Math.abs(val) / max * 50);
      const bar = val >= 0 ? `left:50%;width:${w}%;background:var(--gain)` : `left:${50 - w}%;width:${w}%;background:var(--loss)`;
      return `<a class="mover" href="#/position/${p.id}"><span class="tk" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(App.instLabel(p.inst))}</span><span class="track"><span style="${bar}"></span></span><span class="num ${F.cls(val)}" style="text-align:right">${txt}</span></a>`;
    };
    const contrib = r.positions.filter(p => isFinite(p.unreal)).sort((a, b) => b.unreal - a.unreal);
    const contribList = [...contrib.slice(0, 4), ...contrib.filter(p => p.unreal < 0).slice(-3).reverse()].filter((p, i, a) => a.indexOf(p) === i);
    const maxContrib = Math.max(1, ...contribList.map(p => Math.abs(p.unreal)));
    const recent = [...App.state.transactions.map(t => ({ d: t.date, t })), ...App.state.cash.filter(c => c.type !== 'interest' && c.type !== 'fee').map(c => ({ d: c.date, c }))]
      .filter(x => x.d <= r.asOfISO).sort((a, b) => a.d < b.d ? 1 : -1).slice(0, 6);
    const longs = r.positions.filter(p => p.value > 0).sort((a, b) => b.value - a.value);
    const longTot = longs.reduce((s, p) => s + p.value, 0);
    const html = `
    <div class="grid g-12">
      <section class="card c-12 hero">
        <div class="hero-grid">
          <div class="hero-main">
            <div class="eyebrow label"><span class="pulse"></span>Net asset value · EUR ${tip('value')}</div>
            <div class="hero-value" id="hv">${first ? App.odoHeroHTML(tot.value) : App.heroHTML(tot.value)}</div>
            <div class="hero-delta" id="hd">${heroDelta}</div>
            <div class="hero-chips">
              <div><span class="k">YTD ${tip('ytd')}</span><span class="v ${F.cls(mytd.twr)}">${F.pct(mytd.twr)} · ${F.eur(mytd.pnl, { sign: true, dec: 0 })}</span></div>
              <div><span class="k">Since ${F.date(r.startISO, 'month')}</span><span class="v ${F.cls(mall.twr)}">${F.pct(mall.twr)} TWR</span></div>
              <div><span class="k">Cash</span><span class="v">${F.eur(r.cash, { dec: 0 })}</span></div>
            </div>
          </div>
          <div class="hero-kpis">
            <div class="kpi"><div class="k">Net invested ${tip('invested')}</div><div class="v">${odo(tot.netInvested, v => F.eur(v, { dec: 0 }))}</div><div class="s">since ${F.date(r.startISO, 'med')}</div></div>
            <div class="kpi"><div class="k">Absolute return ${tip('pnl')}</div><div class="v ${F.cls(tot.pnl)}">${odo(tot.pnl, v => F.eur(v, { sign: true, dec: 0 }))}</div><div class="s">${F.pct(tot.simpleReturn)} on net invested</div></div>
            <div class="kpi"><div class="k">TWR ${mall.annualizedMeaningful ? 'p.a.' : ''} ${tip('twr')}</div><div class="v ${F.cls(mall.twr)}">${odo(mall.annualizedMeaningful ? mall.ann : mall.twr, v => F.pct(v))}</div><div class="s">${F.pct(mall.twr)} cumulative · time-weighted</div></div>
            <div class="kpi"><div class="k">XIRR p.a. ${tip('xirr')}</div><div class="v ${F.cls(mall.xirr)}">${odo(mall.xirr, v => F.pct(v))}</div><div class="s">money-weighted · ${tip('twrvsmwr')} why it differs</div></div>
          </div>
        </div>
        <div class="hero-bar">
          <div class="seg accent"><button class="${ui.eqMode !== 'perf' ? 'on' : ''}" data-eqmode="value">Value</button><button class="${ui.eqMode === 'perf' ? 'on' : ''}" data-eqmode="perf">Return</button></div>
          ${ui.eqMode === 'perf' ? `<div class="chips">${benchToggles(ui.eqBench)}</div>` : `<span class="label">Scrub the chart to travel through time</span>`}
          <span class="spacer"></span>
          ${periodChips(ui.eqPeriod, 'eqp')}
        </div>
        <div class="hero-chart"><canvas id="ch-eq" aria-label="Portfolio value over time"></canvas></div>
      </section>

      <div class="card c-7">
        <div class="card-h"><h2>Portfolio map</h2>${tip('map')}<div class="right">${App.mapLegend(ui.mapColor === 'day' ? 0.05 : 1, ui.mapColor === 'day' ? 'last move' : 'unrealised')}${mapColorSeg(ui.mapColor)}</div></div>
        <div class="tm" id="tm-dash" style="height:356px"></div>
      </div>

      <div class="card c-5">
        <div class="card-h"><h2>Return attribution</h2>${tip('attribution')}<div class="right"><span class="sub">all-time · EUR</span></div></div>
        <div class="chart" style="height:356px"><canvas id="ch-attr"></canvas></div>
      </div>

      <div class="card c-4">
        <div class="card-h"><h2>Risk</h2><div class="right"><span class="sub">since inception</span></div></div>
        <div class="risk-grid">
          <div><div class="k">Volatility ${tip('vol')}</div><div class="v">${F.pct(mall.vol, { sign: false, dec: 1 })}</div></div>
          <div><div class="k">Max drawdown ${tip('mdd')}</div><div class="v loss">${F.pct(mall.maxDD, { dec: 1 })}</div></div>
          <div><div class="k">Sharpe ${tip('sharpe')}</div><div class="v">${F.num(mall.sharpe, 2)}</div></div>
          <div><div class="k">Sortino ${tip('sortino')}</div><div class="v">${F.num(mall.sortino, 2)}</div></div>
        </div>
        <div class="row small" style="margin-top:14px;gap:10px">
          ${bm && isFinite(bm.beta) ? `<span class="num text-2">β ${F.num(bm.beta, 2)} · ρ ${F.num(bm.corr, 2)} <span class="muted">vs ${esc(App.shortBench(selB.name))}</span></span>${tip('beta')}` : ''}
          <span class="spacer"></span><span class="num muted xs">r<sub>f</sub> ${F.pct(S.rf, { sign: false })}</span>
        </div>
        ${mall.active < 40 ? `<div class="tag warn" style="margin-top:10px;white-space:normal;height:auto;padding:4px 7px">Only ${mall.active} days with price changes — ratios unreliable</div>` : ''}
      </div>

      <div class="card c-4">
        <div class="card-h"><h2>Concentration</h2>${tip('top3')}<div class="right"><span class="sub">limit ${F.pct(thr, { sign: false, dec: 0 })}</span></div></div>
        <div class="row" style="gap:26px;align-items:flex-end">
          <div><div class="label">Largest · ${conc.largest ? esc(App.instLabel(conc.largest.inst)) : '—'}</div><div class="bigfig" style="margin-top:8px;${conc.breaches.length ? 'color:var(--warn)' : ''}">${F.pct(conc.largest ? conc.largest.weight : 0, { sign: false, dec: 1 })}</div></div>
          <div><div class="label">Top 3</div><div class="bigfig" style="margin-top:8px">${F.pct(conc.top3, { sign: false, dec: 1 })}</div></div>
          <div><div class="label">Eff. N</div><div class="bigfig" style="margin-top:8px">${F.num(conc.effectiveN, 1)}</div></div>
        </div>
        <div class="wstack">${longs.map((p, i) => `<span class="${p.weight > thr ? 'breach' : i === 0 ? 'big' : ''}" style="flex:${(p.value / longTot).toFixed(4)} 1 0" data-tip="${esc(App.instLabel(p.inst))} · ${F.pct(p.weight, { sign: false, dec: 1 })}"></span>`).join('')}</div>
        <div class="xs muted" style="font-family:var(--mono)">One block per holding · width = weight</div>
        ${conc.breaches.length ? `<div class="tag warn" style="margin-top:12px;white-space:normal;height:auto;padding:4px 7px">${icon('alert')} ${conc.breaches.map(p => esc(App.instLabel(p.inst)) + ' ' + F.pct(p.weight, { sign: false, dec: 1 })).join(', ')} above limit</div>` : ''}
      </div>

      <div class="card c-4">
        <div class="card-h"><h2>Movers</h2>${tip('movers')}<div class="right"><span class="sub">${F.date(PT.iso(r.lastPriceDay), 'dm')} vs prior</span></div></div>
        ${fresh.length ? [...up, ...down].map(p => moverRow(p, p.dayPct, F.pct(p.dayPct), maxMove)).join('') : '<div class="muted small">Store two consecutive price updates to see daily movers.</div>'}
      </div>

      <div class="card c-6">
        <div class="card-h"><h2>Contributors</h2><div class="right"><span class="sub">unrealised P&L</span><a class="small" href="#/positions">All →</a></div></div>
        ${contribList.map(p => moverRow(p, p.unreal, F.eur(p.unreal, { sign: true, dec: 0 }), maxContrib)).join('')}
      </div>

      <div class="card c-6">
        <div class="card-h"><h2>Recent activity</h2><div class="right"><a class="small" href="#/activity">Ledger →</a></div></div>
        ${recent.map(x => {
          if (x.t) {
            const t = x.t, inst = App.instById(t.instId);
            return `<div class="list-row"><span class="tag ${t.type === 'buy' ? 'accent' : ''}" style="min-width:84px;justify-content:center">${typeLabel(t.type)}</span><a href="#/position/${t.instId}" class="tk">${esc(App.instLabel(inst))}</a><span class="muted small num">${t.type === 'split' ? '' : F.qty(t.qty) + ' @ ' + F.price(t.price, t.currency)}</span><span class="spacer"></span><span class="muted num xs">${F.date(t.date)}</span></div>`;
          }
          const c = x.c;
          return `<div class="list-row"><span class="tag" style="min-width:84px;justify-content:center">${typeLabel(c.type)}</span><span class="text-2" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c.instId ? esc(App.instLabel(App.instById(c.instId))) : esc(c.note || '')}</span><span class="spacer"></span><span class="num ${F.cls(c.amount)}">${F.price(c.amount, c.currency)}</span><span class="muted num xs">${F.date(c.date)}</span></div>`;
        }).join('') || '<div class="muted">Nothing yet.</div>'}
      </div>
    </div>`;
    return {
      title: 'Overview', html,
      mount(root) {
        const hv = root.querySelector('#hv'), hd = root.querySelector('#hd');
        const cumF = new Float64Array(r.N); let acc = 0;
        for (let k = 0; k < r.N; k++) { acc += r.F[k]; cumF[k] = acc; }
        const restore = () => { if (!hv.classList.contains('scrub')) return; hv.classList.remove('scrub'); hv.innerHTML = App.heroHTML(tot.value); hd.innerHTML = heroDelta; };
        const scrub = (i, i0) => {
          const b = i0 - 1, Vb = b >= 0 ? r.V[b] : 0, Fb = b >= 0 ? cumF[b] : 0;
          const pnl = r.V[i] - Vb - (cumF[i] - Fb), twr = r.IDX[i] / (b >= 0 ? r.IDX[b] : 1) - 1;
          hv.classList.add('scrub');
          hv.innerHTML = App.heroHTML(r.V[i]);
          hd.innerHTML = deltaHTML(pnl, twr, `${pLabel(ui.eqPeriod)} → ${F.date(PT.iso(r.days[i]), 'med')}`);
        };
        App.equityChart('ch-eq', ui.eqPeriod, ui.eqMode === 'perf' ? 'perf' : 'value', ui.eqBench, { scrub, leave: restore });
        root.querySelector('#ch-eq').addEventListener('mouseleave', restore);
        App.treemap(root.querySelector('#tm-dash'), mapItems(r.positions, ui.mapColor));
        App.attributionChart('ch-attr');
        bindMapColor(root);
        root.querySelectorAll('[data-eqp]').forEach(b => b.addEventListener('click', () => { ui.eqPeriod = b.dataset.eqp; App.render(); }));
        root.querySelectorAll('[data-eqmode]').forEach(b => b.addEventListener('click', () => { ui.eqMode = b.dataset.eqmode; App.render(); }));
        App.bindBenchToggles(root);
      }
    };
  };

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
      unrealPct: p => p.unrealPct, realized: p => p.realized, currency: p => p.currency, hold: p => p.holdDays, price: p => p.price, day: p => (p.dayFresh ? p.dayPct : -Infinity)
    }[ui.posSort.k] || (p => p.value);
    rows.sort((a, b) => { const x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * ui.posSort.dir; });
    const th = (k, label, cls, t) => `<th class="sortable ${cls || ''}" data-sort="${k}">${label}${t ? ' ' + tip(t) : ''}${ui.posSort.k === k ? `<span class="arr">${ui.posSort.dir > 0 ? '▲' : '▼'}</span>` : ''}</th>`;
    const sum = rows.reduce((o, p) => { o.cost += p.cost; o.value += p.value; o.unreal += isFinite(p.unreal) ? p.unreal : 0; o.realized += p.realized; o.w += p.weight; o.day += isFinite(p.dayEUR) && p.dayFresh ? p.dayEUR : 0; return o; }, { cost: 0, value: 0, unreal: 0, realized: 0, w: 0, day: 0 });
    const allSum = r.positions.reduce((o, p) => { o.u += isFinite(p.unreal) ? p.unreal : 0; o.c += p.cost; return o; }, { u: 0, c: 0 });
    const conc = PT.concentration(r.positions, thr);
    const tiles = `<div class="tiles">
      <div class="tile"><div class="k">Holdings</div><div class="v">${r.positions.length}</div><div class="s">${r.positions.filter(p => p.inst.type === 'option').length} options · ${r.positions.filter(p => p.side === 'short').length} short</div></div>
      <div class="tile"><div class="k">Market value</div><div class="v">${F.eur(r.totals.securities, { dec: 0 })}</div><div class="s">cash ${F.eur(r.cash, { dec: 0 })}</div></div>
      <div class="tile"><div class="k">Unrealised ${tip('unreal')}</div><div class="v ${F.cls(allSum.u)}">${F.eur(allSum.u, { sign: true, dec: 0 })}</div><div class="s">${F.pct(allSum.c ? allSum.u / allSum.c : NaN, { dec: 1 })} on cost</div></div>
      <div class="tile"><div class="k">Realised ${tip('realized')}</div><div class="v ${F.cls(r.totals.realized)}">${F.eur(r.totals.realized, { sign: true, dec: 0 })}</div><div class="s">all-time, after fees</div></div>
      <div class="tile"><div class="k">Largest ${tip('weight')}</div><div class="v" style="${conc.breaches.length ? 'color:var(--warn)' : ''}">${F.pct(conc.largest ? conc.largest.weight : 0, { sign: false, dec: 1 })}</div><div class="s">${conc.largest ? esc(App.instLabel(conc.largest.inst)) : ''} · limit ${F.pct(thr, { sign: false, dec: 0 })}</div></div>
    </div>`;
    const table = `<div class="table-wrap"><table class="t">
          <thead><tr>
            ${th('ticker', 'Instrument')}${th('weight', 'Weight', 'r', 'weight')}${th('qty', 'Qty', 'r')}<th class="r">Avg cost</th>${th('price', 'Last', 'r')}${th('day', '1D', 'r', 'movers')}
            ${th('cost', 'Cost', 'r')}${th('value', 'Value', 'r', 'value')}${th('unreal', 'P&L € / %', 'r', 'unreal')}${th('realized', 'Realised', 'r', 'realized')}
            ${th('hold', 'Held', 'r', 'hold')}<th class="r">90D</th>
          </tr></thead>
          <tbody>
          ${rows.map(p => {
            const breach = p.weight > thr;
            const badges = [p.side === 'short' ? '<span class="tag">Short</span>' : '', p.missingPrice ? '<span class="tag loss">No price</span>' : (p.stale ? `<span class="tag warn" data-tip="Last price from ${F.date(p.priceDate)} (${p.priceSource === 'stored' ? 'stored' : 'last trade'})">Stale</span>` : ''), p.zeroCost ? '<span class="tag">Zero cost</span>' : ''].join('');
            return `<tr class="click" data-pos="${p.id}">
              <td style="max-width:240px"><div class="row" style="gap:6px;flex-wrap:nowrap"><span class="tk nowrap">${esc(App.instLabel(p.inst))}</span>${badges}</div><div class="nm">${p.broker ? `<span class="badge-broker" style="margin-right:6px">${esc(p.broker)}</span>` : ''}${esc(p.inst.type === 'option' ? p.inst.ticker : p.inst.name)}</div></td>
              <td class="r"><div class="wbar ${breach ? 'breach' : ''}"><span>${F.pct(p.weight, { sign: false, dec: 1 })}</span><span class="track"><span class="fill" style="display:block;width:${Math.min(100, Math.abs(p.weight) / Math.max(thr, 0.0001) * 50)}%"></span></span></div></td>
              <td class="r">${F.qty(p.qty)}</td>
              <td class="r">${F.price(p.avgCostLocal, p.currency)}</td>
              <td class="r">${F.price(p.price, p.currency)}<div class="xs muted">${p.priceDate ? F.date(p.priceDate, 'dm') : ''}</div></td>
              <td class="r">${p.dayFresh ? F.spct(p.dayPct, { dec: 1 }) : '<span class="muted">—</span>'}</td>
              <td class="r">${F.eur(p.cost, { dec: 0 })}</td>
              <td class="r" style="color:var(--text);font-weight:600">${F.eur(p.value, { dec: 0 })}</td>
              <td class="r" data-tip="Price effect ${F.eur(p.pe, { dec: 0, sign: true })} · currency effect ${F.eur(p.fe, { dec: 0, sign: true })}">${F.seur(p.unreal, { dec: 0 })}<div class="xs">${F.spct(p.unrealPct, { dec: 1 })}</div></td>
              <td class="r">${Math.abs(p.realized) > 0.005 ? F.seur(p.realized, { dec: 0 }) : '<span class="muted">—</span>'}</td>
              <td class="r nowrap" data-tip="Since ${F.date(p.since)} · avg lot age ${F.dur(p.avgAge)}">${F.dur(p.holdDays)}</td>
              <td class="r">${App.spark(sparkVals(p.id, 90))}</td>
            </tr>`;
          }).join('')}
          </tbody>
          <tfoot><tr><td>Total · ${rows.length}</td><td class="r">${F.pct(sum.w, { sign: false, dec: 1 })}</td><td></td><td></td><td></td><td class="r">${F.seur(sum.day, { dec: 0 })}</td><td class="r">${F.eur(sum.cost, { dec: 0 })}</td><td class="r">${F.eur(sum.value, { dec: 0 })}</td><td class="r">${F.seur(sum.unreal, { dec: 0 })}<div class="xs">${F.spct(sum.cost ? sum.unreal / sum.cost : NaN, { dec: 1 })}</div></td><td class="r">${F.seur(sum.realized, { dec: 0 })}</td><td colspan="2"></td></tr></tfoot>
        </table></div>`;
    const html = `${tiles}
      <div class="grid g-12"><div class="card c-12 flush">
        <div class="card-h" style="padding-bottom:16px">
          <h2>${ui.posView === 'map' ? 'Holdings map' : 'Open positions'}</h2><span class="sub">${F.eur(sum.value, { dec: 0 })} · ${F.pct(sum.w, { sign: false, dec: 1 })} of portfolio</span>
          <div class="right">
            ${ui.posView === 'map' ? App.mapLegend(ui.mapColor === 'day' ? 0.05 : 1, ui.mapColor === 'day' ? 'last move' : 'unrealised') + mapColorSeg(ui.mapColor) : `<input type="search" id="pos-q" placeholder="Search ticker, name, tag…" value="${esc(ui.posQuery)}" style="width:220px"><label class="check"><input type="checkbox" id="pos-opt" ${ui.posOptions ? 'checked' : ''}> Options</label>`}
            <div class="seg accent"><button class="${ui.posView !== 'map' ? 'on' : ''}" data-pv="table">Table</button><button class="${ui.posView === 'map' ? 'on' : ''}" data-pv="map">Map</button></div>
          </div>
        </div>
        ${ui.posView === 'map' ? `<div style="padding:0 var(--pad) var(--pad)"><div class="tm" id="tm-pos" style="height:min(620px, 70vh)"></div></div>` : table}
      </div></div>
      <p class="xs muted" style="font-family:var(--mono);margin-top:-10px">FIFO cost basis incl. purchase fees. Written options are short positions — their value is the (negative) cost to buy them back.</p>`;
    return {
      title: 'Positions', html,
      mount(root) {
        root.querySelectorAll('[data-pv]').forEach(b => b.addEventListener('click', () => { ui.posView = b.dataset.pv; App.render(); }));
        if (ui.posView === 'map') { App.treemap(root.querySelector('#tm-pos'), mapItems(r.positions, ui.mapColor)); bindMapColor(root); return; }
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
    const lots = [];
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
  App.heroPriceHTML = function (v, cur) {
    const s = F.price(v, cur);
    const m = s.match(/^(.*?)([.,]\d{2,4})(\s?\S*)$/);
    return m && !['KRW', 'JPY'].includes(cur) ? `${esc(m[1])}<span class="cents">${esc(m[2] + m[3])}</span>` : esc(s);
  };
  V.position = function (id) {
    const r = App.res, inst = App.instById(id);
    if (!inst) return { title: 'Not found', html: '<div class="card solo">This instrument no longer exists. <a href="#/positions">Back to positions</a></div>' };
    const p = r.positions ? r.positions.find(x => x.id === id) : null;
    const st = r.instState ? r.instState[id] : null;
    const ui = App.ui;
    const txs = App.state.transactions.filter(t => t.instId === id).sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : (a.seq || 0) - (b.seq || 0));
    const divs = App.state.cash.filter(c => c.instId === id).sort((a, b) => a.date < b.date ? 1 : -1);
    const realized = r.realized ? r.realized.filter(x => x.instId === id) : [];
    const rz = realized.reduce((s, x) => s + x.pnl, 0);
    const divNet = st && st.summary ? st.summary.dividends : (p ? p.dividends : 0);
    const cur = inst.currency;
    const ps = r.priceSeries ? r.priceSeries[id] : null;
    const lastP = p ? p.price : (ps && ps.n ? ps.at(r.asOf) : NaN);
    const tags = (inst.tags || []).map(t => `<span class="tag accent">${esc(t)}</span>`).join(' ');
    const lots = p ? p.lots : [];
    const kpis = p ? [
      ['Market value', F.eur(p.value, { dec: 0 }), `${F.pct(p.weight, { sign: false, dec: 1 })} of portfolio`, ''],
      ['Unrealised ' + tip('unreal'), F.eur(p.unreal, { sign: true, dec: 0 }), `${F.pct(p.unrealPct, { dec: 1 })} on cost`, F.cls(p.unreal)],
      ['Realised ' + tip('realized'), F.eur(rz, { sign: true, dec: 0 }), `${realized.length} lot slice(s) closed`, F.cls(rz)],
      ['Total return', F.eur(p.totalReturn, { sign: true, dec: 0 }), 'unrealised + realised + dividends', F.cls(p.totalReturn)]
    ] : [
      ['Status', 'Closed', st && st.trips && st.trips.length ? `last closed ${F.date(PT.iso(st.trips[st.trips.length - 1].end))}` : 'no open quantity', ''],
      ['Realised ' + tip('realized'), F.eur(rz, { sign: true, dec: 0 }), `${realized.length} lot slice(s)`, F.cls(rz)],
      ['Dividends (net)', F.eur(divNet, { sign: true, dec: 0 }), '', F.cls(divNet)],
      ['Total return', F.eur(rz + divNet, { sign: true, dec: 0 }), 'realised + dividends', F.cls(rz + divNet)]
    ];
    const tiles = p ? [
      ['Quantity', F.qty(p.qty), inst.multiplier > 1 ? `× ${inst.multiplier} multiplier` : (p.side === 'short' ? 'short' : 'shares')],
      ['Avg cost', F.price(p.avgCostLocal, cur), `${F.eur(p.avgCostEUR)} / unit incl. fees`],
      ['Cost basis', F.eur(p.cost, { dec: 0 }), `fees ${F.eur(p.fees)}`],
      ['Price effect ' + tip('pe'), `<span class="${F.cls(p.pe)}">${F.eur(p.pe, { sign: true, dec: 0 })}</span>`, 'in local currency'],
      ['Currency effect ' + tip('fe'), `<span class="${F.cls(p.fe)}">${F.eur(p.fe, { sign: true, dec: 0 })}</span>`, `FX now ${cur === 'EUR' ? '—' : F.fx(p.fx)}`],
      ['Dividends (net)', `<span class="${F.cls(divNet)}">${F.eur(divNet, { sign: true, dec: 0 })}</span>`, `gross ${F.eur(p.divGross)} · tax ${F.eur(-p.divTax)}`],
      ['Held ' + tip('hold'), F.dur(p.holdDays), `since ${F.date(p.since)}`],
      ['Broker', esc(p.broker || '—'), esc(inst.exchange || '')]
    ] : [];
    const dayTxt = p && p.dayFresh ? deltaHTML(p.dayEUR, p.dayPct, `last move · ${F.date(p.dayTo, 'dm')}`) : `<em>${p && p.priceDate ? 'price from ' + F.date(p.priceDate) : 'no recent price move'}</em>`;
    const html = `
      <div class="row" style="margin:-8px 0 16px"><a href="#/positions" class="btn ghost sm">${icon('back')}Positions</a><span class="spacer"></span><button class="btn sm" data-pa="price">${icon('plus')}Add price</button><button class="btn sm" data-pa="trade">${icon('plus')}Trade</button><button class="btn sm" data-pa="edit">${icon('edit')}Edit instrument</button></div>
      <div class="grid g-12">
        <section class="card c-12 hero">
          <div class="hero-grid">
            <div class="hero-main">
              <div class="eyebrow label"><span class="pulse"></span>Last price · ${esc(cur)} ${p && p.priceSource !== 'stored' ? '<span class="tag warn">from last trade</span>' : ''}</div>
              <div class="hero-value" id="hv" style="font-size:clamp(52px, 7vw, 96px)">${App.heroPriceHTML(lastP, cur)}</div>
              <div class="hero-delta" id="hd">${dayTxt}</div>
              <div class="row" style="margin-top:16px;gap:6px">${inst.type !== 'stock' ? `<span class="tag">${esc(inst.type)}</span>` : ''}${tags}<span class="xs muted" style="font-family:var(--mono);margin-left:6px">${[inst.isin, inst.exchange, inst.country, inst.sector, inst.expiry ? 'expires ' + F.date(inst.expiry) : ''].filter(Boolean).map(esc).join(' · ')}</span></div>
            </div>
            <div class="hero-kpis">${kpis.map(k => `<div class="kpi"><div class="k">${k[0]}</div><div class="v ${k[3]}">${k[1]}</div><div class="s">${k[2]}</div></div>`).join('')}</div>
          </div>
          <div class="hero-bar"><div class="legend"><span><i style="border-color:var(--text-2)"></i>Price</span><span><i class="dash" style="border-color:var(--accent)"></i>Avg cost (open lots)</span><span><i class="dot" style="background:var(--accent)"></i>Buy</span><span><i class="dot" style="background:transparent;border:1.5px solid var(--text)"></i>Sell</span></div><span class="spacer"></span>${periodChips(ui.detailPeriod, 'dp')}</div>
          <div class="hero-chart" style="height:340px"><canvas id="ch-px"></canvas></div>
        </section>
      </div>
      ${tiles.length ? `<div class="tiles eight">${tiles.map(t => `<div class="tile"><div class="k">${t[0]}</div><div class="v">${t[1]}</div><div class="s">${t[2]}</div></div>`).join('')}</div>` : ''}
      <div class="grid g-12">
        ${lots.length ? `<div class="card c-12 flush"><div class="card-h"><h2>Open lots · FIFO</h2><span class="sub">oldest lot is sold first</span></div><div class="table-wrap"><table class="t compact"><thead><tr><th>Opened</th><th class="r">Qty</th><th class="r">Price</th><th class="r">FX</th><th class="r">Cost €</th><th class="r">Fees €</th><th class="r">Value €</th><th class="r">P&L €</th><th class="r">Age</th></tr></thead><tbody>
          ${lots.map(l => { const val = isFinite(p.price) ? l.q * l.mult * p.price / p.fx : NaN; const pl = val - l.q * l.uc - Math.abs(l.q) * l.uf; return `<tr><td class="num">${F.date(l.date)}${l.inKind ? ' <span class="tag">transfer in</span>' : ''}</td><td class="r">${F.qty(l.q)}</td><td class="r">${F.price(l.p, l.cur)}</td><td class="r">${l.cur === 'EUR' ? '—' : F.fx(l.fx)}</td><td class="r">${F.eur(l.q * l.uc)}</td><td class="r">${F.eur(Math.abs(l.q) * l.uf)}</td><td class="r">${F.eur(val)}</td><td class="r">${F.seur(pl)}</td><td class="r">${F.dur(r.asOf - l.d)}</td></tr>`; }).join('')}
        </tbody></table></div></div>` : ''}
        <div class="card c-12 flush"><div class="card-h"><h2>Transaction log</h2><span class="sub">${txs.length} trade(s) · ${divs.length} cash item(s)</span></div><div class="table-wrap"><table class="t compact">
          <thead><tr><th>Date</th><th>Type</th><th class="r">Qty</th><th class="r">Price</th><th class="r">FX</th><th class="r">Fees €</th><th class="r">Amount €</th><th>Broker</th><th>Note</th><th></th></tr></thead><tbody>
          ${[...txs.map(t => ({ d: t.date, t })), ...divs.map(c => ({ d: c.date, c }))].sort((a, b) => a.d < b.d ? 1 : -1).map(x => {
            if (x.t) {
              const t = x.t, fx = t.fx > 0 ? t.fx : (t.currency === 'EUR' ? 1 : r.fxAt ? r.fxAt(t.currency, PT.dn(t.date)) : NaN);
              const amt = t.type === 'split' ? NaN : (t.type === 'buy' ? -1 : t.type === 'sell' ? 1 : 0) * t.qty * t.price * (inst.multiplier || 1) / fx - (t.type === 'buy' || t.type === 'sell' ? t.fee : 0);
              return `<tr><td class="num">${F.date(t.date)}</td><td><span class="tag ${t.type === 'buy' ? 'accent' : ''}">${typeLabel(t.type)}</span></td><td class="r">${t.type === 'split' ? '×' + F.num(t.ratio, 4) : F.qty(t.qty)}</td><td class="r">${t.type === 'split' ? '' : F.price(t.price, t.currency)}</td><td class="r">${t.currency === 'EUR' || t.type === 'split' ? '—' : F.fx(fx)}${t.fx > 0 ? '' : (t.type === 'split' ? '' : ' <span class="muted xs" data-tip="Taken from FX history">*</span>')}</td><td class="r">${t.fee ? F.eur(t.fee) : '—'}</td><td class="r">${t.type.startsWith('transfer') ? '<span class="muted xs">no cash</span>' : (isFinite(amt) && amt !== 0 ? F.seur(amt) : '')}</td><td><span class="badge-broker">${esc(t.broker || '—')}</span></td><td class="muted small">${esc(t.note || '')}</td>
                <td class="r nowrap"><button class="icon-btn" data-edit-tx="${t.id}" aria-label="Edit">${icon('edit')}</button><button class="icon-btn" data-del-tx="${t.id}" aria-label="Delete">${icon('trash')}</button></td></tr>`;
            }
            const c = x.c;
            return `<tr><td class="num">${F.date(c.date)}</td><td><span class="tag">${typeLabel(c.type)}</span></td><td></td><td></td><td></td><td></td><td class="r ${F.cls(c.amount)}">${F.price(c.amount, c.currency)}${c.wht ? `<div class="xs muted">WHT ${F.price(-c.wht, c.currency)}</div>` : ''}</td><td><span class="badge-broker">${esc(c.broker || '—')}</span></td><td class="muted small">${esc(c.note || '')}</td>
              <td class="r nowrap"><button class="icon-btn" data-edit-cash="${c.id}" aria-label="Edit">${icon('edit')}</button><button class="icon-btn" data-del-cash="${c.id}" aria-label="Delete">${icon('trash')}</button></td></tr>`;
          }).join('')}
        </tbody></table></div></div>
      </div>`;
    return {
      title: App.instLabel(inst), sub: esc(inst.type === 'option' ? inst.ticker : inst.name || ''), html, noBanner: true, actions: '',
      mount(root) {
        const T = App.theme();
        const base = PT.periodBase(ui.detailPeriod, r.asOf, ps && ps.n ? ps.first : r.asOf, r.lastPriceDay);
        const priceData = [];
        if (ps) for (let i = 0; i < ps.n; i++) if (ps.xs[i] > base && ps.xs[i] <= r.asOf) priceData.push({ x: ps.xs[i] * PT.DAY, y: ps.ys[i] });
        const inRange = t => PT.dn(t.date) > base && t.currency === cur;
        const buys = txs.filter(t => (t.type === 'buy' || t.type === 'transfer_in') && inRange(t) && t.price > 0).map(t => ({ x: PT.dn(t.date) * PT.DAY, y: t.price, t }));
        const sells = txs.filter(t => (t.type === 'sell' || t.type === 'transfer_out') && inRange(t) && t.price > 0).map(t => ({ x: PT.dn(t.date) * PT.DAY, y: t.price, t }));
        const ac = avgCostPath(txs.filter(t => t.currency === cur));
        const acData = [];
        ac.forEach(([d, v]) => { if (d <= base) { acData.length = 0; acData.push({ x: (base + 1) * PT.DAY, y: v }); } else acData.push({ x: d * PT.DAY, y: v }); });
        if (acData.length && isFinite(acData[acData.length - 1].y)) acData.push({ x: r.asOf * PT.DAY, y: acData[acData.length - 1].y });
        const hv = root.querySelector('#hv'), hd = root.querySelector('#hd');
        const restoreHTML = [hv.innerHTML, hd.innerHTML];
        const restore = () => { hv.innerHTML = restoreHTML[0]; hd.innerHTML = restoreHTML[1]; hv.classList.remove('scrub'); };
        const xmin = Math.min(priceData.length ? priceData[0].x : Infinity, buys.length ? buys[0].x : Infinity, sells.length ? sells[0].x : Infinity);
        App.chart('ch-px', {
          type: 'line', plugins: [App.glowPlugin, App.xhair],
          data: {
            datasets: [
              { label: 'Price', data: priceData, borderColor: T.text2, backgroundColor: App.gradientFill(T.light ? '#4a515d' : '#a0a9b8', T.light ? 0.08 : 0.1, 0), fill: 'start', borderWidth: 1.6, pointRadius: 0, pointHoverRadius: 0, tension: 0, order: 3 },
              { label: 'Avg cost', data: acData, borderColor: T.accent, borderWidth: 1.5, borderDash: [5, 4], pointRadius: 0, pointHoverRadius: 0, stepped: 'before', spanGaps: false, order: 2, glow: T.glow },
              { label: 'Buy', type: 'scatter', data: buys, pointStyle: 'triangle', pointRadius: 7, pointHoverRadius: 9, backgroundColor: T.accent, borderColor: T.surface, borderWidth: 2, order: 0 },
              { label: 'Sell', type: 'scatter', data: sells, pointStyle: 'triangle', rotation: 180, pointRadius: 7, pointHoverRadius: 9, backgroundColor: T.surface, borderColor: T.text, borderWidth: 1.75, order: 0 }
            ]
          },
          options: {
            parsing: false, interaction: { mode: 'nearest', intersect: false, axis: 'x' },
            layout: { padding: { right: 80, top: 16, left: 6 } },
            scales: { x: App.timeAxis(T, null, priceData.length ? [xmin, r.asOf * PT.DAY] : null), y: App.valueAxis(T, v => F.price(v, cur)) },
            onHover: (evt, els, chart) => {
              const a = els.find(e => e.datasetIndex === 0);
              if (!a) { restore(); return; }
              const pt = chart.data.datasets[0].data[a.index];
              hv.classList.add('scrub'); hv.innerHTML = App.heroPriceHTML(pt.y, cur);
              const chg = isFinite(lastP) && pt.y > 0 ? lastP / pt.y - 1 : NaN;
              hd.innerHTML = `<em>${F.date(Math.round(pt.x / PT.DAY), 'med')}</em><span class="${F.cls(chg)}">${F.arrow(chg)} ${F.pct(chg)} to today</span>`;
            },
            plugins: {
              xhair: { enabled: true, color: T.text, fmtY: v => F.price(v, cur), fmtX: x => F.date(Math.round(x / PT.DAY)) },
              tooltip: Object.assign(App.tooltipStyle(T), {
                filter: item => item.datasetIndex >= 2,
                callbacks: {
                  title: items => items.length ? F.date(Math.round(items[0].parsed.x / PT.DAY), 'med') : '',
                  label: c => { const raw = c.raw; return raw && raw.t ? ` ${typeLabel(raw.t.type)} ${F.qty(raw.t.qty)} @ ${F.price(raw.t.price, cur)}` : ''; }
                }
              })
            }
          }
        });
        root.querySelector('#ch-px').addEventListener('mouseleave', restore);
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
    return `<div class="bars">${rows.map(x => `<div class="bar-row"><span class="name" title="${esc(x.k)}">${esc(x.k)}</span><div class="bar-track"><div class="bar-fill" style="width:${(x.v / mx * 100).toFixed(1)}%"></div></div><span class="num right" style="color:var(--text)">${F.pct(x.v / tot, { sign: false, dec: 1 })}</span><span class="num right muted eur">${F.eur(x.v, { dec: 0 })}</span></div>`).join('')}</div>`;
  }
  const GROUPS = { theme: ['Theme', p => (p.inst.tags || [])[0] || 'Untagged'], sector: ['Sector', p => p.inst.sector || 'Unclassified'], currency: ['Currency', p => p.currency], country: ['Country', p => p.inst.country || 'Unknown'], broker: ['Broker', p => p.broker || '—'], none: ['Flat', null] };
  V.allocation = function () {
    const r = App.res, ui = App.ui;
    if (r.empty) return emptyView('Allocation');
    const inc = !!App.state.settings.showCashInAlloc;
    const grp = GROUPS[ui.allocGroup] ? ui.allocGroup : 'theme';
    const dims = [
      ['Theme', groupBy(r.positions, p => p.inst.tags || [], inc), 'Multi-tag positions split equally', 'c-4'],
      ['Currency', groupBy(r.positions, p => p.currency, inc), 'Currency of listing', 'c-4'],
      ['Sector', groupBy(r.positions, p => p.inst.sector, inc), '', 'c-4'],
      ['Country', groupBy(r.positions, p => p.inst.country, inc), 'ISIN / listing country — editable', 'c-6'],
      ['Broker', groupBy(r.positions, p => p.broker, inc), '', 'c-6']
    ];
    const shorts = r.positions.filter(p => p.value < 0);
    const curTot = dims[1][1].filter(x => x.k !== 'Cash').reduce((s, x) => s + x.v, 0);
    const nonEur = dims[1][1].filter(x => x.k !== 'EUR' && x.k !== 'Cash').reduce((s, x) => s + x.v, 0) / Math.max(1, curTot);
    const open = r.positions.map(p => p.inst).filter((x, i, a) => a.indexOf(x) === i);
    const allTags = [...new Set(App.state.instruments.flatMap(i => i.tags || []))].sort();
    const html = `
      <div class="tiles">
        <div class="tile"><div class="k">Holdings</div><div class="v">${r.positions.filter(p => p.value > 0).length}</div><div class="s">long${shorts.length ? ` · ${shorts.length} short excluded` : ''}</div></div>
        <div class="tile"><div class="k">Themes</div><div class="v">${dims[0][1].filter(x => x.k !== 'Cash').length}</div><div class="s">top: ${esc((dims[0][1][0] || {}).k || '—')}</div></div>
        <div class="tile"><div class="k">Non-EUR exposure</div><div class="v">${F.pct(nonEur, { sign: false, dec: 0 })}</div><div class="s">${dims[1][1].filter(x => x.k !== 'Cash').length} currencies</div></div>
        <div class="tile"><div class="k">Countries</div><div class="v">${dims[3][1].filter(x => x.k !== 'Cash').length}</div><div class="s">top: ${esc((dims[3][1][0] || {}).k || '—')}</div></div>
      </div>
      <div class="grid g-12">
        <div class="card c-12">
          <div class="card-h"><h2>Exposure map</h2>${tip('map')}<span class="sub">grouped by ${GROUPS[grp][0].toLowerCase()}${grp === 'theme' ? ' (primary tag)' : ''}</span>
            <div class="right">${App.mapLegend(ui.mapColor === 'day' ? 0.05 : 1, ui.mapColor === 'day' ? 'last move' : 'unrealised')}${mapColorSeg(ui.mapColor)}
              <div class="seg">${Object.keys(GROUPS).map(k => `<button class="${k === grp ? 'on' : ''}" data-grp="${k}">${GROUPS[k][0]}</button>`).join('')}</div></div></div>
          <div class="tm" id="tm-alloc" style="height:min(560px, 66vh)"></div>
        </div>
        ${dims.map(([t, rows, note, c]) => `<div class="card ${c}"><div class="card-h"><h2>By ${t.toLowerCase()}</h2>${note ? `<span class="sub">${note}</span>` : ''}</div>${rows.length ? barList(rows) : '<div class="muted">No data.</div>'}</div>`).join('')}
        <div class="card c-12 flush"><div class="card-h"><h2>Classification</h2><span class="sub">sector, country and theme tags — e.g. “AI Energy”, “CPO/Optics”, “Robotics”</span><div class="right"><label class="check"><input type="checkbox" id="al-cash" ${inc ? 'checked' : ''}> Include cash in bars (${F.eur(r.cash, { dec: 0 })})</label></div></div>
          <div class="table-wrap"><table class="t compact"><thead><tr><th>Instrument</th><th>Sector</th><th>Country</th><th>Themes</th></tr></thead><tbody>
          ${open.map(i => `<tr><td><span class="tk">${esc(App.instLabel(i))}</span><div class="nm">${esc(i.name)}</div></td>
            <td><input type="text" data-cls="sector" data-id="${i.id}" value="${esc(i.sector || '')}" style="width:180px"></td>
            <td><input type="text" data-cls="country" data-id="${i.id}" value="${esc(i.country || '')}" style="width:150px"></td>
            <td><div class="row" style="gap:5px">${(i.tags || []).map(t => `<span class="tag accent">${esc(t)} <span class="x" data-untag="${esc(t)}" data-id="${i.id}" role="button" aria-label="Remove tag">×</span></span>`).join('')}<input type="text" list="tag-list" data-addtag="${i.id}" placeholder="+ tag" style="width:110px;height:26px"></div></td></tr>`).join('')}
          </tbody></table></div><datalist id="tag-list">${allTags.map(t => `<option value="${esc(t)}">`).join('')}</datalist>
        </div>
      </div>`;
    return {
      title: 'Allocation', html,
      mount(root) {
        App.treemap(root.querySelector('#tm-alloc'), mapItems(r.positions, ui.mapColor, GROUPS[grp][1]), { groups: !!GROUPS[grp][1] });
        bindMapColor(root);
        root.querySelectorAll('[data-grp]').forEach(b => b.addEventListener('click', () => { ui.allocGroup = b.dataset.grp; App.render(); }));
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
    const cell = v => { if (!isFinite(v)) return 'background:transparent'; const c = App.divColor(v, 0.1, T); return `background:${c.bg};color:${c.ink}`; };
    const yearRet = y => { const ms = months.filter(x => x.y === y); return ms.length ? ms[ms.length - 1].endIdx / ms[0].startIdx - 1 : NaN; };
    const monthNames = Array.from({ length: 12 }, (_, i) => new Intl.DateTimeFormat(F.loc(), { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2020, i, 1))).replace('.', ''));
    const tile = (k, v, s, t, c) => `<div class="tile"><div class="k">${k} ${t ? tip(t) : ''}</div><div class="v ${c || ''}">${v}</div><div class="s">${s || ''}</div></div>`;
    const html = `
      <div class="row" style="margin:-6px 0 16px">${periodChips(ui.perfPeriod, 'pp')}<span class="spacer"></span><span class="label">${F.date(PT.iso(Math.max(m.baseDay + 1, r.start)), 'med')} — ${F.date(r.asOfISO, 'med')} · ${m.days} days</span></div>
      <div class="tiles eight">
        ${tile('TWR', F.pct(m.twr), m.annualizedMeaningful ? F.pct(m.ann) + ' p.a.' : 'cumulative', 'twr', F.cls(m.twr))}
        ${tile('XIRR', F.pct(m.xirr), 'money-weighted, p.a.', 'xirr', F.cls(m.xirr))}
        ${tile('P&L', F.eur(m.pnl, { dec: 0, sign: true }), 'net of flows ' + F.eur(m.flows, { dec: 0, sign: true }), '', F.cls(m.pnl))}
        ${tile('Volatility', F.pct(m.vol, { sign: false, dec: 1 }), 'annualised', 'vol')}
        ${tile('Max drawdown', F.pct(m.maxDD, { dec: 1 }), m.maxDDTrough ? `${F.date(m.maxDDPeak, 'dm')} → ${F.date(m.maxDDTrough)}` : '', 'mdd', 'loss')}
        ${tile('Sharpe', F.num(m.sharpe, 2), `r<sub>f</sub> ${F.pct(m.rf, { sign: false })}`, 'sharpe')}
        ${tile('Sortino', F.num(m.sortino, 2), 'downside risk only', 'sortino')}
        ${tile('Beta', bm && isFinite(bm.beta) ? F.num(bm.beta, 2) : '—', selB ? `vs ${esc(App.shortBench(selB.name))}${bm && isFinite(bm.corr) ? ' · ρ ' + F.num(bm.corr, 2) : ''}` : '', 'beta')}
      </div>
      ${m.active < 40 ? `<div class="banner warn"><div class="ico">${icon('alert')}</div><div class="grow">Only ${m.active} days in this period have price changes. Volatility, drawdown, Sharpe and Sortino need a daily price history — import closes under Data → Prices.</div></div>` : ''}
      <div class="explain" style="margin-bottom:26px"><b>TWR ${F.pct(m.twr)} vs. XIRR ${F.pct(m.xirr)} p.a.</b> — TWR judges the investments, XIRR judges your timing: they differ when you add or withdraw money ahead of big moves.</div>
      <div class="grid g-12">
        <div class="card c-12"><div class="card-h"><h2>Cumulative return vs. benchmarks</h2><span class="sub">TWR, rebased to 0 % · benchmarks in EUR</span><div class="right"><div class="chips">${benchToggles(ui.eqBench)}</div></div></div>
          <div class="row" style="margin:-6px 0 8px"><span class="spacer"></span>${benchLegend(ui.eqBench, 'perf')}</div>
          <div class="chart h-360"><canvas id="ch-perf"></canvas></div></div>
        <div class="card c-6"><div class="card-h"><h2>Drawdown</h2>${tip('mdd')}<div class="right"><span class="sub">from running peak of the TWR index</span></div></div><div class="chart h-220"><canvas id="ch-dd"></canvas></div></div>
        <div class="card c-6"><div class="card-h"><h2>Rolling 12-month return</h2>${tip('rolling')}</div><div class="chart h-220"><canvas id="ch-roll"></canvas></div></div>
        <div class="card c-12"><div class="card-h"><h2>Monthly returns</h2><span class="sub">TWR per calendar month · partial months marked *</span><div class="right"><div class="heat-legend" style="margin:0"><span>${F.pct(-0.1, { dec: 0 })}</span><div class="scale">${[-1, -0.6, -0.25, 0, 0.25, 0.6, 1].map(v => `<span style="background:${App.divColor(v * 0.1, 0.1, T).bg}"></span>`).join('')}</div><span>${F.pct(0.1, { dec: 0 })}</span></div></div></div>
          <div class="heat-wrap"><div class="heat">
            <div></div>${monthNames.map(x => `<div class="hd">${x}</div>`).join('')}<div class="hd">Year</div>
            ${years.map(y => `<div class="yr">${y}</div>${Array.from({ length: 12 }, (_, i) => { const o = months.find(x => x.y === y && x.m === i + 1); return o ? `<div class="cell" style="${cell(o.r)}" data-tip="${monthNames[i]} ${y}: ${F.pct(o.r)}${o.partial ? ' (partial month)' : ''}">${F.num(o.r * 100, 1)}${o.partial ? '*' : ''}</div>` : '<div class="cell empty">·</div>'; }).join('')}<div class="cell tot" style="${cell(yearRet(y))}" data-tip="${y}: ${F.pct(yearRet(y))}">${F.num(yearRet(y) * 100, 1)}</div>`).join('')}
          </div></div>
        </div>
        <div class="card c-7 flush"><div class="card-h"><h2>Benchmark comparison</h2><span class="sub">${pLabel(ui.perfPeriod)}</span><div class="right"><select id="bench-sel" aria-label="Benchmark for beta">${r.benchmarks.map(b => `<option value="${b.id}" ${b.id === sel ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select></div></div>
          <div class="table-wrap"><table class="t"><thead><tr><th></th><th class="r">Return</th><th class="r">Ann.</th><th class="r">Vol</th><th class="r">Max DD</th><th class="r">Beta</th><th class="r">Corr</th></tr></thead><tbody>
            <tr><td class="nowrap"><i style="display:inline-block;width:14px;border-top:2px solid ${T.accent};vertical-align:middle;margin-right:9px"></i><b>Portfolio</b></td><td class="r">${F.spct(m.twr)}</td><td class="r">${F.spct(m.ann)}</td><td class="r">${F.pct(m.vol, { sign: false })}</td><td class="r">${F.pct(m.maxDD)}</td><td class="r muted">1,00</td><td class="r muted">—</td></tr>
            ${r.benchmarks.map((b, j) => { const x = m.bench[b.id]; return `<tr><td class="nowrap"><i style="display:inline-block;width:14px;border-top:2px ${['solid', 'dashed', 'dotted'][j % 3]} ${App.benchColor(b.id, T, j)};vertical-align:middle;margin-right:9px"></i>${esc(App.shortBench(b.name))}</td>${x ? `<td class="r">${F.spct(x.twr)}</td><td class="r">${F.spct(x.ann)}</td><td class="r">${F.pct(x.vol, { sign: false })}</td><td class="r">${F.pct(x.maxDD)}</td><td class="r">${F.num(x.beta, 2)}</td><td class="r">${F.num(x.corr, 2)}</td>` : '<td colspan="6" class="muted small">No data — add a series under Data → Benchmarks</td>'}</tr>`; }).join('')}
            ${bm ? `<tr><td class="muted">Excess vs ${esc(App.shortBench(selB.name))}</td><td class="r">${F.spct(m.twr - bm.twr)}</td><td class="r">${F.spct(m.ann - bm.ann)}</td><td colspan="4"></td></tr>` : ''}
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
          type: 'line', plugins: [App.xhair],
          data: { datasets: [{ label: 'Drawdown', data: dd.map(([d, v]) => ({ x: d * PT.DAY, y: v })), borderColor: T2.loss, backgroundColor: App.gradientFill(T2.loss, 0.04, 0.32), fill: 'origin', borderWidth: 1.5, pointRadius: 0, pointHoverRadius: 0, tension: 0 }] },
          options: { parsing: false, interaction: { mode: 'index', intersect: false }, layout: { padding: { right: 64, top: 8 } }, scales: { x: App.timeAxis(T2, null, dd.length ? [dd[0][0] * PT.DAY, dd[dd.length - 1][0] * PT.DAY] : null), y: App.valueAxis(T2, v => F.pct(v, { dec: 0 }), { max: 0 }) }, plugins: { xhair: { enabled: true, color: T2.loss, fmtY: v => F.pct(v, { dec: 1 }), fmtX: x => F.date(Math.round(x / PT.DAY)) }, tooltip: { enabled: false } } }
        });
        const roll = PT.rolling(r, 365).filter(x => !PT.isWeekend(x[0]));
        const el = document.getElementById('ch-roll');
        if (!roll.length) el.parentElement.innerHTML = '<div class="chart-fallback">Needs more than 12 months of history.</div>';
        else App.chart('ch-roll', {
          type: 'line', plugins: [App.glowPlugin, App.xhair],
          data: { datasets: [{ label: 'Rolling 12M', data: roll.map(([d, v]) => ({ x: d * PT.DAY, y: v })), borderColor: T2.accent, borderWidth: 1.75, pointRadius: 0, pointHoverRadius: 0, tension: 0, glow: T2.glow, fill: { target: { value: 0 }, above: App.alpha(T2.gain, 0.12), below: App.alpha(T2.loss, 0.12) } }] },
          options: { parsing: false, interaction: { mode: 'index', intersect: false }, layout: { padding: { right: 64, top: 8 } }, scales: { x: App.timeAxis(T2, null, [roll[0][0] * PT.DAY, roll[roll.length - 1][0] * PT.DAY]), y: App.valueAxis(T2, v => F.pct(v, { dec: 0 })) }, plugins: { xhair: { enabled: true, fmtY: v => F.pct(v, { dec: 1 }), fmtX: x => F.date(Math.round(x / PT.DAY)) }, tooltip: { enabled: false } } }
        });
        root.querySelectorAll('[data-pp]').forEach(b => b.addEventListener('click', () => { ui.perfPeriod = b.dataset.pp; App.render(); }));
        App.bindBenchToggles(root);
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
    return `<table class="t compact" style="margin:0 calc(-1 * var(--pad));width:calc(100% + 2 * var(--pad))"><tbody>${rows.map(([k, v, t, s]) => `<tr><td>${k} ${t ? tip(t) : ''}${s ? `<div class="xs muted" style="font-family:var(--mono)">${s}</div>` : ''}</td><td class="r">${F.seur(v)}</td></tr>`).join('')}
      ${Math.abs(a.residual) > 0.01 ? `<tr><td>Other / unexplained</td><td class="r">${F.seur(a.residual)}</td></tr>` : ''}</tbody>
      <tfoot><tr><td>Total P&L</td><td class="r">${F.seur(a.pnl)}</td></tr></tfoot></table>
      <div class="xs muted" style="margin-top:12px;font-family:var(--mono)">Reconciles to value − net invested · residual ${F.eur(a.residual)}</div>`;
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
    const html = S.n ? `
      <div class="tiles">
        <div class="tile"><div class="k">Realised P&L ${tip('realized')}</div><div class="v ${F.cls(realizedAll)}">${F.eur(realizedAll, { dec: 0, sign: true })}</div><div class="s">${F.eur(S.total, { dec: 0, sign: true })} from closed trades</div></div>
        <div class="tile"><div class="k">Round trips</div><div class="v">${S.n}</div><div class="s">${S.wins} won · ${S.losses} lost</div></div>
        <div class="tile"><div class="k">Win rate ${tip('winrate')}</div><div class="v">${F.pct(S.winRate, { sign: false, dec: 0 })}</div><div class="s">profit factor ${isFinite(S.profitFactor) ? F.num(S.profitFactor, 2) : '∞'}</div></div>
        <div class="tile"><div class="k">Avg holding ${tip('hold')}</div><div class="v">${F.dur(S.avgHold)}</div><div class="s">quantity-weighted</div></div>
        <div class="tile"><div class="k">Avg win / loss</div><div class="v"><span class="gain">${F.eur(S.avgWin, { dec: 0, sign: true })}</span> <span class="muted">/</span> <span class="loss">${F.eur(S.avgLoss, { dec: 0 })}</span></div><div class="s">after fees</div></div>
      </div>
      <div class="grid g-12">
        <div class="card c-6"><div class="card-h"><h2>Best trade</h2></div>${tripCard(S.best)}</div>
        <div class="card c-6"><div class="card-h"><h2>Worst trade</h2></div>${tripCard(S.worst)}</div>
        <div class="card c-12"><div class="card-h"><h2>Realised P&L per trade</h2><span class="sub">in order of closing date</span></div><div class="chart h-240"><canvas id="ch-trips"></canvas></div></div>
        <div class="card c-12 flush"><div class="card-h"><h2>Closed round trips</h2><span class="sub">flat → position → flat; broker transfers do not close a trade</span></div>
          <div class="table-wrap"><table class="t"><thead><tr>${th('ticker', 'Instrument')}<th>Side</th>${th('start', 'Opened')}${th('end', 'Closed')}${th('hold', 'Held', 'r')}${th('cost', 'Cost €', 'r')}${th('pnl', 'P&L €', 'r')}${th('ret', 'Return', 'r')}<th class="r">Price / FX</th><th class="r">Fees</th></tr></thead><tbody>
          ${trips.map(t => `<tr class="click" data-goto="${t.instId}"><td><span class="tk">${esc(App.instLabel(t.inst))}</span>${t.expired ? ' <span class="tag">expired</span>' : ''}<div class="nm">${esc(t.inst.type === 'option' ? t.inst.ticker : t.inst.name)}</div></td><td><span class="tag">${t.side}</span></td><td class="num">${F.date(t.startISO)}</td><td class="num">${F.date(t.endISO)}</td><td class="r">${F.dur(t.holdDays)}</td><td class="r">${F.eur(t.cost, { dec: 0 })}</td><td class="r">${F.seur(t.pnl)}</td><td class="r">${F.spct(t.ret, { dec: 1 })}</td><td class="r"><span class="${F.cls(t.pe)}">${F.eur(t.pe, { dec: 0, sign: true })}</span> · <span class="${F.cls(t.fe)}">${F.eur(t.fe, { dec: 0, sign: true })}</span></td><td class="r muted">${F.eur(t.fees)}</td></tr>`).join('')}
          </tbody></table></div></div>
        <div class="card c-12 flush"><div class="card-h"><h2>By calendar year</h2><span class="sub">realised gains/losses, income and costs in EUR — a starting point for your tax return, not tax advice</span></div>
          <div class="table-wrap"><table class="t"><thead><tr><th>Year</th><th class="r">Gains</th><th class="r">Losses</th><th class="r">Net realised</th><th class="r">Dividends (gross)</th><th class="r">Withholding tax</th><th class="r">Interest</th><th class="r">Fees</th></tr></thead><tbody>
          ${ylist.map(y => { const o = yrs[y]; return `<tr><td class="num"><b>${y}</b></td><td class="r">${F.seur(o.gains)}</td><td class="r">${F.seur(o.losses)}</td><td class="r"><b>${F.seur(o.realized)}</b></td><td class="r">${F.eur(o.divs)}</td><td class="r">${F.seur(o.tax)}</td><td class="r">${F.seur(o.interest)}</td><td class="r">${F.seur(o.fees)}</td></tr>`; }).join('')}
          </tbody></table></div></div>
      </div>` : `<div class="grid g-12"><div class="card c-12"><div class="empty-state"><div class="ico">${icon('closed')}</div><h2>No closed positions yet</h2><p>Positions appear here once their quantity returns to zero.</p></div></div></div>`;
    return {
      title: 'Closed positions', html,
      mount(root) {
        if (!S.n) return;
        const T = App.theme();
        const ordered = r.trips.slice().sort((a, b) => a.end - b.end);
        App.chart('ch-trips', {
          type: 'bar',
          data: { labels: ordered.map(t => App.instLabel(t.inst)), datasets: [{ data: ordered.map(t => t.pnl), backgroundColor: ordered.map(t => t.pnl >= 0 ? T.gain : T.loss), borderRadius: 1, borderSkipped: 'start', maxBarThickness: 22 }] },
          options: {
            scales: { x: { grid: { display: false }, border: { color: T.axis }, ticks: { color: T.muted, maxRotation: 0, autoSkip: true, font: { family: T.mono, size: 10 }, callback: function (v) { const l = this.getLabelForValue(v); return l.length > 14 ? l.slice(0, 13) + '…' : l; } } }, y: App.valueAxis(T, v => App.axisEur(v)) },
            plugins: { tooltip: Object.assign(App.tooltipStyle(T), { displayColors: false, callbacks: { title: it => { const t = ordered[it[0].dataIndex]; return `${App.instLabel(t.inst)} · closed ${F.date(t.endISO)}`; }, label: c => ` ${F.eur(c.parsed.y, { sign: true })} (${F.pct(ordered[c.dataIndex].ret, { dec: 1 })})` } }) }
          }
        });
        root.querySelectorAll('[data-csort]').forEach(t => t.addEventListener('click', () => { const k = t.dataset.csort; ui.closedSort = { k, dir: ui.closedSort.k === k ? -ui.closedSort.dir : -1 }; App.render(); }));
        root.querySelectorAll('[data-goto]').forEach(tr => tr.addEventListener('click', () => App.go('position/' + tr.dataset.goto)));
      }
    };
  };
  function tripCard(t) {
    if (!t) return '<div class="muted">—</div>';
    return `<a href="#/position/${t.instId}" style="color:inherit;text-decoration:none;display:block">
      <div class="row" style="align-items:flex-end;gap:14px"><span style="font-stretch:120%;font-weight:640;font-size:30px;letter-spacing:-0.02em;line-height:1">${esc(App.instLabel(t.inst))}</span><span class="tag">${t.side}</span>${t.expired ? '<span class="tag">expired</span>' : ''}<span class="spacer"></span><span class="bigfig ${F.cls(t.pnl)}" style="font-size:40px">${F.eur(t.pnl, { sign: true, dec: 0 })}</span></div>
      <div class="row small" style="margin-top:12px;font-family:var(--mono);color:var(--text-2)"><span>${F.date(t.startISO)} → ${F.date(t.endISO)}</span><span class="muted">· ${F.dur(t.holdDays)}</span><span class="spacer"></span><span class="${F.cls(t.ret)}">${F.pct(t.ret, { dec: 1 })}</span></div></a>`;
  }
})();
