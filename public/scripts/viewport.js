/**
 * Dynamic Viewport Height Handler
 * Fixes mobile browser viewport issues by calculating real viewport height
 * and updating CSS custom property --vh
 */

(function() {
  'use strict';

  // Function to set real viewport height
  function setRealViewportHeight() {
    // Calculate 1% of current viewport height
    const vh = window.innerHeight * 0.01;
    
    // Set CSS custom property --vh
    document.documentElement.style.setProperty('--vh', `${vh}px`);
    
    // Debug logging (remove in production)
    if (window.location.search.includes('debug=true')) {
      console.log(`Viewport height updated: ${window.innerHeight}px, --vh: ${vh}px`);
    }
  }

  // Debounce function to limit resize event frequency
  function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  // Debounced resize handler (100ms delay)
  const debouncedSetViewportHeight = debounce(setRealViewportHeight, 100);

  // Set initial viewport height
  setRealViewportHeight();

  // Update on window resize
  window.addEventListener('resize', debouncedSetViewportHeight);

  // Update on orientation change (mobile)
  window.addEventListener('orientationchange', () => {
    // Small delay to let browser finish orientation change
    setTimeout(setRealViewportHeight, 100);
  });

  // Update on visual viewport changes (for browsers that support it)
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', debouncedSetViewportHeight);
  }

  // For iOS Safari - handle address bar show/hide
  let lastHeight = window.innerHeight;
  
  const checkViewportChange = () => {
    if (Math.abs(window.innerHeight - lastHeight) > 50) { // Significant change
      setRealViewportHeight();
      lastHeight = window.innerHeight;
    }
  };

  // Check for viewport changes on scroll (iOS Safari address bar)
  let scrollTimer;
  window.addEventListener('scroll', () => {
    clearTimeout(scrollTimer);
    scrollTimer = setTimeout(checkViewportChange, 150);
  }, { passive: true });

  // Also check on focus events (when keyboard appears/disappears)
  window.addEventListener('focusin', debouncedSetViewportHeight);
  window.addEventListener('focusout', debouncedSetViewportHeight);

})();
