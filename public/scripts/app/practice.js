// 23plusone Happiness Scan - Practice flow
'use strict';

// Practice mode state and elements
const practiceCardDiv = document.getElementById('practiceCard');
const practiceTimerContainer = document.getElementById('practiceTimerContainer');
const practiceTimerProgress = document.getElementById('practiceTimerProgress');
const practiceButtonsDiv = document.getElementById('practiceButtons');
const practiceYesBtn = document.getElementById('practiceYesBtn');
const practiceNoBtn = document.getElementById('practiceNoBtn');
const letsGoBtn = document.getElementById('letsGoBtn');
const practiceMoreBtn = document.getElementById('practiceMoreBtn');

// Hide buttons initially until images preload (fade in effect)
if (startBtn) {
  startBtn.style.opacity = '0';
  startBtn.style.pointerEvents = 'none';
  startBtn.style.transition = 'opacity 0.6s ease-in';
}
if (letsGoBtn) {
  letsGoBtn.style.opacity = '0';
  letsGoBtn.style.pointerEvents = 'none';
  letsGoBtn.style.transition = 'opacity 0.6s ease-in';
}

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

  // Update practice instructions text based on device
  try {
    const practiceIntroTextEl = document.getElementById('practiceIntroText');
    if (practiceIntroTextEl) {
      // Only switch the last line based on device; leave the semibold line in HTML
      const controls = document.getElementById('practiceControlsText');
      if (controls) {
        controls.textContent = isDesktop ? 'Use your arrow keys or buttons' : 'Use the buttons';
      }
      // On mobile, keep text on one line and inject a space instead of the <br>
      const br = document.getElementById('practiceTimingBr');
      const space = document.getElementById('practiceTimingSpace');
      if (br) { br.style.display = isDesktop ? '' : 'none'; }
      if (space) { space.style.display = isDesktop ? 'none' : 'inline'; }
    }
  } catch(_) {}

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
      // Always hide swipe hints (no swipe on mobile)
      hideHints();
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
      // Prevent the same key event from reaching the practice-complete handler
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      else if (e.stopPropagation) e.stopPropagation();
      if (document.activeElement && document.activeElement.blur) { document.activeElement.blur(); }
      const btn = document.getElementById('practiceNoBtn');
      if (btn) { btn.classList.add('flash-no'); setTimeout(()=>btn.classList.remove('flash-no'), 220); }
      recordPracticeAnswer(false);
      hidePracticeHints();
    }
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      // Prevent the same key event from reaching the practice-complete handler
      if (e.stopImmediatePropagation) e.stopImmediatePropagation();
      else if (e.stopPropagation) e.stopPropagation();
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
if (practiceMoreBtn) practiceMoreBtn.addEventListener('click', () => {
  // Practice more: return to practice mode from completion screen
  practiceTimerActive = false;
  if (practiceTimerInterval) { clearTimeout(practiceTimerInterval); practiceTimerInterval = null; }
  practiceTimerTimeouts.forEach(item => { if (typeof item === 'number') { clearTimeout(item); } else if (item && item.clear) { item.clear(); } });
  practiceTimerTimeouts = [];
  practiceIndex = 0; // reset and allow retake from first fake card
  showSection(practiceDiv);
  showPracticeCard();
});

// Desktop: allow arrow keys to activate buttons on the practice-complete screen
document.addEventListener('keydown', function handlePracticeCompleteArrows(e){
  if (!isDesktop) return;
  if (!practiceCompleteDiv || practiceCompleteDiv.style.display === 'none') return;
  if (e.key === 'ArrowLeft') {
    e.preventDefault();
    try { if (practiceMoreBtn) practiceMoreBtn.click(); } catch(_) {}
  } else if (e.key === 'ArrowRight') {
    e.preventDefault();
    try { if (letsGoBtn) letsGoBtn.click(); } catch(_) {}
  }
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
