const cfg = window.HR_CONFIG || {};
let sb = null;
let state = {
  session: null, profile: null, view: 'dashboard',
  employees: [], contracts: [], leave: [], warnings: [],
  companies: [], branches: [], departments: [], positions: [],
  masterTab: 'companies',
  masterF: { company: '', status: 'all' },
  empF: { q: '', company: '', branch: '', department: '', position: '', status: '' }
};

/* ---------- Helpers ---------- */
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
const fmtDate = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('id-ID') : '-';
const daysUntil = d => d ? Math.ceil((new Date(d + 'T00:00:00') - new Date()) / 86400000) : null;
// Data lama tanpa kolom is_active dianggap aktif
const isActive = r => r.is_active !== false;

function configured() {
  return cfg.SUPABASE_URL && !cfg.SUPABASE_URL.includes('PASTE_') && cfg.SUPABASE_ANON_KEY && !cfg.SUPABASE_ANON_KEY.includes('PASTE_');
}

function toast(msg, type = 'success') {
  let box = $('#toasts');
  if (!box) { box = document.createElement('div'); box.id = 'toasts'; document.body.appendChild(box); }
  const t = document.createElement('div');
  t.className = 'toast toast-' + type;
  t.setAttribute('role', 'status');
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.remove(), type === 'error' ? 6500 : 3500);
}

function friendlyError(e) {
  const m = (e && e.message) || String(e || '');
  const c = e && e.code;
  if (c === '23505' || /duplicate key/i.test(m)) return 'Data sudah ada (duplikat). Periksa nama atau kode yang sama.';
  if (c === '42501' || /row-level security|permission denied/i.test(m)) return 'Anda tidak punya izin untuk operasi ini. Pastikan SQL migration Phase 2 (policy RLS) sudah dijalankan.';
  if (c === '23503') return 'Data masih terhubung dengan data lain, sehingga tidak bisa diubah.';
  if (c === '23502') return 'Ada kolom wajib yang belum terisi. ' + m;
  if (c === '42703' || c === 'PGRST204' || /column .* does not exist|schema cache/i.test(m)) return 'Kolom database belum tersedia. Jalankan SQL migration Phase 2 terlebih dahulu. (' + m + ')';
  if (/failed to fetch|network/i.test(m)) return 'Koneksi internet bermasalah. Coba lagi.';
  return 'Terjadi kesalahan: ' + m;
}
const PERMISSION_MSG = 'Perubahan tidak tersimpan. Kemungkinan akun Anda belum punya izin (policy RLS). Jalankan SQL migration Phase 2.';

/* ---------- Init & Auth ---------- */
async function init() {
  if (!configured()) { renderConfigHelp(); return; }
  sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const { data: { session } } = await sb.auth.getSession();
  state.session = session;
  sb.auth.onAuthStateChange((_e, s) => {
    state.session = s;
    if (s) { if (!state.profile) loadProfile(); }      // token refresh tidak me-reset halaman / modal
    else { state.profile = null; renderLogin(); }
  });
  if (session) await loadProfile(); else renderLogin();
}

function renderConfigHelp() {
  document.querySelector('#app').innerHTML = `<div class="login"><div class="login-card"><div class="brand">HR Employee System</div><div class="subtitle">Konfigurasi Supabase belum diisi.</div><p class="muted">Buka <b>config.js</b>, lalu isi SUPABASE_URL dan SUPABASE_ANON_KEY dari project Supabase Anda.</p></div></div>`;
}

function renderLogin(msg = '') {
  document.querySelector('#app').innerHTML = `<div class="login"><form class="login-card" id="loginForm"><div class="brand">HR Employee System</div><div class="subtitle">Employee Database & HR Tracking</div><div class="field"><label>Email</label><input id="email" type="email" required value=""></div><div class="field"><label>Password</label><input id="password" type="password" required></div>${msg ? `<div class="error">${esc(msg)}</div>` : ''}<button class="btn btn-primary btn-block">Masuk</button></form></div>`;
  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const { error } = await sb.auth.signInWithPassword({ email: $('#email').value, password: $('#password').value });
    if (error) renderLogin(error.message);
  });
}

async function loadProfile() {
  const { data, error } = await sb.from('profiles').select('*').eq('id', state.session.user.id).maybeSingle();
  if (error || !data) { renderLogin('Profil admin belum terdaftar. Pastikan akun Anda sudah dibuat di Supabase.'); return; }
  state.profile = data;
  await loadAll();
  renderApp();
}

