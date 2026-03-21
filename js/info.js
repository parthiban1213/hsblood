// ══════════════════════════════════════════════════════════════
// HSBlood — js/info.js
// Info directory, list/map view, Leaflet, geocoding, CRUD
// ══════════════════════════════════════════════════════════════

// ── INFO DIRECTORY (Leaflet + OpenStreetMap) ────────

let allInfoEntries  = [];
let infoTabFilter   = 'all';
let infoCurrentView = 'list';

// Leaflet instances
let lfMap         = null;   // main directory map
let lfPickerMap   = null;   // modal picker map
let lfPickerMarker= null;   // draggable pin in picker
let lfMarkers     = [];     // { id, marker, popup } for directory map

// ── Shared: filtered entries ──────────────────────
function getFilteredEntries() {
  const q = (document.getElementById('info-search').value || '').toLowerCase();
  let list = allInfoEntries;
  if (infoTabFilter !== 'all') list = list.filter(e => e.category === infoTabFilter);
  if (q) list = list.filter(e =>
    (e.name||'').toLowerCase().includes(q) ||
    (e.area||'').toLowerCase().includes(q) ||
    (e.phone||'').toLowerCase().includes(q) ||
    (e.address||'').toLowerCase().includes(q)
  );
  return list;
}

// ── Load data ─────────────────────────────────────
async function loadInfo() {
  document.getElementById('info-admin-btn').innerHTML = isAdmin()
    ? `<button id="btn-open-info-modal" class="btn btn-primary" onclick="openInfoModal()">➕ Add Entry</button>
       <button id="btn-open-bulk-info-modal" class="btn btn-outline" onclick="openBulkInfoModal()" style="margin-left:8px">📥 Bulk Upload</button>`
    : `<span class="lock-badge">🔒 View Only</span>`;

  document.getElementById('info-grid').innerHTML = '<div class="spinner"></div>';
  const res = await apiFetch('/info');
  if(res.success){
    allInfoEntries = res.data || [];
    renderCurrentInfoView();
  } else {
    document.getElementById('info-grid').innerHTML =
      `<div class="empty-state" style="grid-column:1/-1">
        <div class="emoji">⚠️</div>
        <h4>Failed to load directory</h4>
        <p>${res.error||'Could not connect to the server.'}</p>
        <button id="btn-info-retry" class="btn btn-outline" style="margin-top:12px" onclick="loadInfo()">↻ Retry</button>
      </div>`;
  }
}

// ── View toggle ───────────────────────────────────
function setInfoView(view) {
  infoCurrentView = view;
  document.getElementById('info-toggle-list').classList.toggle('active', view === 'list');
  document.getElementById('info-toggle-map').classList.toggle('active',  view === 'map');
  document.getElementById('info-list-view').style.display = view === 'list' ? '' : 'none';
  document.getElementById('info-map-view').style.display  = view === 'map'  ? '' : 'none';
  if (view === 'map') {
    renderMapSidebar();
    if (!lfMap) {
      // Small delay so the container is visible before Leaflet measures it
      setTimeout(initDirectoryMap, 60);
    } else {
      lfMap.invalidateSize();
      refreshMapMarkers();
    }
  }
}

