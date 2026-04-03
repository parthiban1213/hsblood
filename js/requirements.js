// ══════════════════════════════════════════════════════════════
// HSBlood — js/requirements.js
// Blood requirements list, CRUD, quick status update
// ══════════════════════════════════════════════════════════════

// ── BLOOD REQUIREMENTS ─────────────────────────────
let allRequirements = [];

async function loadRequirements(){
  document.getElementById('req-view').innerHTML='<div class="spinner"></div>';
  const res = await apiFetch('/requirements');
  if(!res.success){
    document.getElementById('req-view').innerHTML=
      `<div class="empty-state">
        <div class="emoji">⚠️</div>
        <h4>Failed to load requirements</h4>
        <p>${res.error||'Could not connect to the server.'}</p>
        <button id="btn-requirements-retry" class="btn btn-outline" style="margin-top:12px" onclick="loadRequirements()">↻ Retry</button>
      </div>`;
    return;
  }
  allRequirements = res.data;
  renderRequirementStats(allRequirements);
  renderRequirements(allRequirements);
}

function renderRequirementStats(data){
  const open       = data.filter(r=>r.status==='Open').length;
  const critical   = data.filter(r=>r.urgency==='Critical'&&r.status==='Open').length;
  const fulfilled  = data.filter(r=>r.status==='Fulfilled').length;
  const total      = data.length;
  document.getElementById('req-summary-stats').innerHTML=`
    <div class="dash-stat highlight"><div class="label">Open</div><div class="value">${open}</div><div class="sub">Active requests</div></div>
    <div class="dash-stat"><div class="label" style="color:#DC2626">Critical</div><div class="value" style="color:#DC2626">${critical}</div><div class="sub">Needs immediate action</div></div>
    <div class="dash-stat"><div class="label">Fulfilled</div><div class="value">${fulfilled}</div><div class="sub">Completed</div></div>
    <div class="dash-stat"><div class="label">Total</div><div class="value">${total}</div><div class="sub">All time</div></div>`;
}

function filterRequirements(){
  const q    = document.getElementById('req-search').value.toLowerCase();
  const bt   = document.getElementById('req-filter-blood').value;
  const st   = document.getElementById('req-filter-status').value;
  const urg  = document.getElementById('req-filter-urgency').value;
  const filtered = allRequirements.filter(r=>{
    if(bt  && r.bloodType !== bt)   return false;
    if(st  && r.status    !== st)   return false;
    if(urg && r.urgency   !== urg)  return false;
    if(q   && !(r.patientName.toLowerCase().includes(q)||r.hospital.toLowerCase().includes(q)||r.contactPerson.toLowerCase().includes(q))) return false;
    return true;
  });
  renderRequirements(filtered);
}

const URGENCY_ICON = {Critical:'🔴',High:'🟠',Medium:'🟡',Low:'🟢'};

