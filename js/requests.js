// ══════════════════════════════════════════════════════════════
// HSBlood — js/requests.js
// My Requests screen + Requirement Status Popup + Donor Respond
// ══════════════════════════════════════════════════════════════

// ── RESPOND BADGE — call any time to refresh the sidebar count ─
async function updateRespondBadge() {
  const badge = document.getElementById('respond-nav-badge');
  if (!badge) return;
  const userBT   = currentUser?.bloodType || '';
  const username = currentUser?.username  || '';
  const res = await apiFetch('/requirements?status=Open');
  if (!res.success) return;
  let reqs = res.data;
  if (userBT) reqs = reqs.filter(r => r.bloodType === userBT);
  const pending = reqs.filter(r => {
    const donated  = (r.donations || []).some(d => d.donorUsername === username);
    const declined = (r.declines  || []).some(d => d.donorUsername === username);
    return !donated && !declined;
  }).length;
  if (pending > 0) { badge.textContent = pending; badge.style.display = ''; }
  else             { badge.style.display = 'none'; }
}

let myRequirements = [];
let allOpenRequirements = []; // for the "Respond" view (matching blood group)

// ── MY REQUESTS PAGE ─────────────────────────────────────────
async function loadMyRequests() {
  const el = document.getElementById('my-req-view');
  if (!el) return;
  el.innerHTML = '<div class="spinner"></div>';

  const res = await apiFetch('/my-requirements');
  if (!res.success) {
    el.innerHTML = `<div class="empty-state"><div class="emoji">⚠️</div><h4>Failed to load</h4><p>${res.error || 'Could not connect.'}</p><button class="btn btn-outline" onclick="loadMyRequests()">↻ Retry</button></div>`;
    return;
  }
  myRequirements = res.data;
  renderMyRequestStats(myRequirements);
  renderMyRequests(myRequirements);
}

function renderMyRequestStats(data) {
  const total     = data.length;
  const open      = data.filter(r => r.status === 'Open').length;
  const fulfilled = data.filter(r => r.status === 'Fulfilled').length;
  const partial   = data.filter(r => r.status === 'Open' && r.donationsCount > 0).length;
  const el = document.getElementById('my-req-stats');
  if (!el) return;
  el.innerHTML = `
    <div class="dash-stat highlight"><div class="label">My Requests</div><div class="value">${total}</div><div class="sub">All time</div></div>
    <div class="dash-stat"><div class="label" style="color:#2563EB">Open</div><div class="value" style="color:#2563EB">${open}</div><div class="sub">Active</div></div>
    <div class="dash-stat"><div class="label" style="color:#D97706">Partially Met</div><div class="value" style="color:#D97706">${partial}</div><div class="sub">In progress</div></div>
    <div class="dash-stat"><div class="label" style="color:#15803D">Fulfilled</div><div class="value" style="color:#15803D">${fulfilled}</div><div class="sub">Completed</div></div>`;
}

function getFulfillmentLabel(r) {
  const donated = r.donationsCount || 0;
  const total   = r.unitsRequired;
  const remaining = r.remainingUnits != null ? r.remainingUnits : total;
  if (r.status === 'Fulfilled') return { label: 'Fulfilled', cls: 'status-fulfilled' };
  if (r.status === 'Cancelled') return { label: 'Cancelled', cls: 'status-cancelled' };
  if (donated === 0) return { label: 'Pending', cls: 'status-pending' };
  return { label: 'Partially Fulfilled', cls: 'status-partial' };
}

