// 23plusone Happiness Scan - Intro interactions
'use strict';

// Intro GIF desktop tilt
let disableIntroTilt = function(){};
function enableIntroGifTiltIfDesktop(){
  if (!isDesktop) return;
  const areaEl = document.getElementById('introGifContainer');
  const tiltEl = document.getElementById('introGifImage');
  if (!areaEl || !tiltEl) return;
  // Cleanup any previous
  disableIntroTilt();
  let rafId = null;
  let currentRX = 0, currentRY = 0;
  const maxTilt = 6;
  const damp = 0.12;
  const applyTransform = () => {
    tiltEl.style.transform = `perspective(800px) rotateX(${currentRX}deg) rotateY(${currentRY}deg)`;
  };
  const onMouseMove = (e) => {
    const rect = areaEl.getBoundingClientRect();
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
  // prime styles on the image so container's rounded corners keep clipping intact
  tiltEl.style.willChange = 'transform';
  tiltEl.style.backfaceVisibility = 'hidden';
  tiltEl.style.transformOrigin = 'center center';
  areaEl.addEventListener('mousemove', onMouseMove);
  areaEl.addEventListener('mouseleave', onMouseLeave);
  disableIntroTilt = function(){
    try {
      areaEl.removeEventListener('mousemove', onMouseMove);
      areaEl.removeEventListener('mouseleave', onMouseLeave);
    } catch(_) {}
    if (rafId) cancelAnimationFrame(rafId);
    rafId = null;
    currentRX = 0; currentRY = 0;
    tiltEl.style.transition = 'transform 120ms ease-out';
    tiltEl.style.transform = 'none';
    setTimeout(() => { tiltEl.style.transition = ''; }, 140);
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