// ── Category tab ──────────────────────────────────
function setInfoTab(tab, btn) {
  infoTabFilter = tab;
  document.querySelectorAll('.info-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  renderCurrentInfoView();
}

function filterInfo() { renderCurrentInfoView(); }

function renderCurrentInfoView() {
  if (infoCurrentView === 'list') {
    renderInfoGrid();
  } else {
    renderMapSidebar();
    refreshMapMarkers();
  }
}

// ── LIST VIEW ─────────────────────────────────────
function renderInfoGrid() {
  const entries = getFilteredEntries();
  const grid    = document.getElementById('info-grid');
  if (!entries.length) {
    grid.innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div class="emoji">📭</div><h4>No entries found</h4><p>No records match your search.</p></div>`;
    return;
  }
  grid.innerHTML = entries.map(e => {
    const isAmb     = e.category === 'Ambulance';
    const isBlood   = e.category === 'Blood Bank';
    const iconCls   = isAmb ? 'ambulance' : isBlood ? 'bloodbank' : 'hospital';
    const icon      = isAmb ? '🚑' : isBlood ? '🩸' : '🏥';
    const hasCoords = e.lat && e.lng;
    const osmUrl    = hasCoords
      ? `https://www.openstreetmap.org/?mlat=${e.lat}&mlon=${e.lng}#map=16/${e.lat}/${e.lng}`
      : e.address ? `https://www.openstreetmap.org/search?query=${encodeURIComponent(e.name+' '+e.address)}` : null;
    const adminBtns = isAdmin()
      ? `<button data-testid="info-card-edit-btn" data-id="${e._id}" class="btn btn-sm btn-outline" onclick="editInfoEntry('${e._id}')">✏️ Edit</button>
         <button data-testid="info-card-delete-btn" data-id="${e._id}" class="btn btn-sm btn-danger"  onclick="deleteInfoEntry('${e._id}','${(e.name||'').replace(/'/g,"\\'")}')">🗑</button>`
      : '';
    return `
    <div data-testid="info-card" data-id="${e._id}" class="info-card">
      <div class="info-card-header">
        <div class="info-card-icon ${iconCls}">${icon}</div>
        <div style="flex:1;min-width:0">
          <div class="info-card-name">${e.name}</div>
          ${e.area ? `<div class="info-card-area">📍 ${e.area}</div>` : ''}
        </div>
      </div>
      <div class="info-card-phone">📞 <a href="tel:${e.phone}">${e.phone}</a></div>
      <div class="info-card-meta">
        <span style="font-family:var(--font-ui);font-size:0.7rem;font-weight:700;padding:2px 8px;border-radius:5px;
          background:${isAmb?'#FFF7ED':isBlood?'#FFF1F2':'#EFF6FF'};color:${isAmb?'#C2410C':isBlood?'#BE123C':'#1D4ED8'};
          border:1px solid ${isAmb?'#FED7AA':isBlood?'#FECDD3':'#BFDBFE'}">${e.category}</span>
        ${e.available24h ? '<span class="info-badge-24h">✅ 24 hrs</span>' : ''}
        ${hasCoords ? '<span style="font-size:0.68rem;color:var(--text3);font-family:var(--font-ui)">📌 Mapped</span>' : ''}
      </div>
      ${e.address ? `<div style="font-size:0.76rem;color:var(--text2)">🏠 ${e.address}</div>` : ''}
      ${osmUrl    ? `<a href="${osmUrl}" target="_blank" rel="noopener"
          style="display:inline-flex;align-items:center;gap:5px;font-size:0.75rem;font-family:var(--font-ui);
          font-weight:600;color:#1D4ED8;text-decoration:none;margin-top:2px">🗺 View on OpenStreetMap</a>` : ''}
      ${e.notes   ? `<div class="info-card-notes">${e.notes}</div>` : ''}
      ${isAdmin() ? `<div class="info-card-actions">${adminBtns}</div>` : ''}
    </div>`;
  }).join('');
}

// ── MAP VIEW: init Leaflet directory map ──────────
function initDirectoryMap() {
  const el = document.getElementById('info-map');
  if (!el || !window.L) return;

  lfMap = L.map('info-map', { zoomControl: true }).setView([20.5937, 78.9629], 5);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19
  }).addTo(lfMap);

  refreshMapMarkers();
}

// ── MAP VIEW: sidebar ─────────────────────────────
function renderMapSidebar() {
  const entries = getFilteredEntries();
  const sidebar = document.getElementById('info-map-sidebar');
  if (!sidebar) return;

  if (!entries.length) {
    sidebar.innerHTML = `<div style="text-align:center;padding:24px 12px;color:var(--text3);font-size:0.8rem;font-family:var(--font-ui)">No entries found</div>`;
    return;
  }

  sidebar.innerHTML = entries.map(e => {
    const has = e.lat && e.lng;
    return `<div class="info-map-item${has ? '' : ' info-map-no-coords'}" id="mapitem-${e._id}"
        onclick="${has ? `focusMapMarker('${e._id}')` : ''}"
        title="${has ? 'Click to focus on map' : 'No coordinates — edit entry to add location'}">
      <div class="info-map-item-name">${e.category==='Ambulance'?'🚑':e.category==='Blood Bank'?'🩸':'🏥'} ${e.name}</div>
      ${e.area    ? `<div class="info-map-item-sub">📍 ${e.area}</div>` : ''}
      ${e.address ? `<div class="info-map-item-sub" style="font-size:0.7rem">🏠 ${e.address}</div>` : ''}
      <div class="info-map-item-phone">📞 ${e.phone}</div>
      ${!has ? `<div style="font-size:0.68rem;color:var(--text3);margin-top:3px">⚠ No map pin — edit to add</div>` : ''}
      ${isAdmin() ? `<div style="display:flex;gap:5px;margin-top:7px" onclick="event.stopPropagation()">
        <button data-testid="info-map-edit-btn" data-id="${e._id}" class="btn btn-sm btn-outline" onclick="editInfoEntry('${e._id}')">✏️</button>
        <button data-testid="info-map-delete-btn" data-id="${e._id}" class="btn btn-sm btn-danger"  onclick="deleteInfoEntry('${e._id}','${(e.name||'').replace(/'/g,"\\'")}')">🗑</button>
      </div>` : ''}
    </div>`;
  }).join('');
}

// ── MAP VIEW: markers ─────────────────────────────
function makeCircleIcon(color) {
  return L.divIcon({
    className: '',
    html: `<div style="width:22px;height:22px;border-radius:50%;background:${color};
           border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,0.35)"></div>`,
    iconSize: [22, 22],
    iconAnchor: [11, 11],
    popupAnchor: [0, -13]
  });
}

