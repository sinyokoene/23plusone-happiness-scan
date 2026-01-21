// 23plusone Happiness Scan - Results and reporting
'use strict';

function displayEnhancedResults(results) {
  // Persist latest results for report request flow
  try { window.LATEST_RESULTS = results; } catch(_) {}
  // Persist quality metrics for PDF
  try {
    if (typeof window !== 'undefined') {
      if (typeof results?.completionTime === 'number') window.LATEST_COMPLETION_TIME = results.completionTime;
      if (typeof results?.unansweredCount === 'number') window.LATEST_UNANSWERED = results.unansweredCount;
    }
  } catch(_) {}
  // Update main score
  document.getElementById('totalScore').textContent = `${results.n1}`;

  // Get domain data for visualization
  const domainData = getDomainAnalysis(results.domainCounts);

  // Update dominant domains text (optional element)
  const topDomainsText = getDominantDomainsText(domainData);
  const topDomainsEl = document.getElementById('topDomains');
  if (topDomainsEl) {
    topDomainsEl.textContent = topDomainsText;
  }
  // Personalized insight block (card-aware insights)
  const insightHtml = buildPersonalizedInsight(domainData, answers);
  const insightBlock = document.getElementById('insightBlock');
  if (insightBlock && insightHtml) {
    insightBlock.innerHTML = insightHtml;
  }
  // Store selected card IDs globally for PDF report
  try {
    window.LATEST_SELECTED_CARDS = answers.filter(a => a.yes === true).map(a => a.id);
    window.LATEST_ANSWERS = answers;
  } catch(_) {}

  // Update domain bars with animation (use time‑weighted affirmation totals)
  updateDomainBars(results.domainAffirmations);

  // Insights removed in current design

  // Ensure report request UI is wired once
  try {
    setupReportRequestUI();
    // Fetch benchmark immediately and stash for PDF
    (async () => {
      try {
        const ihs = Number(results?.ihs);
        const domainCounts = results?.domainCounts || {};
        // Benchmark API call removed - now handled by getBenchmarkData() to avoid duplicate calls
        // which were causing percentile discrepancy between scan results and PDF report
      } catch(_) {}
    })();
  } catch(_) {}

  // Desktop-only results hint row
  try {
    const topRow = document.getElementById('resultsTopRow');
    if (topRow) {
      topRow.style.display = (isDesktop ? 'flex' : 'none');
    }
  } catch(_) {}
}

function getDomainAnalysis(domainCounts) {
  const domains = [
    { name: 'Basics', count: domainCounts['Basics'] || 0, color: '#4CAF50', max: 6 },
    { name: 'Self-development', count: domainCounts['Self-development'] || 0, color: '#FF9800', max: 6 },
    { name: 'Ambition', count: domainCounts['Ambition'] || 0, color: '#9C27B0', max: 8 },
    { name: 'Vitality', count: domainCounts['Vitality'] || 0, color: '#2196F3', max: 2 },
    { name: 'Attraction', count: domainCounts['Attraction'] || 0, color: '#E91E63', max: 2 }
  ];

  // Sort by count and calculate percentages
  domains.forEach(domain => {
    domain.percentage = (domain.count / domain.max) * 100;
  });

  domains.sort((a, b) => b.count - a.count);

  return domains;
}

function getDominantDomainsText(domainData) {
  const topDomains = domainData.filter(d => d.count > 0).slice(0, 2);

  if (topDomains.length === 0) return "exploration and discovery";
  if (topDomains.length === 1) return topDomains[0].name.toLowerCase();

  const domainNames = {
    'Basics': 'fundamentals',
    'Self-development': 'growth',
    'Ambition': 'achievement',
    'Vitality': 'energy',
    'Attraction': 'beauty'
  };

  return `${domainNames[topDomains[0].name]} and ${domainNames[topDomains[1].name]}`;
}

