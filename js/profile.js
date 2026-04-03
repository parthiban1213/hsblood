// ════════════════════════════════════════════════════════════════
// HSBlood — js/profile.js
// ════════════════════════════════════════════════════════════════

// ── Mobile OTP update state ───────────────────────────────────
let profileMobileOtpTimer = null, profileMobileOtpCountdown = 0;

async function loadProfile() {
  clearProfileMessages();
  const btn = document.getElementById('profile-save-btn');
  if (btn) { btn.disabled = false; btn.textContent = '💾 Save Changes'; }
  if (currentUser) renderProfile(currentUser);
  try {
    const res = await apiFetch('/auth/profile');
    if (res.success) {
      currentUser = { ...currentUser, ...res.user };
      localStorage.setItem('bl_user', JSON.stringify(currentUser));
      renderProfile(currentUser);
    }
  } catch(e) { /* use cached */ }
}

function renderProfile(user) {
  const initials = ((user.firstName || user.username || '')[0] || '?').toUpperCase();
  const avatarEl = document.getElementById('profile-avatar-lg');
  if (avatarEl) avatarEl.textContent = initials;

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

  const donorBadge = document.getElementById('profile-donor-badge');
  if (donorBadge) {
    donorBadge.style.display = user.donorId ? '' : 'none';
    if (user.donorId) donorBadge.innerHTML = `<span style="background:var(--red-light);border:1px solid rgba(200,16,46,0.2);color:var(--red);padding:4px 12px;border-radius:20px;font-size:0.75rem;font-family:var(--font-ui);font-weight:600">🩸 Registered Donor</span>`;
  }

  // Show delete zone only for HS Employees, never for admins
  const deleteZone = document.getElementById('profile-delete-zone');
  if (deleteZone) deleteZone.style.display = user.role === 'admin' ? 'none' : '';

  _setVal('profile-firstName', user.firstName || '');
  _setVal('profile-lastName',  user.lastName  || '');
  _setVal('profile-username',  user.username  || '');
  _setVal('profile-email',     user.email     || '');
  _setVal('profile-bloodtype', user.bloodType || '');
  _setVal('profile-mobile',    user.mobile    || '');
  _setVal('profile-available', user.isAvailable !== undefined ? String(user.isAvailable) : 'true');
  _setVal('profile-address',   user.address   || '');
  _setVal('profile-lastDonation', user.lastDonationDate ? user.lastDonationDate.split('T')[0] : '');

  // Compute and display eligibility info
  const eligEl = document.getElementById('profile-eligibility-info');
  if (eligEl) {
    const lastDon = user.lastDonationDate ? new Date(user.lastDonationDate) : null;
    if (lastDon && !isNaN(lastDon.getTime())) {
      const nextElig = new Date(lastDon.getTime() + 90 * 86400000);
      const daysLeft = Math.ceil((nextElig.getTime() - Date.now()) / 86400000);
      const isElig   = daysLeft <= 0;
      eligEl.innerHTML = `
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:12px">
          <div style="flex:1;min-width:180px;background:${isElig ? '#F0FDF4' : '#FEF3C7'};border:1.5px solid ${isElig ? '#BBF7D0' : '#FCD34D'};border-radius:10px;padding:12px 14px">
            <div style="font-size:0.7rem;font-weight:700;color:${isElig ? '#15803D' : '#92400E'};text-transform:uppercase;letter-spacing:0.06em;font-family:var(--font-ui);margin-bottom:4px">📅 Next Eligible Date</div>
            <div style="font-size:0.95rem;font-weight:700;color:var(--text);font-family:var(--font-ui)">${nextElig.toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}</div>
          </div>
          <div style="flex:1;min-width:180px;background:${isElig ? '#F0FDF4' : '#FEF3C7'};border:1.5px solid ${isElig ? '#BBF7D0' : '#FCD34D'};border-radius:10px;padding:12px 14px">
            <div style="font-size:0.7rem;font-weight:700;color:${isElig ? '#15803D' : '#92400E'};text-transform:uppercase;letter-spacing:0.06em;font-family:var(--font-ui);margin-bottom:4px">⏳ Days Until Next Donation</div>
            <div style="font-size:0.95rem;font-weight:700;color:var(--text);font-family:var(--font-ui)">${isElig ? '✅ Eligible Now' : daysLeft + ' day' + (daysLeft !== 1 ? 's' : '') + ' remaining'}</div>
          </div>
        </div>`;
      eligEl.style.display = '';
    } else {
      eligEl.style.display = 'none';
    }
  }

  // Close mobile OTP panel if open
  closeMobileUpdatePanel();
}

function _setVal(id, val) { const el = document.getElementById(id); if (el) el.value = val; }

