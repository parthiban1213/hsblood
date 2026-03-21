// ══════════════════════════════════════════════════════════════
// HSBlood — js/ui.js
// Sidebar, mobile nav, role-based UI, page navigation
// ══════════════════════════════════════════════════════════════

// ── ROLE-BASED UI ──────────────────────────────────
function applyRoleUI(){
  const role = currentUser.role;
  const uname = currentUser.username;

  // Sidebar info
  document.getElementById('sidebar-username').textContent = uname;
  document.getElementById('sidebar-userrole').textContent = role==='admin' ? 'Administrator' : 'HS Employee';
  document.getElementById('sidebar-avatar').textContent   = uname[0].toUpperCase();
  document.getElementById('sidebar-role-pill').innerHTML  =
    `<span class="role-pill ${role}">${role==='admin'?'🛡️ Admin':'👁️ HS Employee'}</span>`;
  document.getElementById('dash-welcome').textContent     =
    `Welcome back, ${uname}! You are logged in as ${role==='admin'?'Administrator':'HS Employee'}.`;

  // Requirements add button — both roles can add
  document.getElementById('req-admin-btn').innerHTML =
    `<button id="btn-open-req-modal" class="btn btn-primary" onclick="openReqModal()">➕ Add Requirement</button>
     ${isAdmin() ? '<button id="btn-open-bulk-req-modal" class="btn btn-outline" onclick="openBulkReqModal()" style="margin-left:8px">📥 Bulk Upload</button>' : ''}`;

  // Show "Add Requirement" quick-action in sidebar for all roles
  document.getElementById('nav-add-req').style.display = '';

  // Security nav — only for HS Employee (not admin)
  const secNav = document.getElementById('nav-security');
  const secLabel = document.getElementById('nav-label-account');
  if(secNav) secNav.style.display = role === 'user' ? '' : 'none';
  if(secLabel) secLabel.style.display = role === 'user' ? '' : 'none';

  // Profile nav — visible for ALL roles
  const profileNav = document.getElementById('nav-profile');
  if(profileNav) profileNav.style.display = '';

  // Show User Management and Export nav for admin only
  const usersNav   = document.getElementById('nav-users');
  const exportNav  = document.getElementById('nav-export');
  const adminLabel = document.getElementById('nav-label-admin');
  if(usersNav)   usersNav.style.display   = role === 'admin' ? '' : 'none';
  if(exportNav)  exportNav.style.display  = role === 'admin' ? '' : 'none';
  if(adminLabel) adminLabel.style.display = role === 'admin' ? '' : 'none';

  // Show Bulk Upload button for admin only
  const bulkBtn = document.getElementById('bulk-upload-btn');
  if(bulkBtn) bulkBtn.style.display = isAdmin() ? '' : 'none';
}

// ── PAGE NAVIGATION ────────────────────────────────
function showPage(page, btn){
  document.querySelectorAll('.page').forEach(p=>p.style.display='none');
  document.getElementById('page-'+page).style.display='';
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  if(btn) btn.classList.add('active');
  if(page==='donors') loadDonors();
  if(page==='dashboard') loadDashboard();
  if(page==='requirements') loadRequirements();
  if(page==='info') loadInfo();
  if(page==='users') loadUsers();
  if(page==='profile') loadProfile();
  closeSidebarMobile(); // close on mobile after nav
}
