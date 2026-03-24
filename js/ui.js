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

  const isAdminRole = role === 'admin';

  // ── REQUIREMENTS page & Add Requirement button ──────────────
  // Admin: sees Requirements page + Add Requirement button (sidebar + page header)
  // User:  does NOT see Requirements page or Add Requirement button
  const navReq = document.getElementById('nav-requirements');
  if(navReq) navReq.style.display = isAdminRole ? '' : 'none';

  const reqAdminBtn = document.getElementById('req-admin-btn');
  if(reqAdminBtn){
    reqAdminBtn.innerHTML = isAdminRole
      ? `<button id="btn-open-req-modal" class="btn btn-primary" onclick="openReqModal()">➕ Add Requirement</button>
         <button id="btn-open-bulk-req-modal" class="btn btn-outline" onclick="openBulkReqModal()" style="margin-left:8px">📥 Bulk Upload</button>`
      : '';
  }

  // Sidebar "Add Requirement" quick-action — admin only
  const navAddReq = document.getElementById('nav-add-req');
  if(navAddReq) navAddReq.style.display = isAdminRole ? '' : 'none';

  // ── RESPOND page — users only, not admins ───────────────────
  const navRespond  = document.getElementById('nav-respond');
  if(navRespond) navRespond.style.display = isAdminRole ? 'none' : '';

  // ── Security nav — only for HS Employee (not admin) ─────────
  const secNav   = document.getElementById('nav-security');
  const secLabel = document.getElementById('nav-label-account');
  if(secNav)   secNav.style.display   = isAdminRole ? 'none' : '';
  if(secLabel) secLabel.style.display = isAdminRole ? 'none' : '';

  // ── Profile nav — visible for ALL roles ─────────────────────
  const profileNav = document.getElementById('nav-profile');
  if(profileNav) profileNav.style.display = '';

  // ── Admin-only nav items ─────────────────────────────────────
  const usersNav   = document.getElementById('nav-users');
  const exportNav  = document.getElementById('nav-export');
  const adminLabel = document.getElementById('nav-label-admin');
  if(usersNav)   usersNav.style.display   = isAdminRole ? '' : 'none';
  if(exportNav)  exportNav.style.display  = isAdminRole ? '' : 'none';
  if(adminLabel) adminLabel.style.display = isAdminRole ? '' : 'none';

  // ── My Activity section ──────────────────────────────────────
  // My Requests + Donation History — ALL roles
  // Respond — users only (hidden for admin, handled above)
  const myActLabel = document.getElementById('nav-label-myactivity');
  const myReqNav   = document.getElementById('nav-my-requests');
  const donHistNav = document.getElementById('nav-donation-history');
  if(myActLabel) myActLabel.style.display = '';
  if(myReqNav)   myReqNav.style.display   = '';
  if(donHistNav) donHistNav.style.display = isAdminRole ? 'none' : '';

  // ── Bulk Upload button (donors page) — admin only ────────────
  const bulkBtn = document.getElementById('bulk-upload-btn');
  if(bulkBtn) bulkBtn.style.display = isAdminRole ? '' : 'none';

  // ── Register Donor sidebar button ────────────────────────────
  const navRegDonor = document.getElementById('nav-register-donor');
  if(navRegDonor) navRegDonor.style.display = isAdminRole ? '' : 'none';

  // ── My Requests "New Requirement" button — visible for ALL roles
  const myReqAddBtn = document.getElementById('my-req-add-btn');
  if(myReqAddBtn) myReqAddBtn.style.display = '';
}

// ── PAGE NAVIGATION ────────────────────────────────
function showPage(page, btn){
  document.querySelectorAll('.page').forEach(p=>p.style.display='none');
  const pageEl = document.getElementById('page-'+page);
  if(!pageEl) return;
  pageEl.style.display='';
  document.querySelectorAll('.nav-btn').forEach(b=>b.classList.remove('active'));
  if(btn) btn.classList.add('active');
  if(page==='donors')           loadDonors();
  if(page==='dashboard')        loadDashboard();
  if(page==='requirements')     loadRequirements();
  if(page==='info')             loadInfo();
  if(page==='users')            loadUsers();
  if(page==='profile')          loadProfile();
  if(page==='my-requests')      loadMyRequests();
  if(page==='respond')          loadOpenRequirements();
  if(page==='donation-history') loadMyDonationHistory();
  if(page==='security') {
    const sucEl = document.getElementById('cp-success');
    const errEl = document.getElementById('cp-error');
    const newEl = document.getElementById('cp-new');
    const conEl = document.getElementById('cp-confirm');
    if(sucEl) { sucEl.textContent=''; sucEl.style.display='none'; }
    if(errEl) { errEl.textContent=''; errEl.classList.remove('show'); errEl.style.display='none'; }
    if(newEl) newEl.value='';
    if(conEl) conEl.value='';
  }
  closeSidebarMobile();
}
