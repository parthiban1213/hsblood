// ══════════════════════════════════════════════════════════════
// HSBlood — js/auth.js
// Login, logout, signup, forgot password, change password, session
// ══════════════════════════════════════════════════════════════

// ── LOGIN ──────────────────────────────────────────
let loginRole = 'user';

function switchLoginTab(role, btn){
  loginRole = role;
  document.querySelectorAll('.login-tab').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('login-username').value='';
  document.getElementById('login-password').value='';
  document.getElementById('login-error').classList.remove('show');

  const desc = document.getElementById('login-role-desc');
  if(role==='admin'){
    desc.innerHTML=`<div class="role-icon">🛡️</div><p><strong>The Gatekeeper</strong>Access granted with responsibility.</p>`;
    document.getElementById('signup-section').style.display='none';
    document.getElementById('forgot-password-link').style.display='none';
  } else {
    desc.innerHTML=`<div class="role-icon">👁️</div><p><strong>Smart Access</strong>Access what you need to get things done</p>`;
    document.getElementById('signup-section').style.display='';
    document.getElementById('forgot-password-link').style.display='block';
  }
}

function fillCreds(username, password, role){
  // Switch to the matching tab first
  const tabs = document.querySelectorAll('.login-tab');
  tabs.forEach(t => t.classList.remove('active'));
  tabs[role==='admin'?1:0].classList.add('active');
  switchLoginTab(role, tabs[role==='admin'?1:0]);
  // Fill credentials
  document.getElementById('login-username').value = username;
  document.getElementById('login-password').value = password;
  document.getElementById('login-error').classList.remove('show');
}

async function doLogin(){
  const username = document.getElementById('login-username').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl    = document.getElementById('login-error');
  const btn      = document.getElementById('login-btn');

  if(!username || !password){
    errEl.textContent='Please enter both username and password.';
    errEl.classList.add('show'); return;
  }

  btn.disabled=true; btn.textContent='Signing in…';
  errEl.classList.remove('show');

  try{
    const res = await fetch(API+'/auth/login',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({username, password})
    });
    const data = await res.json();

    if(data.success){
      authToken   = data.token;
      currentUser = data.user;

      // Validate role matches selected tab
      if(currentUser.role !== loginRole){
        errEl.textContent = loginRole==='admin'
          ? 'This account does not have admin access.'
          : 'Please use the Admin tab for admin accounts.';
        errEl.classList.add('show');
        authToken=null; currentUser=null;
        btn.disabled=false; btn.textContent='Sign In →'; return;
      }

      const expiresAt = Date.now() + 24 * 60 * 60 * 1000; // 24 hours
      localStorage.setItem('bl_token',      authToken);
      localStorage.setItem('bl_user',       JSON.stringify(currentUser));
      localStorage.setItem('bl_expires_at', expiresAt.toString());
      launchApp();
    } else {
      errEl.textContent = data.error || 'Login failed.';
      errEl.classList.add('show');
    }
  }catch(e){
    errEl.textContent='Cannot connect to server. Is the backend running?';
    errEl.classList.add('show');
  }

  btn.disabled=false; btn.textContent='Sign In →';
}

function doLogout(){
  authToken=null; currentUser=null;
  localStorage.removeItem('bl_token');
  localStorage.removeItem('bl_user');
  localStorage.removeItem('bl_expires_at');
  closeSidebarMobile();
  // Stop notification polling and reset bell
  if (typeof destroyNotifications === 'function') destroyNotifications();
  document.getElementById('app').classList.remove('visible');
  document.getElementById('login-screen').classList.remove('hidden');
  document.getElementById('login-username').value='';
  document.getElementById('login-password').value='';
  document.getElementById('login-error').classList.remove('show');
}

// ── SIGN UP / REGISTER ─────────────────────────────

// ── FORGOT PASSWORD ────────────────────────────────────────────
function openForgotPasswordModal(){
  document.getElementById('fp-username').value='';
  document.getElementById('fp-email').value='';
  document.getElementById('fp-new-password').value='';
  document.getElementById('fp-confirm-password').value='';
  const errEl=document.getElementById('fp-error');
  const sucEl=document.getElementById('fp-success');
  errEl.classList.remove('show'); errEl.style.display='';
  sucEl.style.display='none';
  document.getElementById('fp-btn').disabled=false;
  document.getElementById('fp-btn').textContent='🔑 Reset Password';
  openModal('forgot-password-modal');
}

