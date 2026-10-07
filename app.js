const cfg = window.HR_CONFIG || {};
let sb = null;
let state = {
  session: null, profile: null, view: 'dashboard',
  employees: [], contracts: [], leave: [], warnings: [],
  companies: [], branches: [], workLocations: [], departments: [], positions: [],
  assignments: [], currentByEmp: {},
  attToday: [], attendance: [], attCtx: null, attCtxError: null, attGeo: null, attTab: 'history', clockTimer: null, clockOffset: 0, flow: null,
  attF: { q: '', company: '', branch: '', from: '', to: '', status: '' },
  masterTab: 'companies',
  masterF: { company: '', status: 'all' },
  empF: { q: '', company: '', branch: '', department: '', position: '', status: '' }
};

/* ---------- PHASE 6D — ROLE & PERMISSION ---------- */
function currentRole() { return String(state.profile?.role || '').toLowerCase(); }
function isAdminUser() { return ['admin','super_admin'].includes(currentRole()); }
function isHRUser() { return ['hr','hr_admin'].includes(currentRole()); }
function isFinanceUser() { return ['finance','finance_admin'].includes(currentRole()); }
function canViewCompensation() { return isHRUser() || isFinanceUser(); }
function canManageOperationalHR() { return isAdminUser() || isHRUser(); }

/* ---------- Helpers ---------- */
const $ = s => document.querySelector(s);
const esc = v => String(v ?? '').replace(/[&<>'"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
const fmtDate = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('id-ID') : '-';
const daysUntil = d => d ? Math.ceil((new Date(d + 'T00:00:00') - new Date()) / 86400000) : null;
// Data lama tanpa kolom is_active dianggap aktif
const isActive = r => r.is_active !== false;
// Tanggal (YYYY-MM-DD) di zona Asia/Jakarta; en-CA menghasilkan format ISO
const todayJakarta = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jakarta' }).format(new Date());
const addDays = (iso, n) => { const d = new Date(iso + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const attTz = () => state.attCtx?.timezone || 'Asia/Jakarta';
const fmtTime = (ts, tz) => ts ? new Date(ts).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz || attTz(), hourCycle: 'h23' }) : '-';
const fmtDateTime = (ts, tz) => ts ? new Date(ts).toLocaleString('id-ID', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: tz || attTz(), hourCycle: 'h23' }) : '-';
// Jarak dua titik koordinat (meter) — rumus Haversine
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000, rad = x => x * Math.PI / 180;
  const dLat = rad(lat2 - lat1), dLng = rad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

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
  if (c === 'P0001') return m;   // pesan validasi dari server (sudah berbahasa Indonesia)
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
    (isAdminUser() ? sb.from('contracts_admin_safe').select('*').order('end_date', { ascending: true }) : sb.from('contracts').select('*').order('end_date', { ascending: true })),
    sb.from('leave_requests').select('*, employees(full_name)').order('start_date', { ascending: false }),
    sb.from('warnings').select('*, employees(full_name)').order('issue_date', { ascending: false }),
    sb.from('companies').select('*').order('name'),
    sb.from('branches').select('*').order('name'),
    sb.from('work_locations').select('*').eq('is_active', true).order('name'),
    sb.from('departments').select('*').order('name'),
    sb.from('positions').select('*').order('name'),
    sb.from('employee_assignments').select('*, branches(name), work_locations(name)').order('start_date', { ascending: false }),
    sb.from('attendance_records').select('*').eq('attendance_date', todayJakarta())
  ]);
  const names = ['karyawan', 'kontrak', 'cuti', 'teguran', 'perusahaan', 'outlet', 'lokasi kerja', 'departemen', 'jabatan', 'penempatan', 'absensi hari ini'];
  const failed = queries.map((q, i) => q.error ? names[i] : null).filter(Boolean);
  if (failed.length) toast('Gagal memuat data: ' + failed.join(', ') + '. ' + friendlyError(queries.find(q => q.error).error), 'error');
  state.employees = queries[0].data || []; state.contracts = queries[1].data || []; state.leave = queries[2].data || []; state.warnings = queries[3].data || [];
  state.companies = queries[4].data || []; state.branches = queries[5].data || []; state.workLocations = queries[6].data || []; state.departments = queries[7].data || []; state.positions = queries[8].data || [];
  state.assignments = queries[9].data || [];
  state.attToday = queries[10].data || [];
  rebuildAssignmentIndex();
}

/* ---------- Shell ---------- */
function renderApp() {
  const labels = { dashboard: 'Dashboard', employees: 'Karyawan', attendance: 'Absensi', contracts: 'Kontrak', leave: 'Cuti', warnings: 'Teguran / SP', master: 'Master Data', calendar: 'Kalender Kerja' };
  document.querySelector('#app').innerHTML = `<div class="shell"><aside class="sidebar"><div class="logo">HR Employee System</div><div class="nav">${Object.keys(labels).map(v => `<button class="${state.view === v ? 'active' : ''}" data-view="${v}">${labels[v]}</button>`).join('')}</div></aside><main class="main"><div class="topbar"><h1>${title()}</h1><div class="userbox"><span>${esc(state.profile.full_name || state.session.user.email)} <span class="muted">(${esc(currentRole() || 'user')})</span></span><span class="avatar">${esc((state.profile.full_name || 'A')[0].toUpperCase())}</span><button id="logout" class="btn btn-light">Keluar</button></div></div><div id="content"></div></main></div>`;
  document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { state.view = b.dataset.view; renderApp(); });
  $('#logout').onclick = async () => { await sb.auth.signOut(); };
  renderView();
}
window.gotoView = v => { state.view = v; renderApp(); };
function title() { return { dashboard: 'Dashboard', employees: 'Database Karyawan', attendance: 'Absensi Karyawan', contracts: 'Kontrak Karyawan', leave: 'Cuti Karyawan', warnings: 'Surat Teguran / SP', master: 'Master Data', calendar: 'Kalender Kerja' }[state.view]; }
function renderView() {
  clearInterval(state.clockTimer);
  if (state.view === 'attendance') return attendance();
  if (state.view === 'dashboard') return dashboard();
  if (state.view === 'employees') return employees();
  if (state.view === 'contracts') return contracts();
  if (state.view === 'leave') return leave();
  if (state.view === 'warnings') return warnings();
  if (state.view === 'calendar') return calendarWork();
  master();
}

/* ---------- Dashboard ---------- */
function dashboard() {
  const active = state.employees.filter(e => e.employment_status === 'active').length;
  const exp = state.contracts.filter(c => { const n = daysUntil(c.end_date); return c.status === 'active' && n !== null && n >= 0 && n <= 30; }).length;
  const onleave = state.leave.filter(l => l.status === 'approved' && new Date(l.start_date) <= new Date() && new Date(l.end_date) >= new Date()).length;
  const warn = state.warnings.filter(w => w.status === 'active').length;
  const actEmp = state.employees.filter(e => e.employment_status === 'active');
  const inSet = new Set(state.attToday.filter(r => r.check_in_at).map(r => r.employee_id));
  const attCards = `<div class="section"><div class="section-head"><h2>Absensi Hari Ini</h2><button class="btn btn-light" onclick="gotoView('attendance')">Buka Absensi</button></div><div class="cards"><div class="card"><div class="muted">Hadir Hari Ini</div><div class="metric">${inSet.size}</div></div><div class="card"><div class="muted">Belum Absen</div><div class="metric">${actEmp.filter(e => !inSet.has(e.id)).length}</div></div><div class="card"><div class="muted">Sudah Absen Keluar</div><div class="metric">${state.attToday.filter(r => r.check_out_at).length}</div></div><div class="card"><div class="muted">Terlambat</div><div class="metric">${state.attToday.filter(r => r.check_in_status === 'late').length}</div></div></div></div>`;
  $('#content').innerHTML = `<div class="cards"><div class="card"><div class="muted">Karyawan Aktif</div><div class="metric">${active}</div></div><div class="card"><div class="muted">Kontrak ≤ 30 Hari</div><div class="metric">${exp}</div></div><div class="card"><div class="muted">Sedang Cuti</div><div class="metric">${onleave}</div></div><div class="card"><div class="muted">Teguran Aktif</div><div class="metric">${warn}</div></div></div>${attCards}<div class="section"><div class="section-head"><h2>Perusahaan</h2></div><div class="cards">${state.companies.map(c => `<div class="card"><div class="muted">${esc(c.name)}</div><div class="metric">${state.employees.filter(e => e.company_id === c.id).length}</div><div class="muted">karyawan</div></div>`).join('')}</div></div><div class="section"><div class="section-head"><h2>Karyawan Terbaru</h2><button class="btn btn-primary" onclick="showEmployeeForm()">+ Tambah Karyawan</button></div>${employeeTable(state.employees.slice(0, 8))}</div>`;
}

/* ---------- Karyawan ---------- */
function employeeTable(rows) {
  if (!rows.length) return '<div class="card empty">Belum ada data karyawan.</div>';
  return `<div class="table-wrap"><table class="table"><thead><tr><th>ID</th><th>Nama</th><th>Perusahaan</th><th>Outlet</th><th>Departemen</th><th>Jabatan</th><th>Status</th><th>Mulai</th><th>Aksi</th></tr></thead><tbody>${rows.map(e => `<tr><td>${esc(e.employee_number)}</td><td><b>${esc(e.full_name)}</b><div class="muted">${esc(e.email || '')}</div></td><td>${esc(e.companies?.name || '-')}</td><td>${esc(currentOutletName(e.id))}</td><td>${esc(e.departments?.name || '-')}</td><td>${esc(e.positions?.name || '-')}</td><td><span class="badge ${e.employment_status === 'active' ? 'badge-green' : 'badge-yellow'}">${esc(e.employment_status)}</span></td><td>${fmtDate(e.join_date)}</td><td><button class="btn btn-light btn-sm" onclick="showEmployeeDetail('${esc(e.id)}')">Detail</button></td></tr>`).join('')}</tbody></table></div>`;
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
      (!f.branch || state.currentByEmp[e.id]?.branch_id === f.branch) &&
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
function contractStatusBadge(status) {
  const map = {
    draft: ['Draft', 'badge-gray'],
    active: ['Aktif', 'badge-green'],
    expired: ['Berakhir', 'badge-yellow'],
    terminated: ['Dihentikan', 'badge-red'],
    cancelled: ['Dibatalkan', 'badge-red']
  };
  const x = map[status] || [status || '-', 'badge-gray'];
  return `<span class="badge ${x[1]}">${esc(x[0])}</span>`;
}

const contractTypeLabel = t => ({
  pkwt: 'PKWT',
  pkwtt: 'PKWTT',
  offering_letter: 'Offering Letter',
  amendment: 'Amandemen PKWT',
  probation: 'Probation',
  other: 'Lainnya'
}[t] || t || '-');

const moneyFmt = v => v == null || v === '' ? '-' : new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(Number(v));

function contractEmployeeOptions(current) {
  return state.employees
    .filter(e => e.employment_status === 'active' || e.id === current)
    .sort((a, b) => String(a.full_name).localeCompare(String(b.full_name)))
    .map(e => `<option value="${esc(e.id)}" ${e.id === current ? 'selected' : ''}>${esc(e.full_name)} — ${esc(e.employee_number || '-')}</option>`)
    .join('');
}

function contractLocationOptions(emp, rec) {
  const branches = state.branches.filter(b => b.company_id === emp?.company_id && (isActive(b) || b.id === rec?.branch_id));
  const locations = state.workLocations.filter(w => w.company_id === emp?.company_id && (isActive(w) || w.id === rec?.work_location_id));
  const current = rec?.work_location_id ? `work:${rec.work_location_id}` : rec?.branch_id ? `branch:${rec.branch_id}` : '';
  return {
    html: `<option value="">Tidak ditentukan</option>${branches.map(b => `<option value="branch:${esc(b.id)}" ${current === 'branch:' + b.id ? 'selected' : ''}>Outlet — ${esc(b.name)}</option>`).join('')}${locations.map(w => `<option value="work:${esc(w.id)}" ${current === 'work:' + w.id ? 'selected' : ''}>Lokasi kerja — ${esc(w.name)}</option>`).join('')}`,
    branches, locations
  };
}

function contractDetailValue(label, value) {
  return `<div class="detail-item"><div class="muted">${label}</div><div>${value || '-'}</div></div>`;
}

async function contractOpenDocument(path) {
  if (!path) return;
  const { data, error } = await sb.storage.from('hr-documents').createSignedUrl(path, 300);
  if (error || !data?.signedUrl) { toast('Dokumen tidak dapat dibuka. Periksa izin bucket hr-documents.', 'error'); return; }
  window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
}

window.contractForm = (id) => {
  const rec = id ? state.contracts.find(x => x.id === id) : null;
  if (id && !rec) { toast('Data kontrak tidak ditemukan.', 'error'); return; }

  const emp = rec ? state.employees.find(e => e.id === rec.employee_id) : state.employees.find(e => e.employment_status === 'active');
  const currentEmployee = rec?.employee_id || emp?.id || '';
  const location = contractLocationOptions(emp, rec);

  const num = (name, label, value, step = '1') =>
    `<div class="field"><label>${label}</label><input name="${name}" type="number" min="0" step="${step}" inputmode="decimal" value="${esc(value ?? '')}"></div>`;
  const date = (name, label, value, required = false) =>
    `<div class="field"><label>${label}${required ? ' *' : ''}</label><input name="${name}" type="date" ${required ? 'required' : ''} value="${esc(value || '')}"></div>`;

  const body = `<div class="modal-grid">
    <div class="field field-full"><label>Karyawan *</label><select name="employee_id" required><option value="">Pilih karyawan</option>${contractEmployeeOptions(currentEmployee)}</select></div>

    <div class="field"><label>Jenis Dokumen *</label><select name="contract_type" required>
      <option value="">Pilih jenis</option>
      <option value="pkwt" ${rec?.contract_type === 'pkwt' ? 'selected' : ''}>PKWT</option>
      <option value="pkwtt" ${rec?.contract_type === 'pkwtt' ? 'selected' : ''}>PKWTT</option>
      <option value="offering_letter" ${rec?.contract_type === 'offering_letter' ? 'selected' : ''}>Offering Letter</option>
      <option value="amendment" ${rec?.contract_type === 'amendment' ? 'selected' : ''}>Amandemen PKWT</option>
      <option value="probation" ${rec?.contract_type === 'probation' ? 'selected' : ''}>Probation</option>
      <option value="other" ${rec?.contract_type === 'other' ? 'selected' : ''}>Lainnya</option>
    </select></div>
    <div class="field"><label>No. Kontrak / Dokumen</label><input name="contract_number" value="${esc(rec?.contract_number || '')}" placeholder="Contoh: PKWT/001/IX/2026"></div>
    <div class="field"><label>Status</label><select name="status">
      <option value="draft" ${rec?.status === 'draft' ? 'selected' : ''}>Draft</option>
      <option value="active" ${!rec || rec?.status === 'active' ? 'selected' : ''}>Aktif</option>
      <option value="expired" ${rec?.status === 'expired' ? 'selected' : ''}>Berakhir</option>
      <option value="terminated" ${rec?.status === 'terminated' ? 'selected' : ''}>Dihentikan</option>
      <option value="cancelled" ${rec?.status === 'cancelled' ? 'selected' : ''}>Dibatalkan</option>
    </select></div>

    <div class="field field-full"><div class="sub-title" style="margin:8px 0 0">Periode & Tanggal</div></div>
    ${date('join_date', 'Tanggal Bergabung', rec?.join_date)}
    ${date('start_date', 'Tanggal Mulai', rec?.start_date, true)}
    ${date('end_date', 'Tanggal Berakhir', rec?.end_date)}
    ${date('signed_date', 'Tanggal Tanda Tangan', rec?.signed_date)}
    ${num('probation_days', 'Masa Probation (hari)', rec?.probation_days)}

    <div class="field field-full"><div class="sub-title" style="margin:8px 0 0">Posisi & Lokasi</div></div>
    <div class="field"><label>Departemen</label><select name="department_id"></select></div>
    <div class="field"><label>Jabatan</label><select name="position_id"></select></div>
    <div class="field field-full"><label>Outlet / Lokasi Kerja</label><select name="location_ref">${location.html}</select></div>

    ${canViewCompensation() ? `
    <div class="field field-full"><div class="sub-title" style="margin:8px 0 0">Remunerasi</div></div>
    ${num('base_salary', 'Gaji Pokok')}
    ${num('position_allowance', 'Tunjangan Jabatan')}
    ${num('performance_incentive', 'Insentif Kinerja')}
    ${num('discipline_allowance', 'Tunjangan Kedisiplinan')}
    ${num('meal_allowance', 'Tunjangan Makan')}
    ${num('thr_amount', 'THR')}` : `<div class="field field-full"><div class="info-box">Data remunerasi tidak ditampilkan untuk akun Admin.</div></div>`}

    <div class="field field-full"><div class="sub-title" style="margin:8px 0 0">Amandemen PKWT</div><div class="muted">Jika bukan amandemen, bagian ini boleh dikosongkan. Periode baru menggunakan Tanggal Mulai/Berakhir di atas.</div></div>
    <div class="field field-full"><label>Kontrak Sebelumnya</label><select name="previous_contract_id"><option value="">Tidak ada</option>${state.contracts.filter(c => c.id !== rec?.id && c.employee_id === currentEmployee).map(c => `<option value="${esc(c.id)}" ${rec?.previous_contract_id === c.id ? 'selected' : ''}>${esc(c.contract_number || contractTypeLabel(c.contract_type))} — ${fmtDate(c.start_date)} s/d ${fmtDate(c.end_date)}</option>`).join('')}</select></div>
    ${date('previous_start_date', 'Periode Sebelumnya — Mulai', rec?.previous_start_date)}
    ${date('previous_end_date', 'Periode Sebelumnya — Berakhir', rec?.previous_end_date)}

    <div class="field field-full"><label>Upload Dokumen Kontrak</label><input name="contract_file" type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png"></div>
    <div class="field field-full">${rec?.document_path ? `<div class="info-box">Dokumen tersimpan: <button type="button" class="btn btn-light btn-sm" id="openContractDoc">Buka dokumen</button></div>` : '<div class="muted">Belum ada dokumen yang diunggah.</div>'}</div>
    <div class="field field-full"><label>Catatan HR</label><textarea name="notes" rows="3" placeholder="Catatan tambahan HR...">${esc(rec?.notes || '')}</textarea></div>
  </div>`;

  const modal = openModal(rec ? 'Edit Kontrak' : 'Tambah Kontrak', body, async form => {
    const fd = new FormData(form);
    const employee_id = fd.get('employee_id') || '';
    const contract_type = fd.get('contract_type') || '';
    const start_date = fd.get('start_date') || '';
    const end_date = fd.get('end_date') || null;
    if (!employee_id || !contract_type || !start_date) { toast('Lengkapi Karyawan, Jenis Dokumen, dan Tanggal Mulai.', 'error'); return false; }
    if (end_date && end_date < start_date) { toast('Tanggal berakhir tidak boleh lebih kecil dari tanggal mulai.', 'error'); return false; }

    const clean = v => String(v ?? '').trim() || null;
    const money = name => {
      const v = clean(fd.get(name));
      if (v === null) return null;
      const n = Number(v);
      return Number.isFinite(n) ? n : null;
    };
    const intVal = name => {
      const v = clean(fd.get(name));
      if (v === null) return null;
      const n = Number(v);
      return Number.isInteger(n) && n >= 0 ? n : null;
    };

    const loc = clean(fd.get('location_ref'));
    const branch_id = loc?.startsWith('branch:') ? loc.slice(7) : null;
    const work_location_id = loc?.startsWith('work:') ? loc.slice(5) : null;

    const payload = {
      employee_id,
      contract_type,
      contract_number: clean(fd.get('contract_number')),
      status: clean(fd.get('status')) || 'active',
      join_date: clean(fd.get('join_date')),
      start_date,
      end_date,
      signed_date: clean(fd.get('signed_date')),
      probation_days: intVal('probation_days'),
      department_id: clean(fd.get('department_id')),
      position_id: clean(fd.get('position_id')),
      branch_id,
      work_location_id,
      ...(canViewCompensation() ? {
        base_salary: money('base_salary'),
        position_allowance: money('position_allowance'),
        performance_incentive: money('performance_incentive'),
        discipline_allowance: money('discipline_allowance'),
        meal_allowance: money('meal_allowance'),
        thr_amount: money('thr_amount')
      } : {}),
      previous_contract_id: clean(fd.get('previous_contract_id')),
      previous_start_date: clean(fd.get('previous_start_date')),
      previous_end_date: clean(fd.get('previous_end_date')),
      document_path: rec?.document_path || null,
      notes: clean(fd.get('notes'))
    };

    if (payload.contract_type === 'amendment' && !payload.previous_contract_id && !payload.previous_start_date && !payload.previous_end_date) {
      toast('Untuk Amandemen PKWT, isi minimal kontrak atau periode sebelumnya.', 'error'); return false;
    }

    const file = fd.get('contract_file');
    if (file && file.size) {
      if (file.size > 10 * 1024 * 1024) { toast('Ukuran dokumen maksimal 10 MB.', 'error'); return false; }
      const safe = String(file.name || 'dokumen').replace(/[^a-zA-Z0-9._-]+/g, '_');
      const path = `contracts/${employee_id}/${new Date().getFullYear()}/${Date.now()}-${safe}`;
      const up = await sb.storage.from('hr-documents').upload(path, file, { upsert: false, contentType: file.type || 'application/octet-stream' });
      if (up.error) {
        toast(/row-level security|policy|unauthorized/i.test(up.error.message || '') ? 'Upload ditolak oleh policy Storage hr-documents.' : 'Gagal upload dokumen: ' + up.error.message, 'error');
        return false;
      }
      payload.document_path = path;
    }

    let res = rec
      ? await sb.from('contracts').update(payload).eq('id', rec.id).select()
      : await sb.from('contracts').insert(payload).select();

    // Kompatibilitas jika migration kontrak memakai kolom inti saja.
    if (res.error && /column .* does not exist|schema cache|PGRST204/i.test(res.error.message || '')) {
      const core = {
        employee_id, contract_type, contract_number: payload.contract_number, status: payload.status,
        start_date, end_date, signed_date: payload.signed_date, notes: payload.notes,
        document_path: payload.document_path
      };
      res = rec
        ? await sb.from('contracts').update(core).eq('id', rec.id).select()
        : await sb.from('contracts').insert(core).select();
      if (!res.error) toast('Kontrak tersimpan, tetapi beberapa field tambahan belum tersedia di database. Jalankan migration Phase 4B-2 terbaru untuk menyimpan semua rincian.');
    }
    if (res.error) { toast(friendlyError(res.error), 'error'); return false; }
    if (!res.data?.length) { toast(PERMISSION_MSG, 'error'); return false; }
    toast(`Kontrak "${payload.contract_number || contractTypeLabel(payload.contract_type)}" berhasil ${rec ? 'diperbarui' : 'ditambahkan'}.`);
    return true;
  });

  const sel = n => modal.querySelector(`[name="${n}"]`);
  const fill = (name, items, placeholder, current) => {
    const el = sel(name);
    el.innerHTML = `<option value="">${placeholder}</option>` + items.map(x => `<option value="${esc(x.id)}" ${current === x.id ? 'selected' : ''}>${esc(x.name)}${isActive(x) ? '' : ' (nonaktif)'}</option>`).join('');
  };
  const refresh = () => {
    const employeeId = sel('employee_id').value;
    const employee = state.employees.find(e => e.id === employeeId);
    const cid = employee?.company_id;
    const depts = state.departments.filter(d => isActive(d) && (d.company_id === cid || !d.company_id) || d.id === rec?.department_id);
    const poss = state.positions.filter(p => isActive(p) && (p.company_id === cid || !p.company_id) || p.id === rec?.position_id);
    fill('department_id', cid ? depts : [], cid ? 'Pilih departemen' : 'Pilih karyawan dulu', rec?.department_id);
    fill('position_id', cid ? poss : [], cid ? 'Pilih jabatan' : 'Pilih karyawan dulu', rec?.position_id);
    sel('department_id').disabled = sel('position_id').disabled = !cid;
  };
  sel('employee_id').onchange = refresh;
  refresh();

  const openBtn = modal.querySelector('#openContractDoc');
  if (openBtn) openBtn.onclick = () => contractOpenDocument(rec.document_path);
};


/* ---------- Import Kontrak Otomatis DOCX ---------- */
async function loadMammoth() {
  if (window.mammoth) return window.mammoth;
  return new Promise((resolve, reject) => {
    const old = document.querySelector('script[data-mammoth="1"]');
    if (old) {
      old.addEventListener('load', () => resolve(window.mammoth));
      old.addEventListener('error', () => reject(new Error('Library pembaca Word gagal dimuat.')));
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/mammoth@1.12.3/mammoth.browser.min.js';
    script.dataset.mammoth = '1';
    script.onload = () => resolve(window.mammoth);
    script.onerror = () => reject(new Error('Library pembaca Word gagal dimuat.'));
    document.head.appendChild(script);
  });
}

function normalizeContractText(text) {
  return String(text || '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\r/g, '').trim();
}

function parseIndonesianDate(value) {
  if (!value) return null;
  const s = String(value).toLowerCase().trim();
  const months = {januari:1,februari:2,maret:3,april:4,mei:5,juni:6,juli:7,agustus:8,september:9,oktober:10,november:11,desember:12};
  let m = s.match(/\b(\d{1,2})[\s\-\/]+(januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)[\s\-\/]+(20\d{2})\b/i);
  if (m) return `${m[3]}-${String(months[m[2].toLowerCase()]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;
  m = s.match(/\b(\d{1,2})[\-\/](\d{1,2})[\-\/](20\d{2})\b/);
  if (m) return `${m[3]}-${String(m[2]).padStart(2,'0')}-${String(m[1]).padStart(2,'0')}`;
  return null;
}

function extractContractDates(text) {
  const months = 'januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember';
  const re = new RegExp(`\\b\\d{1,2}[ \\-\\/]?(?:${months})[ \\-\\/]?20\\d{2}\\b|\\b\\d{1,2}[\\-/]\\d{1,2}[\\-/]20\\d{2}\\b`, 'gi');
  return [...new Set((String(text).match(re) || []).map(parseIndonesianDate).filter(Boolean))];
}

function findLabeledDate(text, labels) {
  const re = new RegExp(`(?:${labels.join('|')})[^\\n]{0,100}?(\\d{1,2}[ \\-\\/]?(?:januari|februari|maret|april|mei|juni|juli|agustus|september|oktober|november|desember)[ \\-\\/]?20\\d{2}|\\d{1,2}[\\-/]\\d{1,2}[\\-/]20\\d{2})`, 'i');
  const m = String(text).match(re);
  return m ? parseIndonesianDate(m[1]) : null;
}

function detectContractType(text) {
  const s = String(text).toLowerCase();
  if (/amandemen|addendum|perubahan.*pkwt/.test(s)) return 'amendment';
  if (/pkwtt|perjanjian kerja waktu tidak tertentu/.test(s)) return 'pkwtt';
  if (/pkwt|perjanjian kerja waktu tertentu/.test(s)) return 'pkwt';
  if (/offering letter|surat penawaran kerja/.test(s)) return 'offering_letter';
  if (/probation|masa percobaan/.test(s)) return 'probation';
  return 'other';
}

function detectContractNumber(text) {
  const patterns = [
    /(?:nomor|no\.?|nomor dokumen|no\. dokumen)\s*[:.]?\s*([^\n]{4,100})/i,
    /\b(\d{3,}\/[^\n]{3,80}\/20\d{2})\b/i
  ];
  for (const re of patterns) {
    const m = String(text).match(re);
    if (m) {
      const v = m[1].trim().replace(/[.,;]+$/,'');
      if (v.length >= 4 && v.length <= 100) return v;
    }
  }
  return '';
}

function detectEmployeeName(text) {
  const lines = String(text).split('\n').map(x => x.trim()).filter(Boolean);
  const labels = /^(nama lengkap|nama karyawan|nama)\s*[:\-]/i;
  for (const line of lines) {
    if (labels.test(line)) return line.replace(labels, '').trim();
  }
  for (const e of state.employees) {
    const n = String(e.full_name || '').trim();
    if (n && String(text).toLowerCase().includes(n.toLowerCase())) return n;
  }
  return '';
}

function findEmployeeFromDocument(text) {
  const number = String(text).match(/(?:id karyawan|employee number|employee no|nik|no\. karyawan)\s*[:\-]?\s*([A-Za-z0-9\-\/]+)/i)?.[1]?.trim();
  if (number) {
    const byNumber = state.employees.find(e => String(e.employee_number || '').toLowerCase() === number.toLowerCase() || String(e.nik || '').toLowerCase() === number.toLowerCase());
    if (byNumber) return byNumber;
  }
  const name = detectEmployeeName(text).toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
  if (!name) return null;
  let exact = state.employees.find(e => String(e.full_name || '').toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim() === name);
  if (exact) return exact;
  const tokens = name.split(' ').filter(x => x.length > 2);
  let best = null, score = 0;
  for (const e of state.employees) {
    const en = String(e.full_name || '').toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
    const hits = tokens.filter(t => en.includes(t)).length;
    if (hits > score) { score = hits; best = e; }
  }
  return score >= Math.max(2, Math.ceil(tokens.length * .6)) ? best : null;
}

function detectField(text, labels) {
  const re = new RegExp(`(?:${labels.join('|')})\\s*[:\\-]?\\s*([^\\n\\r]{2,120})`, 'i');
  const m = String(text).match(re);
  return m ? m[1].trim().replace(/[.,;]+$/,'') : '';
}

function detectMoney(text, labels) {
  const raw = detectField(text, labels);
  if (!raw) return null;
  const digits = raw.replace(/[^0-9]/g, '');
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) ? n : null;
}

function detectContractDates(text, type) {
  const dates = extractContractDates(text);
  const join = findLabeledDate(text, ['tanggal masuk','tanggal bergabung','join date','mulai bekerja']);
  const start = findLabeledDate(text, ['tanggal mulai','mulai berlaku','berlaku mulai','periode.*mulai','terhitung mulai']);
  const end = findLabeledDate(text, ['tanggal berakhir','berakhir','sampai dengan','sampai tanggal','periode.*berakhir']);
  const signed = findLabeledDate(text, ['tanggal tanda tangan','ditandatangani','signed date']);
  return {
    join_date: join || dates[0] || '',
    start_date: start || dates[0] || '',
    end_date: end || (type === 'pkwtt' ? '' : dates[1] || ''),
    signed_date: signed || ''
  };
}

function buildContractImportData(text, file) {
  const clean = normalizeContractText(text);
  const type = detectContractType(clean);
  const employee = findEmployeeFromDocument(clean);
  const dates = detectContractDates(clean, type);
  const department = detectField(clean, ['departemen','department','divisi','bagian']);
  const position = detectField(clean, ['jabatan','position','posisi']);
  return {
    employee_id: employee?.id || '',
    contract_type: type,
    contract_number: detectContractNumber(clean),
    status: 'active',
    join_date: dates.join_date,
    start_date: dates.start_date,
    end_date: dates.end_date,
    signed_date: dates.signed_date,
    department_text: department,
    position_text: position,
    base_salary: detectMoney(clean, ['gaji pokok','upah pokok','basic salary','gaji dasar']),
    position_allowance: detectMoney(clean, ['tunjangan jabatan']),
    performance_incentive: detectMoney(clean, ['insentif kinerja','insentif']),
    discipline_allowance: detectMoney(clean, ['tunjangan kedisiplinan','kedisiplinan']),
    meal_allowance: detectMoney(clean, ['tunjangan makan','uang makan']),
    thr_amount: detectMoney(clean, ['thr','tunjangan hari raya']),
    file,
    employee_name: employee?.full_name || detectEmployeeName(clean)
  };
}

async function importContractDocument() {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.docx';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { toast('Ukuran dokumen maksimal 10 MB.', 'error'); return; }
    if (!/\.docx$/i.test(file.name)) { toast('Versi pertama Import Otomatis hanya menerima file DOCX.', 'error'); return; }
    try {
      toast('Membaca dokumen Word...');
      const mammoth = await loadMammoth();
      const result = await mammoth.extractRawText({ arrayBuffer: await file.arrayBuffer() });
      const data = buildContractImportData(result.value, file);
      const emp = data.employee_id ? state.employees.find(e => e.id === data.employee_id) : null;
      const body = `<div class="info-box">Dokumen <b>${esc(file.name)}</b> sudah dibaca. Periksa hasil deteksi sebelum menyimpan.</div>
        <div class="modal-grid">
          <div class="field field-full"><label>Karyawan *</label><select name="employee_id" required><option value="">Pilih karyawan</option>${contractEmployeeOptions(data.employee_id)}</select></div>
          <div class="field"><label>Jenis Dokumen *</label><select name="contract_type" required>
            <option value="pkwt" ${data.contract_type==='pkwt'?'selected':''}>PKWT</option><option value="pkwtt" ${data.contract_type==='pkwtt'?'selected':''}>PKWTT</option><option value="offering_letter" ${data.contract_type==='offering_letter'?'selected':''}>Offering Letter</option><option value="amendment" ${data.contract_type==='amendment'?'selected':''}>Amandemen PKWT</option><option value="probation" ${data.contract_type==='probation'?'selected':''}>Probation</option><option value="other" ${data.contract_type==='other'?'selected':''}>Lainnya</option>
          </select></div>
          <div class="field"><label>No. Kontrak / Dokumen</label><input name="contract_number" value="${esc(data.contract_number)}"></div>
          <div class="field"><label>Status</label><select name="status"><option value="active" selected>Aktif</option><option value="draft">Draft</option><option value="expired">Berakhir</option></select></div>
          <div class="field"><label>Tanggal Bergabung</label><input name="join_date" type="date" value="${esc(data.join_date)}"></div>
          <div class="field"><label>Tanggal Mulai *</label><input name="start_date" type="date" required value="${esc(data.start_date)}"></div>
          <div class="field"><label>Tanggal Berakhir</label><input name="end_date" type="date" value="${esc(data.end_date)}"></div>
          <div class="field"><label>Tanggal Tanda Tangan</label><input name="signed_date" type="date" value="${esc(data.signed_date)}"></div>
          <div class="field"><label>Departemen terdeteksi</label><input name="department_text" value="${esc(data.department_text)}" placeholder="Periksa / isi bila belum tepat"></div>
          <div class="field"><label>Jabatan terdeteksi</label><input name="position_text" value="${esc(data.position_text)}" placeholder="Periksa / isi bila belum tepat"></div>
          <div class="field"><label>Gaji Pokok</label><input name="base_salary" type="number" min="0" value="${esc(data.base_salary ?? '')}"></div>
          <div class="field"><label>Tunjangan Jabatan</label><input name="position_allowance" type="number" min="0" value="${esc(data.position_allowance ?? '')}"></div>
          <div class="field"><label>Insentif Kinerja</label><input name="performance_incentive" type="number" min="0" value="${esc(data.performance_incentive ?? '')}"></div>
          <div class="field"><label>Tunjangan Kedisiplinan</label><input name="discipline_allowance" type="number" min="0" value="${esc(data.discipline_allowance ?? '')}"></div>
          <div class="field"><label>Tunjangan Makan</label><input name="meal_allowance" type="number" min="0" value="${esc(data.meal_allowance ?? '')}"></div>
          <div class="field"><label>THR</label><input name="thr_amount" type="number" min="0" value="${esc(data.thr_amount ?? '')}"></div>
          <div class="field field-full"><label>Catatan HR</label><textarea name="notes" rows="3">Import otomatis dari ${esc(file.name)}. Hasil pembacaan wajib diperiksa HR sebelum disimpan.</textarea></div>
        </div>`;
      openModal('Preview Import Kontrak', body, async form => {
        const fd = new FormData(form);
        const employee_id = fd.get('employee_id') || '';
        const contract_type = fd.get('contract_type') || '';
        const start_date = fd.get('start_date') || '';
        const end_date = fd.get('end_date') || null;
        if (!employee_id || !contract_type || !start_date) { toast('Lengkapi Karyawan, Jenis Dokumen, dan Tanggal Mulai.', 'error'); return false; }
        if (end_date && end_date < start_date) { toast('Tanggal berakhir tidak boleh lebih kecil dari tanggal mulai.', 'error'); return false; }
        const num = name => { const n = Number(fd.get(name)); return Number.isFinite(n) && n > 0 ? n : null; };
        const clean = v => String(v ?? '').trim() || null;
        const empNow = state.employees.find(e => e.id === employee_id);
        const matchByText = (list, textValue) => {
          const q = String(textValue || '').toLowerCase().trim();
          if (!q) return null;
          return list.find(x => String(x.name || '').toLowerCase() === q) || list.find(x => String(x.name || '').toLowerCase().includes(q) || q.includes(String(x.name || '').toLowerCase()));
        };
        const dept = matchByText(state.departments.filter(d => isActive(d) && (d.company_id === empNow?.company_id || !d.company_id)), fd.get('department_text'));
        const pos = matchByText(state.positions.filter(p => isActive(p) && (p.company_id === empNow?.company_id || !p.company_id)), fd.get('position_text'));
        const payload = {
          employee_id, contract_type, contract_number: clean(fd.get('contract_number')), status: clean(fd.get('status')) || 'active',
          join_date: clean(fd.get('join_date')), start_date, end_date, signed_date: clean(fd.get('signed_date')),
          department_id: dept?.id || empNow?.department_id || null, position_id: pos?.id || empNow?.position_id || null,
          base_salary: num('base_salary'), position_allowance: num('position_allowance'), performance_incentive: num('performance_incentive'),
          discipline_allowance: num('discipline_allowance'), meal_allowance: num('meal_allowance'), thr_amount: num('thr_amount'),
          document_path: null, notes: clean(fd.get('notes'))
        };
        const safe = String(file.name || 'dokumen').replace(/[^a-zA-Z0-9._-]+/g, '_');
        const path = `contracts/${employee_id}/${new Date().getFullYear()}/${Date.now()}-${safe}`;
        const up = await sb.storage.from('hr-documents').upload(path, file, { upsert: false, contentType: file.type || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
        if (up.error) { toast(/row-level security|policy|unauthorized/i.test(up.error.message || '') ? 'Upload ditolak oleh policy Storage hr-documents.' : 'Gagal upload dokumen: ' + up.error.message, 'error'); return false; }
        payload.document_path = path;
        let res = await sb.from('contracts').insert(payload).select();
        if (res.error && /column .* does not exist|schema cache|PGRST204/i.test(res.error.message || '')) {
          const core = { employee_id, contract_type, contract_number: payload.contract_number, status: payload.status, start_date, end_date, signed_date: payload.signed_date, notes: payload.notes, document_path: payload.document_path };
          res = await sb.from('contracts').insert(core).select();
        }
        if (res.error) { toast(friendlyError(res.error), 'error'); return false; }
        if (!res.data?.length) { toast(PERMISSION_MSG, 'error'); return false; }
        toast(`Kontrak ${payload.contract_number || contractTypeLabel(payload.contract_type)} berhasil diimport.`);
        return true;
      }, 'Simpan Hasil Import');
    } catch (err) {
      console.error('IMPORT CONTRACT ERROR', err);
      toast('Gagal membaca dokumen: ' + (err?.message || 'error tidak diketahui'), 'error');
    }
  };
  input.click();
}

function contracts() {
  const rows = state.contracts;
  const today = todayJakarta();
  const expSoon = c => {
    const n = daysUntil(c.end_date);
    return c.status === 'active' && n !== null && n >= 0 && n <= 30;
  };
  $('#content').innerHTML = `<div class="section">
    <div class="section-head">
      <div><h2>Daftar Kontrak</h2><div class="muted">${rows.length} dokumen kontrak tersimpan</div></div>
      <div class="row-actions"><button class="btn btn-light" onclick="importContractDocument()">📄 Import Dokumen</button><button class="btn btn-primary" onclick="contractForm()">+ Tambah Kontrak</button></div>
    </div>
    <div class="cards" style="margin-bottom:14px">
      <div class="card"><div class="muted">Aktif</div><div class="metric">${rows.filter(c => c.status === 'active').length}</div></div>
      <div class="card"><div class="muted">Berakhir ≤ 30 Hari</div><div class="metric">${rows.filter(expSoon).length}</div></div>
      <div class="card"><div class="muted">Sudah Berakhir</div><div class="metric">${rows.filter(c => c.end_date && c.end_date < today).length}</div></div>
    </div>
    ${rows.length ? `<div class="table-wrap"><table class="table"><thead><tr>
      <th>Karyawan</th><th>No. Dokumen</th><th>Jenis</th><th>Mulai</th><th>Berakhir</th>${canViewCompensation() ? '<th>Remunerasi</th>' : ''}<th>Status</th><th>Aksi</th>
    </tr></thead><tbody>${rows.map(c => {
      const e = state.employees.find(x => x.id === c.employee_id);
      const n = daysUntil(c.end_date);
      const loc = c.work_location_id ? (state.workLocations.find(w => w.id === c.work_location_id)?.name || '-') : c.branch_id ? (state.branches.find(b => b.id === c.branch_id)?.name || '-') : '-';
      return `<tr>
        <td><b>${esc(e?.full_name || '-')}</b><div class="muted">${esc(e?.employee_number || '')}</div></td>
        <td>${esc(c.contract_number || '-')}</td>
        <td>${esc(contractTypeLabel(c.contract_type))}</td>
        <td>${fmtDate(c.start_date)}</td>
        <td>${fmtDate(c.end_date)} ${n !== null ? `<span class="badge ${n < 0 ? 'badge-red' : n <= 30 ? 'badge-yellow' : 'badge-green'}">${n < 0 ? 'Lewat' : n + ' hari'}</span>` : ''}</td>
        ${canViewCompensation() ? `<td><div>${moneyFmt(c.base_salary)}</div><div class="muted">${esc(loc)}</div></td>` : ''}
        <td>${contractStatusBadge(c.status)}</td>
        <td><div class="row-actions"><button class="btn btn-light btn-sm" onclick="contractForm('${esc(c.id)}')">Edit</button>${c.document_path ? `<button class="btn btn-light btn-sm" onclick="contractOpenDocument('${esc(c.document_path)}')">Dokumen</button>` : ''}</div></td>
      </tr>`;
    }).join('')}</tbody></table></div>` : '<div class="card empty">Belum ada kontrak. Klik <b>+ Tambah Kontrak</b> untuk memasukkan dokumen pertama.</div>'}
  </div>`;
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
function openModal(titleText, bodyHtml, onSubmit, submitLabel = 'Simpan', afterSave = null) {
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
      if (ok) { close(); await loadAll(); renderApp(); if (afterSave) afterSave(); }
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
  companies:   { label: 'Perusahaan', table: 'companies',   empField: 'company_id',    hasCode: true, hasGeo: true },
  branches:    { label: 'Outlet',     table: 'branches',    empField: 'branch_id',     hasCode: true,  hasCompany: true, companyRequired: true, hasGeo: true },
  departments: { label: 'Departemen', table: 'departments', empField: 'department_id', hasCompany: true },
  positions:   { label: 'Jabatan',    table: 'positions',   empField: 'position_id',   hasCompany: true },
  workLocations: { label: 'Lokasi Kerja', table: 'work_locations', empField: 'work_location_id', hasCompany: true, companyRequired: true, hasGeo: true }
};

const usageCount = (t, id) => t === 'branches'
  ? state.employees.filter(e => state.currentByEmp[e.id]?.branch_id === id).length
  : t === 'workLocations'
    ? state.employees.filter(e => state.currentByEmp[e.id]?.work_location_id === id).length
    : state.employees.filter(e => e[MASTER[t].empField] === id).length;
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
  const geoCol = ['Lokasi Absensi', r => {
    const pre = t === 'companies' ? 'work_' : '';
    const la = r[pre + 'latitude'], lo = r[pre + 'longitude'];
    if (la == null || lo == null) {
      if (t === 'companies' && state.branches.some(b => b.company_id === r.id && isActive(b))) return '<span class="muted">Mengikuti outlet</span>';
      return '<span class="badge badge-yellow">Belum diatur</span>';
    }
    return `${Number(la).toFixed(5)}, ${Number(lo).toFixed(5)} · ${esc(r[pre + 'radius_meter'] || 100)} m`;
  }];
  const cols = {
    companies: [['Nama Perusahaan', nameCol[1]], codeCol, geoCol, stCol, ['Jumlah Outlet', r => state.branches.filter(b => b.company_id === r.id && isActive(b)).length], ['Jumlah Karyawan', cnt]],
    branches: [['Nama Outlet', nameCol[1]], ['Kode Outlet', codeCol[1]], coCol, geoCol, empCol, stCol],
    departments: [['Nama Departemen', nameCol[1]], coCol, empCol, stCol],
    positions: [['Nama Jabatan', nameCol[1]], coCol, empCol, stCol],
    workLocations: [['Nama Lokasi Kerja', nameCol[1]], coCol, ['Alamat', r => esc(r.address || '-')], geoCol, empCol, stCol]
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

function parseGeo(fd, pre) {
  const num = v => { const x = String(v || '').trim().replace(',', '.'); return x === '' ? null : Number(x); };
  const lat = num(fd.get(pre + 'latitude')), lng = num(fd.get(pre + 'longitude')), rad = num(fd.get(pre + 'radius_meter'));
  if ((lat === null) !== (lng === null)) return { error: 'Isi latitude dan longitude sekaligus, atau kosongkan keduanya.' };
  if (lat !== null && (!isFinite(lat) || lat < -90 || lat > 90)) return { error: 'Latitude harus berupa angka antara -90 dan 90.' };
  if (lng !== null && (!isFinite(lng) || lng < -180 || lng > 180)) return { error: 'Longitude harus berupa angka antara -180 dan 180.' };
  if (rad !== null && (!Number.isInteger(rad) || rad < 10 || rad > 5000)) return { error: 'Radius harus bilangan bulat 10–5000 meter.' };
  return { values: { [pre + 'latitude']: lat, [pre + 'longitude']: lng, [pre + 'radius_meter']: rad === null ? 100 : rad } };
}

window.masterForm = (t, id) => {
  const m = MASTER[t];
  const pre = t === 'companies' ? 'work_' : '';
  const rec = id ? state[t].find(r => r.id === id) : null;
  const selCompany = rec ? rec.company_id : state.masterF.company;
  const coOptions = state.companies.filter(c => isActive(c) || c.id === selCompany)
    .map(c => `<option value="${esc(c.id)}" ${selCompany === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  const body = `<div class="modal-grid">
    <div class="field"><label>Nama ${esc(m.label)} *</label><input name="name" required value="${esc(rec?.name || '')}"></div>
    ${m.hasCode ? `<div class="field"><label>Kode ${esc(m.label)}</label><input name="code" value="${esc(rec?.code || '')}"></div>` : ''}
    ${m.hasCompany ? `<div class="field"><label>Perusahaan${m.companyRequired ? ' *' : ''}</label><select name="company_id" ${m.companyRequired ? 'required' : ''}><option value="">${m.companyRequired ? 'Pilih perusahaan' : 'Semua perusahaan (umum)'}</option>${coOptions}</select></div>` : ''}
    ${t === 'workLocations' ? `<div class="field field-full"><label>Alamat</label><textarea name="address" rows="2">${esc(rec?.address || '')}</textarea></div>` : ''}
    ${m.hasGeo ? `<div class="field field-full"><label>${t === 'companies' ? 'Lokasi kerja perusahaan (opsional)' : 'Lokasi absensi outlet'}</label><div class="muted">${t === 'companies' ? 'Isi hanya untuk perusahaan tanpa outlet (mis. Zayco Boga Alifa). Perusahaan yang memiliki outlet memakai lokasi outlet.' : 'Isi koordinat outlet untuk mengaktifkan absensi GPS. Kosongkan jika belum diketahui; jangan diisi perkiraan.'}</div></div>
    <div class="field"><label>Latitude</label><input name="${pre}latitude" inputmode="decimal" placeholder="contoh: -6.2088" value="${esc(rec?.[pre + 'latitude'] ?? '')}"></div>
    <div class="field"><label>Longitude</label><input name="${pre}longitude" inputmode="decimal" placeholder="contoh: 106.8456" value="${esc(rec?.[pre + 'longitude'] ?? '')}"></div>
    <div class="field"><label>Radius absensi (meter)</label><input name="${pre}radius_meter" inputmode="numeric" placeholder="100" value="${esc(rec?.[pre + 'radius_meter'] ?? 100)}"></div>
    <div class="field"><label>&nbsp;</label><button type="button" class="btn btn-light" id="useMyLoc">Gunakan lokasi saya saat ini</button></div>` : ''}
    ${rec ? `<div class="field"><label>Status</label><select name="is_active"><option value="true" ${isActive(rec) ? 'selected' : ''}>Aktif</option><option value="false" ${isActive(rec) ? '' : 'selected'}>Tidak Aktif</option></select></div>` : ''}
  </div>`;
  const gm = openModal((rec ? 'Edit ' : 'Tambah ') + m.label, body, async form => {
    const fd = new FormData(form);
    const name = String(fd.get('name') || '').trim();
    if (!name) { toast('Nama wajib diisi.', 'error'); return false; }
    const payload = { name };
    if (m.hasCode) payload.code = String(fd.get('code') || '').trim() || null;
    if (m.hasCompany) payload.company_id = fd.get('company_id') || null;
    if (t === 'workLocations') payload.address = String(fd.get('address') || '').trim() || null;
    if (m.hasGeo) { const g = parseGeo(fd, pre); if (g.error) { toast(g.error, 'error'); return false; } Object.assign(payload, g.values); }
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
  const locBtn = gm.querySelector('#useMyLoc');
  if (locBtn) locBtn.onclick = () => {
    if (!navigator.geolocation) { toast('Browser tidak mendukung lokasi (GPS).', 'error'); return; }
    const old = locBtn.textContent; locBtn.disabled = true; locBtn.textContent = 'Mengambil lokasi...';
    navigator.geolocation.getCurrentPosition(pos => {
      gm.querySelector(`[name="${pre}latitude"]`).value = pos.coords.latitude.toFixed(6);
      gm.querySelector(`[name="${pre}longitude"]`).value = pos.coords.longitude.toFixed(6);
      toast(`Lokasi terisi (akurasi ±${Math.round(pos.coords.accuracy)} m). Lakukan ini saat berada di titik lokasi kerja.`);
      locBtn.disabled = false; locBtn.textContent = old;
    }, () => {
      toast('Lokasi tidak dapat diperoleh. Aktifkan GPS dan izin lokasi browser.', 'error');
      locBtn.disabled = false; locBtn.textContent = old;
    }, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
  };
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
    if (obj.branch_id) {   // outlet awal => catat sebagai penempatan pertama
      const a = await sb.from('employee_assignments').insert({ employee_id: data[0].id, branch_id: obj.branch_id, start_date: obj.join_date, end_date: null, is_active: true }).select();
      if (a.error || !a.data || !a.data.length) toast('Karyawan tersimpan, tetapi penempatan outlet awal gagal dibuat: ' + (a.error ? friendlyError(a.error) : PERMISSION_MSG) + ' Tambahkan lewat tombol Detail.', 'error');
    }
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

/* ---------- Penempatan / Mutasi Outlet (employee_assignments) ---------- */
function rebuildAssignmentIndex() {
  const idx = {};
  [...state.assignments].sort((a, b) => String(b.start_date).localeCompare(String(a.start_date))).forEach(a => {
    if (a.is_active !== false && !a.end_date && !idx[a.employee_id]) idx[a.employee_id] = a;
  });
  state.currentByEmp = idx;
}
function currentOutletName(empId) {
  const a = state.currentByEmp[empId];
  return assignmentLocationName(a);
}
function assignmentLocationName(a) {
  if (!a) return '-';
  if (a.work_location_id) return a.work_locations?.name || state.workLocations.find(w => w.id === a.work_location_id)?.name || '-';
  if (a.branch_id) return a.branches?.name || state.branches.find(b => b.id === a.branch_id)?.name || '-';
  return 'Tidak ada lokasi';
}
const assignmentOutlet = a => assignmentLocationName(a);
function assignmentStatus(a) {
  if (a.end_date) return { label: 'Selesai', cls: 'badge-gray' };
  if (a.is_active !== false) return { label: 'Aktif', cls: 'badge-green' };
  return { label: 'Nonaktif', cls: 'badge-yellow' };
}
const EMP_TYPE = { permanent: 'Tetap', contract: 'Kontrak', intern: 'Intern', part_time: 'Part Time', daily: 'Harian' };

window.employeeEditForm = (id) => {
  const e = state.employees.find(x => x.id === id);
  if (!e) return;
  const companyOptions = state.companies.filter(c => isActive(c) || c.id === e.company_id)
    .map(c => `<option value="${esc(c.id)}" ${e.company_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');
  const body = `<div class="modal-grid">
    <div class="field"><label>ID Karyawan *</label><input name="employee_number" required value="${esc(e.employee_number || '')}"></div>
    <div class="field"><label>Nama Lengkap *</label><input name="full_name" required value="${esc(e.full_name || '')}"></div>
    <div class="field"><label>NIK</label><input name="nik" inputmode="numeric" value="${esc(e.nik || '')}"></div>
    <div class="field"><label>Email</label><input name="email" type="email" value="${esc(e.email || '')}"></div>
    <div class="field"><label>No. HP</label><input name="phone" type="tel" value="${esc(e.phone || '')}"></div>
    <div class="field"><label>Tanggal Masuk *</label><input name="join_date" type="date" required value="${esc(e.join_date || '')}"></div>
    <div class="field"><label>Perusahaan *</label><select name="company_id" required>${companyOptions}</select></div>
    <div class="field"><label>Departemen</label><select name="department_id"></select></div>
    <div class="field"><label>Jabatan</label><select name="position_id"></select></div>
    <div class="field"><label>Status</label><select name="employment_status"><option value="active" ${e.employment_status === 'active' ? 'selected' : ''}>Aktif</option><option value="inactive" ${e.employment_status === 'inactive' ? 'selected' : ''}>Tidak Aktif</option></select></div>
    <div class="field"><label>Tipe</label><select name="employment_type"><option value="permanent" ${e.employment_type === 'permanent' ? 'selected' : ''}>Tetap</option><option value="contract" ${e.employment_type === 'contract' ? 'selected' : ''}>Kontrak</option><option value="intern" ${e.employment_type === 'intern' ? 'selected' : ''}>Intern</option><option value="part_time" ${e.employment_type === 'part_time' ? 'selected' : ''}>Part Time</option><option value="daily" ${e.employment_type === 'daily' ? 'selected' : ''}>Harian</option></select></div>
    <div class="field field-full"><div class="muted">Lokasi/outlet tidak diedit di sini. Gunakan <b>Riwayat Penempatan</b> agar setiap mutasi tetap tercatat.</div></div>
  </div>`;
  const modal = openModal('Edit Data Karyawan', body, async form => {
    const fd = new FormData(form);
    const employee_number = String(fd.get('employee_number') || '').trim();
    const full_name = String(fd.get('full_name') || '').trim();
    const join_date = fd.get('join_date') || '';
    const company_id = fd.get('company_id') || null;
    if (!employee_number || !full_name || !join_date || !company_id) { toast('Lengkapi field bertanda *.', 'error'); return false; }
    const dup = state.employees.find(x => x.id !== id && String(x.employee_number || '').toLowerCase() === employee_number.toLowerCase());
    if (dup) { toast(`ID Karyawan "${employee_number}" sudah dipakai oleh ${dup.full_name}.`, 'error'); return false; }
    const payload = {
      employee_number, full_name,
      nik: String(fd.get('nik') || '').trim() || null,
      email: String(fd.get('email') || '').trim() || null,
      phone: String(fd.get('phone') || '').trim() || null,
      join_date, company_id,
      department_id: fd.get('department_id') || null,
      position_id: fd.get('position_id') || null,
      employment_status: fd.get('employment_status') || 'active',
      employment_type: fd.get('employment_type') || null
    };
    const res = await sb.from('employees').update(payload).eq('id', id).select();
    if (res.error) { toast(friendlyError(res.error), 'error'); return false; }
    if (!res.data || !res.data.length) { toast(PERMISSION_MSG, 'error'); return false; }
    toast(`Data karyawan "${full_name}" berhasil diperbarui.`);
    return true;
  }, 'Simpan', () => showEmployeeDetail(id));
  const sel = n => modal.querySelector(`[name="${n}"]`);
  const fill = (name, items, placeholder, current) => {
    sel(name).innerHTML = `<option value="">${placeholder}</option>` + items.map(x => `<option value="${esc(x.id)}" ${current === x.id ? 'selected' : ''}>${esc(x.name)}${isActive(x) ? '' : ' (nonaktif)'}</option>`).join('');
  };
  const refresh = () => {
    const cid = sel('company_id').value;
    const depts = state.departments.filter(d => isActive(d) && (d.company_id === cid || !d.company_id) || d.id === e.department_id);
    const poss = state.positions.filter(p => isActive(p) && (p.company_id === cid || !p.company_id) || p.id === e.position_id);
    fill('department_id', cid ? depts : [], cid ? 'Pilih departemen' : 'Pilih perusahaan dulu', e.department_id);
    fill('position_id', cid ? poss : [], cid ? 'Pilih jabatan' : 'Pilih perusahaan dulu', e.position_id);
    sel('department_id').disabled = sel('position_id').disabled = !cid;
  };
  sel('company_id').onchange = refresh;
  refresh();
};

window.showEmployeeDetail = id => {
  const e = state.employees.find(x => x.id === id);
  if (!e) { toast('Data karyawan tidak ditemukan.', 'error'); return; }
  const old = $('#detailModal'); if (old) old.remove();
  const rows = state.assignments.filter(a => a.employee_id === id)
    .sort((a, b) => String(b.start_date).localeCompare(String(a.start_date)));
  const item = (label, val) => `<div class="detail-item"><div class="muted">${label}</div><div>${esc(val || '-')}</div></div>`;
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop'; modal.id = 'detailModal';
  modal.innerHTML = `<div class="modal modal-wide">
    <div class="section-head"><h2>${esc(e.full_name)}</h2><div style="display:flex;gap:8px"><button type="button" class="btn btn-primary" onclick="employeeEditForm('${esc(id)}')">Edit Data</button><button type="button" class="btn btn-light" data-close>Tutup</button></div></div>
    <h3 class="sub-title">Profil Karyawan</h3>
    <div class="detail-grid">
      ${item('ID Karyawan', e.employee_number)}${item('Nama Lengkap', e.full_name)}${item('NIK', e.nik)}
      ${item('No. HP', e.phone)}${item('Email', e.email)}${item('Perusahaan', e.companies?.name)}
      ${item('Departemen', e.departments?.name)}${item('Jabatan', e.positions?.name)}${item('Status', e.employment_status === 'active' ? 'Aktif' : e.employment_status === 'inactive' ? 'Tidak Aktif' : e.employment_status)}
      ${item('Tipe Karyawan', EMP_TYPE[e.employment_type] || e.employment_type)}${item('Tanggal Masuk', e.join_date ? fmtDate(e.join_date) : '')}${item('Lokasi Saat Ini', currentOutletName(id))}
    </div>
    <div class="section-head" style="margin-top:22px"><h3 class="sub-title" style="margin:0">Riwayat Penempatan</h3><button type="button" class="btn btn-primary" onclick="assignmentForm('${esc(id)}')">+ Tambah Penempatan</button></div>
    ${rows.length ? `<div class="table-wrap"><table class="table"><thead><tr><th>Outlet / Lokasi Kerja</th><th>Mulai</th><th>Selesai</th><th>Status</th><th>Catatan</th><th>Aksi</th></tr></thead><tbody>${rows.map(a => { const st = assignmentStatus(a); return `<tr><td><b>${esc(assignmentOutlet(a))}</b></td><td>${fmtDate(a.start_date)}</td><td>${fmtDate(a.end_date)}</td><td><span class="badge ${st.cls}">${st.label}</span></td><td>${esc(a.notes || '-')}</td><td><button class="btn btn-light btn-sm" onclick="assignmentForm('${esc(id)}','${esc(a.id)}')">Edit</button></td></tr>`; }).join('')}</tbody></table></div>` : '<div class="card empty">Belum ada riwayat penempatan.</div>'}
  </div>`;
  document.body.appendChild(modal);
  modal.querySelectorAll('[data-close]').forEach(b => b.onclick = () => modal.remove());
};

// Cek tabrakan tanggal. Rentang [mulai, selesai) ; selesai kosong = masih berjalan. Bersentuhan (selesai = mulai berikutnya) diperbolehkan.
function assignmentConflict(empId, cand, ignoreIds = []) {
  const cEnd = cand.end_date || '9999-12-31';
  for (const o of state.assignments) {
    if (o.employee_id !== empId || o.id === cand.id || ignoreIds.includes(o.id)) continue;
    const oEnd = o.end_date || '9999-12-31';
    if (cand.start_date < oEnd && o.start_date < cEnd) {
      return `Tanggal bertabrakan dengan penempatan di ${assignmentOutlet(o)} (${fmtDate(o.start_date)} – ${o.end_date ? fmtDate(o.end_date) : 'sekarang'}). Sesuaikan tanggal mulai/selesai.`;
    }
  }
  return null;
}

window.assignmentForm = (empId, assignId) => {
  const emp = state.employees.find(x => x.id === empId);
  if (!emp) return;
  const rec = assignId ? state.assignments.find(a => a.id === assignId) : null;
  const branches = state.branches.filter(b => b.company_id === emp.company_id && (isActive(b) || b.id === rec?.branch_id));
  const locations = state.workLocations.filter(w => w.company_id === emp.company_id && (isActive(w) || w.id === rec?.work_location_id));
  const hasOutlets = branches.length > 0;
  const hasLocations = locations.length > 0;
  const isZaycoStyle = !hasOutlets && hasLocations;
  const outletField = hasOutlets
    ? `<select name="branch_id" required><option value="">Pilih outlet</option>${branches.map(b => `<option value="${esc(b.id)}" ${rec?.branch_id === b.id ? 'selected' : ''}>${esc(b.name)}${isActive(b) ? '' : ' (nonaktif)'}</option>`).join('')}</select>`
    : isZaycoStyle
      ? `<select name="work_location_id" required><option value="">Pilih lokasi kerja</option>${locations.map(w => `<option value="${esc(w.id)}" ${rec?.work_location_id === w.id ? 'selected' : ''}>${esc(w.name)}${isActive(w) ? '' : ' (nonaktif)'}</option>`).join('')}</select>`
      : `<input value="Belum ada lokasi kerja" disabled><input type="hidden" name="work_location_id" value="">`;
  const locationLabel = hasOutlets ? 'Outlet' : 'Lokasi Kerja';
  const body = `<div class="modal-grid">
    <div class="field"><label>Karyawan</label><input value="${esc(emp.full_name)} — ${esc(emp.companies?.name || '')}" disabled></div>
    <div class="field"><label>${locationLabel}${(hasOutlets || isZaycoStyle) ? ' *' : ''}</label>${outletField}</div>
    <div class="field"><label>Tanggal Mulai *</label><input name="start_date" type="date" required value="${esc(rec?.start_date || '')}"></div>
    <div class="field"><label>Tanggal Selesai</label><input name="end_date" type="date" value="${esc(rec?.end_date || '')}"></div>
    <div class="field" style="grid-column:1/-1"><label>Catatan</label><textarea name="notes" rows="2">${esc(rec?.notes || '')}</textarea></div>
  </div>`;
  openModal(rec ? 'Edit Penempatan' : 'Tambah Penempatan', body, async form => {
    const fd = new FormData(form);
    const start_date = fd.get('start_date') || '';
    const end_date = fd.get('end_date') || null;
    const notes = String(fd.get('notes') || '').trim() || null;
    const branch_id = hasOutlets ? (fd.get('branch_id') || null) : null;
    const work_location_id = hasOutlets ? null : (fd.get('work_location_id') || null);
    if (hasOutlets && !branch_id) { toast('Pilih outlet terlebih dahulu.', 'error'); return false; }
    if (!hasOutlets && isZaycoStyle && !work_location_id) { toast('Pilih lokasi kerja terlebih dahulu.', 'error'); return false; }
    if (!start_date) { toast('Tanggal mulai wajib diisi.', 'error'); return false; }
    if (end_date && end_date < start_date) { toast('Tanggal selesai tidak boleh lebih kecil dari tanggal mulai.', 'error'); return false; }
    const now = new Date().toISOString();
    const payload = { branch_id, work_location_id, start_date, end_date, notes, is_active: !end_date, updated_at: now };

    /* --- EDIT --- */
    if (rec) {
      const err = assignmentConflict(empId, { id: rec.id, start_date, end_date });
      if (err) { toast(err, 'error'); return false; }
      const res = await sb.from('employee_assignments').update(payload).eq('id', rec.id).select();
      if (res.error) { toast(friendlyError(res.error), 'error'); return false; }
      if (!res.data || !res.data.length) { toast(PERMISSION_MSG, 'error'); return false; }
      toast('Penempatan berhasil diperbarui.');
      return true;
    }

    /* --- TAMBAH --- */
    const act = state.currentByEmp[empId];
    const replacing = !!act && !end_date;
    if (replacing) {
      if (start_date < act.start_date) {
        toast(`Tanggal mulai tidak boleh sebelum penempatan aktif terakhir (${assignmentOutlet(act)}, mulai ${fmtDate(act.start_date)}).`, 'error');
        return false;
      }
      const err = assignmentConflict(empId, { start_date, end_date }, [act.id]);
      if (err) { toast(err, 'error'); return false; }
      if (!confirm(`Karyawan ini masih memiliki penempatan aktif di ${assignmentOutlet(act)}.\nApakah penempatan lama akan diakhiri dan diganti dengan penempatan baru?`)) return false;
      const closed = await sb.from('employee_assignments').update({ end_date: start_date, is_active: false, updated_at: now }).eq('id', act.id).select();
      if (closed.error) { toast(friendlyError(closed.error), 'error'); return false; }
      if (!closed.data || !closed.data.length) { toast(PERMISSION_MSG, 'error'); return false; }
      const ins = await sb.from('employee_assignments').insert({ employee_id: empId, branch_id, work_location_id, start_date, end_date: null, is_active: true, notes }).select();
      if (ins.error || !ins.data || !ins.data.length) {
        await sb.from('employee_assignments').update({ end_date: act.end_date || null, is_active: true, updated_at: new Date().toISOString() }).eq('id', act.id);
        toast('Mutasi dibatalkan, penempatan lama dikembalikan. ' + (ins.error ? friendlyError(ins.error) : PERMISSION_MSG), 'error');
        return false;
      }
      toast('Mutasi berhasil: penempatan lama diakhiri dan penempatan baru dibuat.');
      return true;
    }

    const err = assignmentConflict(empId, { start_date, end_date });
    if (err) { toast(err, 'error'); return false; }
    const res = await sb.from('employee_assignments').insert({ employee_id: empId, branch_id, work_location_id, start_date, end_date, notes, is_active: !end_date }).select();
    if (res.error) { toast(friendlyError(res.error), 'error'); return false; }
    if (!res.data || !res.data.length) { toast(PERMISSION_MSG, 'error'); return false; }
    toast('Penempatan berhasil ditambahkan.');
    return true;
  }, 'Simpan', () => showEmployeeDetail(empId));
};

/* =====================================================================
   PHASE 3 — ABSENSI (selfie + GPS + geofencing)
   - Waktu, jarak, dan status dihitung di server (RPC submit_attendance).
   - Kamera & GPS hanya aktif saat karyawan menekan tombol absen.
   ===================================================================== */
const ATT_STATUS = { valid: ['Valid', 'badge-green'], late: ['Terlambat', 'badge-yellow'], outside_area: ['Di luar area', 'badge-red'], gps_error: ['GPS error', 'badge-red'], rejected: ['Ditolak', 'badge-red'] };
const attBadge = s => s ? `<span class="badge ${ATT_STATUS[s]?.[1] || 'badge-gray'}">${esc(ATT_STATUS[s]?.[0] || s)}</span>` : '<span class="muted">-</span>';
const attLocation = r => r.work_location_name || (r.branch_id ? (state.branches.find(b => b.id === r.branch_id)?.name || '-') : '-');
const attAction = c => { const r = c && c.record; return !r || !r.check_in_at ? 'check_in' : (!r.check_out_at ? 'check_out' : null); };

async function loadAttCtx() {
  const { data, error } = await sb.rpc('attendance_context');
  if (error) { state.attCtx = null; state.attCtxError = friendlyError(error); return false; }
  state.attCtxError = null; state.attCtx = data;
  state.clockOffset = new Date(data.server_now).getTime() - Date.now();
  return true;
}
async function loadTodayAtt() {
  const { data, error } = await sb.from('attendance_records').select('*').eq('attendance_date', todayJakarta());
  if (!error) state.attToday = data || [];
}
async function loadAttHistory() {
  const f = state.attF;
  const { data, error } = await sb.from('attendance_records')
    .select('*, employees(full_name, employee_number, company_id)')
    .gte('attendance_date', f.from).lte('attendance_date', f.to)
    .order('attendance_date', { ascending: false }).order('check_in_at', { ascending: false }).limit(2000);
  if (error) { toast('Gagal memuat riwayat absensi. ' + friendlyError(error), 'error'); state.attendance = []; return; }
  state.attendance = data || [];
}
async function refreshAttendance() {
  await Promise.all([loadAttCtx(), loadTodayAtt(), loadAttHistory()]);
  if (state.view === 'attendance') { renderAttPanel(); renderAttHistory(); }
}

/* ---------- Halaman Absensi ---------- */
function attendance() {
  const f = state.attF;
  if (!f.to) f.to = todayJakarta();
  if (!f.from) f.from = addDays(f.to, -6);
  $('#content').innerHTML = `<div id="attPanel"><div class="card empty">Memuat data absensi...</div></div><div class="section" id="attHistory"></div>`;
  (async () => {
    await loadAttCtx();
    if (state.view !== 'attendance') return;
    renderAttPanel();
    await loadAttHistory();
    if (state.view === 'attendance') renderAttHistory();
  })();
}

function renderAttPanel() {
  const box = $('#attPanel'); if (!box) return;
  const head = '<div class="section-head"><h2>Absen Hari Ini</h2></div>';
  const c = state.attCtx;
  if (!c) { box.innerHTML = `<div class="card att-panel">${head}<div class="error">${esc(state.attCtxError || 'Data absensi tidak dapat dimuat.')}</div></div>`; return; }
  if (!c.linked) {
    box.innerHTML = `<div class="card att-panel">${head}<div class="info-box">Akun Anda belum terhubung ke data karyawan, sehingga panel absen pribadi tidak tersedia. Riwayat dan rekap absensi seluruh karyawan tetap dapat dilihat di bawah. Untuk menghubungkan akun, isi kolom <b>profiles.employee_id</b> (lihat petunjuk di SQL migration Phase 3).</div></div>`;
    return;
  }
  const e = state.employees.find(x => x.id === c.employee_id) || {};
  const t = c.target || {}, rec = c.record, tz = c.timezone;
  const action = attAction(c), g = state.attGeo;
  let statusTxt = 'Belum absen masuk';
  if (rec && rec.check_in_at) statusTxt = `Masuk ${fmtTime(rec.check_in_at, tz)} (${ATT_STATUS[rec.check_in_status]?.[0] || '-'})` + (rec.check_out_at ? ` · Keluar ${fmtTime(rec.check_out_at, tz)}` : ' · Belum absen keluar');
  const item = (l, v, id) => `<div class="detail-item"><div class="muted">${l}</div><div ${id ? `id="${id}"` : ''}>${v}</div></div>`;
  const locLabel = t.kind === 'company' ? 'Lokasi kerja' : 'Outlet aktif';
  box.innerHTML = `<div class="card att-panel">${head}
    <div class="info-box">Absensi membutuhkan akses kamera dan lokasi perangkat. Kamera dan GPS hanya diaktifkan saat Anda menekan tombol absen, tidak ada pelacakan lokasi di latar belakang.</div>
    <div class="detail-grid" style="margin-top:14px">
      ${item('Nama', esc(e.full_name || '-'))}${item('ID Karyawan', esc(e.employee_number || '-'))}${item('Perusahaan', esc(e.companies?.name || '-'))}
      ${item(locLabel, esc(t.name || '-'))}${item('Tanggal', esc(fmtDate(c.today)))}${item('Jam server', '--:--:--', 'attClock')}
      ${item('Status GPS', g ? (g.inside ? 'Di dalam area' : 'Di luar area') : 'Diperiksa saat absen')}${item('Akurasi', g ? Math.round(g.acc) + ' meter' : '-- meter')}${item('Status absensi', esc(statusTxt))}
    </div>
    ${t.configured ? '' : `<div class="error">${esc(t.message || 'Lokasi kerja belum dikonfigurasi.')}${t.kind === 'branch' || t.kind === 'company' ? ' Hubungi admin HR untuk mengisi koordinat di Master Data.' : ''}</div>`}
    ${action
      ? `<button class="btn btn-primary btn-lg btn-block att-cta" ${t.configured ? '' : 'disabled'} onclick="startAttendance('${action}')">${action === 'check_in' ? 'ABSEN MASUK' : 'ABSEN KELUAR'}</button>`
      : '<div class="info-box ok-box" style="margin-top:14px">Absensi masuk dan keluar hari ini sudah lengkap.</div>'}
  </div>`;
  const tick = () => {
    const el = $('#attClock');
    if (!el) { clearInterval(state.clockTimer); return; }
    el.textContent = new Date(Date.now() + state.clockOffset).toLocaleTimeString('en-GB', { timeZone: tz, hourCycle: 'h23' });
  };
  clearInterval(state.clockTimer); tick(); state.clockTimer = setInterval(tick, 1000);
}

/* ---------- Alur absen: selfie + GPS + kirim ---------- */
window.startAttendance = async action => {
  if (state.flow) return;
  if (!(await loadAttCtx())) { toast(state.attCtxError || 'Gagal memuat data absensi.', 'error'); return; }
  renderAttPanel();
  const c = state.attCtx;
  if (!c.linked) return;
  const expected = attAction(c);
  if (expected !== action) { toast(expected ? 'Status absensi Anda sudah berubah. Silakan ulangi.' : 'Absensi hari ini sudah lengkap.', 'error'); return; }
  if (!c.target.configured) { toast(c.target.message || 'Lokasi kerja belum dikonfigurasi.', 'error'); return; }
  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('Browser tidak mendukung kamera. Gunakan Chrome atau Safari versi terbaru (alamat harus HTTPS).', 'error'); return; }
  if (!navigator.geolocation) { toast('Browser tidak mendukung lokasi (GPS).', 'error'); return; }
  openAttendanceFlow(action);
};

function openAttendanceFlow(action) {
  const c = state.attCtx, t = c.target, isIn = action === 'check_in';
  const label = isIn ? 'ABSEN MASUK' : 'ABSEN KELUAR';
  const placeLabel = t.kind === 'company' ? 'lokasi kerja' : 'outlet';
  const flow = state.flow = { action, stream: null, blob: null, previewUrl: null, accepted: false, camMsg: 'Meminta akses kamera...', camErr: null, geo: null, geoErr: null, geoBusy: false, busy: false };
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop att-backdrop'; modal.id = 'attModal';
  modal.innerHTML = `<div class="modal att-modal">
    <div class="section-head"><h2>${label}</h2><button type="button" class="btn btn-light" id="attClose">Tutup</button></div>
    <div class="att-camera"><video id="attVideo" autoplay playsinline muted></video><img id="attPhoto" alt="Hasil selfie" hidden><div id="attCamMsg" class="att-cam-msg"></div></div>
    <div class="att-shots"><button type="button" class="btn btn-primary btn-lg" id="attShoot" disabled>AMBIL SELFIE</button><button type="button" class="btn btn-light btn-lg" id="attRetake" hidden>Ambil Ulang</button><button type="button" class="btn btn-primary btn-lg" id="attUse" hidden>Gunakan Foto</button></div>
    <div class="att-rows">
      <div class="att-row"><span>GPS</span><b id="attGpsTxt">Mendapatkan lokasi...</b></div>
      <div class="att-row"><span>Akurasi</span><b id="attAccTxt">-- meter</b></div>
      <div class="att-row"><span>${t.kind === 'company' ? 'Lokasi kerja' : 'Outlet'}</span><b>${esc(t.name || '-')}</b></div>
      <div class="att-row"><span>Jarak dari ${placeLabel}</span><b id="attDistTxt">--</b></div>
      <div class="att-row"><span>Status lokasi</span><b id="attLocTxt">--</b></div>
    </div>
    <button type="button" class="btn btn-light btn-block" id="attGps">Perbarui Lokasi</button>
    <button type="button" class="btn btn-primary btn-lg btn-block att-submit" id="attSubmit" disabled>${label}</button>
  </div>`;
  document.body.appendChild(modal);
  const $m = sel => modal.querySelector(sel);
  const video = $m('#attVideo'), img = $m('#attPhoto');

  const evalGeo = () => {
    if (!flow.geo) return null;
    const dist = haversine(flow.geo.lat, flow.geo.lng, Number(t.latitude), Number(t.longitude));
    return { dist, inside: dist <= Number(t.radius), accOk: flow.geo.acc <= Number(c.max_accuracy_meter) };
  };
  const render = () => {
    // kamera / foto
    const showPhoto = !!flow.blob;
    video.hidden = showPhoto; img.hidden = !showPhoto;
    const msg = showPhoto ? '' : (flow.camMsg || '');
    $m('#attCamMsg').textContent = msg; $m('#attCamMsg').hidden = !msg;
    $m('#attShoot').hidden = showPhoto; $m('#attShoot').disabled = !flow.stream || !!flow.camMsg;
    $m('#attRetake').hidden = !(showPhoto || flow.camErr);
    $m('#attRetake').textContent = flow.camErr && !showPhoto ? 'Coba Kamera Lagi' : 'Ambil Ulang';
    $m('#attUse').hidden = !(showPhoto && !flow.accepted);
    // GPS
    const ev = evalGeo();
    const gpsTxt = $m('#attGpsTxt'), locTxt = $m('#attLocTxt');
    $m('#attGps').disabled = flow.geoBusy || flow.busy;
    if (flow.geoBusy) { gpsTxt.textContent = 'Mendapatkan lokasi...'; gpsTxt.className = ''; $m('#attAccTxt').textContent = '-- meter'; $m('#attDistTxt').textContent = '--'; locTxt.textContent = '--'; locTxt.className = ''; }
    else if (flow.geoErr) { gpsTxt.textContent = flow.geoErr; gpsTxt.className = 'bad'; $m('#attAccTxt').textContent = '-- meter'; $m('#attDistTxt').textContent = '--'; locTxt.textContent = '--'; locTxt.className = ''; }
    else if (ev) {
      gpsTxt.textContent = 'GPS berhasil'; gpsTxt.className = 'ok';
      $m('#attAccTxt').textContent = `${Math.round(flow.geo.acc)} meter`;
      $m('#attDistTxt').textContent = `${Math.round(ev.dist)} meter`;
      if (!ev.accOk) { locTxt.textContent = `Akurasi GPS terlalu rendah (maks ${c.max_accuracy_meter} m). Pindah ke area terbuka lalu perbarui lokasi.`; locTxt.className = 'bad'; }
      else if (!ev.inside) { locTxt.textContent = `Anda berada di luar area absensi (radius ${t.radius} m).`; locTxt.className = 'bad'; }
      else { locTxt.textContent = `Di dalam area absensi (radius ${t.radius} m)`; locTxt.className = 'ok'; }
    }
    $m('#attSubmit').disabled = !(flow.accepted && ev && ev.inside && ev.accOk) || flow.busy || flow.geoBusy;
    $m('#attSubmit').textContent = flow.busy ? 'Mengirim...' : label;
  };

  const stopCamera = () => {
    if (flow.stream) { flow.stream.getTracks().forEach(tr => tr.stop()); flow.stream = null; }
    video.srcObject = null;
  };
  const camError = e => (e && (e.name === 'NotAllowedError' || e.name === 'PermissionDeniedError'))
    ? 'Camera tidak diizinkan. Izinkan akses kamera untuk situs ini di pengaturan browser, lalu tekan Coba Kamera Lagi.'
    : (e && (e.name === 'NotFoundError' || e.name === 'DevicesNotFoundError')) ? 'Kamera tidak ditemukan di perangkat ini.'
    : 'Kamera tidak dapat dibuka. Pastikan tidak sedang dipakai aplikasi lain.';
  const startCamera = async () => {
    stopCamera(); flow.camErr = null; flow.camMsg = 'Meminta akses kamera...'; render();
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } }, audio: false });
    } catch (e) {
      if (state.flow !== flow) return;
      flow.camErr = camError(e); flow.camMsg = flow.camErr; render(); return;
    }
    if (state.flow !== flow) { stream.getTracks().forEach(tr => tr.stop()); return; }   // modal sudah ditutup
    flow.stream = stream; video.srcObject = stream;
    try { await video.play(); } catch (_) { /* iOS: autoplay tetap berjalan dengan muted + playsinline */ }
    flow.camMsg = ''; render();
  };

  const fetchGps = async () => {
    flow.geoBusy = true; flow.geo = null; flow.geoErr = null; render();
    try {
      const pos = await new Promise((res, rej) => navigator.geolocation.getCurrentPosition(res, rej, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }));
      flow.geo = { lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy };
    } catch (err) {
      flow.geoErr = err && err.code === 1
        ? 'Lokasi tidak diizinkan. Izinkan lokasi untuk situs ini di pengaturan browser, lalu tekan Perbarui Lokasi.'
        : 'Lokasi tidak dapat diperoleh. Aktifkan GPS dan izin lokasi browser.';
    }
    flow.geoBusy = false;
    if (state.flow !== flow) return;
    const ev = evalGeo();
    if (ev) state.attGeo = { acc: flow.geo.acc, dist: ev.dist, inside: ev.inside && ev.accOk };
    render();
  };

  const closeFlow = () => {
    stopCamera();
    if (flow.previewUrl) URL.revokeObjectURL(flow.previewUrl);
    modal.remove(); state.flow = null;
  };
  $m('#attClose').onclick = () => { if (flow.busy) { toast('Sedang mengirim absensi, mohon tunggu.', 'error'); return; } closeFlow(); };

  $m('#attShoot').onclick = () => {
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) { toast('Kamera belum siap. Tunggu sebentar lalu coba lagi.', 'error'); return; }
    const scale = Math.min(1, 960 / Math.max(vw, vh));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(vw * scale); canvas.height = Math.round(vh * scale);
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.toBlob(b => {
      if (!b) { toast('Gagal mengambil foto. Coba lagi.', 'error'); return; }
      if (flow.previewUrl) URL.revokeObjectURL(flow.previewUrl);
      flow.blob = b; flow.previewUrl = URL.createObjectURL(b); img.src = flow.previewUrl; flow.accepted = false;
      render();
    }, 'image/jpeg', 0.8);
  };
  $m('#attRetake').onclick = async () => {
    if (flow.previewUrl) { URL.revokeObjectURL(flow.previewUrl); flow.previewUrl = null; }
    flow.blob = null; flow.accepted = false; img.removeAttribute('src');
    if (flow.stream) render(); else await startCamera();
  };
  $m('#attUse').onclick = () => { flow.accepted = true; stopCamera(); render(); };
  $m('#attGps').onclick = fetchGps;

  $m('#attSubmit').onclick = async () => {
    const ev = evalGeo();
    if (!flow.accepted || !flow.blob) { toast('Selfie wajib diambil sebelum absensi.', 'error'); return; }
    if (!ev) { toast('Lokasi belum tersedia. Tekan Perbarui Lokasi.', 'error'); return; }
    if (!ev.accOk || !ev.inside) { toast('Anda berada di luar area absensi atau akurasi GPS terlalu rendah.', 'error'); return; }
    flow.busy = true; render();
    try {
      const [yyyy, mm] = c.today.split('-');
      const path = `attendance/${c.employee_id}/${yyyy}/${mm}/${c.today}/${isIn ? 'check-in' : 'check-out'}-${Date.now()}.jpg`;
      const up = await sb.storage.from('attendance-photos').upload(path, flow.blob, { contentType: 'image/jpeg', upsert: false });
      if (up.error) {
        const m = up.error.message || '';
        toast(/row-level security|policy|unauthorized/i.test(m) ? 'Izin unggah foto ditolak. Jalankan SQL migration Phase 3 dan pastikan akun terhubung ke data karyawan.'
          : /bucket not found/i.test(m) ? 'Bucket attendance-photos belum dibuat. Jalankan SQL migration Phase 3.'
          : 'Gagal mengunggah foto selfie: ' + m, 'error');
        return;
      }
      const { error } = await sb.rpc('submit_attendance', { p_action: action, p_latitude: flow.geo.lat, p_longitude: flow.geo.lng, p_accuracy: flow.geo.acc, p_photo_path: path });
      if (error) { toast(friendlyError(error), 'error'); return; }
      flow.busy = false; closeFlow();
      toast(isIn ? 'Absensi masuk berhasil.' : 'Absensi keluar berhasil.');
      state.attGeo = null;
      await refreshAttendance();
    } catch (err) {
      toast(friendlyError(err), 'error');
    } finally {
      if (state.flow === flow) { flow.busy = false; render(); }
    }
  };

  render(); startCamera(); fetchGps();
}

/* ---------- Riwayat & Rekap (HR) ---------- */
function attRows() {
  const f = state.attF, q = f.q.toLowerCase();
  return state.attendance.filter(r => {
    const e = r.employees || {};
    return (!q || [e.full_name, e.employee_number].join(' ').toLowerCase().includes(q)) &&
      (!f.company || e.company_id === f.company) &&
      (!f.branch || r.branch_id === f.branch) &&
      (!f.status || r.check_in_status === f.status || r.check_out_status === f.status);
  });
}

function renderAttHistory() {
  const box = $('#attHistory'); if (!box) return;
  const f = state.attF;
  const brs = state.branches.filter(b => !f.company || b.company_id === f.company);
  box.innerHTML = `<div class="section-head"><h2>Riwayat Absensi</h2></div>
    <div class="tabs"><button class="${state.attTab === 'history' ? 'active' : ''}" onclick="attTab('history')">Riwayat</button><button class="${state.attTab === 'recap' ? 'active' : ''}" onclick="attTab('recap')">Rekap</button></div>
    <div class="toolbar att-filters">
      <input id="aSearch" placeholder="Cari nama / ID..." value="${esc(f.q)}">
      <select id="aCompany"><option value="">Semua perusahaan</option>${state.companies.map(c => `<option value="${esc(c.id)}" ${f.company === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select>
      <select id="aBranch"><option value="">Semua outlet</option>${brs.map(b => `<option value="${esc(b.id)}" ${f.branch === b.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('')}</select>
      <label class="mini">Tanggal mulai<input id="aFrom" type="date" value="${esc(f.from)}"></label>
      <label class="mini">Tanggal akhir<input id="aTo" type="date" value="${esc(f.to)}"></label>
      <select id="aStatus"><option value="">Semua status</option>${Object.keys(ATT_STATUS).map(k => `<option value="${k}" ${f.status === k ? 'selected' : ''}>${ATT_STATUS[k][0]}</option>`).join('')}</select>
    </div><div id="attTable"></div>`;
  $('#aSearch').oninput = e => { f.q = e.target.value; drawAttTable(); };
  $('#aCompany').onchange = e => { f.company = e.target.value; f.branch = ''; renderAttHistory(); };
  $('#aBranch').onchange = e => { f.branch = e.target.value; drawAttTable(); };
  $('#aStatus').onchange = e => { f.status = e.target.value; drawAttTable(); };
  const reload = async () => {
    if (!f.from || !f.to) return;
    if (f.from > f.to) { toast('Tanggal mulai tidak boleh lebih besar dari tanggal akhir.', 'error'); return; }
    $('#attTable').innerHTML = '<div class="card empty">Memuat...</div>';
    await loadAttHistory(); if (state.view === 'attendance') drawAttTable();
  };
  $('#aFrom').onchange = e => { f.from = e.target.value; reload(); };
  $('#aTo').onchange = e => { f.to = e.target.value; reload(); };
  drawAttTable();
}
window.attTab = k => { state.attTab = k; renderAttHistory(); };

function drawAttTable() {
  const box = $('#attTable'); if (!box) return;
  const rows = attRows(), tz = attTz();
  if (!rows.length) { box.innerHTML = '<div class="card empty">Tidak ada data absensi untuk filter ini.</div>'; return; }
  if (state.attTab === 'recap') {
    const map = new Map(), today = todayJakarta();
    rows.forEach(r => {
      const e = r.employees || {};
      let x = map.get(r.employee_id);
      if (!x) { x = { name: e.full_name, num: e.employee_number, co: e.company_id, hadir: 0, valid: 0, late: 0, noOut: 0 }; map.set(r.employee_id, x); }
      if (r.check_in_at) {
        x.hadir++;
        if (r.check_in_status === 'late') x.late++; else x.valid++;
        if (!r.check_out_at && r.attendance_date < today) x.noOut++;
      }
    });
    const list = [...map.values()].sort((a, b) => String(a.name).localeCompare(String(b.name)));
    box.innerHTML = `<div class="table-wrap"><table class="table"><thead><tr><th>Karyawan</th><th>ID</th><th>Perusahaan</th><th>Hari Hadir</th><th>Tepat Waktu</th><th>Terlambat</th><th>Tanpa Absen Keluar</th></tr></thead><tbody>${list.map(x => `<tr><td><b>${esc(x.name || '-')}</b></td><td>${esc(x.num || '-')}</td><td>${esc(companyName(x.co, '-'))}</td><td>${x.hadir}</td><td>${x.valid}</td><td>${x.late ? `<span class="badge badge-yellow">${x.late}</span>` : 0}</td><td>${x.noOut ? `<span class="badge badge-red">${x.noOut}</span>` : 0}</td></tr>`).join('')}</tbody></table></div><div class="muted" style="margin-top:8px">Rekap dihitung dari data absensi pada rentang tanggal dan filter yang dipilih. "Tanpa Absen Keluar" tidak menghitung hari ini.</div>`;
    return;
  }
  box.innerHTML = `<div class="table-wrap"><table class="table"><thead><tr><th>Tanggal</th><th>Karyawan</th><th>Outlet</th><th>Masuk</th><th>Keluar</th><th>Status Masuk</th><th>Status Keluar</th><th>Aksi</th></tr></thead><tbody>${rows.map(r => { const e = r.employees || {}; return `<tr><td>${fmtDate(r.attendance_date)}</td><td><b>${esc(e.full_name || '-')}</b><div class="muted">${esc(e.employee_number || '')}</div></td><td>${esc(attLocation(r))}</td><td>${fmtTime(r.check_in_at, tz)}</td><td>${fmtTime(r.check_out_at, tz)}</td><td>${attBadge(r.check_in_status)}</td><td>${attBadge(r.check_out_status)}</td><td><button class="btn btn-light btn-sm" onclick="attDetail('${esc(r.id)}')">Detail</button></td></tr>`; }).join('')}</tbody></table></div>`;
}

window.attDetail = id => {
  const r = state.attendance.find(x => x.id === id); if (!r) return;
  const old = $('#attDetailModal'); if (old) old.remove();
  const e = r.employees || {}, tz = attTz();
  const co = companyName(e.company_id, '-');
  const item = (l, v) => `<div class="detail-item"><div class="muted">${l}</div><div>${v}</div></div>`;
  const gps = (la, lo) => la == null || lo == null ? '-' : `<a href="https://www.google.com/maps?q=${Number(la)},${Number(lo)}" target="_blank" rel="noopener noreferrer">${Number(la).toFixed(6)}, ${Number(lo).toFixed(6)}</a>`;
  const meters = v => v == null ? '-' : Math.round(Number(v)) + ' meter';
  const block = (title, at, la, lo, acc, dist, st, path) => `<div class="att-block"><h3 class="sub-title">${title}</h3>${at ? `<div class="att-photo" data-path="${esc(path || '')}">${path ? 'Memuat foto...' : 'Tidak ada foto'}</div><div class="detail-list">${item('Waktu', esc(fmtDateTime(at, tz)))}${item('Status', attBadge(st))}${item('GPS', gps(la, lo))}${item('Akurasi', acc == null ? '-' : Math.round(Number(acc)) + ' meter')}${item('Jarak dari ' + (r.branch_id ? 'outlet' : 'lokasi kerja'), meters(dist))}</div>` : '<div class="card empty">Belum ada data.</div>'}</div>`;
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop'; modal.id = 'attDetailModal';
  modal.innerHTML = `<div class="modal modal-wide">
    <div class="section-head"><h2>Detail Absensi</h2><button type="button" class="btn btn-light" data-close>Tutup</button></div>
    <div class="detail-grid">${item('Nama karyawan', esc(e.full_name || '-'))}${item('ID', esc(e.employee_number || '-'))}${item('Perusahaan', esc(co))}${item('Outlet / lokasi kerja', esc(attLocation(r)))}${item('Tanggal', esc(fmtDate(r.attendance_date)))}</div>
    <div class="att-detail-grid" style="margin-top:18px">
      ${block('Absen Masuk', r.check_in_at, r.check_in_latitude, r.check_in_longitude, r.check_in_accuracy, r.check_in_distance_meter, r.check_in_status, r.check_in_photo_path)}
      ${block('Absen Keluar', r.check_out_at, r.check_out_latitude, r.check_out_longitude, r.check_out_accuracy, r.check_out_distance_meter, r.check_out_status, r.check_out_photo_path)}
    </div></div>`;
  document.body.appendChild(modal);
  modal.querySelectorAll('[data-close]').forEach(b => b.onclick = () => modal.remove());
  // Foto bersifat private: ambil signed URL (berlaku 5 menit)
  modal.querySelectorAll('.att-photo[data-path]').forEach(async el => {
    const path = el.dataset.path; if (!path) return;
    const { data, error } = await sb.storage.from('attendance-photos').createSignedUrl(path, 300);
    if (error || !data) { el.textContent = 'Foto tidak dapat dimuat.'; return; }
    const im = new Image(); im.alt = 'Foto selfie absensi'; im.src = data.signedUrl;
    im.onerror = () => { el.textContent = 'Foto tidak dapat dimuat.'; };
    im.onload = () => { el.textContent = ''; el.appendChild(im); };
  });
};

init();

/* =========================================================
   PHASE 5 — CONTRACT GENERATOR
   Buat Kontrak dari Website + Export Word/PDF
   Tambahkan blok ini di PALING BAWAH app.js.
   ========================================================= */

async function cgLoadDocxConverter() {
  if (window.docshift) return window.docshift;

  return new Promise((resolve, reject) => {
    const old = document.querySelector('script[data-docshift="1"]');

    if (old) {
      old.addEventListener('load', () => resolve(window.docshift));
      old.addEventListener('error', () => reject(new Error('Library Word gagal dimuat.')));
      return;
    }

    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/docshift@0.0.73/dist/docshift.min.js';
    s.dataset.docshift = '1';

    s.onload = () => window.docshift
      ? resolve(window.docshift)
      : reject(new Error('Library Word tidak tersedia.'));

    s.onerror = () => reject(new Error('Library Word gagal dimuat.'));
    document.head.appendChild(s);
  });
}

const cgTypeLabel = t => ({
  offering_letter: 'Offering Letter',
  pkwt: 'Perjanjian Kerja Waktu Tertentu (PKWT)',
  pkwtt: 'Perjanjian Kerja Waktu Tidak Tertentu (PKWTT)',
  amendment: 'Amandemen PKWT',
  probation: 'Offering Letter / Probation'
}[t] || 'Dokumen Kontrak');

const cgMoney = n => {
  if (n === null || n === undefined || n === '' || Number(n) === 0) return '-';
  return 'Rp ' + Number(n).toLocaleString('id-ID');
};

const cgDate = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('id-ID', {
  day: 'numeric', month: 'long', year: 'numeric'
}) : '-';

const cgEsc = v => String(v ?? '').replace(/[&<>'"]/g, c => ({
  '&':'&amp;', '<':'&lt;', '>':'&gt;', "'":'&#39;', '"':'&quot;'
}[c]));

function cgCurrentLocation(emp) {
  const a = emp ? state.currentByEmp?.[emp.id] : null;
  if (!a) return '-';

  if (a.work_location_id) {
    return a.work_locations?.name ||
      state.workLocations?.find(x => x.id === a.work_location_id)?.name || '-';
  }

  if (a.branch_id) {
    return a.branches?.name ||
      state.branches?.find(x => x.id === a.branch_id)?.name || '-';
  }

  return '-';
}

function cgCompanyDefaults(companyName) {
  const zba = /zayco/i.test(companyName || '');

  return zba ? {
    representative: 'Zayadi',
    representative_title: 'Human Resource Departement',
    address: 'Jl. Arco Raya No. 24, RT.004/001 Cipete Selatan, Cilandak, Jakarta Selatan',
    hr_signer: 'Zayadi',
    hr_title: 'Human Resource Departement'
  } : {
    representative: 'Adhitya Erwin Pratama',
    representative_title: 'Human Resources Departement',
    address: '',
    hr_signer: 'Adhitya Erwin Pratama',
    hr_title: 'Human Resources Departement'
  };
}

function cgCompanyName(emp) {
  return emp?.companies?.name ||
    state.companies?.find(c => c.id === emp?.company_id)?.name ||
    '-';
}

function cgDepartment(emp) {
  return emp?.departments?.name ||
    state.departments?.find(d => d.id === emp?.department_id)?.name ||
    '-';
}

function cgPosition(emp) {
  return emp?.positions?.name ||
    state.positions?.find(p => p.id === emp?.position_id)?.name ||
    '-';
}

function cgEmployeeOptions(selected = '') {
  return state.employees
    .filter(e => e.employment_status !== 'inactive')
    .sort((a,b) => String(a.full_name || '').localeCompare(String(b.full_name || '')))
    .map(e => `<option value="${cgEsc(e.id)}" ${e.id === selected ? 'selected' : ''}>
      ${cgEsc(e.full_name || '-')} — ${cgEsc(e.employee_number || '-')}
    </option>`)
    .join('');
}

function cgField(name, label, value = '', type = 'text', required = false) {
  return `<div class="field">
    <label>${label}${required ? ' *' : ''}</label>
    <input name="${name}" type="${type}" ${required ? 'required' : ''} value="${cgEsc(value)}">
  </div>`;
}

function cgDateField(name, label, value = '', required = false) {
  return cgField(name, label, value, 'date', required);
}

function cgNumField(name, label, value = '') {
  return cgField(name, label, value, 'number');
}

function cgGeneratorForm() {
  const first = state.employees.find(e => e.employment_status !== 'inactive');
  const empId = first?.id || '';
  const emp = first;

  const body = `
    <div class="info-box">
      <b>Buat Kontrak dari Website</b><br>
      Pilih karyawan dan jenis dokumen. Data karyawan akan terisi otomatis.
      Setelah selesai, HR dapat melihat preview lalu Export Word atau PDF.
    </div>

    <div class="modal-grid">

      <div class="field field-full">
        <label>Karyawan *</label>
        <select name="cg_employee_id" required>
          <option value="">Pilih karyawan</option>
          ${cgEmployeeOptions(empId)}
        </select>
      </div>

      <div class="field">
        <label>Jenis Dokumen *</label>
        <select name="cg_type" required>
          <option value="offering_letter">Offering Letter</option>
          <option value="pkwt">PKWT</option>
          <option value="pkwtt">PKWTT</option>
          <option value="amendment">Amandemen PKWT</option>
        </select>
      </div>

      ${cgField('cg_number', 'No. Dokumen / Kontrak', '')}

      ${cgDateField('cg_join_date', 'Tanggal Bergabung', emp?.join_date || '')}
      ${cgDateField('cg_start_date', 'Tanggal Mulai', '', true)}
      ${cgDateField('cg_end_date', 'Tanggal Berakhir')}
      ${cgDateField('cg_signed_date', 'Tanggal Tanda Tangan')}

      <div class="field">
        <label>Departemen</label>
        <input name="cg_department" value="${cgEsc(cgDepartment(emp))}">
      </div>

      <div class="field">
        <label>Jabatan</label>
        <input name="cg_position" value="${cgEsc(cgPosition(emp))}">
      </div>

      ${cgField('cg_supervisor', 'Melapor Kepada', 'PIC (Person In Charge) - SPV/Asst.')}
      ${cgField('cg_work_days', 'Hari & Jam Kerja', '6 (Enam) Hari kerja, 1 (Satu) Hari Libur')}

      <div class="field field-full">
        <label>Lokasi Kerja</label>
        <input name="cg_location" value="${cgEsc(cgCurrentLocation(emp))}">
      </div>

      <div class="field field-full">
        <div class="sub-title">Remunerasi</div>
      </div>

      ${cgNumField('cg_base_salary', 'Gaji Pokok')}
      ${cgNumField('cg_position_allowance', 'Tunjangan Jabatan')}
      ${cgNumField('cg_performance', 'Insentif Kinerja')}
      ${cgNumField('cg_discipline', 'Tunjangan Kedisiplinan')}
      ${cgNumField('cg_meal', 'Tunjangan Makan')}
      ${cgNumField('cg_thr', 'THR')}

      <div class="field field-full">
        <div class="sub-title">Data Pihak Pertama</div>
      </div>

      ${cgField('cg_rep', 'Nama Perwakilan', '')}
      ${cgField('cg_rep_title', 'Jabatan Perwakilan', '')}
      <div class="field field-full">
        <label>Alamat Perusahaan</label>
        <textarea name="cg_company_address" rows="2"></textarea>
      </div>

      <div class="field field-full">
        <div class="sub-title">Catatan</div>
        <textarea name="cg_notes" rows="3"
          placeholder="Catatan internal HR / keterangan tambahan..."></textarea>
      </div>

    </div>
  `;

  const modal = openModal(
    'Buat Kontrak',
    body,
    async form => {
      const fd = new FormData(form);
      const employeeId = fd.get('cg_employee_id');
      const type = fd.get('cg_type');
      const start = fd.get('cg_start_date');

      if (!employeeId || !type || !start) {
        toast('Lengkapi Karyawan, Jenis Dokumen, dan Tanggal Mulai.', 'error');
        return false;
      }

      const emp = state.employees.find(e => e.id === employeeId);
      if (!emp) {
        toast('Karyawan tidak ditemukan.', 'error');
        return false;
      }

      const payload = {
        employee_id: employeeId,
        contract_type: type,
        contract_number: String(fd.get('cg_number') || '').trim() || null,
        status: 'draft',
        join_date: fd.get('cg_join_date') || emp.join_date || null,
        start_date: start,
        end_date: fd.get('cg_end_date') || null,
        signed_date: fd.get('cg_signed_date') || null,
        department_id: emp.department_id || null,
        position_id: emp.position_id || null,
        base_salary: Number(fd.get('cg_base_salary')) || null,
        position_allowance: Number(fd.get('cg_position_allowance')) || null,
        performance_incentive: Number(fd.get('cg_performance')) || null,
        discipline_allowance: Number(fd.get('cg_discipline')) || null,
        meal_allowance: Number(fd.get('cg_meal')) || null,
        thr_amount: Number(fd.get('cg_thr')) || null,
        notes: String(fd.get('cg_notes') || '').trim() || null
      };

      const res = await sb.from('contracts').insert(payload).select();
      if (res.error) {
        toast(friendlyError(res.error), 'error');
        return false;
      }

      toast('Draft kontrak berhasil dibuat.');
      return true;
    },
    'Simpan Draft',
    () => {
      setTimeout(() => cgOpenGenerator(), 250);
    }
  );

  const employeeSelect = modal.querySelector('[name="cg_employee_id"]');
  const rep = modal.querySelector('[name="cg_rep"]');
  const repTitle = modal.querySelector('[name="cg_rep_title"]');
  const companyAddress = modal.querySelector('[name="cg_company_address"]');
  const department = modal.querySelector('[name="cg_department"]');
  const position = modal.querySelector('[name="cg_position"]');
  const location = modal.querySelector('[name="cg_location"]');

  const refresh = () => {
    const e = state.employees.find(x => x.id === employeeSelect.value);
    if (!e) return;

    const company = cgCompanyName(e);
    const defaults = cgCompanyDefaults(company);

    department.value = cgDepartment(e);
    position.value = cgPosition(e);
    location.value = cgCurrentLocation(e);

    rep.value = defaults.representative;
    repTitle.value = defaults.representative_title;
    companyAddress.value = defaults.address;

    const join = modal.querySelector('[name="cg_join_date"]');
    if (!join.value && e.join_date) join.value = e.join_date;
  };

  employeeSelect.onchange = refresh;
  refresh();

  return modal;
}

function cgCollectFormData(form) {
  const fd = new FormData(form);
  const emp = state.employees.find(e => e.id === fd.get('cg_employee_id'));

  return {
    employee: emp,
    company: cgCompanyName(emp),
    type: fd.get('cg_type'),
    number: String(fd.get('cg_number') || '').trim(),
    joinDate: fd.get('cg_join_date') || emp?.join_date || '',
    startDate: fd.get('cg_start_date') || '',
    endDate: fd.get('cg_end_date') || '',
    signedDate: fd.get('cg_signed_date') || '',
    department: String(fd.get('cg_department') || cgDepartment(emp)).trim(),
    position: String(fd.get('cg_position') || cgPosition(emp)).trim(),
    supervisor: String(fd.get('cg_supervisor') || '').trim(),
    workDays: String(fd.get('cg_work_days') || '').trim(),
    location: String(fd.get('cg_location') || cgCurrentLocation(emp)).trim(),
    baseSalary: Number(fd.get('cg_base_salary')) || 0,
    positionAllowance: Number(fd.get('cg_position_allowance')) || 0,
    performance: Number(fd.get('cg_performance')) || 0,
    discipline: Number(fd.get('cg_discipline')) || 0,
    meal: Number(fd.get('cg_meal')) || 0,
    thr: Number(fd.get('cg_thr')) || 0,
    representative: String(fd.get('cg_rep') || '').trim(),
    representativeTitle: String(fd.get('cg_rep_title') || '').trim(),
    companyAddress: String(fd.get('cg_company_address') || '').trim(),
    notes: String(fd.get('cg_notes') || '').trim()
  };
}

function cgOfferingHtml(d) {
  return `
    <div class="cg-doc">
      <h1>SURAT PENAWARAN - OFFERING LETTER</h1>

      <p>Dear Mr/Mrs. <b>${cgEsc(d.employee?.full_name || '')}</b></p>
      <p>Address : ${cgEsc(d.employee?.address || '-')}<br>
      Phone : ${cgEsc(d.employee?.phone || '-')}</p>

      <p>Thank you for your interest to be part of our existing team at
      <b>${cgEsc(d.company)}</b>. We are pleased to offer you an employment
      with us. The terms are as follow:</p>

      <table>
        <tr><td>Posisi</td><td>${cgEsc(d.position)}</td></tr>
        <tr><td>Department</td><td>${cgEsc(d.department)}</td></tr>
        <tr><td>Melapor Kepada</td><td>${cgEsc(d.supervisor)}</td></tr>
        <tr><td>Tanggal bergabung</td><td>${cgDate(d.joinDate)}</td></tr>
        <tr><td>Status Karyawan</td><td>${d.type === 'offering_letter' ? 'Probation' : cgTypeLabel(d.type)}</td></tr>
        <tr><td>Lokasi Kerja</td><td>${cgEsc(d.location)}</td></tr>
        <tr><td>Hari dan Jam Kerja</td><td>${cgEsc(d.workDays)}</td></tr>
        <tr><td>Kompensasi</td><td>${cgMoney(d.baseSalary)}</td></tr>
        <tr><td>Insentif</td><td>${cgMoney(d.performance)}</td></tr>
        <tr><td>Festive Allowance (THR)</td><td>${cgMoney(d.thr)}</td></tr>
      </table>

      <p>Perusahaan memberikan THR kepada Karyawan sebanyak 1 (satu)
      bulan gaji kepada Karyawan yang telah mencapai 12 bulan masa kerja
      atau secara prorata jika Karyawan belum mencapai masa kerja 12 bulan
      pada Hari Raya dengan minimal 1 bulan bekerja.</p>

      <p>Should the above terms be acceptable to you, please sign a copy
      of this letter and return one copy to HRD.</p>

      <div class="sign">
        <div>${cgEsc(d.company)}<br>Menyetujui,</div>
        <div>${cgEsc(d.representative)}<br>${cgEsc(d.representativeTitle)}</div>
        <div>Karyawan<br><br>${cgEsc(d.employee?.full_name || '')}</div>
      </div>
    </div>`;
}

function cgPkwtHtml(d) {
  const companyAddress = d.companyAddress ||
    'Jl. Arco Raya No. 24, RT.004/001 Cipete Selatan, Cilandak, Jakarta Selatan';

  return `
    <div class="cg-doc">
      <h1>PERJANJIAN KERJA WAKTU TERTENTU (PKWT)</h1>
      <p class="center">No: ${cgEsc(d.number || '[NOMOR DOKUMEN]')}</p>

      <p>Pada hari ini tanggal <b>${cgDate(d.signedDate)}</b> telah disepakati
      Perjanjian Kerja Waktu Tertentu (PKWT) antara
      <b>${cgEsc(d.company)}</b>, di ${cgEsc(companyAddress)},
      dalam hal ini diwakili oleh:</p>

      <p>1. Nama : ${cgEsc(d.representative)}<br>
      Jabatan : ${cgEsc(d.representativeTitle)}<br>
      Bertindak untuk dan atas nama ${cgEsc(d.company)}, untuk selanjutnya
      disebut sebagai PIHAK PERTAMA (“Perusahaan”).</p>

      <p>2. Nama : ${cgEsc(d.employee?.full_name || '')}<br>
      ID Karyawan : ${cgEsc(d.employee?.employee_number || '-') }<br>
      Alamat : ${cgEsc(d.employee?.address || '-')}<br>
      Dalam hal ini bertindak untuk dan atas namanya sendiri dan selanjutnya
      disebut sebagai PIHAK KEDUA (“Karyawan”).</p>

      <p>PIHAK PERTAMA DAN PIHAK KEDUA sepakat untuk membuat Perjanjian
      Kerja Waktu Tertentu ini untuk jangka waktu sebagaimana tertera pada
      Pasal 2 (dua).</p>

      <h2>PASAL 1 — Jabatan, Jenis Pekerjaan dan Tanggung Jawab</h2>
      <p>PIHAK KEDUA sebagai <b>${cgEsc(d.position)}</b> pada department
      <b>${cgEsc(d.department)}</b>, dengan tugas dan tanggung jawab sesuai
      Job Description atau tugas-tugas yang ditentukan dan diperintahkan oleh
      atasan langsung. Dalam menjalankan tugasnya PIHAK KEDUA bertanggung
      jawab kepada atasan langsung.</p>

      <h2>PASAL 2 — Masa Kerja</h2>
      <p>Perjanjian Kerja Waktu Tertentu ini berlaku terhitung mulai
      <b>${cgDate(d.startDate)}</b> dan hubungan kerja antara PIHAK PERTAMA
      dengan PIHAK KEDUA akan berakhir pada tanggal
      <b>${cgDate(d.endDate)}</b>.</p>

      <h2>PASAL 3 — Tempat Pekerjaan</h2>
      <p>PIHAK KEDUA akan ditempatkan di <b>${cgEsc(d.location)}</b>.
      Namun demikian, PIHAK KEDUA bersedia melakukan perjalanan dinas bila
      diperlukan sesuai kebutuhan pekerjaan dan perintah PIHAK PERTAMA.</p>

      <h2>PASAL 4 — Penggajian</h2>
      <p>Pembayaran upah atau penggajian akan diberikan oleh PIHAK PERTAMA
      kepada PIHAK KEDUA dilaksanakan pada akhir bulan.</p>

      <p><b>Rincian remunerasi:</b></p>
      <table>
        <tr><td>Gaji Pokok</td><td>${cgMoney(d.baseSalary)}</td></tr>
        <tr><td>Tunjangan Jabatan</td><td>${cgMoney(d.positionAllowance)}</td></tr>
        <tr><td>Insentif Kinerja</td><td>${cgMoney(d.performance)}</td></tr>
        <tr><td>Tunjangan Kedisiplinan</td><td>${cgMoney(d.discipline)}</td></tr>
        <tr><td>Tunjangan Makan</td><td>${cgMoney(d.meal)}</td></tr>
        <tr><td>THR</td><td>${cgMoney(d.thr)}</td></tr>
      </table>

      <h2>PASAL 5 — Waktu Kerja</h2>
      <p>Jam kerja resmi ditentukan sebagai berikut:</p>
      <ol>
        <li>Senin s/d Jumat: 08.00 s/d 17.00.</li>
        <li>Sabtu: 08.00 s/d 15.00 waktu setempat.</li>
        <li>Istirahat makan siang satu jam, 12.00 s/d 13.00.</li>
        <li>Keterlambatan mengikuti ketentuan perusahaan yang berlaku.</li>
      </ol>

      <h2>PASAL 6 — Kewajiban PIHAK KEDUA</h2>
      <ol>
        <li>Melaksanakan tugas dan tanggung jawab dengan sebaik-baiknya,
        jujur, disiplin dan penuh tanggung jawab.</li>
        <li>Mentaati setiap peraturan yang dikeluarkan PIHAK PERTAMA
        dan/atau atasan.</li>
        <li>Merahasiakan keterangan yang diperoleh selama bekerja.</li>
        <li>Mengembalikan dokumen dan peralatan kerja pada akhir perjanjian.</li>
      </ol>

      <h2>PASAL 7 — Izin, Cuti & Tanpa Keterangan</h2>
      <p>Ketentuan izin, cuti, sakit dan ketidakhadiran mengikuti ketentuan
      perusahaan yang berlaku.</p>

      <h2>PASAL 8 — Tindakan Disiplin</h2>
      <p>PIHAK PERTAMA akan mengenakan sanksi disiplin terhadap PIHAK KEDUA
      yang melakukan pelanggaran terhadap tata tertib kerja dan peraturan
      PIHAK PERTAMA sesuai ketentuan yang berlaku.</p>

      <h2>PASAL 9 — Berakhirnya Hubungan Kerja & PHK</h2>
      <p>Hubungan kerja dapat berakhir karena berakhirnya masa perjanjian,
      pengunduran diri, atau keadaan lain sesuai ketentuan perjanjian dan
      peraturan yang berlaku.</p>

      <h2>PASAL 10 — Penyelesaian Perselisihan</h2>
      <p>Bila terjadi perselisihan, kedua belah pihak berusaha menyelesaikan
      melalui musyawarah dan bila tidak tercapai kesepakatan maka diselesaikan
      sesuai ketentuan peraturan perundangan yang berlaku.</p>

      <p>Perjanjian ini dibuat atas dasar persetujuan dan kesepakatan kedua
      belah pihak tanpa paksaan dan ditandatangani dengan sukarela.</p>

      <div class="sign">
        <div>PIHAK PERTAMA<br>${cgEsc(d.company)}<br><br>${cgEsc(d.representative)}</div>
        <div>PIHAK KEDUA<br><br><br>${cgEsc(d.employee?.full_name || '')}</div>
      </div>
    </div>`;
}

function cgPkwttHtml(d) {
  const companyAddress = d.companyAddress || '';

  return `
    <div class="cg-doc">
      <h1>PERJANJIAN KERJA WAKTU TIDAK TERTENTU</h1>
      <p class="center">No. ${cgEsc(d.number || '[NOMOR DOKUMEN]')}</p>

      <p>Pada hari ini, tanggal <b>${cgDate(d.signedDate)}</b>, di kantor
      <b>${cgEsc(d.company)}</b>, yang bertanda tangan di bawah ini:</p>

      <p><b>PIHAK PERTAMA</b><br>
      Nama : ${cgEsc(d.representative)}<br>
      Pekerjaan/Jabatan : ${cgEsc(d.representativeTitle)}<br>
      Alamat : ${cgEsc(companyAddress)}</p>

      <p><b>PIHAK KEDUA</b><br>
      Nama : ${cgEsc(d.employee?.full_name || '')}<br>
      ID Karyawan : ${cgEsc(d.employee?.employee_number || '-')}<br>
      Alamat : ${cgEsc(d.employee?.address || '-')}</p>

      <p>Kedua belah pihak sepakat untuk mengadakan perjanjian kerja waktu
      tidak tertentu dengan syarat-syarat dan ketentuan sebagai berikut:</p>

      <h2>PASAL 1 — KETENTUAN KHUSUS</h2>
      <ol>
        <li>Status: Karyawan PKWTT.</li>
        <li>Jabatan: ${cgEsc(d.position)}.</li>
        <li>Tgl Masuk: ${cgDate(d.joinDate)}.</li>
      </ol>

      <h2>PASAL 2 — KEPEGAWAIAN</h2>
      <p>Pihak Kedua bersedia ditempatkan sesuai kebutuhan organisasi Pihak
      Pertama. Waktu kerja disesuaikan dengan waktu kerja yang ditetapkan
      Pihak Pertama sesuai jabatan, jenis pekerjaan dan lokasi penempatan.</p>

      <h2>PASAL 3 — KEWAJIBAN DAN TANGGUNG-JAWAB KARYAWAN</h2>
      <ol>
        <li>Melaksanakan seluruh kewajiban berdasarkan tugas dan tanggung jawab
        jabatan serta mematuhi peraturan kerja perusahaan.</li>
        <li>Menjaga kerahasiaan perusahaan dan rahasia jabatan.</li>
        <li>Mematuhi ketentuan jam kerja yang berlaku.</li>
        <li>Memberitahukan pengunduran diri sesuai prosedur perusahaan.</li>
      </ol>

      <h2>PASAL 4 — KEWAJIBAN DAN TANGGUNG JAWAB PERUSAHAAN</h2>
      <ol>
        <li>Memberikan upah berdasarkan ketentuan yang disepakati.</li>
        <li>Memperhatikan kesejahteraan dan keselamatan kerja.</li>
        <li>Mengembangkan potensi karyawan sesuai kemampuan dan kondisi
        perusahaan.</li>
        <li>Melaksanakan peraturan ketenagakerjaan sesuai ketentuan yang berlaku.</li>
      </ol>

      <p><b>Rincian remunerasi:</b></p>
      <table>
        <tr><td>Gaji Pokok</td><td>${cgMoney(d.baseSalary)}</td></tr>
        <tr><td>Tunjangan Jabatan</td><td>${cgMoney(d.positionAllowance)}</td></tr>
        <tr><td>Insentif Kinerja</td><td>${cgMoney(d.performance)}</td></tr>
        <tr><td>Tunjangan Kedisiplinan</td><td>${cgMoney(d.discipline)}</td></tr>
        <tr><td>Tunjangan Makan</td><td>${cgMoney(d.meal)}</td></tr>
        <tr><td>THR</td><td>${cgMoney(d.thr)}</td></tr>
      </table>

      <h2>PASAL 5 — LAIN-LAIN</h2>
      <p>Bilamana terdapat hal-hal yang belum diatur atau tercantum dalam
      perjanjian ini, akan ditetapkan secara musyawarah mufakat oleh kedua
      belah pihak dan disesuaikan dengan peraturan perundang-undangan yang
      berlaku.</p>

      <p>Setelah kedua belah pihak membaca dengan seksama serta memahami isi
      ketentuan perjanjian kerja ini, perjanjian dibuat rangkap 2 (dua) dan
      masing-masing mempunyai kekuatan hukum yang sama.</p>

      <div class="sign">
        <div>PIHAK PERTAMA<br>${cgEsc(d.company)}<br><br>${cgEsc(d.representative)}</div>
        <div>PIHAK KEDUA<br><br><br>${cgEsc(d.employee?.full_name || '')}</div>
      </div>
    </div>`;
}

function cgAmendmentHtml(d) {
  return `
    <div class="cg-doc">
      <h1>AMANDemen PERJANJIAN KERJA WAKTU TERTENTU</h1>
      <p class="center">No. ${cgEsc(d.number || '[NOMOR DOKUMEN]')}</p>

      <p>Amandemen ini merupakan perubahan atas Perjanjian Kerja Waktu Tertentu
      antara <b>${cgEsc(d.company)}</b> sebagai PIHAK PERTAMA dan
      <b>${cgEsc(d.employee?.full_name || '')}</b> sebagai PIHAK KEDUA.</p>

      <h2>PERUBAHAN</h2>
      <table>
        <tr><td>Karyawan</td><td>${cgEsc(d.employee?.full_name || '')}</td></tr>
        <tr><td>Jabatan</td><td>${cgEsc(d.position)}</td></tr>
        <tr><td>Departemen</td><td>${cgEsc(d.department)}</td></tr>
        <tr><td>Periode Baru</td><td>${cgDate(d.startDate)} s/d ${cgDate(d.endDate)}</td></tr>
        <tr><td>Lokasi Kerja</td><td>${cgEsc(d.location)}</td></tr>
      </table>

      <p>Ketentuan lain dalam perjanjian sebelumnya yang tidak diubah melalui
      amandemen ini tetap berlaku sesuai dokumen sumber yang disepakati para
      pihak.</p>

      <div class="sign">
        <div>PIHAK PERTAMA<br>${cgEsc(d.company)}<br><br>${cgEsc(d.representative)}</div>
        <div>PIHAK KEDUA<br><br><br>${cgEsc(d.employee?.full_name || '')}</div>
      </div>
    </div>`;
}

function cgBuildHtml(d) {
  if (d.type === 'pkwt') return cgPkwtHtml(d);
  if (d.type === 'pkwtt') return cgPkwttHtml(d);
  if (d.type === 'amendment') return cgAmendmentHtml(d);
  return cgOfferingHtml(d);
}

function cgPrintCss() {
  return `
    <style>
      @page { size: A4; margin: 22mm 20mm 20mm 25mm; }
      body { font-family: Arial, sans-serif; font-size: 11pt; line-height: 1.45; color:#111; }
      .cg-doc { max-width: 180mm; margin:auto; }
      h1 { text-align:center; font-size:16pt; margin:0 0 18px; }
      h2 { font-size:12pt; margin:18px 0 8px; }
      p { margin:0 0 9px; text-align:justify; }
      .center { text-align:center; }
      table { width:100%; border-collapse:collapse; margin:12px 0; }
      td { border:1px solid #777; padding:6px 8px; vertical-align:top; }
      td:first-child { width:32%; font-weight:600; }
      li { margin-bottom:5px; }
      .sign { display:grid; grid-template-columns:1fr 1fr; gap:30px; margin-top:55px; text-align:center; }
      @media print { .no-print { display:none!important; } }
    </style>`;
}

function cgOpenGenerator() {
  const body = `
    <div class="info-box">
      Pilih karyawan dan dokumen yang ingin dibuat. Setelah preview,
      tersedia tombol <b>Export Word</b> dan <b>Export PDF</b>.
    </div>

    <div class="modal-grid">
      <div class="field field-full">
        <label>Karyawan *</label>
        <select name="cg_employee_id" required>
          <option value="">Pilih karyawan</option>
          ${cgEmployeeOptions('')}
        </select>
      </div>

      <div class="field">
        <label>Jenis Dokumen *</label>
        <select name="cg_type" required>
          <option value="offering_letter">Offering Letter</option>
          <option value="pkwt">PKWT</option>
          <option value="pkwtt">PKWTT</option>
          <option value="amendment">Amandemen PKWT</option>
        </select>
      </div>

      ${cgField('cg_number', 'No. Dokumen / Kontrak')}
      ${cgDateField('cg_join_date', 'Tanggal Bergabung')}
      ${cgDateField('cg_start_date', 'Tanggal Mulai', '', true)}
      ${cgDateField('cg_end_date', 'Tanggal Berakhir')}
      ${cgDateField('cg_signed_date', 'Tanggal Tanda Tangan')}

      ${cgField('cg_department', 'Departemen')}
      ${cgField('cg_position', 'Jabatan')}
      ${cgField('cg_supervisor', 'Melapor Kepada', 'PIC (Person In Charge) - SPV/Asst.')}
      ${cgField('cg_work_days', 'Hari & Jam Kerja', '6 (Enam) Hari kerja, 1 (Satu) Hari Libur')}
      <div class="field field-full">
        <label>Lokasi Kerja</label>
        <input name="cg_location">
      </div>

      <div class="field field-full"><div class="sub-title">Remunerasi</div></div>
      ${cgNumField('cg_base_salary', 'Gaji Pokok')}
      ${cgNumField('cg_position_allowance', 'Tunjangan Jabatan')}
      ${cgNumField('cg_performance', 'Insentif Kinerja')}
      ${cgNumField('cg_discipline', 'Tunjangan Kedisiplinan')}
      ${cgNumField('cg_meal', 'Tunjangan Makan')}
      ${cgNumField('cg_thr', 'THR')}

      <div class="field field-full"><div class="sub-title">Pihak Pertama</div></div>
      ${cgField('cg_rep', 'Nama Perwakilan')}
      ${cgField('cg_rep_title', 'Jabatan Perwakilan')}
      <div class="field field-full">
        <label>Alamat Perusahaan</label>
        <textarea name="cg_company_address" rows="2"></textarea>
      </div>
    </div>
  `;

  const modal = openModal(
    'Buat & Export Kontrak',
    body,
    async form => {
      const d = cgCollectFormData(form);

      if (!d.employee || !d.type || !d.startDate) {
        toast('Lengkapi Karyawan, Jenis Dokumen, dan Tanggal Mulai.', 'error');
        return false;
      }

      const preview = `
        <div class="section">
          <div class="section-head">
            <h2>Preview Dokumen</h2>
            <div class="row-actions">
              <button type="button" class="btn btn-light" onclick="cgExportWord()">📄 Export Word</button>
              <button type="button" class="btn btn-primary" onclick="cgExportPdf()">📕 Export PDF</button>
            </div>
          </div>
          <div id="cgPreview">${cgBuildHtml(d)}</div>
        </div>`;

      modal.querySelector('.modal').innerHTML = `
        <div class="section-head">
          <h2>Preview ${cgEsc(cgTypeLabel(d.type))}</h2>
          <button type="button" class="btn btn-light" data-close>Tutup</button>
        </div>
        ${preview}`;

      modal.querySelectorAll('[data-close]').forEach(b => b.onclick = () => modal.remove());
      window._cgExportData = d;
      return false;
    },
    'Preview'
  );

  const refresh = () => {
    const e = state.employees.find(x =>
      x.id === modal.querySelector('[name="cg_employee_id"]').value
    );
    if (!e) return;

    const company = cgCompanyName(e);
    const defaults = cgCompanyDefaults(company);

    modal.querySelector('[name="cg_department"]').value = cgDepartment(e);
    modal.querySelector('[name="cg_position"]').value = cgPosition(e);
    modal.querySelector('[name="cg_location"]').value = cgCurrentLocation(e);
    modal.querySelector('[name="cg_rep"]').value = defaults.representative;
    modal.querySelector('[name="cg_rep_title"]').value = defaults.representative_title;
    modal.querySelector('[name="cg_company_address"]').value = defaults.address;

    if (e.join_date)
      modal.querySelector('[name="cg_join_date"]').value = e.join_date;
  };

  modal.querySelector('[name="cg_employee_id"]').onchange = refresh;
  refresh();
  return modal;
}

async function cgExportWord() {
  const d = window._cgExportData;
  if (!d) {
    toast('Preview dokumen belum tersedia.', 'error');
    return;
  }

  try {
    toast('Menyiapkan file Word...');

    const converter = await cgLoadDocxConverter();

    const html = `
      <!doctype html>
      <html>
      <head>
        <meta charset="utf-8">
        ${cgPrintCss()}
      </head>
      <body>${cgBuildHtml(d)}</body>
      </html>`;

    const blob = await converter.toDocx(html);

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');

    a.href = url;
    a.download =
      `${d.type}_${(d.employee?.full_name || 'karyawan').replace(/[^a-z0-9]+/gi,'_')}.docx`;

    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => URL.revokeObjectURL(url), 1000);

    toast('File Word berhasil dibuat.');
  } catch (err) {
    console.error(err);
    toast('Export Word gagal: ' + (err?.message || 'error tidak diketahui'), 'error');
  }
}

function cgExportPdf() {
  const d = window._cgExportData;
  if (!d) {
    toast('Preview dokumen belum tersedia.', 'error');
    return;
  }

  const w = window.open('', '_blank');

  if (!w) {
    toast('Browser memblokir jendela PDF. Izinkan pop-up untuk website ini.', 'error');
    return;
  }

  w.document.open();
  w.document.write(`
    <!doctype html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>${cgEsc(cgTypeLabel(d.type))} - ${cgEsc(d.employee?.full_name || '')}</title>
      ${cgPrintCss()}
    </head>
    <body>${cgBuildHtml(d)}</body>
    </html>`);
  w.document.close();

  w.onload = () => {
    w.focus();
    w.print();
  };
}


/* ---------- Override halaman Kontrak ---------- */
/* Fungsi ini sengaja diletakkan di akhir app.js agar menggantikan
   tampilan contracts() lama tanpa mengganggu modul lain. */

function contracts() {
  const rows = state.contracts || [];
  const today = todayJakarta();

  const expSoon = c => {
    const n = daysUntil(c.end_date);
    return c.status === 'active' && n !== null && n >= 0 && n <= 30;
  };

  $('#content').innerHTML = `
    <div class="section">

      <div class="section-head">
        <div>
          <h2>Daftar Kontrak</h2>
          <div class="muted">${rows.length} dokumen kontrak tersimpan</div>
        </div>

        <div class="row-actions">
          <button class="btn btn-light" onclick="importContractDocument()">
            📄 Import Dokumen
          </button>

          <button class="btn btn-primary" onclick="cgOpenGenerator()">
            📝 Buat Kontrak
          </button>

          <button class="btn btn-light" onclick="contractForm()">
            + Tambah Kontrak
          </button>
        </div>
      </div>

      <div class="cards" style="margin-bottom:14px">
        <div class="card">
          <div class="muted">Aktif</div>
          <div class="metric">${rows.filter(c => c.status === 'active').length}</div>
        </div>

        <div class="card">
          <div class="muted">Berakhir ≤ 30 Hari</div>
          <div class="metric">${rows.filter(expSoon).length}</div>
        </div>

        <div class="card">
          <div class="muted">Sudah Berakhir</div>
          <div class="metric">${rows.filter(c => c.end_date && c.end_date < today).length}</div>
        </div>

        <div class="card">
          <div class="muted">Draft</div>
          <div class="metric">${rows.filter(c => c.status === 'draft').length}</div>
        </div>
      </div>

      ${rows.length ? `
        <div class="table-wrap">
          <table class="table">
            <thead>
              <tr>
                <th>Karyawan</th>
                <th>No. Dokumen</th>
                <th>Jenis</th>
                <th>Mulai</th>
                <th>Berakhir</th>
                <th>Status</th>
                <th>Aksi</th>
              </tr>
            </thead>

            <tbody>
              ${rows.map(c => {
                const e = state.employees.find(x => x.id === c.employee_id);
                const n = daysUntil(c.end_date);

                return `
                  <tr>
                    <td>
                      <b>${esc(e?.full_name || '-')}</b>
                      <div class="muted">${esc(e?.employee_number || '')}</div>
                    </td>

                    <td>${esc(c.contract_number || '-')}</td>

                    <td>${esc(cgTypeLabel(c.contract_type))}</td>

                    <td>${fmtDate(c.start_date)}</td>

                    <td>
                      ${fmtDate(c.end_date)}
                      ${n !== null
                        ? `<span class="badge ${n < 0 ? 'badge-red' : n <= 30 ? 'badge-yellow' : 'badge-green'}">
                            ${n < 0 ? 'Lewat' : n + ' hari'}
                           </span>`
                        : ''}
                    </td>

                    <td>${contractStatusBadge(c.status)}</td>

                    <td>
                      <div class="row-actions">
                        <button class="btn btn-light btn-sm"
                          onclick="contractForm('${esc(c.id)}')">
                          Edit
                        </button>

                        ${c.document_path
                          ? `<button class="btn btn-light btn-sm"
                              onclick="contractOpenDocument('${esc(c.document_path)}')">
                              Dokumen
                            </button>`
                          : ''}
                      </div>
                    </td>
                  </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>
      ` : `
        <div class="card empty">
          Belum ada kontrak.
        </div>
      `}
    </div>`;
}
/* =====================================================================
   PHASE 6 — CUTI & IZIN + APPROVAL SPV / HR
   Tempel di PALING BAWAH app.js Phase 5.
   ===================================================================== */

const PHASE6_LEAVE = {
  annualCode: 'ANNUAL',
  year: new Date().getFullYear()
};

function p6IsHR() {
  const r = String(state.profile?.role || '').toLowerCase();
  return ['admin','super_admin','hr','hr_admin'].includes(r);
}

function p6Employee(id) { return state.employees.find(e => e.id === id) || null; }
function p6LeaveType(id) { return (state.leaveTypes || []).find(x => x.id === id) || null; }
function p6Days(a,b) {
  if (!a || !b) return 0;
  const x = new Date(a + 'T00:00:00'), y = new Date(b + 'T00:00:00');
  return Math.max(0, Math.floor((y-x)/86400000)+1);
}
function p6StatusBadge(status) {
  const map = {
    pending:['badge-yellow','Menunggu'], supervisor_approved:['badge-blue','Disetujui SPV'],
    approved:['badge-green','Disetujui'], rejected:['badge-red','Ditolak'], cancelled:['badge-red','Dibatalkan']
  };
  const [cl,label] = map[status] || ['badge-yellow', status || 'Menunggu'];
  return `<span class="badge ${cl}">${esc(label)}</span>`;
}
function p6ApprovalLabel(l) {
  if (l.status === 'rejected') return 'Ditolak';
  if (l.status === 'approved') return 'Disetujui';
  if (l.supervisor_status === 'approved' && l.hr_status !== 'approved') return 'Menunggu HR';
  return 'Menunggu SPV';
}
function p6BalanceFor(empId, typeId, year) {
  const type = p6LeaveType(typeId);
  const rows = state.leave.filter(l => l.employee_id === empId && l.leave_type_id === typeId && String(l.start_date || '').slice(0,4) === String(year));
  const approved = rows.filter(l => l.status === 'approved').reduce((s,l)=>s+Number(l.total_days||p6Days(l.start_date,l.end_date)||0),0);
  const pending = rows.filter(l => ['pending','supervisor_approved'].includes(l.status)).reduce((s,l)=>s+Number(l.total_days||p6Days(l.start_date,l.end_date)||0),0);
  let entitlement = 0;
  if (type?.code === PHASE6_LEAVE.annualCode) {
    const e = p6Employee(empId);
    const d = e?.join_date;
    if (d) {
      const y = Number(year);
      const jd = new Date(d+'T00:00:00');
      const ref = new Date(`${y}-12-31T00:00:00`);
      let years = ref.getFullYear()-jd.getFullYear();
      if (ref < new Date(`${ref.getFullYear()}-${jd.getMonth()+1}-${jd.getDate()}T00:00:00`)) years--;
      if (years >= 1 && years <= 2) entitlement=7;
      else if (years >= 3 && years <= 4) entitlement=9;
      else if (years >= 5 && years <= 6) entitlement=10;
      else if (years >= 7) entitlement=12;
    }
  } else if (type?.quota_mode === 'fixed') entitlement = Number(type.default_quota_days||0);
  return { entitlement, approved, pending, available: Math.max(0, entitlement-approved), afterPending: Math.max(0, entitlement-approved-pending) };
}

async function p6RefreshLeaveData() {
  const qs = await Promise.all([
    sb.from('leave_types').select('*').eq('is_active',true).order('name'),
    sb.from('leave_requests').select('*, employees(full_name,employee_number,company_id,join_date,supervisor_employee_id)').order('start_date',{ascending:false}),
    sb.from('leave_approvals').select('*').order('decided_at',{ascending:false}),
    sb.from('employees').select('id,full_name,employee_number,company_id,join_date,supervisor_employee_id').order('full_name')
  ]);
  if (qs[0].error) toast(friendlyError(qs[0].error),'error');
  state.leaveTypes = qs[0].data || [];
  state.leave = qs[1].data || [];
  state.leaveApprovals = qs[2].data || [];
  if (qs[3].data?.length) {
    const by = new Map(qs[3].data.map(x=>[x.id,x]));
    state.employees = state.employees.map(e => by.has(e.id) ? {...e,...by.get(e.id)} : e);
  }
}

/* Extend existing loadAll without touching Phase 5 modules. */
const phase6BaseLoadAll = loadAll;
loadAll = async function() {
  await phase6BaseLoadAll();
  await p6RefreshLeaveData();
};

async function p6EnsureAnnual(empId, year) {
  const r = await sb.rpc('ensure_annual_leave_balance',{p_employee:empId,p_year:Number(year)});
  if (r.error) throw r.error;
  return r.data;
}

function p6AttachmentPath(empId,file) {
  const safe = String(file.name||'lampiran').replace(/[^a-zA-Z0-9._-]+/g,'_');
  return `leave/${empId}/${new Date().getFullYear()}/${Date.now()}-${safe}`;
}

async function p6SubmitRequest(form) {
  const fd = new FormData(form);
  const employee_id = String(fd.get('employee_id')||'');
  const leave_type_id = String(fd.get('leave_type_id')||'');
  const start_date = String(fd.get('start_date')||'');
  const end_date = String(fd.get('end_date')||start_date);
  const reason = String(fd.get('reason')||'').trim();
  const type = p6LeaveType(leave_type_id);
  if (!employee_id || !leave_type_id || !start_date || !end_date || !reason) { toast('Lengkapi karyawan, jenis, tanggal dan alasan.','error'); return false; }
  if (end_date < start_date) { toast('Tanggal berakhir tidak boleh lebih kecil dari tanggal mulai.','error'); return false; }
  const total_days = p6Days(start_date,end_date);
  if (type?.code === PHASE6_LEAVE.annualCode) {
    const bal = p6BalanceFor(employee_id,leave_type_id,Number(start_date.slice(0,4)));
    if (total_days > bal.available) { toast(`Sisa Cuti Tahunan tidak cukup. Tersedia ${bal.available} hari.`,'error'); return false; }
  }
  const file = fd.get('attachment');
  let attachment_path = null;
  if (file && file.size) {
    if (file.size > 10*1024*1024) { toast('Lampiran maksimal 10 MB.','error'); return false; }
    attachment_path = p6AttachmentPath(employee_id,file);
    const up = await sb.storage.from('leave-documents').upload(attachment_path,file,{upsert:false,contentType:file.type||'application/octet-stream'});
    if (up.error) { toast('Gagal upload lampiran: '+up.error.message,'error'); return false; }
  }
  const payload = {
    employee_id, leave_type_id, start_date, end_date, total_days,
    reason, employee_note: reason, attachment_path,
    status:'pending', supervisor_status:'pending', hr_status:'pending', submitted_at:new Date().toISOString()
  };
  const r = await sb.from('leave_requests').insert(payload).select().single();
  if (r.error) { toast(friendlyError(r.error),'error'); return false; }
  toast('Pengajuan cuti/izin berhasil dikirim.');
  await p6RefreshLeaveData();
  leave();
  return true;
}

window.p6NewLeave = function(employeeId='') {
  const activeTypes = (state.leaveTypes||[]).filter(x=>x.is_active);
  const empList = state.employees.filter(e=>e.employment_status==='active');
  const body = `<div class="form-grid">
    <div class="field field-full"><label>Karyawan *</label><select name="employee_id" required>${empList.map(e=>`<option value="${esc(e.id)}" ${e.id===employeeId?'selected':''}>${esc(e.full_name)} — ${esc(e.employee_number||'-')}</option>`).join('')}</select></div>
    <div class="field"><label>Jenis *</label><select name="leave_type_id" id="p6Type" required>${activeTypes.map(t=>`<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}</select></div>
    <div class="field"><label>Jumlah otomatis</label><input id="p6Days" value="0 hari" readonly></div>
    <div class="field"><label>Tanggal Mulai *</label><input name="start_date" type="date" required></div>
    <div class="field"><label>Tanggal Berakhir *</label><input name="end_date" type="date" required></div>
    <div class="field field-full"><label>Alasan *</label><textarea name="reason" rows="4" required placeholder="Tuliskan alasan pengajuan..."></textarea></div>
    <div class="field field-full"><label>Lampiran</label><input name="attachment" type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"><div class="muted">Wajib untuk jenis yang memerlukan bukti.</div></div>
  </div>`;
  const modal = openModal('Ajukan Cuti / Izin',body,async form=>{
    const fd=new FormData(form), type=p6LeaveType(fd.get('leave_type_id')), file=fd.get('attachment');
    if (type?.requires_attachment && (!file || !file.size)) { toast('Lampiran wajib untuk jenis pengajuan ini.','error'); return false; }
    return await p6SubmitRequest(form);
  },'Kirim Pengajuan');
  const calc=()=>{ const f=new FormData(modal); const n=p6Days(f.get('start_date'),f.get('end_date')||f.get('start_date')); const el=modal.querySelector('#p6Days'); if(el) el.value=n+' hari'; };
  modal.querySelectorAll('[name="start_date"],[name="end_date"]').forEach(x=>x.addEventListener('change',calc));
};

window.p6CancelLeave = async function(id) {
  const r=state.leave.find(x=>x.id===id); if(!r) return;
  if(!confirm('Batalkan pengajuan ini?')) return;
  const q=await sb.from('leave_requests').update({status:'cancelled',supervisor_status:'cancelled',hr_status:'cancelled'}).eq('id',id);
  if(q.error) toast(friendlyError(q.error),'error'); else { toast('Pengajuan dibatalkan.'); await p6RefreshLeaveData(); leave(); }
};

window.p6Approve = async function(id,level,decision) {
  const r=state.leave.find(x=>x.id===id); if(!r) return;
  if(level==='supervisor' && decision==='approved') {
    const q=await sb.from('leave_requests').update({supervisor_status:'approved',status:'supervisor_approved',supervisor_approved_at:new Date().toISOString(),supervisor_approved_by:state.profile.id}).eq('id',id);
    if(q.error){toast(friendlyError(q.error),'error');return;}
    await sb.from('leave_approvals').insert({leave_request_id:id,approver_profile_id:state.profile.id,approval_level:'supervisor',decision:'approved'});
  } else if(level==='supervisor' && decision==='rejected') {
    const note=prompt('Catatan penolakan SPV (opsional):')||null;
    const q=await sb.from('leave_requests').update({supervisor_status:'rejected',status:'rejected',supervisor_note:note}).eq('id',id);
    if(q.error){toast(friendlyError(q.error),'error');return;}
    await sb.from('leave_approvals').insert({leave_request_id:id,approver_profile_id:state.profile.id,approval_level:'supervisor',decision:'rejected',note});
  } else if(level==='hr' && decision==='approved') {
    const q=await sb.from('leave_requests').update({hr_status:'approved',status:'approved',hr_approved_at:new Date().toISOString(),hr_approved_by:state.profile.id}).eq('id',id);
    if(q.error){toast(friendlyError(q.error),'error');return;}
    await sb.from('leave_approvals').insert({leave_request_id:id,approver_profile_id:state.profile.id,approval_level:'hr',decision:'approved'});
  } else if(level==='hr' && decision==='rejected') {
    const note=prompt('Catatan penolakan HR (opsional):')||null;
    const q=await sb.from('leave_requests').update({hr_status:'rejected',status:'rejected',hr_note:note}).eq('id',id);
    if(q.error){toast(friendlyError(q.error),'error');return;}
    await sb.from('leave_approvals').insert({leave_request_id:id,approver_profile_id:state.profile.id,approval_level:'hr',decision:'rejected',note});
  }
  toast(decision==='approved'?'Pengajuan disetujui.':'Pengajuan ditolak.');
  await p6RefreshLeaveData(); leave();
};

window.p6SaveSupervisor = async function(empId,supervisorId) {
  const q=await sb.from('employees').update({supervisor_employee_id:supervisorId||null}).eq('id',empId);
  if(q.error){toast(friendlyError(q.error),'error');return;}
  const e=p6Employee(empId); if(e) e.supervisor_employee_id=supervisorId||null;
  toast('Atasan langsung tersimpan.'); leave();
};

window.p6OpenDetail = function(id) {
  const r=state.leave.find(x=>x.id===id); if(!r) return;
  const t=p6LeaveType(r.leave_type_id), e=p6Employee(r.employee_id), sup=e?.supervisor_employee_id?p6Employee(e.supervisor_employee_id):null;
  const aps=(state.leaveApprovals||[]).filter(a=>a.leave_request_id===id);
  const body=`<div class="detail-grid">
    <div class="detail-item"><div class="muted">Karyawan</div><div><b>${esc(e?.full_name||r.employees?.full_name||'-')}</b></div></div>
    <div class="detail-item"><div class="muted">Jenis</div><div>${esc(t?.name||'-')}</div></div>
    <div class="detail-item"><div class="muted">Periode</div><div>${esc(fmtDate(r.start_date))} — ${esc(fmtDate(r.end_date))}</div></div>
    <div class="detail-item"><div class="muted">Jumlah</div><div>${esc(r.total_days||p6Days(r.start_date,r.end_date))} hari</div></div>
    <div class="detail-item"><div class="muted">SPV</div><div>${esc(sup?.full_name||'Belum diatur')}</div></div>
    <div class="detail-item"><div class="muted">Status</div><div>${p6StatusBadge(r.status)}</div></div>
  </div><div class="section" style="margin-top:18px"><h3 class="sub-title">Alasan</h3><div class="info-box">${esc(r.reason||r.employee_note||'-')}</div></div>
  <div class="section"><h3 class="sub-title">Riwayat Approval</h3>${aps.length?`<div class="table-wrap"><table class="table"><thead><tr><th>Level</th><th>Keputusan</th><th>Catatan</th><th>Waktu</th></tr></thead><tbody>${aps.map(a=>`<tr><td>${esc(a.approval_level)}</td><td>${esc(a.decision)}</td><td>${esc(a.note||'-')}</td><td>${esc(new Date(a.decided_at).toLocaleString('id-ID'))}</td></tr>`).join('')}</tbody></table></div>`:'<div class="muted">Belum ada riwayat approval.</div>'}</div>`;
  openModal('Detail Pengajuan',body,null,'Tutup');
};

function p6SupervisorSection() {
  if (!p6IsHR()) return '';
  const emps=state.employees.filter(e=>e.employment_status==='active');
  return `<div class="section"><div class="section-head"><h2>Atasan Langsung</h2><span class="muted">Digunakan untuk menentukan siapa yang menerima approval SPV.</span></div>
    <div class="table-wrap"><table class="table"><thead><tr><th>Karyawan</th><th>Perusahaan</th><th>Atasan Langsung</th><th>Aksi</th></tr></thead><tbody>${emps.map(e=>`<tr><td><b>${esc(e.full_name)}</b><div class="muted">${esc(e.employee_number||'-')}</div></td><td>${esc(e.companies?.name||'-')}</td><td><select id="p6sup_${esc(e.id)}"><option value="">— Belum diatur —</option>${emps.filter(s=>s.id!==e.id).map(s=>`<option value="${esc(s.id)}" ${e.supervisor_employee_id===s.id?'selected':''}>${esc(s.full_name)}</option>`).join('')}</select></td><td><button class="btn btn-light btn-sm" onclick="p6SaveSupervisor('${esc(e.id)}',document.getElementById('p6sup_${esc(e.id)}').value)">Simpan</button></td></tr>`).join('')}</tbody></table></div></div>`;
}

function leave() {
  const rows=state.leave||[];
  const types=state.leaveTypes||[];
  const isHR=p6IsHR();
  const myId=state.profile?.employee_id;
  const myPending=rows.filter(r=>r.employee_id===myId && ['pending','supervisor_approved'].includes(r.status)).length;
  const supQueue=isHR?rows.filter(r=>r.status==='pending' && p6Employee(r.employee_id)?.supervisor_employee_id===myId).length:rows.filter(r=>r.status==='pending' && p6Employee(r.employee_id)?.supervisor_employee_id===myId).length;
  const hrQueue=isHR?rows.filter(r=>['pending','supervisor_approved'].includes(r.status)).length:0;
  const activeEmps=state.employees.filter(e=>e.employment_status==='active');
  const balanceRows=activeEmps.map(e=>{const t=types.find(x=>x.code==='ANNUAL'); return t?{e,b:p6BalanceFor(e.id,t.id,new Date().getFullYear())}:null}).filter(Boolean);
  const canApply=isHR||!!myId;
  $('#content').innerHTML=`<div class="section">
    <div class="section-head"><div><h2>Cuti & Izin</h2><div class="muted">Pengajuan → Approval SPV → Approval HR</div></div><div class="row-actions">${canApply?`<button class="btn btn-primary" onclick="p6NewLeave('${esc(myId||'')}')">+ Ajukan Cuti / Izin</button>`:''}</div></div>
    <div class="cards"><div class="card"><div class="muted">Pengajuan</div><div class="metric">${rows.length}</div></div><div class="card"><div class="muted">Menunggu SPV</div><div class="metric">${supQueue}</div></div><div class="card"><div class="muted">Menunggu HR</div><div class="metric">${hrQueue}</div></div><div class="card"><div class="muted">Pengajuan Saya</div><div class="metric">${myPending}</div></div></div>
  </div>
  <div class="section"><div class="section-head"><h2>Saldo Cuti Tahunan</h2><span class="muted">Tahun ${new Date().getFullYear()}</span></div>
    ${balanceRows.length?`<div class="table-wrap"><table class="table"><thead><tr><th>Karyawan</th><th>Hak</th><th>Terpakai</th><th>Menunggu</th><th>Sisa</th><th>Sisa setelah pengajuan</th></tr></thead><tbody>${balanceRows.map(x=>`<tr><td><b>${esc(x.e.full_name)}</b><div class="muted">${esc(x.e.employee_number||'-')}</div></td><td>${x.b.entitlement}</td><td>${x.b.approved}</td><td>${x.b.pending}</td><td><b>${x.b.available}</b></td><td>${x.b.afterPending}</td></tr>`).join('')}</tbody></table></div>`:'<div class="card empty">Belum ada karyawan aktif.</div>'}
  </div>
  ${p6SupervisorSection()}
  <div class="section"><div class="section-head"><h2>Pengajuan Cuti / Izin</h2></div>${rows.length?`<div class="table-wrap"><table class="table"><thead><tr><th>Karyawan</th><th>Jenis</th><th>Periode</th><th>Hari</th><th>Status</th><th>Aksi</th></tr></thead><tbody>${rows.map(r=>{const e=p6Employee(r.employee_id),t=p6LeaveType(r.leave_type_id); const mine=r.employee_id===myId; const sup=e?.supervisor_employee_id===myId; const canSup=sup&&r.status==='pending'; const canHr=isHR&&['pending','supervisor_approved'].includes(r.status); return `<tr><td><b>${esc(e?.full_name||r.employees?.full_name||'-')}</b><div class="muted">${esc(e?.employee_number||'')}</div></td><td>${esc(t?.name||'-')}</td><td>${fmtDate(r.start_date)} — ${fmtDate(r.end_date)}</td><td>${esc(r.total_days||p6Days(r.start_date,r.end_date))}</td><td>${p6StatusBadge(r.status)}</td><td><div class="row-actions"><button class="btn btn-light btn-sm" onclick="p6OpenDetail('${esc(r.id)}')">Detail</button>${canSup?`<button class="btn btn-primary btn-sm" onclick="p6Approve('${esc(r.id)}','supervisor','approved')">Setujui SPV</button><button class="btn btn-light btn-sm" onclick="p6Approve('${esc(r.id)}','supervisor','rejected')">Tolak</button>`:''}${canHr?`<button class="btn btn-primary btn-sm" onclick="p6Approve('${esc(r.id)}','hr','approved')">Approve HR</button><button class="btn btn-light btn-sm" onclick="p6Approve('${esc(r.id)}','hr','rejected')">Tolak HR</button>`:''}${mine&&['pending','supervisor_approved'].includes(r.status)?`<button class="btn btn-light btn-sm" onclick="p6CancelLeave('${esc(r.id)}')">Batalkan</button>`:''}</div></td></tr>`;}).join('')}</tbody></table></div>`:'<div class="card empty">Belum ada pengajuan cuti/izin.</div>'}</div>`;
}

console.log('HR Employee System Phase 6 loaded: Cuti & Izin + Approval SPV/HR');


/* =========================================================
   PHASE 6B — SUPERVISOR FIELD IN EDIT EMPLOYEE
   Tempelkan di PALING BAWAH app.js
   ========================================================= */

window.employeeEditForm = function(id) {
  const e = state.employees.find(x => x.id === id);
  if (!e) {
    toast('Data karyawan tidak ditemukan.', 'error');
    return;
  }

  const activeEmployees = state.employees
    .filter(x => x.id !== id && x.employment_status !== 'inactive')
    .sort((a,b) => String(a.full_name || '').localeCompare(String(b.full_name || '')));

  const companyOptions = (state.companies || [])
    .filter(c => isActive(c) || c.id === e.company_id)
    .map(c => `<option value="${esc(c.id)}" ${c.id === e.company_id ? 'selected' : ''}>${esc(c.name)}</option>`)
    .join('');

  const supervisorOptions = activeEmployees
    .map(x => `<option value="${esc(x.id)}" ${x.id === e.supervisor_employee_id ? 'selected' : ''}>
      ${esc(x.full_name || '-')} — ${esc(x.employee_number || '-')}
    </option>`)
    .join('');

  const body = `
    <div class="modal-grid">

      <div class="field">
        <label>ID Karyawan *</label>
        <input name="employee_number" required value="${esc(e.employee_number || '')}">
      </div>

      <div class="field">
        <label>Nama Lengkap *</label>
        <input name="full_name" required value="${esc(e.full_name || '')}">
      </div>

      <div class="field">
        <label>NIK</label>
        <input name="nik" inputmode="numeric" value="${esc(e.nik || '')}">
      </div>

      <div class="field">
        <label>Email</label>
        <input name="email" type="email" value="${esc(e.email || '')}">
      </div>

      <div class="field">
        <label>No. HP</label>
        <input name="phone" type="tel" value="${esc(e.phone || '')}">
      </div>

      <div class="field">
        <label>Tanggal Masuk *</label>
        <input name="join_date" type="date" required value="${esc(e.join_date || '')}">
      </div>

      <div class="field">
        <label>Perusahaan *</label>
        <select name="company_id" required>
          <option value="">Pilih perusahaan</option>
          ${companyOptions}
        </select>
      </div>

      <div class="field">
        <label>Departemen</label>
        <select name="department_id"></select>
      </div>

      <div class="field">
        <label>Jabatan</label>
        <select name="position_id"></select>
      </div>

      <div class="field">
        <label>Status</label>
        <select name="employment_status">
          <option value="active" ${e.employment_status === 'active' ? 'selected' : ''}>Aktif</option>
          <option value="inactive" ${e.employment_status === 'inactive' ? 'selected' : ''}>Tidak Aktif</option>
        </select>
      </div>

      <div class="field">
        <label>Tipe</label>
        <select name="employment_type">
          <option value="permanent" ${e.employment_type === 'permanent' ? 'selected' : ''}>Tetap</option>
          <option value="contract" ${e.employment_type === 'contract' ? 'selected' : ''}>Kontrak</option>
          <option value="intern" ${e.employment_type === 'intern' ? 'selected' : ''}>Intern</option>
          <option value="part_time" ${e.employment_type === 'part_time' ? 'selected' : ''}>Part Time</option>
          <option value="daily" ${e.employment_type === 'daily' ? 'selected' : ''}>Harian</option>
        </select>
      </div>

      <div class="field field-full">
        <label>Supervisor / Atasan Langsung</label>
        <select name="supervisor_employee_id">
          <option value="">Belum ditentukan</option>
          ${supervisorOptions}
        </select>
        <div class="muted" style="margin-top:6px">
          Pilih karyawan yang menjadi SPV/atasan langsung.
          Karyawan tidak dapat dipilih sebagai supervisor untuk dirinya sendiri.
        </div>
      </div>

      <div class="field field-full">
        <div class="muted">
          Lokasi/outlet tidak diedit di sini. Gunakan <b>Riwayat Penempatan</b>
          agar setiap mutasi tetap tercatat.
        </div>
      </div>

    </div>
  `;

  const modal = openModal(
    'Edit Data Karyawan',
    body,
    async form => {
      const fd = new FormData(form);

      const employee_number = String(fd.get('employee_number') || '').trim();
      const full_name = String(fd.get('full_name') || '').trim();
      const join_date = fd.get('join_date') || '';
      const company_id = fd.get('company_id') || null;
      const supervisor_employee_id =
        String(fd.get('supervisor_employee_id') || '').trim() || null;

      if (!employee_number || !full_name || !join_date || !company_id) {
        toast('Lengkapi field bertanda *.', 'error');
        return false;
      }

      if (supervisor_employee_id === id) {
        toast('Karyawan tidak dapat menjadi supervisor dirinya sendiri.', 'error');
        return false;
      }

      const dup = state.employees.find(
        x => x.id !== id &&
        String(x.employee_number || '').toLowerCase() === employee_number.toLowerCase()
      );

      if (dup) {
        toast(`ID Karyawan "${employee_number}" sudah dipakai oleh ${dup.full_name}.`, 'error');
        return false;
      }

      const payload = {
        employee_number,
        full_name,
        nik: String(fd.get('nik') || '').trim() || null,
        email: String(fd.get('email') || '').trim() || null,
        phone: String(fd.get('phone') || '').trim() || null,
        join_date,
        company_id,
        department_id: fd.get('department_id') || null,
        position_id: fd.get('position_id') || null,
        employment_status: fd.get('employment_status') || 'active',
        employment_type: fd.get('employment_type') || null,
        supervisor_employee_id
      };

      const res = await sb
        .from('employees')
        .update(payload)
        .eq('id', id)
        .select();

      if (res.error) {
        toast(friendlyError(res.error), 'error');
        return false;
      }

      if (!res.data || !res.data.length) {
        toast(PERMISSION_MSG, 'error');
        return false;
      }

      const local = state.employees.find(x => x.id === id);
      if (local) {
        Object.assign(local, payload);
      }

      toast(
        `Data karyawan "${full_name}" berhasil diperbarui` +
        (supervisor_employee_id ? ' dan SPV berhasil disimpan.' : '.')
      );

      return true;
    },
    'Simpan',
    () => showEmployeeDetail(id)
  );

  const sel = n => modal.querySelector(`[name="${n}"]`);

  const fill = (name, items, placeholder, current) => {
    const el = sel(name);
    if (!el) return;

    el.innerHTML =
      `<option value="">${placeholder}</option>` +
      items.map(x =>
        `<option value="${esc(x.id)}" ${current === x.id ? 'selected' : ''}>
          ${esc(x.name)}${isActive(x) ? '' : ' (nonaktif)'}
        </option>`
      ).join('');
  };

  const refresh = () => {
    const employeeId = sel('company_id').value;

    const depts = (state.departments || []).filter(d =>
      isActive(d) &&
      (d.company_id === employeeId || !d.company_id)
    );

    const poss = (state.positions || []).filter(p =>
      isActive(p) &&
      (p.company_id === employeeId || !p.company_id)
    );

    fill(
      'department_id',
      depts,
      employeeId ? 'Pilih departemen' : 'Pilih perusahaan dulu',
      e.department_id
    );

    fill(
      'position_id',
      poss,
      employeeId ? 'Pilih jabatan' : 'Pilih perusahaan dulu',
      e.position_id
    );

    sel('department_id').disabled = !employeeId;
    sel('position_id').disabled = !employeeId;
  };

  sel('company_id').onchange = refresh;
  refresh();
};

console.log('HR Employee System Phase 6B loaded: Supervisor field in Employee Edit');
/* =========================================================
   PHASE 6D-2 — EMPLOYEE ACCESS + PIN + SPV APPROVAL
   Employee access does NOT create Supabase Auth accounts.
   ========================================================= */

const EMP_PORTAL_KEY = 'hr_employee_portal_session';
let empPortal = { token: null, employee: null, loading: false };

function empSessionGet(){ try{return JSON.parse(localStorage.getItem(EMP_PORTAL_KEY)||'null');}catch(_){return null;} }
function empSessionSet(v){ if(v)localStorage.setItem(EMP_PORTAL_KEY,JSON.stringify(v)); else localStorage.removeItem(EMP_PORTAL_KEY); }
function empPortalIsSupervisor(){ return String(empPortal.employee?.is_supervisor || false)==='true'; }

async function empRpc(name, args={}){
  if(!empPortal.token) throw new Error('Sesi karyawan belum aktif.');
  const {data,error}=await sb.rpc(name,{p_token:empPortal.token,...args});
  if(error) throw error;
  return data;
}

async function employeeLogin(employeeNumber,pin){
  const {data,error}=await sb.rpc('employee_login',{p_employee_number:String(employeeNumber||'').trim(),p_pin:String(pin||'')});
  if(error) throw error;
  if(!data?.token) throw new Error('Login karyawan gagal.');
  empPortal.token=data.token; empPortal.employee=data.employee;
  empSessionSet({token:data.token,employee:data.employee});
  renderEmployeePortal();
}

function renderEmployeeLogin(msg=''){
  document.querySelector('#app').innerHTML=`<div class="login"><form class="login-card" id="employeeLoginForm"><div class="brand">HR Employee System</div><div class="subtitle">Portal Karyawan</div><div class="field"><label>ID Karyawan</label><input id="empNumber" inputmode="numeric" autocomplete="username" required placeholder="Contoh: 2025001004"></div><div class="field"><label>PIN</label><input id="empPin" type="password" inputmode="numeric" autocomplete="current-password" minlength="6" maxlength="12" required placeholder="PIN karyawan"></div>${msg?`<div class="error">${esc(msg)}</div>`:''}<button type="submit" class="btn btn-primary btn-block">Masuk sebagai Karyawan</button><button type="button" class="btn btn-light btn-block" id="backAdminLogin">Login Admin / HR</button></form></div>`;
  $('#employeeLoginForm').addEventListener('submit',async e=>{e.preventDefault();const b=e.target.querySelector('button[type="submit"]');b.disabled=true;b.textContent='Memeriksa...';try{await employeeLogin($('#empNumber').value,$('#empPin').value);}catch(err){renderEmployeeLogin(friendlyError(err));}finally{if(document.body.contains(b)){b.disabled=false;b.textContent='Masuk sebagai Karyawan';}}});
  $('#backAdminLogin').onclick=()=>renderLogin();
}

async function employeeBootstrap(){
  const s=empSessionGet(); if(!s?.token) return false;
  empPortal.token=s.token; empPortal.employee=s.employee||null;
  try{
    const me=await empRpc('employee_me');
    if(!me?.employee) throw new Error('Sesi karyawan tidak valid.');
    empPortal.employee=me.employee; empSessionSet({token:empPortal.token,employee:empPortal.employee});
    renderEmployeePortal(); return true;
  }catch(_){empPortal={token:null,employee:null,loading:false};empSessionSet(null);return false;}
}

function employeeLogout(){ empPortal={token:null,employee:null,loading:false}; empSessionSet(null); renderLogin(); }

async function employeeLeaveList(){ return await empRpc('employee_leave_list'); }

async function employeeApproveLeave(id,decision){
  const note=decision==='rejected'?(prompt('Catatan penolakan (opsional):')||null):null;
  const data=await empRpc('employee_approve_leave',{p_leave_request_id:id,p_decision:decision,p_note:note});
  toast(decision==='approved'?'Pengajuan berhasil disetujui.':'Pengajuan berhasil ditolak.');
  renderEmployeePortal(); return data;
}

async function renderEmployeePortal(){
  if(!empPortal.employee){renderEmployeeLogin();return;}
  const e=empPortal.employee;
  const sup=!!e.is_supervisor;
  document.querySelector('#app').innerHTML=`<div class="shell"><aside class="sidebar"><div class="logo">Employee Portal</div><div class="nav"><button class="active" data-ep-view="home">Dashboard</button><button data-ep-view="attendance">Absensi</button>${sup?'<button data-ep-view="approval">Approval Tim</button>':''}<button data-ep-view="leave">Cuti / Izin</button></div></aside><main class="main"><div class="topbar"><h1>Portal Karyawan</h1><div class="userbox"><span>${esc(e.full_name||'-')} <span class="muted">(${esc(e.employee_number||'-')})</span></span><span class="avatar">${esc((e.full_name||'K')[0].toUpperCase())}</span><button id="epLogout" class="btn btn-light">Keluar</button></div></div><div id="epContent"></div></main></div>`;
  document.querySelectorAll('[data-ep-view]').forEach(b=>b.onclick=()=>employeePortalView(b.dataset.epView));
  $('#epLogout').onclick=employeeLogout;
  employeePortalView('home');
}

async function employeePortalView(view){
  const box=$('#epContent'); if(!box)return;
  const e=empPortal.employee;
  if(view==='home'){
    let leaveCount=0; try{const rows=await employeeLeaveList();leaveCount=rows?.length||0;}catch(_){ }
    box.innerHTML=`<div class="cards"><div class="card"><div class="muted">Nama</div><div class="metric" style="font-size:22px">${esc(e.full_name||'-')}</div><div class="muted">ID ${esc(e.employee_number||'-')}</div></div><div class="card"><div class="muted">Jabatan</div><div class="metric" style="font-size:22px">${esc(e.position_name||'-')}</div></div><div class="card"><div class="muted">Status</div><div class="metric" style="font-size:22px">${esc(e.employment_status||'-')}</div></div>${e.is_supervisor?`<div class="card"><div class="muted">Approval Tim</div><div class="metric">${esc(e.subordinate_count||0)}</div><div class="muted">bawahan</div></div>`:''}</div><div class="section"><div class="section-head"><h2>Akses Karyawan</h2></div><div class="info-box">Gunakan menu Absensi untuk absen dengan selfie + GPS. ${e.is_supervisor?'Sebagai Supervisor, menu Approval Tim digunakan untuk menyetujui cuti/izin bawahan.':''}</div></div>`;
  } else if(view==='approval'){
    box.innerHTML='<div class="card empty">Memuat pengajuan tim...</div>';
    try{const rows=await empRpc('employee_supervisor_queue');box.innerHTML=employeeApprovalHtml(rows||[]);}catch(err){box.innerHTML=`<div class="card"><div class="error">${esc(friendlyError(err))}</div></div>`;}
  } else if(view==='leave'){
    box.innerHTML='<div class="card empty">Memuat pengajuan...</div>';
    try{const rows=await employeeLeaveList();box.innerHTML=employeeLeaveHtml(rows||[]);}catch(err){box.innerHTML=`<div class="card"><div class="error">${esc(friendlyError(err))}</div></div>`;}
  } else if(view==='attendance'){
    box.innerHTML=`<div class="section"><div class="section-head"><h2>Absensi</h2></div><div class="info-box">Modul absensi selfie + GPS tetap menggunakan mesin absensi yang sudah dibuat. Integrasi Employee Portal dengan pengiriman foto akan kita aktifkan pada tahap berikutnya setelah jalur session karyawan ini selesai diuji.</div></div>`;
  }
}

function employeeApprovalHtml(rows){
  if(!rows.length)return '<div class="card empty">Tidak ada pengajuan yang menunggu approval Anda.</div>';
  return `<div class="section"><div class="section-head"><h2>Approval Tim</h2><span class="muted">Hanya bawahan yang terdaftar sebagai tim Anda.</span></div><div class="table-wrap"><table class="table"><thead><tr><th>Karyawan</th><th>Jenis</th><th>Periode</th><th>Hari</th><th>Status</th><th>Aksi</th></tr></thead><tbody>${rows.map(r=>`<tr><td><b>${esc(r.employee_name||'-')}</b><div class="muted">${esc(r.employee_number||'-')}</div></td><td>${esc(r.leave_type_name||'-')}</td><td>${fmtDate(r.start_date)} — ${fmtDate(r.end_date)}</td><td>${esc(r.total_days||'-')}</td><td>${esc(r.status_label||'Menunggu SPV')}</td><td><div class="row-actions"><button class="btn btn-primary btn-sm" onclick="employeeApproveLeave('${esc(r.id)}','approved')">Setujui</button><button class="btn btn-light btn-sm" onclick="employeeApproveLeave('${esc(r.id)}','rejected')">Tolak</button></div></td></tr>`).join('')}</tbody></table></div></div>`;
}
function employeeLeaveHtml(rows){
  if(!rows.length)return '<div class="card empty">Belum ada pengajuan cuti/izin.</div>';
  return `<div class="section"><div class="section-head"><h2>Pengajuan Saya</h2></div><div class="table-wrap"><table class="table"><thead><tr><th>Jenis</th><th>Periode</th><th>Hari</th><th>Status</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.leave_type_name||'-')}</td><td>${fmtDate(r.start_date)} — ${fmtDate(r.end_date)}</td><td>${esc(r.total_days||'-')}</td><td>${esc(r.status_label||'-')}</td></tr>`).join('')}</tbody></table></div></div>`;
}

// Tambahkan pilihan Portal Karyawan pada login admin yang sudah ada.
const __renderAdminLogin = renderLogin;
renderLogin = function(msg=''){
  __renderAdminLogin(msg);
  const form=$('#loginForm'); if(!form)return;
  const b=document.createElement('button'); b.type='button'; b.className='btn btn-light btn-block'; b.textContent='Login Karyawan'; b.onclick=()=>renderEmployeeLogin();
  form.appendChild(b);
};

// Employee session dimulai terpisah dari Supabase Auth admin.
const __initEmployeePortal = async()=>{ if(await employeeBootstrap()) return true; return false; };

// Jika ada session karyawan tersimpan, gunakan portal karyawan; jika tidak, alur admin tetap normal.
const __origInit = init;
init = async function(){
  if(!configured()){renderConfigHelp();return;}
  sb=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);
  const emp=await __initEmployeePortal(); if(emp)return;
  await __origInit();
};

console.log('HR Employee System Phase 6D-2 loaded: Employee Login + PIN + SPV Portal');
/* ============================================================
   PHASE 6C — EMPLOYEE PORTAL + APPROVAL TIM
   Tambahkan DI PALING BAWAH app.js yang sedang dipakai.
   Tidak mengganti modul HR/Admin yang sudah ada.
   ============================================================ */

(function () {
  'use strict';

  const EP6C = {
    buttonId: 'ep6cApprovalNav',
    originalContent: null,
    busy: false
  };

  function ep6cEsc(v) {
    if (typeof window.esc === 'function') return window.esc(v);
    return String(v ?? '').replace(/[&<>'"]/g, c => ({
      '&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'
    }[c]));
  }

  function ep6cFmtDate(d) {
    if (typeof window.fmtDate === 'function') return window.fmtDate(d);
    return d ? new Date(d + 'T00:00:00').toLocaleDateString('id-ID') : '-';
  }

  function ep6cToast(msg, type) {
    if (typeof window.toast === 'function') window.toast(msg, type);
    else alert(msg);
  }

  function ep6cMyEmployeeId() {
    return window.state?.profile?.employee_id || null;
  }

  function ep6cIsEmployeePortal() {
    const id = ep6cMyEmployeeId();
    if (!id) return false;

    const text = document.body?.innerText || '';
    return /Portal Karyawan/i.test(text);
  }

  function ep6cSidebar() {
    return document.querySelector('.sidebar .nav')
      || document.querySelector('.sidebar')
      || document.querySelector('aside .nav')
      || document.querySelector('aside');
  }

  function ep6cFindNavButton(labelRegex) {
    return [...document.querySelectorAll('.sidebar button, aside button, .nav button')]
      .find(b => labelRegex.test((b.textContent || '').trim()));
  }

  function ep6cInstallNav() {
    if (!ep6cIsEmployeePortal()) return;

    const nav = ep6cSidebar();
    if (!nav) return;
    if (document.getElementById(EP6C.buttonId)) return;

    const btn = document.createElement('button');
    btn.id = EP6C.buttonId;
    btn.type = 'button';
    btn.textContent = 'Approval Tim';
    btn.style.cursor = 'pointer';
    btn.addEventListener('click', () => ep6cRenderApproval());

    const leaveBtn = ep6cFindNavButton(/Cuti\s*\/?\s*Izin/i);
    if (leaveBtn && leaveBtn.parentElement === nav) {
      nav.insertBefore(btn, leaveBtn.nextSibling);
    } else {
      nav.appendChild(btn);
    }
  }

  async function ep6cLoadTeamRequests() {
    const myId = ep6cMyEmployeeId();
    if (!myId) return { team: [], requests: [] };

    const teamQ = await window.sb
      .from('employees')
      .select('id,full_name,employee_number,supervisor_employee_id')
      .eq('supervisor_employee_id', myId)
      .eq('employment_status', 'active')
      .order('full_name');

    if (teamQ.error) throw teamQ.error;

    const team = teamQ.data || [];
    if (!team.length) return { team, requests: [] };

    const ids = team.map(e => e.id);

    const reqQ = await window.sb
      .from('leave_requests')
      .select(`
        id,
        employee_id,
        leave_type_id,
        start_date,
        end_date,
        total_days,
        reason,
        employee_note,
        status,
        supervisor_status,
        supervisor_note,
        submitted_at,
        created_at,
        employees(
          full_name,
          employee_number,
          supervisor_employee_id
        ),
        leave_types(
          name,
          code
        )
      `)
      .in('employee_id', ids)
      .eq('status', 'pending')
      .order('start_date', { ascending: false });

    if (reqQ.error) throw reqQ.error;

    return { team, requests: reqQ.data || [] };
  }

  function ep6cStatusBadge(status) {
    if (status === 'approved') return '<span class="badge badge-green">Disetujui</span>';
    if (status === 'rejected') return '<span class="badge badge-red">Ditolak</span>';
    return '<span class="badge badge-yellow">Menunggu SPV</span>';
  }

  function ep6cRenderRows(requests) {
    if (!requests.length) {
      return `
        <div class="card empty" style="padding:28px;text-align:center">
          Tidak ada pengajuan yang menunggu approval Anda.
        </div>
      `;
    }

    return `
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Karyawan</th>
              <th>Jenis</th>
              <th>Periode</th>
              <th>Hari</th>
              <th>Alasan</th>
              <th>Status</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            ${requests.map(r => `
              <tr>
                <td>
                  <b>${ep6cEsc(r.employees?.full_name || '-')}</b>
                  <div class="muted">${ep6cEsc(r.employees?.employee_number || '')}</div>
                </td>
                <td>${ep6cEsc(r.leave_types?.name || '-')}</td>
                <td>${ep6cFmtDate(r.start_date)} — ${ep6cFmtDate(r.end_date)}</td>
                <td>${ep6cEsc(r.total_days ?? '-')}</td>
                <td>${ep6cEsc(r.reason || r.employee_note || '-')}</td>
                <td>${ep6cStatusBadge(r.status)}</td>
                <td>
                  <div class="row-actions">
                    <button class="btn btn-light btn-sm"
                      onclick="window.ep6cDetail('${ep6cEsc(r.id)}')">
                      Detail
                    </button>
                    <button class="btn btn-primary btn-sm"
                      onclick="window.ep6cApprove('${ep6cEsc(r.id)}','approved')">
                      Setujui
                    </button>
                    <button class="btn btn-light btn-sm"
                      onclick="window.ep6cApprove('${ep6cEsc(r.id)}','rejected')">
                      Tolak
                    </button>
                  </div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  window.ep6cRenderApproval = async function () {
    const content = document.querySelector('#content');
    if (!content) return;

    const myId = ep6cMyEmployeeId();
    if (!myId) {
      ep6cToast('Akun ini belum terhubung ke data karyawan.', 'error');
      return;
    }

    content.innerHTML = `
      <div class="section">
        <div class="section-head">
          <div>
            <h2>Approval Tim</h2>
            <div class="muted">Pengajuan cuti/izin dari karyawan yang menjadi bawahan Anda.</div>
          </div>
          <button class="btn btn-light" id="ep6cRefreshBtn">Refresh</button>
        </div>
        <div class="cards">
          <div class="card">
            <div class="muted">Menunggu Approval</div>
            <div class="metric" id="ep6cPendingCount">...</div>
          </div>
          <div class="card">
            <div class="muted">Tim Aktif</div>
            <div class="metric" id="ep6cTeamCount">...</div>
          </div>
        </div>
      </div>
      <div class="section">
        <div class="section-head"><h2>Pengajuan Menunggu Approval</h2></div>
        <div id="ep6cApprovalBody" class="card empty">Memuat data...</div>
      </div>
    `;

    document.getElementById('ep6cRefreshBtn')?.addEventListener('click', ep6cRenderApproval);

    try {
      const { team, requests } = await ep6cLoadTeamRequests();
      const pc = document.getElementById('ep6cPendingCount');
      const tc = document.getElementById('ep6cTeamCount');
      const body = document.getElementById('ep6cApprovalBody');

      if (pc) pc.textContent = requests.length;
      if (tc) tc.textContent = team.length;
      if (body) {
        body.className = '';
        body.innerHTML = ep6cRenderRows(requests);
      }
    } catch (e) {
      console.error('Phase 6C Approval Tim:', e);
      const body = document.getElementById('ep6cApprovalBody');
      if (body) {
        body.className = 'card empty';
        body.innerHTML = `
          <b>Gagal memuat Approval Tim.</b>
          <div class="muted" style="margin-top:8px">${ep6cEsc(e?.message || String(e))}</div>
        `;
      }
      ep6cToast('Approval Tim gagal dimuat. Periksa policy RLS yang disertakan bersama patch.', 'error');
    }
  };

  window.ep6cDetail = async function (id) {
    try {
      const { data, error } = await window.sb
        .from('leave_requests')
        .select(`
          *,
          employees(
            full_name,
            employee_number,
            supervisor_employee_id
          ),
          leave_types(name,code)
        `)
        .eq('id', id)
        .single();

      if (error) throw error;

      const html = `
        <div class="detail-grid">
          <div class="detail-item">
            <div class="muted">Karyawan</div>
            <b>${ep6cEsc(data.employees?.full_name || '-')}</b>
            <div class="muted">${ep6cEsc(data.employees?.employee_number || '')}</div>
          </div>
          <div class="detail-item">
            <div class="muted">Jenis</div>
            <div>${ep6cEsc(data.leave_types?.name || '-')}</div>
          </div>
          <div class="detail-item">
            <div class="muted">Periode</div>
            <div>${ep6cFmtDate(data.start_date)} — ${ep6cFmtDate(data.end_date)}</div>
          </div>
          <div class="detail-item">
            <div class="muted">Jumlah</div>
            <div>${ep6cEsc(data.total_days || '-')} hari</div>
          </div>
          <div class="detail-item">
            <div class="muted">Status</div>
            <div>${ep6cStatusBadge(data.status)}</div>
          </div>
        </div>
        <div class="section" style="margin-top:18px">
          <h3 class="sub-title">Alasan</h3>
          <div class="info-box">${ep6cEsc(data.reason || data.employee_note || '-')}</div>
        </div>
      `;

      if (typeof window.openModal === 'function') {
        window.openModal('Detail Pengajuan', html, null, 'Tutup');
      } else {
        alert(
          `Karyawan: ${data.employees?.full_name || '-'}\n` +
          `Periode: ${data.start_date} - ${data.end_date}\n` +
          `Alasan: ${data.reason || '-'}`
        );
      }
    } catch (e) {
      ep6cToast(e?.message || String(e), 'error');
    }
  };

  window.ep6cApprove = async function (id, decision) {
    if (EP6C.busy) return;

    const myId = ep6cMyEmployeeId();
    if (!myId) {
      ep6cToast('Akun ini belum terhubung ke karyawan.', 'error');
      return;
    }

    try {
      EP6C.busy = true;

      const current = await window.sb
        .from('leave_requests')
        .select(`
          id,
          employee_id,
          status,
          supervisor_status,
          employees(
            full_name,
            employee_number,
            supervisor_employee_id
          )
        `)
        .eq('id', id)
        .single();

      if (current.error) throw current.error;

      const r = current.data;

      if (r.status !== 'pending') {
        ep6cToast('Pengajuan ini sudah diproses atau tidak lagi menunggu SPV.', 'error');
        await ep6cRenderApproval();
        return;
      }

      if (r.employees?.supervisor_employee_id !== myId) {
        ep6cToast('Anda bukan supervisor untuk karyawan ini.', 'error');
        return;
      }

      if (decision === 'rejected') {
        const note = prompt('Catatan penolakan SPV (opsional):') || null;

        const q = await window.sb
          .from('leave_requests')
          .update({
            supervisor_status: 'rejected',
            status: 'rejected',
            supervisor_note: note
          })
          .eq('id', id)
          .eq('status', 'pending');

        if (q.error) throw q.error;

        const a = await window.sb.from('leave_approvals').insert({
          leave_request_id: id,
          approver_profile_id: window.state.profile.id,
          approval_level: 'supervisor',
          decision: 'rejected',
          note
        });

        if (a.error) throw a.error;

        ep6cToast('Pengajuan ditolak oleh SPV.');
      } else {
        const q = await window.sb
          .from('leave_requests')
          .update({
            supervisor_status: 'approved',
            status: 'supervisor_approved',
            supervisor_approved_at: new Date().toISOString(),
            supervisor_approved_by: window.state.profile.id
          })
          .eq('id', id)
          .eq('status', 'pending');

        if (q.error) throw q.error;

        const a = await window.sb.from('leave_approvals').insert({
          leave_request_id: id,
          approver_profile_id: window.state.profile.id,
          approval_level: 'supervisor',
          decision: 'approved'
        });

        if (a.error) throw a.error;

        ep6cToast('Pengajuan disetujui SPV dan diteruskan ke HR.');
      }

      await ep6cRenderApproval();
    } catch (e) {
      console.error('Phase 6C approval error:', e);
      ep6cToast(
        'Approval gagal: ' + (e?.message || String(e)) +
        '. Jika muncul RLS/policy, jalankan SQL Phase 6C.',
        'error'
      );
    } finally {
      EP6C.busy = false;
    }
  };

  /* Pasang tombol setiap kali portal dirender ulang. */
  const observer = new MutationObserver(() => {
    if (!EP6C.busy) ep6cInstallNav();
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });

  /* Coba langsung + beberapa saat setelah aplikasi selesai render. */
  ep6cInstallNav();
  setTimeout(ep6cInstallNav, 500);
  setTimeout(ep6cInstallNav, 1500);
  setTimeout(ep6cInstallNav, 3000);

  console.log('Phase 6C loaded: Employee Portal + Approval Tim');
})();
/* PHASE 6C FIX — Tombol Setujui/Tolak Approval Tim
   Tempelkan di PALING BAWAH app.js, lalu commit/push.
   Fix: gunakan sb/state langsung (bukan window.sb/window.state).
*/

window.ep6cApprove = async function(requestId, decision) {
  try {
    const request = (state.leave || []).find(x => x.id === requestId);
    if (!request) {
      toast('Pengajuan tidak ditemukan.', 'error');
      return;
    }

    const myEmployeeId = state.profile?.employee_id;
    if (!myEmployeeId) {
      toast('Akun Anda belum terhubung ke data karyawan.', 'error');
      return;
    }

    const employee = (state.employees || []).find(x => x.id === request.employee_id);
    if (!employee || employee.supervisor_employee_id !== myEmployeeId) {
      toast('Anda bukan atasan langsung karyawan ini.', 'error');
      return;
    }

    if (request.status !== 'pending') {
      toast('Pengajuan ini sudah diproses atau tidak lagi menunggu SPV.', 'error');
      return;
    }

    const label = decision === 'approved' ? 'menyetujui' : 'menolak';
    const ok = confirm(`Anda yakin ingin ${label} pengajuan ${employee.full_name || 'karyawan ini'}?`);
    if (!ok) return;

    const note = decision === 'rejected'
      ? (prompt('Alasan penolakan (opsional):') || '').trim()
      : '';

    const now = new Date().toISOString();
    const updatePayload = decision === 'approved'
      ? {
          supervisor_status: 'approved',
          supervisor_approved_at: now,
          supervisor_approved_by: state.profile.id,
          status: 'supervisor_approved',
          supervisor_note: note || null
        }
      : {
          supervisor_status: 'rejected',
          supervisor_approved_at: now,
          supervisor_approved_by: state.profile.id,
          status: 'rejected',
          supervisor_note: note || null
        };

    const { data: updated, error: updateError } = await sb
      .from('leave_requests')
      .update(updatePayload)
      .eq('id', requestId)
      .eq('status', 'pending')
      .select('id,status,supervisor_status,hr_status');

    if (updateError) {
      toast(friendlyError(updateError), 'error');
      return;
    }

    if (!updated || !updated.length) {
      toast('Pengajuan tidak berubah. Kemungkinan policy RLS belum diperbarui.', 'error');
      return;
    }

    const { error: approvalError } = await sb
      .from('leave_approvals')
      .insert({
        leave_request_id: requestId,
        approval_level: 'supervisor',
        approver_profile_id: state.profile.id,
        decision: decision,
        note: note || null,
        decided_at: now
      });

    if (approvalError) {
      console.error('leave_approvals insert:', approvalError);
      toast('Status pengajuan sudah berubah, tetapi riwayat approval gagal disimpan: ' + friendlyError(approvalError), 'error');
    } else {
      toast(decision === 'approved'
        ? 'Pengajuan berhasil disetujui SPV dan diteruskan ke HR.'
        : 'Pengajuan berhasil ditolak.');
    }

    await loadAll();
    if (typeof ep6cRenderApproval === 'function') {
      await ep6cRenderApproval();
    } else if (state.view === 'leave') {
      leave();
    }
  } catch (err) {
    console.error('Approval Tim error:', err);
    toast(friendlyError(err), 'error');
  }
};

console.log('PHASE 6C FIX loaded — Approval Tim menggunakan sb/state langsung');
/* ============================================================
   PHASE 6C FIX 2 — HUBUNGKAN TOMBOL "SETUJUI SPV" KE HANDLER BARU
   Masalah: tombol lama masih memanggil p6Approve(...), sedangkan
   patch sebelumnya membuat ep6cApprove(...). Akibatnya tombol
   "Setujui" tetap tidak menjalankan handler yang baru.

   CARA PAKAI:
   1. Tempel file ini di PALING BAWAH app.js
   2. Commit & push ke GitHub
   3. Tunggu Vercel deploy
   4. Logout/login kembali sebagai Sunarwan
   ============================================================ */

(function () {
  'use strict';

  /* Jangan menyimpan wrapper berulang kali jika file ter-load lebih dari sekali. */
  if (!window.__phase6cOriginalP6Approve) {
    window.__phase6cOriginalP6Approve = window.p6Approve;
  }

  /*
   * Tombol lama di halaman Approval Tim menggunakan:
   * p6Approve(id, 'supervisor', 'approved')
   *
   * Kita arahkan khusus level supervisor ke ep6cApprove().
   * Approval HR tetap memakai handler lama.
   */
  window.p6Approve = async function (id, level, decision) {
    if (level === 'supervisor') {
      if (typeof window.ep6cApprove !== 'function') {
        toast('Handler Approval Tim belum termuat. Pastikan patch PHASE 6C FIX sebelumnya juga sudah ditempel.', 'error');
        return;
      }

      return await window.ep6cApprove(id, decision);
    }

    const original = window.__phase6cOriginalP6Approve;
    if (typeof original === 'function') {
      return await original(id, level, decision);
    }

    toast('Handler approval HR belum tersedia.', 'error');
  };

  console.log('PHASE 6C FIX 2 loaded — tombol Setujui SPV diarahkan ke ep6cApprove');
})();
/* PHASE 6C FINAL FIX — TOMBOL SETUJUI SPV */
(function () {
  'use strict';

  async function finalSupervisorApprove(requestId, decision) {
    try {
      const profile = state.profile;
      const myEmployeeId = profile && profile.employee_id;

      if (!myEmployeeId) {
        toast('Akun SPV belum terhubung ke data karyawan.', 'error');
        return;
      }

      const rq = await sb.from('leave_requests')
        .select('id,employee_id,status,supervisor_status,hr_status,start_date,end_date,reason')
        .eq('id', requestId)
        .maybeSingle();

      if (rq.error) { toast(friendlyError(rq.error), 'error'); return; }
      const request = rq.data;

      if (!request) {
        toast('Pengajuan tidak ditemukan.', 'error');
        return;
      }

      if (request.status !== 'pending') {
        toast('Pengajuan ini sudah diproses dan tidak lagi menunggu SPV.', 'error');
        return;
      }

      const er = await sb.from('employees')
        .select('id,full_name,employee_number,supervisor_employee_id')
        .eq('id', request.employee_id)
        .maybeSingle();

      if (er.error) { toast(friendlyError(er.error), 'error'); return; }
      const employee = er.data;

      if (!employee) {
        toast('Data karyawan pengajuan tidak ditemukan.', 'error');
        return;
      }

      if (employee.supervisor_employee_id !== myEmployeeId) {
        toast('Anda bukan atasan langsung karyawan ini.', 'error');
        return;
      }

      const isApprove = decision === 'approved';

      if (!confirm(isApprove
        ? `Setujui pengajuan ${employee.full_name}?`
        : `Tolak pengajuan ${employee.full_name}?`)) return;

      const note = isApprove ? null : ((prompt('Alasan penolakan (opsional):') || '').trim() || null);
      const now = new Date().toISOString();

      const payload = isApprove
        ? {
            supervisor_status: 'approved',
            supervisor_approved_at: now,
            supervisor_approved_by: profile.id,
            status: 'supervisor_approved',
            supervisor_note: null
          }
        : {
            supervisor_status: 'rejected',
            supervisor_approved_at: now,
            supervisor_approved_by: profile.id,
            status: 'rejected',
            supervisor_note: note
          };

      const ur = await sb.from('leave_requests')
        .update(payload)
        .eq('id', requestId)
        .eq('status', 'pending')
        .select('id,status,supervisor_status,hr_status')
        .maybeSingle();

      if (ur.error) {
        toast(friendlyError(ur.error), 'error');
        return;
      }

      if (!ur.data) {
        toast('Pengajuan tidak berubah. Periksa policy RLS leave_requests.', 'error');
        return;
      }

      const ar = await sb.from('leave_approvals').insert({
        leave_request_id: requestId,
        approver_profile_id: profile.id,
        approval_level: 'supervisor',
        decision: decision,
        note: note,
        decided_at: now
      });

      if (ar.error) {
        console.error('leave_approvals:', ar.error);
        toast('Status sudah berubah, tetapi riwayat approval gagal disimpan: ' + friendlyError(ar.error), 'error');
      } else {
        toast(isApprove
          ? 'Berhasil disetujui SPV. Pengajuan diteruskan ke HR.'
          : 'Pengajuan berhasil ditolak.');
      }

      if (typeof loadAll === 'function') await loadAll();
      if (typeof ep6cRenderApproval === 'function') {
        await ep6cRenderApproval();
      } else if (typeof leave === 'function') {
        leave();
      }

    } catch (err) {
      console.error('FINAL Approval SPV error:', err);
      toast(friendlyError(err), 'error');
    }
  }

  window.finalSupervisorApprove = finalSupervisorApprove;

  /* Tangkap tombol lama: p6Approve('ID','supervisor','approved') */
  document.addEventListener('click', function (event) {
    const btn = event.target.closest('button');
    if (!btn) return;

    const text = (btn.textContent || '').trim().toLowerCase();
    if (!text.includes('setujui') || text.includes('approve hr')) return;

    const onclick = btn.getAttribute('onclick') || '';
    const m = onclick.match(
      /p6Approve\s*\(\s*['"]([^'"]+)['"]\s*,\s*['"]supervisor['"]\s*,\s*['"](approved|rejected)['"]\s*\)/
    );

    if (!m) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    btn.disabled = false;
    btn.removeAttribute('disabled');
    btn.style.pointerEvents = 'auto';

    finalSupervisorApprove(m[1], m[2]);
  }, true);

  /* Lapisan kedua: override handler lama. */
  window.p6Approve = async function (id, level, decision) {
    if (level === 'supervisor') return finalSupervisorApprove(id, decision);
    toast('Approval HR menggunakan alur HR.', 'error');
  };

  function unlockApprovalButtons() {
    document.querySelectorAll('button').forEach(btn => {
      const t = (btn.textContent || '').trim().toLowerCase();
      if (t.includes('setujui') && !t.includes('approve hr')) {
        btn.disabled = false;
        btn.removeAttribute('disabled');
        btn.style.pointerEvents = 'auto';
        btn.style.cursor = 'pointer';
      }
    });
  }

  unlockApprovalButtons();
  new MutationObserver(unlockApprovalButtons)
    .observe(document.body, {childList: true, subtree: true});

  console.log('PHASE 6C FINAL FIX loaded');
})();
/* ================================================================
   PHASE 6C — FIX 3: REBIND TOMBOL SETUJUI SECARA LANGSUNG
   Tidak menggunakan onclick HTML lama.
   ================================================================ */
(function () {
  'use strict';

  async function approveFromButton(btn) {
    try {
      btn.disabled = true;
      const oldText = btn.textContent;
      btn.textContent = 'Memproses...';

      const row = btn.closest('tr');
      if (!row) throw new Error('Baris pengajuan tidak ditemukan.');

      /* Ambil nomor karyawan dari baris tabel. */
      const firstCell = row.querySelector('td');
      const employeeNumber = firstCell
        ? ((firstCell.innerText || '').match(/\b\d{8,}\b/) || [null])[0]
        : null;

      if (!employeeNumber) {
        throw new Error('ID karyawan pada baris pengajuan tidak ditemukan.');
      }

      const emp = (state.employees || []).find(
        e => String(e.employee_number || '') === String(employeeNumber)
      );

      if (!emp) throw new Error('Data karyawan tidak ditemukan: ' + employeeNumber);

      const myEmployeeId = state.profile && state.profile.employee_id;
      if (!myEmployeeId) {
        throw new Error('Akun Sunarwan belum terhubung ke data karyawan.');
      }

      if (String(emp.supervisor_employee_id) !== String(myEmployeeId)) {
        throw new Error('Karyawan ini bukan bawahan langsung akun yang sedang login.');
      }

      /* Cari pengajuan pending milik karyawan tersebut. */
      let request = (state.leave || []).find(
        r => String(r.employee_id) === String(emp.id) &&
             r.status === 'pending'
      );

      /* Jika state belum memuat, ambil langsung dari Supabase. */
      if (!request) {
        const q = await sb.from('leave_requests')
          .select('id,employee_id,status,supervisor_status,hr_status')
          .eq('employee_id', emp.id)
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
          .limit(1);

        if (q.error) throw q.error;
        request = q.data && q.data[0];
      }

      if (!request) throw new Error('Pengajuan pending tidak ditemukan.');

      if (!confirm('Setujui pengajuan ' + (emp.full_name || '') + '?')) {
        btn.disabled = false;
        btn.textContent = oldText;
        return;
      }

      const now = new Date().toISOString();

      const q = await sb.from('leave_requests')
        .update({
          supervisor_status: 'approved',
          supervisor_approved_at: now,
          supervisor_approved_by: state.profile.id,
          status: 'supervisor_approved',
          supervisor_note: null
        })
        .eq('id', request.id)
        .eq('status', 'pending')
        .select('id,status,supervisor_status,hr_status');

      if (q.error) throw q.error;
      if (!q.data || !q.data.length) {
        throw new Error('Database tidak mengubah pengajuan. Cek RLS leave_requests.');
      }

      const history = await sb.from('leave_approvals').insert({
        leave_request_id: request.id,
        approver_profile_id: state.profile.id,
        approval_level: 'supervisor',
        decision: 'approved',
        note: null,
        decided_at: now
      });

      if (history.error) {
        console.error('Riwayat approval:', history.error);
        toast('Pengajuan sudah disetujui SPV, tetapi riwayat approval gagal disimpan.', 'error');
      } else {
        toast('Berhasil disetujui SPV. Pengajuan diteruskan ke HR.');
      }

      if (typeof loadAll === 'function') await loadAll();

      /* Refresh halaman Approval Tim tanpa kembali ke menu lain. */
      if (typeof ep6cRenderApproval === 'function') {
        await ep6cRenderApproval();
      } else {
        /* Cari fungsi portal yang sedang digunakan dengan cara aman. */
        const approvalBtn = Array.from(document.querySelectorAll('button,a'))
          .find(x => (x.textContent || '').trim() === 'Approval Tim');
        if (approvalBtn) approvalBtn.click();
      }

    } catch (err) {
      console.error('FIX 3 Approval:', err);
      toast(typeof friendlyError === 'function' ? friendlyError(err) : String(err.message || err), 'error');
      btn.disabled = false;
      btn.textContent = 'Setujui';
    }
  }

  function bindApprovalButtons() {
    const buttons = Array.from(document.querySelectorAll('button'))
      .filter(btn => {
        const text = (btn.textContent || '').trim().toLowerCase();
        return text === 'setujui' || text === 'setujui spv';
      });

    buttons.forEach(btn => {
      if (btn.dataset.finalApprovalBound === '1') return;

      /* Lepaskan onclick lama yang bermasalah. */
      btn.removeAttribute('onclick');

      btn.dataset.finalApprovalBound = '1';
      btn.disabled = false;

      /* Paksa tombol berada di atas elemen lain. */
      btn.style.position = 'relative';
      btn.style.zIndex = '99999';
      btn.style.pointerEvents = 'auto';
      btn.style.cursor = 'pointer';

      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        approveFromButton(btn);
      }, false);
    });
  }

  bindApprovalButtons();

  /* Approval Tim dirender ulang secara dinamis, jadi bind ulang otomatis. */
  const observer = new MutationObserver(bindApprovalButtons);
  observer.observe(document.body, { childList: true, subtree: true });

  /* Fallback untuk render yang tidak memicu MutationObserver. */
  setInterval(bindApprovalButtons, 500);

  console.log('PHASE 6C FIX 3 loaded — tombol Setujui dibind langsung');
})();
/* ================================================================
   PHASE 6C — FIX 4: APPROVAL TIM (QUERY DATABASE LANGSUNG)
   Perbaikan dari FIX 3:
   - Jangan bergantung pada state.employees.
   - Cari employee langsung dari tabel public.employees berdasarkan
     employee_number yang tampil di baris.
   - Cari request langsung dari leave_requests.
   ================================================================ */
(function () {
  'use strict';

  async function approveFromButton(btn) {
    const originalText = btn.textContent;

    try {
      btn.disabled = true;
      btn.textContent = 'Memproses...';

      const row = btn.closest('tr');
      if (!row) throw new Error('Baris pengajuan tidak ditemukan.');

      const firstCell = row.querySelector('td');
      const employeeNumber = firstCell
        ? ((firstCell.innerText || '').match(/\b\d{8,}\b/) || [null])[0]
        : null;

      if (!employeeNumber) {
        throw new Error('ID karyawan pada baris tidak ditemukan.');
      }

      const myEmployeeId = state.profile && state.profile.employee_id;
      if (!myEmployeeId) {
        throw new Error('Akun Anda belum terhubung ke data karyawan.');
      }

      /* 1. Ambil karyawan langsung dari DATABASE. */
      const employeeQuery = await sb
        .from('employees')
        .select('id,full_name,employee_number,supervisor_employee_id')
        .eq('employee_number', employeeNumber)
        .maybeSingle();

      if (employeeQuery.error) throw employeeQuery.error;

      const emp = employeeQuery.data;

      if (!emp) {
        throw new Error('Data karyawan tidak ditemukan: ' + employeeNumber);
      }

      /* 2. Pastikan benar bawahan Sunarwan. */
      if (String(emp.supervisor_employee_id) !== String(myEmployeeId)) {
        throw new Error('Karyawan ini bukan bawahan langsung akun yang sedang login.');
      }

      if (!confirm('Setujui pengajuan ' + (emp.full_name || '') + '?')) {
        btn.disabled = false;
        btn.textContent = originalText;
        return;
      }

      /* 3. Ambil pengajuan pending langsung dari DATABASE. */
      const requestQuery = await sb
        .from('leave_requests')
        .select('id,employee_id,status,supervisor_status,hr_status')
        .eq('employee_id', emp.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1);

      if (requestQuery.error) throw requestQuery.error;

      const request = requestQuery.data && requestQuery.data[0];

      if (!request) {
        throw new Error('Pengajuan pending Abdul Rozak tidak ditemukan.');
      }

      const now = new Date().toISOString();

      /* 4. Setujui sebagai SPV. */
      const updateQuery = await sb
        .from('leave_requests')
        .update({
          supervisor_status: 'approved',
          supervisor_approved_at: now,
          supervisor_approved_by: state.profile.id,
          status: 'supervisor_approved',
          supervisor_note: null
        })
        .eq('id', request.id)
        .eq('status', 'pending')
        .select('id,status,supervisor_status,hr_status');

      if (updateQuery.error) throw updateQuery.error;

      if (!updateQuery.data || !updateQuery.data.length) {
        throw new Error(
          'Pengajuan tidak berubah. Policy RLS leave_requests masih menolak approval SPV.'
        );
      }

      /* 5. Simpan histori approval. */
      const historyQuery = await sb
        .from('leave_approvals')
        .insert({
          leave_request_id: request.id,
          approver_profile_id: state.profile.id,
          approval_level: 'supervisor',
          decision: 'approved',
          note: null,
          decided_at: now
        });

      if (historyQuery.error) {
        console.error('Riwayat approval gagal:', historyQuery.error);
        toast(
          'Pengajuan sudah disetujui SPV, tetapi riwayat approval gagal disimpan.',
          'error'
        );
      } else {
        toast('Berhasil disetujui SPV. Pengajuan diteruskan ke HR.');
      }

      if (typeof loadAll === 'function') {
        await loadAll();
      }

      /* Refresh Approval Tim. */
      if (typeof ep6cRenderApproval === 'function') {
        await ep6cRenderApproval();
      } else {
        window.location.reload();
      }

    } catch (err) {
      console.error('FIX 4 Approval Tim:', err);
      toast(
        typeof friendlyError === 'function'
          ? friendlyError(err)
          : String(err.message || err),
        'error'
      );
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }

  function bindApprovalButtons() {
    document.querySelectorAll('button').forEach(btn => {
      const text = (btn.textContent || '').trim().toLowerCase();

      if (text !== 'setujui' && text !== 'setujui spv') return;
      if (btn.dataset.fix4ApprovalBound === '1') return;

      btn.removeAttribute('onclick');
      btn.disabled = false;
      btn.dataset.fix4ApprovalBound = '1';

      btn.style.position = 'relative';
      btn.style.zIndex = '99999';
      btn.style.pointerEvents = 'auto';
      btn.style.cursor = 'pointer';

      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        approveFromButton(btn);
      }, true);
    });
  }

  bindApprovalButtons();

  const observer = new MutationObserver(bindApprovalButtons);
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  setInterval(bindApprovalButtons, 500);

  console.log(
    'PHASE 6C FIX 4 loaded — Approval Tim menggunakan query database langsung'
  );
})();
/* ================================================================
   PHASE 6C — FIX 5: AMBIL EMPLOYEE ID LOGIN LANGSUNG DARI PROFILES
   Masalah FIX 4:
   state.profile.employee_id kosong walaupun akun Sunarwan sudah benar.
   Fix ini tidak bergantung pada state.profile.employee_id.
   ================================================================ */
(function () {
  'use strict';

  async function getMyEmployeeId() {
    /* Ambil user login dari Supabase Auth. */
    const auth = await sb.auth.getUser();
    if (auth.error) throw auth.error;

    const user = auth.data && auth.data.user;
    if (!user) throw new Error('Sesi login tidak ditemukan. Silakan login ulang.');

    /* Ambil employee_id langsung dari public.profiles. */
    const p = await sb
      .from('profiles')
      .select('id,employee_id,full_name,role,is_active')
      .eq('id', user.id)
      .maybeSingle();

    if (p.error) throw p.error;

    if (!p.data) {
      throw new Error('Profil login tidak ditemukan di public.profiles.');
    }

    if (!p.data.employee_id) {
      throw new Error(
        'Akun ' + (p.data.full_name || user.email || 'ini') +
        ' belum memiliki employee_id di public.profiles.'
      );
    }

    return {
      userId: user.id,
      employeeId: p.data.employee_id,
      profile: p.data
    };
  }

  async function approveFromButton(btn) {
    const originalText = btn.textContent;

    try {
      btn.disabled = true;
      btn.textContent = 'Memproses...';

      const row = btn.closest('tr');
      if (!row) throw new Error('Baris pengajuan tidak ditemukan.');

      const firstCell = row.querySelector('td');
      const employeeNumber = firstCell
        ? ((firstCell.innerText || '').match(/\b\d{8,}\b/) || [null])[0]
        : null;

      if (!employeeNumber) {
        throw new Error('ID karyawan pada baris tidak ditemukan.');
      }

      /* Ambil ID employee milik akun Sunarwan dari PROFILES. */
      const me = await getMyEmployeeId();

      /* Ambil Abdul Rozak langsung dari DATABASE. */
      const employeeQuery = await sb
        .from('employees')
        .select('id,full_name,employee_number,supervisor_employee_id')
        .eq('employee_number', employeeNumber)
        .maybeSingle();

      if (employeeQuery.error) throw employeeQuery.error;

      const emp = employeeQuery.data;

      if (!emp) {
        throw new Error('Data karyawan tidak ditemukan: ' + employeeNumber);
      }

      /* Pastikan Abdul adalah bawahan langsung Sunarwan. */
      if (String(emp.supervisor_employee_id) !== String(me.employeeId)) {
        throw new Error(
          'Karyawan ' + (emp.full_name || employeeNumber) +
          ' bukan bawahan langsung akun yang sedang login.'
        );
      }

      /* Ambil pengajuan pending langsung dari DATABASE. */
      const requestQuery = await sb
        .from('leave_requests')
        .select('id,employee_id,status,supervisor_status,hr_status')
        .eq('employee_id', emp.id)
        .eq('status', 'pending')
        .order('created_at', { ascending: false })
        .limit(1);

      if (requestQuery.error) throw requestQuery.error;

      const request = requestQuery.data && requestQuery.data[0];

      if (!request) {
        throw new Error(
          'Pengajuan pending ' + (emp.full_name || employeeNumber) +
          ' tidak ditemukan.'
        );
      }

      if (!confirm('Setujui pengajuan ' + (emp.full_name || '') + '?')) {
        btn.disabled = false;
        btn.textContent = originalText;
        return;
      }

      const now = new Date().toISOString();

      /* Approval SPV. */
      const updateQuery = await sb
        .from('leave_requests')
        .update({
          supervisor_status: 'approved',
          supervisor_approved_at: now,
          supervisor_approved_by: me.userId,
          status: 'supervisor_approved',
          supervisor_note: null
        })
        .eq('id', request.id)
        .eq('status', 'pending')
        .select('id,status,supervisor_status,hr_status');

      if (updateQuery.error) throw updateQuery.error;

      if (!updateQuery.data || !updateQuery.data.length) {
        throw new Error(
          'Database tidak mengubah pengajuan. Policy RLS leave_requests masih menolak approval SPV.'
        );
      }

      /* Simpan histori approval. */
      const historyQuery = await sb
        .from('leave_approvals')
        .insert({
          leave_request_id: request.id,
          approver_profile_id: me.userId,
          approval_level: 'supervisor',
          decision: 'approved',
          note: null,
          decided_at: now
        });

      if (historyQuery.error) {
        console.error('Riwayat approval gagal:', historyQuery.error);
        toast(
          'Pengajuan sudah disetujui SPV, tetapi riwayat approval gagal disimpan.',
          'error'
        );
      } else {
        toast('Berhasil disetujui SPV. Pengajuan diteruskan ke HR.');
      }

      if (typeof loadAll === 'function') {
        await loadAll();
      }

      if (typeof ep6cRenderApproval === 'function') {
        await ep6cRenderApproval();
      } else {
        window.location.reload();
      }

    } catch (err) {
      console.error('FIX 5 Approval Tim:', err);
      toast(
        typeof friendlyError === 'function'
          ? friendlyError(err)
          : String(err.message || err),
        'error'
      );
      btn.disabled = false;
      btn.textContent = originalText;
    }
  }

  function bindApprovalButtons() {
    document.querySelectorAll('button').forEach(btn => {
      const text = (btn.textContent || '').trim().toLowerCase();

      if (text !== 'setujui' && text !== 'setujui spv') return;
      if (btn.dataset.fix5ApprovalBound === '1') return;

      btn.removeAttribute('onclick');
      btn.disabled = false;
      btn.dataset.fix5ApprovalBound = '1';

      btn.style.position = 'relative';
      btn.style.zIndex = '99999';
      btn.style.pointerEvents = 'auto';
      btn.style.cursor = 'pointer';

      btn.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();
        approveFromButton(btn);
      }, true);
    });
  }

  bindApprovalButtons();

  const observer = new MutationObserver(bindApprovalButtons);
  observer.observe(document.body, { childList: true, subtree: true });

  setInterval(bindApprovalButtons, 500);

  console.log(
    'PHASE 6C FIX 5 loaded — employee_id login diambil langsung dari profiles'
  );
})();
/* PHASE 6C — Approval Tim
   Tempelkan di PALING BAWAH app.js */

(function () {
  function me() {
    return state?.profile?.employee_id
      ? (state.employees || []).find(e => e.id === state.profile.employee_id)
      : null;
  }

  function team() {
    const m = me();
    return m ? (state.employees || []).filter(e =>
      e.employment_status !== 'inactive' &&
      e.supervisor_employee_id === m.id
    ) : [];
  }

  async function loadApproval() {
    const m = me(), t = team();
    if (!m || !t.length) return { team:t, requests:[] };

    const {data,error} = await sb.from('leave_requests')
      .select(`*, leave_types(name), employees!leave_requests_employee_id_fkey(
        id,employee_number,full_name,supervisor_employee_id)`)
      .in('employee_id', t.map(x=>x.id))
      .eq('status','pending')
      .order('created_at',{ascending:false});

    if (error) throw error;
    return {team:t,requests:data||[]};
  }

  async function renderApproval() {
    const root = document.querySelector('main') ||
                 document.querySelector('.content') ||
                 document.querySelector('.main-content') ||
                 document.body;

    root.innerHTML = `
      <div class="page-head">
        <div><h1>Approval Tim</h1>
        <div class="muted">Pengajuan cuti/izin anggota tim Anda.</div></div>
      </div>
      <div id="approvalTimBody"><div class="card empty">Memuat...</div></div>`;

    const body=document.getElementById('approvalTimBody');

    try {
      const {team,requests}=await loadApproval();

      if(!team.length){
        body.innerHTML=`<div class="card empty">
          Belum ada karyawan yang terhubung sebagai anggota tim Anda.
        </div>`;
        return;
      }

      if(!requests.length){
        body.innerHTML=`<div class="card empty">
          Tidak ada pengajuan yang sedang menunggu persetujuan Anda.
        </div>`;
        return;
      }

      body.innerHTML=`<div class="card"><div style="overflow:auto">
        <table class="table"><thead><tr>
          <th>Karyawan</th><th>Jenis</th><th>Periode</th><th>Hari</th><th>Aksi</th>
        </tr></thead><tbody>
        ${requests.map(r=>{
          const e=r.employees||{};
          const lt=r.leave_types||{};
          return `<tr>
            <td><b>${esc(e.full_name||'-')}</b>
              <div class="muted">${esc(e.employee_number||'')}</div></td>
            <td>${esc(lt.name||'-')}</td>
            <td>${fmtDate(r.start_date)} — ${fmtDate(r.end_date)}</td>
            <td>${r.total_days||p6Days(r.start_date,r.end_date)}</td>
            <td><div class="row-actions">
              <button class="btn btn-primary btn-sm"
                onclick="p6cDecision('${esc(r.id)}','approved')">Setujui</button>
              <button class="btn btn-light btn-sm"
                onclick="p6cDecision('${esc(r.id)}','rejected')">Tolak</button>
            </div></td>
          </tr>`;
        }).join('')}
        </tbody></table></div></div>`;
    } catch(e) {
      console.error(e);
      body.innerHTML=`<div class="card">
        <b>Gagal memuat Approval Tim</b>
        <div class="muted">${esc(friendlyError(e))}</div>
      </div>`;
    }
  }

  window.p6cDecision = async function(id,decision) {
    try {
      const m=me();
      if(!m){toast('Akun belum terhubung ke data karyawan.','error');return;}

      const {data:r,error}=await sb.from('leave_requests')
        .select(`*, employees!leave_requests_employee_id_fkey(
          id,employee_number,full_name,supervisor_employee_id)`)
        .eq('id',id).single();

      if(error){toast(friendlyError(error),'error');return;}

      const e=r.employees;
      if(!e || e.supervisor_employee_id!==m.id){
        toast('Anda bukan atasan langsung karyawan ini.','error');return;
      }

      if(r.status!=='pending'){
        toast('Pengajuan ini sudah diproses.','error');
        renderApproval(); return;
      }

      if(!confirm(
        `Anda yakin ingin ${decision==='approved'?'menyetujui':'menolak'} pengajuan ${e.full_name}?`
      )) return;

      const note=decision==='rejected'
        ? ((prompt('Alasan penolakan (opsional):')||'').trim()||null)
        : null;

      const now=new Date().toISOString();
      const payload=decision==='approved'
        ? {supervisor_status:'approved',status:'supervisor_approved',
           supervisor_approved_at:now,supervisor_approved_by:state.profile.id,
           supervisor_note:note}
        : {supervisor_status:'rejected',status:'rejected',
           supervisor_approved_at:now,supervisor_approved_by:state.profile.id,
           supervisor_note:note};

      const {data:updated,error:ue}=await sb.from('leave_requests')
        .update(payload).eq('id',id).eq('status','pending')
        .select('id,status,supervisor_status,hr_status');

      if(ue){toast(friendlyError(ue),'error');return;}
      if(!updated?.length){
        toast('Pengajuan tidak berubah. Periksa policy RLS.','error');return;
      }

      const {error:he}=await sb.from('leave_approvals').insert({
        leave_request_id:id,
        approval_level:'supervisor',
        approver_profile_id:state.profile.id,
        decision,
        note,
        decided_at:now
      });

      if(he){
        toast('Status berubah, tetapi riwayat approval gagal disimpan: '+friendlyError(he),'error');
      } else {
        toast(decision==='approved'
          ? 'Pengajuan disetujui SPV dan diteruskan ke HR.'
          : 'Pengajuan berhasil ditolak.');
      }

      await loadAll();
      renderApproval();
    } catch(e) {
      console.error(e);
      toast(friendlyError(e),'error');
    }
  };

  function addMenu() {
    if(!me() || !team().length) return;
    if([...document.querySelectorAll('a,button')].some(x=>
      (x.textContent||'').trim()==='Approval Tim')) return;

    const nav=document.querySelector('.sidebar .nav')||
              document.querySelector('.sidebar')||
              document.querySelector('aside');
    if(!nav) return;

    const a=document.createElement('a');
    a.href='#';
    a.className='nav-item';
    a.textContent='Approval Tim';
    a.onclick=e=>{e.preventDefault();renderApproval();};
    nav.appendChild(a);
  }

  const ob=new MutationObserver(addMenu);
  ob.observe(document.body,{childList:true,subtree:true});
  setTimeout(addMenu,500);
  setTimeout(addMenu,1500);
  setTimeout(addMenu,3000);
  window.p6cRenderApproval=renderApproval;
  console.log('Phase 6C Approval Tim loaded');
})();
/* PHASE 6C — FIX APPROVAL HR
   Tempelkan di PALING BAWAH app.js
*/

window.phase6cApproveHR = async function(requestId, decision) {
  try {
    const profile = state.profile;
    if (!profile) {
      toast('Profil pengguna tidak ditemukan.', 'error');
      return;
    }

    const role = String(profile.role || '').toLowerCase();
    const isHR = !Object.prototype.hasOwnProperty.call(profile, 'role')
      || ['admin', 'super_admin', 'hr', 'hr_admin'].includes(role);

    if (!isHR) {
      toast('Akun ini bukan akun HR.', 'error');
      return;
    }

    const { data: request, error: requestError } = await sb
      .from('leave_requests')
      .select('id,employee_id,status,supervisor_status,hr_status,start_date,end_date')
      .eq('id', requestId)
      .maybeSingle();

    if (requestError) {
      toast(friendlyError(requestError), 'error');
      return;
    }

    if (!request) {
      toast('Pengajuan cuti/izin tidak ditemukan.', 'error');
      return;
    }

    if (request.supervisor_status !== 'approved' || request.status !== 'supervisor_approved') {
      toast('Pengajuan belum disetujui SPV.', 'error');
      return;
    }

    if (request.hr_status === 'approved' || request.status === 'approved') {
      toast('Pengajuan ini sudah disetujui HR.', 'error');
      return;
    }

    const isApprove = decision === 'approved';
    const label = isApprove ? 'menyetujui' : 'menolak';

    if (!confirm(`Anda yakin ingin ${label} pengajuan cuti/izin ini?`)) return;

    let note = null;
    if (!isApprove) {
      note = (prompt('Catatan penolakan HR (opsional):') || '').trim() || null;
    }

    const now = new Date().toISOString();

    const updatePayload = isApprove
      ? {
          hr_status: 'approved',
          hr_approved_at: now,
          hr_approved_by: profile.id,
          status: 'approved',
          hr_note: note
        }
      : {
          hr_status: 'rejected',
          hr_approved_at: now,
          hr_approved_by: profile.id,
          status: 'rejected',
          hr_note: note
        };

    const { data: updated, error: updateError } = await sb
      .from('leave_requests')
      .update(updatePayload)
      .eq('id', requestId)
      .eq('status', 'supervisor_approved')
      .select('id,status,supervisor_status,hr_status')
      .maybeSingle();

    if (updateError) {
      toast(friendlyError(updateError), 'error');
      return;
    }

    if (!updated) {
      toast('Pengajuan tidak berubah. Pastikan status masih Disetujui SPV.', 'error');
      return;
    }

    const { error: historyError } = await sb
      .from('leave_approvals')
      .insert({
        leave_request_id: requestId,
        approval_level: 'hr',
        approver_profile_id: profile.id,
        decision: decision,
        note: note,
        decided_at: now
      });

    if (historyError) {
      console.error('leave_approvals HR:', historyError);
      toast(
        'Status pengajuan sudah berubah, tetapi riwayat approval HR gagal disimpan: ' +
        friendlyError(historyError),
        'error'
      );
    } else {
      toast(
        isApprove
          ? 'Pengajuan berhasil disetujui HR. Proses selesai.'
          : 'Pengajuan berhasil ditolak HR.'
      );
    }

    if (typeof p6RefreshLeaveData === 'function') {
      await p6RefreshLeaveData();
    } else if (typeof loadAll === 'function') {
      await loadAll();
    }

    if (typeof leave === 'function') leave();

  } catch (err) {
    console.error('phase6cApproveHR error:', err);
    toast(friendlyError(err), 'error');
  }
};

(function installPhase6cHRHandler() {
  const original = window.p6Approve;

  window.p6Approve = async function(id, level, decision) {
    if (String(level).toLowerCase() === 'hr') {
      return window.phase6cApproveHR(id, decision);
    }

    if (typeof original === 'function') {
      return original(id, level, decision);
    }

    toast('Handler approval SPV tidak ditemukan.', 'error');
  };

  console.log('Phase 6C Fix Approval HR aktif.');
})();

/* =========================================================
   PHASE 6D — GOOGLE CALENDAR / KALENDER KERJA
   ========================================================= */
let holidayCalendarYear = new Date().getFullYear();

function holidayCalendarStatusBadge(status) {
  if (status === 'success') return '<span class="badge badge-green">Berhasil</span>';
  if (status === 'error') return '<span class="badge badge-red">Gagal</span>';
  return '<span class="badge badge-yellow">Belum pernah sync</span>';
}

async function calendarWork() {
  const content = document.querySelector('#content');
  if (!content) return;
  const year = Number(holidayCalendarYear || new Date().getFullYear());

  content.innerHTML = `
    <div class="section">
      <div class="section-head">
        <div>
          <h2>Kalender Kerja & Hari Libur</h2>
          <div class="muted">Tanggal merah nasional diambil dari Google Calendar Indonesia.</div>
        </div>
        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <label class="muted">Tahun</label>
          <select id="holidayYear" style="min-width:110px">
            ${Array.from({length: 7}, (_,i) => new Date().getFullYear()-1+i)
              .map(y => `<option value="${y}" ${y===year?'selected':''}>${y}</option>`).join('')}
          </select>
          <button class="btn btn-primary" id="syncGoogleHolidayBtn">🔄 Sinkronkan Google</button>
        </div>
      </div>
      <div id="holidayCalendarMeta" class="card empty">Memuat status kalender...</div>
    </div>
    <div class="section">
      <div class="section-head">
        <h2>Hari Libur ${year}</h2>
        <span class="muted">Sumber: Google Calendar Indonesia</span>
      </div>
      <div id="holidayCalendarTable" class="card empty">Memuat data...</div>
    </div>
  `;

  $('#holidayYear').onchange = () => {
    holidayCalendarYear = Number($('#holidayYear').value);
    calendarWork();
  };

  $('#syncGoogleHolidayBtn').onclick = async () => {
    const btn = $('#syncGoogleHolidayBtn');
    const selectedYear = Number($('#holidayYear').value);
    btn.disabled = true;
    btn.textContent = '⏳ Sinkronisasi...';
    try {
      const { data, error } = await sb.functions.invoke('sync-google-holidays', {
        body: { year: selectedYear }
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Sinkronisasi gagal.');
      toast(`Google Calendar ${selectedYear} berhasil disinkronkan: ${data.inserted || 0} tanggal baru, ${data.updated || 0} diperbarui.`);
      await calendarWork();
    } catch (err) {
      console.error('sync-google-holidays:', err);
      toast(friendlyError(err), 'error');
      btn.disabled = false;
      btn.textContent = '🔄 Sinkronkan Google';
    }
  };

  try {
    const [sourceRes, holidayRes] = await Promise.all([
      sb.from('leave_holiday_sources')
        .select('source_name,calendar_id,is_active,last_synced_at,last_sync_year,last_sync_status,last_sync_message')
        .eq('calendar_id', 'en.indonesian#holiday@group.v.calendar.google.com')
        .maybeSingle(),
      sb.from('leave_holidays')
        .select('holiday_date,name,holiday_type,source,is_active,source_event_title')
        .eq('source', 'google')
        .gte('holiday_date', `${year}-01-01`)
        .lt('holiday_date', `${year + 1}-01-01`)
        .eq('is_active', true)
        .order('holiday_date')
    ]);
    if (sourceRes.error) throw sourceRes.error;
    if (holidayRes.error) throw holidayRes.error;

    const source = sourceRes.data;
    const rows = holidayRes.data || [];
    const lastSync = source?.last_synced_at
      ? new Date(source.last_synced_at).toLocaleString('id-ID') : '-';

    $('#holidayCalendarMeta').className = 'card';
    $('#holidayCalendarMeta').innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px">
        <div><div class="muted">Sumber</div><b>${esc(source?.source_name || 'Google Calendar Indonesia')}</b></div>
        <div><div class="muted">Status</div>${holidayCalendarStatusBadge(source?.last_sync_status)}</div>
        <div><div class="muted">Terakhir Sinkronisasi</div><b>${esc(lastSync)}</b></div>
        <div><div class="muted">Tahun Terakhir</div><b>${esc(source?.last_sync_year || '-')}</b></div>
      </div>
      ${source?.last_sync_message ? `<div class="muted" style="margin-top:12px">${esc(source.last_sync_message)}</div>` : ''}
    `;

    if (!rows.length) {
      $('#holidayCalendarTable').className = 'card empty';
      $('#holidayCalendarTable').innerHTML = `Belum ada tanggal merah Google untuk ${year}. Klik <b>Sinkronkan Google</b>.`;
    } else {
      $('#holidayCalendarTable').className = 'table-wrap';
      $('#holidayCalendarTable').innerHTML = `
        <table class="table">
          <thead><tr><th>No</th><th>Tanggal</th><th>Hari</th><th>Keterangan</th><th>Sumber</th></tr></thead>
          <tbody>
            ${rows.map((r,i) => {
              const d = new Date(`${r.holiday_date}T00:00:00`);
              const day = d.toLocaleDateString('id-ID', { weekday: 'long' });
              return `<tr><td>${i+1}</td><td><b>${fmtDate(r.holiday_date)}</b></td><td>${esc(day)}</td><td>${esc(r.name || r.source_event_title || '-')}</td><td><span class="badge badge-green">Google</span></td></tr>`;
            }).join('')}
          </tbody>
        </table>
      `;
    }
  } catch (err) {
    console.error('calendarWork:', err);
    $('#holidayCalendarMeta').className = 'card';
    $('#holidayCalendarMeta').innerHTML = `<div class="error">${esc(friendlyError(err))}</div>`;
    $('#holidayCalendarTable').className = 'card empty';
    $('#holidayCalendarTable').textContent = 'Data kalender belum dapat dimuat.';
  }
}

/* ============================================================
   PHASE 6C — FINAL FIX APPROVE HR (DIRECT CLICK INTERCEPTOR)
   Bypass handler lama yang masih menampilkan:
   "Approval HR menggunakan alur HR."
   Tempelkan di PALING BAWAH app.js
   ============================================================ */

window.phase6cFinalApproveHR = async function(requestId, decision) {
  try {
    const profile = state.profile;
    if (!profile) {
      toast('Profil pengguna tidak ditemukan.', 'error');
      return;
    }

    const role = String(profile.role || '').toLowerCase();
    const isHR = ['admin', 'super_admin', 'hr', 'hr_admin'].includes(role);

    if (!isHR) {
      toast('Akun ini bukan akun HR.', 'error');
      return;
    }

    const { data: request, error } = await sb
      .from('leave_requests')
      .select('id,status,supervisor_status,hr_status')
      .eq('id', requestId)
      .maybeSingle();

    if (error) {
      toast(friendlyError(error), 'error');
      return;
    }

    if (!request) {
      toast('Pengajuan tidak ditemukan.', 'error');
      return;
    }

    if (request.supervisor_status !== 'approved' ||
        request.status !== 'supervisor_approved') {
      toast('Pengajuan belum disetujui SPV.', 'error');
      return;
    }

    if (request.hr_status === 'approved' || request.status === 'approved') {
      toast('Pengajuan ini sudah disetujui HR.', 'error');
      return;
    }

    const isApprove = decision === 'approved';

    if (!confirm(
      isApprove
        ? 'Anda yakin ingin menyetujui pengajuan ini sebagai HR?'
        : 'Anda yakin ingin menolak pengajuan ini sebagai HR?'
    )) return;

    let note = null;

    if (!isApprove) {
      note = (prompt('Catatan penolakan HR (opsional):') || '').trim() || null;
    }

    const now = new Date().toISOString();

    const payload = isApprove
      ? {
          hr_status: 'approved',
          hr_approved_at: now,
          hr_approved_by: profile.id,
          status: 'approved',
          hr_note: note
        }
      : {
          hr_status: 'rejected',
          hr_approved_at: now,
          hr_approved_by: profile.id,
          status: 'rejected',
          hr_note: note
        };

    const { data: updated, error: updateError } = await sb
      .from('leave_requests')
      .update(payload)
      .eq('id', requestId)
      .eq('status', 'supervisor_approved')
      .select('id,status,supervisor_status,hr_status')
      .maybeSingle();

    if (updateError) {
      toast(friendlyError(updateError), 'error');
      return;
    }

    if (!updated) {
      toast('Pengajuan tidak berubah. Status harus Disetujui SPV.', 'error');
      return;
    }

    const { error: historyError } = await sb
      .from('leave_approvals')
      .insert({
        leave_request_id: requestId,
        approval_level: 'hr',
        approver_profile_id: profile.id,
        decision: decision,
        note: note,
        decided_at: now
      });

    if (historyError) {
      console.error('HR approval history:', historyError);
      toast(
        'Status berhasil berubah, tetapi riwayat approval HR gagal disimpan: ' +
        friendlyError(historyError),
        'error'
      );
    } else {
      toast(
        isApprove
          ? 'Pengajuan berhasil disetujui HR.'
          : 'Pengajuan berhasil ditolak HR.'
      );
    }

    if (typeof p6RefreshLeaveData === 'function') {
      await p6RefreshLeaveData();
    } else if (typeof loadAll === 'function') {
      await loadAll();
    }

    if (typeof leave === 'function') {
      leave();
    }

  } catch (err) {
    console.error('Final Approve HR error:', err);
    toast(friendlyError(err), 'error');
  }
};


/* ============================================================
   INTERCEPTOR
   Menangkap klik tombol "Approve HR" SEBELUM onclick lama.
   Jadi handler lama tidak lagi dijalankan.
   ============================================================ */

(function installFinalApproveHRInterceptor() {
  if (window.__phase6cFinalHRInstalled) return;
  window.__phase6cFinalHRInstalled = true;

  document.addEventListener('click', function(event) {
    const button = event.target.closest('button');

    if (!button) return;

    const text = String(button.textContent || '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

    if (text !== 'approve hr') return;

    const onclick = button.getAttribute('onclick') || '';

    /* Ambil UUID request dari:
       p6Approve('UUID','hr','approved')
    */
    const match = onclick.match(
      /p6Approve\(\s*['"]([^'"]+)['"]\s*,\s*['"]hr['"]\s*,\s*['"]([^'"]+)['"]\s*\)/
    );

    if (!match) {
      toast('ID pengajuan HR tidak ditemukan pada tombol.', 'error');
      return;
    }

    const requestId = match[1];
    const decision = match[2];

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    window.phase6cFinalApproveHR(requestId, decision);

  }, true);

  console.log('Phase 6C FINAL APPROVE HR interceptor aktif.');
})();



/* ============================================================
   PHASE 7 — PROFIL KARYAWAN / SELF SERVICE
   Karyawan mengisi data pribadi sendiri melalui Portal Karyawan.
   Data master HR (ID, nama, perusahaan, jabatan, departemen,
   tanggal masuk, status kerja) tetap dikelola HR.
   ============================================================ */

async function phase7GetProfile() {
  return await empRpc('employee_profile_get');
}

async function phase7SaveProfile(data) {
  return await empRpc('employee_profile_save', { p_data: data });
}

async function phase7SubmitProfile() {
  return await empRpc('employee_profile_submit');
}

function phase7Val(p, k) {
  return esc(p?.[k] ?? '');
}

function phase7ProfileStatus(status) {
  const map = {
    draft: ['Belum selesai', 'badge-gray'],
    submitted: ['Menunggu Verifikasi HR', 'badge-yellow'],
    needs_revision: ['Perlu Perbaikan', 'badge-red'],
    verified: ['Terverifikasi HR', 'badge-green']
  };
  const x = map[status] || [status || 'Belum diisi', 'badge-gray'];
  return `<span class="badge ${x[1]}">${esc(x[0])}</span>`;
}

function phase7ProfileProgress(p) {
  const fields = [
    'nickname','gender','birth_place','birth_date','religion','marital_status',
    'blood_type','citizenship','nik','kk_number','ktp_address','domicile_address',
    'village','district','city','province','postal_code','emergency_name',
    'emergency_relation','emergency_phone','education_level','major','school_name',
    'shirt_size','pants_size','shoe_size'
  ];
  const done = fields.filter(k => String(p?.[k] ?? '').trim()).length;
  return Math.round(done / fields.length * 100);
}

function phase7Input(name, label, value, type='text', placeholder='') {
  return `<div class="field"><label>${label}</label><input name="${name}" type="${type}" value="${phase7Val(value,name)}" placeholder="${esc(placeholder)}"></div>`;
}

function phase7Select(name, label, value, id, placeholder='Pilih...') {
  const current = phase7Val(value, name);
  return `<div class="field"><label>${label}</label><select name="${name}" id="${id}" data-current="${current}"><option value="">${placeholder}</option></select></div>`;
}

function phase7StaticSelect(name, label, value, options, placeholder='Pilih...') {
  const current = String(phase7Val(value, name) || '').trim();
  const html = [`<option value="">${esc(placeholder)}</option>`];
  for (const item of options) {
    const val = String(item?.value ?? item ?? '');
    const text = String(item?.label ?? item ?? '');
    if (!val) continue;
    const selected = val.toLowerCase() === current.toLowerCase() ? ' selected' : '';
    html.push(`<option value="${esc(val)}"${selected}>${esc(text)}</option>`);
  }
  return `<div class="field"><label>${label}</label><select name="${name}">${html.join('')}</select></div>`;
}

const PHASE7_GENDER_OPTIONS = ['Laki-laki','Perempuan'];
const PHASE7_RELIGION_OPTIONS = ['Islam','Kristen Protestan','Katolik','Hindu','Buddha','Konghucu'];
const PHASE7_MARITAL_OPTIONS = ['Belum Menikah','Menikah','Cerai Hidup','Cerai Mati'];
const PHASE7_BLOOD_OPTIONS = ['A','B','AB','O','Tidak Tahu'];
const PHASE7_CITIZENSHIP_OPTIONS = ['WNI','WNA'];
const PHASE7_EDUCATION_OPTIONS = ['SD','SMP','SMA','SMK','D1','D2','D3','D4','S1','S2','S3'];
const PHASE7_SHIRT_OPTIONS = ['XS','S','M','L','XL','XXL','XXXL','4XL','5XL'];
const PHASE7_PANTS_OPTIONS = Array.from({length: 13}, (_,i) => String(28 + i * 2));
const PHASE7_SHOE_OPTIONS = Array.from({length: 14}, (_,i) => String(35 + i));
const PHASE7_EMERGENCY_RELATION_OPTIONS = ['Suami','Istri','Ayah','Ibu','Anak','Kakak','Adik','Saudara','Wali','Lainnya'];

function phase7Textarea(name, label, value, full=true) {
  return `<div class="field ${full ? 'field-full' : ''}"><label>${label}</label><textarea name="${name}" rows="3">${phase7Val(value,name)}</textarea></div>`;
}

/* ============================================================
   PHASE 7 — WILAYAH INDONESIA OTOMATIS
   Provinsi -> Kota/Kabupaten -> Kecamatan -> Kelurahan/Desa
   Kode Pos mengikuti Kelurahan/Desa yang dipilih.
   Data diambil bertingkat agar browser tidak memuat seluruh
   puluhan ribu desa sekaligus.
   ============================================================ */
const PHASE7_REGION_API = 'https://www.emsifa.com/api-wilayah-indonesia/v2';

async function phase7RegionFetch(path) {
  const res = await fetch(`${PHASE7_REGION_API}/${path}`, {
    headers: { 'Accept': 'application/json' }
  });
  if (!res.ok) throw new Error(`Gagal memuat data wilayah (${res.status}).`);
  const json = await res.json();
  return json?.data ?? json;
}

function phase7RegionSetOptions(select, items, selectedName='', placeholder='Pilih...') {
  if (!select) return;
  const selected = String(selectedName || '').trim().toLowerCase();
  const options = [`<option value="">${placeholder}</option>`];
  for (const item of (items || [])) {
    const id = String(item?.id ?? '');
    const name = String(item?.name ?? '');
    if (!id || !name) continue;
    const isSelected = name.trim().toLowerCase() === selected ? ' selected' : '';
    const postal = item?.postal_code ? ` data-postal-code="${esc(item.postal_code)}"` : '';
    options.push(`<option value="${esc(id)}" data-name="${esc(name)}"${postal}${isSelected}>${esc(name)}</option>`);
  }
  select.innerHTML = options.join('');
  select.disabled = false;
}

function phase7RegionSetLoading(select, text='Memuat...') {
  if (!select) return;
  select.innerHTML = `<option value="">${text}</option>`;
  select.disabled = true;
}

function phase7RegionSelectedName(select) {
  return select?.selectedOptions?.[0]?.dataset?.name || '';
}

async function phase7InitRegions(p, locked=false) {
  const province = document.getElementById('phase7Province');
  const city = document.getElementById('phase7City');
  const district = document.getElementById('phase7District');
  const village = document.getElementById('phase7Village');
  const postal = document.getElementById('phase7PostalCode');
  if (!province || !city || !district || !village || !postal) return;

  const savedProvince = String(p?.province || '');
  const savedCity = String(p?.city || '');
  const savedDistrict = String(p?.district || '');
  const savedVillage = String(p?.village || '');
  const savedPostal = String(p?.postal_code || '');

  try {
    phase7RegionSetLoading(province);
    phase7RegionSetLoading(city);
    phase7RegionSetLoading(district);
    phase7RegionSetLoading(village);

    const provinces = await phase7RegionFetch('provinces.json');
    phase7RegionSetOptions(province, provinces, savedProvince, 'Pilih Provinsi');

    const findByName = (items, name) => (items || []).find(x =>
      String(x?.name || '').trim().toLowerCase() === String(name || '').trim().toLowerCase()
    );

    const loadVillages = async (keepValue=true) => {
      const districtId = district.value;
      phase7RegionSetLoading(village);
      postal.value = '';
      if (!districtId) {
        phase7RegionSetOptions(village, [], '', 'Pilih Kelurahan / Desa');
        return;
      }
      const villages = await phase7RegionFetch(`villages/${encodeURIComponent(districtId)}.json`);
      phase7RegionSetOptions(village, villages, keepValue ? savedVillage : '', 'Pilih Kelurahan / Desa');
      const selectedVillage = findByName(villages, keepValue ? savedVillage : '');
      postal.value = selectedVillage?.postal_code || '';
    };

    const loadDistricts = async (keepValue=true) => {
      const regencyId = city.value;
      phase7RegionSetLoading(district);
      phase7RegionSetLoading(village);
      postal.value = '';
      if (!regencyId) {
        phase7RegionSetOptions(district, [], '', 'Pilih Kecamatan');
        return;
      }
      const districts = await phase7RegionFetch(`districts/${encodeURIComponent(regencyId)}.json`);
      phase7RegionSetOptions(district, districts, keepValue ? savedDistrict : '', 'Pilih Kecamatan');
      await loadVillages(keepValue);
    };

    const loadRegencies = async (keepValue=true) => {
      const provinceId = province.value;
      phase7RegionSetLoading(city);
      phase7RegionSetLoading(district);
      phase7RegionSetLoading(village);
      postal.value = '';
      if (!provinceId) {
        phase7RegionSetOptions(city, [], '', 'Pilih Kota / Kabupaten');
        return;
      }
      const regencies = await phase7RegionFetch(`regencies/${encodeURIComponent(provinceId)}.json`);
      phase7RegionSetOptions(city, regencies, keepValue ? savedCity : '', 'Pilih Kota / Kabupaten');
      await loadDistricts(keepValue);
    };

    province.onchange = async () => {
      try { await loadRegencies(false); }
      catch (err) { toast(friendlyError(err), 'error'); }
    };
    city.onchange = async () => {
      try { await loadDistricts(false); }
      catch (err) { toast(friendlyError(err), 'error'); }
    };
    district.onchange = async () => {
      try { await loadVillages(false); }
      catch (err) { toast(friendlyError(err), 'error'); }
    };
    village.onchange = () => {
      const opt = village.selectedOptions?.[0];
      postal.value = opt?.dataset?.postalCode || '';
    };

    const savedProvinceItem = findByName(provinces, savedProvince);
    if (savedProvinceItem) {
      province.value = String(savedProvinceItem.id);
      await loadRegencies(true);
      const selectedVillage = village.selectedOptions?.[0];
      if (selectedVillage?.dataset?.postalCode) postal.value = selectedVillage.dataset.postalCode;
      else if (savedPostal) postal.value = savedPostal;
    } else {
      phase7RegionSetOptions(city, [], '', 'Pilih Kota / Kabupaten');
      phase7RegionSetOptions(district, [], '', 'Pilih Kecamatan');
      phase7RegionSetOptions(village, [], '', 'Pilih Kelurahan / Desa');
      postal.value = savedPostal;
    }

    province.disabled = locked;
    city.disabled = locked;
    district.disabled = locked;
    village.disabled = locked;
    postal.readOnly = true;
  } catch (err) {
    console.error('Phase 7 region loader:', err);
    toast('Data wilayah belum dapat dimuat. Silakan coba lagi.', 'error');
  }
}

async function phase7RenderProfile() {
  const box = $('#epContent');
  if (!box) return;

  box.innerHTML = '<div class="card empty">Memuat Profil Saya...</div>';

  try {
    const data = await phase7GetProfile();
    const p = data?.profile || {};
    const e = data?.employee || empPortal.employee || {};
    const status = p.status || 'draft';
    const locked = status === 'submitted' || status === 'verified';
    const progress = phase7ProfileProgress(p);

    box.innerHTML = `
      <div class="section">
        <div class="section-head">
          <div>
            <h2>Profil Saya</h2>
            <div class="muted">Lengkapi data pribadi Anda. Data master perusahaan tetap dikelola HR.</div>
          </div>
          ${phase7ProfileStatus(status)}
        </div>

        <div class="cards" style="margin-bottom:14px">
          <div class="card">
            <div class="muted">Karyawan</div>
            <div class="metric" style="font-size:20px">${esc(e.full_name || '-')}</div>
            <div class="muted">ID ${esc(e.employee_number || '-')}</div>
          </div>
          <div class="card">
            <div class="muted">Kelengkapan Data Pribadi</div>
            <div class="metric">${progress}%</div>
          </div>
          <div class="card">
            <div class="muted">Status HR</div>
            <div style="margin-top:8px">${phase7ProfileStatus(status)}</div>
          </div>
        </div>

        ${status === 'needs_revision' && p.hr_note ? `<div class="info-box"><b>Catatan HR:</b><br>${esc(p.hr_note)}</div>` : ''}
        ${status === 'submitted' ? `<div class="info-box">Data sudah dikirim ke HR. Sementara menunggu verifikasi, data tidak dapat diedit.</div>` : ''}
        ${status === 'verified' ? `<div class="info-box">Profil sudah diverifikasi HR. Jika ada perubahan data, hubungi HR untuk membuka kembali profil.</div>` : ''}

        <form id="phase7ProfileForm" class="modal-grid" style="margin-top:14px">
          <div class="field field-full"><div class="sub-title">Data Pribadi</div></div>
          ${phase7Input('nickname','Nama Panggilan',p)}
          ${phase7StaticSelect('gender','Jenis Kelamin',p,PHASE7_GENDER_OPTIONS)}
          ${phase7Input('birth_place','Tempat Lahir',p)}
          ${phase7Input('birth_date','Tanggal Lahir',p,'date')}
          ${phase7StaticSelect('religion','Agama',p,PHASE7_RELIGION_OPTIONS)}
          ${phase7StaticSelect('marital_status','Status Perkawinan',p,PHASE7_MARITAL_OPTIONS)}
          ${phase7StaticSelect('blood_type','Golongan Darah',p,PHASE7_BLOOD_OPTIONS)}
          ${phase7StaticSelect('citizenship','Kewarganegaraan',p,PHASE7_CITIZENSHIP_OPTIONS)}
          ${phase7Input('personal_phone','No. HP Pribadi',p,'tel')}
          ${phase7Input('personal_email','Email Pribadi',p,'email')}

          <div class="field field-full"><div class="sub-title">Identitas</div></div>
          ${phase7Input('nik','No. KTP / NIK',p)}
          ${phase7Input('kk_number','No. KK',p)}
          ${phase7Input('npwp','NPWP',p)}
          <div class="field field-full"><div class="sub-title">Alamat</div></div>
          ${phase7Textarea('ktp_address','Alamat KTP',p)}
          ${phase7Textarea('domicile_address','Alamat Domisili',p)}
          ${phase7Select('province','Provinsi',p,'phase7Province','Pilih Provinsi')}
          ${phase7Select('city','Kota / Kabupaten',p,'phase7City','Pilih Kota / Kabupaten')}
          ${phase7Select('district','Kecamatan',p,'phase7District','Pilih Kecamatan')}
          ${phase7Select('village','Kelurahan / Desa',p,'phase7Village','Pilih Kelurahan / Desa')}
          ${phase7Input('postal_code','Kode Pos',p,'text','Otomatis dari Kelurahan / Desa')}

          <div class="field field-full"><div class="sub-title">Kontak Darurat</div></div>
          ${phase7Input('emergency_name','Nama Kontak Darurat',p)}
          ${phase7StaticSelect('emergency_relation','Hubungan',p,PHASE7_EMERGENCY_RELATION_OPTIONS)}
          ${phase7Input('emergency_phone','No. HP Kontak Darurat',p,'tel')}

          <div class="field field-full"><div class="sub-title">Pendidikan</div></div>
          ${phase7StaticSelect('education_level','Pendidikan Terakhir',p,PHASE7_EDUCATION_OPTIONS)}
          ${phase7Input('major','Jurusan',p)}
          ${phase7Input('school_name','Nama Sekolah / Universitas',p)}

          <div class="field field-full"><div class="sub-title">Ukuran Seragam</div></div>
          ${phase7StaticSelect('shirt_size','Ukuran Baju',p,PHASE7_SHIRT_OPTIONS)}
          ${phase7StaticSelect('pants_size','Ukuran Celana',p,PHASE7_PANTS_OPTIONS)}
          ${phase7StaticSelect('shoe_size','Ukuran Sepatu',p,PHASE7_SHOE_OPTIONS)}

          <div class="field field-full"><div class="sub-title">Data Pembayaran</div><div class="muted">Data rekening dapat diisi bila diperlukan oleh perusahaan.</div></div>
          ${phase7Input('bank_name','Bank',p)}
          ${phase7Input('bank_account','Nomor Rekening',p)}
          ${phase7Input('bank_account_name','Nama Pemilik Rekening',p)}

          <div class="field field-full" style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:8px">
            <button type="button" class="btn btn-light" id="phase7SaveBtn" ${locked ? 'disabled' : ''}>Simpan Draft</button>
            <button type="button" class="btn btn-primary" id="phase7SubmitBtn" ${locked ? 'disabled' : ''}>Kirim ke HR untuk Verifikasi</button>
          </div>
        </form>
      </div>
    `;

    const form = $('#phase7ProfileForm');
    const postalInput = form.querySelector('[name="postal_code"]');
    if (postalInput) postalInput.id = 'phase7PostalCode';
    await phase7InitRegions(p, locked);

    /* Dropdown menyimpan nama wilayah agar kompatibel dengan schema Phase 7 saat ini. */
    const collect = () => {
      const fd = new FormData(form);
      const out = {};
      for (const [k,v] of fd.entries()) out[k] = String(v || '').trim() || null;
      out.province = phase7RegionSelectedName(document.getElementById('phase7Province')) || out.province || null;
      out.city = phase7RegionSelectedName(document.getElementById('phase7City')) || out.city || null;
      out.district = phase7RegionSelectedName(document.getElementById('phase7District')) || out.district || null;
      out.village = phase7RegionSelectedName(document.getElementById('phase7Village')) || out.village || null;
      out.postal_code = String(document.getElementById('phase7PostalCode')?.value || out.postal_code || '').trim() || null;
      return out;
    };

    $('#phase7SaveBtn')?.addEventListener('click', async () => {
      const btn = $('#phase7SaveBtn');
      btn.disabled = true;
      try {
        await phase7SaveProfile(collect());
        toast('Profil berhasil disimpan sebagai draft.');
        await phase7RenderProfile();
      } catch (err) {
        toast(friendlyError(err), 'error');
        btn.disabled = false;
      }
    });

    $('#phase7SubmitBtn')?.addEventListener('click', async () => {
      if (!confirm('Kirim profil ke HR untuk diverifikasi? Setelah dikirim, data tidak dapat diedit sampai HR memberikan hasil verifikasi.')) return;
      const btn = $('#phase7SubmitBtn');
      btn.disabled = true;
      try {
        await phase7SaveProfile(collect());
        await phase7SubmitProfile();
        toast('Profil berhasil dikirim ke HR untuk verifikasi.');
        await phase7RenderProfile();
      } catch (err) {
        toast(friendlyError(err), 'error');
        btn.disabled = false;
      }
    });
  } catch (err) {
    box.innerHTML = `<div class="card"><div class="error">${esc(friendlyError(err))}</div></div>`;
  }
}

async function phase7HomeStatus() {
  const box = $('#epContent');
  if (!box) return;
  try {
    const data = await phase7GetProfile();
    const p = data?.profile || {};
    const status = p.status || 'draft';
    const progress = phase7ProfileProgress(p);
    const card = document.createElement('div');
    card.className = 'section';
    card.id = 'phase7HomeCard';
    card.innerHTML = `
      <div class="section-head">
        <div>
          <h2>Profil Saya</h2>
          <div class="muted">Lengkapi data pribadi Anda sendiri.</div>
        </div>
        ${phase7ProfileStatus(status)}
      </div>
      <div class="cards">
        <div class="card"><div class="muted">Kelengkapan</div><div class="metric">${progress}%</div></div>
        <div class="card"><div class="muted">Status</div><div style="margin-top:8px">${phase7ProfileStatus(status)}</div></div>
        <div class="card"><button class="btn btn-primary" onclick="employeePortalView('profile')">Buka Profil Saya</button></div>
      </div>
    `;
    box.appendChild(card);
  } catch (err) {
    console.error('Phase 7 profile home:', err);
  }
}

/* ---------- Portal navigation wrapper ---------- */
const __phase7OriginalEmployeePortalView = employeePortalView;
employeePortalView = async function(view) {
  if (view === 'profile') return phase7RenderProfile();
  await __phase7OriginalEmployeePortalView(view);
  if (view === 'home') await phase7HomeStatus();
};

const __phase7OriginalRenderEmployeePortal = renderEmployeePortal;
renderEmployeePortal = async function() {
  await __phase7OriginalRenderEmployeePortal();
  const nav = document.querySelector('.sidebar .nav');
  if (nav && !document.getElementById('phase7ProfileNav')) {
    const b = document.createElement('button');
    b.id = 'phase7ProfileNav';
    b.type = 'button';
    b.textContent = 'Profil Saya';
    b.addEventListener('click', () => employeePortalView('profile'));
    const leave = [...nav.querySelectorAll('button')].find(x => /Cuti/i.test(x.textContent || ''));
    if (leave) nav.insertBefore(b, leave);
    else nav.appendChild(b);
  }
};

/* ============================================================
   PHASE 7 HR — VERIFIKASI PROFIL KARYAWAN
   ============================================================ */

function phase7AdminStatus(status) {
  const map = {
    draft: ['Draft', 'badge-gray'],
    submitted: ['Menunggu HR', 'badge-yellow'],
    needs_revision: ['Perlu Perbaikan', 'badge-red'],
    verified: ['Terverifikasi', 'badge-green']
  };
  const x = map[status] || [status || '-', 'badge-gray'];
  return `<span class="badge ${x[1]}">${esc(x[0])}</span>`;
}

async function phase7AdminProfileDetail(id) {
  const { data, error } = await sb.from('employee_self_profiles')
    .select('*, employees(full_name,employee_number,company_id,department_id,position_id,join_date)')
    .eq('employee_id', id)
    .single();
  if (error) { toast(friendlyError(error), 'error'); return; }

  const p = data;
  const rows = [
    ['Nama Panggilan', p.nickname],
    ['Jenis Kelamin', p.gender],
    ['Tempat / Tanggal Lahir', [p.birth_place, fmtDate(p.birth_date)].filter(Boolean).join(' / ')],
    ['Agama', p.religion],
    ['Status Perkawinan', p.marital_status],
    ['Golongan Darah', p.blood_type],
    ['Kewarganegaraan', p.citizenship],
    ['No. HP Pribadi', p.personal_phone],
    ['Email Pribadi', p.personal_email],
    ['NIK', p.nik],
    ['No. KK', p.kk_number],
    ['NPWP', p.npwp],
    ['Alamat KTP', p.ktp_address],
    ['Alamat Domisili', p.domicile_address],
    ['Kelurahan', p.village],
    ['Kecamatan', p.district],
    ['Kota/Kabupaten', p.city],
    ['Provinsi', p.province],
    ['Kode Pos', p.postal_code],
    ['Kontak Darurat', [p.emergency_name,p.emergency_relation,p.emergency_phone].filter(Boolean).join(' — ')],
    ['Pendidikan', [p.education_level,p.major,p.school_name].filter(Boolean).join(' — ')],
    ['Ukuran', [p.shirt_size,p.pants_size,p.shoe_size].filter(Boolean).join(' / ')],
    ['Bank', p.bank_name],
    ['No. Rekening', p.bank_account],
    ['Nama Pemilik Rekening', p.bank_account_name]
  ];

  const body = `
    <div class="info-box">
      <b>${esc(p.employees?.full_name || '-')}</b> — ${esc(p.employees?.employee_number || '-')}<br>
      Status: ${phase7AdminStatus(p.status)}
      ${p.submitted_at ? `<br><span class="muted">Dikirim: ${esc(fmtDateTime(p.submitted_at))}</span>` : ''}
    </div>
    <div class="detail-grid">
      ${rows.map(([k,v]) => `<div class="detail-item"><div class="muted">${esc(k)}</div><div>${esc(v || '-')}</div></div>`).join('')}
    </div>
    ${p.hr_note ? `<div class="info-box" style="margin-top:12px"><b>Catatan HR:</b><br>${esc(p.hr_note)}</div>` : ''}
  `;

  const modal = openModal(
    'Detail Profil Karyawan',
    body,
    async () => true,
    'Tutup'
  );

  const submit = modal.querySelector('button[type="submit"]');
  if (submit) {
    submit.style.display = 'none';
    const actions = modal.querySelector('.modal-actions');
    if (actions) {
      const approve = document.createElement('button');
      approve.type = 'button';
      approve.className = 'btn btn-primary';
      approve.textContent = 'Verifikasi';
      approve.disabled = p.status === 'verified';
      approve.onclick = () => phase7AdminVerify(id, 'verified', modal);
      const revise = document.createElement('button');
      revise.type = 'button';
      revise.className = 'btn btn-light';
      revise.textContent = 'Minta Perbaikan';
      revise.disabled = p.status === 'verified';
      revise.onclick = () => phase7AdminVerify(id, 'needs_revision', modal);
      actions.insertBefore(revise, actions.firstChild);
      actions.insertBefore(approve, actions.firstChild);
    }
  }
}

async function phase7AdminVerify(employeeId, status, modal) {
  let note = null;
  if (status === 'needs_revision') {
    note = (prompt('Catatan perbaikan untuk karyawan (opsional):') || '').trim() || null;
  } else if (!confirm('Tandai profil ini sebagai sudah diverifikasi HR?')) {
    return;
  }

  try {
    const { data, error } = await sb.rpc('employee_profile_verify_self', {
      p_employee_id: employeeId,
      p_status: status,
      p_note: note
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.message || 'Verifikasi gagal.');
    toast(status === 'verified' ? 'Profil berhasil diverifikasi HR.' : 'Profil dikembalikan ke karyawan untuk diperbaiki.');
    modal?.remove();
    await phase7AdminProfiles();
  } catch (err) {
    toast(friendlyError(err), 'error');
  }
}

async function phase7AdminProfiles() {
  const content = $('#content');
  if (!content) return;
  content.innerHTML = `
    <div class="section">
      <div class="section-head">
        <div><h2>Profil Karyawan</h2><div class="muted">Data pribadi yang diisi sendiri oleh karyawan dan menunggu verifikasi HR.</div></div>
        <button class="btn btn-light" id="phase7AdminRefresh">Refresh</button>
      </div>
      <div class="cards">
        <div class="card"><div class="muted">Menunggu HR</div><div class="metric" id="phase7PendingCount">...</div></div>
        <div class="card"><div class="muted">Perlu Perbaikan</div><div class="metric" id="phase7RevisionCount">...</div></div>
        <div class="card"><div class="muted">Terverifikasi</div><div class="metric" id="phase7VerifiedCount">...</div></div>
      </div>
    </div>
    <div class="section">
      <div id="phase7AdminBody" class="card empty">Memuat...</div>
    </div>
  `;

  $('#phase7AdminRefresh').onclick = phase7AdminProfiles;

  try {
    const { data, error } = await sb.from('employee_self_profiles')
      .select('employee_id,status,submitted_at,updated_at,employees(full_name,employee_number,companies(name),departments(name),positions(name))')
      .order('updated_at', { ascending: false });
    if (error) throw error;

    const rows = data || [];
    $('#phase7PendingCount').textContent = rows.filter(x => x.status === 'submitted').length;
    $('#phase7RevisionCount').textContent = rows.filter(x => x.status === 'needs_revision').length;
    $('#phase7VerifiedCount').textContent = rows.filter(x => x.status === 'verified').length;

    $('#phase7AdminBody').className = 'table-wrap';
    $('#phase7AdminBody').innerHTML = rows.length ? `
      <table class="table">
        <thead><tr><th>Karyawan</th><th>Perusahaan</th><th>Status</th><th>Dikirim</th><th>Aksi</th></tr></thead>
        <tbody>
          ${rows.map(r => `<tr>
            <td><b>${esc(r.employees?.full_name || '-')}</b><div class="muted">${esc(r.employees?.employee_number || '-')}</div></td>
            <td>${esc(r.employees?.companies?.name || '-')}</td>
            <td>${phase7AdminStatus(r.status)}</td>
            <td>${r.submitted_at ? fmtDateTime(r.submitted_at) : '-'}</td>
            <td><button class="btn btn-light btn-sm" onclick="phase7AdminProfileDetail('${esc(r.employee_id)}')">Detail / Verifikasi</button></td>
          </tr>`).join('')}
        </tbody>
      </table>
    ` : '<div class="card empty">Belum ada profil yang dibuat karyawan.</div>';
  } catch (err) {
    $('#phase7AdminBody').className = 'card';
    $('#phase7AdminBody').innerHTML = `<div class="error">${esc(friendlyError(err))}</div>`;
  }
}

const __phase7OriginalTitle = title;
title = function() {
  if (state.view === 'employee_profiles') return 'Profil Karyawan';
  return __phase7OriginalTitle();
};

const __phase7OriginalRenderView = renderView;
renderView = function() {
  if (state.view === 'employee_profiles') return phase7AdminProfiles();
  return __phase7OriginalRenderView();
};

const __phase7OriginalRenderApp = renderApp;
renderApp = function() {
  __phase7OriginalRenderApp();
  const nav = document.querySelector('.sidebar .nav');
  if (!nav || document.getElementById('phase7AdminNav')) return;
  const b = document.createElement('button');
  b.id = 'phase7AdminNav';
  b.type = 'button';
  b.textContent = 'Profil Karyawan';
  b.dataset.view = 'employee_profiles';
  b.className = state.view === 'employee_profiles' ? 'active' : '';
  b.onclick = () => { state.view = 'employee_profiles'; renderApp(); };
  const masterBtn = [...nav.querySelectorAll('button')].find(x => /Master Data/i.test(x.textContent || ''));
  if (masterBtn) nav.insertBefore(b, masterBtn);
  else nav.appendChild(b);
};

console.log('Phase 7 — Employee Self Profile + HR Verification loaded.');

/* =====================================================================
   PHASE 10B — DOKUMEN KARYAWAN
   Tambahan ini sengaja APPEND ke file FULL sebelumnya.
   Tidak menghapus / mengganti modul Phase 6–9.
   ===================================================================== */

state.employeeDocuments = state.employeeDocuments || [];
state.documentF = state.documentF || { q: '', employee: '', category: '', status: '' };

const PHASE10_DOC_CATEGORIES = [
  ['IDENTITAS', 'Identitas'],
  ['PENDIDIKAN', 'Pendidikan'],
  ['KONTRAK', 'Kontrak'],
  ['HR', 'HR / Kepegawaian'],
  ['BPJS', 'BPJS'],
  ['LAINNYA', 'Lainnya']
];

const PHASE10_DOC_TYPES = {
  IDENTITAS: ['KTP', 'KK', 'NPWP', 'SIM', 'Paspor', 'Dokumen Identitas Lainnya'],
  PENDIDIKAN: ['Ijazah', 'Transkrip Nilai', 'Sertifikat', 'Dokumen Pendidikan Lainnya'],
  KONTRAK: ['Offering Letter', 'PKWT', 'PKWTT', 'Perpanjangan Kontrak', 'Amandemen Kontrak'],
  HR: ['Surat Keterangan', 'Surat Pengangkatan', 'Surat Mutasi', 'Surat Teguran / SP', 'Surat Peringatan', 'Dokumen HR Lainnya'],
  BPJS: ['BPJS Kesehatan', 'BPJS Ketenagakerjaan', 'Dokumen BPJS Lainnya'],
  LAINNYA: ['Dokumen Pendukung', 'Dokumen Lainnya']
};

function phase10DocCategoryLabel(v) {
  return PHASE10_DOC_CATEGORIES.find(x => x[0] === v)?.[1] || v || '-';
}

function phase10DocStatusBadge(status) {
  const map = {
    valid: ['badge-green', 'Berlaku'],
    expiring_90_days: ['badge-blue', '≤ 90 hari'],
    expiring_30_days: ['badge-yellow', '≤ 30 hari'],
    expired: ['badge-red', 'Kadaluarsa']
  };
  const [cl, label] = map[status] || ['badge-blue', status || 'Berlaku'];
  return `<span class="badge ${cl}">${esc(label)}</span>`;
}

async function phase10LoadDocuments() {
  const { data, error } = await sb.from('employee_documents_status_view')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) throw error;
  state.employeeDocuments = data || [];
  return state.employeeDocuments;
}

function phase10DocPath(employeeId, file) {
  const safe = String(file.name || 'dokumen')
    .replace(/[^a-zA-Z0-9._-]+/g, '_');
  const year = new Date().getFullYear();
  return `employees/${employeeId}/documents/${year}/${Date.now()}-${safe}`;
}

async function phase10OpenDocument(path) {
  if (!path) return toast('File dokumen belum tersedia.', 'error');
  const { data, error } = await sb.storage.from('hr-documents').createSignedUrl(path, 600);
  if (error || !data?.signedUrl) {
    toast('Dokumen tidak dapat dibuka. Periksa policy Storage hr-documents.', 'error');
    return;
  }
  window.open(data.signedUrl, '_blank', 'noopener');
}
window.phase10OpenDocument = phase10OpenDocument;

async function phase10DeleteDocument(id, path) {
  if (!isAdminUser() && !isHRUser()) {
    toast('Anda tidak punya izin menghapus dokumen.', 'error');
    return;
  }
  if (!confirm('Hapus dokumen ini? File dan data dokumen akan dihapus.')) return;

  const delRow = await sb.from('employee_documents').delete().eq('id', id);
  if (delRow.error) return toast(friendlyError(delRow.error), 'error');

  if (path) {
    const delFile = await sb.storage.from('hr-documents').remove([path]);
    if (delFile.error) toast('Data dokumen terhapus, tetapi file Storage gagal dihapus.', 'error');
  }

  toast('Dokumen berhasil dihapus.');
  await phase10LoadDocuments();
  phase10Documents();
}
window.phase10DeleteDocument = phase10DeleteDocument;

function phase10DocumentForm(id = '') {
  const existing = id ? (state.employeeDocuments || []).find(x => x.id === id) : null;
  const employees = state.employees || [];
  const selectedCategory = existing?.document_category || 'IDENTITAS';
  const selectedTypes = PHASE10_DOC_TYPES[selectedCategory] || PHASE10_DOC_TYPES.IDENTITAS;

  const employeeOpts = employees.map(e =>
    `<option value="${esc(e.id)}" ${existing?.employee_id === e.id ? 'selected' : ''}>${esc(e.full_name)} — ${esc(e.employee_number || '')}</option>`
  ).join('');

  const categoryOpts = PHASE10_DOC_CATEGORIES.map(([v,l]) =>
    `<option value="${esc(v)}" ${selectedCategory === v ? 'selected' : ''}>${esc(l)}</option>`
  ).join('');

  const typeOpts = selectedTypes.map(v =>
    `<option value="${esc(v)}" ${existing?.document_type === v ? 'selected' : ''}>${esc(v)}</option>`
  ).join('');

  document.body.insertAdjacentHTML('beforeend', `
    <div class="modal-backdrop" id="phase10DocModal">
      <div class="modal" style="max-width:760px;max-height:90vh;overflow:auto">
        <div class="modal-head">
          <h3>${existing ? 'Edit Dokumen Karyawan' : 'Upload Dokumen Karyawan'}</h3>
          <button class="btn btn-light" onclick="phase10CloseModal()">Tutup</button>
        </div>
        <form id="phase10DocForm" class="modal-grid">
          <div class="field field-full">
            <label>Karyawan *</label>
            <select id="p10Employee" required ${existing ? 'disabled' : ''}>
              <option value="">Pilih karyawan</option>${employeeOpts}
            </select>
          </div>

          <div class="field">
            <label>Kategori *</label>
            <select id="p10Category" required>${categoryOpts}</select>
          </div>

          <div class="field">
            <label>Jenis Dokumen *</label>
            <select id="p10Type" required>${typeOpts}</select>
          </div>

          <div class="field">
            <label>Nomor Dokumen</label>
            <input id="p10Number" value="${esc(existing?.document_number || '')}" placeholder="Nomor dokumen">
          </div>

          <div class="field">
            <label>Tanggal Dokumen</label>
            <input id="p10Date" type="date" value="${esc(existing?.document_date || '')}">
          </div>

          <div class="field">
            <label>Berlaku Mulai</label>
            <input id="p10ValidFrom" type="date" value="${esc(existing?.valid_from || '')}">
          </div>

          <div class="field">
            <label>Berlaku Sampai</label>
            <input id="p10ValidUntil" type="date" value="${esc(existing?.valid_until || '')}">
          </div>

          <div class="field field-full">
            <label>File Dokumen ${existing ? '(kosongkan jika tidak diganti)' : '*'}</label>
            <input id="p10File" type="file" accept=".pdf,.jpg,.jpeg,.png,.doc,.docx,.xls,.xlsx">
            ${existing?.original_file_name ? `<div class="muted" style="margin-top:6px">File saat ini: ${esc(existing.original_file_name)}</div>` : ''}
          </div>

          <div class="field field-full">
            <label>Catatan HR</label>
            <textarea id="p10Notes" rows="4" placeholder="Catatan tambahan HR...">${esc(existing?.notes || '')}</textarea>
          </div>

          <div class="field field-full" style="display:flex;justify-content:flex-end;gap:8px">
            <button type="button" class="btn btn-light" onclick="phase10CloseModal()">Batal</button>
            <button type="submit" class="btn btn-primary">${existing ? 'Simpan Perubahan' : 'Upload & Simpan'}</button>
          </div>
        </form>
      </div>
    </div>
  `);

  $('#p10Category').onchange = () => {
    const types = PHASE10_DOC_TYPES[$('#p10Category').value] || [];
    $('#p10Type').innerHTML = types.map(v => `<option value="${esc(v)}">${esc(v)}</option>`).join('');
  };

  $('#phase10DocForm').onsubmit = async e => {
    e.preventDefault();
    const employeeId = existing?.employee_id || $('#p10Employee').value;
    const file = $('#p10File').files?.[0] || null;

    if (!employeeId) return toast('Pilih karyawan.', 'error');
    if (!existing && !file) return toast('Pilih file dokumen.', 'error');

    const saveBtn = $('#phase10DocForm button[type="submit"]');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Menyimpan...';

    try {
      let path = existing?.file_path || null;
      let originalName = existing?.original_file_name || null;
      let mimeType = existing?.mime_type || null;
      let fileSize = existing?.file_size || null;

      if (file) {
        path = phase10DocPath(employeeId, file);
        const up = await sb.storage.from('hr-documents').upload(path, file, {
          upsert: false,
          contentType: file.type || 'application/octet-stream'
        });
        if (up.error) throw up.error;
        originalName = file.name;
        mimeType = file.type || null;
        fileSize = file.size || null;
      }

      const payload = {
        employee_id: employeeId,
        document_category: $('#p10Category').value,
        document_type: $('#p10Type').value,
        document_number: $('#p10Number').value.trim() || null,
        document_date: $('#p10Date').value || null,
        valid_from: $('#p10ValidFrom').value || null,
        valid_until: $('#p10ValidUntil').value || null,
        file_path: path,
        original_file_name: originalName,
        mime_type: mimeType,
        file_size: fileSize,
        notes: $('#p10Notes').value.trim() || null,
        uploaded_by: state.profile?.id || state.session?.user?.id || null
      };

      const result = existing
        ? await sb.from('employee_documents').update(payload).eq('id', existing.id)
        : await sb.from('employee_documents').insert(payload);

      if (result.error) {
        if (file && path && !existing) await sb.storage.from('hr-documents').remove([path]);
        throw result.error;
      }

      toast(existing ? 'Dokumen berhasil diperbarui.' : 'Dokumen berhasil diupload.');
      phase10CloseModal();
      await phase10LoadDocuments();
      phase10Documents();
    } catch (err) {
      toast(friendlyError(err), 'error');
    } finally {
      if ($('#phase10DocForm')) saveBtn.disabled = false;
    }
  };
}
window.phase10DocumentForm = phase10DocumentForm;

function phase10CloseModal() {
  $('#phase10DocModal')?.remove();
}
window.phase10CloseModal = phase10CloseModal;

function phase10Documents() {
  const f = state.documentF;
  const all = state.employeeDocuments || [];
  const q = String(f.q || '').toLowerCase();

  const rows = all.filter(d => {
    const employee = state.employees.find(e => e.id === d.employee_id);
    const hay = [
      d.full_name, d.employee_number, d.document_type, d.document_category,
      d.document_number, d.original_file_name
    ].map(x => String(x || '').toLowerCase()).join(' ');
    if (q && !hay.includes(q)) return false;
    if (f.employee && d.employee_id !== f.employee) return false;
    if (f.category && d.document_category !== f.category) return false;
    if (f.status && d.document_status !== f.status) return false;
    return !!employee;
  });

  const expired = all.filter(x => x.document_status === 'expired').length;
  const exp30 = all.filter(x => x.document_status === 'expiring_30_days').length;
  const exp90 = all.filter(x => x.document_status === 'expiring_90_days').length;

  $('#content').innerHTML = `
    <div class="section">
      <div class="section-head">
        <div>
          <h2>Dokumen Karyawan</h2>
          <div class="muted">Pusat dokumen HR per karyawan</div>
        </div>
        <div class="row-actions">
          <button class="btn btn-primary" onclick="phase10DocumentForm()">+ Upload Dokumen</button>
        </div>
      </div>

      <div class="cards" style="margin-bottom:14px">
        <div class="card"><div class="muted">Total Dokumen</div><div class="metric">${all.length}</div></div>
        <div class="card"><div class="muted">Berlaku</div><div class="metric">${all.filter(x => x.document_status === 'valid').length}</div></div>
        <div class="card"><div class="muted">≤ 30 Hari</div><div class="metric">${exp30}</div></div>
        <div class="card"><div class="muted">≤ 90 Hari</div><div class="metric">${exp90}</div></div>
        <div class="card"><div class="muted">Kadaluarsa</div><div class="metric">${expired}</div></div>
      </div>

      <div class="toolbar">
        <input id="p10Search" placeholder="Cari nama / ID / jenis / nomor dokumen..." value="${esc(f.q)}">
        <select id="p10EmployeeFilter">
          <option value="">Semua karyawan</option>
          ${state.employees.map(e => `<option value="${esc(e.id)}" ${f.employee === e.id ? 'selected' : ''}>${esc(e.full_name)} — ${esc(e.employee_number || '')}</option>`).join('')}
        </select>
        <select id="p10CategoryFilter">
          <option value="">Semua kategori</option>
          ${PHASE10_DOC_CATEGORIES.map(([v,l]) => `<option value="${esc(v)}" ${f.category === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}
        </select>
        <select id="p10StatusFilter">
          <option value="">Semua status</option>
          <option value="valid" ${f.status === 'valid' ? 'selected' : ''}>Berlaku</option>
          <option value="expiring_90_days" ${f.status === 'expiring_90_days' ? 'selected' : ''}>≤ 90 hari</option>
          <option value="expiring_30_days" ${f.status === 'expiring_30_days' ? 'selected' : ''}>≤ 30 hari</option>
          <option value="expired" ${f.status === 'expired' ? 'selected' : ''}>Kadaluarsa</option>
        </select>
      </div>

      ${rows.length ? `
        <div class="table-wrap">
          <table class="table">
            <thead><tr>
              <th>Karyawan</th><th>Kategori</th><th>Jenis Dokumen</th><th>No. Dokumen</th>
              <th>Tanggal</th><th>Berlaku Sampai</th><th>Status</th><th>Aksi</th>
            </tr></thead>
            <tbody>
              ${rows.map(d => `
                <tr>
                  <td><b>${esc(d.full_name || '-')}</b><div class="muted">${esc(d.employee_number || '-')}</div></td>
                  <td>${esc(phase10DocCategoryLabel(d.document_category))}</td>
                  <td>${esc(d.document_type || '-')}</td>
                  <td>${esc(d.document_number || '-')}</td>
                  <td>${fmtDate(d.document_date)}</td>
                  <td>
                    ${fmtDate(d.valid_until)}
                    ${d.remaining_days !== null && d.remaining_days !== undefined
                      ? `<div class="muted">${d.remaining_days < 0 ? 'Lewat ' + Math.abs(d.remaining_days) + ' hari' : d.remaining_days + ' hari lagi'}</div>`
                      : ''}
                  </td>
                  <td>${phase10DocStatusBadge(d.document_status)}</td>
                  <td><div class="row-actions">
                    ${d.file_path ? `<button class="btn btn-light btn-sm" onclick="phase10OpenDocument('${esc(d.file_path)}')">Buka</button>` : ''}
                    <button class="btn btn-light btn-sm" onclick="phase10DocumentForm('${esc(d.id)}')">Edit</button>
                    <button class="btn btn-light btn-sm" onclick="phase10DeleteDocument('${esc(d.id)}','${esc(d.file_path || '')}')">Hapus</button>
                  </div></td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : `<div class="card empty">Belum ada dokumen yang sesuai filter.</div>`}
    </div>
  `;

  $('#p10Search').oninput = e => { f.q = e.target.value; phase10Documents(); };
  $('#p10EmployeeFilter').onchange = e => { f.employee = e.target.value; phase10Documents(); };
  $('#p10CategoryFilter').onchange = e => { f.category = e.target.value; phase10Documents(); };
  $('#p10StatusFilter').onchange = e => { f.status = e.target.value; phase10Documents(); };
}

const __phase10OriginalTitle = title;
title = function() {
  if (state.view === 'employee_documents') return 'Dokumen Karyawan';
  return __phase10OriginalTitle();
};

const __phase10OriginalRenderView = renderView;
renderView = function() {
  if (state.view === 'employee_documents') return phase10Documents();
  return __phase10OriginalRenderView();
};

const __phase10OriginalRenderApp = renderApp;
renderApp = function() {
  __phase10OriginalRenderApp();
  const nav = document.querySelector('.sidebar .nav');
  if (!nav || document.getElementById('phase10DocumentsNav')) return;
  const b = document.createElement('button');
  b.id = 'phase10DocumentsNav';
  b.type = 'button';
  b.textContent = 'Dokumen Karyawan';
  b.dataset.view = 'employee_documents';
  b.className = state.view === 'employee_documents' ? 'active' : '';
  b.onclick = async () => {
    state.view = 'employee_documents';
    renderApp();
    try {
      await phase10LoadDocuments();
      phase10Documents();
    } catch (err) {
      $('#content').innerHTML = `<div class="card"><div class="error">${esc(friendlyError(err))}</div></div>`;
    }
  };
  const profileBtn = document.getElementById('phase7AdminNav');
  const masterBtn = [...nav.querySelectorAll('button')].find(x => /Master Data/i.test(x.textContent || ''));
  if (profileBtn) nav.insertBefore(b, profileBtn);
  else if (masterBtn) nav.insertBefore(b, masterBtn);
  else nav.appendChild(b);
};

console.log('Phase 10B — Employee Documents loaded.');

/* =========================================================
   PHASE 8A — EMPLOYEE PORTAL ATTENDANCE
   Portal Karyawan menggunakan PIN-session, bukan Supabase Auth.
   Kamera + GPS hanya aktif saat tombol absensi ditekan.
   ========================================================= */

async function employeeAttendanceContext(){
  return await empRpc('employee_attendance_context');
}

function employeeAttendanceStatusHtml(rec, tz){
  if(!rec || !rec.check_in_at){
    return `<div class="info-box">Anda belum melakukan absensi masuk hari ini.</div>`;
  }
  const inStatus = ATT_STATUS[rec.check_in_status]?.[0] || '-';
  const out = rec.check_out_at
    ? `Keluar: <b>${esc(fmtTime(rec.check_out_at, tz))}</b> · ${esc(ATT_STATUS[rec.check_out_status]?.[0] || '-')}<br>`
    : `Keluar: <b>Belum absen</b><br>`;
  return `<div class="info-box">Masuk: <b>${esc(fmtTime(rec.check_in_at, tz))}</b> · ${esc(inStatus)}<br>${out}<span class="muted">${esc(rec.work_location_name || '-')}</span></div>`;
}

async function employeeAttendancePanel(box){
  box.innerHTML = '<div class="card empty">Memuat data absensi...</div>';
  try{
    const c = await employeeAttendanceContext();
    if(!c || !c.employee_id){
      box.innerHTML = '<div class="card"><div class="error">Data absensi karyawan tidak tersedia.</div></div>';
      return;
    }
    const t = c.target || {};
    const rec = c.record;
    const action = attAction(c);
    const actionLabel = action === 'check_in' ? 'ABSEN MASUK' : action === 'check_out' ? 'ABSEN KELUAR' : 'ABSENSI SELESAI';
    const disabled = !action || !t.configured;
    box.innerHTML = `<div class="section">
      <div class="section-head"><h2>Absensi Hari Ini</h2></div>
      <div class="cards">
        <div class="card"><div class="muted">Nama</div><div class="metric" style="font-size:22px">${esc(empPortal.employee?.full_name||'-')}</div><div class="muted">ID ${esc(empPortal.employee?.employee_number||'-')}</div></div>
        <div class="card"><div class="muted">Lokasi</div><div class="metric" style="font-size:20px">${esc(t.name||'-')}</div><div class="muted">${esc(t.kind === 'company' ? 'Lokasi kerja' : 'Outlet')}</div></div>
      </div>
      ${employeeAttendanceStatusHtml(rec, c.timezone || 'Asia/Jakarta')}
      ${!t.configured ? `<div class="card"><div class="error">${esc(t.message || 'Lokasi kerja belum dikonfigurasi.')}</div></div>` : ''}
      <button id="employeeAttButton" class="btn btn-primary btn-lg btn-block" ${disabled?'disabled':''}>${actionLabel}</button>
      <div class="muted" style="margin-top:10px">Absensi membutuhkan kamera selfie dan lokasi perangkat. GPS tidak dilacak terus-menerus.</div>
    </div>`;
    if(!disabled) $('#employeeAttButton').onclick = () => openEmployeeAttendanceFlow(c, action);
  }catch(err){
    box.innerHTML = `<div class="card"><div class="error">${esc(friendlyError(err))}</div></div>`;
  }
}

function openEmployeeAttendanceFlow(c, action){
  const t = c.target || {};
  const isIn = action === 'check_in';
  const label = isIn ? 'ABSEN MASUK' : 'ABSEN KELUAR';
  const flow = { action, stream:null, blob:null, previewUrl:null, accepted:false, camMsg:'Meminta akses kamera...', camErr:null, geo:null, geoErr:null, geoBusy:false, busy:false };
  const modal = document.createElement('div');
  modal.className = 'modal-backdrop att-backdrop';
  modal.id = 'employeeAttModal';
  modal.innerHTML = `<div class="modal att-modal">
    <div class="section-head"><h2>${label}</h2><button type="button" class="btn btn-light" id="eAttClose">Tutup</button></div>
    <div class="att-camera"><video id="eAttVideo" autoplay playsinline muted></video><img id="eAttPhoto" alt="Hasil selfie" hidden><div id="eAttCamMsg" class="att-cam-msg"></div></div>
    <div class="att-shots"><button type="button" class="btn btn-primary btn-lg" id="eAttShoot" disabled>AMBIL SELFIE</button><button type="button" class="btn btn-light btn-lg" id="eAttRetake" hidden>Ambil Ulang</button><button type="button" class="btn btn-primary btn-lg" id="eAttUse" hidden>Gunakan Foto</button></div>
    <div class="att-rows">
      <div class="att-row"><span>GPS</span><b id="eAttGpsTxt">Mendapatkan lokasi...</b></div>
      <div class="att-row"><span>Akurasi</span><b id="eAttAccTxt">-- meter</b></div>
      <div class="att-row"><span>${t.kind === 'company' ? 'Lokasi kerja' : 'Outlet'}</span><b>${esc(t.name || '-')}</b></div>
      <div class="att-row"><span>Jarak</span><b id="eAttDistTxt">--</b></div>
      <div class="att-row"><span>Status lokasi</span><b id="eAttLocTxt">--</b></div>
    </div>
    <button type="button" class="btn btn-light btn-block" id="eAttGps">Perbarui Lokasi</button>
    <button type="button" class="btn btn-primary btn-lg btn-block att-submit" id="eAttSubmit" disabled>${label}</button>
  </div>`;
  document.body.appendChild(modal);
  const $m = s => modal.querySelector(s);
  const video = $m('#eAttVideo'), img = $m('#eAttPhoto');

  const evalGeo = () => {
    if(!flow.geo || !t.latitude || !t.longitude) return null;
    const dist = haversine(flow.geo.lat, flow.geo.lng, Number(t.latitude), Number(t.longitude));
    return {dist, inside:dist <= Number(t.radius || 100), accOk:flow.geo.acc <= Number(c.max_accuracy_meter || 150)};
  };
  const render = () => {
    const showPhoto = !!flow.blob;
    video.hidden = showPhoto; img.hidden = !showPhoto;
    const msg = showPhoto ? '' : (flow.camMsg || '');
    $m('#eAttCamMsg').textContent = msg; $m('#eAttCamMsg').hidden = !msg;
    $m('#eAttShoot').hidden = showPhoto; $m('#eAttShoot').disabled = !flow.stream || !!flow.camMsg;
    $m('#eAttRetake').hidden = !(showPhoto || flow.camErr);
    $m('#eAttRetake').textContent = flow.camErr && !showPhoto ? 'Coba Kamera Lagi' : 'Ambil Ulang';
    $m('#eAttUse').hidden = !(showPhoto && !flow.accepted);
    const ev = evalGeo();
    const gpsTxt=$m('#eAttGpsTxt'), locTxt=$m('#eAttLocTxt');
    $m('#eAttGps').disabled = flow.geoBusy || flow.busy;
    if(flow.geoBusy){gpsTxt.textContent='Mendapatkan lokasi...';gpsTxt.className='';$m('#eAttAccTxt').textContent='-- meter';$m('#eAttDistTxt').textContent='--';locTxt.textContent='--';locTxt.className='';}
    else if(flow.geoErr){gpsTxt.textContent=flow.geoErr;gpsTxt.className='bad';$m('#eAttAccTxt').textContent='-- meter';$m('#eAttDistTxt').textContent='--';locTxt.textContent='--';locTxt.className='';}
    else if(ev){
      gpsTxt.textContent='GPS berhasil';gpsTxt.className='ok';
      $m('#eAttAccTxt').textContent=`${Math.round(flow.geo.acc)} meter`;
      $m('#eAttDistTxt').textContent=`${Math.round(ev.dist)} meter`;
      if(!ev.accOk){locTxt.textContent=`Akurasi GPS terlalu rendah (maks ${c.max_accuracy_meter} m).`;locTxt.className='bad';}
      else if(!ev.inside){locTxt.textContent=`Di luar area absensi (radius ${t.radius} m).`;locTxt.className='bad';}
      else{locTxt.textContent=`Di dalam area absensi (radius ${t.radius} m)`;locTxt.className='ok';}
    }
    $m('#eAttSubmit').disabled=!(flow.accepted && ev && ev.inside && ev.accOk) || flow.busy || flow.geoBusy;
    $m('#eAttSubmit').textContent=flow.busy?'Mengirim...':label;
  };
  const stopCamera=()=>{if(flow.stream){flow.stream.getTracks().forEach(tr=>tr.stop());flow.stream=null;}video.srcObject=null;};
  const camError=e=>(e&&(e.name==='NotAllowedError'||e.name==='PermissionDeniedError'))?'Camera tidak diizinkan. Izinkan akses kamera untuk situs ini.':(e&&(e.name==='NotFoundError'||e.name==='DevicesNotFoundError'))?'Kamera tidak ditemukan di perangkat ini.':'Kamera tidak dapat dibuka. Pastikan tidak sedang dipakai aplikasi lain.';
  const startCamera=async()=>{
    stopCamera();flow.camErr=null;flow.camMsg='Meminta akses kamera...';render();
    try{const stream=await navigator.mediaDevices.getUserMedia({video:{facingMode:'user',width:{ideal:1280},height:{ideal:960}},audio:false});
      if(!document.body.contains(modal)){stream.getTracks().forEach(tr=>tr.stop());return;}
      flow.stream=stream;video.srcObject=stream;try{await video.play();}catch(_){}flow.camMsg='';render();
    }catch(e){flow.camErr=camError(e);flow.camMsg=flow.camErr;render();}
  };
  const fetchGps=async()=>{
    flow.geoBusy=true;flow.geo=null;flow.geoErr=null;render();
    try{const pos=await new Promise((res,rej)=>navigator.geolocation.getCurrentPosition(res,rej,{enableHighAccuracy:true,timeout:20000,maximumAge:0}));flow.geo={lat:pos.coords.latitude,lng:pos.coords.longitude,acc:pos.coords.accuracy};}
    catch(err){flow.geoErr=err&&err.code===1?'Lokasi tidak diizinkan. Izinkan lokasi untuk situs ini.':'Lokasi tidak dapat diperoleh. Aktifkan GPS dan izin lokasi browser.';}
    flow.geoBusy=false;render();
  };
  const closeFlow=()=>{stopCamera();if(flow.previewUrl)URL.revokeObjectURL(flow.previewUrl);modal.remove();};
  $m('#eAttClose').onclick=()=>{if(flow.busy){toast('Sedang mengirim absensi, mohon tunggu.','error');return;}closeFlow();};
  $m('#eAttShoot').onclick=()=>{
    const vw=video.videoWidth,vh=video.videoHeight;if(!vw||!vh){toast('Kamera belum siap.','error');return;}
    const scale=Math.min(1,960/Math.max(vw,vh));const canvas=document.createElement('canvas');canvas.width=Math.round(vw*scale);canvas.height=Math.round(vh*scale);canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
    canvas.toBlob(b=>{if(!b){toast('Gagal mengambil foto.','error');return;}if(flow.previewUrl)URL.revokeObjectURL(flow.previewUrl);flow.blob=b;flow.previewUrl=URL.createObjectURL(b);img.src=flow.previewUrl;flow.accepted=false;render();},'image/jpeg',0.8);
  };
  $m('#eAttRetake').onclick=async()=>{if(flow.previewUrl)URL.revokeObjectURL(flow.previewUrl);flow.previewUrl=null;flow.blob=null;flow.accepted=false;img.removeAttribute('src');if(flow.stream)render();else await startCamera();};
  $m('#eAttUse').onclick=()=>{flow.accepted=true;stopCamera();render();};
  $m('#eAttGps').onclick=fetchGps;
  $m('#eAttSubmit').onclick=async()=>{
    const ev=evalGeo();
    if(!flow.accepted||!flow.blob){toast('Selfie wajib diambil sebelum absensi.','error');return;}
    if(!ev||!ev.accOk||!ev.inside){toast('Lokasi tidak memenuhi syarat absensi.','error');return;}
    flow.busy=true;render();
    let path=null;
    try{
      const [yyyy,mm]=String(c.today).split('-');
      const empId=empPortal.employee?.id;
      path=`attendance/${empId}/${yyyy}/${mm}/${c.today}/${isIn?'check-in':'check-out'}-${Date.now()}.jpg`;
      const up=await sb.storage.from('attendance-photos').upload(path,flow.blob,{contentType:'image/jpeg',upsert:false});
      if(up.error)throw up.error;
      const {error}=await sb.rpc('employee_submit_attendance',{p_token:empPortal.token,p_action:action,p_latitude:flow.geo.lat,p_longitude:flow.geo.lng,p_accuracy:flow.geo.acc,p_photo_path:path});
      if(error)throw error;
      closeFlow();toast(isIn?'Absensi masuk berhasil.':'Absensi keluar berhasil.');
      await employeePortalView('attendance');
    }catch(err){toast(friendlyError(err),'error');}
    finally{flow.busy=false;}
  };
  render();startCamera();fetchGps();
}

/* Override only the Employee Portal attendance view; admin attendance remains unchanged. */
const __phase8aEmployeePortalView = employeePortalView;
employeePortalView = async function(view){
  if(view !== 'attendance') return await __phase8aEmployeePortalView(view);
  const box=$('#epContent'); if(!box)return;
  await employeeAttendancePanel(box);
};

console.log('HR Employee System Phase 8A loaded: Employee Portal Selfie + GPS Attendance');

/* =========================================================
   PHASE 9 — RIWAYAT ABSENSI KARYAWAN
   Menambahkan riwayat ke Portal Karyawan tanpa mengubah
   alur selfie + GPS Phase 8A.
   ========================================================= */

function phase9MonthRange() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const last = new Date(y, now.getMonth() + 1, 0).getDate();
  return { from: `${y}-${m}-01`, to: `${y}-${m}-${String(last).padStart(2, '0')}` };
}

function phase9FmtDuration(inAt, outAt) {
  if (!inAt || !outAt) return '-';
  const ms = new Date(outAt).getTime() - new Date(inAt).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '-';
  const mins = Math.floor(ms / 60000);
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h} jam ${String(m).padStart(2, '0')} menit`;
}

function phase9StatusBadge(status) {
  const x = ATT_STATUS[status] || [status || '-', 'badge-gray'];
  return `<span class="badge ${x[1]}">${esc(x[0])}</span>`;
}

async function phase9LoadHistory(from, to) {
  return await empRpc('employee_attendance_history', {
    p_from: from,
    p_to: to
  });
}

function phase9Summary(rows) {
  const total = rows.length;
  const late = rows.filter(r => r.check_in_status === 'late').length;
  const valid = rows.filter(r => r.check_in_status === 'valid').length;
  const incomplete = rows.filter(r => r.check_in_at && !r.check_out_at).length;
  return { total, late, valid, incomplete };
}

async function phase9RenderHistory(box, from, to) {
  box.innerHTML = `<div class="section"><div class="card empty">Memuat riwayat absensi...</div></div>`;
  try {
    const rows = await phase9LoadHistory(from, to) || [];
    const s = phase9Summary(rows);

    box.innerHTML = `
      <div class="section">
        <div class="section-head">
          <div>
            <h2>Riwayat Absensi</h2>
            <div class="muted">Data absensi pribadi berdasarkan tanggal yang dipilih.</div>
          </div>
          <button type="button" class="btn btn-light" id="phase9Refresh">Refresh</button>
        </div>

        <div class="toolbar" style="margin-bottom:14px">
          <label style="min-width:150px">Dari
            <input type="date" id="phase9From" value="${esc(from)}">
          </label>
          <label style="min-width:150px">Sampai
            <input type="date" id="phase9To" value="${esc(to)}">
          </label>
          <button type="button" class="btn btn-primary" id="phase9Apply">Tampilkan</button>
          <button type="button" class="btn btn-light" id="phase9ThisMonth">Bulan Ini</button>
        </div>

        <div class="cards">
          <div class="card"><div class="muted">Hari tercatat</div><div class="metric">${s.total}</div></div>
          <div class="card"><div class="muted">Tepat waktu</div><div class="metric">${s.valid}</div></div>
          <div class="card"><div class="muted">Terlambat</div><div class="metric">${s.late}</div></div>
          <div class="card"><div class="muted">Belum checkout</div><div class="metric">${s.incomplete}</div></div>
        </div>

        <div class="table-wrap" style="margin-top:14px">
          ${rows.length ? `
          <table class="table">
            <thead>
              <tr>
                <th>Tanggal</th>
                <th>Lokasi</th>
                <th>Masuk</th>
                <th>Keluar</th>
                <th>Durasi</th>
                <th>Status Masuk</th>
                <th>Status Keluar</th>
                <th>Jarak</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map(r => `
                <tr>
                  <td><b>${esc(fmtDate(r.attendance_date))}</b></td>
                  <td>${esc(r.work_location_name || '-')}</td>
                  <td>${r.check_in_at ? esc(fmtTime(r.check_in_at, 'Asia/Jakarta')) : '-'}</td>
                  <td>${r.check_out_at ? esc(fmtTime(r.check_out_at, 'Asia/Jakarta')) : '<span class="muted">Belum</span>'}</td>
                  <td>${esc(phase9FmtDuration(r.check_in_at, r.check_out_at))}</td>
                  <td>${r.check_in_status ? phase9StatusBadge(r.check_in_status) : '-'}</td>
                  <td>${r.check_out_status ? phase9StatusBadge(r.check_out_status) : '-'}</td>
                  <td>${r.check_in_distance_meter != null ? `Masuk ${Math.round(Number(r.check_in_distance_meter))} m` : '-'}${r.check_out_distance_meter != null ? `<br><span class="muted">Keluar ${Math.round(Number(r.check_out_distance_meter))} m</span>` : ''}</td>
                </tr>
              `).join('')}
            </tbody>
          </table>` : '<div class="card empty">Tidak ada data absensi pada periode ini.</div>'}
        </div>

        <div class="info-box" style="margin-top:14px">
          Foto selfie, koordinat GPS, akurasi GPS, dan jarak dari lokasi kerja tetap tersimpan pada data absensi. Riwayat ini hanya menampilkan data milik Anda.
        </div>
      </div>`;

    const reload = async (f, t) => {
      const a = document.getElementById('phase9From');
      const b = document.getElementById('phase9To');
      if (a) a.value = f;
      if (b) b.value = t;
      await phase9RenderHistory(box, f, t);
    };

    $('#phase9Refresh')?.addEventListener('click', () => reload(from, to));
    $('#phase9Apply')?.addEventListener('click', () => {
      const f = $('#phase9From')?.value;
      const t = $('#phase9To')?.value;
      if (!f || !t) { toast('Tanggal awal dan akhir wajib diisi.', 'error'); return; }
      if (f > t) { toast('Tanggal awal tidak boleh setelah tanggal akhir.', 'error'); return; }
      reload(f, t);
    });
    $('#phase9ThisMonth')?.addEventListener('click', () => {
      const r = phase9MonthRange();
      reload(r.from, r.to);
    });
  } catch (err) {
    box.innerHTML = `<div class="section"><div class="card"><div class="error">${esc(friendlyError(err))}</div></div></div>`;
  }
}

// Re-wrap attendance so the existing Phase 8A panel remains intact,
// then append the employee's private attendance history below it.
const __phase9AttendanceView = employeePortalView;
employeePortalView = async function(view) {
  if (view !== 'attendance') return await __phase9AttendanceView(view);
  const box = $('#epContent');
  if (!box) return;

  await employeeAttendancePanel(box);

  const range = phase9MonthRange();
  const historyBox = document.createElement('div');
  historyBox.id = 'phase9HistoryBox';
  box.appendChild(historyBox);
  await phase9RenderHistory(historyBox, range.from, range.to);
};

console.log('HR Employee System Phase 9 loaded: Employee Attendance History + Summary');

/* =========================================================
   PHASE 12C FINAL — CUTI WORKDAY OVERRIDE
   THIS BLOCK MUST REMAIN AT THE VERY END OF app.js
   ========================================================= */

async function phase12cFinalWorkdays(employeeId, startDate, endDate) {
  if (!employeeId || !startDate || !endDate) return 0;
  const r = await sb.rpc('leave_workdays_between', {
    p_employee: employeeId,
    p_start: startDate,
    p_end: endDate
  });
  if (r.error) throw r.error;
  return Number(r.data || 0);
}

async function phase12cFinalSubmit(form) {
  if (!(form instanceof HTMLFormElement)) {
    throw new Error('Form pengajuan cuti tidak valid.');
  }

  const fd = new FormData(form);
  const employee_id = String(fd.get('employee_id') || '');
  const leave_type_id = String(fd.get('leave_type_id') || '');
  const start_date = String(fd.get('start_date') || '');
  const end_date = String(fd.get('end_date') || start_date);
  const reason = String(fd.get('reason') || '').trim();

  const type = typeof p6LeaveType === 'function'
    ? p6LeaveType(leave_type_id)
    : null;

  if (!employee_id || !leave_type_id || !start_date || !end_date || !reason) {
    toast('Lengkapi karyawan, jenis, tanggal dan alasan.', 'error');
    return false;
  }

  if (end_date < start_date) {
    toast('Tanggal berakhir tidak boleh lebih kecil dari tanggal mulai.', 'error');
    return false;
  }

  if (type?.requires_attachment) {
    const file = fd.get('attachment');
    if (!file || !file.size) {
      toast('Lampiran wajib untuk jenis pengajuan ini.', 'error');
      return false;
    }
  }

  let total_days;
  try {
    total_days = await phase12cFinalWorkdays(
      employee_id,
      start_date,
      end_date
    );
  } catch (err) {
    console.error('Phase 12C workday error:', err);
    toast('Gagal menghitung hari kerja: ' + friendlyError(err), 'error');
    return false;
  }

  if (total_days <= 0) {
    toast(
      'Tidak ada hari kerja dalam periode yang dipilih. Silakan pilih tanggal kerja.',
      'error'
    );
    return false;
  }

  if (
    type?.code === PHASE6_LEAVE.annualCode &&
    typeof p6BalanceFor === 'function'
  ) {
    const bal = p6BalanceFor(
      employee_id,
      leave_type_id,
      Number(start_date.slice(0, 4))
    );

    if (total_days > Number(bal?.available || 0)) {
      toast(
        `Sisa Cuti Tahunan tidak cukup. Tersedia ${bal.available} hari.`,
        'error'
      );
      return false;
    }
  }

  const file = fd.get('attachment');
  let attachment_path = null;

  if (file && file.size) {
    if (file.size > 10 * 1024 * 1024) {
      toast('Lampiran maksimal 10 MB.', 'error');
      return false;
    }

    if (typeof p6AttachmentPath !== 'function') {
      toast('Fungsi lampiran belum tersedia.', 'error');
      return false;
    }

    attachment_path = p6AttachmentPath(employee_id, file);

    const up = await sb.storage
      .from('leave-documents')
      .upload(
        attachment_path,
        file,
        {
          upsert: false,
          contentType: file.type || 'application/octet-stream'
        }
      );

    if (up.error) {
      toast('Gagal upload lampiran: ' + up.error.message, 'error');
      return false;
    }
  }

  const payload = {
    employee_id,
    leave_type_id,
    start_date,
    end_date,
    total_days,
    calculated_days: total_days,
    reason,
    employee_note: reason,
    attachment_path,
    status: 'pending',
    supervisor_status: 'pending',
    hr_status: 'pending',
    submitted_at: new Date().toISOString()
  };

  const r = await sb
    .from('leave_requests')
    .insert(payload)
    .select()
    .single();

  if (r.error) {
    toast(friendlyError(r.error), 'error');
    return false;
  }

  toast('Pengajuan cuti/izin berhasil dikirim.');

  if (typeof p6RefreshLeaveData === 'function') {
    await p6RefreshLeaveData();
  }

  return true;
}

/* Override p6NewLeave LAST so no later Phase can replace it. */
window.p6NewLeave = function(employeeId = '') {
  const activeTypes = (state.leaveTypes || []).filter(x => x.is_active);
  const empList = (state.employees || []).filter(
    e => e.employment_status === 'active'
  );

  const body = `
    <div class="form-grid">
      <div class="field field-full">
        <label>Karyawan *</label>
        <select name="employee_id" required>
          ${empList.map(e => `
            <option value="${esc(e.id)}" ${e.id === employeeId ? 'selected' : ''}>
              ${esc(e.full_name)} — ${esc(e.employee_number || '-')}
            </option>
          `).join('')}
        </select>
      </div>

      <div class="field">
        <label>Jenis *</label>
        <select name="leave_type_id" id="phase12cFinalType" required>
          ${activeTypes.map(t => `
            <option value="${esc(t.id)}">
              ${esc(t.name)}
            </option>
          `).join('')}
        </select>
      </div>

      <div class="field">
        <label>Jumlah hari kerja otomatis</label>
        <input id="phase12cFinalDays" value="0 hari" readonly>
      </div>

      <div class="field">
        <label>Tanggal Mulai *</label>
        <input name="start_date" type="date" required>
      </div>

      <div class="field">
        <label>Tanggal Berakhir *</label>
        <input name="end_date" type="date" required>
      </div>

      <div class="field field-full">
        <label>Alasan *</label>
        <textarea
          name="reason"
          rows="4"
          required
          placeholder="Tuliskan alasan pengajuan..."
        ></textarea>
      </div>

      <div class="field field-full">
        <label>Lampiran</label>
        <input
          name="attachment"
          type="file"
          accept=".pdf,.jpg,.jpeg,.png,.doc,.docx"
        >
        <div class="muted">Wajib untuk jenis yang memerlukan bukti.</div>
      </div>
    </div>
  `;

  const modal = openModal(
    'Ajukan Cuti / Izin',
    body,
    async form => await phase12cFinalSubmit(form),
    'Kirim Pengajuan'
  );

  const form = modal.querySelector('form');
  const daysEl = modal.querySelector('#phase12cFinalDays');

  const recalc = async () => {
    const fd = new FormData(form);
    const emp = String(fd.get('employee_id') || '');
    const start = String(fd.get('start_date') || '');
    const end = String(fd.get('end_date') || start);

    if (!emp || !start || !end) {
      daysEl.value = '0 hari';
      return;
    }

    if (end < start) {
      daysEl.value = 'Tanggal tidak valid';
      return;
    }

    daysEl.value = 'Menghitung...';

    try {
      const n = await phase12cFinalWorkdays(emp, start, end);
      daysEl.value = `${n} hari`;
    } catch (err) {
      console.error('Phase 12C calculation:', err);
      daysEl.value = 'Gagal dihitung';
      toast(
        'Gagal menghitung hari kerja: ' + friendlyError(err),
        'error'
      );
    }
  };

  form.querySelectorAll(
    '[name="employee_id"], [name="start_date"], [name="end_date"]'
  ).forEach(el => {
    el.addEventListener('change', recalc);
  });

  console.log(
    'PHASE 12C FINAL — p6NewLeave override active',
    'employee=', employeeId
  );
};

console.log(
  'PHASE 12C FINAL LOADED — CUTI USES leave_workdays_between'
);
/* =========================================================
   PHASE 11C FINAL — CONTRACT ALERT DASHBOARD PATCH
   Tujuan:
   - Mengembalikan alert kontrak di Dashboard.
   - Tidak mengubah Phase 12C / modul cuti.
   - Patch ini ditempel PALING BAWAH app.js.
   - Membaca data dari public.contracts_alert_view.
   ========================================================= */

(function () {
  if (window.__PHASE11C_FINAL_CONTRACT_ALERT__) {
    console.log('PHASE 11C FINAL already loaded.');
    return;
  }
  window.__PHASE11C_FINAL_CONTRACT_ALERT__ = true;

  async function phase11cLoadContractAlerts() {
    const { data, error } = await sb
      .from('contracts_alert_view')
      .select('*');

    if (error) {
      console.error('PHASE 11C CONTRACT ALERT ERROR:', error);
      return [];
    }

    return Array.isArray(data) ? data : [];
  }

  function phase11cAlertStatus(row) {
    return String(
      row.alert_status ??
      row.contract_alert_status ??
      row.status_alert ??
      row.alert_type ??
      row.contract_status ??
      ''
    ).toLowerCase();
  }

  function phase11cDays(row) {
    const v =
      row.days_remaining ??
      row.remaining_days ??
      row.days_until_end ??
      row.sisa_hari;

    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function phase11cName(row) {
    return row.full_name ??
      row.employee_name ??
      row.nama_karyawan ??
      row.name ??
      '-';
  }

  function phase11cEmployeeNumber(row) {
    return row.employee_number ??
      row.employee_no ??
      row.nip ??
      row.id_karyawan ??
      '-';
  }

  function phase11cContractNumber(row) {
    return row.contract_number ??
      row.contract_no ??
      row.nomor_kontrak ??
      '-';
  }

  function phase11cContractType(row) {
    return row.contract_type_label ??
      row.contract_type ??
      row.jenis_kontrak ??
      '-';
  }

  function phase11cEndDate(row) {
    return row.end_date ??
      row.contract_end_date ??
      row.tanggal_berakhir ??
      null;
  }

  function phase11cClass(row) {
    const s = phase11cAlertStatus(row);
    const n = phase11cDays(row);

    if (
      s.includes('expired') ||
      s.includes('berakhir') && !s.includes('30') && !s.includes('90') ||
      (n !== null && n < 0)
    ) return 'badge-red';

    if (
      s.includes('critical') ||
      s.includes('30') ||
      (n !== null && n >= 0 && n <= 30)
    ) return 'badge-yellow';

    return 'badge-blue';
  }

  function phase11cLabel(row) {
    const s = phase11cAlertStatus(row);
    const n = phase11cDays(row);

    if (s.includes('expired') || (n !== null && n < 0)) {
      return 'Sudah Berakhir';
    }

    if (
      s.includes('critical') ||
      s.includes('30') ||
      (n !== null && n >= 0 && n <= 30)
    ) {
      return n === null ? '≤ 30 hari' : `≤ 30 hari (${n} hari)`;
    }

    if (
      s.includes('warning') ||
      s.includes('90') ||
      (n !== null && n > 30 && n <= 90)
    ) {
      return n === null ? '≤ 90 hari' : `≤ 90 hari (${n} hari)`;
    }

    return s || 'Perlu perhatian';
  }

  function phase11cDate(row) {
    const d = phase11cEndDate(row);
    if (!d) return '-';

    try {
      if (typeof fmtDate === 'function') return fmtDate(d);
      return new Date(d + 'T00:00:00').toLocaleDateString('id-ID');
    } catch (_) {
      return String(d);
    }
  }

  function phase11cRender(rows) {
    const old = document.getElementById('phase11cContractAlerts');
    if (old) old.remove();

    const expired = rows.filter(r => {
      const n = phase11cDays(r);
      const s = phase11cAlertStatus(r);
      return s.includes('expired') || (n !== null && n < 0);
    });

    const critical = rows.filter(r => {
      const n = phase11cDays(r);
      const s = phase11cAlertStatus(r);
      return !s.includes('expired') &&
        (s.includes('critical') || s.includes('30') || (n !== null && n >= 0 && n <= 30));
    });

    const warning = rows.filter(r => {
      const n = phase11cDays(r);
      const s = phase11cAlertStatus(r);
      return !s.includes('expired') &&
        !s.includes('critical') &&
        !s.includes('30') &&
        (s.includes('warning') || s.includes('90') || (n !== null && n > 30 && n <= 90));
    });

    const esc11c = v =>
      typeof esc === 'function'
        ? esc(v)
        : String(v ?? '').replace(/[&<>'"]/g, c => ({
            '&':'&amp;', '<':'&lt;', '>':'&gt;',
            "'":'&#39;', '"':'&quot;'
          }[c]));

    const allRows = [...expired, ...critical, ...warning];

    const html = `
      <div id="phase11cContractAlerts" class="section" style="margin-top:16px;">
        <div class="section-head">
          <div>
            <h2>⚠️ Peringatan Kontrak</h2>
            <div class="muted">Pemantauan masa berlaku kontrak karyawan</div>
          </div>
        </div>

        <div class="cards" style="margin-bottom:14px;">
          <div class="card">
            <div class="muted">Sudah Berakhir</div>
            <div class="metric">${expired.length}</div>
          </div>
          <div class="card">
            <div class="muted">Berakhir ≤ 30 Hari</div>
            <div class="metric">${critical.length}</div>
          </div>
          <div class="card">
            <div class="muted">Berakhir ≤ 90 Hari</div>
            <div class="metric">${warning.length}</div>
          </div>
        </div>

        ${
          allRows.length
            ? `<div class="table-wrap">
                <table class="table">
                  <thead>
                    <tr>
                      <th>Karyawan</th>
                      <th>No. Kontrak</th>
                      <th>Jenis</th>
                      <th>Tanggal Berakhir</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    ${allRows.map(r => `
                      <tr>
                        <td>
                          <b>${esc11c(phase11cName(r))}</b>
                          <div class="muted">${esc11c(phase11cEmployeeNumber(r))}</div>
                        </td>
                        <td>${esc11c(phase11cContractNumber(r))}</td>
                        <td>${esc11c(phase11cContractType(r))}</td>
                        <td>${esc11c(phase11cDate(r))}</td>
                        <td>
                          <span class="badge ${phase11cClass(r)}">
                            ${esc11c(phase11cLabel(r))}
                          </span>
                        </td>
                      </tr>
                    `).join('')}
                  </tbody>
                </table>
              </div>`
            : `<div class="card" style="padding:18px;">
                <b>✓ Tidak ada kontrak yang perlu perhatian saat ini.</b>
                <div class="muted" style="margin-top:5px;">
                  Kontrak yang sudah berakhir atau mendekati tanggal berakhir akan muncul otomatis di sini.
                </div>
              </div>`
        }
      </div>
    `;

    const content = document.getElementById('content');
    if (!content) return;

    content.insertAdjacentHTML('beforeend', html);
  }

  if (typeof dashboard === 'function') {
    const __phase11cOriginalDashboardFinal = dashboard;

    dashboard = async function () {
      await __phase11cOriginalDashboardFinal();

      try {
        const rows = await phase11cLoadContractAlerts();
        phase11cRender(rows);
      } catch (err) {
        console.error('PHASE 11C FINAL RENDER ERROR:', err);
      }
    };
  } else {
    console.error('PHASE 11C FINAL: dashboard() tidak ditemukan.');
  }

  window.phase11cLoadContractAlerts = phase11cLoadContractAlerts;

  console.log(
    'PHASE 11C FINAL LOADED — Contract Alert Dashboard restored.'
  );
})();
/* =========================================================
   PHASE 6C FINAL — EMPLOYEE PORTAL APPROVAL FIX
   Masalah:
   Phase 6C lama masih menggunakan state.profile.employee_id
   (jalur Admin/HR), sedangkan Portal Karyawan memakai empPortal.token.

   Fix:
   - Override window.ep6cRenderApproval agar selalu menggunakan
     Employee Portal session/token.
   - Tidak memakai state.profile.
   - Queue menggunakan employee_supervisor_queue.
   - Tombol Setujui/Tolak menggunakan employeeApproveLeave().
   - Tidak mengubah database, login, absensi, atau policy cuti.
   ========================================================= */

(function () {
  function phase6cEmployeeApprovalFix() {
    if (typeof window === 'undefined') return;

    window.ep6cRenderApproval = async function () {
      try {
        if (!window.empPortal?.token || !window.empPortal?.employee) {
          if (typeof toast === 'function') {
            toast('Sesi Portal Karyawan tidak ditemukan. Silakan login kembali.', 'error');
          } else {
            alert('Sesi Portal Karyawan tidak ditemukan. Silakan login kembali.');
          }
          return;
        }

        if (typeof window.employeePortalView !== 'function') {
          throw new Error('Modul Approval Tim Employee Portal belum dimuat.');
        }

        await window.employeePortalView('approval');
      } catch (err) {
        console.error('PHASE 6C FINAL APPROVAL FIX:', err);
        const msg = err?.message || String(err);
        if (typeof toast === 'function') toast('Approval Tim gagal dimuat: ' + msg, 'error');
        else alert('Approval Tim gagal dimuat: ' + msg);
      }
    };

    console.log('PHASE 6C FINAL APPROVAL FIX loaded — Employee Portal token/session');
  }

  phase6cEmployeeApprovalFix();
})();
/* =========================================================
   PHASE 6C FINAL — EMPLOYEE PORTAL APPROVAL OVERRIDE
   Fix: jangan gunakan ep6cMyEmployeeId()/state.profile.
   Employee Portal sudah punya session/token yang valid.
   ========================================================= */

(function () {
  async function phase6cFinalApproval() {
    try {
      if (typeof employeePortalView === 'function') {
        await employeePortalView('approval');
        return;
      }

      const box = document.querySelector('#epContent');
      if (!box) throw new Error('Area Employee Portal tidak ditemukan.');

      box.innerHTML = '<div class="card empty">Memuat approval tim...</div>';

      const rows = await empRpc('employee_supervisor_queue');
      box.innerHTML = employeeApprovalHtml(rows || []);
    } catch (err) {
      const box = document.querySelector('#epContent');
      if (box) {
        box.innerHTML =
          '<div class="card"><div class="error">' +
          esc(friendlyError(err)) +
          '</div></div>';
      }
      console.error('PHASE 6C FINAL APPROVAL ERROR:', err);
    }
  }

  /*
   * Tombol Approval Tim Phase 6C lama memanggil window.ep6cRenderApproval().
   * Kita override fungsi tersebut PALING AKHIR agar memakai Employee Portal
   * session/token, bukan state.profile.
   */
  window.ep6cRenderApproval = phase6cFinalApproval;

  console.log(
    'PHASE 6C FINAL APPROVAL OVERRIDE LOADED — uses Employee Portal session'
  );
})();
/* =========================================================
   PHASE 6C FINAL FINAL — APPROVAL BUTTON FIX
   IMPORTANT:
   - The live error is from old FIX 4 at app.js:4062.
   - FIX 4 reads state.profile.employee_id.
   - Employee Portal uses empPortal + empRpc(token).
   - This patch removes the old click listeners by CLONING the
     approval buttons, then calls employeeApproveLeave(), which
     uses empRpc() and the Employee Portal token.
   ========================================================= */

(function () {
  'use strict';

  function phase6cGetRequestId(btn) {
    const raw =
      btn.getAttribute('onclick') ||
      btn.dataset.requestId ||
      '';

    let m = raw.match(
      /(?:employeeApproveLeave|ep6cApprove)\(\s*['"]([^'"]+)['"]/
    );

    if (m) return m[1];

    const row = btn.closest('tr');
    if (!row) return null;

    const html = row.innerHTML || '';
    m = html.match(
      /(?:employeeApproveLeave|ep6cApprove)\(\s*['"]([^'"]+)['"]/
    );

    return m ? m[1] : null;
  }

  function phase6cBindFinalApprovalButtons() {
    document.querySelectorAll('button').forEach(btn => {
      const label = (btn.textContent || '').trim().toLowerCase();

      if (label !== 'setujui' && label !== 'setujui spv' && label !== 'tolak') {
        return;
      }

      if (btn.dataset.phase6cFinalApproval === '1') return;

      const requestId = phase6cGetRequestId(btn);
      if (!requestId) return;

      /*
       * CloneNode creates a clean button without the old FIX 4
       * event listener. This is the critical part.
       */
      const clean = btn.cloneNode(true);

      clean.removeAttribute('onclick');
      clean.dataset.phase6cFinalApproval = '1';
      clean.dataset.requestId = requestId;
      clean.disabled = false;
      clean.style.pointerEvents = 'auto';
      clean.style.cursor = 'pointer';

      clean.addEventListener('click', async function (e) {
        e.preventDefault();
        e.stopImmediatePropagation();

        if (typeof employeeApproveLeave !== 'function') {
          alert('Fungsi approval Employee Portal belum tersedia.');
          return;
        }

        clean.disabled = true;
        const oldText = clean.textContent;
        clean.textContent = 'Memproses...';

        try {
          const decision =
            label === 'tolak' ? 'rejected' : 'approved';

          await employeeApproveLeave(requestId, decision);
        } catch (err) {
          console.error(
            'PHASE 6C FINAL FINAL APPROVAL ERROR:',
            err
          );

          if (typeof toast === 'function') {
            toast(
              typeof friendlyError === 'function'
                ? friendlyError(err)
                : String(err?.message || err),
              'error'
            );
          } else {
            alert(String(err?.message || err));
          }

          clean.disabled = false;
          clean.textContent = oldText;
        }
      });

      btn.replaceWith(clean);
    });
  }

  phase6cBindFinalApprovalButtons();

  const observer = new MutationObserver(
    phase6cBindFinalApprovalButtons
  );

  observer.observe(document.body, {
    childList: true,
    subtree: true
  });

  setInterval(
    phase6cBindFinalApprovalButtons,
    500
  );

  console.log(
    'PHASE 6C FINAL FINAL LOADED — approval buttons use employeeApproveLeave + empRpc token'
  );
})();
/* ============================================================
   PHASE 13C — GOOGLE CALENDAR REVIEW UI
   ============================================================
   Menambahkan review kandidat Google Calendar ke menu Kalender Kerja.
   Tidak mengganti mesin cuti.
   - Approve -> approve_google_calendar_candidate(uuid)
   - Ignore  -> ignore_google_calendar_candidate(uuid)
   ============================================================ */

(function installPhase13CGoogleCalendarReview() {
  'use strict';

  if (window.__PHASE13C_GOOGLE_REVIEW__) {
    console.log('PHASE 13C already loaded.');
    return;
  }
  window.__PHASE13C_GOOGLE_REVIEW__ = true;

  function p13cBadge(status) {
    const s = String(status || '').toLowerCase();
    if (s === 'approved') return '<span class="badge badge-green">Disetujui</span>';
    if (s === 'ignored') return '<span class="badge badge-red">Diabaikan</span>';
    return '<span class="badge badge-yellow">Menunggu Review</span>';
  }

  function p13cDayTypeLabel(v) {
    const x = String(v || '');
    if (x === 'national_holiday') return 'Libur Nasional';
    if (x === 'joint_leave') return 'Cuti Bersama';
    if (x === 'company_holiday') return 'Libur Perusahaan';
    if (x === 'special_workday') return 'Hari Kerja Khusus';
    return x ? x : '—';
  }

  function p13cApplyLabel(v) {
    const x = String(v || '');
    if (x === 'all') return 'Semua';
    if (x === 'office') return 'Office';
    if (x === 'kitchen') return 'Kitchen';
    if (x === 'outlet') return 'Outlet';
    return x || '—';
  }

  function p13cDate(v) {
    if (!v) return '—';
    try {
      return new Date(String(v) + 'T00:00:00').toLocaleDateString('id-ID');
    } catch (_) {
      return String(v);
    }
  }

  async function p13cLoad(year) {
    const { data, error } = await sb
      .from('hr_calendar_reconciliation')
      .select('*')
      .eq('calendar_year', Number(year))
      .order('holiday_date', { ascending: true })
      .order('google_name', { ascending: true });

    if (error) throw error;
    return Array.isArray(data) ? data : [];
  }

  function p13cRender(rows, year) {
    const box = document.querySelector('#phase13cGoogleReview');
    if (!box) return;

    const pending = rows.filter(r => String(r.reconciliation_status) === 'pending');
    const approved = rows.filter(r => String(r.reconciliation_status) === 'approved');
    const ignored = rows.filter(r => String(r.reconciliation_status) === 'ignored');

    if (!rows.length) {
      box.innerHTML = `
        <div class="card empty">
          Tidak ada kandidat Google Calendar untuk tahun ${esc(String(year))}.
        </div>`;
      return;
    }

    box.innerHTML = `
      <div class="card" style="margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap">
          <div>
            <h3 style="margin:0">Review Google Calendar</h3>
            <div class="muted">
              Kandidat tidak otomatis menjadi hari libur. HR harus menyetujui terlebih dahulu.
            </div>
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <span class="badge badge-yellow">Pending ${pending.length}</span>
            <span class="badge badge-green">Disetujui ${approved.length}</span>
            <span class="badge badge-red">Diabaikan ${ignored.length}</span>
          </div>
        </div>
      </div>

      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th>Tanggal</th>
              <th>Event Google</th>
              <th>Tipe Disarankan</th>
              <th>Berlaku Untuk</th>
              <th>Status</th>
              <th>Aksi</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => {
              const status = String(r.reconciliation_status || 'pending');
              const canApprove = status === 'pending' && r.suggested_day_type;
              const canIgnore = status === 'pending';
              return `
                <tr>
                  <td><b>${esc(p13cDate(r.holiday_date))}</b></td>
                  <td>
                    <b>${esc(r.google_name || '-')}</b>
                    ${r.google_holiday_type ? `<div class="muted">${esc(r.google_holiday_type)}</div>` : ''}
                  </td>
                  <td>${esc(p13cDayTypeLabel(r.suggested_day_type))}</td>
                  <td>${esc(p13cApplyLabel(r.suggested_applies_to))}</td>
                  <td>${p13cBadge(status)}</td>
                  <td>
                    ${canApprove
                      ? `<button class="btn btn-primary btn-sm" data-p13c-action="approve" data-id="${esc(r.id)}">✓ Setujui</button>`
                      : ''}
                    ${canIgnore
                      ? `<button class="btn btn-light btn-sm" data-p13c-action="ignore" data-id="${esc(r.id)}">Abaikan</button>`
                      : ''}
                    ${status === 'pending' && !r.suggested_day_type
                      ? `<div class="muted" style="margin-top:5px">Tidak ada tipe otomatis — jangan setujui.</div>`
                      : ''}
                  </td>
                </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  async function p13cRefresh(year) {
    const box = document.querySelector('#phase13cGoogleReview');
    if (!box) return;
    box.innerHTML = `<div class="card empty">Memuat kandidat Google Calendar...</div>`;

    try {
      const rows = await p13cLoad(year);
      p13cRender(rows, year);
    } catch (err) {
      console.error('PHASE 13C load error:', err);
      box.innerHTML = `
        <div class="card">
          <div class="error">${esc(friendlyError(err))}</div>
        </div>`;
    }
  }

  async function p13cAction(id, action, button) {
    if (!id || !action) return;

    const oldText = button ? button.textContent : '';
    if (button) {
      button.disabled = true;
      button.textContent = 'Memproses...';
    }

    try {
      const rpcName = action === 'approve'
        ? 'approve_google_calendar_candidate'
        : 'ignore_google_calendar_candidate';

      const { data, error } = await sb.rpc(rpcName, { p_id: id });
      if (error) throw error;

      toast(
        action === 'approve'
          ? 'Tanggal Google Calendar berhasil disetujui dan masuk Kalender Kerja.'
          : 'Kandidat Google Calendar diabaikan.'
      );

      const year = Number(document.querySelector('#holidayYear')?.value || holidayCalendarYear || new Date().getFullYear());
      await p13cRefresh(year);

      /* Refresh kalender utama agar tanggal yang baru disetujui langsung terlihat. */
      if (action === 'approve' && typeof window.calendarWork === 'function') {
        /* Hindari rekursi: panggil fungsi asli yang sudah disimpan. */
        if (typeof window.__phase13cOriginalCalendarWork === 'function') {
          await window.__phase13cOriginalCalendarWork();
        }
        await p13cRefresh(year);
      }

      return data;
    } catch (err) {
      console.error('PHASE 13C action error:', err);
      toast(friendlyError(err), 'error');
    } finally {
      if (button && document.body.contains(button)) {
        button.disabled = false;
        button.textContent = oldText;
      }
    }
  }

  async function p13cAttachReview() {
    const content = document.querySelector('#content');
    if (!content) return;

    const year = Number(
      document.querySelector('#holidayYear')?.value ||
      holidayCalendarYear ||
      new Date().getFullYear()
    );

    let box = document.querySelector('#phase13cGoogleReview');
    if (!box) {
      content.insertAdjacentHTML('beforeend', `
        <div class="section" id="phase13cGoogleReviewSection">
          <div id="phase13cGoogleReview"></div>
        </div>
      `);
      box = document.querySelector('#phase13cGoogleReview');
    }

    await p13cRefresh(year);
  }

  /* Simpan calendarWork asli sebelum wrapper. */
  if (typeof window.calendarWork === 'function' && !window.__phase13cOriginalCalendarWork) {
    window.__phase13cOriginalCalendarWork = window.calendarWork;
  }

  /* Wrapper: kalender lama tetap jalan, lalu review Google ditambahkan. */
  if (typeof window.__phase13cOriginalCalendarWork === 'function') {
    window.calendarWork = async function() {
      await window.__phase13cOriginalCalendarWork();
      await p13cAttachReview();
    };
  }

  /* Tombol Approve / Ignore menggunakan event delegation. */
  document.addEventListener('click', function(event) {
    const button = event.target.closest('[data-p13c-action][data-id]');
    if (!button) return;

    event.preventDefault();
    event.stopImmediatePropagation();

    p13cAction(
      button.getAttribute('data-id'),
      button.getAttribute('data-p13c-action'),
      button
    );
  }, true);

  console.log('PHASE 13C LOADED — Google Calendar Review UI');
})();
/* ============================================================
   PHASE 13D — ASSIGNMENT STATUS / CURRENT LOCATION FIX
   ============================================================
   Memperbaiki:
   - Penempatan dengan end_date di masa depan tetap Aktif.
   - Outlet Saat Ini mengikuti penempatan yang berlaku hari ini.
   - Riwayat penempatan menampilkan status berdasarkan tanggal hari ini.
   - Index currentByEmp memakai rentang tanggal, bukan hanya end_date NULL.
   Patch-only: append ke akhir app.js. Tidak mengganti source lama.
   ============================================================ */
(function installPhase13DAssignmentPatch() {
  'use strict';
  if (window.__PHASE13D_ASSIGNMENT_PATCH__) {
    console.log('PHASE 13D already loaded.');
    return;
  }
  window.__PHASE13D_ASSIGNMENT_PATCH__ = true;

  function p13dToday() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  }

  function p13dCoversToday(a) {
    if (!a || a.is_active === false || !a.start_date) return false;
    const today = p13dToday();
    return String(a.start_date) <= today && (!a.end_date || String(a.end_date) >= today);
  }

  function p13dLocationName(a) {
    if (!a) return '-';
    if (a.work_location_id) {
      return a.work_locations?.name || state.workLocations.find(w => w.id === a.work_location_id)?.name || '-';
    }
    if (a.branch_id) {
      return a.branches?.name || state.branches.find(b => b.id === a.branch_id)?.name || '-';
    }
    return 'Tidak ada lokasi';
  }

  function p13dCurrentAssignment(empId) {
    return [...(state.assignments || [])]
      .filter(a => a.employee_id === empId && p13dCoversToday(a))
      .sort((a, b) => String(b.start_date).localeCompare(String(a.start_date)))[0] || null;
  }

  function p13dStatus(a) {
    const today = p13dToday();
    if (!a) return { label: 'Belum Mulai', cls: 'badge-yellow' };
    if (a.is_active === false && (!a.end_date || String(a.end_date) >= today)) {
      return { label: 'Nonaktif', cls: 'badge-yellow' };
    }
    if (a.start_date && String(a.start_date) > today) {
      return { label: 'Belum Mulai', cls: 'badge-yellow' };
    }
    if (a.end_date && String(a.end_date) < today) {
      return { label: 'Selesai', cls: 'badge-gray' };
    }
    if (a.is_active !== false) {
      return { label: 'Aktif', cls: 'badge-green' };
    }
    return { label: 'Nonaktif', cls: 'badge-yellow' };
  }

  // Override global helpers used by the existing employee UI.
  window.currentOutletName = function(empId) {
    return p13dLocationName(p13dCurrentAssignment(empId));
  };

  window.assignmentStatus = function(a) {
    return p13dStatus(a);
  };

  // Rebuild the current-placement index using date validity.
  window.rebuildAssignmentIndex = function() {
    const idx = {};
    [...(state.assignments || [])]
      .filter(p13dCoversToday)
      .sort((a, b) => String(b.start_date).localeCompare(String(a.start_date)))
      .forEach(a => {
        if (!idx[a.employee_id]) idx[a.employee_id] = a;
      });
    state.currentByEmp = idx;
  };

  function p13dRefreshIndex() {
    try {
      window.rebuildAssignmentIndex();
    } catch (err) {
      console.warn('PHASE 13D index refresh:', err);
    }
  }

  // Patch the already-open employee detail modal without replacing the original UI.
  function p13dRefreshOpenDetail() {
    const modal = document.querySelector('#detailModal');
    if (!modal) return;

    const title = modal.querySelector('.section-head h2');
    if (!title) return;
    const emp = (state.employees || []).find(e => e.full_name === title.textContent.trim());
    if (!emp) return;

    const current = p13dCurrentAssignment(emp.id);
    const items = [...modal.querySelectorAll('.detail-item')];
    const locationItem = items.find(x => {
      const label = x.querySelector('.muted');
      return label && /^(Outlet|Lokasi) Saat Ini$/i.test(label.textContent.trim());
    });
    if (locationItem) {
      const value = locationItem.children[1];
      if (value) value.textContent = p13dLocationName(current);
    }

    const assignments = [...(state.assignments || [])]
      .filter(a => a.employee_id === emp.id)
      .sort((a, b) => String(b.start_date).localeCompare(String(a.start_date)));
    const trs = [...modal.querySelectorAll('.table tbody tr')];
    trs.forEach((tr, i) => {
      const a = assignments[i];
      if (!a) return;
      const cell = tr.children[3];
      if (!cell) return;
      const st = p13dStatus(a);
      cell.innerHTML = `<span class="badge ${st.cls}">${st.label}</span>`;
    });
  }

  // Wrap employee detail so the visible modal is corrected immediately.
  if (typeof window.showEmployeeDetail === 'function' && !window.__phase13dOriginalShowEmployeeDetail) {
    window.__phase13dOriginalShowEmployeeDetail = window.showEmployeeDetail;
    window.showEmployeeDetail = function(id) {
      const result = window.__phase13dOriginalShowEmployeeDetail(id);
      p13dRefreshIndex();
      p13dRefreshOpenDetail();
      return result;
    };
  }

  p13dRefreshIndex();
  console.log('PHASE 13D LOADED — assignment status/current location fixed');
})();
/* ============================================================
   PHASE 13D FIX — ASSIGNMENT STATUS & CURRENT LOCATION
   ============================================================
   Perbaikan khusus UI:
   - Penempatan 01/09/2026 s/d 31/10/2026 pada 07/10/2026 = Aktif.
   - End date di masa depan TIDAK berarti Nonaktif.
   - Outlet Saat Ini mengikuti penempatan yang berlaku hari ini.
   - Riwayat penempatan menentukan status berdasarkan tanggal hari ini.
   ============================================================ */
(function installPhase13DFix() {
  'use strict';
  if (window.__PHASE13D_FIX__) return;
  window.__PHASE13D_FIX__ = true;

  function todayJakarta() {
    return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Jakarta' });
  }

  function coversToday(a) {
    if (!a || a.is_active === false || !a.start_date) return false;
    const today = todayJakarta();
    return String(a.start_date) <= today && (!a.end_date || String(a.end_date) >= today);
  }

  function locationName(a) {
    if (!a) return '-';
    if (a.work_location_id) {
      return a.work_locations?.name || state.workLocations.find(w => w.id === a.work_location_id)?.name || '-';
    }
    if (a.branch_id) {
      return a.branches?.name || state.branches.find(b => b.id === a.branch_id)?.name || '-';
    }
    return 'Tidak ada lokasi';
  }

  function currentAssignment(empId) {
    return [...(state.assignments || [])]
      .filter(a => a.employee_id === empId && coversToday(a))
      .sort((a,b) => String(b.start_date).localeCompare(String(a.start_date)))[0] || null;
  }

  function status(a) {
    const today = todayJakarta();
    if (!a) return { label: 'Belum Mulai', cls: 'badge-yellow' };
    if (a.start_date && String(a.start_date) > today) return { label: 'Belum Mulai', cls: 'badge-yellow' };
    if (a.end_date && String(a.end_date) < today) return { label: 'Selesai', cls: 'badge-gray' };
    if (a.is_active === false) return { label: 'Nonaktif', cls: 'badge-yellow' };
    return { label: 'Aktif', cls: 'badge-green' };
  }

  function patchOpenDetail() {
    const modal = document.getElementById('detailModal');
    if (!modal) return;
    const title = modal.querySelector('.section-head h2');
    if (!title) return;
    const emp = (state.employees || []).find(e => e.full_name === title.textContent.trim());
    if (!emp) return;

    const current = currentAssignment(emp.id);

    // Perbarui nilai "Lokasi Saat Ini" di detail-grid.
    modal.querySelectorAll('.detail-item').forEach(item => {
      const label = item.querySelector('.muted');
      if (label && /Lokasi Saat Ini/i.test(label.textContent.trim())) {
        const value = item.children[1];
        if (value) value.textContent = locationName(current);
      }
    });

    // Perbaiki status setiap baris riwayat penempatan.
    const assignments = [...(state.assignments || [])]
      .filter(a => a.employee_id === emp.id)
      .sort((a,b) => String(b.start_date).localeCompare(String(a.start_date)));
    const rows = [...modal.querySelectorAll('table tbody tr')];
    rows.forEach((tr, i) => {
      const a = assignments[i];
      if (!a || !tr.children[3]) return;
      const st = status(a);
      tr.children[3].innerHTML = `<span class="badge ${st.cls}">${st.label}</span>`;
    });
  }

  // Fungsi global untuk kebutuhan komponen lain.
  window.phase13dCurrentAssignment = currentAssignment;
  window.phase13dAssignmentStatus = status;
  window.phase13dLocationName = locationName;

  // Bungkus fungsi detail yang asli; setelah modal dibuat, koreksi tampilan.
  if (typeof window.showEmployeeDetail === 'function' && !window.__phase13dFixOriginalDetail) {
    window.__phase13dFixOriginalDetail = window.showEmployeeDetail;
    window.showEmployeeDetail = function(id) {
      const result = window.__phase13dFixOriginalDetail(id);
      setTimeout(patchOpenDetail, 0);
      return result;
    };
  }

  // Jika modal sudah terbuka saat patch dimuat.
  setTimeout(patchOpenDetail, 0);
  console.log('PHASE 13D FIX LOADED — end_date masa depan = Aktif');
})();