function renderMyRequests(data) {
  const el = document.getElementById('my-req-view');
  if (!data.length) {
    el.innerHTML = `<div class="empty-state"><div class="emoji">📋</div><h4>No requests yet</h4><p>You haven't created any blood requirements.</p></div>`;
    return;
  }
  el.innerHTML = `<div class="table-wrap"><table>
    <thead><tr>
      <th>Patient</th><th>Hospital</th><th>Blood</th><th>Units</th><th>Progress</th><th>Status</th><th>Date</th><th>Actions</th>
    </tr></thead>
    <tbody>${data.map(r => {
      const donated    = r.donationsCount || 0;
      const total      = r.unitsRequired;
      const remaining  = (r.remainingUnits != null) ? r.remainingUnits : total;
      const pct        = total > 0 ? Math.round(((total - remaining) / total) * 100) : 0;
      const { label, cls } = getFulfillmentLabel(r);
      return `<tr>
        <td class="bold">${r.patientName}</td>
        <td>${r.hospital}</td>
        <td><span class="blood-badge">${r.bloodType}</span></td>
        <td style="font-weight:700;font-family:var(--font-ui)">${donated}/${total}</td>
        <td style="min-width:110px">
          <div class="prog-wrap">
            <div class="prog-bar" style="width:${pct}%"></div>
          </div>
          <div style="font-size:0.68rem;color:var(--text3);margin-top:2px;font-family:var(--font-ui)">${remaining} remaining</div>
        </td>
        <td><span class="fulfill-badge ${cls}">${label}</span></td>
        <td style="font-size:0.78rem;color:var(--text2)">${formatDate(r.createdAt)}</td>
        <td>
          <div style="display:flex;gap:5px">
            ${r.status === 'Open'
              ? `<button class="btn btn-outline btn-sm" onclick="openStatusPopup('${r._id}')" title="View status">📊 Status</button>`
              : `<button class="btn btn-outline btn-sm" onclick="viewRequirement('${r._id}')" title="View details">👁</button>`
            }
            <button class="btn btn-outline btn-sm" onclick="editRequirement('${r._id}')" title="Edit">✏️</button>
          </div>
        </td>
      </tr>`;
    }).join('')}</tbody></table></div>`;
}

// ── STATUS POPUP ──────────────────────────────────────────────
async function openStatusPopup(id) {
  const res = await apiFetch('/requirements/' + id);
  if (!res.success) { showToast(res.error || 'Could not load requirement.', 'error'); return; }
  const r = res.data;
  const donated    = (r.donations || []).length;
  const total      = r.unitsRequired;
  const remaining  = (r.remainingUnits != null) ? r.remainingUnits : total;
  const pct        = total > 0 ? Math.round((donated / total) * 100) : 0;
  const { label, cls } = getFulfillmentLabel({ ...r, donationsCount: donated });

  // Admin can see donor list
  let donorListHtml = '';
  if (isAdmin() && donated > 0) {
    const dRes = await apiFetch('/requirements/' + id + '/donors');
    if (dRes.success && dRes.data.length) {
      donorListHtml = `<div style="margin-top:16px">
        <div style="font-size:0.78rem;font-weight:600;color:var(--text2);margin-bottom:8px;text-transform:uppercase;letter-spacing:0.05em">Donors Who Responded</div>
        <div style="display:flex;flex-direction:column;gap:6px">
          ${dRes.data.map(d => `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:8px 12px;background:var(--surface);border-radius:8px;border:1px solid var(--border)">
              <div style="display:flex;align-items:center;gap:8px">
                <div style="width:30px;height:30px;border-radius:8px;background:var(--red-light);display:flex;align-items:center;justify-content:center;font-weight:700;color:var(--red);font-size:0.78rem;font-family:var(--font-ui)">${(d.donorName || d.donorUsername || '?')[0].toUpperCase()}</div>
                <div>
                  <div style="font-size:0.82rem;font-weight:600;color:var(--text)">${d.donorName || d.donorUsername}</div>
                  <div style="font-size:0.72rem;color:var(--text3)">@${d.donorUsername}</div>
                </div>
              </div>
              <div style="text-align:right">
                <span class="blood-badge" style="font-size:0.68rem">${d.bloodType}</span>
                <div style="font-size:0.7rem;color:var(--text3);margin-top:2px">${formatDate(d.donatedAt)}</div>
              </div>
            </div>`).join('')}
        </div>
      </div>`;
    }
  }

  document.getElementById('status-popup-content').innerHTML = `
    <div style="padding:20px">
      <!-- Header -->
      <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:20px">
        <div>
          <h3 style="font-family:var(--font-display);font-size:1.2rem;color:var(--text);margin-bottom:3px">${r.patientName}</h3>
          <p style="font-size:0.8rem;color:var(--text2)">🏥 ${r.hospital}${r.location ? ' · 📍 ' + r.location : ''}</p>
        </div>
        <span class="blood-badge" style="font-size:1rem;padding:4px 12px">${r.bloodType}</span>
      </div>

      <!-- Progress Ring Area -->
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:20px">
        <div class="status-stat-card">
          <div class="status-stat-val" style="color:var(--red)">${total}</div>
          <div class="status-stat-label">Required</div>
        </div>
        <div class="status-stat-card">
          <div class="status-stat-val" style="color:#15803D">${donated}</div>
          <div class="status-stat-label">Responded</div>
        </div>
        <div class="status-stat-card">
          <div class="status-stat-val" style="color:#D97706">${remaining}</div>
          <div class="status-stat-label">Remaining</div>
        </div>
      </div>

      <!-- Progress Bar -->
      <div style="margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <span style="font-size:0.78rem;font-weight:600;color:var(--text2)">Fulfillment Progress</span>
          <span style="font-size:0.78rem;font-weight:700;color:var(--text);font-family:var(--font-ui)">${pct}%</span>
        </div>
        <div style="height:10px;background:var(--border);border-radius:99px;overflow:hidden">
          <div style="height:100%;width:${pct}%;background:${pct===100?'#15803D':'var(--red)'};border-radius:99px;transition:width 0.6s ease"></div>
        </div>
      </div>

      <!-- Status Badge -->
      <div style="display:flex;align-items:center;justify-content:center;padding:10px;background:var(--surface);border-radius:10px;border:1px solid var(--border);margin-bottom:4px">
        <span style="font-size:0.78rem;font-weight:600;color:var(--text2);margin-right:8px">Current Status:</span>
        <span class="fulfill-badge ${cls}" style="font-size:0.82rem">${label}</span>
      </div>

      ${donorListHtml}
    </div>`;

  openModal('status-popup-modal');
}

