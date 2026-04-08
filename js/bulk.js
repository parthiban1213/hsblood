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
  const cols = ['firstName','lastName','phone','bloodType','email','address','lastDonationDate','isAvailable'];
  const required = ['firstName','lastName','phone','bloodType'];

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
      const missing = !val && required.includes(c);
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
    }, 0, 60000);

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
  const headers   = ['firstName','lastName','phone','bloodType','email','address','lastDonationDate','isAvailable'];
  const sampleRow = ['Arjun','Kumar','9876543210','O+','arjun@example.com','Chennai, Tamil Nadu','2024-01-15','true'];
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([headers, sampleRow]);
  ws['!cols'] = headers.map(h => ({ wch: Math.max(h.length + 4, 18) }));
  XLSX.utils.book_append_sheet(wb, ws, 'Donors');
  XLSX.writeFile(wb, 'HSBlood_Donor_Template.xlsx');
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
    }, 0, 60000);
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
    }, 0, 60000);
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
