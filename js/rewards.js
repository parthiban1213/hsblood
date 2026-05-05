// ══════════════════════════════════════════════════════════════
// HSBlood — js/rewards.js
// Gamification: Leaderboard · Challenges · Badges
// ══════════════════════════════════════════════════════════════

// ── State ──────────────────────────────────────────────────────
let _gamData       = null;          // from GET /api/gamification/me
let _leaderboard   = [];            // from GET /api/gamification/leaderboard
let _lbScope       = 'city';        // 'city' | 'all'
let _activeTab     = 'leaderboard'; // 'leaderboard' | 'challenges' | 'badges'
let _challengeFilter = 'All';       // 'All' | 'Active' | 'Completed'

// ── Entry point ────────────────────────────────────────────────
async function loadRewards() {
  renderRewardsShell();
  await Promise.all([fetchGamificationMe(), fetchLeaderboard(_lbScope)]);
  renderActiveTab();
}

// ── API calls ──────────────────────────────────────────────────
async function fetchGamificationMe() {
  try {
    const res = await apiFetch('/gamification/me');
    if (res && res.success) _gamData = res.data;
  } catch (e) { /* handled below */ }
}

async function fetchLeaderboard(scope) {
  try {
    const res = await apiFetch(`/gamification/leaderboard?scope=${scope}&limit=25`);
    if (res && res.success) _leaderboard = res.data || [];
  } catch (e) { _leaderboard = []; }
}

// ── Shell (tabs header) ────────────────────────────────────────
function renderRewardsShell() {
  const root = document.getElementById('rewards-root');
  if (!root) return;

  root.innerHTML = `
    <div class="rw-tabs">
      <button class="rw-tab ${_activeTab==='leaderboard'?'active':''}" onclick="switchRewardsTab('leaderboard')">🏆 Leaderboard</button>
      <button class="rw-tab ${_activeTab==='challenges' ?'active':''}" onclick="switchRewardsTab('challenges')">⚡ Challenges</button>
      <button class="rw-tab ${_activeTab==='badges'     ?'active':''}" onclick="switchRewardsTab('badges')">🎖️ Badges</button>
    </div>
    <div id="rewards-tab-content" class="rw-content">
      <div class="spinner" style="margin:60px auto"></div>
    </div>
  `;
}

function switchRewardsTab(tab) {
  _activeTab = tab;
  // update tab buttons
  document.querySelectorAll('.rw-tab').forEach(b => b.classList.remove('active'));
  const idx = ['leaderboard','challenges','badges'].indexOf(tab);
  const tabs = document.querySelectorAll('.rw-tab');
  if (tabs[idx]) tabs[idx].classList.add('active');
  renderActiveTab();
}

function renderActiveTab() {
  if (!_gamData) { renderRewardsError(); return; }
  switch (_activeTab) {
    case 'leaderboard': renderLeaderboardTab(); break;
    case 'challenges':  renderChallengesTab();  break;
    case 'badges':      renderBadgesTab();       break;
  }
}

