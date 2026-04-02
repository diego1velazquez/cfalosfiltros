

// ══════════════════════════════════════════
// GLOBAL ERROR HANDLER
// ══════════════════════════════════════════
window.onerror = function(msg, src, line, col, err) {
  console.error('JS Error:', msg, 'at', src, line+':'+col);
  return false;
};

// ══════════════════════════════════════════
// SUPABASE SETUP
// ══════════════════════════════════════════
const SUPABASE_URL  = 'https://ccmprabfwhfvrkeyfamg.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNjbXByYWJmd2hmdnJrZXlmYW1nIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2MzUzODYsImV4cCI6MjA5MDIxMTM4Nn0.PV2tAkcC2p7QuQQNBw31GIjmr--qu-ULoqqtDBg6lH8';
let _supaClient = null;
function getSupa() {
  if (!_supaClient) _supaClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
  return _supaClient;
}

// ══════════════════════════════════════════
// USER DATABASE
// ══════════════════════════════════════════
const USERS = {};
const EMPLOYEES = {};
let currentUser = null;

// ══════════════════════════════════════════
// LOGIN
// ══════════════════════════════════════════
document.getElementById('loginForm').addEventListener('submit', async function(e) {
  e.preventDefault();
  const email = document.getElementById('pinIn').value.trim();
  const pass  = document.getElementById('passIn').value.trim();
  if (!email || !pass) return;

  const errEl = document.getElementById('loginErr');
  errEl.style.display = 'none';

  try {
    const { data, error } = await getSupa().auth.signInWithPassword({ email, password: pass });
    if (error || !data.user) {
      errEl.textContent = 'Invalid email or password.';
      errEl.style.display = 'block';
      return;
    }
    const { data: profile } = await getSupa().from('profiles').select('*').eq('id', data.user.id).single();
    const role = profile?.role || 'admin';
    const name = profile?.name || data.user.email;
    doLogin(data.user.email, { role, name });
  } catch(err) {
    errEl.textContent = 'Login error: ' + err.message;
    errEl.style.display = 'block';
  }
});

function doLogin(pin, user) {
  currentUser = { pin, ...user };
  document.getElementById('navUser').textContent = user.name || pin;
  document.getElementById('loginPage').style.display = 'none';
  document.getElementById('appShell').style.display = 'flex';
  document.getElementById('loginErr').style.display = 'none';
  document.getElementById('pinIn').value = '';
  document.getElementById('passIn').value = '';
  document.getElementById('navRolePill').textContent = 'ADMIN';
  document.getElementById('navRolePill').className = 'role-pill admin-pill';
  document.getElementById('adminTabNav').style.display = 'flex';
  document.getElementById('empTabNav').style.display = 'none';
  document.getElementById('btnSettings').style.display = 'none';
  document.getElementById('btnHosting').style.display = 'inline-flex';
  goTab('dashboard');
}

async function signOut() {
  await getSupa().auth.signOut();
  currentUser = null;
  clearInterval(window._autoSaveInterval);
  document.getElementById('loginPage').style.display = 'flex';
  document.getElementById('appShell').style.display = 'none';
  ['btnSettings','btnHosting'].forEach(id => {
    const el = document.getElementById(id); if (el) el.style.display = 'none';
  });
  const tw = document.getElementById('timeoutOverlay');
  if (tw) tw.classList.remove('open');
}

// ══════════════════════════════════════════
// TABS
// ══════════════════════════════════════════
function goTab(t) {
  if (t === 'timeoff') t = 'recordto';
  document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
  document.querySelectorAll('.page').forEach(x => x.classList.remove('active'));
  const tabEl  = document.getElementById('t-' + t);
  const pageEl = document.getElementById('p-' + t);
  if (tabEl)  tabEl.classList.add('active');
  if (pageEl) pageEl.classList.add('active');
  // Trigger renders on tab switch
  if (t === 'timeoff')   renderTimeOffRequests();
  if (t === 'employees') updateEmployeesTab();
  if (t === 'users')     updateUserAccountsTab();
}

// ══════════════════════════════════════════
// MODALS
// ══════════════════════════════════════════
function om(id) { document.getElementById(id).classList.add('open'); }
function cm(id) { document.getElementById(id).classList.remove('open'); }
document.querySelectorAll('.moverlay').forEach(o =>
  o.addEventListener('click', function(e) { if (e.target === o) o.classList.remove('open'); })
);

// ══════════════════════════════════════════
// MISC
// ══════════════════════════════════════════


function searchDash(v) {
  document.querySelectorAll('#dashTbody tr').forEach(r => {
    r.style.display = r.textContent.toLowerCase().includes(v.toLowerCase()) ? '' : 'none';
  });
}

function approveTO(id) {
  document.getElementById('toStatus'+id).textContent = 'approved';
  document.getElementById('toStatus'+id).className = 'badge bg-green';
  document.getElementById('toActions'+id).innerHTML = '<span style="color:#16a34a;font-size:.8rem">✓ Approved</span>';
  clearPending();
}
function rejectTO(id) {
  document.getElementById('toStatus'+id).textContent = 'rejected';
  document.getElementById('toStatus'+id).className = 'badge bg-red';
  document.getElementById('toActions'+id).innerHTML = '<span style="color:var(--red);font-size:.8rem">✗ Rejected</span>';
  clearPending();
}
function clearPending() {
  document.getElementById('sPending').textContent = '0';
  document.getElementById('tob').style.display = 'none';
  document.getElementById('nb').style.display = 'none';
  document.querySelectorAll('.alert').forEach(a => a.style.display = 'none');
}

function switchRtab(el, show) {
  document.querySelectorAll('.rtab').forEach(t => t.classList.remove('active'));
  el.classList.add('active');
  ['rRecon'].forEach(id => {
    const panel = document.getElementById(id);
    if (panel) panel.style.display = id === show ? 'block' : 'none';
  });
}

// ══════════════════════════════════════════
// RECONCILIATION (CSV-based, beginner-friendly)
// ══════════════════════════════════════════
const RECON_DATA = {
  gastos: [],
  bank: [],
  amex: [],
  chase: [],
  allCC: [],
  matches: [],
  unmatchedExternal: [],
  unmatchedGastos: [],
  lastRunAt: null
};
let _reconUiBound = false;

function parseCsvRows(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const next = text[i + 1];
    if (ch === '"' && inQuotes && next === '"') { cell += '"'; i++; continue; }
    if (ch === '"') { inQuotes = !inQuotes; continue; }
    if (ch === ',' && !inQuotes) { row.push(cell.trim()); cell = ''; continue; }
    if ((ch === '\n' || ch === '\r') && !inQuotes) {
      if (ch === '\r' && next === '\n') i++;
      row.push(cell.trim());
      if (row.some(v => v !== '')) rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += ch;
  }
  if (cell.length || row.length) {
    row.push(cell.trim());
    if (row.some(v => v !== '')) rows.push(row);
  }
  return rows;
}

function parseMoney(v) {
  if (v == null) return null;
  const s = String(v).replace(/\$/g, '').replace(/,/g, '').trim();
  if (!s) return null;
  const n = parseFloat(s.replace(/[^\d.-]/g, ''));
  if (!isFinite(n)) return null;
  return Math.abs(+n.toFixed(2));
}

function parseDateLoose(v) {
  if (!v) return null;
  const s = String(v).trim();
  // MM/DD/YYYY or MM-DD-YYYY
  let m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (m) {
    let y = +m[3];
    if (y < 100) y += 2000;
    return new Date(y, +m[1] - 1, +m[2]);
  }
  // YYYY-MM-DD
  m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

function fmtDate(d) {
  if (!d) return '';
  return d.toISOString().slice(0, 10);
}

function dateDiffDays(a, b) {
  const ms = Math.abs(a.getTime() - b.getTime());
  return Math.floor(ms / (1000 * 60 * 60 * 24));
}

function normText(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
}

function tokenOverlap(a, b) {
  const A = new Set(normText(a).split(' ').filter(t => t.length >= 4));
  const B = new Set(normText(b).split(' ').filter(t => t.length >= 4));
  for (const t of A) if (B.has(t)) return true;
  return false;
}

function getHeaderIndex(headers, candidates) {
  for (const c of candidates) {
    const idx = headers.findIndex(h => h.includes(c));
    if (idx >= 0) return idx;
  }
  return -1;
}

function csvToTxns(text, sourceName) {
  const rows = parseCsvRows(text);
  if (rows.length < 2) return [];
  const headers = rows[0].map(h => String(h || '').toLowerCase().trim());
  const dateIdx = getHeaderIndex(headers, ['date', 'posted', 'transaction']);
  const descIdx = getHeaderIndex(headers, ['description', 'merchant', 'vendor', 'memo', 'name', 'details']);
  const amountIdx = getHeaderIndex(headers, ['amount', 'total', 'value']);
  const debitIdx = getHeaderIndex(headers, ['debit', 'withdrawal', 'charge']);
  const creditIdx = getHeaderIndex(headers, ['credit', 'deposit', 'payment']);

  const out = [];
  for (let r = 1; r < rows.length; r++) {
    const row = rows[r];
    const rawDate = dateIdx >= 0 ? row[dateIdx] : '';
    const rawDesc = descIdx >= 0 ? row[descIdx] : `Row ${r + 1}`;
    let amount = null;
    if (amountIdx >= 0) amount = parseMoney(row[amountIdx]);
    if (amount == null && debitIdx >= 0) amount = parseMoney(row[debitIdx]);
    if (amount == null && creditIdx >= 0) amount = parseMoney(row[creditIdx]);
    const date = parseDateLoose(rawDate);
    if (!date || amount == null || amount <= 0) continue;
    out.push({
      id: `${sourceName}-${r}-${fmtDate(date)}-${amount.toFixed(2)}`,
      source: sourceName,
      date,
      amount,
      description: String(rawDesc || '').trim() || '(no description)'
    });
  }
  return out;
}

function readFileText(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ''));
    fr.onerror = () => reject(new Error('Could not read file'));
    fr.readAsText(file);
  });
}

function updateReconHeaderStats() {
  const page = document.getElementById('p-recon');
  if (!page) return;
  const cards = page.querySelectorAll('.stat-grid .stat-card');
  if (cards.length < 5) return;
  const ccMatched = RECON_DATA.matches.filter(m => m.external.source !== 'bank').length;
  const ccNoReceipt = RECON_DATA.unmatchedExternal.filter(x => x.source !== 'bank').length;
  const bankNoReceipt = RECON_DATA.unmatchedExternal.filter(x => x.source === 'bank').length;
  const extTotal = RECON_DATA.allCC.length + RECON_DATA.bank.length;
  const progress = extTotal ? Math.round((RECON_DATA.matches.length / extTotal) * 100) : 0;

  cards[0].querySelector('.sval').textContent = `$${RECON_DATA.gastos.reduce((a, x) => a + x.amount, 0).toFixed(2)}`;
  const txNode = cards[0].querySelector('div[style*="font-size:.75rem"]');
  if (txNode) txNode.textContent = `${RECON_DATA.gastos.length} transactions`;
  cards[1].querySelector('.sval').textContent = ccMatched.toString();
  cards[3].querySelector('.sval').textContent = bankNoReceipt.toString();
  cards[4].querySelector('.sval').textContent = ccNoReceipt.toString();

  const fill = page.querySelector('.recon-progress-fill');
  if (fill) {
    fill.style.width = `${progress}%`;
    fill.textContent = `${progress}% reconciled`;
  }
}

function renderReconReport() {
  const wrap = document.getElementById('rRecon');
  if (!wrap) return;
  if (!RECON_DATA.lastRunAt) {
    wrap.innerHTML = '<div class="empty"><div class="ei">📊</div><p>Upload GASTOS + Bank/CC files and click Run Reconciliation.</p></div>';
    updateReconHeaderStats();
    return;
  }

  const mRows = RECON_DATA.matches.map(m => `
    <tr><td>${fmtDate(m.external.date)}</td><td>${m.external.source.toUpperCase()}</td><td>${m.external.description}</td><td>${m.gastos.description}</td><td>$${m.external.amount.toFixed(2)}</td></tr>
  `).join('') || '<tr><td colspan="5">No matches found.</td></tr>';

  const uRows = RECON_DATA.unmatchedExternal.map(x => `
    <tr><td>${fmtDate(x.date)}</td><td>${x.source.toUpperCase()}</td><td>${x.description}</td><td>$${x.amount.toFixed(2)}</td></tr>
  `).join('') || '<tr><td colspan="4">No unmatched Bank/CC items.</td></tr>';

  const gRows = RECON_DATA.unmatchedGastos.map(x => `
    <tr><td>${fmtDate(x.date)}</td><td>${x.description}</td><td>$${x.amount.toFixed(2)}</td></tr>
  `).join('') || '<tr><td colspan="3">No unmatched GASTOS items.</td></tr>';

  wrap.innerHTML = `
    <div class="tbl-wrap" style="margin-top:10px">
      <div class="tbl-bar"><strong>Bank/CC Matched to GASTOS (${RECON_DATA.matches.length})</strong></div>
      <div style="overflow-x:auto"><table><thead><tr><th>Date</th><th>Source</th><th>Bank/CC Description</th><th>GASTOS Description</th><th>Amount</th></tr></thead><tbody>${mRows}</tbody></table></div>
    </div>
    <div class="tbl-wrap" style="margin-top:14px">
      <div class="tbl-bar"><strong>Missing In GASTOS (from Bank/CC) (${RECON_DATA.unmatchedExternal.length})</strong></div>
      <div style="overflow-x:auto"><table><thead><tr><th>Date</th><th>Source</th><th>Description</th><th>Amount</th></tr></thead><tbody>${uRows}</tbody></table></div>
    </div>
    <div class="tbl-wrap" style="margin-top:14px">
      <div class="tbl-bar"><strong>Only In GASTOS (${RECON_DATA.unmatchedGastos.length})</strong></div>
      <div style="overflow-x:auto"><table><thead><tr><th>Date</th><th>Description</th><th>Amount</th></tr></thead><tbody>${gRows}</tbody></table></div>
    </div>
  `;
  updateReconHeaderStats();
}

function runReconciliation() {
  const external = [...RECON_DATA.bank, ...RECON_DATA.allCC];
  if (!RECON_DATA.gastos.length) { alert('Upload at least one GASTOS CSV first.'); return; }
  if (!external.length) { alert('Upload at least one Bank or Credit Card statement first.'); return; }

  const usedG = new Set();
  const matches = [];
  const unmatchedExternal = [];
  for (const ext of external) {
    let bestIdx = -1;
    let bestScore = -1;
    for (let i = 0; i < RECON_DATA.gastos.length; i++) {
      if (usedG.has(i)) continue;
      const g = RECON_DATA.gastos[i];
      if (Math.abs(g.amount - ext.amount) > 0.01) continue;
      const dd = dateDiffDays(g.date, ext.date);
      if (dd > 5) continue;
      const textScore = tokenOverlap(ext.description, g.description) ? 2 : 0;
      const score = (5 - dd) + textScore;
      if (score > bestScore) { bestScore = score; bestIdx = i; }
    }
    if (bestIdx >= 0) {
      usedG.add(bestIdx);
      matches.push({ external: ext, gastos: RECON_DATA.gastos[bestIdx] });
    } else {
      unmatchedExternal.push(ext);
    }
  }

  const unmatchedGastos = RECON_DATA.gastos.filter((_, i) => !usedG.has(i));
  RECON_DATA.matches = matches;
  RECON_DATA.unmatchedExternal = unmatchedExternal;
  RECON_DATA.unmatchedGastos = unmatchedGastos;
  RECON_DATA.lastRunAt = new Date().toISOString();
  renderReconReport();
  showToast(`✅ Reconciliation complete: ${matches.length} matched, ${unmatchedExternal.length} missing in GASTOS.`);
}