function renderRequirements(data){
  const el = document.getElementById('req-view');
  if(!data.length){
    el.innerHTML = '<div class="empty-state"><div class="emoji">📋</div><h4>No requirements found</h4><p>No blood requirements match your filters.</p></div>';
    return;
  }

  function esc(s){ return String(s).replace(/'/g, "\\'"); }

  const rows = data.map(function(r){
    const donated   = (r.donations || []).length;
    const total     = r.unitsRequired;
    const remaining = (r.remainingUnits != null) ? r.remainingUnits : total;
    const pct       = total > 0 ? Math.round((donated / total) * 100) : 0;
    const id        = r._id;

    const selOpts = ['Open','Fulfilled','Cancelled'].map(function(s){
      return '<option value="' + s + '"' + (r.status===s?' selected':'') + '>' + s + '</option>';
    }).join('');

    const statusCell = isAdmin()
      ? '<select data-testid="req-status-select" data-id="' + id + '" class="req-status-select s-' + r.status + '" onchange="quickUpdateStatus(\'' + id + '\', this)" title="Click to change status">' + selOpts + '</select>'
      : '<span class="req-status-badge req-status-' + r.status + '">' + r.status + '</span>';

    const statusBtn = r.status === 'Open'
      ? '<button class="btn btn-outline btn-sm" onclick="openStatusPopup(\'' + id + '\')" title="View status">📊</button>'
      : '';

    const canEdit = isAdmin() || r.createdBy === currentUser?.username;

    const adminBtns = canEdit
      ? '<button data-testid="req-edit-btn" class="btn btn-outline btn-sm" onclick="editRequirement(\'' + id + '\')" title="Edit">✏️</button>'
        + (isAdmin() ? '<button data-testid="req-delete-btn" class="btn btn-danger btn-sm" onclick="deleteRequirement(\'' + id + '\',\'' + esc(r.patientName) + '\')" title="Delete">🗑</button>' : '')
      : '';

    return '<tr data-testid="req-row" data-id="' + id + '">'
      + '<td class="bold">' + r.patientName + '</td>'
      + '<td>' + r.hospital + '</td>'
      + '<td><span class="blood-badge">' + r.bloodType + '</span></td>'
      + '<td style="font-family:var(--font-ui);font-weight:700;color:var(--text)">' + total + '</td>'
      + '<td style="min-width:100px">'
        + '<div class="prog-wrap"><div class="prog-bar" style="width:' + pct + '%"></div></div>'
        + '<div style="font-size:0.66rem;color:var(--text3);margin-top:2px;font-family:var(--font-ui)">' + donated + '/' + total + ' donated</div>'
      + '</td>'
      + '<td><span class="urgency-badge urgency-' + r.urgency + '">' + (URGENCY_ICON[r.urgency]||'') + ' ' + r.urgency + '</span></td>'
      + '<td>' + formatDate(r.requiredBy) + '</td>'
      + '<td>' + statusCell + '</td>'
      + '<td><div style="display:flex;gap:5px;align-items:center">'
        + statusBtn
        + '<button data-testid="req-view-btn" class="btn btn-outline btn-sm" onclick="viewRequirement(\'' + id + '\')" title="View details">👁</button>'
        + adminBtns
      + '</div></td>'
      + '</tr>';
  }).join('');

  el.innerHTML = '<div class="table-wrap"><table>'
    + '<thead><tr>'
    + '<th>Patient</th><th>Hospital</th><th>Blood Type</th><th>Units</th><th>Progress</th>'
    + '<th>Urgency</th><th>Required By</th><th>Status</th><th>Actions</th>'
    + '</tr></thead>'
    + '<tbody>' + rows + '</tbody>'
    + '</table></div>';
}

function openReqModal(){
  document.getElementById('req-id').value='';
  document.getElementById('req-modal-title').textContent='New Blood Requirement';
  document.getElementById('req-form').reset();
  document.getElementById('req-urgency').value='Medium';
  document.getElementById('req-status').value='Open';
  document.getElementById('req-dup-warn').style.display='none';
  // Wire duplicate checks on blur
  document.getElementById('req-patientName').onblur = checkReqDuplicate;
  document.getElementById('req-hospital').onblur    = checkReqDuplicate;
  document.getElementById('req-bloodType').onchange = checkReqDuplicate;
  openModal('req-modal');
}

async function editRequirement(id){
  const res=await apiFetch('/requirements/'+id);
  if(!res.success){showToast(res.error||'Operation failed.','error');return;}
  const r=res.data;
  const canEdit = isAdmin() || r.createdBy === currentUser?.username;
  if(!canEdit){ showToast('You can only edit requirements you created.','warn'); return; }
  document.getElementById('req-id').value=r._id;
  document.getElementById('req-modal-title').textContent='Edit Blood Requirement';
  document.getElementById('req-patientName').value=r.patientName||'';
  document.getElementById('req-hospital').value=r.hospital||'';
  document.getElementById('req-location').value=r.location||'';
  document.getElementById('req-contactPerson').value=r.contactPerson||'';
  document.getElementById('req-contactPhone').value=r.contactPhone||'';
  document.getElementById('req-bloodType').value=r.bloodType||'';
  document.getElementById('req-units').value=r.unitsRequired||1;
  document.getElementById('req-urgency').value=r.urgency||'Medium';
  document.getElementById('req-requiredBy').value=r.requiredBy?r.requiredBy.split('T')[0]:'';
  document.getElementById('req-status').value=r.status||'Open';
  document.getElementById('req-notes').value=r.notes||'';
  openModal('req-modal');
}

async function saveRequirement(e){
  if(e) e.preventDefault();
  const id=document.getElementById('req-id').value;
  const btn=document.getElementById('save-req-btn');
  btn.disabled=true; btn.textContent='Saving…';
  const body={
    patientName:   document.getElementById('req-patientName').value,
    hospital:      document.getElementById('req-hospital').value,
    location:      document.getElementById('req-location').value,
    contactPerson: document.getElementById('req-contactPerson').value,
    contactPhone:  document.getElementById('req-contactPhone').value,
    bloodType:     document.getElementById('req-bloodType').value,
    unitsRequired: parseInt(document.getElementById('req-units').value,10),
    urgency:       document.getElementById('req-urgency').value,
    requiredBy:    document.getElementById('req-requiredBy').value||undefined,
    status:        document.getElementById('req-status').value,
    notes:         document.getElementById('req-notes').value,
  };
  // Initialise remainingUnits for new requirements so progress tracking works from day 1
  if (!id) body.remainingUnits = body.unitsRequired;
  try {
    const res = id
      ? await apiFetch('/requirements/'+id,{method:'PUT',body:JSON.stringify(body)})
      : await apiFetch('/requirements',{method:'POST',body:JSON.stringify(body)});
    if(res.success){
      document.getElementById('req-dup-warn').style.display='none';
      showToast(res.message||'Saved!');
      closeModal('req-modal');
      loadRequirements();
      // Also refresh My Requests page if it's loaded
      if (typeof loadMyRequests === 'function') loadMyRequests();
      // For new requirements, refresh notifications immediately — the backend
      // now awaits notification creation before responding, so a short delay
      // is enough to guarantee the new notifications are in the DB.
      if (!id && typeof fetchNotifications === 'function') {
        setTimeout(fetchNotifications, 300);
      }
    } else {
      if(res.status===409||res.error?.toLowerCase().includes('already exists')||res.error?.toLowerCase().includes('duplicate')){
        document.getElementById('req-dup-msg').textContent=res.error||'A requirement with this information already exists.';
        document.getElementById('req-dup-warn').style.display='';
      }
      showToast(res.error||'Operation failed. Please try again.','error');
    }
  } catch(err) {
    showToast('Request failed. Please check your connection.','error');
  } finally {
    btn.disabled=false; btn.textContent='💾 Save Requirement';
  }
}

async function viewRequirement(id){
  const res = await apiFetch('/requirements/'+id);
  if(!res.success){ showToast(res.error||'Operation failed.','error'); return; }
  const r = res.data;
  const donated   = (r.donations||[]).length;
  const total     = r.unitsRequired;
  const remaining = (r.remainingUnits!=null) ? r.remainingUnits : total;
  const pct       = total>0 ? Math.round((donated/total)*100) : 0;
  const barColor  = pct===100 ? '#15803D' : 'var(--red)';
  const q = function(s){ return String(s||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'"); };

  // Admin: fetch donor list
  var donorListHtml = '';
  if(isAdmin()){
    const dRes = await apiFetch('/requirements/'+id+'/donors');
    if(dRes.success && dRes.data.length){
      const donorRows = dRes.data.map(function(d){
        const initial = (d.donorName||d.donorUsername||'?')[0].toUpperCase();
        return '<div style="display:flex;align-items:center;justify-content:space-between;padding:9px 13px;background:var(--surface);border-radius:9px;border:1px solid var(--border);margin-bottom:7px">'
          +'<div style="display:flex;align-items:center;gap:10px">'
          +'<div style="width:32px;height:32px;border-radius:9px;background:var(--red-light);display:flex;align-items:center;justify-content:center;font-weight:700;color:var(--red);font-size:0.82rem;font-family:var(--font-ui);flex-shrink:0">'+initial+'</div>'
          +'<div><div style="font-size:0.84rem;font-weight:600;color:var(--text)">'+(d.donorName||d.donorUsername)+'</div>'
          +'<div style="font-size:0.72rem;color:var(--text3)">@'+d.donorUsername+'</div></div>'
          +'</div>'
          +'<div style="text-align:right;flex-shrink:0">'
          +'<span class="blood-badge" style="font-size:0.68rem">'+(d.bloodType||'—')+'</span>'
          +'<div style="font-size:0.7rem;color:var(--text3);margin-top:3px">'+formatDate(d.donatedAt)+'</div>'
          +'</div></div>';
      }).join('');
      donorListHtml = '<div style="margin-top:16px;border-top:1px solid var(--border);padding-top:14px">'
        +'<div style="font-size:0.75rem;font-weight:700;color:var(--text2);margin-bottom:10px;text-transform:uppercase;letter-spacing:0.06em">🩸 Donors Who Responded ('+dRes.data.length+')</div>'
        +donorRows+'</div>';
    } else if(dRes.success){
      donorListHtml = '<div style="margin-top:14px;border-top:1px solid var(--border);padding-top:12px;font-size:0.8rem;color:var(--text3)">No donors have responded yet.</div>';
    }
  }

  // Status buttons for admin
  const statusBtns = ['Open','Fulfilled','Cancelled'].map(function(s){
    const active = r.status===s;
    const col = active
      ? (s==='Open'?'background:#EFF6FF;color:#2563EB;border:1.5px solid #BFDBFE;'
        :s==='Fulfilled'?'background:#F0FDF4;color:#15803D;border:1.5px solid #BBF7D0;'
        :'background:#F8FAFC;color:#94A3B8;border:1.5px solid #E2E8F0;')
      : 'background:#fff;color:var(--text3);border:1.5px solid var(--border);';
    const icon = s==='Open'?'🔵':s==='Fulfilled'?'✅':'❌';
    return '<button class="btn btn-sm" style="padding:3px 10px;font-size:0.7rem;'+col+'"'
      +' onclick="quickUpdateStatusFromModal(\'' + r._id + '\',\'' + s + '\',this)"'
      +(active?' disabled':'')+'>'+icon+' '+s+'</button>';
  }).join('');

  const statusWidget = isAdmin()
    ? '<div style="display:flex;gap:5px;flex-wrap:wrap">'+statusBtns+'</div>'
    : '<span class="req-status-badge req-status-'+r.status+'">'+r.status+'</span>';

  const canEdit = isAdmin() || r.createdBy === currentUser?.username;

  const editDeleteBtns = canEdit
    ? '<button class="btn btn-outline" onclick="closeModal(\'req-detail-modal\');editRequirement(\''+r._id+'\')">✏️ Edit</button>'
      + (isAdmin() ? '<button class="btn btn-danger" onclick="closeModal(\'req-detail-modal\');deleteRequirement(\''+r._id+'\',\''+q(r.patientName)+'\')">🗑 Delete</button>' : '')
    : '<span class="lock-badge">🔒 View only</span>';

  // 90-day eligibility for non-admin users
  var userDonateBtn = '';
  if (!isAdmin() && r.status === 'Open') {
    const userBT = currentUser?.bloodType || '';
    const isMatch = userBT && r.bloodType === userBT;
    if (isMatch) {
      const alreadyDonated  = (r.donations || []).some(function(d){ return d.donorUsername === currentUser?.username; });
      const alreadyDeclined = (r.declines  || []).some(function(d){ return d.donorUsername === currentUser?.username; });
      const _lastDon = currentUser?.lastDonationDate ? new Date(currentUser.lastDonationDate) : null;
      const _daysSinceD = _lastDon ? Math.floor((Date.now() - _lastDon.getTime()) / 86400000) : 999;
      const _notElig = _daysSinceD < 90;
      const _nextEligD = _lastDon ? new Date(_lastDon.getTime() + 90 * 86400000) : null;
      if (alreadyDonated) {
        userDonateBtn = '<span class="respond-done-badge">✅ You responded</span>';
      } else if (alreadyDeclined) {
        userDonateBtn = '<span class="respond-declined-badge">❌ You declined</span>';
      } else if (_notElig) {
        userDonateBtn = '<button class="btn btn-sm" style="background:#F3F4F6;color:#9CA3AF;border:1.5px solid #E5E7EB;cursor:not-allowed;font-size:0.82rem;font-weight:600;padding:8px 18px;border-radius:8px;pointer-events:none" disabled>🚫 Not Eligible</button>';
      } else {
        userDonateBtn = '<button class="btn btn-primary" onclick="closeModal(\'req-detail-modal\');respondToDonate(\''+r._id+'\',\''+q(r.patientName)+'\',\''+r.bloodType+'\')">🩸 I\'ll Donate</button>';
      }
    }
  }

  const locationLine  = r.location ? '<p style="color:var(--text2);font-size:0.82rem;margin-top:2px">📍 '+r.location+'</p>' : '';
  const locationField = r.location ? '<div class="detail-field"><div class="dk">Location</div><div class="dv">📍 '+r.location+'</div></div>' : '';
  const notesField    = r.notes    ? '<div class="detail-field" style="grid-column:1/-1"><div class="dk">Notes</div><div class="dv">'+r.notes+'</div></div>' : '';

  document.getElementById('req-detail-content').innerHTML =
    '<div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:16px;padding:16px;background:var(--red-light);border-radius:12px;border:1px solid rgba(200,16,46,0.1)">'
      +'<div style="flex:1">'
        +'<h2 style="font-family:var(--font-display);font-size:1.45rem;color:var(--text)">'+r.patientName+'</h2>'
        +'<p style="color:var(--text2);font-size:0.82rem;margin-top:3px">🏥 '+r.hospital+'</p>'
        +locationLine
        +'<div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;align-items:center">'
          +'<span class="urgency-badge urgency-'+r.urgency+'">'+(URGENCY_ICON[r.urgency]||'')+' '+r.urgency+'</span>'
          +statusWidget
        +'</div>'
      +'</div>'
      +'<div style="text-align:right;flex-shrink:0">'
        +'<div style="font-family:var(--font-display);font-size:2.5rem;font-weight:700;color:var(--red);line-height:1">'+r.bloodType+'</div>'
        +'<div style="font-family:var(--font-ui);font-size:0.75rem;color:var(--text2);margin-top:3px">'+r.unitsRequired+' unit'+(r.unitsRequired!==1?'s':'')+' needed</div>'
      +'</div>'
    +'</div>'
    +'<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px">'
      +'<div class="status-stat-card"><div class="status-stat-val" style="color:var(--red)">'+total+'</div><div class="status-stat-label">Required</div></div>'
      +'<div class="status-stat-card"><div class="status-stat-val" style="color:#15803D">'+donated+'</div><div class="status-stat-label">Donated</div></div>'
      +'<div class="status-stat-card"><div class="status-stat-val" style="color:#D97706">'+remaining+'</div><div class="status-stat-label">Remaining</div></div>'
    +'</div>'
    +'<div style="margin-bottom:14px">'
      +'<div style="display:flex;justify-content:space-between;font-size:0.75rem;color:var(--text3);margin-bottom:5px">'
        +'<span>Fulfillment progress</span><span style="font-weight:700;color:var(--text)">'+pct+'%</span>'
      +'</div>'
      +'<div style="height:9px;background:var(--border);border-radius:99px;overflow:hidden">'
        +'<div style="height:100%;width:'+pct+'%;background:'+barColor+';border-radius:99px;transition:width 0.6s ease"></div>'
      +'</div>'
    +'</div>'
    +'<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">'
      +'<div class="detail-field"><div class="dk">Contact Person</div><div class="dv">'+r.contactPerson+'</div></div>'
      +'<div class="detail-field"><div class="dk">Phone</div><div class="dv">'+r.contactPhone+'</div></div>'
      +locationField
      +'<div class="detail-field"><div class="dk">Required By</div><div class="dv">'+formatDate(r.requiredBy)+'</div></div>'
      +'<div class="detail-field"><div class="dk">Created By</div><div class="dv">'+(r.createdBy||'—')+'</div></div>'
      +'<div class="detail-field"><div class="dk">Created On</div><div class="dv">'+formatDate(r.createdAt)+'</div></div>'
      +'<div class="detail-field"><div class="dk">Last Updated</div><div class="dv">'+formatDate(r.updatedAt)+'</div></div>'
      +notesField
    +'</div>'
    +donorListHtml
    +'<div style="margin-top:14px;display:flex;gap:8px;justify-content:flex-end;align-items:center;flex-wrap:wrap">'+userDonateBtn+editDeleteBtns+'</div>';

  openModal('req-detail-modal');
}

// ── QUICK STATUS UPDATE ────────────────────────────
async function quickUpdateStatus(id, selectEl) {
  const newStatus = selectEl.value;
  // Update the select styling immediately (optimistic UI)
  selectEl.className = 'req-status-select s-' + newStatus;
  const res = await apiFetch('/requirements/' + id, {
    method: 'PUT',
    body: JSON.stringify({ status: newStatus })
  });
  if (res.success) {
    showToast('Status updated to ' + newStatus + '!', 'success');
    // Update local cache without full reload for snappier UX
    const req = allRequirements.find(r => r._id === id);
    if (req) req.status = newStatus;
    renderRequirementStats(allRequirements);
    loadDashboard(); // refresh benefitted count if status changed to Fulfilled
  } else {
    showToast(res.error || 'Could not update the status. Please try again.', 'error');
    // Revert the select on failure
    const req = allRequirements.find(r => r._id === id);
    if (req) { selectEl.value = req.status; selectEl.className = 'req-status-select s-' + req.status; }
  }
}

async function quickUpdateStatusFromModal(id, newStatus, btnEl) {
  const res = await apiFetch('/requirements/' + id, {
    method: 'PUT',
    body: JSON.stringify({ status: newStatus })
  });
  if (res.success) {
    showToast('Status updated to ' + newStatus + '!', 'success');
    loadDashboard();
    loadRequirements();
    closeModal('req-detail-modal');
  } else {
    showToast(res.error || 'Could not update the status. Please try again.', 'error');
  }
}

async function deleteRequirement(id,name){
  if(!isAdmin()){ showToast('Admin access required.','warn'); return; }
  showDeleteConfirm(
    'Delete Requirement',
    `Delete blood requirement for "${name}"? This action cannot be undone.`,
    async () => {
      const res=await apiFetch('/requirements/'+id,{method:'DELETE'});
      if(res.success){showToast(res.message);loadRequirements();}
      else showToast(res.error||'Operation failed. Please try again.','error');
    }
  );
}
