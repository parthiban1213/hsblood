// ══════════════════════════════════════════════════════════════
// HSBlood — js/donors.js
// Donor list, card/table view, CRUD operations
// ══════════════════════════════════════════════════════════════

// ── DONORS ─────────────────────────────────────────
async function loadDonors(){
  document.getElementById('donors-view').innerHTML='<div class="spinner"></div>';
  const res=await apiFetch('/donors');
  if(res.success){allDonors=res.data;renderDonors(allDonors);}
  else {
    document.getElementById('donors-view').innerHTML=
      `<div class="empty-state">
        <div class="emoji">⚠️</div>
        <h4>Failed to load donors</h4>
        <p>${res.error||'Could not connect to the server.'}</p>
        <button id="btn-donors-retry" class="btn btn-outline" style="margin-top:12px" onclick="loadDonors()">↻ Retry</button>
      </div>`;
    showToast(res.error||'Could not load donors. Please refresh and try again.','error');
  }
}

function filterDonors(){
  const search=document.getElementById('donor-search').value.toLowerCase();
  const blood=document.getElementById('filter-blood').value;
  const status=document.getElementById('filter-status').value;
  renderDonors(allDonors.filter(d=>{
    const nm=(d.firstName+' '+d.lastName+' '+(d.address||'')).toLowerCase().includes(search);
    const bt=!blood||d.bloodType===blood;
    const st=status===''||String(d.isAvailable)===status;
    return nm&&bt&&st;
  }));
}

function setView(v,btn){
  donorView=v;
  document.querySelectorAll('.view-toggle button').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');
  filterDonors();
}

function renderDonors(donors){
  const el=document.getElementById('donors-view');
  if(!donors.length){
    el.innerHTML='<div class="empty-state"><div class="emoji">👤</div><h4>No donors found</h4><p>Register a new donor or adjust filters.</p></div>';
    return;
  }

  // Action buttons differ by role
  const adminActions = (id, name) => `
    <button data-testid="donor-view-btn" data-id="${id}" class="btn btn-outline btn-sm" onclick="viewDonor('${id}')">👁 View</button>
    <button data-testid="donor-edit-btn" data-id="${id}" class="btn btn-outline btn-sm" onclick="editDonor('${id}')">✏️ Edit</button>
    <button data-testid="donor-delete-btn" data-id="${id}" class="btn btn-danger btn-sm" onclick="deleteDonor('${id}','${name}')">🗑</button>`;
  const userActions = (id) => `
    <button data-testid="donor-view-btn" data-id="${id}" class="btn btn-outline btn-sm" onclick="viewDonor('${id}')">👁 View</button>
    <span class="lock-badge" style="font-size:0.65rem">🔒 No edit/delete</span>`;

  if(donorView==='cards'){
    el.innerHTML=`<div class="donor-grid">${donors.map(d=>`
      <div data-testid="donor-card" data-id="${d._id}" class="donor-card">
        <div class="donor-card-top">
          <div style="display:flex;align-items:center;gap:10px">
            <div class="donor-avatar" data-initials="${getInitials(d.firstName,d.lastName)}">${getDonorAvatar()}</div>
            <div class="donor-card-name"><h4>${d.firstName} ${d.lastName}</h4><p>${d.address||d.email}</p></div>
          </div>
          <div class="donor-card-bt">${d.bloodType}</div>
        </div>
        <div class="donor-card-info">
          <div class="donor-info-item"><span>Phone</span>${d.phone}</div>
          <div class="donor-info-item"><span>Status</span><span class="status-dot ${d.isAvailable?'available':'unavailable'}">${d.isAvailable?'Available':'Unavailable'}</span></div>
          <div class="donor-info-item"><span>Last Donated</span>${formatDate(d.lastDonationDate)}</div>
        </div>
        <div class="donor-card-actions">
          ${isAdmin() ? adminActions(d._id, d.firstName+' '+d.lastName) : userActions(d._id)}
        </div>
      </div>`).join('')}</div>`;
  }else{
    el.innerHTML=`<div class="table-wrap"><table>
      <thead><tr><th>Name</th><th>Blood Type</th><th>Phone</th><th>Last Donation</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${donors.map(d=>`<tr data-testid="donor-row" data-id="${d._id}">
        <td class="bold">${d.firstName} ${d.lastName}</td>
        <td><span class="blood-badge">${d.bloodType}</span></td>
        <td>${d.phone}</td>
        <td>${formatDate(d.lastDonationDate)}</td>
        <td><span class="status-dot ${d.isAvailable?'available':'unavailable'}">${d.isAvailable?'Available':'Unavailable'}</span></td>
        <td style="display:flex;gap:4px;align-items:center">
          <button data-testid="donor-row-view-btn" data-id="${d._id}" class="btn btn-ghost btn-sm" onclick="viewDonor('${d._id}')">👁</button>
          ${isAdmin()?`
          <button data-testid="donor-row-edit-btn" data-id="${d._id}" class="btn btn-ghost btn-sm" onclick="editDonor('${d._id}')">✏️</button>
          <button data-testid="donor-row-delete-btn" data-id="${d._id}" class="btn btn-ghost btn-sm" style="color:#DC2626" onclick="deleteDonor('${d._id}','${d.firstName} ${d.lastName}')">🗑</button>`
          :`<span class="lock-badge">🔒</span>`}
        </td>
      </tr>`).join('')}</tbody></table></div>`;
  }
}

