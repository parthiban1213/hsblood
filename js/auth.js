// ══════════════════════════════════════════════════════════════
// HSBlood — js/auth.js
// ══════════════════════════════════════════════════════════════

let loginRole = 'user';
let otpMobile = '', otpTimer = null, otpCountdown = 0;
let otpIsExistingUser = false, otpIsExistingDonor = false;
// Registration OTP state
let regOtpTimer = null, regOtpCountdown = 0, regOtpVerified = false;

// ── TAB SWITCHING ────────────────────────────────────────────
function switchLoginTab(role, btn) {
  loginRole = role;
  document.querySelectorAll('.login-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('login-error').classList.remove('show');
  const desc = document.getElementById('login-role-desc');
  if (role === 'admin') {
    desc.innerHTML = `<div class="role-icon">🛡️</div><p><strong>The Gatekeeper</strong>Access granted with responsibility.</p>`;
    document.getElementById('admin-login-form').style.display = '';
    document.getElementById('user-otp-form').style.display    = 'none';
  } else {
    desc.innerHTML = `<div class="role-icon">👁️</div><p><strong>Smart Access</strong>Sign in or register as an HS Employee</p>`;
    document.getElementById('admin-login-form').style.display = 'none';
    document.getElementById('user-otp-form').style.display    = '';
    resetOTPFlow();
  }
}

// ── ADMIN LOGIN ──────────────────────────────────────────────
function fillCreds(username, password, role) {
  const tabs = document.querySelectorAll('.login-tab');
  tabs.forEach(t => t.classList.remove('active'));
  tabs[role === 'admin' ? 1 : 0].classList.add('active');
  switchLoginTab(role, tabs[role === 'admin' ? 1 : 0]);
  document.getElementById('login-username').value = username;
  document.getElementById('login-password').value = password;
}

async function doLogin() {
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl = document.getElementById('login-error');
  const btn   = document.getElementById('login-btn');
  if (!username || !password) { errEl.textContent = 'Please enter both username and password.'; errEl.classList.add('show'); return; }
  btn.disabled = true; btn.textContent = 'Signing in…'; errEl.classList.remove('show');
  try {
    const res  = await fetch(API + '/auth/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({username, password}) });
    const data = await res.json();
    if (data.success) {
      authToken = data.token; currentUser = data.user;
      if (currentUser.role !== 'admin') {
        errEl.textContent = 'Please use the Admin tab for admin accounts.'; errEl.classList.add('show');
        authToken = null; currentUser = null; btn.disabled = false; btn.textContent = 'Sign In →'; return;
      }
      persistSession(authToken, currentUser); launchApp();
    } else { errEl.textContent = data.error || 'Login failed.'; errEl.classList.add('show'); }
  } catch(e) { errEl.textContent = 'Cannot connect to server.'; errEl.classList.add('show'); }
  btn.disabled = false; btn.textContent = 'Sign In →';
}

// ── OTP LOGIN FLOW ───────────────────────────────────────────
function resetOTPFlow() {
  clearOTPTimer();
  otpMobile = ''; otpIsExistingUser = false; otpIsExistingDonor = false;
  _showOTPStep('step-mobile');
  const el = document.getElementById('otp-mobile'); if (el) el.value = '';
  showOTPLogin(); // always reset to OTP section
  _clearOTPError();
}

// Show OTP login section, hide pwd section
function showOTPLogin() {
  const otpSection  = document.getElementById('otp-login-section');
  const pwdWrap     = document.getElementById('user-pwd-login-wrap');
  const signinFields= document.getElementById('user-pwd-signin-fields');
  const forgotPanel = document.getElementById('forgot-pwd-panel');
  if (otpSection)   otpSection.style.display   = '';
  if (pwdWrap)      pwdWrap.style.display       = 'none';
  if (signinFields) signinFields.style.display  = '';
  if (forgotPanel)  forgotPanel.style.display   = 'none';
  const uEl = document.getElementById('user-login-username');
  const pEl = document.getElementById('user-login-password');
  if (uEl) uEl.value = ''; if (pEl) pEl.value = '';
  _clearOTPError();
}

// Show pwd login section, hide OTP section
function showUserPwdLogin() {
  const otpSection = document.getElementById('otp-login-section');
  const pwdWrap    = document.getElementById('user-pwd-login-wrap');
  if (otpSection) otpSection.style.display = 'none';
  if (pwdWrap)    pwdWrap.style.display    = '';
  _clearOTPError();
  document.getElementById('user-login-username')?.focus();
}

// Legacy — kept so any old calls don't crash
function toggleUserPwdLogin() { showUserPwdLogin(); }

// Username + password login for HS Employee (admin-created accounts)
async function doUserPwdLogin() {
  const username = (document.getElementById('user-login-username')?.value || '').trim();
  const password =  document.getElementById('user-login-password')?.value || '';
  const btn      =  document.getElementById('user-pwd-login-btn');
  _clearOTPError();
  if (!username || !password) { _showOTPError('Please enter both username and password.'); return; }
  btn.disabled = true; btn.textContent = 'Signing in…';
  try {
    const res  = await fetch(API + '/auth/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({username, password}) });
    const data = await res.json();
    if (data.success) {
      if (data.user.role === 'admin') {
        _showOTPError('Admin accounts must use the Admin tab.');
        btn.disabled = false; btn.textContent = 'Sign In →'; return;
      }
      authToken = data.token; currentUser = data.user;
      persistSession(authToken, currentUser); launchApp();
      showToast('Welcome back! 🩸', 'success');
    } else { _showOTPError(data.error || 'Login failed.'); }
  } catch(e) { _showOTPError('Cannot connect to server.'); }
  btn.disabled = false; btn.textContent = 'Sign In →';
}

async function sendOTP() {
  const mobile = (document.getElementById('otp-mobile')?.value || '').trim();
  const btn    = document.getElementById('otp-send-btn');
  _clearOTPError();
  if (!/^[6-9]\d{9}$/.test(mobile)) { _showOTPError('Please enter a valid 10-digit Indian mobile number.'); return; }
  btn.disabled = true; btn.textContent = 'Checking…';
  try {
    const res  = await fetch(API + '/auth/otp/send', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({mobile}) });
    const data = await res.json();
    if (data.success) {
      // Block login if this mobile has no registered account
      if (!data.isExistingUser && !data.isExistingDonor) {
        _showOTPError('No account found for this mobile number. Please register first.');
        btn.disabled = false; btn.textContent = '📲 Sign In with OTP'; return;
      }
      otpMobile = mobile; otpIsExistingUser = !!data.isExistingUser; otpIsExistingDonor = !!data.isExistingDonor;
      document.getElementById('otp-mobile-display').textContent = '+91 ' + mobile;
      _showOTPStep('step-otp'); _startOTPTimer();
      document.getElementById('otp-code').value = ''; document.getElementById('otp-code').focus();
    } else { _showOTPError(data.error || 'Failed to send OTP.'); }
  } catch(e) { _showOTPError('Cannot connect to server.'); }
  btn.disabled = false; btn.textContent = '📲 Sign In with OTP';
}

async function verifyOTP() {
  const otp = (document.getElementById('otp-code')?.value || '').trim();
  const btn = document.getElementById('otp-verify-btn');
  _clearOTPError();
  if (!/^\d{6}$/.test(otp)) { _showOTPError('Please enter the 6-digit OTP.'); return; }
  btn.disabled = true; btn.textContent = 'Verifying…';
  if (otpIsExistingUser || otpIsExistingDonor) {
    try {
      const res  = await fetch(API + '/auth/otp/login', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({mobile: otpMobile, otp}) });
      const data = await res.json();
      if (data.success) {
        clearOTPTimer(); authToken = data.token; currentUser = data.user;
        persistSession(authToken, currentUser); launchApp(); showToast('Welcome back! 🩸', 'success');
      } else { _showOTPError(data.error || 'Login failed.'); }
    } catch(e) { _showOTPError('Cannot connect to server.'); }
  } else {
    _showOTPError('No account found for this mobile. Please use "Register as HS Employee" to create an account.');
  }
  btn.disabled = false; btn.textContent = '✅ Verify OTP';
}

// ── REGISTER BUTTON ──────────────────────────────────────────
function openRegisterForm() {
  _clearOTPError();
  regOtpVerified = false;
  clearRegOtpTimer();
  // Reset all fields
  ['reg-mobile-input','reg-otp-code','reg-username-new','reg-firstName','reg-lastName',
   'reg-email-new','reg-address','reg-lastDonation'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  ['reg-bloodtype-new'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  // (availability is asked via popup after login)
  // Hide OTP code row and fully reset verify btn
  const otpRow = document.getElementById('reg-otp-code-row'); if (otpRow) otpRow.style.display = 'none';
  const verBtn = document.getElementById('reg-mobile-verify-btn');
  if (verBtn) {
    verBtn.style.display = 'none';
    verBtn.textContent = '✅ Verify';
    verBtn.style.background = 'var(--red)';
    verBtn.disabled = false;
  }
  // Reset Send OTP button
  const sendBtn = document.getElementById('reg-send-otp-btn');
  if (sendBtn) { sendBtn.disabled = false; sendBtn.textContent = '📲 Send OTP'; }
  _showOTPStep('step-register');
}

function backFromRegister() {
  clearRegOtpTimer();
  resetOTPFlow();
}

// ── REGISTRATION OTP ─────────────────────────────────────────
async function sendRegOTP() {
  const mobile  = (document.getElementById('reg-mobile-input')?.value || '').trim();
  const sendBtn = document.getElementById('reg-send-otp-btn');
  _clearOTPError();
  if (!/^[6-9]\d{9}$/.test(mobile)) { _showOTPError('Please enter a valid 10-digit mobile number.'); return; }
  sendBtn.disabled = true; sendBtn.textContent = 'Sending…';
  try {
    const res  = await fetch(API + '/auth/otp/send', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({mobile, purpose: 'register'}) });
    const data = await res.json();
    if (data.success) {
      if (data.isExistingUser) {
        _showOTPError('This mobile is already registered. Please sign in with OTP instead.');
        sendBtn.disabled = false; sendBtn.textContent = '📲 Send OTP'; return;
      }
      // Show OTP code row and verify button
      const otpRow = document.getElementById('reg-otp-code-row'); if (otpRow) otpRow.style.display = '';
      const verBtn = document.getElementById('reg-mobile-verify-btn'); if (verBtn) verBtn.style.display = '';
      document.getElementById('reg-otp-code')?.focus();
      regOtpVerified = false;
      _startRegOtpTimer();
      showToast('OTP sent to +91 ' + mobile, 'success');
    } else { _showOTPError(data.error || 'Failed to send OTP.'); sendBtn.disabled = false; sendBtn.textContent = '📲 Send OTP'; }
  } catch(e) { _showOTPError('Cannot connect to server.'); sendBtn.disabled = false; sendBtn.textContent = '📲 Send OTP'; }
}

function verifyRegOTP() {
  // OTP is verified server-side during final submit — this just marks local intent
  const otp = (document.getElementById('reg-otp-code')?.value || '').trim();
  if (!/^\d{6}$/.test(otp)) { _showOTPError('Please enter the 6-digit OTP.'); return; }
  regOtpVerified = true;
  _clearOTPError();
  showToast('OTP accepted — please complete the form and submit.', 'success');
  const verBtn = document.getElementById('reg-mobile-verify-btn');
  if (verBtn) { verBtn.textContent = '✅ OTP Verified'; verBtn.style.background = '#16A34A'; verBtn.disabled = true; }
}

// ── SUBMIT REGISTRATION ──────────────────────────────────────
async function doOTPRegister() {
  _clearOTPError();
  const btn = document.getElementById('reg-submit-btn');

  const mobile      = (document.getElementById('reg-mobile-input')?.value   || '').trim();
  const otp         = (document.getElementById('reg-otp-code')?.value        || '').trim();
  const username    = (document.getElementById('reg-username-new')?.value    || '').trim();
  const firstName   = (document.getElementById('reg-firstName')?.value       || '').trim();
  const lastName    = (document.getElementById('reg-lastName')?.value        || '').trim();
  const bloodType   =  document.getElementById('reg-bloodtype-new')?.value   || '';
  const email       = (document.getElementById('reg-email-new')?.value       || '').trim();
  const address     = (document.getElementById('reg-address')?.value         || '').trim();
  const lastDonation=  document.getElementById('reg-lastDonation')?.value    || '';

  if (!mobile || !/^[6-9]\d{9}$/.test(mobile)) { _showOTPError('Please enter a valid 10-digit mobile number.'); return; }
  if (!otp || !/^\d{6}$/.test(otp))             { _showOTPError('Please send and enter the OTP to verify your mobile.'); return; }
  if (!username || username.length < 3)          { _showOTPError('Username must be at least 3 characters.'); return; }
  if (!firstName)   { _showOTPError('First name is required.'); return; }
  if (!lastName)    { _showOTPError('Last name is required.'); return; }
  if (!bloodType)   { _showOTPError('Please select your blood type.'); return; }
  if (!email)       { _showOTPError('Email address is required.'); return; }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { _showOTPError('Please enter a valid email address.'); return; }

  btn.disabled = true; btn.textContent = 'Registering…';
  try {
    const res  = await fetch(API + '/auth/register-direct', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ mobile, otp, username, firstName, lastName,
        bloodType, email, address, lastDonationDate: lastDonation || undefined })
    });
    const data = await res.json();
    if (data.success) {
      clearRegOtpTimer();
      authToken = data.token; currentUser = data.user;
      persistSession(authToken, currentUser);
      sessionStorage.setItem('hs_new_registration', '1');
      launchApp();
      showToast(`Welcome, ${firstName}! You are now registered as a donor. 🩸`, 'success');
    } else { _showOTPError(data.error || 'Registration failed.'); }
  } catch(e) { _showOTPError('Cannot connect to server.'); }
  btn.disabled = false; btn.textContent = '✨ Complete Registration';
}