function applyReconSearchFilter() {
  const q = document.querySelector('#p-recon .recon-search')?.value?.trim().toLowerCase();
  const rows = document.querySelectorAll('#rRecon tbody tr');
  rows.forEach(r => {
    if (!q) { r.style.display = ''; return; }
    r.style.display = r.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}

async function handleReconUpload(kind, files) {
  if (!files || !files.length) return;
  const uploaded = [];
  for (const file of Array.from(files)) {
    const ext = (file.name.split('.').pop() || '').toLowerCase();
    if (kind === 'amex' && ext !== 'csv') {
      alert('AMEX upload currently supports CSV only. Please export to CSV and upload again.');
      continue;
    }
    if (ext !== 'csv') {
      alert(`"${file.name}" is not CSV. Please upload CSV files for reconciliation.`);
      continue;
    }
    const text = await readFileText(file);
    uploaded.push(...csvToTxns(text, kind === 'gastos' ? 'gastos' : kind === 'bank' ? 'bank' : 'cc'));
  }

  if (kind === 'gastos') RECON_DATA.gastos = uploaded;
  if (kind === 'bank') RECON_DATA.bank = uploaded;
  if (kind === 'amex') RECON_DATA.amex = uploaded;
  if (kind === 'chase') RECON_DATA.chase = uploaded;
  RECON_DATA.allCC = [...RECON_DATA.amex, ...RECON_DATA.chase];
  RECON_DATA.lastRunAt = null;
  RECON_DATA.matches = [];
  RECON_DATA.unmatchedExternal = [];
  RECON_DATA.unmatchedGastos = [];
  renderReconReport();
}

function initReconciliationUI() {
  if (_reconUiBound) return;
  const page = document.getElementById('p-recon');
  if (!page) return;
  const slots = page.querySelectorAll('.file-slot input[type="file"]');
  if (slots.length < 4) return;

  const notes = page.querySelectorAll('.cached-note');
  const runBtn = page.querySelector('.ccard-top .btn.btn-red2');
  const search = page.querySelector('.recon-search');

  slots[0].addEventListener('change', async (e) => {
    await handleReconUpload('gastos', e.target.files);
    showToast(`✅ GASTOS loaded (${RECON_DATA.gastos.length} rows).`);
  });
  slots[1].addEventListener('change', async (e) => {
    await handleReconUpload('amex', e.target.files);
    if (notes[0]) notes[0].textContent = `✓ ${RECON_DATA.amex.length} rows cached`;
  });
  slots[2].addEventListener('change', async (e) => {
    await handleReconUpload('chase', e.target.files);
    if (notes[1]) notes[1].textContent = `✓ ${RECON_DATA.chase.length} rows cached`;
  });
  slots[3].addEventListener('change', async (e) => {
    await handleReconUpload('bank', e.target.files);
    if (notes[2]) notes[2].textContent = `✓ ${RECON_DATA.bank.length} rows cached`;
  });

  if (runBtn) runBtn.addEventListener('click', runReconciliation);
  if (search) search.addEventListener('input', applyReconSearchFilter);

  renderReconReport();
  _reconUiBound = true;
}

// ══════════════════════════════════════════
// AUTO-LOGOUT (15 min idle → 60s warning)
// ══════════════════════════════════════════
const IDLE_TIMEOUT = 15 * 60 * 1000; // 15 minutes
const WARN_DURATION = 60;             // 60 second countdown
let idleTimer = null;
let countdownTimer = null;
let countdownVal = WARN_DURATION;

function resetTimer() {
  // Hide warning modal
  document.getElementById('timeoutOverlay').classList.remove('open');
  clearInterval(countdownTimer);
  countdownVal = WARN_DURATION;
  document.getElementById('timeoutCountdown').textContent = WARN_DURATION;

  // Only run if logged in
  if (!currentUser) return;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(showTimeoutWarning, IDLE_TIMEOUT);
}

function showTimeoutWarning() {
  if (!currentUser) return;
  document.getElementById('timeoutOverlay').classList.add('open');
  countdownVal = WARN_DURATION;
  clearInterval(countdownTimer);
  countdownTimer = setInterval(() => {
    countdownVal--;
    document.getElementById('timeoutCountdown').textContent = countdownVal;
    if (countdownVal <= 0) {
      clearInterval(countdownTimer);
      document.getElementById('timeoutOverlay').classList.remove('open');
      signOut();
      // Show a brief message on the login page
      document.getElementById('loginErr').textContent = 'You were logged out due to inactivity.';
      document.getElementById('loginErr').style.background = '#fef9c3';
      document.getElementById('loginErr').style.color = '#854d0e';
      document.getElementById('loginErr').style.display = 'block';
    }
  }, 1000);
}

// Listen for any user activity
['mousemove','keydown','mousedown','touchstart','scroll','click'].forEach(evt =>
  document.addEventListener(evt, () => { if (currentUser) resetTimer(); }, { passive: true })
);


// ══════════════════════════════════════════
// PR LABOR LAW ACCRUAL ENGINE
// Law: Act 180 of Puerto Rico
// ══════════════════════════════════════════

/**
 * Calculate monthly accrual for one employee for one month.
 * @param {number} hoursWorked - total hours worked that month
 * @param {number} avgWeeklyHours - average weekly hours (hoursWorked / weeksInMonth)
 * @returns {{ vacationEarned: number, sickEarned: number, tier: string }}
 */
// Act 180-1998 caps (Law 41-2022 was struck down March 2023 — original Act 180 applies)
const SICK_MAX_ACCRUAL   = 15;  // Max 15 days sick leave balance at any time
const VAC_MAX_ACCRUAL    = 30;  // Max 30 days vacation balance at any time
const VAC_MIN_TENURE_MONTHS = 12; // Vacation cannot be claimed until 1 year of service

function calcMonthlyAccrual(hoursWorked, avgWeeklyHours) {
  // Rule 1: ≥ 115 hours → full tier
  if (hoursWorked >= 115) {
    return { vacationEarned: 1.25, sickEarned: 1.0, tier: 'full' };
  }
  // Rule 2: < 115 hours but avg weekly ≥ 20 → partial tier
  else if (avgWeeklyHours >= 20) {
    return { vacationEarned: 0.5, sickEarned: 0.5, tier: 'partial' };
  }
  // Rule 3: does not qualify
  else {
    return { vacationEarned: 0, sickEarned: 0, tier: 'none' };
  }
}

/**
 * Process all months of punch data for an employee and return totals.
 * Applies PR Act 180 caps and 1-year vacation eligibility rule.
 * @param {Array} monthlyRecords - array of { year, month, hoursWorked }
 * @param {string} firstClockIn  - ISO date string of first day worked
 * @param {number} vacTaken      - total vacation days already taken
 * @param {number} sickTaken     - total sick days already taken
 * @returns {{ vacationEarned, sickEarned, vacationBal, sickBal, vacationEligible, monthlyBreakdown }}
 */
function calcEmployeeAccruals(monthlyRecords, firstClockIn, vacTaken = 0, sickTaken = 0) {
  let vacationEarned = 0;
  let sickEarned     = 0;
  const monthlyBreakdown = [];

  // Calculate tenure in months from firstClockIn
  const startDate = firstClockIn ? new Date(firstClockIn) : null;
  const tenureMonths = startDate
    ? Math.floor((Date.now() - startDate) / (1000 * 60 * 60 * 24 * 30.44))
    : 0;

  // Vacation can only be CLAIMED (used) after 12 months — but still accrues
  const vacationEligible = tenureMonths >= VAC_MIN_TENURE_MONTHS;

  for (const rec of monthlyRecords) {
    // A month is "complete" when it has 2 pay periods uploaded
    // For months with only 1 pay period, accrue based on current hours
    // (user uploads bi-weekly; after both uploads the month is fully counted)
    const periodCount = (rec.payPeriods || []).length;
    const isComplete  = periodCount >= 2;

    // Always calculate accrual immediately on whatever hours are uploaded so far.
    // Employees see their running balance right away.
    // When the 2nd pay period is uploaded, the month recalculates automatically —
    // someone who was partial tier may move to full tier once all hours are in.
    const avgWeeklyHours = rec.hoursWorked / 4.33;
    const accrual = calcMonthlyAccrual(rec.hoursWorked, avgWeeklyHours);

    vacationEarned += accrual.vacationEarned;
    sickEarned     += accrual.sickEarned;

    const sickBal = Math.min(sickEarned - sickTaken, SICK_MAX_ACCRUAL);
    const vacBal  = Math.min(vacationEarned - vacTaken, VAC_MAX_ACCRUAL);

    monthlyBreakdown.push({
      year: rec.year,
      month: rec.month,
      hoursWorked: rec.hoursWorked,
      avgWeeklyHours: +avgWeeklyHours.toFixed(2),
      vacationEarned: accrual.vacationEarned,
      sickEarned: accrual.sickEarned,
      tier: accrual.tier,
      periodCount,
      isComplete,
      runningVacBal:  +Math.max(0, vacBal).toFixed(2),
      runningSickBal: +Math.max(0, sickBal).toFixed(2)
    });
  }

  // Final balances with caps applied
  const sickBal = +Math.min(Math.max(sickEarned - sickTaken, 0), SICK_MAX_ACCRUAL).toFixed(2);
  const vacBal  = +Math.min(Math.max(vacationEarned - vacTaken, 0), VAC_MAX_ACCRUAL).toFixed(2);

  return {
    vacationEarned:   +vacationEarned.toFixed(2),
    sickEarned:       +sickEarned.toFixed(2),
    vacationBal:      vacBal,
    sickBal:          sickBal,
    vacationEligible, // false = accruing but can't use yet (< 1 year tenure)
    tenureMonths,
    monthlyBreakdown
  };
}

/**
 * Recalculate all employees in the EMPLOYEES object and update the dashboard.
 * Call this after importing data or recording time-off.
 */
function recalculateAll() {
  let activeCount = 0;
  let inactiveCount = 0;

  const tbody = document.getElementById('dashTbody');
  if (!tbody) return;

  const rows = [];

  for (const [pin, emp] of Object.entries(EMPLOYEES)) {
    const accruals = calcEmployeeAccruals(emp.monthlyRecords || [], emp.firstClockIn, emp.vacTaken || 0, emp.sickTaken || 0);

    // Apply time-off taken
    const vacTaken  = +(emp.vacTaken  || 0);
    const sickTaken = +(emp.sickTaken || 0);
    const vacBal    = +(accruals.vacationEarned - vacTaken).toFixed(2);
    const sickBal   = +(accruals.sickEarned    - sickTaken).toFixed(2);

    // Store back
    emp.vacEarned  = accruals.vacationEarned;
    emp.sickEarned = accruals.sickEarned;
    emp.vacBal     = vacBal;
    emp.sickBal    = sickBal;

    if (emp.status === 'active') activeCount++; else inactiveCount++;

    // Tenure
    let tenure = '—';
    if (emp.firstClockIn) {
      const months = Math.floor((Date.now() - new Date(emp.firstClockIn)) / (1000*60*60*24*30.44));
      tenure = months >= 12 ? Math.floor(months/12) + 'y ' + (months%12) + 'm' : months + 'm';
    }

    const vacNote = !accruals.vacationEligible ? ' <span title="Cannot use vacation until 1 year of service" style="font-size:.7rem;color:#d97706;cursor:help">⚠ < 1yr</span>' : '';
    rows.push(`<tr>
      <td><strong>${emp.name}</strong></td>
      <td><span class="badge bg-teal">${emp.type || 'hourly'}</span></td>
      <td><span class="badge ${emp.status==='active'?'bg-green':'bg-gray'}">${emp.status||'active'}</span></td>
      <td>${tenure}</td>
      <td>${accruals.sickEarned}</td>
      <td>${emp.sickTaken||0}</td>
      <td style="font-weight:600;color:${accruals.sickBal<=0?'var(--red)':'var(--navy)'}">${accruals.sickBal}</td>
      <td>${accruals.vacationEarned}${vacNote}</td>
      <td>${emp.vacTaken||0}</td>
      <td style="font-weight:600;color:${accruals.vacationBal<=0?'var(--red)':'var(--navy)'}">${accruals.vacationBal}${vacNote}</td>
    </tr>`);
  }

  // Check for any months missing their 2nd pay period
  const pendingMonths = [];
  for (const [pin, emp] of Object.entries(EMPLOYEES)) {
    for (const rec of (emp.monthlyRecords || [])) {
      const periodCount = (rec.payPeriods || []).length;
      const now = new Date();
      const isCurrentMonth = rec.year === now.getFullYear() && rec.month === now.getMonth()+1;
      if (periodCount === 1 && !isCurrentMonth) {
        const monthName = new Date(rec.year, rec.month-1).toLocaleString('en-US',{month:'long',year:'numeric'});
        if (!pendingMonths.includes(monthName)) pendingMonths.push(monthName);
      }
    }
  }

  if (pendingMonths.length) {
    const notice = document.getElementById('pendingPeriodsNotice') || (() => {
      const d = document.createElement('div');
      d.id = 'pendingPeriodsNotice';
      d.style.cssText = 'background:#fffbec;border-left:4px solid #d97706;border-radius:8px;padding:12px 16px;margin-bottom:16px;font-size:.84rem';
      document.getElementById('p-dashboard').insertBefore(d, document.getElementById('p-dashboard').firstChild);
      return d;
    })();
    notice.innerHTML = `📋 <strong>Note:</strong> ${pendingMonths.join(', ')} only have 1 of 2 pay periods uploaded. Balances are estimated — upload the 2nd period to finalize.`;
    notice.style.display = 'block';
  } else {
    const n = document.getElementById('pendingPeriodsNotice');
    if (n) n.style.display = 'none';
  }

  if (rows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="10"><div class="empty"><div class="ei">📋</div><p>No data yet. Import data to get started.</p></div></td></tr>';
  } else {
    tbody.innerHTML = rows.join('');
  }

  // Update stat cards
  const sActive   = document.getElementById('sActive');
  const sInactive = document.getElementById('sInactive');
  if (sActive)   sActive.textContent   = activeCount;
  if (sInactive) sInactive.textContent = inactiveCount;

  // Update employee portal balances if logged in as employee
  if (currentUser && currentUser.role === 'employee') {
    const emp = EMPLOYEES[currentUser.pin];
    if (emp) {
      document.getElementById('empSickEarned').textContent = emp.sickEarned ?? '—';
      document.getElementById('empSickTaken').textContent  = emp.sickTaken  ?? '—';
      document.getElementById('empSickBal').textContent    = emp.sickBal    ?? '—';
      document.getElementById('empVacEarned').textContent  = emp.vacEarned  ?? '—';
      document.getElementById('empVacTaken').textContent   = emp.vacTaken   ?? '—';
      document.getElementById('empVacBal').textContent     = emp.vacBal     ?? '—';
    }
  }
}

/**
 * Demo: add a test employee with sample monthly records to verify the engine.
 * Remove this once real import is wired up.
 */
function loadDemoData() {
  EMPLOYEES['12345'] = {
    name: 'Demo Employee',
    type: 'hourly',
    status: 'active',
    firstClockIn: '2024-01-01',
    vacTaken: 2,
    sickTaken: 1,
    monthlyRecords: [
      { year: 2025, month: 1,  hoursWorked: 120 }, // full tier
      { year: 2025, month: 2,  hoursWorked: 115 }, // full tier (exactly 115)
      { year: 2025, month: 3,  hoursWorked: 110 }, // partial (avg weekly ~25.4)
      { year: 2025, month: 4,  hoursWorked: 90  }, // partial (avg weekly ~20.8)
      { year: 2025, month: 5,  hoursWorked: 70  }, // none (avg weekly ~16.2)
      { year: 2025, month: 6,  hoursWorked: 130 }, // full tier
    ]
  };
  recalculateAll();
  alert('Demo data loaded! Check the Dashboard to see accruals calculated per PR labor law.');
}


// ══════════════════════════════════════════
// PDF PARSER — CFA Time Summary Report
// ══════════════════════════════════════════

/** Convert "HH:MM" or "H:MM" string to decimal hours */
function hhmm(s) {
  if (!s) return 0;
  const parts = s.trim().split(':');
  return parseInt(parts[0]) + parseInt(parts[1]) / 60;
}

/** Parse the Time Summary PDF using pdf.js (loaded from CDN) */
async function parseTimeSummaryPDF(file) {
  const pdfjsLib = window['pdfjs-dist/build/pdf'];
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  let allWords = [];
  let headerText = '';

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1 });

    // Collect words with their positions
    for (const item of content.items) {
      if (!item.str.trim()) continue;
      const tx = pdfjsLib.Util.transform(viewport.transform, item.transform);
      // pdf.js y is from bottom; convert to top-down
      const x = item.transform[4];
      const y = viewport.height - item.transform[5];
      if (p === 1) headerText += item.str + ' ';
      allWords.push({ text: item.str.trim(), x, y, page: p });
    }
  }

  // Parse date range from header
  const dateMatch = headerText.match(
    /From\s+\w+,\s+(\w+\s+\d+,\s+\d+)\s+through\s+\w+,\s+(\w+\s+\d+,\s+\d+)/
  );
  let periodStart = null, periodEnd = null, year = null, month = null;
  if (dateMatch) {
    periodStart = new Date(dateMatch[1]);
    periodEnd   = new Date(dateMatch[2]);
    year  = periodStart.getFullYear();
    month = periodStart.getMonth() + 1;
  }

  // Group words into rows by y-coordinate (±3px tolerance)
  const rowMap = {};
  for (const w of allWords) {
    const key = Math.round(w.y / 3) * 3;
    if (!rowMap[key]) rowMap[key] = [];
    rowMap[key].push(w);
  }

  const SKIP = new Set(['Employee','Name','Total','Time','Wage','Rate','Regular',
    'Hours','Wages','Overtime','Grand','All',"Employees'","Employees'",'Page','of',
    'FSU','Filtros','Los','Summary','Report','From','through','Monday','Tuesday',
    'Wednesday','Thursday','Friday','Saturday','Sunday','AM','PM','1','2','3']);

  const employees = [];
  const timeRe = /^\d+:\d{2}$/;
  const dateRe  = /^\d{2}\/\d{2}\/\d{4}$/;

  for (const [rowKey, words] of Object.entries(rowMap)) {
    const sorted = words.sort((a, b) => a.x - b.x);
    let nameParts = [], totalTime = null, regHours = null, otHours = null;

    for (const w of sorted) {
      const t = w.text;
      if (SKIP.has(t) || dateRe.test(t)) continue;

      if (timeRe.test(t)) {
        if (w.x < 210)      totalTime = t;
        else if (w.x < 390) regHours  = t;
        else if (w.x < 530) otHours   = t;
      } else if (w.x < 155) {
        nameParts.push(t);
      }
    }

    if (nameParts.length && totalTime && regHours) {
      const name = nameParts.join(' ');
      if (name.toLowerCase().includes('grand') || name.toLowerCase().includes('employees')) continue;
      const totalHours = hhmm(totalTime);
      employees.push({
        name,
        totalTime,
        regularHours: regHours,
        otHours: otHours || '0:00',
        totalHours: +totalHours.toFixed(2)
      });
    }
  }

  return { periodStart, periodEnd, year, month, employees };
}

// ══════════════════════════════════════════
// IMPORT DATA — wire up the upload button
// ══════════════════════════════════════════

// Track uploaded pay periods to avoid double-counting
let IMPORTED_PERIODS = {};  // key: "YYYY-MM-DD_YYYY-MM-DD" → true
let TIME_OFF_REQUESTS = [];  // pending/approved/rejected requests

async function handleImport(file) {
  const statusEl = document.getElementById('importStatus');
  const progressEl = document.getElementById('importProgress');
  
  statusEl.style.display = 'block';
  statusEl.innerHTML = '<span style="color:var(--navy)">⏳ Parsing PDF...</span>';
  progressEl.style.display = 'block';

  try {
    const result = await parseTimeSummaryPDF(file);

    if (!result.employees.length) {
      statusEl.innerHTML = '<span style="color:var(--red)">❌ No employees found. Is this a Time Summary Report?</span>';
      return;
    }

    const periodKey = `${result.periodStart?.toISOString().slice(0,10)}_${result.periodEnd?.toISOString().slice(0,10)}`;
    
    if (IMPORTED_PERIODS[periodKey]) {
      statusEl.innerHTML = `<span style="color:#d97706">⚠ This pay period was already imported. Remove it first to re-import.</span>`;
      return;
    }
    IMPORTED_PERIODS[periodKey] = true;

    let newCount = 0, updatedCount = 0;

    for (const emp of result.employees) {
      const key = emp.name.toLowerCase().replace(/\s+/g,'_');

      if (!EMPLOYEES[key]) {
        // New employee — auto-create
        EMPLOYEES[key] = {
          name: emp.name,
          type: 'hourly',
          status: 'active',
          firstClockIn: result.periodStart?.toISOString().slice(0,10) || null,
          vacTaken: 0,
          sickTaken: 0,
          monthlyRecords: []
        };
        newCount++;
      } else {
        updatedCount++;
      }

      const empRecord = EMPLOYEES[key];

      // Find or create monthly record for this period's month/year
      const y = result.year, m = result.month;
      let monthRec = empRecord.monthlyRecords.find(r => r.year === y && r.month === m);
      if (!monthRec) {
        monthRec = { year: y, month: m, hoursWorked: 0, payPeriods: [] };
        empRecord.monthlyRecords.push(monthRec);
      }

      // Add this pay period's hours (bi-weekly uploads accumulate into monthly)
      monthRec.hoursWorked += emp.totalHours;
      monthRec.payPeriods.push({
        periodKey,
        start: result.periodStart?.toISOString().slice(0,10),
        end:   result.periodEnd?.toISOString().slice(0,10),
        hours: emp.totalHours
      });
    }

    // Update employee counts in dashboard
    const sActive = Object.values(EMPLOYEES).filter(e => e.status === 'active').length;
    const sInactive = Object.values(EMPLOYEES).filter(e => e.status !== 'active').length;
    document.getElementById('sActive').textContent   = sActive;
    document.getElementById('sInactive').textContent = sInactive;

    // Update data range display
    const allPeriods = Object.values(EMPLOYEES)
      .flatMap(e => e.monthlyRecords.flatMap(m => m.payPeriods || []))
      .map(p => p.start).filter(Boolean).sort();
    if (allPeriods.length) {
      document.getElementById('sRange').textContent =
        allPeriods[0] + ' → ' + allPeriods[allPeriods.length-1];
    }

    // Recalculate all accruals
    recalculateAll();

    // Populate dropdowns
    populateEmployeeDropdowns();

    const fmt = d => d ? new Date(d).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) : '?';
    statusEl.innerHTML = `
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:14px 16px">
        <div style="font-weight:700;color:#166534;margin-bottom:6px">✅ Import Successful!</div>
        <div style="font-size:.83rem;color:#166534">
          Period: <strong>${fmt(result.periodStart)} – ${fmt(result.periodEnd)}</strong><br>
          ${result.employees.length} employees processed
          (${newCount} new, ${updatedCount} updated)<br>
          Accruals recalculated per PR Act 180.
        </div>
      </div>`;
    progressEl.style.display = 'none';

    // Refresh all dependent views
    updateEmployeesTab();
    updateUserAccountsTab();

    // Switch to dashboard to show results
    setTimeout(() => goTab('dashboard'), 1500);

  } catch (err) {
    console.error(err);
    statusEl.innerHTML = `<span style="color:var(--red)">❌ Error parsing PDF: ${err.message}</span>`;
    progressEl.style.display = 'none';
  }
}

