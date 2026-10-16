/* ═══════════════════════════════════════════════════════════
   LOS FILTROS HUB — Operations & Costs
   Equipment · Food cost · Productivity
   Writes only to: equipment, equipment_repairs, food_cost_periods, food_cost_items,
   productivity_days, hub_targets.
   ═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const H = window.H;
  const AREAS = ['BOH', 'FOH', 'Drive-thru', 'Facility'];
  const AREA_PILL = { BOH: 'red', FOH: 'blue', 'Drive-thru': 'purple', Facility: '' };

  // ═════════════ EQUIPMENT ═════════════
  // One tile per machine (loaded from an uploaded equipment list). Each tile keeps that machine's repair history.
  const EQ = { filter: 'All', q: '' };

  async function eqLoad() {
    const [eq, repairs] = await Promise.all([H.db.list('equipment', { order: 'name' }), H.db.list('equipment_repairs', { order: 'opened_on', asc: false })]);
    return { eq, repairs };
  }

  H.pages.equipment = {
    async render(host) {
      host.innerHTML = `<div class="ph"><div><h2>Equipment</h2><p>One tile per machine. Open a tile to log a repair and see everything that's been done to it.</p></div>
        <div class="actions"><button class="btn" onclick="H.pages.equipment.addEquipment()">Add equipment</button><button class="btn btn-primary" onclick="H.pages.equipment.uploadList()">Upload equipment list</button></div></div>
        <div id="eqBody"><div class="li-empty">Loading equipment…</div></div>`;
      const { eq, repairs } = await eqLoad();
      const body = document.getElementById('eqBody'); if (!body) return;
      if (eq === null) { body.innerHTML = ''; return H.missingTable(body, 'equipment'); }
      const active = eq.filter(e => e.status !== 'retired');
      if (!active.length) {
        body.innerHTML = `<div class="card card-pad" style="max-width:640px">
          <div class="strong" style="font-size:1.05rem">No equipment yet</div>
          <p class="muted mt-s" style="max-width:56ch">Upload your equipment list (Excel or CSV) and every machine becomes its own tile. Columns like name, area, type, make, model, serial number, location, purchase date, warranty and service vendor are picked up automatically; anything missing can be filled in later.</p>
          <div class="row mt" style="flex-wrap:wrap"><button class="btn btn-primary" onclick="H.pages.equipment.uploadList()">Upload equipment list</button><button class="btn" onclick="H.pages.equipment.addEquipment()">Add one machine</button></div></div>`;
        return;
      }
      const byEq = {}; (repairs || []).forEach(r => (byEq[r.equipment_id] ||= []).push(r));
      const areas = ['All', ...[...new Set(active.map(e => e.area).filter(Boolean))].sort()];
      const q = EQ.q.toLowerCase();
      const shown = active.filter(e => (EQ.filter === 'All' || e.area === EQ.filter) && (!q || [e.name, e.category, e.make, e.model, e.serial, e.location, e.asset_id].join(' ').toLowerCase().includes(q)));
      body.innerHTML = `
        <div class="toolbar mb"><div class="chips" style="margin:0">${areas.map(a => `<button class="chip ${EQ.filter === a ? 'active' : ''}" onclick='H.pages.equipment.setFilter(${JSON.stringify(a)})'>${H.esc(a)}<span class="n">${a === 'All' ? active.length : active.filter(e => e.area === a).length}</span></button>`).join('')}</div>
          <input class="sinput" style="margin-left:auto" placeholder="Search name, model, serial…" value="${H.esc(EQ.q)}" oninput="H.pages.equipment.search(this.value)" aria-label="Search equipment"/></div>
        <div class="grid g4" id="eqTiles">${shown.map(e => tile(e, byEq[e.id] || [])).join('') || '<div class="list" style="grid-column:1/-1"><div class="li-empty">No machines match.</div></div>'}</div>`;
    },
    setFilter(a) { EQ.filter = a; this.render(document.getElementById('equipmentApp')); },
    search(v) { EQ.q = v; clearTimeout(this._t); this._t = setTimeout(() => { const pos = document.activeElement && document.activeElement.selectionStart; this.render(document.getElementById('equipmentApp')).then(() => { const i = document.querySelector('#eqBody .sinput'); if (i) { i.focus(); try { i.setSelectionRange(pos, pos); } catch (e) {} } }); }, 200); },

    async details(id) {
      const [eq, reps] = await Promise.all([H.db.list('equipment', { cache: false }), H.db.list('equipment_repairs', { cache: false, order: 'opened_on', asc: false })]);
      const e = (eq || []).find(x => x.id === id); if (!e) return;
      const mine = (reps || []).filter(r => r.equipment_id === id);
      const today = H.today();
      const spec = [['Type', e.category], ['Area', e.area], ['Location', e.location], ['Make', e.make], ['Model', e.model], ['Serial', e.serial], ['Purchased', e.purchased_on && H.fmtD(e.purchased_on, { month: 'short', day: 'numeric', year: 'numeric' })], ['Warranty until', e.warranty_until && (H.fmtD(e.warranty_until, { month: 'short', day: 'numeric', year: 'numeric' }) + (e.warranty_until < today ? ' (expired)' : ''))], ['Service vendor', [e.vendor, e.vendor_phone].filter(Boolean).join(' · ')], ['CFA asset ID', e.asset_id], ['Life cycle', e.life_cycle_years ? `${+e.life_cycle_years} years` : null], ['Anticipated replacement', e.replace_by && H.fmtD(e.replace_by, { month: 'short', day: 'numeric', year: 'numeric' })]].filter(x => x[1]);
      const total = mine.reduce((s, r) => s + (+r.cost || 0), 0);
      H.modal(`<div class="between" style="margin-bottom:14px"><h3 style="margin:0">${H.esc(e.name)}</h3><button class="btn btn-sm" onclick="H.closeModal()">Close</button></div>
        <div class="grid g2" style="gap:8px 18px;margin-bottom:16px">${spec.map(([k, v]) => `<div class="small"><span class="muted">${k}</span><div style="font-weight:600">${H.esc(v)}</div></div>`).join('') || '<div class="muted small">No details yet. Use Edit details to add them.</div>'}</div>
        ${e.description ? `<div class="small muted" style="margin-bottom:10px">${H.esc(e.description)}</div>` : ''}
        ${e.notes ? `<div class="small" style="white-space:pre-wrap;margin-bottom:14px">${H.esc(e.notes)}</div>` : ''}
        <div class="section-label">Repairs <span class="muted" style="text-transform:none;letter-spacing:0">${mine.length} · ${H.money(total, true)} total</span></div>
        <div class="list" style="max-height:300px;overflow:auto">${mine.map(r => `<div class="li" style="grid-template-columns:76px minmax(0,1fr) auto;align-items:flex-start">
            <div class="small muted">${H.fmtD(r.opened_on, { month: 'short', day: 'numeric', year: 'numeric' })}</div>
            <div style="min-width:0"><div class="li-title" style="font-size:.86rem">${H.esc(r.issue)}</div><div class="li-sub">${H.esc([r.notes, r.vendor, r.opened_by && 'logged by ' + H.shortName(r.opened_by)].filter(Boolean).join(' · '))}</div></div>
            <div style="text-align:right"><div class="small strong">${r.cost ? H.money(r.cost, true) : ''}</div>${r.status !== 'closed' ? `<button class="btn btn-sm btn-ok-quiet mt-s" onclick="H.pages.equipment.closeRepair('${r.id}','${id}')">Mark fixed</button>` : '<span class="pill green">Fixed</span>'}</div></div>`).join('') || '<div class="li-empty">No repairs logged for this machine.</div>'}</div>
        <div class="mfooter"><button class="btn btn-ghost" onclick='H.pages.equipment.editEq("${id}")'>Edit details</button><button class="btn btn-primary" onclick="H.pages.equipment.logRepair('${id}')">Log a repair</button></div>`, true);
    },
    async logRepair(eqId) {
      const eq = await H.db.list('equipment', { cache: false });
      const e = (eq || []).find(x => x.id === eqId) || {};
      H.form({ title: `Log a repair · ${e.name || ''}`, fields: [
        { id: 'date', label: 'Date', type: 'date', value: H.today(), required: true, half: true },
        { id: 'status', label: 'Status', type: 'select', half: true, options: [{ value: 'closed', label: 'Fixed' }, { value: 'open', label: 'Still being worked on' }] },
        { id: 'issue', label: 'What was wrong', type: 'textarea', required: true, placeholder: 'e.g. Not reaching temperature, error E4' },
        { id: 'notes', label: 'What was done', type: 'textarea', placeholder: 'e.g. Replaced the high-limit switch' },
        { id: 'vendor', label: 'Who fixed it', half: true, value: e.vendor || '' },
        { id: 'cost', label: 'Cost', type: 'number', step: '0.01', half: true },
      ], submit: 'Save repair', onSubmit: async v => {
        await H.db.insert('equipment_repairs', { equipment_id: eqId, opened_on: v.date, issue: v.issue, notes: v.notes, vendor: v.vendor, cost: v.cost, status: v.status, closed_on: v.status === 'closed' ? v.date : null, opened_by: H.who(), closed_by: v.status === 'closed' ? H.who() : null });
        H.toast('Repair saved'); await this.render(document.getElementById('equipmentApp')); setTimeout(() => this.details(eqId), 50); return false;
      } });
    },
    async closeRepair(id, eqId) {
      await H.db.update('equipment_repairs', id, { status: 'closed', closed_on: H.today(), closed_by: H.who() });
      H.toast('Marked fixed'); await this.render(document.getElementById('equipmentApp')); this.details(eqId);
    },
    addEquipment(existing) {
      const e = existing || {};
      H.form({ title: existing ? `Edit ${e.name}` : 'Add equipment', wide: true, fields: [
        { id: 'name', label: 'Name', required: true, value: e.name, placeholder: 'e.g. Pressure fryer #1', half: true },
        { id: 'area', label: 'Area', value: e.area, list: ['BOH', 'FOH', 'Drive-thru', 'Facility'], half: true },
        { id: 'category', label: 'Type', value: e.category, list: ['Pressure fryer', 'Open fryer', 'Grill', 'Walk-in cooler', 'Walk-in freezer', 'Ice machine', 'Beverage', 'Breading table', 'HVAC', 'POS / tech', 'Other'], half: true },
        { id: 'location', label: 'Location', value: e.location, half: true },
        { id: 'make', label: 'Make', value: e.make, half: true },
        { id: 'model', label: 'Model', value: e.model, half: true },
        { id: 'serial', label: 'Serial number', value: e.serial, half: true },
        { id: 'purchased_on', label: 'Purchased', type: 'date', value: e.purchased_on, half: true },
        { id: 'warranty_until', label: 'Warranty until', type: 'date', value: e.warranty_until, half: true },
        { id: 'vendor', label: 'Service vendor', value: e.vendor, half: true },
        { id: 'vendor_phone', label: 'Vendor phone', value: e.vendor_phone, half: true },
        { id: 'notes', label: 'Notes', type: 'textarea', value: e.notes },
      ], submit: existing ? 'Save' : 'Add equipment',
      extraButtons: existing ? `<button type="button" class="btn btn-danger-quiet" onclick="H.pages.equipment.retire('${e.id}')">Remove machine</button>` : '',
      onSubmit: async v => {
        const row = { name: v.name, area: v.area, category: v.category, location: v.location, make: v.make, model: v.model, serial: v.serial, purchased_on: v.purchased_on, warranty_until: v.warranty_until, vendor: v.vendor, vendor_phone: v.vendor_phone, notes: v.notes };
        if (existing) { await H.db.update('equipment', e.id, row); H.toast('Saved'); }
        else { await H.db.insert('equipment', { ...row, status: 'ok', created_by: H.who() }); H.toast(`${v.name} added`); }
        this.render(document.getElementById('equipmentApp'));
      } });
    },
    async editEq(id) { const eq = await H.db.list('equipment', { cache: false }); this.addEquipment(eq.find(x => x.id === id)); },
    retire(id) {
      H.confirm('Remove this machine?', 'Its tile disappears. Its repair history is kept in the database.', 'Remove', async () => { await H.db.update('equipment', id, { status: 'retired' }); this.render(document.getElementById('equipmentApp')); }, true);
    },

    // ── Upload an equipment list (CSV or Excel) ──
    uploadList() {
      H.modal(`<h3>Upload equipment list</h3><p class="muted small" style="margin:-10px 0 14px">Excel (.xlsx) or CSV, one machine per row with a header row. Nothing is saved until you check the list and click Add.</p>
        <div class="upzone compact" onclick="document.getElementById('eqFile').click()"><div class="up-link">Choose a file</div><div class="up-sub">.xlsx, .xls or .csv</div></div>
        <input type="file" id="eqFile" accept=".xlsx,.xls,.csv,.tsv,.txt,.pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv" style="display:none"/>
        <div id="eqPrev" class="mt"></div>
        <div class="mfooter"><button class="btn" onclick="H.closeModal()">Cancel</button><button class="btn btn-primary" id="eqAdd" disabled>Add machines</button></div>`, true);
      let rows = [];
      document.getElementById('eqFile').onchange = async ev => {
        const f = ev.target.files[0]; if (!f) return;
        const prev = document.getElementById('eqPrev'); prev.innerHTML = '<div class="small muted">Reading…</div>';
        try {
          const raw = await readTable(f);
          const existing = (await H.db.list('equipment', { cache: false })) || [];
          const isCfa = (raw.headers || []).includes('csi_description') && (raw.headers || []).includes('asset_description');
          rows = isCfa ? mapCfaAssetListing(raw) : raw.map(mapEquipmentRow).filter(r => r.name);
          const dupKey = r => r.asset_id ? `asset:${r.asset_id}` : `${(r.name || '').toLowerCase()}|${(r.serial || '').toLowerCase()}`;
          const have = new Set(existing.filter(x => x.status !== 'retired').map(dupKey));
          rows.forEach(r => { r._dup = have.has(dupKey(r)); });
          const fresh = rows.filter(r => !r._dup);
          prev.innerHTML = rows.length ? `<div class="small" style="margin-bottom:8px">${isCfa ? '<span class="pill blue" style="margin-right:6px">CFA asset listing</span>' : ''}<strong style="color:var(--ok)">${fresh.length} machine${fresh.length === 1 ? '' : 's'} ready to add</strong>${rows.length - fresh.length ? ` · ${rows.length - fresh.length} already in the hub (skipped)` : ''}</div>
            <div class="tbl-wrap" style="max-height:300px;overflow:auto"><table><thead><tr><th>Name</th><th>Area</th><th>Type</th><th>Make / model</th><th>Serial</th></tr></thead><tbody>
            ${rows.map(r => `<tr style="${r._dup ? 'opacity:.45' : ''}"><td style="color:var(--text);font-weight:600">${H.esc(r.name)}</td><td>${H.esc(r.area || '—')}</td><td>${H.esc(r.category || '—')}</td><td>${H.esc([r.make, r.model].filter(Boolean).join(' ') || '—')}</td><td>${H.esc(r.serial || '—')}</td></tr>`).join('')}</tbody></table></div>`
            : `<div class="small" style="color:var(--bad)">No machines found in this file. Columns found: ${H.esc((raw.headers || []).join(', ') || 'none')}. Send the file to Claude if it looks right to you.</div>`;
          document.getElementById('eqAdd').disabled = !fresh.length;
        } catch (e) { prev.innerHTML = `<div class="small" style="color:var(--bad)">${H.esc(e.message)}</div>`; }
      };
      document.getElementById('eqAdd').onclick = async () => {
        const b = document.getElementById('eqAdd'); b.disabled = true;
        try {
          const fresh = rows.filter(r => !r._dup).map(({ _dup, ...r }) => ({ ...r, status: 'ok', created_by: H.who() }));
          for (let i = 0; i < fresh.length; i += 200) {
            const { error } = await getSupa().from('equipment').insert(fresh.slice(i, i + 200));
            if (error) throw new Error(error.message);
          }
          H.db.bust('equipment'); H.closeModal(); H.toast(`${fresh.length} machines added`); this.render(document.getElementById('equipmentApp'));
        } catch (e) { document.getElementById('eqPrev').insertAdjacentHTML('beforeend', `<div class="small" style="color:var(--bad);margin-top:8px">Could not save: ${H.esc(e.message)}</div>`); b.disabled = false; }
      };
    },
  };

  function tile(e, reps) {
    const open = reps.filter(r => r.status !== 'closed');
    const last = reps[0];
    const total = reps.reduce((s, r) => s + (+r.cost || 0), 0);
    return `<div class="card card-pad" role="button" tabindex="0" style="cursor:pointer;display:flex;flex-direction:column;gap:8px" onclick="H.pages.equipment.details('${e.id}')" onkeydown="if(event.key==='Enter')H.pages.equipment.details('${e.id}')">
      <div class="between" style="align-items:flex-start"><div class="strong" style="font-size:.95rem;min-width:0">${H.esc(e.name)}</div>${e.area ? `<span class="pill ${AREA_PILL[e.area] || ''}">${H.esc(e.area)}</span>` : ''}</div>
      <div class="small muted" style="min-height:1.2em">${H.esc([e.category && !String(e.name || '').toLowerCase().startsWith(String(e.category).toLowerCase()) ? e.category : '', e.location].filter(Boolean).join(' · '))}</div>
      <div class="small" style="color:var(--text-mid)">${H.esc([e.make, e.model].filter(Boolean).join(' ') || '')}${e.serial ? `<div class="muted">S/N ${H.esc(e.serial)}</div>` : ''}${e.replace_by ? `<div class="muted">Replace by ${H.fmtD(e.replace_by, { month: 'short', year: 'numeric' })}${e.replace_by < H.today() ? ' <span class="pill amber">Past due</span>' : ''}</div>` : ''}</div>
      <div class="small" style="margin-top:auto;padding-top:8px;border-top:1px solid #F0F0F2;color:var(--text-mid)">${reps.length ? `${reps.length} repair${reps.length === 1 ? '' : 's'} · last ${H.fmtD(last.opened_on)}${total ? ' · ' + H.money(total) : ''}` : '<span class="muted">No repairs logged</span>'}${open.length ? ' <span class="pill amber" style="margin-left:4px">In repair</span>' : ''}</div>
    </div>`;
  }

  // reads .csv directly; .xlsx/.xls via SheetJS loaded only when needed.
  // Finds the real header row (lists often have a title or blank rows on top),
  // picks the sheet that looks most like an equipment list, and handles Spanish headers.
  H.readTable = file => readTable(file);
  const norm = k => String(k == null ? '' : k).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  const HEADER_WORDS = ['name', 'nombre', 'equipment', 'equipo', 'description', 'descripcion', 'item', 'articulo', 'asset', 'activo', 'area', 'station', 'estacion', 'type', 'tipo', 'category', 'categoria',
    'make', 'marca', 'brand', 'manufacturer', 'fabricante', 'model', 'modelo', 'serial', 'serie', 'location', 'ubicacion', 'localizacion', 'purchase', 'compra', 'warranty', 'garantia',
    'vendor', 'suplidor', 'proveedor', 'tecnico', 'technician', 'phone', 'telefono', 'notes', 'notas', 'job', 'position', 'puesto', 'employee', 'empleado',
    'gross', 'bruto', 'wages', 'salario', 'pay', 'paga', 'hours', 'horas', 'regular', 'overtime', 'check', 'date', 'fecha'];
  function headerScore(row) { return (row || []).reduce((n, c) => { const k = norm(c); return n + (k && HEADER_WORDS.some(w => k === w || k.includes(w)) ? 1 : 0); }, 0); }
  function rowsFromArrays(arr) {
    arr = (arr || []).filter(r => Array.isArray(r) && r.some(c => String(c ?? '').trim() !== ''));
    if (!arr.length) return { rows: [], score: 0 };
    let hi = 0, best = -1;
    arr.slice(0, 15).forEach((r, i) => { const sc = headerScore(r); if (sc > best) { best = sc; hi = i; } });
    if (best <= 0) hi = 0; // no recognisable header: treat the first row as the header
    const hdr = arr[hi].map((h, i) => norm(h) || `col_${i + 1}`);
    const rows = arr.slice(hi + 1).map(r => { const o = {}; hdr.forEach((h, i) => { if (!(h in o) || o[h] === '') o[h] = r[i] == null ? '' : r[i]; }); return o; });
    return { rows, score: best * 1000 + rows.length, headers: hdr };
  }
  function csvArrays(text) {
    const out = []; let row = [], cur = '', q = false;
    const t = String(text || '').replace(/^﻿/, '');
    const delim = (t.split('\n')[0].match(/;/g) || []).length > (t.split('\n')[0].match(/,/g) || []).length ? ';' : (t.split('\n')[0].includes('\t') ? '\t' : ',');
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (q) { if (ch === '"' && t[i + 1] === '"') { cur += '"'; i++; } else if (ch === '"') q = false; else cur += ch; continue; }
      if (ch === '"') q = true; else if (ch === delim) { row.push(cur.trim()); cur = ''; } else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; row.push(cur.trim()); out.push(row); row = []; cur = ''; } else cur += ch;
    }
    if (cur !== '' || row.length) { row.push(cur.trim()); out.push(row); }
    return out;
  }
  async function readTable(file) {
    const name = file.name || '';
    if (/\.pdf$/i.test(name)) throw new Error('PDF lists can\'t be read here. Save it as Excel or CSV, or send the PDF to Claude and it will add the machines for you.');
    if (/\.(csv|txt|tsv)$/i.test(name)) { const r = rowsFromArrays(csvArrays(await file.text())); r.rows.headers = r.headers; return r.rows; }
    if (!window.XLSX) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; s.onload = res; s.onerror = () => rej(new Error('Could not load the Excel reader. Save the file as CSV and try again.')); document.head.appendChild(s); });
    let wb;
    try { wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true }); }
    catch (e) { throw new Error('This file could not be opened as a spreadsheet. If it is password-protected or a Numbers file, export it as .xlsx or .csv first.'); }
    let best = { rows: [], score: -1 };
    for (const sn of wb.SheetNames) {
      const arr = XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, defval: '', raw: false, dateNF: 'yyyy-mm-dd', blankrows: false });
      const r = rowsFromArrays(arr);
      if (r.score > best.score) best = r;
    }
    best.rows.headers = best.headers;
    return best.rows;
  }
  // CFA "Location Asset Listing" export (CSI Description, Manufacturer, Model Number, Serial Number, Asset ID,
  // Asset Description, Purchase Date, Life Cycle, Anticipated Replacement…). One tile per asset; machines of the
  // same kind are numbered (#1, #2…) in serial-number order so each one keeps its own repair history.
  function mapCfaAssetListing(raw) {
    const s = v => { const t = String(v ?? '').trim(); return t && t.toUpperCase() !== 'UNKNOWN' ? t : null; };
    const list = raw.filter(r => s(r.csi_description) && !/inactive|disposed|retired/i.test(String(r.status || '')))
      .map(r => ({ r, kind: s(r.csi_description).replace(/\s+Replacement$/i, '') }));
    const counts = {}; list.forEach(x => { counts[x.kind] = (counts[x.kind] || 0) + 1; });
    const seen = {};
    list.sort((a, b) => a.kind.localeCompare(b.kind) || String(a.r.serial_number || '').localeCompare(String(b.r.serial_number || '')));
    return list.map(({ r, kind }) => {
      seen[kind] = (seen[kind] || 0) + 1;
      const life = H.toNum(r.life_cycle);
      return {
        name: counts[kind] > 1 ? `${kind} #${seen[kind]}` : kind,
        category: kind,
        area: areaForEquipment(kind),
        make: s(r.manufacturer), model: s(r.model_number), serial: s(r.serial_number),
        asset_id: s(r.asset_id) ? String(r.asset_id).replace(/\.0$/, '') : null,
        description: s(r.asset_description) ? String(r.asset_description).replace(/&#34;/g, '"').replace(/&amp;/g, '&') : null,
        purchased_on: H.toISO(s(r.purchase_date) || s(r.asset_start_date)),
        replace_by: life ? H.toISO(s(r.anticipated_replacement)) : null,
        life_cycle_years: life || null,
      };
    });
  }
  function areaForEquipment(kind) {
    const k = String(kind || '').toLowerCase();
    if (/drive-thru|drive thru|audio|headset/.test(k)) return 'Drive-thru';
    if (/hvac|water heater|exhaust|safe|co2|walk-in|sink/.test(k)) return 'Facility';
    if (/beverage|lemonade|ice cream|milkshake|coffee|tea brewer|ice machine|ice bin|lemon juicer/.test(k)) return 'FOH';
    return 'BOH';
  }
  function mapEquipmentRow(r) {
    const keys = Object.keys(r);
    // exact header match first, then "contains"; skip headers that clearly belong to another field
    const find = (cands, exclude = []) => {
      const ok = k => !exclude.some(x => k.includes(x));
      for (const c of cands) { const k = keys.find(k => k === c && ok(k)); if (k && String(r[k] ?? '').trim()) return String(r[k]).trim(); }
      for (const c of cands) { const k = keys.find(k => k.includes(c) && ok(k)); if (k && String(r[k] ?? '').trim()) return String(r[k]).trim(); }
      return null;
    };
    const firstText = () => { for (const k of keys) { const v = String(r[k] ?? '').trim(); if (v && !/^[\d\s.,$/-]+$/.test(v)) return v; } return null; };
    return {
      name: find(['name', 'nombre', 'equipment', 'equipo', 'equipment_name', 'nombre_del_equipo', 'description', 'descripcion', 'item', 'articulo', 'asset', 'activo'], ['vendor', 'serial', 'serie', 'model', 'contact', 'company', 'proveedor', 'suplidor', 'compania', 'tecnico']) || firstText(),
      area: find(['area', 'station', 'estacion', 'department', 'departamento', 'zone', 'zona']),
      category: find(['type', 'tipo', 'category', 'categoria', 'class', 'clase'], ['serial', 'serie']),
      location: find(['location', 'ubicacion', 'localizacion', 'lugar']),
      make: find(['make', 'marca', 'brand', 'manufacturer', 'fabricante', 'mfr']),
      model: find(['model', 'modelo']),
      serial: find(['serial', 'serial_number', 'numero_de_serie', 'serie', 's_n', 'sn', 'no_serie']),
      purchased_on: H.toISO(find(['purchase_date', 'purchased', 'fecha_de_compra', 'compra', 'install', 'installed', 'instalacion', 'in_service', 'acquired'])),
      warranty_until: H.toISO(find(['warranty', 'garantia'])),
      vendor: find(['vendor', 'service_vendor', 'service_company', 'suplidor', 'proveedor', 'technician', 'tecnico', 'company', 'compania'], ['phone', 'telefono', 'in_service']),
      vendor_phone: find(['vendor_phone', 'phone', 'telefono', 'tel', 'contact', 'contacto']),
      notes: find(['notes', 'note', 'notas', 'nota', 'comments', 'comment', 'comentarios']),
    };
  }



  // ═════════════ shared: "update from cfahome" import ═════════════
  function importModal({ title, intro, example, prompt, onRows }) {
    H.modal(`<h3>${H.esc(title)}</h3><p class="muted small" style="margin:-10px 0 14px">${H.esc(intro)}</p>
      <div class="field"><label for="impText">Paste rows (CSV with a header row, or JSON)</label><textarea id="impText" style="height:170px;font-family:ui-monospace,Menlo,monospace;font-size:.78rem" placeholder="${H.esc(example)}"></textarea></div>
      <div id="impPreview" class="small muted mt-s"></div>
      <details class="mt"><summary class="small" style="cursor:pointer;font-weight:600">What to tell Claude</summary>
        <div class="small" style="background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-top:8px;white-space:pre-wrap">${H.esc(prompt)}</div></details>
      <div class="mfooter"><button class="btn" onclick="H.closeModal()">Cancel</button><button class="btn" id="impCheck">Check rows</button><button class="btn btn-primary" id="impSave" disabled>Save</button></div>`, true);
    let parsed = null;
    const check = async () => {
      try {
        const rows = H.parseRows(document.getElementById('impText').value);
        const res = await onRows(rows, true);
        parsed = res.rows;
        document.getElementById('impPreview').innerHTML = res.html;
        document.getElementById('impSave').disabled = !parsed.length || !!res.block;
      } catch (e) { document.getElementById('impPreview').innerHTML = `<span style="color:var(--bad)">${H.esc(e.message)}</span>`; document.getElementById('impSave').disabled = true; }
    };
    document.getElementById('impCheck').onclick = check;
    document.getElementById('impText').addEventListener('input', () => { document.getElementById('impSave').disabled = true; });
    document.getElementById('impSave').onclick = async () => {
      if (!parsed) return; const b = document.getElementById('impSave'); b.disabled = true;
      try { await onRows(parsed, false); H.closeModal(); } catch (e) { document.getElementById('impPreview').innerHTML = `<span style="color:var(--bad)">${H.esc(e.message)}</span>`; b.disabled = false; }
    };
  }
  const pick = (r, ...keys) => { for (const k of keys) if (r[k] != null && r[k] !== '') return r[k]; return null; };
  // red = don't save until fixed · amber = worth a look, saving is allowed
  const flagHtml = (red, amber) => (red.length ? `<div style="color:var(--bad);margin-top:6px"><strong>Fix before saving (${red.length}):</strong><ul style="margin:4px 0 0 18px">${red.map(x => `<li>${H.esc(x)}</li>`).join('')}</ul></div>` : '')
    + (amber.length ? `<div style="color:var(--warn);margin-top:6px"><strong>Check (${amber.length}):</strong><ul style="margin:4px 0 0 18px">${amber.map(x => `<li>${H.esc(x)}</li>`).join('')}</ul></div>` : '')
    + (!red.length ? `<div style="color:var(--ok);margin-top:6px">${amber.length ? 'Nothing blocking. Save when the notes above look right.' : 'All checks passed.'}</div>` : '');
  const nearly = (a, b, tol) => a == null || b == null || Math.abs(+a - +b) <= tol;
  Object.assign(H, { importModal, pick, flagHtml, nearly, readTable });

  // ═════════════ FOOD COST ═════════════
  const FC = { month: null };
  async function fcLoad() {
    const rows = await H.db.list('food_cost_periods', { eq: { period_type: 'month' }, order: 'period_start' });
    return rows;
  }
  function fcPct(r) {
    if (!r) return null;
    if (r.food_cost_pct != null) return +r.food_cost_pct;
    if (r.sales && r.beginning_inventory != null && r.purchases != null && r.ending_inventory != null) return ((+r.beginning_inventory + +r.purchases - +r.ending_inventory) / +r.sales) * 100;
    return null;
  }

  H.pages.foodcost = {
    async render(host) {
      host.innerHTML = `<div class="ph"><div><h2>Food cost</h2><p>From the cfahome Target Food Cost Report. Each month is compared with the same month last year.</p></div>
        <div class="actions"><button class="btn" onclick="H.pages.foodcost.editTarget()">Target</button><button class="btn btn-primary" onclick="H.pages.foodcost.importRows()">Update from cfahome</button></div></div><div id="fcBody"><div class="li-empty">Loading…</div></div>`;
      const [rows, tg] = await Promise.all([fcLoad(), H.targets()]);
      const body = document.getElementById('fcBody'); if (!body) return;
      if (rows === null) { body.innerHTML = ''; return H.missingTable(body, 'food_cost_periods'); }
      if (!rows.length) {
        body.innerHTML = `<div class="card card-pad"><div class="li-title">No food cost data yet</div><div class="li-sub mt-s" style="max-width:62ch">Click <strong>Update with Claude</strong> at the top, or paste months from the Target Food Cost Report (cfahome → Reports and Tools → Chick-fil-A Report Galleries → Financial) with <strong>Update from cfahome</strong>. You can also type a month in by hand.</div>
          <div class="row mt"><button class="btn btn-primary" onclick="H.pages.foodcost.importRows()">Update from cfahome</button><button class="btn" onclick="H.pages.foodcost.addMonth()">Add a month by hand</button></div></div>`;
        return;
      }
      const keys = rows.map(r => H.monthKey(r.period_start));
      if (!FC.month || !keys.includes(FC.month)) FC.month = keys[keys.length - 1];
      const byKey = Object.fromEntries(rows.map(r => [H.monthKey(r.period_start), r]));
      const cur = byKey[FC.month], ly = byKey[H.lyKey(FC.month)];
      const act = fcPct(cur), theo = cur.theoretical_pct != null ? +cur.theoretical_pct : null, lyAct = fcPct(ly);
      const target = tg.food_cost_pct;
      const under = act != null && act <= target;
      const dollars = act != null && cur.sales ? Math.abs(target - act) / 100 * cur.sales : null;
      const used = (cur.beginning_inventory != null && cur.purchases != null && cur.ending_inventory != null) ? +cur.beginning_inventory + +cur.purchases - +cur.ending_inventory : null;
      const gapD = act != null && theo != null && cur.sales ? (act - theo) / 100 * cur.sales : null;
      const lo = Math.min(target - 5, act || target) - 1, hi = Math.max(target + 6, act || target) + 1;
      const pos = v => Math.max(0, Math.min(100, ((v - lo) / (hi - lo)) * 100));
      const items = await H.db.list('food_cost_items', { eq: { period_id: cur.id } });
      const last12 = keys.slice(-12);

      body.innerHTML = `
        ${sourceNote(cur)}
        <div class="row mb"><label class="small muted" for="fcMonth">Month</label><select id="fcMonth" class="sel" onchange="H.pages.foodcost.setMonth(this.value)">${keys.slice().reverse().map(k => `<option value="${k}" ${k === FC.month ? 'selected' : ''}>${H.monthLabel(k, true)}</option>`).join('')}</select></div>
        <div class="card fc-hero" id="fcHero">
          <div style="padding:20px 22px;background:${under ? 'var(--ok-wash)' : 'var(--bad-wash)'}">
            <div class="label">Real food cost · ${H.monthLabel(FC.month, true)}</div>
            <div class="row" style="align-items:baseline;gap:12px;margin-top:6px"><div style="font-size:2.6rem;font-weight:700;letter-spacing:-.03em;color:${under ? 'var(--ok)' : 'var(--bad)'}">${H.pct(act)}</div>
              <div class="strong" style="color:${under ? 'var(--ok)' : 'var(--bad)'}">${act == null ? '' : under ? 'Under target' : 'Over target'}${dollars != null ? ' · ' + H.money(dollars) : ''}</div></div>
            <div class="small" style="color:var(--text-mid);margin-top:4px">Target is ${H.pct(target)}.${dollars != null ? (under ? ` You kept about ${H.money(dollars)} in food this month.` : ` That's about ${H.money(dollars)} more food than the target allows.`) : ''}</div>
            ${act != null ? `<div style="position:relative;height:8px;border-radius:4px;background:linear-gradient(90deg,#BFE3CC 0,#BFE3CC ${pos(target)}%,#F6C9D3 ${pos(target)}%,#F6C9D3 100%);margin:18px 0 6px">
              <i style="position:absolute;left:${pos(target)}%;top:-5px;width:2px;height:18px;background:var(--text-mid)"></i>
              <i style="position:absolute;left:calc(${pos(act)}% - 6px);top:-4px;width:12px;height:16px;border-radius:3px;background:var(--text)"></i></div>
              <div class="between small muted"><span>${lo.toFixed(0)}%</span><span>target ${H.pct(target)}</span><span>${hi.toFixed(0)}%</span></div>` : ''}
          </div>
          <div style="padding:20px 22px">
            <div class="label">How it was counted</div>
            ${used != null ? `<div class="row small" style="flex-wrap:wrap;gap:8px;margin-top:10px;align-items:stretch">
              ${box('Start count', H.money(cur.beginning_inventory))}<span class="muted" style="align-self:center">+</span>${box('Food bought', H.money(cur.purchases))}<span class="muted" style="align-self:center">−</span>${box('End count', H.money(cur.ending_inventory))}<span class="muted" style="align-self:center">=</span>${box('Food used', H.money(used), true)}</div>
              <div class="small muted mt-s">${H.money(used)} ÷ ${H.money(cur.sales)} sales = ${H.pct(used / cur.sales * 100)}</div>` : `<div class="small muted mt-s">Inventory counts weren't included for this month.</div>`}
            <div class="grid g3 mt" style="gap:10px">
              <div><div class="label">Theoretical</div><div class="strong" style="font-size:1.15rem">${H.pct(theo)}</div></div>
              <div><div class="label">Same month LY</div><div class="strong" style="font-size:1.15rem">${H.pct(lyAct)}</div><div class="small">${lyAct != null && act != null ? H.delta(act, lyAct, false, 'pts') : '<span class="muted">No data</span>'}</div></div>
              <div><div class="label">Sales</div><div class="strong" style="font-size:1.15rem">${H.money(cur.sales)}</div><div class="small">${ly && ly.sales ? H.delta(+cur.sales, +ly.sales, true) + ' <span class="muted">vs LY</span>' : ''}</div></div>
            </div>
          </div>
        </div>
        <div class="kpis">
          <div class="kpi ${gapD != null && gapD > 0 ? 'bad' : 'ok'}"><div class="kpi-label">Gap vs theoretical</div><div class="kpi-val">${gapD == null ? '—' : H.money(gapD)}</div><div class="kpi-sub">${act != null && theo != null ? (act - theo).toFixed(1) + ' pts' : 'Needs both figures'}</div></div>
          <div class="kpi"><div class="kpi-label">Waste</div><div class="kpi-val">${H.money(cur.waste_amount)}</div><div class="kpi-sub">${cur.waste_amount && cur.sales ? H.pct(cur.waste_amount / cur.sales * 100, 2) + ' of sales' : 'Not reported'}</div></div>
          <div class="kpi"><div class="kpi-label">Employee meals</div><div class="kpi-val">${H.money(cur.employee_meals)}</div><div class="kpi-sub">Not sold to guests</div></div>
          <div class="kpi"><div class="kpi-label">Promos & donations</div><div class="kpi-val">${H.money((+cur.promo_amount || 0) + (+cur.donations || 0) || null)}</div><div class="kpi-sub">Not sold to guests</div></div>
        </div>
        <div class="split">
          <div class="card card-pad"><div class="section-label">Food cost by month</div>
            ${H.barChart({ labels: last12.map(k => H.monthLabel(k).split(' ')[0]), series: [{ name: 'Actual', color: 'var(--red)', values: last12.map(k => fcPct(byKey[k])) }, { name: 'Theoretical', color: '#9DB4F5', values: last12.map(k => byKey[k].theoretical_pct != null ? +byKey[k].theoretical_pct : null) }], target, min: Math.max(0, Math.floor(Math.min(target, ...last12.flatMap(k => [fcPct(byKey[k]), byKey[k].theoretical_pct != null ? +byKey[k].theoretical_pct : null]).filter(v => v != null)) - 2)), fmt: v => v.toFixed(1) + '%' })}</div>
          <div class="card card-pad"><div class="section-label">Biggest variances · ${H.monthLabel(FC.month)}</div>
            ${items && items.length ? `<div>${items.slice().sort((a, b) => Math.abs(b.variance_amount || 0) - Math.abs(a.variance_amount || 0)).slice(0, 8).map(i => `<div class="between small" style="padding:6px 0;border-top:1px solid #F0F0F2"><span>${H.esc(i.item)}</span><span style="font-weight:600;color:${(i.variance_amount || 0) > 0 ? 'var(--bad)' : 'var(--ok)'}">${H.money(i.variance_amount, true)}</span></div>`).join('')}</div>` : '<div class="small muted">Item-level variances show here when the report includes them.</div>'}</div>
        </div>
        <div class="section-label mt" style="margin-top:24px">Month by month</div>
        <div class="tbl-wrap"><div class="tbl-scroll"><table><thead><tr><th>Month</th><th class="r">Sales</th><th class="r">Sales vs LY</th><th class="r">Actual</th><th class="r">Theoretical</th><th class="r">Gap</th><th class="r">Same month LY</th><th class="r">Waste</th><th></th></tr></thead><tbody>
          ${keys.slice().reverse().map(k => { const r = byKey[k], l = byKey[H.lyKey(k)], a = fcPct(r), la = fcPct(l), t = r.theoretical_pct != null ? +r.theoretical_pct : null; return `<tr${k === FC.month ? ' style="background:#FBFBFC"' : ''}><td style="color:var(--text);font-weight:600">${H.monthLabel(k)}</td><td class="r">${H.money(r.sales)}</td><td class="r">${l && l.sales ? H.delta(+r.sales, +l.sales, true) : '—'}</td><td class="r" style="font-weight:700;color:${a != null && a > target ? 'var(--bad)' : 'var(--ok)'}">${H.pct(a)}</td><td class="r">${H.pct(t)}</td><td class="r">${a != null && t != null ? (a - t).toFixed(1) + ' pts' : '—'}</td><td class="r">${H.pct(la)} ${la != null && a != null ? H.delta(a, la, false, 'pts') : ''}</td><td class="r">${H.money(r.waste_amount)}</td><td class="r"><button class="btn btn-sm btn-ghost" onclick="H.pages.foodcost.addMonth('${r.id}')">Edit</button></td></tr>`; }).join('')}
        </tbody></table></div></div>
        <div class="row mt"><button class="btn btn-sm" onclick="H.pages.foodcost.addMonth()">Add a month by hand</button></div>`;
    },
    setMonth(k) { FC.month = k; this.render(document.getElementById('foodcostApp')); },
    async kpi() {
      const rows = await fcLoad(); if (!rows || !rows.length) return null;
      const tg = await H.targets(); const r = rows[rows.length - 1]; const a = fcPct(r);
      return { label: `Food cost · ${H.monthLabel(H.monthKey(r.period_start)).split(' ')[0]}`, val: H.pct(a), cls: a != null && a > tg.food_cost_pct ? 'bad' : 'ok', sub: `target ${H.pct(tg.food_cost_pct)}` };
    },
    async editTarget() {
      const tg = await H.targets();
      H.form({ title: 'Food cost target', fields: [{ id: 'v', label: 'Target food cost %', type: 'number', step: '0.1', value: tg.food_cost_pct, required: true }], onSubmit: async v => { await H.setTarget('food_cost_pct', v.v); H.toast('Target saved'); this.render(document.getElementById('foodcostApp')); } });
    },
    async addMonth(id) {
      const rows = await H.db.list('food_cost_periods', { cache: false }) || [];
      const r = rows.find(x => x.id === id) || {};
      H.form({ title: id ? `Edit ${H.monthLabel(H.monthKey(r.period_start), true)}` : 'Add a month', wide: true, fields: [
        { id: 'month', label: 'Month', type: 'month', value: r.period_start ? H.monthKey(r.period_start) : H.iso(H.prNow()).slice(0, 7), required: true, half: true },
        { id: 'sales', label: 'Sales', type: 'number', step: '0.01', value: r.sales, required: true, half: true },
        { id: 'fc', label: 'Actual food cost %', type: 'number', step: '0.01', value: r.food_cost_pct, half: true, help: 'Leave blank to calculate from the counts' },
        { id: 'theo', label: 'Theoretical food cost %', type: 'number', step: '0.01', value: r.theoretical_pct, half: true },
        { id: 'bi', label: 'Beginning inventory', type: 'number', step: '0.01', value: r.beginning_inventory, half: true },
        { id: 'pu', label: 'Food purchases', type: 'number', step: '0.01', value: r.purchases, half: true },
        { id: 'ei', label: 'Ending inventory', type: 'number', step: '0.01', value: r.ending_inventory, half: true },
        { id: 'waste', label: 'Waste', type: 'number', step: '0.01', value: r.waste_amount, half: true },
        { id: 'meals', label: 'Employee meals', type: 'number', step: '0.01', value: r.employee_meals, half: true },
        { id: 'promo', label: 'Promos / free items', type: 'number', step: '0.01', value: r.promo_amount, half: true },
      ], onSubmit: async v => {
        const start = v.month + '-01'; const [y, m] = v.month.split('-'); const end = H.iso(new Date(+y, +m, 0));
        await H.db.upsert('food_cost_periods', [{ period_type: 'month', period_start: start, period_end: end, sales: v.sales, food_cost_pct: v.fc, theoretical_pct: v.theo, beginning_inventory: v.bi, purchases: v.pu, ending_inventory: v.ei, waste_amount: v.waste, employee_meals: v.meals, promo_amount: v.promo, source: 'Entered by hand', updated_by: H.who(), pulled_at: new Date().toISOString() }], 'period_type,period_start');
        FC.month = v.month; H.toast('Month saved'); this.render(document.getElementById('foodcostApp')); hubRefreshCounts();
      } });
    },
    importRows() {
      importModal({
        title: 'Update food cost from cfahome',
        intro: 'One row per month. Existing months are updated, new months are added. Nothing else in the hub changes.',
        example: 'month,sales,food_cost_pct,theoretical_pct,beginning_inventory,purchases,ending_inventory,waste,employee_meals,promo\n2026-09,812440.55,30.1,28.6,21400,245800,24150,3120,4410,1180',
        prompt: 'cfahome → Reports and Tools → Chick-fil-A Report Galleries → Financial tab → Target Food Cost Report (PDF) for each calendar month; sales from the Management Tool (Management tab). Copy: month (YYYY-MM), total sales, actual food cost %, target food cost % (as theoretical_pct), beginning inventory $, food purchases $, ending inventory $, waste $, employee meals $, promo/free items $. Then open losfiltroshub.com → Food cost → Update from cfahome, paste the rows as CSV with that header, click Check rows, then Save.',
        onRows: async (rows, dry) => {
          const clean = rows.map(r => {
            const m = H.toISO(pick(r, 'month', 'period', 'period_start', 'date')); if (!m) return null;
            const start = m.slice(0, 7) + '-01'; const [y, mo] = m.split('-'); const end = H.iso(new Date(+y, +mo, 0));
            return { period_type: 'month', period_start: start, period_end: end, sales: H.toNum(pick(r, 'sales', 'total_sales')), food_cost_pct: H.toNum(pick(r, 'food_cost_pct', 'actual_pct', 'actual', 'food_cost')), theoretical_pct: H.toNum(pick(r, 'theoretical_pct', 'theoretical', 'theo')), beginning_inventory: H.toNum(pick(r, 'beginning_inventory', 'start_count', 'beginning')), purchases: H.toNum(pick(r, 'purchases', 'food_purchases', 'food_bought')), ending_inventory: H.toNum(pick(r, 'ending_inventory', 'end_count', 'ending')), waste_amount: H.toNum(pick(r, 'waste', 'waste_amount')), employee_meals: H.toNum(pick(r, 'employee_meals', 'meals')), promo_amount: H.toNum(pick(r, 'promo', 'promo_amount', 'promos')), donations: H.toNum(pick(r, 'donations')), source: 'cfahome Target Food Cost Report', pulled_at: new Date().toISOString(), updated_by: H.who() };
          }).filter(Boolean);
          if (dry) {
            if (!clean.length) return { rows: clean, html: '<span style="color:var(--bad)">No rows with a month were found. Check the header row.</span>' };
            const have = Object.fromEntries(((await H.db.list('food_cost_periods', { cache: false })) || []).map(r => [H.monthKey(r.period_start), r]));
            const red = [], amber = [], thisMonth = H.today().slice(0, 7), seen = {};
            for (const c of clean) {
              const k = H.monthKey(c.period_start), L = H.monthLabel(k);
              if (seen[k]) red.push(`${L} is in the paste twice.`); seen[k] = 1;
              if (k >= thisMonth) red.push(`${L} isn't over yet. Only whole months go in food cost.`);
              if (c.sales == null || c.sales <= 0) red.push(`${L}: sales are missing.`);
              if (c.food_cost_pct == null && !(c.beginning_inventory != null && c.purchases != null && c.ending_inventory != null)) red.push(`${L}: actual food cost % is missing.`);
              const act = fcPct(c);
              if (act != null && (act < 15 || act > 50)) red.push(`${L}: food cost of ${act.toFixed(1)}% is outside 15–50%. Usually a wrong column or a partial month.`);
              if (c.food_cost_pct != null && c.sales && c.beginning_inventory != null && c.purchases != null && c.ending_inventory != null) {
                const calc = (c.beginning_inventory + c.purchases - c.ending_inventory) / c.sales * 100;
                if (!nearly(calc, c.food_cost_pct, 1)) amber.push(`${L}: inventory math gives ${calc.toFixed(1)}%, the report says ${(+c.food_cost_pct).toFixed(1)}%.`);
              }
              if (c.theoretical_pct == null) amber.push(`${L}: no theoretical %.`);
              const o = have[k];
              if (o && !nearly(o.sales, c.sales, 1)) amber.push(`${L} is already in the hub with sales of ${H.money(o.sales)}. Saving replaces it with ${H.money(c.sales)}.`);
              const ly = have[H.lyKey(k)] || clean.find(x => H.monthKey(x.period_start) === H.lyKey(k));
              if (ly && ly.sales && c.sales && (c.sales / ly.sales > 2 || c.sales / ly.sales < 0.5)) amber.push(`${L}: sales are ${Math.round(c.sales / ly.sales * 100)}% of the same month last year.`);
            }
            return { rows: clean, block: red.length > 0, html: `<span style="color:var(--ok);font-weight:600">${clean.length} month${clean.length === 1 ? '' : 's'} read:</span> ${clean.map(c => H.monthLabel(c.period_start.slice(0, 7))).join(', ')}${flagHtml(red, amber)}` };
          }
          await H.db.upsert('food_cost_periods', clean, 'period_type,period_start');
          H.toast(`${clean.length} month${clean.length === 1 ? '' : 's'} updated`); FC.month = clean.map(c => c.period_start.slice(0, 7)).sort().pop();
          this.render(document.getElementById('foodcostApp')); hubRefreshCounts();
        },
      });
    },
  };
  function box(l, v, hi) { return `<div style="border:1px solid ${hi ? '#B9C8F7' : 'var(--border)'};background:${hi ? 'var(--info-wash)' : '#fff'};border-radius:8px;padding:6px 10px;min-width:84px"><div class="muted" style="font-size:.7rem">${l}</div><div class="strong">${v}</div></div>`; }
  function sourceNote(r) { return r && r.pulled_at ? `<div class="source">${H.svg('import').replace('<svg', '<svg width="15" height="15" stroke="currentColor" fill="none" stroke-width="2"')}<span>Last updated ${H.fmtDT(r.pulled_at)}${r.updated_by ? ' by ' + H.esc(H.shortName(r.updated_by)) : ''} · ${H.esc(r.source || 'cfahome')}</span></div>` : ''; }

  // ═════════════ PRODUCTIVITY ═════════════
  const PR = { month: null };
  async function prLoad() { return H.db.list('productivity_days', { order: 'day' }); }
  function agg(days) {
    const s = k => days.reduce((a, d) => a + (+d[k] || 0), 0);
    const sales = s('sales'), hours = s('labor_hours'), ly = s('last_year_sales'), lyh = s('last_year_labor_hours'), cost = s('labor_cost'), ot = s('overtime_hours'), fc = s('forecast_sales'), tx = s('transactions');
    return { sales, hours, ly, lyh, cost, ot, fc, tx, splh: hours ? sales / hours : null, lysplh: lyh ? ly / lyh : null, laborPct: cost && sales ? cost / sales * 100 : null, n: days.length };
  }
  H.pages.productivity = {
    async render(host) {
      host.innerHTML = `<div class="ph"><div><h2>Productivity</h2><p>Sales per labor hour from cfahome, by day and by month, compared with the same month last year.</p></div>
        <div class="actions"><button class="btn" onclick="H.pages.productivity.editTargets()">Targets</button><button class="btn btn-primary" onclick="H.pages.productivity.importRows()">Update from cfahome</button></div></div><div id="prBody"><div class="li-empty">Loading…</div></div>`;
      const [days, tg] = await Promise.all([prLoad(), H.targets()]);
      const body = document.getElementById('prBody'); if (!body) return;
      if (days === null) { body.innerHTML = ''; return H.missingTable(body, 'productivity_days'); }
      if (!days.length) { body.innerHTML = `<div class="card card-pad"><div class="li-title">No productivity data yet</div><div class="li-sub mt-s" style="max-width:62ch">Click <strong>Update with Claude</strong> at the top, or paste days from cfahome → Analytics Hub → Talent → Labor Productivity Analytics with <strong>Update from cfahome</strong>.</div><button class="btn btn-primary mt" onclick="H.pages.productivity.importRows()">Update from cfahome</button></div>`; return; }
      const months = [...new Set(days.map(d => H.monthKey(d.day)))].sort();
      if (!PR.month || !months.includes(PR.month)) PR.month = months[months.length - 1];
      const md = days.filter(d => H.monthKey(d.day) === PR.month);
      const a = agg(md);
      const lyDays = days.filter(d => H.monthKey(d.day) === H.lyKey(PR.month));
      const lyA = lyDays.length ? agg(lyDays) : null;
      const lySales = lyA && lyA.sales ? lyA.sales : a.ly || null;
      const lySplh = lyA && lyA.splh ? lyA.splh : a.lysplh;
      const tgt = tg.splh_target;
      const dowNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
      const byDow = [1, 2, 3, 4, 5, 6].map(i => ({ name: dowNames[i], ...agg(md.filter(d => H.d(d.day).getDay() === i)) }));
      const latest = md[md.length - 1];
      const recent = md.slice(-7);

      body.innerHTML = `
        ${latest && latest.pulled_at ? `<div class="source">${H.svg('import').replace('<svg', '<svg width="15" height="15" stroke="currentColor" fill="none" stroke-width="2"')}<span>Last updated ${H.fmtDT(latest.pulled_at)} · data through ${H.fmtD(latest.day, { month: 'short', day: 'numeric', year: 'numeric' })}</span></div>` : ''}
        <div class="row mb"><label class="small muted" for="prMonth">Month</label><select id="prMonth" class="sel" onchange="H.pages.productivity.setMonth(this.value)">${months.slice().reverse().map(k => `<option value="${k}" ${k === PR.month ? 'selected' : ''}>${H.monthLabel(k, true)}</option>`).join('')}</select><span class="small muted">${a.n} day${a.n === 1 ? '' : 's'} of data</span></div>
        <div class="kpis">
          <div class="kpi ${a.splh != null && a.splh >= tgt ? 'ok' : 'bad'}"><div class="kpi-label">Sales per labor hour</div><div class="kpi-val">${a.splh != null ? H.money(a.splh, true) : '—'}</div><div class="kpi-sub">target ${H.money(tgt)}${lySplh ? ` · LY ${H.money(lySplh, true)}` : ''}</div></div>
          <div class="kpi"><div class="kpi-label">Sales · ${H.monthLabel(PR.month).split(' ')[0]}</div><div class="kpi-val">${H.money(a.sales)}</div><div class="kpi-sub">${lySales ? H.delta(a.sales, lySales, true) + ' vs same month LY' : 'No last-year figure'}</div></div>
          <div class="kpi"><div class="kpi-label">Labor hours</div><div class="kpi-val">${H.num(a.hours)}</div><div class="kpi-sub">${a.fc ? `Forecast sales ${H.money(a.fc)}` : '&nbsp;'}</div></div>
          <div class="kpi ${a.laborPct != null && a.laborPct > tg.labor_pct ? 'bad' : a.laborPct != null ? 'ok' : ''}"><div class="kpi-label">Labor %</div><div class="kpi-val">${H.pct(a.laborPct)}</div><div class="kpi-sub">target ${H.pct(tg.labor_pct, 0)}</div></div>
          <div class="kpi ${a.ot > 0 ? 'warn' : ''}"><div class="kpi-label">Overtime hours</div><div class="kpi-val">${H.num(a.ot, 1)}</div><div class="kpi-sub">This month</div></div>
        </div>
        <div class="split">
          <div class="card card-pad"><div class="section-label">Sales per labor hour by day · ${H.monthLabel(PR.month, true)}</div>
            ${H.barChart({ labels: md.map(d => String(H.d(d.day).getDate())), series: [{ name: 'Sales per labor hour', color: 'var(--foh)', values: md.map(d => d.labor_hours ? d.sales / d.labor_hours : null) }], target: tgt, min: Math.max(0, Math.floor(Math.min(tgt, ...md.filter(d => d.labor_hours).map(d => d.sales / d.labor_hours)) * 0.85)), fmt: v => '$' + v.toFixed(0), height: 200 })}</div>
          <div class="card card-pad"><div class="section-label">By day of week</div>
            ${byDow.map(d => `<div class="metric-row"><span>${d.name}</span><div class="bar ${d.splh != null && d.splh >= tgt ? 'ok' : 'bad'}"><i style="width:${d.splh ? Math.min(100, d.splh / (tgt * 1.3) * 100) : 0}%"></i></div><span class="v">${d.splh ? '$' + d.splh.toFixed(0) : '—'}</span></div>`).join('')}
            <div class="small muted mt-s">Average sales per labor hour for each weekday this month.</div></div>
        </div>
        <div class="section-label" style="margin-top:24px">Last 7 days in ${H.monthLabel(PR.month)}</div>
        <div class="tbl-wrap"><div class="tbl-scroll"><table><thead><tr><th>Day</th><th class="r">Sales</th><th class="r">Forecast</th><th class="r">Last year</th><th class="r">Labor hrs</th><th class="r">SPLH</th><th class="r">Overtime</th></tr></thead><tbody>
          ${recent.slice().reverse().map(d => { const sp = d.labor_hours ? d.sales / d.labor_hours : null; return `<tr><td style="color:var(--text);font-weight:600">${H.fmtD(d.day, { weekday: 'short', month: 'short', day: 'numeric' })}</td><td class="r">${H.money(d.sales)}</td><td class="r">${H.money(d.forecast_sales)}</td><td class="r">${H.money(d.last_year_sales)} ${d.last_year_sales ? H.delta(+d.sales, +d.last_year_sales, true) : ''}</td><td class="r">${H.num(d.labor_hours, 1)}</td><td class="r" style="font-weight:700;color:${sp != null && sp >= tgt ? 'var(--ok)' : 'var(--bad)'}">${sp != null ? H.money(sp, true) : '—'}</td><td class="r">${d.overtime_hours ? H.num(d.overtime_hours, 1) : '—'}</td></tr>`; }).join('')}
        </tbody></table></div></div>
        <div class="section-label" style="margin-top:24px">Month by month</div>
        <div class="tbl-wrap"><div class="tbl-scroll"><table><thead><tr><th>Month</th><th class="r">Sales</th><th class="r">vs same month LY</th><th class="r">Labor hrs</th><th class="r">SPLH</th><th class="r">SPLH LY</th><th class="r">Labor %</th><th class="r">Overtime</th></tr></thead><tbody>
          ${months.slice().reverse().map(k => { const x = agg(days.filter(d => H.monthKey(d.day) === k)); const lx = days.some(d => H.monthKey(d.day) === H.lyKey(k)) ? agg(days.filter(d => H.monthKey(d.day) === H.lyKey(k))) : null; const lys = lx ? lx.sales : x.ly; const lsp = lx ? lx.splh : x.lysplh; return `<tr${k === PR.month ? ' style="background:#FBFBFC"' : ''}><td style="color:var(--text);font-weight:600">${H.monthLabel(k)}${x.n < 24 ? ` <span class="small muted" style="font-weight:400">${x.n} days</span>` : ''}</td><td class="r">${H.money(x.sales)}</td><td class="r">${lys ? H.delta(x.sales, lys, true) : '—'}</td><td class="r">${H.num(x.hours)}</td><td class="r" style="font-weight:700;color:${x.splh != null && x.splh >= tgt ? 'var(--ok)' : 'var(--bad)'}">${x.splh != null ? H.money(x.splh, true) : '—'}</td><td class="r">${lsp ? H.money(lsp, true) : '—'}</td><td class="r">${H.pct(x.laborPct)}</td><td class="r">${H.num(x.ot, 1)}</td></tr>`; }).join('')}
        </tbody></table></div></div>`;
    },
    setMonth(k) { PR.month = k; this.render(document.getElementById('productivityApp')); },
    async kpi() {
      const days = await prLoad(); if (!days || !days.length) return null;
      const tg = await H.targets(); const k = H.monthKey(days[days.length - 1].day); const a = agg(days.filter(d => H.monthKey(d.day) === k));
      return { label: `Productivity · ${H.monthLabel(k).split(' ')[0]}`, val: a.splh != null ? H.money(a.splh, true) : '—', cls: a.splh != null && a.splh >= tg.splh_target ? 'ok' : 'bad', sub: `per labor hour · target ${H.money(tg.splh_target)}` };
    },
    async editTargets() {
      const tg = await H.targets();
      H.form({ title: 'Productivity targets', fields: [
        { id: 'splh', label: 'Sales per labor hour target ($)', type: 'number', step: '0.5', value: tg.splh_target, required: true, half: true },
        { id: 'labor', label: 'Labor % target', type: 'number', step: '0.1', value: tg.labor_pct, required: true, half: true },
      ], onSubmit: async v => { await H.setTarget('splh_target', v.splh); await H.setTarget('labor_pct', v.labor); H.toast('Targets saved'); this.render(document.getElementById('productivityApp')); } });
    },
    importRows() {
      importModal({
        title: 'Update productivity from cfahome',
        intro: 'One row per day. Existing days are updated, new days are added. Nothing else in the hub changes.',
        example: 'date,sales,forecast_sales,last_year_sales,labor_hours,last_year_labor_hours,labor_cost,overtime_hours,transactions,scheduled_hours\n2026-10-12,28261,27600,27711,365,372,4380,6.5,1840,358',
        prompt: 'cfahome → Analytics Hub → Talent → Labor Productivity Analytics (day grain, table view) plus Sales & Brand Growth → Sales Analytics for last year and Talent → Actual vs Scheduled Labor Hours. For each day, copy: date, total sales, forecast sales, same day last year sales, labor hours, last year labor hours, labor cost $, overtime hours, transactions, scheduled hours. Then open losfiltroshub.com → Productivity → Update from cfahome, paste the rows as CSV with that header, click Check rows, then Save.',
        onRows: async (rows, dry) => {
          const clean = rows.map(r => {
            const d = H.toISO(pick(r, 'date', 'day', 'business_date')); if (!d) return null;
            return { day: d, sales: H.toNum(pick(r, 'sales', 'total_sales', 'actual_sales')), forecast_sales: H.toNum(pick(r, 'forecast_sales', 'forecast', 'forecasted_sales')), last_year_sales: H.toNum(pick(r, 'last_year_sales', 'ly_sales', 'last_year')), labor_hours: H.toNum(pick(r, 'labor_hours', 'hours', 'actual_hours')), last_year_labor_hours: H.toNum(pick(r, 'last_year_labor_hours', 'ly_labor_hours', 'ly_hours')), scheduled_hours: H.toNum(pick(r, 'scheduled_hours')), labor_cost: H.toNum(pick(r, 'labor_cost', 'labor_dollars', 'labor')), overtime_hours: H.toNum(pick(r, 'overtime_hours', 'ot_hours', 'overtime')), transactions: H.toNum(pick(r, 'transactions', 'tc', 'trans')), source: 'cfahome Analytics Hub', pulled_at: new Date().toISOString() };
          }).filter(Boolean);
          if (dry) {
            if (!clean.length) return { rows: clean, html: '<span style="color:var(--bad)">No rows with a date were found. Check the header row.</span>' };
            clean.sort((a, b) => a.day < b.day ? -1 : 1);
            const have = Object.fromEntries(((await H.db.list('productivity_days', { cache: false })) || []).map(r => [r.day, r]));
            const red = [], amber = [], today = H.today(), seen = {};
            for (const c of clean) {
              const L = H.fmtD(c.day, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
              if (seen[c.day]) red.push(`${L} is in the paste twice.`); seen[c.day] = 1;
              if (c.day >= today) red.push(`${L} isn't finished yet. Only full days go in productivity.`);
              if (c.sales == null) red.push(`${L}: sales are missing.`);
              if (c.sales > 0 && !c.labor_hours) red.push(`${L}: sales but no labor hours.`);
              if (c.sales > 0 && c.labor_hours > 0) { const splh = c.sales / c.labor_hours; if (splh < 30 || splh > 250) red.push(`${L}: sales per labor hour of ${H.money(splh)} is outside $30–$250. Check the hours column.`); }
              if (c.sales > 0 && H.storeClosed(c.day)) amber.push(`${L}: sales on a day the store is normally closed.`);
              if (c.last_year_sales == null) amber.push(`${L}: no last-year sales.`);
              const o = have[c.day];
              if (o && !nearly(o.sales, c.sales, 1)) amber.push(`${L} is already in the hub with sales of ${H.money(o.sales)}. Saving replaces it.`);
            }
            for (let i = 1; i < clean.length; i++) { if (H.daysBetween(clean[i - 1].day, clean[i].day) > 400) continue; let d = H.addDays(clean[i - 1].day, 1); const gap = []; while (d < clean[i].day) { if (!H.storeClosed(d) && !have[d]) gap.push(d); d = H.addDays(d, 1); } if (gap.length) amber.push(`Gap: ${gap.length} open day${gap.length === 1 ? '' : 's'} missing between ${H.fmtD(clean[i - 1].day)} and ${H.fmtD(clean[i].day)}.`); }
            return { rows: clean, block: red.length > 0, html: `<span style="color:var(--ok);font-weight:600">${clean.length} day${clean.length === 1 ? '' : 's'} read</span> · ${H.fmtD(clean[0].day)} to ${H.fmtD(clean[clean.length - 1].day, { month: 'short', day: 'numeric', year: 'numeric' })}${flagHtml(red, amber)}` };
          }
          await H.db.upsert('productivity_days', clean, 'day');
          H.toast(`${clean.length} days updated`); PR.month = H.monthKey(clean.map(c => c.day).sort().pop());
          this.render(document.getElementById('productivityApp')); hubRefreshCounts();
        },
      });
    },
  };
})();
