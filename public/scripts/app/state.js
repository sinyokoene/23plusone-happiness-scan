// 23plusone Happiness Scan - Shared state and DOM bindings
'use strict';

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
let cardInsightsData = null; // Card-specific insights data
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