// ── OTP STEP NAV ─────────────────────────────────────────────
function _showOTPStep(stepId) {
  ['step-mobile','step-otp','step-register'].forEach(id => {
    const el = document.getElementById(id); if (el) el.style.display = id === stepId ? '' : 'none';
  });
  // Back to Login button — only on step-otp
  const existingBack = document.getElementById('otp-step-back-btn');
  if (existingBack) existingBack.remove();
  if (stepId === 'step-otp') {
    const backBtn = document.createElement('button');
    backBtn.id = 'otp-step-back-btn';
    backBtn.textContent = '← Back to Login';
    backBtn.onclick = () => { clearOTPTimer(); resetOTPFlow(); };
    Object.assign(backBtn.style, {
      width: '100%', marginTop: '12px', padding: '10px',
      background: 'none', border: '1.5px solid var(--border)',
      borderRadius: '10px', color: 'var(--text2)',
      fontFamily: 'var(--font-ui)', fontSize: '0.85rem', cursor: 'pointer'
    });
    document.getElementById('step-otp')?.appendChild(backBtn);
  }
}
function _showOTPError(msg) { const el = document.getElementById('otp-error'); if (el) { el.textContent = msg; el.classList.add('show'); } }
function _clearOTPError()   { const el = document.getElementById('otp-error'); if (el) el.classList.remove('show'); }

