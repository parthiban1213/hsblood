// ══════════════════════════════════════════════════════════════
// HSBlood — js/export.js
// Data export: XLSX, CSV, JSON with filters
// ══════════════════════════════════════════════════════════════

// ── EXPORT DATA ────────────────────────────────────

function openExportModal() {
  if (!isAdmin()) { showToast('Admin access required.', 'warn'); return; }
  wireExportListeners();
  // Reset to config step
  document.getElementById('export-step-config').style.display = '';
  document.getElementById('export-step-result').style.display = 'none';
  document.getElementById('export-modal-cancel-btn').textContent = 'Cancel';
  document.getElementById('export-preview-btn').style.display = '';
  document.getElementById('export-download-btn').style.display = '';
  document.getElementById('export-download-btn').disabled = false;
  document.getElementById('export-download-btn').textContent = '📤 Export & Download';
  // Sync filter section visibility with checkboxes
  syncExportFilterVisibility();
  openModal('export-modal');
}

function syncExportFilterVisibility() {
  const donorsOn = document.getElementById('export-ds-donors').checked;
  const reqsOn   = document.getElementById('export-ds-requirements').checked;
  const infoOn   = document.getElementById('export-ds-info').checked;
  document.getElementById('export-donor-filters').style.display = donorsOn ? '' : 'none';
  document.getElementById('export-req-filters').style.display   = reqsOn   ? '' : 'none';
  document.getElementById('export-info-filters').style.display  = infoOn   ? '' : 'none';
}

// Wire checkboxes and radio buttons — called once from openExportModal
function wireExportListeners() {
  if (wireExportListeners._done) return;
  wireExportListeners._done = true;
  ['export-ds-donors','export-ds-requirements','export-ds-info','export-ds-users'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', () => {
      syncExportFilterVisibility();
      updateExportCheckboxStyles();
    });
  });
  ['export-fmt-xlsx','export-fmt-csv','export-fmt-json'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', updateExportFormatStyles);
  });
}

function updateExportCheckboxStyles() {
  ['donors','requirements','info','users'].forEach(ds => {
    const cb    = document.getElementById('export-ds-' + ds);
    const label = document.getElementById('export-ds-' + ds + '-label');
    if (!cb || !label) return;
    if (cb.checked) {
      label.style.borderColor = 'var(--red)';
      label.style.background  = 'var(--red-light)';
      label.style.color       = 'var(--red)';
    } else {
      label.style.borderColor = 'var(--border)';
      label.style.background  = 'var(--bg3)';
      label.style.color       = 'var(--text2)';
    }
  });
}

function updateExportFormatStyles() {
  ['xlsx','csv','json'].forEach(fmt => {
    const radio = document.getElementById('export-fmt-' + fmt);
    const label = document.getElementById('export-fmt-' + fmt + '-label');
    if (!radio || !label) return;
    if (radio.checked) {
      label.style.borderColor = 'var(--red)';
      label.style.background  = 'var(--red-light)';
      label.style.color       = 'var(--red)';
      label.style.fontWeight  = '700';
    } else {
      label.style.borderColor = 'var(--border)';
      label.style.background  = 'var(--bg3)';
      label.style.color       = 'var(--text2)';
      label.style.fontWeight  = '600';
    }
  });
}

function buildExportParams() {
  const datasets = ['donors','requirements','info','users']
    .filter(ds => document.getElementById('export-ds-' + ds).checked)
    .join(',');

  const params = new URLSearchParams({ datasets });

  // Donor filters
  const dBlood = document.getElementById('export-donor-blood').value;
  const dAvail = document.getElementById('export-donor-available').value;
  const dFrom  = document.getElementById('export-donor-date-from').value;
  const dTo    = document.getElementById('export-donor-date-to').value;
  if (dBlood) params.set('bloodType', dBlood);
  if (dAvail !== '') params.set('available', dAvail);
  if (dFrom)  params.set('donorDateFrom', dFrom);
  if (dTo)    params.set('donorDateTo', dTo);

  // Requirement filters
  const rStatus = document.getElementById('export-req-status').value;
  const rBlood  = document.getElementById('export-req-blood').value;
  const rUrg    = document.getElementById('export-req-urgency').value;
  const rFrom   = document.getElementById('export-req-date-from').value;
  const rTo     = document.getElementById('export-req-date-to').value;
  if (rStatus) params.set('reqStatus', rStatus);
  if (rBlood)  params.set('reqBloodType', rBlood);
  if (rUrg)    params.set('reqUrgency', rUrg);
  if (rFrom)   params.set('reqDateFrom', rFrom);
  if (rTo)     params.set('reqDateTo', rTo);

  // Info filters
  const iCat = document.getElementById('export-info-category').value;
  if (iCat) params.set('infoCategory', iCat);

  return params;
}

