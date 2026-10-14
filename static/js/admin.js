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
  let allVisitors = [];
  let allTeams = [];
  let activeGroup = null; // Currently forming group synced with backend
  let questions = [];
  let currentServerUrl = '';
  let html5QrScanner = null;

  // DOM Elements
  const adminServerUrl = document.getElementById('admin-server-url');
  const modalServerUrl = document.getElementById('modal-server-url');
  const statRegistered = document.getElementById('stat-registered');
  const statVerified = document.getElementById('stat-verified');
  const statPending = document.getElementById('stat-pending');
  const statCompleted = document.getElementById('stat-completed');
  const tabVisitorCount = document.getElementById('tab-visitor-count');

  const quickVerifyId = document.getElementById('quick-verify-id');
  const btnQuickVerify = document.getElementById('btn-quick-verify');
  const verifyAlertMsg = document.getElementById('verify-alert-msg');

  const adminTeamNameInput = document.getElementById('admin-team-name-input');
  const btnCreateGroup = document.getElementById('btn-create-group');
  const btnAutoFormTeam = document.getElementById('btn-auto-form-team');
  const btnCreateTeamSubmit = document.getElementById('btn-create-team-submit');
  const btnCancelGroup = document.getElementById('btn-cancel-group');
  const btnClearSelectedMembers = document.getElementById('btn-clear-selected-members');
  const adminGroupStatusTitle = document.getElementById('admin-group-status-title');
  const adminGroupBadge = document.getElementById('admin-group-badge');
  const selectedTeamCount = document.getElementById('selected-team-count');
  const selectedTeamMembersChips = document.getElementById('selected-team-members-chips');

  const leaderboardContainer = document.getElementById('leaderboard-container');
  const visitorsTableBody = document.getElementById('visitors-table-body');
  const visitorSearch = document.getElementById('visitor-search');
  const visitorFilterStatus = document.getElementById('visitor-filter-status');
  const btnExportExcel = document.getElementById('btn-export-excel');

  const questionsListContainer = document.getElementById('questions-list-container');
  const btnAddQuestion = document.getElementById('btn-add-question');

  const formSettings = document.getElementById('form-settings');
  const settingTitle = document.getElementById('setting-title');
  const settingStall = document.getElementById('setting-stall');
  const btnResetData = document.getElementById('btn-reset-data');

  // Modals & Triggers
  const modalEntranceQr = document.getElementById('modal-entrance-qr');
  const btnShowEntranceQr = document.getElementById('btn-show-entrance-qr');
  const btnCloseEntranceQr = document.getElementById('btn-close-entrance-qr');
  const entranceQrTarget = document.getElementById('entrance-qr-target');

  const modalScanner = document.getElementById('modal-scanner');
  const btnOpenScanner = document.getElementById('btn-open-scanner');
  const btnCloseScanner = document.getElementById('btn-close-scanner');

  // Join Admin Socket Room
  socket.emit('join_admin');

  // Load Initial Info & Data
  fetchServerInfo();
  loadVisitors();
  loadLeaderboard();
  loadQuestions();
  loadCurrentGroup();

  function fetchServerInfo() {
    fetch(`${API_BASE}/api/info`)
      .then(res => res.json())
      .then(data => {
        currentServerUrl = data.server_url;
        adminServerUrl.innerText = data.server_url;
        modalServerUrl.innerText = data.server_url;
        if (data.exhibition_title) {
          settingTitle.value = data.exhibition_title;
        }
        if (data.main_stall_name) {
          settingStall.value = data.main_stall_name;
          document.getElementById('admin-stall-title').innerText = "Main Dashboard";
        }
        updateStatsUI(data.stats);
      })
      .catch(err => console.error('Fetch server info error:', err));
  }

  // Socket.IO Real-time Events
  socket.on('stats_update', (stats) => {
    updateStatsUI(stats);
  });

  socket.on('visitor_registered', (visitor) => {
    showVerifyToast(`New Visitor Registered: ${visitor.name} (${visitor.id})`, 'info');
    loadVisitors();
  });

  socket.on('visitor_updated', (visitor) => {
    loadVisitors();
  });

  socket.on('group_created', (data) => {
    if (data) {
      activeGroup = data;
      renderGroupUI(activeGroup);
      renderVisitorsTable();
      showVerifyToast(`Group '${data.team_name}' created & live!`, 'info');
    }
  });

  socket.on('group_updated', (data) => {
    activeGroup = data;
    renderGroupUI(activeGroup);
    renderVisitorsTable();
  });

  socket.on('group_player_added', (data) => {
    if (data && data.last_added) {
      showVerifyToast(`👤 ${data.last_added.name} added to ${data.team_name} (${data.slot_number}/5)`, 'info');
    }
  });

  socket.on('group_cancelled', () => {
    activeGroup = null;
    renderGroupUI(null);
    renderVisitorsTable();
  });

  socket.on('group_started', (data) => {
    activeGroup = null;
    renderGroupUI(null);
    loadVisitors();
    loadLeaderboard();
  });

  socket.on('team_created', (team) => {
    showVerifyToast(`✅ Team '${team.team_name}' formed & Quiz unlocked!`, 'success');
    activeGroup = null;
    renderGroupUI(null);
    loadVisitors();
  });

  socket.on('leaderboard_update', (leaderboard) => {
    renderLeaderboard(leaderboard);
  });

  socket.on('data_reset', () => {
    activeGroup = null;
    renderGroupUI(null);
    loadVisitors();
    loadLeaderboard();
    fetchServerInfo();
  });

  socket.on('settings_updated', (data) => {
    if (data.exhibition_title) settingTitle.value = data.exhibition_title;
    if (data.main_stall_name) {
      settingStall.value = data.main_stall_name;
      document.getElementById('admin-stall-title').innerText = "Main Dashboard";
    }
  });

  function updateStatsUI(stats) {
    if (!stats) return;
    statRegistered.innerText = stats.total_registered || 0;
    statVerified.innerText = stats.total_verified || 0;
    statPending.innerText = stats.total_pending || 0;
    statCompleted.innerText = stats.total_completed || 0;
    tabVisitorCount.innerText = stats.total_registered || 0;
  }

  // Quick Verification / Check-in Station Action
  window.performQuickVerify = performQuickVerify;
  window.triggerVerify = function(id) {
    if (quickVerifyId) quickVerifyId.value = id;
    performQuickVerify();
  };

  if (btnQuickVerify) btnQuickVerify.addEventListener('click', performQuickVerify);
  if (quickVerifyId) {
    quickVerifyId.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') performQuickVerify();
    });
  }

  function performQuickVerify() {
    const inputId = quickVerifyId ? quickVerifyId.value.trim() : '';
    if (!inputId) {
      showVerifyToast('Please enter a Visitor ID or Phone number', 'error');
      return;
    }

    fetch(`${API_BASE}/api/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitor_id: inputId })
    })
    .then(res => res.json())
    .then(data => {
      if (data.status === 'success') {
        showVerifyToast(`✅ ${data.message}`, 'success');
        if (quickVerifyId) quickVerifyId.value = '';
        loadVisitors();
      } else {
        showVerifyToast(`❌ ${data.message}`, 'error');
      }
    })
    .catch(err => showVerifyToast('Server connection error', 'error'));
  }

  function showVerifyToast(msg, type) {
    verifyAlertMsg.innerText = msg;
    verifyAlertMsg.style.display = 'block';
    verifyAlertMsg.style.color = type === 'error' ? '#ef4444' : '#10b981';

    setTimeout(() => {
      verifyAlertMsg.style.display = 'none';
    }, 4000);
  }

  // ===================================================================
  // GROUP & TEAM FORMATION LOGIC
  // ===================================================================
  function loadCurrentGroup() {
    fetch(`${API_BASE}/api/group/current`)
      .then(res => res.json())
      .then(data => {
        if (data.status === 'success') {
          activeGroup = data.group;
          renderGroupUI(activeGroup);
          renderVisitorsTable();
        }
      })
      .catch(err => console.error('Error fetching current group:', err));
  }

  function renderGroupUI(group) {
    activeGroup = group;
    if (!adminGroupStatusTitle) return;

    if (group && group.team_name) {
      adminGroupStatusTitle.innerHTML = `⚡ Group: <strong style="color: #1e3a8a;">${escapeHtml(group.team_name)}</strong>`;
      if (adminGroupBadge) {
        adminGroupBadge.style.display = 'inline-block';
        const count = group.members ? group.members.length : 0;
        if (count >= 5) {
          adminGroupBadge.innerText = '🟢 Ready (5/5)';
          adminGroupBadge.style.background = '#dcfce7';
          adminGroupBadge.style.color = '#15803d';
        } else {
          adminGroupBadge.innerText = `🟡 Forming (${count}/5)`;
          adminGroupBadge.style.background = '#fef3c7';
          adminGroupBadge.style.color = '#b45309';
        }
      }
      if (btnCancelGroup) btnCancelGroup.style.display = 'inline-block';
      if (selectedTeamCount) selectedTeamCount.innerText = group.members ? group.members.length : 0;
      if (adminTeamNameInput && !adminTeamNameInput.value) {
        adminTeamNameInput.value = group.team_name;
      }

      if (selectedTeamMembersChips) {
        if (!group.members || group.members.length === 0) {
          selectedTeamMembersChips.innerHTML = `
            <span style="font-size: 12px; color: #1e3a8a; font-weight: 600;">
              ✨ Group <strong>${escapeHtml(group.team_name)}</strong> is active! Click <strong>"+ Add to Group"</strong> on checked-in visitors below, or <strong>"Auto-Form Team"</strong> to add players.
            </span>
          `;
        } else {
          selectedTeamMembersChips.innerHTML = '';
          group.members.forEach((m, idx) => {
            const chip = document.createElement('div');
            chip.style.cssText = 'background: #eff6ff; color: #1e3a8a; border: 1.5px solid #93c5fd; padding: 5px 12px; border-radius: var(--radius-full); font-size: 12px; font-weight: 700; display: flex; align-items: center; gap: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);';
            chip.innerHTML = `
              <span>#${idx + 1} 👤 ${escapeHtml(m.name)} <span style="font-size: 11px; opacity: 0.7;">(${escapeHtml(m.id)})</span></span>
              <button style="background: none; border: none; color: #ef4444; font-weight: 800; cursor: pointer; font-size: 14px; line-height: 1;" title="Remove player from group" onclick="removeVisitorFromGroup('${escapeHtml(m.id)}')">✕</button>
            `;
            selectedTeamMembersChips.appendChild(chip);
          });
        }
      }
    } else {
      adminGroupStatusTitle.innerText = 'Group Status: No Group Created Yet';
      if (adminGroupBadge) adminGroupBadge.style.display = 'none';
      if (btnCancelGroup) btnCancelGroup.style.display = 'none';
      if (selectedTeamCount) selectedTeamCount.innerText = '0';
      if (selectedTeamMembersChips) {
        selectedTeamMembersChips.innerHTML = `
          <span style="font-size: 12px; color: var(--text-muted);">
            Click <strong>"➕ Create Group"</strong> to start forming a new team, or click <strong>"+ Add to Group"</strong> on any checked-in visitor below.
          </span>
        `;
      }
    }
  }

  // Button 1: Create Group
  window.createGroupClick = function() {
    const customName = adminTeamNameInput ? adminTeamNameInput.value.trim() : '';
    fetch(`${API_BASE}/api/group/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ team_name: customName })
    })
    .then(res => res.json())
    .then(data => {
      if (data.status === 'success') {
        showVerifyToast(`🎉 ${data.message}`, 'success');
        renderGroupUI(data.group);
        renderVisitorsTable();
      } else {
        showVerifyToast(`⚠️ ${data.message || 'Error creating group'}`, 'error');
      }
    })
    .catch(err => showVerifyToast('Network error creating group', 'error'));
  };
  if (btnCreateGroup) btnCreateGroup.addEventListener('click', window.createGroupClick);

  // Button 2: Cancel Group
  window.cancelGroupClick = function() {
    fetch(`${API_BASE}/api/group/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    })
    .then(res => res.json())
    .then(data => {
      showVerifyToast('Group formation cancelled.', 'info');
      renderGroupUI(null);
      renderVisitorsTable();
    })
    .catch(err => showVerifyToast('Network error cancelling group', 'error'));
  };
  if (btnCancelGroup) btnCancelGroup.addEventListener('click', window.cancelGroupClick);

  // Button 3: Auto-Form Team
  window.autoFormTeamClick = function() {
    const customName = adminTeamNameInput ? adminTeamNameInput.value.trim() : '';
    fetch(`${API_BASE}/api/group/auto-form`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ team_name: customName })
    })
    .then(res => res.json())
    .then(data => {
      if (data.status === 'success') {
        showVerifyToast(`🎲 ${data.message}`, 'success');
        renderGroupUI(data.group);
        renderVisitorsTable();
      } else {
        showVerifyToast(`⚠️ ${data.message || 'Error auto-forming group'}`, 'error');
      }
    })
    .catch(err => showVerifyToast('Network error auto-forming group', 'error'));
  };
  if (btnAutoFormTeam) btnAutoFormTeam.addEventListener('click', window.autoFormTeamClick);

  // Button 4: Start Quiz & Unlock
  window.startQuizClick = function() {
    // If no members in active group, auto-form from available verified visitors
    if (!activeGroup || !activeGroup.members || activeGroup.members.length === 0) {
      const verifiedList = allVisitors.filter(v => v.status === 'verified');
      if (verifiedList.length > 0) {
        showVerifyToast('Auto-forming group and starting quiz...', 'info');
        const customName = adminTeamNameInput ? adminTeamNameInput.value.trim() : '';
        fetch(`${API_BASE}/api/group/auto-form`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ team_name: customName })
        })
        .then(res => res.json())
        .then(data => {
          if (data.status === 'success') {
            return fetch(`${API_BASE}/api/group/start-quiz`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' }
            });
          } else {
            throw new Error(data.message || 'Auto-form failed');
          }
        })
        .then(res => res.json())
        .then(startData => {
          if (startData.status === 'success') {
            showVerifyToast(`${startData.message}`, 'success');
            if (adminTeamNameInput) adminTeamNameInput.value = '';
            renderGroupUI(null);
            loadVisitors();
            loadLeaderboard();
          } else {
            showVerifyToast(`⚠️ ${startData.message || 'Error starting quiz'}`, 'error');
          }
        })
        .catch(err => showVerifyToast(err.message || 'Network error', 'error'));
        return;
      } else {
        showVerifyToast('⚠️ No checked-in visitors available! Please check in visitors first.', 'error');
        return;
      }
    }

    fetch(`${API_BASE}/api/group/start-quiz`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    })
    .then(res => res.json())
    .then(data => {
      if (data.status === 'success') {
        showVerifyToast(`${data.message}`, 'success');
        if (adminTeamNameInput) adminTeamNameInput.value = '';
        renderGroupUI(null);
        loadVisitors();
        loadLeaderboard();
      } else {
        showVerifyToast(`⚠️ ${data.message || 'Error starting quiz'}`, 'error');
      }
    })
    .catch(err => showVerifyToast('Network error starting quiz.', 'error'));
  };
  if (btnCreateTeamSubmit) btnCreateTeamSubmit.addEventListener('click', window.startQuizClick);

  // Clear Players Button
  window.clearPlayersClick = function() {
    if (activeGroup) {
      fetch(`${API_BASE}/api/group/cancel`, { method: 'POST', headers: { 'Content-Type': 'application/json' } })
        .then(() => {
          showVerifyToast('Cleared players from group.', 'info');
          renderGroupUI(null);
          renderVisitorsTable();
        });
    }
  };
  if (btnClearSelectedMembers) btnClearSelectedMembers.addEventListener('click', window.clearPlayersClick);

  // Add Member to Group Function
  function addVisitorToGroup(visitorId) {
    const teamName = adminTeamNameInput ? adminTeamNameInput.value.trim() : '';
    fetch(`${API_BASE}/api/group/add-member`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitor_id: visitorId, team_name: teamName })
    })
    .then(res => res.json())
    .then(data => {
      if (data.status === 'success') {
        showVerifyToast(`👤 ${data.message}`, 'success');
        renderGroupUI(data.group);
        renderVisitorsTable();
      } else {
        alert(data.message || 'Error adding player to group');
      }
    })
    .catch(err => alert('Network error adding player to group'));
  }
  window.addVisitorToGroup = addVisitorToGroup;

  // Remove Member from Group Function
  function removeVisitorFromGroup(visitorId) {
    fetch(`${API_BASE}/api/group/remove-member`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ visitor_id: visitorId })
    })
    .then(res => res.json())
    .then(data => {
      if (data.status === 'success') {
        showVerifyToast('Player removed from group.', 'info');
        renderGroupUI(data.group);
        renderVisitorsTable();
      } else {
        alert(data.message || 'Error removing player');
      }
    })
    .catch(err => alert('Network error removing player'));
  }
  window.removeVisitorFromGroup = removeVisitorFromGroup;

  // Load Visitors Table
  function loadVisitors() {
    fetch(`${API_BASE}/api/visitors`)
      .then(res => res.json())
      .then(data => {
        if (data.status === 'success') {
          allVisitors = data.visitors || [];
          allTeams = data.teams || [];
          renderVisitorsTable();
        }
      })
      .catch(err => console.error('Error loading visitors:', err));
  }

  function renderVisitorsTable() {
    const searchTerm = visitorSearch.value.toLowerCase().trim();
    const filterStatus = visitorFilterStatus.value;

    const filtered = allVisitors.filter(v => {
      const matchSearch = (v.name || '').toLowerCase().includes(searchTerm) ||
                          (v.phone || '').includes(searchTerm) ||
                          (v.id || '').toLowerCase().includes(searchTerm) ||
                          (v.company || '').toLowerCase().includes(searchTerm) ||
                          (v.email || '').toLowerCase().includes(searchTerm);

      const matchStatus = (filterStatus === 'all') || (v.status === filterStatus);

      return matchSearch && matchStatus;
    });

    if (filtered.length === 0) {
      visitorsTableBody.innerHTML = `
        <tr>
          <td colspan="10" style="text-align: center; padding: 30px; color: var(--text-muted);">
            No visitors found matching filter criteria.
          </td>
        </tr>
      `;
      return;
    }

    visitorsTableBody.innerHTML = '';
    filtered.forEach(v => {
      const tr = document.createElement('tr');

      let statusBadge = `<span class="badge badge-pending">PENDING VISIT</span>`;
      if (v.status === 'verified') {
        statusBadge = `<span class="badge badge-verified">CHECKED-IN</span>`;
      } else if (v.status === 'in_team') {
        statusBadge = `<span class="badge badge-completed" style="background: rgba(37, 99, 235, 0.15); color: #2563eb;">IN TEAM</span>`;
      } else if (v.status === 'completed') {
        statusBadge = `<span class="badge badge-completed">COMPLETED</span>`;
      }

      const isSolar = (v.solar_interest === 'Yes' || v.solar_interest === true);
      const solarBadge = isSolar
        ? `<span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #d97706; border: 1px solid rgba(245, 158, 11, 0.3); font-weight: 700;">☀️ YES</span>`
        : `<span style="color: var(--text-muted); font-size: 13px;">No</span>`;

      const teamNameText = v.team_id ? `<strong style="color: var(--color-primary);">${v.team_id}</strong>` : '-';

      let actionBtn = '';
      if (v.status === 'pending_visit') {
        actionBtn = `<button class="btn btn-success btn-sm btn-verify-row" onclick="window.triggerVerify('${escapeHtml(v.id)}')">Check-in</button>`;
      } else if (v.status === 'verified') {
        const isInGroup = activeGroup && activeGroup.members && activeGroup.members.some(m => m.id === v.id);
        if (isInGroup) {
          actionBtn = `<button class="btn btn-danger btn-sm btn-remove-group-row" onclick="window.removeVisitorFromGroup('${escapeHtml(v.id)}')" style="background: #ef4444; border-color: #ef4444; font-weight: 700;">✕ In Group (Remove)</button>`;
        } else {
          actionBtn = `<button class="btn btn-primary btn-sm btn-add-group-row" onclick="window.addVisitorToGroup('${escapeHtml(v.id)}')" style="font-weight: 700;">+ Add to Group</button>`;
        }
      } else {
        actionBtn = `<span style="color: var(--text-muted); font-size: 12px;">Assigned</span>`;
      }

      const companyStr = escapeHtml(v.company || '');
      const emailStr = escapeHtml(v.email || '');
      let compEmail = '-';
      if (companyStr && emailStr) {
        compEmail = `${companyStr}<br><small style="color: var(--text-muted);">${emailStr}</small>`;
      } else if (companyStr) {
        compEmail = companyStr;
      } else if (emailStr) {
        compEmail = emailStr;
      }

      tr.innerHTML = `
        <td><strong style="color: var(--color-primary);">${escapeHtml(v.id)}</strong></td>
        <td><strong>${escapeHtml(v.name)}</strong></td>
        <td>${escapeHtml(v.age) || '-'}</td>
        <td>${escapeHtml(v.phone)}</td>
        <td>${compEmail}</td>
        <td>${solarBadge}</td>
        <td>${statusBadge}</td>
        <td>${teamNameText}</td>
        <td><small style="color: var(--text-muted);">${escapeHtml(v.registered_at)}</small></td>
        <td>${actionBtn}</td>
      `;

      visitorsTableBody.appendChild(tr);
    });
  }

  if (visitorSearch) visitorSearch.addEventListener('input', renderVisitorsTable);
  if (visitorFilterStatus) visitorFilterStatus.addEventListener('change', renderVisitorsTable);

  window.exportVisitorsClick = function() {
    window.open(`${API_BASE}/api/export-visitors`, '_blank');
  };
  if (btnExportExcel) {
    btnExportExcel.addEventListener('click', window.exportVisitorsClick);
  }

  // Load Leaderboard
  function loadLeaderboard() {
    fetch(`${API_BASE}/api/leaderboard`)
      .then(res => res.json())
      .then(data => {
        if (data.status === 'success') {
          renderLeaderboard(data.leaderboard);
        }
      })
      .catch(err => console.error('Error loading leaderboard:', err));
  }

  function renderLeaderboard(leaderboardData) {
    if (!leaderboardData) return;

    const activeMatch = leaderboardData.active_match;
    const roundMatches = leaderboardData.round_matches || [];
    const topPlayers = leaderboardData.top_players || [];

    leaderboardContainer.innerHTML = '';

    // 1. Render Active Live Match Bar if playing on stage
    if (activeMatch) {
      const activeDiv = document.createElement('div');
      activeDiv.style.cssText = 'background: linear-gradient(135deg, #1e3a8a, #0f172a); color: #ffffff; padding: 18px; border-radius: var(--radius-md); margin-bottom: 20px; border: 2px solid var(--color-accent); box-shadow: var(--shadow-md);';
      activeDiv.innerHTML = `
        <div style="display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; gap: 12px;">
          <div>
            <div style="display: flex; align-items: center; gap: 8px;">
              <div class="pulse-dot"></div>
              <h3 style="font-size: 17px; font-weight: 800; color: #ffffff;">🔥 LIVE 5-PLAYER STAGE ROUND: ${escapeHtml(activeMatch.team_name || activeMatch.id)}</h3>
            </div>
            <p style="font-size: 13px; color: #94a3b8; margin-top: 4px;">
              Submissions Received: <strong style="color: #60a5fa; font-size: 15px;">${activeMatch.submitted_count} / ${activeMatch.total_players} Players</strong>
            </p>
          </div>
          <span class="badge badge-completed" style="background: rgba(59, 130, 246, 0.25); color: #60a5fa; font-size: 13px; padding: 8px 16px;">⏱️ 2-Min Round In Progress</span>
        </div>
      `;
      leaderboardContainer.appendChild(activeDiv);
    }

    if (roundMatches.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.style.cssText = 'text-align: center; padding: 40px; color: var(--text-muted);';
      emptyDiv.innerText = 'No completed 5-player quiz rounds yet. Match winners will display here!';
      leaderboardContainer.appendChild(emptyDiv);
      return;
    }

    roundMatches.forEach((m, idx) => {
      const roundNum = roundMatches.length - idx;
      const winner = m.winner_player;
      const winnerName = winner ? escapeHtml(winner.name) : 'Pending Winners';
      const winnerScore = winner ? `${winner.score} / ${winner.total_questions || 10} Pts` : '-';
      const winnerTime = winner ? `⏱️ ${winner.time_taken_seconds}s` : '-';

      const item = document.createElement('div');
      item.className = 'leaderboard-item';
      item.style.cursor = 'pointer';
      item.setAttribute('data-team-id', m.team_id);

      item.innerHTML = `
        <div class="rank-badge rank-1">🏆</div>
        <div class="leaderboard-user">
          <div>
            <div class="user-name">
              ${escapeHtml(m.team_name || m.team_id)} 
              <small style="font-weight: 700; color: var(--color-accent);">(Round Match)</small>
            </div>
            <div style="font-size: 14px; font-weight: 800; color: var(--color-primary); margin-top: 4px;">
              🥇 Round Winner: <strong>${winnerName}</strong>
            </div>
            <div class="user-meta" style="font-size: 11px; color: var(--text-muted); margin-top: 2px;">
              Completed: ${escapeHtml(m.completed_at || '-')} | ${m.all_players ? m.all_players.length : 0} Players Submitted
            </div>
          </div>
        </div>
        <div class="leaderboard-score">
          <div class="score-main" style="color: var(--color-success);">${winnerScore}</div>
          <div class="score-time">${winnerTime}</div>
          <button class="btn btn-outline btn-sm btn-open-team-details" style="margin-top: 6px; padding: 4px 10px; font-size: 11px; width: 100%; border-radius: var(--radius-sm);" data-team-id="${escapeHtml(m.team_id)}">
            🔍 View 5-Player Rankings
          </button>
        </div>
      `;
      leaderboardContainer.appendChild(item);
    });

    // Add click listener for round match breakdown modal
    leaderboardContainer.querySelectorAll('.btn-open-team-details, .leaderboard-item').forEach(elem => {
      elem.addEventListener('click', (e) => {
        e.stopPropagation();
        const tId = elem.getAttribute('data-team-id');
        const matchObj = roundMatches.find(item => item.team_id === tId);
        if (matchObj) openTeamDetailsModal(matchObj);
      });
    });
  }

  // Open Team Details Modal
  const modalTeamDetails = document.getElementById('modal-team-details');
  const btnCloseTeamDetails = document.getElementById('btn-close-team-details');
  const teamDetailsContent = document.getElementById('team-details-content');

  if (btnCloseTeamDetails && modalTeamDetails) {
    btnCloseTeamDetails.addEventListener('click', () => {
      modalTeamDetails.classList.remove('active');
    });
  }

  function openTeamDetailsModal(match) {
    if (!modalTeamDetails || !teamDetailsContent) return;

    modalTeamDetails.classList.add('active');
    const winner = match.winner_player;

    // Render individual player rank table inside the 5-player round
    let memberRowsHtml = '';
    const allPlayers = match.all_players || [];

    if (allPlayers.length > 0) {
      allPlayers.forEach((p, idx) => {
        const pRank = idx + 1;
        const rankBadge = pRank === 1 ? '🥇 Winner' : pRank === 2 ? '🥈 2nd' : pRank === 3 ? '🥉 3rd' : `#${pRank}`;
        const rowBg = pRank === 1 ? 'background: var(--color-accent-light);' : '';
        const fullV = allVisitors.find(item => item.id === p.visitor_id || item.phone === p.phone) || {};
        const isSolar = (fullV.solar_interest === 'Yes' || fullV.solar_interest === true);
        const solarBadge = isSolar
          ? `<span style="color: #d97706; font-weight: 700;">☀️ Yes</span>`
          : `<span style="color: var(--text-muted);">No</span>`;

        memberRowsHtml += `
          <tr style="border-bottom: 1px solid var(--border-color); ${rowBg}">
            <td style="padding: 10px 12px; font-weight: 800;">${rankBadge}</td>
            <td style="padding: 10px 12px;">
              <strong>${escapeHtml(p.name)}</strong><br>
              <small style="color: var(--color-primary); font-weight: 700;">ID: ${escapeHtml(p.visitor_id)}</small>
            </td>
            <td style="padding: 10px 12px; font-weight: 800; color: var(--color-primary);">${p.score} / ${p.total_questions || 10} Pts</td>
            <td style="padding: 10px 12px; font-weight: 700; color: var(--bg-dark-blue);">⏱️ ${p.time_taken_seconds}s</td>
            <td style="padding: 10px 12px;">${escapeHtml(p.company || fullV.company || '-')}<br><small style="color: var(--text-muted);">${escapeHtml(p.phone)}</small></td>
            <td style="padding: 10px 12px;">${solarBadge}</td>
          </tr>
        `;
      });
    } else {
      memberRowsHtml = `<tr><td colspan="6" style="text-align: center; padding: 20px; color: var(--text-muted);">No submissions received yet for this match.</td></tr>`;
    }

    teamDetailsContent.innerHTML = `
      <div style="background: var(--color-accent-light); border: 1.5px solid rgba(37, 99, 235, 0.3); border-radius: var(--radius-md); padding: 16px; margin-bottom: 20px; text-align: center;">
        <span style="font-size: 32px;">🏆</span>
        <h3 style="font-size: 20px; font-weight: 800; color: var(--bg-dark-blue); margin-top: 4px;">${escapeHtml(match.team_name || match.team_id)}</h3>
        <span class="badge badge-completed" style="font-size: 13px; font-weight: 800; margin-top: 6px;">5-Player Stage Match</span>
      </div>

      ${winner ? `
      <div style="background: var(--bg-primary); padding: 16px; border-radius: var(--radius-md); border: 2px solid var(--color-success); margin-bottom: 20px; text-align: center;">
        <div style="font-size: 12px; color: var(--color-success); font-weight: 800; text-transform: uppercase;">🥇 ROUND WINNING PLAYER</div>
        <div style="font-size: 22px; font-weight: 800; color: var(--bg-dark-blue); margin-top: 4px;">${escapeHtml(winner.name)}</div>
        <div style="font-size: 14px; font-weight: 700; color: var(--color-primary); margin-top: 2px;">
          Score: ${winner.score}/${winner.total_questions || 10} Pts | Time: ${winner.time_taken_seconds}s
        </div>
      </div>
      ` : ''}

      <div style="font-size: 12px; color: var(--color-accent); font-weight: 700; margin-bottom: 12px; display: flex; align-items: center; gap: 6px;">
        <span>ℹ️</span> <span>Round Winner Criterion: Highest score within the 5-player team. Fast submission time breaks ties!</span>
      </div>

      <h4 style="font-size: 15px; font-weight: 800; color: var(--bg-dark-blue); margin-bottom: 10px; display: flex; align-items: center; gap: 6px;">
        <span>👥</span> 5-Player Individual Rankings:
      </h4>

      <div class="table-responsive">
        <table class="data-table" style="width: 100%; font-size: 13px;">
          <thead>
            <tr>
              <th>Rank</th>
              <th>Player Name</th>
              <th>Score</th>
              <th>Time</th>
              <th>Company / Phone</th>
              <th>Solar Interest</th>
            </tr>
          </thead>
          <tbody>
            ${memberRowsHtml}
          </tbody>
        </table>
      </div>
    `;
  }

  // Load Questions Editor
  function loadQuestions() {
    fetch(`${API_BASE}/api/questions?admin=true`)
      .then(res => res.json())
      .then(data => {
        if (data.status === 'success') {
          questions = data.questions || [];
          renderQuestionsList();
        }
      })
      .catch(err => console.error('Error loading questions:', err));
  }

  function renderQuestionsList() {
    if (questions.length === 0) {
      questionsListContainer.innerHTML = `
        <div style="text-align: center; padding: 30px; color: var(--text-muted);">
          No questions found. Click "Add New Question" above to create one.
        </div>
      `;
      return;
    }

    questionsListContainer.innerHTML = '';
    questions.forEach((q, qIdx) => {
      const card = document.createElement('div');
      card.className = 'card question-card-item';
      card.style.marginBottom = '16px';

      let optionsHtml = '';
      q.options.forEach((opt, optIdx) => {
        const isCorrect = (q.correct === optIdx);
        optionsHtml += `
          <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
            <input type="radio" name="q_correct_${qIdx}" value="${optIdx}" ${isCorrect ? 'checked' : ''} onchange="updateQuestionCorrect(${qIdx}, ${optIdx})">
            <input type="text" class="form-control q-opt-input" value="${escapeHtml(opt)}" onchange="updateQuestionOption(${qIdx}, ${optIdx}, this.value)">
          </div>
        `;
      });

      card.innerHTML = `
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
          <h4 style="font-weight: 800; color: var(--bg-dark-blue);">Question ${qIdx + 1}</h4>
          <button class="btn btn-danger btn-sm" onclick="removeQuestion(${qIdx})">Delete</button>
        </div>
        <div class="form-group">
          <label class="form-label">Question Text</label>
          <input type="text" class="form-control q-text-input" value="${escapeHtml(q.question)}" onchange="updateQuestionText(${qIdx}, this.value)">
        </div>
        <div class="form-group">
          <label class="form-label">Options (Select radio for Correct Answer)</label>
          ${optionsHtml}
        </div>
      `;

      questionsListContainer.appendChild(card);
    });

    const saveBtn = document.createElement('button');
    saveBtn.className = 'btn btn-primary btn-lg';
    saveBtn.innerText = '💾 Save All Questions Changes';
    saveBtn.onclick = saveQuestionsToBackend;
    questionsListContainer.appendChild(saveBtn);
  }

  window.updateQuestionText = (qIdx, text) => { if (questions[qIdx]) questions[qIdx].question = text; };
  window.updateQuestionOption = (qIdx, optIdx, text) => { if (questions[qIdx] && questions[qIdx].options) questions[qIdx].options[optIdx] = text; };
  window.updateQuestionCorrect = (qIdx, optIdx) => { if (questions[qIdx]) questions[qIdx].correct = optIdx; };
  window.removeQuestion = (qIdx) => {
    questions.splice(qIdx, 1);
    renderQuestionsList();
  };

  btnAddQuestion.addEventListener('click', () => {
    questions.push({
      id: Date.now(),
      question: "New Exhibition Question",
      options: ["Option 1", "Option 2", "Option 3", "Option 4"],
      correct: 0,
      time_limit: 15
    });
    renderQuestionsList();
  });

  function saveQuestionsToBackend() {
    // Sync current DOM inputs to questions array
    const questionCards = questionsListContainer.querySelectorAll('.question-card-item');
    questionCards.forEach((card, qIdx) => {
      if (questions[qIdx]) {
        const textInput = card.querySelector('.q-text-input');
        if (textInput) questions[qIdx].question = textInput.value;
        
        const optInputs = card.querySelectorAll('.q-opt-input');
        optInputs.forEach((optInput, optIdx) => {
          if (questions[qIdx].options && questions[qIdx].options[optIdx] !== undefined) {
            questions[qIdx].options[optIdx] = optInput.value;
          }
        });
        
        const radio = card.querySelector(`input[name="q_correct_${qIdx}"]:checked`);
        if (radio) questions[qIdx].correct = parseInt(radio.value, 10);
      }
    });

    fetch(`${API_BASE}/api/questions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ questions })
    })
    .then(res => res.json())
    .then(data => {
      if (data.status === 'success') {
        alert('Questions saved successfully!');
      } else {
        alert('Failed to save questions: ' + (data.message || 'Unknown error'));
      }
    })
    .catch(err => alert('Network error while saving questions.'));
  }

  // Navigation Tabs Switcher
  document.querySelectorAll('.nav-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.tab-content').forEach(c => c.style.display = 'none');

      tab.classList.add('active');
      const target = tab.getAttribute('data-tab');
      document.getElementById(target).style.display = 'block';

      if (target === 'tab-questions') {
        loadQuestions();
      }
    });
  });

  // Entrance QR Modal
  window.showEntranceQrClick = function() {
    entranceQrTarget.innerHTML = '';
    new QRCode(entranceQrTarget, {
      text: currentServerUrl,
      width: 240,
      height: 240,
      colorDark: '#0f172a',
      colorLight: '#ffffff',
      correctLevel: QRCode.CorrectLevel.H
    });
    modalEntranceQr.classList.add('active');
  };
  if (btnShowEntranceQr) btnShowEntranceQr.addEventListener('click', window.showEntranceQrClick);

  window.closeEntranceQrClick = function() {
    modalEntranceQr.classList.remove('active');
  };
  if (btnCloseEntranceQr) btnCloseEntranceQr.addEventListener('click', window.closeEntranceQrClick);

  // Camera QR Scanner Modal
  window.openScannerClick = function() {
    modalScanner.classList.add('active');
    setTimeout(startCameraScanner, 300);
  };
  if (btnOpenScanner) btnOpenScanner.addEventListener('click', window.openScannerClick);

  window.closeScannerClick = function() {
    stopCameraScanner();
  };
  if (btnCloseScanner) btnCloseScanner.addEventListener('click', window.closeScannerClick);

  function startCameraScanner() {
    if (!html5QrScanner) {
      html5QrScanner = new Html5Qrcode("qr-reader");
    }

    html5QrScanner.start(
      { facingMode: "environment" },
      { fps: 10, qrbox: { width: 250, height: 250 } },
      (decodedText) => {
        quickVerifyId.value = decodedText;
        stopCameraScanner();
        performQuickVerify();
      },
      (errorMessage) => {
        // ignore frame scan errors
      }
    ).catch(err => {
      console.error("Camera access error:", err);
      alert("Unable to access camera for scanning. You can manually enter the ID in the verification box!");
      stopCameraScanner();
    });
  }

  function stopCameraScanner() {
    if (html5QrScanner && html5QrScanner.isScanning) {
      html5QrScanner.stop().then(() => {
        modalScanner.classList.remove('active');
      }).catch(err => {
        modalScanner.classList.remove('active');
      });
    } else {
      modalScanner.classList.remove('active');
    }
  }

  // Data Reset Action
  btnResetData.addEventListener('click', () => {
    if (confirm('Are you sure you want to clear all visitor registrations and quiz results?')) {
      fetch(`${API_BASE}/api/reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'visitors' })
      })
      .then(res => res.json())
      .then(data => {
        alert('All visitor registrations cleared!');
        loadVisitors();
        loadLeaderboard();
        fetchServerInfo();
      })
      .catch(err => alert('Network error resetting data.'));
    }
  });

  // Save Settings
  formSettings.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = settingTitle.value.trim();
    const stall = settingStall.value.trim();

    fetch(`${API_BASE}/api/settings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ exhibition_title: title, main_stall_name: stall })
    })
    .then(res => res.json())
    .then(data => {
      if (data.status === 'success') {
        alert('Settings saved successfully!');
        fetchServerInfo();
      } else {
        alert('Failed to save settings: ' + (data.message || 'Unknown error'));
      }
    })
    .catch(err => alert('Network error saving settings.'));
  });
});
