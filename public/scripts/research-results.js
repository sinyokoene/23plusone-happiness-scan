(function(){
  'use strict';

  const limitInput = document.getElementById('limitInput');
  const tbody = document.querySelector('#resultsTable tbody');
  const who5Canvas = document.getElementById('who5Chart');
  const swlsCanvas = document.getElementById('swlsChart');
  const cantrilCanvas = document.getElementById('cantrilChart');
  const who5VsIhsCanvas = document.getElementById('who5VsIhs');
  const swlsVsIhsCanvas = document.getElementById('swlsVsIhs');
  const cantrilVsIhsCanvas = document.getElementById('cantrilVsIhs');
  const n123Canvas = document.getElementById('n123VsWho5');
  const statsWho5El = document.getElementById('statsWho5');
  const statsSwlsEl = document.getElementById('statsSwls');
  const domainCorrTbody = document.querySelector('#domainCorrTable tbody');
  const cardTopWhoTbody = document.querySelector('#cardTopWho tbody');
  const cardBottomWhoTbody = document.querySelector('#cardBottomWho tbody');

  let who5Chart, swlsChart, cantrilChart, who5Scatter, swlsScatter, cantrilScatter, n123Scatter;

  // Card/domain mapping for colored dots
  const domainColors = {
    'Basics': '#4CAF50',
    'Self-development': '#FF9800',
    'Ambition': '#9C27B0',
    'Vitality': '#2196F3',
    'Attraction': '#E91E63'
  };
  let cardIdToDomain = new Map();
  async function ensureCardDomains(){
    if (cardIdToDomain.size > 0) return;
    // Try /data/cards.json first, fallback to /cards.json
    const sources = ['/data/cards.json', '/cards.json'];
    for (const src of sources) {
      try {
        const r = await fetch(src, { cache: 'no-store' });
        if (!r.ok) continue;
        const cards = await r.json();
        if (Array.isArray(cards)) {
          cards.forEach(c => {
            const id = Number(c.id);
            if (Number.isFinite(id) && c.domain) {
              cardIdToDomain.set(id, c.domain);
            }
          });
          if (cardIdToDomain.size > 0) return;
        }
      } catch (_) { /* ignore and try next */ }
    }
  }

  function sum(arr){ return arr.reduce((a,b)=>a+(Number(b)||0),0); }

  const SCALE = {
    who5: (raw) => (Number(raw)||0) * 4,           // 0-25 -> 0-100
    swls: (raw) => (Number(raw)||0) * (5/3)        // 3-21 -> 5-35
  };

  function computeDistributions(entries){
    const who5TotalsRaw = entries.map(e => sum(e.who5||[]));
    const swlsTotalsRaw = entries.map(e => sum(e.swls||[]));
    const cantrilVals = entries.map(e => (e.cantril==null?null:Number(e.cantril))).filter(v=>v!=null && !Number.isNaN(v));
    const who5Scaled = who5TotalsRaw.map(SCALE.who5);
    const swlsScaled = swlsTotalsRaw.map(SCALE.swls);
    return { who5Scaled, swlsScaled, cantrilVals };
  }

  function corr(x, y){
    const n = Math.min(x.length, y.length);
    if (!n) return 0;
    const xm = x.reduce((a,b)=>a+b,0)/n;
    const ym = y.reduce((a,b)=>a+b,0)/n;
    let num = 0, dx=0, dy=0;
    for (let i=0;i<n;i++) { const xv=x[i]-xm; const yv=y[i]-ym; num += xv*yv; dx += xv*xv; dy += yv*yv; }
    return (dx && dy) ? (num/Math.sqrt(dx*dy)) : 0;
  }

  function ols(x, y){
    const n = Math.min(x.length, y.length);
    if (n < 2) return { slope: 0, intercept: 0 };
    const xm = x.reduce((a,b)=>a+b,0)/n;
    const ym = y.reduce((a,b)=>a+b,0)/n;
    let num = 0, den = 0;
    for (let i=0;i<n;i++) { const xv=x[i]-xm; num += xv*(y[i]-ym); den += xv*xv; }
    const slope = den ? num/den : 0;
    return { slope, intercept: ym - slope*xm };
  }

  function pValuePearson(r, n){
    if (typeof jStat === 'undefined' || n < 3) return null;
    const t = r * Math.sqrt((n-2)/(1-Math.min(0.999999, r*r)));
    const df = n - 2;
    const p = 2 * (1 - jStat.studentt.cdf(Math.abs(t), df));
    return p;
  }

  function renderTable(entries){
    tbody.replaceChildren();
    entries.forEach(e => {
      const tr = document.createElement('tr');
      const ihs = (e.ihs !== undefined && e.ihs !== null) ? Number(e.ihs).toFixed(1) : '';
      tr.innerHTML = `
        <td>${e.id}</td>
        <td>${new Date(e.created_at).toLocaleString()}</td>
        <td>${e.session_id}</td>
        <td>${(e.who5||[]).join(', ')}</td>
        <td>${(e.swls||[]).join(', ')}</td>
        <td>${e.cantril ?? ''}</td>
        <td>${ihs}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  function renderCharts(entries){
    const { who5Scaled, swlsScaled, cantrilVals } = computeDistributions(entries);
    // WHO-5 percent bins 0..100 step 4 (26 bins)
    const who5Bins = new Array(26).fill(0);
    const who5Labels = Array.from({length:26}, (_,i)=>i*4);
    who5Scaled.forEach(v => { const i=Math.max(0, Math.min(25, Math.round((v)/4))); who5Bins[i]++; });
    // SWLS scaled bins 5..35 (31 bins at integers)
    const swlsBins = new Array(31).fill(0);
    const swlsLabels = Array.from({length:31}, (_,i)=>i+5);
    swlsScaled.forEach(v => { const i=Math.max(0, Math.min(30, Math.round(v) - 5)); swlsBins[i]++; });

    const common = {
      type: 'bar',
      options: { responsive: true, scales: { x: { ticks: { maxRotation: 0 } }, y: { beginAtZero: true } } }
    };

    if (who5Chart) who5Chart.destroy();
    const vline = (values, color='rgba(0,0,0,.3)') => ({
      id: 'vline_'+Math.random().toString(36).slice(2,7),
      afterDraw(chart){
        const {ctx, chartArea:{top,bottom}, scales:{x}} = chart;
        ctx.save();
        ctx.strokeStyle = color; ctx.setLineDash([4,4]);
        values.forEach(val => { const xPos = x.getPixelForValue(val); ctx.beginPath(); ctx.moveTo(xPos, top); ctx.lineTo(xPos, bottom); ctx.stroke(); });
        ctx.restore();
      }
    });

    who5Chart = new Chart(who5Canvas, {
      ...common,
      data: { labels: who5Labels, datasets: [{ label: 'WHO‑5 %', data: who5Bins, backgroundColor: 'rgba(236, 72, 153, .5)' }] },
      plugins: [vline([50], 'rgba(236,72,153,.6)')]
    });

    if (swlsChart) swlsChart.destroy();
    swlsChart = new Chart(swlsCanvas, {
      ...common,
      data: { labels: swlsLabels, datasets: [{ label: 'SWLS (5–35)', data: swlsBins, backgroundColor: 'rgba(99, 102, 241, .5)' }] },
      plugins: [vline([9,14,19,20,25,30], 'rgba(99,102,241,.5)')]
    });

    // Cantril bins 0..10 (11 bins)
    if (cantrilCanvas) {
      const canBins = new Array(11).fill(0);
      const canLabels = Array.from({length:11}, (_,i)=>i);
      cantrilVals.forEach(v=>{ const i=Math.max(0,Math.min(10, Math.round(v))); canBins[i]++; });
      if (cantrilChart) cantrilChart.destroy();
      cantrilChart = new Chart(cantrilCanvas, {
        ...common,
        data: { labels: canLabels, datasets: [{ label: 'Cantril (0–10)', data: canBins, backgroundColor: 'rgba(16,185,129,.5)' }] }
      });
    }
  }

  async function load(){
    const limit = parseInt(limitInput.value, 10) || 200;
    // Fetch all research entries; we will filter for IHS only where needed (scatter/correlations)
    const res = await fetch(`/api/research-results?limit=${limit}&includeNoIhs=true`);
    const json = await res.json();
    const entries = json.entries || [];
    renderTable(entries);
    renderCharts(entries);

    // Build arrays for scatter plots from the same dataset, keeping only rows with IHS
    const who5TotalsAll = entries.map(e => SCALE.who5(sum(e.who5||[]))); // percent
    const swlsTotalsAll = entries.map(e => SCALE.swls(sum(e.swls||[]))); // 5–35
    const ihsAll = entries.map(e => (e.ihs==null?null:Number(e.ihs)));
    const cantrilAll = entries.map(e => (e.cantril==null?null:Number(e.cantril)));
    const n1All = entries.map(e => (e.n1==null?null:Number(e.n1)));
    const n2All = entries.map(e => (e.n2==null?null:Number(e.n2)));
    const n3All = entries.map(e => (e.n3==null?null:Number(e.n3)));

    const who5Pairs = who5TotalsAll.map((x,i)=>({x, y: ihsAll[i]})).filter(p=>p.y!=null && !Number.isNaN(p.y));
    const swlsPairs = swlsTotalsAll.map((x,i)=>({x, y: ihsAll[i]})).filter(p=>p.y!=null && !Number.isNaN(p.y));
    const cantrilPairs = cantrilAll.map((x,i)=>({x, y: ihsAll[i]})).filter(p=>xIsNumber(p.x) && p.y!=null && !Number.isNaN(p.y));

    function xIsNumber(v){ return v!=null && !Number.isNaN(Number(v)); }

    // Scatter charts
    const scatterCommon = {
      type: 'scatter',
      options: {
        responsive: true,
        scales: {
          x: { beginAtZero: true, title: { display: true, text: 'Questionnaire total (WHO‑5 % or SWLS 5–35)' } },
          y: { beginAtZero: true, title: { display: true, text: 'IHS (0–100)' } }
        },
        plugins: { legend: { display: true } }
      }
    };
    if (who5Scatter) who5Scatter.destroy();
    {
      const pts = who5Pairs.map(p=>({x:p.x, y:p.y}));
      const xs = who5Pairs.map(p=>p.x), ys = who5Pairs.map(p=>p.y);
      const { slope, intercept } = ols(xs, ys);
      const xMin = Math.min(...xs, 0), xMax = Math.max(...xs, 100);
      const line = [{x:xMin, y: slope*xMin+intercept}, {x:xMax, y: slope*xMax+intercept}];
      who5Scatter = new Chart(who5VsIhsCanvas, {
        ...scatterCommon,
        data: { datasets: [
          { label: 'WHO‑5% vs IHS', data: pts, backgroundColor: 'rgba(236,72,153,.5)' },
          { type: 'line', label: 'Trend', data: line, borderColor: 'rgba(236,72,153,1)', backgroundColor: 'rgba(0,0,0,0)', pointRadius: 0, borderWidth: 1 }
        ] },
        plugins: [({id:'vlineWho5', afterDraw(c){ const {ctx, chartArea:{top,bottom}, scales:{x}}=c; ctx.save(); ctx.setLineDash([4,4]); ctx.strokeStyle='rgba(236,72,153,.6)'; const xp=x.getPixelForValue(50); ctx.beginPath(); ctx.moveTo(xp, top); ctx.lineTo(xp, bottom); ctx.stroke(); ctx.restore(); }})]
      });
    }
    if (swlsScatter) swlsScatter.destroy();
    {
      const pts = swlsPairs.map(p=>({x:p.x, y:p.y}));
      const xs = swlsPairs.map(p=>p.x), ys = swlsPairs.map(p=>p.y);
      const { slope, intercept } = ols(xs, ys);
      const xMin = Math.min(...xs, 5), xMax = Math.max(...xs, 35);
      const line = [{x:xMin, y: slope*xMin+intercept}, {x:xMax, y: slope*xMax+intercept}];
      swlsScatter = new Chart(swlsVsIhsCanvas, {
        ...scatterCommon,
        data: { datasets: [
          { label: 'SWLS(5–35) vs IHS', data: pts, backgroundColor: 'rgba(99,102,241,.5)' },
          { type: 'line', label: 'Trend', data: line, borderColor: 'rgba(99,102,241,1)', backgroundColor: 'rgba(0,0,0,0)', pointRadius: 0, borderWidth: 1 }
        ] },
        plugins: [({id:'vlineSwls', afterDraw(c){ const {ctx, chartArea:{top,bottom}, scales:{x}}=c; ctx.save(); ctx.setLineDash([4,4]); ctx.strokeStyle='rgba(99,102,241,.5)'; [9,14,19,20,25,30].forEach(v=>{ const xp=x.getPixelForValue(v); ctx.beginPath(); ctx.moveTo(xp, top); ctx.lineTo(xp, bottom); ctx.stroke(); }); ctx.restore(); }})]
      });
    }

    if (cantrilScatter) cantrilScatter.destroy();
    if (cantrilVsIhsCanvas) {
      const pts = cantrilPairs.map(p=>({x:p.x, y:p.y}));
      const xs = cantrilPairs.map(p=>p.x), ys = cantrilPairs.map(p=>p.y);
      const { slope, intercept } = ols(xs, ys);
      const xMin = 0, xMax = 10;
      const line = [{x:xMin, y: slope*xMin+intercept}, {x:xMax, y: slope*xMax+intercept}];
      cantrilScatter = new Chart(cantrilVsIhsCanvas, {
        ...scatterCommon,
        data: { datasets: [
          { label: 'Cantril vs IHS', data: pts, backgroundColor: 'rgba(16,185,129,.5)' },
          { type: 'line', label: 'Trend', data: line, borderColor: 'rgba(16,185,129,1)', backgroundColor: 'rgba(0,0,0,0)', pointRadius: 0, borderWidth: 1 }
        ] }
      });
    }

    // N1/N2/N3 vs WHO-5 scatter (overlay)
    if (n123Scatter) n123Scatter.destroy();
    if (n123Canvas) {
      const mkPairs = (yArr) => who5TotalsAll.map((x,i)=>({x, y: yArr[i]})).filter(p=>xIsNumber(p.x) && xIsNumber(p.y));
      const p1 = mkPairs(n1All), p2 = mkPairs(n2All), p3 = mkPairs(n3All);
      const xs1 = p1.map(p=>p.x), ys1 = p1.map(p=>p.y);
      const xs2 = p2.map(p=>p.x), ys2 = p2.map(p=>p.y);
      const xs3 = p3.map(p=>p.x), ys3 = p3.map(p=>p.y);
      const t1 = ols(xs1, ys1), t2 = ols(xs2, ys2), t3 = ols(xs3, ys3);
      const r1 = xs1.length ? corr(xs1, ys1) : 0;
      const r2 = xs2.length ? corr(xs2, ys2) : 0;
      const r3 = xs3.length ? corr(xs3, ys3) : 0;
      const xMin = 0, xMax = 100;
      const line1 = [{x:xMin, y: t1.slope*xMin+t1.intercept}, {x:xMax, y: t1.slope*xMax+t1.intercept}];
      const line2 = [{x:xMin, y: t2.slope*xMin+t2.intercept}, {x:xMax, y: t2.slope*xMax+t2.intercept}];
      const line3 = [{x:xMin, y: t3.slope*xMin+t3.intercept}, {x:xMax, y: t3.slope*xMax+t3.intercept}];
      n123Scatter = new Chart(n123Canvas, {
        ...scatterCommon,
        data: { datasets: [
          { label: `N1 vs WHO‑5 (r=${r1.toFixed(2)})`, data: p1, backgroundColor: 'rgba(99,102,241,.5)' },
          { type: 'line', label: 'N1 trend', data: line1, borderColor: 'rgba(99,102,241,1)', backgroundColor: 'rgba(0,0,0,0)', pointRadius: 0, borderWidth: 1 },
          { label: `N2 vs WHO‑5 (r=${r2.toFixed(2)})`, data: p2, backgroundColor: 'rgba(16,185,129,.5)' },
          { type: 'line', label: 'N2 trend', data: line2, borderColor: 'rgba(16,185,129,1)', backgroundColor: 'rgba(0,0,0,0)', pointRadius: 0, borderWidth: 1 },
          { label: `N3 vs WHO‑5 (r=${r3.toFixed(2)})`, data: p3, backgroundColor: 'rgba(236,72,153,.4)' },
          { type: 'line', label: 'N3 trend', data: line3, borderColor: 'rgba(236,72,153,1)', backgroundColor: 'rgba(0,0,0,0)', pointRadius: 0, borderWidth: 1 }
        ] }
      });
    }

    // Correlations
    const xsWho5 = who5Pairs.map(p=>p.x), ysWho5 = who5Pairs.map(p=>p.y);
    const xsSwls = swlsPairs.map(p=>p.x), ysSwls = swlsPairs.map(p=>p.y);
    const xsCan = cantrilPairs.map(p=>p.x), ysCan = cantrilPairs.map(p=>p.y);
    const rWho5 = xsWho5.length ? corr(xsWho5, ysWho5) : 0;
    const rSwls = xsSwls.length ? corr(xsSwls, ysSwls) : 0;
    const rCan = xsCan.length ? corr(xsCan, ysCan) : 0;
    const pWho5 = pValuePearson(rWho5, xsWho5.length);
    const pSwls = pValuePearson(rSwls, xsSwls.length);
    const pCan = xsCan.length ? pValuePearson(rCan, xsCan.length) : null;
    if (statsWho5El) statsWho5El.textContent = `n=${xsWho5.length}  r(WHO‑5%, IHS)=${rWho5.toFixed(2)}  p=${pWho5===null?'—':pWho5.toExponential(2)}  slope=${ols(xsWho5, ysWho5).slope.toFixed(2)}  (cutoff 50 shown)`;
    if (statsSwlsEl) statsSwlsEl.textContent = `n=${xsSwls.length}  r(SWLS[5–35], IHS)=${rSwls.toFixed(2)}  p=${pSwls===null?'—':pSwls.toExponential(2)}  slope=${ols(xsSwls, ysSwls).slope.toFixed(2)}  (category lines shown)  |  n_can=${xsCan.length} r(Cantril, IHS)=${rCan.toFixed(2)} ${pCan===null?'':`p=${pCan.toExponential(2)}`}`;

    // Fetch server-side correlations for domains and cards
    try {
      await ensureCardDomains();
      const corrRes = await fetch(`/api/analytics/correlations?limit=${limit}`);
      const corrJson = await corrRes.json();
      const domains = corrJson.domains || [];
      const cards = corrJson.cards || [];

      // Domain table
      if (domainCorrTbody) {
        domainCorrTbody.replaceChildren();
        domains.forEach(d => {
          const tr = document.createElement('tr');
          tr.innerHTML = `
            <td>${d.domain}</td>
            <td>${Number(d.r_affirm_who5||0).toFixed(2)}</td>
            <td>${Number(d.r_affirm_swls||0).toFixed(2)}</td>
            <td>${Number(d.r_yesrate_who5||0).toFixed(2)}</td>
            <td>${Number(d.r_yesrate_swls||0).toFixed(2)}</td>
            <td>${Math.max(d.n_affirm_who5||0, d.n_yesrate_who5||0)}</td>
          `;
          domainCorrTbody.appendChild(tr);
        });
      }

      // Card top/bottom by r_yes_who5
      const sorted = cards.slice().sort((a,b)=> (b.r_yes_who5||0) - (a.r_yes_who5||0));
      const top = sorted.slice(0, 10);
      const bottom = sorted.slice(-10);
      function renderCardRows(tbody, rows){
        if (!tbody) return;
        tbody.replaceChildren();
        rows.forEach(c => {
          const tr = document.createElement('tr');
          const domain = cardIdToDomain.get(Number(c.cardId)) || '';
          const color = domainColors[domain] || '#9ca3af';
          const dot = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:6px;vertical-align:middle;"></span>`;
          const name = c.label ? `${c.cardId} · ${c.label}` : c.cardId;
          tr.innerHTML = `<td>${dot}${name}</td><td>${Number(c.r_yes_who5||0).toFixed(2)}</td><td>${c.n_yes_who5||0}</td>`;
          tbody.appendChild(tr);
        });
      }
      renderCardRows(cardTopWhoTbody, top);
      renderCardRows(cardBottomWhoTbody, bottom);
    } catch (e) {
      // Non-fatal if analytics endpoint is unavailable
      console.warn('Correlation analytics failed', e);
    }
  }

  limitInput.addEventListener('change', load);
  load();
})();