function buildPersonalizedInsight(domainData, answersData) {
  if (!domainData || domainData.length === 0) return '';

  const selectedCards = (answersData || []).filter(a => a.yes === true);
  const selectedIds = selectedCards.map(a => a.id);
  const totalSelected = selectedCards.length;
  const topDomain = domainData[0];

  // Helper to pick random item from array
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

  // Get card insights from loaded data
  const ci = cardInsightsData || {};
  const cardData = ci.cards || {};
  const patterns = ci.patterns || {};
  const domainSummaries = ci.domainSummaries || {};

  // Build card-specific value references
  const getCardValue = (id) => cardData[String(id)]?.value || null;
  const getCardShortInsight = (id) => cardData[String(id)]?.shortInsight || null;

  // Get top 2-3 cards by fastest response time (strong signals)
  const fastCards = [...selectedCards]
    .sort((a, b) => a.time - b.time)
    .slice(0, 3);
  const fastValues = fastCards.map(c => getCardValue(c.id)).filter(Boolean);

  // Detect patterns and sort by match strength
  const detectedPatterns = [];
  for (const [key, pattern] of Object.entries(patterns)) {
    const matchingCardIds = pattern.requires.filter(id => selectedIds.includes(id));
    const matchCount = matchingCardIds.length;
    if (matchCount >= (pattern.minMatch || 2)) {
      // Calculate average response time for matched cards (lower = faster = stronger signal)
      const matchedAnswers = selectedCards.filter(a => matchingCardIds.includes(a.id));
      const avgResponseTime = matchedAnswers.length > 0
        ? matchedAnswers.reduce((sum, a) => sum + (a.time || 4000), 0) / matchedAnswers.length
        : 4000;

      detectedPatterns.push({
        key,
        matchCount,
        matchPct: matchCount / pattern.requires.length,
        avgResponseTime,
        ...pattern
      });
    }
  }
  // Sort by: 1) match count, 2) match percentage, 3) faster response time wins ties
  detectedPatterns.sort((a, b) => {
    if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
    if (b.matchPct !== a.matchPct) return b.matchPct - a.matchPct;
    return a.avgResponseTime - b.avgResponseTime; // faster (lower time) wins
  });

  // Build insight text - keep it SHORT for scan results (details in PDF report)
  let parts = [];

  // Opening: Reference specific values from fastest responses (gut feeling signals)
  const isDutch = document.documentElement.lang === 'nl';
  if (fastValues.length >= 2) {
    const valuesStr = fastValues.slice(0, 2).join(isDutch ? ' en ' : ' and ');
    parts.push(isDutch
      ? `Jouw snelle reacties op ${valuesStr} onthullen wat echt belangrijk voor je is.`
      : `Your quick responses to ${valuesStr} reveal what truly matters to you.`);
  } else if (fastValues.length === 1) {
    parts.push(isDutch
      ? `${fastValues[0]} springt eruit als een belangrijke drijfveer voor jou.`
      : `${fastValues[0]} stands out as a core driver for you.`);
  }

  // One domain summary based on score band
  const getBand = (count, max) => {
    const pct = (count / max) * 100;
    if (pct >= 66) return 'high';
    if (pct >= 34) return 'mid';
    return 'low';
  };
  const topDomainBand = getBand(topDomain.count, topDomain.max);
  const summaries = domainSummaries[topDomain.name];
  if (summaries && summaries[topDomainBand]) {
    parts.push(pick(summaries[topDomainBand]));
  }

  // Simple closing - encourage full report
  parts.push(isDutch
    ? "Vraag je volledige rapport aan voor gedetailleerde inzichten."
    : "Request your full report for detailed insights.");

  return parts.join(' ').trim();
}

function updateDomainBars(domainAffirmations) {
  // Maximum affirmation per domain = maxYesCount * 4 (fastest response score)
  const domainMaxAffirmation = {
    'Basics': 6 * 4,
    'Self-development': 6 * 4,
    'Ambition': 8 * 4,
    'Vitality': 2 * 4,
    'Attraction': 2 * 4
  };

  console.log('Updating domain bars with affirmation totals:', domainAffirmations);

  Object.keys(domainMaxAffirmation).forEach(domain => {
    const totalAffirmation = domainAffirmations[domain] || 0;
    const percentage = (totalAffirmation / domainMaxAffirmation[domain]) * 100;

    // Count display removed from UI; skip updating

    // Animate bar
    setTimeout(() => {
      const barFill = document.querySelector(`[data-domain="${domain}"] .bar-fill`);
      if (barFill) {
        barFill.style.width = percentage + '%';
      }

      // Update progress bar ARIA attributes
      const barContainer = document.querySelector(`[data-domain="${domain}"] .bar-container`);
      if (barContainer) {
        barContainer.setAttribute('aria-valuenow', Math.round(totalAffirmation));
      }
    }, 500);
  });
}

function generatePersonalizedInsights() { /* removed */ }

