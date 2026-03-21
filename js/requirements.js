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
    el.innerHTML=`<div class="empty-state"><div class="emoji">📋</div><h4>No requirements found</h4><p>No blood requirements match your filters.</p></div>`;
    return;
  }
  el.innerHTML=`<div class="table-wrap"><table>
    <thead><tr>
      <th>Patient</th><th>Hospital</th><th>Blood Type</th><th>Units</th>
      <th>Urgency</th><th>Required By</th><th>Status</th><th>Actions</th>
    </tr></thead>
    <tbody>${data.map(r=>`<tr data-testid="req-row" data-id="${r._id}">
      <td class="bold">${r.patientName}</td>
      <td>${r.hospital}</td>
      <td><span class="blood-badge">${r.bloodType}</span></td>
      <td style="font-family:var(--font-ui);font-weight:700;color:var(--text)">${r.unitsRequired}</td>
      <td><span class="urgency-badge urgency-${r.urgency}">${URGENCY_ICON[r.urgency]||''} ${r.urgency}</span></td>
      <td>${formatDate(r.requiredBy)}</td>
      <td>
        ${isAdmin()
          ? `<select data-testid="req-status-select" data-id="${r._id}" class="req-status-select s-${r.status}"
               onchange="quickUpdateStatus('${r._id}', this)"
               title="Click to change status">
               <option value="Open"      ${r.status==='Open'      ?'selected':''}>Open</option>
               <option value="Fulfilled" ${r.status==='Fulfilled' ?'selected':''}>Fulfilled</option>
               <option value="Cancelled" ${r.status==='Cancelled' ?'selected':''}>Cancelled</option>
             </select>`
          : `<span class="req-status-badge req-status-${r.status}">${r.status}</span>`
        }
      </td>
      <td>
        <div style="display:flex;gap:5px;align-items:center">
          <button data-testid="req-view-btn" data-id="${r._id}" class="btn btn-outline btn-sm" onclick="viewRequirement('${r._id}')" title="View details">👁</button>
          ${isAdmin()?`<button data-testid="req-edit-btn" data-id="${r._id}" class="btn btn-outline btn-sm" onclick="editRequirement('${r._id}')" title="Edit full requirement">✏️</button>
          <button data-testid="req-delete-btn" data-id="${r._id}" class="btn btn-danger btn-sm" onclick="deleteRequirement('${r._id}','${r.patientName}')" title="Delete">🗑</button>`:''}
        </div>
      </td>
    </tr>`).join('')}</tbody></table></div>`;
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
  if(!isAdmin()){ showToast('Admin access required.','warn'); return; }
  const res=await apiFetch('/requirements/'+id);
  if(!res.success){showToast(res.error||'Operation failed. Please try again.','error');return;}
  const r=res.data;
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
  // Users can add but not edit existing requirements
  if(id && !isAdmin()){ showToast('Editing requirements requires Admin access.','warn'); return; }
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
  try {
    const res = id
      ? await apiFetch('/requirements/'+id,{method:'PUT',body:JSON.stringify(body)})
      : await apiFetch('/requirements',{method:'POST',body:JSON.stringify(body)});
    if(res.success){
      document.getElementById('req-dup-warn').style.display='none';
      showToast(res.message||'Saved!');
      closeModal('req-modal');
      loadRequirements();
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
  const res=await apiFetch('/requirements/'+id);
  if(!res.success){showToast(res.error||'Operation failed. Please try again.','error');return;}
  const r=res.data;
  document.getElementById('req-detail-content').innerHTML=`
    <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:18px;padding:16px;background:var(--red-light);border-radius:12px;border:1px solid rgba(200,16,46,0.1)">
      <div style="flex:1">
        <h2 style="font-family:var(--font-display);font-size:1.45rem;color:var(--text)">${r.patientName}</h2>
        <p style="color:var(--text2);font-size:0.82rem;margin-top:3px">🏥 ${r.hospital}</p>
        ${r.location?`<p style="color:var(--text2);font-size:0.82rem;margin-top:2px">📍 ${r.location}</p>`:''}
        <div style="display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;align-items:center">
          <span class="urgency-badge urgency-${r.urgency}">${URGENCY_ICON[r.urgency]} ${r.urgency}</span>
          ${isAdmin()
            ? `<div style="display:flex;gap:5px;flex-wrap:wrap">
                ${['Open','Fulfilled','Cancelled'].map(s=>`
                  <button
                    data-testid="req-quick-status-btn" data-id="${r._id}" data-status="${s}"
                    class="btn btn-sm"
                    style="padding:3px 10px;font-size:0.7rem;${r.status===s
                      ? s==='Open'      ? 'background:#EFF6FF;color:#2563EB;border:1.5px solid #BFDBFE;'
                      : s==='Fulfilled' ? 'background:#F0FDF4;color:#15803D;border:1.5px solid #BBF7D0;'
                      :                  'background:#F8FAFC;color:#94A3B8;border:1.5px solid #E2E8F0;'
                      : 'background:#fff;color:var(--text3);border:1.5px solid var(--border);'}"
                    onclick="quickUpdateStatusFromModal('${r._id}','${s}',this)"
                    ${r.status===s ? 'disabled' : ''}
                  >${s==='Open'?'🔵':s==='Fulfilled'?'✅':'❌'} ${s}</button>
                `).join('')}
               </div>`
            : `<span class="req-status-badge req-status-${r.status}">${r.status}</span>`
          }
        </div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-family:var(--font-display);font-size:2.5rem;font-weight:700;color:var(--red);line-height:1">${r.bloodType}</div>
        <div style="font-family:var(--font-ui);font-size:0.75rem;color:var(--text2);margin-top:3px">${r.unitsRequired} unit${r.unitsRequired!==1?'s':''} needed</div>
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">
      <div class="detail-field"><div class="dk">Contact Person</div><div class="dv">${r.contactPerson}</div></div>
      <div class="detail-field"><div class="dk">Phone</div><div class="dv">${r.contactPhone}</div></div>
      ${r.location?`<div class="detail-field"><div class="dk">Location</div><div class="dv">📍 ${r.location}</div></div>`:''}
      <div class="detail-field"><div class="dk">Required By</div><div class="dv">${formatDate(r.requiredBy)}</div></div>
      <div class="detail-field"><div class="dk">Created By</div><div class="dv">${r.createdBy||'—'}</div></div>
      <div class="detail-field"><div class="dk">Created On</div><div class="dv">${formatDate(r.createdAt)}</div></div>
      <div class="detail-field"><div class="dk">Last Updated</div><div class="dv">${formatDate(r.updatedAt)}</div></div>
      ${r.notes?`<div class="detail-field" style="grid-column:1/-1"><div class="dk">Notes</div><div class="dv">${r.notes}</div></div>`:''}
    </div>
    <div style="margin-top:6px;display:flex;gap:8px;justify-content:flex-end">
      ${isAdmin()?`
      <button data-testid="req-detail-edit-btn" data-id="${r._id}" class="btn btn-outline" onclick="closeModal('req-detail-modal');editRequirement('${r._id}')">✏️ Edit</button>
      <button data-testid="req-detail-delete-btn" data-id="${r._id}" class="btn btn-danger" onclick="closeModal('req-detail-modal');deleteRequirement('${r._id}','${r.patientName}')">🗑 Delete</button>`
      :`<span class="lock-badge">🔒 View only — editing requires Admin access</span>`}
    </div>`;
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
