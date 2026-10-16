/* ═══════════════════════════════════════════════════════════
   LOS FILTROS HUB — core
   Shared helpers, roles & section access, sidebar counts,
   Quick add, and the Dashboard.

   DATA SAFETY: this file and the other hub-*.js modules only
   READ the original tables (employees, monthly_records,
   time_off_log, imported_periods, audit_log, app_settings,
   catering_orders, fcr_*). Everything they write goes to the
   new tables created by sql/2026-10-hub-v2.sql.
   ═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const H = (window.H = window.H || {});
  H.pages = {};

  // ── formatting ────────────────────────────────────────────
  H.esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  H.money = (n, cents) => (n == null || isNaN(n)) ? '—' : (n < 0 ? '-' : '') + '$' + Math.abs(+n).toLocaleString('en-US', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: cents ? 2 : 0 });
  H.pct = (n, d = 1) => (n == null || isNaN(n)) ? '—' : (+n).toFixed(d) + '%';
  H.num = (n, d = 0) => (n == null || isNaN(n)) ? '—' : (+n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  H.prNow = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Puerto_Rico' }));
  H.iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  H.today = () => H.iso(H.prNow());
  H.d = s => { if (!s) return null; const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null; };
  H.addDays = (iso, n) => { const d = H.d(iso); d.setDate(d.getDate() + n); return H.iso(d); };
  H.daysBetween = (a, b) => Math.round((H.d(b) - H.d(a)) / 86400000);
  H.fmtD = (iso, o) => { const d = H.d(iso); return d ? d.toLocaleDateString('en-US', o || { month: 'short', day: 'numeric' }) : '—'; };
  H.fmtDT = ts => { if (!ts) return '—'; const d = new Date(ts); return d.toLocaleString('en-US', { timeZone: 'America/Puerto_Rico', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }); };
  H.fmtTime = ts => { if (!ts) return ''; return new Date(ts).toLocaleTimeString('en-US', { timeZone: 'America/Puerto_Rico', hour: 'numeric', minute: '2-digit' }); };
  H.isoOfTs = ts => ts ? H.iso(new Date(new Date(ts).toLocaleString('en-US', { timeZone: 'America/Puerto_Rico' }))) : null;
  H.monthKey = iso => String(iso).slice(0, 7);
  H.addMonths = (key, n) => { const [y, m] = key.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  H.monthEnd = key => { const [y, m] = key.split('-').map(Number); return H.iso(new Date(y, m, 0)); };
  H.longD = iso => H.fmtD(iso, { month: 'short', day: 'numeric', year: 'numeric' });
  // Days the restaurant is closed: Sundays, Thanksgiving, Christmas
  H.storeClosed = iso => { const d = H.d(iso); return d.getDay() === 0 || (d.getMonth() === 11 && d.getDate() === 25) || (d.getMonth() === 10 && d.getDay() === 4 && d.getDate() >= 22 && d.getDate() <= 28); };
  H.monthLabel = (key, long) => { const [y, m] = key.split('-'); return new Date(+y, +m - 1, 1).toLocaleDateString('en-US', { month: long ? 'long' : 'short', year: 'numeric' }); };
  H.lyKey = key => { const [y, m] = key.split('-'); return `${+y - 1}-${m}`; };
  H.initials = n => { const p = String(n || '').replace(/@.*/, '').split(/[\s._-]+/).filter(Boolean); return ((p[0] || '?')[0] + ((p[1] || '')[0] || '')).toUpperCase(); };
  H.shortName = n => { const p = String(n || '').trim().split(/\s+/); return p.length > 1 ? `${p[0]} ${p[1][0]}.` : (p[0] || ''); };
  H.delta = (cur, prev, goodUp = true, unit = '%') => {
    if (cur == null || prev == null || isNaN(cur) || isNaN(prev) || prev === 0) return '';
    const diff = unit === 'pts' ? cur - prev : ((cur - prev) / Math.abs(prev)) * 100;
    const good = goodUp ? diff >= 0 : diff <= 0;
    const txt = (diff >= 0 ? '+' : '') + diff.toFixed(1) + (unit === 'pts' ? ' pts' : '%');
    return `<span style="color:${good ? 'var(--ok)' : 'var(--bad)'};font-weight:600">${txt}</span>`;
  };

  // ── icons ─────────────────────────────────────────────────
  const ICONS = {
    alert: '<path d="M12 4 2.8 19.5h18.4z"/><path d="M12 10v4M12 17v.5"/>',
    dollar: '<circle cx="12" cy="12" r="8.5"/><path d="M14.5 9.2c-.6-.8-1.5-1.2-2.5-1.2-1.4 0-2.5.8-2.5 2s1.1 1.6 2.5 2 2.5.8 2.5 2-1.1 2-2.5 2c-1.1 0-2-.4-2.6-1.2M12 6.5V8M12 16v1.5"/>',
    drop: '<path d="M12 3.5s6 6.5 6 10.5a6 6 0 0 1-12 0c0-4 6-10.5 6-10.5z"/>',
    wrench: '<path d="M14.5 6.5a4 4 0 0 0 5 5L12 19a2.1 2.1 0 0 1-3-3z"/><path d="M14.5 6.5 17 4l3 3-2.5 2.5"/>',
    tray: '<path d="M3.5 16.5h17"/><path d="M5 16.5a7 7 0 0 1 14 0"/><path d="M12 7.5V6"/>',
    people: '<circle cx="9" cy="8" r="3.2"/><path d="M3.5 19c.6-3.2 2.8-5 5.5-5s4.9 1.8 5.5 5"/><circle cx="17" cy="9" r="2.5"/><path d="M15.8 14.2c2.3.2 4 1.8 4.6 4.8"/>',
    chat: '<path d="M4 5.5h16v10H9l-5 4z"/>',
    flag: '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
    pen: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    image: '<rect x="3.5" y="5" width="17" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="m4 17 5-5 4 4 2.5-2.5L20 17"/>',
    cal: '<rect x="3.5" y="5" width="17" height="15" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
    clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
    import: '<path d="M12 4v11"/><path d="m7.5 10.5 4.5 4.5 4.5-4.5"/><path d="M4.5 16.5V20h15v-3.5"/>',
    trend: '<path d="M3.5 19.5h17"/><path d="m5 15 4.5-4.5 3.5 3L19 7.5"/>',
    star: '<path d="m12 4 2.4 5 5.4.7-4 3.8 1 5.4L12 16.3 7.2 18.9l1-5.4-4-3.8 5.4-.7z"/>',
    heart: '<path d="M12 19.5s-7.5-4.5-7.5-10A4.2 4.2 0 0 1 12 7a4.2 4.2 0 0 1 7.5 2.5c0 5.5-7.5 10-7.5 10z"/>',
    check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    meal: '<path d="M7 3v8M5 3v5a2 2 0 0 0 4 0V3M7 11v10"/><path d="M16.5 21V3c-2 1.2-3 4-3 7.5h3"/>',
  };
  H.icon = (n, cls = '') => `<span class="ico ${cls}"><svg viewBox="0 0 24 24">${ICONS[n] || ICONS.alert}</svg></span>`;
  H.svg = n => `<svg viewBox="0 0 24 24">${ICONS[n] || ''}</svg>`;

  // ── toast + modal + forms ─────────────────────────────────
  H.toast = msg => {
    const t = document.getElementById('hubToast'); if (!t) return;
    t.textContent = msg; t.style.display = 'block';
    clearTimeout(t._t); t._t = setTimeout(() => { t.style.display = 'none'; }, 2800);
  };
  H.modal = (html, wide) => {
    const body = document.getElementById('hubModalBody');
    body.className = 'modal' + (wide ? ' wide' : '');
    body.innerHTML = html;
    document.getElementById('hubModal').classList.add('open');
    const f = body.querySelector('input,select,textarea'); if (f) setTimeout(() => f.focus(), 60);
  };
  H.closeModal = () => document.getElementById('hubModal').classList.remove('open');
  document.addEventListener('keydown', e => { if (e.key === 'Escape') H.closeModal(); });
  document.addEventListener('click', e => {
    const ov = document.getElementById('hubModal'); if (e.target === ov) H.closeModal();
  });

  // form({title, intro, fields, submit, onSubmit(values) -> truthy to close, extraButtons})
  H.form = opts => {
    const f = opts.fields.map(fd => {
      const id = 'hf_' + fd.id;
      const req = fd.required ? ' required' : '';
      const val = fd.value == null ? '' : fd.value;
      let input;
      if (fd.type === 'select') {
        input = `<select id="${id}"${req}>${(fd.options || []).map(o => { const ov = typeof o === 'object' ? o.value : o; const ol = typeof o === 'object' ? o.label : o; return `<option value="${H.esc(ov)}"${String(ov) === String(val) ? ' selected' : ''}>${H.esc(ol)}</option>`; }).join('')}</select>`;
      } else if (fd.type === 'textarea') {
        input = `<textarea id="${id}" placeholder="${H.esc(fd.placeholder || '')}"${req}>${H.esc(val)}</textarea>`;
      } else if (fd.type === 'file') {
        input = `<input id="${id}" type="file" accept="${H.esc(fd.accept || '')}"/>`;
      } else {
        input = `<input id="${id}" type="${fd.type || 'text'}" value="${H.esc(val)}" placeholder="${H.esc(fd.placeholder || '')}"${fd.step ? ` step="${fd.step}"` : ''}${fd.list ? ` list="${id}_dl"` : ''}${req}/>` +
          (fd.list ? `<datalist id="${id}_dl">${fd.list.map(x => `<option value="${H.esc(x)}">`).join('')}</datalist>` : '');
      }
      return `<div class="field" style="${fd.half ? '' : 'grid-column:1/-1'}"><label for="${id}">${H.esc(fd.label)}${fd.required ? '' : ' <span class="muted" style="font-weight:400">(optional)</span>'}</label>${input}${fd.help ? `<div class="help">${H.esc(fd.help)}</div>` : ''}</div>`;
    }).join('');
    H.modal(`<h3>${H.esc(opts.title)}</h3>${opts.intro ? `<p class="muted small" style="margin:-10px 0 16px">${H.esc(opts.intro)}</p>` : ''}
      <form id="hubForm" novalidate><div class="frow" style="margin:0;row-gap:12px">${f}</div>
      <div id="hubFormErr" class="login-err" style="margin-top:12px"></div>
      <div class="mfooter">${opts.extraButtons || ''}<button type="button" class="btn" onclick="H.closeModal()">Cancel</button><button type="submit" class="btn btn-primary" id="hubFormSubmit">${H.esc(opts.submit || 'Save')}</button></div></form>`, opts.wide);
    document.getElementById('hubForm').onsubmit = async e => {
      e.preventDefault();
      const vals = {}; const err = document.getElementById('hubFormErr'); err.style.display = 'none';
      for (const fd of opts.fields) {
        const el = document.getElementById('hf_' + fd.id);
        let v = fd.type === 'file' ? (el.files && el.files[0]) || null : el.value.trim();
        if (fd.type === 'number' && v !== '') v = +v;
        if (v === '') v = null;
        if (fd.required && (v == null)) { err.textContent = `${fd.label} is required.`; err.style.display = 'block'; el.focus(); return; }
        vals[fd.id] = v;
      }
      const btn = document.getElementById('hubFormSubmit'); btn.disabled = true;
      try { const ok = await opts.onSubmit(vals); if (ok !== false) H.closeModal(); }
      catch (ex) { err.textContent = ex.message || String(ex); err.style.display = 'block'; }
      finally { btn.disabled = false; }
    };
  };
  H.confirm = (title, text, yesLabel, onYes, danger) => {
    H.modal(`<h3>${H.esc(title)}</h3><p class="muted" style="margin-top:-8px">${H.esc(text)}</p>
      <div class="mfooter"><button class="btn" onclick="H.closeModal()">Cancel</button><button class="btn ${danger ? 'btn-primary' : 'btn-dark'}" id="hubYes">${H.esc(yesLabel)}</button></div>`);
    document.getElementById('hubYes').onclick = async () => { await onYes(); H.closeModal(); };
  };

  // ── database (new tables only) ────────────────────────────
  const cache = {};
  H.db = {
    async list(table, o = {}) {
      const key = table + JSON.stringify(o);
      if (o.cache !== false && cache[key] && Date.now() - cache[key].t < 30000) return cache[key].d;
      let q = getSupa().from(table).select(o.select || '*');
      if (o.eq) for (const [c, v] of Object.entries(o.eq)) q = q.eq(c, v);
      if (o.gte) for (const [c, v] of Object.entries(o.gte)) q = q.gte(c, v);
      if (o.order) q = q.order(o.order, { ascending: o.asc !== false });
      if (o.limit) q = q.limit(o.limit);
      const { data, error } = await q;
      if (error) { console.warn(`[hub] read ${table} failed:`, error.message); H.db.lastError = { table, message: error.message }; return null; }
      cache[key] = { t: Date.now(), d: data || [] };
      return data || [];
    },
    // Every matching row, 1,000 at a time (Supabase returns at most 1,000 per request).
    async all(table, o = {}) {
      const out = [];
      for (let i = 0; i < 100; i++) {
        let q = getSupa().from(table).select('*');
        if (o.eq) for (const [c, v] of Object.entries(o.eq)) q = q.eq(c, v);
        if (o.gte) for (const [c, v] of Object.entries(o.gte)) q = q.gte(c, v);
        if (o.lte) for (const [c, v] of Object.entries(o.lte)) q = q.lte(c, v);
        for (const c of (o.order || ['id'])) q = q.order(c, { ascending: true });
        const { data, error } = await q.range(i * 1000, i * 1000 + 999);
        if (error) { console.warn(`[hub] read ${table} failed:`, error.message); return null; }
        out.push(...(data || [])); if (!data || data.length < 1000) break;
      }
      return out;
    },
    bust(table) { for (const k of Object.keys(cache)) if (k.startsWith(table)) delete cache[k]; },
    async insert(table, row) {
      const { data, error } = await getSupa().from(table).insert(row).select().single();
      if (error) throw new Error(`Could not save (${error.message})`);
      H.db.bust(table); return data;
    },
    async update(table, id, patch) {
      const { data, error } = await getSupa().from(table).update(patch).eq('id', id).select().single();
      if (error) throw new Error(`Could not save (${error.message})`);
      H.db.bust(table); return data;
    },
    async upsert(table, rows, onConflict) {
      const { data, error } = await getSupa().from(table).upsert(rows, { onConflict }).select();
      if (error) throw new Error(`Could not save (${error.message})`);
      H.db.bust(table); return data;
    },
    async remove(table, id) {
      const { error } = await getSupa().from(table).delete().eq('id', id);
      if (error) throw new Error(`Could not delete (${error.message})`);
      H.db.bust(table); return true;
    },
  };
  // currentUser is a top-level `let` in app.js, so it is not on window — read it directly.
  H.user = () => { try { return typeof currentUser !== 'undefined' ? currentUser : null; } catch (e) { return null; } };
  H.who = () => ((H.user() || {}).name || (H.user() || {}).pin) || 'Unknown';

  // employees from the existing hub data (read-only)
  H.employees = (includeInactive) => {
    try {
      return Object.values(EMPLOYEES)
        .filter(e => includeInactive || (e.status || 'active') === 'active')
        .map(e => ({ id: e.supabase_id || null, name: e.name, status: e.status || 'active', firstClockIn: e.firstClockIn }))
        .sort((a, b) => a.name.localeCompare(b.name));
    } catch (e) { return []; }
  };
  H.empOptions = (blank = 'Select team member…') => [{ value: '', label: blank }, ...H.employees().map(e => ({ value: e.name, label: e.name }))];
  H.empIdByName = name => (H.employees(true).find(e => e.name === name) || {}).id || null;

  // targets (stored in hub_targets; defaults until set)
  H.TARGET_DEFAULTS = { bonus_est_wage: 11, bonus_over20: 1, bonus_first_year: 1, food_cost_pct: 30.5, splh_target: 80, labor_pct: 25, infraction_dropoff_days: 90, infraction_written_at: 4, infraction_final_at: 6 };
  H.targets = async () => {
    const rows = await H.db.list('hub_targets');
    const t = { ...H.TARGET_DEFAULTS };
    (rows || []).forEach(r => { if (r.value != null) t[r.key] = +r.value; });
    return t;
  };
  H.setTarget = async (key, value) => { await H.db.upsert('hub_targets', [{ key, value, updated_at: new Date().toISOString(), updated_by: H.who() }], 'key'); };

  // ── roles & sections ──────────────────────────────────────
  // Sections in sidebar order.
  const ALL = ['home', 'calendar', 'equipment', 'quality', 'sales', 'foodcost', 'productivity', 'pl', 'cash', 'recon', 'fcr', 'dashboard', 'bonus', 'staffing', 'infractions', 'meals', 'access', 'catering', 'marketing', 'reputation'];
  const EVERYONE = ['home']; // anyone with access to the hub (Calendar can be ticked on or off per person)
  H.SECTIONS = ALL;
  H.SECTION_LABELS = { bonus: 'Christmas bonus', home: 'Home', calendar: 'Calendar', quality: 'Speed & quality', sales: 'Sales', pl: 'Monthly P&L', cash: 'Cash', equipment: 'Equipment', foodcost: 'Food cost', productivity: 'Productivity', recon: 'Reconciliation', fcr: 'FCR trends', staffing: 'Staffing', infractions: 'Infractions', dashboard: 'Leave balances', import: 'Import hours', recordto: 'Record time-off', meals: 'Meal penalties', access: 'Users & access', catering: 'Catering', marketing: 'Marketing', reputation: 'Reputación' };
  H.ROLE_LABELS = { operator: 'Operator', admin: 'Operator', director: 'Director', shift_leader: 'Shift leader', marketing: 'Marketing', team_member: 'Team member' };
  H.ROLE_DEFAULTS = {
    operator: ALL,
    director: ALL.filter(s => !['fcr', 'access', 'recon', 'pl'].includes(s)),
    shift_leader: ['home', 'calendar', 'equipment', 'quality', 'dashboard', 'infractions', 'catering'],
    marketing: ['home', 'calendar', 'catering', 'marketing', 'reputation'],
    team_member: [],
  };
  const OPERATOR_ONLY = ['fcr', 'access', 'pl', 'bonus'];
  H.normRole = r => { const x = String(r || '').trim().toLowerCase().replace(/[\s-]+/g, '_'); return (!x || x === 'admin') ? 'operator' : x; };
  H.realRole = () => H.normRole((H.user() || {}).role);
  H.viewAs = null;
  H.role = () => H.viewAs || H.realRole();
  H.isOperator = () => H.role() === 'operator';
  H.sectionsFor = (role, custom) => {
    role = H.normRole(role);
    let s = Array.isArray(custom) && custom.length ? custom.slice() : (H.ROLE_DEFAULTS[role] || []).slice();
    if (role !== 'operator') s = s.filter(x => !OPERATOR_ONLY.includes(x));
    if (s.length) s.push(...EVERYONE);
    return ALL.filter(x => s.includes(x));
  };
  H.visible = () => H.viewAs ? H.sectionsFor(H.viewAs) : H.sectionsFor(H.realRole(), (H.user() || {}).sections);

  window.hubCanSee = t => {
    if (!H.user()) return true;
    if (t === 'import' || t === 'recordto' || t === 'timeoff') t = 'dashboard';
    if (!ALL.includes(t)) return H.isOperator(); // legacy hidden tabs: operator only
    return H.visible().includes(t);
  };
  // First page after sign-in: Home (welcome, snapshot, news, what's coming up).
  window.hubLanding = () => { const v = H.visible(); return v.includes('home') ? 'home' : v.includes('dashboard') ? 'dashboard' : (v[0] || 'dashboard'); };
  // Sub-tabs inside Leave balances: Balances · Import hours · Record time-off
  window.hubLbTab = name => {
    if (!document.getElementById('lbView-' + name)) name = 'balances';
    document.querySelectorAll('#p-dashboard .subtab').forEach(b => b.classList.toggle('active', b.dataset.lb === name));
    ['balances', 'import', 'recordto'].forEach(v => { const el = document.getElementById('lbView-' + v); if (el) el.hidden = v !== name; });
    if (name === 'recordto' && typeof populateEmployeeDropdowns === 'function') populateEmployeeDropdowns();
  };

  // Sidebar items are <a> without href: make them reachable and usable from the keyboard.
  document.querySelectorAll('#adminTabNav .tab').forEach(el => {
    el.tabIndex = 0; el.setAttribute('role', 'link');
    el.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); el.click(); } });
  });

  function applyNav() {
    const vis = H.visible();
    document.querySelectorAll('#adminTabNav .tab').forEach(a => {
      const t = a.id.replace(/^t-/, '');
      if (a.dataset.legacy) return;
      a.style.display = vis.includes(t) ? '' : 'none';
    });
    // hide group labels whose items are all hidden
    document.querySelectorAll('#adminTabNav .nav-group').forEach(g => {
      let el = g.nextElementSibling, any = false;
      while (el && !el.classList.contains('nav-group')) { if (el.classList.contains('tab') && el.style.display !== 'none') any = true; el = el.nextElementSibling; }
      g.style.display = any ? '' : 'none';
    });
    const fcr = document.querySelector('#t-fcr .count'); if (fcr) { fcr.textContent = ''; }
  }

  window.hubOnLogin = user => {
    H.viewAs = null;
    const role = H.realRole();
    document.getElementById('navUser').textContent = user.name || user.pin || '';
    document.getElementById('navRolePill').textContent = H.ROLE_LABELS[role] || role;
    document.getElementById('navAvatar').textContent = H.initials(user.name || user.pin);
    document.getElementById('sbViewWrap').style.display = role === 'operator' ? '' : 'none';
    const sel = document.getElementById('sbViewAs'); if (sel) sel.value = 'operator';
    document.getElementById('topDate').textContent = H.prNow().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
    applyNav();
    hubRefreshCounts();
  };
  window.hubSetViewAs = role => {
    H.viewAs = role === 'operator' ? null : role;
    applyNav();
    H.toast(role === 'operator' ? 'Back to your own view' : `Viewing the hub as ${H.ROLE_LABELS[role]} would see it`);
    hubRefreshCounts();
    const cur = (document.querySelector('.page.active') || {}).id || 'p-home';
    goTab(hubCanSee(cur.replace('p-', '')) ? cur.replace('p-', '') : hubLanding());
  };

  window.hubOnTab = t => {
    if (t === 'dashboard') { hubLbTab(window._hubLbSub || 'balances'); window._hubLbSub = null; }
    const p = H.pages[t];
    if (p && p.render) {
      Promise.resolve(p.render(document.getElementById(t + 'App'))).catch(err => {
        console.error(err);
        const host = document.getElementById(t + 'App');
        if (host) host.innerHTML = `<div class="source warn">This page could not load: ${H.esc(err.message)}</div>`;
      });
    }
    if (t === 'fcr') {
      const app = document.getElementById('fcrApp');
      if (app && !document.getElementById('fcrPh')) app.insertAdjacentHTML('beforebegin', '<div class="ph" id="fcrPh"><div><h2>FCR trends <span class="pill dark" style="vertical-align:middle;margin-left:6px">Operator only</span></h2><p>Month-over-month review of your Financial Control Reports with contractual checks.</p></div></div>');
    }
  };

  // ── sidebar counts ────────────────────────────────────────
  window.hubRefreshCounts = async () => {
    const set = (t, n, alert) => { const el = document.getElementById('cnt-' + t); if (!el) return; el.textContent = n > 0 ? n : ''; el.classList.toggle('hot', !!alert && n > 0); };
    try {
      const cat = window._hubCatering || await H.db.list('catering_orders');
      if (cat) set('catering', cat.filter(o => o.follow_up_status !== 'Completed').length, true);
    } catch (e) {}
    const vis = H.visible();
    for (const [t, p] of Object.entries(H.pages)) {
      if (!p.count || !vis.includes(t)) continue;
      try { const r = await p.count(); if (r) set(t, r.n, r.alert); } catch (e) {}
    }
  };

  // simple SVG bar/line chart helpers used by several pages
  // min: value at the bottom of the axis (use it when differences are small, e.g. food cost %)
  H.barChart = ({ labels, series, height = 180, fmt = v => v, target, min = 0 }) => {
    const W = 640, Hh = height, padL = 44, padB = 24, padT = 10;
    const all = series.flatMap(s => s.values.filter(v => v != null));
    if (target != null) all.push(target);
    const top = Math.max(min + 1, ...all);
    const max = top + (top - min) * 0.12;
    const n = labels.length, groupW = (W - padL - 8) / Math.max(n, 1), bw = Math.min(26, (groupW - 8) / series.length);
    const y = v => padT + (Hh - padT - padB) * (1 - (Math.max(v, min) - min) / (max - min));
    let g = `<g class="grid">`;
    for (let i = 0; i <= 4; i++) { const v = min + (max - min) * i / 4; g += `<line x1="${padL}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/><text x="${padL - 6}" y="${y(v) + 4}" text-anchor="end">${fmt(v)}</text>`; }
    g += '</g>';
    let bars = '';
    labels.forEach((lb, i) => {
      const gx = padL + i * groupW + (groupW - bw * series.length) / 2;
      series.forEach((s, j) => { const v = s.values[i]; if (v == null) return; bars += `<rect x="${gx + j * bw}" y="${y(v)}" width="${bw - 2}" height="${Math.max(0, Hh - padB - y(v))}" rx="3" fill="${s.color}"><title>${H.esc(s.name)} · ${H.esc(lb)}: ${fmt(v)}</title></rect>`; });
      bars += `<text x="${padL + i * groupW + groupW / 2}" y="${Hh - 6}" text-anchor="middle">${H.esc(lb)}</text>`;
    });
    const tl = target != null ? `<line x1="${padL}" x2="${W}" y1="${y(target)}" y2="${y(target)}" stroke="var(--ok)" stroke-dasharray="4 4" stroke-width="1.5"/>` : '';
    return `<svg class="chart" viewBox="0 0 ${W} ${Hh}" role="img">${g}${bars}${tl}</svg>
      <div class="legend">${series.map(s => `<span><i style="background:${s.color}"></i>${H.esc(s.name)}</span>`).join('')}${target != null ? '<span><i style="background:var(--ok)"></i>Target</span>' : ''}</div>`;
  };
  H.spark = (vals, color = 'var(--foh)', w = 120, h = 34) => {
    const v = vals.filter(x => x != null); if (v.length < 2) return '';
    const mn = Math.min(...v), mx = Math.max(...v), r = mx - mn || 1;
    const pts = v.map((x, i) => `${(i / (v.length - 1)) * (w - 4) + 2},${h - 3 - ((x - mn) / r) * (h - 6)}`).join(' ');
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  };

  // paste-import helper: accepts CSV (with header row) or JSON array
  H.parseRows = text => {
    text = String(text || '').trim(); if (!text) return [];
    if (text[0] === '[' || text[0] === '{') { const j = JSON.parse(text); return Array.isArray(j) ? j : [j]; }
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    const split = l => { const out = []; let cur = '', q = false; for (const ch of l) { if (ch === '"') q = !q; else if ((ch === ',' || ch === '\t') && !q) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map(s => s.trim()); };
    const hdr = split(lines[0]).map(h => h.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''));
    return lines.slice(1).map(l => { const c = split(l); const o = {}; hdr.forEach((h, i) => { o[h] = c[i]; }); return o; });
  };
  H.toNum = v => { if (v == null || v === '') return null; const n = parseFloat(String(v).replace(/[$,%\s]/g, '')); return isNaN(n) ? null : n; };
  H.toISO = v => {
    if (!v) return null; const s = String(v).trim();
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/); if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/); if (m) return `${m[3].length === 2 ? '20' + m[3] : m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
    m = s.match(/^(\d{4})-(\d{1,2})$/); if (m) return `${m[1]}-${m[2].padStart(2, '0')}-01`;
    return null;
  };
  H.missingTable = (host, table) => {
    host.innerHTML += `<div class="source warn mt"><span>The <strong>${H.esc(table)}</strong> table isn't set up yet. Run <code>sql/2026-10-hub-v2.sql</code> once in the Supabase SQL editor, then reload.</span></div>`;
  };
})();
