// ══════════════════════════════════════════════════════════════
// HSBlood — js/bulk.js
// Bulk upload: donors, requirements, info directory
// ══════════════════════════════════════════════════════════════

// ── BULK UPLOAD ────────────────────────────────────

let bulkParsedDonors = [];

function openBulkUploadModal() {
  bulkReset();
  openModal('bulk-modal');
}

function bulkReset() {
  bulkParsedDonors = [];
  document.getElementById('bulk-step-1').style.display = '';
  document.getElementById('bulk-step-2').style.display = 'none';
  document.getElementById('bulk-step-3').style.display = 'none';
  document.getElementById('bulk-confirm-btn').style.display = 'none';
  document.getElementById('bulk-done-btn').style.display = 'none';
  document.getElementById('bulk-cancel-btn').style.display = '';
  document.getElementById('bulk-file-name').textContent = '';
  document.getElementById('bulk-file-input').value = '';
  const dz = document.getElementById('bulk-drop-zone');
  dz.style.borderColor = 'var(--border)';
  dz.style.background  = 'var(--bg3)';
}

function bulkDragOver(e) {
  e.preventDefault();
  const dz = document.getElementById('bulk-drop-zone');
  dz.style.borderColor = 'var(--red)';
  dz.style.background  = 'var(--red-light)';
}
function bulkDragLeave(e) {
  const dz = document.getElementById('bulk-drop-zone');
  dz.style.borderColor = 'var(--border)';
  dz.style.background  = 'var(--bg3)';
}
function bulkDrop(e) {
  e.preventDefault();
  bulkDragLeave(e);
  const file = e.dataTransfer.files[0];
  if (file) processBulkFile(file);
}
function bulkFileSelected(e) {
  const file = e.target.files[0];
  if (file) processBulkFile(file);
}

function processBulkFile(file) {
  if (!file.name.match(/\.(xlsx|xls)$/i)) {
    showToast('Please select an .xlsx or .xls file.', 'error');
    return;
  }
  document.getElementById('bulk-file-name').textContent = '📁 ' + file.name;

  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const wb = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });

      if (!rows.length) { showToast('The file appears to be empty.', 'error'); return; }

      bulkParsedDonors = rows;
      showBulkPreview(rows);
    } catch(err) {
      showToast('Failed to parse file: ' + err.message, 'error');
    }
  };
  reader.readAsArrayBuffer(file);
}

function showBulkPreview(rows) {
  const cols = ['firstName','lastName','email','phone','dateOfBirth','gender','bloodType','address','city','country','lastDonationDate','isAvailable'];

  // Build header
  const thead = document.getElementById('bulk-preview-head');
  thead.innerHTML = '<tr>' + cols.map(c =>
    `<th style="padding:8px 10px;text-align:left;font-family:var(--font-ui);font-size:0.72rem;color:var(--text2);white-space:nowrap">${c}</th>`
  ).join('') + '</tr>';

  // Build rows (max 50 preview)
  const tbody = document.getElementById('bulk-preview-body');
  const preview = rows.slice(0, 50);
  tbody.innerHTML = preview.map((row, i) => {
    const bg = i % 2 === 0 ? '' : 'background:var(--bg3)';
    return '<tr style="' + bg + '">' + cols.map(c => {
      const val = row[c] !== undefined ? String(row[c]) : '';
      const missing = !val && ['firstName','lastName','email','phone','dateOfBirth','gender','bloodType'].includes(c);
      return `<td style="padding:7px 10px;border-top:1px solid var(--border2);${missing?'color:#C8102E;font-weight:700':''}">${val || (missing ? '⚠ missing' : '—')}</td>`;
    }).join('') + '</tr>';
  }).join('');

  document.getElementById('bulk-preview-summary').textContent =
    `${rows.length} row${rows.length !== 1 ? 's' : ''} found` + (rows.length > 50 ? ' (showing first 50)' : '');

  document.getElementById('bulk-step-1').style.display = 'none';
  document.getElementById('bulk-step-2').style.display = '';
  document.getElementById('bulk-confirm-btn').style.display = '';
}