function refreshMapMarkers() {
  if (!lfMap) return;

  // Remove old markers
  lfMarkers.forEach(m => m.marker.remove());
  lfMarkers = [];

  const entries = getFilteredEntries();
  const bounds  = [];

  entries.forEach(e => {
    if (!e.lat || !e.lng) return;
    const lat    = parseFloat(e.lat);
    const lng    = parseFloat(e.lng);
    const isAmb  = e.category === 'Ambulance';
    const isBlood = e.category === 'Blood Bank';
    const color  = isAmb ? '#EA580C' : isBlood ? '#BE123C' : '#C8102E';
    const osmUrl = `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=16/${lat}/${lng}`;

    const marker = L.marker([lat, lng], { icon: makeCircleIcon(color) });

    const popupHtml = `
      <div style="min-width:210px;padding:14px 16px;font-family:'DM Sans',sans-serif">
        <div style="font-family:'Syne',sans-serif;font-weight:800;font-size:0.95rem;color:#18213A;margin-bottom:5px">
          ${isAmb ? '🚑' : '🏥'} ${e.name}
        </div>
        ${e.area    ? `<div style="font-size:0.77rem;color:#566080;margin-bottom:2px">📍 ${e.area}</div>` : ''}
        ${e.address ? `<div style="font-size:0.75rem;color:#566080;margin-bottom:6px">🏠 ${e.address}</div>` : ''}
        <div style="background:#FEF1F3;border-radius:7px;padding:7px 10px;margin-bottom:6px">
          <a href="tel:${e.phone}" style="font-size:0.85rem;font-weight:700;color:#C8102E;text-decoration:none;font-family:'Syne',sans-serif">
            📞 ${e.phone}
          </a>
        </div>
        ${e.available24h ? `<div style="font-size:0.7rem;background:#EDFBF3;color:#15803D;border:1px solid #BBF7D0;border-radius:5px;padding:2px 8px;display:inline-block;margin-bottom:6px">✅ Available 24 hours</div>` : ''}
        ${e.notes ? `<div style="font-size:0.75rem;color:#566080;border-top:1px solid #eee;padding-top:6px;margin-top:4px;line-height:1.5">${e.notes}</div>` : ''}
        <a href="${osmUrl}" target="_blank" rel="noopener"
           style="display:block;margin-top:10px;font-size:0.75rem;font-family:'Syne',sans-serif;font-weight:700;color:#1D4ED8;text-decoration:none">
          🗺 Open in OpenStreetMap →
        </a>
      </div>`;

    marker.bindPopup(popupHtml, { className: 'lf-popup', maxWidth: 280 });

    marker.on('click', () => {
      // Highlight sidebar item
      document.querySelectorAll('.info-map-item').forEach(el => el.classList.remove('active'));
      const item = document.getElementById('mapitem-' + e._id);
      if (item) { item.classList.add('active'); item.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
    });

    marker.addTo(lfMap);
    lfMarkers.push({ id: e._id, marker });
    bounds.push([lat, lng]);
  });

  if (bounds.length === 1) {
    lfMap.setView(bounds[0], 15);
  } else if (bounds.length > 1) {
    lfMap.fitBounds(bounds, { padding: [40, 40] });
  }
}

function focusMapMarker(id) {
  const found = lfMarkers.find(m => m.id === id);
  if (!found || !lfMap) return;
  lfMap.setView(found.marker.getLatLng(), 16, { animate: true });
  found.marker.openPopup();
  document.querySelectorAll('.info-map-item').forEach(el => el.classList.remove('active'));
  const item = document.getElementById('mapitem-' + id);
  if (item) item.classList.add('active');
}

// ── MODAL PICKER MAP (Leaflet) ────────────────────
function initPickerMap(lat, lng) {
  const el = document.getElementById('info-picker-map');
  if (!el || !window.L) return;

  // Destroy previous instance if any
  if (lfPickerMap) { lfPickerMap.remove(); lfPickerMap = null; lfPickerMarker = null; }

  const centerLat = lat || 11.0168;
  const centerLng = lng || 76.9558;
  const zoom      = lat ? 15 : 9;

  lfPickerMap = L.map(el, { zoomControl: true }).setView([centerLat, centerLng], zoom);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 19
  }).addTo(lfPickerMap);

  // Drop existing pin if coords provided
  if (lat && lng) {
    lfPickerMarker = L.marker([lat, lng], { draggable: true }).addTo(lfPickerMap);
    lfPickerMarker.on('dragend', ev => {
      const p = ev.target.getLatLng();
      setPickerCoords(p.lat, p.lng);
    });
  }

  // Click anywhere to place / move pin
  lfPickerMap.on('click', ev => {
    const { lat, lng } = ev.latlng;
    setPickerCoords(lat, lng);
    if (lfPickerMarker) lfPickerMarker.remove();
    lfPickerMarker = L.marker([lat, lng], { draggable: true }).addTo(lfPickerMap);
    lfPickerMarker.on('dragend', ev2 => {
      const p = ev2.target.getLatLng();
      setPickerCoords(p.lat, p.lng);
    });
  });
}

