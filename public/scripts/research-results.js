(function(){
  'use strict';

  const limitInput = document.getElementById('limitInput');
  const tbody = document.querySelector('#resultsTable tbody');
  const who5Canvas = document.getElementById('who5Chart');
  const swlsCanvas = document.getElementById('swlsChart');
  const who5VsIhsCanvas = document.getElementById('who5VsIhs');
  const swlsVsIhsCanvas = document.getElementById('swlsVsIhs');
  const statsWho5El = document.getElementById('statsWho5');
  const statsSwlsEl = document.getElementById('statsSwls');

  let who5Chart, swlsChart, who5Scatter, swlsScatter;

  function sum(arr){ return arr.reduce((a,b)=>a+(Number(b)||0),0); }

  const SCALE = {
    who5: (raw) => (Number(raw)||0) * 4,           // 0-25 -> 0-100
    swls: (raw) => (Number(raw)||0) * (5/3)        // 3-21 -> 5-35
  };

  function computeDistributions(entries){
    const who5TotalsRaw = entries.map(e => sum(e.who5||[]));
    const swlsTotalsRaw = entries.map(e => sum(e.swls||[]));
    const who5Scaled = who5TotalsRaw.map(SCALE.who5);
    const swlsScaled = swlsTotalsRaw.map(SCALE.swls);
    return { who5Scaled, swlsScaled };
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
        <td>${ihs}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  function renderCharts(entries){
    const { who5Scaled, swlsScaled } = computeDistributions(entries);
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
  }

  async function load(){
    const limit = parseInt(limitInput.value, 10) || 200;
    // By default only request entries that also have an IHS score (avoids counting refreshes before scan)
    const res = await fetch(`/api/research-results?limit=${limit}&includeNoIhs=false`);
    const json = await res.json();
    renderTable(json.entries || []);
    renderCharts(json.entries || []);

    // Comparison fetch
    const cmp = await (await fetch(`/api/research-compare?limit=${limit}`)).json();
    const cmpEntries = cmp.entries || [];
    const who5Totals = cmpEntries.map(e => SCALE.who5(sum(e.who5||[]))); // percent
    const swlsTotals = cmpEntries.map(e => SCALE.swls(sum(e.swls||[])));   // 5–35
    const ihs = cmpEntries.map(e => Number(e.ihs)||0);

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
      const pts = who5Totals.map((v,i)=>({x:v, y: ihs[i]}));
      const { slope, intercept } = ols(who5Totals, ihs);
      const xMin = Math.min(...who5Totals, 0), xMax = Math.max(...who5Totals, 100);
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
      const pts = swlsTotals.map((v,i)=>({x:v, y: ihs[i]}));
      const { slope, intercept } = ols(swlsTotals, ihs);
      const xMin = Math.min(...swlsTotals, 5), xMax = Math.max(...swlsTotals, 35);
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

    // Correlations
    const rWho5 = corr(who5Totals, ihs);
    const rSwls = corr(swlsTotals, ihs);
    const pWho5 = pValuePearson(rWho5, who5Totals.length);
    const pSwls = pValuePearson(rSwls, swlsTotals.length);
    if (statsWho5El) statsWho5El.textContent = `n=${who5Totals.length}  r(WHO‑5%, IHS)=${rWho5.toFixed(2)}  p=${pWho5===null?'—':pWho5.toExponential(2)}  slope=${ols(who5Totals, ihs).slope.toFixed(2)}  (cutoff 50 shown)`;
    if (statsSwlsEl) statsSwlsEl.textContent = `n=${swlsTotals.length}  r(SWLS[5–35], IHS)=${rSwls.toFixed(2)}  p=${pSwls===null?'—':pSwls.toExponential(2)}  slope=${ols(swlsTotals, ihs).slope.toFixed(2)}  (category lines shown)`;
  }

  limitInput.addEventListener('change', load);
  load();
})();