// ══════════════════════════════════════════
// POPULATE EMPLOYEE DROPDOWNS everywhere
// ══════════════════════════════════════════
function populateEmployeeDropdowns() {
  const empList = Object.entries(EMPLOYEES)
    .filter(([k,e]) => e.status === 'active')
    .sort((a,b) => a[1].name.localeCompare(b[1].name));

  const allEmpList = Object.entries(EMPLOYEES)
    .sort((a,b) => a[1].name.localeCompare(b[1].name));

  // Record Time-Off employee dropdown
  const rtoSel = document.getElementById('rtoEmployeeSel');
  if (rtoSel) {
    rtoSel.innerHTML = '<option value="">Select employee...</option>' +
      empList.map(([k,e]) => `<option value="${k}">${e.name}</option>`).join('');
  }

  // Create User Account dropdown
  const userSel = document.getElementById('userEmployeeSel');
  if (userSel) {
    userSel.innerHTML = '<option value="">Select employee...</option>' +
      allEmpList.map(([k,e]) => `<option value="${k}">${e.name}</option>`).join('');
  }

  // Tardiness modal employee dropdown
  const tardSel = document.getElementById('tardEmpSel');
  if (tardSel) {
    tardSel.innerHTML = '<option value="">Select employee...</option>' +
      empList.map(([k,e]) => `<option value="${k}">${e.name}</option>`).join('');
  }

  // Meal penalty modal employee dropdown
  const mealSel = document.getElementById('mealEmpSel');
  if (mealSel) {
    mealSel.innerHTML = '<option value="">Select employee...</option>' +
      empList.map(([k,e]) => `<option value="${k}">${e.name}</option>`).join('');
  }
}

// ══════════════════════════════════════════
// RECORD TIME-OFF — actually saves
// ══════════════════════════════════════════
function submitRecordTimeOff() {
  const empKey  = document.getElementById('rtoEmployeeSel').value;
  const type    = document.getElementById('rtoType').value;
  const days    = parseFloat(document.getElementById('rtoDays').value);
  const date    = document.getElementById('rtoDate').value;
  const notes   = document.getElementById('rtoNotes').value;

  if (!empKey) { alert('Please select an employee.'); return; }
  if (!days || days <= 0) { alert('Please enter valid number of days.'); return; }
  if (!date) { alert('Please select a date.'); return; }

  const emp = EMPLOYEES[empKey];
  if (!emp) { alert('Employee not found.'); return; }

  // Calculate current balances before deducting
  const accr = calcEmployeeAccruals(emp.monthlyRecords || [], emp.firstClockIn, emp.vacTaken || 0, emp.sickTaken || 0);

  // Apply to correct balance — with eligibility and balance guards
  if (type === 'Sick') {
    if (days > accr.sickBal) {
      alert(`❌ Cannot record time-off. ${emp.name} only has ${accr.sickBal.toFixed(2)} sick days available.`);
      return;
    }
    emp.sickTaken = +(( emp.sickTaken || 0) + days).toFixed(2);
  } else if (type === 'Vacation' || type === 'Vacation Liquidation (Payout)') {
    if (!accr.vacationEligible && type !== 'Vacation Liquidation (Payout)') {
      alert(`⚠️ ${emp.name} has not completed 1 year of service and cannot use vacation yet (PR Act 180). Vacation accrues but cannot be claimed until the 1-year anniversary.`);
      return;
    }
    if (days > accr.vacationBal) {
      alert(`❌ Cannot record time-off. ${emp.name} only has ${accr.vacationBal.toFixed(2)} vacation days available.`);
      return;
    }
    emp.vacTaken  = +(( emp.vacTaken  || 0) + days).toFixed(2);
  }

  // ── Duplicate check: pending or approved request for same employee/date/type? ──
  const dupRequest = TIME_OFF_REQUESTS.find(r =>
    (r.empKey === empKey || r.empName === emp.name) &&
    r.type === type &&
    r.start <= date && r.end >= date &&
    (r.status === 'pending' || r.status === 'approved')
  );
  if (dupRequest) {
    const statusLabel = dupRequest.status === 'approved' ? 'already approved' : 'still pending';
    if (!confirm(`⚠️ Duplicate detected!\n\n${emp.name} has a ${dupRequest.status} request for ${dupRequest.type} covering ${dupRequest.start}→${dupRequest.end} (${dupRequest.days} days) — ${statusLabel}.\n\nRecording this manually may double-deduct their balance. Continue anyway?`)) return;
  }

  // ── Duplicate check: already manually logged for same date+type? ──
  const dupLog = (emp.timeOffLog || []).find(l => l.date === date && l.type === type);
  if (dupLog) {
    if (!confirm(`⚠️ Duplicate detected!\n\n${emp.name} already has a ${type} entry on ${date} (${dupLog.days} days, recorded ${new Date(dupLog.recordedAt).toLocaleDateString()}).\n\nContinue anyway?`)) return;
  }

  // Log it
  if (!emp.timeOffLog) emp.timeOffLog = [];
  const accrBeforeManual = calcEmployeeAccruals(emp.monthlyRecords||[], emp.firstClockIn, emp.vacTaken||0, emp.sickTaken||0);
  emp.timeOffLog.push({
    type, days, date, notes,
    recordedBy: currentUser?.name || currentUser?.pin || 'admin',
    recordedAt: new Date().toISOString(),
    source: 'manual_entry',
    balanceBefore: type === 'Sick' ? accrBeforeManual.sickBal : accrBeforeManual.vacationBal
  });

  recalculateAll();
  saveToStorage();

  // Show confirmation
  const btn = document.getElementById('rtoSubmitBtn');
  btn.textContent = '✅ Recorded!';
  btn.style.background = '#16a34a';
  setTimeout(() => {
    btn.textContent = 'Record Time-Off';
    btn.style.background = '';
    // Reset form
    document.getElementById('rtoEmployeeSel').value = '';
    document.getElementById('rtoDays').value = '';
    document.getElementById('rtoDate').value = '';
    document.getElementById('rtoNotes').value = '';
  }, 2000);
}

// Toggle inactive employees in Record Time-Off
function toggleInactiveEmployees(checked) {
  const sel = document.getElementById('rtoEmployeeSel');
  if (!sel) return;
  const list = checked
    ? Object.entries(EMPLOYEES)
    : Object.entries(EMPLOYEES).filter(([k,e]) => e.status === 'active');
  sel.innerHTML = '<option value="">Select employee...</option>' +
    list.sort((a,b) => a[1].name.localeCompare(b[1].name))
        .map(([k,e]) => `<option value="${k}">${e.name}${e.status!=='active'?' (inactive)':''}</option>`).join('');
}

// ══════════════════════════════════════════
// DATA PERSISTENCE — Supabase Cloud + localStorage fallback
// ══════════════════════════════════════════
function _cacheToLocal() {
  try {
    localStorage.setItem('cfa_losfiltros_employees', JSON.stringify(EMPLOYEES));
    localStorage.setItem('cfa_losfiltros_periods',   JSON.stringify(IMPORTED_PERIODS));
    localStorage.setItem('cfa_losfiltros_requests',  JSON.stringify(TIME_OFF_REQUESTS));
    localStorage.setItem('cfa_losfiltros_tardiness', JSON.stringify(TARDINESS_LOG));
    localStorage.setItem('cfa_losfiltros_meals',     JSON.stringify(MEAL_PENALTIES));
    localStorage.setItem('cfa_losfiltros_slack',     JSON.stringify(SLACK_SETTINGS));
  } catch(e) { console.warn('localStorage cache failed:', e); }
}

async function saveToCloud() {
  try {
    const payload = {
      key:       'appdata',
      employees: EMPLOYEES,
      periods:   IMPORTED_PERIODS,
      requests:  TIME_OFF_REQUESTS,
      tardiness: TARDINESS_LOG,
      meals:     MEAL_PENALTIES,
      slack:     SLACK_SETTINGS,
      saved_at:  new Date().toISOString(),
    };
    const { error } = await getSupa().from('app_data').upsert(payload, { onConflict: 'key' });
    if (error) { console.warn('Cloud save error:', error.message); return; }
    const now = new Date().toLocaleString();
    localStorage.setItem('cfa_losfiltros_backup_time', now);
    const sb = document.getElementById('sBackup');
    if (sb) sb.textContent = now;
  } catch(e) { console.warn('Cloud save failed:', e); }
}

function saveToStorage() {
  _cacheToLocal();
  saveToCloud();
}

async function loadFromStorage() {
  try {
    const { data, error } = await getSupa().from('app_data').select('*').eq('key','appdata').single();
    if (!error && data) {
      if (data.employees)  Object.assign(EMPLOYEES, data.employees);
      if (data.periods)    Object.assign(IMPORTED_PERIODS, data.periods);
      if (data.requests)   { TIME_OFF_REQUESTS.length = 0; TIME_OFF_REQUESTS.push(...data.requests); }
      if (data.tardiness)  { TARDINESS_LOG.length  = 0; TARDINESS_LOG.push(...data.tardiness); }
      if (data.meals)      { MEAL_PENALTIES.length  = 0; MEAL_PENALTIES.push(...data.meals); }
      if (data.slack)      Object.assign(SLACK_SETTINGS, data.slack);
      _cacheToLocal();
      console.log('✅ Loaded from Supabase cloud');
    } else throw new Error('no cloud data');
  } catch(e) {
    console.warn('Cloud load failed, using local cache:', e.message);
    try {
      const empData = localStorage.getItem('cfa_losfiltros_employees');
      if (empData) Object.assign(EMPLOYEES, JSON.parse(empData));
      const periodData = localStorage.getItem('cfa_losfiltros_periods');
      if (periodData) Object.assign(IMPORTED_PERIODS, JSON.parse(periodData));
      const reqData = localStorage.getItem('cfa_losfiltros_requests');
      if (reqData) { TIME_OFF_REQUESTS.length = 0; TIME_OFF_REQUESTS.push(...JSON.parse(reqData)); }
      const td = localStorage.getItem('cfa_losfiltros_tardiness');
      if (td) { TARDINESS_LOG.length = 0; TARDINESS_LOG.push(...JSON.parse(td)); }
      const mp = localStorage.getItem('cfa_losfiltros_meals');
      if (mp) { MEAL_PENALTIES.length = 0; MEAL_PENALTIES.push(...JSON.parse(mp)); }
      const sl = localStorage.getItem('cfa_losfiltros_slack');
      if (sl) Object.assign(SLACK_SETTINGS, JSON.parse(sl));
    } catch(e2) { console.warn('localStorage load failed:', e2); }
  }

  const backupTime = localStorage.getItem('cfa_losfiltros_backup_time');
  if (backupTime) { const sb = document.getElementById('sBackup'); if(sb) sb.textContent = backupTime; }
  const allPeriods = Object.values(EMPLOYEES)
    .flatMap(e => e.monthlyRecords?.flatMap(m => m.payPeriods || []) || [])
    .map(p => p.start).filter(Boolean).sort();
  if (allPeriods.length) {
    const sr = document.getElementById('sRange');
    if(sr) sr.textContent = allPeriods[0] + ' → ' + allPeriods[allPeriods.length-1];
  }
  populateEmployeeDropdowns();
  recalculateAll();
  updateRequestBadge();
}

// Auto-save every 5 minutes and after key actions
setInterval(() => { if (currentUser) saveToStorage(); }, 5 * 60 * 1000);
window.addEventListener('load', initReconciliationUI);

// Override doBackup to also persist
function doBackup() {
  saveToStorage();
  alert('Backup saved to cloud successfully!');
}

// Load data on page load
window.addEventListener('load', loadFromStorage);


// ══════════════════════════════════════════
// TESTING HELPERS
// ══════════════════════════════════════════
function clearPeriodLock() {
  IMPORTED_PERIODS = {};
  try { localStorage.removeItem('cfa_losfiltros_periods'); } catch(e){}
  const fi = document.getElementById('wageFile');
  if (fi) fi.value = '';
  const dz = document.getElementById('importDropzone');
  if (dz) dz.style.borderColor = '';
  const st = document.getElementById('importStatus');
  if (st) st.style.display = 'none';
  const out = document.getElementById('testOutput');
  if (out) { out.style.display='block'; out.style.color='#16a34a'; out.style.whiteSpace='normal';
    out.textContent='✅ Period lock cleared — re-upload the same PDF to simulate a 2nd pay period.'; }
}

function clearAllData() {
  if (!confirm('⚠️ This will delete ALL imported employee data and balances. Are you sure?')) return;
  Object.keys(EMPLOYEES).forEach(k => delete EMPLOYEES[k]);
  IMPORTED_PERIODS = {};
  try {
    localStorage.removeItem('cfa_losfiltros_employees');
    localStorage.removeItem('cfa_losfiltros_periods');
    localStorage.removeItem('cfa_losfiltros_backup_time');
  } catch(e){}
  recalculateAll();
  const sr = document.getElementById('sRange'); if(sr) sr.textContent='No data yet';
  const sb = document.getElementById('sBackup'); if(sb) sb.textContent='Never';
  const out = document.getElementById('testOutput');
  if (out) { out.style.display='block'; out.style.color='var(--red)'; out.style.whiteSpace='normal';
    out.textContent='🗑 All data cleared.'; }
}

function showImportedPeriods() {
  const out = document.getElementById('testOutput');
  if (!out) return;
  out.style.display = 'block';
  out.style.whiteSpace = 'pre';
  const periods = Object.keys(IMPORTED_PERIODS);
  if (!periods.length) {
    out.style.color='var(--text-mid)'; out.textContent='No periods imported yet.'; return;
  }
  const sampleEmp = Object.values(EMPLOYEES)[0];
  let detail = '';
  if (sampleEmp) {
    detail = '\n\nSample: ' + sampleEmp.name;
    for (const rec of (sampleEmp.monthlyRecords||[])) {
      const avg = (rec.hoursWorked/4.33).toFixed(1);
      detail += '\n  '+rec.year+'-'+String(rec.month).padStart(2,'0')+
        ': '+rec.hoursWorked.toFixed(1)+' hrs ('+
        (rec.payPeriods||[]).length+' period(s), avg weekly: '+avg+' hrs)'+
        ' → '+(rec.hoursWorked>=115?'FULL ✅':avg>=20?'PARTIAL 🟡':'NONE ❌');
    }
  }
  out.style.color='var(--navy)';
  out.innerHTML='<strong>Imported periods:</strong>\n'+periods.join('\n')+detail;
}

// ══════════════════════════════════════════
// ADD EMPLOYEE — saves to EMPLOYEES object
// ══════════════════════════════════════════
function submitAddEmployee() {
  const first  = document.getElementById('empFirst').value.trim();
  const last   = document.getElementById('empLast').value.trim();
  const pin    = document.getElementById('empPin').value.trim();
  const type   = document.getElementById('empType').value;
  const date   = document.getElementById('empDate').value;
  const status = document.getElementById('empStatus').value;

  if (!first || !last) { alert('Please enter first and last name.'); return; }

  // Build key same way as importer: "Last, First" normalized
  const fullName = last + ', ' + first;
  const key = fullName.toLowerCase().replace(/\s+/g,'_');

  EMPLOYEES[key] = {
    name: fullName,
    type: type.toLowerCase(),
    status: status.toLowerCase(),
    firstClockIn: date || new Date().toISOString().slice(0,10),
    pin: pin || null,
    vacTaken: 0,
    sickTaken: 0,
    monthlyRecords: [],
    timeOffLog: []
  };

  // Also create a user account if PIN provided
  if (pin) {
    USERS[pin] = { password: null, role: 'employee', name: fullName, needsSetup: true };
  }

  saveToStorage();
  recalculateAll();
  populateEmployeeDropdowns();
  updateEmployeesTab();

  // Update stat cards
  document.getElementById('sActive').textContent   = Object.values(EMPLOYEES).filter(e=>e.status==='active').length;
  document.getElementById('sInactive').textContent = Object.values(EMPLOYEES).filter(e=>e.status!=='active').length;

  cm('addEmpModal');
  // Clear form
  ['empFirst','empLast','empPin','empDate'].forEach(id => { const el=document.getElementById(id); if(el) el.value=''; });

  showToast('✅ Employee ' + fullName + ' added!');
}

// ══════════════════════════════════════════
// EMPLOYEES TAB — live table from EMPLOYEES
// ══════════════════════════════════════════


function editEmployee(key) {
  const emp = EMPLOYEES[key];
  if (!emp) return;
  const newStatus = emp.status === 'active' ? 'inactive' : 'active';
  if (confirm(`Toggle ${emp.name} to ${newStatus}?`)) {
    emp.status = newStatus;
    saveToStorage();
    recalculateAll();
    updateEmployeesTab();
  }
}

// ══════════════════════════════════════════
// USER ACCOUNTS TAB — live table from USERS
// ══════════════════════════════════════════
function updateUserAccountsTab() {
  const tbody = document.getElementById('userTbody');
  if (!tbody) return;
  const adminUsers = Object.entries(USERS).filter(([, user]) => user.role === 'admin');
  const rows = adminUsers.map(([pin, user]) => `
    <tr>
      <td><strong>${pin}</strong></td>
      <td>${user.name || '—'}</td>
      <td><span class="badge bg-orange">admin</span></td>
      <td><span class="badge ${user.needsSetup?'bg-yellow':'bg-green'}">${user.needsSetup?'Pending setup':'Set'}</span></td>
    </tr>`).join('');
  tbody.innerHTML = rows || '<tr><td colspan="4"><div class="empty"><div class="ei">🔐</div><p>No admin accounts found.</p></div></td></tr>';
}

// ══════════════════════════════════════════
// TIME-OFF REQUESTS — employee submit + admin approve/reject
// ══════════════════════════════════════════

// Store pending requests
// TIME_OFF_REQUESTS initialized at module level

function updateRequestBadge() {
  const pending = TIME_OFF_REQUESTS.filter(r => r.status==='pending').length;
  const badge = document.getElementById('tob');
  const nb    = document.getElementById('nb');
  const sp    = document.getElementById('sPending');
  if (badge)  { badge.textContent  = pending; badge.style.display = pending > 0 ? 'inline-flex' : 'none'; }
  if (nb)     { nb.textContent     = pending; nb.style.display    = pending > 0 ? 'flex' : 'none'; }
  if (sp)       sp.textContent     = pending;
}