// ── LOGIN OTP TIMER ──────────────────────────────────────────
function _startOTPTimer() {
  clearOTPTimer(); otpCountdown = 60; _updateTimerUI();
  otpTimer = setInterval(() => { otpCountdown--; _updateTimerUI(); if (otpCountdown <= 0) clearOTPTimer(); }, 1000);
}
function clearOTPTimer() { if (otpTimer) { clearInterval(otpTimer); otpTimer = null; } otpCountdown = 0; _updateTimerUI(); }
function _updateTimerUI() {
  const el = document.getElementById('otp-resend-timer'); const btn = document.getElementById('otp-resend-btn');
  if (!el || !btn) return;
  if (otpCountdown > 0) { el.style.display = ''; btn.style.display = 'none'; el.textContent = `Resend OTP in ${otpCountdown}s`; }
  else { el.style.display = 'none'; btn.style.display = ''; }
}
function resendOTP() { _showOTPStep('step-mobile'); const el = document.getElementById('otp-mobile'); if (el) el.value = otpMobile; _clearOTPError(); }
function changeOTPMobile() { resetOTPFlow(); }

// ── REGISTRATION OTP TIMER ───────────────────────────────────
function _startRegOtpTimer() {
  clearRegOtpTimer(); regOtpCountdown = 60; _updateRegTimerUI();
  regOtpTimer = setInterval(() => { regOtpCountdown--; _updateRegTimerUI(); if (regOtpCountdown <= 0) clearRegOtpTimer(); }, 1000);
}
function clearRegOtpTimer() { if (regOtpTimer) { clearInterval(regOtpTimer); regOtpTimer = null; } regOtpCountdown = 0; _updateRegTimerUI(); }
function _updateRegTimerUI() {
  const el  = document.getElementById('reg-otp-timer');
  const btn = document.getElementById('reg-send-otp-btn');
  if (!el) return;
  if (regOtpCountdown > 0) {
    el.style.display = ''; el.textContent = `Resend in ${regOtpCountdown}s`;
    if (btn) btn.disabled = true;
  } else {
    el.style.display = 'none';
    if (btn && !regOtpVerified) { btn.disabled = false; btn.textContent = '📲 Send OTP'; }
  }
}

