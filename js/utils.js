// ══════════════════════════════════════════════════════════════
// HSBlood — js/utils.js
// Shared utilities: toast, date formatting, avatar helpers
// ══════════════════════════════════════════════════════════════

// ── UTILS ──────────────────────────────────────────
function showToast(msg, type='success'){
  const t=document.getElementById('toast');
  t.textContent=msg; t.className=`show ${type}`;
  setTimeout(()=>t.className='',3200);
}
function formatDate(d){
  if(!d) return '—';
  return new Date(d).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'});
}
function getInitials(f,l){return((f||'')[0]+(l||'')[0]).toUpperCase()}

// Returns an inline SVG human icon — no internet needed, works everywhere
function getDonorAvatar() {
  return `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="7" r="3.5" fill="rgba(255,255,255,0.95)"/>
    <path d="M5 20c0-3.866 3.134-7 7-7s7 3.134 7 7" stroke="rgba(255,255,255,0.95)" stroke-width="1.8" stroke-linecap="round" fill="none"/>
  </svg>`;
}
function closeModal(id){document.getElementById(id).classList.remove('open')}
function openModal(id){document.getElementById(id).classList.add('open')}
function isAdmin(){return currentUser?.role==='admin'}
