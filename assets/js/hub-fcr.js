// Los Filtros Hub v2 — FCR detail inside Monthly P&L.
// The FCR (cfahome → Reports and Tools → Financial Management) and the Management Tool P&L are the same
// numbers; the FCR adds ~160 line items. This file shows, for the month picked in Monthly P&L:
//   • the CFA charge checks (royalty 4%, rent 6%, flat fees unchanged, YTD math) from the FCR module in app.js
//   • a drill-down from each P&L category to its FCR lines next to the previous months
//   • two ways to add a month's detail: Claude pastes the lines (Update with Claude), or upload the PDF
// It reads and writes only fcr_reports / fcr_line_items, the same way the FCR upload always has.
(function () {
  const H = window.H;
  const SECTION_OF = {
    food: 'Food Cost', paper: 'Paper Cost', talent: 'Talent Investment', utilities: 'Utilities', marketing: 'Marketing',
    repairs: 'Repairs and Maintenance', insurance: 'Business Insurance', financial_fees: 'Financial Fees', other_taxes: 'Other Taxes',
    cfa_fees: 'Chick-fil-A Puerto Rico LLC Expenses and Fees', misc: 'Miscellaneous Income/Expense',
  };
  const ym = r => `${r.period_year}-${String(r.period_month).padStart(2, '0')}`;
  const addM = (k, n) => { const [y, m] = k.split('-').map(Number), d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  let loaded = false;
  async function load(force) { if (force || !loaded) { await fcrLoadAll(); loaded = true; } return FCR.reports; }
  const reportFor = k => FCR.reports.find(r => ym(r) === k);

  // ── Panel under the P&L table ──
  H.fcrPanel = async (body, month, pl) => {
    const box = document.createElement('div'); box.id = 'fcrInPl'; box.style.marginTop = '22px';
    box.innerHTML = '<div class="li-empty">Loading FCR detail…</div>'; body.appendChild(box);
    try { await load(); } catch (e) { box.innerHTML = `<div class="source warn"><span>The FCR detail could not load: ${H.esc(e.message)}</span></div>`; return; }
    const rep = reportFor(month), L = H.monthLabel(month, true);
    const addBtns = `<button class="btn btn-sm" onclick="H.fcrImport('${month}')">Paste FCR lines</button> <button class="btn btn-sm" onclick="document.getElementById('fcrFileInput').click()">Upload FCR PDF</button>`;
    const hidden = `<input type="file" accept=".pdf" id="fcrFileInput" style="display:none" onchange="fcrHandleFile(this.files[0])"/><div id="fcrUploadStatus" class="small mt-s"></div><div id="fcrPreviewWrap" style="display:none;margin-top:14px"></div>`;
    if (!rep) {
      box.innerHTML = `<div class="section-label">CFA charges · ${H.esc(L)}</div>
        <div class="card card-pad"><div class="li-title">Waiting for the ${H.esc(L)} FCR detail</div>
          <div class="li-sub mt-s">Update with Claude pulls it with the P&amp;L. You can also paste the lines or upload the PDF. Then the royalty, rent and fixed fees are checked here and each category opens to its line items.</div>
          <div class="row mt">${addBtns}</div>${hidden}</div>`;
      return;
    }
    const v0 = fcrComputeVerification(rep);
    // Charges (royalty, rent, flat fees) vs. the report's own YTD arithmetic, shown separately
    const isMath = q => /^YTD doesn't reconcile/.test(q.title);
    const v = { questions: v0.questions.filter(q => !isMath(q)), passes: v0.passes }, math = v0.questions.filter(isMath);
    const mism = [];
    if (pl && pl.sales != null && rep.total_sales != null && Math.abs(+pl.sales - +rep.total_sales) > 1) mism.push(`Sales: P&amp;L ${H.money(pl.sales)}, FCR ${H.money(rep.total_sales)}`);
    if (pl && pl.net_profit != null && rep.net_profit != null && Math.abs(+pl.net_profit - +rep.net_profit) > 1) mism.push(`Net profit: P&amp;L ${H.money(pl.net_profit)}, FCR ${H.money(rep.net_profit)}`);
    box.innerHTML = `<div class="section-label">CFA charges · ${H.esc(L)} <span class="small muted" style="text-transform:none;letter-spacing:0">${H.esc(rep.source_filename || 'FCR')}</span></div>
      ${mism.length ? `<div class="source warn mb"><span>The P&amp;L and the FCR don't agree for ${H.esc(L)}. ${mism.join(' · ')}. One of them may have been pulled before a correction.</span></div>` : ''}
      <div class="card card-pad">
        ${v.questions.length ? `<div class="li-title" style="color:var(--bad)">${v.questions.length} charge${v.questions.length === 1 ? '' : 's'} to ask about</div>
          ${v.questions.map((q, i) => `<div style="border-top:1px solid var(--border);padding:10px 0;margin-top:8px"><div style="font-weight:600">${H.esc(q.title)}</div><div class="small muted mt-s">${H.esc(q.detail)}</div>
            <div class="row mt-s"><button class="btn btn-sm" onclick="H.copyText(H._fcrDrafts[${i}],'Email text copied')">Copy email to CFA / CPA</button></div></div>`).join('')}`
          : `<div class="li-title" style="color:var(--ok)">All CFA charges are correct</div>`}
        ${v.passes.length ? `<div class="small muted mt">${v.passes.map(p => '✓ ' + H.esc(p)).join('<br>')}</div>` : ''}
        ${math.length ? `<details class="mt"><summary class="small" style="cursor:pointer;font-weight:600;color:var(--warn)">Year-to-date math doesn't add up on ${math.length} line${math.length === 1 ? '' : 's'}</summary><div class="small muted mt-s">Last month's YTD plus this month should equal this month's YTD. Usually a correction CFA made to an earlier month.</div>${math.slice(0, 20).map(q => `<div class="small" style="padding:4px 0;border-top:1px solid var(--border)">${H.esc(q.detail)}</div>`).join('')}${math.length > 20 ? `<div class="small muted">and ${math.length - 20} more</div>` : ''}</details>` : ''}
        <div class="small muted mt">Click any category in the table above to see its FCR line items. <a href="#" onclick="H.fcrImport('${month}');return false">Replace this month's lines</a> · <a href="#" onclick="document.getElementById('fcrFileInput').click();return false">upload the PDF</a></div>
        ${hidden}</div>`;
    H._fcrDrafts = v.questions.map(q => q.draft);
  };

  // ── Drill-down: one P&L category → its FCR lines, this month and the two before ──
  H.fcrLines = async (key, month, label) => {
    await load();
    const sec = SECTION_OF[key], months = [addM(month, -2), addM(month, -1), month];
    const reps = months.map(reportFor);
    if (!reps[2]) return H.modal(`<h3>${H.esc(label)}</h3><p class="muted small">The ${H.esc(H.monthLabel(month, true))} FCR detail isn't in the hub yet, so there are no line items to show.</p><div class="mfooter"><button class="btn" onclick="H.closeModal()">Close</button><button class="btn btn-primary" onclick="H.closeModal();H.fcrImport('${month}')">Add FCR lines</button></div>`);
    const names = new Map();
    reps.forEach((r, i) => r && fcrGetItems(r.id).filter(li => li.section === sec && li.line_item !== sec).forEach(li => {
      const k = li.line_item; if (!names.has(k)) names.set(k, [null, null, null, li.has_accrual_entries]); if (names.get(k)[i] == null) names.get(k)[i] = +li.cm_amount;
    }));
    const rows = [...names.entries()].sort((a, b) => Math.abs(b[1][2] || 0) - Math.abs(a[1][2] || 0));
    const tot = reps.map(r => { if (!r) return null; const t = fcrGetItems(r.id).find(li => li.section === sec && li.line_item === sec && !li.parent_line); return t ? +t.cm_amount : null; });
    const chg = (a, b) => a == null || b == null ? '—' : Math.abs(a - b) < 0.5 ? '<span class="muted">same</span>' : `<span style="color:var(--${a > b ? 'bad' : 'ok'});font-weight:600">${a > b ? '+' : '−'}${H.money(Math.abs(a - b), true)}</span>`;
    H.modal(`<h3>${H.esc(label)} · FCR line items</h3><p class="muted small" style="margin:-10px 0 12px">Biggest first. Change is ${H.esc(H.monthLabel(month, true))} against the month before.</p>
      <div class="tbl-wrap"><div class="tbl-scroll" style="max-height:60vh"><table><thead><tr><th>Line</th>${months.map(m => `<th class="r">${H.esc(H.monthLabel(m).split(' ')[0])}</th>`).join('')}<th class="r">Change</th></tr></thead><tbody>
        ${rows.map(([n, v]) => `<tr><td>${H.esc(n)}${v[3] ? ' <span class="pill gray" title="Includes accrual entries">accrual</span>' : ''}</td>${v.slice(0, 3).map(x => `<td class="r">${x == null ? '<span class="muted">—</span>' : H.money(x, true)}</td>`).join('')}<td class="r">${chg(v[2], v[1])}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">No line items in this category.</td></tr>'}
        <tr><td style="font-weight:700">Total ${H.esc(label)}</td>${tot.map(x => `<td class="r" style="font-weight:700">${x == null ? '—' : H.money(x, true)}</td>`).join('')}<td class="r">${chg(tot[2], tot[1])}</td></tr>
      </tbody></table></div></div><div class="mfooter"><button class="btn" onclick="H.closeModal()">Close</button></div>`, true);
  };

  // ── Paste the FCR lines (Claude in Chrome reads the FCR on cfahome and pastes them here) ──
  const COLS = 'month,section,parent_line,line_item,is_subtotal,cm_amount,cm_pct,ytd_amount,ytd_pct';
  H.FCR_COLS = COLS;
  H.fcrImport = month => H.importModal({
    title: `FCR lines${month ? ' · ' + H.monthLabel(month, true) : ''}`,
    intro: 'Every line of the FCR for the month: one row per line, current month (CM) and year to date. The month must already be in Monthly P&L; its sales and net profit are used to check the lines add up.',
    example: `${COLS}\n2026-09,Talent Investment,,Talent Investment,yes,165200.10,18.21,1093384.02,18.47\n2026-09,Talent Investment,Talent Investment,Wages,no,132004.55,14.55,880211.40,14.87\n2026-09,Chick-fil-A Puerto Rico LLC Expenses and Fees,Chick-fil-A Puerto Rico LLC Expenses and Fees,Base Franchise Fee - Royalty,no,36285.14,4.00,214451.26,4.00`,
    prompt: H.claudeFcrHow ? H.claudeFcrHow() : 'cfahome → Reports and Tools → Financial Management → the month\'s FCR.',
    onRows: async (rows, dry) => {
      const pl = Object.fromEntries((await H.db.list('pl_months', { cache: false }) || []).map(r => [String(r.period_start).slice(0, 7), r]));
      await load(true);
      const byMonth = {};
      const red = [], amber = [];
      rows.forEach((r, i) => {
        const m = (H.toISO(H.pick(r, 'month', 'period')) || (month ? month + '-01' : '')).slice(0, 7); if (!m) { red.push(`Row ${i + 2} has no month.`); return; }
        const li = String(H.pick(r, 'line_item', 'line', 'item') || '').trim(); if (!li) return;
        const sub = /^(y|yes|true|1|subtotal)$/i.test(String(H.pick(r, 'is_subtotal', 'subtotal') || '').trim());
        (byMonth[m] ||= []).push({ section: String(H.pick(r, 'section') || '').trim() || null, parent_line: String(H.pick(r, 'parent_line', 'parent') || '').trim() || null, line_item: li, is_subtotal: sub,
          has_accrual_entries: false, cm_amount: H.toNum(H.pick(r, 'cm_amount', 'cm', 'amount')) || 0, cm_pct: H.toNum(H.pick(r, 'cm_pct')) || 0, ytd_amount: H.toNum(H.pick(r, 'ytd_amount', 'ytd')) || 0, ytd_pct: H.toNum(H.pick(r, 'ytd_pct')) || 0 });
      });
      const out = [];
      for (const [m, items] of Object.entries(byMonth)) {
        const L = H.monthLabel(m, true), p = pl[m];
        if (!p) { red.push(`${L} isn't in Monthly P&L yet. Pull the P&L first; its sales and net profit check these lines.`); continue; }
        if (m >= H.today().slice(0, 7)) red.push(`${L} isn't closed yet.`);
        if (!items.some(x => x.ytd_amount)) red.push(`${L}: the year-to-date (ytd_amount) column is empty. Include it so the year-to-date check works.`);
        const tops = items.filter(x => x.is_subtotal && !x.parent_line);
        const known = new Set(Object.values(SECTION_OF));
        const missing = [...known].filter(s => !tops.some(t => t.section === s || t.line_item === s));
        if (missing.length) amber.push(`${L}: no total line for ${missing.join(', ')}.`);
        const odd = [...new Set(items.map(x => x.section).filter(s => s && !known.has(s)))]; if (odd.length) amber.push(`${L}: sections the P&L doesn't use: ${odd.join(', ')}. They're saved but won't show under a category.`);
        const acc = tops.reduce((s, t) => s + t.cm_amount, 0) + (+p.net_profit || 0), delta = +(acc - (+p.sales || 0)).toFixed(2);
        const ok = Math.abs(delta) <= Math.max(5, (+p.sales || 0) * 0.001);
        if (!ok) red.push(`${L}: the section totals plus net profit come to ${H.money(acc)}, ${H.money(Math.abs(delta))} ${delta > 0 ? 'more' : 'less'} than sales of ${H.money(p.sales)}.`);
        SECTION_OF && Object.values(SECTION_OF).forEach(s => { const t = tops.find(x => x.section === s || x.line_item === s); const kids = items.filter(x => x.section === s && !(x.is_subtotal && !x.parent_line) && x.parent_line === (t && t.line_item)); if (t && kids.length) { const ks = kids.reduce((a, b) => a + b.cm_amount, 0); if (Math.abs(ks - t.cm_amount) > 1) amber.push(`${L}: ${s} lines add to ${H.money(ks)}, its total says ${H.money(t.cm_amount)}.`); } });
        const seen = {}; items.forEach(x => { const k = `${x.section}|${x.parent_line}|${x.line_item}`; if (seen[k]) amber.push(`${L}: "${x.line_item}" appears twice.`); seen[k] = 1; });
        const have = reportFor(m); if (have) amber.push(`${L} already has FCR detail (${H.esc(have.source_filename || 'FCR')}). Saving replaces its lines.`);
        out.push({ month: m, items, sales: +p.sales, net_profit: +p.net_profit, ok, delta });
      }
      if (dry) {
        if (!out.length && !red.length) return { rows: [], html: '<span style="color:var(--bad)">No lines were found. Check the header row.</span>' };
        return { rows: out, block: red.length > 0, html: `<span style="color:var(--ok);font-weight:600">${out.reduce((s, o) => s + o.items.length, 0)} lines for ${out.length} month${out.length === 1 ? '' : 's'} read</span>${H.flagHtml([...new Set(red)], amber.slice(0, 14))}` };
      }
      for (const o of rows) {
        const [y, mo] = o.month.split('-').map(Number);
        const { data: rep, error } = await getSupa().from('fcr_reports').upsert({ period_month: mo, period_year: y, source_filename: 'cfahome (pulled by Claude)', storage_path: null,
          total_sales: o.sales, net_profit: o.net_profit, net_profit_pct: o.sales ? +(o.net_profit / o.sales * 100).toFixed(2) : null, is_transition_period: y === 2026 && mo === 4,
          parse_check_passed: o.ok, parse_check_delta: o.delta }, { onConflict: 'period_month,period_year' }).select().single();
        if (error) throw error;
        const del = await getSupa().from('fcr_line_items').delete().eq('report_id', rep.id); if (del.error) throw del.error;
        const ins = await getSupa().from('fcr_line_items').insert(o.items.map(li => ({ ...li, report_id: rep.id }))); if (ins.error) throw ins.error;
      }
      await load(true);
      H.toast(`FCR lines saved for ${rows.map(o => H.monthLabel(o.month)).join(', ')}`);
      if (H.pages.pl && document.getElementById('plApp')) H.pages.pl.render(document.getElementById('plApp'));
    },
  });

  // After an FCR PDF is saved from inside Monthly P&L, reload and redraw the P&L page
  if (typeof window.fcrSaveReport === 'function') {
    const orig = window.fcrSaveReport;
    window.fcrSaveReport = async (...a) => { await orig(...a); loaded = false; const pl = document.getElementById('plApp'); if (pl && document.getElementById('p-pl').classList.contains('active')) H.pages.pl.render(pl); };
  }
})();