// ── LOGOUT ───────────────────────────────────────────────────
function doLogout() {
  authToken = null; currentUser = null;
  localStorage.removeItem('bl_token'); localStorage.removeItem('bl_user'); localStorage.removeItem('bl_expires_at');
  closeSidebarMobile();
  if (typeof destroyNotifications === 'function') destroyNotifications();
  document.getElementById('app').classList.remove('visible');
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('login-username').value = ''; document.getElementById('login-password').value = '';
  document.getElementById('login-error').classList.remove('show');
  loginRole = 'user';
  document.querySelectorAll('.login-tab').forEach(b => b.classList.remove('active'));
  const userTab = document.querySelector('.login-tab[onclick*="user"]');
  if (userTab) { userTab.classList.add('active'); switchLoginTab('user', userTab); }
}

function persistSession(token, user) {
  const expiresAt = Date.now() + 24*60*60*1000;
  localStorage.setItem('bl_token', token); localStorage.setItem('bl_user', JSON.stringify(user)); localStorage.setItem('bl_expires_at', expiresAt.toString());
}

function launchApp() {
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.add('visible');
  applyRoleUI();
  showPage('dashboard', document.querySelector('.nav-btn[onclick*="dashboard"]'));
  if (typeof initNotifications === 'function') initNotifications();
}