async function doForgotPassword(){
  const username        = document.getElementById('fp-username').value.trim();
  const email           = document.getElementById('fp-email').value.trim();
  const newPassword     = document.getElementById('fp-new-password').value;
  const confirmPassword = document.getElementById('fp-confirm-password').value;
  const errEl           = document.getElementById('fp-error');
  const sucEl           = document.getElementById('fp-success');
  const btn             = document.getElementById('fp-btn');

  errEl.classList.remove('show'); errEl.style.display='none';
  sucEl.style.display='none';

  if(!username || !email || !newPassword || !confirmPassword){
    errEl.textContent='All fields are required.';
    errEl.style.display='block'; return;
  }
  if(newPassword.length < 6){
    errEl.textContent='New password must be at least 6 characters.';
    errEl.style.display='block'; return;
  }
  if(newPassword !== confirmPassword){
    errEl.textContent='Passwords do not match.';
    errEl.style.display='block'; return;
  }

  btn.disabled=true; btn.textContent='Resetting…';

  try{
    const res = await fetch(API+'/auth/forgot-password',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({username, email, newPassword, confirmPassword})
    });
    const data = await res.json();
    if(data.success){
      sucEl.textContent='✅ '+data.message;
      sucEl.style.display='block';
      btn.textContent='✅ Done';
      setTimeout(()=>{ closeModal('forgot-password-modal'); showToast('Password reset! Please sign in.','success'); }, 1800);
    } else {
      errEl.textContent = data.error || 'Reset failed.';
      errEl.style.display='block';
      btn.disabled=false; btn.textContent='🔑 Reset Password';
    }
  }catch(e){
    errEl.textContent='Cannot connect to server.';
    errEl.style.display='block';
    btn.disabled=false; btn.textContent='🔑 Reset Password';
  }
}

// ── SECURITY PAGE — CHANGE PASSWORD ────────────────────────────
async function doChangePassword(){
  const currentPassword = document.getElementById('cp-current').value;
  const newPassword     = document.getElementById('cp-new').value;
  const confirmPassword = document.getElementById('cp-confirm').value;
  const errEl           = document.getElementById('cp-error');
  const sucEl           = document.getElementById('cp-success');
  const btn             = document.getElementById('cp-btn');

  errEl.classList.remove('show'); errEl.style.display='none';
  sucEl.style.display='none';

  if(!currentPassword || !newPassword || !confirmPassword){
    errEl.textContent='All fields are required.';
    errEl.style.display='block'; return;
  }
  if(newPassword.length < 6){
    errEl.textContent='New password must be at least 6 characters.';
    errEl.style.display='block'; return;
  }
  if(newPassword !== confirmPassword){
    errEl.textContent='New passwords do not match.';
    errEl.style.display='block'; return;
  }

  btn.disabled=true; btn.textContent='Updating…';

  try{
    const res = await fetch(API+'/auth/change-password',{
      method:'POST',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+authToken},
      body:JSON.stringify({currentPassword, newPassword, confirmPassword})
    });
    const data = await res.json();
    if(data.success){
      sucEl.textContent='✅ '+data.message;
      sucEl.style.display='block';
      document.getElementById('cp-current').value='';
      document.getElementById('cp-new').value='';
      document.getElementById('cp-confirm').value='';
      showToast('Password updated successfully!','success');
    } else {
      errEl.textContent = data.error || 'Update failed.';
      errEl.style.display='block';
    }
  }catch(e){
    errEl.textContent='Cannot connect to server.';
    errEl.style.display='block';
  }
  btn.disabled=false; btn.textContent='🔒 Update Password';
}

function openSignupModal(){
  document.getElementById('reg-username').value='';
  document.getElementById('reg-email').value='';
  document.getElementById('reg-password').value='';
  document.getElementById('reg-confirm-password').value='';
  document.getElementById('reg-bloodtype').value='';
  document.getElementById('signup-error').classList.remove('show');
  document.getElementById('signup-error').style.display='none';
  document.getElementById('signup-success').style.display='none';
  document.getElementById('register-btn').disabled=false;
  document.getElementById('register-btn').textContent='✨ Create Account';
  openModal('signup-modal');
}