async function bulkConfirmUpload() {
  if (!bulkParsedDonors.length) return;
  const btn = document.getElementById('bulk-confirm-btn');
  btn.disabled = true;
  btn.textContent = '⏳ Uploading…';

  try {
    const res = await apiFetch('/donors/bulk', {
      method: 'POST',
      body: JSON.stringify({ donors: bulkParsedDonors })
    });

    document.getElementById('bulk-step-2').style.display = 'none';
    document.getElementById('bulk-step-3').style.display = '';
    document.getElementById('bulk-confirm-btn').style.display = 'none';
    document.getElementById('bulk-cancel-btn').style.display = 'none';
    document.getElementById('bulk-done-btn').style.display = '';

    const d = res.data || {};
    const box = document.getElementById('bulk-result-box');
    const allOk = d.skipped === 0;
    box.style.background = allOk ? '#edfaf4' : '#fff9ec';
    box.style.border = '1px solid ' + (allOk ? '#52c982' : '#f0ad4e');
    box.innerHTML = `
      <p style="font-family:var(--font-ui);font-weight:800;font-size:1rem;color:${allOk?'#1a7a46':'#856404'};margin-bottom:10px">
        ${allOk ? '✅ Upload Complete!' : '⚠️ Upload Complete with Issues'}
      </p>
      <div style="display:flex;gap:24px;flex-wrap:wrap">
        <div><span style="font-size:1.6rem;font-weight:800;color:#1a7a46">${d.inserted||0}</span>
          <p style="font-size:0.75rem;color:var(--text2);font-family:var(--font-ui)">Donors Inserted</p></div>
        <div><span style="font-size:1.6rem;font-weight:800;color:#856404">${d.skipped||0}</span>
          <p style="font-size:0.75rem;color:var(--text2);font-family:var(--font-ui)">Rows Skipped</p></div>
      </div>`;

    if (d.errors && d.errors.length) {
      const wrap = document.getElementById('bulk-error-table-wrap');
      wrap.style.display = '';
      document.getElementById('bulk-error-body').innerHTML = d.errors.map(e =>
        `<tr>
          <td style="padding:7px 12px;border-top:1px solid var(--border2)">${e.row}</td>
          <td style="padding:7px 12px;border-top:1px solid var(--border2)">${e.email||'—'}</td>
          <td style="padding:7px 12px;border-top:1px solid var(--border2);color:#856404">${e.reason}</td>
        </tr>`
      ).join('');
    }

    showToast(res.message || 'Bulk upload complete!');
  } catch(err) {
    showToast('Upload failed: ' + err.message, 'error');
    btn.disabled = false;
    btn.textContent = '🚀 Upload Donors';
  }
}

function downloadTemplate() {
  // Pre-built server-side template with real dropdown validations & date pickers
  const b64 = "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";
  const byteChars = atob(b64);
  const byteNums  = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++) byteNums[i] = byteChars.charCodeAt(i);
  const blob = new Blob([new Uint8Array(byteNums)],
    { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'HSBlood_Donor_Template.xlsx';
  a.click();
  URL.revokeObjectURL(url);
}

// ── SESSION RESTORE ────────────────────────────────
// ── BULK INFO UPLOAD ───────────────────────────────

let bulkInfoParsed = [];
const BI_COLS = ['category','name','phone','area','address','notes','available24h','lat','lng'];
const BI_REQUIRED = ['category','name','phone'];

function openBulkInfoModal() {
  biReset();
  openModal('bulk-info-modal');
}

function biReset() {
  bulkInfoParsed = [];
  document.getElementById('bi-step-1').style.display = '';
  document.getElementById('bi-step-2').style.display = 'none';
  document.getElementById('bi-step-3').style.display = 'none';
  document.getElementById('bi-confirm-btn').style.display = 'none';
  document.getElementById('bi-done-btn').style.display = 'none';
  document.getElementById('bi-cancel-btn').style.display = '';
  document.getElementById('bi-file-name').textContent = '';
  document.getElementById('bi-file-input').value = '';
  document.getElementById('bi-error-table-wrap').style.display = 'none';
  const dz = document.getElementById('bi-drop-zone');
  dz.style.borderColor = 'var(--border)';
  dz.style.background  = 'var(--bg3)';
}

function biDragOver(e) {
  e.preventDefault();
  const dz = document.getElementById('bi-drop-zone');
  dz.style.borderColor = 'var(--red)';
  dz.style.background  = 'var(--red-light)';
}
function biDragLeave(e) {
  const dz = document.getElementById('bi-drop-zone');
  dz.style.borderColor = 'var(--border)';
  dz.style.background  = 'var(--bg3)';
}
function biDrop(e) {
  e.preventDefault();
  biDragLeave(e);
  const file = e.dataTransfer.files[0];
  if (file) processBulkInfoFile(file);
}
function biFileSelected(e) {
  const file = e.target.files[0];
  if (file) processBulkInfoFile(file);
}

function processBulkInfoFile(file) {
  if (!file.name.match(/\.(xlsx|xls)$/i)) {
    showToast('Please select an .xlsx or .xls file.', 'error');
    return;
  }
  document.getElementById('bi-file-name').textContent = '📁 ' + file.name;
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const wb   = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      if (!rows.length) { showToast('The file appears to be empty.', 'error'); return; }
      bulkInfoParsed = rows;
      showBulkInfoPreview(rows);
    } catch(err) {
      showToast('Failed to parse file: ' + err.message, 'error');
    }
  };
  reader.readAsArrayBuffer(file);
}

