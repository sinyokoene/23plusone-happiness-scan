(function(){
  'use strict';

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
    'I am satisfied with my life',
    'So far I have gotten the important things I want in life',
    'If I could live my life over, I would change almost nothing'
  ];

  const who5Section = document.getElementById('who5');
  const swlsSection = document.getElementById('swls');
  const scanHost = document.getElementById('scanHost');
  const toSwlsBtn = document.getElementById('toSwls');
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
      const node = tpl.content.cloneNode(true);
      const label = node.querySelector('label');
      label.textContent = text;
      node.querySelectorAll('.choice').forEach(btn => {
        btn.addEventListener('click', () => {
          const value = parseInt(btn.dataset.val, 10);
          answers[idx] = value;
          // visual state
          node.querySelectorAll('.choice').forEach(b => b.classList.remove('bg-pink-600','text-white','border-pink-600'));
          btn.classList.add('bg-pink-600','text-white','border-pink-600');
        });
      });
      container.appendChild(node);
    });
  }

  function show(el){ el.classList.add('active'); el.style.display='flex'; }
  function hide(el){ el.classList.remove('active'); el.style.display='none'; }

  function allAnswered(arr){ return arr.every(v => v !== null); }

  async function submitResearch(){
    const payload = {
      sessionId: `research-${Date.now()}-${Math.random().toString(36).slice(2,9)}`,
      who5: who5Answers,
      swls: swlsAnswers,
      userAgent: navigator.userAgent
    };
    try {
      await fetch('/api/research', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      // Silent fail - research is optional for flow
      console.warn('Research submit failed', e);
    }
  }

  // Initialize
  renderLikert(who5Form, who5RowTpl, who5Items, who5Answers);
  renderLikert(swlsForm, swlsRowTpl, swlsItems, swlsAnswers);

  toSwlsBtn.addEventListener('click', () => {
    if (!allAnswered(who5Answers)) { return; }
    hide(who5Section); show(swlsSection);
  });

  toScanBtn.addEventListener('click', async () => {
    if (!allAnswered(swlsAnswers)) { return; }
    await submitResearch();
    hide(swlsSection); show(scanHost);
  });
})();