async function doRegister(){
  const username        = document.getElementById('reg-username').value.trim();
  const email           = document.getElementById('reg-email').value.trim();
  const password        = document.getElementById('reg-password').value;
  const confirmPassword = document.getElementById('reg-confirm-password').value;
  const bloodType       = document.getElementById('reg-bloodtype').value;
  const errEl           = document.getElementById('signup-error');
  const successEl       = document.getElementById('signup-success');
  const btn             = document.getElementById('register-btn');

  errEl.style.display='none'; successEl.style.display='none';

  // Client-side validation
  if(!username || !password || !confirmPassword){
    errEl.textContent='All fields are required.';
    errEl.style.display='block'; return;
  }
  if(username.length < 3){
    errEl.textContent='Username must be at least 3 characters.';
    errEl.style.display='block'; return;
  }
  if(password.length < 6){
    errEl.textContent='Password must be at least 6 characters.';
    errEl.style.display='block'; return;
  }
  if(password !== confirmPassword){
    errEl.textContent='Passwords do not match.';
    errEl.style.display='block'; return;
  }

  btn.disabled=true; btn.textContent='Creating account…';

  try{
    const res = await fetch(API+'/auth/register',{
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({username, email, password, confirmPassword, bloodType})
    });
    const data = await res.json();

    if(data.success){
      successEl.textContent='✅ Account created! Signing you in…';
      successEl.style.display='block';
      // Auto-login after successful registration
      setTimeout(async ()=>{
        closeModal('signup-modal');
        try{
          const loginRes = await fetch(API+'/auth/login',{
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body:JSON.stringify({username, password})
          });
          const loginData = await loginRes.json();
          if(loginData.success){
            authToken   = loginData.token;
            currentUser = loginData.user;
            const regExpiresAt = Date.now() + 24 * 60 * 60 * 1000;
            localStorage.setItem('bl_token',      authToken);
            localStorage.setItem('bl_user',       JSON.stringify(loginData.user));
            localStorage.setItem('bl_expires_at', regExpiresAt.toString());
            launchApp();
            showToast('Welcome, '+username+'! Account created successfully.','success');
          } else {
            loginRole = 'user';
            document.querySelectorAll('.login-tab').forEach(b=>b.classList.remove('active'));
            document.querySelector('.login-tab[onclick*="user"]').classList.add('active');
            document.getElementById('login-username').value = username;
            document.getElementById('login-password').value = '';
            document.getElementById('login-password').focus();
            showToast('Account created! Please sign in.','success');
          }
        }catch(e){
          loginRole = 'user';
          document.getElementById('login-username').value = username;
          showToast('Account created! Please sign in.','success');
        }
      }, 1200);
    } else {
      errEl.textContent = data.error || 'Registration failed.';
      errEl.style.display='block';
      btn.disabled=false; btn.textContent='✨ Create Account';
    }
  }catch(e){
    errEl.textContent='Cannot connect to server. Is the backend running?';
    errEl.style.display='block';
    btn.disabled=false; btn.textContent='✨ Create Account';
  }
}

function launchApp(){
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app').classList.add('visible');
  applyRoleUI();
  showPage('dashboard', document.querySelector('.nav-btn[onclick*="dashboard"]'));
  // Start notification polling
  if (typeof initNotifications === 'function') initNotifications();
}

// ── SIDEBAR TOGGLE ──────────────────────────────────
let sidebarCollapsed = false;

function toggleSidebar(){
  const sidebar  = document.getElementById('sidebar');
  const mainEl   = document.querySelector('.main');
  sidebarCollapsed = !sidebarCollapsed;
  sidebar.classList.toggle('collapsed', sidebarCollapsed);
  // Adjust main margin
  mainEl.style.marginLeft = sidebarCollapsed
    ? 'var(--sidebar-collapsed-w)'
    : 'var(--sidebar-w)';
  // Persist
  try{ localStorage.setItem('sb_collapsed', sidebarCollapsed ? '1' : '0'); }catch(e){}
}

function openSidebarMobile(){
  const sidebar  = document.getElementById('sidebar');
  const overlay  = document.getElementById('sidebar-overlay');
  sidebar.classList.add('mobile-open');
  overlay.classList.add('active');
  document.body.style.overflow = 'hidden';
}

function closeSidebarMobile(){
  const sidebar  = document.getElementById('sidebar');
  const overlay  = document.getElementById('sidebar-overlay');
  sidebar.classList.remove('mobile-open');
  overlay.classList.remove('active');
  document.body.style.overflow = '';
}

function isMobile(){ return window.innerWidth <= 768; }

// Restore sidebar collapsed state on desktop
(function restoreSidebar(){
  try{
    const val = localStorage.getItem('sb_collapsed');
    if(val === '1'){
      sidebarCollapsed = true;
      document.getElementById('sidebar')?.classList.add('collapsed');
      const mainEl = document.querySelector('.main');
      if(mainEl) mainEl.style.marginLeft = 'var(--sidebar-collapsed-w)';
    }
  }catch(e){}
})();