// ── FORGOT PASSWORD (username/password login flow) ────────────
function toggleForgotPassword() {
  const panel    = document.getElementById('forgot-pwd-panel');
  const signIn   = document.getElementById('user-pwd-signin-fields');
  if (!panel) return;
  const showing = panel.style.display !== 'none';
  panel.style.display   = showing ? 'none' : '';
  if (signIn) signIn.style.display = showing ? '' : 'none';
  if (!showing) {
    ['fp-username','fp-email','fp-new-password','fp-confirm-password'].forEach(id => {
      const el = document.getElementById(id); if (el) el.value = '';
    });
    const errEl = document.getElementById('fp-error');
    const sucEl = document.getElementById('fp-success');
    if (errEl) { errEl.textContent=''; errEl.classList.remove('show'); errEl.style.display='none'; }
    if (sucEl) { sucEl.style.display='none'; }
    document.getElementById('fp-username')?.focus();
  }
}

async function doForgotPassword() {
  const username        = (document.getElementById('fp-username')?.value        || '').trim();
  const email           = (document.getElementById('fp-email')?.value           || '').trim();
  const newPassword     =  document.getElementById('fp-new-password')?.value    || '';
  const confirmPassword =  document.getElementById('fp-confirm-password')?.value || '';
  const errEl           =  document.getElementById('fp-error');
  const sucEl           =  document.getElementById('fp-success');
  const btn             =  document.getElementById('fp-btn');

  if (errEl) { errEl.textContent=''; errEl.classList.remove('show'); errEl.style.display='none'; }
  if (sucEl) { sucEl.style.display='none'; }

  if (!username)                         { _showFpError('Username is required.'); return; }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { _showFpError('A valid email address is required.'); return; }
  if (!newPassword || newPassword.length < 6) { _showFpError('New password must be at least 6 characters.'); return; }
  if (newPassword !== confirmPassword)   { _showFpError('Passwords do not match.'); return; }

  if (btn) { btn.disabled=true; btn.textContent='Resetting…'; }
  try {
    const res  = await fetch(API + '/auth/forgot-password', {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ username, email, newPassword, confirmPassword })
    });
    const data = await res.json();
    if (data.success) {
      if (sucEl) { sucEl.textContent='✅ '+data.message; sucEl.style.display=''; }
      if (btn)   { btn.textContent='✅ Done'; }
      setTimeout(() => {
        document.getElementById('forgot-pwd-panel').style.display = 'none';
        if (btn) { btn.disabled=false; btn.textContent='🔑 Reset Password'; }
        showToast('Password reset! Please sign in.','success');
      }, 2000);
    } else {
      _showFpError(data.error || 'Reset failed. Check your username and email.');
      if (btn) { btn.disabled=false; btn.textContent='🔑 Reset Password'; }
    }
  } catch(e) {
    _showFpError('Cannot connect to server.');
    if (btn) { btn.disabled=false; btn.textContent='🔑 Reset Password'; }
  }
}