async function loadAll() {
  const queries = await Promise.all([
    sb.from('employees').select('*, companies(name), branches(name), departments(name), positions(name)').order('full_name'),
    sb.from('contracts').select('*').order('end_date', { ascending: true }),
    sb.from('leave_requests').select('*, employees(full_name)').order('start_date', { ascending: false }),
    sb.from('warnings').select('*, employees(full_name)').order('issue_date', { ascending: false }),
    sb.from('companies').select('*').order('name'),
    sb.from('branches').select('*').order('name'),
    sb.from('departments').select('*').order('name'),
    sb.from('positions').select('*').order('name')
  ]);
  const names = ['karyawan', 'kontrak', 'cuti', 'teguran', 'perusahaan', 'outlet', 'departemen', 'jabatan'];
  const failed = queries.map((q, i) => q.error ? names[i] : null).filter(Boolean);
  if (failed.length) toast('Gagal memuat data: ' + failed.join(', ') + '. ' + friendlyError(queries.find(q => q.error).error), 'error');
  state.employees = queries[0].data || []; state.contracts = queries[1].data || []; state.leave = queries[2].data || []; state.warnings = queries[3].data || [];
  state.companies = queries[4].data || []; state.branches = queries[5].data || []; state.departments = queries[6].data || []; state.positions = queries[7].data || [];
}

/* ---------- Shell ---------- */
function renderApp() {
  const labels = { dashboard: 'Dashboard', employees: 'Karyawan', contracts: 'Kontrak', leave: 'Cuti', warnings: 'Teguran / SP', master: 'Master Data' };
  document.querySelector('#app').innerHTML = `<div class="shell"><aside class="sidebar"><div class="logo">HR Employee System</div><div class="nav">${Object.keys(labels).map(v => `<button class="${state.view === v ? 'active' : ''}" data-view="${v}">${labels[v]}</button>`).join('')}</div></aside><main class="main"><div class="topbar"><h1>${title()}</h1><div class="userbox"><span>${esc(state.profile.full_name || state.session.user.email)}</span><span class="avatar">${esc((state.profile.full_name || 'A')[0].toUpperCase())}</span><button id="logout" class="btn btn-light">Keluar</button></div></div><div id="content"></div></main></div>`;
  document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { state.view = b.dataset.view; renderApp(); });
  $('#logout').onclick = async () => { await sb.auth.signOut(); };
  renderView();
}
function title() { return { dashboard: 'Dashboard', employees: 'Database Karyawan', contracts: 'Kontrak Karyawan', leave: 'Cuti Karyawan', warnings: 'Surat Teguran / SP', master: 'Master Data' }[state.view]; }
function renderView() {
  if (state.view === 'dashboard') return dashboard();
  if (state.view === 'employees') return employees();
  if (state.view === 'contracts') return contracts();
  if (state.view === 'leave') return leave();
  if (state.view === 'warnings') return warnings();
  master();
}

/* ---------- Dashboard ---------- */
function dashboard() {
  const active = state.employees.filter(e => e.employment_status === 'active').length;
  const exp = state.contracts.filter(c => { const n = daysUntil(c.end_date); return c.status === 'active' && n !== null && n >= 0 && n <= 30; }).length;
  const onleave = state.leave.filter(l => l.status === 'approved' && new Date(l.start_date) <= new Date() && new Date(l.end_date) >= new Date()).length;
  const warn = state.warnings.filter(w => w.status === 'active').length;
  $('#content').innerHTML = `<div class="cards"><div class="card"><div class="muted">Karyawan Aktif</div><div class="metric">${active}</div></div><div class="card"><div class="muted">Kontrak ≤ 30 Hari</div><div class="metric">${exp}</div></div><div class="card"><div class="muted">Sedang Cuti</div><div class="metric">${onleave}</div></div><div class="card"><div class="muted">Teguran Aktif</div><div class="metric">${warn}</div></div></div><div class="section"><div class="section-head"><h2>Perusahaan</h2></div><div class="cards">${state.companies.map(c => `<div class="card"><div class="muted">${esc(c.name)}</div><div class="metric">${state.employees.filter(e => e.company_id === c.id).length}</div><div class="muted">karyawan</div></div>`).join('')}</div></div><div class="section"><div class="section-head"><h2>Karyawan Terbaru</h2><button class="btn btn-primary" onclick="showEmployeeForm()">+ Tambah Karyawan</button></div>${employeeTable(state.employees.slice(0, 8))}</div>`;
}