// ── RESPOND TO REQUIREMENTS (for matching users) ──────────────
async function loadOpenRequirements() {
  const el = document.getElementById('respond-req-view');
  if (!el) return;
  el.innerHTML = '<div class="spinner"></div>';

  const res = await apiFetch('/requirements?status=Open');
  if (!res.success) {
    el.innerHTML = `<div class="empty-state"><div class="emoji">⚠️</div><h4>Failed to load</h4><p>${res.error || 'Could not connect.'}</p></div>`;
    return;
  }

  const userBT = currentUser?.bloodType || '';
  const reqs = res.data; // Show ALL open requirements, no blood type filter

  allOpenRequirements = reqs;

  // Refresh sidebar badge
  updateRespondBadge();

  renderOpenRequirements(reqs, userBT);
}

function renderOpenRequirements(data, userBT) {
  const el = document.getElementById('respond-req-view');
  if (!data.length) {
    el.innerHTML = `<div class="empty-state">
      <div class="emoji">🩸</div>
      <h4>No open requests</h4>
      <p>There are no open blood requirements at the moment.</p>
    </div>`;
    return;
  }

  const isUnavailable = currentUser?.isAvailable === false;

  el.innerHTML = `
    ${isUnavailable ? `<div class="warn-banner">⚠️ You are currently marked as <strong>Unavailable</strong> to donate. <a href="#" onclick="showPage('profile',document.getElementById('nav-profile'))">Update in Profile →</a></div>` : ''}
    ${userBT ? `<div style="font-size:0.8rem;color:var(--text2);margin-bottom:12px">Showing all requests — <strong>Donate</strong> and <strong>Decline</strong> buttons appear on requests matching your blood type (<span style="color:var(--red);font-weight:700">${userBT}</span>).</div>` : `<div style="font-size:0.8rem;color:var(--text3);margin-bottom:12px">Set your blood type in Profile to enable donating to matching requests.</div>`}
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px">
      ${data.map(r => {
        const donated   = (r.donations || []).length;
        const total     = r.unitsRequired;
        const remaining = (r.remainingUnits != null) ? r.remainingUnits : total;
        const pct       = total > 0 ? Math.round((donated / total) * 100) : 0;
        const alreadyDonated  = (r.donations || []).some(d => d.donorUsername === currentUser?.username);
        const alreadyDeclined = (r.declines  || []).some(d => d.donorUsername === currentUser?.username);
        const isMatch = userBT && r.bloodType === userBT;

        const URGENCY_ICON = { Critical:'🔴', High:'🟠', Medium:'🟡', Low:'🟢' };

        // Footer action area — only show donate/decline for matching blood type
        let footerActions = '';
        if (isMatch) {
          if (alreadyDonated) {
            footerActions = `<span class="respond-done-badge">✅ You responded</span>`;
          } else if (alreadyDeclined) {
            footerActions = `<span class="respond-declined-badge">❌ Declined</span>`;
          } else if (isUnavailable) {
            footerActions = `<span style="font-size:0.72rem;color:var(--text3)">Update availability to respond</span>`;
          } else {
            footerActions = `
              <button class="btn btn-primary btn-sm" onclick="respondToDonate('${r._id}','${r.patientName}','${r.bloodType}')">🩸 Donate</button>
              <button class="btn btn-outline btn-sm" onclick="respondToDecline('${r._id}')">Decline</button>`;
          }
        }
        // Non-matching cards show no action buttons (just the view icon below)

        return `<div class="respond-card${isMatch ? ' respond-card-match' : ''}">
          <div class="respond-card-top">
            <div>
              <div class="respond-card-patient">${r.patientName}</div>
              <div class="respond-card-hospital">🏥 ${r.hospital}</div>
              ${r.location ? `<div class="respond-card-loc">📍 ${r.location}</div>` : ''}
            </div>
            <div style="text-align:right;flex-shrink:0">
              <div style="font-family:var(--font-display);font-size:1.8rem;font-weight:700;color:var(--red);line-height:1">${r.bloodType}</div>
              <span class="urgency-badge urgency-${r.urgency}" style="font-size:0.65rem;margin-top:4px;display:inline-block">${URGENCY_ICON[r.urgency] || ''} ${r.urgency}</span>
              ${isMatch ? `<div style="font-size:0.65rem;font-weight:600;color:var(--red);margin-top:4px;background:var(--red-light);border-radius:6px;padding:2px 6px">Matches your type</div>` : ''}
            </div>
          </div>
          <div class="respond-card-prog">
            <div style="display:flex;justify-content:space-between;font-size:0.72rem;color:var(--text3);margin-bottom:4px">
              <span>${donated} donated</span><span>${remaining} needed</span>
            </div>
            <div style="height:7px;background:var(--border);border-radius:99px;overflow:hidden">
              <div style="height:100%;width:${pct}%;background:var(--red);border-radius:99px"></div>
            </div>
          </div>
          <div class="respond-card-footer">
            ${footerActions}
            <button class="btn btn-ghost btn-sm" onclick="viewRequirement('${r._id}')" style="margin-left:auto">👁</button>
          </div>
        </div>`;
      }).join('')}
    </div>`;
}

