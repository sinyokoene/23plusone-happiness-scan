// 23plusone Happiness Scan - Bootstrap
'use strict';

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

// Load cards and card insights data
const isDutch = document.documentElement.lang === 'nl';
Promise.all([
  fetch('data/cards.json').then(r => r.json()),
  fetch(isDutch ? 'data/card-insights-nl.json' : 'data/card-insights.json').then(r => r.json()).catch(() => null)
])
  .then(([cardsJson, insightsJson]) => {
    cards = cardsJson;
    cardInsightsData = insightsJson;
    // Cards loaded, now preload all images for instant display
    console.log('Cards loaded, starting image preload...');
    if (cardInsightsData) console.log('Card insights data loaded');
    preloadCardImages();
  })
  .catch(err => {
    console.error('Error loading cards:', err);
    startBtn.textContent = 'Error loading - Please refresh';
    startBtn.disabled = true;
  });

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
