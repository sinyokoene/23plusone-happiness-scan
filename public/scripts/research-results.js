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
  const statsWho5El = document.getElementById('statsWho5');
  const statsSwlsEl = document.getElementById('statsSwls');

  let who5Chart, swlsChart, cantrilChart, who5Scatter, swlsScatter, cantrilScatter;

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
  }

  limitInput.addEventListener('change', load);
  load();
})();