// ── Save profile (everything except mobile) ───────────────────
async function saveProfile() {
  clearProfileMessages();
  const btn = document.getElementById('profile-save-btn');
  btn.disabled = true; btn.textContent = 'Saving…';

  const firstName    = document.getElementById('profile-firstName')?.value.trim();
  const lastName     = document.getElementById('profile-lastName')?.value.trim();
  const username     = document.getElementById('profile-username')?.value.trim();
  const email        = document.getElementById('profile-email')?.value.trim();
  const bloodType    = document.getElementById('profile-bloodtype')?.value;
  const isAvailable  = document.getElementById('profile-available')?.value === 'true';
  const address      = document.getElementById('profile-address')?.value.trim();
  const lastDonation = document.getElementById('profile-lastDonation')?.value;

  if (!username || username.length < 3) {
    showProfileError('Username must be at least 3 characters.');
    btn.disabled = false; btn.textContent = '💾 Save Changes'; return;
  }

  try {
    const res = await apiFetch('/auth/profile', {
      method: 'PUT',
      body: JSON.stringify({ firstName, lastName, username, email, bloodType,
        isAvailable, address,
        lastDonationDate: lastDonation || null })
    });
    if (res.success) {
      currentUser = { ...currentUser, ...res.user };
      localStorage.setItem('bl_user', JSON.stringify(currentUser));
      applyRoleUI();
      renderProfile(currentUser);
      showProfileSuccess(res.message || 'Profile updated successfully!');
      showToast('Profile updated!');
    } else { showProfileError(res.error || 'Update failed.'); }
  } catch(err) { showProfileError('Request failed. Please check your connection.'); }
  finally { btn.disabled = false; btn.textContent = '💾 Save Changes'; }
}

// ── Mobile update with OTP ────────────────────────────────────
function openMobileUpdatePanel() {
  const panel = document.getElementById('profile-mobile-otp-panel');
  if (panel) panel.style.display = '';
  const newInput = document.getElementById('profile-mobile-new');
  if (newInput) { newInput.value = ''; newInput.focus(); }
  _setProfileMobileOtpError('');
  const otpRow  = document.getElementById('profile-mobile-otp-row');
  const verBtn  = document.getElementById('profile-mobile-verify-btn');
  if (otpRow) otpRow.style.display = 'none';
  if (verBtn) verBtn.style.display = 'none';
  const otpInput = document.getElementById('profile-mobile-otp');
  if (otpInput) otpInput.value = '';
  clearProfileMobileTimer();
}

function closeMobileUpdatePanel() {
  const panel = document.getElementById('profile-mobile-otp-panel');
  if (panel) panel.style.display = 'none';
  clearProfileMobileTimer();
}

async function sendMobileUpdateOTP() {
  const newMobile = (document.getElementById('profile-mobile-new')?.value || '').trim();
  const btn = document.getElementById('profile-mobile-send-otp-btn');
  _setProfileMobileOtpError('');

  if (!/^[6-9]\d{9}$/.test(newMobile)) {
    _setProfileMobileOtpError('Please enter a valid 10-digit mobile number.'); return;
  }
  // Check it's not the same as current
  if (currentUser?.mobile === newMobile) {
    _setProfileMobileOtpError('This is already your current mobile number.'); return;
  }

  btn.disabled = true; btn.textContent = 'Sending…';
  try {
    const res  = await fetch(API + '/auth/otp/send', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ mobile: newMobile })
    });
    const data = await res.json();
    if (data.success) {
      if (data.isExistingUser) {
        _setProfileMobileOtpError('This mobile number is already registered to another account.');
        btn.disabled = false; btn.textContent = '📲 Send OTP'; return;
      }
      // Show OTP input + verify button
      const otpRow = document.getElementById('profile-mobile-otp-row');
      const verBtn = document.getElementById('profile-mobile-verify-btn');
      const otpInput = document.getElementById('profile-mobile-otp');
      if (otpRow) otpRow.style.display = '';
      if (verBtn) verBtn.style.display = '';
      if (otpInput) { otpInput.value = ''; otpInput.focus(); }
      _startProfileMobileTimer();
      showToast('OTP sent to +91 ' + newMobile, 'success');
    } else { _setProfileMobileOtpError(data.error || 'Failed to send OTP.'); btn.disabled = false; btn.textContent = '📲 Send OTP'; }
  } catch(e) { _setProfileMobileOtpError('Cannot connect to server.'); btn.disabled = false; btn.textContent = '📲 Send OTP'; }
}

