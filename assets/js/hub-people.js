/* ═══════════════════════════════════════════════════════════
   LOS FILTROS HUB — People
   Staffing · Infractions · Users & access
   Reads team members from the existing hub data (read-only).
   Writes only to: staff_positions, staffing_targets, candidates,
   infractions, hub_access, hub_invites, profiles.role*
   (*role changes on Users & access only, by the operator).
   ═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const H = window.H;
  const AREAS = ['FOH', 'BOH', 'Leadership'];
  const AREA_CLS = { FOH: 'foh', BOH: 'boh', Leadership: 'lead' };
  const AREA_PILL = { FOH: 'blue', BOH: 'red', Leadership: 'purple' };
  const DEFAULT_POSITIONS = { FOH: ['Front counter', 'Drive-thru', 'Dining room', 'Catering'], BOH: ['Breading & fry', 'Assembly', 'Prep', 'Dish'], Leadership: ['Shift leader', 'Director'] };

  async function wait() { try { if (window._hubDataReady) await window._hubDataReady; } catch (e) {} }

  // ═════════════ STAFFING ═════════════
  const STAGES = [
    { k: 'applied', l: 'Applied' }, { k: 'interview_set', l: 'Interview set' }, { k: 'interviewed', l: 'Interviewed' }, { k: 'offer', l: 'Offer made' }, { k: 'hired', l: 'Hired' },
  ];
  const REC = { strong_hire: ['Strong hire', 'green'], hire: ['Hire', 'green'], maybe: ['Maybe', 'amber'], no_hire: ['Do not hire', 'red'] };

  async function stLoad() {
    await wait();
    const [pos, targets, cands] = await Promise.all([H.db.list('staff_positions'), H.db.list('staffing_targets'), H.db.list('candidates', { order: 'created_at', asc: false })]);
    return { pos, targets, cands };
  }
  function headcount(pos, targets) {
    const active = H.employees();
    const byName = Object.fromEntries((pos || []).map(p => [p.employee_name, p]));
    const rows = {};
    AREAS.forEach(a => { rows[a] = {}; });
    (targets || []).forEach(t => { (rows[t.area] ||= {})[t.position] = { need: t.needed || 0, have: 0, leaving: 0, people: [] }; });
    let unassigned = 0;
    active.forEach(e => {
      const p = byName[e.name];
      if (!p || !p.area) { unassigned++; return; }
      const r = ((rows[p.area] ||= {})[p.position || 'Unassigned'] ||= { need: 0, have: 0, leaving: 0, people: [] });
      r.have++; r.people.push(e.name);
      if (p.ends_on && p.ends_on >= H.today()) r.leaving++;
    });
    return { rows, unassigned, total: active.length };
  }

  H.pages.staffing = {
    async render(host) {
      host.innerHTML = `<div class="ph"><div><h2>Staffing</h2><p>People you have in each area against what you need, and who is on the way in.</p></div>
        <div class="actions"><button class="btn" onclick="H.pages.staffing.editTargets()">Staffing targets</button><button class="btn" onclick="H.pages.staffing.importRoster()">Import roster</button><button class="btn" onclick="H.pages.staffing.assign()">Assign positions</button><button class="btn btn-primary" onclick="H.pages.staffing.addCandidate()">Add candidate</button></div></div><div id="stBody"><div class="li-empty">Loading…</div></div>`;
      const { pos, targets, cands } = await stLoad();
      const body = document.getElementById('stBody'); if (!body) return;
      if (pos === null || cands === null) { body.innerHTML = ''; return H.missingTable(body, 'staff_positions / candidates'); }
      const hc = headcount(pos, targets);
      const need = Object.values(hc.rows).flatMap(a => Object.values(a)).reduce((s, r) => s + Math.max(0, r.need - r.have + r.leaving), 0);
      const pipeline = (cands || []).filter(c => ['applied', 'interview_set', 'interviewed', 'offer'].includes(c.stage));
      const starting = (cands || []).filter(c => c.stage === 'hired' && c.start_date && c.start_date >= H.today());
      const leaving = (pos || []).filter(p => p.ends_on && p.ends_on >= H.today());
      const pt = H.employees().length;

      body.innerHTML = `
        <div class="kpis">
          <div class="kpi"><div class="kpi-label">Team members</div><div class="kpi-val">${pt}</div><div class="kpi-sub">${hc.unassigned ? `${hc.unassigned} without a position yet` : 'All assigned'}</div></div>
          <div class="kpi ${need ? 'bad' : 'ok'}"><div class="kpi-label">Open spots</div><div class="kpi-val">${need}</div><div class="kpi-sub">after ${starting.length} starting soon and ${leaving.length} leaving</div></div>
          <div class="kpi info"><div class="kpi-label">In the hiring pipeline</div><div class="kpi-val">${pipeline.length}</div><div class="kpi-sub">${pipeline.filter(c => c.stage === 'interview_set').length} interviews set · ${pipeline.filter(c => c.stage === 'offer').length} offer out</div></div>
          <div class="kpi"><div class="kpi-label">Starting soon</div><div class="kpi-val">${starting.length}</div><div class="kpi-sub">${starting.slice(0, 2).map(c => H.shortName(c.name)).join(', ') || '&nbsp;'}</div></div>
        </div>
        <div class="grid g3">${AREAS.map(a => areaCard(a, hc.rows[a] || {}, (cands || []).filter(c => c.area === a && ['applied', 'interview_set', 'interviewed', 'offer'].includes(c.stage)).length)).join('')}</div>
        ${hc.unassigned ? `<div class="source warn mt"><span>${hc.unassigned} active team member${hc.unassigned === 1 ? ' has' : 's have'} no area or position yet, so they aren't counted above. <a href="#" onclick="H.pages.staffing.assign();return false" style="color:inherit;font-weight:700;margin-left:4px">Assign positions</a></span></div>` : ''}
        <div class="section-label" style="margin-top:26px">Hiring pipeline <span class="small muted" style="text-transform:none;letter-spacing:0">Click a candidate to see interviews and notes</span></div>
        <div class="board">${STAGES.map(s => { const list = (cands || []).filter(c => c.stage === s.k && (s.k !== 'hired' || !c.start_date || c.start_date >= H.addDays(H.today(), -30))); return `<div class="col"><div class="col-head"><span>${s.l}</span><span class="muted">${list.length}</span></div>${list.map(candTile).join('') || '<div class="small muted" style="padding:4px">None</div>'}</div>`; }).join('')}</div>
        <div class="grid g2 mt" style="margin-top:22px">
          <div class="card card-pad"><div class="section-label">Starting soon</div>${starting.length ? starting.map(c => `<div class="between small" style="padding:6px 0;border-top:1px solid #F0F0F2"><span><strong>${H.esc(c.name)}</strong> · ${H.esc(c.position || c.area || '')}</span><span class="muted">${H.fmtD(c.start_date)}</span></div>`).join('') : '<div class="small muted">No start dates set.</div>'}</div>
          <div class="card card-pad"><div class="section-label">Leaving</div>${leaving.length ? leaving.map(p => `<div class="between small" style="padding:6px 0;border-top:1px solid #F0F0F2"><span><strong>${H.esc(p.employee_name)}</strong> · ${H.esc(p.position || p.area || '')}</span><span class="muted">Last day ${H.fmtD(p.ends_on)}</span></div>`).join('') : '<div class="small muted">Nobody has a last day set. Set one under Assign positions.</div>'}</div>
        </div>`;
    },
    async count() { const { cands } = await stLoad(); if (!cands) return null; const n = cands.filter(c => c.stage === 'interviewed').length; return { n, alert: false }; },
    addCandidate(c) {
      c = c || {};
      const allPos = [...new Set([...Object.values(DEFAULT_POSITIONS).flat()])];
      H.form({ title: c.id ? `Edit ${c.name}` : 'Add candidate', wide: true, fields: [
        { id: 'name', label: 'Name', required: true, value: c.name, half: true },
        { id: 'phone', label: 'Phone', value: c.phone, half: true },
        { id: 'area', label: 'Area', type: 'select', value: c.area || 'FOH', options: AREAS, half: true },
        { id: 'position', label: 'Position', value: c.position, list: allPos, half: true },
        { id: 'source', label: 'Source', value: c.source, list: ['Walk-in', 'Referral', 'CFA careers site', 'Indeed', 'Social media', 'Job fair'], half: true },
        { id: 'stage', label: 'Stage', type: 'select', value: c.stage || 'applied', options: [...STAGES.map(s => ({ value: s.k, label: s.l })), { value: 'declined', label: 'Not moving forward' }], half: true },
        { id: 'interview_at', label: 'Interview date & time', type: 'datetime-local', value: c.interview_at ? new Date(new Date(c.interview_at).toLocaleString('en-US', { timeZone: 'America/Puerto_Rico' })).toISOString().slice(0, 16) : '', half: true },
        { id: 'interviewer', label: 'Interviewer', value: c.interviewer, half: true },
        { id: 'start_date', label: 'Start date (if hired)', type: 'date', value: c.start_date, half: true },
        { id: 'notes', label: 'Notes', type: 'textarea', value: c.notes },
      ], submit: c.id ? 'Save' : 'Add candidate', onSubmit: async v => {
        const row = { ...v, interview_at: v.interview_at ? new Date(v.interview_at + ':00-04:00').toISOString() : null, updated_at: new Date().toISOString() };
        if (c.id) await H.db.update('candidates', c.id, row); else await H.db.insert('candidates', { ...row, added_by: H.who() });
        H.toast('Saved'); this.render(document.getElementById('staffingApp')); hubRefreshCounts();
      } });
    },
    async openCandidate(id) {
      const cands = await H.db.list('candidates', { cache: false }); const c = cands.find(x => x.id === id); if (!c) return;
      const sc = c.scores || {};
      const rec = REC[c.recommendation];
      H.modal(`<div class="between" style="margin-bottom:12px"><h3 style="margin:0">${H.esc(c.name)}</h3><button class="btn btn-sm" onclick="H.closeModal()">Close</button></div>
        <div class="row" style="flex-wrap:wrap;gap:6px;margin-bottom:14px"><span class="pill ${AREA_PILL[c.area] || ''}">${H.esc(c.area || '')}</span>${c.position ? `<span class="pill">${H.esc(c.position)}</span>` : ''}<span class="pill outline">${H.esc((STAGES.find(s => s.k === c.stage) || { l: 'Not moving forward' }).l)}</span>${rec ? `<span class="pill ${rec[1]}">${rec[0]}</span>` : ''}</div>
        <div class="grid g2 small" style="gap:8px 18px;margin-bottom:14px">
          <div><span class="muted">Phone</span><div class="strong">${H.esc(c.phone || '—')}</div></div><div><span class="muted">Source</span><div class="strong">${H.esc(c.source || '—')}</div></div>
          <div><span class="muted">Interview</span><div class="strong">${c.interview_at ? H.fmtDT(c.interview_at) : '—'}</div></div><div><span class="muted">Interviewer</span><div class="strong">${H.esc(c.interviewer || '—')}</div></div>
          ${c.start_date ? `<div><span class="muted">Start date</span><div class="strong">${H.fmtD(c.start_date, { month: 'short', day: 'numeric', year: 'numeric' })}</div></div>` : ''}
        </div>
        ${c.score != null ? `<div class="section-label">Interview scorecard · ${(+c.score).toFixed(1)} / 5</div><div class="grid g2" style="gap:6px 18px;margin-bottom:14px">${['communication', 'teamwork', 'reliability', 'energy'].map(k => `<div class="between small"><span style="text-transform:capitalize">${k === 'energy' ? 'Energy & work ethic' : k}</span><span class="stars">${'★'.repeat(sc[k] || 0)}<span style="color:#DDD">${'★'.repeat(5 - (sc[k] || 0))}</span></span></div>`).join('')}</div>` : ''}
        ${c.notes ? `<div class="section-label">Notes</div><div class="small" style="white-space:pre-wrap;margin-bottom:12px">${H.esc(c.notes)}</div>` : ''}
        <div class="mfooter"><button class="btn" onclick="H.pages.staffing.scorecard('${c.id}')">Score interview</button><button class="btn" onclick='H.pages.staffing.editCandidate("${c.id}")'>Edit</button>
          ${nextStageBtn(c)}</div>`, true);
    },
    async editCandidate(id) { const cands = await H.db.list('candidates', { cache: false }); this.addCandidate(cands.find(x => x.id === id)); },
    async moveCandidate(id, stage) {
      const patch = { stage, updated_at: new Date().toISOString() };
      if (stage === 'hired') {
        const cands = await H.db.list('candidates', { cache: false }); const c = cands.find(x => x.id === id);
        return H.form({ title: `Hire ${c.name}`, intro: 'Their hours and leave balances start once they appear on a Time Summary import.', fields: [{ id: 'start', label: 'Start date', type: 'date', required: true, value: H.addDays(H.today(), 7) }], submit: 'Mark hired', onSubmit: async v => { await H.db.update('candidates', id, { ...patch, start_date: v.start }); H.toast('Marked hired'); this.render(document.getElementById('staffingApp')); hubRefreshCounts(); } });
      }
      await H.db.update('candidates', id, patch); H.closeModal(); H.toast('Moved'); this.render(document.getElementById('staffingApp')); hubRefreshCounts();
    },
    async scorecard(id) {
      const cands = await H.db.list('candidates', { cache: false }); const c = cands.find(x => x.id === id); const sc = c.scores || {};
      const opts = [1, 2, 3, 4, 5].map(n => ({ value: n, label: `${n} — ${['Poor', 'Below average', 'OK', 'Good', 'Excellent'][n - 1]}` }));
      H.form({ title: `Score ${c.name}`, intro: 'Rate each area 1–5, then make a recommendation.', fields: [
        { id: 'communication', label: 'Communication', type: 'select', options: opts, value: sc.communication || 3, half: true },
        { id: 'teamwork', label: 'Teamwork', type: 'select', options: opts, value: sc.teamwork || 3, half: true },
        { id: 'reliability', label: 'Reliability', type: 'select', options: opts, value: sc.reliability || 3, half: true },
        { id: 'energy', label: 'Energy & work ethic', type: 'select', options: opts, value: sc.energy || 3, half: true },
        { id: 'rec', label: 'Recommendation', type: 'select', value: c.recommendation || 'hire', options: Object.entries(REC).map(([k, v]) => ({ value: k, label: v[0] })) },
        { id: 'notes', label: 'Interview notes', type: 'textarea', value: c.notes },
      ], submit: 'Save scorecard', onSubmit: async v => {
        const scores = { communication: +v.communication, teamwork: +v.teamwork, reliability: +v.reliability, energy: +v.energy };
        const score = Object.values(scores).reduce((a, b) => a + b, 0) / 4;
        await H.db.update('candidates', id, { scores, score, recommendation: v.rec, notes: v.notes, interviewer: c.interviewer || H.who(), stage: ['applied', 'interview_set'].includes(c.stage) ? 'interviewed' : c.stage, updated_at: new Date().toISOString() });
        H.toast('Scorecard saved'); this.render(document.getElementById('staffingApp')); hubRefreshCounts();
      } });
    },
    async editTargets() {
      const t = await H.db.list('staffing_targets', { cache: false }) || [];
      const get = (a, p) => (t.find(x => x.area === a && x.position === p) || {}).needed;
      const fields = [];
      AREAS.forEach(a => DEFAULT_POSITIONS[a].forEach(p => fields.push({ id: `${a}|${p}`, label: `${a} · ${p}`, type: 'number', value: get(a, p) ?? '', half: true })));
      t.filter(x => !(DEFAULT_POSITIONS[x.area] || []).includes(x.position)).forEach(x => fields.push({ id: `${x.area}|${x.position}`, label: `${x.area} · ${x.position}`, type: 'number', value: x.needed, half: true }));
      H.form({ title: 'Staffing targets', intro: 'How many people you want in each position. Leave blank to skip a position.', wide: true, fields, submit: 'Save targets', onSubmit: async v => {
        const rows = Object.entries(v).filter(([, n]) => n != null).map(([k, n]) => { const [area, position] = k.split('|'); return { area, position, needed: Math.round(n) }; });
        if (rows.length) await H.db.upsert('staffing_targets', rows, 'area,position');
        H.toast('Targets saved'); this.render(document.getElementById('staffingApp'));
      } });
    },
    async assign() {
      await wait();
      const pos = await H.db.list('staff_positions', { cache: false }) || [];
      const byName = Object.fromEntries(pos.map(p => [p.employee_name, p]));
      const emps = H.employees();
      const posOpts = a => ['', ...DEFAULT_POSITIONS[a]];
      H.modal(`<div class="between" style="margin-bottom:6px"><h3 style="margin:0">Assign positions</h3><button class="btn btn-sm" onclick="H.closeModal()">Close</button></div>
        <p class="muted small" style="margin-bottom:12px">Area, main position, and a last day if they're leaving. Saves as you change each row. This doesn't change their hours or leave balances.</p>
        <input class="sinput" style="width:100%;margin-bottom:10px" placeholder="Search team members…" oninput="document.querySelectorAll('#asgRows tr').forEach(r=>r.style.display=r.dataset.n.includes(this.value.toLowerCase())?'':'none')"/>
        <div class="tbl-wrap" style="max-height:52vh;overflow:auto"><table><thead><tr><th>Team member</th><th>Area</th><th>Position</th><th>Last day</th></tr></thead><tbody id="asgRows">
        ${emps.map(e => { const p = byName[e.name] || {}; const a = p.area || ''; return `<tr data-n="${H.esc(e.name.toLowerCase())}" data-emp="${H.esc(e.name)}" data-id="${H.esc(e.id || '')}">
          <td style="color:var(--text);font-weight:600;white-space:nowrap">${H.esc(e.name)}</td>
          <td><select class="sel" data-f="area" onchange="H.pages.staffing.saveAssign(this)"><option value=""></option>${AREAS.map(x => `<option ${x === a ? 'selected' : ''}>${x}</option>`).join('')}</select></td>
          <td><input class="sel" style="width:150px" data-f="position" list="asgPos" value="${H.esc(p.position || '')}" onchange="H.pages.staffing.saveAssign(this)"/></td>
          <td><input class="sel" type="date" data-f="ends_on" value="${H.esc(p.ends_on || '')}" onchange="H.pages.staffing.saveAssign(this)"/></td></tr>`; }).join('')}
        </tbody></table></div>
        <datalist id="asgPos">${Object.values(DEFAULT_POSITIONS).flat().map(x => `<option value="${H.esc(x)}">`).join('')}</datalist>`, true);
      document.getElementById('hubModalBody').style.maxWidth = '900px';
    },
    // Import a HotSchedules (or any) roster export: name + job → area/position for each team member
    importRoster() {
      H.modal(`<h3>Import roster</h3><p class="muted small" style="margin:-10px 0 14px">Upload a roster export from HotSchedules (Excel or CSV) with each person's name and job. The hub matches names to your team members and fills in their area and position. Hours and leave balances are not touched.</p>
        <div class="upzone compact" onclick="document.getElementById('rsFile').click()"><div class="up-link">Choose a file</div><div class="up-sub">.xlsx, .xls or .csv</div></div>
        <input type="file" id="rsFile" accept=".xlsx,.xls,.csv" style="display:none"/>
        <div id="rsPrev" class="mt"></div>
        <div class="mfooter"><button class="btn" onclick="H.closeModal()">Cancel</button><button class="btn btn-primary" id="rsSave" disabled>Save positions</button></div>`, true);
      let matched = [];
      document.getElementById('rsFile').onchange = async ev => {
        const f = ev.target.files[0]; if (!f) return;
        const prev = document.getElementById('rsPrev'); prev.innerHTML = '<div class="small muted">Reading…</div>';
        try {
          await wait();
          const rows = await H.readTable(f);
          const keys = rows.length ? Object.keys(rows[0]) : [];
          const nameKey = keys.find(k => /^(employee_)?name$|full_name|employee$/.test(k)) || keys.find(k => k.includes('name') && !k.includes('job'));
          const firstKey = keys.find(k => k.includes('first')), lastKey = keys.find(k => k.includes('last') && !k.includes('day'));
          const jobKey = keys.find(k => /primary_job|^job$|^jobs$|position|role|job_title|^title$/.test(k)) || keys.find(k => k.includes('job'));
          if ((!nameKey && !(firstKey && lastKey)) || !jobKey) throw new Error(`Could not find a name column and a job column. Columns found: ${keys.join(', ') || 'none'}`);
          const unmatched = [];
          matched = [];
          for (const r of rows) {
            let raw = nameKey ? String(r[nameKey] || '').trim() : `${r[firstKey] || ''} ${r[lastKey] || ''}`.trim();
            if (!raw) continue;
            if (raw.includes(',')) { const [l, fst] = raw.split(',').map(x => x.trim()); raw = `${fst} ${l}`; }
            const key = typeof fuzzyMatchEmployee === 'function' ? fuzzyMatchEmployee(raw) : null;
            const emp = key ? EMPLOYEES[key] : null;
            const job = String(r[jobKey] || '').split(/[;,\/|]/)[0].trim();
            if (!emp) { unmatched.push(raw); continue; }
            matched.push({ employee_name: emp.name, employee_id: emp.supabase_id || null, area: areaForJob(job), position: job || null, from: raw });
          }
          const seen = new Set(); matched = matched.filter(m => !seen.has(m.employee_name) && seen.add(m.employee_name));
          prev.innerHTML = `<div class="small" style="margin-bottom:8px"><strong style="color:var(--ok)">${matched.length} team members matched</strong>${unmatched.length ? ` · <span style="color:var(--warn)">${unmatched.length} not found in the hub</span>` : ''}</div>
            <div class="tbl-wrap" style="max-height:280px;overflow:auto"><table><thead><tr><th>Team member</th><th>Area</th><th>Position</th></tr></thead><tbody>${matched.map(m => `<tr><td style="color:var(--text);font-weight:600">${H.esc(m.employee_name)}${m.from !== m.employee_name ? `<div class="small muted" style="font-weight:400">${H.esc(m.from)}</div>` : ''}</td><td>${H.esc(m.area || '—')}</td><td>${H.esc(m.position || '—')}</td></tr>`).join('')}</tbody></table></div>
            ${unmatched.length ? `<details class="mt-s"><summary class="small" style="cursor:pointer">Not found (${unmatched.length})</summary><div class="small muted mt-s">${unmatched.map(H.esc).join(', ')}</div><div class="small muted mt-s">These names aren't in your imported hours yet (new hires, or spelled differently). Assign them by hand once they show up.</div></details>` : ''}`;
          document.getElementById('rsSave').disabled = !matched.length;
        } catch (e) { prev.innerHTML = `<div class="small" style="color:var(--bad)">${H.esc(e.message)}</div>`; }
      };
      document.getElementById('rsSave').onclick = async () => {
        const b = document.getElementById('rsSave'); b.disabled = true;
        try {
          await H.db.upsert('staff_positions', matched.map(({ from, ...m }) => ({ ...m, updated_at: new Date().toISOString(), updated_by: H.who() })), 'employee_name');
          H.closeModal(); H.toast(`${matched.length} position${matched.length === 1 ? '' : 's'} saved`); this.render(document.getElementById('staffingApp'));
        } catch (e) { document.getElementById('rsPrev').insertAdjacentHTML('beforeend', `<div class="small" style="color:var(--bad)">${H.esc(e.message)}</div>`); b.disabled = false; }
      };
    },
    async saveAssign(el) {
      const tr = el.closest('tr'); const name = tr.dataset.emp;
      const vals = {}; tr.querySelectorAll('[data-f]').forEach(x => { vals[x.dataset.f] = x.value || null; });
      try {
        await H.db.upsert('staff_positions', [{ employee_name: name, employee_id: tr.dataset.id || null, ...vals, updated_at: new Date().toISOString(), updated_by: H.who() }], 'employee_name');
        H.toast(`${H.shortName(name)} saved`);
        this.render(document.getElementById('staffingApp'));
      } catch (e) { H.toast(e.message); }
    },
  };
  function areaForJob(job) {
    const j = String(job || '').toLowerCase();
    if (/director|manager|shift lead|leader|supervisor|trainer lead|operator/.test(j)) return 'Leadership';
    if (/boh|back of house|kitchen|bread|fry|fries|filet|assembl|prep|dish|cook|grill|machine/.test(j)) return 'BOH';
    if (/foh|front|counter|register|cashier|drive|dt|dining|host|catering|order taker|runner|bag/.test(j)) return 'FOH';
    return null;
  }
  function areaCard(a, rows, inPipe) {
    const list = Object.entries(rows).sort((x, y) => DEFAULT_POSITIONS[a] ? (DEFAULT_POSITIONS[a].indexOf(x[0]) + 99) % 99 - (DEFAULT_POSITIONS[a].indexOf(y[0]) + 99) % 99 : 0);
    const have = list.reduce((s, [, r]) => s + r.have, 0), need = list.reduce((s, [, r]) => s + r.need, 0), short = list.reduce((s, [, r]) => s + Math.max(0, r.need - r.have + r.leaving), 0);
    const color = { FOH: 'var(--foh)', BOH: 'var(--boh)', Leadership: 'var(--lead)' }[a];
    return `<div class="card card-pad top-${AREA_CLS[a]}">
      <div class="between"><div class="label">${a === 'FOH' ? 'Front of house' : a === 'BOH' ? 'Back of house' : 'Leadership'}</div>${short ? `<span class="pill red">Need ${short}</span>` : need ? '<span class="pill green">Covered</span>' : '<span class="pill">No targets set</span>'}</div>
      <div style="font-size:1.6rem;font-weight:700;margin:4px 0 6px">${have}<span class="muted" style="font-size:1rem;font-weight:500"> / ${need || '—'}</span></div>
      <div class="seats" style="color:${color};margin-bottom:6px">${Array.from({ length: Math.max(need, have) }, (_, i) => `<i class="${i < have ? 'on' : ''}"></i>`).join('')}</div>
      <div class="small muted" style="margin-bottom:10px">${inPipe} candidate${inPipe === 1 ? '' : 's'} in process</div>
      ${list.length ? list.map(([p, r]) => `<div class="metric-row"><span>${H.esc(p)}</span><div class="bar ${r.have >= r.need ? 'ok' : AREA_CLS[a]}"><i style="width:${r.need ? Math.min(100, r.have / r.need * 100) : 100}%"></i></div><span class="v" style="color:${r.have < r.need ? 'var(--bad)' : 'var(--text)'}">${r.have}/${r.need || '—'}</span></div>`).join('') : '<div class="small muted">Set targets and assign positions to see coverage.</div>'}
    </div>`;
  }
  function candTile(c) {
    const rec = REC[c.recommendation];
    return `<div class="tile" onclick="H.pages.staffing.openCandidate('${c.id}')">
      <div class="between"><div class="t">${H.esc(c.name)}</div>${c.score != null ? `<span class="small strong">${(+c.score).toFixed(1)}</span>` : ''}</div>
      <div class="s">${H.esc([c.position, c.area].filter(Boolean).join(' · '))}</div>
      ${c.stage === 'interview_set' && c.interview_at ? `<div class="s">Interview ${H.fmtDT(c.interview_at)}${c.interviewer ? ' · ' + H.esc(H.shortName(c.interviewer)) : ''}</div>` : ''}
      ${c.stage === 'hired' && c.start_date ? `<div class="s">Starts ${H.fmtD(c.start_date)}</div>` : ''}
      <div class="row" style="gap:6px;margin-top:6px">${rec ? `<span class="pill ${rec[1]}">${rec[0]}</span>` : ''}${c.source ? `<span class="small muted">${H.esc(c.source)}</span>` : ''}</div>
    </div>`;
  }
  function nextStageBtn(c) {
    const order = STAGES.map(s => s.k); const i = order.indexOf(c.stage);
    const out = [];
    if (c.stage !== 'declined' && c.stage !== 'hired') out.push(`<button class="btn btn-danger-quiet" onclick="H.pages.staffing.moveCandidate('${c.id}','declined')">Not moving forward</button>`);
    if (i >= 0 && i < order.length - 1) out.push(`<button class="btn btn-primary" onclick="H.pages.staffing.moveCandidate('${c.id}','${order[i + 1]}')">Move to ${STAGES[i + 1].l.toLowerCase()}</button>`);
    return out.join('');
  }

  // ═════════════ INFRACTIONS ═════════════
  const IN = { cat: 'all' };
  const CATEGORIES = ['Asistencia y Puntualidad', 'Apariencia y Aseo Personal', 'Uniformes', 'Inocuidad de Alimentos / Seguridad Alimentaria', 'Responsabilidad de Efectivo y Cupones', 'Normas de Conducta', 'Ambiente de Trabajo Civil y Respetuoso', 'Pausas y Comidas de Empleados', 'Deberes y Responsabilidades del Puesto', 'Seguridad en el Lugar de Trabajo', 'Comunicaciones Telefónicas', 'Política de Salud', 'Funciones, Responsabilidades y Requisitos de Liderazgo', 'Igualdad de Oportunidad de Empleo y Política de No Acoso'];
  const LEVELS = { coaching: ['Coaching', 1, 'blue'], verbal: ['Verbal warning', 2, 'amber'], written: ['Written warning', 3, 'red'], final: ['Final written warning', 4, 'red'] };
  async function inLoad() { await wait(); const [rows, tg] = await Promise.all([H.db.list('infractions', { order: 'occurred_on', asc: false }), H.targets()]); return { rows, tg }; }
  function activePts(rows, name, today) { return (rows || []).filter(r => r.employee_name === name && r.status !== 'void' && (!r.drop_off_on || r.drop_off_on > today)).reduce((s, r) => s + (+r.points || 0), 0); }

  H.pages.infractions = {
    async render(host) {
      host.innerHTML = `<div class="ph"><div><h2>Infractions</h2><p>Every record uses the same form and can be printed for signatures. Points drop off after a set number of days.</p></div>
        <div class="actions"><button class="btn" onclick="H.pages.infractions.editRules()">Point rules</button><button class="btn btn-primary" onclick="H.pages.infractions.add()">Record an infraction</button></div></div><div id="inBody"><div class="li-empty">Loading…</div></div>`;
      const { rows, tg } = await inLoad();
      const body = document.getElementById('inBody'); if (!body) return;
      if (rows === null) { body.innerHTML = ''; return H.missingTable(body, 'infractions'); }
      const today = H.today();
      const active = rows.filter(r => r.status !== 'void' && (!r.drop_off_on || r.drop_off_on > today));
      const people = [...new Set(active.map(r => r.employee_name))].map(n => ({ name: n, pts: activePts(rows, n, today), recs: active.filter(r => r.employee_name === n) })).sort((a, b) => b.pts - a.pts);
      const needSig = rows.filter(r => r.status === 'needs_signature');
      const cats = {}; active.forEach(r => { cats[r.category] = (cats[r.category] || 0) + 1; });
      const shown = rows.filter(r => r.status !== 'void' && (IN.cat === 'all' || (IN.cat === 'sig' ? r.status === 'needs_signature' : r.category === IN.cat)));

      body.innerHTML = `
        <div class="kpis">
          <div class="kpi"><div class="kpi-label">Active records</div><div class="kpi-val">${active.length}</div><div class="kpi-sub">Within ${tg.infraction_dropoff_days} days</div></div>
          <div class="kpi ${needSig.length ? 'warn' : 'ok'}"><div class="kpi-label">Waiting for signature</div><div class="kpi-val">${needSig.length}</div><div class="kpi-sub">Print, sign, then mark signed</div></div>
          <div class="kpi ${people.some(p => p.pts >= tg.infraction_written_at) ? 'bad' : ''}"><div class="kpi-label">At written-warning level</div><div class="kpi-val">${people.filter(p => p.pts >= tg.infraction_written_at).length}</div><div class="kpi-sub">${tg.infraction_written_at}+ active points</div></div>
          <div class="kpi"><div class="kpi-label">This month</div><div class="kpi-val">${rows.filter(r => r.occurred_on.startsWith(today.slice(0, 7))).length}</div><div class="kpi-sub">${H.monthLabel(today.slice(0, 7), true)}</div></div>
        </div>
        ${people.length ? `<div class="section-label">Highest points</div><div class="grid g4" style="margin-bottom:20px">${people.slice(0, 4).map(p => { const next = p.pts >= tg.infraction_final_at ? 'At final warning level' : p.pts >= tg.infraction_written_at ? `Final warning at ${tg.infraction_final_at} pts · ${tg.infraction_final_at - p.pts} more` : `Written warning at ${tg.infraction_written_at} pts · ${tg.infraction_written_at - p.pts} more`; const drop = p.recs.map(r => r.drop_off_on).filter(Boolean).sort()[0];
          return `<div class="card card-pad"><div class="between"><div class="row"><div class="avatar" style="background:${p.pts >= tg.infraction_written_at ? 'var(--red)' : 'var(--warn)'}">${H.initials(p.name)}</div><div><div class="strong">${H.esc(H.shortName(p.name))}</div><div class="small muted">${p.recs.length} record${p.recs.length === 1 ? '' : 's'}</div></div></div><div style="font-size:1.4rem;font-weight:700;color:${p.pts >= tg.infraction_written_at ? 'var(--bad)' : 'var(--warn)'}">${p.pts}<span class="small muted" style="font-weight:500"> pt${p.pts === 1 ? '' : 's'}</span></div></div>
            <div class="bar ${p.pts >= tg.infraction_written_at ? 'bad' : 'warn'}" style="margin:10px 0 6px"><i style="width:${Math.min(100, p.pts / tg.infraction_final_at * 100)}%"></i></div>
            <div class="small muted">${next}</div>${drop ? `<div class="small muted">Next point drops off ${H.fmtD(drop)}</div>` : ''}</div>`; }).join('')}</div>` : ''}
        <div class="chips"><button class="chip ${IN.cat === 'all' ? 'active' : ''}" onclick="H.pages.infractions.setCat('all')">All</button><button class="chip ${IN.cat === 'sig' ? 'active' : ''}" onclick="H.pages.infractions.setCat('sig')">Waiting for signature<span class="n">${needSig.length}</span></button>${Object.entries(cats).sort((a, b) => b[1] - a[1]).map(([c, n]) => `<button class="chip ${IN.cat === c ? 'active' : ''}" onclick='H.pages.infractions.setCat(${JSON.stringify(c)})'>${H.esc(c.split(/ [y\/] /)[0])}<span class="n">${n}</span></button>`).join('')}</div>
        <div class="grid g3">${shown.slice(0, 30).map(r => recCard(r, today)).join('') || '<div class="list" style="grid-column:1/-1"><div class="li-empty">No records here.</div></div>'}</div>`;
    },
    setCat(c) { IN.cat = c; this.render(document.getElementById('infractionsApp')); },
    async count() { const { rows } = await inLoad(); if (!rows) return null; return { n: rows.filter(r => r.status === 'needs_signature').length, alert: false }; },
    async add() {
      const { tg } = await inLoad();
      H.form({ title: 'Record an infraction', wide: true, fields: [
        { id: 'emp', label: 'Team member', type: 'select', options: H.empOptions(), required: true, half: true },
        { id: 'date', label: 'Date of the incident', type: 'date', value: H.today(), required: true, half: true },
        { id: 'cat', label: 'Policy', type: 'select', options: CATEGORIES, required: true, half: true },
        { id: 'level', label: 'Action', type: 'select', value: 'verbal', half: true, options: Object.entries(LEVELS).map(([k, v]) => ({ value: k, label: `${v[0]} (+${v[1]} pt${v[1] === 1 ? '' : 's'})` })) },
        { id: 'desc', label: 'Describe what happened', type: 'textarea', required: true, placeholder: 'Ej. Llegó 25 minutos tarde al turno de apertura sin llamar al líder de turno.' },
        { id: 'action', label: 'Corrective action expected', type: 'textarea' },
      ], submit: 'Save record', onSubmit: async v => {
        const pts = LEVELS[v.level][1];
        await H.db.insert('infractions', { employee_name: v.emp, employee_id: H.empIdByName(v.emp), occurred_on: v.date, category: v.cat, level: v.level, points: pts, description: v.desc, corrective_action: v.action, recorded_by: H.who(), status: 'needs_signature', drop_off_on: H.addDays(v.date, tg.infraction_dropoff_days) });
        H.toast('Record saved · print it for signatures'); if (document.getElementById('p-infractions').classList.contains('active')) this.render(document.getElementById('infractionsApp')); hubRefreshCounts();
      } });
    },
    async markSigned(id, refused) {
      await H.db.update('infractions', id, { status: refused ? 'refused' : 'signed', signed_on: H.today() });
      H.toast(refused ? 'Marked refused to sign' : 'Marked signed'); this.render(document.getElementById('infractionsApp')); hubRefreshCounts();
    },
    async voidRec(id) {
      H.confirm('Void this record?', 'It stays in the history but no longer counts toward points.', 'Void record', async () => { await H.db.update('infractions', id, { status: 'void' }); this.render(document.getElementById('infractionsApp')); hubRefreshCounts(); }, true);
    },
    async print(id) {
      const r = (await H.db.list('infractions', { cache: false })).find(x => x.id === id); if (!r) return;
      const lv = LEVELS[r.level] || [r.level];
      const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><title>Infracción — ${H.esc(r.employee_name)}</title><style>body{font-family:Arial,sans-serif;font-size:11pt;color:#18181b;padding:28px 34px}h1{font-size:18pt;margin:0 0 4px}.m{display:grid;grid-template-columns:1fr 1fr;gap:6px 24px;border-top:2px solid #18181b;border-bottom:1px solid #ddd;padding:10px 0;margin:12px 0}.l{font-size:8.5pt;color:#666;text-transform:uppercase;letter-spacing:.05em}.b{border:1px solid #ccc;border-radius:4px;padding:10px;min-height:70px;margin:4px 0 14px;white-space:pre-wrap}.s{display:grid;grid-template-columns:1fr 1fr;gap:28px 30px;margin-top:30px}.s div{border-top:1px solid #333;padding-top:4px;font-size:9pt}</style></head><body>
        <h1>Formulario de Acción Disciplinaria</h1><div>Chick-fil-A Los Filtros · ${H.esc(r.id.slice(0, 8).toUpperCase())}</div>
        <div class="m"><div><div class="l">Miembro del equipo</div><strong>${H.esc(r.employee_name)}</strong></div><div><div class="l">Fecha del incidente</div><strong>${H.fmtD(r.occurred_on, { month: 'long', day: 'numeric', year: 'numeric' })}</strong></div>
        <div><div class="l">Política</div><strong>${H.esc(r.category)}</strong></div><div><div class="l">Acción</div><strong>${H.esc(lv[0])} (+${r.points} pts)</strong></div><div><div class="l">Registrado por</div>${H.esc(r.recorded_by || '')}</div><div><div class="l">Puntos expiran</div>${r.drop_off_on ? H.fmtD(r.drop_off_on, { month: 'long', day: 'numeric', year: 'numeric' }) : '—'}</div></div>
        <div class="l">Describa el incidente</div><div class="b">${H.esc(r.description || '')}</div><div class="l">Acción correctiva</div><div class="b">${H.esc(r.corrective_action || '')}</div>
        <p style="font-size:9pt">Al firmar este documento reconozco que este informe ha sido discutido y explicado por mi supervisor y que se me brindó la oportunidad de explicar mi versión de los hechos.</p>
        <div class="s"><div>Firma del miembro del equipo</div><div>Fecha</div><div>Firma del supervisor</div><div>Fecha</div><div>Firma del testigo (si se niega a firmar)</div><div>Fecha</div></div>
        <script>window.onload=()=>window.print()<\/script></body></html>`;
      const w = window.open('', '_blank');
      if (!w) return H.toast('Allow pop-ups to print this form');
      w.document.write(html); w.document.close();
    },
    async editRules() {
      const tg = await H.targets();
      H.form({ title: 'Point rules', intro: 'Coaching = 1 pt, verbal = 2, written = 3, final = 4. Set when points drop off and the levels that flag someone.', fields: [
        { id: 'drop', label: 'Points drop off after (days)', type: 'number', value: tg.infraction_dropoff_days, required: true },
        { id: 'w', label: 'Written warning at (points)', type: 'number', value: tg.infraction_written_at, required: true, half: true },
        { id: 'f', label: 'Final warning at (points)', type: 'number', value: tg.infraction_final_at, required: true, half: true },
      ], onSubmit: async v => { await H.setTarget('infraction_dropoff_days', v.drop); await H.setTarget('infraction_written_at', v.w); await H.setTarget('infraction_final_at', v.f); H.toast('Rules saved'); this.render(document.getElementById('infractionsApp')); } });
    },
  };
  function recCard(r, today) {
    const lv = LEVELS[r.level] || [r.level, r.points, ''];
    const st = r.status === 'needs_signature' ? '<span class="pill amber">Needs signature</span>' : r.status === 'signed' ? '<span class="pill green">Signed</span>' : r.status === 'refused' ? '<span class="pill red">Refused to sign</span>' : '';
    const expired = r.drop_off_on && r.drop_off_on <= today;
    return `<div class="card card-pad ${r.level === 'coaching' ? 'top-foh' : r.level === 'verbal' ? 'top-warn' : 'top-boh'}" style="${expired ? 'opacity:.6' : ''}">
      <div class="between small muted"><span>${H.fmtD(r.occurred_on, { month: 'short', day: 'numeric', year: 'numeric' })}</span>${st}</div>
      <div class="row" style="margin:8px 0"><div class="avatar" style="background:var(--text-mid)">${H.initials(r.employee_name)}</div><div style="min-width:0"><div class="strong">${H.esc(r.employee_name)}</div><div class="small muted">by ${H.esc(H.shortName(r.recorded_by || '—'))}</div></div></div>
      <div class="row" style="flex-wrap:wrap;gap:5px;margin-bottom:8px"><span class="pill">${H.esc(r.category)}</span><span class="pill ${lv[2]}">${H.esc(lv[0])}</span><span class="pill outline">+${r.points} pt${r.points === 1 ? '' : 's'}</span></div>
      <div class="small" style="color:var(--text-mid);display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden">${H.esc(r.description)}</div>
      <div class="small muted mt-s">${expired ? 'Points dropped off ' : 'Points drop off '}${r.drop_off_on ? H.fmtD(r.drop_off_on) : '—'}</div>
      <div class="row mt-s" style="flex-wrap:wrap;gap:6px"><button class="btn btn-sm" onclick="H.pages.infractions.print('${r.id}')">Print</button>${r.status === 'needs_signature' ? `<button class="btn btn-sm btn-ok-quiet" onclick="H.pages.infractions.markSigned('${r.id}')">Mark signed</button><button class="btn btn-sm btn-ghost" onclick="H.pages.infractions.markSigned('${r.id}',true)">Refused</button>` : ''}<button class="btn btn-sm btn-ghost" onclick="H.pages.infractions.voidRec('${r.id}')">Void</button></div>
    </div>`;
  }

  // ═════════════ USERS & ACCESS (operator only) ═════════════
  H.pages.access = {
    async render(host) {
      host.innerHTML = `<div class="ph"><div><h2>Users &amp; access <span class="pill dark" style="vertical-align:middle;margin-left:6px">Operator only</span></h2><p>Who can sign in and what each person can see.</p></div>
        <div class="actions"><button class="btn" onclick="H.pages.access.backup()">Download full backup</button><button class="btn btn-primary" onclick="H.pages.access.invite()">Invite someone</button></div></div><div id="acBody"><div class="li-empty">Loading…</div></div>`;
      const [profiles, access, invites] = await Promise.all([H.db.list('profiles', { cache: false }), H.db.list('hub_access', { cache: false }), H.db.list('hub_invites', { cache: false, order: 'created_at', asc: false })]);
      const body = document.getElementById('acBody'); if (!body) return;
      const acc = Object.fromEntries((access || []).map(a => [a.user_id, a]));
      const users = (profiles || []).map(p => ({ ...p, role: H.normRole(p.role), custom: acc[p.id] && Array.isArray(acc[p.id].sections) && acc[p.id].sections.length ? acc[p.id].sections : null }));
            body.innerHTML = `
        ${profiles === null ? `<div class="source warn"><span>The user list could not be read (${H.esc((H.db.lastError || {}).message || 'permission denied')}). Run <code>sql/2026-10-hub-v2.sql</code> so the operator can see every profile.</span></div>` : ''}
        <div class="section-label">People</div>
        <div class="tbl-wrap"><div class="tbl-scroll"><table><thead><tr><th>Name</th><th>Role</th><th>Access</th><th class="r"></th></tr></thead><tbody>
          ${users.map(u => `<tr><td><div style="color:var(--text);font-weight:600">${H.esc(u.name || u.email || u.id)}</div><div class="small muted">${H.esc(u.email || '')}</div></td>
            <td>${u.id === (H.user() || {}).id ? `<span class="pill dark">${H.ROLE_LABELS[u.role]}</span> <span class="small muted">you</span>` : `<select class="sel" onchange="H.pages.access.setRole('${u.id}',this.value)">${['operator', 'director', 'shift_leader', 'marketing', 'team_member'].map(r => `<option value="${r}" ${r === H.normRole(u.role) ? 'selected' : ''}>${H.ROLE_LABELS[r]}</option>`).join('')}</select>`}</td>
            <td style="max-width:520px">${u.role === 'operator' ? '<span class="small muted">Everything</span>' : `<span class="small">${H.esc(H.sectionsFor(u.role, u.custom).map(x => H.SECTION_LABELS[x]).join(', '))}</span>`}</td>
            <td class="r">${u.id === (H.user() || {}).id ? '' : `<button class="btn btn-sm" onclick="H.pages.access.editAccess('${u.id}')">Edit access</button>`}</td></tr>`).join('') || '<tr><td colspan="4" class="muted">No profiles found.</td></tr>'}
        </tbody></table></div></div>
        ${(invites || []).filter(i => !i.accepted_at).length ? `<div class="section-label" style="margin-top:22px">Invited</div><div class="list">${invites.filter(i => !i.accepted_at).map(i => `<div class="li">${H.icon('people', 'blue')}<div><div class="li-title">${H.esc(i.name || i.email)}</div><div class="li-sub">${H.esc(i.email)} · ${H.ROLE_LABELS[i.role] || i.role} · invited ${H.fmtD(H.isoOfTs(i.created_at))}</div></div><span class="pill amber">Waiting for first sign-in</span></div>`).join('')}</div>` : ''}
        <div class="source mt" style="margin-top:22px"><span>Changes apply the next time that person signs in. FCR trends and Users &amp; access are only ever shown to the Operator. Monthly P&amp;L, Christmas bonus, saved reconciliations and QuickBooks are also locked to the Operator in the database itself, whatever is ticked here.</span></div>`;
    },
    async setRole(id, role) {
      try { const { error } = await getSupa().from('profiles').update({ role }).eq('id', id); if (error) throw error; H.db.bust('profiles'); H.toast(`Role changed to ${H.ROLE_LABELS[role]}`); this.render(document.getElementById('accessApp')); }
      catch (e) { H.toast('Could not change role: ' + e.message); }
    },
    async editAccess(id) {
      const [profiles, access] = await Promise.all([H.db.list('profiles', { cache: false }), H.db.list('hub_access', { cache: false })]);
      const p = profiles.find(x => x.id === id); const a = (access || []).find(x => x.user_id === id);
      const role = H.normRole(p.role); const cur = a && a.sections && a.sections.length ? a.sections : H.sectionsFor(role);
      H.modal(`<h3>${H.esc(p.name || p.email)}</h3><p class="muted small" style="margin:-10px 0 14px">${H.ROLE_LABELS[role]} · tick the sections this person can open.</p>
        <div class="grid g2" style="gap:6px 16px">${H.SECTIONS.filter(s => !['fcr', 'access'].includes(s) || role === 'operator').map(s => `<label class="checkbox-row" style="margin:0"><input type="checkbox" value="${s}" ${cur.includes(s) ? 'checked' : ''} ${s === 'home' ? 'disabled' : ''}/> ${H.esc(H.SECTION_LABELS[s])}</label>`).join('')}</div>
        <div class="mfooter"><button class="btn btn-ghost" id="acReset">Use role default</button><button class="btn" onclick="H.closeModal()">Cancel</button><button class="btn btn-primary" id="acSave">Save access</button></div>`);
      document.getElementById('acSave').onclick = async () => {
        const secs = ['home', ...[...document.querySelectorAll('#hubModalBody input:checked')].map(x => x.value).filter(x => x !== 'home')];
        try { await H.db.upsert('hub_access', [{ user_id: id, sections: secs, updated_at: new Date().toISOString(), updated_by: H.who() }], 'user_id'); H.closeModal(); H.toast('Access saved'); this.render(document.getElementById('accessApp')); } catch (e) { H.toast(e.message); }
      };
      document.getElementById('acReset').onclick = async () => {
        try { await H.db.upsert('hub_access', [{ user_id: id, sections: null, updated_at: new Date().toISOString(), updated_by: H.who() }], 'user_id'); H.closeModal(); H.toast('Back to role default'); this.render(document.getElementById('accessApp')); } catch (e) { H.toast(e.message); }
      };
    },
    // One-click backup: reads every original table and saves a JSON file. Read-only.
    async backup() {
      const tables = ['employees', 'monthly_records', 'time_off_log', 'imported_periods', 'audit_log', 'app_settings', 'profiles', 'catering_orders', 'fcr_reports', 'fcr_line_items',
        'equipment', 'equipment_tasks', 'equipment_log', 'equipment_repairs', 'food_cost_periods', 'productivity_days', 'staff_positions', 'staffing_targets', 'candidates', 'one_on_ones', 'infractions', 'marketing_posts', 'marketing_events', 'community_requests', 'rep_snapshots', 'rep_reviews', 'hub_targets', 'hub_access'];
      H.toast('Collecting every table…');
      const out = { taken_at: new Date().toISOString(), taken_by: H.who(), tables: {} }; const counts = [];
      for (const t of tables) {
        const rows = []; let from = 0;
        while (true) {
          const { data, error } = await getSupa().from(t).select('*').range(from, from + 999);
          if (error) { out.tables[t] = { error: error.message }; break; }
          rows.push(...(data || [])); if (!data || data.length < 1000) break; from += 1000;
        }
        if (!out.tables[t]) { out.tables[t] = rows; counts.push(`${t}: ${rows.length}`); }
      }
      const blob = new Blob([JSON.stringify(out, null, 1)], { type: 'application/json' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `losfiltroshub-backup-${H.today()}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      H.modal(`<h3>Backup downloaded</h3><p class="muted small" style="margin-top:-8px">Saved as <strong>losfiltroshub-backup-${H.today()}.json</strong>. Rows in each table:</p><div class="small" style="columns:2;margin-top:10px">${counts.map(c => `<div>${H.esc(c)}</div>`).join('')}</div><div class="mfooter"><button class="btn btn-dark" onclick="H.closeModal()">Done</button></div>`);
    },
    invite() {
      H.form({ title: 'Invite someone', intro: 'Saves their role now. Then create their login in Supabase → Authentication → Add user with the same email. Their role applies on first sign-in.', fields: [
        { id: 'name', label: 'Name', required: true, half: true },
        { id: 'email', label: 'Email', type: 'email', required: true, half: true },
        { id: 'role', label: 'Role', type: 'select', value: 'shift_leader', options: ['director', 'shift_leader', 'marketing'].map(r => ({ value: r, label: H.ROLE_LABELS[r] })) },
      ], submit: 'Save invite', onSubmit: async v => { await H.db.insert('hub_invites', { name: v.name, email: v.email.toLowerCase(), role: v.role, invited_by: H.who() }); H.toast('Invite saved'); this.render(document.getElementById('accessApp')); } });
    },
  };

  // apply per-person access + invites at login (reads only)
  const _origLogin = window.hubOnLogin;
  window.hubOnLogin = async user => {
    _origLogin(user);
    try {
      if (user.id) {
        const acc = await H.db.list('hub_access', { eq: { user_id: user.id }, cache: false });
        if (acc && acc[0] && Array.isArray(acc[0].sections) && acc[0].sections.length) { currentUser.sections = acc[0].sections; _origLogin(currentUser); }
      }
    } catch (e) {}
  };
})();
