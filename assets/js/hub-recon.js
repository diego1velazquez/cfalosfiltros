// Los Filtros Hub v2 — Reconciliation upgrades, on top of the existing matching engine in app.js (unchanged rules):
//  • pick the month to reconcile (it used to always be "this month")
//  • one drop zone that recognizes Gastos, Amex, Chase, Amazon and Banco Popular files (Excel works too)
//  • remembered matches: link a charge to a Gastos vendor once, matched automatically from then on (recon_rules)
//  • every run is saved per month (recon_runs): reopen it without re-uploading, and see what's still open from last month
//  • (QuickBooks pull lives in hub-qbo.js and feeds the same card/bank lists)
(function () {
  const H = window.H;
  const R = { month: null, files: {}, rules: [], saved: {}, ui: false };
  const curMonth = () => H.today().slice(0, 7);
  const ACH_VENDORS = ['LOOMIS', 'MCS', 'HOLSUM', 'HOLSUM PR', 'IDEAL ACCOUNTING', 'ANGEL BERRIOS'];   // same list app.js uses
  const KIND_LABEL = { gastos: 'Gastos (R365)', amex: 'Amex', chase: 'Chase Ink', amazon: 'Amazon Business', bank: 'Banco Popular' };

  // Month being reconciled. With nothing picked it is today, exactly as before.
  window.reconRef = () => { if (!R.month || R.month === curMonth()) return new Date(); const [y, m] = R.month.split('-').map(Number); return new Date(y, m - 1, 15); };
  H.reconMonth = () => R.month || curMonth();

  // ── Excel → CSV text (skips title rows above the real header, e.g. Amex's XLSX download) ──
  async function ensureXlsx() {
    if (typeof XLSX !== 'undefined') return;
    await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; s.onload = res; s.onerror = () => rej(new Error('Could not load the Excel reader.')); document.head.appendChild(s); });
  }
  window.reconSheetToCsv = async file => {
    await ensureXlsx();
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, dateNF: 'mm/dd/yyyy', blankrows: false, defval: '' });
    let h = rows.findIndex((r, i) => i < 25 && r.some(c => /date|fecha/i.test(c)) && r.some(c => /amount|monto|debit|vendor|total/i.test(c)));
    if (h < 0) h = 0;
    const q = v => { const t = String(v == null ? '' : v); return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };
    return rows.slice(h).map(r => r.map(q).join(',')).join('\n');
  };

  // ── What kind of file is this? ──
  async function detectKind(file) {
    const n = file.name.toLowerCase(), ext = (n.split('.').pop() || '');
    if (ext === 'pdf') return 'chase';
    if (['jpg', 'jpeg', 'png', 'webp'].includes(ext)) return 'amazon';
    let text = '';
    try { text = ['xlsx', 'xls'].includes(ext) ? await reconSheetToCsv(file) : await file.slice(0, 20000).text(); } catch (e) { return null; }
    const head = text.split(/\r?\n/).slice(0, 3).join(' ').toLowerCase(), body = text.toLowerCase();
    if (/\bvendor\b/.test(head) && /(payment_date|expense_category|payment_id|payment date)/.test(head)) return 'gastos';
    if (/transaction date/.test(head) && /post date/.test(head)) return 'chase';
    if (/card member|account #|extended details|appears on your statement/.test(head)) return 'amex';
    if (/order id|order date|po number|account group|amazon/.test(head)) return 'amazon';
    if (/\btype\b/.test(head) && /(^|,)\s*"?(db|cr)"?\s*(,|$)/m.test(body)) return 'bank';
    if (/debit/.test(head) && /credit/.test(head)) return 'bank';
    if (/amex|american/.test(n)) return 'amex';
    if (/chase/.test(n)) return 'chase';
    if (/amazon/.test(n)) return 'amazon';
    if (/popular|bppr|banco/.test(n)) return 'bank';
    if (/gasto|r365|payment/.test(n)) return 'gastos';
    return null;
  }

  // Keep the files so a month change can re-read them
  const origUpload = window.handleReconUpload;
  window.handleReconUpload = async (kind, files) => { R.files[kind] = Array.from(files || []); return origUpload(kind, files); };
  async function loadKind(kind, files) {
    await window.handleReconUpload(kind, files);
    const notes = document.querySelectorAll('#p-recon .cached-note');
    const count = { amex: RECON_DATA.amex.length, chase: RECON_DATA.chase.length, amazon: RECON_DATA.amazon.length, bank: RECON_DATA.bank.length };
    const idx = { amex: 0, chase: 1, amazon: 2, bank: 3 }[kind];
    if (idx != null && notes[idx]) notes[idx].textContent = `✓ ${count[kind]} ${kind === 'bank' ? 'debits' : 'rows'} loaded`;
    if (kind === 'bank' && files[0] && typeof handleBPStatement === 'function') handleBPStatement(files[0]);
  }

  // ── Remembered matches ──
  async function syncRules() {
    const rows = await H.db.list('recon_rules', { cache: false });
    R.rules = rows || [];
    for (let i = VENDOR_GROUPS.length - 1; i >= 0; i--) if (VENDOR_GROUPS[i]._saved) VENDOR_GROUPS.splice(i, 1);
    R.rules.forEach(r => VENDOR_GROUPS.push({ label: r.label, chargeKeywords: r.charge_keywords || [], gastosVendors: r.gastos_vendors || [], _saved: true, _id: r.id }));
  }

  // ── Save / reopen a month ──
  const ser = list => (list || []).map(x => ({ ...x, date: x.date instanceof Date ? H.iso(x.date) : x.date }));
  const rev = list => (list || []).map(x => ({ ...x, date: x.date ? H.d(x.date) : null }));
  function openItems() {
    const ref = reconRef(), m = ref.getMonth(), y = ref.getFullYear();
    const needs = (RECON_DATA.unmatchedExternal || []).filter(x => { if (x.source === 'bank') return false; const d = x.date instanceof Date ? x.date : new Date(x.date); return d.getMonth() === m && d.getFullYear() === y; });
    const gastosOnly = (RECON_DATA.unmatchedGastos || []).filter(g => !ACH_VENDORS.some(v => (g.description || '').toUpperCase().includes(v)));
    return { needs: ser(needs), gastosOnly: ser(gastosOnly) };
  }
  async function saveRun() {
    const month = H.reconMonth(), open = openItems(), sum = a => +a.reduce((s, x) => s + (+x.amount || 0), 0).toFixed(2);
    const files = Object.fromEntries(Object.entries(R.files).map(([k, f]) => [k, f.map(x => x.name)]));
    if (RECON_DATA._fromQbo) files.quickbooks = [RECON_DATA._fromQbo];
    const row = { month, run_at: new Date().toISOString(), run_by: H.who(),
      inputs: { gastos: ser(RECON_DATA.gastos), amex: ser(RECON_DATA.amex), chase: ser(RECON_DATA.chase), amazon: ser(RECON_DATA.amazon), bank: ser(RECON_DATA.bank) },
      files, summary: { gastos_total: sum(RECON_DATA.gastos), cards_total: sum(RECON_DATA.allCC), matched: (RECON_DATA.matches || []).length, needs_entry: open.needs.length, needs_total: sum(open.needs), gastos_only: open.gastosOnly.length },
      open_items: open };
    try { await H.db.upsert('recon_runs', [row], 'month'); R.saved[month] = row; } catch (e) { console.warn('[hub] recon save', e.message); H.toast('Reconciled, but the run could not be saved: ' + e.message); }
  }
  async function reopen(month) {
    const run = R.saved[month]; if (!run) return;
    const i = run.inputs || {};
    RECON_DATA.gastos = rev(i.gastos); RECON_DATA.amex = rev(i.amex); RECON_DATA.chase = rev(i.chase); RECON_DATA.amazon = rev(i.amazon); RECON_DATA.bank = rev(i.bank);
    RECON_DATA.allCC = [...RECON_DATA.amex, ...RECON_DATA.chase, ...RECON_DATA.amazon];
    R.files = {}; await window.runReconciliation({ noSave: true });
    H.toast(`Reopened ${H.monthLabel(month, true)} from ${H.fmtDT(run.run_at)}`);
  }

  // Run = load saved rules, run the existing engine, save the month, refresh the panel
  const origRun = window.runReconciliation;
  window.runReconciliation = async (opt) => {
    await syncRules();
    origRun();
    if (RECON_DATA.lastRunAt && !(opt && opt.noSave)) await saveRun();
    renderTop();
  };

  // ── Panel above the upload slots ──
  async function loadSaved() { const rows = await H.db.list('recon_runs', { cache: false }); R.saved = Object.fromEntries((rows || []).map(r => [r.month, r])); return rows; }
  function monthOptions() { const out = []; for (let i = 0; i < 13; i++) out.push(H.addMonths(curMonth(), -i)); return out; }
  async function renderTop() {
    const host = document.getElementById('rcTop'); if (!host) return;
    const month = H.reconMonth(), prev = H.addMonths(month, -1), run = R.saved[month], prevRun = R.saved[prev];
    const loaded = Object.entries({ gastos: RECON_DATA.gastos, amex: RECON_DATA.amex, chase: RECON_DATA.chase, amazon: RECON_DATA.amazon, bank: RECON_DATA.bank }).filter(([, v]) => v.length);
    const po = prevRun && prevRun.open_items;
    host.innerHTML = `
      <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:12px">
        <div class="row" style="gap:8px"><label class="small muted" for="rcMonth">Month to reconcile</label>
          <select id="rcMonth" class="sel" onchange="H.recon.setMonth(this.value)">${monthOptions().map(m => `<option value="${m}" ${m === month ? 'selected' : ''}>${H.esc(H.monthLabel(m, true))}${R.saved[m] ? ' · saved' : ''}</option>`).join('')}</select></div>
        <div class="row" style="gap:8px">${H.qbo ? '<button class="btn btn-sm btn-primary" onclick="H.qbo.pull()">Pull from QuickBooks</button><button class="btn btn-sm" onclick="H.qbo.settings()">QuickBooks settings</button>' : ''}<button class="btn btn-sm" onclick="H.recon.teach()">Teach a match</button><button class="btn btn-sm" onclick="H.recon.rules()">Matching rules${R.rules.length ? ` (${R.rules.length})` : ''}</button></div>
      </div>
      ${run && !RECON_DATA.lastRunAt ? `<div class="source"><span>${H.esc(H.monthLabel(month, true))} was reconciled ${H.esc(H.fmtDT(run.run_at))}${run.run_by ? ' by ' + H.esc(run.run_by) : ''}: ${run.summary.matched} matched, ${run.summary.needs_entry} not in Gastos. <a href="#" onclick="H.recon.reopen('${month}');return false">Reopen it</a> or drop new files to run it again.</span></div>` : ''}
      ${po && (po.needs.length || po.gastosOnly.length) ? `<details class="card card-pad mb"><summary style="cursor:pointer"><strong>Still open from ${H.esc(H.monthLabel(prev, true))}:</strong> ${po.needs.length} charge${po.needs.length === 1 ? '' : 's'} not in Gastos (${H.money(po.needs.reduce((s, x) => s + x.amount, 0), true)})${po.gastosOnly.length ? `, ${po.gastosOnly.length} Gastos with no charge` : ''}</summary>
        <div class="tbl-wrap mt-s"><div class="tbl-scroll"><table><thead><tr><th>Date</th><th>Where</th><th>Description</th><th class="r">Amount</th></tr></thead><tbody>
        ${po.needs.map(x => `<tr><td>${H.esc(H.fmtD(x.date))}</td><td>${H.esc(x.source)}</td><td>${H.esc(x.description)}</td><td class="r">${H.money(x.amount, true)}</td></tr>`).join('')}
        ${po.gastosOnly.map(x => `<tr><td>${H.esc(H.fmtD(x.date))}</td><td>Gastos</td><td>${H.esc(x.description)} <span class="muted small">no charge found</span></td><td class="r">${H.money(x.amount, true)}</td></tr>`).join('')}
        </tbody></table></div></div><div class="small muted mt-s">From the saved ${H.esc(H.monthLabel(prev, true))} run. Rerun ${H.esc(H.monthLabel(prev))} after fixing to clear them.</div></details>` : ''}
      <div class="upzone" id="rcDrop" onclick="document.getElementById('rcFile').click()"><div class="up-link">Drop all of ${H.esc(H.monthLabel(month, true))}'s files here</div><div class="up-sub">Gastos, Amex, Chase, Amazon and Banco Popular, all at once. Each file is recognized automatically.</div></div>
      <input type="file" id="rcFile" multiple accept=".csv,.xlsx,.xls,.pdf,.jpg,.jpeg,.png" style="display:none"/>
      <div id="rcFiles" class="mt-s"></div>
      ${loaded.length ? `<div class="small mt-s"><strong>Loaded:</strong> ${loaded.map(([k, v]) => `${H.esc(KIND_LABEL[k])} ${v.length}`).join(' · ')}${RECON_DATA._fromQbo ? ` <span class="pill blue">from QuickBooks</span>` : ''}</div>` : ''}`;
    const input = document.getElementById('rcFile'), drop = document.getElementById('rcDrop');
    input.onchange = e => staged(Array.from(e.target.files));
    drop.ondragover = e => { e.preventDefault(); drop.classList.add('drag'); };
    drop.ondragleave = () => drop.classList.remove('drag');
    drop.ondrop = e => { e.preventDefault(); drop.classList.remove('drag'); staged(Array.from(e.dataTransfer.files)); };
  }
  // Show what each file was recognized as, let them change it, then load
  async function staged(files) {
    const host = document.getElementById('rcFiles'); if (!files.length || !host) return;
    host.innerHTML = '<div class="small muted">Reading…</div>';
    const items = []; for (const f of files) items.push({ f, kind: await detectKind(f) });
    host.innerHTML = `<div class="list">${items.map((it, i) => `<div class="li"><span></span><div><div class="li-title">${H.esc(it.f.name)}</div><div class="li-sub">${it.kind ? 'Recognized as' : '<span style="color:var(--bad)">Not recognized, pick one</span>'}</div></div>
        <select class="sel" data-i="${i}"><option value="">Choose…</option>${Object.entries(KIND_LABEL).map(([k, l]) => `<option value="${k}" ${k === it.kind ? 'selected' : ''}>${H.esc(l)}</option>`).join('')}</select></div>`).join('')}</div>
      <div class="row mt-s"><button class="btn btn-primary" id="rcLoad">Load and reconcile</button><button class="btn" onclick="document.getElementById('rcFiles').innerHTML=''">Cancel</button></div>`;
    document.getElementById('rcLoad').onclick = async () => {
      host.querySelectorAll('select[data-i]').forEach(s => { items[+s.dataset.i].kind = s.value || null; });
      const miss = items.filter(it => !it.kind); if (miss.length) { H.toast(`Pick what ${miss[0].f.name} is first.`); return; }
      const byKind = {}; items.forEach(it => (byKind[it.kind] = byKind[it.kind] || []).push(it.f));
      if (Object.keys(byKind).some(k => k !== 'gastos')) RECON_DATA._fromQbo = null;   // card/bank files replace what came from QuickBooks
      for (const [k, fs] of Object.entries(byKind)) await loadKind(k, fs);
      host.innerHTML = '';
      if (RECON_DATA.gastos.length && (RECON_DATA.allCC.length || RECON_DATA.bank.length)) await window.runReconciliation();
      else { H.toast(RECON_DATA.gastos.length ? 'Gastos loaded. Add a card or bank file to reconcile.' : 'Add the Gastos export too, then reconcile.'); renderTop(); }
    };
  }

  H.recon = {
    async setMonth(m) {
      R.month = m === curMonth() ? null : m;
      // Re-read the files already loaded so the bank's date window follows the month
      for (const [k, fs] of Object.entries(R.files)) if (fs.length) await origUpload(k, fs);
      if (RECON_DATA.lastRunAt || (RECON_DATA.gastos.length && RECON_DATA.allCC.length)) await window.runReconciliation();
      else { renderReconReport(); renderTop(); }
    },
    reopen,
    refresh: () => renderTop(),
    async rules() {
      await syncRules();
      const builtIn = VENDOR_GROUPS.filter(g => !g._saved);
      H.modal(`<h3>Matching rules</h3><p class="muted small" style="margin:-10px 0 14px">Charges whose description contains a keyword are added up and matched against the Gastos vendor's total for the month.</p>
        <div class="section-label">Yours</div>
        <div class="list">${R.rules.map(r => `<div class="li"><span></span><div><div class="li-title">${H.esc(r.label)}</div><div class="li-sub">Charges with ${H.esc((r.charge_keywords || []).join(' / '))} → Gastos ${H.esc((r.gastos_vendors || []).join(' / '))}</div></div><button class="btn btn-sm" onclick="H.recon.delRule('${r.id}')">Remove</button></div>`).join('') || '<div class="li-empty">None yet. Use “Teach a match” after a run.</div>'}</div>
        <div class="section-label mt">Built in</div>
        <div class="list">${builtIn.map(g => `<div class="li"><span></span><div><div class="li-title">${H.esc(g.label)}</div><div class="li-sub">${H.esc((g.chargeKeywords || g.ccKeywords || []).join(' / '))} → ${H.esc((g.gastosVendors || []).join(' / '))}</div></div><span class="pill gray">Built in</span></div>`).join('')}
          <div class="li"><span></span><div><div class="li-title">Paid by bank transfer (ACH)</div><div class="li-sub">${H.esc(ACH_VENDORS.join(', '))}</div></div><span class="pill gray">Built in</span></div></div>
        <div class="mfooter"><button class="btn" onclick="H.closeModal()">Close</button></div>`, true);
    },
    async delRule(id) { await H.db.remove('recon_rules', id); await syncRules(); this.rules(); if (RECON_DATA.lastRunAt) window.runReconciliation(); },
    teach() {
      if (!RECON_DATA.lastRunAt) { H.toast('Run a reconciliation first, then teach it the charges it missed.'); return; }
      const open = openItems(), charges = [...open.needs, ...ser((RECON_DATA.unmatchedExternal || []).filter(x => x.source === 'bank'))];
      const vendors = [...new Set(RECON_DATA.gastos.map(g => (g.description || '').trim()).filter(Boolean))].sort();
      if (!charges.length) { H.toast('Nothing unmatched to teach this month.'); return; }
      const kw = d => String(d || '').toUpperCase().replace(/[^A-Z&\- ]+/g, ' ').trim().split(/\s+/).filter(w => w.length > 2 && !['THE', 'INC', 'LLC', 'CORP', 'SAN', 'JUAN', 'BAYAMON', 'ACH', 'DEBIT', 'PMT', 'PAYMENT'].includes(w)).slice(0, 2).join(' ');
      H.modal(`<h3>Teach a match</h3><p class="muted small" style="margin:-10px 0 14px">Pick the Gastos vendor a charge belongs to. From then on, charges with that keyword are matched to that vendor automatically, every month.</p>
        <div class="tbl-wrap" style="max-height:380px;overflow:auto"><table><thead><tr><th>Charge</th><th class="r">Amount</th><th>Keyword</th><th>Gastos vendor</th></tr></thead><tbody>
        ${charges.map((x, i) => `<tr><td><div style="font-weight:600;color:var(--text)">${H.esc(x.description)}</div><div class="small muted">${H.esc(x.source)} · ${H.esc(H.fmtD(x.date))}</div></td><td class="r">${H.money(x.amount, true)}</td>
          <td><input class="sinput" style="min-width:120px" data-kw="${i}" value="${H.esc(kw(x.description))}"/></td>
          <td><select class="sel" data-v="${i}"><option value="">Leave</option>${vendors.map(v => `<option>${H.esc(v)}</option>`).join('')}</select></td></tr>`).join('')}
        </tbody></table></div>
        <div class="mfooter"><button class="btn" onclick="H.closeModal()">Cancel</button><button class="btn btn-primary" id="rcTeachSave">Save and rerun</button></div>`, true);
      document.getElementById('rcTeachSave').onclick = async () => {
        const rows = [];
        document.querySelectorAll('select[data-v]').forEach(s => { if (!s.value) return; const i = s.dataset.v, k = document.querySelector(`input[data-kw="${i}"]`).value.trim().toUpperCase(); if (k) rows.push({ label: s.value, charge_keywords: [k], gastos_vendors: [s.value], created_by: H.who() }); });
        if (!rows.length) { H.closeModal(); return; }
        const merged = {}; rows.forEach(r => { const key = r.label; if (merged[key]) merged[key].charge_keywords = [...new Set([...merged[key].charge_keywords, ...r.charge_keywords])]; else merged[key] = r; });
        for (const r of Object.values(merged)) await H.db.insert('recon_rules', r);
        H.closeModal(); H.toast(`${Object.keys(merged).length} rule${Object.keys(merged).length === 1 ? '' : 's'} saved`); await window.runReconciliation();
      };
    },
  };

  // Build the panel the first time Reconciliation opens
  const prevOnTab = window.hubOnTab;
  window.hubOnTab = t => {
    prevOnTab(t);
    if (t !== 'recon') return;
    const body = document.querySelector('#p-recon .ccard-body'); if (!body) return;
    if (!document.getElementById('rcTop')) {
      body.querySelector('h2').textContent = 'Reconcile a month';
      const desc = body.querySelector('.desc'); if (desc) desc.textContent = 'Drop every file for the month at once, or pull the card and bank side from QuickBooks. Each run is saved.';
      const top = document.createElement('div'); top.id = 'rcTop';
      const slots = [...body.querySelectorAll(':scope > .file-slot, :scope > .file-slots-grid')];
      const det = document.createElement('details'); det.className = 'mt rc-slots'; det.innerHTML = '<summary class="small" style="cursor:pointer;font-weight:600">Or upload one file at a time</summary>';
      slots[0].before(top); top.after(det); slots.forEach(s => det.appendChild(s));
    }
    Promise.all([syncRules(), loadSaved()]).then(renderTop);
  };
})();
