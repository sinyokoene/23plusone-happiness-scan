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
  const n123MetricSel = document.getElementById('n123Metric');
  const n123MetricLabel = document.getElementById('n123MetricLabel');
  const statsWho5El = document.getElementById('statsWho5');
  const statsSwlsEl = document.getElementById('statsSwls');
  const overallCorrTbody = document.querySelector('#overallCorrTable tbody');
  const domainCorrTbody = document.querySelector('#domainCorrTable tbody');
  const cardTopWhoTbody = document.querySelector('#cardTopWho tbody');
  const cardBottomWhoTbody = document.querySelector('#cardBottomWho tbody');
  const cardYesRankingTbody = document.querySelector('#cardYesRankingTable tbody');
  const filterDevice = document.getElementById('filterDevice');
  const filterSex = document.getElementById('filterSex');
  const filterCountry = document.getElementById('filterCountry');
  const excludeCountries = document.getElementById('excludeCountries');
  const excludeCountEl = document.getElementById('excludeCount');
  const includeCountEl = document.getElementById('includeCount');
  const includeList = document.getElementById('includeList');
  const excludeList = document.getElementById('excludeList');
  const includeSearch = document.getElementById('includeSearch');
  const excludeSearch = document.getElementById('excludeSearch');
  const includeDropdown = document.getElementById('includeDropdown');
  const excludeDropdown = document.getElementById('excludeDropdown');
  const filterAgeMin = document.getElementById('filterAgeMin');
  const filterAgeMax = document.getElementById('filterAgeMax');
  const modClick = document.getElementById('modClick');
  const modSwipe = document.getElementById('modSwipe');
  const modArrow = document.getElementById('modArrow');
  const filterExclusive = document.getElementById('filterExclusive');
  const filterNoTimeouts = document.getElementById('filterNoTimeouts');
  const filterIat = document.getElementById('filterIat');
  const filterSensitivity = document.getElementById('filterSensitivity');
  const filterThreshold = document.getElementById('filterThreshold');
  const applyFiltersBtn = document.getElementById('applyFilters');
  const cardCorrMetric = document.getElementById('cardCorrMetric');
  const cardTimeSelector = document.getElementById('cardTimeSelector');
  const cardTimeCanvas = document.getElementById('cardTimeChart');
  const who5ScaleSel = document.getElementById('who5Scale');
  const swlsScaleSel = document.getElementById('swlsScale');
  const who5NEl = document.getElementById('who5N');
  const swlsNEl = document.getElementById('swlsN');
  const ihsNEl = document.getElementById('ihsN');
  const cantrilNEl = document.getElementById('cantrilN');

  let who5Chart, swlsChart, cantrilChart, ihsChart, who5Scatter, swlsScatter, cantrilScatter, n123Scatter;
  let cardTimeChart;
  let currentEntries = [];

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
    who5Percent: (raw) => (Number(raw)||0) * 4,    // 0-25 -> 0-100
    who5Raw: (raw) => (Number(raw)||0),            // 0-25
    swls: (raw) => (Number(raw)||0) * (5/3)        // 3-21 -> 5-35
  };

  function computeDistributions(entries){
    const who5TotalsRaw = entries.map(e => sum(e.who5||[]));
    const swlsTotalsRaw = entries.map(e => sum(e.swls||[]));
    const cantrilVals = entries.map(e => (e.cantril==null?null:Number(e.cantril))).filter(v=>v!=null && !Number.isNaN(v));
    const usePercent = (who5ScaleSel && who5ScaleSel.value === 'percent');
    const who5Scaled = who5TotalsRaw.map(usePercent ? SCALE.who5Percent : SCALE.who5Raw);
    // SWLS: either raw 3–21 or rescaled 5–35
    const swlsScaled = swlsTotalsRaw.map(v => {
      if (swlsScaleSel && swlsScaleSel.value === '21') return Number(v)||0; // raw total 3–21
      return SCALE.swls(v); // 5–35
    });
    return { who5Scaled, swlsScaled, cantrilVals, usePercent };
  }

  // Compute per-card correlation between Cantril (0–10) and binary Yes (1) / No (0)
  function computeCardYesVsCantril(entries){
    const acc = new Map(); // cardId -> { yes:[], can:[] }
    entries.forEach(e => {
      const can = (e.cantril==null?null:Number(e.cantril));
      if (can==null || Number.isNaN(can)) return;
      const sel = e.selections && e.selections.allResponses;
      if (!Array.isArray(sel)) return;
      sel.forEach(r => {
        const cid = Number(r && r.cardId);
        if (!Number.isFinite(cid)) return;
        if (r && (r.response === true || r.response === false)){
          let slot = acc.get(cid);
          if (!slot){ slot = { yes: [], can: [] }; acc.set(cid, slot); }
          slot.yes.push(r.response === true ? 1 : 0);
          slot.can.push(can);
        }
      });
    });
    const out = new Map();
    acc.forEach((v, cid) => {
      const n = Math.min(v.yes.length, v.can.length);
      if (n >= 3){
        const r = corr(v.yes, v.can);
        out.set(cid, { r, n });
      }
    });
    return out;
  }

  // Compute per-card correlation between Cantril and time-weighted affirmation (positive Yes strength)
  function computeCardAffirmVsCantril(entries){
    const acc = new Map(); // cardId -> { affirm:[], can:[] }
    const timeMultiplier = (ms) => { const t = Math.max(0, Math.min(4000, Number(ms)||0)); const lin=(4000 - t)/4000; return Math.sqrt(Math.max(0, lin)); };
    entries.forEach(e => {
      const can = (e.cantril==null?null:Number(e.cantril));
      if (can==null || Number.isNaN(can)) return;
      const sel = e.selections && e.selections.allResponses;
      if (!Array.isArray(sel)) return;
      sel.forEach(r => {
        const cid = Number(r && r.cardId);
        if (!Number.isFinite(cid)) return;
        let slot = acc.get(cid); if (!slot){ slot = { affirm: [], can: [] }; acc.set(cid, slot); }
        // Only count positive Yes strength; No/timeout contribute 0
        const isYes = r && r.response === true;
        const aff = isYes ? (4 * timeMultiplier(r && r.responseTime)) : 0;
        slot.affirm.push(aff);
        slot.can.push(can);
      });
    });
    const out = new Map();
    acc.forEach((v, cid) => {
      const n = Math.min(v.affirm.length, v.can.length);
      if (n >= 3){
        const r = corr(v.affirm, v.can);
        out.set(cid, { r, n });
      }
    });
    return out;
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
      const timeSec = (e.completion_time==null? (e.selections && Array.isArray(e.selections.allResponses) ? Math.round((e.selections.allResponses.reduce((s,r)=>s+(Number(r&&r.responseTime)||0),0))/1000) : '') : Number(e.completion_time));
      const selected = (e.selections && Array.isArray(e.selections.allResponses)) ? e.selections.allResponses.filter(r=>r && r.response===true).length : (e.selected_count || '');
      const rejected = (e.selections && Array.isArray(e.selections.allResponses)) ? e.selections.allResponses.filter(r=>r && r.response===false).length : (e.rejected_count || '');
      const timeouts = (e.selections && Array.isArray(e.selections.allResponses)) ? e.selections.allResponses.filter(r=>r && r.response===null).length : '';
      tr.innerHTML = `
        <td>${e.id}</td>
        <td>${new Date(e.created_at).toLocaleString()}</td>
        <td>${e.session_id}</td>
        <td>${e.prolific_pid || ''}</td>
        <td>${e.prolific_study_id || ''}</td>
        <td>${e.prolific_session_id || ''}</td>
        <td>${e.demo_sex || ''}</td>
        <td>${e.demo_age == null ? '' : e.demo_age}</td>
        <td>${e.demo_country || ''}</td>
        <td>${deviceLabel(e)}</td>
        <td>${timeSec}</td>
        <td>${selected}</td>
        <td>${rejected}</td>
        <td>${timeouts}</td>
        <td>${(e.who5||[]).join(', ')}</td>
        <td>${(e.swls||[]).join(', ')}</td>
        <td>${e.cantril ?? ''}</td>
        <td>${ihs}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  function renderCharts(entries){
    const { who5Scaled, swlsScaled, cantrilVals, usePercent } = computeDistributions(entries);
    const ihsVals = entries.map(e => (e.ihs==null?null:Number(e.ihs))).filter(v=>v!=null && !Number.isNaN(v));
    // WHO‑5 bins: percent (0..100 step 4) or raw (0..25 step 1)
    let who5Bins, who5Labels;
    if (usePercent) {
      who5Bins = new Array(26).fill(0);
      who5Labels = Array.from({length:26}, (_,i)=>i*4);
      who5Scaled.forEach(v => { const idx = Math.max(0, Math.min(25, Math.round(v/4))); who5Bins[idx]++; });
    } else {
      who5Bins = new Array(26).fill(0);
      who5Labels = Array.from({length:26}, (_,i)=>i);
      who5Scaled.forEach(v => { const idx = Math.max(0, Math.min(25, Math.round(v))); who5Bins[idx]++; });
    }
    // SWLS bins: 5..35 or 3..21
    const useSwls35 = !(swlsScaleSel && swlsScaleSel.value === '21');
    let swlsBins, swlsLabels;
    if (useSwls35) {
      swlsBins = new Array(31).fill(0);
      swlsLabels = Array.from({length:31}, (_,i)=>i+5);
      swlsScaled.forEach(v => { const idx = Math.max(0, Math.min(30, Math.round(v) - 5)); swlsBins[idx]++; });
    } else {
      swlsBins = new Array(19).fill(0);
      swlsLabels = Array.from({length:19}, (_,i)=>i+3);
      swlsScaled.forEach(v => { const idx = Math.max(0, Math.min(18, Math.round(v) - 3)); swlsBins[idx]++; });
    }

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
      data: { labels: who5Labels, datasets: [{ label: (who5ScaleSel && who5ScaleSel.value === 'percent') ? 'WHO‑5 %' : 'WHO‑5 (raw 0–25)', data: who5Bins, backgroundColor: 'rgba(236, 72, 153, .5)' }] },
      plugins: [vline((who5ScaleSel && who5ScaleSel.value === 'percent') ? [50] : [], 'rgba(236,72,153,.6)')]
    });
    if (who5NEl) who5NEl.textContent = `N = ${who5Scaled.length}`;

    if (swlsChart) swlsChart.destroy();
    swlsChart = new Chart(swlsCanvas, {
      ...common,
      data: { labels: swlsLabels, datasets: [{ label: 'SWLS (5–35)', data: swlsBins, backgroundColor: 'rgba(99, 102, 241, .5)' }] },
      plugins: [vline([], 'rgba(99,102,241,.5)')]
    });
    if (swlsNEl) swlsNEl.textContent = `N = ${swlsScaled.length}`;

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
      if (cantrilNEl) cantrilNEl.textContent = `N = ${cantrilVals.length}`;
    }

    // IHS distribution 0..100 step 5 (21 bins)
    const ihsCanvas = document.getElementById('ihsChart');
    if (ihsCanvas) {
      const binSize = 5;
      const bins = new Array(21).fill(0);
      const labels = Array.from({length:21}, (_,i)=>i*binSize);
      ihsVals.forEach(v => { const i = Math.max(0, Math.min(20, Math.round(v/binSize))); bins[i]++; });
      if (ihsChart) ihsChart.destroy();
      ihsChart = new Chart(ihsCanvas, {
        type: 'bar',
        data: { labels, datasets: [{ label: 'IHS (0–100)', data: bins, backgroundColor: 'rgba(59,130,246,.5)' }] },
        options: { responsive: true, scales: { x: { ticks: { maxRotation: 0 } }, y: { beginAtZero: true } } }
      });
      if (ihsNEl) ihsNEl.textContent = `N = ${ihsVals.length}`;
    }
  }

  function isMobileUA(ua){
    if (!ua || typeof ua !== 'string') return false;
    return /(Mobi|Android|iPhone|iPad|iPod)/i.test(ua);
  }
  function deviceLabel(entry){
    const ua = entry.scan_user_agent || entry.user_agent || '';
    return isMobileUA(ua) ? 'Mobile' : 'Desktop';
  }

  function entryMatchesFilters(entry){
    const wantDevice = (filterDevice && filterDevice.value) || '';
    const wantMods = [
      modClick && modClick.checked ? 'click' : null,
      modSwipe && modSwipe.checked ? 'swipe' : null,
      modArrow && modArrow.checked ? 'arrow' : null
    ].filter(Boolean);
    const exclusiveOnly = !!(filterExclusive && filterExclusive.checked);
    const noTimeoutsOnly = !!(filterNoTimeouts && filterNoTimeouts.checked);
    const iatOnly = !!(filterIat && filterIat.checked);
    const sensitivityAllMax = !!(filterSensitivity && filterSensitivity.checked);
    const thresholdPct = Number(filterThreshold && filterThreshold.value ? filterThreshold.value : NaN);

    if (!wantDevice && wantMods.length === 0 && !exclusiveOnly && !noTimeoutsOnly && !iatOnly && !sensitivityAllMax && (Number.isNaN(thresholdPct))) return true;
    // device by user agents: prefer scan_user_agent (from scan), fallback to research user_agent
    const ua = entry.scan_user_agent || entry.user_agent || '';
    if (wantDevice === 'mobile' && !isMobileUA(ua)) return false;
    if (wantDevice === 'desktop' && isMobileUA(ua)) return false;

    const sel = entry.selections && entry.selections.allResponses;
    if ((wantMods.length > 0 || exclusiveOnly || noTimeoutsOnly || iatOnly || sensitivityAllMax || !Number.isNaN(thresholdPct)) && !Array.isArray(sel)) return false;

    if (Array.isArray(sel)) {
      const counts = sel.reduce((acc, r) => {
        const v = String(r && r.inputModality || '').toLowerCase();
        if (v === 'click') acc.click++;
        else if (v === 'keyboard-arrow') acc.arrow++;
        else if (v === 'swipe-touch' || v === 'swipe-mouse') acc.swipe++;
        else acc.other++;
        acc.total++;
        return acc;
      }, { click:0, swipe:0, arrow:0, other:0, total:0 });

      if (exclusiveOnly) {
        // Exactly one modality present among selected types, and zero of the others
        const present = {
          click: counts.click > 0,
          swipe: counts.swipe > 0,
          arrow: counts.arrow > 0
        };
        const selectedSet = new Set(wantMods);
        // If no modality selected, exclusivity means single-modality of any type
        const modalitiesPresent = Object.entries(present).filter(([k,v])=>v).map(([k])=>k);
        if (wantMods.length === 0) {
          if (modalitiesPresent.length !== 1) return false;
        } else {
          // Must be subset of selected and no others present
          if (modalitiesPresent.length !== 1) return false;
          if (!selectedSet.has(modalitiesPresent[0])) return false;
        }
      }

      if (noTimeoutsOnly) {
        const hasTimeout = sel.some(r => r && r.response === null);
        if (hasTimeout) return false;
      }

      if (iatOnly) {
        const total = sel.length;
        if (total < 24) return false;
        let invalid = 0;
        for (const r of sel) {
          if (!r) { invalid++; continue; }
          if (r.response === null) { invalid++; continue; }
          const t = Number(r.responseTime);
          if (!Number.isFinite(t)) { invalid++; continue; }
          if (!(t > 300 && t < 2000)) invalid++;
        }
        const fracInvalid = total > 0 ? (invalid / total) : 1;
        if (fracInvalid > 0.10) return false;
      }

      if (sensitivityAllMax) {
        // Exclude if WHO‑5 max (25), SWLS max (21), or Cantril max (10)
        const who5Total = sum(entry.who5 || []);
        const swlsTotal = sum(entry.swls || []);
        const can = (entry.cantril==null?null:Number(entry.cantril));
        if (who5Total >= 25 || swlsTotal >= 21 || (can != null && can >= 10)) return false;
      }

      if (!Number.isNaN(thresholdPct) && counts.total > 0) {
        const thresholds = [];
        if (wantMods.length === 0) {
          thresholds.push(counts.click / counts.total, counts.swipe / counts.total, counts.arrow / counts.total);
        } else {
          if (wantMods.includes('click')) thresholds.push(counts.click / counts.total);
          if (wantMods.includes('swipe')) thresholds.push(counts.swipe / counts.total);
          if (wantMods.includes('arrow')) thresholds.push(counts.arrow / counts.total);
        }
        const pass = thresholds.some(frac => (frac * 100) >= thresholdPct);
        if (!pass) return false;
      }

      if (wantMods.length > 0) {
        const anyMatch = (
          (wantMods.includes('click') && counts.click > 0) ||
          (wantMods.includes('swipe') && counts.swipe > 0) ||
          (wantMods.includes('arrow') && counts.arrow > 0)
        );
        if (!anyMatch) return false;
      }
    }
    return true;
  }

  async function load(){
    const limit = parseInt(limitInput.value, 10) || 1500;
    // Fetch entries with scan details for filtering (device/modality)
    const params = new URLSearchParams({ limit: String(limit), includeNoIhs: 'false', includeScanDetails: 'true' });
    if (filterSex && filterSex.value) params.set('sex', filterSex.value);
    if (filterCountry && filterCountry.selectedOptions && filterCountry.selectedOptions.length > 0) {
      const inc = Array.from(filterCountry.selectedOptions).map(o=>o.value).filter(Boolean);
      if (inc.length === 1) params.set('country', inc[0]);
      if (inc.length > 1) params.set('countries', inc.join(','));
      if (includeCountEl) includeCountEl.textContent = inc.length ? `(${inc.length} selected)` : '';
    } else if (includeCountEl) {
      includeCountEl.textContent = '';
    }
    if (excludeCountries && excludeCountries.selectedOptions && excludeCountries.selectedOptions.length > 0) {
      const ex = Array.from(excludeCountries.selectedOptions).map(o=>o.value).filter(Boolean);
      if (ex.length) params.set('excludeCountries', ex.join(','));
      if (excludeCountEl) excludeCountEl.textContent = `(${ex.length} selected)`;
    } else {
      if (excludeCountEl) excludeCountEl.textContent = '';
    }
    if (filterAgeMin && filterAgeMin.value) params.set('ageMin', filterAgeMin.value);
    if (filterAgeMax && filterAgeMax.value) params.set('ageMax', filterAgeMax.value);
    const res = await fetch(`/api/research-results?${params.toString()}`);
    const json = await res.json();
    let entries = json.entries || [];
    // Populate country dropdown from returned entries (distinct, sorted)
    if ((filterCountry && filterCountry.tagName === 'SELECT') || (excludeCountries && excludeCountries.tagName === 'SELECT')) {
      const set = new Map(); // country -> count
      entries.forEach(e => {
        const c = (e.demo_country || '').trim();
        if (!c) return; set.set(c, (set.get(c)||0)+1);
      });
      const arr = Array.from(set.entries()).sort((a,b)=> a[0].localeCompare(b[0]));
      // Rebuild options each load to keep counts accurate
      const prevInc = new Set(Array.from(filterCountry.selectedOptions || []).map(o=>o.value));
      filterCountry.innerHTML = '';
      const any = document.createElement('option'); any.value = ''; any.textContent = 'Any'; filterCountry.appendChild(any);
      arr.forEach(([name, count]) => {
        const opt = document.createElement('option');
        opt.value = name; opt.textContent = `${name} (${count})`;
        if (prevInc.has(name)) opt.selected = true;
        filterCountry.appendChild(opt);
      });
      // Build include checkbox dropdown list (with search)
      if (includeList) {
        const prevSet = new Set(Array.from(filterCountry.selectedOptions || []).map(o=>o.value));
        const renderInclude = (source) => {
          includeList.innerHTML = '';
          source.forEach(([name, count]) => {
            const id = 'inc_' + name.replace(/\W+/g,'_');
            const wrapper = document.createElement('label');
            wrapper.className = 'menu-item';
            const cb = document.createElement('input');
            cb.type = 'checkbox'; cb.id = id; cb.value = name; cb.checked = prevSet.has(name);
            cb.addEventListener('change', () => {
              // sync to hidden select
              const opt = Array.from(filterCountry.options).find(o=>o.value===name);
              if (opt) opt.selected = cb.checked;
              if (includeCountEl) {
                const inc = Array.from(filterCountry.selectedOptions || []).map(o=>o.value).filter(Boolean);
                includeCountEl.textContent = inc.length ? `(${inc.length} selected)` : '';
              }
              load();
            });
            const span = document.createElement('span');
            span.textContent = `${name} (${count})`;
            wrapper.appendChild(cb); wrapper.appendChild(span);
            includeList.appendChild(wrapper);
          });
        };
        renderInclude(arr);
        if (includeSearch) {
          includeSearch.oninput = () => {
            const q = includeSearch.value.trim().toLowerCase();
            if (!q) { renderInclude(arr); return; }
            renderInclude(arr.filter(([n]) => n.toLowerCase().includes(q)));
          };
        }
        if (includeCountEl) {
          const inc = Array.from(filterCountry.selectedOptions || []).map(o=>o.value).filter(Boolean);
          includeCountEl.textContent = inc.length ? `(${inc.length} selected)` : '';
        }
      }
      // Populate exclude multi-select
      if (excludeCountries) {
        const prevEx = new Set(Array.from(excludeCountries.selectedOptions).map(o=>o.value));
        excludeCountries.innerHTML = '';
        arr.forEach(([name, count]) => {
          const opt = document.createElement('option');
          opt.value = name; opt.textContent = `${name} (${count})`;
          excludeCountries.appendChild(opt);
          if (prevEx.has(name)) opt.selected = true;
        });
        const current = Array.from(excludeCountries.selectedOptions).length;
        if (excludeCountEl) excludeCountEl.textContent = current ? `(${current} selected)` : '';
        // Build exclude checkbox dropdown list (with search)
        if (excludeList) {
          const renderExclude = (source) => {
            excludeList.innerHTML = '';
            source.forEach(([name, count]) => {
              const id = 'exc_' + name.replace(/\W+/g,'_');
              const wrapper = document.createElement('label');
              wrapper.className = 'menu-item';
              const cb = document.createElement('input');
              cb.type = 'checkbox'; cb.id = id; cb.value = name; cb.checked = prevEx.has(name);
              cb.addEventListener('change', () => {
                const opt = Array.from(excludeCountries.options).find(o=>o.value===name);
                if (opt) opt.selected = cb.checked;
                const ex = Array.from(excludeCountries.selectedOptions).map(o=>o.value).filter(Boolean);
                if (excludeCountEl) excludeCountEl.textContent = ex.length ? `(${ex.length} selected)` : '';
                load();
              });
              const span = document.createElement('span');
              span.textContent = `${name} (${count})`;
              wrapper.appendChild(cb); wrapper.appendChild(span);
              excludeList.appendChild(wrapper);
            });
          };
          renderExclude(arr);
          if (excludeSearch) {
            excludeSearch.oninput = () => {
              const q = excludeSearch.value.trim().toLowerCase();
              if (!q) { renderExclude(arr); return; }
              renderExclude(arr.filter(([n]) => n.toLowerCase().includes(q)));
            };
          }
        }
      }
    }
    // Apply client-side filters (device, modality, exclusivity, threshold)
    entries = entries.filter(entryMatchesFilters);
    currentEntries = entries.slice();
    renderTable(currentEntries);
    renderCharts(currentEntries);

    // Build card selector options once we have entries and mapping
    await ensureCardDomains();
    if (cardTimeSelector && cardTimeSelector.options.length === 0) {
      // Derive card list from data (with labels if present)
      const cardLabels = new Map();
      currentEntries.forEach(e => {
        const sel = e && e.selections && e.selections.allResponses;
        if (!Array.isArray(sel)) return;
        sel.forEach(r => {
          const cid = Number(r && r.cardId);
          if (!Number.isFinite(cid)) return;
          if (!cardLabels.has(cid)) cardLabels.set(cid, r && r.label ? r.label : '');
        });
      });
      const sorted = Array.from(cardLabels.entries()).sort((a,b)=>a[0]-b[0]);
      cardTimeSelector.innerHTML = '';
      sorted.forEach(([cid, label]) => {
        const opt = document.createElement('option');
        opt.value = String(cid);
        opt.textContent = label ? `${cid} · ${label}` : String(cid);
        cardTimeSelector.appendChild(opt);
      });
    }
    renderCardTimeHistogram();

    // Build arrays for scatter plots from the same dataset, keeping only rows with IHS
    const who5TotalsAll = entries.map(e => (who5ScaleSel && who5ScaleSel.value === 'percent') ? SCALE.who5Percent(sum(e.who5||[])) : SCALE.who5Raw(sum(e.who5||[])));
    const swlsTotalsAll = entries.map(e => (swlsScaleSel && swlsScaleSel.value === '21') ? (sum(e.swls||[])) : SCALE.swls(sum(e.swls||[])));
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
          x: { beginAtZero: true, title: { display: true, text: 'Questionnaire total' } },
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
      const xMin = (who5ScaleSel && who5ScaleSel.value === 'percent') ? Math.min(...xs, 0) : Math.min(...xs, 0);
      const xMax = (who5ScaleSel && who5ScaleSel.value === 'percent') ? Math.max(...xs, 100) : Math.max(...xs, 25);
      const line = [{x:xMin, y: slope*xMin+intercept}, {x:xMax, y: slope*xMax+intercept}];
      who5Scatter = new Chart(who5VsIhsCanvas, {
        ...scatterCommon,
        data: { datasets: [
          { label: (who5ScaleSel && who5ScaleSel.value === 'percent') ? 'WHO‑5% vs IHS' : 'WHO‑5 (raw) vs IHS', data: pts, backgroundColor: 'rgba(236,72,153,.5)' },
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
      const swls21 = (swlsScaleSel && swlsScaleSel.value === '21');
      const xMin = swls21 ? Math.min(...xs, 3) : Math.min(...xs, 5);
      const xMax = swls21 ? Math.max(...xs, 21) : Math.max(...xs, 35);
      const line = [{x:xMin, y: slope*xMin+intercept}, {x:xMax, y: slope*xMax+intercept}];
      swlsScatter = new Chart(swlsVsIhsCanvas, {
        ...scatterCommon,
        data: { datasets: [
          { label: swls21 ? 'SWLS(3–21) vs IHS' : 'SWLS(5–35) vs IHS', data: pts, backgroundColor: 'rgba(99,102,241,.5)' },
          { type: 'line', label: 'Trend', data: line, borderColor: 'rgba(99,102,241,1)', backgroundColor: 'rgba(0,0,0,0)', pointRadius: 0, borderWidth: 1 }
        ] },
        plugins: [({id:'vlineSwls', afterDraw(c){ const {ctx, chartArea:{top,bottom}, scales:{x}}=c; ctx.save(); ctx.setLineDash([4,4]); ctx.strokeStyle='rgba(99,102,241,.5)'; ctx.restore(); }})]
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

    // N1/N2/N3 vs selected questionnaire scatter (overlay)
    if (n123Scatter) n123Scatter.destroy();
    if (n123Canvas) {
      const metric = (n123MetricSel && n123MetricSel.value) || 'who5';
      if (n123MetricLabel) { n123MetricLabel.textContent = metric.toUpperCase(); }
      const Xs = metric === 'swls' ? swlsTotalsAll : (metric === 'cantril' ? cantrilAll : who5TotalsAll);
      const mkPairs = (yArr) => Xs.map((x,i)=>({x, y: yArr[i]})).filter(p=>xIsNumber(p.x) && xIsNumber(p.y));
      const p1 = mkPairs(n1All), p2 = mkPairs(n2All), p3 = mkPairs(n3All);
      const xs1 = p1.map(p=>p.x), ys1 = p1.map(p=>p.y);
      const xs2 = p2.map(p=>p.x), ys2 = p2.map(p=>p.y);
      const xs3 = p3.map(p=>p.x), ys3 = p3.map(p=>p.y);
      const t1 = ols(xs1, ys1), t2 = ols(xs2, ys2), t3 = ols(xs3, ys3);
      const r1 = xs1.length ? corr(xs1, ys1) : 0;
      const r2 = xs2.length ? corr(xs2, ys2) : 0;
      const r3 = xs3.length ? corr(xs3, ys3) : 0;
      const xMin = metric === 'swls' ? 5 : 0;
      const xMax = metric === 'swls' ? 35 : (metric === 'cantril' ? 10 : 100);
      const line1 = [{x:xMin, y: t1.slope*xMin+t1.intercept}, {x:xMax, y: t1.slope*xMax+t1.intercept}];
      const line2 = [{x:xMin, y: t2.slope*xMin+t2.intercept}, {x:xMax, y: t2.slope*xMax+t2.intercept}];
      const line3 = [{x:xMin, y: t3.slope*xMin+t3.intercept} , {x:xMax, y: t3.slope*xMax+t3.intercept}];
      const xTitle = (metric === 'swls') ? 'SWLS (5–35)' : (metric === 'cantril' ? 'Cantril (0–10)' : 'WHO‑5 %');
      n123Scatter = new Chart(n123Canvas, {
        ...scatterCommon,
        data: { datasets: [
          { label: `N1 vs ${metric.toUpperCase()} (r=${r1.toFixed(2)})`, data: p1, backgroundColor: 'rgba(99,102,241,.5)' },
          { type: 'line', label: 'N1 trend', data: line1, borderColor: 'rgba(99,102,241,1)', backgroundColor: 'rgba(0,0,0,0)', pointRadius: 0, borderWidth: 1 },
          { label: `N2 vs ${metric.toUpperCase()} (r=${r2.toFixed(2)})`, data: p2, backgroundColor: 'rgba(16,185,129,.5)' },
          { type: 'line', label: 'N2 trend', data: line2, borderColor: 'rgba(16,185,129,1)', backgroundColor: 'rgba(0,0,0,0)', pointRadius: 0, borderWidth: 1 },
          { label: `N3 vs ${metric.toUpperCase()} (r=${r3.toFixed(2)})`, data: p3, backgroundColor: 'rgba(236,72,153,.4)' },
          { type: 'line', label: 'N3 trend', data: line3, borderColor: 'rgba(236,72,153,1)', backgroundColor: 'rgba(0,0,0,0)', pointRadius: 0, borderWidth: 1 }
        ] },
        options: {
          ...scatterCommon.options,
          scales: {
            x: { beginAtZero: true, title: { display: true, text: xTitle } },
            y: { beginAtZero: true, title: { display: true, text: 'IHS (0–100)' } }
          }
        }
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
    if (overallCorrTbody) {
      overallCorrTbody.replaceChildren();
      const rows = [
        { m: 'WHO‑5 %', n: xsWho5.length, r: rWho5, p: pWho5 },
        { m: 'SWLS (5–35)', n: xsSwls.length, r: rSwls, p: pSwls },
        { m: 'Cantril (0–10)', n: xsCan.length, r: rCan, p: pCan }
      ];
      const colorBadge = (v) => {
        const av = Math.abs(Number(v||0));
        let bg = '#e5e7eb', fg = '#111827';
        if (av >= 0.9) { bg = 'rgba(236,72,153,.20)'; fg = '#831843'; }
        else if (av >= 0.7) { bg = 'rgba(168,85,247,.20)'; fg = '#581c87'; }
        else if (av >= 0.5) { bg = 'rgba(16,185,129,.18)'; fg = '#065f46'; }
        else if (av >= 0.3) { bg = 'rgba(59,130,246,.18)'; fg = '#1e3a8a'; }
        else if (av >= 0.1) { bg = 'rgba(250,204,21,.20)'; fg = '#854d0e'; }
        return `<span style="display:inline-block;min-width:44px;text-align:center;padding:2px 6px;border-radius:6px;background:${bg};color:${fg};font-variant-numeric: tabular-nums;">${Number(v||0).toFixed(2)}</span>`;
      };
      rows.forEach(rw => {
        const tr = document.createElement('tr');
        tr.innerHTML = `<td>${rw.m}</td><td>${rw.n}</td><td>${colorBadge(rw.r)}</td><td>${rw.p===null?'—':rw.p.toExponential(2)}</td>`;
        overallCorrTbody.appendChild(tr);
      });
    }

    // Fetch server-side correlations for domains and cards
    try {
      // Pre-compute client-side Cantril correlations per card from raw entries (Yes or Affirm per metric)
      const metricIsAffirm = (cardCorrMetric && cardCorrMetric.value === 'affirm');
      const cantrilByCard = metricIsAffirm ? computeCardAffirmVsCantril(entries) : computeCardYesVsCantril(entries);
      await ensureCardDomains();
      const dev = (filterDevice && filterDevice.value) || '';
      const q = new URLSearchParams({ limit: String(limit) });
      if (dev) q.set('device', dev);
      // Server correlations allow a single modality value; if multiple are checked, omit and rely on client-side distributions
      const selectedMods = [
        modClick && modClick.checked ? 'click' : null,
        modSwipe && modSwipe.checked ? 'swipe' : null,
        modArrow && modArrow.checked ? 'arrow' : null
      ].filter(Boolean);
      if (selectedMods.length === 1) q.set('modality', selectedMods[0]);
      if (filterExclusive && filterExclusive.checked) q.set('exclusive', 'true');
      if (filterNoTimeouts && filterNoTimeouts.checked) q.set('excludeTimeouts', 'true');
      if (filterIat && filterIat.checked) q.set('iat', 'true');
      if (filterSensitivity && filterSensitivity.checked) q.set('sensitivityAllMax', 'true');
      // Pass demographics filters through to correlations so n matches
      if (filterSex && filterSex.value) q.set('sex', filterSex.value);
      if (filterCountry && filterCountry.selectedOptions && filterCountry.selectedOptions.length > 0) {
        const inc = Array.from(filterCountry.selectedOptions).map(o=>o.value).filter(Boolean);
        if (inc.length === 1) q.set('country', inc[0]);
        if (inc.length > 1) q.set('countries', inc.join(','));
      }
      if (excludeCountries && excludeCountries.selectedOptions && excludeCountries.selectedOptions.length > 0) {
        const ex = Array.from(excludeCountries.selectedOptions).map(o=>o.value).filter(Boolean);
        if (ex.length) q.set('excludeCountries', ex.join(','));
      }
      if (filterAgeMin && filterAgeMin.value) q.set('ageMin', filterAgeMin.value);
      if (filterAgeMax && filterAgeMax.value) q.set('ageMax', filterAgeMax.value);
      const thresholdPct = Number(filterThreshold && filterThreshold.value ? filterThreshold.value : NaN);
      if (!Number.isNaN(thresholdPct) && selectedMods.length === 1) q.set('threshold', String(thresholdPct));
      q.set('limit', String(limit));
      const corrRes = await fetch(`/api/analytics/correlations?${q.toString()}`);
      const corrJson = await corrRes.json();
      const domains = corrJson.domains || [];
      const cards = corrJson.cards || [];

      // Domain table with color-coded r values
      if (domainCorrTbody) {
        domainCorrTbody.replaceChildren();
        domains.forEach(d => {
          const tr = document.createElement('tr');
          const colorBadge = (r) => {
            const v = Number(r||0);
            const t = v.toFixed(2);
            let bg = '#e5e7eb', fg = '#111827';
            const av = Math.abs(v);
            if (av < 0.10) { bg = '#e5e7eb'; fg = '#111827'; }
            else if (av < 0.30) { bg = 'rgba(250,204,21,.20)'; fg = '#854d0e'; }
            else if (av < 0.50) { bg = 'rgba(59,130,246,.18)'; fg = '#1e3a8a'; }
            else if (av < 0.70) { bg = 'rgba(16,185,129,.18)'; fg = '#065f46'; }
            else if (av < 0.90) { bg = 'rgba(168,85,247,.20)'; fg = '#581c87'; }
            else { bg = 'rgba(236,72,153,.20)'; fg = '#831843'; }
            return `<span style="display:inline-block;min-width:44px;text-align:center;padding:2px 6px;border-radius:6px;background:${bg};color:${fg};font-variant-numeric: tabular-nums;">${t}</span>`;
          };
          tr.innerHTML = `
            <td>${d.domain}</td>
            <td>${colorBadge(d.r_affirm_who5)}</td>
            <td>${colorBadge(d.r_affirm_swls)}</td>
            <td>${colorBadge(d.r_affirm_cantril)}</td>
            <td>${colorBadge(d.r_yesrate_who5)}</td>
            <td>${colorBadge(d.r_yesrate_swls)}</td>
            <td>${colorBadge(d.r_yesrate_cantril)}</td>
            <td>${Math.max(d.n_affirm_who5||0, d.n_yesrate_who5||0)}</td>
          `;
          domainCorrTbody.appendChild(tr);
        });
      }

      // Card top/bottom by composite of WHO-5/SWLS/Cantril
      const score = (c) => 0.4*(c.r_yes_who5||0) + 0.4*(c.r_yes_swls||0) + 0.2*( (c.r_yes_can!=null?c.r_yes_can: (cantrilByCard.get(Number(c.cardId)) && cantrilByCard.get(Number(c.cardId)).r) ) || 0 );
      const sorted = cards.slice().sort((a,b)=> score(b) - score(a));
      const top = sorted.slice(0, 12);
      const bottom = sorted.slice(-12);
      function colorBadge(r) {
        const v = Number(r||0);
        const t = v.toFixed(2);
        let bg = '#e5e7eb', fg = '#111827';
        const av = Math.abs(v);
        if (av < 0.10) { bg = '#e5e7eb'; fg = '#111827'; }
        else if (av < 0.30) { bg = 'rgba(250,204,21,.20)'; fg = '#854d0e'; }
        else if (av < 0.50) { bg = 'rgba(59,130,246,.18)'; fg = '#1e3a8a'; }
        else if (av < 0.70) { bg = 'rgba(16,185,129,.18)'; fg = '#065f46'; }
        else if (av < 0.90) { bg = 'rgba(168,85,247,.20)'; fg = '#581c87'; }
        else { bg = 'rgba(236,72,153,.20)'; fg = '#831843'; }
        return `<span style="display:inline-block;min-width:44px;text-align:center;padding:2px 6px;border-radius:6px;background:${bg};color:${fg};font-variant-numeric: tabular-nums;">${t}</span>`;
      }

      function renderCardRows(tbody, rows){
        if (!tbody) return;
        tbody.replaceChildren();
        rows.forEach(c => {
          const tr = document.createElement('tr');
          const domain = cardIdToDomain.get(Number(c.cardId)) || '';
          const color = domainColors[domain] || '#9ca3af';
          const dot = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:6px;vertical-align:middle;"></span>`;
          const name = c.label ? `${c.cardId} · ${c.label}` : c.cardId;
          const cid = Number(c.cardId);
          const rCanSource = (c.r_yes_can!=null ? Number(c.r_yes_can) : (cantrilByCard.get(cid) && cantrilByCard.get(cid).r));
          const rCan = (rCanSource==null || Number.isNaN(rCanSource)) ? 0 : rCanSource;
          tr.innerHTML = `<td>${dot}${name}</td>
            <td>${colorBadge(c.r_yes_who5)}</td>
            <td>${colorBadge(c.r_yes_swls)}</td>
            <td>${colorBadge(rCan)}</td>
            <td>${c.n_yes_who5||0}</td>`;
          tbody.appendChild(tr);
        });
      }
      renderCardRows(cardTopWhoTbody, top);
      renderCardRows(cardBottomWhoTbody, bottom);

      // Card Yes frequency ranking (from raw entries)
      if (cardYesRankingTbody) {
        const yesCounts = new Map(); // cardId -> { count, label }
        entries.forEach(e => {
          const sel = e && e.selections && e.selections.allResponses;
          if (!Array.isArray(sel)) return;
          sel.forEach(r => {
            if (!r || r.response !== true) return;
            const cid = Number(r.cardId);
            if (!Number.isFinite(cid)) return;
            const prev = yesCounts.get(cid) || { count: 0, label: r.label || '' };
            yesCounts.set(cid, { count: prev.count + 1, label: prev.label || r.label || '' });
          });
        });
        // Combine domain color and label from mapping where available
        const rows = Array.from(yesCounts.entries()).map(([cid, v]) => {
          const domain = cardIdToDomain.get(cid) || '';
          const color = domainColors[domain] || '#9ca3af';
          const dot = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${color};margin-right:6px;vertical-align:middle;"></span>`;
          const name = v.label ? `${cid} · ${v.label}` : String(cid);
          return { cid, name: `${dot}${name}`, count: v.count };
        }).sort((a,b)=> b.count - a.count);
        cardYesRankingTbody.replaceChildren();
        rows.forEach((row, idx) => {
          const tr = document.createElement('tr');
          tr.innerHTML = `<td>${idx+1}</td><td>${row.name}</td><td>${row.count}</td>`;
          cardYesRankingTbody.appendChild(tr);
        });
      }
    } catch (e) {
      // Non-fatal if analytics endpoint is unavailable
      console.warn('Correlation analytics failed', e);
    }
  }

  function renderCardTimeHistogram(){
    if (!cardTimeCanvas || !cardTimeSelector) return;
    const selectedCid = Number(cardTimeSelector.value || NaN);
    if (!Number.isFinite(selectedCid)) return;
    // Collect response times (ms) for the selected card, excluding null timeouts
    const times = [];
    currentEntries.forEach(e => {
      const sel = e && e.selections && e.selections.allResponses;
      if (!Array.isArray(sel)) return;
      sel.forEach(r => {
        const cid = Number(r && r.cardId);
        if (!Number.isFinite(cid) || cid !== selectedCid) return;
        const resp = r && r.response;
        if (resp === null || r.responseTime == null) return; // exclude timeouts
        const t = Number(r.responseTime);
        if (!Number.isFinite(t)) return;
        const clamped = Math.max(0, Math.min(4000, t));
        times.push(clamped);
      });
    });
    // 0..4000 ms in 250 ms bins => 16 bins
    const binSize = 250;
    const bins = new Array(17).fill(0);
    const labels = Array.from({length:17}, (_,i)=> i*binSize);
    times.forEach(t => {
      const idx = Math.max(0, Math.min(16, Math.floor(t / binSize)));
      bins[idx]++;
    });
    if (cardTimeChart) cardTimeChart.destroy();
    cardTimeChart = new Chart(cardTimeCanvas, {
      type: 'bar',
      data: { labels, datasets: [{ label: `Response time (ms) for card ${selectedCid}`, data: bins, backgroundColor: 'rgba(234,88,12,.5)' }] },
      options: { responsive: true, scales: { x: { ticks: { callback: (v)=>labels[v] } }, y: { beginAtZero: true } } }
    });
  }

  limitInput.addEventListener('change', load);
  if (applyFiltersBtn) applyFiltersBtn.addEventListener('click', load);
  if (who5ScaleSel) who5ScaleSel.addEventListener('change', load);
  if (swlsScaleSel) swlsScaleSel.addEventListener('change', load);
  if (n123MetricSel) n123MetricSel.addEventListener('change', load);
  if (cardTimeSelector) cardTimeSelector.addEventListener('change', renderCardTimeHistogram);
  if (cardCorrMetric) cardCorrMetric.addEventListener('change', load);
  if (filterSex) filterSex.addEventListener('change', load);
  if (filterCountry) filterCountry.addEventListener('change', load);
  if (excludeCountries) excludeCountries.addEventListener('change', load);
  if (filterAgeMin) filterAgeMin.addEventListener('change', load);
  if (filterAgeMax) filterAgeMax.addEventListener('change', load);
  if (filterIat) filterIat.addEventListener('change', load);
  if (filterSensitivity) filterSensitivity.addEventListener('change', load);
  // Close dropdowns on outside click
  (function setupDropdownClose(){
    function closeIfOutside(e, detailsEl){
      if (!detailsEl) return;
      if (!detailsEl.open) return;
      if (!detailsEl.contains(e.target)) {
        detailsEl.open = false;
      }
    }
    document.addEventListener('click', (e)=>{
      closeIfOutside(e, document.getElementById('includeDropdown'));
      closeIfOutside(e, document.getElementById('excludeDropdown'));
    });
  })();
  // Sorting: make multiple headers clickable with arrows and toggling
  (function attachSorting(){
    const table = document.getElementById('resultsTable');
    if (!table) return;

    // Value getters
    const selectedCountOf = (e) => {
      if (e && e.selections && Array.isArray(e.selections.allResponses)) {
        return e.selections.allResponses.filter(r=>r && r.response===true).length;
      }
      return Number(e && e.selected_count ? e.selected_count : 0) || 0;
    };
    const rejectedCountOf = (e) => {
      if (e && e.selections && Array.isArray(e.selections.allResponses)) {
        return e.selections.allResponses.filter(r=>r && r.response===false).length;
      }
      return Number(e && e.rejected_count ? e.rejected_count : 0) || 0;
    };
    const timeoutsCountOf = (e) => {
      if (e && e.selections && Array.isArray(e.selections.allResponses)) {
        return e.selections.allResponses.filter(r=>r && r.response===null).length;
      }
      return 0;
    };
    const timeSecOf = (e) => {
      if (e && e.completion_time != null) return Number(e.completion_time) || 0;
      if (e && e.selections && Array.isArray(e.selections.allResponses)) {
        const ms = e.selections.allResponses.reduce((s,r)=> s + (Number(r && r.responseTime)||0), 0);
        return Math.round(ms/1000);
      }
      return 0;
    };
    const who5Of = (e) => (sum(e && e.who5 || []) * 4);
    const swlsOf = (e) => (sum(e && e.swls || []) * (5/3));
    const cantrilOf = (e) => Number(e && e.cantril != null ? e.cantril : NaN);
    const ihsOf = (e) => Number(e && e.ihs != null ? e.ihs : NaN);

    function makeSortable(colIndex, title, getter) {
      const th = table.querySelector(`thead th:nth-child(${colIndex})`);
      if (!th) return;
      let desc = true;
      const indicator = document.createElement('span');
      indicator.textContent = '↕';
      indicator.style.marginLeft = '4px';
      indicator.style.opacity = '0.6';
      th.appendChild(indicator);
      th.style.cursor = 'pointer';
      th.title = `Click to sort by ${title}`;
      th.addEventListener('click', () => {
        if (!Array.isArray(currentEntries) || currentEntries.length === 0) return;
        currentEntries.sort((a,b)=>{
          const va = getter(a);
          const vb = getter(b);
          const na = (va==null || Number.isNaN(va)) ? -Infinity : Number(va);
          const nb = (vb==null || Number.isNaN(vb)) ? -Infinity : Number(vb);
          return desc ? (nb - na) : (na - nb);
        });
        indicator.textContent = desc ? '↓' : '↑';
        desc = !desc;
        renderTable(currentEntries);
      });
    }

    // Map required columns (adjust indices after adding Sex/Age/Country)
    // Columns: 1 ID, 2 Created, 3 Session, 4 PID, 5 STUDY_ID, 6 SESSION_ID, 7 Sex, 8 Age, 9 Country, 10 Device, 11 Time, 12 Selected, 13 Rejected, 14 Timeouts, 15 WHO-5, 16 SWLS, 17 Cantril, 18 IHS
    makeSortable(11, 'Time (s)', timeSecOf);
    makeSortable(12, 'Selected', selectedCountOf);
    makeSortable(13, 'Rejected', rejectedCountOf);
    makeSortable(14, 'Timeouts', timeoutsCountOf);
    makeSortable(15, 'WHO-5', who5Of);
    makeSortable(16, 'SWLS', swlsOf);
    makeSortable(17, 'Cantril', cantrilOf);
    makeSortable(18, 'IHS', ihsOf);
  })();
  load();
})();


