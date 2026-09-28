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
    sb.from('contracts').select('*').order('end_date', { ascending: true }),
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
  const labels = { dashboard: 'Dashboard', employees: 'Karyawan', attendance: 'Absensi', contracts: 'Kontrak', leave: 'Cuti', warnings: 'Teguran / SP', master: 'Master Data' };
  document.querySelector('#app').innerHTML = `<div class="shell"><aside class="sidebar"><div class="logo">HR Employee System</div><div class="nav">${Object.keys(labels).map(v => `<button class="${state.view === v ? 'active' : ''}" data-view="${v}">${labels[v]}</button>`).join('')}</div></aside><main class="main"><div class="topbar"><h1>${title()}</h1><div class="userbox"><span>${esc(state.profile.full_name || state.session.user.email)}</span><span class="avatar">${esc((state.profile.full_name || 'A')[0].toUpperCase())}</span><button id="logout" class="btn btn-light">Keluar</button></div></div><div id="content"></div></main></div>`;
  document.querySelectorAll('[data-view]').forEach(b => b.onclick = () => { state.view = b.dataset.view; renderApp(); });
  $('#logout').onclick = async () => { await sb.auth.signOut(); };
  renderView();
}
window.gotoView = v => { state.view = v; renderApp(); };
function title() { return { dashboard: 'Dashboard', employees: 'Database Karyawan', attendance: 'Absensi Karyawan', contracts: 'Kontrak Karyawan', leave: 'Cuti Karyawan', warnings: 'Surat Teguran / SP', master: 'Master Data' }[state.view]; }
function renderView() {
  clearInterval(state.clockTimer);
  if (state.view === 'attendance') return attendance();
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

    <div class="field field-full"><div class="sub-title" style="margin:8px 0 0">Remunerasi</div></div>
    ${num('base_salary', 'Gaji Pokok')}
    ${num('position_allowance', 'Tunjangan Jabatan')}
    ${num('performance_incentive', 'Insentif Kinerja')}
    ${num('discipline_allowance', 'Tunjangan Kedisiplinan')}
    ${num('meal_allowance', 'Tunjangan Makan')}
    ${num('thr_amount', 'THR')}

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
      base_salary: money('base_salary'),
      position_allowance: money('position_allowance'),
      performance_incentive: money('performance_incentive'),
      discipline_allowance: money('discipline_allowance'),
      meal_allowance: money('meal_allowance'),
      thr_amount: money('thr_amount'),
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
      <th>Karyawan</th><th>No. Dokumen</th><th>Jenis</th><th>Mulai</th><th>Berakhir</th><th>Remunerasi</th><th>Status</th><th>Aksi</th>
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
        <td><div>${moneyFmt(c.base_salary)}</div><div class="muted">${esc(loc)}</div></td>
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
  return !Object.prototype.hasOwnProperty.call(state.profile || {}, 'role') || ['admin','super_admin','hr','hr_admin'].includes(r);
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
