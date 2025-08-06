// 23plusone Happiness Scan - Main JavaScript
(function() {
  let cards = [];
  let deck = [];
  let currentCardIndex = 0;
  let answers = [];
  let startTime = 0;
  let scanStartTime = 0; // Track start of entire scan
  let timerInterval = null;
  let timerTimeouts = []; // Track all timer-related timeouts
  let timerActive = false; // Flag to prevent timer conflicts

  
  // DOM elements
  const introDiv = document.getElementById('intro');
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
  const buttonsDiv = document.querySelector('.buttons');
  const yesBtn = document.getElementById('yesBtn');
  const noBtn = document.getElementById('noBtn');
  
  // Helper function to control which section is visible
  function showSection(sectionToShow) {
    console.log('🔄 showSection called with:', sectionToShow);
    
    // Hide all main sections first
    [introDiv, countdownDiv, gameDiv, processingDiv, resultsDiv].forEach(div => {
      if (div) {
        div.classList.remove('active-section');
        console.log('Removed active-section from:', div.id);
      }
    });
  
    // Then show the requested section
    if (sectionToShow) {
      sectionToShow.classList.add('active-section');
      console.log('✅ Added active-section to:', sectionToShow.id);
    }
  }
  
  // Start button event listener with comprehensive debugging
  if (startBtn) {
    console.log('Start button found:', startBtn);
    
    // Add multiple event listeners to ensure one works
    startBtn.addEventListener('click', function(e) {
      console.log('Button clicked - addEventListener method');
      e.preventDefault();
      e.stopPropagation();
      startScan();
    });
    
    startBtn.onclick = function(e) {
      console.log('Button clicked - onclick method');
      e.preventDefault();
      e.stopPropagation();
      startScan();
    };
    
    // Test if button is clickable
    startBtn.addEventListener('touchstart', function() {
      console.log('Button touch detected');
    });
    
    console.log('All event listeners attached to start button');
  } else {
    console.error('Start button not found!');
  }
  
  function startScan() {
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
    
    // Wrapping up... (1.0 seconds) then show results
    setTimeout(() => {
      // Hide processing, show results
      showSection(resultsDiv);
      
      // Change body layout for results
      document.body.classList.add('showing-results');
      
      // Display enhanced results
      displayEnhancedResults(results);
      
      // Submit to backend
      submitResults(results);
      
      // Setup sharing
      setupSharing(results);
    }, 3000); // 1200 + 800 + 1000
  }
  
  // Initialize page state
  document.body.classList.remove('showing-results');
  showSection(introDiv); // Show the intro section by default
  
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
    
    // Display card (visual only - no text labels)
    cardDiv.innerHTML = `
      <div id="cardImages">
        <img src="${card.images[0]}" alt="Happiness card" class="card-image" 
             tabindex="0" role="img"
             onerror="this.style.display='none'" style="opacity: 1 !important;">
      </div>
    `;
    
    // Show timer and buttons
    timerContainer.style.display = 'block';
    buttonsDiv.style.display = 'flex';
    
    // Setup swipe listeners and keyboard navigation for the new card
    setTimeout(() => {
      setupSwipeListeners();
      setupKeyboardNavigation();
      // Ensure card is fully visible and reset any lingering styles
      const cardImage = document.querySelector('.card-image');
      if (cardImage) {
        cardImage.style.opacity = '1';
        cardImage.style.transform = '';
        cardImage.style.transition = '';
      }
    }, 100);
    
    // Reset and start timer
    startTimer();
    
    // Record start time for individual card response time
    startTime = Date.now();
  }
  
  function startTimer() {
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
    
    // Reset timer immediately
    timerProgress.style.transition = 'none';
    timerProgress.style.width = '100%';
    timerProgress.className = ''; // Remove any existing classes
    timerProgress.style.background = '#4CAF50'; // Start with green
    
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
      timerProgress.className = 'warning';
    }, 2000);
    timerTimeouts.push(timeout2);
    
    const timeout3 = setTimeout(() => {
      if (!timerActive) return;
      timerProgress.className = 'danger';
    }, 3000);
    timerTimeouts.push(timeout3);
    
    // Auto-submit "No" after 4 seconds
    timerInterval = setTimeout(() => {
      if (!timerActive) return;
      recordAnswer(false);
    }, 4000);
  }
  
  function recordAnswer(isYes) {
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
  
  function calculateIHS() {
    // Time multipliers based on response speed
    function getTimeMultiplier(time) {
      if (time <= 1000) return 1.0;
      if (time <= 2000) return 0.8;
      if (time <= 3000) return 0.6;
      return 0.4;
    }
    
    // N1: Affirmations + Time
    const n1 = answers
      .filter(a => a.yes)
      .reduce((sum, a) => sum + (4 * getTimeMultiplier(a.time)), 0);
    
    // N2: Domain Coverage
    const uniqueDomains = new Set(answers.filter(a => a.yes).map(a => a.domain));
    const n2 = uniqueDomains.size * 19.2;
    
    // N3: Spread Score
    const domainCounts = {};
    const totalAnswers = answers.length;
    
    answers.filter(a => a.yes).forEach(a => {
      domainCounts[a.domain] = (domainCounts[a.domain] || 0) + 1;
    });
    
    const domainPercentages = Object.values(domainCounts).map(count => count / totalAnswers);
    const spreadDeviation = domainPercentages.reduce((sum, pct) => sum + Math.abs(pct - 0.2), 0);
    const n3 = ((1.6 - spreadDeviation) / 1.6) * 100;
    
    // Final IHS
    const ihs = (0.4 * n1) + (0.4 * n2) + (0.2 * Math.max(0, n3));
    
    return {
      ihs: Math.round(ihs * 10) / 10,
      n1: Math.round(n1 * 10) / 10,
      n2: Math.round(n2 * 10) / 10,
      n3: Math.round(n3 * 10) / 10,
      domainCounts
    };
  }
  
  // Frontend validation to match server-side validation
  function validateScanQuality() {
    const selectedCount = answers.filter(a => a.yes).length;
    const totalResponses = answers.length;
    const totalTime = scanStartTime > 0 ? (Date.now() - scanStartTime) / 1000 : 0; // Use scan start time
    
    console.log('🔍 Frontend validation:', {
      totalResponses,
      selectedCount,
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
    
    // Update dominant domains text
    const topDomainsText = getDominantDomainsText(domainData);
    document.getElementById('topDomains').textContent = topDomainsText;
    
    // Update domain bars with animation
    updateDomainBars(results.domainCounts);
    
    // Generate personalized insights
    generatePersonalizedInsights(domainData, results);
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
  
  function updateDomainBars(domainCounts) {
    const domainMaxes = {
      'Basics': 6,
      'Self-development': 6, 
      'Ambition': 8,
      'Vitality': 2,
      'Attraction': 2
    };
    
    Object.keys(domainMaxes).forEach(domain => {
      const count = domainCounts[domain] || 0;
      const percentage = (count / domainMaxes[domain]) * 100;
      
      // Update count
      const countElement = document.querySelector(`[data-domain="${domain}"] .bar-count`);
      if (countElement) {
        countElement.textContent = count;
        countElement.setAttribute('aria-label', `${count} selections`);
      }
      
      // Animate bar
      setTimeout(() => {
        const barFill = document.querySelector(`[data-domain="${domain}"] .bar-fill`);
        if (barFill) {
          barFill.style.width = percentage + '%';
        }
        
        // Update progress bar ARIA attributes
        const barContainer = document.querySelector(`[data-domain="${domain}"] .bar-container`);
        if (barContainer) {
          barContainer.setAttribute('aria-valuenow', count);
        }
      }, 500);
    });
  }
  
  function generatePersonalizedInsights(domainData, results) {
    const topDomain = domainData[0];
    const totalSelected = domainData.reduce((sum, d) => sum + d.count, 0);
    
    // Generate insight text
    let insightText = '';
    let recommendations = [];
    
    if (totalSelected <= 5) {
      insightText = "You're selective and intentional with what brings you joy. Quality over quantity defines your happiness approach.";
      recommendations = [
        "Dive deeper into the few things that truly matter to you",
        "Practice mindfulness to appreciate your chosen sources of joy",
        "Consider exploring one new area gradually"
      ];
    } else if (totalSelected <= 12) {
      insightText = "You have a balanced happiness palette - diverse but not overwhelming. You appreciate variety while staying grounded.";
      recommendations = [
        "Keep nurturing your diverse interests",
        "Notice patterns in what consistently brings you joy",
        "Share your balanced approach with others"
      ];
    } else {
      insightText = "You're a happiness maximalist! You find joy in many places and aren't afraid to embrace life's full spectrum.";
      recommendations = [
        "Your enthusiasm is contagious - share it!",
        "Ensure you have time to fully enjoy each source of happiness",
        "Consider prioritizing to avoid happiness overwhelm"
      ];
    }
    
    // Add domain-specific insights
    if (topDomain.count > 0) {
      const domainInsights = {
        'Basics': "Your foundation is strong - you value security, connection, and moral clarity.",
        'Self-development': "You're driven by growth and self-expression - a true lifelong learner.",
        'Ambition': "Achievement and recognition fuel your fire - you're built to succeed.",
        'Vitality': "Energy and health are your superpowers - you prioritize feeling alive.",
        'Attraction': "Beauty and allure matter to you - you appreciate life's aesthetic pleasures."
      };
      
      insightText += ` ${domainInsights[topDomain.name]}`;
    }
    
    // Update the display
    document.getElementById('insightText').textContent = insightText;
    
    const recList = document.getElementById('recommendationsList');
    recList.innerHTML = '';
    recommendations.forEach(rec => {
      const li = document.createElement('li');
      li.textContent = rec;
      recList.appendChild(li);
    });
  }
  
  function submitResults(results) {
    // Create complete card selections with ALL responses
    const cardSelections = {
      domains: [],
      selected: [],    // Cards answered "Yes"
      rejected: [],    // Cards answered "No"
      allResponses: [] // Complete response data
    };
    
    // Process ALL answers (both Yes and No)
    answers.forEach(answer => {
      // Add to complete responses
      cardSelections.allResponses.push({
        cardId: answer.id,
        domain: answer.domain,
        label: answer.label,
        response: answer.yes,
        responseTime: answer.time
      });
      
      // Track selected vs rejected
      if (answer.yes) {
        cardSelections.selected.push(answer.id);
      } else {
        cardSelections.rejected.push(answer.id);
      }
      
      // Track unique domains from all responses
      if (!cardSelections.domains.includes(answer.domain)) {
        cardSelections.domains.push(answer.domain);
      }
    });
    
    const payload = {
      sessionId: `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      cardSelections: cardSelections,
      ihsScore: results.ihs,
      n1Score: results.n1, // Now properly sending calculated N1 score
      n2Score: results.n2, // Now properly sending calculated N2 score
      n3Score: results.n3, // Now properly sending calculated N3 score
      completionTime: scanStartTime > 0 ? Math.round((Date.now() - scanStartTime) / 1000) : 0,
      userAgent: navigator.userAgent,
      totalCards: answers.length, // Should be 24
      selectedCount: cardSelections.selected.length,
      rejectedCount: cardSelections.rejected.length
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
    const copyLinkBtn = document.getElementById('copyLinkBtn');
    
    const shareText = `I just completed the 23plusone Happiness Scan and scored ${results.ihs}! Discover what drives your happiness.`;
    const shareUrl = window.location.href;
    
    // Native share handler
    nativeShareBtn.addEventListener('click', async () => {
      if (navigator.share) {
        try {
          await navigator.share({
            title: '23plusone Happiness Scan',
            text: shareText,
            url: shareUrl
          });
        } catch (err) {
          // User cancelled or error occurred, fallback to copy
          if (err.name !== 'AbortError') {
            copyToClipboard(shareUrl, copyLinkBtn);
          }
        }
      } else {
        // Fallback for browsers without Web Share API
        copyToClipboard(shareUrl, copyLinkBtn);
      }
    });
    
    // Copy link handler
    copyLinkBtn.addEventListener('click', () => {
      copyToClipboard(shareUrl, copyLinkBtn);
    });
    
    async function copyToClipboard(text, button) {
      try {
        await navigator.clipboard.writeText(text);
        button.innerHTML = '<span>Copied!</span>';
        button.classList.add('copied');
        setTimeout(() => {
          button.innerHTML = '<span>Copy Link</span>';
          button.classList.remove('copied');
        }, 2000);
      } catch (err) {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        
        button.innerHTML = '<span>Copied!</span>';
        button.classList.add('copied');
        setTimeout(() => {
          button.innerHTML = '<span>Copy Link</span>';
          button.classList.remove('copied');
        }, 2000);
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
    
    // Update the statistics with cleaner, non-redundant labels
    document.getElementById('benchmarkYourScore').textContent = results.ihs;
    document.getElementById('benchmarkTotal').textContent = benchmark.totalResponses.toLocaleString();
    document.getElementById('benchmarkAverage').textContent = benchmark.context.averageScore || '--';
    
    console.log('Benchmark display updated with top percentage:', topPercentage);
  }
  
  // Button event listeners
  yesBtn.addEventListener('click', () => recordAnswer(true));
  noBtn.addEventListener('click', () => recordAnswer(false));
  
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
      yesBtn.style.background = '#66bb6a';
      yesBtn.style.transform = 'scale(1.1)';
    } else {
      noBtn.style.background = '#ef5350';
      noBtn.style.transform = 'scale(1.1)';
    }
    
    setTimeout(() => {
      if (yesBtn) {
        yesBtn.style.background = '';
        yesBtn.style.transform = '';
      }
      if (noBtn) {
        noBtn.style.background = '';
        noBtn.style.transform = '';
      }
    }, 200);
  }
})();