/* ---------- Karyawan ---------- */
function employeeTable(rows) {
  if (!rows.length) return '<div class="card empty">Belum ada data karyawan.</div>';
  return `<div class="table-wrap"><table class="table"><thead><tr><th>ID</th><th>Nama</th><th>Perusahaan</th><th>Outlet</th><th>Departemen</th><th>Jabatan</th><th>Status</th><th>Mulai</th></tr></thead><tbody>${rows.map(e => `<tr><td>${esc(e.employee_number)}</td><td><b>${esc(e.full_name)}</b><div class="muted">${esc(e.email || '')}</div></td><td>${esc(e.companies?.name || '-')}</td><td>${esc(e.branches?.name || '-')}</td><td>${esc(e.departments?.name || '-')}</td><td>${esc(e.positions?.name || '-')}</td><td><span class="badge ${e.employment_status === 'active' ? 'badge-green' : 'badge-yellow'}">${esc(e.employment_status)}</span></td><td>${fmtDate(e.join_date)}</td></tr>`).join('')}</tbody></table></div>`;
}

function employees() {
  const f = state.empF;
  const opts = (list, val, label) => `<option value="">${label}</option>` + list.map(x => `<option value="${esc(x.id)}" ${val === x.id ? 'selected' : ''}>${esc(x.name)}${isActive(x) ? '' : ' (nonaktif)'}</option>`).join('');
  // Pilihan filter menyesuaikan perusahaan yang dipilih (data nonaktif tetap ada karena karyawan lama masih memakainya)
  const byCompany = (list, allowGeneral) => f.company ? list.filter(x => x.company_id === f.company || (allowGeneral && !x.company_id)) : list;
  $('#content').innerHTML = `<div class="toolbar"><input id="empSearch" placeholder="Cari nama / ID / NIK..." value="${esc(f.q)}"><select id="companyFilter">${opts(state.companies, f.company, 'Semua perusahaan')}</select><select id="branchFilter">${opts(byCompany(state.branches, false), f.branch, 'Semua outlet')}</select><select id="deptFilter">${opts(byCompany(state.departments, true), f.department, 'Semua departemen')}</select><select id="posFilter">${opts(byCompany(state.positions, true), f.position, 'Semua jabatan')}</select><select id="statusFilter"><option value="">Semua status</option><option value="active" ${f.status === 'active' ? 'selected' : ''}>Aktif</option><option value="inactive" ${f.status === 'inactive' ? 'selected' : ''}>Tidak Aktif</option></select><button class="btn btn-primary" onclick="showEmployeeForm()">+ Tambah Karyawan</button></div><div class="section" id="empTable"></div>`;
  const draw = () => {
    const q = f.q.toLowerCase();
    const rows = state.employees.filter(e =>
      (!q || [e.full_name, e.employee_number, e.nik].join(' ').toLowerCase().includes(q)) &&
      (!f.company || e.company_id === f.company) &&
      (!f.branch || e.branch_id === f.branch) &&
      (!f.department || e.department_id === f.department) &&
      (!f.position || e.position_id === f.position) &&
      (!f.status || e.employment_status === f.status));
    $('#empTable').innerHTML = employeeTable(rows);
  };
  $('#empSearch').oninput = e => { f.q = e.target.value; draw(); };
  $('#companyFilter').onchange = e => { f.company = e.target.value; f.branch = f.department = f.position = ''; employees(); };
  $('#branchFilter').onchange = e => { f.branch = e.target.value; draw(); };
  $('#deptFilter').onchange = e => { f.department = e.target.value; draw(); };
  $('#posFilter').onchange = e => { f.position = e.target.value; draw(); };
  $('#statusFilter').onchange = e => { f.status = e.target.value; draw(); };
  draw();
}