async function respondToDonate(id, patientName, bloodType) {
  const confirmed = await showDonateConfirm(patientName, bloodType);
  if (!confirmed) return;

  const res = await apiFetch('/requirements/' + id + '/donate', { method: 'POST', body: JSON.stringify({}) });
  if (res.success) {
    showToast(res.message || 'Donation recorded!', 'success');
    loadOpenRequirements(); // also calls updateRespondBadge internally
    loadMyDonationHistory();
  } else {
    showToast(res.error || 'Could not record donation.', 'error');
  }
}

async function respondToDecline(id) {
  const res = await apiFetch('/requirements/' + id + '/decline', { method: 'POST', body: JSON.stringify({}) });
  if (res.success) {
    showToast('Response recorded.', 'success');
    loadOpenRequirements(); // also calls updateRespondBadge internally
  } else {
    showToast(res.error || 'Could not record response.', 'error');
  }
}

function showDonateConfirm(patientName, bloodType) {
  return new Promise(resolve => {
    document.getElementById('donate-confirm-body').innerHTML = `
      <div style="text-align:center;padding:8px 0">
        <div style="font-size:2.5rem;font-weight:700;color:var(--red);font-family:var(--font-display);margin-bottom:8px">${bloodType}</div>
        <p style="color:var(--text2);font-size:0.9rem">Confirm your donation for <strong>${patientName}</strong>?</p>
        <p style="font-size:0.78rem;color:var(--text3);margin-top:6px">This will reduce the required units count and be recorded in the system.</p>
      </div>`;
    document.getElementById('donate-confirm-yes').onclick = () => { closeModal('donate-confirm-modal'); resolve(true); };
    document.getElementById('donate-confirm-no').onclick  = () => { closeModal('donate-confirm-modal'); resolve(false); };
    openModal('donate-confirm-modal');
  });
}
