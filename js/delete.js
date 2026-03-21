// ══════════════════════════════════════════════════════════════
// HSBlood — js/delete.js
// Shared delete confirmation modal
// ══════════════════════════════════════════════════════════════

// ── DELETE CONFIRM MODAL ───────────────────────────
let _deleteCallback = null;

function showDeleteConfirm(title, body, onConfirm) {
  _deleteCallback = onConfirm;
  document.getElementById('delete-modal-title').textContent = title;
  document.getElementById('delete-modal-body').textContent = body;
  document.getElementById('delete-confirm-modal').classList.add('open');
}

function cancelDelete() {
  _deleteCallback = null;
  document.getElementById('delete-confirm-modal').classList.remove('open');
}

function confirmDelete() {
  document.getElementById('delete-confirm-modal').classList.remove('open');
  if (_deleteCallback) { _deleteCallback(); _deleteCallback = null; }
}

async function deleteDonor(id,name){
  if(!isAdmin()){ showToast('Permission denied. Admin access required.','warn'); return; }
  showDeleteConfirm(
    'Remove Donor',
    `Remove "${name}" from the registry? This action cannot be undone.`,
    async () => {
      const res=await apiFetch('/donors/'+id,{method:'DELETE'});
      if(res.success){showToast(res.message);loadDonors();loadDashboard();}
      else showToast(res.error,'error');
    }
  );
}

// ── BLOOD TYPES ────────────────────────────────────
