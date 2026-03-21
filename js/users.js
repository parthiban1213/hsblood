// ══════════════════════════════════════════════════════════════
// HSBlood — js/users.js
// User management (admin only)
// ══════════════════════════════════════════════════════════════

// ── USER MANAGEMENT ─────────────────────────────────
let allUsers = [];

async function loadUsers() {
  document.getElementById('um-table-wrap').innerHTML = '<div class="spinner" style="margin:32px auto"></div>';
  const res = await apiFetch('/users');
  if (!res.success) {
    document.getElementById('um-table-wrap').innerHTML = `<div class="empty-state" style="padding:32px"><div class="emoji">⚠️</div><p>${res.error}</p></div>`;
    return;
  }
  allUsers = res.data;
  document.getElementById('um-total').textContent = allUsers.length;
  document.getElementById('um-admins').textContent = allUsers.filter(u => u.role === 'admin').length;
  document.getElementById('um-employees').textContent = allUsers.filter(u => u.role === 'user').length;
  renderUsersTable();
}

function renderUsersTable() {
  const q = (document.getElementById('um-search')?.value || '').toLowerCase();
  const rows = allUsers.filter(u => !q || u.username.includes(q) || (u.email||'').includes(q));
  if (!rows.length) {
    document.getElementById('um-table-wrap').innerHTML = '<div class="empty-state" style="padding:32px"><div class="emoji">👥</div><p>No users found.</p></div>';
    return;
  }
  const me = currentUser?.username;
  document.getElementById('um-table-wrap').innerHTML = `
    <table style="width:100%;border-collapse:collapse;font-size:0.875rem">
      <thead><tr style="background:var(--bg3);border-bottom:2px solid var(--border)">
        <th style="padding:12px 18px;text-align:left;font-family:var(--font-ui);font-size:0.78rem;color:var(--text2);font-weight:600">USERNAME</th>
        <th style="padding:12px 18px;text-align:left;font-family:var(--font-ui);font-size:0.78rem;color:var(--text2);font-weight:600">EMAIL</th>
        <th style="padding:12px 18px;text-align:left;font-family:var(--font-ui);font-size:0.78rem;color:var(--text2);font-weight:600">ROLE</th>
        <th style="padding:12px 18px;text-align:left;font-family:var(--font-ui);font-size:0.78rem;color:var(--text2);font-weight:600">BLOOD TYPE</th>
        <th style="padding:12px 18px;text-align:left;font-family:var(--font-ui);font-size:0.78rem;color:var(--text2);font-weight:600">CREATED</th>
        <th style="padding:12px 18px;text-align:right;font-family:var(--font-ui);font-size:0.78rem;color:var(--text2);font-weight:600">ACTIONS</th>
      </tr></thead>
      <tbody>${rows.map(u => {
        const isMe = u.username === me;
        const roleTag = u.role === 'admin'
          ? '<span style="background:#FEF3C7;color:#92400E;padding:3px 10px;border-radius:20px;font-size:0.75rem;font-family:var(--font-ui);font-weight:600">🛡️ Admin</span>'
          : '<span style="background:var(--border2);color:var(--text2);padding:3px 10px;border-radius:20px;font-size:0.75rem;font-family:var(--font-ui);font-weight:600">👤 Employee</span>';
        const youTag = isMe ? ' <span style="font-size:0.68rem;background:var(--red-light);color:var(--red);padding:2px 7px;border-radius:20px;font-family:var(--font-ui)">You</span>' : '';
        const safeU = JSON.stringify(u).replace(/\\/g,'\\\\').replace(/`/g,'\\`');
        return `<tr data-testid="user-row" data-id="${u._id}" style="border-bottom:1px solid var(--border2)">
          <td style="padding:13px 18px;font-weight:600;color:var(--text)">${u.username}${youTag}</td>
          <td style="padding:13px 18px;color:var(--text2)">${u.email || '<span style="color:var(--text3)">—</span>'}</td>
          <td style="padding:13px 18px">${roleTag}</td>
          <td style="padding:13px 18px">${u.bloodType ? `<span class="blood-badge">${u.bloodType}</span>` : '<span style="color:var(--text3)">—</span>'}</td>
          <td style="padding:13px 18px;color:var(--text2)">${new Date(u.createdAt).toLocaleDateString()}</td>
          <td style="padding:13px 18px;text-align:right">
            <div style="display:flex;gap:6px;justify-content:flex-end">
              <button data-testid="user-edit-btn" data-id="${u._id}" class="btn btn-outline btn-sm" onclick='openUserModal(${JSON.stringify(u)})'>✏️ Edit</button>
              ${!isMe ? `<button data-testid="user-delete-btn" data-id="${u._id}" class="btn btn-danger btn-sm" onclick="deleteUser('${u._id}','${u.username}')">🗑</button>` : ''}
            </div>
          </td>
        </tr>`;
      }).join('')}
      </tbody>
    </table>`;
}

function openUserModal(user) {
  const errEl = document.getElementById('um-error');
  errEl.style.display = 'none'; errEl.textContent = '';
  const editing = user && user._id;
  document.getElementById('um-id').value = editing ? user._id : '';
  document.getElementById('um-username').value  = editing ? user.username     : '';
  document.getElementById('um-email').value     = editing ? (user.email || '') : '';
  document.getElementById('um-role').value      = editing ? user.role          : 'user';
  document.getElementById('um-bloodtype').value = editing ? (user.bloodType || '') : '';
  document.getElementById('um-password').value  = '';
  document.getElementById('user-modal-title').textContent = editing ? 'Edit User' : 'Add User';
  document.getElementById('um-password-label').textContent = editing ? 'New Password' : 'Password *';
  document.getElementById('um-password-hint').style.display = editing ? '' : 'none';
  document.getElementById('um-save-btn').textContent = editing ? '💾 Save Changes' : '💾 Save User';
  openModal('user-modal');
}

async function saveUser() {
  const errEl = document.getElementById('um-error');
  errEl.style.display = 'none';
  const id = document.getElementById('um-id').value;
  const body = {
    username:  document.getElementById('um-username').value.trim(),
    email:     document.getElementById('um-email').value.trim(),
    role:      document.getElementById('um-role').value,
    bloodType: document.getElementById('um-bloodtype').value,
    password:  document.getElementById('um-password').value,
  };
  if (!id && !body.password) {
    errEl.textContent = 'Password is required for new users.';
    errEl.style.display = 'block'; return;
  }
  const btn = document.getElementById('um-save-btn');
  btn.disabled = true; btn.textContent = 'Saving…';
  let res;
  try {
    res = id
      ? await apiFetch('/users/' + id, { method: 'PUT',  body: JSON.stringify(body) })
      : await apiFetch('/users',        { method: 'POST', body: JSON.stringify(body) });
  } catch(err) {
    showToast('Request failed. Please check your connection.','error');
    btn.disabled = false;
    btn.textContent = id ? '💾 Save Changes' : '💾 Save User';
    return;
  }
  btn.disabled = false;
  btn.textContent = id ? '💾 Save Changes' : '💾 Save User';
  if (res.success) {
    showToast(res.message);
    closeModal('user-modal');
    loadUsers();
  } else {
    errEl.textContent = res.error;
    errEl.style.display = 'block';
  }
}

async function deleteUser(id, username) {
  showDeleteConfirm(
    'Delete User',
    `Delete user "${username}"? They will lose all access immediately. This cannot be undone.`,
    async () => {
      const res = await apiFetch('/users/' + id, { method: 'DELETE' });
      if (res.success) { showToast(res.message); loadUsers(); }
      else showToast(res.error, 'error');
    }
  );
}
