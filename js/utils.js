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
function getDonorAvatar(gender) {
  // Female icon — person with longer hair
  const femaleSvg = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="7" r="3.5" fill="rgba(255,255,255,0.95)"/>
    <path d="M5 20c0-3.866 3.134-7 7-7s7 3.134 7 7" stroke="rgba(255,255,255,0.95)" stroke-width="1.8" stroke-linecap="round" fill="none"/>
    <path d="M9 5.5c0-1.657 1.343-3 3-3s3 1.343 3 3" stroke="rgba(255,255,255,0.7)" stroke-width="1.2" stroke-linecap="round" fill="none"/>
    <path d="M8.5 6c-.5 1-.5 2 0 3" stroke="rgba(255,255,255,0.7)" stroke-width="1.2" stroke-linecap="round" fill="none"/>
    <path d="M15.5 6c.5 1 .5 2 0 3" stroke="rgba(255,255,255,0.7)" stroke-width="1.2" stroke-linecap="round" fill="none"/>
  </svg>`;

  // Male icon — standard person
  const maleSvg = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="7" r="3.5" fill="rgba(255,255,255,0.95)"/>
    <path d="M5 20c0-3.866 3.134-7 7-7s7 3.134 7 7" stroke="rgba(255,255,255,0.95)" stroke-width="1.8" stroke-linecap="round" fill="none"/>
    <path d="M10 5h4" stroke="rgba(255,255,255,0.7)" stroke-width="1.2" stroke-linecap="round"/>
  </svg>`;

  // Neutral icon — generic person
  const neutralSvg = `<svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="12" cy="7" r="3.5" fill="rgba(255,255,255,0.95)"/>
    <path d="M5 20c0-3.866 3.134-7 7-7s7 3.134 7 7" stroke="rgba(255,255,255,0.95)" stroke-width="1.8" stroke-linecap="round" fill="none"/>
  </svg>`;

  if (gender === 'Female') return femaleSvg;
  if (gender === 'Male')   return maleSvg;
  return neutralSvg;
}
function closeModal(id){document.getElementById(id).classList.remove('open')}
function openModal(id){document.getElementById(id).classList.add('open')}
function isAdmin(){return currentUser?.role==='admin'}
