// ════════════════════════════════════════════════════════════════
// HSBlood — js/notifications.js
// In-app notification system: bell icon, panel, polling, read/clear
// ════════════════════════════════════════════════════════════════

let notifData        = [];       // cached notifications
let notifPollTimer   = null;     // setInterval handle
let notifPanelOpen   = false;

const POLL_INTERVAL  = 15000;    // poll every 15 seconds (was 30s)

// ── Init ──────────────────────────────────────────────────────
// Called from launchApp() after login
function initNotifications() {
  document.getElementById('notif-bell-wrap').style.display = '';
  fetchNotifications();
  // Start polling
  if (notifPollTimer) clearInterval(notifPollTimer);
  notifPollTimer = setInterval(fetchNotifications, POLL_INTERVAL);
}

// Called from doLogout()
function destroyNotifications() {
  if (notifPollTimer) { clearInterval(notifPollTimer); notifPollTimer = null; }
  notifData = [];
  closeNotifPanel();
  document.getElementById('notif-bell-wrap').style.display = 'none';
  document.getElementById('notif-badge').style.display = 'none';
  document.getElementById('notif-list').innerHTML = '<div class="notif-empty">No notifications yet</div>';
}

// ── Fetch from API ─────────────────────────────────────────────
async function fetchNotifications() {
  if (!authToken) return;
  try {
    const res = await apiFetch('/notifications');
    if (!res.success) return;
    notifData = res.data || [];
    renderNotifBadge(res.unreadCount || 0);
    if (notifPanelOpen) renderNotifList();
  } catch(e) { /* silent fail — polling will retry */ }
}

// ── Badge ──────────────────────────────────────────────────────
function renderNotifBadge(count) {
  const badge = document.getElementById('notif-badge');
  if (count > 0) {
    badge.textContent = count > 99 ? '99+' : count;
    badge.style.display = 'flex';
  } else {
    badge.style.display = 'none';
  }
}

// ── Panel toggle ───────────────────────────────────────────────
function toggleNotifPanel() {
  notifPanelOpen ? closeNotifPanel() : openNotifPanel();
}

function openNotifPanel() {
  notifPanelOpen = true;
  const panel = document.getElementById('notif-panel');
  panel.style.display = 'flex';
  panel.style.flexDirection = 'column';
  document.getElementById('notif-overlay').style.display = 'block';
  renderNotifList();
  fetchNotifications();
}

function closeNotifPanel() {
  notifPanelOpen = false;
  document.getElementById('notif-panel').style.display   = 'none';
  document.getElementById('notif-overlay').style.display = 'none';
}

// ── Render list ────────────────────────────────────────────────
function renderNotifList() {
  const container = document.getElementById('notif-list');

  if (!notifData.length) {
    container.innerHTML = '<div class="notif-empty">🔕 No notifications yet</div>';
    return;
  }

  container.innerHTML = notifData.map(n => {
    const timeAgo = formatNotifTime(n.createdAt);
    const isUnread = !n.isRead;
    return `
    <div class="notif-item ${isUnread ? 'unread' : 'read'}"
         data-testid="notif-item"
         data-id="${n._id}"
         onclick="handleNotifClick('${n._id}', '${n.requirementId || ''}')">
      <div class="notif-dot"></div>
      <div class="notif-item-body">
        <div class="notif-item-title">${escapeHtml(n.title)}</div>
        <div class="notif-item-msg">${escapeHtml(n.message)}</div>
        <div class="notif-item-time">${timeAgo}</div>
      </div>
      <button class="notif-item-del" title="Dismiss"
        onclick="event.stopPropagation(); deleteNotif('${n._id}')">✕</button>
    </div>`;
  }).join('');
}

// ── Interactions ───────────────────────────────────────────────
async function handleNotifClick(id, requirementId) {
  // Mark as read
  const notif = notifData.find(n => n._id === id);
  if (notif && !notif.isRead) {
    notif.isRead = true;
    renderNotifList();
    const unread = notifData.filter(n => !n.isRead).length;
    renderNotifBadge(unread);
    apiFetch(`/notifications/${id}/read`, { method: 'PUT' }).catch(() => {});
  }
  // Navigate to requirements page
  closeNotifPanel();
  const btn = document.getElementById('nav-requirements');
  if (btn) showPage('requirements', btn);
}

async function deleteNotif(id) {
  try {
    await apiFetch(`/notifications/${id}`, { method: 'DELETE' });
    notifData = notifData.filter(n => n._id !== id);
    const unread = notifData.filter(n => !n.isRead).length;
    renderNotifBadge(unread);
    renderNotifList();
  } catch(e) { showToast('Failed to dismiss notification', 'error'); }
}

async function markAllNotifRead() {
  try {
    await apiFetch('/notifications/read-all', { method: 'PUT' });
    notifData.forEach(n => n.isRead = true);
    renderNotifBadge(0);
    renderNotifList();
  } catch(e) { showToast('Failed to mark notifications read', 'error'); }
}

async function clearAllNotif() {
  try {
    await apiFetch('/notifications', { method: 'DELETE' });
    notifData = [];
    renderNotifBadge(0);
    renderNotifList();
    showToast('All notifications cleared');
  } catch(e) { showToast('Failed to clear notifications', 'error'); }
}

// ── Helpers ────────────────────────────────────────────────────
function formatNotifTime(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins  = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days  = Math.floor(diff / 86400000);
  if (mins  <  1) return 'Just now';
  if (mins  < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days  <  7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString();
}

function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
