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

  function computeDistributions(entries){
    const who5Totals = entries.map(e => sum(e.who5||[]));
    const swlsTotals = entries.map(e => sum(e.swls||[]));
    return { who5Totals, swlsTotals };
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

  function renderTable(entries){
    tbody.replaceChildren();
    entries.forEach(e => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${e.id}</td>
        <td>${new Date(e.created_at).toLocaleString()}</td>
        <td>${e.session_id}</td>
        <td>${(e.who5||[]).join(', ')}</td>
        <td>${(e.swls||[]).join(', ')}</td>
        <td style="max-width:380px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${e.user_agent||''}">${e.user_agent||''}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  function renderCharts(entries){
    const { who5Totals, swlsTotals } = computeDistributions(entries);
    const who5Bins = new Array(31).fill(0); // WHO‑5 max 25, leave headroom
    const swlsBins = new Array(31).fill(0); // SWLS max 21
    who5Totals.forEach(v => { const i=Math.max(0,Math.min(30, v)); who5Bins[i]++; });
    swlsTotals.forEach(v => { const i=Math.max(0,Math.min(30, v)); swlsBins[i]++; });

    // Prepare labels 0..30
    const labels = [...Array(31).keys()];

    const common = {
      type: 'bar',
      options: { responsive: true, scales: { x: { ticks: { maxRotation: 0 } }, y: { beginAtZero: true } } }
    };

    if (who5Chart) who5Chart.destroy();
    who5Chart = new Chart(who5Canvas, {
      ...common,
      data: { labels, datasets: [{ label: 'WHO‑5 total', data: who5Bins, backgroundColor: 'rgba(236, 72, 153, .5)' }] }
    });

    if (swlsChart) swlsChart.destroy();
    swlsChart = new Chart(swlsCanvas, {
      ...common,
      data: { labels, datasets: [{ label: 'SWLS total', data: swlsBins, backgroundColor: 'rgba(99, 102, 241, .5)' }] }
    });
  }

  async function load(){
    const limit = parseInt(limitInput.value, 10) || 200;
    const res = await fetch(`/api/research-results?limit=${limit}`);
    const json = await res.json();
    renderTable(json.entries || []);
    renderCharts(json.entries || []);

    // Comparison fetch
    const cmp = await (await fetch(`/api/research-compare?limit=${limit}`)).json();
    const cmpEntries = cmp.entries || [];
    const who5Totals = cmpEntries.map(e => sum(e.who5||[]));
    const swlsTotals = cmpEntries.map(e => sum(e.swls||[]));
    const ihs = cmpEntries.map(e => Number(e.ihs)||0);

    // Scatter charts
    const scatterCommon = {
      type: 'scatter', options: { responsive: true, scales: { x: { beginAtZero: true }, y: { beginAtZero: true } } }
    };
    if (who5Scatter) who5Scatter.destroy();
    who5Scatter = new Chart(who5VsIhsCanvas, {
      ...scatterCommon,
      data: { datasets: [{ label: 'WHO‑5 vs IHS', data: who5Totals.map((v,i)=>({x:v, y: ihs[i]})), backgroundColor: 'rgba(236,72,153,.5)' }] }
    });
    if (swlsScatter) swlsScatter.destroy();
    swlsScatter = new Chart(swlsVsIhsCanvas, {
      ...scatterCommon,
      data: { datasets: [{ label: 'SWLS vs IHS', data: swlsTotals.map((v,i)=>({x:v, y: ihs[i]})), backgroundColor: 'rgba(99,102,241,.5)' }] }
    });

    // Correlations
    const rWho5 = corr(who5Totals, ihs);
    const rSwls = corr(swlsTotals, ihs);
    if (statsWho5El) statsWho5El.textContent = `n=${who5Totals.length}  r(WHO‑5, IHS)=${rWho5.toFixed(2)}`;
    if (statsSwlsEl) statsSwlsEl.textContent = `n=${swlsTotals.length}  r(SWLS, IHS)=${rSwls.toFixed(2)}`;
  }

  limitInput.addEventListener('change', load);
  load();
})();