function submitResults(results) {
  // Create complete card selections with ALL responses
  const cardSelections = {
    domains: [],
    selected: [],    // Cards answered "Yes"
    rejected: [],    // Cards answered "No"
    allResponses: [] // Complete response data
  };

  // Process ALL answers (Yes, No, and NULL timeouts)
  answers.forEach(answer => {
    const clamped = Math.max(0, Math.min(4000, answer.time));
    const timeMultiplier = (4000 - clamped) / 4000; // 1.0 → 0.0
    const perCardScore = 4 * timeMultiplier;
    const sign = (answer.yes === true) ? 1 : (answer.yes === false) ? -1 : null;
    const affirmationScore = sign === null ? null : Math.round(sign * perCardScore * 100) / 100;

    // Add to complete responses
    cardSelections.allResponses.push({
      cardId: answer.id,
      domain: answer.domain,
      label: answer.label,
      response: answer.yes, // true/false/null
      responseTime: answer.time,
      inputModality: answer.modality || 'unknown',
      affirmationScore: affirmationScore
    });

    // Track selected vs rejected (ignore NULL)
    if (answer.yes === true) {
      cardSelections.selected.push(answer.id);
    } else if (answer.yes === false) {
      cardSelections.rejected.push(answer.id);
    }

    // Track unique domains from all responses
    if (!cardSelections.domains.includes(answer.domain)) {
      cardSelections.domains.push(answer.domain);
    }
  });

  const modalityCounts = answers.reduce((acc, a) => {
    const k = a.modality || 'unknown';
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

  const payload = {
    sessionId: (window.RESEARCH_MODE ? participantId : `${participantId}-${Date.now()}`),
    participantId: participantId,
    cardSelections: cardSelections,
    ihsScore: results.ihs,
    n1Score: results.n1, // Now properly sending calculated N1 score
    n2Score: results.n2, // Now properly sending calculated N2 score
    n3Score: results.n3, // Now properly sending calculated N3 score
    completionTime: scanStartTime > 0 ? Math.round((Date.now() - scanStartTime) / 1000) : 0,
    userAgent: navigator.userAgent,
    totalCards: answers.length, // Should be 24
    selectedCount: cardSelections.selected.length,
    rejectedCount: cardSelections.rejected.length,
    unansweredCount: answers.filter(a => a.yes === null).length,
    modalityCounts: modalityCounts
  };

  // Persist quality metrics globally for PDF/report usage
  try {
    if (typeof window !== 'undefined') {
      window.LATEST_COMPLETION_TIME = payload.completionTime;
      window.LATEST_UNANSWERED = payload.unansweredCount;
    }
  } catch(_) {}

  console.log('Submitting complete scan data:', {
    totalResponses: answers.length,
    selectedCards: cardSelections.selected.length,
    rejectedCards: cardSelections.rejected.length,
    domains: cardSelections.domains.length,
    ihsScore: results.ihs,
    n1Score: results.n1,
    n2Score: results.n2,
    n3Score: results.n3
  });

  fetch('/api/responses', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })
  .then(response => {
    if (!response.ok) {
      console.warn('Failed to submit results:', response.status);
    } else {
      console.log('Results submitted successfully - all 24 cards recorded');
    }
  })
  .catch(err => {
    console.warn('Error submitting results:', err);
  });
}

function setupSharing(results) {
  const nativeShareBtn = document.getElementById('nativeShareBtn');
  // Use full report btn as harmless anchor for status text if needed
  const fallbackStatusBtn = document.getElementById('fullReportBtn');

  const shareText = `I just completed the 23plusone Happiness Scan and scored ${results.n1} (N1). Discover what drives your happiness.`;
  const shareUrl = window.location.href;

  // Native share handler
  if (nativeShareBtn) nativeShareBtn.addEventListener('click', async () => {
    if (navigator.share) {
      try {
        await navigator.share({
          title: '23plusone Happiness Scan',
          text: shareText,
          url: shareUrl
        });
      } catch (err) {
        // User cancelled or error occurred, fallback to copy
        // Silently ignore if cancelled
      }
    } else {
      // Fallback for browsers without Web Share API
      copyToClipboard(shareUrl, fallbackStatusBtn);
    }
  });

  // No separate copy button in UI; keep function for fallback use

  async function copyToClipboard(text, button) {
    try {
      await navigator.clipboard.writeText(text);
      if (button) {
        const original = button.getAttribute('data-original-label') || button.innerHTML;
        button.setAttribute('data-original-label', original);
        button.innerHTML = '<span>Copied!</span>';
        button.classList.add('copied');
        setTimeout(() => {
          button.innerHTML = button.getAttribute('data-original-label');
          button.classList.remove('copied');
        }, 2000);
      }
    } catch (err) {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = text;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      if (button) {
        const original = button.getAttribute('data-original-label') || button.innerHTML;
        button.setAttribute('data-original-label', original);
        button.innerHTML = '<span>Copied!</span>';
        button.classList.add('copied');
        setTimeout(() => {
          button.innerHTML = button.getAttribute('data-original-label');
          button.classList.remove('copied');
        }, 2000);
      }
    }
  }
}

// Results actions: Try again confirmation
(function setupRetakeConfirmation(){
  const retakeBtn = document.getElementById('retakeBtn');
  const pill = document.getElementById('retakeConfirmPill');
  const btns = document.getElementById('retakeConfirmButtons');
  const del = document.getElementById('retakeConfirmDelete');
  const cancel = document.getElementById('retakeConfirmCancel');
  const overlay = document.getElementById('retakeOverlay');
  const overlayYes = document.getElementById('retakeOverlayYes');
  const overlayNo = document.getElementById('retakeOverlayNo');
  if (!retakeBtn) return;
  const actionsRow = document.getElementById('resultsActions');
  const show = () => {
    // Inline the message on the button to avoid overlay stacking and keep bars from reflowing
    const original = retakeBtn.getAttribute('data-original-html') || retakeBtn.innerHTML;
    retakeBtn.setAttribute('data-original-html', original);
    // Move the confirmation pill into the actions row to REPLACE the Try again button spot
    try {
      if (actionsRow && pill && retakeBtn.parentElement === actionsRow) {
        actionsRow.insertBefore(pill, retakeBtn);
      }
    } catch(_) {}
    // Hide the original button entirely so space is freed
    retakeBtn.style.display = 'none';
    // Show the confirmation pill inline, matching the button's visual style and width
    try {
      const width = Math.max(retakeBtn.offsetWidth || 0, retakeBtn.getBoundingClientRect().width || 0);
      pill.style.width = width ? (width + 'px') : '';
    } catch(_) { pill.style.width = ''; }
    pill.style.display = 'inline-flex';
    pill.style.position = 'static';
    pill.classList.add('btn-pill', 'btn-pill-multi');
    // Position action buttons just below the pill, aligned under the same x position
    try {
      const btnRect = pill.getBoundingClientRect();
      const container = document.getElementById('resultsContent');
      const contRect = container ? container.getBoundingClientRect() : { left: 0, top: 0 };
      btns.style.width = btnRect.width + 'px';
      btns.style.left = (btnRect.left - contRect.left) + 'px';
      let btnsTop = (btnRect.bottom - contRect.top + window.scrollY + 12);
      const footerH = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--footer-h')) || 64;
      const maxTop = (window.scrollY + window.innerHeight) - (footerH + 90);
      if (btnsTop > maxTop) btnsTop = maxTop;
      btns.style.top = btnsTop + 'px';
    } catch(_) {}
    btns.style.display = 'block';
    document.addEventListener('keydown', onEsc, { once: true });
    document.addEventListener('click', onDocClick, { capture: true, once: true });
  };
  const hide = () => {
    btns.style.display = 'none';
    // Hide pill and restore original button in the row
    pill.style.display = 'none';
    pill.style.position = 'absolute';
    pill.style.width = '';
    retakeBtn.style.display = '';
  };
  const onEsc = (e) => { if (e.key === 'Escape') hide(); };
  const onDocClick = (e) => { if (!btns.contains(e.target) && e.target !== retakeBtn) hide(); };
  // Always show modal overlay for Try again (desktop and mobile)
  retakeBtn.onclick = function(e){
    e.preventDefault();
    if (!overlay) return;
    overlay.style.display = 'flex';
    const close = () => { overlay.style.display = 'none'; };
    if (overlayNo) overlayNo.onclick = close;
    if (overlayYes) overlayYes.onclick = () => { location.reload(); };
    overlay.addEventListener('click', function onBk(ev){ if (ev.target === overlay) { close(); overlay.removeEventListener('click', onBk); } });
  };
  if (cancel) cancel.addEventListener('click', hide);
  if (del) del.addEventListener('click', () => { location.reload(); });
})();

// Full report request: modal, validation, API call
function setupReportRequestUI(){
  if (setupReportRequestUI._initialized) return;
  setupReportRequestUI._initialized = true;
  const openBtn = document.getElementById('fullReportBtn');
  const overlay = document.getElementById('reportOverlay');
  const backBtn = null;
  const sendBtn = document.getElementById('reportSendBtn');
  const emailInput = document.getElementById('reportEmailInput');
  const consent = document.getElementById('reportConsent');
  const marketing = document.getElementById('reportMarketing');
  const errorEl = document.getElementById('reportError');
  const statusEl = document.getElementById('reportStatus');
  const sentBlock = document.getElementById('reportSentBlock');
  const formBlock = document.getElementById('reportFormBlock');
  
  // Debug: Log if consent element is missing
  if (!consent) {
    console.warn('Report consent checkbox not found. Check if reportConsent element exists.');
  }
  const tryAgainBtn = document.getElementById('reportTryAgainBtn');
  const shareBtn = document.getElementById('reportShareBtn');
  if (!openBtn || !overlay) return;

  // Track PDF generation state
  let pdfGenerationProgress = 0;
  let pdfGenerationInterval = null;
  let isPdfReady = false;
  let cachedPdfBase64 = null;

  function showOverlay(){ overlay.style.display = 'flex'; }
  function hideOverlay(){ overlay.style.display = 'none'; }
  function showForm(){ formBlock.style.display = 'block'; sentBlock.style.display = 'none'; }
  function showSent(){ formBlock.style.display = 'none'; sentBlock.style.display = 'block'; }
  function validateEmail(v){ return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(v||'').trim()); }

  // Pre-generate PDF when overlay opens (silently in background)
  async function preGeneratePDF() {
    if (isPdfReady || cachedPdfBase64) return; // Already generated

    try {
      const results = (typeof window !== 'undefined' && window.LATEST_RESULTS) ? window.LATEST_RESULTS : null;

      // Build benchmark data
      const fullBm = (typeof window !== 'undefined' ? (window.LATEST_BENCHMARK || null) : null);
      const safeBenchmark = fullBm ? {
        ihsPercentile: typeof fullBm.ihsPercentile === 'number' ? fullBm.ihsPercentile : null,
        totalResponses: typeof fullBm.totalResponses === 'number' ? fullBm.totalResponses : null,
        context: {
          averageScore: (fullBm.context && typeof fullBm.context.averageScore === 'number') ? fullBm.context.averageScore : null
        }
      } : null;

      const dataPayload = {
        results,
        benchmark: safeBenchmark,
        completionTime: (typeof window !== 'undefined' ? (window.LATEST_COMPLETION_TIME ?? null) : null),
        unansweredCount: (typeof window !== 'undefined' ? (window.LATEST_UNANSWERED ?? null) : null),
        selectedCardIds: (typeof window !== 'undefined' ? (window.LATEST_SELECTED_CARDS || []) : []),
        answers: (typeof window !== 'undefined' ? (window.LATEST_ANSWERS || []) : [])
      };

      const reportUrl = `/report/preview?data=${encodeURIComponent(btoa(unescape(encodeURIComponent(JSON.stringify(dataPayload)))))}&preview=1`;
      const iframe = document.createElement('iframe');
      iframe.style.position = 'fixed';
      iframe.style.left = '0';
      iframe.style.top = '0';
      iframe.style.visibility = 'hidden';
      iframe.style.pointerEvents = 'none';
      iframe.style.width = '210mm';
      iframe.style.height = '297mm';
      iframe.src = reportUrl;
      document.body.appendChild(iframe);

      await new Promise(resolve => { iframe.onload = resolve; });
      await new Promise(r => setTimeout(r, 250));

      const doc = iframe.contentDocument;
      const win = iframe.contentWindow;

      let waited = 0;
      while (waited < 4000 && !(win && win.__REPORT_READY__)) {
        await new Promise(r => setTimeout(r, 200));
        waited += 200;
      }

      try { doc.body.classList.add('pdf-render'); } catch(_) {}
      await new Promise(r => setTimeout(r, 100));

      const page = doc && (doc.querySelector('#report-page') || doc.querySelector('.page'));
      let blob = null;

      // Load libraries
      async function ensureLibsLoaded() {
        async function load(url) {
          return await new Promise(resolve => {
            const sc = doc.createElement('script');
            sc.src = url;
            sc.referrerPolicy = 'no-referrer';
            sc.onload = () => resolve(true);
            sc.onerror = () => resolve(false);
            doc.head.appendChild(sc);
          });
        }
        if (!(win && win.html2canvas)) await load('https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js');
        if (!(win && win.jspdf?.jsPDF)) await load('https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js');
        await new Promise(r => setTimeout(r, 100));
      }

      if (page) {
        let tries = 0;
        while (tries < 8 && !(win?.html2canvas && win?.jspdf?.jsPDF)) {
          await new Promise(r => setTimeout(r, 200));
          tries++;
        }
        if (!(win?.html2canvas && win?.jspdf?.jsPDF)) await ensureLibsLoaded();

        if (win.html2canvas && win.jspdf?.jsPDF) {
          const canvasOpts = {
            scale: 6,
            useCORS: true,
            width: 595,
            height: 842,
            windowWidth: 595,
            windowHeight: 842,
            x: 0,
            y: 0,
            scrollX: 0,
            scrollY: 0,
            backgroundColor: '#ffffff'
          };

          let canvas;
          try {
            canvas = await win.html2canvas(page, canvasOpts);
          } catch(_) {
            canvas = await win.html2canvas(page, { ...canvasOpts, scale: 2 });
          }

          const imgData = canvas.toDataURL('image/png');
          const pdf = new win.jspdf.jsPDF({
            unit: 'px',
            format: [595, 842],
            orientation: 'portrait',
            hotfixes: ['px_scaling'],
            compress: true
          });
          pdf.addImage(imgData, 'PNG', 0, 0, 595, 842);
          blob = pdf.output('blob');
        }
      }

      if (blob) {
        const dataUri = await new Promise((resolve) => {
          const fr = new FileReader();
          fr.onload = () => resolve(fr.result);
          fr.readAsDataURL(blob);
        });
        cachedPdfBase64 = String(dataUri);
        window.LAST_PDF_BASE64 = cachedPdfBase64;
      }

      try { document.body.removeChild(iframe); } catch(_){}

      isPdfReady = true;
      console.log('PDF pre-generation complete');

    } catch(e) {
      console.error('PDF pre-generation failed:', e);
      isPdfReady = false;
    }
  }

  openBtn.addEventListener('click', () => {
    try {
      showOverlay();
      showForm();
      errorEl.style.display='none';
      statusEl.style.display='none';
      // Start generating PDF in background
      preGeneratePDF();
    } catch(_){ }
  });
  if (backBtn) backBtn.addEventListener('click', hideOverlay);
  if (overlay) overlay.addEventListener('click', function(e){ if (e.target === overlay) hideOverlay(); });
  if (tryAgainBtn) tryAgainBtn.addEventListener('click', () => { try { location.reload(); } catch(_) { showForm(); } });
  if (shareBtn) shareBtn.addEventListener('click', function(){ try { document.getElementById('nativeShareBtn')?.click(); } catch(_){} });

  async function sendRequest(){
    errorEl.style.display = 'none';
    statusEl.style.display = 'none';
    const email = emailInput ? emailInput.value.trim() : '';
    const isEmailValid = validateEmail(email);
    const isConsentChecked = consent && consent.checked;
    
    // More specific error messages
    if (!isEmailValid && !isConsentChecked) {
      errorEl.textContent = errorEl.getAttribute('data-error-both') || 'Please enter a valid email address and agree to receive your report.';
      errorEl.style.display = 'block';
      return;
    }
    if (!isEmailValid) {
      errorEl.textContent = errorEl.getAttribute('data-error-email') || 'Please enter a valid email address.';
      errorEl.style.display = 'block';
      return;
    }
    if (!isConsentChecked) {
      errorEl.textContent = errorEl.getAttribute('data-error-consent') || 'Please agree to receive your report.';
      errorEl.style.display = 'block';
      return;
    }

    let animationFrameId = null;
    let progress = 0;
    let currentPhase = 'preparing'; // preparing -> generating -> sending
    let phaseStartTime = 0;
    let phaseStartProgress = 0;

    // Helper to update progress text
    function setPhase(phase) {
      currentPhase = phase;
      const txt = document.getElementById('pdfProgressText');
      if (!txt) return;
      if (phase === 'preparing') txt.textContent = 'Preparing...';
      else if (phase === 'generating') txt.textContent = 'Generating...';
      else if (phase === 'sending') txt.textContent = 'Sending...';
      phaseStartTime = Date.now();
      phaseStartProgress = progress;
    }

    function getPhaseConfig(phase) {
      if (phase === 'preparing') return { target: 10, duration: 400 };
      if (phase === 'generating') return { target: 85, duration: 6000 };
      return { target: 95, duration: 1200 };
    }

    function startProgressAnimation() {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      const tick = () => {
        const bar = document.getElementById('pdfProgressBar');
        if (!bar) return;
        const { target, duration } = getPhaseConfig(currentPhase);
        const elapsed = Math.min(Date.now() - phaseStartTime, duration);
        const t = duration > 0 ? elapsed / duration : 1;
        const eased = 1 - Math.pow(1 - t, 2);
        const next = phaseStartProgress + (target - phaseStartProgress) * eased;
        if (next > progress) {
          progress = next;
          bar.style.width = `${progress.toFixed(1)}%`;
        }
        animationFrameId = requestAnimationFrame(tick);
      };
      tick();
    }

    try {
      if (sendBtn) { sendBtn.disabled = true; }

      // Determine initial phase based on PDF readiness
      const pdfAlreadyReady = !!(isPdfReady || cachedPdfBase64 || window.LAST_PDF_BASE64);

      // Setup progress bar
      statusEl.innerHTML = `
        <div style="width:100%; max-width:280px; height:6px; background:var(--progress-bg, #e0e0e0); border-radius:999px; overflow:hidden; margin:10px auto 0;">
          <div id="pdfProgressBar" style="width:0%; height:100%; background:var(--brand-pink, #e91e63); transition:width 0.05s linear;"></div>
        </div>
        <div id="pdfProgressText" style="text-align:center; font-size:12px; margin-top:6px; color:#5DA1BB;"></div>
      `;
      statusEl.style.display = 'block';
      setPhase('preparing');
      startProgressAnimation();

      const results = (typeof window !== 'undefined' && window.LATEST_RESULTS) ? window.LATEST_RESULTS : null;
      try {
        if (typeof window !== 'undefined') {
          if (results && typeof results.completionTime === 'number') window.LATEST_COMPLETION_TIME = results.completionTime;
          if (results && typeof results.unansweredCount === 'number') window.LATEST_UNANSWERED = results.unansweredCount;
        }
      } catch(_){ }

      const payload = {
        sessionId: participantId,
        email,
        consent: true,
        marketing: !!(marketing && marketing.checked),
        results: results ? {
          ihs: results.ihs,
          n1: results.n1,
          n2: results.n2,
          n3: results.n3,
          domainCounts: results.domainCounts || null,
          domainAffirmations: results.domainAffirmations || null
        } : null,
        userAgent: navigator.userAgent,
        pdfBase64: cachedPdfBase64 || window.LAST_PDF_BASE64 || null
      };

      const minPreparingMs = 400;
      const minGeneratingMs = 600;
      await new Promise(r => setTimeout(r, minPreparingMs));

      setPhase('generating');
      const generatingStart = Date.now();
      if (!payload.pdfBase64 && !isPdfReady) {
        // Wait up to 20 seconds for PDF to be ready (scale 6 takes longer)
        let waitTime = 0;
        while (!isPdfReady && !cachedPdfBase64 && waitTime < 20000) {
          await new Promise(r => setTimeout(r, 300));
          waitTime += 300;
          if (cachedPdfBase64 || window.LAST_PDF_BASE64) {
            payload.pdfBase64 = cachedPdfBase64 || window.LAST_PDF_BASE64;
            break;
          }
        }
      } else {
        await new Promise(r => setTimeout(r, minGeneratingMs));
      }

      const elapsedGenerating = Date.now() - generatingStart;
      if (elapsedGenerating < minGeneratingMs) {
        await new Promise(r => setTimeout(r, minGeneratingMs - elapsedGenerating));
      }

      if (!payload.pdfBase64) {
        if (animationFrameId) cancelAnimationFrame(animationFrameId);
        statusEl.textContent = 'Could not prepare PDF. Please try again.';
        return;
      }

      // Switch to sending phase
      setPhase('sending');

      const res = await fetch('/api/report', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });

      // Complete!
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      const bar = document.getElementById('pdfProgressBar');
      if (bar) bar.style.width = '100%';

      if (!res.ok) { throw new Error('Failed to send'); }

      // Small delay to let user see 100%
      await new Promise(r => setTimeout(r, 300));
      showSent();
    } catch (e) {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      statusEl.textContent = 'Something went wrong. Please try again.';
      statusEl.style.display = 'block';
    } finally {
      if (animationFrameId) cancelAnimationFrame(animationFrameId);
      if (sendBtn) { sendBtn.disabled = false; }
    }
  }
  if (sendBtn) {
    sendBtn.addEventListener('click', function(e) {
      e.preventDefault();
      e.stopPropagation();
      sendRequest();
    });
  }
}

