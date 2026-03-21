// ══════════════════════════════════════════════════════════════
// HSBlood — js/duplicates.js
// Live duplicate detection on all forms
// ══════════════════════════════════════════════════════════════

// ── DUPLICATE PRE-CHECK HELPERS (live blur checks) ──

async function checkDonorDuplicate() {
  const id    = document.getElementById('donor-id').value;
  if (id) return; // editing — skip
  const email = document.getElementById('d-email').value.trim().toLowerCase();
  if (!email) return;
  const warn = document.getElementById('donor-dup-warn');
  const msg  = document.getElementById('donor-dup-msg');
  const res  = await apiFetch('/donors?email=' + encodeURIComponent(email));
  if (res.success && res.data && res.data.length > 0) {
    const d = res.data[0];
    msg.textContent = `A donor with this email already exists: ${d.firstName} ${d.lastName} (${d.bloodType}, ${d.email}).`;
    warn.style.display = '';
  } else {
    warn.style.display = 'none';
  }
}

async function checkReqDuplicate() {
  const id          = document.getElementById('req-id').value;
  if (id) return; // editing — skip
  const patientName = document.getElementById('req-patientName').value.trim();
  const hospital    = document.getElementById('req-hospital').value.trim();
  const bloodType   = document.getElementById('req-bloodType').value;
  if (!patientName || !hospital || !bloodType) return;
  const warn = document.getElementById('req-dup-warn');
  const msg  = document.getElementById('req-dup-msg');
  const res  = await apiFetch('/requirements?status=Open');
  if (res.success && res.data) {
    const dup = res.data.find(r =>
      r.patientName.toLowerCase() === patientName.toLowerCase() &&
      r.hospital.toLowerCase()    === hospital.toLowerCase()    &&
      r.bloodType                 === bloodType
    );
    if (dup) {
      msg.textContent = `An open requirement already exists for "${dup.patientName}" at "${dup.hospital}" needing ${dup.bloodType} blood (created ${formatDate(dup.createdAt)}).`;
      warn.style.display = '';
    } else {
      warn.style.display = 'none';
    }
  }
}

async function checkInfoDuplicate() {
  const id    = document.getElementById('info-id').value;
  if (id) return; // editing — skip
  const name  = document.getElementById('info-name').value.trim().toLowerCase();
  const phone = document.getElementById('info-phone').value.trim();
  if (!name || !phone) return;
  const warn = document.getElementById('info-dup-warn');
  const msg  = document.getElementById('info-dup-msg');
  const res  = await apiFetch('/info');
  if (res.success && res.data) {
    const dup = res.data.find(e =>
      e.name.toLowerCase()  === name  &&
      e.phone.replace(/\s+/g,'') === phone.replace(/\s+/g,'')
    );
    if (dup) {
      msg.textContent = `"${dup.name}" with phone "${dup.phone}" already exists in the ${dup.category} directory.`;
      warn.style.display = '';
    } else {
      warn.style.display = 'none';
    }
  }
}