async function runExportPreview() {
  const btn = document.getElementById('export-preview-btn');
  btn.disabled = true; btn.textContent = '⏳ Counting…';

  let res;
  try {
    const params = buildExportParams();
    res = await apiFetch('/export?' + params.toString());
  } catch(err) {
    showToast('Preview failed. Please check your connection.', 'error');
    btn.disabled = false; btn.textContent = '🔍 Preview Count';
    return;
  } finally {
    btn.disabled = false; btn.textContent = '🔍 Preview Count';
  }

  if (!res.success) { showToast(res.error || 'Preview failed', 'error'); return; }

  const s = res.data.summary;
  const rows = [
    s.donors       !== null ? `<tr><td style="padding:8px 14px;border-top:1px solid var(--border2)">👤 Donors</td><td style="padding:8px 14px;border-top:1px solid var(--border2);font-weight:700;color:var(--red);font-family:var(--font-display);font-size:1.1rem">${s.donors}</td><td style="padding:8px 14px;border-top:1px solid var(--border2);color:var(--text3);font-size:0.75rem">rows</td></tr>` : '',
    s.requirements !== null ? `<tr><td style="padding:8px 14px;border-top:1px solid var(--border2)">🩸 Requirements</td><td style="padding:8px 14px;border-top:1px solid var(--border2);font-weight:700;color:var(--red);font-family:var(--font-display);font-size:1.1rem">${s.requirements}</td><td style="padding:8px 14px;border-top:1px solid var(--border2);color:var(--text3);font-size:0.75rem">rows</td></tr>` : '',
    s.info         !== null ? `<tr><td style="padding:8px 14px;border-top:1px solid var(--border2)">📍 Info Directory</td><td style="padding:8px 14px;border-top:1px solid var(--border2);font-weight:700;color:var(--red);font-family:var(--font-display);font-size:1.1rem">${s.info}</td><td style="padding:8px 14px;border-top:1px solid var(--border2);color:var(--text3);font-size:0.75rem">rows</td></tr>` : '',
    s.users        !== null ? `<tr><td style="padding:8px 14px;border-top:1px solid var(--border2)">👥 Users</td><td style="padding:8px 14px;border-top:1px solid var(--border2);font-weight:700;color:var(--red);font-family:var(--font-display);font-size:1.1rem">${s.users}</td><td style="padding:8px 14px;border-top:1px solid var(--border2);color:var(--text3);font-size:0.75rem">rows</td></tr>` : '',
  ].filter(Boolean).join('');

  showToast(`Preview: ${[
    s.donors       !== null ? s.donors       + ' donors' : '',
    s.requirements !== null ? s.requirements + ' requirements' : '',
    s.info         !== null ? s.info         + ' info entries' : '',
    s.users        !== null ? s.users        + ' users' : '',
  ].filter(Boolean).join(', ')}`);
}

