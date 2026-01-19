// 23plusone Happiness Scan - Section visibility
'use strict';

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