async function verifyMobileUpdateOTP() {
  const newMobile = (document.getElementById('profile-mobile-new')?.value || '').trim();
  const otp       = (document.getElementById('profile-mobile-otp')?.value  || '').trim();
  const verBtn    = document.getElementById('profile-mobile-verify-btn');
  _setProfileMobileOtpError('');

  if (!/^\d{6}$/.test(otp)) { _setProfileMobileOtpError('Please enter the 6-digit OTP.'); return; }

  verBtn.disabled = true; verBtn.textContent = 'Verifying…';
  try {
    const res  = await fetch(API + '/auth/mobile/update', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + authToken },
      body: JSON.stringify({ newMobile, otp })
    });
    const data = await res.json();
    if (data.success) {
      clearProfileMobileTimer();
      currentUser = { ...currentUser, mobile: newMobile };
      localStorage.setItem('bl_user', JSON.stringify(currentUser));
      renderProfile(currentUser);
      showProfileSuccess('Mobile number updated successfully!');
      showToast('Mobile number updated! 📱', 'success');
    } else { _setProfileMobileOtpError(data.error || 'Verification failed.'); verBtn.disabled = false; verBtn.textContent = '✅ Verify & Update'; }
  } catch(e) { _setProfileMobileOtpError('Cannot connect to server.'); verBtn.disabled = false; verBtn.textContent = '✅ Verify & Update'; }
}

function _setProfileMobileOtpError(msg) {
  const el = document.getElementById('profile-mobile-otp-error');
  if (!el) return;
  el.textContent = msg; el.style.display = msg ? '' : 'none';
}

function _startProfileMobileTimer() {
  clearProfileMobileTimer(); profileMobileOtpCountdown = 60; _updateProfileMobileTimerUI();
  profileMobileOtpTimer = setInterval(() => {
    profileMobileOtpCountdown--; _updateProfileMobileTimerUI();
    if (profileMobileOtpCountdown <= 0) clearProfileMobileTimer();
  }, 1000);
}
function clearProfileMobileTimer() {
  if (profileMobileOtpTimer) { clearInterval(profileMobileOtpTimer); profileMobileOtpTimer = null; }
  profileMobileOtpCountdown = 0; _updateProfileMobileTimerUI();
}
function _updateProfileMobileTimerUI() {
  const el  = document.getElementById('profile-mobile-otp-timer');
  const btn = document.getElementById('profile-mobile-send-otp-btn');
  if (!el) return;
  if (profileMobileOtpCountdown > 0) {
    el.style.display = ''; el.textContent = `Resend in ${profileMobileOtpCountdown}s`;
    if (btn) btn.disabled = true;
  } else {
    el.style.display = 'none';
    if (btn) { btn.disabled = false; btn.textContent = '📲 Send OTP'; }
  }
}

// ── Helpers ───────────────────────────────────────────────────
function showProfileError(msg) {
  const el = document.getElementById('profile-error'); if (!el) return;
  el.textContent = '⚠️ ' + msg; el.style.display = 'block';
  document.getElementById('profile-success').style.display = 'none';
}
function showProfileSuccess(msg) {
  const el = document.getElementById('profile-success'); if (!el) return;
  el.textContent = '✅ ' + msg; el.style.display = 'block';
  document.getElementById('profile-error').style.display = 'none';
}
function clearProfileMessages() {
  const err = document.getElementById('profile-error'); if (err) err.style.display = 'none';
  const suc = document.getElementById('profile-success'); if (suc) suc.style.display = 'none';
}

// ── Delete own account ────────────────────────────────────────
function confirmDeleteAccount() {
  showDeleteConfirm(
    'Delete My Account',
    'Are you sure? This will permanently delete your account AND remove you from the donor list. This cannot be undone.',
    async () => {
      try {
        const res  = await apiFetch('/auth/account', { method: 'DELETE' });
        if (res.success) {
          showToast('Your account has been deleted.', 'success');
          // Small delay so toast is visible, then log out
          setTimeout(() => doLogout(), 1200);
        } else {
          showToast(res.error || 'Failed to delete account. Please try again.', 'error');
        }
      } catch(e) {
        showToast('Request failed. Please check your connection.', 'error');
      }
    }
  );
}

// ── Availability popup (shown every login for HS employees) ──
async function setAvailability(isAvailable) {
  closeModal('availability-modal');
  try {
    const res = await apiFetch('/auth/availability', {
      method: 'POST',
      body: JSON.stringify({ isAvailable })
    });
    if (res.success) {
      currentUser = { ...currentUser, isAvailable };
      localStorage.setItem('bl_user', JSON.stringify(currentUser));
      showToast(isAvailable ? '✅ Marked as available to donate!' : '❌ Marked as unavailable.', 'success');
    } else {
      showToast(res.error || 'Could not update availability.', 'error');
    }
  } catch(e) {
    showToast('Could not update availability. Please update it from your profile.', 'error');
  }
}