// ─────────────────────────────────────────────────────────────
//  LEADERBOARD TAB
// ─────────────────────────────────────────────────────────────
function renderLeaderboardTab() {
  const el = document.getElementById('rewards-tab-content');
  if (!el) return;

  // Find "me" in leaderboard
  const me = _leaderboard.find(e => e.isCurrentUser) || {
    displayName : currentUser?.username || 'You',
    bloodType   : _gamData.tier ? '' : '',
    tier        : _gamData.tier,
    donationCount: _gamData.donationCount,
    xp          : _gamData.xp,
    rank        : _gamData.cityRank,
    isCurrentUser: true,
  };
  const myRank = me.rank || _gamData.cityRank || '—';
  const initials = nameInitials(me.displayName || currentUser?.username || '?');

  const rows = _leaderboard.map((e, i) => leaderboardRowHTML(e)).join('');

  el.innerHTML = `
    <!-- Your rank hero -->
    <div class="rw-hero-card">
      <div class="rw-hero-rank">#${myRank}</div>
      <div class="rw-avatar rw-avatar-you">${initials}</div>
      <div class="rw-hero-info">
        <div class="rw-hero-name">
          ${escHtml(me.displayName || currentUser?.username || '')}
          <span class="rw-you-tag">YOU</span>
        </div>
        <div class="rw-hero-meta">${escHtml(_gamData.tier)} · ${escHtml(me.bloodType || '')}</div>
      </div>
      <div class="rw-hero-xp">${_gamData.xp} <span>XP</span></div>
    </div>

    <!-- Scope pills -->
    <div class="rw-pills" style="margin-bottom:14px">
      <button class="rw-pill ${_lbScope==='city'?'active':''}" onclick="switchLbScope('city')">📍 My City</button>
      <button class="rw-pill ${_lbScope==='all' ?'active':''}" onclick="switchLbScope('all')">🌐 All</button>
    </div>

    <!-- Column header -->
    <div class="rw-lb-header">
      <span class="rw-lb-rank-col">#</span>
      <span style="flex:1;margin-left:50px">Donor</span>
      <span class="rw-lb-num-col">Donations</span>
      <span class="rw-lb-num-col">XP</span>
    </div>

    <!-- Rows -->
    <div class="rw-card rw-lb-list">
      ${rows.length ? rows : '<p class="rw-empty">No donors found in this scope.</p>'}
    </div>
  `;
}

function leaderboardRowHTML(e) {
  const initials  = nameInitials(e.displayName || e.username || '?');
  const rankColor = e.rank === 1 ? '#F59E0B' : e.rank === 2 ? '#94A3B8' : e.rank === 3 ? '#CD7F3A' : 'var(--text3)';
  const isMe      = e.isCurrentUser;
  return `
    <div class="rw-lb-row ${isMe ? 'rw-lb-row-me' : ''}">
      <span class="rw-lb-rank" style="color:${rankColor}">${e.rank}</span>
      <span class="rw-avatar ${isMe?'rw-avatar-you':'rw-avatar-other'}">${initials}</span>
      <span class="rw-lb-name-col">
        <span class="rw-lb-name ${isMe?'rw-name-me':''}">${escHtml(e.displayName || e.username)}${isMe?' <span class="rw-you-tag">YOU</span>':''}</span>
        <span class="rw-lb-sub">${escHtml(e.bloodType||'')} · ${escHtml(e.tier||'')}</span>
      </span>
      <span class="rw-lb-num-col rw-lb-donations">${e.donationCount}</span>
      <span class="rw-lb-num-col rw-lb-xp">${e.xp}</span>
    </div>
    <div class="rw-divider"></div>
  `;
}

async function switchLbScope(scope) {
  _lbScope = scope;
  // update pills immediately
  document.querySelectorAll('.rw-pill').forEach(p => p.classList.remove('active'));
  const pills = document.querySelectorAll('.rw-pill');
  if (scope === 'city' && pills[0]) pills[0].classList.add('active');
  if (scope === 'all'  && pills[1]) pills[1].classList.add('active');

  const listEl = document.querySelector('.rw-lb-list');
  if (listEl) listEl.innerHTML = '<div class="spinner" style="margin:30px auto"></div>';

  await fetchLeaderboard(scope);
  const rows = _leaderboard.map(e => leaderboardRowHTML(e)).join('');
  if (listEl) listEl.innerHTML = rows.length ? rows : '<p class="rw-empty">No donors found in this scope.</p>';
}

// ─────────────────────────────────────────────────────────────
//  CHALLENGES TAB
// ─────────────────────────────────────────────────────────────
function renderChallengesTab() {
  const el = document.getElementById('rewards-tab-content');
  if (!el) return;

  const all       = _gamData.challenges || [];
  const active    = all.filter(c => !c.isCompleted);
  const completed = all.filter(c =>  c.isCompleted);

  const filtered = _challengeFilter === 'Active'    ? active
                 : _challengeFilter === 'Completed' ? completed
                 : all;

  const cards = filtered.map(c => challengeCardHTML(c)).join('');

  el.innerHTML = `
    <!-- Filter pills -->
    <div class="rw-pills" style="margin-bottom:16px">
      ${['All','Active','Completed'].map(f => `
        <button class="rw-pill ${_challengeFilter===f?'rw-pill-dark active':''}" onclick="filterChallenges('${f}')">${f}</button>
      `).join('')}
    </div>

    <!-- Cards -->
    <div class="rw-challenges-list">
      ${cards.length ? cards : '<p class="rw-empty">No challenges to show.</p>'}
    </div>
  `;
}

