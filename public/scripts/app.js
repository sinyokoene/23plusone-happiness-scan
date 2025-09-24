// 23plusone Happiness Scan - Main JavaScript
(function() {
  // Participant/session identifier shared across research and scan
  const urlParams = new URLSearchParams(window.location.search || '');
  const pidFromUrl = urlParams.get('pid');
  const modeFromUrl = (urlParams.get('mode') || '').toLowerCase();
  if (modeFromUrl === 'research') { window.RESEARCH_MODE = true; }
  let participantId = null;
  try {
    const stored = (typeof localStorage !== 'undefined') ? localStorage.getItem('participantId') : null;
    participantId = pidFromUrl || stored || `pid-${Date.now()}-${Math.random().toString(36).slice(2,9)}`;
    if (stored !== participantId) {
      localStorage.setItem('participantId', participantId);
    }
  } catch (_) {
    participantId = pidFromUrl || `pid-${Date.now()}-${Math.random().toString(36).slice(2,9)}`;
  }
  let cards = [];
  let deck = [];
  let currentCardIndex = 0;
  let answers = [];
  let startTime = 0;
  let scanStartTime = 0; // Track start of entire scan
  let timerInterval = null;
  let timerTimeouts = []; // Track all timer-related timeouts
  let timerActive = false; // Flag to prevent timer conflicts
  let scanTerminated = false; // Hard stop flag (e.g., too many NULLs)

  
  // DOM elements
  const introDiv = document.getElementById('intro');
  const practiceDiv = document.getElementById('practice');
  const practiceCompleteDiv = document.getElementById('practice-complete');
  const countdownDiv = document.getElementById('countdown');
  const processingDiv = document.getElementById('processing');
  const gameDiv = document.getElementById('game');
  const resultsDiv = document.getElementById('results');
  const startBtn = document.getElementById('startBtn');
  const cardDiv = document.getElementById('card');
  const progressBar = document.getElementById('progressBar');
  const countdownText = document.getElementById('countdownText');
  const countdownProgress = document.getElementById('countdownProgress');
  const processingText = document.getElementById('processingText');
  const processingProgress = document.getElementById('processingProgress');

  // Debug logging to check DOM elements
  console.log('DOM elements check:', {
    introDiv, countdownDiv, gameDiv, startBtn, countdownText, countdownProgress
  });

  const timerContainer = document.getElementById('timerContainer');
  const timerProgress = document.getElementById('timerProgress');
  const buttonsDiv = document.getElementById('gameButtons');
  const yesBtn = document.getElementById('yesBtn');
  const noBtn = document.getElementById('noBtn');
  
  // Helper function to control which section is visible
  function showSection(sectionToShow) {
    if (scanTerminated) return; // Do not switch sections after termination
    console.log('🔄 showSection called with:', sectionToShow);
    
    // Hide all main sections first
    [introDiv, practiceDiv, practiceCompleteDiv, countdownDiv, gameDiv, processingDiv, resultsDiv].forEach(div => {
      if (div) {
        div.classList.remove('active-section');
        // Let CSS control the card white box; only toggle display
        div.style.display = 'none';
        div.setAttribute('aria-hidden', 'true');
        console.log('Removed active-section from:', div.id);
      }
    });
  
    // Then show the requested section
    if (sectionToShow) {
      sectionToShow.classList.add('active-section');
      // Ensure visible
      sectionToShow.style.display = 'flex';
      sectionToShow.removeAttribute('aria-hidden');
      console.log('✅ Added active-section to:', sectionToShow.id);
    }
  }
  // Expose for research mode orchestrator
  window._showSection = showSection;

  // Intro GIF desktop tilt
  let disableIntroTilt = function(){};
  function enableIntroGifTiltIfDesktop(){
    if (!isDesktop) return;
    const tiltEl = document.getElementById('introGifContainer');
    if (!tiltEl) return;
    // Cleanup any previous
    disableIntroTilt();
    let rafId = null;
    let currentRX = 0, currentRY = 0;
    const maxTilt = 6;
    const damp = 0.12;
    const applyTransform = () => {
      tiltEl.style.transform = `perspective(800px) rotateX(${currentRX}deg) rotateY(${currentRY}deg) scale(1.02)`;
    };
    const onMouseMove = (e) => {
      const rect = tiltEl.getBoundingClientRect();
      const cx = rect.left + rect.width / 2;
      const cy = rect.top + rect.height / 2;
      const dx = (e.clientX - cx) / (rect.width / 2);
      const dy = (e.clientY - cy) / (rect.height / 2);
      const targetRY = Math.max(-1, Math.min(1, dx)) * maxTilt;
      const targetRX = Math.max(-1, Math.min(1, -dy)) * maxTilt;
      if (rafId) cancelAnimationFrame(rafId);
      const step = () => {
        currentRX += (targetRX - currentRX) * damp;
        currentRY += (targetRY - currentRY) * damp;
        applyTransform();
        if (Math.abs(targetRX - currentRX) > 0.05 || Math.abs(targetRY - currentRY) > 0.05) {
          rafId = requestAnimationFrame(step);
        } else {
          rafId = null;
        }
      };
      rafId = requestAnimationFrame(step);
    };
    const onMouseLeave = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
      currentRX = 0; currentRY = 0;
      tiltEl.style.transition = 'transform 180ms ease-out';
      applyTransform();
      setTimeout(() => { tiltEl.style.transition = ''; }, 200);
    };
    tiltEl.style.willChange = 'transform';
    tiltEl.style.transformStyle = 'preserve-3d';
    tiltEl.addEventListener('mousemove', onMouseMove);
    tiltEl.addEventListener('mouseleave', onMouseLeave);
    disableIntroTilt = function(){
      try {
        tiltEl.removeEventListener('mousemove', onMouseMove);
        tiltEl.removeEventListener('mouseleave', onMouseLeave);
      } catch(_) {}
      if (rafId) cancelAnimationFrame(rafId);
      rafId = null;
      currentRX = 0; currentRY = 0;
      tiltEl.style.transition = 'transform 160ms ease-out';
      tiltEl.style.transform = 'perspective(800px) rotateX(0deg) rotateY(0deg) scale(1)';
      setTimeout(() => { tiltEl.style.transition = ''; }, 180);
    };
  }
  
  // Start button event listener with comprehensive debugging
  if (startBtn) {
    console.log('Start button found:', startBtn);
    
    // Add multiple event listeners to ensure one works
    startBtn.addEventListener('click', function(e) {
      console.log('Button clicked - addEventListener method');
      e.preventDefault();
      e.stopPropagation();
      // Stop intro GIF tilt when starting practice
      try { if (typeof disableIntroTilt === 'function') disableIntroTilt(); } catch(_) {}
      startPractice();
    });
    
    startBtn.onclick = function(e) {
      console.log('Button clicked - onclick method');
      e.preventDefault();
      e.stopPropagation();
      // Stop intro GIF tilt when starting practice
      try { if (typeof disableIntroTilt === 'function') disableIntroTilt(); } catch(_) {}
      startPractice();
    };
    
    // Test if button is clickable
    startBtn.addEventListener('touchstart', function() {
      console.log('Button touch detected');
    });
    
    console.log('All event listeners attached to start button');
  } else {
    console.error('Start button not found!');
  }

  // Practice mode state and elements
  const practiceCardDiv = document.getElementById('practiceCard');
  const practiceTimerContainer = document.getElementById('practiceTimerContainer');
  const practiceTimerProgress = document.getElementById('practiceTimerProgress');
  const practiceButtonsDiv = document.getElementById('practiceButtons');
  const practiceYesBtn = document.getElementById('practiceYesBtn');
  const practiceNoBtn = document.getElementById('practiceNoBtn');
  const letsGoBtn = document.getElementById('letsGoBtn');
  const practiceNextBtn = document.getElementById('practiceNextBtn');
  const practicePrevBtn = document.getElementById('practicePrevBtn');

  const practiceImages = [
    'fakeCards/25. resilience_strength.jpeg',
    'fakeCards/26. expression_extravegance.jpeg',
    'fakeCards/27. precision_highstakes.jpeg',
    'fakeCards/28. tradition_nostalgia.jpeg',
    'fakeCards/30. rural_outdoor.jpeg',
    'fakeCards/31. contemporaryart_modern.jpeg',
    'fakeCards/35. insects_micro 2.jpeg'
  ];
  // Preload practice images once
  (function preloadPracticeImages(){
    practiceImages.forEach(src => { const img = new Image(); img.src = src; });
  })();
  let practiceIndex = 0;
  let practiceTimerInterval = null;
  let practiceTimerTimeouts = [];
  let practiceTimerActive = false;
  let practiceStartX = null;
  let practiceCurrentCard = null;

  function startPractice() {
    console.log('🎯 startPractice called');
    showSection(practiceDiv);
    // Shuffle practice images each time practice starts
    if (Array.isArray(practiceImages) && practiceImages.length > 0) {
      // Fisher-Yates shuffle for unbiased random order
      for (let i = practiceImages.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        const tmp = practiceImages[i];
        practiceImages[i] = practiceImages[j];
        practiceImages[j] = tmp;
      }
    }
    practiceIndex = 0;
    // Show quick rules overlay immediately in practice
    const prOverlay = document.getElementById('practiceRulesOverlay');
    const prBtn = document.getElementById('practiceRulesGotIt');
    const begin = () => {
      if (prOverlay) {
        prOverlay.style.display = 'none';
      }
      showPracticeCard();
    };
    if (prOverlay && prBtn) {
      prOverlay.style.display = 'flex';
      prBtn.addEventListener('click', begin, { once: true });
      document.addEventListener('keydown', function onKey(e){ if (e.key==='Escape'){ begin(); document.removeEventListener('keydown', onKey);} });
    } else {
      showPracticeCard();
    }
  }
  window.startPractice = startPractice;

  function showPracticeCard() {
    if (practiceIndex >= practiceImages.length) {
      // Completed practice
      practiceTimerContainer.style.visibility = 'hidden';
      practiceButtonsDiv.style.visibility = 'hidden';
      showSection(practiceCompleteDiv);
      return;
    }

    const imgSrc = practiceImages[practiceIndex];
    practiceCardDiv.innerHTML = `
      <div id="practiceCardImages" class="w-full h-full max-h-full flex items-center justify-center">
        <img src="${imgSrc}" alt="Practice card" class="practice-card-image w-auto h-auto max-w-full max-h-full object-contain rounded-[16px] shadow-[0_10px_15px_rgba(0,0,0,0.15)]" tabindex="0" role="img" onerror="this.style.display='none'" style="opacity: 1 !important;">
      </div>
    `;

    // Show timer and buttons (keep layout space reserved for stability)
    practiceTimerContainer.style.visibility = 'visible';
    practiceButtonsDiv.style.visibility = 'visible';
    // Reveal desktop keyboard hint now that practice controls are visible
    try { if (typeof showKeyboardHintsIfDesktop === 'function') { showKeyboardHintsIfDesktop(); } } catch (_) {}
    const practiceGestureHint = document.getElementById('practiceGestureHint');
    if (practiceGestureHint) { practiceGestureHint.style.display = 'flex'; }
    // Stop pre-interaction pulse on first interaction
    const removePulse = () => {
      try {
        const yesIcon = practiceYesBtn ? practiceYesBtn.querySelector('img') : null;
        const noIcon = practiceNoBtn ? practiceNoBtn.querySelector('img') : null;
        if (yesIcon) yesIcon.classList.remove('pulse-icon');
        if (noIcon) noIcon.classList.remove('pulse-icon');
      } catch (_) {}
    };
    
    // Predefine tilt cleanup so other handlers can stop it on first interaction
    let disablePracticeTilt = function(){};

    setTimeout(() => {
      setupPracticeSwipeListeners();
      setupPracticeKeyboardNavigation();
      const cardImage = document.querySelector('.practice-card-image');
      if (cardImage) {
        cardImage.style.opacity = '1';
        cardImage.style.transform = '';
        cardImage.style.transition = '';
        // Desktop-only: pre-interaction 3D tilt on the first practice card
        if (practiceIndex === 0 && isDesktop) {
          const tiltEl = document.getElementById('practiceCardImages');
          if (tiltEl) {
            let rafId = null;
            let currentRX = 0, currentRY = 0;
            const maxTilt = 6; // degrees
            const damp = 0.12; // easing toward target
            const applyTransform = () => {
              tiltEl.style.transform = `perspective(800px) rotateX(${currentRX}deg) rotateY(${currentRY}deg) scale(1.02)`;
            };
            const onMouseMove = (e) => {
              const rect = tiltEl.getBoundingClientRect();
              const cx = rect.left + rect.width / 2;
              const cy = rect.top + rect.height / 2;
              const dx = (e.clientX - cx) / (rect.width / 2);
              const dy = (e.clientY - cy) / (rect.height / 2);
              const targetRY = Math.max(-1, Math.min(1, dx)) * maxTilt; // left/right
              const targetRX = Math.max(-1, Math.min(1, -dy)) * maxTilt; // up/down
              if (rafId) cancelAnimationFrame(rafId);
              const step = () => {
                currentRX += (targetRX - currentRX) * damp;
                currentRY += (targetRY - currentRY) * damp;
                applyTransform();
                if (Math.abs(targetRX - currentRX) > 0.05 || Math.abs(targetRY - currentRY) > 0.05) {
                  rafId = requestAnimationFrame(step);
                } else {
                  rafId = null;
                }
              };
              rafId = requestAnimationFrame(step);
            };
            const onMouseLeave = () => {
              if (rafId) cancelAnimationFrame(rafId);
              rafId = null;
              currentRX = 0; currentRY = 0;
              tiltEl.style.transition = 'transform 180ms ease-out';
              applyTransform();
              setTimeout(() => { tiltEl.style.transition = ''; }, 200);
            };
            // prime styles
            tiltEl.style.willChange = 'transform';
            tiltEl.style.transformStyle = 'preserve-3d';
            tiltEl.addEventListener('mousemove', onMouseMove);
            tiltEl.addEventListener('mouseleave', onMouseLeave);
            // expose cleanup
            disablePracticeTilt = function(){
              try {
                tiltEl.removeEventListener('mousemove', onMouseMove);
                tiltEl.removeEventListener('mouseleave', onMouseLeave);
              } catch(_) {}
              if (rafId) cancelAnimationFrame(rafId);
              rafId = null;
              currentRX = 0; currentRY = 0;
              tiltEl.style.transition = 'transform 160ms ease-out';
              tiltEl.style.transform = 'perspective(800px) rotateX(0deg) rotateY(0deg) scale(1)';
              setTimeout(() => { tiltEl.style.transition = ''; }, 180);
            };
          }
        }
      }
      // Show swipe arrows until any interaction; also stop icon pulse on any interaction
      const left = document.getElementById('practiceHintLeft');
      const right = document.getElementById('practiceHintRight');
      const hideHints = () => { if (left) left.style.display='none'; if (right) right.style.display='none'; };
      if (left && right) {
        left.style.display = 'block';
        right.style.display = 'block';
        const onceOpts = { once: true };
        if (cardImage) {
          const hideAllHints = () => { hideHints(); if (practiceGestureHint) practiceGestureHint.style.display = 'none'; removePulse(); disablePracticeTilt(); };
          cardImage.addEventListener('touchstart', hideAllHints, onceOpts);
          cardImage.addEventListener('mousedown', hideAllHints, onceOpts);
          cardImage.addEventListener('click', hideAllHints, onceOpts);
          cardImage.addEventListener('keydown', (e)=>{ if(e.key==='ArrowLeft'||e.key==='ArrowRight'||e.key==='Enter'||e.key===' '){ hideAllHints(); } }, onceOpts);
        }
        const hideAll = () => { hideHints(); if (practiceGestureHint) practiceGestureHint.style.display = 'none'; removePulse(); disablePracticeTilt(); };
        if (practiceYesBtn) practiceYesBtn.addEventListener('click', hideAll, onceOpts);
        if (practiceNoBtn) practiceNoBtn.addEventListener('click', hideAll, onceOpts);
      }
    }, 100);

    // Start timer: on the very first practice card, wait for the user's first interaction
    if (practiceIndex === 0) {
      const startIfIdle = () => {
        if (!practiceTimerActive) { startPracticeTimer(); }
        removePulse();
        disablePracticeTilt();
      };
      const cardImage = document.querySelector('.practice-card-image');
      if (cardImage) {
        const onceOpts = { once: true };
        cardImage.addEventListener('touchstart', startIfIdle, onceOpts);
        cardImage.addEventListener('mousedown', startIfIdle, onceOpts);
        cardImage.addEventListener('click', startIfIdle, onceOpts);
        cardImage.addEventListener('keydown', (e) => {
          if (e && (e.key === 'Enter' || e.key === ' ')) startIfIdle();
        }, onceOpts);
      } else {
        // Fallback: if image not found for any reason, start immediately
        startPracticeTimer();
      }
    } else {
      startPracticeTimer();
    }
  }

  function startPracticeTimer() {
    // Clear existing
    if (practiceTimerInterval) {
      clearTimeout(practiceTimerInterval);
      practiceTimerInterval = null;
    }
    practiceTimerTimeouts.forEach(item => {
      if (typeof item === 'number') {
        clearTimeout(item);
      } else if (item && item.clear) {
        item.clear();
      }
    });
    practiceTimerTimeouts = [];

    practiceTimerActive = true;
    practiceTimerProgress.style.transition = 'none';
    practiceTimerProgress.style.width = '100%';
    if (practiceTimerProgress.classList) {
      practiceTimerProgress.classList.remove('warning', 'danger', 'timer-warning', 'timer-danger');
    }

    const t1 = setTimeout(() => {
      if (!practiceTimerActive) return;
      practiceTimerProgress.style.transition = 'width 4s linear, background-color 0.3s ease';
      practiceTimerProgress.style.width = '0%';
      let currentTime = 100;
      const update = setInterval(() => {
        if (!practiceTimerActive) { clearInterval(update); return; }
        currentTime -= 2.5;
        const bar = document.getElementById('practiceTimerBar');
        if (bar && currentTime >= 0) {
          bar.setAttribute('aria-valuenow', Math.round(currentTime));
        }
        if (currentTime <= 0) { clearInterval(update); }
      }, 100);
      practiceTimerTimeouts.push({ clear: () => clearInterval(update) });
    }, 50);
    practiceTimerTimeouts.push(t1);

    const t2 = setTimeout(() => {
      if (!practiceTimerActive) return;
      practiceTimerProgress.classList.remove('danger', 'timer-danger');
      practiceTimerProgress.classList.add('warning', 'timer-warning');
    }, 2000);
    practiceTimerTimeouts.push(t2);

    const t3 = setTimeout(() => {
      if (!practiceTimerActive) return;
      practiceTimerProgress.classList.remove('warning', 'timer-warning');
      practiceTimerProgress.classList.add('danger', 'timer-danger');
    }, 3000);
    practiceTimerTimeouts.push(t3);

    practiceTimerInterval = setTimeout(() => {
      if (!practiceTimerActive) return;
      recordPracticeTimeout();
    }, 4000);
  }

  function recordPracticeAnswer(isYes) {
    practiceTimerActive = false;
    if (practiceTimerInterval) { clearTimeout(practiceTimerInterval); practiceTimerInterval = null; }
    practiceTimerTimeouts.forEach(item => { if (typeof item === 'number') { clearTimeout(item); } else if (item && item.clear) { item.clear(); } });
    practiceTimerTimeouts = [];
    practiceIndex++;
    showPracticeCard();
  }

  function recordPracticeTimeout() { recordPracticeAnswer(null); }

  // Practice controls
  if (practiceYesBtn) practiceYesBtn.addEventListener('click', () => recordPracticeAnswer(true));
  if (practiceNoBtn) practiceNoBtn.addEventListener('click', () => recordPracticeAnswer(false));
  // Add colored border flash on click in practice
  if (practiceYesBtn) practiceYesBtn.addEventListener('click', () => {
    practiceYesBtn.classList.add('flash-yes');
    setTimeout(() => practiceYesBtn.classList.remove('flash-yes'), 220);
  });
  if (practiceNoBtn) practiceNoBtn.addEventListener('click', () => {
    practiceNoBtn.classList.add('flash-no');
    setTimeout(() => practiceNoBtn.classList.remove('flash-no'), 220);
  });
  // Desktop detection helper
  const isDesktop = (() => {
    const hasTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0 || navigator.msMaxTouchPoints > 0;
    const wideScreen = window.matchMedia && window.matchMedia('(pointer:fine)').matches;
    return !hasTouch || wideScreen;
  })();

  // Show keyboard hints only on desktop
  function showKeyboardHintsIfDesktop() {
    if (!isDesktop) return;
    const ph = document.getElementById('practiceKeyboardHint');
    if (ph && practiceDiv && practiceDiv.style.display !== 'none') ph.style.display = 'block';
  }

  // Global keyboard shortcuts in practice: ArrowLeft = No, ArrowRight = Yes (desktop only)
  document.addEventListener('keydown', function practiceArrows(e){
    if (!isDesktop) return;
    if (practiceDiv && practiceDiv.style.display !== 'none') {
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        if (document.activeElement && document.activeElement.blur) { document.activeElement.blur(); }
        const btn = document.getElementById('practiceNoBtn');
        if (btn) { btn.classList.add('flash-no'); setTimeout(()=>btn.classList.remove('flash-no'), 220); }
        recordPracticeAnswer(false);
        hidePracticeHints();
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        if (document.activeElement && document.activeElement.blur) { document.activeElement.blur(); }
        const btn = document.getElementById('practiceYesBtn');
        if (btn) { btn.classList.add('flash-yes'); setTimeout(()=>btn.classList.remove('flash-yes'), 220); }
        recordPracticeAnswer(true);
        hidePracticeHints();
      }
    }
  });
  function hidePracticeHints(){
    const left = document.getElementById('practiceHintLeft');
    const right = document.getElementById('practiceHintRight');
    const hint = document.getElementById('practiceKeyboardHint');
    if (left) left.style.display = 'none';
    if (right) right.style.display = 'none';
    if (hint) hint.style.display = 'none';
  }
  if (letsGoBtn) letsGoBtn.addEventListener('click', () => {
    // Proceed to real countdown
    // stop any running practice timers
    practiceTimerActive = false;
    if (practiceTimerInterval) { clearTimeout(practiceTimerInterval); practiceTimerInterval = null; }
    practiceTimerTimeouts.forEach(item => { if (typeof item === 'number') { clearTimeout(item); } else if (item && item.clear) { item.clear(); } });
    practiceTimerTimeouts = [];
    startScan();
  });
  if (practiceNextBtn) practiceNextBtn.addEventListener('click', () => {
    // Immediate go to Well done page
    practiceTimerActive = false;
    if (practiceTimerInterval) { clearTimeout(practiceTimerInterval); practiceTimerInterval = null; }
    practiceTimerTimeouts.forEach(item => { if (typeof item === 'number') { clearTimeout(item); } else if (item && item.clear) { item.clear(); } });
    practiceTimerTimeouts = [];
    showSection(practiceCompleteDiv);
  });
  if (practicePrevBtn) practicePrevBtn.addEventListener('click', () => {
    // Return to practice mode
    practiceTimerActive = false;
    if (practiceTimerInterval) { clearTimeout(practiceTimerInterval); practiceTimerInterval = null; }
    practiceTimerTimeouts.forEach(item => { if (typeof item === 'number') { clearTimeout(item); } else if (item && item.clear) { item.clear(); } });
    practiceTimerTimeouts = [];
    practiceIndex = 0; // reset and allow retake from first fake card
    showSection(practiceDiv);
    showPracticeCard();
  });

  function setupPracticeKeyboardNavigation() {
    const cardImage = document.querySelector('.practice-card-image');
    if (!cardImage) return;
    cardImage.addEventListener('keydown', function(e) {
      switch(e.key) {
        case 'Enter':
        case ' ':
          e.preventDefault();
          if (practiceYesBtn && practiceButtonsDiv.style.display !== 'none') { practiceYesBtn.focus(); }
          break;
        case 'ArrowLeft':
          e.preventDefault();
          recordPracticeAnswer(false);
          break;
        case 'ArrowRight':
          e.preventDefault();
          recordPracticeAnswer(true);
          break;
      }
    });
  }

  function setupPracticeSwipeListeners() {
    const cardImage = document.querySelector('.practice-card-image');
    if (!cardImage) return;
    practiceCurrentCard = cardImage;

    cardImage.addEventListener('touchstart', function(e){ e.preventDefault(); practiceStartX = e.touches[0].clientX; }, { passive: false });
    cardImage.addEventListener('touchmove', function(e){
      e.preventDefault();
      if (practiceStartX == null) return;
      const deltaX = e.touches[0].clientX - practiceStartX;
      if (practiceCurrentCard) { practiceCurrentCard.style.transform = `translateX(${deltaX}px) rotate(${deltaX * 0.1}deg)`; }
    }, { passive: false });
    cardImage.addEventListener('touchend', function(e){
      e.preventDefault();
      if (practiceStartX == null || !practiceCurrentCard) return;
      const deltaX = e.changedTouches[0].clientX - practiceStartX;
      if (Math.abs(deltaX) > 100) {
        const isYes = deltaX > 0;
        animatePracticeCardExit(isYes);
        setTimeout(() => recordPracticeAnswer(isYes), 300);
      } else {
        practiceCurrentCard.style.transform = '';
      }
      practiceStartX = null;
    }, { passive: false });

    // Mouse
    cardImage.addEventListener('mousedown', function(e){ e.preventDefault(); practiceStartX = e.clientX; });
    cardImage.addEventListener('mousemove', function(e){ if (practiceStartX == null || !practiceCurrentCard) return; const dx = e.clientX - practiceStartX; practiceCurrentCard.style.transform = `translateX(${dx}px) rotate(${dx * 0.1}deg)`; });
    const up = function(e){ if (practiceStartX == null || !practiceCurrentCard) return; const dx = e.clientX - practiceStartX; if (Math.abs(dx) > 100) { const isYes = dx > 0; animatePracticeCardExit(isYes); setTimeout(() => recordPracticeAnswer(isYes), 300); } else { practiceCurrentCard.style.transform = ''; } practiceStartX = null; };
    cardImage.addEventListener('mouseup', up);
    cardImage.addEventListener('mouseleave', up);
  }

  function animatePracticeCardExit(isYes) {
    if (!practiceCurrentCard) return;
    const direction = isYes ? 1 : -1;
    practiceCurrentCard.style.transform = `translateX(${direction * 400}px) rotate(${direction * 30}deg)`;
    practiceCurrentCard.style.transition = 'all 0.3s ease-out';
    if (isYes && practiceYesBtn) { practiceYesBtn.style.transform = 'scale(1.1)'; }
    if (!isYes && practiceNoBtn) { practiceNoBtn.style.transform = 'scale(1.1)'; }
    setTimeout(() => {
      if (practiceYesBtn) { practiceYesBtn.style.transform = ''; }
      if (practiceNoBtn) { practiceNoBtn.style.transform = ''; }
    }, 200);
  }
  
  function startScan() {
    scanTerminated = false;
    console.log('🎯 startScan function called'); // Debug log
    console.log('Available sections:', {
      introDiv: introDiv,
      countdownDiv: countdownDiv,
      gameDiv: gameDiv
    });
    
    if (!countdownDiv) {
      console.error('Countdown div not found!');
      return;
    }
    
    // Hide intro, show countdown
    console.log('Calling showSection with countdownDiv');
    showSection(countdownDiv);
    
    // Remove results layout
    document.body.classList.remove('showing-results');
    
    // Start countdown sequence
    console.log('Calling startCountdown');
    startCountdown();
  }

  // Make startScan globally accessible for inline onclick
  window.startScan = startScan;
  
  function startCountdown() {
    // Reset countdown elements
    countdownText.textContent = 'Ready?';
    countdownProgress.style.width = '0%';
    countdownProgress.style.background = '#DA006B'; // Pink for "Ready?"
    countdownProgress.style.transition = 'none'; // Remove transition temporarily
    
    // Start smooth animation using CSS transition
    setTimeout(() => {
      countdownProgress.style.transition = 'width 2.4s linear'; // Total duration
      countdownProgress.style.width = '100%';
    }, 100); // Small delay to ensure transition is removed first
    
    // Ready? (1 second) - Pink
    setTimeout(() => {
      countdownText.textContent = 'Set...';
      countdownProgress.style.background = '#FF9800'; // Orange for "Set..."
    }, 1000);
    
    // Set... (0.8 seconds) - Orange  
    setTimeout(() => {
      countdownText.textContent = 'Go!';
      countdownProgress.style.background = '#4CAF50'; // Green for "Go!"
    }, 1800); // 1000 + 800
    
    // Go! (0.6 seconds) then start game
    setTimeout(() => {
      // Hide countdown, show game
      showSection(gameDiv);
      
      // Initialize the scan
      initializeScan();
    }, 2400); // 1000 + 800 + 600
  }
  
  function startProcessing(results) {
    // Reset processing elements
    processingText.textContent = 'Reviewing...';
    processingProgress.style.width = '0%';
    processingProgress.style.background = '#DA006B'; // Pink for "Reviewing..."
    processingProgress.style.transition = 'none'; // Remove transition temporarily
    
    // Start smooth animation using CSS transition
    setTimeout(() => {
      processingProgress.style.transition = 'width 3s linear'; // Total duration
      processingProgress.style.width = '100%';
    }, 100); // Small delay to ensure transition is removed first
    
    // Reviewing... (1.2 seconds) - Pink
    // Load benchmark data during this phase
    getBenchmarkData(results);
    
    setTimeout(() => {
      processingText.textContent = 'Processing...';
      processingProgress.style.background = '#FF9800'; // Orange for "Processing..."
    }, 1200);
    
    // Processing... (0.8 seconds) - Orange  
    setTimeout(() => {
      processingText.textContent = 'Wrapping up...';
      processingProgress.style.background = '#4CAF50'; // Green for "Wrapping up..."
    }, 2000); // 1200 + 800
    
    // Wrapping up... (1.0 seconds) then show results (or notify parent in research mode)
    setTimeout(() => {
      // Submit to backend first
      submitResults(results);

      if (window.RESEARCH_MODE) {
        // Do not show results when embedded for research; notify host page instead
        try {
          window.parent && window.parent.postMessage({ type: 'scan_complete', ihs: results.ihs, sessionId: participantId }, '*');
        } catch (_) {}
        return;
      }

      // Normal mode: show results UI
      showSection(resultsDiv);
      document.body.classList.add('showing-results');
      displayEnhancedResults(results);
      setupSharing(results);
    }, 3000); // 1200 + 800 + 1000
  }
  
  // Initialize page state
  document.body.classList.remove('showing-results');
  // In research mode, an external script controls the first sections
  if (!window.RESEARCH_MODE) {
    showSection(introDiv); // Show the intro section by default
    // Enable intro GIF tilt on initial load (desktop only)
    try { enableIntroGifTiltIfDesktop(); } catch(_) {}
  }
  
  // Prevent scrolling on mobile
  document.body.classList.add('no-scroll');
  
  // Load cards and initialize
  fetch('cards.json')
    .then(r => r.json())
    .then(json => {
      cards = json;
      // Cards loaded, now preload all images for instant display
      console.log('Cards loaded, starting image preload...');
      preloadCardImages();
    })
    .catch(err => {
      console.error('Error loading cards:', err);
      startBtn.textContent = 'Error loading - Please refresh';
      startBtn.disabled = true;
    });

    // Preload all card images for instant loading during game
  function preloadCardImages() {
    let loadedCount = 0;
    const totalImages = cards.length;
    
    console.log(`🖼️ Preloading ${totalImages} card images...`);
    
    // Silent preloading - no UI changes needed
    cards.forEach((card, index) => {
      const img = new Image();
      
      img.onload = () => {
        loadedCount++;
        
        // All images loaded
        if (loadedCount === totalImages) {
          console.log('✅ All card images preloaded!');
        }
      };
      
      img.onerror = () => {
        console.warn(`⚠️ Failed to preload image: ${card.images[0]}`);
        loadedCount++; // Count it anyway to prevent hanging
        
        if (loadedCount === totalImages) {
          console.log('✅ Image preloading complete (some failed)');
        }
      };
      
      // Start loading the image
      img.src = card.images[0];
    });
  }

  // Preload next few cards while current card is being viewed
  function preloadNextCards(currentIndex, count = 3) {
    for(let i = 1; i <= count; i++) {
      if(currentIndex + i < deck.length) {
        const nextCard = deck[currentIndex + i];
        const img = new Image();
        img.src = nextCard.images[0];
        // Silent preloading - no need for callbacks
      }
    }
  }
  
  function initializeScan() {
    // Shuffle all cards once
    deck = [...cards].sort(() => Math.random() - 0.5);
    
    console.log('📋 Total cards available:', cards.length);
    console.log('🎯 Deck created with', deck.length, 'cards');
    
    currentCardIndex = 0;
    answers = [];
    scanStartTime = Date.now(); // Record start of entire scan
    showCard();
  }
  
  function showCard() {
    if (scanTerminated) return;
    if (currentCardIndex >= deck.length) {
      finishScan();
      return;
    }
    
    const card = deck[currentCardIndex];
    
    // Preload next few cards for even smoother experience
    preloadNextCards(currentCardIndex, 3);
    
    // Update progress (only if progress bar exists)
    if (progressBar) {
    const progress = (currentCardIndex / deck.length) * 100;
    progressBar.style.width = progress + '%';
    }
    
    // Update ARIA attributes for progress (only if progress container exists)
    const progressContainer = document.getElementById('progress');
    if (progressContainer) {
      const progress = (currentCardIndex / deck.length) * 100;
      progressContainer.setAttribute('aria-valuenow', Math.round(progress));
    }
    
    // Display card (reuse persistent image to avoid layout reset/flicker)
    let imagesContainer = document.getElementById('cardImages');
    if (!imagesContainer) {
      imagesContainer = document.createElement('div');
      imagesContainer.id = 'cardImages';
      imagesContainer.className = 'w-full h-full max-h-full flex items-center justify-center';
      cardDiv.replaceChildren(imagesContainer);
    }
    let img = imagesContainer.querySelector('#gameCardImage');
    if (!img) {
      img = document.createElement('img');
      img.id = 'gameCardImage';
      img.className = 'card-image w-auto h-auto max-w-full max-h-full object-contain rounded-[16px] shadow-[0_10px_15px_rgba(0,0,0,0.15)]';
      img.setAttribute('tabindex', '0');
      img.setAttribute('role', 'img');
      img.alt = 'Happiness card';
      img.onerror = function(){ this.style.display = 'none'; };
      imagesContainer.appendChild(img);
      // Attach gesture listeners once to the persistent image
      setupSwipeListeners();
      setupKeyboardNavigation();
    }
    // Reset transient styles and update source
    img.style.opacity = '1';
    img.style.transform = '';
    img.style.transition = '';
    img.src = card.images[0];
    
    // Show timer and buttons
    timerContainer.style.display = 'block';
    // Use block here so the inner row controls layout; prevents hint from sitting beside the row
    buttonsDiv.style.display = 'block';
    // Reveal desktop keyboard hint now that game controls are visible
    try { if (typeof showKeyboardHintsIfDesktop === 'function') { showKeyboardHintsIfDesktop(); } } catch (_) {}
    
    // Ensure card is fully visible and reset any lingering styles (already done above)
    
    // Reset and start timer
    startTimer();
    
    // Record start time for individual card response time
    startTime = Date.now();
  }
  
  function startTimer() {
    if (scanTerminated) return;
    // Clear any existing timers first
    if (timerInterval) {
      clearTimeout(timerInterval);
      timerInterval = null;
    }
    
    // Clear all timer-related timeouts
    timerTimeouts.forEach(item => {
      if (typeof item === 'number') {
        clearTimeout(item);
      } else if (item && item.clear) {
        item.clear();
      }
    });
    timerTimeouts = [];
    
    // Set timer as active
    timerActive = true;
    
    // Reset timer immediately (preserve base classes, remove only state modifiers)
    timerProgress.style.transition = 'none';
    timerProgress.style.width = '100%';
    if (timerProgress.classList) {
      timerProgress.classList.remove('warning', 'danger', 'timer-warning', 'timer-danger');
    } else {
      // Fallback for very old browsers
      timerProgress.className = (timerProgress.className || '').replace(/\b(warning|danger|timer-warning|timer-danger)\b/g, '').trim();
    }
    
    // Start countdown after a tiny delay
    const timeout1 = setTimeout(() => {
      if (!timerActive) return; // Don't execute if timer was stopped
      timerProgress.style.transition = 'width 4s linear, background-color 0.3s ease';
      timerProgress.style.width = '0%';
      
      // Update timer ARIA attributes as it counts down
      let currentTime = 100;
      const timerUpdateInterval = setInterval(() => {
        if (!timerActive) {
          clearInterval(timerUpdateInterval);
          return;
        }
        currentTime -= 2.5; // Decrease by 2.5% every 100ms (4 seconds total)
        const timerContainer = document.getElementById('timerContainer');
        const timerBar = document.getElementById('timerBar');
        if (timerBar && currentTime >= 0) {
          timerBar.setAttribute('aria-valuenow', Math.round(currentTime));
        }
        if (currentTime <= 0) {
          clearInterval(timerUpdateInterval);
        }
      }, 100);
      
      timerTimeouts.push({ clear: () => clearInterval(timerUpdateInterval) });
    }, 50);
    timerTimeouts.push(timeout1);
    
    // Color changes during countdown - only if timer still active
    const timeout2 = setTimeout(() => {
      if (!timerActive) return;
      if (timerProgress.classList) {
        timerProgress.classList.remove('danger', 'timer-danger');
        timerProgress.classList.add('warning', 'timer-warning');
      } else {
        timerProgress.className = 'warning';
      }
    }, 2000);
    timerTimeouts.push(timeout2);
    
    const timeout3 = setTimeout(() => {
      if (!timerActive) return;
      if (timerProgress.classList) {
        timerProgress.classList.remove('warning', 'timer-warning');
        timerProgress.classList.add('danger', 'timer-danger');
      } else {
        timerProgress.className = 'danger';
      }
    }, 3000);
    timerTimeouts.push(timeout3);
    
    // Auto-timeout after 4 seconds (record NULL response)
    timerInterval = setTimeout(() => {
      if (!timerActive) return;
      recordTimeout();
    }, 4000);
  }
  
  function recordAnswer(isYes) {
    if (scanTerminated) return;
    // Stop timer immediately
    timerActive = false;
    
    // Clear main timer
    if (timerInterval) {
      clearTimeout(timerInterval);
      timerInterval = null;
    }
    
    // Clear all timer-related timeouts
    timerTimeouts.forEach(item => {
      if (typeof item === 'number') {
        clearTimeout(item);
      } else if (item && item.clear) {
        item.clear();
      }
    });
    timerTimeouts = [];
    
    const responseTime = Date.now() - startTime;
    const card = deck[currentCardIndex];
    
    // Record all answers
    answers.push({
      id: card.id,
      domain: card.domain,
      label: card.label,
      yes: isYes,
      time: responseTime
    });
    
    currentCardIndex++;
    showCard();
  }

  // Record a NULL response on timeout
  function recordTimeout() {
    if (scanTerminated) return;
    // Stop timer immediately
    timerActive = false;
    
    // Clear main timer
    if (timerInterval) {
      clearTimeout(timerInterval);
      timerInterval = null;
    }
    
    // Clear all timer-related timeouts
    timerTimeouts.forEach(item => {
      if (typeof item === 'number') {
        clearTimeout(item);
      } else if (item && item.clear) {
        item.clear();
      }
    });
    timerTimeouts = [];
    
    const responseTime = 4000; // full timeout
    const card = deck[currentCardIndex];
    
    answers.push({
      id: card.id,
      domain: card.domain,
      label: card.label,
      yes: null,
      time: responseTime
    });
    
    // If more than 3 NULLs, stop immediately and show retry message
    const nullCount = answers.filter(a => a.yes === null).length;
    if (nullCount > 3) {
      scanTerminated = true;
      showValidationError('You took too long — try again.');
      return;
    }
    
    currentCardIndex++;
    showCard();
  }
  
  function calculateIHS() {
    // Gentle non‑linear time multiplier: sqrt of linear proportion
    // linear = (4s - t)/4s; curve = sqrt(linear) → rewards faster responses but with diminishing returns
    function getTimeMultiplier(time) {
      const clamped = Math.max(0, Math.min(4000, time));
      const linear = (4000 - clamped) / 4000; // 0..1
      return Math.sqrt(Math.max(0, linear));
    }

    // N1 (affirmations × speed), keep same per‑card base 4 then normalize to 0–100 by 96 max (24×4)
    const rawN1 = answers
      .filter(a => a.yes)
      .reduce((sum, a) => sum + (4 * getTimeMultiplier(a.time)), 0);
    const N1pct = Math.min(100, (rawN1 / 96) * 100);

    // N2 (domain coverage): normalize to 0–100 across the 5 domains
    const uniqueDomains = new Set(answers.filter(a => a.yes).map(a => a.domain));
    const N2pct = Math.min(100, (uniqueDomains.size / 5) * 100);

    // N3 (spread across domains) — include zeros for all 5 domains; normalize by total "Yes"
    const domainCounts = {};
    const domainAffirmations = {};
    const totalAnswers = answers.length;
    const domainOrder = ['Basics','Self-development','Ambition','Vitality','Attraction'];
    const yesCounts = Object.fromEntries(domainOrder.map(d => [d, 0]));

    answers.forEach(a => {
      if (a.yes) {
        yesCounts[a.domain] = (yesCounts[a.domain] || 0) + 1;
      }
      // Keep time‑weighted affirmation totals for visualization
      const perCardAffirmation = a.yes ? 4 * getTimeMultiplier(a.time) : 0;
      domainAffirmations[a.domain] = (domainAffirmations[a.domain] || 0) + perCardAffirmation;
      // Also track raw counts for potential future use
      domainCounts[a.domain] = (domainCounts[a.domain] || 0) + (a.yes ? 1 : 0);
    });

    const totalYes = Object.values(yesCounts).reduce((s,c)=>s+c,0);
    let N3pct = 0;
    if (totalYes > 0) {
      const proportions = domainOrder.map(d => yesCounts[d] / totalYes); // five terms including zeros
      const dev = proportions.reduce((s,p) => s + Math.abs(p - 0.2), 0); // Σ|p−0.2| over 5 domains
      N3pct = Math.max(0, ((1.6 - dev) / 1.6) * 100);
    }

    // Final IHS on 0–100 scale
    const ihs = (0.4 * N1pct) + (0.4 * N2pct) + (0.2 * N3pct);

    return {
      ihs: Math.round(ihs * 10) / 10,
      n1: Math.round(N1pct * 10) / 10,
      n2: Math.round(N2pct * 10) / 10,
      n3: Math.round(N3pct * 10) / 10,
      domainCounts,
      domainAffirmations
    };
  }
  
  // Frontend validation to match server-side validation
  function validateScanQuality() {
    const selectedCount = answers.filter(a => a.yes).length;
    const totalResponses = answers.length;
    const totalTime = scanStartTime > 0 ? (Date.now() - scanStartTime) / 1000 : 0; // Use scan start time
    const nullCount = answers.filter(a => a.yes === null).length;
    
    console.log('🔍 Frontend validation:', {
      totalResponses,
      selectedCount,
      nullCount,
      totalTime: `${totalTime}s`,
      scanStartTime,
      now: Date.now()
    });
    
    // Must have 24 responses
    if (totalResponses !== 24) {
      console.log('❌ Frontend: Incomplete scan');
      return { isValid: false, reason: `Incomplete scan: only ${totalResponses} responses recorded.` };
    }
    
    // Reject all "No" responses
    if (selectedCount === 0) {
      console.log('❌ Frontend: All No responses');
      return { isValid: false, reason: 'You said "No" to everything. Please retake the scan and engage more thoughtfully.' };
    }
    
    // Allow all "Yes" responses - removed restriction
    
    // Too many unanswered (NULL) responses
    if (nullCount > 3) {
      console.log('❌ Frontend: Too many unanswered cards');
      return { isValid: false, reason: 'You took too long — try again.' };
    }
    
    // Allow fast individual clicks but prevent completing entire scan too quickly
    if (totalTime < 5) {
      console.log('❌ Frontend: Too fast completion');
      return { isValid: false, reason: 'Scan completed too quickly. Please take more time to view each image.' };
    }
    
    console.log('✅ Frontend validation passed');
    return { isValid: true, reason: 'Valid scan' };
  }
  
  function showValidationError(reason) {
    cardDiv.innerHTML = `
      <div style="text-align: center; color: #F44336; padding: 20px;">
        <h3 style="color: #F44336; margin-bottom: 15px;">⚠️ Invalid Scan</h3>
        <p style="margin-bottom: 20px;">${reason}</p>
        <button onclick="location.reload()" style="background: #e91e63; color: white; border: none; padding: 12px 24px; border-radius: 20px; cursor: pointer;">
          Retake Scan
        </button>
      </div>
    `;
    
    // Hide timer and buttons
    timerContainer.style.display = 'none';
    buttonsDiv.style.display = 'none';
  }
  
  function finishScan() {
    const results = calculateIHS();
    
    // Validate scan quality before showing results
    const validationResult = validateScanQuality();
    if (!validationResult.isValid) {
      showValidationError(validationResult.reason);
      return;
    }
    
    // Hide game, show processing
    showSection(processingDiv);
    
    // Start processing sequence
    startProcessing(results);
  }


  
  function displayEnhancedResults(results) {
    // Update main score
    document.getElementById('totalScore').textContent = results.ihs;
    
    // Get domain data for visualization
    const domainData = getDomainAnalysis(results.domainCounts);
    
    // Update dominant domains text (optional element)
    const topDomainsText = getDominantDomainsText(domainData);
    const topDomainsEl = document.getElementById('topDomains');
    if (topDomainsEl) {
      topDomainsEl.textContent = topDomainsText;
    }
    // Personalized insight block (bold fueled-by + adaptive insight)
    const insightHtml = buildPersonalizedInsight(domainData);
    const insightBlock = document.getElementById('insightBlock');
    if (insightBlock && insightHtml) {
      insightBlock.innerHTML = insightHtml;
    }
    
    // Update domain bars with animation (use time‑weighted affirmation totals)
    updateDomainBars(results.domainAffirmations);
    
    // Insights removed in current design
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

  function buildPersonalizedInsight(domainData) {
    if (!domainData || domainData.length === 0) return '';
    const topDomain = domainData[0];
    const totalSelected = domainData.reduce((sum, d) => sum + d.count, 0);

    // Baseline insight by selection breadth
    let insightText = '';
    if (totalSelected <= 5) {
      insightText = "You're selective and intentional with what brings you joy. Quality over quantity defines your happiness approach.";
    } else if (totalSelected <= 12) {
      insightText = "You have a balanced happiness palette — diverse but not overwhelming. You appreciate variety while staying grounded.";
    } else {
      insightText = "You're a happiness maximalist! You find joy in many places and aren't afraid to embrace life's full spectrum.";
    }

    // Domain-specific add-on
    const domainInsights = {
      'Basics': 'Your foundation is strong — you value security, connection, and moral clarity.',
      'Self-development': "You're driven by growth and self-expression — a true lifelong learner.",
      'Ambition': "Achievement and recognition fuel your fire — you're built to succeed.",
      'Vitality': 'Energy and health are your superpowers — you prioritize feeling alive.',
      'Attraction': "Beauty and allure matter to you — you appreciate life's aesthetic pleasures."
    };
    const domainSentence = domainInsights[topDomain.name] || '';

    // Bold fueled-by sentence first
    const fueledBy = `<strong>You're fueled by ${topDomain.name}.</strong>`;
    return `${fueledBy} ${insightText} ${domainSentence}`.trim();
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
    
    const payload = {
      sessionId: participantId,
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
      unansweredCount: answers.filter(a => a.yes === null).length
    };
    
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
    // copyLinkBtn no longer exists; use learnMoreBtn as a harmless anchor for status text if needed
    const fallbackStatusBtn = document.getElementById('learnMoreBtn');
    
    const shareText = `I just completed the 23plusone Happiness Scan and scored ${results.ihs}! Discover what drives your happiness.`;
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
      ihsScore: results.ihs,
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
      displayBenchmarkResults(data.benchmark, results);
    })
    .catch(err => {
      console.warn('Error fetching benchmark:', err);
      // Hide benchmark section if there's an error
      benchmarkSection.style.display = 'none';
    });
  }
  
  function displayBenchmarkResults(benchmark, results) {
    // Convert percentile to "top X%" format
    const topPercentage = 100 - benchmark.ihsPercentile;
    let performanceMessage = '';
    
    if (topPercentage <= 5) {
      performanceMessage = `You're in the top ${topPercentage}%! 🏆`;
    } else if (topPercentage <= 10) {
      performanceMessage = `You're in the top ${topPercentage}%! 🌟`;
    } else if (topPercentage <= 25) {
      performanceMessage = `You're in the top ${topPercentage}%! ✨`;
    } else {
      performanceMessage = `You're in the top ${topPercentage}%!`;
    }
    
    // Update the main benchmark message
    const messageEl = document.getElementById('benchmarkMessage');
    messageEl.textContent = performanceMessage;
    
    // Removed 'Your Score' row from UI; keep average/participants only
    document.getElementById('benchmarkTotal').textContent = benchmark.totalResponses.toLocaleString();
    document.getElementById('benchmarkAverage').textContent = benchmark.context.averageScore || '--';
    
    console.log('Benchmark display updated with top percentage:', topPercentage);
  }
  
  // Button event listeners - immediate record; visual feedback handled via :active CSS
  yesBtn.addEventListener('click', () => recordAnswer(true));
  noBtn.addEventListener('click', () => recordAnswer(false));
  // Add colored border flash on click in game
  yesBtn.addEventListener('click', () => { yesBtn.classList.add('flash-yes'); setTimeout(()=>yesBtn.classList.remove('flash-yes'), 220); });
  noBtn.addEventListener('click', () => { noBtn.classList.add('flash-no'); setTimeout(()=>noBtn.classList.remove('flash-no'), 220); });
  
  // Keyboard navigation setup
  function setupKeyboardNavigation() {
    const cardImage = document.querySelector('.card-image');
    if (!cardImage) return;
    
    // Add keyboard listeners to card image
    cardImage.addEventListener('keydown', handleCardKeydown);
    
    // Global keyboard shortcuts (Y/N keys)
    document.addEventListener('keydown', handleGlobalKeydown);
  }
  
  function handleCardKeydown(e) {
    switch(e.key) {
      case 'Enter':
      case ' ': // Spacebar
        e.preventDefault();
        // Focus the Yes button for Enter/Space
        if (yesBtn && yesBtn.style.display !== 'none') {
          yesBtn.focus();
        }
        break;
      case 'ArrowLeft':
        e.preventDefault();
        recordAnswer(false);
        break;
      case 'ArrowRight':
        e.preventDefault();
        recordAnswer(true);
        break;
    }
  }
  
  function handleGlobalKeydown(e) {
    // Only handle Y/N keys when game is visible and buttons are shown
    if (gameDiv.style.display === 'none' || buttonsDiv.style.display === 'none') return;
    
    switch(e.key.toLowerCase()) {
      case 'y':
        e.preventDefault();
        recordAnswer(true);
        break;
      case 'n':
        e.preventDefault();  
        recordAnswer(false);
        break;
    }
  }
  // Also support ArrowLeft/ArrowRight in game mode
  document.addEventListener('keydown', function gameArrows(e){
    if (!isDesktop) return;
    if (gameDiv.style.display === 'none' || buttonsDiv.style.display === 'none') return;
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      if (document.activeElement && document.activeElement.blur) { document.activeElement.blur(); }
      const btn = document.getElementById('noBtn');
      if (btn) { btn.classList.add('flash-no'); setTimeout(()=>btn.classList.remove('flash-no'), 220); }
      recordAnswer(false);
      hideGameHint();
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (document.activeElement && document.activeElement.blur) { document.activeElement.blur(); }
      const btn = document.getElementById('yesBtn');
      if (btn) { btn.classList.add('flash-yes'); setTimeout(()=>btn.classList.remove('flash-yes'), 220); }
      recordAnswer(true);
      hideGameHint();
    }
  });
  function hideGameHint(){
    const hint = document.getElementById('gameKeyboardHint');
    if (hint) hint.style.display = 'none';
  }

  // Call once on load and when sections change
  showKeyboardHintsIfDesktop();
  const originalShowSection = window._showSection;
  window._showSection = function(section) {
    originalShowSection(section);
    showKeyboardHintsIfDesktop();
    // Manage intro GIF tilt based on visible section
    try {
      const id = section && section.id;
      if (id === 'intro') {
        enableIntroGifTiltIfDesktop();
      } else {
        if (typeof disableIntroTilt === 'function') disableIntroTilt();
      }
    } catch(_) {}
  };
  
  // Touch/swipe functionality for mobile
  let startX = null;
  let startY = null;
  let currentCard = null;
  
  function setupSwipeListeners() {
    const cardImage = document.querySelector('.card-image');
    if (!cardImage) return;
    
    currentCard = cardImage;
    
    // Touch events
    cardImage.addEventListener('touchstart', handleTouchStart, { passive: false });
    cardImage.addEventListener('touchmove', handleTouchMove, { passive: false });
    cardImage.addEventListener('touchend', handleTouchEnd, { passive: false });
    
    // Mouse events for desktop
    cardImage.addEventListener('mousedown', handleMouseDown);
    cardImage.addEventListener('mousemove', handleMouseMove);
    cardImage.addEventListener('mouseup', handleMouseUp);
    cardImage.addEventListener('mouseleave', handleMouseUp);
  }
  
  function handleTouchStart(e) {
    e.preventDefault();
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }
  
  function handleTouchMove(e) {
    e.preventDefault();
    if (!startX || !startY) return;
    
    const currentX = e.touches[0].clientX;
    const deltaX = currentX - startX;
    
    if (currentCard) {
      currentCard.style.transform = `translateX(${deltaX}px) rotate(${deltaX * 0.1}deg)`;
      // Remove opacity change during swipe - keep cards fully visible
    }
  }
  
  function handleTouchEnd(e) {
    e.preventDefault();
    if (!startX || !currentCard) return;
    
    const endX = e.changedTouches[0].clientX;
    const deltaX = endX - startX;
    
    if (Math.abs(deltaX) > 100) {
      // Swipe detected
      const isYes = deltaX > 0;
      animateCardExit(isYes);
      setTimeout(() => recordAnswer(isYes), 300);
    } else {
      // Snap back
      currentCard.style.transform = '';
      // Keep opacity at 1 when snapping back
    }
    
    startX = null;
    startY = null;
  }
  
  function handleMouseDown(e) {
    e.preventDefault();
    startX = e.clientX;
    startY = e.clientY;
  }
  
  function handleMouseMove(e) {
    if (!startX || !currentCard) return;
    
    const deltaX = e.clientX - startX;
    currentCard.style.transform = `translateX(${deltaX}px) rotate(${deltaX * 0.1}deg)`;
    // Remove opacity change during swipe - keep cards fully visible
  }
  
  function handleMouseUp(e) {
    if (!startX || !currentCard) return;
    
    const deltaX = e.clientX - startX;
    
    if (Math.abs(deltaX) > 100) {
      // Swipe detected
      const isYes = deltaX > 0;
      animateCardExit(isYes);
      setTimeout(() => recordAnswer(isYes), 300);
    } else {
      // Snap back
      currentCard.style.transform = '';
      // Keep opacity at 1 when snapping back
    }
    
    startX = null;
    startY = null;
  }
  
  function animateCardExit(isYes) {
    if (!currentCard) return;
    
    const direction = isYes ? 1 : -1;
    currentCard.style.transform = `translateX(${direction * 400}px) rotate(${direction * 30}deg)`;
    // Remove opacity change - keep cards visible during exit animation
    currentCard.style.transition = 'all 0.3s ease-out';
    
    // Visual feedback on buttons
    if (isYes) {
      yesBtn.style.transform = 'scale(1.1)';
    } else {
      noBtn.style.transform = 'scale(1.1)';
    }
    
    setTimeout(() => {
      if (yesBtn) {
        yesBtn.style.transform = '';
      }
      if (noBtn) {
        noBtn.style.transform = '';
      }
    }, 200);
  }
})();