function getBenchmarkData(results) {
  // Show the benchmark section
  const benchmarkSection = document.getElementById('benchmarkSection');
  benchmarkSection.style.display = 'block';

  // Convert domain counts to the expected format for the API
  const domainScores = {
    red: results.domainCounts['Attraction'] || 0,      // Beauty/Attraction
    orange: results.domainCounts['Self-development'] || 0, // Growth
    yellow: results.domainCounts['Ambition'] || 0,     // Achievement
    green: results.domainCounts['Basics'] || 0,        // Fundamentals
    blue: results.domainCounts['Vitality'] || 0        // Energy
  };

  const benchmarkPayload = {
    ihsScore: results.n1,
    domainScores: domainScores
  };

  console.log('Requesting benchmark for:', benchmarkPayload);

  fetch('/api/benchmarks', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(benchmarkPayload)
      })
  .then(response => {
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return response.json();
  })
  .then(data => {
    console.log('Benchmark data received:', data);
    console.log('Benchmark ihsPercentile from API:', data?.benchmark?.ihsPercentile);
    // Store benchmark for PDF report (ensure consistency with displayed values)
    try {
      window.LATEST_BENCHMARK = data?.benchmark || null;
      console.log('Stored LATEST_BENCHMARK:', window.LATEST_BENCHMARK);
    } catch(_) {}
    displayBenchmarkResults(data.benchmark, results);
  })
  .catch(err => {
    console.warn('Error fetching benchmark:', err);
    // Keep section visible with fallback text/placeholders
    try {
      const msg = document.getElementById('benchmarkMessage');
      if (msg) { msg.textContent = 'Ranking unavailable.'; }
      const avg = document.getElementById('benchmarkAverage');
      if (avg && !avg.textContent) { avg.textContent = '--'; }
      const tot = document.getElementById('benchmarkTotal');
      if (tot && !tot.textContent) { tot.textContent = '--'; }
    } catch(_) {}
  });
}

