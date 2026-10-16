// Los Filtros Hub v2 — Christmas bonus (bono de Navidad, Ley 148 de 30 de junio de 1969, as amended by Ley 4-2017).
// Hours come from the monthly Time Summary imports already in the hub (read-only here); wages and worked hours come
// from the payroll register (bonus_wages). Nothing on this page writes to employees, monthly_records or any other
// team-member table.
(function () {
  const H = window.H;
  const CUTOFF = '2017-01-26';                 // Ley 4-2017 took effect: different rules for people hired on/after this date
  const NEED_NEW = 1350, NEED_OLD = 700;
  const BY = { year: null, filter: 'all', q: '' };
  const periodOf = by => ({ from: `${by - 1}-10-01`, to: `${by}-09-30` });
  const periodLabel = by => `Oct 1, ${by - 1} – Sep 30, ${by}`;
  const nextBizDay = iso => { let d = iso; while ([0, 6].includes(H.d(d).getDay())) d = H.addDays(d, 1); return d; };
  H.bonusDates = by => ({ opens: `${by}-11-15`, exemptionBy: nextBizDay(`${by}-11-30`), payBy: `${by}-12-15` });
  // During Oct–Dec the bonus that's due is for the year that just ended; the rest of the year, show the one in progress.
  const defaultYear = () => { const t = H.prNow(); return t.getMonth() >= 9 ? t.getFullYear() : t.getFullYear(); };
  const inProgressYear = () => { const t = H.prNow(); return t.getMonth() >= 9 ? t.getFullYear() + 1 : t.getFullYear(); };
  const monthsOf = by => { const out = []; for (let i = 0; i < 12; i++) { const d = new Date(by - 1, 9 + i, 1); out.push([d.getFullYear(), d.getMonth() + 1]); } return out; };
  const allEmployees = () => { try { return Object.values(EMPLOYEES); } catch (e) { return []; } };

  async function settings() {
    const t = await H.targets();
    return { estWage: +t.bonus_est_wage || 11, over20: +t.bonus_over20 !== 0, firstYearRule: +t.bonus_first_year || 1 };
  }

  const dayCount = (a, b) => H.daysBetween(a, b) + 1;
  // A file with many paychecks only holds wages earned up to about 5 days before its last pay date
  // (the next check pays the rest), so its real earned range ends there.
  const effTo = l => { const pays = String(l.pay_dates || '').split(',').filter(Boolean).sort(); if (pays.length < 2) return l.earned_to; const e = H.addDays(pays[pays.length - 1], -5); return e < l.earned_to ? e : l.earned_to; };
  // Days of [from, to] covered by at least one register (earned ranges), as a count and as gaps.
  function coverage(lines, from, to) {
    const ranges = [...new Set(lines.map(l => `${l.earned_from}|${effTo(l)}`))].map(k => k.split('|'))
      .map(([a, b]) => [a < from ? from : a, b > to ? to : b]).filter(([a, b]) => a <= b).sort((x, y) => x[0] < y[0] ? -1 : 1);
    const merged = []; for (const r of ranges) { const l = merged[merged.length - 1]; if (l && H.addDays(l[1], 1) >= r[0]) { if (r[1] > l[1]) l[1] = r[1]; } else merged.push([...r]); }
    const days = merged.reduce((n, [a, b]) => n + dayCount(a, b), 0);
    const gaps = []; let cur = from; merged.forEach(([a, b]) => { if (a > cur) gaps.push([cur, H.addDays(a, -1)]); cur = H.addDays(b, 1) > cur ? H.addDays(b, 1) : cur; });
    return { days, merged, gaps, end: cur };
  }

  // One row per team member for bonus year `by`
  function compute(by, st, wageRows, lines) {
    const { from, to } = periodOf(by), months = monthsOf(by), today = H.today();
    const key = (y, m) => `${y}-${m}`, inYear = new Set(months.map(([y, m]) => key(y, m)));
    const emps = allEmployees();
    const imported = new Set(); emps.forEach(e => (e.monthlyRecords || []).forEach(r => { if (inYear.has(key(r.year, r.month))) imported.add(key(r.year, r.month)); }));
    const monthsLeft = months.filter(([y, m]) => !imported.has(key(y, m)) && `${y}-${String(m).padStart(2, '0')}-01` <= to).length;
    const ended = today > to, periodDays = dayCount(from, to);
    const elapsed = ended ? periodDays : Math.max(0, dayCount(from, H.addDays(today, -1)));
    // Payroll registers: split each paycheck by the share of its earned days inside this bonus year
    const cov = coverage(lines, from, to), fullCover = cov.days >= elapsed && elapsed > 0;
    const pay = {};
    lines.forEach(l => {
      const lt = effTo(l), a = l.earned_from < from ? from : l.earned_from, b = lt > to ? to : lt; if (a > b) return;
      const f = dayCount(a, b) / dayCount(l.earned_from, lt);
      const o = pay[l.employee_id] = pay[l.employee_id] || { gross: 0, hours: 0 };
      o.gross += (+l.gross_pay || 0) * f; o.hours += (+l.hours_worked || 0) * f;
    });
    const wages = Object.fromEntries((wageRows || []).map(w => [w.employee_id, w]));
    const rows = emps.map(e => {
      const recs = (e.monthlyRecords || []).filter(r => inYear.has(key(r.year, r.month)));
      const importHours = recs.reduce((a, r) => a + (+r.hoursWorked || 0), 0);
      const w = wages[e.supabase_id] || {}, p = pay[e.supabase_id];
      const hire = e.firstClockIn ? String(e.firstClockIn).slice(0, 10) : null;
      // Hours: a manual figure first, then payroll when it covers at least as much of the year as the monthly imports
      const payHours = p ? p.hours : null;
      const useRegister = p && (fullCover || cov.days >= imported.size * 30);
      const hours = w.worked_hours != null ? +w.worked_hours : useRegister ? payHours : importHours;
      const hoursSrc = w.worked_hours != null ? 'manual' : useRegister ? 'payroll' : 'imports';
      if (!hours && !p && w.gross_wages == null && (!hire || hire > to)) return null;   // not employed this bonus year
      const oldRules = !!hire && hire < CUTOFF, need = oldRules ? NEED_OLD : NEED_NEW;
      // Wages: manual figure, else payroll (filled in for days no register covers yet, at the person's own pay rate), else an estimate
      let wagesUsed, wagesKnown, wagesNote;
      // Only days the person was employed count when filling gaps or projecting (e.g. everyone who started Apr 1, 2026)
      const start = hire && hire > from ? hire : from, upTo = ended ? to : H.addDays(today, -1);
      const employedSoFar = start <= upTo ? dayCount(start, upTo) : 0;
      const coveredWhileEmployed = cov.merged.reduce((n, [a, b]) => { const x = a > start ? a : start, y = b < upTo ? b : upTo; return n + (x <= y ? dayCount(x, y) : 0); }, 0);
      const gapDays = Math.max(0, employedSoFar - coveredWhileEmployed);
      const daysLeft = ended ? 0 : dayCount(today > start ? today : start, to);
      const payRate = p && coveredWhileEmployed ? p.gross / coveredWhileEmployed : null, hourRate = useRegister && coveredWhileEmployed ? hours / coveredWhileEmployed : null;
      if (w.gross_wages != null) { wagesUsed = +w.gross_wages; wagesKnown = true; wagesNote = 'entered'; }
      else if (p && payRate != null) { wagesUsed = p.gross + payRate * gapDays; wagesKnown = gapDays === 0; wagesNote = gapDays ? 'payroll + est.' : 'payroll'; }
      else { wagesUsed = hours * st.estWage; wagesKnown = false; wagesNote = 'est.'; }
      // Full-year projection while the year is in progress
      const projHours = ended && !gapDays ? hours : hourRate != null ? hours + hourRate * (gapDays + daysLeft) : hours + (recs.length ? importHours / recs.length : 0) * monthsLeft;
      const projWages = ended ? wagesUsed : payRate != null ? wagesUsed + payRate * daysLeft : projHours * st.estWage;
      const firstAnniv = hire ? `${+hire.slice(0, 4) + 1}${hire.slice(4)}` : null;
      const firstYear = !oldRules && !!hire && (st.firstYearRule === 2 ? firstAnniv > from : hire >= from);
      const cap = st.over20 ? 600 : 300;
      const bonusOn = wg => Math.round(Math.min(oldRules ? Math.min(wg, 10000) * (st.over20 ? 0.06 : 0.03) : wg * 0.02, cap) * (firstYear ? 0.5 : 1) * 100) / 100;
      const active = (e.status || 'active') === 'active';
      let status;
      if (hours >= need) status = 'eligible';
      else if (ended) status = gapDays && projHours >= need * 0.9 ? 'incomplete' : 'not';
      else if (!active) status = 'left';
      else status = projHours >= need * 1.05 ? 'on_track' : projHours >= need ? 'close' : 'off';
      const mismatch = ended && fullCover && imported.size === 12 && p && Math.abs(p.hours - importHours) > 8;
      return { e, id: e.supabase_id, name: e.name, active, hire, oldRules, need, hours, hoursSrc, importHours, regHours: payHours, mismatch, wagesKnown, wagesUsed, wagesNote, projHours, firstYear,
        amount: hours >= need ? bonusOn(ended ? wagesUsed : projWages) : 0, potential: bonusOn(projWages), status,
        paid: w.paid_amount != null ? +w.paid_amount : null, paidOn: w.paid_on || null, notes: w.notes || '' };
    }).filter(Boolean).sort((a, b) => (b.status === 'eligible') - (a.status === 'eligible') || b.hours - a.hours);
    return { rows, imported: imported.size, monthsLeft, ended, cov, fullCover, elapsed, periodDays, registers: new Set(lines.map(l => `${l.earned_from}|${l.earned_to}|${l.pay_date}`)).size };
  }

  const ST_PILL = { incomplete: ['Missing payroll', 'amber'], eligible: ['Eligible', 'green'], not: ['Not eligible', 'gray'], left: ['Left · short of hours', 'gray'], on_track: ['On track', 'blue'], close: ['Close', 'amber'], off: ['Unlikely', 'red'] };
  const DECISIONS = { pay: ['Paying', 'green'], exempt: ['Filing an exemption', 'amber'], not_owed: ['Not owed: no one eligible', 'blue'], not_paying: ['Not paying', 'gray'], undecided: ['Undecided', 'amber'] };

  // ── Payroll Register PDF (Oracle BI Publisher "Payroll Register": header + "Summary Section") ──
  async function ensurePdfJs() {
    if (typeof pdfjsLib !== 'undefined') return;
    await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js'; s.onload = res; s.onerror = () => rej(new Error('Could not load the PDF reader.')); document.head.appendChild(s); });
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  }
  // Text of each page as lines, left to right (items on the same baseline joined with double spaces)
  async function pdfLines(file) {
    await ensurePdfJs();
    const pdf = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise, out = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const items = (await (await pdf.getPage(i)).getTextContent()).items.filter(t => t.str.trim());
      const rows = [];
      items.forEach(t => { const y = t.transform[5], x = t.transform[4]; let r = rows.find(r => Math.abs(r.y - y) < 2.5); if (!r) rows.push(r = { y, parts: [] }); r.parts.push({ x, s: t.str }); });
      rows.sort((a, b) => b.y - a.y).forEach(r => out.push(r.parts.sort((a, b) => a.x - b.x).map(p => p.s.trim()).join('  ')));
    }
    return out;
  }
  const money = v => +String(v).replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1');
  const mdy = v => { const m = String(v || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); return m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : null; };
  const MON = { JAN: '01', FEB: '02', MAR: '03', APR: '04', MAY: '05', JUN: '06', JUL: '07', AUG: '08', SEP: '09', OCT: '10', NOV: '11', DEC: '12' };
  H.parsePayrollRegisterText = (lines, file) => {
    const all = lines.join('\n');
    const er = all.match(/Earned Date range\s+(\d{1,2}\/\d{1,2}\/\d{4})\s*-\s*(\d{1,2}\/\d{1,2}\/\d{4})/i);
    // Every paycheck date in the detail section (a register can hold one payroll or a whole year of them)
    const payDates = [...new Set([...all.matchAll(/Payment Date\s+(\d{1,2})-([A-Z]{3})-(\d{4})/gi)].map(m => `${m[3]}-${MON[m[2].toUpperCase()]}-${m[1].padStart(2, '0')}`))].sort();
    const reg = { file, from: er ? mdy(er[1]) : null, to: er ? mdy(er[2]) : null, payDate: payDates.length === 1 ? payDates[0] : payDates[payDates.length - 1] || null, payDates, people: [], totalGross: null, totalCount: null };
    const MONEY = '\\(?-?\\$?[\\d,]+(?:\\.\\d{1,2})?\\)?', NUM = '-?[\\d,]+(?:\\.\\d{1,2})?';
    const row = new RegExp(`^(.*?)\\s+(${MONEY})\\s+(${NUM})\\s+(${MONEY})\\s+(${MONEY})\\s+(${MONEY})\\s*$`);
    let inSummary = false;
    for (const raw of lines) {
      const l = raw.replace(/\s+/g, ' ').trim();
      if (/^Summary Section/i.test(l)) { inSummary = true; continue; }
      if (/^Detail Section/i.test(l)) break;
      if (!inSummary) continue;
      const m = l.match(row); if (!m) continue;
      const name = m[1].replace(/\s+12-\d*\s*$/, '').replace(/\s+\d{2}-\d+\s*$/, '').trim();
      if (/^Employee Total/i.test(name)) { reg.totalGross = money(m[2]); const c = name.match(/\((\d+)\)/); reg.totalCount = c ? +c[1] : null; continue; }
      if (/^Grand Total/i.test(name) || !name) continue;
      reg.people.push({ name, gross: money(m[2]), hours: +m[3].replace(/,/g, '') });
    }
    return reg;
  };
  H.parsePayrollRegisterPdf = async file => {
    const reg = H.parsePayrollRegisterText(await pdfLines(file), file.name);
    if (!reg.people.length) throw new Error(`${file.name}: this doesn't look like a Payroll Register (no Summary Section found).`);
    return reg;
  };
  // Excel/CSV: the cfahome "payroll_register_rpt" export has the same layout as the PDF, so read it as lines first
  async function readRegisterSheet(file) {
    if (/\.(xlsx?|xls)$/i.test(file.name)) {
      if (typeof XLSX === 'undefined') await new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js'; s.onload = res; s.onerror = () => rej(new Error('Could not load the Excel reader.')); document.head.appendChild(s); });
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const lines = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: true, blankrows: false })
        .map(r => r.filter(c => c != null && String(c).trim() !== '').map(c => typeof c === 'number' ? c.toFixed(2) : String(c).trim()).join('  '));
      if (lines.some(l => /^Summary Section/i.test(l))) return H.parsePayrollRegisterText(lines, file.name);
    }
    return readRegisterColumns(file);
  }
  async function readRegisterColumns(file) {
    const raw = await H.readTable(file), P = (r, ...k) => H.pick(r, ...k);
    const first = raw[0] || {};
    const people = raw.map(r => ({ name: String(P(r, 'employee', 'employee_name', 'name', 'nombre', 'empleado') || '').replace(/\s+12-\d*\s*$/, '').trim(), gross: H.toNum(P(r, 'gross_pay', 'gross', 'gross_wages', 'total_gross', 'salario_bruto')) || 0, hours: H.toNum(P(r, 'hours_worked', 'worked_hours', 'hours', 'horas')) || 0 }))
      .filter(p => p.name && !/total/i.test(p.name));
    return { file: file.name, from: H.toISO(P(first, 'earned_from', 'period_start', 'start')), to: H.toISO(P(first, 'earned_to', 'period_end', 'end')), payDate: H.toISO(P(first, 'pay_date', 'check_date', 'payment_date')), people, totalGross: null, totalCount: null };
  }

  H.pages.bonus = {
    async render(host) {
      if (!BY.year) BY.year = defaultYear();
      const years = [...new Set([inProgressYear(), defaultYear(), 2026, BY.year])].sort((a, b) => b - a);
      host.innerHTML = `<div class="ph"><div><h2>Christmas bonus <span class="pill dark" style="vertical-align:middle;margin-left:6px">Operator only</span></h2><p>Bono de Navidad under Ley 148: who qualifies, what each person is owed, and the deadlines. Hours come from your monthly imports; wages from the payroll register.</p></div>
        <div class="actions"><button class="btn" onclick="H.pages.bonus.exportCsv()">Export CSV</button><button class="btn" onclick="H.pages.bonus.editSettings()">Settings</button><button class="btn btn-primary" onclick="H.pages.bonus.importWages()">Import payroll register</button></div></div>
        <div class="row mb"><label class="small muted" for="bnYear">Bonus year</label><select id="bnYear" class="sel" onchange="H.pages.bonus.setYear(+this.value)">${years.map(y => `<option value="${y}" ${y === BY.year ? 'selected' : ''}>${H.esc(periodLabel(y))}${y === inProgressYear() ? ' (in progress)' : ''}</option>`).join('')}</select></div>
        <div id="bnBody"><div class="li-empty">Loading…</div></div>`;
      const { from: pFrom, to: pTo } = periodOf(BY.year);
      const [st, wageRows, yearRows, lines] = await Promise.all([settings(), H.db.list('bonus_wages', { eq: { bonus_year: BY.year }, cache: false }), H.db.list('bonus_years', { cache: false }),
        H.db.all('payroll_lines', { gte: { earned_to: pFrom }, lte: { earned_from: pTo }, order: ['earned_from', 'employee_id', 'pay_date'] })]);
      const body = document.getElementById('bnBody'); if (!body) return;
      if (wageRows === null || yearRows === null || lines === null) return H.missingTable(body, 'bonus_wages / bonus_years / payroll_lines');
      const by = BY.year, { from, to } = periodOf(by), dates = H.bonusDates(by), today = H.today();
      const c = compute(by, st, wageRows, lines), rows = c.rows;
      const yr = yearRows.find(y => y.bonus_year === by) || {};
      const elig = rows.filter(r => r.status === 'eligible'), owed = elig.reduce((a, r) => a + r.amount, 0);
      const paidRows = rows.filter(r => r.paid != null), paid = paidRows.reduce((a, r) => a + r.paid, 0);
      const est = elig.some(r => !r.wagesKnown);
      // 15% of net profit cap (P&L months for this bonus year)
      const pl = (await H.db.list('pl_months') || []).filter(p => p.period_start >= from && p.period_start <= to);
      const np = pl.reduce((a, p) => a + (+p.net_profit || 0), 0);
      const daysTo = d => H.daysBetween(today, d);
      const dl = (label, d, done) => `<div class="bn-date ${done ? 'done' : daysTo(d) < 0 ? 'past' : daysTo(d) <= 21 ? 'soon' : ''}"><div class="kpi-label">${H.esc(label)}</div><div class="bn-d">${H.esc(H.fmtD(d, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }))}</div><div class="kpi-sub">${done ? H.esc(done) : daysTo(d) >= 0 ? `in ${daysTo(d)} day${daysTo(d) === 1 ? '' : 's'}` : `${-daysTo(d)} days ago`}</div></div>`;
      const [dl1, dc] = DECISIONS[yr.decision] || ['No decision recorded', 'amber'];
      const filtered = rows.filter(r => (BY.filter === 'all' || r.status === BY.filter || (BY.filter === 'unpaid' && r.status === 'eligible' && r.paid == null)) && (!BY.q || r.name.toLowerCase().includes(BY.q)));
      const counts = k => k === 'all' ? rows.length : k === 'unpaid' ? rows.filter(r => r.status === 'eligible' && r.paid == null).length : rows.filter(r => r.status === k).length;
      const chips = [['all', 'Everyone'], ['eligible', 'Eligible'], ['incomplete', 'Missing payroll'], ['unpaid', 'Eligible, not paid'], ['on_track', 'On track'], ['close', 'Close'], ['off', 'Unlikely'], ['not', 'Not eligible'], ['left', 'Left']].filter(([k]) => k === 'all' || counts(k));
      const isTransitionYear = by === 2026;
      const cfaCredit = isTransitionYear ? allEmployees().filter(e => (e.status || 'active') === 'active' && e.firstClockIn && String(e.firstClockIn).slice(0, 10) <= '2026-04-01') : [];
      body.innerHTML = `
        <div class="card card-pad mb bn-decision"><div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:10px">
          <div><div class="kpi-label">Decision for ${H.esc(periodLabel(by))}</div><div class="row mt-s" style="gap:8px"><span class="pill ${dc}">${H.esc(dl1)}</span>${yr.decision_notes ? `<span class="small muted">${H.esc(yr.decision_notes)}</span>` : ''}</div></div>
          <button class="btn btn-sm" onclick="H.pages.bonus.editDecision()">${yr.decision ? 'Change' : 'Record decision'}</button></div></div>
        <div class="bn-dates">${dl('Payment window opens', dates.opens)}${dl('Exemption filing deadline', dates.exemptionBy, yr.exemption_filed_on ? 'Filed ' + H.fmtD(yr.exemption_filed_on) : '')}${dl('Pay everyone by', dates.payBy, yr.paid_on ? 'Paid ' + H.fmtD(yr.paid_on) : '')}</div>
        <div class="kpis">
          <div class="kpi"><div class="kpi-label">Eligible</div><div class="kpi-val">${elig.length}<small> of ${rows.length}</small></div><div class="kpi-sub">${c.ended ? 'Reached the hours' : c.registers ? `Payroll through ${H.fmtD(H.addDays(c.cov.end, -1))}` : `${c.imported} of 12 months imported`}</div></div>
          <div class="kpi"><div class="kpi-label">${c.ended ? 'Bonus owed' : 'Owed so far'}</div><div class="kpi-val">${H.money(owed)}</div><div class="kpi-sub">${est ? 'Some wages estimated' : elig.length ? 'From payroll wages' : '&nbsp;'}</div></div>
          ${!c.ended ? `<div class="kpi"><div class="kpi-label">On track</div><div class="kpi-val">${counts('on_track') + counts('close')}</div><div class="kpi-sub">Projected to reach ${NEED_NEW.toLocaleString()} hrs</div></div>` : ''}
          <div class="kpi ${paidRows.length && paid >= owed ? 'ok' : ''}"><div class="kpi-label">Paid</div><div class="kpi-val">${H.money(paid)}</div><div class="kpi-sub">${paidRows.length} team member${paidRows.length === 1 ? '' : 's'}</div></div>
          <div class="kpi ${pl.length === 12 && owed > np * 0.15 ? 'warn' : ''}"><div class="kpi-label">15% of net profit cap</div><div class="kpi-val">${pl.length ? H.money(Math.max(0, np * 0.15)) : '—'}</div><div class="kpi-sub">${pl.length ? `${pl.length} of 12 P&amp;L months${pl.length === 12 && owed > np * 0.15 ? ' · bonus is over the cap' : ''}` : 'Needs Monthly P&amp;L'}</div></div>
        </div>
        <div class="source ${c.registers ? (c.fullCover ? '' : 'warn') : 'warn'}"><span>${c.registers
          ? `${c.registers} payroll register${c.registers === 1 ? ' covers' : 's cover'} ${H.num(c.cov.days)} of ${H.num(c.elapsed)} days ${c.ended ? 'in this bonus year' : 'so far'}${c.cov.gaps.length ? ` · missing ${c.cov.gaps.slice(0, 3).map(([a, b]) => a === b ? H.longD(a) : `${H.longD(a)} – ${H.longD(b)}`).join(', ')}${c.cov.gaps.length > 3 ? ` and ${c.cov.gaps.length - 3} more` : ''}` : ''}${c.fullCover ? '. Wages and hours come from payroll.' : '. Days without a register are filled in from each person\'s own pay rate and marked est.'}`
          : `No payroll registers imported for this bonus year. Hours come from your monthly imports, and wages are estimated at ${H.money(st.estWage, true)} an hour. Import the registers before paying.`}</span></div>
        ${rows.some(r => r.mismatch) ? `<div class="source warn"><span>${rows.filter(r => r.mismatch).length} team member${rows.filter(r => r.mismatch).length === 1 ? '' : 's'} have payroll hours that differ from your monthly imports by more than 8 hours. They're marked below. Check them before paying.</span></div>` : ''}
        ${isTransitionYear ? `<div class="card card-pad mb"><div class="section-label">Chick-fil-A PR transition credit</div><div class="small" style="line-height:1.55">$300 FCR credit for each team member employed by COR on Mar 31, 2026 and still employed on Nov 14, 2026, applied to December's FCR. <strong>${cfaCredit.length} team members</strong> who started Apr 1, 2026 are active in the hub today, which would be <strong>${H.money(cfaCredit.length * 300)}</strong>. Check the count again on Nov 14.</div></div>` : ''}
        <div class="row" style="justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:10px">
          <div class="chips" style="margin:0">${chips.map(([k, l]) => `<button class="chip${BY.filter === k ? ' active' : ''}" onclick="H.pages.bonus.setFilter('${k}')">${H.esc(l)}<span class="n">${counts(k)}</span></button>`).join('')}</div>
          <div class="row" style="gap:8px"><input class="sinput" placeholder="Search…" value="${H.esc(BY.q)}" oninput="H.pages.bonus.search(this.value)" style="max-width:200px"/>${elig.some(r => r.paid == null) ? '<button class="btn btn-sm btn-primary" onclick="H.pages.bonus.recordPayments()">Record payments</button>' : ''}</div>
        </div>
        <div class="tbl-wrap"><div class="tbl-scroll"><table><thead><tr><th>Team member</th><th>Hired</th><th style="min-width:180px">Hours worked</th><th>Status</th><th class="r">Wages</th><th class="r">Bonus</th><th class="r">Paid</th></tr></thead><tbody>
          ${filtered.map(r => { const [sl, sc] = ST_PILL[r.status]; const pct = Math.min(100, r.hours / r.need * 100); return `<tr class="click" onclick="H.pages.bonus.editRow('${r.id}')">
            <td style="font-weight:600;color:var(--text)">${H.esc(r.name)}${r.active ? '' : ' <span class="pill gray">Left</span>'}${r.firstYear ? ' <span class="pill blue" title="Ley 148: 50% during the first year of employment">1st year · 50%</span>' : ''}${r.oldRules ? ' <span class="pill gray" title="Hired before Jan 26, 2017">Pre-2017 rules</span>' : ''}</td>
            <td>${r.hire ? H.esc(H.fmtD(r.hire, { month: 'short', day: 'numeric', year: 'numeric' })) : '—'}</td>
            <td><div class="row" style="gap:8px"><div class="bar ${r.status === 'eligible' ? 'ok' : r.status === 'off' ? 'bad' : r.status === 'close' ? 'warn' : ''}" style="flex:1"><i style="width:${pct}%"></i></div><span class="small" style="white-space:nowrap;font-weight:600">${H.num(r.hours)} / ${H.num(r.need)}</span></div>${r.status !== 'eligible' && r.status !== 'left' && Math.round(r.projHours) !== Math.round(r.hours) ? `<div class="small muted">${c.ended ? `About ${H.num(r.projHours)} counting days with no register` : `On pace for ${H.num(r.projHours)}`}</div>` : ''}${r.mismatch ? `<div class="small" style="color:var(--warn)">Payroll ${H.num(r.regHours)} · imports ${H.num(r.importHours)}</div>` : ''}</td>
            <td><span class="pill ${sc}">${sl}</span></td>
            <td class="r">${H.money(r.wagesUsed)}${r.wagesKnown ? '' : ' <span class="muted small">est.</span>'}${!c.ended ? `<div class="small muted">so far</div>` : ''}</td>
            <td class="r" style="font-weight:600">${r.status === 'eligible' ? H.money(r.amount, true) : `<span class="muted">${r.status === 'not' || r.status === 'left' ? '—' : '~' + H.money(r.potential, true) + ' if they reach it'}</span>`}</td>
            <td class="r">${r.paid != null ? `${H.money(r.paid, true)}<div class="small muted">${H.esc(H.fmtD(r.paidOn))}</div>` : r.status === 'eligible' ? '<span class="pill amber">Not paid</span>' : '—'}</td></tr>`; }).join('') || '<tr><td colspan="7"><div class="li-empty">No one in this group.</div></td></tr>'}
        </tbody></table></div></div>
        <details class="card card-pad mt bn-rules"><summary><strong>How it's calculated</strong> <span class="muted small">Ley 148 de 1969, as amended by Ley 4-2017</span></summary>
          <ul>
            <li><strong>Bonus year:</strong> Oct 1 to Sep 30. Pay between Nov 15 and Dec 15.</li>
            <li><strong>Hired on or after Jan 26, 2017</strong> (everyone hired by Pertenecen LLC): must work at least <strong>1,350 hours</strong> in the bonus year. Bonus = <strong>2% of wages earned</strong> in the year, up to <strong>$600</strong> when you have more than 20 employees (for over 26 weeks), or $300 with 20 or fewer.</li>
            <li><strong>First year of employment:</strong> 50% of that amount. ${st.firstYearRule === 2 ? 'Set to: applies whenever any part of the first 12 months falls in the bonus year.' : 'Set to: applies when the person was hired during this bonus year.'} Confirm the reading with your labor counsel.</li>
            <li><strong>Hired before Jan 26, 2017:</strong> 700 hours; 6% of the first $10,000 (max $600), or 3% (max $300) with 15 or fewer employees.</li>
            <li><strong>People who left</strong> are still owed the bonus if they reached the hours.</li>
            <li><strong>Hours:</strong> regular + overtime hours from the payroll register when imported, otherwise hours from your monthly Time Summary imports. Vacation and sick hours aren't counted as hours worked.</li>
            <li><strong>Total bonuses</strong> can't exceed 15% of the year's net profits. To claim a full or partial exemption for lack of profits, file the year's profit-and-loss statement and balance sheet, certified by a CPA, with the Departamento del Trabajo by Nov 30 (next business day if it falls on a weekend). Without that filing, the full bonus is owed.</li>
            <li><strong>Paying late</strong> adds 50% of the bonus if paid within six months of the deadline, and 100% after that.</li>
          </ul>
          <div class="small muted">This page applies the law as written; it isn't legal advice.</div></details>`;
      this._rows = rows;
    },
    setYear(y) { BY.year = y; BY.filter = 'all'; this.render(document.getElementById('bonusApp')); },
    setFilter(k) { BY.filter = k; this.render(document.getElementById('bonusApp')); },
    search(q) { BY.q = q.toLowerCase().trim(); clearTimeout(this._t); this._t = setTimeout(() => { this.render(document.getElementById('bonusApp')).then(() => { const i = document.querySelector('#bnBody .sinput'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }); }, 250); },

    async editSettings() {
      const st = await settings();
      H.form({ title: 'Bonus settings', fields: [
        { id: 'over20', label: 'More than 20 employees for over 26 weeks of the year?', type: 'select', value: st.over20 ? '1' : '0', options: [{ value: '1', label: 'Yes: cap is $600' }, { value: '0', label: 'No: cap is $300' }] },
        { id: 'first', label: 'First year of employment (50%) applies when…', type: 'select', value: String(st.firstYearRule), options: [{ value: '1', label: 'The person was hired during this bonus year' }, { value: '2', label: 'Any part of their first 12 months falls in this bonus year' }] },
        { id: 'wage', label: 'Average hourly pay, for estimates before the payroll register is imported', type: 'number', step: '0.01', value: st.estWage, required: true },
      ], onSubmit: async v => { await H.setTarget('bonus_over20', v.over20 === '1' ? 1 : 0); await H.setTarget('bonus_first_year', +v.first); await H.setTarget('bonus_est_wage', v.wage); H.db.bust('hub_targets'); H.toast('Saved'); this.render(document.getElementById('bonusApp')); } });
    },
    async editDecision() {
      const yrs = await H.db.list('bonus_years', { cache: false }) || []; const yr = yrs.find(y => y.bonus_year === BY.year) || {};
      H.form({ title: `Decision · ${periodLabel(BY.year)}`, fields: [
        { id: 'decision', label: 'Decision', type: 'select', value: yr.decision || 'undecided', options: Object.entries(DECISIONS).map(([k, [l]]) => ({ value: k, label: l })) },
        { id: 'notes', label: 'Why (for your records)', type: 'textarea', value: yr.decision_notes },
        { id: 'filed', label: 'Exemption filed on', type: 'date', value: yr.exemption_filed_on, half: true },
        { id: 'paid', label: 'Bonuses paid on', type: 'date', value: yr.paid_on, half: true },
      ], onSubmit: async v => { await H.db.upsert('bonus_years', [{ bonus_year: BY.year, decision: v.decision, decision_notes: v.notes, exemption_filed_on: v.filed, paid_on: v.paid, updated_by: H.who(), updated_at: new Date().toISOString() }], 'bonus_year'); H.toast('Saved'); this.render(document.getElementById('bonusApp')); } });
    },
    editRow(id) {
      const r = (this._rows || []).find(x => x.id === id); if (!r) return;
      H.form({ title: r.name, intro: `${periodLabel(BY.year)} · ${H.num(r.hours)} hours · ${r.status === 'eligible' ? 'eligible for ' + H.money(r.amount, true) : 'not eligible yet'}`, fields: [
        { id: 'wages', label: 'Wages earned in the bonus year (from payroll)', type: 'number', step: '0.01', value: r.wagesKnown ? r.wagesUsed : '', half: true },
        { id: 'hours', label: 'Hours worked (regular + overtime, from payroll)', type: 'number', step: '0.01', value: r.regHours, half: true },
        { id: 'paid', label: 'Bonus paid', type: 'number', step: '0.01', value: r.paid, half: true },
        { id: 'paid_on', label: 'Paid on', type: 'date', value: r.paidOn, half: true },
        { id: 'notes', label: 'Notes', type: 'textarea', value: r.notes },
      ], onSubmit: async v => {
        if (v.paid != null && !v.paid_on) throw new Error('Add the date it was paid.');
        await H.db.upsert('bonus_wages', [{ bonus_year: BY.year, employee_id: r.id, employee_name: r.name, gross_wages: v.wages, worked_hours: v.hours, paid_amount: v.paid, paid_on: v.paid_on, notes: v.notes, source: 'Edited in the hub', updated_by: H.who(), updated_at: new Date().toISOString() }], 'bonus_year,employee_id');
        H.toast('Saved'); this.render(document.getElementById('bonusApp'));
      } });
    },
    recordPayments() {
      const todo = (this._rows || []).filter(r => r.status === 'eligible' && r.paid == null);
      const est = todo.filter(r => !r.wagesKnown).length;
      H.form({ title: 'Record bonus payments', intro: `Marks ${todo.length} eligible team member${todo.length === 1 ? '' : 's'} as paid the amount shown (${H.money(todo.reduce((a, r) => a + r.amount, 0), true)} total). People already marked paid aren't changed.${est ? ` ${est} of these amounts are estimates; import the payroll register first if you can.` : ''}`, fields: [
        { id: 'date', label: 'Paid on', type: 'date', value: H.today(), required: true },
      ], submit: 'Mark as paid', onSubmit: async v => {
        await H.db.upsert('bonus_wages', todo.map(r => ({ bonus_year: BY.year, employee_id: r.id, employee_name: r.name, paid_amount: r.amount, paid_on: v.date, updated_by: H.who(), updated_at: new Date().toISOString() })), 'bonus_year,employee_id');
        if (v.date > H.bonusDates(BY.year).payBy) H.toast('Saved. This is after Dec 15, so the late-payment penalty may apply.'); else H.toast('Payments recorded');
        this.render(document.getElementById('bonusApp'));
      } });
    },

    importWages() {
      H.modal(`<h3>Import payroll registers</h3><p class="muted small" style="margin:-10px 0 14px">Choose one or more Payroll Register PDFs (the ones with "Summary Section"), or an Excel/CSV export. The hub reads each person's gross pay and hours worked and the earned dates. Importing the same register again doesn't double count.</p>
        <div class="upzone compact" onclick="document.getElementById('bnFile').click()"><div class="up-link">Choose files</div><div class="up-sub">Payroll Register PDF, .xlsx or .csv · several at once is fine</div></div>
        <input type="file" id="bnFile" multiple accept=".pdf,.xlsx,.xls,.csv,.tsv,.txt" style="display:none"/>
        <div id="bnPrev" class="mt small"></div>
        <div class="mfooter"><button class="btn" onclick="H.closeModal()">Cancel</button><button class="btn btn-primary" id="bnSave" disabled>Save</button></div>`, true);
      let lines = [], replaceIds = [], prevExtra = '', redCount = 0;
      document.getElementById('bnFile').onchange = async ev => {
        const files = [...ev.target.files]; if (!files.length) return; const prev = document.getElementById('bnPrev'); prev.innerHTML = 'Reading…';
        try {
          const regs = []; lines = []; replaceIds = []; prevExtra = '';
          const red = [], amber = [], unmatched = new Set();
          for (const f of files) {
            const reg = /\.pdf$/i.test(f.name) ? await H.parsePayrollRegisterPdf(f) : await readRegisterSheet(f);
            regs.push(reg);
            if (!reg.from || !reg.to) { red.push(`${f.name}: couldn't find the earned date range.`); continue; }
            if (reg.totalGross != null && Math.abs(reg.totalGross - reg.people.reduce((a, p) => a + p.gross, 0)) > 0.05) red.push(`${f.name}: people add up to ${H.money(reg.people.reduce((a, p) => a + p.gross, 0), true)} but the register total is ${H.money(reg.totalGross, true)}. Some lines weren't read.`);
            if (reg.totalCount != null && reg.totalCount !== reg.people.length) red.push(`${f.name}: read ${reg.people.length} people, the register says ${reg.totalCount}.`);
            const lastPay = (reg.payDates || []).slice(-1)[0];
            if (reg.payDates && reg.payDates.length > 1 && lastPay && H.daysBetween(lastPay, reg.to) > 7) amber.push(`${f.name}: the last paycheck in it was paid ${H.longD(lastPay)}, but the earned range runs to ${H.longD(reg.to)}. Wages earned after about ${H.longD(H.addDays(lastPay, -5))} are paid later and probably aren't in this file. Run it again with the payment date range a few weeks past ${H.longD(reg.to)}.`);
            reg.people.forEach(p => {
              const key = typeof fuzzyMatchEmployee === 'function' ? fuzzyMatchEmployee(p.name) : null, emp = key && EMPLOYEES[key];
              if (!emp || !emp.supabase_id) { unmatched.add(p.name); return; }
              lines.push({ employee_id: emp.supabase_id, employee_name: emp.name, earned_from: reg.from, earned_to: reg.to, pay_date: reg.payDate || reg.to, pay_dates: (reg.payDates && reg.payDates.length ? reg.payDates : [reg.payDate || reg.to]).join(','), gross_pay: p.gross, hours_worked: p.hours, source: f.name, imported_by: H.who(), imported_at: new Date().toISOString() });
            });
          }
          const keys = {}; lines.forEach(l => { const k = [l.employee_id, l.earned_from, l.earned_to, l.pay_date].join('|'); if (keys[k]) { keys[k].gross_pay += l.gross_pay; keys[k].hours_worked += l.hours_worked; l._dup = true; } else keys[k] = l; });
          lines = lines.filter(l => !l._dup);
          // The same paycheck must never be counted twice (e.g. a year file plus that year's biweekly registers)
          const newPays = new Set(regs.flatMap(r => r.payDates && r.payDates.length ? r.payDates : [r.payDate || r.to]));
          const existing = (await H.db.all('payroll_lines', { order: ['earned_from'] })) || [];
          const clash = existing.filter(l => String(l.pay_dates || l.pay_date || '').split(',').some(d => newPays.has(d)) && !lines.some(n => n.employee_id === l.employee_id && n.earned_from === l.earned_from && n.earned_to === l.earned_to && n.pay_date === l.pay_date));
          replaceIds = clash.map(l => l.id);
          if (clash.length) {
            const files = [...new Set(clash.map(l => l.source || 'an earlier import'))];
            red.push(`Some of these paychecks are already in the hub from ${files.join(', ')}. Saving both would count those wages twice.`);
            prevExtra = `<label class="row mt-s" style="gap:8px;font-weight:600"><input type="checkbox" id="bnReplace"/> Replace what was imported from ${H.esc(files.join(', '))} with this file</label>`;
          }
          if (unmatched.size) amber.push(`Not matched to anyone in the hub, so not included: ${[...unmatched].slice(0, 15).join('; ')}${unmatched.size > 15 ? ` and ${unmatched.size - 15} more` : ''}. They're usually new hires whose hours haven't been imported yet.`);
          prev.innerHTML = `<div class="tbl-wrap"><div class="tbl-scroll"><table><thead><tr><th>Register</th><th>Earned</th><th>Paid</th><th class="r">People</th><th class="r">Gross pay</th><th class="r">Hours worked</th></tr></thead><tbody>
            ${regs.map(r => `<tr><td>${H.esc(r.file)}</td><td>${r.from ? H.esc(H.fmtD(r.from) + ' – ' + H.fmtD(r.to, { month: 'short', day: 'numeric', year: 'numeric' })) : '—'}</td><td>${r.payDates && r.payDates.length > 1 ? H.esc(`${r.payDates.length} paychecks, ${H.fmtD(r.payDates[0])} – ${H.fmtD(r.payDates[r.payDates.length - 1])}`) : r.payDate ? H.esc(H.fmtD(r.payDate)) : '—'}</td><td class="r">${r.people.length}</td><td class="r">${H.money(r.people.reduce((a, p) => a + p.gross, 0), true)}</td><td class="r">${H.num(r.people.reduce((a, p) => a + p.hours, 0), 2)}</td></tr>`).join('')}
            </tbody></table></div></div><div class="mt-s"><strong style="color:var(--ok)">${lines.length} paycheck lines ready</strong></div>${H.flagHtml(red, amber)}${prevExtra}`;
          redCount = red.length;
          const onlyClash = red.length === 1 && replaceIds.length;
          document.getElementById('bnSave').disabled = !lines.length || !!red.length;
          const cb = document.getElementById('bnReplace'); if (cb && onlyClash) cb.onchange = () => { document.getElementById('bnSave').disabled = !cb.checked || !lines.length; };
        } catch (e) { prev.innerHTML = `<span style="color:var(--bad)">${H.esc(e.message)}</span>`; }
      };
      document.getElementById('bnSave').onclick = async () => {
        const b = document.getElementById('bnSave'); b.disabled = true;
        try {
          const cb = document.getElementById('bnReplace');
          if (replaceIds.length) {
            if (!cb || !cb.checked) throw new Error('Tick "Replace" first, or remove the overlapping file from your selection.');
            for (let i = 0; i < replaceIds.length; i += 200) { const { error } = await getSupa().from('payroll_lines').delete().in('id', replaceIds.slice(i, i + 200)); if (error) throw new Error(error.message); }
          }
          for (let i = 0; i < lines.length; i += 500) await H.db.upsert('payroll_lines', lines.slice(i, i + 500), 'employee_id,earned_from,earned_to,pay_date');
          H.closeModal(); H.toast(`${lines.length} paycheck lines saved`); this.render(document.getElementById('bonusApp'));
        } catch (e) { document.getElementById('bnPrev').insertAdjacentHTML('beforeend', `<div style="color:var(--bad)">${H.esc(e.message)}</div>`); b.disabled = false; }
      };
    },
    exportCsv() {
      const rows = this._rows || []; const q = v => `"${String(v == null ? '' : v).replace(/"/g, '""')}"`;
      const lines = [['Team member', 'Status', 'Hired', 'Hours used', 'Hours (payroll)', 'Hours (imports)', 'Hours needed', 'Wages', 'Wages estimated', 'First year 50%', 'Bonus', 'Paid', 'Paid on'].join(',')]
        .concat(rows.map(r => [q(r.name), q((ST_PILL[r.status] || [])[0]), r.hire || '', r.hours, r.regHours ?? '', r.importHours, r.need, r.wagesUsed.toFixed(2), r.wagesKnown ? 'no' : 'yes', r.firstYear ? 'yes' : 'no', r.amount.toFixed(2), r.paid ?? '', r.paidOn || ''].join(',')));
      const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv' }); const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = `christmas-bonus-${BY.year}.csv`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    },
  };
})();