function _showFpError(msg) {
  const el = document.getElementById('fp-error');
  if (!el) return;
  el.textContent=msg; el.style.display=''; el.classList.add('show');
}

// ── CONTACT SUPPORT ──────────────────────────────────────────
async function sendContactSupport() {
  const name    = (document.getElementById('cs-name')?.value    || '').trim();
  const email   = (document.getElementById('cs-email')?.value   || '').trim();
  const subject = (document.getElementById('cs-subject')?.value || '').trim();
  const message = (document.getElementById('cs-message')?.value || '').trim();
  const file    =  document.getElementById('cs-attachment')?.files?.[0];
  const errEl   =  document.getElementById('cs-error');
  const btn     =  document.getElementById('cs-send-btn');

  if (errEl) { errEl.textContent=''; errEl.classList.remove('show'); errEl.style.display='none'; }

  if (!name)    { _showCsError('Your name is required.'); return; }
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { _showCsError('A valid email address is required.'); return; }
  if (!subject) { _showCsError('Subject is required.'); return; }
  if (!message) { _showCsError('Message is required.'); return; }

  btn.disabled=true; btn.textContent='Opening mail…';

  // Fetch admin contact email from server
  let adminEmail = 'admin@hsblood.com';
  try {
    const r = await fetch(API + '/config/admin-email');
    const d = await r.json();
    if (d.success && d.email) adminEmail = d.email;
  } catch(e) { /* use default */ }

  const attachNote = file
    ? `\n\n[Attachment: "${file.name}" — please attach this file manually after your mail client opens]`
    : '';
  const body    = `From: ${name} <${email}>\n\n${message}${attachNote}\n\n---\nSent via HSBlood Contact Support`;
  const mailto  = `mailto:${encodeURIComponent(adminEmail)}?subject=${encodeURIComponent('[HSBlood Support] '+subject)}&body=${encodeURIComponent(body)}`;
  window.location.href = mailto;

  setTimeout(() => {
    btn.disabled=false; btn.textContent='📧 Send Message';
    closeModal('contact-support-modal');
    showToast('Mail client opened! Attach any files and send the email.','success');
    ['cs-name','cs-email','cs-subject','cs-message'].forEach(id => {
      const el=document.getElementById(id); if (el) el.value='';
    });
    const att=document.getElementById('cs-attachment'); if (att) att.value='';
  }, 1500);
}

