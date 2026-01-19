// 23plusone Happiness Scan - Core scan flow
'use strict';

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

// Preload all card images for instant loading during game
function preloadCardImages() {
  let loadedCount = 0;
  const totalImages = cards.length;

  console.log(`🖼️ Preloading ${totalImages} card images...`);

  // Silent preloading - no UI changes needed
  cards.forEach((card) => {
    const img = new Image();

    img.onload = () => {
      loadedCount++;

      // All images loaded
      if (loadedCount === totalImages) {
        console.log('✅ All card images preloaded!');

        // Fade in buttons now that images are ready
        if (startBtn) {
          startBtn.style.opacity = '1';
          startBtn.style.pointerEvents = 'auto';
        }
        if (letsGoBtn) {
          letsGoBtn.style.opacity = '1';
          letsGoBtn.style.pointerEvents = 'auto';
        }
      }
    };

    img.onerror = () => {
      console.warn(`⚠️ Failed to preload image: ${card.images[0]}`);
      loadedCount++; // Count it anyway to prevent hanging

      if (loadedCount === totalImages) {
        console.log('✅ Image preloading complete (some failed)');

        // Fade in buttons even if some images failed
        if (startBtn) {
          startBtn.style.opacity = '1';
          startBtn.style.pointerEvents = 'auto';
        }
        if (letsGoBtn) {
          letsGoBtn.style.opacity = '1';
          letsGoBtn.style.pointerEvents = 'auto';
        }
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
    // Attach keyboard navigation once to the persistent image
    setupKeyboardNavigation();
  }
  // Hide before switching source to prevent brief flash of previous image on mobile
  img.style.visibility = 'hidden';
  // Disable transitions BEFORE resetting transform to avoid any snap-back animation frame
  img.style.transition = 'none';
  // Reset transient styles without animating
  img.style.transform = '';
  img.style.opacity = '1';
  // Force reflow so transition removal takes effect immediately
  void img.offsetWidth;
  // Reveal only after the new image has loaded; restore transition to default afterwards
  img.onload = function() { img.style.visibility = 'visible'; img.style.transition = ''; img.onload = null; };
  img.src = card.images[0];

  // Show timer and buttons
  timerContainer.style.display = 'block';
  // Use block here so the inner row controls layout; prevents hint from sitting beside the row
  buttonsDiv.style.display = 'block';
  // Reveal desktop keyboard hint now that game controls are visible
  try { if (typeof showKeyboardHintsIfDesktop === 'function') { showKeyboardHintsIfDesktop(); } } catch (_) {}

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

function recordAnswer(isYes, modality) {
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
    time: responseTime,
    modality: modality || 'unknown'
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
    time: responseTime,
    modality: 'timeout'
  });

  // Show transient timeout notification
  try {
    const pill = document.getElementById('notificationPill');
    if (pill) {
      pill.classList.remove('show');
      void pill.offsetWidth; // reflow to restart animation
      pill.classList.add('show');
      setTimeout(() => { if (pill) pill.classList.remove('show'); }, 1600);
    }
  } catch(_) {}

  // If more than 3 NULLs, stop immediately and show retry message
  const nullCount = answers.filter(a => a.yes === null).length;
  const isDutch = document.documentElement.lang === 'nl';
  if (nullCount > 3) {
    scanTerminated = true;
    showValidationError(isDutch ? 'Je deed er te lang over — probeer het opnieuw.' : 'You took too long — try again.');
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
  const isDutch = document.documentElement.lang === 'nl';
  if (selectedCount === 0) {
    console.log('❌ Frontend: All No responses');
    return { isValid: false, reason: isDutch
      ? 'Je hebt overal "Nee" op gezegd. Doe de scan opnieuw en denk goed na.'
      : 'You said "No" to everything. Please retake the scan and engage more thoughtfully.' };
  }

  // Allow all "Yes" responses - removed restriction

  // Too many unanswered (NULL) responses
  if (nullCount > 3) {
    console.log('❌ Frontend: Too many unanswered cards');
    return { isValid: false, reason: isDutch
      ? 'Je deed er te lang over — probeer het opnieuw.'
      : 'You took too long — try again.' };
  }

  // Allow fast individual clicks but prevent completing entire scan too quickly
  if (totalTime < 5) {
    console.log('❌ Frontend: Too fast completion');
    return { isValid: false, reason: isDutch
      ? 'Scan te snel voltooid. Neem meer tijd om elke afbeelding te bekijken.'
      : 'Scan completed too quickly. Please take more time to view each image.' };
  }

  console.log('✅ Frontend validation passed');
  return { isValid: true, reason: 'Valid scan' };
}

function showValidationError(reason) {
  // Hide the game prompt text on invalid state
  try {
    const promptEl = document.getElementById('gamePrompt');
    if (promptEl) promptEl.style.display = 'none';
  } catch(_) {}

  const isDutch = document.documentElement.lang === 'nl';
  // Render invalid message with a button using the shared btn-pill style
  cardDiv.innerHTML = `
    <div style="text-align: center; color: #F44336; padding: 20px;">
      <h3 style="color: #F44336; margin-bottom: 15px;">⚠️ ${isDutch ? 'Ongeldige Scan' : 'Invalid Scan'}</h3>
      <p style="margin-bottom: 20px;">${reason}</p>
      <button id="retakeScanBtn" type="button" class="btn-pill" style="color: var(--brand-pink, #e91e63);">${isDutch ? 'Scan Opnieuw' : 'Retake Scan'}</button>
    </div>
  `;
  try {
    const btn = document.getElementById('retakeScanBtn');
    if (btn) btn.addEventListener('click', () => { location.reload(); });
  } catch(_) {}

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

// Button event listeners - immediate record; visual feedback handled via :active CSS
if (yesBtn) {
  yesBtn.addEventListener('click', () => recordAnswer(true, 'click'));
  yesBtn.addEventListener('click', () => { yesBtn.classList.add('flash-yes'); setTimeout(()=>yesBtn.classList.remove('flash-yes'), 220); });
}
if (noBtn) {
  noBtn.addEventListener('click', () => recordAnswer(false, 'click'));
  noBtn.addEventListener('click', () => { noBtn.classList.add('flash-no'); setTimeout(()=>noBtn.classList.remove('flash-no'), 220); });
}

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
      recordAnswer(false, 'keyboard-arrow');
      break;
    case 'ArrowRight':
      e.preventDefault();
      recordAnswer(true, 'keyboard-arrow');
      break;
  }
}

function handleGlobalKeydown(e) {
  // Only handle Y/N keys when game is visible and buttons are shown
  if (gameDiv.style.display === 'none' || buttonsDiv.style.display === 'none') return;

  switch(e.key.toLowerCase()) {
    case 'y':
      e.preventDefault();
      recordAnswer(true, 'keyboard-yn');
      break;
    case 'n':
      e.preventDefault();
      recordAnswer(false, 'keyboard-yn');
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
    recordAnswer(false, 'keyboard-arrow');
    hideGameHint();
  }
  if (e.key === 'ArrowRight') {
    e.preventDefault();
    if (document.activeElement && document.activeElement.blur) { document.activeElement.blur(); }
    const btn = document.getElementById('yesBtn');
    if (btn) { btn.classList.add('flash-yes'); setTimeout(()=>btn.classList.remove('flash-yes'), 220); }
    recordAnswer(true, 'keyboard-arrow');
    hideGameHint();
  }
});

function hideGameHint(){
  const hint = document.getElementById('gameKeyboardHint');
  if (hint) hint.style.display = 'none';
}
