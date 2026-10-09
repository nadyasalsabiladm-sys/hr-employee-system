/*!
 * spv-management.js  (PHASE 20)
 * Panel "Manajemen SPV" untuk akun Admin HR.
 * File ini berdiri sendiri (tanpa library lain) dan memakai client Supabase milik aplikasi Anda.
 *
 * PEMAKAIAN (di dalam app.js, setelah Admin HR login dan kontainernya ada di halaman):
 *   SPVManager.mount({ client: supabaseClientAnda, container: document.getElementById('spv-panel') });
 *
 * Semua data diambil/diubah lewat fungsi database (hr_list_spv_overview, hr_set_spv,
 * hr_set_supervisor). Hak akses diperiksa di database, bukan di file ini.
 */
(function (global) {
  'use strict';

  var STYLE_ID = 'spvm-style';
  var CSS = [
    '.spvm{font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#1e293b}',
    '.spvm *{box-sizing:border-box}',
    '.spvm-bar{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:12px}',
    '.spvm-bar input,.spvm-bar select{height:38px;border:1px solid #cbd5e1;border-radius:8px;padding:0 10px;background:#fff;font:inherit;min-width:0}',
    '.spvm-bar input{flex:1 1 200px}',
    '.spvm-wrap{overflow-x:auto;border:1px solid #e2e8f0;border-radius:10px;background:#fff}',
    '.spvm table{width:100%;border-collapse:collapse;min-width:760px}',
    '.spvm th{background:#f8fafc;text-align:left;font-size:12px;color:#475569;padding:10px 12px;border-bottom:1px solid #e2e8f0;white-space:nowrap}',
    '.spvm td{padding:10px 12px;border-bottom:1px solid #f1f5f9;vertical-align:middle}',
    '.spvm tr:last-child td{border-bottom:0}',
    '.spvm small{color:#64748b;display:block}',
    '.spvm-badge{display:inline-block;border-radius:999px;padding:2px 9px;font-size:12px;font-weight:600;white-space:nowrap}',
    '.spvm-b-spv{background:#d1fae5;color:#065f46}',
    '.spvm-b-emp{background:#e2e8f0;color:#334155}',
    '.spvm-b-adm{background:#dbeafe;color:#1e40af}',
    '.spvm-b-no{background:#fef3c7;color:#92400e}',
    '.spvm-b-off{background:#fee2e2;color:#991b1b}',
    '.spvm button{font:inherit;font-weight:600;border-radius:8px;border:1px solid #cbd5e1;background:#fff;color:#1e293b;padding:7px 12px;cursor:pointer;min-height:36px}',
    '.spvm button:disabled{opacity:.5;cursor:not-allowed}',
    '.spvm button.spvm-pri{background:#185067;border-color:#185067;color:#fff}',
    '.spvm button.spvm-dng{background:#fff;border-color:#fca5a5;color:#b91c1c}',
    '.spvm td select{height:36px;border:1px solid #cbd5e1;border-radius:8px;padding:0 8px;background:#fff;font:inherit;max-width:200px}',
    '.spvm-msg{margin:0 0 12px;padding:10px 12px;border-radius:8px;font-size:13px}',
    '.spvm-ok{background:#ecfdf5;color:#065f46}',
    '.spvm-err{background:#fef2f2;color:#991b1b}',
    '.spvm-empty{padding:24px;text-align:center;color:#64748b}',
    '.spvm-ovl{position:fixed;inset:0;background:rgba(15,23,42,.5);display:flex;align-items:center;justify-content:center;padding:16px;z-index:99999}',
    '.spvm-dlg{background:#fff;border-radius:12px;max-width:440px;width:100%;padding:20px;font:14px/1.5 system-ui,sans-serif;color:#1e293b;max-height:90vh;overflow:auto}',
    '.spvm-dlg h3{margin:0 0 8px;font-size:17px}',
    '.spvm-dlg label{display:block;font-weight:600;margin:12px 0 4px;font-size:13px}',
    '.spvm-dlg input{width:100%;height:38px;border:1px solid #cbd5e1;border-radius:8px;padding:0 10px;font:inherit}',
    '.spvm-dlg .spvm-act{display:flex;gap:8px;justify-content:flex-end;margin-top:18px;flex-wrap:wrap}',
    '.spvm-dlg button{font:inherit;font-weight:600;border-radius:8px;border:1px solid #cbd5e1;background:#fff;padding:8px 14px;cursor:pointer;min-height:38px}',
    '.spvm-dlg button.spvm-pri{background:#185067;border-color:#185067;color:#fff}',
    '.spvm-dlg button.spvm-dng{background:#b91c1c;border-color:#b91c1c;color:#fff}',
    '.spvm-dlg code{background:#f1f5f9;padding:2px 6px;border-radius:6px;user-select:all;word-break:break-all}'
  ].join('');

  // ---------- helper DOM (semua teks lewat textContent -> aman dari XSS) ----------
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) return;
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    });
    (kids || []).forEach(function (c) {
      if (c === null || c === undefined) return;
      el.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return el;
  }

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    var s = document.createElement('style');
    s.id = STYLE_ID;
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function randomPassword() {
    var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
    var buf = new Uint32Array(12);
    crypto.getRandomValues(buf);
    var out = '';
    for (var i = 0; i < buf.length; i++) out += chars[buf[i] % chars.length];
    return out + '#7';
  }

  // ---------- dialog ----------
  function dialog(opts) {
    // opts: {title, body: [nodes], confirmText, confirmClass, onConfirm: async fn -> may throw}
    return new Promise(function (resolve) {
      var errBox = h('div', { class: 'spvm-msg spvm-err', style: 'display:none' });
      var okBtn = h('button', { class: opts.confirmClass || 'spvm-pri', text: opts.confirmText || 'OK' });
      var cancelBtn = h('button', { text: 'Batal' });
      var dlg = h('div', { class: 'spvm-dlg', role: 'dialog', 'aria-modal': 'true' }, [
        h('h3', { text: opts.title })
      ].concat(opts.body || [], [errBox, h('div', { class: 'spvm-act' }, [cancelBtn, okBtn])]));
      var ovl = h('div', { class: 'spvm-ovl' }, [dlg]);

      function close(v) { ovl.remove(); document.removeEventListener('keydown', onKey); resolve(v); }
      function onKey(e) { if (e.key === 'Escape') close(false); }
      document.addEventListener('keydown', onKey);
      cancelBtn.addEventListener('click', function () { close(false); });
      ovl.addEventListener('click', function (e) { if (e.target === ovl) close(false); });
      okBtn.addEventListener('click', async function () {
        okBtn.disabled = true; cancelBtn.disabled = true; errBox.style.display = 'none';
        try {
          var r = opts.onConfirm ? await opts.onConfirm() : true;
          close(r === undefined ? true : r);
        } catch (e) {
          errBox.textContent = (e && e.message) || String(e);
          errBox.style.display = 'block';
          okBtn.disabled = false; cancelBtn.disabled = false;
        }
      });
      document.body.appendChild(ovl);
      var first = dlg.querySelector('input');
      (first || okBtn).focus();
    });
  }

  // ---------- panel ----------
  function mount(config) {
    config = config || {};
    var client = config.client;
    var root = typeof config.container === 'string' ? document.querySelector(config.container) : config.container;
    if (!client || typeof client.rpc !== 'function') throw new Error('SPVManager: "client" Supabase wajib diisi.');
    if (!root) throw new Error('SPVManager: "container" tidak ditemukan.');
    var fnName = config.createAccountFunction || 'create-spv-account';
    ensureStyle();

    var state = { rows: [], q: '', filter: 'all', msg: null, busy: false };

    var msgBox = h('div');
    var search = h('input', { type: 'search', placeholder: 'Cari nama / nomor karyawan', 'aria-label': 'Cari karyawan' });
    var filter = h('select', { 'aria-label': 'Filter' }, [
      h('option', { value: 'all', text: 'Semua karyawan' }),
      h('option', { value: 'spv', text: 'Hanya SPV' }),
      h('option', { value: 'nonspv', text: 'Bukan SPV' }),
      h('option', { value: 'noacc', text: 'Belum punya akun' })
    ]);
    var reload = h('button', { text: 'Muat ulang' });
    var tbody = h('tbody');
    var table = h('table', null, [
      h('thead', null, [h('tr', null, ['Karyawan', 'Akun', 'Atasan langsung', 'Bawahan', 'Aksi'].map(function (t) { return h('th', { text: t }); }))]),
      tbody
    ]);
    var wrap = h('div', { class: 'spvm-wrap' }, [table]);
    var box = h('div', { class: 'spvm' }, [msgBox, h('div', { class: 'spvm-bar' }, [search, filter, reload]), wrap]);
    root.textContent = '';
    root.appendChild(box);

    function flash(text, isErr) {
      state.msg = text ? { text: text, err: !!isErr } : null;
      msgBox.textContent = '';
      if (state.msg) msgBox.appendChild(h('p', { class: 'spvm-msg ' + (isErr ? 'spvm-err' : 'spvm-ok'), role: 'status', text: text }));
    }

    function friendly(err) {
      var m = (err && err.message) || String(err);
      if (/42501|Akses ditolak|permission denied/i.test(m + ((err && err.code) || ''))) return 'Akses ditolak: hanya Admin HR yang boleh mengelola SPV.';
      return m;
    }

    async function rpc(name, args) {
      var r = await client.rpc(name, args);
      if (r.error) { var e = new Error(friendly(r.error)); e.code = r.error.code; throw e; }
      return r.data;
    }

    async function load() {
      reload.disabled = true;
      try {
        state.rows = (await rpc('hr_list_spv_overview')) || [];
        render();
      } catch (e) {
        flash('Gagal memuat data: ' + e.message, true);
        state.rows = []; render();
      }
      reload.disabled = false;
    }

    function visible() {
      var q = state.q.trim().toLowerCase();
      return state.rows.filter(function (r) {
        if (q && ((r.full_name || '') + ' ' + (r.employee_number || '')).toLowerCase().indexOf(q) === -1) return false;
        if (state.filter === 'spv') return r.is_spv;
        if (state.filter === 'nonspv') return !r.is_spv;
        if (state.filter === 'noacc') return !r.has_account;
        return true;
      });
    }

    function spvList() { return state.rows.filter(function (r) { return r.is_spv; }); }

    function accountBadge(r) {
      if (!r.has_account) return h('span', { class: 'spvm-badge spvm-b-no', text: 'Belum punya akun' });
      if (!r.profile_active) return h('span', { class: 'spvm-badge spvm-b-off', text: 'Akun nonaktif' });
      if (r.is_spv) return h('span', { class: 'spvm-badge spvm-b-spv', text: 'SPV' });
      var role = (r.profile_role || '').toLowerCase();
      if (/admin|^hr/.test(role)) return h('span', { class: 'spvm-badge spvm-b-adm', text: 'Admin/HR' });
      return h('span', { class: 'spvm-badge spvm-b-emp', text: 'Karyawan' });
    }

    function supervisorSelect(r) {
      var sel = h('select', { 'aria-label': 'Atasan langsung ' + r.full_name });
      sel.appendChild(h('option', { value: '', text: '- Belum diatur -' }));
      spvList().forEach(function (s) {
        if (s.employee_id === r.employee_id) return;
        sel.appendChild(h('option', { value: s.employee_id, text: s.full_name }));
      });
      // atasan yang tersimpan tapi bukan SPV lagi: tetap tampil agar tidak menyesatkan
      if (r.supervisor_employee_id && !spvList().some(function (s) { return s.employee_id === r.supervisor_employee_id; })) {
        sel.appendChild(h('option', { value: r.supervisor_employee_id, text: (r.supervisor_name || 'Atasan') + ' (bukan SPV)' }));
      }
      sel.value = r.supervisor_employee_id || '';
      sel.addEventListener('change', async function () {
        var wanted = sel.value || null;
        sel.disabled = true;
        try {
          var res = await rpc('hr_set_supervisor', { p_employee_id: r.employee_id, p_supervisor_employee_id: wanted });
          if (!res.ok) { flash(res.message, true); sel.value = r.supervisor_employee_id || ''; }
          else { flash(r.full_name + ': ' + res.message, false); await load(); return; }
        } catch (e) { flash(e.message, true); sel.value = r.supervisor_employee_id || ''; }
        sel.disabled = false;
      });
      return sel;
    }

    async function makeSpv(r) {
      var done = await dialog({
        title: 'Jadikan ' + r.full_name + ' sebagai SPV?',
        body: [h('p', { text: 'Akun ini akan bisa menyetujui cuti bawahannya. Yang bersangkutan perlu login ulang agar perubahan berlaku.' })],
        confirmText: 'Ya, jadikan SPV',
        onConfirm: async function () {
          var res = await rpc('hr_set_spv', { p_employee_id: r.employee_id, p_make_spv: true });
          if (!res.ok) throw new Error(res.message);
          return res;
        }
      });
      if (done) { flash(r.full_name + ' sekarang SPV.', false); await load(); }
    }

    async function revokeSpv(r) {
      var done = await dialog({
        title: 'Cabut status SPV ' + r.full_name + '?',
        body: [h('p', { text: r.subordinate_count > 0
          ? 'SPV ini punya ' + r.subordinate_count + ' bawahan. Jika dilanjutkan, kolom atasan para bawahan akan dikosongkan dan harus diatur ulang.'
          : 'Akun ini kembali menjadi karyawan biasa.' })],
        confirmText: r.subordinate_count > 0 ? 'Cabut & kosongkan atasan bawahan' : 'Ya, cabut SPV',
        confirmClass: 'spvm-dng',
        onConfirm: async function () {
          var res = await rpc('hr_set_spv', { p_employee_id: r.employee_id, p_make_spv: false, p_clear_subordinates: r.subordinate_count > 0 });
          if (!res.ok) throw new Error(res.message);
          return res;
        }
      });
      if (done) { flash('Status SPV ' + r.full_name + ' dicabut.', false); await load(); }
    }

    async function createAccount(r) {
      var email = h('input', { type: 'email', value: r.email || '', autocomplete: 'off', placeholder: 'nama@perusahaan.com' });
      var pass = h('input', { type: 'text', value: randomPassword(), autocomplete: 'off' });
      var asSpv = h('input', { type: 'checkbox', checked: true, style: 'width:auto;height:auto;margin-right:6px' });
      var done = await dialog({
        title: 'Buat akun login untuk ' + r.full_name,
        body: [
          h('label', { text: 'Email login' }), email,
          h('label', { text: 'Password awal (catat dan berikan ke yang bersangkutan)' }), pass,
          h('label', null, [asSpv, 'Langsung jadikan SPV'])
        ],
        confirmText: 'Buat akun',
        onConfirm: async function () {
          var em = email.value.trim(), pw = pass.value;
          if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) throw new Error('Email tidak valid.');
          if (pw.length < 8) throw new Error('Password minimal 8 karakter.');
          var res = await client.functions.invoke(fnName, { body: { employee_id: r.employee_id, email: em, password: pw, make_spv: asSpv.checked } });
          if (res.error) {
            var detail = res.error.message;
            try { var j = await res.error.context.json(); if (j && j.message) detail = j.message; } catch (_) {}
            throw new Error(detail);
          }
          if (!res.data || !res.data.ok) throw new Error((res.data && res.data.message) || 'Gagal membuat akun.');
          return { email: em, password: pw };
        }
      });
      if (done) {
        await dialog({
          title: 'Akun dibuat',
          body: [h('p', null, ['Email: ', h('code', { text: done.email })]), h('p', null, ['Password awal: ', h('code', { text: done.password })]),
                 h('p', { text: 'Password ini tidak ditampilkan lagi. Minta yang bersangkutan menggantinya setelah login.' })],
          confirmText: 'Sudah dicatat'
        });
        flash('Akun untuk ' + r.full_name + ' berhasil dibuat.', false);
        await load();
      }
    }

    function actionCell(r) {
      if (!r.has_account) return h('button', { class: 'spvm-pri', text: 'Buat akun', onclick: function () { createAccount(r); } });
      if (!r.profile_active) return h('span', { text: '-' });
      var role = (r.profile_role || '').toLowerCase();
      if (/admin|^hr/.test(role) && !r.is_spv) return h('span', { text: '-' });
      return r.is_spv
        ? h('button', { class: 'spvm-dng', text: 'Cabut SPV', onclick: function () { revokeSpv(r); } })
        : h('button', { class: 'spvm-pri', text: 'Jadikan SPV', onclick: function () { makeSpv(r); } });
    }

    function render() {
      var rows = visible();
      tbody.textContent = '';
      if (!rows.length) {
        tbody.appendChild(h('tr', null, [h('td', { colspan: '5' }, [h('div', { class: 'spvm-empty', text: 'Tidak ada data yang cocok.' })])]));
        return;
      }
      rows.forEach(function (r) {
        tbody.appendChild(h('tr', null, [
          h('td', null, [h('strong', { text: r.full_name || '-' }), h('small', { text: (r.employee_number || '') + (r.email ? ' · ' + r.email : '') })]),
          h('td', null, [accountBadge(r)]),
          h('td', null, [supervisorSelect(r)]),
          h('td', { text: String(r.subordinate_count || 0) }),
          h('td', null, [actionCell(r)])
        ]));
      });
    }

    search.addEventListener('input', function () { state.q = search.value; render(); });
    filter.addEventListener('change', function () { state.filter = filter.value; render(); });
    reload.addEventListener('click', load);
    load();

    return { reload: load };
  }

  global.SPVManager = { mount: mount };
})(window);