async function runExport() {
  const btn = document.getElementById('export-download-btn');
  btn.disabled = true; btn.textContent = '⏳ Exporting…';

  const datasets = ['donors','requirements','info','users']
    .filter(ds => document.getElementById('export-ds-' + ds).checked);

  if (!datasets.length) {
    showToast('Please select at least one dataset.', 'error');
    btn.disabled = false; btn.textContent = '📤 Export & Download';
    return;
  }

  const params = buildExportParams();
  const res = await apiFetch('/export?' + params.toString());

  if (!res.success) {
    showToast(res.error || 'Export failed', 'error');
    btn.disabled = false; btn.textContent = '📤 Export & Download';
    return;
  }

  const format = document.querySelector('input[name="export-format"]:checked').value;
  const timestamp = new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);
  const d = res.data;

  try {
    if (format === 'xlsx') {
      exportAsXlsx(d, timestamp);
    } else if (format === 'csv') {
      exportAsCsv(d, timestamp);
    } else {
      exportAsJson(d, timestamp);
    }

    // Show result step
    document.getElementById('export-step-config').style.display = 'none';
    document.getElementById('export-step-result').style.display = '';
    document.getElementById('export-preview-btn').style.display = 'none';
    document.getElementById('export-download-btn').style.display = 'none';
    document.getElementById('export-modal-cancel-btn').textContent = 'Close';

    const s = d.summary;
    const total = [s.donors, s.requirements, s.info, s.users].filter(n => n !== null).reduce((a,b) => a+b, 0);
    const box = document.getElementById('export-result-box');
    box.style.background = '#edfaf4';
    box.style.border = '1px solid #52c982';
    box.innerHTML = `
      <p style="font-family:var(--font-ui);font-weight:800;font-size:1rem;color:#1a7a46;margin-bottom:12px">✅ Export Successful!</p>
      <div style="display:flex;gap:20px;flex-wrap:wrap;margin-bottom:12px">
        ${s.donors       !== null ? `<div><span style="font-size:1.5rem;font-weight:800;color:#1a7a46;font-family:var(--font-display)">${s.donors}</span><p style="font-size:0.73rem;color:var(--text2);font-family:var(--font-ui)">Donors</p></div>` : ''}
        ${s.requirements !== null ? `<div><span style="font-size:1.5rem;font-weight:800;color:#1a7a46;font-family:var(--font-display)">${s.requirements}</span><p style="font-size:0.73rem;color:var(--text2);font-family:var(--font-ui)">Requirements</p></div>` : ''}
        ${s.info         !== null ? `<div><span style="font-size:1.5rem;font-weight:800;color:#1a7a46;font-family:var(--font-display)">${s.info}</span><p style="font-size:0.73rem;color:var(--text2);font-family:var(--font-ui)">Info Entries</p></div>` : ''}
        ${s.users        !== null ? `<div><span style="font-size:1.5rem;font-weight:800;color:#1a7a46;font-family:var(--font-display)">${s.users}</span><p style="font-size:0.73rem;color:var(--text2);font-family:var(--font-ui)">Users</p></div>` : ''}
      </div>
      <p style="font-size:0.75rem;color:var(--text3);font-family:var(--font-ui)">
        ${total} total rows · Format: ${format.toUpperCase()} · Exported at ${new Date(s.exportedAt).toLocaleString()} · By ${s.exportedBy}
      </p>`;

    showToast(`Exported ${total} rows as ${format.toUpperCase()}`);
  } catch(err) {
    showToast('Export generation failed: ' + err.message, 'error');
    btn.disabled = false; btn.textContent = '📤 Export & Download';
  }
}

function exportAsXlsx(data, timestamp) {
  const wb = XLSX.utils.book_new();
  const sheetMap = {
    donors:       { data: data.donors,       name: 'Donors' },
    requirements: { data: data.requirements, name: 'Requirements' },
    info:         { data: data.info,          name: 'Info Directory' },
    users:        { data: data.users,         name: 'Users' },
  };
  let hasSheet = false;
  Object.values(sheetMap).forEach(({ data: rows, name }) => {
    if (!rows || !rows.length) return;
    const ws = XLSX.utils.json_to_sheet(rows);
    // Auto column widths
    const cols = Object.keys(rows[0]);
    ws['!cols'] = cols.map(k => ({ wch: Math.min(40, Math.max(k.length + 2, 12)) }));
    XLSX.utils.book_append_sheet(wb, ws, name);
    hasSheet = true;
  });
  if (!hasSheet) { showToast('No data to export.', 'error'); return; }
  XLSX.writeFile(wb, `HSBlood_Export_${timestamp}.xlsx`);
}

function exportAsCsv(data, timestamp) {
  const datasets = { donors: data.donors, requirements: data.requirements, info: data.info, users: data.users };
  const names    = { donors: 'Donors', requirements: 'Requirements', info: 'InfoDirectory', users: 'Users' };
  let downloaded = 0;
  Object.entries(datasets).forEach(([key, rows]) => {
    if (!rows || !rows.length) return;
    const ws  = XLSX.utils.json_to_sheet(rows);
    const csv = XLSX.utils.sheet_to_csv(ws);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href = url; a.download = `HSBlood_${names[key]}_${timestamp}.csv`;
    document.body.appendChild(a); a.click();
    document.body.removeChild(a); URL.revokeObjectURL(url);
    downloaded++;
  });
  if (!downloaded) { showToast('No data to export.', 'error'); }
}

function exportAsJson(data, timestamp) {
  const exportObj = {
    exportedAt: data.summary.exportedAt,
    exportedBy: data.summary.exportedBy,
    summary:    data.summary,
  };
  if (data.donors)       exportObj.donors       = data.donors;
  if (data.requirements) exportObj.requirements = data.requirements;
  if (data.info)         exportObj.info          = data.info;
  if (data.users)        exportObj.users         = data.users;

  const json = JSON.stringify(exportObj, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = `HSBlood_Export_${timestamp}.json`;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a); URL.revokeObjectURL(url);
}