function openDonorModal(){
  document.getElementById('donor-id').value='';
  document.getElementById('donor-modal-title').textContent='Register Donor';
  document.getElementById('donor-form').reset();
  document.getElementById('d-available-true').checked = true;
  document.getElementById('d-available-false').checked = false;
  document.getElementById('donor-dup-warn').style.display='none';
  // Wire duplicate check on email blur (only once)
  const emailEl = document.getElementById('d-email');
  emailEl.onblur = checkDonorDuplicate;
  openModal('donor-modal');
}

async function saveDonor(e){
  if(e) e.preventDefault();
  const id=document.getElementById('donor-id').value;
  const btn=document.getElementById('save-donor-btn');
  btn.disabled=true; btn.textContent='Saving…';
  const body={
    firstName:       document.getElementById('d-firstName').value,
    lastName:        document.getElementById('d-lastName').value,
    phone:           document.getElementById('d-phone').value,
    email:           document.getElementById('d-email').value || undefined,
    address:         document.getElementById('d-address').value,
    city:'N/A', country:'N/A',
    bloodType:       document.getElementById('d-bloodType').value,
    lastDonationDate:document.getElementById('d-lastDonation').value||undefined,
    isAvailable:     document.querySelector('input[name="d-available"]:checked')?.value === 'true',
  };
  try {
    const res = id
      ? await apiFetch('/donors/'+id,{method:'PUT',body:JSON.stringify(body)})
      : await apiFetch('/donors',{method:'POST',body:JSON.stringify(body)});
    if(res.success){
      document.getElementById('donor-dup-warn').style.display='none';
      showToast(res.message||'Saved!');
      closeModal('donor-modal');
      if(document.getElementById('page-donors').style.display!=='none') loadDonors();
      loadDashboard();
    } else {
      if(res.status===409||res.error?.toLowerCase().includes('already exists')||res.error?.toLowerCase().includes('duplicate')){
        document.getElementById('donor-dup-msg').textContent=res.error||'A donor with this information already exists.';
        document.getElementById('donor-dup-warn').style.display='';
      }
      showToast(res.error||'Operation failed. Please try again.','error');
    }
  } catch(err) {
    showToast('Request failed. Please check your connection.','error');
  } finally {
    btn.disabled=false; btn.textContent='💾 Save Donor';
  }
}

async function editDonor(id){
  if(!isAdmin()){ showToast('Permission denied. Admin access required.','warn'); return; }
  const res=await apiFetch('/donors/'+id);
  if(!res.success){showToast(res.error||'Operation failed. Please try again.','error');return;}
  const d=res.data;
  document.getElementById('donor-id').value=d._id;
  document.getElementById('donor-modal-title').textContent='Edit Donor';
  document.getElementById('d-firstName').value=d.firstName||'';
  document.getElementById('d-lastName').value=d.lastName||'';
  document.getElementById('d-phone').value=d.phone||'';
  document.getElementById('d-email').value=d.email||'';
  document.getElementById('d-address').value=d.address||'';
  document.getElementById('d-bloodType').value=d.bloodType||'';
  document.getElementById('d-lastDonation').value=d.lastDonationDate?d.lastDonationDate.split('T')[0]:'';
  const availVal = String(d.isAvailable) === 'true';
  document.getElementById('d-available-true').checked  =  availVal;
  document.getElementById('d-available-false').checked = !availVal;
  openModal('donor-modal');
}

async function viewDonor(id){
  const res=await apiFetch('/donors/'+id);
  if(!res.success){showToast(res.error||'Operation failed. Please try again.','error');return;}
  const d=res.data;
  const fields=[
    ['First Name',d.firstName],['Last Name',d.lastName],
    ['Phone',d.phone],['Email',d.email||'—'],
    ['Address',d.address||'—'],['Blood Type',d.bloodType],
    ['Last Donation',formatDate(d.lastDonationDate)],['Registered',formatDate(d.createdAt)],
  ];
  document.getElementById('detail-content').innerHTML=`
    <div style="display:flex;align-items:center;gap:15px;margin-bottom:18px;padding:16px;background:var(--red-light);border-radius:12px;border:1px solid rgba(200,16,46,0.1)">
      <div class="donor-avatar" data-initials="${getInitials(d.firstName,d.lastName)}" style="width:54px;height:54px;border-radius:13px;flex-shrink:0">${getDonorAvatar()}</div>
      <div style="flex:1">
        <h2 style="font-family:var(--font-display);font-size:1.55rem;color:var(--text)">${d.firstName} ${d.lastName}</h2>
        <p style="color:var(--text2);font-size:0.82rem;margin-top:2px">${d.email}</p>
        <span class="status-dot ${d.isAvailable?'available':'unavailable'}" style="margin-top:5px;display:inline-flex">${d.isAvailable?'Available to donate':'Currently unavailable'}</span>
      </div>
      <div style="font-family:var(--font-display);font-size:2.5rem;font-weight:700;color:var(--red);line-height:1">${d.bloodType}</div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      ${fields.map(([k,v])=>`<div class="detail-field"><div class="dk">${k}</div><div class="dv">${v||'—'}</div></div>`).join('')}
    </div>
    <div style="margin-top:16px;display:flex;gap:8px;justify-content:flex-end">
      ${isAdmin()?`
      <button data-testid="donor-detail-edit-btn" data-id="${d._id}" class="btn btn-outline" onclick="closeModal('detail-modal');editDonor('${d._id}')">✏️ Edit</button>
      <button data-testid="donor-detail-delete-btn" data-id="${d._id}" class="btn btn-danger" onclick="closeModal('detail-modal');deleteDonor('${d._id}','${d.firstName} ${d.lastName}')">🗑 Delete</button>`
      :`<span class="lock-badge">🔒 View only — editing requires Admin access</span>`}
    </div>`;
  openModal('detail-modal');
}