function _showCsError(msg) {
  const el=document.getElementById('cs-error');
  if (!el) return;
  el.textContent=msg; el.style.display=''; el.classList.add('show');
}

// Legacy stubs
function openForgotPasswordModal() {}
function openSignupModal() {} async function doRegister() {}

async function doChangePassword() {
  const newPassword     = document.getElementById('cp-new').value;
  const confirmPassword = document.getElementById('cp-confirm').value;
  const errEl = document.getElementById('cp-error');
  const sucEl = document.getElementById('cp-success');
  const btn   = document.getElementById('cp-btn');
  errEl.classList.remove('show'); errEl.style.display='none'; sucEl.style.display='none';
  if (!newPassword || !confirmPassword) { errEl.textContent='All fields are required.'; errEl.style.display='block'; return; }
  if (newPassword.length < 6)           { errEl.textContent='Password must be at least 6 characters.'; errEl.style.display='block'; return; }
  if (newPassword !== confirmPassword)  { errEl.textContent='Passwords do not match.'; errEl.style.display='block'; return; }
  btn.disabled=true; btn.textContent='Updating…';
  try {
    const res  = await fetch(API+'/auth/change-password',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+authToken},body:JSON.stringify({newPassword,confirmPassword})});
    const data = await res.json();
    if (data.success) {
      sucEl.textContent='✅ '+data.message; sucEl.style.display='block';
      document.getElementById('cp-new').value='';
      document.getElementById('cp-confirm').value='';
      showToast('Password updated!','success');
    } else { errEl.textContent=data.error||'Update failed.'; errEl.style.display='block'; }
  } catch(e) { errEl.textContent='Cannot connect to server.'; errEl.style.display='block'; }
  btn.disabled=false; btn.textContent='🔒 Update Password';
}

// ── AVAILABILITY POPUP ───────────────────────────────────────
async function setAvailability(isAvailable) {
  closeModal('availability-modal');
  try {
    const data = await apiFetch('/auth/availability', {
      method: 'POST',
      body: JSON.stringify({ isAvailable })
    });
    if (data.success) {
      currentUser = { ...currentUser, isAvailable };
      localStorage.setItem('bl_user', JSON.stringify(currentUser));
      showToast(isAvailable ? '✅ Marked as available to donate!' : '❌ Marked as unavailable.', 'success');
    } else {
      showToast('Availability not saved — update it from your Profile.', 'warn');
    }
  } catch(e) {
    showToast('Availability not saved — update it from your Profile.', 'warn');
  }
}