function renderTimeOffRequests() {
  const tbody = document.querySelector('#p-timeoff table tbody');
  if (!tbody) return;
  const filter = document.getElementById('toFilter')?.value || 'pending';
  const filtered = filter === 'all' ? TIME_OFF_REQUESTS : TIME_OFF_REQUESTS.filter(r => r.status === filter);

  if (!filtered.length) {
    tbody.innerHTML = `<tr><td colspan="11"><div class="empty"><div class="ei">📭</div><p>No ${filter} requests.</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(req => {
    const submittedAt = req.submittedAt ? new Date(req.submittedAt).toLocaleString() : '—';
    const reviewedAt  = req.reviewedAt  ? new Date(req.reviewedAt).toLocaleString()  : '—';
    const reviewedBy  = req.reviewedBy  || '—';
    return `
    <tr id="toRow${req.id}">
      <td>${req.empName||req.empKey}</td>
      <td><span class="badge bg-teal">${req.type}</span></td>
      <td>${req.days}</td>
      <td>${req.start}</td>
      <td>${req.end}</td>
      <td style="font-size:.8rem">${req.notes||'—'}</td>
      <td style="font-size:.75rem;color:#888">${submittedAt}</td>
      <td><span class="badge ${req.status==='approved'?'bg-green':req.status==='rejected'?'bg-red':'bg-yellow'}" id="toStatus${req.id}">${req.status}</span></td>
      <td style="font-size:.78rem;font-weight:600;color:var(--navy)">${req.status!=='pending' ? reviewedBy : '—'}</td>
      <td style="font-size:.75rem;color:#888">${req.status!=='pending' ? reviewedAt : '—'}</td>
      <td id="toActions${req.id}">
        ${req.status==='pending'
          ? `<button class="btn btn-green btn-sm" onclick="approveRequest(${req.id})">Approve</button>
             <button class="btn btn-red2 btn-sm" onclick="rejectRequest(${req.id})">Reject</button>`
          : `<span style="font-size:.78rem;color:var(--text-light)">${req.status==='approved'?'✓ Approved':'✗ Rejected'}</span>`}
      </td>
    </tr>`;
  }).join('');
}

function approveRequest(id) {
  const req = TIME_OFF_REQUESTS.find(r => r.id === id);
  if (!req) return;
  req.status = 'approved';
  req.reviewedAt = new Date().toISOString();
  req.reviewedBy = currentUser?.name || currentUser?.pin || 'admin';

  // Deduct from employee balance
  const empKey = Object.keys(EMPLOYEES).find(k =>
    EMPLOYEES[k].name === req.empName || k === req.empKey
  );
  if (empKey) {
    const emp = EMPLOYEES[empKey];
    const accr = calcEmployeeAccruals(emp.monthlyRecords || [], emp.firstClockIn, emp.vacTaken || 0, emp.sickTaken || 0);
    if (req.type === 'Sick') {
      if (req.days > accr.sickBal) {
        alert(`❌ Cannot approve request. ${emp.name} only has ${accr.sickBal.toFixed(2)} sick days available.`);
        return;
      }
      emp.sickTaken = +((emp.sickTaken||0) + req.days).toFixed(2);
    } else {
      if (!accr.vacationEligible) {
        alert(`⚠️ ${emp.name} has not completed 1 year of service (PR Act 180). Vacation cannot be approved yet.`);
        return;
      }
      if (req.days > accr.vacationBal) {
        alert(`❌ Cannot approve request. ${emp.name} only has ${accr.vacationBal.toFixed(2)} vacation days available.`);
        return;
      }
      emp.vacTaken  = +((emp.vacTaken||0)  + req.days).toFixed(2);
    }
    // ── Duplicate check: already manually recorded in timeOffLog for same date+type? ──
    const dupLog = (emp.timeOffLog || []).find(l =>
      l.date === req.start && l.type === req.type && l.notes !== 'Approved request'
    );
    if (dupLog) {
      if (!confirm(`⚠️ Duplicate detected!\n\n${emp.name} already has a manually recorded ${req.type} entry on ${req.start} (${dupLog.days} days).\n\nApproving this request will also deduct ${req.days} days — double-deducting the balance. Continue anyway?`)) return;
    }

    if (!emp.timeOffLog) emp.timeOffLog = [];
    const accrBefore = calcEmployeeAccruals(emp.monthlyRecords||[], emp.firstClockIn, emp.vacTaken||0, emp.sickTaken||0);
    emp.timeOffLog.push({
      type: req.type, days: req.days, date: req.start,
      notes: 'Approved request',
      recordedBy: req.reviewedBy,
      recordedAt: req.reviewedAt,
      source: 'request_approval',
      requestId: req.id,
      balanceBefore: req.type === 'Sick' ? accrBefore.sickBal : accrBefore.vacationBal
    });
  }

  recalculateAll();
  saveToStorage();
  try { localStorage.setItem('cfa_losfiltros_requests', JSON.stringify(TIME_OFF_REQUESTS)); } catch(e){}
  updateRequestBadge();
  renderTimeOffRequests();
  showToast('✅ Request approved — balance updated.');
}

function rejectRequest(id) {
  const req = TIME_OFF_REQUESTS.find(r => r.id === id);
  if (!req) return;
  req.status = 'rejected';
  req.reviewedAt = new Date().toISOString();
  req.reviewedBy = currentUser?.name || currentUser?.pin || 'admin';
  try { localStorage.setItem('cfa_losfiltros_requests', JSON.stringify(TIME_OFF_REQUESTS)); } catch(e){}
  updateRequestBadge();
  renderTimeOffRequests();
  showToast('✗ Request rejected.');
}

// ══════════════════════════════════════════
// TOAST NOTIFICATION
// ══════════════════════════════════════════
function showToast(msg) {
  let toast = document.getElementById('toastMsg');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'toastMsg';
    toast.style.cssText = 'position:fixed;bottom:24px;right:24px;background:var(--navy);color:#fff;' +
      'padding:12px 20px;border-radius:10px;font-size:.87rem;font-weight:500;z-index:500;' +
      'box-shadow:0 4px 20px rgba(0,0,0,.25);transition:opacity .3s;max-width:320px';
    document.body.appendChild(toast);
  }
  toast.textContent = msg;
  toast.style.opacity = '1';
  toast.style.display = 'block';
  clearTimeout(toast._timer);
  toast._timer = setTimeout(() => { toast.style.opacity='0'; setTimeout(()=>toast.style.display='none',300); }, 3000);
}

// Startup hydration handled inside loadFromStorage (called by window load event above)

// ══════════════════════════════════════════
// CHANGE PASSWORD — actually saves
// ══════════════════════════════════════════
function submitChangePassword() {
  const current  = document.getElementById('cpCurrent').value;
  const newPass  = document.getElementById('cpNew').value;
  const confirm  = document.getElementById('cpConfirm').value;
  const errEl    = document.getElementById('cpErr');

  if (!currentUser) return;
  const user = USERS[currentUser.pin];
  if (!user) return;

  if (user.password !== current) {
    errEl.textContent = 'Current password is incorrect.';
    errEl.style.display = 'block'; return;
  }
  if (!newPass || newPass.length < 4) {
    errEl.textContent = 'New password must be at least 4 characters.';
    errEl.style.display = 'block'; return;
  }
  if (newPass !== confirm) {
    errEl.textContent = 'Passwords do not match.';
    errEl.style.display = 'block'; return;
  }

  user.password   = newPass;
  user.needsSetup = false;
  currentUser.password = newPass;
  saveToStorage();
  errEl.style.display = 'none';
  ['cpCurrent','cpNew','cpConfirm'].forEach(id => document.getElementById(id).value = '');
  cm('cpModal');
  showToast('✅ Password updated successfully!');
}

// ══════════════════════════════════════════
// EMPLOYEES TAB — search + filter + balance columns
// ══════════════════════════════════════════
function updateEmployeesTab() {
  filterEmployeesTab();
}

function filterEmployeesTab() {
  const search     = (document.getElementById('empSearch')?.value || '').toLowerCase();
  const typeFilter = (document.getElementById('empTypeFilter')?.value || '').toLowerCase();
  const statFilter = (document.getElementById('empStatusFilter')?.value || '').toLowerCase();
  const tbody = document.getElementById('empTbody');
  if (!tbody) return;

  const emps = Object.entries(EMPLOYEES)
    .filter(([k,e]) => {
      if (typeFilter && (e.type||'hourly').toLowerCase() !== typeFilter) return false;
      if (statFilter && (e.status||'active').toLowerCase() !== statFilter) return false;
      if (search && !e.name.toLowerCase().includes(search)) return false;
      return true;
    })
    .sort((a,b) => a[1].name.localeCompare(b[1].name));

  if (!emps.length) {
    tbody.innerHTML = '<tr><td colspan="8"><div class="empty"><div class="ei">👥</div><p>No employees match.</p></div></td></tr>';
    return;
  }

  tbody.innerHTML = emps.map(([key,emp]) => {
    const accruals = calcEmployeeAccruals(emp.monthlyRecords||[], emp.firstClockIn, emp.vacTaken||0, emp.sickTaken||0);
    const tenure   = getTenureString(emp.firstClockIn);
    const sickBal  = accruals.sickBal;
    const vacBal   = accruals.vacationBal;
    return `<tr>
      <td><a href="#" style="color:var(--navy);font-weight:600;text-decoration:none" onclick="showEmpDetail('${key}');return false">${emp.name}</a></td>
      <td><span class="badge bg-teal">${emp.type||'hourly'}</span></td>
      <td><span class="badge ${emp.status==='active'?'bg-green':'bg-gray'}">${emp.status||'active'}</span></td>
      <td style="font-size:.8rem">${emp.firstClockIn||'—'}</td>
      <td style="font-weight:600;color:${sickBal<=0?'var(--red)':'#0f766e'}">${sickBal}</td>
      <td style="font-weight:600;color:${vacBal<=0?'var(--red)':'var(--navy)'}">${vacBal}${!accruals.vacationEligible?' <span style="font-size:.65rem;color:#d97706">⚠</span>':''}</td>
      <td style="font-size:.78rem;color:var(--text-light)">${tenure}</td>
      <td><button class="btn btn-sm" onclick="showEmpDetail('${key}')">View</button></td>
    </tr>`;
  }).join('');
}

function getTenureString(firstClockIn) {
  if (!firstClockIn) return '—';
  const months = Math.floor((Date.now() - new Date(firstClockIn)) / (1000*60*60*24*30.44));
  if (months >= 12) return Math.floor(months/12) + 'y ' + (months%12) + 'm';
  return months + ' mo';
}

// ══════════════════════════════════════════
// EMPLOYEE DETAIL VIEW
// ══════════════════════════════════════════
function showEmpDetail(key) {
  const emp = EMPLOYEES[key];
  if (!emp) return;

  const accruals = calcEmployeeAccruals(emp.monthlyRecords||[], emp.firstClockIn, emp.vacTaken||0, emp.sickTaken||0);

  document.getElementById('empDetailName').textContent = emp.name;
  document.getElementById('detSickE').textContent = accruals.sickEarned;
  document.getElementById('detSickT').textContent = emp.sickTaken||0;
  document.getElementById('detSickB').textContent = accruals.sickBal;
  document.getElementById('detVacE').textContent  = accruals.vacationEarned;
  document.getElementById('detVacT').textContent  = emp.vacTaken||0;
  document.getElementById('detVacB').textContent  = accruals.vacationBal;

  document.getElementById('detType').innerHTML    = `<span class="badge bg-teal">${emp.type||'hourly'}</span>`;
  document.getElementById('detStatus').innerHTML  = `<span class="badge ${emp.status==='active'?'bg-green':'bg-gray'}">${emp.status||'active'}</span>`;
  document.getElementById('detTenure').textContent = '📅 Tenure: ' + getTenureString(emp.firstClockIn);
  document.getElementById('detEligible').textContent = accruals.vacationEligible
    ? '✅ Vacation eligible' : '⚠️ Vacation not usable until 1yr';

  // Monthly breakdown table
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const tbody = document.getElementById('detMonthlyTbody');
  if (!(emp.monthlyRecords||[]).length) {
    tbody.innerHTML = '<tr><td colspan="7" style="padding:12px;text-align:center;color:#888">No pay periods imported yet.</td></tr>';
  } else {
    tbody.innerHTML = (emp.monthlyRecords||[])
      .sort((a,b) => a.year!==b.year ? a.year-b.year : a.month-b.month)
      .map(rec => {
        const avg = (rec.hoursWorked/4.33).toFixed(1);
        const acr = calcMonthlyAccrual(rec.hoursWorked, rec.hoursWorked/4.33);
        const tierColor = acr.tier==='full'?'#166534':acr.tier==='partial'?'#854d0e':'#888';
        const tierLabel = acr.tier==='full'?'Full ✅':acr.tier==='partial'?'Partial 🟡':'None ❌';
        const periods = (rec.payPeriods||[]).length;
        return `<tr style="border-bottom:1px solid #f0f0f0">
          <td style="padding:7px 10px">${monthNames[rec.month-1]} ${rec.year}</td>
          <td style="padding:7px 10px;text-align:right">${rec.hoursWorked.toFixed(1)}</td>
          <td style="padding:7px 10px;text-align:right">${avg}</td>
          <td style="padding:7px 10px;text-align:center;color:${tierColor};font-weight:600;font-size:.75rem">${tierLabel}</td>
          <td style="padding:7px 10px;text-align:right;color:#0f766e;font-weight:600">+${acr.sickEarned}</td>
          <td style="padding:7px 10px;text-align:right;color:var(--navy);font-weight:600">+${acr.vacationEarned}</td>
          <td style="padding:7px 10px;text-align:center">
            <span style="font-size:.7rem;background:${periods>=2?'#dcfce7':'#fef9c3'};color:${periods>=2?'#166534':'#854d0e'};padding:2px 7px;border-radius:10px">${periods}/2</span>
          </td>
        </tr>`;
      }).join('');
  }

  // Time-off log
  const logEl = document.getElementById('detTimeOffLog');
  if (!(emp.timeOffLog||[]).length) {
    logEl.textContent = 'No time-off recorded.';
  } else {
    logEl.innerHTML = '<table style="width:100%;font-size:.78rem;border-collapse:collapse">' +
      '<thead><tr style="background:#f8f9fa">' +
        '<th style="padding:6px 10px;text-align:left">Date</th>' +
        '<th style="padding:6px 10px;text-align:left">Type</th>' +
        '<th style="padding:6px 10px;text-align:right">Days</th>' +
        '<th style="padding:6px 10px;text-align:right">Bal Before</th>' +
        '<th style="padding:6px 10px;text-align:left">Source</th>' +
        '<th style="padding:6px 10px;text-align:left">By</th>' +
        '<th style="padding:6px 10px;text-align:left">Recorded At</th>' +
        '<th style="padding:6px 10px;text-align:left">Notes</th>' +
      '</tr></thead><tbody>' +
      (emp.timeOffLog||[]).slice().reverse().map(log => {
        const src = log.source === 'request_approval' ? '📋 Request' : log.source === 'manual_entry' ? '✏️ Manual' : '—';
        const by  = log.recordedBy || '—';
        const ts  = log.recordedAt ? new Date(log.recordedAt).toLocaleString() : '—';
        const bal = log.balanceBefore != null ? log.balanceBefore.toFixed(2) : '—';
        return `<tr style="border-bottom:1px solid #f0f0f0">
          <td style="padding:6px 10px">${log.date||'—'}</td>
          <td style="padding:6px 10px"><span class="badge bg-teal" style="font-size:.7rem">${log.type}</span></td>
          <td style="padding:6px 10px;text-align:right;font-weight:600;color:var(--red)">-${log.days}</td>
          <td style="padding:6px 10px;text-align:right;color:#555">${bal}</td>
          <td style="padding:6px 10px;font-size:.72rem">${src}</td>
          <td style="padding:6px 10px;font-weight:600;color:var(--navy)">${by}</td>
          <td style="padding:6px 10px;color:#888;font-size:.72rem">${ts}</td>
          <td style="padding:6px 10px;color:#888">${log.notes||'—'}</td>
        </tr>`;
      }).join('') +
      '</tbody></table>';
  }

  om('empDetailModal');
}

// ══════════════════════════════════════════
// PAY PERIOD HISTORY
// ══════════════════════════════════════════
function showPeriodHistory() {
  const list = document.getElementById('periodHistoryList');
  const periods = Object.keys(IMPORTED_PERIODS);

  if (!periods.length) {
    list.innerHTML = '<div class="empty"><div class="ei">📭</div><p>No pay periods imported yet.</p></div>';
  } else {
    // Collect period details from employee records
    const periodDetails = {};
    for (const [key, emp] of Object.entries(EMPLOYEES)) {
      for (const rec of (emp.monthlyRecords||[])) {
        for (const pp of (rec.payPeriods||[])) {
          if (!periodDetails[pp.periodKey]) {
            periodDetails[pp.periodKey] = { start: pp.start, end: pp.end, empCount: 0, totalHours: 0 };
          }
          periodDetails[pp.periodKey].empCount++;
          periodDetails[pp.periodKey].totalHours += pp.hours;
        }
      }
    }

    list.innerHTML = Object.entries(periodDetails)
      .sort((a,b) => b[0].localeCompare(a[0]))
      .map(([key, pd]) => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border:1px solid var(--border);border-radius:8px;margin-bottom:8px">
          <div>
            <div style="font-weight:600;font-size:.88rem">${pd.start} → ${pd.end}</div>
            <div style="font-size:.78rem;color:var(--text-light);margin-top:2px">${pd.empCount} employees · ${pd.totalHours.toFixed(0)} total hours</div>
          </div>
          <button class="btn btn-red2 btn-sm" onclick="deletePeriod('${key}')">🗑 Delete</button>
        </div>`).join('');
  }

  om('periodHistoryModal');
}

function deletePeriod(periodKey) {
  if (!confirm('Delete this pay period? Hours will be removed from all employees and balances recalculated.')) return;

  // Remove from all employee monthly records
  for (const emp of Object.values(EMPLOYEES)) {
    for (const rec of (emp.monthlyRecords||[])) {
      const before = rec.hoursWorked;
      const pp = (rec.payPeriods||[]).find(p => p.periodKey === periodKey);
      if (pp) {
        rec.hoursWorked   -= pp.hours;
        rec.payPeriods     = rec.payPeriods.filter(p => p.periodKey !== periodKey);
      }
    }
    // Remove empty monthly records
    emp.monthlyRecords = (emp.monthlyRecords||[]).filter(r => r.hoursWorked > 0);
  }

  delete IMPORTED_PERIODS[periodKey];
  saveToStorage();
  recalculateAll();
  showPeriodHistory(); // refresh the modal
  showToast('🗑 Pay period deleted and balances recalculated.');
}

