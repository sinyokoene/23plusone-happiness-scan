const express = require('express');

const { pool, researchPool } = require('../db/pool');
const { detectDemographics, qIdent } = require('../lib/demographics');

const router = express.Router();

// Simple in-memory cache for validity analytics
const __validityCache = new Map(); // key -> { at, ttlMs, data }

// Correlations across scan and research data
router.get('/analytics/correlations', async (req, res) => {
  function sumArray(arr) {
    return (arr || []).reduce((a, b) => a + (Number(b) || 0), 0);
  }
  function pearson(x, y) {
    const n = Math.min(x.length, y.length);
    if (n < 2) return { r: 0, n: n };
    const xs = x.slice(0, n);
    const ys = y.slice(0, n);
    const xm = xs.reduce((a, b) => a + b, 0) / n;
    const ym = ys.reduce((a, b) => a + b, 0) / n;
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < n; i++) {
      const xv = xs[i] - xm;
      const yv = ys[i] - ym;
      num += xv * yv;
      dx += xv * xv;
      dy += yv * yv;
    }
    const denom = Math.sqrt(dx * dy);
    return { r: denom ? (num / denom) : 0, n };
  }
  function rankArray(arr) {
    const ord = arr.map((v, i) => ({ v: Number(v), i })).sort((a, b) => a.v - b.v);
    const ranks = new Array(arr.length);
    for (let k = 0; k < ord.length;) {
      let j = k; while (j < ord.length && ord[j].v === ord[k].v) j++;
      const avg = (k + j - 1) / 2 + 1; // average rank (1-based)
      for (let t = k; t < j; t++) ranks[ord[t].i] = avg;
      k = j;
    }
    return ranks;
  }
  function spearman(x, y) {
    const n = Math.min(x.length, y.length);
    if (n < 2) return { r: 0, n };
    const xr = rankArray(x.slice(0, n));
    const yr = rankArray(y.slice(0, n));
    return pearson(xr, yr);
  }

  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 500, 2000);
    const device = String(req.query.device || '').toLowerCase(); // 'mobile' | 'desktop' | ''
    const method = String(req.query.method || 'pearson').toLowerCase(); // 'pearson' | 'spearman'
    const modality = String(req.query.modality || '').toLowerCase(); // 'click' | 'swipe' | 'arrow' | ''
    const modalitiesCsv = String(req.query.modalities || '').toLowerCase();
    const modalities = modalitiesCsv ? modalitiesCsv.split(',').map(s => s.trim()).filter(Boolean) : [];
    const exclusive = String(req.query.exclusive || '').toLowerCase() === 'true';
    const excludeTimeouts = String(req.query.excludeTimeouts || '').toLowerCase() === 'true';
    const iat = String(req.query.iat || '').toLowerCase() === 'true';
    const sensitivityAllMax = String(req.query.sensitivityAllMax || '').toLowerCase() === 'true';
    const threshold = Number.isFinite(Number(req.query.threshold)) ? Number(req.query.threshold) : null; // 0..100
    // Outlier trimming
    const trimIhs = (req.query.trimIhs != null) ? (Number.isFinite(Number(req.query.trimIhs)) ? Number(req.query.trimIhs) : (String(req.query.trimIhs).toLowerCase() === 'true' ? 0.10 : null)) : null;
    const trimScales = (req.query.trimScales != null) ? (Number.isFinite(Number(req.query.trimScales)) ? Number(req.query.trimScales) : (String(req.query.trimScales).toLowerCase() === 'true' ? 0.10 : null)) : null;
    // Demographics filters
    const sex = req.query.sex ? String(req.query.sex) : '';
    const country = req.query.country ? String(req.query.country) : '';
    const countries = req.query.countries ? String(req.query.countries) : '';
    const ageMin = Number.isFinite(Number(req.query.ageMin)) ? Number(req.query.ageMin) : null;
    const ageMax = Number.isFinite(Number(req.query.ageMax)) ? Number(req.query.ageMax) : null;
    const excludeCountries = req.query.excludeCountries ? String(req.query.excludeCountries) : '';
    const researchClient = await researchPool.connect();
    const mainClient = await pool.connect();
    try {
      // Ensure table exists (for local dev safety)
      try {
        await researchClient.query(
          `CREATE TABLE IF NOT EXISTS research_entries (
            id SERIAL PRIMARY KEY,
            session_id TEXT NOT NULL,
            who5 INTEGER[] NOT NULL,
            swls INTEGER[] NOT NULL,
            cantril INTEGER,
            user_agent TEXT,
            created_at TIMESTAMPTZ DEFAULT now()
          )`
        );
      } catch (e) {
        console.warn('validity: CREATE TABLE research_entries failed (continuing)', e?.message || e);
      }
      // Ensure optional Prolific columns exist for demographics join
      try { await researchClient.query('ALTER TABLE research_entries ADD COLUMN IF NOT EXISTS prolific_pid TEXT'); } catch (e) { console.warn('validity: add prolific_pid failed', e?.message || e); }
      try { await researchClient.query('ALTER TABLE research_entries ADD COLUMN IF NOT EXISTS prolific_study_id TEXT'); } catch (e) { console.warn('validity: add prolific_study_id failed', e?.message || e); }
      try { await researchClient.query('ALTER TABLE research_entries ADD COLUMN IF NOT EXISTS prolific_session_id TEXT'); } catch (e) { console.warn('validity: add prolific_session_id failed', e?.message || e); }

      // Pull latest research rows with optional demographics filtering
      let demo = null;
      try { demo = await detectDemographics(researchClient); } catch (e) { console.warn('validity: detectDemographics failed', e?.message || e); demo = null; }
      const demoJoin = demo ? ` LEFT JOIN ${qIdent(demo.table)} d ON d.${qIdent(demo.pidCol)} = re.prolific_pid` : '';
      const clauses = [];
      const params = [];
      if (demo && sex) { params.push(sex); clauses.push(`LOWER(d.${qIdent(demo.sexCol || 'sex')}) = LOWER($${params.length})`); }
      if (demo && country) { params.push(country); clauses.push(`LOWER(d.${qIdent(demo.countryCol || 'country_of_residence')}) = LOWER($${params.length})`); }
      if (demo && countries) {
        const inc = countries.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        if (inc.length) {
          const placeholders = inc.map((_, i) => `LOWER($${params.length + i + 1})`).join(',');
          params.push(...inc);
          clauses.push(`LOWER(d.${qIdent(demo.countryCol || 'country_of_residence')}) IN (${placeholders})`);
        }
      }
      if (demo && ageMin != null) { params.push(ageMin); clauses.push(`d.${qIdent(demo.ageCol || 'age')} >= $${params.length}`); }
      if (demo && ageMax != null) { params.push(ageMax); clauses.push(`d.${qIdent(demo.ageCol || 'age')} <= $${params.length}`); }
      if (demo && excludeCountries) {
        const ex = excludeCountries.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        if (ex.length) {
          const loweredPlaceholders = ex.map((_, i) => `LOWER($${params.length + i + 1})`).join(',');
          params.push(...ex);
          clauses.push(`LOWER(d.${qIdent(demo.countryCol || 'country_of_residence')}) NOT IN (${loweredPlaceholders})`);
        }
      }
      params.push(limit);
      const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      let researchRows = [];
      try {
        const qres = await researchClient.query(
          `SELECT re.session_id, re.who5, re.swls, re.cantril, re.created_at
           FROM research_entries re${demoJoin}
           ${whereSql}
           ORDER BY re.created_at DESC
           LIMIT $${params.length}`,
          params
        );
        researchRows = qres.rows || [];
      } catch (e) {
        console.warn('validity: SELECT from research_entries failed (continuing with empty set)', e?.message || e);
        researchRows = [];
      }
      const rBySession = new Map();
      for (const r of researchRows) {
        const who5Total = sumArray(r.who5);
        const swlsTotal = sumArray(r.swls);
        const who5Percent = who5Total * 4; // 0-25 -> 0-100
        const swlsScaled = swlsTotal * (5 / 3); // 3-21 -> 5-35 (approx scaling)
        rBySession.set(r.session_id, {
          who5Total,
          swlsTotal,
          who5Percent,
          swlsScaled,
          cantril: (r.cantril == null ? null : Number(r.cantril))
        });
      }

      const sessionIds = Array.from(rBySession.keys());
      if (!sessionIds.length) {
        return res.json({ overall: [], domains: [], cards: [], usedSessions: 0 });
      }

      // Fetch scan data for those sessions
      const { rows: scanRows } = await mainClient.query(
        `SELECT session_id, ihs_score, n1_score, n2_score, n3_score, n1_scaled_100, n1_trials_total, card_selections, user_agent
         FROM scan_responses
         WHERE session_id = ANY($1::text[])`, [sessionIds]
      );

      // Helper to compute N1 scaled from selections if missing
      function computeN1Scaled(all) {
        if (!Array.isArray(all) || all.length === 0) return null;
        const trials = all.length;
        const timeMultiplier = (ms) => { const t = Math.max(0, Math.min(4000, Number(ms) || 0)); const lin = (4000 - t) / 4000; return Math.sqrt(Math.max(0, lin)); };
        let sum = 0; for (const e of all) { if (!e) continue; if (e.response === true) { const t = Number(e.responseTime); if (Number.isFinite(t)) sum += 4 * timeMultiplier(t); } }
        const denom = 4 * Math.max(1, trials);
        return Math.max(0, Math.min(100, (100 * sum) / denom));
      }

      // Keep only sessions that exist in both sets and have IHS
      let joined = [];
      for (const s of scanRows) {
        const r = rBySession.get(s.session_id);
        if (!r) continue;
        if (s.ihs_score == null) continue;
        joined.push({
          sessionId: s.session_id,
          ihs: Number(s.ihs_score),
          n1: (s.n1_scaled_100 != null ? Number(s.n1_scaled_100) : computeN1Scaled(s.card_selections?.allResponses)),
          n2: s.n2_score == null ? null : Number(s.n2_score),
          n3: s.n3_score == null ? null : Number(s.n3_score),
          who5Percent: r.who5Percent,
          swlsScaled: r.swlsScaled,
          cantril: r.cantril,
          selections: s.card_selections,
          scan_user_agent: s.user_agent || null
        });
      }

      // Optional filtering by device and modality
      function isMobileUA(ua) {
        if (!ua || typeof ua !== 'string') return false;
        return /(Mobi|Android|iPhone|iPad|iPod)/i.test(ua);
      }
      if (device === 'mobile') {
        joined = joined.filter(j => isMobileUA(j.scan_user_agent));
      } else if (device === 'desktop') {
        joined = joined.filter(j => !isMobileUA(j.scan_user_agent));
      }
      // Preserve a base set after device filtering but before modality/timeouts/IAT/sensitivity/threshold filters
      const joinedBase = joined.slice();
      if (modality || modalities.length > 0 || exclusive || excludeTimeouts || iat || sensitivityAllMax || (threshold != null)) {
        const matchers = {
          click: (m) => m === 'click',
          swipe: (m) => m === 'swipe-touch' || m === 'swipe-mouse',
          arrow: (m) => m === 'keyboard-arrow'
        };
        joined = joined.filter(j => {
          const all = j.selections?.allResponses;
          if (!Array.isArray(all)) return false;
          let counts = { click: 0, swipe: 0, arrow: 0, other: 0, total: 0 };
          // For split-half reliability on IHS we will also need card-level info
          // but we compute it later using available selections per session.
          for (const e of all) {
            const v = String(e?.inputModality || '').toLowerCase();
            if (matchers.click(v)) counts.click++; else if (matchers.swipe(v)) counts.swipe++; else if (matchers.arrow(v)) counts.arrow++; else counts.other++;
            counts.total++;
          }
          if (excludeTimeouts) {
            if (all.some(e => e && e.response === null)) return false;
          }
          if (iat) {
            const total = all.length;
            if (total < 24) return false;
            let invalid = 0;
            for (const e of all) {
              if (!e) { invalid++; continue; }
              if (e.response === null) { invalid++; continue; }
              const t = Number(e.responseTime);
              if (!Number.isFinite(t)) { invalid++; continue; }
              if (!(t > 300 && t < 2000)) invalid++;
            }
            const fracInvalid = total > 0 ? (invalid / total) : 1;
            if (fracInvalid > 0.10) return false;
          }
          if (sensitivityAllMax) {
            const who5 = Number(j?.who5Percent);
            const swls = Number(j?.swlsScaled);
            if ((Number.isFinite(who5) && who5 >= 100) && (Number.isFinite(swls) && swls >= 35)) return false;
          }
          if (modality) {
            if (modality === 'click' && counts.click === 0) return false;
            if (modality === 'swipe' && counts.swipe === 0) return false;
            if (modality === 'arrow' && counts.arrow === 0) return false;
          } else if (modalities.length > 0) {
            const present = {
              click: counts.click > 0,
              swipe: counts.swipe > 0,
              arrow: counts.arrow > 0
            };
            if (!modalities.some(mod => present[mod])) return false;
          }
          if (exclusive) {
            const present = [counts.click > 0, counts.swipe > 0, counts.arrow > 0].filter(Boolean).length;
            if (present !== 1) return false;
          }
          if (threshold != null && counts.total > 0 && modality) {
            const frac = (modality === 'click' ? counts.click : modality === 'swipe' ? counts.swipe : counts.arrow) / counts.total;
            if ((frac * 100) < threshold) return false;
          }
          return true;
        });
      }

      const corrFn = (method === 'spearman') ? spearman : pearson;
      // Overall correlations
      const xIhs = joined.map(j => j.ihs);
      const yWho = joined.map(j => j.who5Percent);
      const ySwls = joined.map(j => j.swlsScaled);
      const yCan = joined.map(j => j.cantril);
      const overall = [
        { metric: 'ihs_vs_who5', ...corrFn(xIhs, yWho) },
        { metric: 'ihs_vs_swls', ...corrFn(xIhs, ySwls) },
        { metric: 'ihs_vs_cantril', ...corrFn(xIhs, yCan) }
      ];

      // Domain-level correlations
      const domains = [];
      const domainList = ['Basics', 'Self-development', 'Ambition', 'Vitality', 'Attraction'];
      for (const domain of domainList) {
        const affWhoX = [];
        const affWhoY = [];
        const affSwlX = [];
        const affSwlY = [];
        const affCanX = [];
        const affCanY = [];
        const xYes = [];
        const yYesWho = [];
        const yYesSwls = [];
        const yYesCan = [];
        for (const j of joined) {
          const all = j.selections?.allResponses;
          if (!Array.isArray(all)) continue;
          let sumAff = 0;
          let yes = 0;
          let yn = 0;
          for (const e of all) {
            if (!e || String(e.domain) !== domain) continue;
            if (e.response === true) {
              yes++;
              yn++;
            } else if (e.response === false) {
              yn++;
            }
            const aff = (e.affirmationScore == null ? null : Number(e.affirmationScore));
            if (aff != null && !Number.isNaN(aff)) sumAff += aff;
          }
          if (sumAff > 0) {
            affWhoX.push(sumAff);
            affWhoY.push(j.who5Percent);
            affSwlX.push(sumAff);
            affSwlY.push(j.swlsScaled);
            const canY = (j.cantril == null ? NaN : Number(j.cantril));
            if (!Number.isNaN(canY)) { affCanX.push(sumAff); affCanY.push(canY); }
          }
          if (yn > 0) {
            const yesRate = yes / yn;
            xYes.push(yesRate);
            yYesWho.push(j.who5Percent);
            yYesSwls.push(j.swlsScaled);
            const canY = (j.cantril == null ? NaN : Number(j.cantril));
            if (!Number.isNaN(canY)) { yYesCan.push(canY); }
          }
        }
        const affWho = corrFn(affWhoX, affWhoY);
        const affSwl = corrFn(affSwlX, affSwlY);
        const affCan = corrFn(affCanX, affCanY);
        const yesWho = corrFn(xYes, yYesWho);
        const yesSwl = corrFn(xYes, yYesSwls);
        const yesCan = corrFn(xYes, yYesCan);
        domains.push({
          domain,
          r_affirm_who5: affWho.r,
          r_affirm_swls: affSwl.r,
          r_affirm_cantril: affCan.r,
          r_yesrate_who5: yesWho.r,
          r_yesrate_swls: yesSwl.r,
          r_yesrate_cantril: yesCan.r,
          n_affirm_who5: affWho.n,
          n_affirm_swls: affSwl.n,
          n_affirm_cantril: affCan.n,
          n_yesrate_who5: yesWho.n,
          n_yesrate_swls: yesSwl.n,
          n_yesrate_cantril: yesCan.n,
          method
        });
      }

      // Card-level correlations
      const cardStats = new Map(); // cardId -> { label, yes:[], affirm:[], who:[], swls:[], whoAff:[], swlsAff:[] }
      for (const j of joined) {
        const all = j.selections?.allResponses;
        if (!Array.isArray(all)) continue;
        for (const e of all) {
          const cid = Number(e.cardId);
          if (!Number.isFinite(cid)) continue;
          if (!cardStats.has(cid)) cardStats.set(cid, { label: e.label || null, yes: [], affirm: [], who: [], swls: [], whoAff: [], swlsAff: [] });
          const bucket = cardStats.get(cid);
          const yesBin = e.response === true ? 1 : (e.response === false ? 0 : null);
          const aff = (e.affirmationScore == null ? null : Number(e.affirmationScore));
          if (yesBin != null) {
            bucket.yes.push(yesBin);
            bucket.who.push(j.who5Percent);
            bucket.swls.push(j.swlsScaled);
          }
          if (aff != null && !Number.isNaN(aff)) {
            bucket.affirm.push(aff);
            bucket.whoAff.push(j.who5Percent);
            bucket.swlsAff.push(j.swlsScaled);
          }
        }
      }
      const cards = [];
      for (const [cardId, b] of cardStats.entries()) {
        const rYesWho = corrFn(b.yes, b.who);
        const rYesSwl = corrFn(b.yes, b.swls);
        const rAffWho = corrFn(b.affirm, b.whoAff);
        const rAffSwl = corrFn(b.affirm, b.swlsAff);
        cards.push({
          cardId,
          label: b.label,
          r_yes_who5: rYesWho.r,
          r_yes_swls: rYesSwl.r,
          r_affirm_who5: rAffWho.r,
          r_affirm_swls: rAffSwl.r,
          n_yes_who5: rYesWho.n,
          n_yes_swls: rYesSwl.n,
          n_affirm_who5: rAffWho.n,
          n_affirm_swls: rAffSwl.n,
          method
        });
      }

      res.json({ overall, domains, cards, usedSessions: joined.length, method });
    } finally {
      researchClient.release();
      mainClient.release();
    }
  } catch (e) {
    console.error('Error computing correlations:', e);
    res.status(500).json({ error: 'Failed to compute correlations' });
  }
});