function displayBenchmarkResults(benchmark, results) {
  try {
    // Compute "top" as previously (topPct = 100 - percentile)
    const p = Number(benchmark && benchmark.ihsPercentile);
    const topPct = Number.isFinite(p) ? (100 - p) : NaN;
    let performanceMessage = '';
    if (Number.isFinite(topPct)) {
      // If "Top X%" would exceed 50%, show as "Bottom (100 - X)%" instead
      if (topPct > 50) {
        performanceMessage = `You're in the <span class=\"accent\">bottom ${Math.round(100 - topPct)}%!</span>`;
      } else {
        performanceMessage = `You're in the <span class=\"accent\">top ${Math.round(topPct)}%!</span>`;
      }
    } else {
      performanceMessage = 'Ranking unavailable.';
    }

    // Update the main benchmark message
    const messageEl = document.getElementById('benchmarkMessage');
    if (messageEl) messageEl.innerHTML = performanceMessage;

    // Keep average/participants visible
    const total = (benchmark && benchmark.totalResponses) != null ? benchmark.totalResponses : null;
    const avg = benchmark && benchmark.context && benchmark.context.averageScore;
    const totalEl = document.getElementById('benchmarkTotal');
    const avgEl = document.getElementById('benchmarkAverage');
    if (totalEl) totalEl.textContent = total != null ? String(total).toLocaleString() : '--';
    if (avgEl) avgEl.textContent = (avg != null ? avg : '--');

    console.log('Benchmark display updated with top percentage:', topPct);
  } catch (e) {
    console.warn('displayBenchmarkResults failed', e);
    try {
      const messageEl = document.getElementById('benchmarkMessage');
      if (messageEl) messageEl.textContent = 'Ranking unavailable.';
    } catch(_) {}
  }
}