function setPickerCoords(lat, lng) {
  document.getElementById('info-lat').value = parseFloat(lat).toFixed(6);
  document.getElementById('info-lng').value = parseFloat(lng).toFixed(6);
}

// Called when user types into lat/lng inputs manually
function onManualLatLng() {
  const lat = parseFloat(document.getElementById('info-lat').value);
  const lng = parseFloat(document.getElementById('info-lng').value);
  if (isNaN(lat) || isNaN(lng) || !lfPickerMap) return;
  lfPickerMap.setView([lat, lng], 15);
  if (lfPickerMarker) lfPickerMarker.remove();
  lfPickerMarker = L.marker([lat, lng], { draggable: true }).addTo(lfPickerMap);
  lfPickerMarker.on('dragend', ev => {
    const p = ev.target.getLatLng();
    setPickerCoords(p.lat, p.lng);
  });
}

// Nominatim free geocoding (no API key needed)
async function nominatimSearch() {
  const q = document.getElementById('info-geocode-query').value.trim();
  if (!q) { showToast('Enter an address to search', 'warn'); return; }
  try {
    const url  = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1`;
    const resp = await fetch(url, { headers: { 'Accept-Language': 'en' } });
    const data = await resp.json();
    if (!data.length) { showToast('Address not found — try a broader search', 'warn'); return; }
    const lat = parseFloat(data[0].lat);
    const lng = parseFloat(data[0].lon);
    setPickerCoords(lat, lng);
    if (!lfPickerMap) { initPickerMap(lat, lng); return; }
    lfPickerMap.setView([lat, lng], 16);
    if (lfPickerMarker) lfPickerMarker.remove();
    lfPickerMarker = L.marker([lat, lng], { draggable: true }).addTo(lfPickerMap);
    lfPickerMarker.on('dragend', ev => {
      const p = ev.target.getLatLng();
      setPickerCoords(p.lat, p.lng);
    });
  } catch(err) { showToast('Search failed: ' + err.message, 'error'); }
}

// ── CRUD ──────────────────────────────────────────
function openInfoModal() {
  if (!isAdmin()) { showToast('Admin access required.', 'warn'); return; }
  document.getElementById('info-modal-title').textContent = 'Add Entry';
  document.getElementById('info-form').reset();
  document.getElementById('info-id').value = '';
  document.getElementById('info-geocode-query').value = '';
  document.getElementById('info-dup-warn').style.display = 'none';
  // Wire duplicate checks on blur
  document.getElementById('info-name').onblur  = checkInfoDuplicate;
  document.getElementById('info-phone').onblur = checkInfoDuplicate;
  lfPickerMap = null; lfPickerMarker = null;
  openModal('info-modal');
  setTimeout(() => initPickerMap(), 250);
}

async function editInfoEntry(id) {
  if (!isAdmin()) { showToast('Admin access required.', 'warn'); return; }
  const res = await apiFetch('/info/' + id);
  if (!res.success) { showToast(res.error, 'error'); return; }
  const e = res.data;
  document.getElementById('info-modal-title').textContent  = 'Edit Entry';
  document.getElementById('info-id').value                 = e._id;
  document.getElementById('info-category').value           = e.category || '';
  document.getElementById('info-name').value               = e.name || '';
  document.getElementById('info-phone').value              = e.phone || '';
  document.getElementById('info-area').value               = e.area || '';
  document.getElementById('info-address').value            = e.address || '';
  document.getElementById('info-notes').value              = e.notes || '';
  document.getElementById('info-available24h').checked     = !!e.available24h;
  document.getElementById('info-lat').value                = e.lat || '';
  document.getElementById('info-lng').value                = e.lng || '';
  document.getElementById('info-geocode-query').value      = e.address || '';
  lfPickerMap = null; lfPickerMarker = null;
  openModal('info-modal');
  const lat = e.lat ? parseFloat(e.lat) : null;
  const lng = e.lng ? parseFloat(e.lng) : null;
  setTimeout(() => initPickerMap(lat, lng), 250);
}

async function saveInfoEntry(evt) {
  if (evt) evt.preventDefault();
  const id  = document.getElementById('info-id').value;
  // Users can add but not edit existing entries
  if (id && !isAdmin()) { showToast('Editing entries requires Admin access.', 'warn'); return; }
  const btn = document.getElementById('save-info-btn');
  btn.disabled = true; btn.textContent = 'Saving…';
  const latVal = parseFloat(document.getElementById('info-lat').value);
  const lngVal = parseFloat(document.getElementById('info-lng').value);
  const body = {
    category:    document.getElementById('info-category').value,
    name:        document.getElementById('info-name').value,
    phone:       document.getElementById('info-phone').value,
    area:        document.getElementById('info-area').value,
    address:     document.getElementById('info-address').value,
    notes:       document.getElementById('info-notes').value,
    available24h:document.getElementById('info-available24h').checked,
    lat:         isNaN(latVal) ? null : latVal,
    lng:         isNaN(lngVal) ? null : lngVal,
  };
  try {
    const res = id
      ? await apiFetch('/info/' + id, { method: 'PUT',  body: JSON.stringify(body) })
      : await apiFetch('/info',       { method: 'POST', body: JSON.stringify(body) });
    if (res.success) {
      document.getElementById('info-dup-warn').style.display = 'none';
      showToast(res.message || 'Saved!');
      closeModal('info-modal');
      await loadInfo();
      if (infoCurrentView === 'map') { renderMapSidebar(); refreshMapMarkers(); }
    } else {
      if (res.status===409||res.error?.toLowerCase().includes('already exists')||res.error?.toLowerCase().includes('duplicate')) {
        document.getElementById('info-dup-msg').textContent = res.error;
        document.getElementById('info-dup-warn').style.display = '';
      }
      showToast(res.error, 'error');
    }
  } catch(err) {
    showToast('Request failed. Please check your connection.','error');
  } finally {
    btn.disabled = false; btn.textContent = '💾 Save Entry';
  }
}

async function deleteInfoEntry(id, name) {
  if (!isAdmin()) { showToast('Admin access required.', 'warn'); return; }
  showDeleteConfirm(
    'Delete Entry',
    `Delete "${name}" from the info directory? This action cannot be undone.`,
    async () => {
      const res = await apiFetch('/info/' + id, { method: 'DELETE' });
      if (res.success) { showToast(res.message); loadInfo(); }
      else showToast(res.error, 'error');
    }
  );
}