function filterChallenges(f) {
  _challengeFilter = f;
  renderChallengesTab();
}

function challengeCardHTML(c) {
  const done      = c.isCompleted;
  const icon      = challengeIcon(c.id || c.icon || '');
  const progress  = c.progressTotal > 0 ? Math.min(c.progressCurrent / c.progressTotal, 1) : 0;
  const pct       = Math.round(progress * 100);

  const dateStr = done && c.completedAt
    ? 'Completed · ' + fmtDate(c.completedAt)
    : c.progressCurrent + ' of ' + c.progressTotal + ' done';

  const deadlineStr = done
    ? '+' + c.xpReward + ' XP earned'
    : c.deadline
      ? 'Ends ' + fmtDate(c.deadline)
      : 'Ongoing';

  return `
    <div class="rw-challenge-card ${done?'rw-challenge-done':''}">
      <div class="rw-challenge-top">
        <div class="rw-challenge-icon ${done?'rw-icon-done':''}">${icon}</div>
        <div class="rw-challenge-title ${done?'rw-title-done':''}">${escHtml(c.title)}</div>
        <div class="rw-xp-badge ${done?'rw-xp-earned':'rw-xp-pending'}">+${c.xpReward} XP</div>
      </div>
      <p class="rw-challenge-desc">${escHtml(c.description)}</p>
      <div class="rw-progress-bar">
        <div class="rw-progress-fill ${done?'rw-fill-done':''}" style="width:${pct}%"></div>
      </div>
      <div class="rw-challenge-footer">
        <span class="${done?'rw-done-text':'rw-meta-text'}">${dateStr}</span>
        <span class="rw-deadline-text">${deadlineStr}</span>
      </div>
    </div>
  `;
}

function challengeIcon(id) {
  if (id.includes('first') || id.includes('drop'))   return '⭐';
  if (id.includes('life') || id.includes('blood'))   return '❤️';
  if (id.includes('rapid') || id.includes('bolt'))   return '⚡';
  if (id.includes('emergency') || id.includes('shield')) return '🛡️';
  return '🎯';
}

// ─────────────────────────────────────────────────────────────
//  BADGES TAB
// ─────────────────────────────────────────────────────────────

const BADGE_META = {
  first_drop:       { icon: '⭐', label: 'First Drop' },
  life_saver:       { icon: '❤️', label: 'Life Saver' },
  on_time:          { icon: '⏰', label: 'On Time' },
  rapid_responder:  { icon: '🛡️', label: 'Rapid Responder' },
  platinum:         { icon: '💎', label: 'Platinum Donor' },
  legend:           { icon: '🏆', label: 'Legend' },
};

// Badge definitions (mirrors mobile app defaults)
const BADGE_DEFAULTS = [
  { id:'first_drop',      name:'First Drop',      description:'Make your first blood donation pledge',  earnedDescription:'Complete 1 donation',  icon:'first_drop' },
  { id:'life_saver',      name:'Life Saver',       description:'Donated 3 times — real impact!',         earnedDescription:'Complete 3 donations', icon:'life_saver' },
  { id:'on_time',         name:'On Time Hero',     description:'Fulfilled a pledge within 24 hours',     earnedDescription:'Complete 2 donations', icon:'on_time' },
  { id:'rapid_responder', name:'Rapid Responder',  description:'Responded within 1 hour of posting',     earnedDescription:'Respond within 1 hour of a request', icon:'rapid_responder' },
  { id:'platinum',        name:'Platinum Donor',   description:'Reached Platinum tier — 15+ donations!', earnedDescription:'Complete 15 donations', icon:'platinum' },
  { id:'legend',          name:'Legend',           description:'The highest honour — 25+ donations!',    earnedDescription:'Complete 25 donations', icon:'legend' },
];