// ══════════════════════════════════════════
// EXPORT TO CSV
// ══════════════════════════════════════════
function exportAuditLog() {
  const rows = [['Employee','Action','Type','Days','Date','Balance Before','Source','By','Timestamp','Notes']];

  // Time-off log entries from all employees
  for (const [key, emp] of Object.entries(EMPLOYEES)) {
    for (const log of (emp.timeOffLog || [])) {
      rows.push([
        emp.name,
        'Time Off Used',
        log.type || '',
        log.days || '',
        log.date || '',
        log.balanceBefore != null ? log.balanceBefore : '—',
        log.source === 'request_approval' ? 'Request Approval' : log.source === 'manual_entry' ? 'Manual Entry' : '—',
        log.recordedBy || '—',
        log.recordedAt ? new Date(log.recordedAt).toLocaleString() : '—',
        log.notes || ''
      ]);
    }
  }

  // Time-off request decisions
  for (const req of TIME_OFF_REQUESTS) {
    if (req.status === 'approved' || req.status === 'rejected') {
      rows.push([
        req.empName || req.empKey,
        req.status === 'approved' ? 'Request Approved' : 'Request Rejected',
        req.type || '',
        req.days || '',
        req.start || '',
        '—',
        'Request Decision',
        req.reviewedBy || '—',
        req.reviewedAt ? new Date(req.reviewedAt).toLocaleString() : '—',
        req.notes || ''
      ]);
    }
  }

  rows.sort((a,b) => (a[8] || '').localeCompare(b[8] || ''));

  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `cfa_losfiltros_audit_log_${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}


function exportToCSV() {
  const rows = [['Name','Type','Status','First Clock-In','Tenure','Sick Earned','Sick Taken','Sick Balance','Vac Earned','Vac Taken','Vac Balance','Vac Eligible']];

  for (const [key, emp] of Object.entries(EMPLOYEES)) {
    const accruals = calcEmployeeAccruals(emp.monthlyRecords||[], emp.firstClockIn, emp.vacTaken||0, emp.sickTaken||0);
    rows.push([
      emp.name,
      emp.type||'hourly',
      emp.status||'active',
      emp.firstClockIn||'',
      getTenureString(emp.firstClockIn),
      accruals.sickEarned,
      emp.sickTaken||0,
      accruals.sickBal,
      accruals.vacationEarned,
      emp.vacTaken||0,
      accruals.vacationBal,
      accruals.vacationEligible ? 'Yes' : 'No'
    ]);
  }

  const csv = rows.map(r => r.map(v => `"${v}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = 'los_filtros_balances_' + new Date().toISOString().slice(0,10) + '.csv';
  a.click();
  URL.revokeObjectURL(url);
  showToast('✅ CSV exported!');
}

// ══════════════════════════════════════════
// PRINT-FRIENDLY VIEW
// ══════════════════════════════════════════
function exportToPrint() {
  const rows = Object.entries(EMPLOYEES).sort((a,b)=>a[1].name.localeCompare(b[1].name)).map(([key,emp]) => {
    const accruals = calcEmployeeAccruals(emp.monthlyRecords||[], emp.firstClockIn, emp.vacTaken||0, emp.sickTaken||0);
    return `<tr>
      <td>${emp.name}</td>
      <td>${emp.type||'hourly'}</td>
      <td>${emp.status||'active'}</td>
      <td>${getTenureString(emp.firstClockIn)}</td>
      <td>${accruals.sickEarned}</td><td>${emp.sickTaken||0}</td><td><strong>${accruals.sickBal}</strong></td>
      <td>${accruals.vacationEarned}</td><td>${emp.vacTaken||0}</td><td><strong>${accruals.vacationBal}</strong></td>
    </tr>`;
  }).join('');

  const win = window.open('','_blank');
  win.document.write(`<!DOCTYPE html><html><head><title>Los Filtros — Balance Report</title>
  <style>
    body{font-family:Arial,sans-serif;font-size:11px;margin:20px}
    h1{font-size:16px;margin-bottom:4px}
    p{color:#666;font-size:11px;margin-bottom:12px}
    table{width:100%;border-collapse:collapse}
    th{background:#004F71;color:#fff;padding:6px 8px;text-align:left;font-size:10px}
    td{padding:5px 8px;border-bottom:1px solid #eee}
    tr:nth-child(even) td{background:#f9f9f9}
    @media print{body{margin:10px}}
  </style></head><body>
  <h1>🐔 Chick-fil-A Los Filtros — Leave Balance Report</h1>
  <p>Generated: ${new Date().toLocaleString()} &nbsp;|&nbsp; ${Object.keys(EMPLOYEES).length} employees</p>
  <table>
    <thead><tr>
      <th>Name</th><th>Type</th><th>Status</th><th>Tenure</th>
      <th>Sick Earned</th><th>Sick Taken</th><th>Sick Bal</th>
      <th>Vac Earned</th><th>Vac Taken</th><th>Vac Bal</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <script>window.onload=()=>window.print()<\/script>
  
<!-- ADD TARDINESS MODAL -->
<div class="moverlay" id="addTardModal">
  <div class="modal" style="max-width:520px">
    <h3>Log Tardiness Incident</h3>
    <div id="tardErr" style="display:none;background:#fee2e2;color:#991b1b;border-radius:7px;padding:9px 12px;font-size:.82rem;margin-bottom:12px"></div>
    <div class="frow full"><div class="field"><label>Employee</label>
      <select id="tardEmpSel"><option value="">Select employee...</option></select>
    </div></div>
    <div class="frow"><div class="field"><label>Date</label>
      <input type="date" id="tardDate"/>
    </div><div class="field"><label>Type</label>
      <select id="tardType">
        <option>Late Arrival</option>
        <option>No-Show</option>
        <option>Early Departure</option>
      </select>
    </div></div>
    <div class="frow"><div class="field"><label>Scheduled Time</label>
      <input type="time" id="tardScheduled"/>
    </div><div class="field"><label>Actual Time</label>
      <input type="time" id="tardActual"/>
    </div></div>
    <div class="frow full"><div class="field"><label>Notes (optional)</label>
      <input type="text" id="tardNotes" placeholder="e.g. called out, traffic, no call no show..."/>
    </div></div>
    <div class="mfooter">
      <button class="btn" onclick="cm('addTardModal')">Cancel</button>
      <button class="btn btn-red2" onclick="submitTardiness()">Log Incident</button>
    </div>
  </div>
</div>

<!-- ADD MEAL PENALTY MODAL -->
<div class="moverlay" id="addMealModal">
  <div class="modal" style="max-width:560px">
    <h3>Log Meal Penalty Violation</h3>
    <div id="mealErr" style="display:none;background:#fee2e2;color:#991b1b;border-radius:7px;padding:9px 12px;font-size:.82rem;margin-bottom:12px"></div>
    <div id="mealViolationBanner" style="display:none;background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:10px 14px;margin-bottom:12px;font-size:.82rem;color:#92400e"></div>
    <div class="frow full"><div class="field"><label>Employee</label>
      <select id="mealEmpSel" onchange="autoFillMealRate(this.value)"><option value="">Select employee...</option></select>
    </div></div>
    <div class="frow"><div class="field"><label>Date</label>
      <input type="date" id="mealDate"/>
    </div><div class="field"><label>Hourly Rate ($)</label>
      <input type="number" id="mealRate" placeholder="e.g. 10.50" step="0.01" min="0"/>
    </div></div>
    <div class="frow"><div class="field"><label>Shift Start</label>
      <input type="time" id="mealShiftStart" oninput="checkMealViolation()"/>
    </div><div class="field"><label>Shift End</label>
      <input type="time" id="mealShiftEnd" oninput="checkMealViolation()"/>
    </div></div>
    <div class="frow"><div class="field"><label>Break Start (leave blank if no break)</label>
      <input type="time" id="mealBreakStart" oninput="checkMealViolation()"/>
    </div><div class="field"><label>Break End</label>
      <input type="time" id="mealBreakEnd" oninput="checkMealViolation()"/>
    </div></div>
    <div id="mealCalcResult" style="display:none;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px 14px;margin:10px 0;font-size:.83rem;color:#166534"></div>
    <div class="frow full"><div class="field"><label>Notes (optional)</label>
      <input type="text" id="mealNotes" placeholder="Additional context..."/>
    </div></div>
    <div class="mfooter">
      <button class="btn" onclick="cm('addMealModal')">Cancel</button>
      <button class="btn btn-red2" onclick="submitMealPenalty()">Log Violation</button>
    </div>
  </div>
</div>

<!-- SLACK + NOTIFICATIONS SETUP MODAL -->
<div class="moverlay" id="slackModal">
  <div class="modal" style="max-width:560px">
    <h3>🔔 Notifications & Slack Setup</h3>

    <!-- Slack section -->
    <div style="background:#f8f9fa;border-radius:10px;padding:16px;margin-bottom:16px">
      <div style="font-weight:700;font-size:.9rem;margin-bottom:4px">Slack Webhook</div>
      <p style="font-size:.8rem;color:var(--text-light);margin-bottom:10px">Paste your Slack Incoming Webhook URL to receive alerts when employees submit time-off requests.</p>
      <input type="url" id="slackWebhookUrl" placeholder="https://hooks.slack.com/services/..." style="width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;font-size:.85rem;margin-bottom:8px"/>
      <button class="btn btn-sm btn-navy" onclick="testSlackWebhook()" id="slackTestBtn">Send Test Message</button>
      <div id="slackTestResult" style="margin-top:8px;font-size:.8rem"></div>

      <!-- Setup instructions -->
      <details style="margin-top:12px">
        <summary style="cursor:pointer;font-size:.82rem;font-weight:600;color:var(--navy)">📖 How to get your webhook URL</summary>
        <ol style="font-size:.78rem;color:var(--text-mid);margin:8px 0 0 16px;line-height:2">
          <li>Go to <strong>slack.com</strong> → create a free workspace</li>
          <li>Create a channel, e.g. <strong>#time-off-requests</strong></li>
          <li>Go to <strong>api.slack.com/apps</strong> → Create New App → From Scratch</li>
          <li>Click <strong>Incoming Webhooks</strong> → toggle On</li>
          <li>Click <strong>Add New Webhook to Workspace</strong> → select your channel</li>
          <li>Copy the webhook URL and paste it above</li>
        </ol>
      </details>
    </div>

    <!-- Notification preferences -->
    <div style="font-weight:700;font-size:.9rem;margin-bottom:10px">Notify me when:</div>
    <div style="display:flex;flex-direction:column;gap:10px;margin-bottom:20px">
      <label style="display:flex;align-items:center;gap:10px;font-size:.87rem;cursor:pointer">
        <input type="checkbox" id="notifOnRequest" checked style="width:16px;height:16px;accent-color:var(--navy)"/>
        Employee submits a time-off request
      </label>
      <label style="display:flex;align-items:center;gap:10px;font-size:.87rem;cursor:pointer">
        <input type="checkbox" id="notifOnApprove" checked style="width:16px;height:16px;accent-color:var(--navy)"/>
        A request is approved or rejected
      </label>
      <label style="display:flex;align-items:center;gap:10px;font-size:.87rem;cursor:pointer">
        <input type="checkbox" id="notifOnTardiness" checked style="width:16px;height:16px;accent-color:var(--navy)"/>
        An employee is flagged for tardiness pattern (3+ in 30 days)
      </label>
    </div>

    <div class="mfooter">
      <button class="btn" onclick="cm('slackModal')">Cancel</button>
      <button class="btn btn-navy" onclick="saveSlackSettings()">Save Settings</button>
    </div>
  </div>
</div>

<!-- HOSTING GUIDE MODAL -->
<div class="moverlay" id="hostingModal">
  <div class="modal" style="max-width:560px;max-height:90vh;overflow-y:auto">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px">
      <h3 style="margin:0">🌐 Host This App Online</h3>
      <button class="btn btn-sm" onclick="cm('hostingModal')">✕ Close</button>
    </div>
    <p style="font-size:.85rem;color:var(--text-mid);margin-bottom:16px">Get this app accessible from any device — phone, tablet, computer — with a real URL. <strong>Free, no coding required.</strong></p>

    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:16px;margin-bottom:14px">
      <div style="font-weight:700;color:#1e40af;margin-bottom:8px">⭐ Recommended: Netlify (Free)</div>
      <ol style="font-size:.83rem;color:#1e40af;margin:0 0 0 16px;line-height:2.2">
        <li>Go to <strong>netlify.com</strong> → Sign up free (use Google)</li>
        <li>Click <strong>"Add new site"</strong> → <strong>"Deploy manually"</strong></li>
        <li>Drag and drop your <strong>admin_hub.html</strong> file into the box</li>
        <li>Netlify gives you a free URL like <strong>random-name.netlify.app</strong></li>
        <li>Share that link with your team — done!</li>
      </ol>
      <div style="margin-top:10px;font-size:.78rem;color:#3b82f6">💡 To get a custom domain (cfalosfiltros.com): buy it at Namecheap (~$12/yr) then connect it in Netlify Settings → Domain Management.</div>
    </div>

    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:14px;margin-bottom:14px">
      <div style="font-weight:700;color:#166534;margin-bottom:6px">📱 Add to Home Screen (Mobile App Feel)</div>
      <div style="font-size:.82rem;color:#166534;line-height:1.8">
        Once hosted on Netlify:<br>
        <strong>iPhone:</strong> Open in Safari → Share button → "Add to Home Screen"<br>
        <strong>Android:</strong> Open in Chrome → Menu (⋮) → "Add to Home Screen"<br>
        It will appear as an app icon on your phone — no App Store needed.
      </div>
    </div>

    <div style="background:#faf5ff;border:1px solid #e9d5ff;border-radius:10px;padding:14px">
      <div style="font-weight:700;color:#6b21a8;margin-bottom:6px">🔒 Important Note on Data</div>
      <div style="font-size:.82rem;color:#6b21a8;line-height:1.8">
        Your data is saved in the browser's local storage on each device. If multiple people need to see the same data, each device will need to import the same reports.<br><br>
        For true multi-user sync (everyone sees the same data), we'd need to add a backend database — that's the next step when you're ready.
      </div>
    </div>
  </div>
</div>

</body></html>`);
  win.document.close();
}

// ══════════════════════════════════════════
// DATA STORES
// ══════════════════════════════════════════
let TARDINESS_LOG  = [];
let MEAL_PENALTIES = [];
let SLACK_SETTINGS = { webhookUrl: '', notifOnRequest: true, notifOnApprove: true, notifOnTardiness: true };

// ══════════════════════════════════════════
// TARDINESS — submit, render, patterns
// ══════════════════════════════════════════
function submitTardiness() {
  const empKey    = document.getElementById('tardEmpSel').value;
  const date      = document.getElementById('tardDate').value;
  const type      = document.getElementById('tardType').value;
  const scheduled = document.getElementById('tardScheduled').value;
  const actual    = document.getElementById('tardActual').value;
  const notes     = document.getElementById('tardNotes').value;
  const errEl     = document.getElementById('tardErr');

  if (!empKey) { errEl.textContent='Please select an employee.'; errEl.style.display='block'; return; }
  if (!date)   { errEl.textContent='Please select a date.';      errEl.style.display='block'; return; }
  errEl.style.display = 'none';

  // Calculate minutes late
  let minutesLate = 0;
  if (type === 'Late Arrival' && scheduled && actual) {
    const [sh,sm] = scheduled.split(':').map(Number);
    const [ah,am] = actual.split(':').map(Number);
    minutesLate = Math.max(0, (ah * 60 + am) - (sh * 60 + sm));
  }

  const emp = EMPLOYEES[empKey];
  TARDINESS_LOG.push({
    id: Date.now(), empKey, empName: emp?.name || empKey,
    date, type, scheduled, actual, minutesLate, notes,
    loggedAt: new Date().toISOString()
  });

  saveTardinessData();
  renderTardiness();
  checkTardinessPatterns();
  cm('addTardModal');

  // Reset form
  ['tardEmpSel','tardDate','tardScheduled','tardActual','tardNotes'].forEach(id => {
    const el = document.getElementById(id); if(el) el.value = '';
  });

  showToast(`⏰ Incident logged for ${emp?.name || empKey}`);

  // Slack alert if flagged
  const count = getTardinessCount30Days(empKey);
  if (count >= 3 && SLACK_SETTINGS.notifOnTardiness) {
    sendSlackMessage(`⚠️ *Tardiness Alert* — ${emp?.name} has ${count} incidents in the last 30 days.`);
  }
}

function getTardinessCount30Days(empKey) {
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  return TARDINESS_LOG.filter(t => t.empKey === empKey && new Date(t.date).getTime() >= cutoff).length;
}

function renderTardiness() {
  const tbody      = document.getElementById('tardTbody');
  if (!tbody) return;
  const search     = (document.getElementById('tardSearch')?.value || '').toLowerCase();
  const typeFilter = document.getElementById('tardTypeFilter')?.value || '';
  const dayFilter  = parseInt(document.getElementById('tardMonthFilter')?.value || '0');
  const cutoff     = dayFilter ? Date.now() - dayFilter * 24 * 60 * 60 * 1000 : 0;

  const filtered = TARDINESS_LOG.filter(t => {
    if (typeFilter && t.type !== typeFilter) return false;
    if (cutoff && new Date(t.date).getTime() < cutoff) return false;
    if (search && !t.empName.toLowerCase().includes(search)) return false;
    return true;
  }).sort((a,b) => b.date.localeCompare(a.date));

  if (!filtered.length) {
    tbody.innerHTML = '<tr><td colspan="9"><div class="empty"><div class="ei">⏰</div><p>No incidents match.</p></div></td></tr>';
  } else {
    const now30 = Date.now() - 30*24*60*60*1000;
    tbody.innerHTML = filtered.map(t => {
      const count30 = TARDINESS_LOG.filter(x => x.empKey === t.empKey && new Date(x.date).getTime() >= now30).length;
      const flagged = count30 >= 3;
      return `<tr style="${flagged?'background:#fff3f3':''}">
        <td><strong>${t.empName}</strong></td>
        <td>${t.date}</td>
        <td><span class="badge ${t.type==='No-Show'?'bg-red':t.type==='Late Arrival'?'bg-yellow':'bg-gray'}">${t.type}</span></td>
        <td style="font-size:.8rem">${t.scheduled||'—'}</td>
        <td style="font-size:.8rem">${t.actual||'—'}</td>
        <td style="font-weight:600;color:${t.minutesLate>15?'var(--red)':t.minutesLate>0?'#d97706':'#888'}">${t.minutesLate>0?t.minutesLate+' min':'—'}</td>
        <td style="font-size:.78rem;color:#888">${t.notes||'—'}</td>
        <td><span style="font-size:.78rem;padding:3px 8px;border-radius:10px;background:${flagged?'#fee2e2':'#f0f0f0'};color:${flagged?'#dc2626':'#666'};font-weight:600">${count30}${flagged?' ⚠️':''}</span></td>
        <td><button class="btn btn-red2 btn-sm" onclick="deleteTardiness(${t.id})">✕</button></td>
      </tr>`;
    }).join('');
  }

  // Update stats
  const now = new Date(); const thisMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const monthItems = TARDINESS_LOG.filter(t => t.date.startsWith(thisMonth));
  document.getElementById('tardMonthCount').textContent = monthItems.length;
  document.getElementById('tardNoShowCount').textContent = monthItems.filter(t=>t.type==='No-Show').length;
  document.getElementById('tardTotalCount').textContent = TARDINESS_LOG.length;
  checkTardinessPatterns();
}