function showBulkInfoPreview(rows) {
  // Header
  document.getElementById('bi-preview-head').innerHTML =
    '<tr>' + BI_COLS.map(c =>
      `<th style="padding:8px 10px;text-align:left;font-family:var(--font-ui);font-size:0.72rem;color:var(--text2);white-space:nowrap">${c}</th>`
    ).join('') + '</tr>';

  // Rows (max 50 preview)
  const preview = rows.slice(0, 50);
  document.getElementById('bi-preview-body').innerHTML = preview.map((row, i) => {
    const bg = i % 2 === 0 ? '' : 'background:var(--bg3)';
    return '<tr style="' + bg + '">' + BI_COLS.map(c => {
      const val     = row[c] !== undefined ? String(row[c]) : '';
      const missing = !val && BI_REQUIRED.includes(c);
      return `<td style="padding:7px 10px;border-top:1px solid var(--border2);${missing ? 'color:#C8102E;font-weight:700' : ''}">${val || (missing ? '⚠ missing' : '—')}</td>`;
    }).join('') + '</tr>';
  }).join('');

  document.getElementById('bi-preview-summary').textContent =
    `${rows.length} row${rows.length !== 1 ? 's' : ''} found` + (rows.length > 50 ? ' (showing first 50)' : '');

  document.getElementById('bi-step-1').style.display = 'none';
  document.getElementById('bi-step-2').style.display = '';
  document.getElementById('bi-confirm-btn').style.display = '';
}

async function biConfirmUpload() {
  if (!bulkInfoParsed.length) return;
  const btn = document.getElementById('bi-confirm-btn');
  btn.disabled = true;
  btn.textContent = '⏳ Uploading…';

  let res;
  try {
    res = await apiFetch('/info/bulk', {
      method: 'POST',
      body: JSON.stringify({ entries: bulkInfoParsed })
    });
  } catch(err) {
    showToast('Upload failed. Please check your connection.', 'error');
    btn.disabled = false; btn.textContent = '🚀 Upload Entries';
    return;
  }

  document.getElementById('bi-step-2').style.display = 'none';
  document.getElementById('bi-step-3').style.display = '';
  document.getElementById('bi-confirm-btn').style.display = 'none';
  document.getElementById('bi-cancel-btn').style.display = 'none';
  document.getElementById('bi-done-btn').style.display = '';
  loadInfo();

  if (!res.success) {
    showToast(res.error || 'Upload failed', 'error');
    btn.disabled = false;
    btn.textContent = '🚀 Upload Entries';
    return;
  }

  const d = res.data || {};
  const allOk = d.skipped === 0;
  const box = document.getElementById('bi-result-box');
  box.style.background = allOk ? '#edfaf4' : '#fff9ec';
  box.style.border = '1px solid ' + (allOk ? '#52c982' : '#f0ad4e');
  box.innerHTML = `
    <p style="font-family:var(--font-ui);font-weight:800;font-size:1rem;color:${allOk ? '#1a7a46' : '#856404'};margin-bottom:10px">
      ${allOk ? '✅ Upload Complete!' : '⚠️ Upload Complete with Issues'}
    </p>
    <div style="display:flex;gap:24px;flex-wrap:wrap">
      <div>
        <span style="font-size:1.6rem;font-weight:800;color:#1a7a46">${d.inserted || 0}</span>
        <p style="font-size:0.75rem;color:var(--text2);font-family:var(--font-ui)">Entries Inserted</p>
      </div>
      <div>
        <span style="font-size:1.6rem;font-weight:800;color:#856404">${d.skipped || 0}</span>
        <p style="font-size:0.75rem;color:var(--text2);font-family:var(--font-ui)">Rows Skipped</p>
      </div>
    </div>`;

  if (d.errors && d.errors.length) {
    const wrap = document.getElementById('bi-error-table-wrap');
    wrap.style.display = '';
    document.getElementById('bi-error-body').innerHTML = d.errors.map(e =>
      `<tr>
        <td style="padding:7px 12px;border-top:1px solid var(--border2)">${e.row}</td>
        <td style="padding:7px 12px;border-top:1px solid var(--border2)">${e.name || '—'}</td>
        <td style="padding:7px 12px;border-top:1px solid var(--border2);color:#856404">${e.reason}</td>
      </tr>`
    ).join('');
  }

  showToast(res.message || 'Bulk upload complete!');
}

