document.addEventListener('DOMContentLoaded', () => {
  // Dynamically resolve backend server URL (handles VS Code Live Server on 5500 or file:// or direct port 5000)
  const API_BASE = (window.location.port !== '5000') 
    ? `${window.location.protocol === 'file:' ? 'http:' : window.location.protocol}//${window.location.hostname || '127.0.0.1'}:5000` 
    : '';

  // Socket.IO Connection
  const socket = io(API_BASE || undefined);

  // Helper: Escape HTML to prevent XSS & DOM breakage
  function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // State Variables
  let currentVisitor = JSON.parse(sessionStorage.getItem('exhibition_visitor') || 'null');
  let questions = [];
  let currentQuestionIndex = 0;
  let userAnswers = [];
  let quizStartTime = 0;
  let questionTimerInterval = null;
  let timeRemaining = 15;
  let totalQuizTime = 0;

  // DOM Elements
  const stepRegister = document.getElementById('step-register');
  const stepPending = document.getElementById('step-pending');
  const stepVerifiedWaiting = document.getElementById('step-verified-waiting');
  const stepQuiz = document.getElementById('step-quiz');
  const stepWaitingOthers = document.getElementById('step-waiting-others');
  const stepResults = document.getElementById('step-results');

  const waitingSubmittedCount = document.getElementById('waiting-submitted-count');
  const waitingPersonalScore = document.getElementById('waiting-personal-score');
  const waitingPersonalTime = document.getElementById('waiting-personal-time');

  const formRegister = document.getElementById('form-register');
  const pendingIdDisplay = document.getElementById('pending-id-display');
  const visitorQrContainer = document.getElementById('visitor-qr-code');
  const btnSelfVerify = document.getElementById('btn-self-verify');

  const verifiedIdDisplay = document.getElementById('verified-id-display');
  const verifiedNameDisplay = document.getElementById('verified-name-display');
  const verifiedSlotYouName = document.getElementById('verified-slot-you-name');
  const btnToggleVerifiedQr = document.getElementById('btn-toggle-verified-qr');
  const verifiedQrCollapse = document.getElementById('verified-qr-collapse');
  const verifiedQrContainer = document.getElementById('verified-qr-code');

  const visitorGroupCard = document.getElementById('visitor-group-card');
  const visitorGroupName = document.getElementById('visitor-group-name');
  const visitorGroupStatusMsg = document.getElementById('visitor-group-status-msg');
  const visitorPlayerAlert = document.getElementById('visitor-player-alert');
  const visitorPlayerAlertText = document.getElementById('visitor-player-alert-text');
  const waitingNoticeTitle = document.getElementById('waiting-notice-title');
  const waitingNoticeSub = document.getElementById('waiting-notice-sub');
  const waitingNoticeDesc = document.getElementById('waiting-notice-desc');
  const slotsHeaderTitle = document.getElementById('slots-header-title');
  const visitorSlotsGrid = document.getElementById('visitor-slots-grid');
  const slotsFootnoteText = document.getElementById('slots-footnote-text');
  const btnVisitorReady = document.getElementById('btn-visitor-ready');
  const visitorReadyConfirmedBadge = document.getElementById('visitor-ready-confirmed-badge');
  const visitorReadyPrompt = document.getElementById('visitor-ready-prompt');
  const modalQuizReady = document.getElementById('modal-quiz-ready');
  const btnModalStartQuiz = document.getElementById('btn-modal-start-quiz');
  const modalReadyTeamName = document.getElementById('modal-ready-team-name');

  let visitorIsReady = false;
  let lastGroupData = null;
  let pendingQuizTeam = null;

  const questionProgressText = document.getElementById('question-progress-text');
  const quizTimer = document.getElementById('quiz-timer');
  const quizTimerPill = document.getElementById('quiz-timer-pill');
  const quizProgressFill = document.getElementById('quiz-progress-fill');
  const allQuestionsContainer = document.getElementById('all-questions-container');
  const btnSubmitQuiz = document.getElementById('btn-submit-quiz');

  const resultName = document.getElementById('result-name');
  const resultScore = document.getElementById('result-score');
  const resultTime = document.getElementById('result-time');
  const resultRank = document.getElementById('result-rank');

  // Load Info
  fetch(`${API_BASE}/api/info`)
    .then(res => res.json())
    .then(data => {
      if (data.exhibition_title) {
        document.title = data.exhibition_title;
        const titleElem = document.getElementById('header-title');
        if (titleElem) titleElem.innerText = data.exhibition_title;
      }
      if (data.main_stall_name) {
        const stallElem = document.getElementById('header-stall-name');
        if (stallElem) stallElem.innerText = data.main_stall_name;
      }
    }).catch(e => console.log('Info fetch error:', e));

  // Listen to real-time team submission progress
  socket.on('team_progress_update', (data) => {
    if (waitingSubmittedCount) {
      waitingSubmittedCount.innerText = `${data.submitted_count} / ${data.total_players} Players Submitted`;
    }
  });

  // Listen to final round completed broadcast
  socket.on('quiz_completed', (result) => {
    console.log('Received quiz_completed event!', result);
    showResultsScreen(result);
  });

  // Listen to live settings updates
  socket.on('settings_updated', (data) => {
    if (data.exhibition_title) {
      document.title = data.exhibition_title;
      const titleElem = document.getElementById('header-title');
      if (titleElem) titleElem.innerText = data.exhibition_title;
    }
    if (data.main_stall_name) {
      const stallElem = document.getElementById('header-stall-name');
      if (stallElem) stallElem.innerText = data.main_stall_name;
    }
  });

  // Listen to system data reset event
  socket.on('data_reset', () => {
    sessionStorage.removeItem('exhibition_visitor');
    currentVisitor = null;
    if (questionTimerInterval) clearInterval(questionTimerInterval);
    showRegistrationScreen();
  });

  // Auto join room on socket connect/reconnect
  socket.on('connect', () => {
    if (currentVisitor && currentVisitor.id) {
      socket.emit('join_visitor', { visitor_id: currentVisitor.id });
    }
  });

  // Listen to real-time check-in verification from Admin
  socket.on('visitor_verified', (data) => {
    console.log('Real-time visitor_verified event received:', data);
    if (data && data.visitor && (!currentVisitor || data.visitor.id === currentVisitor.id)) {
      currentVisitor = data.visitor;
      sessionStorage.setItem('exhibition_visitor', JSON.stringify(currentVisitor));
      showVerifiedWaitingScreen();
    }
  });

  // Listen to visitor status updates
  socket.on('visitor_status', (data) => {
    console.log('Real-time visitor_status received:', data);
    if (data && data.visitor && currentVisitor && data.visitor.id === currentVisitor.id) {
      currentVisitor = data.visitor;
      sessionStorage.setItem('exhibition_visitor', JSON.stringify(currentVisitor));
      if (currentVisitor.status === 'verified') {
        showVerifiedWaitingScreen();
      } else if (currentVisitor.status === 'in_team') {
        startQuizFlow(data.team);
      }
    }
  });

  // Real-time Group Formation Sockets
  socket.on('group_created', (data) => {
    if (data) {
      showPlayerAlertToast(
        `⚡ <strong>New Group Created: ${escapeHtml(data.team_name)}</strong>! Admin is now adding players...`,
        '#eff6ff', '#3b82f6', '#1e3a8a'
      );
      updateVisitorGroupUI(data);
    }
  });

  socket.on('group_updated', (data) => {
    if (data) {
      updateVisitorGroupUI(data);
    } else {
      resetVisitorGroupUI();
    }
  });

  socket.on('group_player_added', (data) => {
    if (data) {
      const name = data.last_added ? data.last_added.name : 'A new player';
      const isYou = (currentVisitor && data.last_added && data.last_added.id === currentVisitor.id);
      if (isYou) {
        showPlayerAlertToast(
          `🎉 <strong>You were added to ${escapeHtml(data.team_name)}!</strong> (Slot ${data.slot_number}/5)`,
          '#dcfce7', '#16a34a', '#15803d'
        );
      } else {
        showPlayerAlertToast(
          `👤 Player <strong>${escapeHtml(name)}</strong> was added to ${escapeHtml(data.team_name)}! (${data.slot_number}/5)`,
          '#ecfdf5', '#10b981', '#065f46'
        );
      }
      updateVisitorGroupUI(data);
    }
  });

  socket.on('you_joined_group', (data) => {
    if (data) {
      showPlayerAlertToast(
        `🎉 <strong>You have joined ${escapeHtml(data.team_name)}!</strong> Get ready for the quiz!`,
        '#dcfce7', '#16a34a', '#15803d'
      );
      updateVisitorGroupUI(data);
    }
  });

  socket.on('group_cancelled', () => {
    showPlayerAlertToast(
      `ℹ️ Group formation cancelled by Admin. Waiting for the next group...`,
      '#fef2f2', '#ef4444', '#b91c1c'
    );
    resetVisitorGroupUI();
  });

  // Collapsible QR code toggle on verified screen
  window.toggleVerifiedQrClick = function() {
    if (!verifiedQrCollapse || !btnToggleVerifiedQr) return;
    const isHidden = (verifiedQrCollapse.style.display === 'none' || !verifiedQrCollapse.style.display);
    verifiedQrCollapse.style.display = isHidden ? 'block' : 'none';
    btnToggleVerifiedQr.innerText = isHidden ? '✕ Hide QR Code' : '📱 View My QR Code';
  };
  if (btnToggleVerifiedQr) {
    btnToggleVerifiedQr.addEventListener('click', window.toggleVerifiedQrClick);
  }

  // Check saved state
  if (currentVisitor) {
    checkVisitorStatus(currentVisitor.id);
  }

  function showRegistrationScreen() {
    visitorIsReady = false;
    stepRegister.style.display = 'block';
    stepPending.style.display = 'none';
    if (stepVerifiedWaiting) stepVerifiedWaiting.style.display = 'none';
    stepQuiz.style.display = 'none';
    if (stepWaitingOthers) stepWaitingOthers.style.display = 'none';
    stepResults.style.display = 'none';
  }

  // 1. Form Registration Submit
  formRegister.addEventListener('submit', (e) => {
    e.preventDefault();

    const name = document.getElementById('reg-name').value.trim();
    const age = document.getElementById('reg-age').value.trim();
    const phone = document.getElementById('reg-phone').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const company = document.getElementById('reg-company').value.trim();
    const solarElem = document.getElementById('reg-solar');
    const solar_interest = (solarElem && solarElem.checked) ? 'Yes' : 'No';

    if (!name || !phone || !age) {
      alert('Please fill in Full Name, select your Age Range, and enter your Phone number!');
      return;
    }

    fetch(`${API_BASE}/api/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        name: name,
        age: age,
        phone: phone, 
        email: email, 
        company: company, 
        solar_interest: solar_interest 
      })
    })
    .then(res => res.json())
    .then(data => {
      if (data.status === 'success') {
        currentVisitor = data.visitor;
        sessionStorage.setItem('exhibition_visitor', JSON.stringify(currentVisitor));
        setupPendingScreen('Waiting for Main Hall check-in & team formation...');
      } else {
        alert(data.message || 'Registration failed!');
      }
    })
    .catch(err => {
      console.error(err);
      alert('Network error. Please make sure the Python server (app.py) is running on port 5000!');
    });
  });

  // 2. Setup Pending Screen (Waiting to Visit Main Stall)
  function setupPendingScreen(statusMsg) {
    if (!currentVisitor) return;

    stepRegister.style.display = 'none';
    if (stepVerifiedWaiting) stepVerifiedWaiting.style.display = 'none';
    stepQuiz.style.display = 'none';
    if (stepWaitingOthers) stepWaitingOthers.style.display = 'none';
    stepResults.style.display = 'none';
    stepPending.style.display = 'block';

    if (pendingIdDisplay) pendingIdDisplay.innerText = currentVisitor.id;
    const statusTextElem = document.getElementById('pending-status-text');
    if (statusTextElem && statusMsg) {
      statusTextElem.innerText = statusMsg;
    }

    // Generate QR Code
    if (visitorQrContainer) {
      visitorQrContainer.innerHTML = '';
      new QRCode(visitorQrContainer, {
        text: currentVisitor.id,
        width: 180,
        height: 180,
        colorDark: '#0f172a',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.H
      });
    }

    // Join Socket Room
    socket.emit('join_visitor', { visitor_id: currentVisitor.id });

    // Poll status fallback every 2 seconds
    startStatusPolling();
  }

  // ===================================================================
  // 2.5 Setup Verified Waiting Screen (Waiting for 5-Player Group Formation)
  // ===================================================================
  function showVerifiedWaitingScreen() {
    if (!currentVisitor) return;

    stepRegister.style.display = 'none';
    stepPending.style.display = 'none';
    stepQuiz.style.display = 'none';
    if (stepWaitingOthers) stepWaitingOthers.style.display = 'none';
    stepResults.style.display = 'none';
    if (stepVerifiedWaiting) stepVerifiedWaiting.style.display = 'block';

    if (verifiedIdDisplay) verifiedIdDisplay.innerText = currentVisitor.id;
    if (verifiedNameDisplay) verifiedNameDisplay.innerText = currentVisitor.name || 'Visitor';
    if (verifiedSlotYouName) {
      const firstName = currentVisitor.name ? currentVisitor.name.split(' ')[0] : 'You';
      verifiedSlotYouName.innerText = `${firstName} (${visitorIsReady ? 'Ready' : 'Player'})`;
    }

    if (visitorIsReady) {
      if (btnVisitorReady) btnVisitorReady.style.display = 'none';
      if (visitorReadyConfirmedBadge) visitorReadyConfirmedBadge.style.display = 'inline-flex';
      if (visitorReadyPrompt) visitorReadyPrompt.innerText = 'You are ready! Standing by for host to launch the quiz round...';
    } else {
      if (btnVisitorReady) btnVisitorReady.style.display = 'block';
      if (visitorReadyConfirmedBadge) visitorReadyConfirmedBadge.style.display = 'none';
      if (visitorReadyPrompt) visitorReadyPrompt.innerText = 'Tap the button below to confirm you are ready to play!';
    }

    // Generate QR in collapsible container if not already generated
    if (verifiedQrContainer && verifiedQrContainer.children.length === 0) {
      new QRCode(verifiedQrContainer, {
        text: currentVisitor.id,
        width: 160,
        height: 160,
        colorDark: '#0f172a',
        colorLight: '#ffffff',
        correctLevel: QRCode.CorrectLevel.H
      });
    }

    // Join Socket Room
    socket.emit('join_visitor', { visitor_id: currentVisitor.id });

    // Fetch current forming group state immediately
    fetch(`${API_BASE}/api/group/current`)
      .then(res => res.json())
      .then(data => {
        if (data.status === 'success' && data.group) {
          updateVisitorGroupUI(data.group);
        } else {
          resetVisitorGroupUI();
        }
      })
      .catch(() => {});

    // Poll status fallback every 2 seconds
    startStatusPolling();
  }

  // Group Formation UI Updates for Visitor
  function updateVisitorGroupUI(groupData) {
    lastGroupData = groupData;
    if (!visitorSlotsGrid) return;

    if (groupData && groupData.team_name) {
      if (visitorGroupCard) visitorGroupCard.style.display = 'block';
      if (visitorGroupName) visitorGroupName.innerText = `Group: ${groupData.team_name}`;

      const members = groupData.members || [];
      const isInGroup = currentVisitor && members.some(m => m.id === currentVisitor.id);

      if (visitorGroupStatusMsg) {
        if (isInGroup) {
          visitorGroupStatusMsg.innerHTML = `🎉 You are assigned to <strong>${escapeHtml(groupData.team_name)}</strong>! Please wait for Admin to start the quiz.`;
        } else {
          visitorGroupStatusMsg.innerHTML = `Admin created <strong>${escapeHtml(groupData.team_name)}</strong>! Adding players...`;
        }
      }

      if (isInGroup) {
        if (waitingNoticeTitle) waitingNoticeTitle.innerHTML = `<span>🎉</span> Added to Team Successfully!`;
        if (waitingNoticeSub) waitingNoticeSub.innerHTML = `You are in <strong>${escapeHtml(groupData.team_name)}</strong>! Tap Ready to prepare for the quiz.`;
        if (waitingNoticeDesc) waitingNoticeDesc.innerHTML = `Once stall staff starts the quiz round, your 5-minute challenge will launch right here!`;
      } else {
        if (waitingNoticeTitle) waitingNoticeTitle.innerHTML = `<span>⏳</span> Waiting for Team Assignment`;
        if (waitingNoticeSub) waitingNoticeSub.innerHTML = `Waiting for Admin to add you to this group or the next team`;
        if (waitingNoticeDesc) waitingNoticeDesc.innerHTML = `Once stall staff adds you to a <strong>5-Player Team</strong>, your <strong>5-Minute Live Quiz Challenge</strong> will begin automatically!`;
      }

      if (slotsHeaderTitle) {
        slotsHeaderTitle.innerText = `Team Formation Status (${members.length} / 5 Added)`;
      }

      // Render 5 slots
      visitorSlotsGrid.innerHTML = '';
      for (let i = 0; i < 5; i++) {
        const slot = document.createElement('div');
        if (i < members.length) {
          const m = members[i];
          const isYou = (currentVisitor && m.id === currentVisitor.id);
          slot.className = `slot-item slot-filled ${isYou ? 'slot-is-you' : ''}`;
          const firstName = escapeHtml(m.name ? m.name.split(' ')[0] : 'Player');
          const displayName = isYou ? `${firstName} (You)` : firstName;
          const displayTag = isYou ? (visitorIsReady ? 'Ready ✅' : 'Ready?') : `Player ${i + 1}`;
          slot.innerHTML = `
            <div class="slot-avatar">${isYou ? '⭐' : '👤'}</div>
            <div class="slot-name" title="${escapeHtml(m.name)}">${displayName}</div>
            <div class="slot-tag">${displayTag}</div>
          `;
        } else {
          slot.className = 'slot-item slot-waiting';
          slot.innerHTML = `
            <div class="slot-avatar">⏳</div>
            <div class="slot-name">Player ${i + 1}</div>
            <div class="slot-tag">Waiting</div>
          `;
        }
        visitorSlotsGrid.appendChild(slot);
      }

      if (slotsFootnoteText) {
        if (members.length === 5) {
          slotsFootnoteText.innerHTML = `<span style="color: #15803d; font-weight: 700;">🟢 All 5 players ready! Admin is starting the quiz challenge...</span>`;
        } else {
          slotsFootnoteText.innerHTML = `<span>Admin is currently assigning players to this 5-player team</span>`;
        }
      }
    } else {
      resetVisitorGroupUI();
    }
  }

  function resetVisitorGroupUI() {
    lastGroupData = null;
    if (visitorGroupCard) visitorGroupCard.style.display = 'none';
    if (waitingNoticeTitle) waitingNoticeTitle.innerHTML = `<span>⏳</span> Waiting for Team Assignment`;
    if (waitingNoticeSub) waitingNoticeSub.innerHTML = `Waiting for Admin to assign you to a 5-Player Team`;
    if (waitingNoticeDesc) waitingNoticeDesc.innerHTML = `Once stall staff adds you to a <strong>5-Player Team</strong>, your <strong>5-Minute Live Quiz Challenge</strong> will launch directly on this screen!`;
    if (slotsHeaderTitle) slotsHeaderTitle.innerText = `Team Formation Status (0 / 5 Added)`;
    if (visitorSlotsGrid) {
      visitorSlotsGrid.innerHTML = `
        <div class="slot-item slot-waiting"><div class="slot-avatar">⏳</div><div class="slot-name">Player 1</div><div class="slot-tag">Waiting</div></div>
        <div class="slot-item slot-waiting"><div class="slot-avatar">⏳</div><div class="slot-name">Player 2</div><div class="slot-tag">Waiting</div></div>
        <div class="slot-item slot-waiting"><div class="slot-avatar">⏳</div><div class="slot-name">Player 3</div><div class="slot-tag">Waiting</div></div>
        <div class="slot-item slot-waiting"><div class="slot-avatar">⏳</div><div class="slot-name">Player 4</div><div class="slot-tag">Waiting</div></div>
        <div class="slot-item slot-waiting"><div class="slot-avatar">⏳</div><div class="slot-name">Player 5</div><div class="slot-tag">Waiting</div></div>
      `;
    }
    if (slotsFootnoteText) {
      slotsFootnoteText.innerHTML = `<span>Stall staff will form 5-player teams to launch the quiz round</span>`;
    }
  }

  let alertToastTimeout = null;
  function showPlayerAlertToast(htmlMessage, bg = '#ecfdf5', border = '#10b981', color = '#065f46') {
    if (!visitorPlayerAlert || !visitorPlayerAlertText) return;
    if (alertToastTimeout) clearTimeout(alertToastTimeout);

    visitorPlayerAlert.style.background = bg;
    visitorPlayerAlert.style.borderColor = border;
    visitorPlayerAlert.style.color = color;
    visitorPlayerAlertText.innerHTML = htmlMessage;
    visitorPlayerAlert.style.display = 'block';

    alertToastTimeout = setTimeout(() => {
      if (visitorPlayerAlert) visitorPlayerAlert.style.display = 'none';
    }, 5000);
  }

  // Check Visitor Status from backend
  function checkVisitorStatus(visitorId) {
    fetch(`${API_BASE}/api/visitor/${visitorId}`)
      .then(res => res.json())
      .then(data => {
        if (data.status === 'success') {
          currentVisitor = data.visitor;
          const currentTeam = data.team;
          sessionStorage.setItem('exhibition_visitor', JSON.stringify(currentVisitor));

          if (currentVisitor.status === 'pending_visit') {
            setupPendingScreen('Waiting for Main Hall check-in & team formation...');
          } else if (currentVisitor.status === 'verified') {
            showVerifiedWaitingScreen();
            if (data.forming_group) {
              updateVisitorGroupUI(data.forming_group);
            }
          } else if (currentVisitor.status === 'in_team') {
            handleQuizUnlocked(currentTeam);
          } else if (currentVisitor.status === 'completed') {
            showResultsScreen({
              team: currentTeam,
              score: currentTeam ? currentTeam.score : 0,
              total_questions: currentTeam ? currentTeam.total_questions : 0,
              time_taken_seconds: currentTeam ? currentTeam.time_taken_seconds : 0,
              rank: '-'
            });
          }
        } else {
          // Visitor not found (e.g. data reset by admin)
          sessionStorage.removeItem('exhibition_visitor');
          currentVisitor = null;
          showRegistrationScreen();
        }
      })
      .catch(err => {
        console.error('Check status error:', err);
      });
  }

  // Socket IO Listener for real-time team quiz unlock!
  socket.on('quiz_unlocked', (data) => {
    console.log('Quiz unlocked event received!', data);
    if (data.visitor && data.visitor.id === currentVisitor?.id) {
      currentVisitor = data.visitor;
      sessionStorage.setItem('exhibition_visitor', JSON.stringify(currentVisitor));
      handleQuizUnlocked(data.team);
    }
  });

  // Poll status interval
  let pollInterval = null;
  function startStatusPolling() {
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(() => {
      if (currentVisitor && (currentVisitor.status === 'pending_visit' || currentVisitor.status === 'verified')) {
        fetch(`${API_BASE}/api/visitor/${currentVisitor.id}`)
          .then(res => res.json())
          .then(data => {
            if (data && data.status === 'success' && data.visitor) {
              const oldStatus = currentVisitor.status;
              currentVisitor = data.visitor;
              sessionStorage.setItem('exhibition_visitor', JSON.stringify(currentVisitor));

              if (currentVisitor.status === 'verified') {
                if (oldStatus !== 'verified') {
                  showVerifiedWaitingScreen();
                } else if (data.forming_group) {
                  updateVisitorGroupUI(data.forming_group);
                } else if (!data.forming_group) {
                  resetVisitorGroupUI();
                }
              } else if (currentVisitor.status === 'in_team') {
                clearInterval(pollInterval);
                handleQuizUnlocked(data.team);
              }
            }
          })
          .catch(err => console.error('Poll status error:', err));
      } else {
        clearInterval(pollInterval);
      }
    }, 2000);
  }

  // 3. Start Quiz Flow
  function startQuizFlow(team) {
    if (pollInterval) clearInterval(pollInterval);

    stepRegister.style.display = 'none';
    stepPending.style.display = 'none';
    if (stepVerifiedWaiting) stepVerifiedWaiting.style.display = 'none';
    if (stepWaitingOthers) stepWaitingOthers.style.display = 'none';
    stepResults.style.display = 'none';
    stepQuiz.style.display = 'block';

    const tNameElem = document.getElementById('quiz-team-name-display');
    if (tNameElem && team) {
      const memberNames = (team.members || []).map(m => m.name).join(', ');
      tNameElem.innerText = `${team.team_name} (${team.members ? team.members.length : 5} Players)`;
    }

    const visitorIdParam = currentVisitor ? currentVisitor.id : '';
    const teamIdParam = team ? team.id : (currentVisitor ? currentVisitor.team_id || '' : '');
    fetch(`${API_BASE}/api/questions?visitor_id=${encodeURIComponent(visitorIdParam)}&team_id=${encodeURIComponent(teamIdParam)}`)
      .then(res => res.json())
      .then(data => {
        if (data.status === 'success' && data.questions && data.questions.length > 0) {
          questions = data.questions;
          userAnswers = new Array(questions.length).fill(null);
          quizStartTime = Date.now();
          renderAllQuestions();
          start2MinTimer();
        } else {
          alert('No quiz questions configured yet!');
        }
      })
      .catch(err => {
        console.error('Error fetching questions:', err);
        alert('Network error loading quiz questions.');
      });
  }

  // Start 5-Minute Overall Quiz Timer (300 Seconds)
  function start2MinTimer() {
    if (questionTimerInterval) clearInterval(questionTimerInterval);
    timeRemaining = 300; // 5 minutes = 300s
    updateTimerDisplay();

    questionTimerInterval = setInterval(() => {
      timeRemaining--;
      updateTimerDisplay();

      if (timeRemaining <= 0) {
        clearInterval(questionTimerInterval);
        alert('⏱️ Time is up! Submitting your team answers now.');
        finishAndSubmitQuiz();
      }
    }, 1000);
  }

  function updateTimerDisplay() {
    const mins = Math.floor(Math.max(0, timeRemaining) / 60);
    const secs = Math.max(0, timeRemaining) % 60;
    quizTimer.innerText = `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

    if (timeRemaining <= 30 && quizTimerPill) {
      quizTimerPill.style.background = 'rgba(239, 68, 68, 0.15)';
      quizTimerPill.style.color = '#ef4444';
      quizTimerPill.style.borderColor = '#ef4444';
    }
  }

  // Render All Questions Vertically (List View)
  function renderAllQuestions() {
    if (!allQuestionsContainer) return;
    allQuestionsContainer.innerHTML = '';
    const letters = ['A', 'B', 'C', 'D'];

    questions.forEach((q, qIdx) => {
      const qBlock = document.createElement('div');
      qBlock.className = 'card';
      qBlock.style.marginBottom = '20px';
      qBlock.style.background = '#ffffff';
      qBlock.style.border = '1px solid var(--border-color)';
      qBlock.style.borderRadius = 'var(--radius-md)';
      qBlock.style.padding = '18px';
      qBlock.style.boxShadow = '0 2px 8px rgba(0,0,0,0.03)';

      let optionsHtml = '';
      q.options.forEach((optText, optIdx) => {
        optionsHtml += `
          <div class="option-card" data-qidx="${qIdx}" data-optidx="${optIdx}" id="opt-${qIdx}-${optIdx}">
            <div class="option-letter">${letters[optIdx]}</div>
            <span>${escapeHtml(optText)}</span>
          </div>
        `;
      });

      qBlock.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
          <span style="font-weight: 800; font-size: 13px; color: var(--color-primary); background: var(--color-accent-light); padding: 4px 10px; border-radius: var(--radius-full);">
            Question ${qIdx + 1} of ${questions.length}
          </span>
          <span id="answered-badge-${qIdx}" style="font-size: 12px; font-weight: 700; color: #94a3b8;">
            Unanswered
          </span>
        </div>
        <h3 class="question-text" style="font-size: 16px; font-weight: 700; color: var(--bg-dark-blue); margin-bottom: 16px; line-height: 1.4;">
          ${escapeHtml(q.question)}
        </h3>
        <div class="options-grid">
          ${optionsHtml}
        </div>
      `;

      allQuestionsContainer.appendChild(qBlock);
    });

    // Handle clicks on option cards
    allQuestionsContainer.querySelectorAll('.option-card').forEach(card => {
      card.addEventListener('click', () => {
        const qIdx = parseInt(card.getAttribute('data-qidx'), 10);
        const optIdx = parseInt(card.getAttribute('data-optidx'), 10);

        // Deselect sibling options for this question
        const grid = card.closest('.options-grid');
        grid.querySelectorAll('.option-card').forEach(c => c.classList.remove('selected'));

        // Mark clicked option as selected
        card.classList.add('selected');

        // Store selected answer
        userAnswers[qIdx] = {
          question_id: questions[qIdx].id,
          selected_option: optIdx
        };

        // Update badge
        const badge = document.getElementById(`answered-badge-${qIdx}`);
        if (badge) {
          badge.innerText = '✓ Answered';
          badge.style.color = 'var(--color-success)';
        }

        updateProgressUI();
      });
    });

    updateProgressUI();
  }

  function updateProgressUI() {
    const totalCount = questions.length;
    let answeredCount = 0;
    userAnswers.forEach(ans => {
      if (ans && ans.selected_option !== undefined && ans.selected_option !== -1) {
        answeredCount++;
      }
    });

    const percent = totalCount > 0 ? (answeredCount / totalCount) * 100 : 0;
    if (quizProgressFill) quizProgressFill.style.width = `${percent}%`;
    if (questionProgressText) questionProgressText.innerText = `${answeredCount} of ${totalCount} Answered`;

    if (btnSubmitQuiz) {
      if (answeredCount === totalCount) {
        btnSubmitQuiz.innerText = `Submit Team Quiz (All ${totalCount} Answered) 🏁`;
        btnSubmitQuiz.style.background = 'var(--color-success)';
      } else {
        btnSubmitQuiz.innerText = `Submit Team Quiz (${answeredCount} of ${totalCount} Answered) 🏁`;
        btnSubmitQuiz.style.background = '';
      }
    }
  }

  // Handle Submit Quiz button click
  window.submitQuizClick = function() {
    finishAndSubmitQuiz();
  };
  if (btnSubmitQuiz) {
    btnSubmitQuiz.addEventListener('click', window.submitQuizClick);
  }

  // 4. Finish & Submit Quiz
  function finishAndSubmitQuiz() {
    if (questionTimerInterval) clearInterval(questionTimerInterval);
    totalQuizTime = ((Date.now() - quizStartTime) / 1000).toFixed(1);

    // Ensure all questions have an entry in payload
    const finalAnswers = questions.map((q, idx) => {
      if (userAnswers[idx] && userAnswers[idx].selected_option !== undefined) {
        return userAnswers[idx];
      }
      return { question_id: q.id, selected_option: -1 };
    });

    fetch(`${API_BASE}/api/submit-quiz`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        visitor_id: currentVisitor.id,
        team_id: currentVisitor.team_id || undefined,
        answers: finalAnswers,
        time_taken_seconds: parseFloat(totalQuizTime)
      })
    })
    .then(res => res.json())
    .then(data => {
      if (data.status === 'pending_others') {
        showWaitingOthersScreen(data);
      } else if (data.status === 'completed' || data.status === 'success') {
        if (data.result) showResultsScreen(data.result);
      } else {
        alert(data.message || 'Error submitting quiz.');
      }
    })
    .catch(err => {
      console.error('Quiz submit error:', err);
      alert('Network error submitting quiz.');
    });
  }

  function showWaitingOthersScreen(data) {
    stepRegister.style.display = 'none';
    stepPending.style.display = 'none';
    if (stepVerifiedWaiting) stepVerifiedWaiting.style.display = 'none';
    stepQuiz.style.display = 'none';
    if (stepResults) stepResults.style.display = 'none';
    if (stepWaitingOthers) stepWaitingOthers.style.display = 'block';

    if (waitingSubmittedCount) {
      waitingSubmittedCount.innerText = `${data.submitted_count || 1} / ${data.total_players || 5} Players Submitted`;
    }
  }

  function getOrdinalRank(n) {
    const num = parseInt(n, 10);
    if (num === 1) return '1ST';
    if (num === 2) return '2ND';
    if (num === 3) return '3RD';
    if (num === 4) return '4TH';
    if (num === 5) return '5TH';
    return `#${num}`;
  }

  // 5. Show Results Screen (Revealed once ALL 5 players submit)
  function showResultsScreen(result) {
    stepRegister.style.display = 'none';
    stepPending.style.display = 'none';
    if (stepVerifiedWaiting) stepVerifiedWaiting.style.display = 'none';
    stepQuiz.style.display = 'none';
    if (stepWaitingOthers) stepWaitingOthers.style.display = 'none';
    if (stepResults) stepResults.style.display = 'block';

    const teamName = result.team_name || '5-Player Team Round';
    const rankNum = parseInt(result.rank_in_team || 1, 10);
    const isWinner = result.is_winner || (rankNum === 1);
    
    const resultTeamNameElem = document.getElementById('result-team-name');
    if (resultTeamNameElem) resultTeamNameElem.innerText = `${teamName} (5-Player Match)`;
    
    if (resultScore) resultScore.innerText = `${result.score} / ${result.total_questions}`;
    if (resultTime) resultTime.innerText = `${result.time_taken_seconds}s`;
    if (resultRank) resultRank.innerText = `#${rankNum} of ${result.total_team_players || 5}`;

    const winnerBanner = document.getElementById('winner-celebration-banner');
    const winnerTitle = document.getElementById('winner-banner-title');
    const winnerSub = document.getElementById('winner-banner-subtitle');

    const runnerupBanner = document.getElementById('runnerup-banner');
    const runnerupTitle = document.getElementById('runnerup-banner-title');
    const runnerupSub = document.getElementById('runnerup-banner-subtitle');

    if (isWinner) {
      if (winnerBanner) {
        winnerBanner.style.display = 'block';
        if (winnerTitle) winnerTitle.innerText = '🏆 🥇 YOU ARE THE #1 WINNER OF THIS ROUND!';
        if (winnerSub) winnerSub.innerText = `Highest Score (${result.score}/${result.total_questions}) & Fastest Speed (${result.time_taken_seconds}s) among all 5 players!`;
      }
      if (runnerupBanner) runnerupBanner.style.display = 'none';
    } else {
      if (winnerBanner) winnerBanner.style.display = 'none';
      if (runnerupBanner) {
        runnerupBanner.style.display = 'block';
        if (runnerupTitle) runnerupTitle.innerText = `👏 ${getOrdinalRank(rankNum)} PLACE IN THIS ROUND!`;
        if (runnerupSub) {
          runnerupSub.innerText = `🥇 Round Winner: ${escapeHtml(result.winner_name || 'Team Leader')} (${result.winner_score}/${result.total_questions} Pts in ${result.winner_time}s)`;
        }
      }
    }

    const playersDisp = document.getElementById('result-players-display');
    if (playersDisp) {
      playersDisp.innerHTML = `Participant: <strong>${escapeHtml(result.visitor_name || (currentVisitor ? currentVisitor.name : 'Visitor'))}</strong> | Round Winner: <strong>${escapeHtml(result.winner_name || 'Leader')}</strong>`;
    }

    // Confetti FX for Winner!
    if (isWinner && typeof confetti === 'function') {
      confetti({
        particleCount: 150,
        spread: 90,
        origin: { y: 0.5 }
      });
      setTimeout(() => {
        confetti({
          particleCount: 100,
          angle: 60,
          spread: 60,
          origin: { x: 0 }
        });
        confetti({
          particleCount: 100,
          angle: 120,
          spread: 60,
          origin: { x: 1 }
        });
      }, 350);
    }
  }

  // Map Modal Expand Handler
  const btnOpenMapModal = document.getElementById('btn-open-map-modal');
  const btnCloseMapModal = document.getElementById('btn-close-map-modal');
  const modalMap = document.getElementById('modal-map');

  window.openMapModalClick = function() {
    if (modalMap) modalMap.classList.add('active');
  };
  window.closeMapModalClick = function() {
    if (modalMap) modalMap.classList.remove('active');
  };

  if (btnOpenMapModal) btnOpenMapModal.addEventListener('click', window.openMapModalClick);
  if (btnCloseMapModal) btnCloseMapModal.addEventListener('click', window.closeMapModalClick);

  // Visitor Ready Button Handler
  function visitorReadyClick() {
    visitorIsReady = true;
    if (btnVisitorReady) btnVisitorReady.style.display = 'none';
    if (visitorReadyConfirmedBadge) visitorReadyConfirmedBadge.style.display = 'inline-flex';
    if (visitorReadyPrompt) {
      visitorReadyPrompt.innerHTML = 'You are ready! Standing by for host to launch the quiz round...';
    }
    showPlayerAlertToast('✅ You are marked Ready! Quiz will start as soon as stall staff launches it.', '#ecfdf5', '#10b981', '#065f46');
    
    // Notify server via socket if connected
    if (socket && currentVisitor) {
      socket.emit('visitor_ready', { visitor_id: currentVisitor.id });
    }

    // Refresh slots visualizer if displayed
    if (lastGroupData) {
      updateVisitorGroupUI(lastGroupData);
    }
  }
  window.visitorReadyClick = visitorReadyClick;

  // Pre-Quiz Ready Confirmation Handler
  function handleQuizUnlocked(team) {
    pendingQuizTeam = team;
    if (visitorIsReady) {
      startQuizFlow(team);
    } else {
      if (modalQuizReady) {
        if (modalReadyTeamName && team) {
          modalReadyTeamName.innerText = team.team_name || 'Team Match';
        }
        modalQuizReady.classList.add('active');
      } else {
        startQuizFlow(team);
      }
    }
  }

  function confirmReadyAndStartQuiz() {
    if (modalQuizReady) {
      modalQuizReady.classList.remove('active');
    }
    visitorIsReady = true;
    startQuizFlow(pendingQuizTeam);
  }
  window.confirmReadyAndStartQuiz = confirmReadyAndStartQuiz;

  if (btnVisitorReady) btnVisitorReady.addEventListener('click', visitorReadyClick);
  if (btnModalStartQuiz) btnModalStartQuiz.addEventListener('click', confirmReadyAndStartQuiz);
});