function checkTardinessPatterns() {
  const now30 = Date.now() - 30*24*60*60*1000;
  const empCounts = {};
  const dayPatterns = {};

  for (const t of TARDINESS_LOG) {
    if (new Date(t.date).getTime() < now30) continue;
    empCounts[t.empKey] = (empCounts[t.empKey] || { name: t.empName, count: 0, days: {} });
    empCounts[t.empKey].count++;
    const dow = new Date(t.date).toLocaleDateString('en-US',{weekday:'long'});
    empCounts[t.empKey].days[dow] = (empCounts[t.empKey].days[dow]||0) + 1;
  }

  const flagged = Object.values(empCounts).filter(e => e.count >= 3);
  document.getElementById('tardFlagCount').textContent = flagged.length;

  const panel = document.getElementById('tardFlagPanel');
  const list  = document.getElementById('tardFlagList');
  if (!flagged.length) { panel.style.display='none'; return; }

  panel.style.display = 'block';
  list.innerHTML = flagged.map(e => {
    const topDay = Object.entries(e.days).sort((a,b)=>b[1]-a[1])[0];
    const dayNote = topDay && topDay[1] >= 2 ? ` — often on <strong>${topDay[0]}</strong>` : '';
    return `<div style="margin-bottom:4px">• <strong>${e.name}</strong>: ${e.count} incidents in last 30 days${dayNote}</div>`;
  }).join('');
}

function deleteTardiness(id) {
  if (!confirm('Delete this incident?')) return;
  TARDINESS_LOG = TARDINESS_LOG.filter(t => t.id !== id);
  saveTardinessData();
  renderTardiness();
  showToast('🗑 Incident deleted.');
}

function exportTardinessCSV() {
  const rows = [['Employee','Date','Type','Scheduled','Actual','Minutes Late','Notes']];
  TARDINESS_LOG.forEach(t => rows.push([t.empName,t.date,t.type,t.scheduled||'',t.actual||'',t.minutesLate||0,t.notes||'']));
  const csv = rows.map(r=>r.map(v=>`"${v}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  a.download = 'tardiness_' + new Date().toISOString().slice(0,10) + '.csv';
  a.click();
}

// ══════════════════════════════════════════
// MEAL PENALTIES — PR Act 379 engine
// ══════════════════════════════════════════
function timeToMin(t) {
  if (!t) return null;
  const parts = t.split(':').map(Number);
  if (parts.length < 2 || parts.some(isNaN)) return null;
  return parts[0] * 60 + parts[1];
}

function autoFillMealRate(empKey) {
  if (!empKey) return;
  const emp = EMPLOYEES[empKey];
  if (emp?.hourlyRate) {
    const rateEl = document.getElementById('mealRate');
    if (rateEl && !rateEl.value) rateEl.value = emp.hourlyRate;
  }
}

function checkMealViolation() {
  const shiftStart  = document.getElementById('mealShiftStart').value;
  const shiftEnd    = document.getElementById('mealShiftEnd').value;
  const breakStart  = document.getElementById('mealBreakStart').value;
  const breakEnd    = document.getElementById('mealBreakEnd').value;
  const banner      = document.getElementById('mealViolationBanner');
  const calcResult  = document.getElementById('mealCalcResult');
  const rate        = parseFloat(document.getElementById('mealRate').value || 0);

  if (!shiftStart || !shiftEnd) { banner.style.display='none'; calcResult.style.display='none'; return; }

  const ssMin = timeToMin(shiftStart);
  const seMin = timeToMin(shiftEnd);
  const shiftHours = (seMin - ssMin) / 60;

  const violations = [];
  let penaltyMinutes = 0;

  // Rule: ≤6 hrs → no break required. >6 hrs → 30-min break must START before hour 6.
  if (shiftHours <= 6) {
    // No break required — compliant by rule
    banner.style.display = 'none';
    calcResult.innerHTML = `✅ Shift is ${shiftHours.toFixed(1)} hrs — no meal break required (≤ 6 hours).`;
    calcResult.style.display = 'block';
    return;
  }

  // Shift > 6 hours: break required
  if (!breakStart || !breakEnd) {
    // No break entered
    violations.push(`❌ No meal break recorded — shift is ${shiftHours.toFixed(1)} hrs. A 30-min break must start before hour 6.`);
    penaltyMinutes = 30;
  } else {
    const bsMin = timeToMin(breakStart);
    const beMin = timeToMin(breakEnd);
    const breakDuration = beMin - bsMin;
    const breakStartHour = (bsMin - ssMin) / 60;

    if (breakDuration < 30)
      violations.push(`❌ Break too short: ${breakDuration} min (minimum 30 min required)`);
    if (breakStartHour < 2)
      violations.push(`❌ Break too early: ${breakStartHour.toFixed(1)} hrs into shift (must start at or after hour 2)`);
    if (breakStartHour >= 6)
      violations.push(`❌ Break too late: ${breakStartHour.toFixed(1)} hrs into shift (must start before hour 6)`);

    // Penalty = 30 min (the required break period not properly taken)
    penaltyMinutes = 30;
  }

  if (violations.length) {
    banner.style.display = 'block';
    banner.innerHTML = '<strong>Violations detected:</strong><br>' + violations.join('<br>');
    const penalty = rate > 0 ? (rate * 1.5).toFixed(2) : '—';
    calcResult.style.display = 'block';
    calcResult.innerHTML = `<strong>Penalty calculation:</strong><br>
      Period: 1 hr × 1.5× rate${rate>0?' = <strong>$'+penalty+'</strong> owed':''}<br>
      <span style="font-size:.75rem;color:#888">(1.5× hourly rate for meal period worked per PR Act 379)</span>`;
  } else {
    banner.style.display = 'none';
    calcResult.style.display = 'block';
    calcResult.innerHTML = '✅ No violations detected for this shift.';
  }
}

function submitMealPenalty() {
  const empKey     = document.getElementById('mealEmpSel').value;
  const date       = document.getElementById('mealDate').value;
  const rate       = parseFloat(document.getElementById('mealRate').value || 0);
  const shiftStart = document.getElementById('mealShiftStart').value;
  const shiftEnd   = document.getElementById('mealShiftEnd').value;
  const breakStart = document.getElementById('mealBreakStart').value;
  const breakEnd   = document.getElementById('mealBreakEnd').value;
  const notes      = document.getElementById('mealNotes').value;
  const errEl      = document.getElementById('mealErr');

  if (!empKey) { errEl.textContent='Please select an employee.'; errEl.style.display='block'; return; }
  if (!date || !shiftStart || !shiftEnd) { errEl.textContent='Please fill in date and shift times.'; errEl.style.display='block'; return; }
  errEl.style.display = 'none';

  // Calculate violation details
  const ssMin = timeToMin(shiftStart), seMin = timeToMin(shiftEnd);
  const shiftHours = (seMin - ssMin) / 60;
  const bsMin = breakStart ? timeToMin(breakStart) : null;
  const beMin = breakEnd   ? timeToMin(breakEnd)   : null;
  const breakDuration = (bsMin !== null && beMin !== null) ? beMin - bsMin : 0;
  const breakStartHour = bsMin !== null ? (bsMin - ssMin)/60 : null;

  const violationTypes = [];
  if (!breakStart) violationTypes.push('No break taken');
  else {
    if (breakDuration < 30)                            violationTypes.push('Break too short');
    if (breakStartHour !== null && breakStartHour < 2) violationTypes.push('Break too early');
    if (breakStartHour !== null && breakStartHour >= 6) violationTypes.push('Break too late');
  }
  if (shiftHours > 10 && (!breakStart)) violationTypes.push('Second break required');

  const penaltyMinutes = 30;
  const penaltyAmount  = rate > 0 ? +(rate*1.5).toFixed(2) : 0;

  const emp = EMPLOYEES[empKey];
  MEAL_PENALTIES.push({
    id: Date.now(), empKey, empName: emp?.name || empKey,
    date, rate, shiftStart, shiftEnd, breakStart, breakEnd,
    shiftHours: +shiftHours.toFixed(2), breakDuration,
    violationTypes, penaltyAmount, notes,
    loggedAt: new Date().toISOString()
  });

  saveMealData();
  renderMealPenalties();
  cm('addMealModal');
  ['mealEmpSel','mealDate','mealRate','mealShiftStart','mealShiftEnd','mealBreakStart','mealBreakEnd','mealNotes'].forEach(id=>{
    const el=document.getElementById(id); if(el) el.value='';
  });
  document.getElementById('mealViolationBanner').style.display='none';
  document.getElementById('mealCalcResult').style.display='none';
  showToast(`🥪 Meal penalty logged for ${emp?.name || empKey}${penaltyAmount>0?' — $'+penaltyAmount+' owed':''}`);
}

function renderMealPenalties() {
  const tbody = document.getElementById('mealTbody');
  if (!tbody) return;

  if (!MEAL_PENALTIES.length) {
    tbody.innerHTML = '<tr><td colspan="11"><div class="empty"><div class="ei">🥪</div><p>No violations logged.</p></div></td></tr>';
  } else {
    tbody.innerHTML = [...MEAL_PENALTIES].sort((a,b)=>b.date.localeCompare(a.date)).map(p => `<tr>
      <td><strong>${p.empName}</strong></td>
      <td>${p.date}</td>
      <td style="font-size:.8rem">${p.shiftStart||'—'}</td>
      <td style="font-size:.8rem">${p.shiftEnd||'—'}</td>
      <td style="font-size:.8rem">${p.breakStart||'None'}</td>
      <td style="font-size:.8rem">${p.breakEnd||'—'}</td>
      <td style="font-size:.8rem;color:${p.breakDuration<30&&p.breakDuration>0?'var(--red)':'inherit'}">${p.breakDuration?p.breakDuration+' min':'—'}</td>
      <td style="font-size:.75rem">${p.violationTypes.map(v=>`<span class="badge bg-red" style="font-size:.65rem">${v}</span>`).join(' ')}</td>
      <td style="font-size:.8rem">${p.rate?'$'+p.rate:'—'}</td>
      <td style="font-size:.8rem;color:#b45309;font-weight:600">${p.penaltyAmount>0?'1 hr @ 1.5×':'—'}</td>
      <td style="font-weight:700;color:${p.penaltyAmount>0?'var(--red)':'#888'}">${p.penaltyAmount>0?'$'+p.penaltyAmount:'—'}</td>
      <td><button class="btn btn-red2 btn-sm" onclick="deleteMealPenalty(${p.id})">✕</button></td>
    </tr>`).join('');
  }

  // Add all-time totals footer row
  if (MEAL_PENALTIES.length) {
    const totalPenalty = MEAL_PENALTIES.reduce((s,p) => s + (p.penaltyAmount||0), 0);
    const totalRow = document.createElement('tr');
    totalRow.style.cssText = 'background:#fef2f2;font-weight:700;border-top:2px solid #fca5a5';
    totalRow.innerHTML = `
      <td colspan="8" style="text-align:right;padding:10px;font-size:.85rem;color:#991b1b">ALL-TIME TOTAL LIABILITY</td>
      <td style="padding:10px;font-size:.85rem;color:#991b1b">—</td>
      <td style="padding:10px;font-size:.85rem;color:#991b1b">—</td>
      <td style="padding:10px;font-size:1rem;color:#dc2626">$${totalPenalty.toFixed(2)}</td>
      <td></td>`;
    tbody.appendChild(totalRow);
  }

  // Update stats
  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const monthItems = MEAL_PENALTIES.filter(p => p.date.startsWith(thisMonth));
  document.getElementById('mealMonthCount').textContent = monthItems.length;
  if (document.getElementById('mealEmpCount')) document.getElementById('mealEmpCount').textContent = new Set(monthItems.map(p=>p.empKey)).size;
  document.getElementById('mealLiability').textContent  = '$'+monthItems.reduce((s,p)=>s+(p.penaltyAmount||0),0).toFixed(2);
  document.getElementById('mealTotalCount').textContent = MEAL_PENALTIES.length;
}

function deleteMealPenalty(id) {
  if (!confirm('Delete this penalty record?')) return;
  MEAL_PENALTIES = MEAL_PENALTIES.filter(p => p.id !== id);
  saveMealData();
  renderMealPenalties();
  showToast('🗑 Penalty record deleted.');
}

function clearAllMealPenalties() {
  if (!confirm('⚠️ This will delete ALL meal penalty records. Are you sure?')) return;
  MEAL_PENALTIES.length = 0;
  saveMealData();
  renderMealPenalties();
  showToast('🗑 All meal penalty records cleared.');
}

function exportMealsCSV() {
  const rows = [['Employee','Date','Shift Start','Shift End','Break Start','Break End','Break Duration (min)','Violations','Hourly Rate','Time Owed','Penalty Amount']];
  MEAL_PENALTIES.forEach(p => rows.push([p.empName,p.date,p.shiftStart,p.shiftEnd,p.breakStart||'',p.breakEnd||'',p.breakDuration,p.violationTypes.join('; '),'$'+(p.rate||0),p.penaltyAmount>0?'1 hr @ 1.5x':'—','$'+p.penaltyAmount]));
  const csv = rows.map(r=>r.map(v=>`"${v}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  a.download = 'meal_penalties_' + new Date().toISOString().slice(0,10) + '.csv';
  a.click();
}

// ══════════════════════════════════════════
// SLACK INTEGRATION
// ══════════════════════════════════════════
async function sendSlackMessage(text) {
  if (!SLACK_SETTINGS.webhookUrl) return;
  try {
    await fetch(SLACK_SETTINGS.webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
  } catch(e) { console.warn('Slack send failed:', e); }
}

async function testSlackWebhook() {
  const url    = document.getElementById('slackWebhookUrl').value.trim();
  const btn    = document.getElementById('slackTestBtn');
  const result = document.getElementById('slackTestResult');
  if (!url) { result.textContent = '❌ Please enter a webhook URL first.'; result.style.color='var(--red)'; return; }
  btn.textContent = 'Sending...'; btn.disabled = true;
  try {
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: '✅ *CFA Los Filtros Admin Hub* — Slack notifications are connected!' })
    });
    result.textContent = '✅ Test message sent! Check your Slack channel.';
    result.style.color = '#16a34a';
  } catch(e) {
    result.textContent = '❌ Failed — double-check your webhook URL. (CORS errors are normal; if Slack received it, you\'re good)';
    result.style.color = 'var(--red)';
  }
  btn.textContent = 'Send Test Message'; btn.disabled = false;
}

function saveSlackSettings() {
  SLACK_SETTINGS.webhookUrl        = document.getElementById('slackWebhookUrl').value.trim();
  SLACK_SETTINGS.notifOnRequest    = document.getElementById('notifOnRequest').checked;
  SLACK_SETTINGS.notifOnApprove    = document.getElementById('notifOnApprove').checked;
  SLACK_SETTINGS.notifOnTardiness  = document.getElementById('notifOnTardiness').checked;
  try { localStorage.setItem('cfa_losfiltros_slack', JSON.stringify(SLACK_SETTINGS)); } catch(e){}
  cm('slackModal');
  showToast('✅ Notification settings saved!');
}

function loadSlackSettings() {
  try {
    const s = localStorage.getItem('cfa_losfiltros_slack');
    if (s) Object.assign(SLACK_SETTINGS, JSON.parse(s));
    const urlEl = document.getElementById('slackWebhookUrl');
    if (urlEl && SLACK_SETTINGS.webhookUrl) urlEl.value = SLACK_SETTINGS.webhookUrl;
    ['notifOnRequest','notifOnApprove','notifOnTardiness'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.checked = SLACK_SETTINGS[id] !== false;
    });
  } catch(e){}
}

// ══════════════════════════════════════════
// PERSISTENCE — tardiness + meals + slack
// ══════════════════════════════════════════
function saveTardinessData() {
  try { localStorage.setItem('cfa_losfiltros_tardiness', JSON.stringify(TARDINESS_LOG)); } catch(e){}
}
function saveMealData() {
  try { localStorage.setItem('cfa_losfiltros_meals', JSON.stringify(MEAL_PENALTIES)); } catch(e){}
}

// Load on startup (append to existing loadFromStorage)
const _origLFS = loadFromStorage;
loadFromStorage = function() {
  _origLFS();
  try {
    const td = localStorage.getItem('cfa_losfiltros_tardiness');
    if (td) { TARDINESS_LOG.length=0; TARDINESS_LOG.push(...JSON.parse(td)); }
    const mp = localStorage.getItem('cfa_losfiltros_meals');
    if (mp) { MEAL_PENALTIES.length=0; MEAL_PENALTIES.push(...JSON.parse(mp)); }
    loadSlackSettings();
  } catch(e) { console.warn('Extended load failed:', e); }
};

// ══════════════════════════════════════════
// POPULATE employee dropdowns for new tabs
// ══════════════════════════════════════════
const _origPopulate = populateEmployeeDropdowns;
populateEmployeeDropdowns = function() {
  _origPopulate();
  const empList = Object.entries(EMPLOYEES)
    .filter(([k,e]) => e.status === 'active')
    .sort((a,b) => a[1].name.localeCompare(b[1].name));
  const opts = '<option value="">Select employee...</option>' +
    empList.map(([k,e]) => `<option value="${k}">${e.name}</option>`).join('');
  ['tardEmpSel','mealEmpSel'].forEach(id => {
    const el = document.getElementById(id); if(el) el.innerHTML = opts;
  });
};

// Render tardiness + meals on tab switch
const _origGoTab = goTab;
goTab = function(t) {
  _origGoTab(t);
  if (t === 'tardiness') { renderTardiness(); populateEmployeeDropdowns(); }
  if (t === 'meals')     { renderMealPenalties(); populateEmployeeDropdowns(); }
  if (t === 'recon')     { initReconciliationUI(); renderReconReport(); }
};




// ══════════════════════════════════════════════════════
// MEAL PREMIUM PDF PARSER — PR Act 379
// ══════════════════════════════════════════════════════

