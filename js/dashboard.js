// ══════════════════════════════════════════════════════════════
// HSBlood — js/dashboard.js
// Dashboard stats, blood type chart, recent donors
// ══════════════════════════════════════════════════════════════

// ── DASHBOARD ──────────────────────────────────────
async function loadDashboard(){
  // Show loading placeholders while fetching
  ['d-total','d-available','d-open-reqs','d-benefitted','d-benefitted-2','d-fulfilled-count'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.innerHTML='<span style="opacity:0.4;font-size:1.2rem">…</span>';
  });
  document.getElementById('bt-chart').innerHTML='<div class="spinner"></div>';
  document.getElementById('recent-donors-table').innerHTML='<div class="spinner"></div>';
  document.getElementById('stat-total').textContent='—';
  document.getElementById('stat-available').textContent='—';

  const[stats,donors,reqs]=await Promise.all([apiFetch('/stats'),apiFetch('/donors'),apiFetch('/requirements')]);

  // Benefitted banner loading placeholder
  ['d-benefitted','d-benefitted-2','d-fulfilled-count'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.innerHTML='<span style="opacity:0.5;font-size:1rem">…</span>';
  });

  // Stats card
  if(stats.success){
    const{totalDonors,availableDonors,byBloodType}=stats.data;
    document.getElementById('d-total').textContent=totalDonors;
    document.getElementById('d-available').textContent=availableDonors;
    document.getElementById('stat-total').textContent=totalDonors;
    document.getElementById('stat-available').textContent=availableDonors;
    const max=Math.max(...byBloodType.map(x=>x.count),1);
    document.getElementById('bt-chart').innerHTML=byBloodType.length
      ?byBloodType.map(b=>`<div class="bt-bar-row">
          <div class="bt-bar-label">${b._id}</div>
          <div class="bt-bar-track"><div class="bt-bar-fill" style="width:${(b.count/max)*100}%"></div></div>
          <div class="bt-bar-count">${b.count}</div>
        </div>`).join('')
      :'<p style="color:var(--text3);font-size:.81rem">No donors yet.</p>';
  // People benefitted — from stats response
    const helped   = stats.data.peopleHelped       || 0;
    const fulfilled= stats.data.fulfilledRequirements || 0;
    const units    = stats.data.unitsDelivered      || 0;
    document.getElementById('d-benefitted').textContent   = helped.toLocaleString();
    document.getElementById('d-benefitted-2').textContent = units.toLocaleString();
    document.getElementById('d-fulfilled-count').textContent = fulfilled.toLocaleString();
  } else {
    document.getElementById('d-total').textContent='—';
    document.getElementById('d-available').textContent='—';
    document.getElementById('bt-chart').innerHTML=
      `<div style="text-align:center;padding:20px 0">
        <p style="color:var(--text3);font-size:0.8rem;margin-bottom:10px">⚠️ Failed to load stats</p>
        <button id="btn-dashboard-retry" class="btn btn-outline btn-sm" onclick="loadDashboard()">↻ Retry</button>
      </div>`;
    ['d-benefitted','d-benefitted-2','d-fulfilled-count'].forEach(id=>{
      const el=document.getElementById(id); if(el) el.textContent='—';
    });
  }

  // Open requirements count
  if(reqs.success){
    const openCount=reqs.data.filter(r=>r.status==='Open').length;
    document.getElementById('d-open-reqs').textContent=openCount;
  } else {
    document.getElementById('d-open-reqs').textContent='—';
  }

  // Recent donors table
  if(donors.success){
    const recent=donors.data.slice(0,6);
    document.getElementById('recent-donors-table').innerHTML=recent.length
      ?`<div class="table-wrap"><table>
          <thead><tr><th>Name</th><th>Blood Type</th><th>Phone</th><th>Status</th><th>Registered</th></tr></thead>
          <tbody>${recent.map(d=>`<tr>
            <td class="bold">${d.firstName} ${d.lastName}</td>
            <td><span class="blood-badge">${d.bloodType}</span></td>
            <td>${d.phone}</td>
            <td><span class="status-dot ${d.isAvailable?'available':'unavailable'}">${d.isAvailable?'Available':'Unavailable'}</span></td>
            <td>${formatDate(d.createdAt)}</td>
          </tr>`).join('')}</tbody></table></div>`
      :'<div class="empty-state"><div class="emoji">🩸</div><h4>No donors yet</h4><p>Register the first donor!</p></div>';
  } else {
    document.getElementById('recent-donors-table').innerHTML=
      `<div style="text-align:center;padding:20px 0">
        <p style="color:var(--text3);font-size:0.8rem;margin-bottom:10px">⚠️ Failed to load recent donors</p>
        <button id="btn-dashboard-donors-retry" class="btn btn-outline btn-sm" onclick="loadDashboard()">↻ Retry</button>
      </div>`;
  }
}
