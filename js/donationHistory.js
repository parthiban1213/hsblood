// ══════════════════════════════════════════════════════════════
// HSBlood — js/donationHistory.js
// Donation History screen for logged-in users
// ══════════════════════════════════════════════════════════════

let myDonations = [];

async function loadMyDonationHistory() {
  const el = document.getElementById('donation-history-view');
  if (!el) return;
  el.innerHTML = '<div class="spinner"></div>';

  const res = await apiFetch('/my-donations');
  if (!res.success) {
    el.innerHTML = `<div class="empty-state"><div class="emoji">⚠️</div><h4>Failed to load</h4><p>${res.error || 'Could not connect.'}</p><button class="btn btn-outline" onclick="loadMyDonationHistory()">↻ Retry</button></div>`;
    return;
  }
  myDonations = res.data;
  renderDonationHistoryStats(myDonations);
  renderDonationHistory(myDonations);
}

function renderDonationHistoryStats(data) {
  const el = document.getElementById('donation-history-stats');
  if (!el) return;
  const total      = data.length;
  const fulfilled  = data.filter(d => d.status === 'Fulfilled').length;
  const recent     = data.filter(d => {
    if (!d.donatedAt) return false;
    const diff = (Date.now() - new Date(d.donatedAt)) / (1000 * 60 * 60 * 24);
    return diff <= 30;
  }).length;

  el.innerHTML = `
    <div class="dash-stat highlight">
      <div class="label">Total Donations</div>
      <div class="value">${total}</div>
      <div class="sub">All time</div>
    </div>
    <div class="dash-stat">
      <div class="label" style="color:#15803D">Helped Fulfill</div>
      <div class="value" style="color:#15803D">${fulfilled}</div>
      <div class="sub">Fully met requests</div>
    </div>
    <div class="dash-stat">
      <div class="label" style="color:#2563EB">This Month</div>
      <div class="value" style="color:#2563EB">${recent}</div>
      <div class="sub">Last 30 days</div>
    </div>`;
}

function renderDonationHistory(data) {
  const el = document.getElementById('donation-history-view');
  if (!data.length) {
    el.innerHTML = `
      <div class="empty-state">
        <div class="emoji">🩸</div>
        <h4>No donations yet</h4>
        <p>You haven't responded to any blood requirements yet.</p>
        <button class="btn btn-primary" onclick="showPage('respond', document.getElementById('nav-respond'))">See Open Requests →</button>
      </div>`;
    return;
  }

  const URGENCY_ICON = { Critical:'🔴', High:'🟠', Medium:'🟡', Low:'🟢' };

  el.innerHTML = `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Patient</th>
            <th>Hospital / Location</th>
            <th>Blood Type</th>
            <th>Urgency</th>
            <th>Donated On</th>
            <th>Requirement Status</th>
          </tr>
        </thead>
        <tbody>
          ${data.map(d => {
            const statusCls = d.status === 'Fulfilled' ? 'req-status-Fulfilled'
              : d.status === 'Cancelled' ? 'req-status-Cancelled'
              : 'req-status-Open';
            return `<tr>
              <td class="bold">${d.patientName}</td>
              <td>
                <div>${d.hospital}</div>
                ${d.location ? `<div style="font-size:0.72rem;color:var(--text3)">📍 ${d.location}</div>` : ''}
              </td>
              <td><span class="blood-badge">${d.bloodType}</span></td>
              <td><span class="urgency-badge urgency-${d.urgency}">${URGENCY_ICON[d.urgency] || ''} ${d.urgency}</span></td>
              <td style="font-size:0.82rem">${formatDate(d.donatedAt)}</td>
              <td>
                <span class="req-status-badge ${statusCls}">${d.status}</span>
                ${d.status === 'Fulfilled' ? ' <span style="font-size:0.75rem">🎉</span>' : ''}
              </td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}