// ── Core parser ──────────────────────────────────────────
function parseMealViolations(lines, filename) {
  const PUNCH_RE = /^(\w+),\s+(\d{2}\/\d{2}\/\d{4})\s+(\d+:\d+\s*[ap])\s+(\d+:\d+\s*[ap])\s+(\d+:\d+)\s+(Regular|Break)/i;
  const EMP_TOTALS_RE = /^Employee Totals/i;

  // Reconstruct full-line strings from pdf.js tokens
  // pdf.js returns individual tokens; punch rows span multiple tokens.
  // We join consecutive tokens into candidate lines and test with regex.
  const candidates = buildCandidateLines(lines);

  // Group punches by employee
  const empMap = {}; // empName → { date → { shifts:[], breaks:[] } }
  let currentEmp = null;

  for (const line of candidates) {
    if (EMP_TOTALS_RE.test(line)) {
      currentEmp = null;
      continue;
    }

    const pm = PUNCH_RE.exec(line);
    if (pm) {
      const [, , date, timeIn, timeOut, , payType] = pm;
      if (!currentEmp) continue;

      if (!empMap[currentEmp]) empMap[currentEmp] = {};
      if (!empMap[currentEmp][date]) empMap[currentEmp][date] = { shifts:[], breaks:[] };

      const inMin  = parseTimeMin(timeIn);
      const outMin = parseTimeOut(timeOut, inMin);

      if (payType.toLowerCase() === 'regular') {
        empMap[currentEmp][date].shifts.push({ inMin, outMin });
      } else {
        empMap[currentEmp][date].breaks.push({ inMin, outMin });
      }
      continue;
    }

    // If it's not a punch line and not a total line, check if it's an employee name
    const possibleEmp = detectEmployeeName(line);
    if (possibleEmp) currentEmp = possibleEmp;
  }

  // Now evaluate violations
  const violations = [];
  for (const [empName, dates] of Object.entries(empMap)) {
    for (const [date, { shifts, breaks }] of Object.entries(dates)) {
      // Sort and merge consecutive shifts (same day, touching)
      shifts.sort((a,b) => a.inMin - b.inMin);
      const merged = mergeShifts(shifts);

      for (const shift of merged) {
        const shiftHrs = (shift.outMin - shift.inMin) / 60;
        if (shiftHrs <= 6) continue; // ≤6 hrs: no break required

        // Find breaks within this shift window (with 5 min buffer)
        const shiftBreaks = breaks.filter(b =>
          b.inMin >= shift.inMin - 5 &&
          b.outMin <= shift.outMin + 5
        );

        // Only qualifying breaks: ≥30 min
        const mealBreaks = shiftBreaks.filter(b => (b.outMin - b.inMin) >= 30);

        const viols = [];

        if (mealBreaks.length === 0) {
          // >6 hrs with no qualifying break = violation
          viols.push(`No meal break (shift ${shiftHrs.toFixed(1)} hrs — 30-min break required before hour 6)`);
        } else {
          // Break must START after hour 3 and before hour 6 of the shift
          for (const brk of mealBreaks) {
            const dur  = brk.outMin - brk.inMin;
            const hrIn = (brk.inMin - shift.inMin) / 60;
            if (dur < 30)   viols.push(`Break too short (${dur} min — minimum 30 min)`);
            if (hrIn <= 2)  viols.push(`Break too early (hr ${hrIn.toFixed(1)} — must start after hour 2)`);
            if (hrIn >= 6)  viols.push(`Break too late (hr ${hrIn.toFixed(1)} — must start before hour 6)`);
          }
        }

        if (viols.length > 0) {
          const firstBreak = mealBreaks[0];
          violations.push({
            id:             `${empName}|${date}|${shift.inMin}`,
            empName,
            empKey:         empName,
            date,
            shiftStart:     minToTimeStr(shift.inMin),
            shiftEnd:       minToTimeStr(shift.outMin),
            shiftHours:     +shiftHrs.toFixed(2),
            breakStart:     firstBreak ? minToTimeStr(firstBreak.inMin) : '',
            breakEnd:       firstBreak ? minToTimeStr(firstBreak.outMin) : '',
            breakDuration:  firstBreak ? (firstBreak.outMin - firstBreak.inMin) : 0,
            violationTypes: viols,
            rate:           0,
            penaltyAmount:  0,
            notes:          `Imported from ${filename}`,
            loggedAt:       new Date().toISOString()
          });
        }
      }
    }
  }

  return violations;
}

