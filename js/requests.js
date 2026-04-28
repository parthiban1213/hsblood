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
      const completed  = r.donationsCount || 0;
      const pending    = r.pendingCount   || 0;
      const total      = r.unitsRequired;
      const remaining  = (r.remainingUnits != null) ? r.remainingUnits : total;
      const pct        = total > 0 ? Math.round((completed / total) * 100) : 0;
      const { label, cls } = getFulfillmentLabel(r);
      return `<tr>
        <td class="bold">${r.patientName}</td>
        <td>${r.hospital}</td>
        <td><span class="blood-badge">${r.bloodType}</span></td>
        <td style="font-weight:700;font-family:var(--font-ui)">${completed}/${total}${pending > 0 ? `<div style="font-size:0.68rem;color:#92400E;font-weight:600">+${pending} pending</div>` : ''}</td>
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
function _buildDonorCard(d, reqId) {
  const isPending = (d.donationStatus || 'Pending') === 'Pending';
  const cardBorder  = isPending ? '#FCD34D' : '#86EFAC';
  const selBg       = isPending ? '#FEF3C7' : '#DCFCE7';
  const selColor    = isPending ? '#92400E' : '#15803D';
  const selBorder   = isPending ? '#FCD34D' : '#86EFAC';
  const arrowColor  = isPending ? '%2392400E' : '%2315803D';
  const arrowSvg    = "url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2210%22 height=%2210%22 viewBox=%220 0 10 10%22><path d=%22M1 3l4 4 4-4%22 stroke=%22" + arrowColor + "%22 stroke-width=%221.5%22 fill=%22none%22/></svg>')";

  const schedInfo = d.scheduledDate
    ? '<div style="font-size:0.72rem;color:#2563EB;margin-top:3px;font-weight:500">📅 ' + formatDate(d.scheduledDate) + (d.scheduledTime ? ' &nbsp;🕐 ' + d.scheduledTime : '') + '</div>'
    : '<div style="font-size:0.72rem;color:var(--text3);margin-top:2px">No date scheduled</div>';

  const avatar = (d.donorName || d.donorUsername || '?')[0].toUpperCase();
  const displayName = d.donorName || d.donorUsername || '?';

  const selectStyle = [
    'background:' + selBg,
    'color:' + selColor,
    'border:1.5px solid ' + selBorder,
    'font-size:0.73rem',
    'font-weight:700',
    'font-family:var(--font-ui)',
    'padding:5px 26px 5px 10px',
    'border-radius:8px',
    'cursor:pointer',
    'outline:none',
    'appearance:none',
    '-webkit-appearance:none',
    'background-image:' + arrowSvg,
    'background-repeat:no-repeat',
    'background-position:right 7px center',
    'min-width:122px'
  ].join(';');

  return '<div data-donor-card="' + d.donorUsername + '" style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--surface);border-radius:10px;border:1.5px solid ' + cardBorder + '">' +
    '<div style="width:34px;height:34px;border-radius:9px;background:var(--red-light);display:flex;align-items:center;justify-content:center;font-weight:700;color:var(--red);font-size:0.82rem;font-family:var(--font-ui);flex-shrink:0">' + avatar + '</div>' +
    '<div style="flex:1;min-width:0">' +
      '<div style="font-size:0.84rem;font-weight:600;color:var(--text)">' + displayName + '</div>' +
      '<div style="font-size:0.72rem;color:var(--text3)">@' + d.donorUsername + '</div>' +
      schedInfo +
    '</div>' +
    '<div style="flex-shrink:0">' +
      '<select data-req="' + reqId + '" data-donor="' + d.donorUsername + '" onchange="handleDonorStatusChange(this,\'' + reqId + '\',\'' + d.donorUsername + '\')" style="' + selectStyle + '">' +
        '<option value="Pending"'   + (isPending  ? ' selected' : '') + '>⏳ Pending</option>' +
        '<option value="Completed"' + (!isPending ? ' selected' : '') + '>✅ Completed</option>' +
      '</select>' +
    '</div>' +
  '</div>';
}

async function openStatusPopup(id) {
  const res = await apiFetch('/requirements/' + id);
  if (!res.success) { showToast(res.error || 'Could not load requirement.', 'error'); return; }
  const r = res.data;
  const allDonations = r.donations || [];
  const completed = allDonations.filter(d => d.donationStatus === 'Completed').length;
  const pending   = allDonations.filter(d => (d.donationStatus || 'Pending') === 'Pending').length;
  const total     = r.unitsRequired;
  // remainingUnits is authoritative from the DB (set correctly on completion)
  const remaining = (r.remainingUnits != null) ? r.remainingUnits : total;
  const pct       = total > 0 ? Math.round((completed / total) * 100) : 0;
  const { label, cls } = getFulfillmentLabel({ ...r, donationsCount: completed });

  // Requester or admin sees the donor list with status dropdown
  const isRequester = r.createdBy === currentUser?.username || r.username === currentUser?.username;
  let donorListHtml = '';
  if ((isAdmin() || isRequester) && allDonations.length > 0) {
    const dRes = await apiFetch('/requirements/' + id + '/donors');
    if (dRes.success && dRes.data.length) {
      donorListHtml =
        '<div style="margin-top:18px">' +
          '<div style="font-size:0.75rem;font-weight:700;color:var(--text2);margin-bottom:10px;text-transform:uppercase;letter-spacing:0.06em">Donors Who Responded</div>' +
          '<div style="display:flex;flex-direction:column;gap:8px">' +
            dRes.data.map(function(d) { return _buildDonorCard(d, id); }).join('') +
          '</div>' +
        '</div>';
    }
  }

  document.getElementById('status-popup-content').innerHTML =
    '<div style="padding:20px">' +
      '<div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:20px">' +
        '<div>' +
          '<h3 style="font-family:var(--font-display);font-size:1.2rem;color:var(--text);margin-bottom:3px">' + r.patientName + '</h3>' +
          '<p style="font-size:0.8rem;color:var(--text2)">🏥 ' + r.hospital + (r.location ? ' · 📍 ' + r.location : '') + '</p>' +
        '</div>' +
        '<span class="blood-badge" style="font-size:1rem;padding:4px 12px">' + r.bloodType + '</span>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:20px">' +
        '<div class="status-stat-card"><div class="status-stat-val" style="color:var(--red)">' + total + '</div><div class="status-stat-label">Required</div></div>' +
        '<div class="status-stat-card"><div class="status-stat-val" style="color:#15803D">' + completed + '</div><div class="status-stat-label">Completed</div></div>' +
        '<div class="status-stat-card"><div class="status-stat-val" style="color:#D97706">' + remaining + '</div><div class="status-stat-label">Remaining</div></div>' +
      '</div>' +
      (pending > 0 && r.status !== 'Fulfilled' ? '<div style="font-size:0.75rem;color:#92400E;background:#FEF3C7;border:1px solid #FCD34D;border-radius:8px;padding:6px 12px;margin-bottom:12px">⏳ ' + pending + ' donor' + (pending > 1 ? 's' : '') + ' scheduled — awaiting confirmation</div>' : '') +
      '<div style="margin-bottom:16px">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">' +
          '<span style="font-size:0.78rem;font-weight:600;color:var(--text2)">Fulfillment Progress</span>' +
          '<span style="font-size:0.78rem;font-weight:700;color:var(--text);font-family:var(--font-ui)">' + pct + '%</span>' +
        '</div>' +
        '<div style="height:10px;background:var(--border);border-radius:99px;overflow:hidden">' +
          '<div style="height:100%;width:' + pct + '%;background:' + (pct === 100 ? '#15803D' : 'var(--red)') + ';border-radius:99px;transition:width 0.6s ease"></div>' +
        '</div>' +
      '</div>' +
      '<div style="display:flex;align-items:center;justify-content:center;padding:10px;background:var(--surface);border-radius:10px;border:1px solid var(--border);margin-bottom:4px">' +
        '<span style="font-size:0.78rem;font-weight:600;color:var(--text2);margin-right:8px">Current Status:</span>' +
        '<span class="fulfill-badge ' + cls + '" style="font-size:0.82rem">' + label + '</span>' +
      '</div>' +
      donorListHtml +
    '</div>';

  openModal('status-popup-modal');
}



// ── RESPOND TO REQUIREMENTS (for matching users) ──────────────
async function loadOpenRequirements() {
  const el = document.getElementById('respond-req-view');
  if (!el) return;
  el.innerHTML = '<div class="spinner"></div>';

  // Always fetch fresh profile so lastDonationDate (and thus eligibility) is current.
  // This ensures that after a requester marks a donation Completed, the donor sees
  // the correct "Not Eligible" state the next time they open this screen.
  try {
    const profileRes = await apiFetch('/auth/profile');
    if (profileRes.success) {
      currentUser = { ...currentUser, ...profileRes.user };
      localStorage.setItem('bl_user', JSON.stringify(currentUser));
    }
  } catch(e) { /* use cached */ }

  const res = await apiFetch('/requirements?status=Open');
  if (!res.success) {
    el.innerHTML = `<div class="empty-state"><div class="emoji">⚠️</div><h4>Failed to load</h4><p>${res.error || 'Could not connect.'}</p></div>`;
    return;
  }

  const userBT = currentUser?.bloodType || '';
  const reqs = res.data;

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

  // 90-day eligibility check
  const _lastDonation = currentUser?.lastDonationDate ? new Date(currentUser.lastDonationDate) : null;
  const _daysSince = _lastDonation ? Math.floor((Date.now() - _lastDonation.getTime()) / 86400000) : 999;
  const isNotEligible = _daysSince < 90;
  const _nextEligible = _lastDonation ? new Date(_lastDonation.getTime() + 90 * 86400000) : null;
  const _daysLeft = isNotEligible ? (90 - _daysSince) : 0;

  el.innerHTML = `
    ${isUnavailable ? `<div class="warn-banner">⚠️ You are currently marked as <strong>Unavailable</strong> to donate. <a href="#" onclick="showPage('profile',document.getElementById('nav-profile'))">Update in Profile →</a></div>` : ''}
    ${isNotEligible ? `<div class="warn-banner" style="background:#FEF3C7;border:1.5px solid #FCD34D;color:#92400E;border-radius:10px;padding:10px 14px;margin-bottom:12px;font-size:0.82rem;font-family:var(--font-ui)">⏳ You are not eligible to donate yet. Next eligible date: <strong>${_nextEligible.toLocaleDateString('en-IN',{day:'numeric',month:'short',year:'numeric'})}</strong> — ${_daysLeft} day${_daysLeft !== 1 ? 's' : ''} remaining.</div>` : ''}
    ${userBT ? `<div style="font-size:0.8rem;color:var(--text2);margin-bottom:12px">Showing all requests — <strong>I'll Donate</strong> and <strong>Decline</strong> buttons appear on requests matching your blood type (<span style="color:var(--red);font-weight:700">${userBT}</span>).</div>` : `<div style="font-size:0.8rem;color:var(--text3);margin-bottom:12px">Set your blood type in Profile to enable donating to matching requests.</div>`}
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:14px">
      ${data.map(r => {
        const completed = (r.donations || []).filter(d => d.donationStatus === 'Completed').length;
        const total     = r.unitsRequired;
        const remaining = (r.remainingUnits != null) ? r.remainingUnits : total;
        const pct       = total > 0 ? Math.round((completed / total) * 100) : 0;
        const myDonation      = (r.donations || []).find(d => d.donorUsername === currentUser?.username);
        const alreadyDonated  = !!myDonation;
        const donationDone    = myDonation?.donationStatus === 'Completed';
        const alreadyDeclined = (r.declines  || []).some(d => d.donorUsername === currentUser?.username);
        const isMatch = userBT && r.bloodType === userBT;

        const URGENCY_ICON = { Critical:'🔴', High:'🟠', Medium:'🟡', Low:'🟢' };

        // Footer action area — only show donate/decline for matching blood type
        let footerActions = '';
        if (isMatch) {
          if (alreadyDonated) {
            footerActions = donationDone
              ? `<span class="respond-done-badge" style="background:#DCFCE7;color:#15803D;border:1.5px solid #86EFAC">✅ You donated</span>`
              : `<span class="respond-done-badge" style="background:#FEF3C7;color:#92400E;border:1.5px solid #FCD34D">⏳ Scheduled</span>
                 <button class="btn btn-sm" onclick="cancelPledge('${r._id}')" style="background:#FFF1F2;color:#BE123C;border:1.5px solid #FECDD3;font-size:0.75rem;font-weight:600;padding:5px 11px;border-radius:8px;cursor:pointer;font-family:var(--font-ui)" title="Cancel your pledge">✕ Cancel</button>`;
          } else if (alreadyDeclined) {
            footerActions = `<span class="respond-declined-badge">❌ Declined</span>`;
          } else if (isNotEligible) {
            footerActions = `<button class="btn btn-sm" style="background:#F3F4F6;color:#9CA3AF;border:1.5px solid #E5E7EB;cursor:not-allowed;font-family:var(--font-ui);font-size:0.78rem;font-weight:600;padding:6px 14px;border-radius:8px;pointer-events:none" disabled title="Not eligible until ${_nextEligible?.toLocaleDateString('en-IN')}">🚫 Not Eligible</button>`;
          } else if (isUnavailable) {
            footerActions = `<span style="font-size:0.72rem;color:var(--text3)">Update availability to respond</span>`;
          } else {
            footerActions = `
              <button class="btn btn-primary btn-sm" onclick="respondToDonate('${r._id}','${r.patientName}','${r.bloodType}')">🩸 I'll Donate</button>
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
              <span>${completed} donated</span><span>${remaining} needed</span>
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
  const result = await showDonateSchedule(patientName, bloodType);
  if (!result) return;

  const { scheduledDate, scheduledTime } = result;
  const body = { scheduledDate, scheduledTime, donationStatus: 'Pending' };

  const res = await apiFetch('/requirements/' + id + '/donate', { method: 'POST', body: JSON.stringify(body) });
  if (res.success) {
    showToast('✅ Donation scheduled! The requester has been notified.', 'success');
    loadOpenRequirements();
    loadMyDonationHistory();
  } else {
    showToast(res.error || 'Could not record donation.', 'error');
  }
}

async function respondToDecline(id) {
  const res = await apiFetch('/requirements/' + id + '/decline', { method: 'POST', body: JSON.stringify({}) });
  if (res.success) {
    showToast('Response recorded.', 'success');
    loadOpenRequirements();
  } else {
    showToast(res.error || 'Could not record response.', 'error');
  }
}

async function cancelPledge(id) {
  const confirmed = await showConfirmDialog(
    'Cancel Your Pledge?',
    'Are you sure you want to withdraw your pledge for this request? The requester will no longer count on you.'
  );
  if (!confirmed) return;

  const res = await apiFetch('/requirements/' + id + '/donate', { method: 'DELETE' });
  if (res.success) {
    showToast('Pledge cancelled successfully.', 'success');
    loadOpenRequirements();
    loadMyDonationHistory();
  } else {
    showToast(res.error || 'Could not cancel pledge. Please try again.', 'error');
  }
}

function showConfirmDialog(title, message) {
  return new Promise(resolve => {
    const modal = document.getElementById('cancel-pledge-modal');
    if (!modal) {
      // Fallback: use browser confirm if modal not in DOM yet
      resolve(confirm(message));
      return;
    }
    document.getElementById('cancel-pledge-modal-title').textContent = title;
    document.getElementById('cancel-pledge-modal-body').textContent  = message;
    document.getElementById('cancel-pledge-confirm-yes').onclick = () => { closeModal('cancel-pledge-modal'); resolve(true); };
    document.getElementById('cancel-pledge-confirm-no').onclick  = () => { closeModal('cancel-pledge-modal'); resolve(false); };
    openModal('cancel-pledge-modal');
  });
}

function showDonateSchedule(patientName, bloodType) {
  return new Promise(resolve => {
    // Pre-fill date to today (optional — user can clear)
    const today = new Date().toISOString().split('T')[0];
    const dateEl = document.getElementById('donate-schedule-date');
    const timeEl = document.getElementById('donate-schedule-time');
    const errEl  = document.getElementById('donate-schedule-err');
    if (dateEl) { dateEl.value = today; dateEl.min = today; }
    if (timeEl) timeEl.value = '';
    if (errEl)  { errEl.style.display = 'none'; errEl.textContent = ''; }

    document.getElementById('donate-confirm-body').innerHTML = `
      <div style="text-align:center;padding:4px 0 12px">
        <div style="font-size:2.2rem;font-weight:700;color:var(--red);font-family:var(--font-display);margin-bottom:6px">${bloodType}</div>
        <p style="color:var(--text2);font-size:0.88rem">You're committing to donate for <strong>${patientName}</strong>.</p>
        <p style="font-size:0.75rem;color:var(--text3);margin-top:4px">Optionally choose when you plan to donate below.</p>
      </div>`;

    document.getElementById('donate-confirm-yes').onclick = () => {
      const date = dateEl?.value || '';
      const time = timeEl?.value || '';
      // date and time are optional — no validation needed
      closeModal('donate-confirm-modal');
      resolve({ scheduledDate: date || undefined, scheduledTime: time || undefined });
    };
    document.getElementById('donate-confirm-no').onclick = () => {
      closeModal('donate-confirm-modal');
      resolve(null);
    };
    openModal('donate-confirm-modal');
  });
}

// ── DONOR STATUS DROPDOWN CHANGE ─────────────────────────────
async function handleDonorStatusChange(selectEl, requirementId, donorUsername) {
  const newStatus = selectEl.value;
  const prevValue = newStatus === 'Completed' ? 'Pending' : 'Completed';

  // Visually update the select immediately for responsiveness
  const isPendingNow = newStatus === 'Pending';
  selectEl.style.background    = isPendingNow ? '#FEF3C7' : '#DCFCE7';
  selectEl.style.color         = isPendingNow ? '#92400E' : '#15803D';
  selectEl.style.borderColor   = isPendingNow ? '#FCD34D' : '#86EFAC';
  const card = selectEl.closest('[data-donor-card]');
  if (card) card.style.borderColor = isPendingNow ? '#FCD34D' : '#86EFAC';

  const res = await apiFetch(
    '/requirements/' + requirementId + '/donations/' + encodeURIComponent(donorUsername) + '/status',
    { method: 'POST', body: JSON.stringify({ donationStatus: newStatus }) }
  );

  if (res.success) {
    if (newStatus === 'Completed') {
      showToast('✅ Marked as Completed! Last donation date updated for @' + donorUsername + '.', 'success');
      // Always refresh profile from server — lastDonationDate may have changed for the donor,
      // and if the requester IS the donor, their local eligibility state needs updating too.
      try {
        const profileRes = await apiFetch('/auth/profile');
        if (profileRes.success) {
          currentUser = { ...currentUser, ...profileRes.user };
          localStorage.setItem('bl_user', JSON.stringify(currentUser));
        }
      } catch(e) { /* use cached */ }
      // Reload all three views that could be stale after a completion
      loadMyRequests();          // Issue 1: refresh requester's My Requests table
      loadOpenRequirements();    // refresh open list (pledges cleared, eligibility updated)
      loadMyDonationHistory();   // refresh donor history
    } else {
      showToast('Set back to Pending.', 'success');
      loadMyRequests();
    }
    // Re-open the popup to reflect latest donor list state
    openStatusPopup(requirementId);
  } else {
    // Revert on failure
    selectEl.value = prevValue;
    const wasPending = prevValue === 'Pending';
    selectEl.style.background  = wasPending ? '#FEF3C7' : '#DCFCE7';
    selectEl.style.color       = wasPending ? '#92400E' : '#15803D';
    selectEl.style.borderColor = wasPending ? '#FCD34D' : '#86EFAC';
    showToast(res.error || 'Could not update status.', 'error');
  }
}
