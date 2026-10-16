// Los Filtros Hub — CHECK MODE (read-only). Open the site with ?check=1 to turn it on for this tab, ?check=0 to turn it off.
// While it's on, nothing can be saved anywhere: every database insert/update/upsert/delete, file upload, Supabase
// function call and local cache write is stopped before it leaves the browser. Reading and signing in still work,
// so the new hub can be tested against the real data with zero risk. Loaded right after supabase-js, before app.js.
(function () {
  const qs = new URLSearchParams(location.search);
  try { if (qs.get('check') === '1') sessionStorage.setItem('hubCheck', '1'); if (qs.get('check') === '0') sessionStorage.removeItem('hubCheck'); } catch (e) {}
  let on = false; try { on = sessionStorage.getItem('hubCheck') === '1'; } catch (e) {}
  window.HUB_CHECK = on;
  if (!on) return;
  const blocked = window.__checkBlocked = [];
  const note = what => { blocked.push({ what, at: new Date().toISOString() }); console.info('[check mode] blocked:', what); };
  const ERR = { message: 'Check mode: saving is turned off' };

  // A query builder that never sends anything: every chained call returns itself, and awaiting it gives an error.
  const dead = what => { note(what); const p = new Proxy(function () {}, { get(_, k) { if (k === 'then') return (res, rej) => Promise.resolve({ data: null, error: ERR, count: null }).then(res, rej); return () => p; }, apply() { return p; } }); return p; };

  const lib = window.supabase;
  if (lib && lib.createClient) {
    const real = lib.createClient.bind(lib);
    lib.createClient = (...args) => {
      const c = real(...args);
      const wrapFrom = t => {
        const b = c.from(t);
        return new Proxy(b, { get(target, k) {
          if (['insert', 'update', 'upsert', 'delete'].includes(k)) return () => dead(`${k} ${t}`);
          const v = target[k]; return typeof v === 'function' ? v.bind(target) : v;
        } });
      };
      return new Proxy(c, { get(target, k) {
        if (k === 'from') return wrapFrom;
        if (k === 'rpc') return name => dead(`rpc ${name}`);
        if (k === 'functions') return { invoke: name => dead(`function ${name}`) };
        if (k === 'storage') return { from: bucket => ({ upload: () => dead(`upload to ${bucket}`), remove: () => dead(`remove from ${bucket}`), update: () => dead(`update in ${bucket}`), move: () => dead(`move in ${bucket}`), getPublicUrl: (...a) => target.storage.from(bucket).getPublicUrl(...a), list: (...a) => target.storage.from(bucket).list(...a) }) };
        const v = target[k]; return typeof v === 'function' ? v.bind(target) : v;
      } });
    };
  }
  // Direct calls: Supabase functions (Claude proxy, Slack notices) and any non-GET REST call
  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = String(typeof input === 'string' ? input : input && input.url), method = String((init && init.method) || (input && input.method) || 'GET').toUpperCase();
    if (/\/functions\/v1\//.test(url) || (/\/rest\/v1\//.test(url) && method !== 'GET' && method !== 'HEAD')) {
      note(`${method} ${url.replace(/^https?:\/\/[^/]+/, '')}`);
      return Promise.resolve(new Response(JSON.stringify(ERR), { status: 403, headers: { 'Content-Type': 'application/json' } }));
    }
    return realFetch(input, init);
  };
  // The old pages keep a copy of the team in this browser's storage, shared with the live site: leave it untouched
  const realSet = Storage.prototype.setItem, realRemove = Storage.prototype.removeItem;
  const guarded = k => /^(cfa_|wu_|rep_)/.test(String(k));
  Storage.prototype.setItem = function (k, v) { if (this === window.localStorage && guarded(k)) return note(`browser copy ${k}`); return realSet.call(this, k, v); };
  Storage.prototype.removeItem = function (k) { if (this === window.localStorage && guarded(k)) return note(`browser copy remove ${k}`); return realRemove.call(this, k); };
  // Old pages also ask before some actions; nothing they'd do can be saved anyway
  window.addEventListener('error', e => (window.__checkErrors = window.__checkErrors || []).push(String(e.message || e.error)));
  window.addEventListener('unhandledrejection', e => (window.__checkErrors = window.__checkErrors || []).push(String((e.reason && e.reason.message) || e.reason)));

  document.addEventListener('DOMContentLoaded', () => {
    const bar = document.createElement('div');
    bar.id = 'checkBar';
    bar.innerHTML = `<strong>Check mode</strong><span>Nothing can be saved. Everything you see is your real data, read only.</span><button class="btn btn-sm" onclick="hubRunCheck()">Run system check</button><a class="btn btn-sm" href="?check=0">Exit check mode</a>`;
    document.body.prepend(bar);
  });

  // ── System check: load everything, open every page, report ──
  const NEW_TABLES = ['hub_targets', 'equipment', 'equipment_repairs', 'food_cost_periods', 'food_cost_items', 'productivity_days', 'staff_positions', 'staffing_targets', 'candidates', 'infractions', 'hub_access', 'hub_invites', 'marketing_posts', 'marketing_events', 'community_requests', 'social_stats', 'marketing_assets', 'marketing_ideas', 'rep_snapshots', 'rep_reviews', 'hub_news', 'hub_calendar', 'hub_metrics', 'pl_months', 'bonus_years', 'bonus_wages', 'payroll_lines', 'recon_rules', 'recon_runs', 'qbo_account_map'];
  window.hubRunCheck = async () => {
    const H = window.H;
    if (!H || !H.user()) { alert('Sign in first, then run the check.'); return; }
    H.modal(`<h3>System check</h3><div id="ckBody" class="small"><div class="li-empty">Checking… this takes about a minute. Every page is opened once.</div></div>`, true);
    const out = { data: [], pages: [], tables: [], blockedBefore: blocked.length };
    const row = (label, value, ok, note2) => out.data.push({ label, value, ok, note: note2 || '' });
    let E = []; try { E = Object.values(EMPLOYEES); } catch (e) {}
    const act = E.filter(e => (e.status || 'active') === 'active').length;
    row('Team members', `${E.length} (${act} active, ${E.length - act} inactive)`, E.length > 0);
    const mr = E.reduce((a, e) => a + (e.monthlyRecords || []).length, 0);
    const months = [...new Set(E.flatMap(e => (e.monthlyRecords || []).map(r => `${r.year}-${String(r.month).padStart(2, '0')}`)))].sort();
    row('Monthly hours records', `${mr}${months.length ? ` · ${months[0]} to ${months[months.length - 1]}` : ''}`, mr > 0 && window._hubHoursComplete !== false, window._hubHoursComplete === false ? 'NOT all rows loaded' : 'all rows loaded');
    const tol = E.reduce((a, e) => a + (e.timeOffLog || []).length, 0);
    row('Time-off log entries', String(tol), window._hubTimeOffComplete !== false, window._hubTimeOffComplete === false ? 'NOT all rows loaded' : 'all rows loaded');
    let ip = 0; try { ip = Object.keys(IMPORTED_PERIODS).length; } catch (e) {}
    row('Imported pay periods', String(ip), ip > 0);
    let meals = null; try { meals = MEAL_PENALTIES; } catch (e) {}
    row('Meal penalty records', meals ? String(Array.isArray(meals) ? meals.length : Object.keys(meals).length) : '—', !!window._hubSettingsLoaded, window._hubSettingsLoaded ? 'loaded from the database' : 'not loaded: meal penalties would not be saved');
    const cat = await H.db.list('catering_orders', { cache: false });
    row('Catering orders', cat ? String(cat.length) : 'could not read', !!cat);
    if (cat && cat.length) { const bad = cat.filter(o => !H.toISO(o.pickup_time || o.order_date)).length; row('Catering dates readable', `${cat.length - bad} of ${cat.length}`, bad === 0, bad ? 'some orders won\'t show on the calendar' : ''); }
    row('Your role', `${H.ROLE_LABELS[H.realRole()] || H.realRole()} · sees ${H.visible().length} sections`, true);
    // New hub tables (created by sql/2026-10-hub-v2.sql)
    for (const t of NEW_TABLES) { const { error } = await getSupa().from(t).select('*', { count: 'exact', head: true }); out.tables.push({ t, ok: !error, msg: error ? error.message : '' }); }
    // Open every page
    const start = (document.querySelector('.page.active') || {}).id;
    for (const t of H.visible()) {
      const errsBefore = (window.__checkErrors || []).length;
      goTab(t); await new Promise(r => setTimeout(r, t === 'dashboard' || t === 'recon' || t === 'fcr' ? 2200 : 1500));
      const page = document.getElementById('p-' + t), text = page ? page.innerText : '';
      const errs = (window.__checkErrors || []).slice(errsBefore);
      const failed = /could not load/i.test(text) || errs.length;
      const setup = /isn't set up yet/i.test(text);
      out.pages.push({ t, label: H.SECTION_LABELS[t] || t, status: failed ? 'error' : setup ? 'setup' : 'ok', msg: failed ? (errs[0] || (text.match(/could not load[^\n]*/i) || [''])[0]) : setup ? 'needs the SQL setup' : '' });
    }
    if (start) goTab(start.replace('p-', ''));
    H.modal(`<h3>System check</h3><div id="ckBody"></div>`, true);
    const missing = out.tables.filter(x => !x.ok);
    const newBlocked = blocked.slice(out.blockedBefore);
    const icon = ok => ok ? '<span class="pill green">OK</span>' : '<span class="pill red">Check</span>';
    const report = [
      `LOS FILTROS HUB · SYSTEM CHECK · ${new Date().toLocaleString('en-US', { timeZone: 'America/Puerto_Rico' })}`,
      ...out.data.map(d => `${d.ok ? 'OK   ' : 'CHECK'} ${d.label}: ${d.value}${d.note ? ' (' + d.note + ')' : ''}`),
      `Pages: ${out.pages.filter(p => p.status === 'ok').length} OK, ${out.pages.filter(p => p.status === 'setup').length} need SQL setup, ${out.pages.filter(p => p.status === 'error').length} with errors`,
      ...out.pages.filter(p => p.status !== 'ok').map(p => `  ${p.status.toUpperCase()} ${p.label}: ${p.msg}`),
      `New tables missing: ${missing.length ? missing.map(x => x.t).join(', ') : 'none'}`,
      `Save attempts stopped by check mode during the check: ${newBlocked.length}${newBlocked.length ? ' (' + [...new Set(newBlocked.map(b => b.what))].slice(0, 8).join('; ') + ')' : ''}`,
      `Save attempts stopped since sign-in: ${blocked.length}`,
    ].join('\n');
    document.getElementById('ckBody').innerHTML = `
      <div class="section-label">Your data</div>
      <div class="list">${out.data.map(d => `<div class="li"><span></span><div><div class="li-title">${H.esc(d.label)}</div><div class="li-sub">${H.esc(d.value)}${d.note ? ' · ' + H.esc(d.note) : ''}</div></div>${icon(d.ok)}</div>`).join('')}</div>
      <div class="section-label mt">Pages</div>
      <div class="list">${out.pages.map(p => `<div class="li"><span></span><div><div class="li-title">${H.esc(p.label)}</div>${p.msg ? `<div class="li-sub">${H.esc(p.msg)}</div>` : ''}</div><span class="pill ${p.status === 'ok' ? 'green' : p.status === 'setup' ? 'amber' : 'red'}">${p.status === 'ok' ? 'OK' : p.status === 'setup' ? 'Needs SQL setup' : 'Error'}</span></div>`).join('')}</div>
      <div class="section-label mt">New tables</div>
      <div class="small">${missing.length ? `${missing.length} of ${out.tables.length} not created yet. That's expected before running <code>sql/2026-10-hub-v2.sql</code>.` : `All ${out.tables.length} are set up.`}</div>
      <div class="section-label mt">Safety</div>
      <div class="small">${newBlocked.length ? `${newBlocked.length} save attempts were stopped during the check (nothing reached the database): ${H.esc([...new Set(newBlocked.map(b => b.what))].join('; '))}` : 'No save attempts during the check.'}</div>
      <textarea id="ckReport" readonly style="width:100%;height:120px;margin-top:12px;font-family:ui-monospace,Menlo,monospace;font-size:.72rem;border:1px solid var(--border);border-radius:8px;padding:8px">${H.esc(report)}</textarea>
      <div class="mfooter"><button class="btn" onclick="H.closeModal()">Close</button><button class="btn btn-primary" onclick="H.copyText(document.getElementById('ckReport').value,'Report copied')">Copy report</button></div>`;
  };
})();