/* ---------- Kontrak / Cuti / Teguran (tidak berubah) ---------- */
function contracts() {
  const rows = state.contracts;
  $('#content').innerHTML = `<div class="section"><div class="section-head"><h2>Daftar Kontrak</h2></div>${rows.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Karyawan</th><th>No. Kontrak</th><th>Jenis</th><th>Mulai</th><th>Berakhir</th><th>Status</th></tr></thead><tbody>${rows.map(c => { const n = daysUntil(c.end_date); let cls = n !== null && n <= 30 ? 'badge-red' : 'badge-green'; return `<tr><td>${esc(state.employees.find(e => e.id === c.employee_id)?.full_name || '-')}</td><td>${esc(c.contract_number || '-')}</td><td>${esc(c.contract_type)}</td><td>${fmtDate(c.start_date)}</td><td>${fmtDate(c.end_date)} ${n !== null ? `<span class="badge ${cls}">${n < 0 ? 'Lewat' : n + ' hari'}</span>` : ''}</td><td>${esc(c.status)}</td></tr>`; }).join('')}</tbody></table></div>` : '<div class="card empty">Belum ada kontrak.</div>'}</div>`;
}
function leave() {
  const rows = state.leave;
  $('#content').innerHTML = `<div class="section"><div class="section-head"><h2>Riwayat Cuti</h2></div>${rows.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Karyawan</th><th>Periode</th><th>Hari</th><th>Alasan</th><th>Status</th></tr></thead><tbody>${rows.map(l => `<tr><td>${esc(l.employees?.full_name || '-')}</td><td>${fmtDate(l.start_date)} - ${fmtDate(l.end_date)}</td><td>${esc(l.total_days)}</td><td>${esc(l.reason || '-')}</td><td><span class="badge ${l.status === 'approved' ? 'badge-green' : l.status === 'pending' ? 'badge-yellow' : 'badge-red'}">${esc(l.status)}</span></td></tr>`).join('')}</tbody></table></div>` : '<div class="card empty">Belum ada pengajuan cuti.</div>'}</div>`;
}
function warnings() {
  const rows = state.warnings;
  $('#content').innerHTML = `<div class="section"><div class="section-head"><h2>Surat Teguran / SP</h2></div>${rows.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Karyawan</th><th>Jenis</th><th>Nomor</th><th>Tanggal</th><th>Perihal</th><th>Status</th></tr></thead><tbody>${rows.map(w => `<tr><td>${esc(w.employees?.full_name || '-')}</td><td>${esc(w.warning_type)}</td><td>${esc(w.warning_number || '-')}</td><td>${fmtDate(w.issue_date)}</td><td>${esc(w.title)}</td><td><span class="badge ${w.status === 'active' ? 'badge-red' : 'badge-yellow'}">${esc(w.status)}</span></td></tr>`).join('')}</tbody></table></div>` : '<div class="card empty">Belum ada surat teguran.</div>'}</div>`;
}

/* ---------- Modal helper ---------- */
// onSubmit(form) -> true jika berhasil (modal ditutup + data dimuat ulang), false jika gagal (modal tetap terbuka)
function openModal(titleText, bodyHtml, onSubmit, submitLabel = 'Simpan') {
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop';
  modal.innerHTML = `<div class="modal"><div class="section-head"><h2>${esc(titleText)}</h2><button type="button" class="btn btn-light" data-close>Tutup</button></div><form>${bodyHtml}<div class="modal-actions"><button type="button" class="btn btn-light" data-close>Batal</button><button type="submit" class="btn btn-primary">${esc(submitLabel)}</button></div></form></div>`;
  document.body.appendChild(modal);
  const close = () => modal.remove();
  modal.querySelectorAll('[data-close]').forEach(b => b.onclick = close);
  const form = modal.querySelector('form');
  form.onsubmit = async e => {
    e.preventDefault();
    const btn = form.querySelector('button[type=submit]');
    const old = btn.textContent;
    btn.disabled = true; btn.textContent = 'Menyimpan...';
    try {
      const ok = await onSubmit(form);
      if (ok) { close(); await loadAll(); renderApp(); }
    } catch (err) {
      toast(friendlyError(err), 'error');
    } finally {
      btn.disabled = false; btn.textContent = old;
    }
  };
  return modal;
}

/* ---------- Master Data ---------- */
const MASTER = {
  companies:   { label: 'Perusahaan', table: 'companies',   empField: 'company_id',    hasCode: true },
  branches:    { label: 'Outlet',     table: 'branches',    empField: 'branch_id',     hasCode: true,  hasCompany: true, companyRequired: true },
  departments: { label: 'Departemen', table: 'departments', empField: 'department_id', hasCompany: true },
  positions:   { label: 'Jabatan',    table: 'positions',   empField: 'position_id',   hasCompany: true }
};

const usageCount = (t, id) => state.employees.filter(e => e[MASTER[t].empField] === id).length;
const companyName = (id, emptyLabel) => id ? (state.companies.find(c => c.id === id)?.name || '-') : emptyLabel;
const statusBadge = r => `<span class="badge ${isActive(r) ? 'badge-green' : 'badge-gray'}">${isActive(r) ? 'Aktif' : 'Tidak Aktif'}</span>`;

function masterList(t) {
  const { company, status } = state.masterF;
  let rows = state[t];
  if (company) {
    if (t === 'companies') rows = rows.filter(r => r.id === company);
    else if (t === 'branches') rows = rows.filter(r => r.company_id === company);
    else rows = rows.filter(r => r.company_id === company || !r.company_id);   // data umum (tanpa perusahaan) ikut tampil
  }
  if (status === 'active') rows = rows.filter(isActive);
  if (status === 'inactive') rows = rows.filter(r => !isActive(r));
  return rows;
}

function masterTable(t, rows) {
  if (!rows.length) return '<div class="card empty">Belum ada data untuk filter ini.</div>';
  const cnt = r => usageCount(t, r.id);
  const nameCol = ['Nama', r => `<b>${esc(r.name)}</b>`];
  const codeCol = ['Kode', r => esc(r.code || '-')];
  const coCol = ['Perusahaan', r => esc(companyName(r.company_id, t === 'branches' ? '-' : 'Semua perusahaan'))];
  const empCol = ['Karyawan', cnt];
  const stCol = ['Status', statusBadge];
  const cols = {
    companies: [['Nama Perusahaan', nameCol[1]], codeCol, stCol, ['Jumlah Outlet', r => state.branches.filter(b => b.company_id === r.id && isActive(b)).length], ['Jumlah Karyawan', cnt]],
    branches: [['Nama Outlet', nameCol[1]], ['Kode Outlet', codeCol[1]], coCol, empCol, stCol],
    departments: [['Nama Departemen', nameCol[1]], coCol, empCol, stCol],
    positions: [['Nama Jabatan', nameCol[1]], coCol, empCol, stCol]
  }[t];
  const actions = r => `<div class="row-actions"><button class="btn btn-light btn-sm" onclick="masterForm('${t}','${esc(r.id)}')">Edit</button>${isActive(r)
    ? `<button class="btn btn-danger btn-sm" onclick="masterDeactivate('${t}','${esc(r.id)}')">Nonaktifkan</button>`
    : `<button class="btn btn-light btn-sm" onclick="masterActivate('${t}','${esc(r.id)}')">Aktifkan</button>`}</div>`;
  return `<div class="table-wrap"><table class="table"><thead><tr>${cols.map(c => `<th>${c[0]}</th>`).join('')}<th>Aksi</th></tr></thead><tbody>${rows.map(r => `<tr>${cols.map(c => `<td>${c[1](r)}</td>`).join('')}<td>${actions(r)}</td></tr>`).join('')}</tbody></table></div>`;
}

function master() {
  const t = state.masterTab, m = MASTER[t], f = state.masterF;
  const activeCount = k => state[k].filter(isActive).length;
  $('#content').innerHTML = `<div class="cards">${Object.keys(MASTER).map(k => `<div class="card card-click ${k === t ? 'card-active' : ''}" onclick="masterTab('${k}')"><b>${MASTER[k].label}</b><div class="metric">${activeCount(k)}</div><div class="muted">aktif${state[k].length !== activeCount(k) ? ' · ' + (state[k].length - activeCount(k)) + ' nonaktif' : ''}</div></div>`).join('')}</div>
  <div class="section"><div class="tabs">${Object.keys(MASTER).map(k => `<button class="${k === t ? 'active' : ''}" onclick="masterTab('${k}')">${MASTER[k].label}</button>`).join('')}</div>
  <div class="toolbar"><select id="mCompany"><option value="">Perusahaan: Semua</option>${state.companies.map(c => `<option value="${esc(c.id)}" ${f.company === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select><select id="mStatus"><option value="all" ${f.status === 'all' ? 'selected' : ''}>Status: Semua</option><option value="active" ${f.status === 'active' ? 'selected' : ''}>Aktif</option><option value="inactive" ${f.status === 'inactive' ? 'selected' : ''}>Tidak Aktif</option></select></div>
  <div class="section-head"><h2>${m.label}</h2><button class="btn btn-primary" onclick="masterForm('${t}')">+ Tambah</button></div>${masterTable(t, masterList(t))}</div>`;
  $('#mCompany').onchange = e => { f.company = e.target.value; master(); };
  $('#mStatus').onchange = e => { f.status = e.target.value; master(); };
}
window.masterTab = k => { state.masterTab = k; master(); };

window.masterForm = (t, id) => {
  const m = MASTER[t];
  const rec = id ? state[t].find(r => r.id === id) : null;
  const selCompany = rec ? rec.company_id : state.masterF.company;
  const coOptions = state.companies.filter(c => isActive(c) || c.id === selCompany)
    .map(c => `<option value="${esc(c.id)}" ${selCompany === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  const body = `<div class="modal-grid">
    <div class="field"><label>Nama ${esc(m.label)} *</label><input name="name" required value="${esc(rec?.name || '')}"></div>
    ${m.hasCode ? `<div class="field"><label>Kode ${esc(m.label)}</label><input name="code" value="${esc(rec?.code || '')}"></div>` : ''}
    ${m.hasCompany ? `<div class="field"><label>Perusahaan${m.companyRequired ? ' *' : ''}</label><select name="company_id" ${m.companyRequired ? 'required' : ''}><option value="">${m.companyRequired ? 'Pilih perusahaan' : 'Semua perusahaan (umum)'}</option>${coOptions}</select></div>` : ''}
    ${rec ? `<div class="field"><label>Status</label><select name="is_active"><option value="true" ${isActive(rec) ? 'selected' : ''}>Aktif</option><option value="false" ${isActive(rec) ? '' : 'selected'}>Tidak Aktif</option></select></div>` : ''}
  </div>`;
  openModal((rec ? 'Edit ' : 'Tambah ') + m.label, body, async form => {
    const fd = new FormData(form);
    const name = String(fd.get('name') || '').trim();
    if (!name) { toast('Nama wajib diisi.', 'error'); return false; }
    const payload = { name };
    if (m.hasCode) payload.code = String(fd.get('code') || '').trim() || null;
    if (m.hasCompany) payload.company_id = fd.get('company_id') || null;
    if (rec) { if (fd.get('is_active') !== null) payload.is_active = fd.get('is_active') === 'true'; }
    else payload.is_active = true;

    const dup = state[t].find(r => r.id !== rec?.id && String(r.name).trim().toLowerCase() === name.toLowerCase() &&
      (!m.hasCompany || (r.company_id || null) === (payload.company_id || null)));
    if (dup) { toast(`${m.label} "${name}" sudah ada${m.hasCompany ? ' pada perusahaan tersebut' : ''}.`, 'error'); return false; }

    const res = rec
      ? await sb.from(m.table).update(payload).eq('id', rec.id).select()
      : await sb.from(m.table).insert(payload).select();
    if (res.error) { toast(friendlyError(res.error), 'error'); return false; }
    if (!res.data || !res.data.length) { toast(PERMISSION_MSG, 'error'); return false; }
    toast(`${m.label} "${name}" berhasil ${rec ? 'diperbarui' : 'ditambahkan'}.`);
    return true;
  });
};

async function setActive(t, id, value) {
  const m = MASTER[t];
  const rec = state[t].find(r => r.id === id);
  const res = await sb.from(m.table).update({ is_active: value }).eq('id', id).select();
  if (res.error) { toast(friendlyError(res.error), 'error'); return; }
  if (!res.data || !res.data.length) { toast(PERMISSION_MSG, 'error'); return; }
  toast(`${m.label} "${rec?.name || ''}" berhasil ${value ? 'diaktifkan' : 'dinonaktifkan'}.`);
  await loadAll();
  renderApp();
}
window.masterDeactivate = async (t, id) => {
  const rec = state[t].find(r => r.id === id);
  if (!rec) return;
  const used = usageCount(t, id);
  const msg = used
    ? `"${rec.name}" sedang digunakan oleh ${used} karyawan.\n\nData tidak dihapus, hanya diubah menjadi Tidak Aktif: tidak muncul di pilihan baru, tetapi tetap tampil pada data karyawan lama.\n\nLanjutkan?`
    : `Nonaktifkan "${rec.name}"?\n\nData tidak muncul lagi di pilihan baru dan bisa diaktifkan kembali kapan saja.`;
  if (!confirm(msg)) return;
  await setActive(t, id, false);
};
window.masterActivate = (t, id) => setActive(t, id, true);

/* ---------- Form Tambah Karyawan ---------- */
window.showEmployeeForm = () => {
  const body = `<div class="modal-grid">
    <div class="field"><label>ID Karyawan *</label><input name="employee_number" required></div>
    <div class="field"><label>Nama Lengkap *</label><input name="full_name" required></div>
    <div class="field"><label>NIK</label><input name="nik" inputmode="numeric"></div>
    <div class="field"><label>Email</label><input name="email" type="email"></div>
    <div class="field"><label>No. HP</label><input name="phone" type="tel"></div>
    <div class="field"><label>Tanggal Masuk *</label><input name="join_date" type="date" required></div>
    <div class="field"><label>Perusahaan *</label><select name="company_id" required><option value="">Pilih</option>${state.companies.filter(isActive).map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}</select></div>
    <div class="field"><label>Outlet</label><select name="branch_id"></select></div>
    <div class="field"><label>Departemen</label><select name="department_id"></select></div>
    <div class="field"><label>Jabatan</label><select name="position_id"></select></div>
    <div class="field"><label>Status</label><select name="employment_status"><option value="active">Aktif</option><option value="inactive">Tidak Aktif</option></select></div>
    <div class="field"><label>Tipe</label><select name="employment_type"><option value="permanent">Tetap</option><option value="contract">Kontrak</option><option value="intern">Intern</option><option value="part_time">Part Time</option><option value="daily">Harian</option></select></div>
  </div>`;
  const modal = openModal('Tambah Karyawan', body, async form => {
    const obj = {};
    new FormData(form).forEach((v, k) => { const s = String(v).trim(); obj[k] = s === '' ? null : s; });
    if (!obj.employee_number || !obj.full_name || !obj.join_date || !obj.company_id) { toast('Lengkapi field bertanda *.', 'error'); return false; }
    if (state.employees.some(e => String(e.employee_number).toLowerCase() === obj.employee_number.toLowerCase())) { toast(`ID Karyawan "${obj.employee_number}" sudah dipakai.`, 'error'); return false; }
    if (!('branch_id' in obj)) obj.branch_id = null;       // outlet disabled / kosong => tetap null (opsional)
    obj.employment_status = obj.employment_status || 'active';
    const { data, error } = await sb.from('employees').insert(obj).select();
    if (error) { toast(friendlyError(error), 'error'); return false; }
    if (!data || !data.length) { toast(PERMISSION_MSG, 'error'); return false; }
    toast(`Karyawan "${obj.full_name}" berhasil ditambahkan.`);
    return true;
  });

  const sel = n => modal.querySelector(`[name="${n}"]`);
  const fill = (name, items, placeholder) => {
    sel(name).innerHTML = `<option value="">${placeholder}</option>` + items.map(x => `<option value="${esc(x.id)}">${esc(x.name)}</option>`).join('');
  };
  const refresh = () => {
    const cid = sel('company_id').value;
    const branches = state.branches.filter(b => isActive(b) && b.company_id === cid);
    const depts = state.departments.filter(d => isActive(d) && (d.company_id === cid || !d.company_id));
    const poss = state.positions.filter(p => isActive(p) && (p.company_id === cid || !p.company_id));
    const bs = sel('branch_id');
    if (!cid) { fill('branch_id', [], 'Pilih perusahaan dulu'); bs.disabled = true; }
    else if (!branches.length) { fill('branch_id', [], 'Tidak ada outlet'); bs.disabled = true; }   // mis. Zayco Boga Alifa
    else { fill('branch_id', branches, 'Pilih outlet (opsional)'); bs.disabled = false; }
    fill('department_id', cid ? depts : [], cid ? 'Pilih' : 'Pilih perusahaan dulu');
    fill('position_id', cid ? poss : [], cid ? 'Pilih' : 'Pilih perusahaan dulu');
    sel('department_id').disabled = sel('position_id').disabled = !cid;
  };
  sel('company_id').onchange = refresh;
  refresh();
};

init();