function renderBadgesTab() {
  const el = document.getElementById('rewards-tab-content');
  if (!el) return;

  // Merge server badges (which have earnedAt) with defaults
  const earnedMap = {};
  (_gamData.badges || []).forEach(b => { earnedMap[b.id] = b; });

  const allBadges = BADGE_DEFAULTS.map(def => ({
    ...def,
    earnedAt: earnedMap[def.id]?.earnedAt || null,
    isEarned: !!earnedMap[def.id]?.earnedAt,
  }));

  const earned = allBadges.filter(b => b.isEarned);
  const locked = allBadges.filter(b => !b.isEarned);

  el.innerHTML = `
    <p class="rw-badge-summary">${earned.length} of ${allBadges.length} badges earned</p>

    ${earned.length ? `
      <div class="rw-badge-section-header">
        <span class="rw-badge-section-label rw-section-earned">EARNED</span>
        <span class="rw-badge-count rw-count-earned">${earned.length}</span>
      </div>
      <div class="rw-card" style="margin-bottom:20px">
        ${earned.map((b,i) => badgeRowHTML(b, false, i < earned.length-1)).join('')}
      </div>
    ` : ''}

    ${locked.length ? `
      <div class="rw-badge-section-header">
        <span class="rw-badge-section-label rw-section-locked">LOCKED</span>
        <span class="rw-badge-count rw-count-locked">${locked.length}</span>
      </div>
      <div class="rw-card">
        ${locked.map((b,i) => badgeRowHTML(b, true, i < locked.length-1)).join('')}
      </div>
    ` : ''}
  `;
}

function badgeRowHTML(b, isLocked, showDivider) {
  const meta = BADGE_META[b.id] || { icon: '🎖️' };
  const earnedDateStr = b.earnedAt ? 'Earned ' + fmtDateLong(b.earnedAt) : '';

  return `
    <div class="rw-badge-row ${isLocked?'rw-badge-locked':''}">
      <div class="rw-badge-icon-wrap ${isLocked?'rw-badge-icon-locked':'rw-badge-icon-earned'}">
        <span class="rw-badge-emoji">${meta.icon}</span>
      </div>
      <div class="rw-badge-info">
        <div class="rw-badge-name">${escHtml(b.name)}</div>
        <div class="rw-badge-desc">${escHtml(isLocked ? b.earnedDescription : b.description)}</div>
        ${!isLocked && earnedDateStr ? `<div class="rw-badge-earned-date">${earnedDateStr}</div>` : ''}
      </div>
      <div class="rw-badge-status ${isLocked?'rw-status-locked':'rw-status-earned'}">
        ${isLocked ? 'Locked' : 'Earned'}
      </div>
    </div>
    ${showDivider ? '<div class="rw-divider rw-divider-indent"></div>' : ''}
  `;
}

// ─────────────────────────────────────────────────────────────
//  Error state
// ─────────────────────────────────────────────────────────────
function renderRewardsError() {
  const el = document.getElementById('rewards-tab-content');
  if (!el) return;
  el.innerHTML = `
    <div class="rw-error">
      <div class="rw-error-icon">📡</div>
      <p>Could not load rewards data.</p>
      <button class="btn btn-primary" onclick="loadRewards()">Try Again</button>
    </div>
  `;
}

// ─────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────
function nameInitials(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  if (parts.length === 1) return parts[0][0].toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function fmtDate(dateStr) {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleDateString('en-IN', { day:'numeric', month:'short' });
  } catch { return ''; }
}

function fmtDateLong(dateStr) {
  if (!dateStr) return '';
  try {
    return new Date(dateStr).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' });
  } catch { return ''; }
}

function escHtml(str) {
  if (!str) return '';
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
