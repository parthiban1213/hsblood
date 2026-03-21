// ════════════════════════════════════════════════════════════════
// HSBlood — js/profile.js
// User profile view and update (username, email, blood type)
// ════════════════════════════════════════════════════════════════

// ── Load and render profile ───────────────────────────────────
async function loadProfile() {
  clearProfileMessages();
  const btn = document.getElementById('profile-save-btn');
  if (btn) { btn.disabled = false; btn.textContent = '💾 Save Changes'; }

  // Populate from currentUser (fast, no API call needed on first load)
  if (currentUser) renderProfile(currentUser);

  // Then fetch fresh data from server
  try {
    const res = await apiFetch('/auth/profile');
    if (res.success) {
      renderProfile(res.user);
      // Keep currentUser in sync
      currentUser = { ...currentUser, ...res.user };
      localStorage.setItem('bl_user', JSON.stringify(currentUser));
    }
  } catch(e) { /* use cached data */ }
}

function renderProfile(user) {
  // Avatar
  const initials = ((user.username || '')[0] || '?').toUpperCase();
  const avatarEl = document.getElementById('profile-avatar-lg');
  if (avatarEl) avatarEl.textContent = initials;

  // Header
  const nameEl = document.getElementById('profile-display-name');
  if (nameEl) nameEl.textContent = user.username || '—';

  const roleEl = document.getElementById('profile-display-role');
  if (roleEl) roleEl.textContent = user.role === 'admin' ? '🛡️ Administrator' : '👤 HS Employee';

  const btEl = document.getElementById('profile-display-bloodtype');
  if (btEl) {
    btEl.innerHTML = user.bloodType
      ? `<span class="blood-badge">${user.bloodType}</span>`
      : '<span style="font-size:0.75rem;color:var(--text3);font-family:var(--font-ui)">No blood type set</span>';
  }

  // Form fields
  const usernameEl = document.getElementById('profile-username');
  if (usernameEl) usernameEl.value = user.username || '';

  const emailEl = document.getElementById('profile-email');
  if (emailEl) emailEl.value = user.email || '';

  const btSelectEl = document.getElementById('profile-bloodtype');
  if (btSelectEl) btSelectEl.value = user.bloodType || '';
}

// ── Save profile ──────────────────────────────────────────────
async function saveProfile() {
  clearProfileMessages();
  const btn = document.getElementById('profile-save-btn');
  btn.disabled = true; btn.textContent = 'Saving…';

  const username  = document.getElementById('profile-username').value.trim();
  const email     = document.getElementById('profile-email').value.trim();
  const bloodType = document.getElementById('profile-bloodtype').value;

  // Client-side validation
  if (!username || username.length < 3) {
    showProfileError('Username must be at least 3 characters.');
    btn.disabled = false; btn.textContent = '💾 Save Changes';
    return;
  }

  try {
    const res = await apiFetch('/auth/profile', {
      method: 'PUT',
      body: JSON.stringify({ username, email, bloodType })
    });

    if (res.success) {
      // Update currentUser and localStorage with new values
      currentUser = { ...currentUser, ...res.user };
      localStorage.setItem('bl_user', JSON.stringify(currentUser));

      // Refresh sidebar display
      applyRoleUI();

      // Re-render profile header
      renderProfile(currentUser);

      showProfileSuccess(res.message || 'Profile updated successfully!');
      showToast('Profile updated!');
    } else {
      showProfileError(res.error || 'Update failed.');
    }
  } catch(err) {
    showProfileError('Request failed. Please check your connection.');
  } finally {
    btn.disabled = false; btn.textContent = '💾 Save Changes';
  }
}

// ── Helpers ───────────────────────────────────────────────────
function showProfileError(msg) {
  const el = document.getElementById('profile-error');
  if (!el) return;
  el.textContent = '⚠️ ' + msg;
  el.style.display = 'block';
  document.getElementById('profile-success').style.display = 'none';
}

function showProfileSuccess(msg) {
  const el = document.getElementById('profile-success');
  if (!el) return;
  el.textContent = '✅ ' + msg;
  el.style.display = 'block';
  document.getElementById('profile-error').style.display = 'none';
}

function clearProfileMessages() {
  const err = document.getElementById('profile-error');
  const suc = document.getElementById('profile-success');
  if (err) err.style.display = 'none';
  if (suc) suc.style.display = 'none';
}