function downloadInfoTemplate() {
  // Build a simple template xlsx with headers using SheetJS
  const ws = XLSX.utils.aoa_to_sheet([
    BI_COLS,
    ['Hospital',    'PSG Hospitals',        '+91 422 4345678', 'Coimbatore', '(No. 5, 6 Avinashi Rd, Coimbatore)', 'Trauma centre, blood bank on site', 'true',  '11.0168', '76.9558'],
    ['Ambulance',   'GVK EMRI (108)',        '108',             'Tamil Nadu', '', '24/7 free ambulance service', 'true', '', ''],
    ['Hospital',    'KMCH',                  '+91 422 4323800', 'Coimbatore', 'Avanashi Rd, Coimbatore', '', 'false', '', ''],
    ['Blood Bank',  'District Blood Bank',   '+91 422 2300000', 'Coimbatore', 'Avinashi Rd, Coimbatore', 'Licensed blood bank, walk-in accepted', 'false', '', ''],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Info Directory');
  XLSX.writeFile(wb, 'HSBlood_InfoDirectory_Template.xlsx');
}


// ── BULK REQUIREMENT UPLOAD ─────────────────────────
const BR_COLS = ['patientName','hospital','location','contactPerson','contactPhone','bloodType','unitsRequired','urgency','requiredBy','status','notes'];
const BR_REQUIRED = ['patientName','hospital','contactPerson','contactPhone','bloodType','unitsRequired'];
let bulkReqParsed = [];

function openBulkReqModal() {
  brReset();
  openModal('bulk-req-modal');
}

function brReset() {
  bulkReqParsed = [];
  document.getElementById('br-step-1').style.display = '';
  document.getElementById('br-step-2').style.display = 'none';
  document.getElementById('br-step-3').style.display = 'none';
  document.getElementById('br-confirm-btn').style.display = 'none';
  document.getElementById('br-done-btn').style.display = 'none';
  document.getElementById('br-cancel-btn').style.display = '';
  document.getElementById('br-file-name').textContent = '';
  document.getElementById('br-file-input').value = '';
  document.getElementById('br-error-table-wrap').style.display = 'none';
  const dz = document.getElementById('br-drop-zone');
  if (dz) dz.style.borderColor = 'var(--border)';
}

function brDragOver(e) {
  e.preventDefault();
  document.getElementById('br-drop-zone').style.borderColor = 'var(--red)';
}
function brDragLeave(e) {
  document.getElementById('br-drop-zone').style.borderColor = 'var(--border)';
}
function brDrop(e) {
  e.preventDefault();
  brDragLeave(e);
  const file = e.dataTransfer.files[0];
  if (file) processBulkReqFile(file);
}
function brFileSelected(e) {
  const file = e.target.files[0];
  if (file) processBulkReqFile(file);
}

function processBulkReqFile(file) {
  if (!file.name.match(/\.(xlsx|xls)$/i)) {
    showToast('Please select an .xlsx or .xls file.', 'error'); return;
  }
  document.getElementById('br-file-name').textContent = '📁 ' + file.name;
  const reader = new FileReader();
  reader.onload = function(e) {
    try {
      const wb   = XLSX.read(new Uint8Array(e.target.result), { type: 'array' });
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
      if (!rows.length) { showToast('The file appears to be empty.', 'error'); return; }
      bulkReqParsed = rows;
      showBulkReqPreview(rows);
    } catch(err) {
      showToast('Failed to parse file: ' + err.message, 'error');
    }
  };
  reader.readAsArrayBuffer(file);
}

function showBulkReqPreview(rows) {
  document.getElementById('br-preview-head').innerHTML =
    '<tr>' + BR_COLS.map(c =>
      `<th style="padding:8px 10px;text-align:left;font-family:var(--font-ui);font-size:0.72rem;color:var(--text2);white-space:nowrap">${c}</th>`
    ).join('') + '</tr>';

  const preview = rows.slice(0, 50);
  document.getElementById('br-preview-body').innerHTML = preview.map((row, i) => {
    const bg = i % 2 === 0 ? '' : 'background:var(--bg3)';
    return '<tr style="' + bg + '">' + BR_COLS.map(c => {
      const val     = row[c] !== undefined ? String(row[c]) : '';
      const missing = !val && BR_REQUIRED.includes(c);
      return `<td style="padding:7px 10px;border-top:1px solid var(--border2);${missing ? 'color:#C8102E;font-weight:700' : ''}">${val || (missing ? '⚠ missing' : '—')}</td>`;
    }).join('') + '</tr>';
  }).join('');

  document.getElementById('br-preview-summary').textContent =
    `${rows.length} row${rows.length !== 1 ? 's' : ''} found` + (rows.length > 50 ? ' (showing first 50)' : '');

  document.getElementById('br-step-1').style.display = 'none';
  document.getElementById('br-step-2').style.display = '';
  document.getElementById('br-confirm-btn').style.display = '';
}

async function brConfirmUpload() {
  if (!bulkReqParsed.length) return;
  const btn = document.getElementById('br-confirm-btn');
  btn.disabled = true; btn.textContent = '⏳ Uploading…';

  let res;
  try {
    res = await apiFetch('/requirements/bulk', {
      method: 'POST',
      body: JSON.stringify({ requirements: bulkReqParsed })
    });
  } catch(err) {
    showToast('Upload failed. Please check your connection.', 'error');
    btn.disabled = false; btn.textContent = '🚀 Upload Requirements';
    return;
  }

  document.getElementById('br-step-2').style.display = 'none';
  document.getElementById('br-step-3').style.display = '';
  document.getElementById('br-confirm-btn').style.display = 'none';
  document.getElementById('br-cancel-btn').style.display = 'none';
  document.getElementById('br-done-btn').style.display = '';
  loadRequirements();

  if (!res.success) {
    showToast(res.error || 'Upload failed', 'error');
    btn.disabled = false; btn.textContent = '🚀 Upload Requirements';
    return;
  }

  const d = res.data || {};
  const allOk = d.skipped === 0;
  const box = document.getElementById('br-result-box');
  box.style.background = allOk ? '#edfaf4' : '#fff9ec';
  box.style.border = '1px solid ' + (allOk ? '#52c982' : '#f0ad4e');
  box.innerHTML = `
    <p style="font-family:var(--font-ui);font-weight:800;font-size:1rem;color:${allOk ? '#1a7a46' : '#856404'};margin-bottom:10px">
      ${allOk ? '✅ Upload Complete!' : '⚠️ Upload Complete with Issues'}
    </p>
    <div style="display:flex;gap:24px;flex-wrap:wrap">
      <div>
        <span style="font-size:1.6rem;font-weight:800;color:#1a7a46">${d.inserted || 0}</span>
        <p style="font-size:0.75rem;color:var(--text2);font-family:var(--font-ui)">Requirements Inserted</p>
      </div>
      <div>
        <span style="font-size:1.6rem;font-weight:800;color:#856404">${d.skipped || 0}</span>
        <p style="font-size:0.75rem;color:var(--text2);font-family:var(--font-ui)">Rows Skipped</p>
      </div>
    </div>`;

  if (d.errors && d.errors.length) {
    const wrap = document.getElementById('br-error-table-wrap');
    wrap.style.display = '';
    document.getElementById('br-error-body').innerHTML = d.errors.map(e =>
      `<tr>
        <td style="padding:7px 12px;border-top:1px solid var(--border2)">${e.row}</td>
        <td style="padding:7px 12px;border-top:1px solid var(--border2)">${e.patientName || '—'}</td>
        <td style="padding:7px 12px;border-top:1px solid var(--border2);color:#856404">${e.reason}</td>
      </tr>`
    ).join('');
  }
  showToast(res.message || 'Bulk upload complete!');
}

function downloadReqTemplate() {
  const REQ_COLS = ['patientName','hospital','location','contactPerson','contactPhone','bloodType','unitsRequired','urgency','requiredBy','status','notes'];
  const ws = XLSX.utils.aoa_to_sheet([
    REQ_COLS,
    ['Ravi Kumar', 'PSG Hospital', 'Coimbatore', 'Dr. Anand', '+91 98765 43210', 'O+', 2, 'High', '', 'Open', ''],
    ['Priya Devi', 'KMCH',         'Coimbatore', 'Nurse Meena', '+91 90000 11111', 'B+', 1, 'Medium', '', 'Open', 'Post-surgery'],
  ]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Requirements');
  XLSX.writeFile(wb, 'HSBlood_Requirements_Template.xlsx');
}
