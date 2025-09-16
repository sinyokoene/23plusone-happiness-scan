(function(){
  'use strict';

  // Generate or reuse a persistent participant ID to join research ↔ scan
  const existingPid = (typeof localStorage !== 'undefined') ? localStorage.getItem('participantId') : null;
  const participantId = existingPid || `pid-${Date.now()}-${Math.random().toString(36).slice(2,9)}`;
  try { localStorage.setItem('participantId', participantId); } catch (_) {}

  const who5Items = [
    'I have felt cheerful and in good spirits',
    'I have felt calm and relaxed',
    'I have felt active and vigorous',
    'I woke up feeling fresh and rested',
    'My daily life has been filled with things that interest me'
  ];

  const swlsItems = [
    'In most ways my life is close to my ideal',
    'The conditions of my life are excellent',
    'I am satisfied with my life'
  ];

  const introSection = document.getElementById('intro');
  const who5Section = document.getElementById('who5');
  const swlsSection = document.getElementById('swls');
  const scanHost = document.getElementById('scanHost');
  const scanFrame = document.getElementById('scanFrame');
  const toSwlsIntroBtn = document.getElementById('toSwlsIntro');
  const toSwlsBtn = document.getElementById('toWho5');
  const toScanBtn = document.getElementById('toScan');

  const who5Form = document.getElementById('who5Form');
  const swlsForm = document.getElementById('swlsForm');

  const who5RowTpl = document.getElementById('who5Row');
  const swlsRowTpl = document.getElementById('swlsRow');

  const who5Answers = new Array(who5Items.length).fill(null);
  const swlsAnswers = new Array(swlsItems.length).fill(null);

  function renderLikert(container, tpl, items, answers, scaleHint){
    container.replaceChildren();
    items.forEach((text, idx) => {
      const fragment = tpl.content.cloneNode(true);
      const rowEl = fragment.querySelector('.qgrid');
      const labelEl = fragment.querySelector('.swls-q') || fragment.querySelector('label');
      if (labelEl) labelEl.textContent = text;
      rowEl.querySelectorAll('.choice').forEach(btn => {
        const activate = () => {
          const value = parseInt(btn.dataset.val, 10);
          answers[idx] = value;
          // ensure only ONE active per row
          rowEl.querySelectorAll('.choice').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
        };
        btn.addEventListener('click', activate);
        // Enhance mobile: respond to touchstart to feel instant
        btn.addEventListener('touchstart', (e) => { e.preventDefault(); activate(); }, { passive: false });
      });
      container.appendChild(fragment);
    });
  }

  function show(el){ el.classList.add('active'); el.style.display='flex'; }
  function hide(el){ el.classList.remove('active'); el.style.display='none'; }

  function allAnswered(arr){ return arr.every(v => v !== null); }

  async function submitResearch(){
    const payload = {
      sessionId: participantId,
      participantId: participantId,
      who5: who5Answers,
      swls: swlsAnswers,
      userAgent: navigator.userAgent
    };
    try {
      if (navigator.sendBeacon) {
        const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
        navigator.sendBeacon('/api/research', blob);
      } else {
        fetch('/api/research', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          keepalive: true
        });
      }
    } catch (e) {
      // Silent fail - research is optional for flow
      console.warn('Research submit failed', e);
    }
  }

  // Initialize
  renderLikert(who5Form, who5RowTpl, who5Items, who5Answers);
  renderLikert(swlsForm, swlsRowTpl, swlsItems, swlsAnswers);

  if (toSwlsIntroBtn) {
    toSwlsIntroBtn.addEventListener('click', () => { hide(introSection); show(swlsSection); });
  }
  if (toSwlsBtn) {
    toSwlsBtn.addEventListener('click', () => {
      if (!allAnswered(swlsAnswers)) { return; }
      hide(swlsSection); show(who5Section);
    });
  }

  if (toScanBtn) {
    toScanBtn.addEventListener('click', () => {
      if (!allAnswered(who5Answers)) { return; }
      // Fire-and-forget submit to avoid blocking UI transition
      try { submitResearch(); } catch (_) {}
      hide(who5Section);
      show(scanHost);
      // Hide outer footer to avoid double footer when iframe is visible
      const footer = document.getElementById('globalFooter');
      if (footer) footer.style.display = 'none';
      const main = document.querySelector('main');
      if (main) main.style.paddingBottom = '0';
    });
  }

  // Ensure footer is visible for non-scan sections when shown via show()
  const _origShow = show;
  function showWithFooter(el){
    _origShow(el);
    const footer = document.getElementById('globalFooter');
    const main = document.querySelector('main');
    if (!el || el.id === 'scanHost') {
      if (footer) footer.style.display = 'none';
      if (main) main.style.paddingBottom = '0';
    } else {
      if (footer) footer.style.display = '';
      if (main) main.style.paddingBottom = 'var(--footer-h)';
    }
  }
  // Override local helper for the rest of this file
  show = showWithFooter;

  // Preload the scan iframe early so transition is instant
  if (scanFrame) {
    const base = 'scan.html';
    scanFrame.src = `${base}?pid=${encodeURIComponent(participantId)}`;
  }
})();