// ── Helper: build candidate lines from pdf.js token stream ─
function buildCandidateLines(tokens) {
  // pdf.js gives us tokens like: "Mon,", "02/16/2026", "7:31", "a", "3:04", "p", ...
  // We need to reassemble them. Strategy: sliding window join
  const lines = [];
  const joined = tokens.join(' ');
  // Split on employee totals and name patterns
  const rawLines = joined.split(/(?=Employee Totals|(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s+\d{2}\/\d{2}\/\d{4})/);
  for (const l of rawLines) {
    lines.push(l.trim());
  }
  // Also add individual tokens for name detection
  for (const t of tokens) {
    lines.push(t);
  }
  return lines;
}

// ── Helper: detect employee name lines ──────────────────────
function detectEmployeeName(line) {
  // Employee names look like: "Lastname Lastname, Firstname Middle" 
  // They contain a comma, no date pattern, no pay type keywords
  if (!line || line.length < 4) return null;
  if (/\d{2}\/\d{2}\/\d{4}/.test(line)) return null;
  if (/Regular|Break|Totals|Punch|clock|Page \d/i.test(line)) return null;
  if (/From |through |FSU|Los Filtros|Employee Time Detail/i.test(line)) return null;
  // Must contain a comma (Last, First format) or look like a proper name
  if (/^[A-ZÀ-Ü][a-zà-ü\s\-]+,\s+[A-ZÀ-Ü]/.test(line)) return line.trim();
  return null;
}

// ── Helper: merge overlapping/touching shifts ───────────────
function mergeShifts(shifts) {
  if (!shifts.length) return [];
  const merged = [{ ...shifts[0] }];
  for (let i = 1; i < shifts.length; i++) {
    const last = merged[merged.length - 1];
    // If shifts are within 30 min of each other, merge (split shifts)
    if (shifts[i].inMin <= last.outMin + 30) {
      last.outMin = Math.max(last.outMin, shifts[i].outMin);
    } else {
      merged.push({ ...shifts[i] });
    }
  }
  return merged;
}

// ── Helper: parse time string to minutes ───────────────────
function parseTimeMin(t) {
  const m = t.trim().match(/(\d+):(\d+)\s*([ap])/i);
  if (!m) return 0;
  let h = parseInt(m[1]), mi = parseInt(m[2]);
  const ampm = m[3].toLowerCase();
  if (ampm === 'p' && h !== 12) h += 12;
  if (ampm === 'a' && h === 12) h = 0;
  return h * 60 + mi;
}

// ── Helper: parse time out (handle overnight) ──────────────
function parseTimeOut(t, inMin) {
  let out = parseTimeMin(t);
  // If out < in, shift crosses midnight
  if (out < inMin) out += 24 * 60;
  return out;
}

// ── Helper: convert minutes to HH:MM ──────────────────────
function minToTimeStr(min) {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  const ampm = h >= 12 ? 'PM' : 'AM';
  const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${h12}:${String(m).padStart(2,'0')} ${ampm}`;
}


// ══════════════════════════════════════════════════════════
// MEAL PENALTY PDF PARSER — PR Act 379
// Parses CFA Employee Time Detail Report
// ══════════════════════════════════════════════════════════

async function handleMealPdfImport(file) {
  const status   = document.getElementById('mealImportStatus');
  const progress = document.getElementById('mealImportProgress');
  const dropzone = document.getElementById('mealDropzone');

  status.style.display  = 'block';
  progress.style.display = 'block';
  dropzone.style.borderColor = 'var(--navy)';
  status.innerHTML = '<span style="color:var(--navy)">⏳ Reading PDF...</span>';

  try {
    // Load pdf.js if not already loaded
    if (typeof pdfjsLib === 'undefined') {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
        s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
      });
      pdfjsLib.GlobalWorkerOptions.workerSrc =
        'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    }

    status.innerHTML = '<span style="color:var(--navy)">⏳ Extracting text from PDF...</span>';

    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

    let allLines = [];
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();

      // Group items by Y position (same line = same Y ± 3)
      const byY = {};
      for (const item of content.items) {
        const y = Math.round(item.transform[5] / 3) * 3;
        if (!byY[y]) byY[y] = [];
        byY[y].push({ x: item.transform[4], text: item.str });
      }
      // Sort lines top-to-bottom (higher Y = higher on page in PDF coords)
      const ys = Object.keys(byY).map(Number).sort((a, b) => b - a);
      for (const y of ys) {
        const lineItems = byY[y].sort((a, b) => a.x - b.x);
        const lineText = lineItems.map(i => i.text).join(' ').replace(/\s+/g, ' ').trim();
        if (lineText) allLines.push(lineText);
      }
    }

    status.innerHTML = '<span style="color:var(--navy)">⚙️ Analyzing shifts...</span>';

    const results = parseMealTimeDetail(allLines);
    progress.style.display = 'none';

    if (!results.violations.length && !results.compliant.length) {
      status.innerHTML = `<div style="background:#fef3c7;border:1px solid #fde68a;border-radius:8px;padding:12px;font-size:.83rem;color:#92400e">
        ⚠️ Could not parse any shifts from this file. Make sure it's an Employee Time Detail Report.
      </div>`;
      return;
    }

    // Add new violations to MEAL_PENALTIES (avoid duplicates by emp+date)
    let added = 0, skipped = 0;
    for (const v of results.violations) {
      const exists = MEAL_PENALTIES.some(p => p.empName === v.empName && p.date === v.date && p.shiftStart === v.shiftStart);
      if (!exists) {
        MEAL_PENALTIES.push(v);
        added++;
      } else { skipped++; }
    }

    saveMealData();
    renderMealPenalties();
    populateEmployeeDropdowns();

    const vCount = results.violations.length;
    const totalShifts = results.compliant.length + vCount;
    const pct = totalShifts > 0 ? Math.round((vCount/totalShifts)*100) : 0;

    status.innerHTML = `<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:14px;font-size:.83rem;color:#166534">
      <strong>✅ Import complete!</strong><br>
      Analyzed <strong>${totalShifts}</strong> shifts across <strong>${results.employees}</strong> employees<br>
      Found <strong style="color:${vCount>0?'#dc2626':'#16a34a'}">${vCount} violations</strong> (${pct}% of shifts)<br>
      ${added} added, ${skipped} already in log
      ${vCount > 0 ? '<br><br><strong>Violations breakdown:</strong><br>' + results.violationSummary.map(s=>`• ${s}`).join('<br>') : ''}
    </div>`;

    dropzone.style.borderColor = vCount > 0 ? 'var(--red)' : '#16a34a';
    document.getElementById('mealPdfFile').value = '';

    if (vCount > 0) showToast(`🥪 Found ${vCount} meal penalty violations!`);
    else showToast('✅ No meal penalty violations found.');

  } catch(e) {
    progress.style.display = 'none';
    console.error('Meal PDF parse error:', e);
    status.innerHTML = `<div style="background:#fee2e2;border:1px solid #fecaca;border-radius:8px;padding:12px;font-size:.83rem;color:#991b1b">
      ❌ Error reading PDF: ${e.message || e}<br>
      Make sure this is an Employee Time Detail Report PDF.
    </div>`;
  }
}

function parseMealTimeDetail(lines) {
  // ── helpers ──────────────────────────────────────────────
  const toMin = (t) => {
    if (!t) return null;
    const m = t.match(/(\d+):(\d+)\s*([ap])/i);
    if (!m) return null;
    let h = parseInt(m[1]), min = parseInt(m[2]);
    if (isNaN(h) || isNaN(min)) return null;
    const ap = m[3].toLowerCase();
    if (ap === 'p' && h !== 12) h += 12;
    else if (ap === 'a' && h === 12) h = 0;
    return h * 60 + min;
  };

  const fmtTime = (t) => {
    if (!t) return '—';
    const m = t.match(/(\d+):(\d+)\s*([ap])/i);
    return m ? `${m[1]}:${m[2]} ${m[3].toLowerCase()}` : t;
  };

  const fmtMin = (m) => {
    if (m === null) return '—';
    const h = Math.floor(m / 60) % 24, mins = m % 60;
    const ampm = h < 12 ? 'am' : 'pm';
    return `${h%12||12}:${String(mins).padStart(2,'0')}${ampm}`;
  };

  // ── state ────────────────────────────────────────────────
  let currentEmp = null;
  let currentWage = 0;
  let employees = new Set();
  const empWages = {};
  const shifts = [];

  // Date pattern: "Mon, 02/16/2026"
  const dateRe   = /^(Mon|Tue|Wed|Thu|Fri|Sat|Sun),\s+(\d{2}\/\d{2}\/\d{4})/i;
  // Time row pattern: captures TimeIn TimeOut Total Pay Type
  // "7:31 a 3:04 p 7:33 Regular" or "9:55 a 10:25 a 0:30 Break"
  const timeRe   = /(\d{1,2}:\d{2}\s*[ap])\s+(\d{1,2}:\d{2}\s*[ap])\s+[\d:]+\s+(Regular|Break|Break \(Conv to Paid\))/i;
  // Employee name: "Lastname Firstname" — line with no date, no time, typically has comma
  const empRe    = /^([A-Z][a-záéíóúñüA-ZÁÉÍÓÚÑÜ\s\-]+,\s+[A-Za-záéíóúñüÁÉÍÓÚÑÜ\s\.]+)$/;
  // Skip lines
  const skipRe   = /Employee Totals|Grand Total|Punch types|clock-in time|Page \d|From |Los Filtros|Employee Time Detail|Wage Rate|Pay Type/i;

  let currentDate = null;
  let currentShift = null;

  for (const line of lines) {
    if (skipRe.test(line)) continue;

    // Extract wage rate from Regular punch lines (first $ amount after "Regular")
    const wageLineMatch = line.match(/Regular\s+\$(\d+\.\d{2})/i);
    if (wageLineMatch && currentEmp) {
      const w = parseFloat(wageLineMatch[1]);
      if (w > 0) { currentWage = w; empWages[currentEmp] = w; }
    }

    // Check for date line
    const dateMatch = line.match(dateRe);
    if (dateMatch) {
      currentDate = dateMatch[2]; // "02/16/2026"
      // Try to extract time row from same line
      const timeMatch = line.match(timeRe);
      if (timeMatch && currentEmp) {
        const type = timeMatch[3].toLowerCase();
        if (type.startsWith('regular')) {
          const lineWage = wageLineMatch ? parseFloat(wageLineMatch[1]) : currentWage;
          if (lineWage > 0) { currentWage = lineWage; empWages[currentEmp] = lineWage; }
          currentShift = {
            empName: currentEmp, date: currentDate,
            shiftIn: fmtTime(timeMatch[1]), shiftOut: fmtTime(timeMatch[2]),
            breaks: [], wage: currentWage
          };
          shifts.push(currentShift);
        } else if (type.startsWith('break') && currentShift && currentShift.date === currentDate) {
          currentShift.breaks.push({ in: fmtTime(timeMatch[1]), out: fmtTime(timeMatch[2]) });
        }
      }
      continue;
    }

    // Check for time row (without date, continuation line)
    const timeMatch = line.match(timeRe);
    if (timeMatch && currentEmp && currentDate) {
      const type = timeMatch[3].toLowerCase();
      if (type.startsWith('regular')) {
        const lineWage = wageLineMatch ? parseFloat(wageLineMatch[1]) : currentWage;
        if (lineWage > 0) { currentWage = lineWage; empWages[currentEmp] = lineWage; }
        currentShift = {
          empName: currentEmp, date: currentDate,
          shiftIn: fmtTime(timeMatch[1]), shiftOut: fmtTime(timeMatch[2]),
          breaks: [], wage: currentWage
        };
        shifts.push(currentShift);
      } else if (type.startsWith('break') && currentShift && currentShift.date === currentDate) {
        currentShift.breaks.push({ in: fmtTime(timeMatch[1]), out: fmtTime(timeMatch[2]) });
      }
      continue;
    }

    // Check for employee name
    if (empRe.test(line.trim()) && !timeRe.test(line) && !dateRe.test(line)) {
      const candidate = line.trim();
      // Must look like "Lastname, Firstname" or "Last First, Middle"
      if (candidate.includes(',') && candidate.length > 5 && candidate.length < 60) {
        currentEmp = candidate;
        employees.add(candidate);
        currentDate = null;
        currentShift = null;
        currentWage = empWages[candidate] || 0;
      }
    }
  }

  // ── Apply PR Act 379 violation logic ─────────────────────
  const violations = [];
  const compliant  = [];
  const violTypeCounts = {};

  for (const s of shifts) {
    const ssMin = toMin(s.shiftIn);
    const seMin_raw = toMin(s.shiftOut);
    if (ssMin === null || seMin_raw === null || isNaN(ssMin) || isNaN(seMin_raw)) continue;

    let seMin = seMin_raw < ssMin ? seMin_raw + 24*60 : seMin_raw; // overnight
    const shiftHours = (seMin - ssMin) / 60;

    if (shiftHours <= 6) { compliant.push(s); continue; } // No meal period required (≤6 hrs)

    // Find qualifying breaks: duration >= 30min AND starts between hr3 and hr6
    let hasQualifyingBreak = false;
    let bestBreak = null;
    let violationDetails = [];

    const allBreaks = s.breaks.map(b => {
      const bi = toMin(b.in);
      const bo_raw = toMin(b.out);
      if (bi === null || bo_raw === null) return null;
      const bo = bo_raw < bi ? bo_raw + 24*60 : bo_raw;
      const dur = bo - bi;
      // Adjust break start relative to shift
      let biAdj = bi < ssMin ? bi + 24*60 : bi;
      const startHour = (biAdj - ssMin) / 60;
      return { in: b.in, out: b.out, dur, startHour };
    }).filter(Boolean);

    for (const br of allBreaks) {
      const inWindow = br.startHour >= 2 && br.startHour < 6;
      const longEnough = br.dur >= 30;
      if (inWindow && longEnough) { hasQualifyingBreak = true; bestBreak = br; break; }
    }

    if (!hasQualifyingBreak) {
      // Determine specific violation reason
      let reason = 'No break taken';
      let breakInfo = { in: '', out: '', dur: 0 };

      if (allBreaks.length > 0) {
        // Breaks exist but none qualify
        const issues = [];
        for (const br of allBreaks) {
          if (br.dur < 30) issues.push(`break too short (${br.dur}min)`);
          else if (br.startHour < 2) issues.push(`break too early (${br.startHour.toFixed(1)}h in — must start at or after hour 2)`);
          else if (br.startHour >= 6) issues.push(`break too late (${br.startHour.toFixed(1)}h in)`);
        }
        reason = issues.join('; ') || 'Break does not meet requirements';
        breakInfo = allBreaks[0];
      }

      violTypeCounts[reason.split('(')[0].trim()] = (violTypeCounts[reason.split('(')[0].trim()]||0) + 1;

      const _rate1 = s.wage || 0;
      const _penalty1 = _rate1 > 0 ? +(_rate1*1.5).toFixed(2) : 0;
      violations.push({
        id: Date.now() + Math.random(),
        empKey: s.empName.replace(/[^a-z0-9]/gi,'_').toLowerCase(),
        empName: s.empName,
        date: s.date,
        rate: _rate1,
        shiftStart: s.shiftIn,
        shiftEnd: s.shiftOut,
        breakStart: breakInfo.in || '',
        breakEnd:   breakInfo.out || '',
        shiftHours: +shiftHours.toFixed(2),
        breakDuration: breakInfo.dur || 0,
        violationTypes: [reason],
        penaltyAmount: _penalty1,
        notes: `Auto-detected from Time Detail Report`,
        loggedAt: new Date().toISOString()
      });
    } else {
      // Check if 2nd meal period needed (shift > 10h)
      if (shiftHours > 10) {
        const qualifyingBreaks = allBreaks.filter(br => br.startHour >= 3 && br.startHour < 6 && br.dur >= 30);
        if (qualifyingBreaks.length < 2) {
          const _rate2 = s.wage || 0;
          const _penalty2 = _rate2 > 0 ? +(_rate2*1.5).toFixed(2) : 0;
          violations.push({
            id: Date.now() + Math.random(),
            empKey: s.empName.replace(/[^a-z0-9]/gi,'_').toLowerCase(),
            empName: s.empName,
            date: s.date,
            rate: _rate2,
            shiftStart: s.shiftIn,
            shiftEnd: s.shiftOut,
            breakStart: bestBreak?.in || '',
            breakEnd:   bestBreak?.out || '',
            shiftHours: +shiftHours.toFixed(2),
            breakDuration: bestBreak?.dur || 0,
            violationTypes: [`Shift over 10h — 2nd meal period required`],
            penaltyAmount: _penalty2,
            notes: 'Auto-detected from Time Detail Report',
            loggedAt: new Date().toISOString()
          });
          continue;
        }
      }
      compliant.push(s);
    }
  }

  // Build violation type summary
  const violationSummary = Object.entries(violTypeCounts)
    .sort((a,b) => b[1]-a[1])
    .map(([t,c]) => `${t}: ${c}`);

  return {
    violations, compliant,
    employees: employees.size,
    violationSummary
  };
}


// ══════════════════════════════════════════════════════════════════
// WRITE-UPS MODULE — Sistema de Amonestaciones Disciplinarias
// ══════════════════════════════════════════════════════════════════

const WU = {
  currentEmpId: null,
  currentEmpName: null,
  currentRecords: [],

  LEVELS: {
    verbal:      'Amonestación Verbal',
    escrita:     'Amonestación Escrita',
    final:       'Amonestación Final Escrita',
    terminacion: 'Terminación'
  },

  FALTA_MAP: {
    verbal:      'Amonestación Escrita',
    escrita:     'Amonestación Final Escrita',
    final:       'Terminación',
    terminacion: 'N/A — Nivel máximo'
  },

  // ── Auto-suggest level based on history ──────────────────────
  suggestLevel(records) {
    if (!records || records.length === 0) return 'verbal';
    const sorted = [...records].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    const last = sorted[0].level;
    const progression = { verbal: 'escrita', escrita: 'final', final: 'terminacion', terminacion: 'terminacion' };
    return progression[last] || 'verbal';
  },

  // ── Supabase helpers ─────────────────────────────────────────
  async fetchEmployees(query) {
    try {
      const supa = getSupa();
      let q = supa.from('wu_employees').select('*').eq('terminated', false);
      if (query) q = q.ilike('name', `%${query}%`);
      const { data, error } = await q.order('name');
      if (error) throw error;
      return data || [];
    } catch (e) {
      // fallback to localStorage
      const all = JSON.parse(localStorage.getItem('wu_employees') || '[]');
      if (!query) return all.filter(e => !e.terminated);
      return all.filter(e => !e.terminated && e.name.toLowerCase().includes(query.toLowerCase()));
    }
  },

  async upsertEmployee(name) {
    try {
      const supa = getSupa();
      // Check if exists
      const { data: existing } = await supa.from('wu_employees').select('*').ilike('name', name).single();
      if (existing) return existing;
      const { data, error } = await supa.from('wu_employees').insert({ name, terminated: false }).select().single();
      if (error) throw error;
      return data;
    } catch (e) {
      // localStorage fallback
      const all = JSON.parse(localStorage.getItem('wu_employees') || '[]');
      let emp = all.find(x => x.name.toLowerCase() === name.toLowerCase());
      if (!emp) {
        emp = { id: 'local_' + Date.now(), name, terminated: false };
        all.push(emp);
        localStorage.setItem('wu_employees', JSON.stringify(all));
      }
      return emp;
    }
  },

  async fetchRecords(empId) {
    try {
      const supa = getSupa();
      const { data, error } = await supa.from('wu_records').select('*').eq('emp_id', empId).order('created_at', { ascending: false });
      if (error) throw error;
      return data || [];
    } catch (e) {
      const all = JSON.parse(localStorage.getItem('wu_records') || '[]');
      return all.filter(r => r.emp_id === empId).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    }
  },

  async saveRecord(record) {
    try {
      const supa = getSupa();
      const { data, error } = await supa.from('wu_records').insert(record).select().single();
      if (error) throw error;
      return data;
    } catch (e) {
      const all = JSON.parse(localStorage.getItem('wu_records') || '[]');
      const rec = { ...record, id: 'local_' + Date.now() };
      all.push(rec);
      localStorage.setItem('wu_records', JSON.stringify(all));
      return rec;
    }
  }
};

// ── Search employees ──────────────────────────────────────────────
async function wuSearchEmployees(query) {
  const resultsEl = document.getElementById('wuSearchResults');
  if (!query || query.trim().length < 2) {
    resultsEl.innerHTML = '';
    return;
  }
  resultsEl.innerHTML = '<div style="color:var(--text-mid);font-size:.85rem;padding:8px">Buscando...</div>';
  const emps = await WU.fetchEmployees(query.trim());

  // Build result list + "add new" option
  let html = '<div style="display:flex;flex-direction:column;gap:6px;margin-top:4px">';
  emps.forEach(emp => {
    html += `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;cursor:pointer" onclick="wuSelectEmployee('${emp.id}','${emp.name.replace(/'/g,"\\'")}')">
      <span style="font-weight:500;font-size:.9rem">${emp.name}</span>
      <span style="font-size:.78rem;color:var(--text-mid)">Ver historial →</span>
    </div>`;
  });

  // Offer to add as new if no exact match
  const exactMatch = emps.find(e => e.name.toLowerCase() === query.trim().toLowerCase());
  if (!exactMatch) {
    const safeName = query.trim().replace(/'/g, "\\'");
    html += `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:#eff6ff;border:1px dashed #3b82f6;border-radius:8px;cursor:pointer" onclick="wuAddAndSelect('${safeName}')">
      <span style="font-size:.9rem;color:#2563eb">+ Agregar <strong>${query.trim()}</strong> como nuevo empleado</span>
    </div>`;
  }

  html += '</div>';
  resultsEl.innerHTML = html;
}

async function wuAddAndSelect(name) {
  const emp = await WU.upsertEmployee(name);
  wuSelectEmployee(emp.id, emp.name);
}

async function wuSelectEmployee(empId, empName) {
  WU.currentEmpId = empId;
  WU.currentEmpName = empName;

  document.getElementById('wuSearchResults').innerHTML = '';
  document.getElementById('wuSearchInput').value = '';
  document.getElementById('wuFormPanel').style.display = 'none';
  document.getElementById('wuAIOutput').style.display = 'none';

  // Load records
  const records = await WU.fetchRecords(empId);
  WU.currentRecords = records;

  // Show history panel
  document.getElementById('wuEmpName').textContent = empName;
  renderWuHistory(records);
  document.getElementById('wuHistoryPanel').style.display = 'block';
}

function renderWuHistory(records) {
  const listEl = document.getElementById('wuHistoryList');
  const statusEl = document.getElementById('wuEmpStatus');

  if (!records || records.length === 0) {
    listEl.innerHTML = '<div style="color:var(--text-mid);padding:12px 0;font-style:italic">Sin amonestaciones previas.</div>';
    statusEl.innerHTML = '<span style="background:#dcfce7;color:#16a34a;padding:2px 10px;border-radius:20px;font-size:.78rem;font-weight:600">Sin historial disciplinario</span>';
    return;
  }

  const levelColors = {
    verbal:      { bg:'#fef9c3', color:'#854d0e', label:'Verbal' },
    escrita:     { bg:'#ffedd5', color:'#9a3412', label:'Escrita' },
    final:       { bg:'#fee2e2', color:'#991b1b', label:'Final Escrita' },
    terminacion: { bg:'#1e293b', color:'#f8fafc', label:'Terminación' }
  };

  const latest = records[0];
  const lc = levelColors[latest.level] || levelColors.verbal;
  statusEl.innerHTML = `<span style="background:${lc.bg};color:${lc.color};padding:2px 10px;border-radius:20px;font-size:.78rem;font-weight:600">Última acción: ${WU.LEVELS[latest.level] || latest.level}</span>`;

  let html = '<div style="display:flex;flex-direction:column;gap:8px">';
  records.forEach(r => {
    const lc2 = levelColors[r.level] || levelColors.verbal;
    const d = r.date ? new Date(r.date + 'T12:00:00').toLocaleDateString('es-PR', { year:'numeric', month:'short', day:'numeric' }) : '';
    html += `<div style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden">
      <div style="display:flex;align-items:center;gap:10px;padding:10px 14px;background:#f8fafc;border-bottom:1px solid #e2e8f0">
        <span style="background:${lc2.bg};color:${lc2.color};padding:2px 8px;border-radius:12px;font-size:.75rem;font-weight:700">${WU.LEVELS[r.level] || r.level}</span>
        <span style="font-size:.82rem;color:var(--text-mid)">${d}</span>
        <span style="font-size:.82rem;color:var(--text-mid);margin-left:auto">${r.category || ''}</span>
      </div>
      <div style="padding:10px 14px;font-size:.82rem;line-height:1.5;color:#374151">${r.incident ? r.incident.substring(0, 200) + (r.incident.length > 200 ? '…' : '') : ''}</div>
    </div>`;
  });
  html += '</div>';
  listEl.innerHTML = html;
}

function wuOpenNewForm() {
  if (!WU.currentEmpId) {
    alert('Por favor, busque y seleccione un empleado primero.');
    return;
  }
  // Auto-suggest level
  const suggested = WU.suggestLevel(WU.currentRecords);
  const levelSel = document.getElementById('wuLevel');
  levelSel.value = suggested;

  document.getElementById('wuFormEmpName').textContent = WU.currentEmpName;
  document.getElementById('wuDate').value = new Date().toISOString().split('T')[0];
  document.getElementById('wuCategory').value = '';
  document.getElementById('wuSupervisor').value = '';
  document.getElementById('wuShift').value = '';
  document.getElementById('wuRawDescription').value = '';
  document.getElementById('wuAIOutput').style.display = 'none';

  wuUpdateFaltaMejora();
  document.getElementById('wuFormPanel').style.display = 'block';
  document.getElementById('wuFormPanel').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function wuUpdateFaltaMejora() {
  const level = document.getElementById('wuLevel').value;
  document.getElementById('wuFaltaMejora').value = WU.FALTA_MAP[level] || '';
}

function wuCancelForm() {
  document.getElementById('wuFormPanel').style.display = 'none';
  document.getElementById('wuAIOutput').style.display = 'none';
}

function wuCloseHistory() {
  WU.currentEmpId = null;
  WU.currentEmpName = null;
  WU.currentRecords = [];
  document.getElementById('wuHistoryPanel').style.display = 'none';
  document.getElementById('wuFormPanel').style.display = 'none';
  document.getElementById('wuAIOutput').style.display = 'none';
}

// ── AI Generation ─────────────────────────────────────────────────
async function wuGenerateWithAI() {
  const level      = document.getElementById('wuLevel').value;
  const category   = document.getElementById('wuCategory').value;
  const supervisor = document.getElementById('wuSupervisor').value.trim();
  const date       = document.getElementById('wuDate').value;
  const shift      = document.getElementById('wuShift').value;
  const rawDesc    = document.getElementById('wuRawDescription').value.trim();

  if (!category)   { alert('Por favor seleccione una categoría de violación.'); return; }
  if (!supervisor) { alert('Por favor ingrese el nombre del supervisor.'); return; }
  if (!rawDesc)    { alert('Por favor describa el incidente.'); return; }

  const levelLabel = WU.LEVELS[level];
  const faltaLabel = WU.FALTA_MAP[level];
  const empName    = WU.currentEmpName;

  const prompt = `Eres un especialista en recursos humanos y derecho laboral en Puerto Rico. 
Redacta una amonestación disciplinaria formal en español legal y profesional para el siguiente caso:

Empleado: ${empName}
Nivel de acción: ${levelLabel}
Categoría: ${category}
Supervisor: ${supervisor}
Fecha: ${date}
Turno: ${shift}
Descripción informal del incidente: ${rawDesc}
Falta de mejora implica: ${faltaLabel}

Devuelve SOLAMENTE un objeto JSON válido sin backticks ni texto adicional, con exactamente estas tres claves:
{
  "incidente": "Redacción formal del incidente en 3-5 oraciones en español legal, en tercera persona, mencionando al empleado por nombre, la fecha, el turno, y la categoría de violación.",
  "correctiva": "Acción correctiva requerida al empleado en 2-3 oraciones formales, describiendo qué debe cambiar y en qué plazo.",
  "consecuencia": "Consecuencias en caso de no mejora en 1-2 oraciones, mencionando que la próxima acción sería ${faltaLabel}."
}`;

  const btn = document.getElementById('wuGenerateBtn');
  btn.textContent = '⏳ Generando...';
  btn.disabled = true;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    const data = await response.json();
    const text = data.content?.[0]?.text || '';

    let parsed;
    try {
      const clean = text.replace(/```json|```/g, '').trim();
      parsed = JSON.parse(clean);
    } catch (parseErr) {
      throw new Error('La IA no devolvió JSON válido. Intente de nuevo.');
    }

    document.getElementById('wuGenIncidente').value    = parsed.incidente    || '';
    document.getElementById('wuGenCorrectiva').value   = parsed.correctiva   || '';
    document.getElementById('wuGenConsecuencia').value = parsed.consecuencia || '';

    document.getElementById('wuAIOutput').style.display = 'block';
    document.getElementById('wuAIOutput').scrollIntoView({ behavior: 'smooth', block: 'start' });

  } catch (err) {
    alert('Error al generar con IA: ' + err.message);
    console.error(err);
  } finally {
    btn.textContent = '✨ Generar con IA';
    btn.disabled = false;
  }
}

// ── Save record ───────────────────────────────────────────────────
async function wuSaveRecord() {
  const record = {
    emp_id:      WU.currentEmpId,
    emp_name:    WU.currentEmpName,
    date:        document.getElementById('wuDate').value,
    level:       document.getElementById('wuLevel').value,
    category:    document.getElementById('wuCategory').value,
    supervisor:  document.getElementById('wuSupervisor').value.trim(),
    shift:       document.getElementById('wuShift').value,
    incident:    document.getElementById('wuGenIncidente').value,
    corrective:  document.getElementById('wuGenCorrectiva').value,
    consequence: document.getElementById('wuGenConsecuencia').value,
    created_at:  new Date().toISOString()
  };

  try {
    await WU.saveRecord(record);
    // Refresh history
    const records = await WU.fetchRecords(WU.currentEmpId);
    WU.currentRecords = records;
    renderWuHistory(records);
    document.getElementById('wuFormPanel').style.display = 'none';
    document.getElementById('wuAIOutput').style.display  = 'none';
    document.getElementById('wuHistoryPanel').scrollIntoView({ behavior: 'smooth' });
    alert('✅ Amonestación guardada exitosamente en el expediente de ' + WU.currentEmpName + '.');
  } catch (err) {
    alert('Error al guardar: ' + err.message);
    console.error(err);
  }
}

// ── Print ─────────────────────────────────────────────────────────
function wuPrintRecord() {
  const empName    = WU.currentEmpName;
  const level      = document.getElementById('wuLevel').value;
  const levelLabel = WU.LEVELS[level];
  const faltaLabel = WU.FALTA_MAP[level];
  const category   = document.getElementById('wuCategory').value;
  const supervisor = document.getElementById('wuSupervisor').value.trim();
  const date       = document.getElementById('wuDate').value;
  const shift      = document.getElementById('wuShift').value;
  const incidente  = document.getElementById('wuGenIncidente').value;
  const correctiva = document.getElementById('wuGenCorrectiva').value;
  const consecuencia = document.getElementById('wuGenConsecuencia').value;

  const dateFormatted = date
    ? new Date(date + 'T12:00:00').toLocaleDateString('es-PR', { year:'numeric', month:'long', day:'numeric' })
    : '';

  const printHtml = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8"/>
  <title>Amonestación — ${empName}</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap');
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'DM Sans', Arial, sans-serif; color: #1e293b; background: #fff; padding: 40px; }
    .header { text-align: center; border-bottom: 3px solid #1e3a5f; padding-bottom: 20px; margin-bottom: 28px; }
    .header h1 { font-size: 1.4rem; color: #1e3a5f; margin-bottom: 4px; }
    .header p { font-size: .85rem; color: #64748b; }
    .level-badge { display:inline-block;background:#1e3a5f;color:#fff;padding:6px 18px;border-radius:4px;font-size:.9rem;font-weight:700;margin:10px 0; }
    .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 24px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius:8px; padding: 16px; margin-bottom: 24px; }
    .meta-item label { font-size: .72rem; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: .06em; display:block; margin-bottom:2px; }
    .meta-item span { font-size: .9rem; font-weight: 500; }
    .section { margin-bottom: 20px; }
    .section h2 { font-size: .78rem; font-weight: 700; color: #64748b; text-transform: uppercase; letter-spacing: .07em; border-bottom: 1px solid #e2e8f0; padding-bottom: 6px; margin-bottom: 10px; }
    .section p { font-size: .9rem; line-height: 1.7; color: #1e293b; }
    .sig-block { display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:48px;padding-top:24px;border-top:1px solid #e2e8f0; }
    .sig-line { border-bottom: 1px solid #94a3b8; margin-bottom:6px; height:32px; }
    .sig-label { font-size: .78rem; color: #64748b; }
    @media print { body { padding: 24px; } }
  </style>
</head>
<body>
  <div class="header">
    <h1>LOS FILTROS FSU — DOCUMENTO DE ACCIÓN DISCIPLINARIA</h1>
    <p>Expediente Confidencial de Recursos Humanos</p>
    <div class="level-badge">${levelLabel}</div>
  </div>

  <div class="meta-grid">
    <div class="meta-item"><label>Nombre del Empleado</label><span>${empName}</span></div>
    <div class="meta-item"><label>Categoría de Violación</label><span>${category}</span></div>
    <div class="meta-item"><label>Fecha del Incidente</label><span>${dateFormatted}</span></div>
    <div class="meta-item"><label>Turno</label><span>${shift}</span></div>
    <div class="meta-item"><label>Supervisor</label><span>${supervisor}</span></div>
    <div class="meta-item"><label>Nivel Siguiente (Falta de Mejora)</label><span>${faltaLabel}</span></div>
  </div>

  <div class="section">
    <h2>Descripción del Incidente</h2>
    <p>${incidente.replace(/\n/g, '<br/>')}</p>
  </div>

  <div class="section">
    <h2>Acción Correctiva Requerida</h2>
    <p>${correctiva.replace(/\n/g, '<br/>')}</p>
  </div>

  <div class="section">
    <h2>Consecuencias en Caso de No Mejora</h2>
    <p>${consecuencia.replace(/\n/g, '<br/>')}</p>
  </div>

  <div class="sig-block">
    <div>
      <div class="sig-line"></div>
      <div class="sig-label">Firma del Empleado / Fecha</div>
    </div>
    <div>
      <div class="sig-line"></div>
      <div class="sig-label">Firma del Supervisor / Fecha</div>
    </div>
    <div>
      <div class="sig-line"></div>
      <div class="sig-label">Firma de Recursos Humanos / Fecha</div>
    </div>
    <div style="padding-top:8px;font-size:.78rem;color:#64748b;line-height:1.5">
      Al firmar este documento, el empleado reconoce haberlo recibido y leído. La firma no implica necesariamente acuerdo con el contenido.
    </div>
  </div>
</body>
</html>`;

  const win = window.open('', '_blank');
  win.document.write(printHtml);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 600);
}

// ── Hook goTab for write-ups ──────────────────────────────────────
const _wuOrigGoTab = goTab;
goTab = function(t) {
  _wuOrigGoTab(t);
  // Nothing special needed on tab activation for write-ups
};