// Validity analytics: Build Benchmark (z-mean of WHO-5 raw, SWLS raw, Cantril) and compare to IHS
router.get('/analytics/validity', async (req, res) => {
  function sumArray(arr) {
    return (arr || []).reduce((a, b) => a + (Number(b) || 0), 0);
  }
  function mean(arr) {
    if (!arr || arr.length === 0) return NaN;
    return arr.reduce((a, b) => a + b, 0) / arr.length;
  }
  function sd(arr) {
    if (!arr || arr.length < 2) return NaN;
    const m = mean(arr);
    let v = 0;
    for (let i = 0; i < arr.length; i++) { const d = arr[i] - m; v += d * d; }
    return Math.sqrt(v / (arr.length - 1));
  }
  function pearson(x, y) {
    const n = Math.min(x.length, y.length);
    if (n < 2) return { r: 0, n: n };
    const xs = x.slice(0, n);
    const ys = y.slice(0, n);
    const xm = xs.reduce((a, b) => a + b, 0) / n;
    const ym = ys.reduce((a, b) => a + b, 0) / n;
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < n; i++) {
      const xv = xs[i] - xm;
      const yv = ys[i] - ym;
      num += xv * yv;
      dx += xv * xv;
      dy += yv * yv;
    }
    const denom = Math.sqrt(dx * dy);
    return { r: denom ? (num / denom) : 0, n };
  }
  function rankArray(arr) {
    const ord = arr.map((v, i) => ({ v: Number(v), i })).sort((a, b) => a.v - b.v);
    const ranks = new Array(arr.length);
    for (let k = 0; k < ord.length;) {
      let j = k; while (j < ord.length && ord[j].v === ord[k].v) j++;
      const avg = (k + j - 1) / 2 + 1; // average rank (1-based)
      for (let t = k; t < j; t++) ranks[ord[t].i] = avg;
      k = j;
    }
    return ranks;
  }
  function spearman(x, y) {
    const n = Math.min(x.length, y.length);
    if (n < 2) return { r: 0, n };
    const xr = rankArray(x.slice(0, n));
    const yr = rankArray(y.slice(0, n));
    return pearson(xr, yr);
  }
  function fisherCIZ(r, n) {
    if (!Number.isFinite(r) || n < 4) return null;
    const z = 0.5 * Math.log((1 + r) / (1 - r));
    const se = 1 / Math.sqrt(n - 3);
    const zLo = z - 1.96 * se;
    const zHi = z + 1.96 * se;
    const rLo = (Math.exp(2 * zLo) - 1) / (Math.exp(2 * zLo) + 1);
    const rHi = (Math.exp(2 * zHi) - 1) / (Math.exp(2 * zHi) + 1);
    return [rLo, rHi];
  }
  function erf(x) {
    const sign = x < 0 ? -1 : 1;
    const ax = Math.abs(x);
    const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
    const t = 1 / (1 + p * ax);
    const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
    return sign * y;
  }
  function normCdf(x) { return 0.5 * (1 + erf(x / Math.SQRT2)); }
  // Incomplete beta and F CDF utilities for p-values
  function gammaln(z) {
    const p = [
      676.5203681218851, -1259.1392167224028, 771.32342877765313,
      -176.61502916214059, 12.507343278686905, -0.13857109526572012,
      9.9843695780195716e-6, 1.5056327351493116e-7
    ];
    if (z < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - gammaln(1 - z);
    z -= 1;
    let x = 0.99999999999980993;
    for (let i = 0; i < p.length; i++) x += p[i] / (z + i + 1);
    const t = z + p.length - 0.5;
    return 0.9189385332046727 + (z + 0.5) * Math.log(t) - t + Math.log(x);
  }
  function betacf(a, b, x) {
    const MAXIT = 200, EPS = 3e-7, FPMIN = 1e-30;
    let qab = a + b, qap = a + 1, qam = a - 1;
    let c = 1, d = 1 - qab * x / qap;
    if (Math.abs(d) < FPMIN) d = FPMIN; d = 1 / d;
    let h = d;
    for (let m = 1, m2 = 2; m <= MAXIT; m++, m2 += 2) {
      let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN; d = 1 / d;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      h *= d * c;
      aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
      d = 1 + aa * d; if (Math.abs(d) < FPMIN) d = FPMIN; d = 1 / d;
      c = 1 + aa / c; if (Math.abs(c) < FPMIN) c = FPMIN;
      const del = d * c; h *= del;
      if (Math.abs(del - 1.0) < EPS) break;
    }
    return h;
  }
  function betainc(x, a, b) {
    if (x <= 0) return 0; if (x >= 1) return 1;
    const bt = Math.exp(gammaln(a + b) - gammaln(a) - gammaln(b) + a * Math.log(x) + b * Math.log(1 - x));
    if (x < (a + 1) / (a + b + 2)) return bt * betacf(a, b, x) / a;
    return 1 - bt * betacf(b, a, 1 - x) / b;
  }
  function fCdf(f, d1, d2) {
    if (!(f >= 0) || d1 <= 0 || d2 <= 0) return NaN;
    const x = (d1 * f) / (d1 * f + d2);
    return betainc(x, d1 / 2, d2 / 2);
  }
  function quantile(arr, q) {
    if (!arr || arr.length === 0) return NaN;
    const a = arr.slice().sort((x, y) => x - y);
    const pos = (a.length - 1) * q;
    const base = Math.floor(pos);
    const rest = pos - base;
    if (a[base + 1] !== undefined) return a[base] + rest * (a[base + 1] - a[base]);
    return a[base];
  }
  function variance(arr) {
    if (!arr || arr.length < 2) return NaN;
    const m = mean(arr);
    let s2 = 0; for (let i = 0; i < arr.length; i++) { const d = arr[i] - m; s2 += d * d; }
    return s2 / (arr.length - 1);
  }
  function skewness(arr) {
    if (!arr || arr.length < 3) return NaN;
    const n = arr.length; const m = mean(arr); let m2 = 0, m3 = 0;
    for (let i = 0; i < n; i++) { const d = arr[i] - m; m2 += d * d; m3 += d * d * d; }
    m2 /= n; m3 /= n; const s = Math.sqrt(m2);
    return (s === 0) ? 0 : (m3 / (s * s * s));
  }
  function kurtosisExcess(arr) {
    if (!arr || arr.length < 4) return NaN;
    const n = arr.length; const m = mean(arr); let m2 = 0, m4 = 0;
    for (let i = 0; i < n; i++) { const d = arr[i] - m; const d2 = d * d; m2 += d2; m4 += d2 * d2; }
    m2 /= n; m4 /= n; if (!m2) return 0; return (m4 / (m2 * m2)) - 3;
  }
  function bootstrap(values, statFn, B) {
    const n = values.length; if (n === 0) return { stats: [] };
    const out = []; const idx = new Array(n);
    for (let b = 0; b < B; b++) {
      for (let i = 0; i < n; i++) { idx[i] = Math.floor(Math.random() * n); }
      const sample = idx.map(i => values[i]);
      out.push(statFn(sample));
    }
    return { stats: out };
  }
  function powerIterSym3(M, iters = 100) {
    // M is 3x3 symmetric
    let v = [1, 0, 0];
    for (let t = 0; t < iters; t++) {
      const w = [
        M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2],
        M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2],
        M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2]
      ];
      const norm = Math.sqrt(w[0] * w[0] + w[1] * w[1] + w[2] * w[2]) || 1;
      v = [w[0] / norm, w[1] / norm, w[2] / norm];
    }
    const ev = (
      v[0] * (M[0][0] * v[0] + M[0][1] * v[1] + M[0][2] * v[2]) +
      v[1] * (M[1][0] * v[0] + M[1][1] * v[1] + M[1][2] * v[2]) +
      v[2] * (M[2][0] * v[0] + M[2][1] * v[1] + M[2][2] * v[2])
    );
    return { vec: v, val: ev };
  }
  function aucFromScores(scores, labels) {
    const pairs = scores.map((s, i) => ({ s, y: labels[i] }));
    const valid = pairs.filter(p => Number.isFinite(p.s) && (p.y === 0 || p.y === 1));
    const n1 = valid.filter(p => p.y === 1).length; const n0 = valid.length - n1;
    if (n1 === 0 || n0 === 0) return { auc: null, n: valid.length };
    // Mann-Whitney U via ranks
    const ord = valid.map((p, i) => ({ ...p, i })).sort((a, b) => a.s - b.s);
    let rank = 1; const ranks = new Array(ord.length);
    for (let k = 0; k < ord.length;) {
      let j = k; while (j < ord.length && ord[j].s === ord[k].s) j++;
      const avg = (k + j - 1) / 2 + 1;
      for (let t = k; t < j; t++) ranks[ord[t].i] = avg;
      k = j;
    }
    let rankSumPos = 0; for (let i = 0; i < valid.length; i++) { if (valid[i].y === 1) rankSumPos += ranks[i]; }
    const U = rankSumPos - n1 * (n1 + 1) / 2;
    const auc = U / (n0 * n1);
    return { auc, n: valid.length };
  }

  try {
    const limit = Math.min(parseInt(req.query.limit, 10) || 500, 2000);
    const device = String(req.query.device || '').toLowerCase(); // 'mobile' | 'desktop' | ''
    const method = String(req.query.method || 'pearson').toLowerCase(); // 'pearson' | 'spearman'
    const modality = String(req.query.modality || '').toLowerCase(); // 'click' | 'swipe' | 'arrow' | ''
    const modalitiesCsv = String(req.query.modalities || '').toLowerCase();
    const modalities = modalitiesCsv ? modalitiesCsv.split(',').map(s => s.trim()).filter(Boolean) : [];
    const exclusive = String(req.query.exclusive || '').toLowerCase() === 'true';
    const excludeTimeouts = String(req.query.excludeTimeouts || '').toLowerCase() === 'true';
    const iat = String(req.query.iat || '').toLowerCase() === 'true';
    const sensitivityAllMax = String(req.query.sensitivityAllMax || '').toLowerCase() === 'true';
    const threshold = Number.isFinite(Number(req.query.threshold)) ? Number(req.query.threshold) : null; // 0..100
    const includePerSession = String(req.query.includePerSession || '').toLowerCase() === 'true';
    // Outlier trimming (10% tails by default if enabled)
    const trimIhs = (req.query.trimIhs != null) ? (Number.isFinite(Number(req.query.trimIhs)) ? Number(req.query.trimIhs) : (String(req.query.trimIhs).toLowerCase() === 'true' ? 0.10 : null)) : null;
    const trimScales = (req.query.trimScales != null) ? (Number.isFinite(Number(req.query.trimScales)) ? Number(req.query.trimScales) : (String(req.query.trimScales).toLowerCase() === 'true' ? 0.10 : null)) : null;
    // Scoring/tuning and RT denoise options
    const scoreMode = String(req.query.score || 'raw').toLowerCase(); // 'raw' | 'tuned' | 'cv' | 'n1' | 'n12'
    const isoCalibrate = String(req.query.iso || '').toLowerCase() === 'true';
    const rtDenoise = String(req.query.rtDenoise || '').toLowerCase() === 'true';
    const rtLearn = String(req.query.rtLearn || '').toLowerCase() === 'true';
    const domainList = req.query.domains ? String(req.query.domains) : '';
    const domainSet = new Set(domainList.split(',').map(s => s.trim().toLowerCase()).filter(Boolean));
    // Modality/timeouts policy
    const excludeSwipe = String(req.query.excludeSwipe || '').toLowerCase() === 'true';
    const timeoutsMax = Number.isFinite(Number(req.query.timeoutsMax)) ? Number(req.query.timeoutsMax) : null;
    const timeoutsFracMax = Number.isFinite(Number(req.query.timeoutsFracMax)) ? Number(req.query.timeoutsFracMax) : null;
    // Demographics filters
    const sex = req.query.sex ? String(req.query.sex) : '';
    const country = req.query.country ? String(req.query.country) : '';
    const countries = req.query.countries ? String(req.query.countries) : '';
    const ageMin = Number.isFinite(Number(req.query.ageMin)) ? Number(req.query.ageMin) : null;
    const ageMax = Number.isFinite(Number(req.query.ageMax)) ? Number(req.query.ageMax) : null;
    const excludeCountries = req.query.excludeCountries ? String(req.query.excludeCountries) : '';

    // cache key includes all relevant params
    const cacheKey = JSON.stringify({
      limit, device, method, modality, modalities, exclusive, excludeTimeouts, iat, sensitivityAllMax, threshold,
      includePerSession, sex, country, countries, ageMin, ageMax, excludeCountries,
      scoreMode, isoCalibrate, rtDenoise, domains: Array.from(domainSet),
      excludeSwipe, timeoutsMax, timeoutsFracMax, trimIhs, trimScales
    });
    const cached = __validityCache.get(cacheKey);
    if (cached && (Date.now() - cached.at) < (cached.ttlMs || 5000)) {
      return res.json({ ...cached.data, cache: { hit: true } });
    }

    const researchClient = await researchPool.connect();
    const mainClient = await pool.connect();
    try {
      await researchClient.query(
        `CREATE TABLE IF NOT EXISTS research_entries (
          id SERIAL PRIMARY KEY,
          session_id TEXT NOT NULL,
          who5 INTEGER[] NOT NULL,
          swls INTEGER[] NOT NULL,
          cantril INTEGER,
          user_agent TEXT,
          created_at TIMESTAMPTZ DEFAULT now()
        )`
      );

      const demo = await detectDemographics(researchClient);
      const demoJoin = demo ? ` LEFT JOIN ${qIdent(demo.table)} d ON d.${qIdent(demo.pidCol)} = re.prolific_pid` : '';
      const clauses = [];
      const params = [];
      if (demo && sex) { params.push(sex); clauses.push(`LOWER(d.${qIdent(demo.sexCol || 'sex')}) = LOWER($${params.length})`); }
      if (demo && country) { params.push(country); clauses.push(`LOWER(d.${qIdent(demo.countryCol || 'country_of_residence')}) = LOWER($${params.length})`); }
      if (demo && countries) {
        const inc = countries.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        if (inc.length) {
          const placeholders = inc.map((_, i) => `LOWER($${params.length + i + 1})`).join(',');
          params.push(...inc);
          clauses.push(`LOWER(d.${qIdent(demo.countryCol || 'country_of_residence')}) IN (${placeholders})`);
        }
      }
      if (demo && ageMin != null) { params.push(ageMin); clauses.push(`d.${qIdent(demo.ageCol || 'age')} >= $${params.length}`); }
      if (demo && ageMax != null) { params.push(ageMax); clauses.push(`d.${qIdent(demo.ageCol || 'age')} <= $${params.length}`); }
      if (demo && excludeCountries) {
        const ex = excludeCountries.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
        if (ex.length) {
          const loweredPlaceholders = ex.map((_, i) => `LOWER($${params.length + i + 1})`).join(',');
          params.push(...ex);
          clauses.push(`LOWER(d.${qIdent(demo.countryCol || 'country_of_residence')}) NOT IN (${loweredPlaceholders})`);
        }
      }
      params.push(limit);
      const whereSql = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const { rows: researchRows } = await researchClient.query(
        `SELECT re.session_id, re.who5, re.swls, re.cantril, re.created_at
         FROM research_entries re${demoJoin}
         ${whereSql}
         ORDER BY re.created_at DESC
         LIMIT $${params.length}`,
        params
      );
      const rBySession = new Map();
      for (const r of researchRows) {
        const who5Total = sumArray(r.who5); // 0-25
        const swlsTotal = sumArray(r.swls); // 3-21
        rBySession.set(r.session_id, {
          who5Total,
          swlsTotal,
          cantril: (r.cantril == null ? null : Number(r.cantril))
        });
      }

      const sessionIds = Array.from(rBySession.keys());
      console.log(`[Validity] After research query filters (excludeCountries='${excludeCountries}'): ${sessionIds.length} sessions`);
      if (!sessionIds.length) {
        return res.json({ n_used: 0, method, correlation: { r: null, n: 0, ci95: null }, benchmark: { method: 'z_mean' } });
      }

      const { rows: scanRows } = await mainClient.query(
        `SELECT session_id, ihs_score, n1_score, n2_score, n3_score, n1_scaled_100, n1_trials_total, card_selections, user_agent
         FROM scan_responses
         WHERE session_id = ANY($1::text[])`, [sessionIds]
      );

      // Build joined set
      let joined = [];
      function computeN1Scaled(all) {
        if (!Array.isArray(all) || all.length === 0) return null;
        const trials = all.length;
        const timeMultiplier = (ms) => { const x = Math.max(0, Math.min(4000, Number(ms) || 0)); const lin = (4000 - x) / 4000; return Math.sqrt(Math.max(0, lin)); };
        let sum = 0; for (const e of all) { if (!e) continue; if (e.response === true) { const t = Number(e.responseTime); if (Number.isFinite(t)) sum += 4 * timeMultiplier(t); } }
        const denom = 4 * Math.max(1, trials);
        return Math.max(0, Math.min(100, (100 * sum) / denom));
      }
      for (const s of scanRows) {
        const r = rBySession.get(s.session_id);
        if (!r) continue;
        if (s.ihs_score == null) continue;
        joined.push({
          sessionId: s.session_id,
          ihs: Number(s.ihs_score),
          n1: (s.n1_scaled_100 != null ? Number(s.n1_scaled_100) : computeN1Scaled(s.card_selections?.allResponses)),
          n2: s.n2_score == null ? null : Number(s.n2_score),
          n3: s.n3_score == null ? null : Number(s.n3_score),
          who5Total: r.who5Total,
          swlsTotal: r.swlsTotal,
          cantril: r.cantril,
          selections: s.card_selections,
          scan_user_agent: s.user_agent || null
        });
      }

      function isMobileUA(ua) {
        if (!ua || typeof ua !== 'string') return false;
        return /(Mobi|Android|iPhone|iPad|iPod)/i.test(ua);
      }
      if (device === 'mobile') {
        joined = joined.filter(j => isMobileUA(j.scan_user_agent));
      } else if (device === 'desktop') {
        joined = joined.filter(j => !isMobileUA(j.scan_user_agent));
      }
      if (modality || modalities.length > 0 || exclusive || excludeTimeouts || iat || sensitivityAllMax || (threshold != null) || excludeSwipe || timeoutsMax != null || timeoutsFracMax != null) {
        const matchers = {
          click: (m) => m === 'click',
          swipe: (m) => m === 'swipe-touch' || m === 'swipe-mouse',
          arrow: (m) => m === 'keyboard-arrow'
        };
        joined = joined.filter(j => {
          const all = j.selections?.allResponses;
          if (!Array.isArray(all)) return false;
          let counts = { click: 0, swipe: 0, arrow: 0, other: 0, total: 0 };
          for (const e of all) {
            const v = String(e?.inputModality || '').toLowerCase();
            if (matchers.click(v)) counts.click++; else if (matchers.swipe(v)) counts.swipe++; else if (matchers.arrow(v)) counts.arrow++; else counts.other++;
            counts.total++;
          }
          if (excludeSwipe && counts.swipe > 0) return false;
          if (excludeTimeouts) {
            if (all.some(e => e && e.response === null)) return false;
          }
          // allow limited timeouts if requested
          if (timeoutsMax != null || timeoutsFracMax != null) {
            const timeouts = all.filter(e => e && e.response === null).length;
            if (timeoutsMax != null && timeouts > timeoutsMax) return false;
            if (timeoutsFracMax != null && counts.total > 0 && (timeouts / counts.total) > timeoutsFracMax) return false;
          }
          if (iat) {
            const total = all.length;
            if (total < 24) return false;
            let invalid = 0;
            for (const e of all) {
              if (!e) { invalid++; continue; }
              if (e.response === null) { invalid++; continue; }
              const t = Number(e.responseTime);
              if (!Number.isFinite(t)) { invalid++; continue; }
              if (!(t > 300 && t < 2000)) invalid++;
            }
            const fracInvalid = total > 0 ? (invalid / total) : 1;
            if (fracInvalid > 0.10) return false;
          }
          if (sensitivityAllMax) {
            const who5Total = Number(j?.who5Total);
            const swlsTotal = Number(j?.swlsTotal);
            if ((Number.isFinite(who5Total) && who5Total >= 25) && (Number.isFinite(swlsTotal) && swlsTotal >= 21)) return false;
          }
          if (modality) {
            if (modality === 'click' && counts.click === 0) return false;
            if (modality === 'swipe' && counts.swipe === 0) return false;
            if (modality === 'arrow' && counts.arrow === 0) return false;
          } else if (modalities.length > 0) {
            const present = {
              click: counts.click > 0,
              swipe: counts.swipe > 0,
              arrow: counts.arrow > 0
            };
            if (!modalities.some(mod => present[mod])) return false;
          }
          if (exclusive) {
            const present = [counts.click > 0, counts.swipe > 0, counts.arrow > 0].filter(Boolean).length;
            if (present !== 1) return false;
          }
          if (threshold != null && counts.total > 0 && modality) {
            const frac = (modality === 'click' ? counts.click : modality === 'swipe' ? counts.swipe : counts.arrow) / counts.total;
            if ((frac * 100) < threshold) return false;
          }
          return true;
        });
      }

      // Compute component means/sds (on available non-null values)
      const whoVals = joined.map(j => j.who5Total).filter(v => v != null && Number.isFinite(Number(v)));
      const swlVals = joined.map(j => j.swlsTotal).filter(v => v != null && Number.isFinite(Number(v)));
      const canVals = joined.map(j => j.cantril).filter(v => v != null && Number.isFinite(Number(v)));
      const whoMean = mean(whoVals), whoSd = sd(whoVals);
      const swlMean = mean(swlVals), swlSd = sd(swlVals);
      const canMean = mean(canVals), canSd = sd(canVals);

      // Preserve a base copy before trimming for robustness table
      const joinedBase = joined.slice();
      // Optional trimming of outliers using 10th/90th percentiles
      if ((trimIhs && trimIhs > 0) || (trimScales && trimScales > 0)) {
        let ihsLo = null, ihsHi = null, whoLo = null, whoHi = null, swlLo = null, swlHi = null, canLo = null, canHi = null;
        if (trimIhs && trimIhs > 0) {
          const ihsVals = joined.map(j => Number(j.ihs)).filter(Number.isFinite);
          if (ihsVals.length >= 10) { ihsLo = quantile(ihsVals.slice(), Math.max(0, Math.min(0.5, trimIhs))); ihsHi = quantile(ihsVals.slice(), 1 - Math.max(0, Math.min(0.5, trimIhs))); }
        }
        if (trimScales && trimScales > 0) {
          if (whoVals.length >= 10) { whoLo = quantile(whoVals.slice(), Math.max(0, Math.min(0.5, trimScales))); whoHi = quantile(whoVals.slice(), 1 - Math.max(0, Math.min(0.5, trimScales))); }
          if (swlVals.length >= 10) { swlLo = quantile(swlVals.slice(), Math.max(0, Math.min(0.5, trimScales))); swlHi = quantile(swlVals.slice(), 1 - Math.max(0, Math.min(0.5, trimScales))); }
          if (canVals.length >= 10) { canLo = quantile(canVals.slice(), Math.max(0, Math.min(0.5, trimScales))); canHi = quantile(canVals.slice(), 1 - Math.max(0, Math.min(0.5, trimScales))); }
        }
        joined = joined.filter(j => {
          let keep = true;
          if (ihsLo != null && ihsHi != null && Number.isFinite(j.ihs)) { if (!(j.ihs >= ihsLo && j.ihs <= ihsHi)) keep = false; }
          if (keep && whoLo != null && whoHi != null && Number.isFinite(j.who5Total)) { if (!(j.who5Total >= whoLo && j.who5Total <= whoHi)) keep = false; }
          if (keep && swlLo != null && swlHi != null && Number.isFinite(j.swlsTotal)) { if (!(j.swlsTotal >= swlLo && j.swlsTotal <= swlHi)) keep = false; }
          if (keep && canLo != null && canHi != null && Number.isFinite(j.cantril)) { if (!(j.cantril >= canLo && j.cantril <= canHi)) keep = false; }
          return keep;
        });
      }

      // Per-session z-mean composite (require at least 2 present)
      const pairsIhs = [], pairsBench = [];
      // For yes-rate analysis
      const yesRates = [], benchForYes = [], n1ForYes = [];
      // For hypotheses (H1, H2, H3)
      const h1X = [], h1Y = [];
      const domainListAll = ['Basics', 'Self-development', 'Ambition', 'Vitality', 'Attraction'];
      const h2Data = domainListAll.reduce((m, d) => { m[d] = { x: [], y: [] }; return m; }, {});
      const perSession = [];
      const benchVals = [];
      // Keep data rows for potential CV scoring
      const cvRows = [];
      // For non-CV alternative score modes, capture predictions per session for downstream metrics
      let predBySession = (scoreMode === 'tuned' || scoreMode === 'n1' || scoreMode === 'n12') ? new Map() : null;
      for (const j of joined) {
        const zs = [];
        if (j.who5Total != null && Number.isFinite(j.who5Total) && Number.isFinite(whoSd) && whoSd > 0) zs.push((j.who5Total - whoMean) / whoSd);
        if (j.swlsTotal != null && Number.isFinite(j.swlsTotal) && Number.isFinite(swlSd) && swlSd > 0) zs.push((j.swlsTotal - swlMean) / swlSd);
        if (j.cantril != null && Number.isFinite(j.cantril) && Number.isFinite(canSd) && canSd > 0) zs.push((j.cantril - canMean) / canSd);
        if (zs.length >= 2 && j.ihs != null && Number.isFinite(j.ihs)) {
          const zMean = zs.reduce((a, b) => a + b, 0) / zs.length;
          // choose predictor: raw IHS or tuned blend
          let ihsPred = Number(j.ihs);
          // Optional per-person RT denoise for N1 component
          let n1Denoised = null; // raw sum scale (Σ 4*mult)
          let n1DenoisedScaled = null; // 0–100 scaled by trials presented
          if (rtDenoise) {
            const all = j.selections?.allResponses;
            if (Array.isArray(all) && all.length >= 5) {
              const validTs = all.map(e => Number(e && e.responseTime)).filter(t => Number.isFinite(t));
              if (validTs.length >= 5) {
                const loCut = quantile(validTs.slice(), 0.10);
                const hiCut = quantile(validTs.slice(), 0.90);
                // time multiplier similar to reliability block
                const timeMultiplier = (ms) => { const x = Math.max(0, Math.min(4000, Number(ms) || 0)); const lin = (4000 - x) / 4000; return Math.sqrt(Math.max(0, lin)); };
                let sum = 0;
                for (const e of all) {
                  if (!e || e.response !== true) continue; // only yes add affirmation
                  let t = Number(e.responseTime);
                  if (!Number.isFinite(t)) continue;
                  // per-person winsorize 10% and clamp to IAT window 300–2000 ms
                  t = Math.max(300, Math.min(2000, Math.max(loCut, Math.min(hiCut, t))));
                  sum += 4 * timeMultiplier(t);
                }
                n1Denoised = sum;
                const trials = all.length;
                const denom = 4 * Math.max(1, trials);
                n1DenoisedScaled = Math.max(0, Math.min(100, (100 * sum) / denom));
              }
            }
          }
          if (scoreMode === 'tuned' || scoreMode === 'n12') {
            // z-scale N1/N2/N3 within-joined
            const n1 = (n1Denoised != null ? n1Denoised : Number(j.n1)); const n2 = Number(j.n2); const n3 = Number(j.n3);
            if (Number.isFinite(n1) || Number.isFinite(n2) || Number.isFinite(n3)) {
              // lazy compute means/sds
              if (!global.__tmpStats) {
                const n1s = joined.map(r => (rtDenoise && Array.isArray(r?.selections?.allResponses)) ? null : Number(r.n1)).filter(Number.isFinite);
                const n2s = joined.map(r => Number(r.n2)).filter(Number.isFinite);
                const n3s = joined.map(r => Number(r.n3)).filter(Number.isFinite);
                global.__tmpStats = {
                  m1: mean(n1s), s1: sd(n1s),
                  m2: mean(n2s), s2: sd(n2s),
                  m3: mean(n3s), s3: sd(n3s)
                };
              }
              const { m1, s1, m2, s2, m3, s3 } = global.__tmpStats;
              const z1 = Number.isFinite(n1) && s1 > 0 ? (n1 - m1) / s1 : 0;
              const z2 = Number.isFinite(n2) && s2 > 0 ? (n2 - m2) / s2 : 0;
              const z3 = Number.isFinite(n3) && s3 > 0 ? (n3 - m3) / s3 : 0;
              if (scoreMode === 'tuned') {
                // simple fixed weights for now (front-end can evolve to CV)
                ihsPred = (0.5 * z1 + 0.3 * z2 + 0.2 * z3);
              } else {
                // n12: equal blend of N1 and N2 only
                ihsPred = (0.5 * z1 + 0.5 * z2);
              }
            }
          }
          if (scoreMode === 'n1') {
            // Use N1 scaled 0–100 (optionally RT-denoised scaled)
            const n1 = (n1DenoisedScaled != null ? n1DenoisedScaled : Number(j.n1));
            if (Number.isFinite(n1)) ihsPred = n1;
          }
          // Save for immediate modes
          pairsIhs.push(ihsPred);
          pairsBench.push(zMean);
          benchVals.push({ sessionId: j.sessionId, z: zMean, who5: j.who5Total, swls: j.swlsTotal, cantril: j.cantril });
          if (includePerSession) perSession.push({ sessionId: j.sessionId, ihs: Number(j.ihs), who5: j.who5Total, swls: j.swlsTotal, cantril: j.cantril, z_benchmark: zMean });
          if (predBySession) predBySession.set(j.sessionId, ihsPred);
          // H1 pairs: IHS predictor vs SWLS total
          if (Number.isFinite(ihsPred) && Number.isFinite(j.swlsTotal)) { h1X.push(ihsPred); h1Y.push(Number(j.swlsTotal)); }
          // Yes-rate for the same session (share of Yes among Yes/No; exclude null timeouts)
          const all = j.selections?.allResponses;
          // H2: per-domain affirmation vs SWLS
          if (Array.isArray(all) && Number.isFinite(j.swlsTotal)) {
            const timeMultiplier = (ms) => { const x = Math.max(0, Math.min(4000, Number(ms) || 0)); const lin = (4000 - x) / 4000; return Math.sqrt(Math.max(0, lin)); };
            const perDomain = domainListAll.reduce((m, d) => { m[d] = 0; return m; }, {});
            for (const e of all) {
              if (!e || e.response !== true) continue;
              const d = String(e.domain || ''); if (!domainListAll.includes(d)) continue;
              const t = Number(e.responseTime); if (!Number.isFinite(t)) continue;
              perDomain[d] += 4 * timeMultiplier(t);
            }
            for (const d of domainListAll) { h2Data[d].x.push(perDomain[d]); h2Data[d].y.push(Number(j.swlsTotal)); }
          }
          if (Array.isArray(all) && all.length) {
            let yes = 0, yn = 0;
            for (const e of all) { if (!e) continue; if (e.response === true) { yes++; yn++; } else if (e.response === false) { yn++; } }
            if (yn > 0) {
              yesRates.push(yes / yn);
              benchForYes.push(zMean);
              const n1use = Number.isFinite(Number(j.n1)) ? Number(j.n1) : null;
              n1ForYes.push(n1use);
            }
          }
          // Store row for CV mode
          cvRows.push({
            sessionId: j.sessionId,
            label: zMean,
            n1: (rtDenoise ? (typeof n1Denoised === 'number' ? n1Denoised : Number(j.n1)) : Number(j.n1)),
            n2: Number(j.n2),
            n3: Number(j.n3),
            selections: j.selections
          });
        }
      }

      const n = Math.min(pairsIhs.length, pairsBench.length);
      console.log(`[Validity] Final n after all filters: ${n}, joined.length: ${joined.length}`);
      let r = null, ci95 = null;
      if (n >= 2) {
        const out = (method === 'spearman') ? spearman(pairsIhs, pairsBench) : pearson(pairsIhs, pairsBench);
        r = out.r;
        if (method === 'pearson') ci95 = fisherCIZ(r, out.n);
      }

      // Yes-rate analytics
      let yesrate = null;
      try {
        const nY = Math.min(yesRates.length, benchForYes.length);
        if (nY >= 2) {
          const corrFn = (method === 'spearman') ? spearman : pearson;
          const rY = corrFn(yesRates, benchForYes);
          const ciY = (method === 'pearson') ? fisherCIZ(rY.r, rY.n) : null;
          // AUC for top-25% benchmark using yes-rate
          let aucY = null; if (nY >= 10) { const thr = quantile(benchForYes.slice(), 0.75); const labels = benchForYes.map(b => (b >= thr ? 1 : 0)); aucY = aucFromScores(yesRates, labels).auc; }
          // Partial r controlling for N1 (Pearson on ranks if spearman)
          let partial = null;
          const validIdx = [];
          for (let i = 0; i < nY; i++) { if (Number.isFinite(yesRates[i]) && Number.isFinite(benchForYes[i]) && Number.isFinite(n1ForYes[i])) validIdx.push(i); }
          if (validIdx.length >= 3) {
            const x = validIdx.map(i => yesRates[i]);
            const y = validIdx.map(i => benchForYes[i]);
            const z = validIdx.map(i => n1ForYes[i]);
            const toRanks = (arr) => rankArray(arr);
            const X = (method === 'spearman') ? toRanks(x) : x;
            const Y = (method === 'spearman') ? toRanks(y) : y;
            const Z = (method === 'spearman') ? toRanks(z) : z;
            const rxy = pearson(X, Y).r;
            const rxz = pearson(X, Z).r;
            const ryz = pearson(Y, Z).r;
            const denom = Math.sqrt(Math.max(0, (1 - rxz * rxz))) * Math.sqrt(Math.max(0, (1 - ryz * ryz)));
            const rp = denom ? (rxy - rxz * ryz) / denom : null;
            partial = { r: rp, n: validIdx.length };
          }
          yesrate = { r: rY.r, n: rY.n, ci95: ciY, auc: aucY, partial_given_n1: partial };
        }
      } catch (_) { yesrate = null; }

      // Hypotheses H1, H2, H3
      let hypotheses = null;
      try {
        const corrFn = (method === 'spearman') ? spearman : pearson;
        // H1: IHS vs SWLS
        let h1 = null; if (Math.min(h1X.length, h1Y.length) >= 2) { const out = corrFn(h1X, h1Y); const ci = (method === 'pearson') ? fisherCIZ(out.r, out.n) : null; h1 = { r: out.r, n: out.n, ci95: ci, pass: (ci && ci[0] > 0) }; }
        // H2: each domain vs SWLS
        const domains = {}; let allPass = true; for (const d of domainListAll) { const xs = h2Data[d].x, ys = h2Data[d].y; const n = Math.min(xs.length, ys.length); if (n < 2) { domains[d] = { r: null, n, ci95: null, pass: false }; allPass = false; } else { const out = corrFn(xs, ys); const ci = (method === 'pearson') ? fisherCIZ(out.r, out.n) : null; const pass = (ci && ci[0] > 0); domains[d] = { r: out.r, n: out.n, ci95: ci, pass }; if (!pass) allPass = false; } }
        // H3: combined five clusters better than best single (nested regression ΔR²)
        let h3 = null; try {
          const rows = []; const m = {}, s = {}; for (const d of domainListAll) { const arr = h2Data[d].x.map(Number).filter(Number.isFinite); m[d] = mean(arr); s[d] = sd(arr); }
          const nRows = Math.min(...domainListAll.map(d => h2Data[d].x.length), h1Y.length);
          for (let i = 0; i < nRows; i++) { let ok = true; const zRow = []; for (const d of domainListAll) { const v = Number(h2Data[d].x[i]); if (!Number.isFinite(v) || !Number.isFinite(s[d]) || s[d] <= 0) { ok = false; break; } zRow.push((v - m[d]) / s[d]); } const y = Number(h2Data[domainListAll[0]].y[i]); if (!Number.isFinite(y)) ok = false; if (ok) rows.push({ z: zRow, y }); }
          if (rows.length >= 12) {
            const y = rows.map(rw => rw.y);
            const Xbest = rows.map(rw => [rw.z[0]]);
            const Xall = rows.map(rw => rw.z);
            function xtx(X) { const p = X[0].length + 1; const M = new Array(p).fill(0).map(() => new Array(p).fill(0)); for (let i = 0; i < X.length; i++) { const row = [1, ...X[i]]; for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) M[a][b] += row[a] * row[b]; } return M; }
            function xty(X, y) { const p = X[0].length + 1; const v = new Array(p).fill(0); for (let i = 0; i < X.length; i++) { const row = [1, ...X[i]]; for (let a = 0; a < p; a++) v[a] += row[a] * y[i]; } return v; }
            function matInv(A) { const n = A.length; const M = A.map(r => r.slice()); const I = new Array(n).fill(0).map((_, i) => { const r = new Array(n).fill(0); r[i] = 1; return r; }); for (let i = 0; i < n; i++) { let maxR = i, maxV = Math.abs(M[i][i]); for (let r = i + 1; r < n; r++) { const v = Math.abs(M[r][i]); if (v > maxV) { maxV = v; maxR = r; } } if (maxR !== i) { const t = M[i]; M[i] = M[maxR]; M[maxR] = t; const t2 = I[i]; I[i] = I[maxR]; I[maxR] = t2; } let piv = M[i][i]; if (Math.abs(piv) < 1e-12) return null; for (let j = 0; j < n; j++) { M[i][j] /= piv; I[i][j] /= piv; } for (let r = 0; r < n; r++) if (r !== i) { const f = M[r][i]; for (let j = 0; j < n; j++) { M[r][j] -= f * M[i][j]; I[r][j] -= f * I[i][j]; } } } return I; }
            function matVec(M, v) { return M.map(row => row.reduce((s, a, i) => s + a * v[i], 0)); }
            function r2For(X, y) { const XT = xtx(X); const Xy = xty(X, y); const inv = matInv(XT); if (!inv) return { r2: 0 }; const beta = matVec(inv, Xy); let ssTot = 0, ssRes = 0; const yM = mean(y); for (let i = 0; i < X.length; i++) { const row = [1, ...X[i]]; const yhat = row.reduce((s, a, idx) => s + a * beta[idx], 0); const err = y[i] - yhat; ssRes += err * err; const d = y[i] - yM; ssTot += d * d; } return { r2: (ssTot > 0 ? 1 - ssRes / ssTot : 0) }; }
            const base = r2For(Xbest, y), full = r2For(Xall, y); const df1 = 4, df2 = rows.length - 5 - 1; let F = null, pF = null, dR2 = null; if (df2 > 0) { dR2 = Math.max(0, full.r2 - base.r2); F = (dR2 / df1) / ((1 - full.r2) / df2); const cdf = fCdf(F, df1, df2); pF = (Number.isFinite(cdf) ? (1 - cdf) : null); }
            h3 = { delta_r2: dR2, f: F, df1, df2, p: pF, pass: (dR2 != null && dR2 > 0 && pF != null && pF < 0.05) };
          }
        } catch (_) { /* ignore */ }
        hypotheses = { h1, h2: { domains, all_pass: allPass }, h3 };
      } catch (_) { hypotheses = null; }

      // Optional CV scoring mode with learned weights (and optional RT exponent learning)
      let cvInfo = null;
      if (scoreMode === 'cv' && Array.isArray(cvRows) && cvRows.length >= 20) {
        // Helper: quantile
        const qtile = (arr, q) => { if (!arr.length) return NaN; const a = arr.slice().sort((x, y) => x - y); const pos = (a.length - 1) * q; const base = Math.floor(pos); const rest = pos - base; return a[base + 1] !== undefined ? a[base] + rest * (a[base + 1] - a[base]) : a[base]; };
        // Compute per-person N1 under exponent alpha
        function n1WithAlpha(row, alpha) {
          if (!rtLearn) return Number(row.n1);
          const all = row?.selections?.allResponses;
          if (!Array.isArray(all) || all.length < 5) return Number(row.n1);
          const validTs = all.map(e => Number(e && e.responseTime)).filter(t => Number.isFinite(t));
          if (validTs.length < 5) return Number(row.n1);
          const loCut = qtile(validTs.slice(), 0.10);
          const hiCut = qtile(validTs.slice(), 0.90);
          const timeMultiplier = (ms) => { const x = Math.max(0, Math.min(4000, Number(ms) || 0)); const lin = (4000 - x) / 4000; return Math.pow(Math.max(0, lin), alpha); };
          let sum = 0;
          for (const e of all) {
            if (!e || e.response !== true) continue;
            let t = Number(e.responseTime);
            if (!Number.isFinite(t)) continue;
            t = Math.max(300, Math.min(2000, Math.max(loCut, Math.min(hiCut, t))));
            sum += 4 * timeMultiplier(t);
          }
          return sum;
        }
        function ridgeFit(X, y, lambda) {
          const p = X[0].length + 1;
          function xtx(X) { const M = new Array(p).fill(0).map(() => new Array(p).fill(0)); for (let i = 0; i < X.length; i++) { const row = [1, ...X[i]]; for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) M[a][b] += row[a] * row[b]; } return M; }
          function xty(X, y) { const v = new Array(p).fill(0); for (let i = 0; i < X.length; i++) { const row = [1, ...X[i]]; for (let a = 0; a < p; a++) v[a] += row[a] * y[i]; } return v; }
          function matInv(A) {
            const n = A.length;
            const M = A.map(r => r.slice());
            const I = new Array(n).fill(0).map((_, i) => { const r = new Array(n).fill(0); r[i] = 1; return r; });
            for (let i = 0; i < n; i++) {
              let maxR = i, maxV = Math.abs(M[i][i]);
              for (let r = i + 1; r < n; r++) { const v = Math.abs(M[r][i]); if (v > maxV) { maxV = v; maxR = r; } }
              if (maxR !== i) { const t = M[i]; M[i] = M[maxR]; M[maxR] = t; const t2 = I[i]; I[i] = I[maxR]; I[maxR] = t2; }
              let piv = M[i][i]; if (Math.abs(piv) < 1e-12) return null;
              for (let j = 0; j < n; j++) { M[i][j] /= piv; I[i][j] /= piv; }
              for (let r = 0; r < n; r++) if (r !== i) { const f = M[r][i]; for (let j = 0; j < n; j++) { M[r][j] -= f * M[i][j]; I[r][j] -= f * I[i][j]; } }
            }
            return I;
          }
          function matVec(M, v) { return M.map(row => row.reduce((s, a, i) => s + a * v[i], 0)); }
          const XT = xtx(X);
          for (let i = 1; i < p; i++) XT[i][i] += lambda;
          const Xy = xty(X, y);
          const inv = matInv(XT);
          if (!inv) return null;
          return matVec(inv, Xy);
        }
        function predictRow(beta, z1, z2, z3) { return beta[0] + beta[1] * z1 + beta[2] * z2 + beta[3] * z3; }
        // Optional: learn RT exponent alpha
        let alphaBest = 0.5;
        if (rtLearn) {
          let best = { alpha: 0.5, r: -Infinity };
          for (const a of [0.25, 0.35, 0.5, 0.65, 0.75]) {
            const xs = [];
            const ys = [];
            for (const row of cvRows) {
              const n1 = n1WithAlpha(row, a);
              if (!Number.isFinite(n1) || !Number.isFinite(row.n2) || !Number.isFinite(row.n3) || !Number.isFinite(row.label)) continue;
              xs.push([n1, row.n2, row.n3]);
              ys.push(row.label);
            }
            if (xs.length < 10) continue;
            const n1s = xs.map(r => r[0]), n2s = xs.map(r => r[1]), n3s = xs.map(r => r[2]);
            const m1 = mean(n1s), s1 = sd(n1s), m2 = mean(n2s), s2 = sd(n2s), m3 = mean(n3s), s3 = sd(n3s);
            const Z = xs.map(r => [(r[0] - m1) / s1, (r[1] - m2) / s2, (r[2] - m3) / s3]);
            const beta = ridgeFit(Z, ys, 1);
            if (!beta) continue;
            const preds = Z.map(row => predictRow(beta, row[0], row[1], row[2]));
            const r = pearson(preds, ys).r;
            if (r > best.r) best = { alpha: a, r };
          }
          alphaBest = best.alpha;
        }

        const X = [];
        const y = [];
        const ids = [];
        for (const row of cvRows) {
          const n1 = n1WithAlpha(row, alphaBest);
          if (!Number.isFinite(n1) || !Number.isFinite(row.n2) || !Number.isFinite(row.n3) || !Number.isFinite(row.label)) continue;
          X.push([n1, row.n2, row.n3]);
          y.push(row.label);
          ids.push(row.sessionId);
        }
        if (X.length >= 20) {
          const n1s = X.map(r => r[0]), n2s = X.map(r => r[1]), n3s = X.map(r => r[2]);
          const m1 = mean(n1s), s1 = sd(n1s), m2 = mean(n2s), s2 = sd(n2s), m3 = mean(n3s), s3 = sd(n3s);
          const Z = X.map(r => [(r[0] - m1) / s1, (r[1] - m2) / s2, (r[2] - m3) / s3]);
          const beta = ridgeFit(Z, y, 1);
          if (beta) {
            const preds = Z.map(row => predictRow(beta, row[0], row[1], row[2]));
            const corr = pearson(preds, y);
            const w = { n1: beta[1], n2: beta[2], n3: beta[3] };
            cvInfo = { n: y.length, r: corr.r, weights: w, alpha: alphaBest, intercept: beta[0] };
          }
        }
      }

      // Robustness: compare base vs trimmed correlations (simple LOO summary)
      function summarize(joinedLocal) {
        const pairs = [];
        for (const j of joinedLocal) {
          if (j.ihs == null || !Number.isFinite(j.ihs)) continue;
          const zs = [];
          if (j.who5Total != null && Number.isFinite(j.who5Total) && Number.isFinite(whoSd) && whoSd > 0) zs.push((j.who5Total - whoMean) / whoSd);
          if (j.swlsTotal != null && Number.isFinite(j.swlsTotal) && Number.isFinite(swlSd) && swlSd > 0) zs.push((j.swlsTotal - swlMean) / swlSd);
          if (j.cantril != null && Number.isFinite(j.cantril) && Number.isFinite(canSd) && canSd > 0) zs.push((j.cantril - canMean) / canSd);
          if (zs.length >= 2) pairs.push({ ihs: Number(j.ihs), z: zs.reduce((a, b) => a + b, 0) / zs.length });
        }
        const x = pairs.map(p => p.ihs);
        const y = pairs.map(p => p.z);
        if (x.length < 2) return { r: null, n: x.length };
        const out = (method === 'spearman') ? spearman(x, y) : pearson(x, y);
        return { r: out.r, n: out.n };
      }
      const robustness = {
        base: summarize(joinedBase),
        trimmed: summarize(joined)
      };

      // Attenuation: reliability adjustment for observed correlation
      let ihsReliability = null;
      try {
        const half = Math.floor(joined.length / 2);
        const splitA = joined.slice(0, half);
        const splitB = joined.slice(half);
        function computeIhsFromSelections(sel) {
          const all = sel?.allResponses;
          if (!Array.isArray(all) || all.length === 0) return null;
          const timeMultiplier = (ms) => { const x = Math.max(0, Math.min(4000, Number(ms) || 0)); const lin = (4000 - x) / 4000; return Math.sqrt(Math.max(0, lin)); };
          let n1 = 0, n2 = 0, n3 = 0;
          const domains = ['Basics', 'Self-development', 'Ambition', 'Vitality', 'Attraction'];
          const domainCounts = domains.reduce((m, d) => { m[d] = 0; return m; }, {});
          let totalYes = 0;
          for (const e of all) {
            if (!e || e.response !== true) continue;
            totalYes++;
            const d = String(e.domain || '');
            if (domainCounts[d] != null) domainCounts[d] += 1;
            const t = Number(e.responseTime);
            if (Number.isFinite(t)) n1 += 4 * timeMultiplier(t);
          }
          const trials = all.length;
          const denom = 4 * Math.max(1, trials);
          const n1Scaled = Math.max(0, Math.min(100, (100 * n1) / denom));
          const covered = Object.values(domainCounts).filter(v => v > 0).length;
          n2 = (covered / 5) * 100;
          if (totalYes > 0) {
            const props = Object.values(domainCounts).map(v => v / totalYes);
            const deviation = props.reduce((s, p) => s + Math.abs(p - 0.2), 0);
            n3 = Math.max(0, (1.6 - deviation) / 1.6 * 100);
          } else {
            n3 = 0;
          }
          return 0.4 * n1Scaled + 0.4 * n2 + 0.2 * n3;
        }
        const halfIhsA = splitA.map(j => computeIhsFromSelections(j.selections)).filter(Number.isFinite);
        const halfIhsB = splitB.map(j => computeIhsFromSelections(j.selections)).filter(Number.isFinite);
        const nHalf = Math.min(halfIhsA.length, halfIhsB.length);
        if (nHalf >= 3) {
          const rHalf = pearson(halfIhsA.slice(0, nHalf), halfIhsB.slice(0, nHalf)).r;
          ihsReliability = (2 * rHalf) / (1 + rHalf);
        }
      } catch (_) {}

      // Benchmark reliability via split-half for z benchmark
      let benchmarkOmega = null;
      try {
        const A = joinedBase.slice(0, Math.floor(joinedBase.length / 2));
        const B = joinedBase.slice(Math.floor(joinedBase.length / 2));
        function zBenchmark(list) {
          const whoVals = list.map(j => j.who5Total).filter(Number.isFinite);
          const swlVals = list.map(j => j.swlsTotal).filter(Number.isFinite);
          const canVals = list.map(j => j.cantril).filter(Number.isFinite);
          const whoMean = mean(whoVals), whoSd = sd(whoVals);
          const swlMean = mean(swlVals), swlSd = sd(swlVals);
          const canMean = mean(canVals), canSd = sd(canVals);
          const out = [];
          for (const j of list) {
            const zs = [];
            if (Number.isFinite(j.who5Total) && Number.isFinite(whoSd) && whoSd > 0) zs.push((j.who5Total - whoMean) / whoSd);
            if (Number.isFinite(j.swlsTotal) && Number.isFinite(swlSd) && swlSd > 0) zs.push((j.swlsTotal - swlMean) / swlSd);
            if (Number.isFinite(j.cantril) && Number.isFinite(canSd) && canSd > 0) zs.push((j.cantril - canMean) / canSd);
            if (zs.length >= 2) out.push(zs.reduce((a, b) => a + b, 0) / zs.length);
          }
          return out;
        }
        const zA = zBenchmark(A);
        const zB = zBenchmark(B);
        const nZ = Math.min(zA.length, zB.length);
        if (nZ >= 3) {
          const rHalf = pearson(zA.slice(0, nZ), zB.slice(0, nZ)).r;
          benchmarkOmega = (2 * rHalf) / (1 + rHalf);
        }
      } catch (_) {}

      // Attenuation correction
      let attenuation = null;
      try {
        if (r != null && ihsReliability && benchmarkOmega) {
          const denom = Math.sqrt(ihsReliability * benchmarkOmega);
          attenuation = denom ? (r / denom) : null;
        }
      } catch (_) {}

      // ROC: classify top quartile benchmark vs others
      let roc = null;
      let rocAux = {};
      try {
        if (benchVals.length >= 20) {
          const thr = quantile(benchVals.map(b => b.z), 0.75);
          const labels = benchVals.map(b => (b.z >= thr ? 1 : 0));
          const scores = benchVals.map(b => b.z);
          roc = aucFromScores(scores, labels).auc;
          rocAux = { who5: aucFromScores(benchVals.map(b => b.who5), labels).auc, swls: aucFromScores(benchVals.map(b => b.swls), labels).auc, cantril: aucFromScores(benchVals.map(b => b.cantril), labels).auc };
          const best = [
            ['who5', rocAux.who5],
            ['swls', rocAux.swls],
            ['cantril', rocAux.cantril]
          ].sort((a, b) => (b[1] || 0) - (a[1] || 0))[0];
          rocAux.best = best ? best[1] : null;
          rocAux.best_name = best ? best[0] : null;
        }
      } catch (_) {}

      // Non-inferiority check: compare IHS to best component
      let nonInferiority = null;
      try {
        const comp = {
          who5: pearson(benchVals.map(b => b.who5), benchVals.map(b => b.z)),
          swls: pearson(benchVals.map(b => b.swls), benchVals.map(b => b.z)),
          cantril: pearson(benchVals.map(b => b.cantril), benchVals.map(b => b.z))
        };
        const best = Object.entries(comp).sort((a, b) => (b[1].r || 0) - (a[1].r || 0))[0];
        nonInferiority = { best_component: best ? best[0] : null, best_r: best ? best[1].r : null };
      } catch (_) {}

      // Components vs benchmark
      let compsVsB = null;
      try {
        compsVsB = {
          who5: pearson(benchVals.map(b => b.who5), benchVals.map(b => b.z)),
          swls: pearson(benchVals.map(b => b.swls), benchVals.map(b => b.z)),
          cantril: pearson(benchVals.map(b => b.cantril), benchVals.map(b => b.z))
        };
      } catch (_) {}

      // Regression summary for components predicting benchmark
      let regression = null;
      try {
        const rows = benchVals.map(b => [b.who5, b.swls, b.cantril, b.z]).filter(r => r.every(Number.isFinite));
        if (rows.length >= 10) {
          const y = rows.map(r => r[3]);
          const X = rows.map(r => [r[0], r[1], r[2]]);
          function xtx(X) { const p = X[0].length + 1; const M = new Array(p).fill(0).map(() => new Array(p).fill(0)); for (let i = 0; i < X.length; i++) { const row = [1, ...X[i]]; for (let a = 0; a < p; a++) for (let b = 0; b < p; b++) M[a][b] += row[a] * row[b]; } return M; }
          function xty(X, y) { const p = X[0].length + 1; const v = new Array(p).fill(0); for (let i = 0; i < X.length; i++) { const row = [1, ...X[i]]; for (let a = 0; a < p; a++) v[a] += row[a] * y[i]; } return v; }
          function matInv(A) { const n = A.length; const M = A.map(r => r.slice()); const I = new Array(n).fill(0).map((_, i) => { const r = new Array(n).fill(0); r[i] = 1; return r; }); for (let i = 0; i < n; i++) { let maxR = i, maxV = Math.abs(M[i][i]); for (let r = i + 1; r < n; r++) { const v = Math.abs(M[r][i]); if (v > maxV) { maxV = v; maxR = r; } } if (maxR !== i) { const t = M[i]; M[i] = M[maxR]; M[maxR] = t; const t2 = I[i]; I[i] = I[maxR]; I[maxR] = t2; } let piv = M[i][i]; if (Math.abs(piv) < 1e-12) return null; for (let j = 0; j < n; j++) { M[i][j] /= piv; I[i][j] /= piv; } for (let r = 0; r < n; r++) if (r !== i) { const f = M[r][i]; for (let j = 0; j < n; j++) { M[r][j] -= f * M[i][j]; I[r][j] -= f * I[i][j]; } } } return I; }
          function matVec(M, v) { return M.map(row => row.reduce((s, a, i) => s + a * v[i], 0)); }
          function r2For(X, y) { const XT = xtx(X); const Xy = xty(X, y); const inv = matInv(XT); if (!inv) return { r2: 0 }; const beta = matVec(inv, Xy); let ssTot = 0, ssRes = 0; const yM = mean(y); for (let i = 0; i < X.length; i++) { const row = [1, ...X[i]]; const yhat = row.reduce((s, a, idx) => s + a * beta[idx], 0); const err = y[i] - yhat; ssRes += err * err; const d = y[i] - yM; ssTot += d * d; } return { r2: (ssTot > 0 ? 1 - ssRes / ssTot : 0) }; }
          const out = r2For(X, y);
          regression = { r2: out.r2 };
        }
      } catch (_) {}

      // Reliability of IHS vs benchmark omega
      const reliability = { ihs_sb: ihsReliability, benchmark_omega: benchmarkOmega };

      // Ceiling analysis
      let ceiling = null;
      try {
        const ihsVals = joined.map(j => j.ihs).filter(Number.isFinite);
        const whoVals = joined.map(j => j.who5Total).filter(Number.isFinite);
        const swlVals = joined.map(j => j.swlsTotal).filter(Number.isFinite);
        const canVals = joined.map(j => j.cantril).filter(Number.isFinite);
        ceiling = {
          ihs: { mean: mean(ihsVals), sd: sd(ihsVals), skew: skewness(ihsVals), kurtosis: kurtosisExcess(ihsVals) },
          who5: { mean: mean(whoVals), sd: sd(whoVals), skew: skewness(whoVals), kurtosis: kurtosisExcess(whoVals) },
          swls: { mean: mean(swlVals), sd: sd(swlVals), skew: skewness(swlVals), kurtosis: kurtosisExcess(swlVals) },
          cantril: { mean: mean(canVals), sd: sd(canVals), skew: skewness(canVals), kurtosis: kurtosisExcess(canVals) }
        };
      } catch (_) {}

      // ROC summary
      const rocSummary = roc == null ? null : roc;

      // Robustness/perf grader
      let grader = null;
      try {
        const reasons = [];
        if (r != null) {
          if (r >= 0.5) reasons.push('Strong correlation');
          if (r >= 0.35) reasons.push('Moderate correlation');
        }
        if (hypotheses && hypotheses.h1) {
          reasons.push(`H1 (IHS vs SWLS): r=${(hypotheses.h1.r ?? NaN).toFixed(3)} ${hypotheses.h1.pass ? 'PASS' : 'FAIL'}`);
        }
        if (hypotheses && hypotheses.h2 && hypotheses.h2.domains) {
          const fails = Object.entries(hypotheses.h2.domains).filter(([_, v]) => v && v.pass === false).map(([k]) => k);
          reasons.push(`H2 (clusters vs SWLS): ${fails.length ? `FAIL ${fails.join(', ')}` : 'PASS all'}`);
        }
        if (hypotheses && hypotheses.h3) {
          reasons.push(`H3 (combined > best single): ΔR²=${(hypotheses.h3.delta_r2 ?? 0).toFixed(3)} p=${(hypotheses.h3.p == null ? '—' : hypotheses.h3.p.toExponential(2))} ${hypotheses.h3.pass ? 'PASS' : 'FAIL'}`);
        }
        grader = { reasons };
      } catch (_) { grader = null; }

      const payload = {
        n_used: n,
        method,
        correlation: { r, n, ci95: (ci95 ? [ci95[0], ci95[1]] : null) },
        benchmark: {
          method: 'z_mean',
          components: {
            who5: { mean: whoMean, sd: whoSd },
            swls: { mean: swlMean, sd: swlSd },
            cantril: { mean: canMean, sd: canSd }
          }
        },
        non_inferiority: nonInferiority,
        components_vs_benchmark: compsVsB,
        regression,
        reliability: { ihs_sb: ihsReliability, benchmark_omega: benchmarkOmega },
        attenuation,
        ceiling,
        roc: rocSummary,
        roc_aux: { who5: rocAux.who5, swls: rocAux.swls, cantril: rocAux.cantril, best: rocAux.best, best_name: rocAux.best_name },
        robustness,
        hypotheses,
        yesrate,
        cv: cvInfo,
        filters_echo: { device, method, modality, exclusive, excludeTimeouts, iat, sensitivityAllMax, threshold, sex, country, countries, ageMin, ageMax, excludeCountries },
        grader
      };
      if (includePerSession) payload.perSession = perSession;
      payload.usedSessions = joined.length;
      __validityCache.set(cacheKey, { at: Date.now(), ttlMs: 5000, data: payload });
      res.json({ ...payload, cache: { hit: false } });
    } finally {
      researchClient.release();
      mainClient.release();
    }
  } catch (e) {
    console.error('Error computing validity analytics:', e);
    const debug = String(req.query.debug || '').toLowerCase() === '1';
    if (debug) {
      res.status(500).json({ error: 'Failed to compute validity analytics', message: e?.message || null, stack: e?.stack || null });
    } else {
      res.status(500).json({ error: 'Failed to compute validity analytics' });
    }
  }
});

module.exports = router;