// ── SIDEBAR ──────────────────────────────────────────────────
let sidebarCollapsed = false;
function toggleSidebar(){const s=document.getElementById('sidebar');const m=document.querySelector('.main');sidebarCollapsed=!sidebarCollapsed;s.classList.toggle('collapsed',sidebarCollapsed);m.style.marginLeft=sidebarCollapsed?'var(--sidebar-collapsed-w)':'var(--sidebar-w)';try{localStorage.setItem('sb_collapsed',sidebarCollapsed?'1':'0');}catch(e){}}
function openSidebarMobile(){document.getElementById('sidebar').classList.add('mobile-open');document.getElementById('sidebar-overlay').classList.add('active');document.body.style.overflow='hidden';}
function closeSidebarMobile(){document.getElementById('sidebar').classList.remove('mobile-open');document.getElementById('sidebar-overlay').classList.remove('active');document.body.style.overflow='';}
function isMobile(){return window.innerWidth<=768;}
(function restoreSidebar(){try{if(localStorage.getItem('sb_collapsed')==='1'){sidebarCollapsed=true;document.getElementById('sidebar')?.classList.add('collapsed');const m=document.querySelector('.main');if(m)m.style.marginLeft='var(--sidebar-collapsed-w)';}  }catch(e){}})();

// ── NEW USER PASSWORD BANNER ──────────────────────────────────
// Patches launchApp to show a one-time banner for newly registered users.
(function () {
  const _origLaunchApp = launchApp;
  launchApp = function () {
    _origLaunchApp.apply(this, arguments);
    _maybeShowNewUserBanner();
  };
})();

function _maybeShowNewUserBanner() {
  if (sessionStorage.getItem('hs_new_registration') !== '1') return;
  sessionStorage.removeItem('hs_new_registration'); // consume immediately — one-time only

  document.getElementById('new-user-pwd-banner')?.remove();

  const banner = document.createElement('div');
  banner.id = 'new-user-pwd-banner';
  banner.innerHTML = `
    <div style="display:flex;align-items:flex-start;gap:14px;flex:1;min-width:0">
      <div style="font-size:1.6rem;line-height:1;flex-shrink:0;margin-top:2px">🔐</div>
      <div style="min-width:0">
        <div style="font-family:var(--font-ui);font-weight:700;font-size:0.95rem;color:#fff;margin-bottom:3px">Set up your password</div>
        <div style="font-size:0.82rem;color:rgba(255,255,255,0.82);line-height:1.45">
          You're signed in with OTP. Create a password so you can sign in with your username anytime — no OTP needed.
        </div>
        <button
          onclick="showPage('security', document.getElementById('nav-security')); document.getElementById('new-user-pwd-banner')?.remove();"
          style="margin-top:10px;background:rgba(255,255,255,0.18);border:1.5px solid rgba(255,255,255,0.4);color:#fff;font-family:var(--font-ui);font-size:0.8rem;font-weight:700;padding:6px 16px;border-radius:8px;cursor:pointer;transition:background .2s"
          onmouseover="this.style.background='rgba(255,255,255,0.28)'" onmouseout="this.style.background='rgba(255,255,255,0.18)'"
        >Create Password →</button>
      </div>
    </div>
    <button
      onclick="document.getElementById('new-user-pwd-banner').remove()"
      aria-label="Dismiss"
      style="flex-shrink:0;background:transparent;border:none;color:rgba(255,255,255,0.6);font-size:1.25rem;cursor:pointer;line-height:1;padding:2px 4px;margin-top:-2px;transition:color .2s"
      onmouseover="this.style.color='#fff'" onmouseout="this.style.color='rgba(255,255,255,0.6)'"
    >✕</button>
  `;
  Object.assign(banner.style, {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: '12px',
    background: 'linear-gradient(135deg,#1e3a5f 0%,#1d4ed8 100%)',
    borderRadius: 'var(--radius, 12px)',
    padding: '18px 20px',
    marginBottom: '18px',
    boxShadow: '0 6px 24px rgba(29,78,216,0.32)',
    animation: 'fadeUp .4s ease both',
    border: '1px solid rgba(255,255,255,0.12)',
    boxSizing: 'border-box'
  });

  // Insert right after the .page-header of the dashboard
  const pageHeader = document.querySelector('#page-dashboard .page-header');
  if (pageHeader) {
    pageHeader.insertAdjacentElement('afterend', banner);
  } else {
    document.getElementById('page-dashboard')?.prepend(banner);
  }
}
