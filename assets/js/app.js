

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
  goTab('dashboard');
}

async function signOut() {
  await getSupa().auth.signOut();
  currentUser = null;
  clearInterval(window._autoSaveInterval);
  document.getElementById('loginPage').style.display = 'flex';
  document.getElementById('appShell').style.display = 'none';
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
  if (t === 'gastos')    gastosInit();
  if (t === 'eom')       eomInit();
  if (t === 'meals')     { renderMealPenalties(); populateEmployeeDropdowns(); }
  if (t === 'recon')     { initReconciliationUI(); renderReconReport(); }
  if (t === 'writeups')  { wuRefreshEmpList(); wuLoadPendingQueue(); }
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
// Law: Act No. 180-1998 as amended by Act 4-2017 (LTFA)
// Note: Act 41-2022 was declared null and void by federal
//       court on March 3, 2023 — Act 4-2017 rules apply.
//
// VACATION (requires ≥130 hrs/month to qualify):
//   Year 0 – <1 yr  : 0.50 days/month  (½ day)
//   Year 1 – <5 yrs : 0.75 days/month  (¾ day)
//   Year 5 – <15 yrs: 1.00 day/month
//   Year 15+        : 1.25 days/month
//   ⚠ Cannot be USED until employee completes 1 full year.
//
// SICK (requires ≥130 hrs/month to qualify):
//   ALL years       : 1.00 day/month  (flat, no tier)
//   Max carryover   : 15 days
// ══════════════════════════════════════════

/**
 * Returns the vacation accrual rate (days/month) for a given
 * number of completed years of service per PR Act 180 / Act 4-2017.
 */
function getVacationRateForYears(completedYears) {
  if (completedYears >= 15) return 1.25;
  if (completedYears >= 5)  return 1.00;
  if (completedYears >= 1)  return 0.75;
  return 0.50; // first year of service
}

/**
 * Calculates the accrual earned in a single calendar month.
 *
 * @param {number} hoursWorked  - Total hours worked that month
 * @param {number} completedYears - Full years of service at the time of accrual
 * @returns {{ vacationEarned: number, sickEarned: number, tier: string, qualified: boolean }}
 */
function calcMonthlyAccrual(hoursWorked, completedYears) {
  const HOURS_THRESHOLD = 130; // Act 4-2017 requirement
  const qualified = hoursWorked >= HOURS_THRESHOLD;

  if (!qualified) {
    return { vacationEarned: 0, sickEarned: 0, tier: 'none', qualified: false };
  }

  const vacRate = getVacationRateForYears(completedYears);
  // Sick leave is always 1.00 day/month flat (no seniority tier)
  const sickRate = 1.00;

  // Determine label for UI display
  let tier = 'full';
  if (completedYears < 1)  tier = 'year1';
  else if (completedYears < 5)  tier = 'year1to5';
  else if (completedYears < 15) tier = 'year5to15';
  else tier = 'year15plus';

  return {
    vacationEarned: +vacRate.toFixed(4),
    sickEarned:     +sickRate.toFixed(4),
    tier,
    qualified: true
  };
}

/**
 * Calculates total accrued vacation and sick balances for an employee
 * across their full monthly history.
 *
 * @param {Array}  monthlyRecords - Array of { year, month, hoursWorked }
 * @param {string} firstClockIn   - ISO date string of first day of work
 * @param {number} vacTaken       - Total vacation days already taken
 * @param {number} sickTaken      - Total sick days already taken
 * @returns {{ vacationEarned, vacationBal, sickEarned, sickBal, vacationEligible }}
 */
function calcEmployeeAccruals(monthlyRecords, firstClockIn, vacTaken, sickTaken) {
  const startDate = firstClockIn ? new Date(firstClockIn) : null;

  let totalVacEarned  = 0;
  let totalSickEarned = 0;

  for (const rec of (monthlyRecords || [])) {
    // Compute how many full years of service the employee had
    // at the START of this month (conservative, employee-favorable rounding)
    let completedYears = 0;
    if (startDate) {
      const monthStart = new Date(rec.year, rec.month - 1, 1);
      const msPerYear  = 1000 * 60 * 60 * 24 * 365.25;
      completedYears   = Math.floor((monthStart - startDate) / msPerYear);
      if (completedYears < 0) completedYears = 0;
    }

    const acr = calcMonthlyAccrual(rec.hoursWorked, completedYears);
    totalVacEarned  += acr.vacationEarned;
    totalSickEarned += acr.sickEarned;
  }

  // Sick leave carryover cap: 15 days (Act 180 §250d(l))
  const SICK_CAP = 15;
  totalSickEarned = Math.min(totalSickEarned, SICK_CAP + (sickTaken || 0));

  const vacBal  = +(totalVacEarned  - (vacTaken  || 0)).toFixed(2);
  const sickBal = +(totalSickEarned - (sickTaken || 0)).toFixed(2);

  // Vacation cannot be USED until 1 full year of service (Act 180 §250d(f))
  let vacationEligible = false;
  if (startDate) {
    const msPerYear  = 1000 * 60 * 60 * 24 * 365.25;
    vacationEligible = (Date.now() - startDate.getTime()) >= msPerYear;
  }

  return {
    vacationEarned:   +totalVacEarned.toFixed(2),
    vacationBal:      Math.max(0, vacBal),
    sickEarned:       +totalSickEarned.toFixed(2),
    sickBal:          Math.max(0, sickBal),
    vacationEligible
  };
}

/**
 * Refreshes all employee accrual displays and UI counts.
 * Call after any data change (import, time-off entry, status change).
 */
function recalculateAll() {
  for (const key of Object.keys(EMPLOYEES)) {
    const emp = EMPLOYEES[key];
    // Ensure required fields exist
    if (!emp.monthlyRecords) emp.monthlyRecords = [];
    if (emp.vacTaken  == null) emp.vacTaken  = 0;
    if (emp.sickTaken == null) emp.sickTaken = 0;
  }
  // Refresh all dependent UI
  updateEmployeesTab();
  updateDashboard();
}

function updateDashboard() {
  const tbody = document.getElementById('dashTbody');
  if (!tbody) return;
  const emps = Object.entries(EMPLOYEES).sort((a,b) => a[1].name.localeCompare(b[1].name));
  if (!emps.length) {
    tbody.innerHTML = '<tr><td colspan="10"><div class="empty"><div class="ei">📋</div><p>No data yet. Import data to get started.</p></div></td></tr>';
    return;
  }
  tbody.innerHTML = emps.map(([key, emp]) => {
    const accruals = calcEmployeeAccruals(emp.monthlyRecords || [], emp.firstClockIn, emp.vacTaken || 0, emp.sickTaken || 0);
    const tenure   = getTenureString(emp.firstClockIn);
    const sickBal  = accruals.sickBal;
    const vacBal   = accruals.vacationBal;
    const vacFlag  = !accruals.vacationEligible ? ' ⚠' : '';
    return `<tr>
      <td><a href="#" style="color:var(--navy);font-weight:600;text-decoration:none" onclick="goTab('employees');return false">${emp.name}</a></td>
      <td><span class="badge bg-teal">${emp.type || 'hourly'}</span></td>
      <td><span class="badge ${emp.status === 'active' ? 'bg-green' : 'bg-gray'}">${emp.status || 'active'}</span></td>
      <td style="font-size:.8rem">${tenure}</td>
      <td style="text-align:right">${daysToHrs(accruals.sickEarned)}</td>
      <td style="text-align:right">${daysToHrs(emp.sickTaken || 0)}</td>
      <td style="text-align:right;font-weight:700;color:${sickBal <= 0 ? 'var(--red)' : '#0f766e'}">${daysToHrs(sickBal)}</td>
      <td style="text-align:right">${daysToHrs(accruals.vacationEarned)}</td>
      <td style="text-align:right">${daysToHrs(emp.vacTaken || 0)}</td>
      <td style="text-align:right;font-weight:700;color:${vacBal <= 0 ? 'var(--red)' : 'var(--navy)'}">${daysToHrs(vacBal)}${vacFlag}</td>
    </tr>`;
  }).join('');
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

/** Parse the Time Summary PDF using pdf.js (loaded from CDN).
 *  Calibrated against real CFA Time Summary Report layout (Apr 2026).
 *
 *  Confirmed column x-positions (pdfplumber):
 *    Employee Name : x <  145
 *    Total Time    : x ~  157–165   (< 180)
 *    Regular Hours : x ~  291–295   (180–340)
 *    OT Hours      : x ~  417–421   (340–450)
 *    Dollar cols   : x > 340 and contain '$' — skipped
 */
async function parseTimeSummaryPDF(file) {
  const pdfjsLib = window['pdfjs-dist/build/pdf'];
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  let allWords = [];
  let headerText = '';

  for (let p = 1; p <= pdf.numPages; p++) {
    const page  = await pdf.getPage(p);
    const content  = await page.getTextContent();
    const viewport = page.getViewport({ scale: 1 });

    for (const item of content.items) {
      const t = item.str.trim();
      if (!t) continue;
      const x = item.transform[4];
      const y = viewport.height - item.transform[5];
      if (p === 1) headerText += t + ' ';
      allWords.push({ text: t, x, y, page: p });
    }
  }

  // ── Date range ──────────────────────────────────────────────────────────
  // Header looks like: "From Sunday, Mar 01, 2026 through Tuesday, Mar 31, 2026"
  // Words come in separately so we reconstruct from the header string.
  const MONTHS = { Jan:1,Feb:2,Mar:3,Apr:4,May:5,Jun:6,
                   Jul:7,Aug:8,Sep:9,Oct:10,Nov:11,Dec:12 };
  let periodStart = null, periodEnd = null, year = null, month = null;

  // Match "Mar 01, 2026" style tokens anywhere in the header
  const dateRangeMatch = headerText.match(
    /From\s+\w+,\s+(\w+)\s+(\d+),\s+(\d+)\s+through\s+\w+,\s+(\w+)\s+(\d+),\s+(\d+)/
  );
  if (dateRangeMatch) {
    const [, sm, sd, sy, em, ed, ey] = dateRangeMatch;
    periodStart = new Date(+sy, (MONTHS[sm] || 1) - 1, +sd);
    periodEnd   = new Date(+ey, (MONTHS[em] || 1) - 1, +ed);
    year  = periodStart.getFullYear();
    month = periodStart.getMonth() + 1;
  }

  // ── Group words into rows by y-coordinate (±2px tolerance) ─────────────
  const rowMap = {};
  for (const w of allWords) {
    const key = Math.round(w.y / 2) * 2;
    if (!rowMap[key]) rowMap[key] = [];
    rowMap[key].push(w);
  }

  const SKIP = new Set([
    'Employee','Name','Total','Time','Wage','Rate','Regular','Hours','Wages',
    'Overtime','Grand','All',"Employees'","Employees'",'Page','of',
    'FSU','Filtros','Los','Summary','Report','From','through',
    'Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday',
    'AM','PM'
  ]);

  const employees = [];
  const timeRe   = /^\d+:\d{2}$/;   // matches "156:54", "0:31", etc.
  const dollarRe = /^\$/;            // skip all dollar-amount cells

  for (const words of Object.values(rowMap)) {
    const sorted = words.sort((a, b) => a.x - b.x);
    let nameParts = [], totalTime = null, regHours = null, otHours = null;

    for (const w of sorted) {
      const t = w.text;

      // Skip header words, timestamps (HH:MM:SS), dollar amounts, page numbers
      if (SKIP.has(t) || dollarRe.test(t)) continue;
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(t)) continue;  // date stamps
      if (/^\d{1,2}:\d{2}:\d{2}$/.test(t)) continue;  // time-of-day stamps
      if (/^\d+$/.test(t)) continue;                   // bare page numbers

      if (timeRe.test(t)) {
        // Assign to column by x position (calibrated from real report):
        //   Total Time   x < 180
        //   Reg Hours    180 ≤ x < 340
        //   OT Hours     340 ≤ x < 450
        if      (w.x < 180) totalTime = t;
        else if (w.x < 340) regHours  = t;
        else if (w.x < 450) otHours   = t;
      } else if (w.x < 145) {
        // Employee name tokens are always left-aligned (x < 145)
        nameParts.push(t);
      }
    }

    if (nameParts.length && totalTime && regHours) {
      const name = nameParts.join(' ').trim();
      if (/grand|employees/i.test(name)) continue;  // skip grand total row
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

// Track imported months to avoid double-counting
// key: "YYYY-MM" → { start, end, empCount, totalHours }
let IMPORTED_PERIODS = {};
let TIME_OFF_REQUESTS = [];  // pending/approved/rejected requests

async function handleImport(file) {
  const statusEl   = document.getElementById('importStatus');
  const progressEl = document.getElementById('importProgress');

  statusEl.style.display   = 'block';
  statusEl.innerHTML       = '<span style="color:var(--navy)">⏳ Parsing PDF...</span>';
  progressEl.style.display = 'block';

  try {
    const result = await parseTimeSummaryPDF(file);

    if (!result.employees.length) {
      statusEl.innerHTML = '<span style="color:var(--red)">❌ No employees found. Is this a Time Summary Report?</span>';
      progressEl.style.display = 'none';
      return;
    }

    // Monthly key — one upload per calendar month
    const y = result.year, m = result.month;
    const monthKey  = `${y}-${String(m).padStart(2,'0')}`;
    const monthName = new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

    // If this month already exists, ask director whether to overwrite
    if (IMPORTED_PERIODS[monthKey]) {
      const overwrite = confirm(
        `⚠️ ${monthName} has already been imported.\n\n` +
        `Do you want to overwrite it with this new report?\n\n` +
        `OK = replace existing data   |   Cancel = keep current data`
      );
      if (!overwrite) {
        statusEl.innerHTML = `<span style="color:#d97706">⚠ Import cancelled — existing ${monthName} data kept.</span>`;
        progressEl.style.display = 'none';
        return;
      }
      // Wipe the old monthly record from every employee before re-importing
      for (const emp of Object.values(EMPLOYEES)) {
        emp.monthlyRecords = (emp.monthlyRecords || []).filter(r => !(r.year === y && r.month === m));
      }
    }

    let newCount = 0, updatedCount = 0, totalHours = 0;

    for (const emp of result.employees) {
      const key = emp.name.toLowerCase().replace(/\s+/g, '_');

      if (!EMPLOYEES[key]) {
        EMPLOYEES[key] = {
          name:         emp.name,
          type:         'hourly',
          status:       'active',
          firstClockIn: result.periodStart?.toISOString().slice(0, 10) || null,
          vacTaken:     0,
          sickTaken:    0,
          monthlyRecords: [],
          timeOffLog:   []
        };
        newCount++;
      } else {
        updatedCount++;
      }

      // One clean record per month — no accumulation needed
      EMPLOYEES[key].monthlyRecords.push({
        year:        y,
        month:       m,
        hoursWorked: emp.totalHours,
        reportStart: result.periodStart?.toISOString().slice(0, 10),
        reportEnd:   result.periodEnd?.toISOString().slice(0, 10)
      });

      totalHours += emp.totalHours;
    }

    // Register month as imported
    IMPORTED_PERIODS[monthKey] = {
      monthKey,
      start:      result.periodStart?.toISOString().slice(0, 10),
      end:        result.periodEnd?.toISOString().slice(0, 10),
      empCount:   result.employees.length,
      totalHours: +totalHours.toFixed(1)
    };

    // Dashboard counts
    document.getElementById('sActive').textContent   = Object.values(EMPLOYEES).filter(e => e.status === 'active').length;
    document.getElementById('sInactive').textContent = Object.values(EMPLOYEES).filter(e => e.status !== 'active').length;

    // Data range display
    const allMonths = Object.keys(IMPORTED_PERIODS).sort();
    if (allMonths.length) {
      const first = IMPORTED_PERIODS[allMonths[0]];
      const last  = IMPORTED_PERIODS[allMonths[allMonths.length - 1]];
      const srEl  = document.getElementById('sRange');
      if (srEl) srEl.textContent = (first.start || allMonths[0]) + ' → ' + (last.end || allMonths[allMonths.length - 1]);
    }

    recalculateAll();
    populateEmployeeDropdowns();
    saveToStorage();

    statusEl.innerHTML = `
      <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:14px 16px">
        <div style="font-weight:700;color:#166534;margin-bottom:6px">✅ Import Successful!</div>
        <div style="font-size:.83rem;color:#166534">
          Month: <strong>${monthName}</strong><br>
          ${result.employees.length} employees processed (${newCount} new, ${updatedCount} updated)<br>
          Accruals recalculated per PR Act 180.
        </div>
      </div>`;
    progressEl.style.display = 'none';

    updateEmployeesTab();
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

  // Record Time-Off employee dropdown
  const rtoSel = document.getElementById('rtoEmployeeSel');
  if (rtoSel) {
    rtoSel.innerHTML = '<option value="">Select employee...</option>' +
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
  const inputHrs = parseFloat(document.getElementById('rtoDays').value);
  const days      = inputHrs / 8;  // convert hours to days for internal storage
  const date    = document.getElementById('rtoDate').value;
  const notes   = document.getElementById('rtoNotes').value;

  if (!empKey) { alert('Please select an employee.'); return; }
  if (!inputHrs || inputHrs <= 0) { alert('Please enter valid number of hours.'); return; }
  if (!date) { alert('Please select a date.'); return; }

  const emp = EMPLOYEES[empKey];
  if (!emp) { alert('Employee not found.'); return; }

  // Calculate current balances before deducting
  const accr = calcEmployeeAccruals(emp.monthlyRecords || [], emp.firstClockIn, emp.vacTaken || 0, emp.sickTaken || 0);

  // Apply to correct balance — with eligibility and balance guards
  if (type === 'Sick') {
    if (days > accr.sickBal) {
      alert(`❌ Cannot record time-off. ${emp.name} only has ${daysToHrs(accr.sickBal)} sick hours available.`);
      return;
    }
    emp.sickTaken = +(( emp.sickTaken || 0) + days).toFixed(2);
  } else if (type === 'Vacation' || type === 'Vacation Liquidation (Payout)') {
    if (!accr.vacationEligible && type !== 'Vacation Liquidation (Payout)') {
      alert(`⚠️ ${emp.name} has not completed 1 year of service and cannot use vacation yet (PR Act 180). Vacation accrues but cannot be claimed until the 1-year anniversary.`);
      return;
    }
    if (days > accr.vacationBal) {
      alert(`❌ Cannot record time-off. ${emp.name} only has ${daysToHrs(accr.vacationBal)} vacation hours available.`);
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
    if (!confirm(`⚠️ Duplicate detected!\n\n${emp.name} has a ${dupRequest.status} request for ${dupRequest.type} covering ${dupRequest.start}→${dupRequest.end} (${daysToHrs(dupRequest.days)} hrs) — ${statusLabel}.\n\nRecording this manually may double-deduct their balance. Continue anyway?`)) return;
  }

  // ── Duplicate check: already manually logged for same date+type? ──
  const dupLog = (emp.timeOffLog || []).find(l => l.date === date && l.type === type);
  if (dupLog) {
    if (!confirm(`⚠️ Duplicate detected!\n\n${emp.name} already has a ${type} entry on ${date} (${daysToHrs(dupLog.days)} hrs, recorded ${new Date(dupLog.recordedAt).toLocaleDateString()}).\n\nContinue anyway?`)) return;
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
    localStorage.setItem('cfa_losfiltros_meals',     JSON.stringify(MEAL_PENALTIES));
  } catch(e) { console.warn('localStorage cache failed:', e); }
}

async function saveToCloud() {
  try {
    const payload = {
      key:       'appdata',
      employees: EMPLOYEES,
      periods:   IMPORTED_PERIODS,
      requests:  TIME_OFF_REQUESTS,
      meals:     MEAL_PENALTIES,
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
      if (data.meals)      { MEAL_PENALTIES.length  = 0; MEAL_PENALTIES.push(...data.meals); }
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
        const mp = localStorage.getItem('cfa_losfiltros_meals');
      if (mp) { MEAL_PENALTIES.length = 0; MEAL_PENALTIES.push(...JSON.parse(mp)); }
    } catch(e2) { console.warn('localStorage load failed:', e2); }
  }

  const backupTime = localStorage.getItem('cfa_losfiltros_backup_time');
  if (backupTime) { const sb = document.getElementById('sBackup'); if(sb) sb.textContent = backupTime; }
  // Restore data range display from imported months
  const allMonths = Object.keys(IMPORTED_PERIODS).sort();
  if (allMonths.length) {
    const first = IMPORTED_PERIODS[allMonths[0]];
    const last  = IMPORTED_PERIODS[allMonths[allMonths.length - 1]];
    const sr    = document.getElementById('sRange');
    if (sr) sr.textContent = (first?.start || allMonths[0]) + ' → ' + (last?.end || allMonths[allMonths.length - 1]);
  }
  populateEmployeeDropdowns();
  recalculateAll();
  updateRequestBadge();
  // Auto-fix any meal penalty records saved with old wrong formula
  migrateMealPenalties();
}

// Auto-save every 5 minutes and after key actions
setInterval(() => { if (currentUser) saveToStorage(); }, 5 * 60 * 1000);
window.addEventListener('load', initReconciliationUI);

// Override doBackup to also persist
async function doBackup() {
  const btn = document.querySelector('[onclick="doBackup()"]');
  if (btn) { btn.textContent = '⏳ Saving...'; btn.disabled = true; }
  try {
    await saveToCloud();
    _cacheToLocal();
    showToast('✅ Backup saved to cloud!');
  } catch(e) {
    showToast('❌ Backup failed: ' + e.message);
  } finally {
    if (btn) { btn.textContent = '💾 Backup Now'; btn.disabled = false; }
  }
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
    out.textContent='✅ Month lock cleared — you can now re-upload the same month to overwrite it.'; }
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
  const months = Object.keys(IMPORTED_PERIODS).sort();
  if (!months.length) {
    out.style.color='var(--text-mid)'; out.textContent='No months imported yet.'; return;
  }
  const sampleEmp = Object.values(EMPLOYEES)[0];
  let detail = '';
  if (sampleEmp) {
    detail = '\n\nSample: ' + sampleEmp.name;
    for (const rec of (sampleEmp.monthlyRecords||[])) {
      const qualified = rec.hoursWorked >= 130;
      detail += '\n  '+rec.year+'-'+String(rec.month).padStart(2,'0')+
        ': '+rec.hoursWorked.toFixed(1)+' hrs' +
        ' → '+(qualified ? 'QUALIFIES ✅ (≥130 hrs)' : 'DOES NOT QUALIFY ❌ (<130 hrs)');
    }
  }
  out.style.color='var(--navy)';
  out.innerHTML='<strong>Imported months:</strong>\n'+months.join('\n')+detail;
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
      <td>${daysToHrs(req.days)} hrs</td>
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
        alert(`❌ Cannot approve request. ${emp.name} only has ${daysToHrs(accr.sickBal)} sick hours available.`);
        return;
      }
      emp.sickTaken = +((emp.sickTaken||0) + req.days).toFixed(2);
    } else {
      if (!accr.vacationEligible) {
        alert(`⚠️ ${emp.name} has not completed 1 year of service (PR Act 180). Vacation cannot be approved yet.`);
        return;
      }
      if (req.days > accr.vacationBal) {
        alert(`❌ Cannot approve request. ${emp.name} only has ${daysToHrs(accr.vacationBal)} vacation hours available.`);
        return;
      }
      emp.vacTaken  = +((emp.vacTaken||0)  + req.days).toFixed(2);
    }
    // ── Duplicate check: already manually recorded in timeOffLog for same date+type? ──
    const dupLog = (emp.timeOffLog || []).find(l =>
      l.date === req.start && l.type === req.type && l.notes !== 'Approved request'
    );
    if (dupLog) {
      if (!confirm(`⚠️ Duplicate detected!\n\n${emp.name} already has a manually recorded ${req.type} entry on ${req.start} (${daysToHrs(dupLog.days)} hrs).\n\nApproving this request will also deduct ${daysToHrs(req.days)} hrs — double-deducting the balance. Continue anyway?`)) return;
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
      <td style="font-weight:600;color:${sickBal<=0?'var(--red)':'#0f766e'}">${daysToHrs(sickBal)} hrs</td>
      <td style="font-weight:600;color:${vacBal<=0?'var(--red)':'var(--navy)'}">${daysToHrs(vacBal)} hrs${!accruals.vacationEligible?' <span style="font-size:.65rem;color:#d97706">⚠</span>':''}</td>
      <td style="font-size:.78rem;color:var(--text-light)">${tenure}</td>
      <td><button class="btn btn-sm" onclick="showEmpDetail('${key}')">View</button></td>
    </tr>`;
  }).join('');
}

function editHireDate(empKey) {
  const emp = EMPLOYEES[empKey];
  if (!emp) return;
  const current = emp.firstClockIn || '';
  const input = prompt(
    `Edit hire date for ${emp.name}\n\nEnter the correct hire date (YYYY-MM-DD format):\nCurrent: ${current || 'Not set'}`,
    current
  );
  if (input === null) return; // cancelled
  const trimmed = input.trim();
  if (trimmed && !/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    alert('Invalid date format. Please use YYYY-MM-DD (e.g. 2022-08-15)');
    return;
  }
  emp.firstClockIn = trimmed || null;
  saveToStorage();
  recalculateAll();
  // Refresh the detail modal if still open
  showEmpDetail(empKey);
  showToast(`✅ Hire date updated for ${emp.name}`);
}

// Convert days to hours for display (1 day = 8 hours per PR Act 180)
function daysToHrs(days) {
  return (Math.round(days * 8 * 100) / 100);  // e.g. 0.5 → 4, 0.75 → 6, 1 → 8
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
  document.getElementById('detSickE').textContent = daysToHrs(accruals.sickEarned) + ' hrs';
  document.getElementById('detSickT').textContent = daysToHrs(emp.sickTaken||0) + ' hrs';
  document.getElementById('detSickB').textContent = daysToHrs(accruals.sickBal) + ' hrs';
  document.getElementById('detVacE').textContent  = daysToHrs(accruals.vacationEarned) + ' hrs';
  document.getElementById('detVacT').textContent  = daysToHrs(emp.vacTaken||0) + ' hrs';
  document.getElementById('detVacB').textContent  = daysToHrs(accruals.vacationBal) + ' hrs';

  document.getElementById('detType').innerHTML    = `<span class="badge bg-teal">${emp.type||'hourly'}</span>`;
  document.getElementById('detStatus').innerHTML  = `<span class="badge ${emp.status==='active'?'bg-green':'bg-gray'}">${emp.status||'active'}</span>`;
  document.getElementById('detTenure').innerHTML =
    '📅 Tenure: ' + getTenureString(emp.firstClockIn) +
    ' &nbsp;<button onclick="editHireDate(\'' + key + '\')" ' +
    'style="font-size:.65rem;padding:2px 7px;border:1px solid #94a3b8;border-radius:4px;cursor:pointer;background:#fff;color:#475569;margin-left:4px">' +
    '✏️ Edit hire date</button>';
  document.getElementById('detEligible').textContent = accruals.vacationEligible
    ? '✅ Vacation eligible' : '⚠️ Vacation not usable until 1yr';

  // Monthly breakdown table
  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const tbody = document.getElementById('detMonthlyTbody');
  if (!(emp.monthlyRecords||[]).length) {
    tbody.innerHTML = '<tr><td colspan="7" style="padding:12px;text-align:center;color:#888">No months imported yet.</td></tr>';
  } else {
    tbody.innerHTML = (emp.monthlyRecords||[])
      .sort((a,b) => a.year!==b.year ? a.year-b.year : a.month-b.month)
      .map(rec => {
        const avg = (rec.hoursWorked/4.33).toFixed(1);
        // Compute completed years of service at the start of this month
        const startDate = emp.firstClockIn ? new Date(emp.firstClockIn) : null;
        const monthStart = new Date(rec.year, rec.month - 1, 1);
        const completedYears = startDate
          ? Math.max(0, Math.floor((monthStart - startDate) / (1000*60*60*24*365.25)))
          : 0;
        const acr = calcMonthlyAccrual(rec.hoursWorked, completedYears);
        const tierColor = acr.tier==='none'?'#888':'#166534';
        const tierLabel = acr.tier==='none'?'None ❌'
          : acr.tier==='year1'?'Yr1 (½/day) ✅'
          : acr.tier==='year1to5'?'Yr1-5 (¾/day) ✅'
          : acr.tier==='year5to15'?'Yr5-15 (1/day) ✅'
          : 'Yr15+ (1¼/day) ✅';
        const qualBg    = acr.qualified ? '#dcfce7' : '#fee2e2';
        const qualColor = acr.qualified ? '#166534' : '#991b1b';
        const qualLabel = acr.qualified ? '✓ Qualifies' : '✗ < 130 hrs';
        return `<tr style="border-bottom:1px solid #f0f0f0">
          <td style="padding:7px 10px">${monthNames[rec.month-1]} ${rec.year}</td>
          <td style="padding:7px 10px;text-align:right">${rec.hoursWorked.toFixed(1)}</td>
          <td style="padding:7px 10px;text-align:right">${avg}</td>
          <td style="padding:7px 10px;text-align:center;color:${tierColor};font-weight:600;font-size:.75rem">${tierLabel}</td>
          <td style="padding:7px 10px;text-align:right;color:#0f766e;font-weight:600">+${daysToHrs(acr.sickEarned)} hrs</td>
          <td style="padding:7px 10px;text-align:right;color:var(--navy);font-weight:600">+${daysToHrs(acr.vacationEarned)} hrs</td>
          <td style="padding:7px 10px;text-align:center">
            <span style="font-size:.7rem;background:${qualBg};color:${qualColor};padding:2px 7px;border-radius:10px">${qualLabel}</span>
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
          <td style="padding:6px 10px;text-align:right;font-weight:600;color:var(--red)">-${daysToHrs(log.days)} hrs</td>
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
  const list   = document.getElementById('periodHistoryList');
  const months = Object.keys(IMPORTED_PERIODS).sort().reverse();

  if (!months.length) {
    list.innerHTML = '<div class="empty"><div class="ei">📭</div><p>No months imported yet.</p></div>';
  } else {
    list.innerHTML = months.map(monthKey => {
      const pd        = IMPORTED_PERIODS[monthKey];
      const label     = new Date(monthKey + '-02').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      const dateRange = pd.start && pd.end ? `${pd.start} → ${pd.end}` : monthKey;
      return `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:12px 14px;border:1px solid var(--border);border-radius:8px;margin-bottom:8px">
          <div>
            <div style="font-weight:600;font-size:.88rem">📅 ${label}</div>
            <div style="font-size:.78rem;color:var(--text-light);margin-top:2px">
              ${dateRange} · ${pd.empCount || '?'} employees · ${(pd.totalHours||0).toFixed(0)} hrs
            </div>
          </div>
          <button class="btn btn-red2 btn-sm" onclick="deletePeriod('${monthKey}')">🗑 Delete</button>
        </div>`;
    }).join('');
  }

  om('periodHistoryModal');
}

function deletePeriod(monthKey) {
  const pd    = IMPORTED_PERIODS[monthKey];
  const label = pd ? new Date(monthKey + '-02').toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : monthKey;
  if (!confirm(`Delete ${label}? All hours for this month will be removed from every employee and accruals will be recalculated.`)) return;

  // Parse year/month from key e.g. "2025-03"
  const [y, mo] = monthKey.split('-').map(Number);

  // Remove that month's record from every employee
  for (const emp of Object.values(EMPLOYEES)) {
    emp.monthlyRecords = (emp.monthlyRecords || []).filter(r => !(r.year === y && r.month === mo));
  }

  delete IMPORTED_PERIODS[monthKey];
  saveToStorage();
  recalculateAll();
  showPeriodHistory();
  showToast(`🗑 ${label} deleted — accruals recalculated.`);
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
        log.days ? daysToHrs(log.days) + ' hrs' : '',
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
        req.days ? daysToHrs(req.days) + ' hrs' : '',
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
      daysToHrs(accruals.sickEarned),
      daysToHrs(emp.sickTaken||0),
      daysToHrs(accruals.sickBal),
      daysToHrs(accruals.vacationEarned),
      daysToHrs(emp.vacTaken||0),
      daysToHrs(accruals.vacationBal),
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
      <td>${daysToHrs(accruals.sickEarned)} hrs</td><td>${daysToHrs(emp.sickTaken||0)} hrs</td><td><strong>${daysToHrs(accruals.sickBal)} hrs</strong></td>
      <td>${daysToHrs(accruals.vacationEarned)} hrs</td><td>${daysToHrs(emp.vacTaken||0)} hrs</td><td><strong>${daysToHrs(accruals.vacationBal)} hrs</strong></td>
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

</body></html>`);
  win.document.close();
}

// ══════════════════════════════════════════
// DATA STORES
// ══════════════════════════════════════════
let MEAL_PENALTIES = [];

// ══════════════════════════════════════════
// MEAL PENALTY MIGRATION
// Fixes records saved with old formula (rate × 1.5 only, missing × 0.5 hr).
// Correct formula: rate × 1.5 × 0.5  (30 min = 0.5 hr of meal period)
// ══════════════════════════════════════════
function migrateMealPenalties() {
  let fixed = 0;
  for (const p of MEAL_PENALTIES) {
    if (!p.rate || !p.penaltyAmount) continue;
    const correct = +(p.rate * 1.5 * 0.5).toFixed(2);
    const old     = +(p.rate * 1.5).toFixed(2);
    // If stored value matches old wrong formula (and not already correct)
    if (Math.abs(p.penaltyAmount - old) < 0.01 && Math.abs(p.penaltyAmount - correct) > 0.01) {
      p.penaltyAmount = correct;
      fixed++;
    }
  }
  if (fixed > 0) {
    saveMealData();
    saveToCloud();
    console.log(`✅ Migrated ${fixed} meal penalty record(s) to correct 30-min formula.`);
  }
  return fixed;
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

  // Second meal period check (>10 hrs)
  if (shiftHours > 10) {
    violations.push(`⚠️ Shift is ${shiftHours.toFixed(1)} hrs — second meal period required (unless < 12 hrs and first break was taken).`);
    if (penaltyMinutes === 0) penaltyMinutes = 30;
  }

  if (violations.length) {
    banner.style.display = 'block';
    banner.innerHTML = '<strong>Violations detected:</strong><br>' + violations.join('<br>');
    // Penalty = actual meal period not properly taken (30 min = 0.5 hr × 1.5×)
    const penaltyHours = penaltyMinutes / 60;
    const penalty = rate > 0 ? (rate * 1.5 * penaltyHours).toFixed(2) : '—';
    calcResult.style.display = 'block';
    calcResult.innerHTML = `<strong>Penalty calculation (PR Act 379 — post-Jan 26, 2017 hire):</strong><br>
      ${penaltyMinutes} min (${penaltyHours.toFixed(2)} hr) × 1.5× rate${rate>0?' = <strong>$'+penalty+'</strong> owed':''}<br>
      <span style="font-size:.75rem;color:#888">Time and a half for meal period worked. Pre-2017 hires would owe 2× (double time).</span>`;
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
  if (shiftHours <= 6) {
    // No break required — log as informational if somehow submitted
  } else if (!breakStart) {
    violationTypes.push('No break taken');
  } else {
    if (breakDuration < 30)                             violationTypes.push('Break too short');
    if (breakStartHour !== null && breakStartHour < 2)  violationTypes.push('Break too early');
    if (breakStartHour !== null && breakStartHour >= 6)  violationTypes.push('Break too late');
  }
  // Second meal period: required if >10 hrs. Can be waived if <12 hrs AND first break was taken.
  if (shiftHours > 10) {
    const secondBreakWaivable = shiftHours < 12 && breakStart;
    if (!secondBreakWaivable) violationTypes.push('Second meal period required');
  }

  // Penalty: actual time not properly rested (30 min = 0.5 hr) × 1.5×
  // Note: pre-Jan 26 2017 hires = 2× but all CFA PR employees are post-2017
  const penaltyMinutes = 30;
  const penaltyHours   = penaltyMinutes / 60;
  const penaltyAmount  = rate > 0 ? +(rate * 1.5 * penaltyHours).toFixed(2) : 0;

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
  showToast(`✅ Meal penalty logged for ${emp?.name || empKey}${penaltyAmount>0?' — $'+penaltyAmount+' owed':''}`);
}

function renderMealPenalties() {
  const tbody = document.getElementById('mealTbody');
  if (!tbody) return;

  if (!MEAL_PENALTIES.length) {
    tbody.innerHTML = '<tr><td colspan="11"><div class="empty"><div class="ei">🍽</div><p>No violations logged.</p></div></td></tr>';
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
      <td style="font-size:.8rem;color:#b45309;font-weight:600">${p.penaltyAmount>0?'30 min @ 1.5×':'—'}</td>
      <td style="font-weight:700;color:${p.penaltyAmount>0?'var(--red)':'#888'}">${p.penaltyAmount>0?'$'+p.penaltyAmount:'—'}</td>
      <td><button class="btn btn-red2 btn-sm" onclick="deleteMealPenalty(${p.id})">✕</button></td>
    </tr>`).join('');
  }

  // Add all-time totals footer row
  if (MEAL_PENALTIES.length) {
    const totalPenalty = MEAL_PENALTIES.reduce((s,p) => s + (p.penaltyAmount||0), 0);
    // Total time owed: each violation = 30 min (0.5 hr)
    const totalViolations = MEAL_PENALTIES.filter(p => p.penaltyAmount > 0).length;
    const totalMins  = totalViolations * 30;
    const totalHrsWhole = Math.floor(totalMins / 60);
    const totalMinsRem  = totalMins % 60;
    const timeOwedStr   = totalMinsRem > 0
      ? `${totalHrsWhole}h ${totalMinsRem}m`
      : `${totalHrsWhole}h`;
    const totalRow = document.createElement('tr');
    totalRow.style.cssText = 'background:#fef2f2;font-weight:700;border-top:2px solid #fca5a5';
    totalRow.innerHTML = `
      <td colspan="8" style="text-align:right;padding:10px;font-size:.85rem;color:#991b1b">ALL-TIME TOTAL LIABILITY</td>
      <td style="padding:10px;font-size:.85rem;color:#991b1b">—</td>
      <td style="padding:10px;font-size:.85rem;color:#b45309;font-weight:700">${timeOwedStr} total</td>
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
  saveToCloud();           // ← persist to Supabase
  renderMealPenalties();
  showToast('🗑 Penalty record deleted.');
}

function clearAllMealPenalties() {
  if (!confirm('⚠️ This will delete ALL meal penalty records. Are you sure?')) return;
  MEAL_PENALTIES.length = 0;
  saveMealData();
  saveToCloud();           // ← persist to Supabase so clear survives refresh
  renderMealPenalties();
  showToast('🗑 All meal penalty records cleared.');
}

function exportMealsCSV() {
  const rows = [['Employee','Date','Shift Start','Shift End','Break Start','Break End','Break Duration (min)','Violations','Hourly Rate','Time Owed','Penalty Amount']];
  MEAL_PENALTIES.forEach(p => rows.push([p.empName,p.date,p.shiftStart,p.shiftEnd,p.breakStart||'',p.breakEnd||'',p.breakDuration,p.violationTypes.join('; '),'$'+(p.rate||0),p.penaltyAmount>0?'30 min @ 1.5x':'—','$'+p.penaltyAmount]));
  const csv = rows.map(r=>r.map(v=>`"${v}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv],{type:'text/csv'}));
  a.download = 'meal_penalties_' + new Date().toISOString().slice(0,10) + '.csv';
  a.click();
}

// ══════════════════════════════════════════
// PERSISTENCE — meals
// ══════════════════════════════════════════
function saveMealData() {
  try { localStorage.setItem('cfa_losfiltros_meals', JSON.stringify(MEAL_PENALTIES)); } catch(e){}
  saveToCloud();
}



// ══════════════════════════════════════════
// POPULATE employee dropdowns for new tabs
// ══════════════════════════════════════════
// Tab-switch side effects for meals + recon are handled
// directly inside goTab (see goTab function above).




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

    if (vCount > 0) showToast(`✅ Found ${vCount} meal penalty violations!`);
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
      // Correct formula: rate × 1.5 × 0.5 hr (30-min meal period)
      const _penalty1 = _rate1 > 0 ? +(_rate1 * 1.5 * 0.5).toFixed(2) : 0;
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
          // Correct formula: rate × 1.5 × 0.5 hr (30-min meal period)
          const _penalty2 = _rate2 > 0 ? +(_rate2 * 1.5 * 0.5).toFixed(2) : 0;
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
// GASTOS AUTOFILL MODULE
// ══════════════════════════════════════════════════════════════════

const GASTOS_PROXY = `${SUPABASE_URL}/functions/v1/claude-proxy`;

const GASTOS_CATEGORIES = [
  "Auto Liability Insurance","Bank Charges","Business Interruption Insrnc","CFA Kiosk",
  "Catering Expense","Catering Mileage - Team Member","Cell Phone - Team Members",
  "Change Fund","Cleaning Supplies","Commissions Paid on Sales",
  "Contents and Inventory Insrnc","Crime Insurance","Cyber Insurance",
  "Distributor - Fuel Surcharge","Drive-Thru TM Experience","Dues & Subscriptions",
  "Electric Salad Spinners","Electric Utility - Utility Co.","Floor Scrubbers",
  "Food - Beverages","Food - Bread","Food - Breakfast","Food - Chicken - Breakfast",
  "Food - Chicken - Filets","Food - Chicken - Grld Filet","Food - Chicken - Grld Nggts",
  "Food - Chicken - Nuggets","Food - Chicken - Spicy","Food - Chicken - Strips",
  "Food - Coater","Food - Condiments","Food - Dessert","Food - Distributor",
  "Food - Miscellaneous","Food - Oil","Food - Other Food","Food - Produce",
  "Food - Test Ingredients","Food - Waffle Potato Fries","Food Giveaways",
  "General Liability","General Miscellaneous","Health Insurance - Team Member",
  "Health Insurance Administrative Fees","Kitchen Supplies","Legal Fees - Restaurant Ops",
  "License","Life Insurance-Team Member","Linen","Maint Bldg - Door/Glass/HW",
  "Maint Bldg - Electrical","Maint Bldg - Exhaust","Maint Bldg - Finishes/Paint",
  "Maint Bldg - HVAC","Maint Bldg - Lighting","Maint Bldg - Lndscp/Lawn/Irrig",
  "Maint Bldg - Miscellaneous","Maint Bldg - Playground","Maint Bldg - Plumbing",
  "Maint Bldg - Prev/Sched Maint","Maint Bldg - Seating","Maint Bldg - Signage",
  "Maint Equip- Beverage","Maint Equip- DriveThru Equip","Maint Equip- Food Prep/Hold",
  "Maint Equip- Frig/Freezer/Thaw","Maint Equip- Grill","Maint Equip- I.T.",
  "Maint Equip- Ice Cream","Maint Equip- Ice Machine","Maint Equip- Miscellaneous",
  "Maint Equip- Open Fryer","Maint Equip- Other","Maint Equip- Pressure Fryer",
  "Maint Equip- Prev/Sched Maint","Maint Equip- Shelving","Maint Equip- Walkin Frig/Frzr",
  "Maint Equip- Water Filtration","Maintenance","Marketing - Fundraisers",
  "Marketing - Rest. Advertising","Marketing - Services","Marketing - Sponsorships",
  "Meals - Operator","Meals - Team Member","Music Expense","NSF Check Collection",
  "Office Supplies","Offsite Office Space","Offsite Space/Storage",
  "Operator Business Mileage","Operator Development Expense","Operator EPLI",
  "Operator cell phone","Other Business Insurance","Other Team Member Benefits",
  "Paper","Paper Giveaways","Party/Outing Expense",
  "Payroll - Wages - bonus/vacation/sick time","Payroll - Workers Comp Insurance",
  "Payroll- Wages","Pension - Team Member","Pest Control",
  "Phone-Landline/Internet/Wifi","Products and Premise Liability Insurance",
  "Profit Sharing - Team Member","Property Tax Expense","Property Tax-Opr/Entity Owned",
  "R&M Equip - Music","R&M Equip - Security","Recruiting Expense",
  "Repair Bldg - Door/Glass/HW","Repair Bldg - Electrical","Repair Bldg - Exhaust",
  "Repair Bldg - Finishes/Paint","Repair Bldg - HVAC","Repair Bldg - Lighting",
  "Repair Bldg - Miscellaneous","Repair Bldg - Playground","Repair Bldg - Plumbing",
  "Repair Bldg - Prev/Sched Maint","Repair Bldg - Seating","Repair Bldg - Signage",
  "Repair Bldg -Land/Lawn/Irrig","Repair Equip - Beverage","Repair Equip - Drive-Thr Equip",
  "Repair Equip - Food Prep/Hold","Repair Equip - Frig/Frzer/Thaw","Repair Equip - Grill",
  "Repair Equip - I.T.","Repair Equip - Ice Cream","Repair Equip - Ice Machine",
  "Repair Equip - Miscellaneous","Repair Equip - Open Fryer","Repair Equip - Other",
  "Repair Equip - Pressure Fryer","Repair Equip - Prev/Sch Maint","Repair Equip - Shelving",
  "Repair Equip - Water Filtr.","Repair Equip - Wlk-in Frig/Frz","Repair General - Other",
  "Repairs","Replacement Check","Retirement Admin Fees","Security Expense",
  "Service Amenities","Swiped Credit Card Fees","TM Bus. Mileage(Non-Delivery)",
  "Team Member Retirement","Team Member Training Expense","Theft Liability Insurance",
  "Third Party Staffing","Trailers","Trash Compactors","Travel - Operators",
  "Travel - Team Member","Uniforms","Utilities - Deposit Paid","Utilities - Gas",
  "Utilities - Trash Service","Water & Sewage - Utility Co.","Fuel Surcharge"
  // NOTE: "Withholding Tax- COR Only" intentionally excluded per spec
];

// ── Module State ───────────────────────────────────────────────
const G = {
  mode: 'single',        // 'single' | 'batch'
  batch: [],             // [{file, index, status, extracted, blob, dupFound}]
  sameVendor: false,
  sameVendorName: '',
  currentEntry: null,    // data being reviewed in step 2
  currentBlob: null,     // compressed image blob for current entry
  historyFilter: 'all',
  dupFound: null,
  forceOverride: false,
};
let _gastosFiles = [];

// ── Category Lookup ────────────────────────────────────────────
function getCategoryForVendor(vendorName) {
  const name = (vendorName || '').toUpperCase().trim();

  const tier1 = {
    "FRESHPOINT PUERTO RICO":"Food - Produce","COCA-COLA PR":"Food - Beverages",
    "HOLSUM PR":"Food - Bread","TRES MONJITAS":"Food - Beverages",
    "PR COFFEE":"Food - Beverages","ERS GRAPHICS":"Marketing - Rest. Advertising",
    "PARTS TOWN":"Kitchen Supplies","DANNY DETAILING":"Maint Bldg - Prev/Sched Maint",
    "META":"Marketing - Rest. Advertising",
    "MICHAELANGELO PEREZ BURGOS":"Maint Bldg - Lndscp/Lawn/Irrig",
    "RENTOKIL":"Pest Control","HALO":"Marketing - Rest. Advertising",
    "ANGEL BERRIOS GARCIA OSO":"Offsite Space/Storage","LOOMIS":"Change Fund",
    "LUMA":"Electric Utility - Utility Co.","ACUEDUCTOS":"Water & Sewage - Utility Co.",
    "YCS":"Maint Equip- I.T.","EC WASTE":"Trash Compactors",
    "CANVA":"Dues & Subscriptions","OFFICE DEPOT":"Office Supplies",
    "EL COQUI":"Food - Beverages","SAMS CLUB":"Meals - Team Member",
    "WALGREENS":"General Miscellaneous","DATE LABEL":"Kitchen Supplies",
    "PLI":"Marketing - Rest. Advertising","ECOLAB":"Cleaning Supplies",
    "STARBUCKS":"Meals - Team Member","SHRM":"Team Member Training Expense",
    "MOOD MEDIA":"Music Expense","SIGNATURE CONTRACTOR":"Maint Bldg - Lndscp/Lawn/Irrig",
    "OFFICE MAX":"Paper","INDEED":"Recruiting Expense",
    "SSP AMERICA THE KITCHEN":"Meals - Team Member","SHOES FOR CREWS":"Uniforms",
    "JW MARRIOTT":"Team Member Training Expense","ABBYS PIZZA":"Party/Outing Expense",
    "OOBE":"Uniforms","AMBITEK FURNITURE":"Offsite Space/Storage",
    "THE APPROACH":"Team Member Training Expense","QDOBA":"Meals - Team Member",
    "CLARK":"Kitchen Supplies","KINGS UNIFORMS":"Linen",
    "T-MOBILE":"Phone-Landline/Internet/Wifi","CASA DE TORNILLOS":"Maintenance",
  };
  const tier2 = {
    "AMAZON":"General Miscellaneous","COSTCO":"General Miscellaneous",
    "WALMART":"General Miscellaneous","SUPERMAX":"General Miscellaneous",
    "HOME DEPOT":"General Miscellaneous","SPECTRUM INDUSTRIAL":"Dues & Subscriptions",
    "PROGRESSIVE":"Maintenance","ME SALVE":"General Miscellaneous",
    "NIETO REFRIGERATION":"Maint Bldg - Prev/Sched Maint",
    "RET":"Maint Bldg - Prev/Sched Maint",
    "INTERNATIONAL MASCOT":"Marketing - Rest. Advertising",
    "ALBER RAMOS ROMERO":"Maintenance",
    "ELECTRIC SERVICE CORPORATION":"Maint Equip- Prev/Sched Maint",
    "LLUCH":"Maint Equip- Prev/Sched Maint","BEST BUY":"Office Supplies",
    "KRISPY KREME":"Meals - Team Member","IKEA":"Office Supplies",
    "CHARTER HOUSE":"General Miscellaneous",
    "VA ELECTRICAL CONTRACTORS":"Maint Bldg - Electrical",
    "ASORE":"Team Member Training Expense",
    "TAYLOR SALES AND SERVICES":"Maint Equip- Ice Cream",
    "UNITED AIRLINES":"Travel - Team Member","HORNOFINO":"Meals - Team Member",
    "GOOD CENTS R&M":"Kitchen Supplies",
  };

  if (tier1[name]) return { category: tier1[name], tier: 'locked', confidence: 100 };
  if (tier2[name]) return { category: tier2[name], tier: 'ai', confidence: 60 };
  for (const [k, v] of Object.entries(tier1)) {
    if (name.includes(k) || k.includes(name)) return { category: v, tier: 'locked', confidence: 90 };
  }
  for (const [k, v] of Object.entries(tier2)) {
    if (name.includes(k) || k.includes(name)) return { category: v, tier: 'ai', confidence: 50 };
  }
  return { category: '', tier: 'human', confidence: 0 };
}

function gastosCategoryBadge(tier) {
  if (tier === 'locked') return '<span class="badge" style="background:#d1fae5;color:#065f46;font-size:.72rem">Auto-fill ✓</span>';
  if (tier === 'ai')     return '<span class="badge" style="background:#fef3c7;color:#92400e;font-size:.72rem">Sugerido por IA</span>';
  return                        '<span class="badge" style="background:#fee2e2;color:#991b1b;font-size:.72rem">Requiere revisión</span>';
}

function gastosStatusBadge(status) {
  if (status === 'pending')  return '<span class="badge" style="background:#fef3c7;color:#92400e">Pendiente</span>';
  if (status === 'approved') return '<span class="badge" style="background:#dbeafe;color:#1e40af">Aprobado</span>';
  if (status === 'entered')  return '<span class="badge" style="background:#dcfce7;color:#166534">Ingresado ✓</span>';
  return '<span class="badge">—</span>';
}

// ── Date helpers ───────────────────────────────────────────────
function gastosParseDate(str) {
  // MM/DD/YYYY → YYYY-MM-DD
  if (!str) return null;
  const p = str.split('/');
  if (p.length === 3) return `${p[2]}-${p[0].padStart(2,'0')}-${p[1].padStart(2,'0')}`;
  return str;
}
function gastosFormatDate(dbDate) {
  // YYYY-MM-DD → MM/DD/YYYY
  if (!dbDate) return '—';
  try {
    const d = new Date(dbDate + 'T12:00:00');
    return `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}/${d.getFullYear()}`;
  } catch { return dbDate; }
}

// ── Image helpers ──────────────────────────────────────────────
async function gastosCompressImage(file) {
  return new Promise(resolve => {
    const canvas = document.createElement('canvas');
    const img = new Image();
    img.onload = () => {
      const maxW = 1200;
      const scale = Math.min(1, maxW / img.width);
      canvas.width  = img.width  * scale;
      canvas.height = img.height * scale;
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(blob => resolve(blob), 'image/jpeg', 0.85);
    };
    img.src = URL.createObjectURL(file);
  });
}
async function gastosToBase64(blob) {
  return new Promise(resolve => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.readAsDataURL(blob);
  });
}

// ── Duplicate check ────────────────────────────────────────────
async function gastosCheckDuplicate(vendor, invoiceNumber) {
  if (!invoiceNumber) return null;
  try {
    const { data } = await getSupa()
      .from('gastos_entries')
      .select('id,vendor,invoice_number,invoice_date,amount,status')
      .ilike('vendor', `%${vendor}%`)
      .eq('invoice_number', invoiceNumber)
      .limit(1);
    return data?.length > 0 ? data[0] : null;
  } catch { return null; }
}

// ── Sorting ────────────────────────────────────────────────────
function sortForGastosEntry(entries) {
  return entries
    .filter(e => e.status === 'approved')
    .sort((a, b) => {
      if (a.vendor < b.vendor) return -1;
      if (a.vendor > b.vendor) return 1;
      return new Date(a.invoice_date) - new Date(b.invoice_date);
    });
}

// ── AI calls ───────────────────────────────────────────────────
async function gastosExtractReceipt(base64Img) {
  const res = await fetch(GASTOS_PROXY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON}` },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 600,
      system: `You are an expense entry assistant for a Chick-fil-A restaurant in Puerto Rico. You will be given a photo of a receipt or invoice. Extract the following fields and return ONLY valid JSON with no markdown, no backticks, no preamble. Return this exact structure: {"vendor":"supplier name in ALL CAPS. Use canonical names: FRESHPOINT PUERTO RICO, COCA-COLA PR, HOLSUM PR, LUMA, ACUEDUCTOS, RENTOKIL, etc. Otherwise return as printed in ALL CAPS.","invoice_number":"invoice/receipt number or null","invoice_date":"MM/DD/YYYY or null","amount":total as number or null,"description":"1 sentence describing what was purchased","raw_vendor":"vendor name exactly as printed"}`,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64Img } },
          { type: 'text', text: 'Extract the expense data from this receipt.' }
        ]
      }]
    })
  });
  if (!res.ok) throw new Error(`API error ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = (data.content?.[0]?.text || '').replace(/```json|```/g, '').trim();
  return JSON.parse(text);
}

async function gastosExtractSameVendor(base64Img, vendorName) {
  const res = await fetch(GASTOS_PROXY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON}` },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64Img } },
          { type: 'text', text: `The vendor is already known: ${vendorName}. Extract only: invoice_number, invoice_date (MM/DD/YYYY), and amount (number only). Return ONLY valid JSON: {"invoice_number":"...","invoice_date":"...","amount":0.00}` }
        ]
      }]
    })
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  const data = await res.json();
  const text = (data.content?.[0]?.text || '').replace(/```json|```/g, '').trim();
  return JSON.parse(text);
}

async function gastosAiCategory(vendor, description) {
  const catList = GASTOS_CATEGORIES.join(', ');
  const res = await fetch(GASTOS_PROXY, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${SUPABASE_ANON}` },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `You are an expense categorization assistant for a Chick-fil-A restaurant in Puerto Rico. Vendor: "${vendor}". Description: "${description}". Return ONLY valid JSON: {"category":"exact name from the list","reasoning":"one sentence"}. NEVER suggest "Withholding Tax- COR Only". Choose ONLY from this list: ${catList}`
      }]
    })
  });
  if (!res.ok) throw new Error(`API error ${res.status}`);
  const data = await res.json();
  const text = (data.content?.[0]?.text || '').replace(/```json|```/g, '').trim();
  return JSON.parse(text);
}

// ── Supabase CRUD ──────────────────────────────────────────────
async function gastosSaveEntry(entry) {
  const { data: { user } } = await getSupa().auth.getUser();
  const { data, error } = await getSupa()
    .from('gastos_entries')
    .insert({ ...entry, created_by: user?.id })
    .select().single();
  if (error) throw error;
  return data;
}

async function gastosDeleteEntry(id) {
  const { error } = await getSupa().from('gastos_entries').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

async function gastosUpdateStatus(id, status) {
  const { error } = await getSupa().from('gastos_entries').update({ status }).eq('id', id);
  if (error) throw error;
}

async function gastosLoadHistory(filterStatus = 'all') {
  let q = getSupa().from('gastos_entries').select('*').order('created_at', { ascending: false }).limit(150);
  if (filterStatus !== 'all') q = q.eq('status', filterStatus);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

async function gastosUploadImage(blob, entryId) {
  try {
    const { data: { user } } = await getSupa().auth.getUser();
    const path = `gastos/${user?.id || 'anon'}/${entryId}.jpg`;
    await getSupa().storage.from('receipts').upload(path, blob, { contentType: 'image/jpeg', upsert: true });
    const { data } = getSupa().storage.from('receipts').getPublicUrl(path);
    return data?.publicUrl || null;
  } catch (e) { console.warn('Image upload failed:', e); return null; }
}

// ── MAIN INIT ──────────────────────────────────────────────────
function gastosInit() {
  const app = document.getElementById('gastosApp');
  if (!app || app.dataset.init === '1') {
    // Already initialized — just refresh queue and history
    gastosRenderQueue();
    gastosRenderHistory();
    return;
  }
  app.dataset.init = '1';
  app.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:16px">
      <h2 style="margin:0;font-size:1.2rem;color:var(--navy)">💰 Gastos Autofill</h2>
      <span style="font-size:.78rem;color:var(--text-mid)">Extrae datos de recibos con IA · Prepara entradas para Gastos</span>
    </div>
    <div id="gastosStep1"></div>
    <div id="gastosStep2" style="display:none"></div>
    <div id="gastosQueueArea" style="margin-top:20px"></div>
    <div id="gastosHistoryArea" style="margin-top:20px"></div>`;

  gastosRenderUpload();
  gastosRenderQueue();
  gastosRenderHistory();
}

// ── STEP 1: Upload UI ──────────────────────────────────────────
function gastosRenderUpload() {
  document.getElementById('gastosStep1').innerHTML = `
  <div class="ccard">
    <div style="font-weight:700;color:var(--navy);font-size:.9rem;margin-bottom:14px">📤 Paso 1 — Subir Recibo(s)</div>

    <div id="gDropZone"
      style="border:2px dashed #94a3b8;border-radius:10px;padding:36px 20px;text-align:center;cursor:pointer;transition:border-color .2s;margin-bottom:14px"
      onclick="document.getElementById('gFileInput').click()"
      ondragover="event.preventDefault();this.style.borderColor='var(--navy)'"
      ondragleave="this.style.borderColor='#94a3b8'"
      ondrop="event.preventDefault();this.style.borderColor='#94a3b8';gastosHandleFiles(event.dataTransfer.files)">
      <div style="font-size:2.2rem;margin-bottom:8px">📷</div>
      <div style="font-weight:600;color:var(--navy);margin-bottom:4px">Arrastra fotos aquí o haz clic para seleccionar</div>
      <div style="font-size:.78rem;color:var(--text-mid)">Máximo 15 recibos · JPG / PNG / HEIC · Cámara o galería</div>
    </div>
    <input type="file" id="gFileInput" accept="image/*" capture="environment" multiple
      style="display:none" onchange="gastosHandleFiles(this.files)"/>

    <!-- Same-vendor toggle — shown only in batch mode -->
    <div id="gSameVendorRow" style="display:none;background:#f0f9ff;border:1px solid #bae6fd;border-radius:8px;padding:12px 14px;margin-bottom:14px">
      <label style="display:flex;align-items:center;gap:10px;cursor:pointer;font-size:.875rem;font-weight:600;color:#0369a1">
        <input type="checkbox" id="gSameVendorChk" onchange="gastosToggleSameVendor()"
          style="width:18px;height:18px;accent-color:var(--navy)"/>
        ¿Todos los recibos son del mismo proveedor?
      </label>
      <div id="gSameVendorInput" style="display:none;margin-top:10px">
        <input type="text" id="gVendorNamePreset" class="sinput" style="width:100%"
          placeholder="Nombre del proveedor (ej. FRESHPOINT PUERTO RICO)"
          oninput="G.sameVendorName=this.value.trim().toUpperCase()"/>
      </div>
    </div>

    <!-- Single preview -->
    <div id="gSinglePreview" style="display:none;margin-bottom:14px;text-align:center">
      <img id="gPreviewImg" style="max-width:100%;max-height:280px;border-radius:8px;border:1px solid #e2e8f0;object-fit:contain"/>
    </div>

    <!-- Batch thumbnail grid -->
    <div id="gBatchGrid" style="display:none;grid-template-columns:repeat(auto-fill,minmax(110px,1fr));gap:10px;margin-bottom:14px"></div>

    <!-- Progress bar -->
    <div id="gProgressWrap" style="display:none;margin-bottom:14px">
      <div style="font-size:.82rem;font-weight:600;color:var(--navy);margin-bottom:6px" id="gProgressLabel">Procesando...</div>
      <div style="background:#e5e7eb;border-radius:10px;height:8px;overflow:hidden">
        <div id="gProgressBar" style="height:100%;background:var(--navy);border-radius:10px;transition:width .3s;width:0%"></div>
      </div>
    </div>

    <!-- Batch summary (shown after processing) -->
    <div id="gBatchSummary" style="display:none"></div>

    <!-- Extract button -->
    <div id="gExtractRow" style="display:none">
      <button class="btn btn-navy" id="gExtractBtn" onclick="gastosExtract()" style="width:100%;padding:12px;font-size:.95rem">
        ✨ Extraer datos con IA
      </button>
    </div>
  </div>`;
}

function gastosHandleFiles(fileList) {
  const files = Array.from(fileList);
  if (!files.length) return;
  if (files.length > 15) {
    alert('Por favor selecciona máximo 15 recibos a la vez.');
    return;
  }
  _gastosFiles = files;
  G.mode = files.length > 1 ? 'batch' : 'single';
  G.batch = [];
  document.getElementById('gBatchSummary').style.display = 'none';

  if (G.mode === 'single') {
    document.getElementById('gSameVendorRow').style.display = 'none';
    document.getElementById('gBatchGrid').style.display = 'none';
    document.getElementById('gSinglePreview').style.display = 'block';
    document.getElementById('gPreviewImg').src = URL.createObjectURL(files[0]);
  } else {
    document.getElementById('gSameVendorRow').style.display = 'block';
    document.getElementById('gSinglePreview').style.display = 'none';
    gastosRenderBatchGrid(files);
  }
  document.getElementById('gDropZone').style.borderColor = 'var(--navy)';
  document.getElementById('gExtractRow').style.display = 'block';
}

function gastosRenderBatchGrid(files) {
  const grid = document.getElementById('gBatchGrid');
  grid.style.display = 'grid';
  grid.innerHTML = files.map((f, i) => `
    <div id="gThumb_${i}" style="border:2px solid #e2e8f0;border-radius:8px;overflow:hidden">
      <img src="${URL.createObjectURL(f)}" style="width:100%;height:86px;object-fit:cover;display:block"/>
      <div id="gThumbLbl_${i}" style="padding:3px 6px;font-size:.68rem;font-weight:600;text-align:center;background:#f8fafc;color:#64748b">
        En espera
      </div>
    </div>`).join('');
}

function gastosSetThumbStatus(i, text, bg, color) {
  const lbl  = document.getElementById(`gThumbLbl_${i}`);
  const card = document.getElementById(`gThumb_${i}`);
  if (lbl)  { lbl.textContent = text; lbl.style.background = bg; lbl.style.color = color; }
  if (card) { card.style.borderColor = color; }
}

function gastosToggleSameVendor() {
  G.sameVendor = document.getElementById('gSameVendorChk').checked;
  document.getElementById('gSameVendorInput').style.display = G.sameVendor ? 'block' : 'none';
}

// ── EXTRACT dispatcher ─────────────────────────────────────────
async function gastosExtract() {
  if (!_gastosFiles.length) return;
  document.getElementById('gExtractBtn').disabled = true;
  document.getElementById('gExtractBtn').textContent = '⏳ Procesando...';
  document.getElementById('gProgressWrap').style.display = 'block';

  if (G.mode === 'single') {
    await gastosExtractSingleFlow(_gastosFiles[0]);
  } else {
    await gastosExtractBatchFlow(_gastosFiles);
  }
}

async function gastosExtractSingleFlow(file) {
  try {
    gastosSetProgress(20, 'Comprimiendo imagen...');
    const blob = await gastosCompressImage(file);
    G.currentBlob = blob;
    gastosSetProgress(55, 'Extrayendo datos con IA...');
    const b64  = await gastosToBase64(blob);
    const data = await gastosExtractReceipt(b64);
    gastosSetProgress(100, 'Listo ✓');
    setTimeout(() => {
      document.getElementById('gProgressWrap').style.display = 'none';
      gastosShowStep2(data, blob);
    }, 400);
  } catch(err) {
    alert('Error al procesar el recibo: ' + err.message);
    gastosResetExtractBtn();
  }
}

async function gastosExtractBatchFlow(files) {
  G.batch = files.map((f, i) => ({ file: f, index: i, status: 'pending', extracted: null, blob: null, dupFound: null }));
  const total = files.length;

  for (let i = 0; i < total; i++) {
    const item = G.batch[i];
    gastosSetProgress(Math.round(((i) / total) * 100), `Procesando ${i+1} de ${total}...`);
    gastosSetThumbStatus(i, '⏳ Procesando...', '#fef3c7', '#92400e');
    try {
      item.blob = await gastosCompressImage(item.file);
      const b64 = await gastosToBase64(item.blob);

      if (G.sameVendor && G.sameVendorName) {
        const partial = await gastosExtractSameVendor(b64, G.sameVendorName);
        item.extracted = { vendor: G.sameVendorName, description: '', ...partial };
      } else {
        item.extracted = await gastosExtractReceipt(b64);
      }

      // Duplicate check
      if (item.extracted.invoice_number && item.extracted.vendor) {
        item.dupFound = await gastosCheckDuplicate(item.extracted.vendor, item.extracted.invoice_number);
      }

      const missingCritical = !item.extracted.vendor || item.extracted.amount == null;
      item.status = item.dupFound ? 'duplicate' : missingCritical ? 'review' : 'ready';

      const statusMap = {
        ready:     ['Listo ✓',      '#dcfce7', '#166534'],
        review:    ['Revisar ⚠',   '#fef9c3', '#92400e'],
        duplicate: ['Duplicado ✗', '#fee2e2', '#991b1b'],
      };
      const [t, bg, c] = statusMap[item.status] || ['?', '#f1f5f9', '#64748b'];
      gastosSetThumbStatus(i, t, bg, c);
    } catch(err) {
      item.status = 'error';
      gastosSetThumbStatus(i, 'Error ✗', '#fee2e2', '#dc2626');
    }
    if (i < total - 1) await new Promise(r => setTimeout(r, 500));
  }

  gastosSetProgress(100, 'Procesamiento completado');
  gastosRenderBatchSummary();
}

function gastosSetProgress(pct, label) {
  const bar = document.getElementById('gProgressBar');
  const lbl = document.getElementById('gProgressLabel');
  if (bar) bar.style.width = pct + '%';
  if (lbl) lbl.textContent = label;
}

function gastosResetExtractBtn() {
  const btn = document.getElementById('gExtractBtn');
  if (btn) { btn.disabled = false; btn.textContent = '✨ Extraer datos con IA'; }
  document.getElementById('gProgressWrap').style.display = 'none';
}

function gastosRenderBatchSummary() {
  const ready = G.batch.filter(b => b.status === 'ready').length;
  const review = G.batch.filter(b => b.status === 'review').length;
  const dups   = G.batch.filter(b => b.status === 'duplicate').length;
  const errors = G.batch.filter(b => b.status === 'error').length;

  const el = document.getElementById('gBatchSummary');
  el.style.display = 'block';
  el.innerHTML = `
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px;margin-top:10px">
      <div style="font-weight:700;color:var(--navy);margin-bottom:10px">📊 Resultado del procesamiento</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:14px">
        <span style="background:#dcfce7;color:#166534;padding:3px 10px;border-radius:20px;font-size:.8rem;font-weight:700">✅ ${ready} listos</span>
        ${review > 0 ? `<span style="background:#fef9c3;color:#92400e;padding:3px 10px;border-radius:20px;font-size:.8rem;font-weight:700">⚠️ ${review} requieren revisión</span>` : ''}
        ${dups   > 0 ? `<span style="background:#fee2e2;color:#991b1b;padding:3px 10px;border-radius:20px;font-size:.8rem;font-weight:700">✗ ${dups} duplicados</span>` : ''}
        ${errors > 0 ? `<span style="background:#f1f5f9;color:#64748b;padding:3px 10px;border-radius:20px;font-size:.8rem;font-weight:700">✗ ${errors} errores</span>` : ''}
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">
        ${ready > 0 ? `<button class="btn btn-navy" onclick="gastosApproveAllReady()">✅ Aprobar todos los listos (${ready})</button>` : ''}
        <button class="btn" onclick="gastosReviewOneByOne(0)">Revisar uno por uno →</button>
      </div>
    </div>`;

  gastosResetExtractBtn();
}

// ── STEP 2: Review form ────────────────────────────────────────
function gastosShowStep2(extracted, blob, batchIndex = null) {
  G.currentEntry = { ...extracted, _batchIndex: batchIndex };
  G.currentBlob  = blob;
  G.dupFound     = null;
  G.forceOverride = false;

  const catResult = getCategoryForVendor(extracted.vendor || '');
  G.currentEntry._catResult = catResult;

  const step1 = document.getElementById('gastosStep1');
  const step2 = document.getElementById('gastosStep2');
  step1.style.display = 'none';
  step2.style.display = 'block';

  const hasWarning = !extracted.vendor || extracted.amount == null;
  const catOpts = GASTOS_CATEGORIES.map(c =>
    `<option value="${c}" ${c === catResult.category ? 'selected' : ''}>${c}</option>`
  ).join('');
  const catBorderColor = catResult.tier === 'locked' ? '#16a34a' : catResult.tier === 'ai' ? '#d97706' : '#dc2626';

  step2.innerHTML = `
  <div class="ccard">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:8px">
      <div style="font-weight:700;color:var(--navy);font-size:.9rem">📝 Paso 2 — Revisar y Confirmar</div>
      <button class="btn" style="font-size:.78rem" onclick="gastosBackToUpload()">← Nuevo recibo</button>
    </div>

    ${hasWarning ? `<div style="background:#fef9c3;border:1px solid #fde68a;border-radius:8px;padding:10px 14px;font-size:.82rem;color:#92400e;margin-bottom:12px">
      ⚠️ No pudimos leer todos los datos. Por favor verifica la foto o ingresa los datos manualmente.</div>` : ''}

    <div id="gDupAlert"></div>

    <div class="frow" style="margin-bottom:12px">
      <div class="field" style="flex:2">
        <label style="font-size:.8rem;font-weight:600;color:var(--text-mid)">Proveedor *</label>
        <input type="text" id="gVendor" value="${extracted.vendor || ''}" class="sinput"
          style="border-color:${!extracted.vendor ? '#d97706' : '#d1d5db'}"
          oninput="gastosOnVendorInput(this.value)"/>
      </div>
      <div class="field" style="flex:1">
        <label style="font-size:.8rem;font-weight:600;color:var(--text-mid)">Número de factura</label>
        <input type="text" id="gInvNum" value="${extracted.invoice_number || ''}" class="sinput"/>
      </div>
    </div>

    <div class="frow" style="margin-bottom:12px">
      <div class="field" style="flex:1">
        <label style="font-size:.8rem;font-weight:600;color:var(--text-mid)">Fecha de factura</label>
        <input type="text" id="gInvDate" value="${extracted.invoice_date || ''}" class="sinput" placeholder="MM/DD/YYYY"/>
      </div>
      <div class="field" style="flex:1">
        <label style="font-size:.8rem;font-weight:600;color:var(--text-mid)">Fecha de pago <span style="font-weight:400;color:#94a3b8">(opcional)</span></label>
        <input type="text" id="gPayDate" value="" class="sinput" placeholder="MM/DD/YYYY"/>
      </div>
    </div>

    <div class="frow" style="margin-bottom:12px">
      <div class="field" style="flex:1">
        <label style="font-size:.8rem;font-weight:600;color:var(--text-mid)">Monto *</label>
        <input type="number" id="gAmount" value="${extracted.amount ?? ''}" class="sinput" step="0.01" min="0"
          style="border-color:${extracted.amount == null ? '#d97706' : '#d1d5db'}"/>
      </div>
      <div class="field" style="flex:1">
        <label style="font-size:.8rem;font-weight:600;color:var(--text-mid)">Divisa</label>
        <select id="gCurrency" class="sinput">
          <option value="USD" selected>USD</option>
          <option value="EUR">EUR</option>
        </select>
      </div>
    </div>

    <div style="margin-bottom:12px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <label style="font-size:.8rem;font-weight:600;color:var(--text-mid);margin:0">Categoría de gasto *</label>
        <span id="gCatBadge">${gastosCategoryBadge(catResult.tier)}</span>
      </div>
      <select id="gCat" onchange="gastosOnCatChange()"
        style="width:100%;padding:9px 10px;border:2px solid ${catBorderColor};border-radius:7px;font-size:.875rem;background:#fff">
        <option value="">-- Seleccionar categoría --</option>
        ${catOpts}
      </select>
    </div>

    <div style="margin-bottom:14px">
      <label style="font-size:.8rem;font-weight:600;color:var(--text-mid);display:block;margin-bottom:4px">Descripción</label>
      <textarea id="gDesc" class="sinput" rows="2" style="width:100%;resize:vertical">${extracted.description || ''}</textarea>
    </div>

    <div style="display:flex;gap:10px;flex-wrap:wrap">
      <button class="btn btn-navy" id="gApproveBtn" onclick="gastosApproveEntry()"
        ${catResult.tier === 'human' && !catResult.category ? 'disabled' : ''}>
        ✅ Aprobar y guardar
      </button>
      <button class="btn" onclick="gastosBackToUpload()">🗑 Limpiar</button>
    </div>
  </div>`;

  // Async: duplicate check + AI category fallback
  const v = extracted.vendor, n = extracted.invoice_number;
  if (v && n) gastosCheckAndShowDup(v, n);
  if (catResult.tier === 'human' && extracted.description) {
    gastosAiCategory(v, extracted.description).then(r => {
      if (!r?.category) return;
      const sel = document.getElementById('gCat');
      if (sel) {
        sel.value = r.category;
        sel.style.borderColor = '#d97706';
        document.getElementById('gCatBadge').innerHTML = gastosCategoryBadge('ai');
        gastosOnCatChange();
      }
    }).catch(() => {});
  }
}

function gastosOnVendorInput(val) {
  const cat = getCategoryForVendor(val);
  const sel = document.getElementById('gCat');
  const badge = document.getElementById('gCatBadge');
  if (sel && cat.category) {
    sel.value = cat.category;
    sel.style.borderColor = cat.tier === 'locked' ? '#16a34a' : cat.tier === 'ai' ? '#d97706' : '#dc2626';
  }
  if (badge) badge.innerHTML = gastosCategoryBadge(cat.tier);
  gastosOnCatChange();
}

function gastosOnCatChange() {
  const val = document.getElementById('gCat')?.value;
  const btn = document.getElementById('gApproveBtn');
  if (btn) btn.disabled = !val || (G.dupFound && !G.forceOverride);
}

async function gastosCheckAndShowDup(vendor, invoiceNumber) {
  const dup = await gastosCheckDuplicate(vendor, invoiceNumber);
  G.dupFound = dup;
  const el = document.getElementById('gDupAlert');
  if (!el) return;
  if (!dup) { el.innerHTML = ''; return; }

  el.innerHTML = `
    <div style="background:#fee2e2;border:1px solid #fecaca;border-radius:8px;padding:12px 14px;margin-bottom:12px">
      <div style="font-weight:700;color:#dc2626;margin-bottom:6px">⚠️ Esta factura ya fue ingresada</div>
      <div style="font-size:.82rem;color:#7f1d1d;margin-bottom:10px">
        Proveedor: ${dup.vendor} · Fecha: ${gastosFormatDate(dup.invoice_date)} · Monto: $${parseFloat(dup.amount||0).toFixed(2)} · Estado: ${dup.status}
      </div>
      <button class="btn" style="font-size:.78rem;border-color:#dc2626;color:#dc2626" onclick="gastosForceOverride()">
        Ignorar y guardar de todas formas
      </button>
    </div>`;
  const btn = document.getElementById('gApproveBtn');
  if (btn) btn.disabled = true;
}

function gastosForceOverride() {
  G.forceOverride = true;
  G.dupFound = null;
  document.getElementById('gDupAlert').innerHTML = `
    <div style="background:#fef9c3;border:1px solid #fde68a;border-radius:8px;padding:8px 12px;margin-bottom:12px;font-size:.82rem;color:#92400e">
      ⚠️ Guardando como duplicado confirmado — haz clic en "Aprobar y guardar" para confirmar.
    </div>`;
  gastosOnCatChange();
}

async function gastosApproveEntry() {
  const vendor   = document.getElementById('gVendor')?.value.trim();
  const invNum   = document.getElementById('gInvNum')?.value.trim();
  const invDate  = document.getElementById('gInvDate')?.value.trim();
  const payDate  = document.getElementById('gPayDate')?.value.trim();
  const amount   = parseFloat(document.getElementById('gAmount')?.value || '');
  const currency = document.getElementById('gCurrency')?.value || 'USD';
  const category = document.getElementById('gCat')?.value;
  const desc     = document.getElementById('gDesc')?.value.trim();

  if (!vendor)   { alert('Por favor ingresa el nombre del proveedor.'); return; }
  if (!category) { alert('Por favor selecciona una categoría de gasto.'); return; }
  if (!amount || isNaN(amount)) { alert('Por favor ingresa un monto válido.'); return; }

  const btn = document.getElementById('gApproveBtn');
  btn.disabled = true; btn.textContent = 'Guardando...';

  try {
    const catResult = getCategoryForVendor(vendor);
    const entry = {
      vendor, invoice_number: invNum || null,
      invoice_date: invDate ? gastosParseDate(invDate) : null,
      payment_date: payDate ? gastosParseDate(payDate) : null,
      currency, amount, expense_category: category,
      description: desc || null,
      category_tier: G.currentEntry._catResult?.tier || catResult.tier,
      category_confidence: G.currentEntry._catResult?.confidence || catResult.confidence,
      status: 'approved'
    };

    const saved = await gastosSaveEntry(entry);

    // Upload image async (non-blocking)
    if (G.currentBlob) {
      gastosUploadImage(G.currentBlob, saved.id).then(url => {
        if (url) getSupa().from('gastos_entries').update({ receipt_image_url: url }).eq('id', saved.id);
      });
    }

    gastosShowStep3Single(saved);
    gastosRenderQueue();
    gastosRenderHistory();
  } catch(err) {
    alert('Error al guardar: ' + err.message);
    btn.disabled = false; btn.textContent = '✅ Aprobar y guardar';
  }
}

function gastosBackToUpload() {
  document.getElementById('gastosStep2').style.display = 'none';
  document.getElementById('gastosStep1').style.display = 'block';
  _gastosFiles = [];
  G.currentEntry = null; G.currentBlob = null; G.dupFound = null; G.forceOverride = false;
  gastosRenderUpload();
}

// ── STEP 3: Single entry ready panel ──────────────────────────
function gastosShowStep3Single(entry) {
  const step2 = document.getElementById('gastosStep2');
  step2.innerHTML = `
  <div class="ccard">
    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:8px">
      <div style="font-weight:700;color:var(--navy);font-size:.9rem">✅ Listo para ingresar en Gastos</div>
      <button class="btn" style="font-size:.78rem" onclick="gastosBackToUpload()">+ Nuevo recibo</button>
    </div>

    <!-- Status pill row -->
    <div style="display:flex;margin-bottom:18px;border-radius:8px;overflow:hidden;border:1px solid #e2e8f0">
      ${['Pendiente','Aprobado','Ingresado'].map((s,i) => `
        <div style="flex:1;padding:10px 8px;text-align:center;font-size:.75rem;font-weight:700;
          background:${i===1?'var(--navy)':'#f8fafc'};color:${i===1?'#fff':'var(--text-mid)'};
          border-right:${i<2?'1px solid #e2e8f0':'none'}">
          ${['○','★','✓'][i]} ${s}
        </div>`).join('')}
    </div>

    <div style="font-size:.72rem;font-weight:700;color:var(--text-mid);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Página 1 — Add Invoice</div>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;margin-bottom:10px">
      ${gastosRORow('Supplier', entry.vendor)}
      ${gastosRORow('Invoice Number', entry.invoice_number || '—')}
      ${gastosRORow('Invoice Date', gastosFormatDate(entry.invoice_date))}
      ${gastosRORow('Currency', entry.currency || 'USD')}
    </div>
    <div style="font-size:.72rem;font-weight:700;color:var(--text-mid);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Página 2 — Add Invoice Detail</div>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;margin-bottom:10px">
      ${gastosRORow('Expense Category', entry.expense_category || '—')}
      ${gastosRORow('Amount', `$${parseFloat(entry.amount||0).toFixed(2)}`)}
      ${gastosRORow('Description', entry.description || '—')}
    </div>
    <div style="font-size:.72rem;font-weight:700;color:var(--text-mid);text-transform:uppercase;letter-spacing:.06em;margin-bottom:8px">Página 3 — Edit Invoice</div>
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px 14px;margin-bottom:16px">
      ${gastosRORow('Payment Date', gastosFormatDate(entry.payment_date))}
    </div>

    <button class="btn btn-navy" id="gMarkEnteredBtn_${entry.id}"
      onclick="gastosMarkEntered('${entry.id}', this)" style="width:100%;padding:12px">
      ✅ Marcar como ingresado en Gastos
    </button>
  </div>`;
}

function gastosRORow(label, value) {
  return `<div style="display:flex;align-items:baseline;gap:12px;padding:5px 0;border-bottom:1px solid #f1f5f9">
    <span style="font-size:.75rem;font-weight:700;color:var(--text-mid);min-width:140px;flex-shrink:0">${label}</span>
    <span style="font-size:.9rem;font-weight:600;color:var(--navy)">${value}</span>
  </div>`;
}

async function gastosMarkEntered(id, btn) {
  btn.disabled = true; btn.textContent = 'Actualizando...';
  try {
    await gastosUpdateStatus(id, 'entered');
    btn.textContent = '✓ Ingresado en Gastos';
    btn.style.background = '#16a34a';
    btn.style.borderColor = '#16a34a';
    gastosRenderQueue();
    gastosRenderHistory();
  } catch(err) {
    alert('Error: ' + err.message);
    btn.disabled = false; btn.textContent = '✅ Marcar como ingresado en Gastos';
  }
}

// ── Batch approve all ready ────────────────────────────────────
async function gastosApproveAllReady() {
  const readyItems = G.batch.filter(b => b.status === 'ready');
  if (!readyItems.length) return;
  const btn = event.currentTarget;
  btn.disabled = true; btn.textContent = `Guardando ${readyItems.length}...`;
  let saved = 0;
  for (const item of readyItems) {
    try {
      const catResult = getCategoryForVendor(item.extracted.vendor || '');
      const entry = {
        vendor: item.extracted.vendor,
        invoice_number: item.extracted.invoice_number || null,
        invoice_date: item.extracted.invoice_date ? gastosParseDate(item.extracted.invoice_date) : null,
        amount: item.extracted.amount,
        expense_category: catResult.category,
        description: item.extracted.description || null,
        category_tier: catResult.tier,
        category_confidence: catResult.confidence,
        currency: 'USD', status: 'approved'
      };
      const rec = await gastosSaveEntry(entry);
      if (item.blob) {
        gastosUploadImage(item.blob, rec.id).then(url => {
          if (url) getSupa().from('gastos_entries').update({ receipt_image_url: url }).eq('id', rec.id);
        });
      }
      item.status = 'saved';
      saved++;
    } catch(e) { console.error('Batch save error:', e); }
  }
  alert(`✅ ${saved} entrada(s) guardadas exitosamente.`);
  gastosRenderQueue();
  gastosRenderHistory();
  gastosBackToUpload();
}

// ── Batch review one by one ────────────────────────────────────
function gastosReviewOneByOne(startIndex) {
  const pending = G.batch.filter(b => b.status !== 'saved' && b.status !== 'error');
  if (!pending.length || startIndex >= G.batch.length) {
    gastosBackToUpload();
    gastosRenderHistory();
    return;
  }
  // Find next non-saved item from startIndex
  let idx = startIndex;
  while (idx < G.batch.length && (G.batch[idx].status === 'saved' || G.batch[idx].status === 'error')) idx++;
  if (idx >= G.batch.length) { gastosBackToUpload(); return; }

  const item = G.batch[idx];
  const origApprove = window.gastosApproveEntry;

  // Show step 2 for this item
  gastosShowStep2(item.extracted, item.blob, idx);

  // Patch approve to advance to next after saving
  const nextIdx = idx + 1;
  const approveBtn = document.getElementById('gApproveBtn');
  if (approveBtn) {
    approveBtn.onclick = async () => {
      await gastosApproveEntry();
      item.status = 'saved';
      gastosReviewOneByOne(nextIdx);
    };
  }
}

// ── Entry Queue (grouped, sorted) ─────────────────────────────
async function gastosRenderQueue() {
  const el = document.getElementById('gastosQueueArea');
  if (!el) return;
  try {
    const all = await gastosLoadHistory('approved');
    const sorted = sortForGastosEntry(all);
    if (!sorted.length) { el.innerHTML = ''; return; }

    // Group by vendor
    const groups = {};
    sorted.forEach(e => { if (!groups[e.vendor]) groups[e.vendor] = []; groups[e.vendor].push(e); });

    el.innerHTML = `
      <div class="ccard">
        <div style="font-weight:700;color:var(--navy);font-size:.9rem;margin-bottom:14px">
          📋 Cola de entrada en Gastos
          <span style="font-weight:400;font-size:.78rem;color:var(--text-mid)"> — agrupado por proveedor</span>
        </div>
        ${Object.entries(groups).map(([vendor, items]) => `
          <div style="margin-bottom:18px">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
              <span style="font-weight:700;color:var(--navy)">${vendor}</span>
              <span style="background:#e0f2fe;color:#0369a1;padding:2px 8px;border-radius:10px;font-size:.72rem;font-weight:700">${items.length} factura(s)</span>
            </div>
            ${items.map(e => `
              <div id="qRow_${e.id}" style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:6px;flex-wrap:wrap">
                <span style="font-size:.82rem;color:var(--text-mid);min-width:92px">${gastosFormatDate(e.invoice_date)}</span>
                <span style="font-size:.82rem;color:#374151;flex:1">Inv #${e.invoice_number || '—'}</span>
                <span style="font-size:.9rem;font-weight:700;color:var(--navy)">$${parseFloat(e.amount||0).toFixed(2)}</span>
                <button class="btn" style="font-size:.75rem;padding:4px 10px;border-color:#16a34a;color:#16a34a;white-space:nowrap"
                  onclick="gastosMarkEnteredFromQueue('${e.id}', this)">Ingresar ✓</button>
              </div>`).join('')}
          </div>`).join('')}
      </div>`;
  } catch(err) { console.error('Queue render error:', err); }
}

async function gastosMarkEnteredFromQueue(id, btn) {
  btn.disabled = true; btn.textContent = '✓';
  try {
    await gastosUpdateStatus(id, 'entered');
    const row = document.getElementById(`qRow_${id}`);
    if (row) { row.style.opacity = '0.4'; row.style.textDecoration = 'line-through'; btn.style.background = '#dcfce7'; }
    gastosRenderHistory();
  } catch(err) { alert('Error: ' + err.message); btn.disabled = false; btn.textContent = 'Ingresar ✓'; }
}

// ── History table ──────────────────────────────────────────────
async function gastosRenderHistory() {
  const el = document.getElementById('gastosHistoryArea');
  if (!el) return;
  try {
    const entries = await gastosLoadHistory(G.historyFilter);
    const filters = ['all','pending','approved','entered'];
    const filterLabels = { all:'Todos', pending:'Pendientes', approved:'Aprobados', entered:'Ingresados' };
    const filterBtns = filters.map(f =>
      `<button class="btn ${G.historyFilter === f ? 'btn-navy' : ''}" style="font-size:.75rem;padding:4px 12px"
        onclick="G.historyFilter='${f}';gastosRenderHistory()">
        ${filterLabels[f]}
      </button>`).join('');

    if (!entries.length) {
      el.innerHTML = `<div class="ccard">
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">${filterBtns}</div>
        <div style="color:var(--text-mid);text-align:center;padding:24px;font-style:italic">No hay entradas registradas.</div>
      </div>`;
      return;
    }

    const rows = entries.map(e => `
      <tr id="histRow_${e.id}" style="transition:background .15s" onmouseover="this.style.background='#f8fafc'" onmouseout="this.style.background=''">
        <td style="padding:8px 10px;font-size:.82rem;cursor:pointer" onclick="gastosOpenFromHistory(${JSON.stringify(e).replace(/"/g,'&quot;')})">${gastosFormatDate(e.invoice_date)}</td>
        <td style="padding:8px 10px;font-size:.82rem;font-weight:600;cursor:pointer" onclick="gastosOpenFromHistory(${JSON.stringify(e).replace(/"/g,'&quot;')})">${e.vendor}</td>
        <td style="padding:8px 10px;font-size:.82rem;cursor:pointer" onclick="gastosOpenFromHistory(${JSON.stringify(e).replace(/"/g,'&quot;')})">${e.invoice_number || '—'}</td>
        <td style="padding:8px 10px;font-size:.85rem;font-weight:700;color:var(--navy);cursor:pointer" onclick="gastosOpenFromHistory(${JSON.stringify(e).replace(/"/g,'&quot;')})">$${parseFloat(e.amount||0).toFixed(2)}</td>
        <td style="padding:8px 10px;font-size:.78rem;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer" title="${e.expense_category||''}" onclick="gastosOpenFromHistory(${JSON.stringify(e).replace(/"/g,'&quot;')})">${e.expense_category||'—'}</td>
        <td style="padding:8px 10px;cursor:pointer" onclick="gastosOpenFromHistory(${JSON.stringify(e).replace(/"/g,'&quot;')})">${gastosStatusBadge(e.status)}</td>
        <td style="padding:8px 10px;text-align:center" onclick="event.stopPropagation()">
          <button onclick="gastosConfirmDelete('${e.id}')"
            style="background:none;border:1px solid #fca5a5;border-radius:6px;color:#dc2626;font-size:.75rem;padding:3px 8px;cursor:pointer;line-height:1.4"
            title="Eliminar esta entrada">🗑</button>
        </td>
      </tr>`).join('');

    el.innerHTML = `
      <div class="ccard">
        <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:14px">
          <div style="font-weight:700;color:var(--navy);font-size:.9rem">📂 Historial de Entradas</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">${filterBtns}</div>
        </div>
        <div style="overflow-x:auto">
          <table style="width:100%;border-collapse:collapse">
            <thead><tr style="background:#f8fafc;border-bottom:2px solid #e2e8f0">
              <th style="padding:8px 10px;text-align:left;font-size:.75rem;color:var(--text-mid);white-space:nowrap">Fecha</th>
              <th style="padding:8px 10px;text-align:left;font-size:.75rem;color:var(--text-mid)">Proveedor</th>
              <th style="padding:8px 10px;text-align:left;font-size:.75rem;color:var(--text-mid)">Factura #</th>
              <th style="padding:8px 10px;text-align:left;font-size:.75rem;color:var(--text-mid)">Monto</th>
              <th style="padding:8px 10px;text-align:left;font-size:.75rem;color:var(--text-mid)">Categoría</th>
              <th style="padding:8px 10px;text-align:left;font-size:.75rem;color:var(--text-mid)">Estado</th>
              <th style="padding:8px 10px;text-align:center;font-size:.75rem;color:var(--text-mid)"></th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>`;
  } catch(err) {
    el.innerHTML = `<div class="ccard" style="color:#dc2626;font-size:.85rem">Error al cargar historial: ${err.message}</div>`;
  }
}

async function gastosConfirmDelete(id) {
  if (!confirm('¿Eliminar esta entrada?\n\nEsta acción no se puede deshacer.')) return;
  const row = document.getElementById('histRow_' + id);
  if (row) { row.style.opacity = '0.4'; row.style.pointerEvents = 'none'; }
  try {
    await gastosDeleteEntry(id);
    if (row) { row.style.transition = 'opacity .3s'; row.style.opacity = '0'; setTimeout(() => row.remove(), 320); }
    gastosRenderQueue();
    gastosRenderHistory();
    showToast('🗑 Entrada eliminada.');
  } catch(err) {
    if (row) { row.style.opacity = '1'; row.style.pointerEvents = ''; }
    alert('Error al eliminar: ' + err.message);
  }
}

function gastosOpenFromHistory(entry) {
  document.getElementById('gastosStep1')?.scrollIntoView({ behavior: 'smooth' });
  if (entry.status === 'approved') {
    gastosShowStep3Single(entry);
  } else {
    gastosShowStep2(
      { vendor: entry.vendor, invoice_number: entry.invoice_number,
        invoice_date: gastosFormatDate(entry.invoice_date),
        amount: entry.amount, description: entry.description },
      null
    );
  }
}

// ── SQL to run in Supabase ─────────────────────────────────────
// create table gastos_entries (
//   id uuid default gen_random_uuid() primary key,
//   created_at timestamp with time zone default now(),
//   created_by uuid references auth.users(id),
//   vendor text not null,
//   invoice_number text,
//   invoice_date date,
//   payment_date date,
//   currency text default 'USD',
//   amount numeric(10,2),
//   expense_category text,
//   description text,
//   category_tier text,
//   category_confidence integer,
//   status text default 'pending',
//   receipt_image_url text,
//   notes text
// );

// ══════════════════════════════════════════════════════════════════
// WRITE-UPS MODULE — Sistema de Amonestaciones Disciplinarias
// Fixed legal templates — consistent language every time
// ══════════════════════════════════════════════════════════════════

const WU_PROXY_URL = `${SUPABASE_URL}/functions/v1/claude-proxy`;

const WU = {
  currentEmpKey: null, currentEmpName: null, currentRecords: [],
  LEVELS: { verbal:'Amonestación Verbal', escrita:'Amonestación Escrita', final:'Amonestación Final Escrita', terminacion:'Terminación' },
  FALTA_MAP: { verbal:'Amonestación Escrita', escrita:'Amonestación Final Escrita', final:'Terminación', terminacion:'N/A — Nivel máximo' },
  suggestLevel(records, category) {
    if (!records || !records.length || !category) return 'verbal';
    const prog = { verbal:'escrita', escrita:'final', final:'terminacion', terminacion:'terminacion' };
    const cat = records.filter(r => r.category === category).sort((a,b) => new Date(b.created_at)-new Date(a.created_at));
    return cat.length ? (prog[cat[0].level] || 'verbal') : 'verbal';
  },
  getShiftString() {
    const v = id => document.getElementById(id)?.value || '';
    const sh=String(v('wuShiftStartH')).padStart(2,'0'), sm=String(v('wuShiftStartM')).padStart(2,'0'), sap=v('wuShiftStartAMPM');
    const eh=String(v('wuShiftEndH')).padStart(2,'0'),   em=String(v('wuShiftEndM')).padStart(2,'0'),   eap=v('wuShiftEndAMPM');
    return `${sh}:${sm} ${sap} – ${eh}:${em} ${eap}`;
  },
  async fetchRecords(k) {
    try { const {data,error}=await getSupa().from('wu_records').select('*').eq('emp_id',k).order('created_at',{ascending:false}); if(error)throw error; return data||[]; }
    catch { return(JSON.parse(localStorage.getItem('wu_records')||'[]')).filter(r=>r.emp_id===k).sort((a,b)=>new Date(b.created_at)-new Date(a.created_at)); }
  },
  async saveRecord(r) {
    try { const {data,error}=await getSupa().from('wu_records').insert(r).select().single(); if(error)throw error; return data; }
    catch { const all=JSON.parse(localStorage.getItem('wu_records')||'[]'); const rec={...r,id:'local_'+Date.now()}; all.push(rec); localStorage.setItem('wu_records',JSON.stringify(all)); return rec; }
  },
  async deleteAllRecords(k) {
    try { const {error}=await getSupa().from('wu_records').delete().eq('emp_id',k); if(error)throw error; }
    catch { const all=JSON.parse(localStorage.getItem('wu_records')||'[]'); localStorage.setItem('wu_records',JSON.stringify(all.filter(r=>r.emp_id!==k))); }
  }
};

// ══════════════════════════════════════════
// WRITE-UP PENDING REVIEW QUEUE
// ══════════════════════════════════════════
async function wuLoadPendingQueue() {
  const container = document.getElementById('wuPendingQueue');
  if (!container) return;
  try {
    const { data, error } = await getSupa()
      .from('wu_submissions')
      .select('*')
      .order('submitted_at', { ascending: false });
    if (error) throw error;
    const pending = (data || []).filter(s => s.status === 'pending');
    const reviewed = (data || []).filter(s => s.status !== 'pending');
    wuRenderQueue(pending, reviewed);
  } catch(e) {
    const container = document.getElementById('wuPendingQueue');
    if (container) container.innerHTML = '<p style="color:#888;font-size:.85rem">Error cargando cola. Verifique conexión.</p>';
  }
}

function wuRenderQueue(pending, reviewed) {
  const container = document.getElementById('wuPendingQueue');
  if (!container) return;

  const pendingHtml = pending.length ? pending.map(s => `
    <div style="border:2px solid #fbbf24;border-radius:10px;padding:16px;margin-bottom:12px;background:#fffbeb">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:8px;margin-bottom:10px">
        <div>
          <div style="font-weight:700;font-size:.95rem;color:var(--navy)">${s.emp_name}</div>
          <div style="font-size:.78rem;color:#6b7280;margin-top:2px">
            Reportado por: <strong>${s.leader_name}</strong> · ${s.category} · ${s.inc_date}
          </div>
          <div style="font-size:.75rem;color:#9ca3af;margin-top:2px">Enviado: ${new Date(s.submitted_at).toLocaleString('es-PR')}</div>
        </div>
        <span class="badge" style="background:#fef3c7;color:#92400e;font-size:.72rem">⏳ Pendiente</span>
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn btn-navy btn-sm" onclick="wuReviewSubmission('${s.id}')">📋 Revisar y Generar</button>
        <button class="btn btn-sm" onclick="wuDeleteSubmission('${s.id}')" style="border-color:#dc2626;color:#dc2626;font-size:.75rem;padding:4px 10px">🗑 Eliminar</button>
      </div>
    </div>`).join('')
    : '<div style="color:#16a34a;font-size:.85rem;padding:12px 0">✅ No hay amonestaciones pendientes de revisión.</div>';

  const reviewedHtml = reviewed.length ? `
    <div style="margin-top:20px">
      <div style="font-size:.85rem;font-weight:700;color:var(--navy);margin-bottom:10px">Historial</div>
      ${reviewed.slice(0,10).map(s => `
        <div style="border:1px solid #e5e7eb;border-radius:8px;padding:12px;margin-bottom:8px;background:#fff;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <div>
            <div style="font-weight:600;font-size:.88rem">${s.emp_name} — ${s.category}</div>
            <div style="font-size:.75rem;color:#6b7280">${s.inc_date} · Por: ${s.leader_name}</div>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span class="badge" style="background:${s.status==='approved'?'#dcfce7':'#fee2e2'};color:${s.status==='approved'?'#16a34a':'#991b1b'};font-size:.7rem">
              ${s.status==='approved'?'✅ Aprobado':'✗ Rechazado'}
            </span>
            ${s.status==='approved' ? `<button class="btn btn-sm" onclick="wuPrintApproved('${s.id}')" style="border-color:#7c3aed;color:#7c3aed;font-size:.75rem;padding:4px 10px">🖨 Imprimir</button>` : ''}
            <button class="btn btn-sm" onclick="wuDeleteSubmission('${s.id}')" style="border-color:#dc2626;color:#dc2626;font-size:.75rem;padding:4px 10px">🗑</button>
          </div>
        </div>`).join('')}
    </div>` : '';

  container.innerHTML = `
    <div style="font-size:.85rem;font-weight:700;color:var(--navy);margin-bottom:12px">
      Reportes Pendientes (${pending.length})
    </div>
    ${pendingHtml}
    ${reviewedHtml}`;
}

async function wuReviewSubmission(id) {
  try {
    const { data, error } = await getSupa().from('wu_submissions').select('*').eq('id', id).single();
    if (error) throw error;
    showWuReviewModal(data);
  } catch(e) {
    alert('Error cargando el reporte. Intente nuevamente.');
  }
}

function showWuReviewModal(s) {
  // Build field summary
  const fieldLines = Object.entries(s.fields || {}).map(([k, v]) => v ? `<li><strong>${k}:</strong> ${v}</li>` : '').filter(Boolean).join('');

  const modal = document.createElement('div');
  modal.id = 'wuReviewModal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:999;display:flex;align-items:flex-start;justify-content:center;padding:20px;overflow-y:auto';
  modal.innerHTML = `
    <div style="background:#fff;border-radius:14px;max-width:620px;width:100%;padding:28px;margin:auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <h3 style="margin:0;color:var(--navy);font-size:1.1rem">📋 Revisar Reporte de Amonestación</h3>
        <button onclick="document.getElementById('wuReviewModal').remove()" style="background:none;border:none;font-size:1.2rem;cursor:pointer;color:#6b7280">✕</button>
      </div>

      <div style="background:#f8fafc;border-radius:10px;padding:16px;margin-bottom:16px;font-size:.85rem">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div><span style="color:#6b7280">Empleado:</span> <strong>${s.emp_name}</strong></div>
          <div><span style="color:#6b7280">Categoría:</span> <strong>${s.category}</strong></div>
          <div><span style="color:#6b7280">Fecha:</span> <strong>${s.inc_date}</strong></div>
          <div><span style="color:#6b7280">Turno:</span> <strong>${s.shift_start||'—'} a ${s.shift_end||'—'}</strong></div>
          <div><span style="color:#6b7280">Reportado por:</span> <strong>${s.leader_name}</strong></div>
          <div><span style="color:#6b7280">Hora incidente:</span> <strong>${s.inc_time||'—'}</strong></div>
        </div>
      </div>

      <div style="margin-bottom:14px">
        <div style="font-size:.78rem;font-weight:700;color:#6b7280;margin-bottom:6px;text-transform:uppercase">Información del Incidente</div>
        <ul style="font-size:.82rem;line-height:1.8;padding-left:16px;color:#374151">${fieldLines}</ul>
        ${s.extra_notes ? `<div style="margin-top:8px;font-size:.82rem;color:#374151"><strong>Notas adicionales:</strong> ${s.extra_notes}</div>` : ''}
      </div>

      <div style="margin-bottom:16px">
        <div style="font-size:.78rem;font-weight:700;color:#6b7280;margin-bottom:6px;text-transform:uppercase">Verificación del Director</div>
        <label style="font-size:.82rem;font-weight:600;color:#374151;display:block;margin-bottom:4px">Confirme el nombre exacto del empleado <span style="color:#dc2626">*</span></label>
        <input type="text" id="wuReviewEmpName" placeholder="Escriba el nombre completo del empleado" style="width:100%;padding:10px;border:1.5px solid #d1d5db;border-radius:8px;font-size:.88rem"/>
        <label style="font-size:.82rem;font-weight:600;color:#374151;display:block;margin:12px 0 4px">Observaciones del director (opcional)</label>
        <textarea id="wuReviewNotes" rows="2" placeholder="Notas internas del director..." style="width:100%;padding:10px;border:1.5px solid #d1d5db;border-radius:8px;font-size:.88rem;resize:vertical"></textarea>
      </div>

      <div id="wuReviewErr" style="display:none;background:#fee2e2;color:#991b1b;border-radius:8px;padding:10px;font-size:.83rem;margin-bottom:12px"></div>

      <div style="display:flex;gap:10px;flex-wrap:wrap">
        <button class="btn btn-navy" style="flex:1" onclick="wuApproveSubmission('${s.id}', '${s.emp_name}')">✅ Aprobar y Generar</button>
        <button class="btn btn-red2" style="flex:1" onclick="wuRejectSubmission('${s.id}')">✗ Rechazar</button>
      </div>
    </div>`;

  document.body.appendChild(modal);
  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
}

async function wuApproveSubmission(id, originalEmpName) {
  const confirmedName = document.getElementById('wuReviewEmpName').value.trim();
  const reviewNotes = document.getElementById('wuReviewNotes').value.trim();
  const errEl = document.getElementById('wuReviewErr');

  if (!confirmedName) {
    errEl.textContent = 'Debe confirmar el nombre del empleado para aprobar.';
    errEl.style.display = 'block';
    return;
  }

  try {
    // Get submission details to generate the write-up
    const { data: s, error } = await getSupa().from('wu_submissions').select('*').eq('id', id).single();
    if (error) throw error;

    // Generate the write-up text using existing build functions
    const f = s.fields || {};
    const shiftStr = `${s.shift_start||''} a ${s.shift_end||''}`;
    const dateFormatted = s.inc_date ? new Date(s.inc_date + 'T12:00:00').toLocaleDateString('es-PR', {year:'numeric',month:'long',day:'numeric'}) : s.inc_date;

    // Determine level based on history
    const empKey = s.emp_key;
    let existingRecords = [];
    if (empKey) {
      const { data: recs } = await getSupa().from('wu_records').select('*').eq('emp_id', empKey);
      existingRecords = recs || [];
    }
    const level = WU.suggestLevel(existingRecords, s.category);

    const doc = wuBuildDocument({ empName: confirmedName, cat: s.category, level, sup: s.leader_name, dateFormatted, shift: shiftStr, fields: f });

    // Save as approved wu_record
    const record = {
      emp_id: empKey || confirmedName.toLowerCase().replace(/\s+/g,'_'),
      emp_name: confirmedName,
      date: s.inc_date,
      level,
      category: s.category,
      supervisor: s.leader_name,
      shift: shiftStr,
      incident: doc.incidente,
      corrective: doc.correctiva,
      consequence: doc.consecuencia,
      director_notes: reviewNotes,
      submission_id: id,
      created_at: new Date().toISOString()
    };

    await WU.saveRecord(record);

    // Update submission status
    await getSupa().from('wu_submissions').update({ status: 'approved', reviewed_at: new Date().toISOString(), reviewed_emp_name: confirmedName, director_notes: reviewNotes }).eq('id', id);

    document.getElementById('wuReviewModal').remove();
    wuLoadPendingQueue();

    // Also refresh the employee history if this employee is open
    if (WU.currentEmpKey === empKey) {
      WU.currentRecords = await WU.fetchRecords(empKey);
      wuRenderHistory(WU.currentRecords);
    }

    showToast('✅ Amonestación aprobada y guardada en el expediente de ' + confirmedName);

    // Open print immediately
    setTimeout(() => wuPrintFromRecord(record), 500);

  } catch(e) {
    document.getElementById('wuReviewErr').textContent = 'Error al aprobar: ' + e.message;
    document.getElementById('wuReviewErr').style.display = 'block';
  }
}

async function wuRejectSubmission(id) {
  if (!confirm('¿Está seguro que desea rechazar este reporte? Se mantendrá en el historial como rechazado.')) return;
  try {
    await getSupa().from('wu_submissions').update({ status: 'rejected', reviewed_at: new Date().toISOString() }).eq('id', id);
    document.getElementById('wuReviewModal').remove();
    wuLoadPendingQueue();
    showToast('✗ Reporte rechazado.');
  } catch(e) {
    alert('Error al rechazar: ' + e.message);
  }
}

async function wuDeleteSubmission(id) {
  if (!confirm('¿Está seguro que desea eliminar este reporte? Esta acción no se puede deshacer.')) return;
  try {
    // Also delete associated wu_record if exists
    await getSupa().from('wu_records').delete().eq('submission_id', id);
    await getSupa().from('wu_submissions').delete().eq('id', id);
    wuLoadPendingQueue();
    showToast('🗑 Reporte eliminado.');
  } catch(e) {
    alert('Error al eliminar: ' + e.message);
  }
}

async function wuPrintApproved(submissionId) {
  try {
    const { data } = await getSupa().from('wu_records').select('*').eq('submission_id', submissionId).single();
    if (data) wuPrintFromRecord(data);
  } catch(e) {
    alert('No se encontró el expediente para imprimir.');
  }
}

function wuPrintFromRecord(record) {
  // Use existing wuPrintRecord logic but with record data directly
  const WUcopy = { currentEmpName: record.emp_name };
  const level = record.level;
  const cat = record.category;
  const sup = record.supervisor;
  const date = record.date;
  const shift = record.shift;
  // Pre-process newlines before embedding in template literal
  const incident = (record.incident||'').split('\n').join('<br/>');
  const corrective = (record.corrective||'').split('\n').join('<br/>');
  const consequence = (record.consequence||'').split('\n').join('<br/>');
  const today = new Date().toLocaleDateString('es-PR',{year:'numeric',month:'long',day:'numeric'});
  const incDateFmt = date ? new Date(date+'T12:00:00').toLocaleDateString('es-PR',{year:'numeric',month:'long',day:'numeric'}) : '';

  const allCats=[['Política de Salud','Funciones, Responsabilidades y Requisitos de Liderazgo','Asistencia y Puntualidad','Ausencia Injustificada','Pausas y Comidas de Empleados','Deberes y Responsabilidades del Puesto','Normas de Conducta','Ambiente de Trabajo Civil y Respetuoso','Inocuidad de Alimentos / Seguridad Alimentaria'],['Apariencia y Aseo Personal','Igualdad de Oportunidad de Empleo y Política de No Acoso','Seguridad en el Lugar de Trabajo','Comunicaciones Telefónicas','Responsabilidad de Efectivo y Cupones','Política de Uniformes']];
  const catItem=c=>{const chk=c===cat||( cat==='Asistencia y Puntualidad' && c==='Asistencia y Puntualidad');return`<div style="display:flex;align-items:center;gap:6px;padding:1.5px 0;font-size:9pt;${chk?'font-weight:700;color:#004f71;':''}"><div style="width:13px;height:13px;border:1.5px solid #004f71;border-radius:2px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:9pt;${chk?'background:#e0f2fe;color:#c1121f;font-weight:900;':''}">${chk?'✓':''}</div><span>${c}</span></div>`;};
  const faltaMap={verbal:'escrita',escrita:'final',final:'terminacion',terminacion:'terminacion'};const faltaKey=faltaMap[level];
  const levelRows=[{key:'verbal',label:'Amonestación Verbal'},{key:'escrita',label:'Amonestación Escrita'},{key:'final',label:'Amonestación Final Escrita'}];
  const faltaRows=[{key:'escrita',label:'Amonestación Escrita'},{key:'final',label:'Amonestación Final Escrita'},{key:'terminacion',label:'Terminación'}];
  const chkRow=(rows,active)=>rows.map(r=>`<div style="display:flex;align-items:center;gap:7px;font-size:9pt;${r.key===active?'font-weight:700;':''}"><div style="width:14px;height:14px;border:1.5px solid #004f71;border-radius:2px;flex-shrink:0;display:flex;align-items:center;justify-content:center;${r.key===active?'background:#fff0f0;color:#c1121f;font-size:10pt;font-weight:900;':''}">${r.key===active?'✓':''}</div><span>${r.label}</span></div>`).join('');
  const win=window.open('','_blank');
  win.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"/><title>Amonestación — ${record.emp_name}</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:10pt;color:#1a1a2e;padding:22px 26px}.hdr{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:8px}.title{font-size:20pt;font-weight:900;color:#004f71;line-height:1.1}.logo{text-align:right;font-size:10pt;font-weight:700;color:#004f71}.logo span{display:block;font-size:8pt;color:#c1121f;font-weight:600}.meta{display:grid;grid-template-columns:1fr 1fr;gap:3px 20px;border-top:2px solid #004f71;border-bottom:1px solid #e5e7eb;padding:7px 0;margin-bottom:9px}.mf{display:flex;align-items:baseline;gap:5px;font-size:9.5pt}.ml{font-weight:700;white-space:nowrap;color:#004f71}.mv{border-bottom:1px solid #94a3b8;flex:1;padding-bottom:1px;font-weight:600}.sec{background:#004f71;color:#fff;font-weight:700;font-size:8.5pt;padding:3px 9px;border-radius:3px;margin:8px 0 5px;display:inline-block}.cats{display:grid;grid-template-columns:1fr 1fr;gap:1px 14px;margin-bottom:3px}.tbox{border:1px solid #cbd5e1;border-radius:4px;padding:9px 11px;min-height:65px;font-size:9.5pt;line-height:1.65;margin-bottom:3px;font-weight:500}.chks{display:flex;gap:20px;margin:5px 0 3px;flex-wrap:wrap}.signotice{font-size:8pt;color:#374151;line-height:1.5;border:1px solid #e5e7eb;border-radius:4px;padding:7px 9px;margin:9px 0 7px;background:#f8fafc}.sigs{display:grid;grid-template-columns:1fr 1fr;gap:12px 28px;margin-bottom:9px}.sigs label{font-size:8pt;font-weight:700;color:#004f71;display:block;margin-bottom:2px}.sl{border-bottom:1.5px solid #374151;height:20px}.neg{border:1.5px solid #004f71;border-radius:4px;padding:7px 10px;margin-top:7px}.negtitle{background:#004f71;color:#fff;font-weight:700;font-size:8pt;padding:2px 7px;border-radius:2px;display:inline-block;margin-bottom:5px}.footer{font-size:7.5pt;color:#94a3b8;text-align:right;margin-top:8px;border-top:1px solid #e5e7eb;padding-top:5px}@media print{body{padding:14px}}</style></head><body><div class="hdr"><div class="title">FORMULARIO DE ACCIÓN<br>DISCIPLINARIA</div><div class="logo">🐔 Los Filtros FSU<span>Chick-fil-A</span></div></div><div class="meta"><div class="mf"><span class="ml">Nombre del Miembro del Equipo:</span><span class="mv">${record.emp_name}</span></div><div class="mf"><span class="ml">Fecha del Incidente:</span><span class="mv">${incDateFmt}</span></div><div class="mf"><span class="ml">Fecha:</span><span class="mv">${today}</span></div><div class="mf"><span class="ml">Supervisor:</span><span class="mv">${sup}</span></div></div><div class="sec">VIOLACIÓN DE POLÍTICA</div><div class="cats"><div>${allCats[0].map(catItem).join('')}</div><div>${allCats[1].map(catItem).join('')}</div></div><div class="sec">DESCRIBA EL INCIDENTE</div><div class="tbox">${incident}</div><div class="sec">ACCIÓN DISCIPLINARIA</div><div class="chks">${chkRow(levelRows,level)}</div><div class="sec">ACCIÓN CORRECTIVA</div><div class="tbox">${corrective}</div><div class="sec">FALTA DE MEJORA</div><div class="chks">${chkRow(faltaRows,faltaKey)}</div><div class="tbox" style="min-height:48px">${consequence}</div><div class="signotice">Al firmar este documento reconozco que este informe ha sido completamente discutido y explicado por mi supervisor y entiendo que se me ha brindado la oportunidad de corregir mis acciones. Confirmo que se me brindó la oportunidad de explicar mi versión de los hechos.</div><div class="sigs"><div><label>Firma del Miembro del Equipo</label><div class="sl"></div></div><div><label>Fecha</label><div class="sl"></div></div><div><label>Firma del Supervisor</label><div class="sl"></div></div><div><label>Fecha</label><div class="sl"></div></div><div><label>Firma del Testigo</label><div class="sl"></div></div><div><label>Fecha</label><div class="sl"></div></div></div><div class="neg"><div class="negtitle">NEGATIVA DE FIRMA (si aplica)</div><div style="display:flex;align-items:center;gap:7px;font-size:8.5pt;margin-bottom:8px"><div style="width:13px;height:13px;border:1.5px solid #004f71;border-radius:2px;flex-shrink:0"></div><span>El Miembro del Equipo se negó a firmar después de que este documento le fue explicado completamente.</span></div><div class="sigs" style="margin-bottom:0"><div><label>Firma del Testigo</label><div class="sl"></div></div><div><label>Fecha</label><div class="sl"></div></div></div></div><div class="footer">Los Filtros FSU — Generado: ${today} — Revisado y aprobado por director</div><script>window.onload=()=>window.print();<\/script></body></html>`);
  win.document.close();
}

function wuRefreshEmpList() {
  const sel=document.getElementById('wuEmpSelect'); if(!sel)return;
  const prev=sel.value; sel.innerHTML='<option value="">— Seleccionar empleado —</option>';
  Object.entries(EMPLOYEES).filter(([,e])=>e.status==='active').sort((a,b)=>(a[1].name||'').localeCompare(b[1].name||'')).forEach(([key,emp])=>{const opt=document.createElement('option');opt.value=key;opt.textContent=emp.name;sel.appendChild(opt);});
  if(prev) sel.value=prev;
}
async function wuSelectFromDropdown(sel) {
  const key=sel.value; if(!key){wuCloseHistory();return;} const emp=EMPLOYEES[key]; if(!emp)return;
  WU.currentEmpKey=key; WU.currentEmpName=emp.name;
  document.getElementById('wuFormPanel').style.display='none'; document.getElementById('wuAIOutput').style.display='none';
  const records=await WU.fetchRecords(key); WU.currentRecords=records;
  document.getElementById('wuEmpNameDisplay').textContent=emp.name;
  wuRenderHistory(records); document.getElementById('wuHistoryPanel').style.display='block';
}
function wuRenderHistory(records) {
  const listEl=document.getElementById('wuHistoryList'), statusEl=document.getElementById('wuEmpStatus');
  const LC={verbal:{bg:'#fef9c3',color:'#854d0e'},escrita:{bg:'#ffedd5',color:'#9a3412'},final:{bg:'#fee2e2',color:'#991b1b'},terminacion:{bg:'#1e293b',color:'#f8fafc'}};
  if(!records||!records.length){listEl.innerHTML='<div style="color:var(--text-mid);padding:12px 0;font-style:italic">Sin amonestaciones previas.</div>';statusEl.innerHTML='<span class="badge" style="background:#dcfce7;color:#16a34a">Sin historial disciplinario</span>';return;}
  const lc0=LC[records[0].level]||LC.verbal; statusEl.innerHTML=`<span class="badge" style="background:${lc0.bg};color:${lc0.color}">Última: ${WU.LEVELS[records[0].level]||records[0].level}</span>`;
  listEl.innerHTML='<div style="display:flex;flex-direction:column;gap:8px">'+records.map(r=>{const lc=LC[r.level]||LC.verbal;const d=r.date?new Date(r.date+'T12:00:00').toLocaleDateString('es-PR',{year:'numeric',month:'short',day:'numeric'}):'';return`<div style="border:1px solid #e2e8f0;border-radius:8px;overflow:hidden"><div style="display:flex;align-items:center;gap:10px;padding:9px 14px;background:#f8fafc;border-bottom:1px solid #e2e8f0;flex-wrap:wrap"><span class="badge" style="background:${lc.bg};color:${lc.color}">${WU.LEVELS[r.level]||r.level}</span><span style="font-size:.82rem;color:var(--text-mid)">${d}</span>${r.shift?`<span style="font-size:.82rem;color:var(--text-mid)">🕐 ${r.shift}</span>`:''}<span style="font-size:.82rem;color:var(--text-mid);margin-left:auto">${r.category||''}</span></div><div style="padding:10px 14px;font-size:.82rem;line-height:1.5;color:#374151">${(r.incident||'').substring(0,200)}${(r.incident||'').length>200?'…':''}</div></div>`;}).join('')+'</div>';
}
function wuDeleteAllConfirm() {
  if(!WU.currentEmpKey||!WU.currentEmpName)return;
  if(!WU.currentRecords.length){alert('Este empleado no tiene amonestaciones registradas.');return;}
  const first=confirm(`⚠️ ¿Está seguro que desea eliminar TODAS las amonestaciones de ${WU.currentEmpName}?\n\nSe eliminarán ${WU.currentRecords.length} registro(s). Esta acción NO se puede deshacer.`);
  if(!first)return;
  const typed=prompt(`VERIFICACIÓN FINAL\n\nEscriba exactamente el nombre del empleado:\n\n"${WU.currentEmpName}"`);
  if(typed===null)return;
  if(typed.trim()!==WU.currentEmpName.trim()){alert('❌ El nombre no coincide. No se eliminaron los registros.');return;}
  WU.deleteAllRecords(WU.currentEmpKey).then(()=>{WU.currentRecords=[];wuRenderHistory([]);document.getElementById('wuFormPanel').style.display='none';document.getElementById('wuAIOutput').style.display='none';alert(`✅ Se eliminaron todos los registros de ${WU.currentEmpName}.`);}).catch(err=>alert('Error: '+err.message));
}
function wuOpenNewForm() {
  // If employee not set via dropdown change, try reading it directly now
  if(!WU.currentEmpKey) {
    const sel = document.getElementById('wuEmpSelect');
    if (sel && sel.value) {
      const emp = EMPLOYEES[sel.value];
      if (emp) { WU.currentEmpKey = sel.value; WU.currentEmpName = emp.name; }
    }
  }
  if(!WU.currentEmpKey){alert('Por favor, seleccione un empleado primero.');return;}
  // Reset form fields — matched to current HTML structure
  const setVal = (id, v) => { const el=document.getElementById(id); if(el) el.value=v; };
  setVal('wuLevel', 'verbal');
  setVal('wuCategory', '');
  setVal('wuSupervisor', '');
  setVal('wuDate', new Date().toISOString().split('T')[0]);
  setVal('wuShiftStartH', '8');
  setVal('wuShiftStartM', '0');
  setVal('wuShiftStartAMPM', 'AM');
  setVal('wuShiftEndH', '4');
  setVal('wuShiftEndM', '0');
  setVal('wuShiftEndAMPM', 'PM');
  setVal('wuRawDescription', '');

  // Clear generated output areas
  const aiOut = document.getElementById('wuAIOutput');
  if (aiOut) aiOut.style.display = 'none';
  const catFields = document.getElementById('wuCategoryFields');
  if (catFields) catFields.innerHTML = '';
  const hint = document.getElementById('wuCategoryHint');
  if (hint) hint.style.display = 'none';
  const genBtn = document.getElementById('wuGenerateBtn');
  if (genBtn) { genBtn.textContent = '✨ Generar con IA'; genBtn.disabled = false; }

  // Set employee name and show form
  const nameEl = document.getElementById('wuFormEmpName');
  if (nameEl) nameEl.textContent = WU.currentEmpName;
  wuUpdateFaltaMejora();

  const panel = document.getElementById('wuFormPanel');
  if (panel) {
    panel.style.display = 'block';
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}
function wuOnCategoryChange() {
  const cat=document.getElementById('wuCategory').value; document.getElementById('wuAIOutput').style.display='none';
  if(!cat){document.getElementById('wuCategoryFields').innerHTML='';return;}
  document.getElementById('wuLevel').value=WU.suggestLevel(WU.currentRecords,cat);
  const catRecs=(WU.currentRecords||[]).filter(r=>r.category===cat);
  const hintEl=document.getElementById('wuCategoryHint');
  if(hintEl){
    if(!catRecs.length){hintEl.textContent='Sin historial en esta categoría — nivel sugerido: Amonestación Verbal';hintEl.style.color='#16a34a';}
    else{const last=[...catRecs].sort((a,b)=>new Date(b.created_at)-new Date(a.created_at))[0];const d=last.date?new Date(last.date+'T12:00:00').toLocaleDateString('es-PR',{year:'numeric',month:'short',day:'numeric'}):'';hintEl.textContent=`${catRecs.length} amonestación(es) en esta categoría. Última: ${WU.LEVELS[last.level]} (${d})`;hintEl.style.color='#92400e';}
    hintEl.style.display='block';
  }
  wuUpdateFaltaMejora(); wuRenderCategoryFields(cat);
}
function wuUpdateFaltaMejora(){document.getElementById('wuFaltaMejora').value=WU.FALTA_MAP[document.getElementById('wuLevel').value]||'';}
function wuCancelForm(){document.getElementById('wuFormPanel').style.display='none';document.getElementById('wuAIOutput').style.display='none';}
function wuCloseHistory(){WU.currentEmpKey=null;WU.currentEmpName=null;WU.currentRecords=[];['wuHistoryPanel','wuFormPanel','wuAIOutput'].forEach(id=>document.getElementById(id).style.display='none');}

const WU_FIELDS={
  'Asistencia y Puntualidad':[{id:'tipo_ausencia',label:'Tipo de incidente',type:'select',options:['Tardanza','Ausencia injustificada'],required:true},{id:'horaProgram',label:'Hora exacta programada de entrada',type:'time',required:true},{id:'horaLlegada',label:'Hora exacta de llegada (solo para tardanza)',type:'time',required:false,showIf:{id:'tipo_ausencia',val:'Tardanza'}},{id:'minutosT',label:'Minutos totales de tardanza (mínimo 1 minuto = violación)',type:'number',required:false,showIf:{id:'tipo_ausencia',val:'Tardanza'}},{id:'reloj',label:'¿El sistema de reloj registró la entrada/ausencia?',type:'yesno',required:true},{id:'llamo',label:'¿Llamó para avisar antes de su turno?',type:'yesno',required:true},{id:'horaLlamo',label:'Si llamó — ¿a qué hora?',type:'time',required:false,showIf:{id:'llamo',val:'Sí'}},{id:'quienAtendio',label:'Si llamó — ¿a quién?',type:'text',required:false,showIf:{id:'llamo',val:'Sí'}},{id:'ocasiones_previas',label:'¿Ha tenido incidentes de asistencia previos en los últimos 90 días?',type:'yesno',required:true}],
  'Normas de Conducta':[{id:'descripcion',label:'Descripción exacta (palabras textuales si aplica)',type:'textarea',required:true},{id:'area',label:'Área específica donde ocurrió',type:'text',required:true},{id:'horaInc',label:'Hora exacta del incidente',type:'time',required:true},{id:'clientes',label:'¿Hubo clientes presentes?',type:'yesno',required:true},{id:'testigos',label:'Nombre(s) de testigo(s)',type:'text',required:false},{id:'testigoDecl',label:'¿El testigo está dispuesto a declarar?',type:'yesno',required:false,showIf:{id:'testigos',notEmpty:true}},{id:'dano',label:'¿Hubo daño a la operación o persona? Describa',type:'text',required:false}],
  'Inocuidad de Alimentos / Seguridad Alimentaria':[{id:'regulacion',label:'Regulación específica violada (citar la regla)',type:'textarea',required:true},{id:'productoArea',label:'Producto, equipo o área involucrada',type:'text',required:true},{id:'riesgo',label:'¿Hubo riesgo de contaminación o daño al cliente?',type:'yesno',required:true},{id:'temperatura',label:'Temperatura del producto (si aplica)',type:'text',required:false},{id:'descarto',label:'¿Se descartó el producto?',type:'yesno',required:false},{id:'entrenado',label:'¿El empleado había recibido entrenamiento en esta regla?',type:'yesno',required:true},{id:'corrigioMom',label:'¿Fue corregido en el momento?',type:'yesno',required:true}],
  'Deberes y Responsabilidades del Puesto':[{id:'tarea',label:'Tarea o responsabilidad específica no cumplida',type:'textarea',required:true},{id:'enDescripcion',label:'¿Estaba en la descripción oficial del puesto?',type:'yesno',required:true},{id:'instruccionDir',label:'¿Se le dio instrucción directa ese día?',type:'yesno',required:true},{id:'quienInstruyo',label:'¿Por quién se le instruyó?',type:'text',required:false,showIf:{id:'instruccionDir',val:'Sí'}},{id:'impacto',label:'Impacto directo en la operación',type:'textarea',required:true},{id:'quejaCliente',label:'¿Hubo queja de cliente o incidente relacionado?',type:'yesno',required:true}],
  'Ambiente de Trabajo Civil y Respetuoso':[{id:'descripcion',label:'¿Qué dijo o hizo exactamente? (palabras textuales)',type:'textarea',required:true},{id:'dirigidoA',label:'¿Fue dirigido a compañero, supervisor, o cliente?',type:'select',options:['Compañero de trabajo','Supervisor','Cliente','Varios'],required:true},{id:'area',label:'Área donde ocurrió',type:'text',required:true},{id:'horaInc',label:'Hora del incidente',type:'time',required:true},{id:'testigos',label:'Nombre(s) de testigo(s)',type:'text',required:false},{id:'testigoDecl',label:'¿El testigo está dispuesto a declarar?',type:'yesno',required:false,showIf:{id:'testigos',notEmpty:true}},{id:'contactoFisico',label:'¿Hubo contacto físico?',type:'yesno',required:true},{id:'tipoContacto',label:'Si hubo contacto físico — ¿de qué tipo?',type:'text',required:false,showIf:{id:'contactoFisico',val:'Sí'}},{id:'quejaFormal',label:'¿La otra persona presentó queja formal?',type:'yesno',required:true},{id:'hostigamiento',label:'¿Constituyó hostigamiento, discriminación o acoso?',type:'yesno',required:true}],
  'Apariencia y Aseo Personal':[{id:'articulo',label:'Artículo o requisito específico no cumplido',type:'text',required:true},{id:'tenia',label:'¿Tenía el empleado el artículo ese día?',type:'yesno',required:true},{id:'oportunidad',label:'¿Se le dio oportunidad de corregirlo?',type:'yesno',required:true},{id:'corrigio',label:'¿Lo corrigió cuando se le indicó?',type:'yesno',required:true},{id:'impactoCliente',label:'¿Hubo impacto en la interacción con clientes?',type:'yesno',required:true}],
  'Seguridad en el Lugar de Trabajo':[{id:'regla',label:'Regla de seguridad violada (citar específicamente)',type:'textarea',required:true},{id:'lugar',label:'Lugar exacto donde ocurrió',type:'text',required:true},{id:'horaInc',label:'Hora del incidente',type:'time',required:true},{id:'riesgoLesion',label:'¿Hubo riesgo de lesión?',type:'yesno',required:true},{id:'entrenado',label:'¿El empleado había recibido entrenamiento en este procedimiento?',type:'yesno',required:true},{id:'fechaEntren',label:'¿Cuándo recibió el entrenamiento?',type:'date',required:false,showIf:{id:'entrenado',val:'Sí'}},{id:'camara',label:'¿Hay registro en cámara?',type:'yesno',required:true},{id:'reportoGerente',label:'¿Se reportó al gerente inmediatamente?',type:'yesno',required:true}],
  'Responsabilidad de Efectivo y Cupones':[{id:'discrepancia',label:'Discrepancia exacta en dólares y centavos ($)',type:'number',required:true},{id:'tipoDisc',label:'Tipo de discrepancia',type:'select',options:['Faltante','Sobrante'],required:true},{id:'caja',label:'Caja o terminal donde ocurrió',type:'text',required:true},{id:'horaConteo',label:'Hora en que se hizo el conteo',type:'time',required:true},{id:'soloEnCaja',label:'¿Estuvo el empleado solo/a en esa caja?',type:'yesno',required:true},{id:'reviso',label:'¿Se revisó el conteo con el empleado presente?',type:'yesno',required:true},{id:'firmoConteo',label:'¿El empleado firmó el conteo?',type:'yesno',required:true},{id:'registroPOS',label:'¿Hay registro del sistema POS?',type:'yesno',required:true}],
  'Política de Uniformes':[{id:'articulo',label:'Artículo específico faltante o incorrecto',type:'text',required:true},{id:'orientado',label:'¿Se le notificó la política en su orientación?',type:'yesno',required:true},{id:'tenia',label:'¿Tenía el artículo disponible ese día?',type:'yesno',required:true},{id:'oportunidad',label:'¿Se le dio oportunidad de corregirlo?',type:'yesno',required:true},{id:'corrigio',label:'¿Lo corrigió?',type:'yesno',required:true}],
  'Comunicaciones Telefónicas':[{id:'politica',label:'Política específica de uso de teléfono violada',type:'textarea',required:true},{id:'area',label:'Área donde estaba el empleado',type:'text',required:true},{id:'horasTrabajo',label:'¿Estaba en horas activas o en descanso?',type:'select',options:['Horas activas de trabajo','Período de descanso'],required:true},{id:'afectoServicio',label:'¿Afectó el servicio al cliente?',type:'yesno',required:true},{id:'clienteTestigo',label:'¿Hubo un cliente afectado o testigo?',type:'yesno',required:true},{id:'camara',label:'¿Hay registro en cámara?',type:'yesno',required:true}],
};

function wuRenderCategoryFields(cat){const container=document.getElementById('wuCategoryFields');const fields=WU_FIELDS[cat]||[];if(!fields.length){container.innerHTML='';return;}container.innerHTML=`<div style="margin-top:16px;border-top:1px solid #e5e7eb;padding-top:16px"><div style="font-size:.8rem;font-weight:700;color:var(--navy);margin-bottom:12px">📋 Información Requerida — ${cat}<span style="font-weight:400;color:#6b7280;font-size:.75rem"> (* obligatorios)</span></div>${fields.map(wuFieldHtml).join('')}</div>`;}
function wuFieldHtml(f){const req=f.required?'<span style="color:#dc2626"> *</span>':'';const showStyle=f.showIf?'display:none;':'';const showAttr=f.showIf?`data-showif='${JSON.stringify(f.showIf)}'`:'';let input='';if(f.type==='yesno')input=`<div style="display:flex;gap:16px;margin-top:4px"><label style="display:flex;align-items:center;gap:6px;font-size:.875rem;cursor:pointer"><input type="radio" name="wuf_${f.id}" value="Sí" onchange="wuCheckConditionals()" style="accent-color:var(--navy)"> Sí</label><label style="display:flex;align-items:center;gap:6px;font-size:.875rem;cursor:pointer"><input type="radio" name="wuf_${f.id}" value="No" onchange="wuCheckConditionals()" style="accent-color:var(--navy)"> No</label></div>`;else if(f.type==='select')input=`<select id="wuf_${f.id}" onchange="wuCheckConditionals()" style="width:100%;padding:8px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:.875rem;margin-top:4px"><option value="">Seleccionar...</option>${(f.options||[]).map(o=>`<option>${o}</option>`).join('')}</select>`;else if(f.type==='textarea')input=`<textarea id="wuf_${f.id}" rows="3" style="width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:.875rem;resize:vertical;margin-top:4px" placeholder="Ingrese detalles..."></textarea>`;else if(f.type==='time')input=`<input type="time" id="wuf_${f.id}" style="padding:7px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:.875rem;margin-top:4px"/>`;else if(f.type==='date')input=`<input type="date" id="wuf_${f.id}" style="padding:7px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:.875rem;margin-top:4px"/>`;else if(f.type==='number')input=`<input type="number" id="wuf_${f.id}" min="0" step="0.01" style="width:160px;padding:7px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:.875rem;margin-top:4px" placeholder="0"/>`;else input=`<input type="text" id="wuf_${f.id}" style="width:100%;padding:8px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:.875rem;margin-top:4px" placeholder="Ingrese información..."/>`;return`<div id="wuf_wrap_${f.id}" ${showAttr} style="${showStyle}margin-bottom:12px"><label style="font-size:.8rem;font-weight:600;color:var(--text-mid);display:block">${f.label}${req}</label>${input}</div>`;}
function wuCheckConditionals(){const cat=document.getElementById('wuCategory').value;(WU_FIELDS[cat]||[]).forEach(f=>{if(!f.showIf)return;const wrap=document.getElementById(`wuf_wrap_${f.id}`);if(!wrap)return;let show=false;const si=f.showIf;if(si.val!==undefined){document.querySelectorAll(`[name="wuf_${si.id}"]`).forEach(r=>{if(r.checked&&r.value===si.val)show=true;});const sel=document.getElementById(`wuf_${si.id}`);if(sel&&sel.value===si.val)show=true;}else if(si.notEmpty){const el=document.getElementById(`wuf_${si.id}`);if(el&&el.value.trim())show=true;}wrap.style.display=show?'block':'none';});}
function wuGetFieldVals(){const cat=document.getElementById('wuCategory').value;const vals={};(WU_FIELDS[cat]||[]).forEach(f=>{if(f.type==='yesno'){const c=document.querySelector(`[name="wuf_${f.id}"]:checked`);vals[f.id]=c?c.value:'';}else{const el=document.getElementById(`wuf_${f.id}`);vals[f.id]=el?el.value.trim():'';} });return vals;}
function wuValidateFields(){const cat=document.getElementById('wuCategory').value;const vals=wuGetFieldVals();const missing=[];(WU_FIELDS[cat]||[]).forEach(f=>{if(!f.required)return;const wrap=document.getElementById(`wuf_wrap_${f.id}`);if(wrap&&wrap.style.display==='none')return;if(!vals[f.id]||vals[f.id]==='')missing.push(f.label);});return missing;}
function wuGenerateDocument(){const cat=document.getElementById('wuCategory').value,sup=document.getElementById('wuSupervisor').value.trim(),date=document.getElementById('wuDate').value;if(!cat){alert('Por favor seleccione una categoría.');return;}if(!sup){alert('Por favor ingrese el nombre del supervisor.');return;}if(!date){alert('Por favor seleccione la fecha del incidente.');return;}const missing=wuValidateFields();if(missing.length){alert('Por favor complete los campos obligatorios:\n\n• '+missing.join('\n• '));return;}const level=document.getElementById('wuLevel').value,shift=WU.getShiftString(),fields=wuGetFieldVals();const dateFormatted=new Date(date+'T12:00:00').toLocaleDateString('es-PR',{year:'numeric',month:'long',day:'numeric'});const doc=wuBuildDocument({empName:WU.currentEmpName,cat,level,sup,dateFormatted,shift,fields});document.getElementById('wuGenIncidente').value=doc.incidente;document.getElementById('wuGenCorrectiva').value=doc.correctiva;document.getElementById('wuGenConsecuencia').value=doc.consecuencia;document.getElementById('wuAIOutput').style.display='block';document.getElementById('wuAIOutput').scrollIntoView({behavior:'smooth',block:'start'});}
function wuBuildDocument({empName,cat,level,sup,dateFormatted,shift,fields}){return{incidente:wuBuildIncidente(empName,cat,sup,dateFormatted,shift,fields),correctiva:wuBuildCorrectiva(empName,cat),consecuencia:`De reincidir en esta conducta, el/la empleado/a ${empName} estará sujeto/a a ${WU.FALTA_MAP[level]}, conforme a la política disciplinaria progresiva de Los Filtros FSU. Esta empresa está comprometida con mantener un ambiente de trabajo que cumpla con todas las normas establecidas, y espera el cumplimiento inmediato y sostenido de dicha política.`};}
function wuBuildIncidente(n,cat,sup,date,shift,f){const t={'Asistencia y Puntualidad':`En fecha ${date}, el/la empleado/a ${n} incurrió en una violación a la Política de Asistencia y Puntualidad de Los Filtros FSU. ${f.tipo_ausencia==='Ausencia injustificada'?`El/la empleado/a tenía programado su turno a las ${f.horaProgram} y no se presentó a trabajar (ausencia injustificada). ${f.llamo==='Sí'?`Notificó al supervisor a las ${f.horaLlamo} con ${f.quienAtendio}.`:'No notificó a la gerencia en ningún momento previo al turno.'}`:`El/la empleado/a tenía programada su entrada a las ${f.horaProgram}, sin embargo se presentó a las ${f.horaLlegada}, registrando una tardanza de ${f.minutosT} minuto(s). De conformidad con la política de Los Filtros FSU, toda tardanza — incluyendo un (1) minuto — constituye una violación. ${f.llamo==='Sí'?`El/la empleado/a notificó al supervisor a las ${f.horaLlamo} con ${f.quienAtendio}.`:'El/la empleado/a no notificó previamente a la gerencia.'}`} ${f.reloj==='Sí'?'Dicho incidente quedó registrado en el sistema de marcaje electrónico de la empresa.':'El sistema de marcaje no registró la situación.'} ${f.ocasiones_previas==='Sí'?'Se certifica que el/la empleado/a ha tenido incidentes de asistencia previos en los últimos 90 días.':''} El supervisor ${sup} certificó la ocurrencia de dicho incidente durante el turno de ${shift}.`,'Normas de Conducta':`En fecha ${date}, durante el turno de ${shift}, el/la empleado/a ${n} incurrió en una violación a las Normas de Conducta de Los Filtros FSU. Específicamente, ${f.descripcion}. El incidente ocurrió en el área de ${f.area} a las ${f.horaInc}. ${f.clientes==='Sí'?'Había clientes presentes al momento del incidente.':''} ${f.testigos?`El/la testigo ${f.testigos} estuvo presente y ${f.testigoDecl==='Sí'?'está dispuesto/a a declarar.':'fue notificado/a del incidente.'}`:''} ${f.dano?`Como consecuencia, ${f.dano}.`:''} El supervisor ${sup} certificó la ocurrencia de dicho incidente.`,'Inocuidad de Alimentos / Seguridad Alimentaria':`En fecha ${date}, durante el turno de ${shift}, el/la empleado/a ${n} incurrió en una violación a la Política de Inocuidad de Alimentos de Los Filtros FSU. Específicamente, se violó la siguiente regulación: ${f.regulacion}. El producto, equipo o área involucrada fue: ${f.productoArea}. ${f.riesgo==='Sí'?'Existió un riesgo directo de contaminación o daño al cliente.':'No se identificó riesgo directo al consumidor.'} ${f.temperatura?`La temperatura registrada fue de ${f.temperatura}.`:''} ${f.descarto==='Sí'?'El producto fue descartado conforme al protocolo.':''} ${f.entrenado==='Sí'?'El/la empleado/a había recibido entrenamiento sobre esta regulación.':'Esta situación evidencia una deficiencia en la aplicación de los protocolos.'} ${f.corrigioMom==='Sí'?'La situación fue corregida al momento de ser identificada.':'La situación no fue corregida de inmediato.'} El supervisor ${sup} certificó la ocurrencia de dicho incidente.`,'Deberes y Responsabilidades del Puesto':`En fecha ${date}, durante el turno de ${shift}, el/la empleado/a ${n} incurrió en una violación a sus Deberes y Responsabilidades del Puesto en Los Filtros FSU. Específicamente, no cumplió con la siguiente tarea: ${f.tarea}. ${f.enDescripcion==='Sí'?'Dicha responsabilidad forma parte de la descripción oficial de su puesto.':''} ${f.instruccionDir==='Sí'?`Se le dio instrucción directa de realizarla por ${f.quienInstruyo}.`:''} Como consecuencia directa, ${f.impacto}. ${f.quejaCliente==='Sí'?'Se generó una queja de cliente a raíz de este incumplimiento.':''} El supervisor ${sup} certificó la ocurrencia de dicho incidente.`,'Ambiente de Trabajo Civil y Respetuoso':`En fecha ${date}, durante el turno de ${shift}, en el área de ${f.area}, el/la empleado/a ${n} incurrió en una violación a la Política de Ambiente de Trabajo Civil y Respetuoso de Los Filtros FSU. Específicamente, ${f.descripcion}. Dicha conducta fue dirigida a ${f.dirigidoA}. ${f.testigos?`El/la testigo ${f.testigos} estuvo presente y ${f.testigoDecl==='Sí'?'está dispuesto/a a declarar.':'fue notificado/a del incidente.'}`:''} ${f.contactoFisico==='Sí'?`Hubo contacto físico de la siguiente naturaleza: ${f.tipoContacto}.`:''} ${f.quejaFormal==='Sí'?'La parte afectada presentó queja formal.':''} ${f.hostigamiento==='Sí'?'Los hechos pueden constituir hostigamiento, discriminación o acoso en el lugar de trabajo.':''} El supervisor ${sup} certificó la ocurrencia de dicho incidente.`,'Apariencia y Aseo Personal':`En fecha ${date}, durante el turno de ${shift}, el/la empleado/a ${n} incurrió en una violación a la Política de Apariencia y Aseo Personal de Los Filtros FSU. Específicamente, no cumplió con el siguiente requisito: ${f.articulo}. ${f.tenia==='Sí'?'El/la empleado/a tenía el artículo en su poder ese día.':'El/la empleado/a no contaba con el artículo requerido.'} ${f.oportunidad==='Sí'?'Se le brindó la oportunidad de corregir la situación.':''} ${f.corrigio==='Sí'?'El/la empleado/a procedió a corregir la situación.':'El/la empleado/a no procedió a corregir la situación.'} ${f.impactoCliente==='Sí'?'Dicha situación tuvo impacto en la interacción con clientes.':''} El supervisor ${sup} certificó la ocurrencia de dicho incidente.`,'Seguridad en el Lugar de Trabajo':`En fecha ${date}, durante el turno de ${shift}, el/la empleado/a ${n} incurrió en una violación a la Política de Seguridad en el Lugar de Trabajo de Los Filtros FSU. Específicamente, violó la siguiente regla: ${f.regla}. El incidente ocurrió en ${f.lugar} a las ${f.horaInc}. ${f.riesgoLesion==='Sí'?'Existió riesgo de lesión para el/la empleado/a u otras personas.':''} ${f.entrenado==='Sí'?`El/la empleado/a había recibido entrenamiento en este procedimiento el ${f.fechaEntren}.`:''} ${f.camara==='Sí'?'Existe registro en cámara.':''} ${f.reportoGerente==='Sí'?'El incidente fue reportado al gerente de turno inmediatamente.':'El incidente no fue reportado al gerente de forma inmediata.'} El supervisor ${sup} certificó la ocurrencia de dicho incidente.`,'Responsabilidad de Efectivo y Cupones':`En fecha ${date}, durante el turno de ${shift}, el/la empleado/a ${n} incurrió en una violación a la Política de Responsabilidad de Efectivo y Cupones de Los Filtros FSU. Al realizarse el conteo a las ${f.horaConteo} en la caja ${f.caja}, se identificó una discrepancia de $${f.discrepancia}, siendo esta un ${f.tipoDisc}. ${f.soloEnCaja==='Sí'?'El/la empleado/a estuvo solo/a en dicha caja durante el turno.':'Otros empleados tuvieron acceso a la caja.'} ${f.reviso==='Sí'?'El conteo fue revisado con el/la empleado/a presente.':'El conteo no fue revisado con el/la empleado/a presente.'} ${f.firmoConteo==='Sí'?'El/la empleado/a firmó el conteo.':'El/la empleado/a no firmó el conteo.'} ${f.registroPOS==='Sí'?'Existe registro del sistema POS que respalda esta discrepancia.':''} El supervisor ${sup} certificó la ocurrencia de dicho incidente.`,'Política de Uniformes':`En fecha ${date}, durante el turno de ${shift}, el/la empleado/a ${n} incurrió en una violación a la Política de Uniformes de Los Filtros FSU. Específicamente, el siguiente artículo del uniforme faltaba o no cumplía con la política: ${f.articulo}. ${f.orientado==='Sí'?'El/la empleado/a fue notificado/a de la Política de Uniformes durante su orientación.':''} ${f.tenia==='Sí'?'El/la empleado/a tenía el artículo disponible ese día.':'El/la empleado/a no contaba con el artículo disponible.'} ${f.oportunidad==='Sí'?'Se le brindó la oportunidad de corregir la situación.':''} ${f.corrigio==='Sí'?'El/la empleado/a procedió a corregir la situación.':'El/la empleado/a no corrigió la situación.'} El supervisor ${sup} certificó la ocurrencia de dicho incidente.`,'Comunicaciones Telefónicas':`En fecha ${date}, durante el turno de ${shift}, el/la empleado/a ${n} incurrió en una violación a la Política de Comunicaciones Telefónicas de Los Filtros FSU. Específicamente, violó la siguiente política: ${f.politica}. El incidente ocurrió en el área de ${f.area}, ${f.horasTrabajo==='Horas activas de trabajo'?'durante horas activas de trabajo':'durante su período de descanso'}. ${f.afectoServicio==='Sí'?'Dicha conducta afectó directamente el servicio al cliente.':''} ${f.clienteTestigo==='Sí'?'Un cliente u otro testigo estuvo presente durante el incidente.':''} ${f.camara==='Sí'?'Existe registro en cámara del incidente.':''} El supervisor ${sup} certificó la ocurrencia de dicho incidente.`};return t[cat]||`En fecha ${date}, durante el turno de ${shift}, el/la empleado/a ${n} incurrió en una violación a la política de ${cat} de Los Filtros FSU. El supervisor ${sup} certificó la ocurrencia de dicho incidente.`;}
function wuBuildCorrectiva(n,cat){const t={'Asistencia y Puntualidad':`Se le requiere al/a la empleado/a ${n} reportarse a su turno puntualmente. De acuerdo con la política de Los Filtros FSU, cualquier tardanza — incluyendo un (1) minuto de retraso — constituye una violación. En caso de no poder cumplir con el horario asignado, el/la empleado/a debe notificar al supervisor antes del inicio del turno. El incumplimiento reiterado de esta directiva resultará en acción disciplinaria progresiva hasta la terminación del empleo.`,'Normas de Conducta':`Se le requiere al/a la empleado/a ${n} mantener en todo momento una conducta profesional, respetuosa y acorde con las Normas de Conducta de Los Filtros FSU. Toda interacción con compañeros, supervisores y clientes debe realizarse dentro del marco de respeto y profesionalismo que exige esta empresa. El incumplimiento de esta directiva no será tolerado.`,'Inocuidad de Alimentos / Seguridad Alimentaria':`Se le requiere al/a la empleado/a ${n} cumplir estrictamente con todos los protocolos de inocuidad y seguridad alimentaria establecidos por Los Filtros FSU y las regulaciones aplicables. El manejo adecuado de alimentos es una responsabilidad no negociable que protege la salud de nuestros clientes y la integridad de la operación. El incumplimiento de estos protocolos no será tolerado bajo ninguna circunstancia.`,'Deberes y Responsabilidades del Puesto':`Se le requiere al/a la empleado/a ${n} cumplir a cabalidad con todas las tareas y responsabilidades inherentes a su puesto, conforme a las instrucciones recibidas de la gerencia. La ejecución efectiva de sus funciones es fundamental para el buen funcionamiento de la operación. El incumplimiento de sus responsabilidades no será tolerado.`,'Ambiente de Trabajo Civil y Respetuoso':`Se le requiere al/a la empleado/a ${n} mantener en todo momento un comportamiento civil, respetuoso y profesional hacia todos los compañeros, supervisores y clientes de Los Filtros FSU. Toda conducta que atente contra el ambiente de trabajo respetuoso que esta empresa promueve constituye una violación grave y no será tolerada.`,'Apariencia y Aseo Personal':`Se le requiere al/a la empleado/a ${n} reportarse a su turno cumpliendo en su totalidad con el Código de Apariencia y Aseo Personal de Los Filtros FSU. El cumplimiento de estos estándares es una condición de empleo y refleja los valores de la empresa. El incumplimiento de esta política no será tolerado.`,'Seguridad en el Lugar de Trabajo':`Se le requiere al/a la empleado/a ${n} cumplir en todo momento con todos los procedimientos y normas de seguridad establecidos por Los Filtros FSU. La seguridad en el lugar de trabajo es una responsabilidad compartida y su cumplimiento es obligatorio. El incumplimiento de los protocolos de seguridad no será tolerado.`,'Responsabilidad de Efectivo y Cupones':`Se le requiere al/a la empleado/a ${n} manejar el efectivo y cupones con la máxima diligencia conforme a los procedimientos de Los Filtros FSU. Toda discrepancia de $2.00 o más constituye una violación sujeta a acción disciplinaria progresiva (Verbal, Escrita, Final y Terminación). El/la empleado/a debe verificar su caja al inicio y cierre de turno, reportar cualquier irregularidad inmediatamente, y no compartir su caja sin autorización del gerente. El incumplimiento de esta política no será tolerado bajo ninguna circunstancia.`,'Política de Uniformes':`Se le requiere al/a la empleado/a ${n} reportarse a cada turno con el uniforme completo y en las condiciones establecidas por la Política de Uniformes de Los Filtros FSU. El uso correcto del uniforme es una condición de empleo y parte de la imagen profesional de la empresa. El incumplimiento de esta política no será tolerado.`,'Comunicaciones Telefónicas':`Se le requiere al/a la empleado/a ${n} cumplir estrictamente con la Política de Comunicaciones Telefónicas de Los Filtros FSU durante las horas de trabajo. El uso indebido de dispositivos de comunicación personal durante el turno interfiere con la operación y el servicio al cliente. El incumplimiento de esta política no será tolerado.`};return t[cat]||`Se le requiere al/a la empleado/a ${n} cumplir estrictamente con todas las políticas y normas de Los Filtros FSU. El incumplimiento de estas directivas no será tolerado.`;}
function wuGenerateWithAI() { wuGenerateDocument(); }
async function wuSaveRecord(){const record={emp_id:WU.currentEmpKey,emp_name:WU.currentEmpName,date:document.getElementById('wuDate').value,level:document.getElementById('wuLevel').value,category:document.getElementById('wuCategory').value,supervisor:document.getElementById('wuSupervisor').value.trim(),shift:WU.getShiftString(),incident:document.getElementById('wuGenIncidente').value,corrective:document.getElementById('wuGenCorrectiva').value,consequence:document.getElementById('wuGenConsecuencia').value,created_at:new Date().toISOString()};try{await WU.saveRecord(record);WU.currentRecords=await WU.fetchRecords(WU.currentEmpKey);wuRenderHistory(WU.currentRecords);document.getElementById('wuFormPanel').style.display='none';document.getElementById('wuAIOutput').style.display='none';document.getElementById('wuHistoryPanel').scrollIntoView({behavior:'smooth'});alert('✅ Amonestación guardada en el expediente de '+WU.currentEmpName+'.');}catch(err){alert('Error al guardar: '+err.message);}}
function wuPrintRecord(){const level=document.getElementById('wuLevel').value,cat=document.getElementById('wuCategory').value,sup=document.getElementById('wuSupervisor').value.trim(),date=document.getElementById('wuDate').value,shift=WU.getShiftString(),incident=document.getElementById('wuGenIncidente').value,corrective=document.getElementById('wuGenCorrectiva').value,consequence=document.getElementById('wuGenConsecuencia').value;const today=new Date().toLocaleDateString('es-PR',{year:'numeric',month:'long',day:'numeric'}),incDateFmt=date?new Date(date+'T12:00:00').toLocaleDateString('es-PR',{year:'numeric',month:'long',day:'numeric'}):'';const allCats=[['Política de Salud','Funciones, Responsabilidades y Requisitos de Liderazgo','Asistencia y Puntualidad','Pausas y Comidas de Empleados','Deberes y Responsabilidades del Puesto','Normas de Conducta','Ambiente de Trabajo Civil y Respetuoso','Inocuidad de Alimentos / Seguridad Alimentaria'],['Apariencia y Aseo Personal','Igualdad de Oportunidad de Empleo y Política de No Acoso','Seguridad en el Lugar de Trabajo','Comunicaciones Telefónicas','Responsabilidad de Efectivo y Cupones','Política de Uniformes']];const catItem=c=>{const chk=c===cat;return`<div style="display:flex;align-items:center;gap:6px;padding:1.5px 0;font-size:9pt;${chk?'font-weight:700;color:#004f71;':''}"><div style="width:13px;height:13px;border:1.5px solid #004f71;border-radius:2px;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:9pt;${chk?'background:#e0f2fe;color:#c1121f;font-weight:900;':''}">${chk?'✓':''}</div><span>${c}</span></div>`;};const faltaMap={verbal:'escrita',escrita:'final',final:'terminacion',terminacion:'terminacion'},faltaKey=faltaMap[level];const levelRows=[{key:'verbal',label:'Amonestación Verbal'},{key:'escrita',label:'Amonestación Escrita'},{key:'final',label:'Amonestación Final Escrita'}];const faltaRows=[{key:'escrita',label:'Amonestación Escrita'},{key:'final',label:'Amonestación Final Escrita'},{key:'terminacion',label:'Terminación'}];const chkRow=(rows,active)=>rows.map(r=>`<div style="display:flex;align-items:center;gap:7px;font-size:9pt;${r.key===active?'font-weight:700;':''}"><div style="width:14px;height:14px;border:1.5px solid #004f71;border-radius:2px;flex-shrink:0;display:flex;align-items:center;justify-content:center;${r.key===active?'background:#fff0f0;color:#c1121f;font-size:10pt;font-weight:900;':''}">${r.key===active?'✓':''}</div><span>${r.label}</span></div>`).join('');const win=window.open('','_blank');win.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"/><title>Amonestación — ${WU.currentEmpName}</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Arial,sans-serif;font-size:10pt;color:#1a1a2e;padding:22px 26px}.hdr{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:8px}.title{font-size:20pt;font-weight:900;color:#004f71;line-height:1.1}.logo{text-align:right;font-size:10pt;font-weight:700;color:#004f71}.logo span{display:block;font-size:8pt;color:#c1121f;font-weight:600}.meta{display:grid;grid-template-columns:1fr 1fr;gap:3px 20px;border-top:2px solid #004f71;border-bottom:1px solid #e5e7eb;padding:7px 0;margin-bottom:9px}.mf{display:flex;align-items:baseline;gap:5px;font-size:9.5pt}.ml{font-weight:700;white-space:nowrap;color:#004f71}.mv{border-bottom:1px solid #94a3b8;flex:1;padding-bottom:1px;font-weight:600}.sec{background:#004f71;color:#fff;font-weight:700;font-size:8.5pt;padding:3px 9px;border-radius:3px;margin:8px 0 5px;display:inline-block}.cats{display:grid;grid-template-columns:1fr 1fr;gap:1px 14px;margin-bottom:3px}.tbox{border:1px solid #cbd5e1;border-radius:4px;padding:9px 11px;min-height:65px;font-size:9.5pt;line-height:1.65;margin-bottom:3px;font-weight:500}.chks{display:flex;gap:20px;margin:5px 0 3px;flex-wrap:wrap}.signotice{font-size:8pt;color:#374151;line-height:1.5;border:1px solid #e5e7eb;border-radius:4px;padding:7px 9px;margin:9px 0 7px;background:#f8fafc}.sigs{display:grid;grid-template-columns:1fr 1fr;gap:12px 28px;margin-bottom:9px}.sigs label{font-size:8pt;font-weight:700;color:#004f71;display:block;margin-bottom:2px}.sl{border-bottom:1.5px solid #374151;height:20px}.neg{border:1.5px solid #004f71;border-radius:4px;padding:7px 10px;margin-top:7px}.negtitle{background:#004f71;color:#fff;font-weight:700;font-size:8pt;padding:2px 7px;border-radius:2px;display:inline-block;margin-bottom:5px}.footer{font-size:7.5pt;color:#94a3b8;text-align:right;margin-top:8px;border-top:1px solid #e5e7eb;padding-top:5px}@media print{body{padding:14px}}</style></head><body><div class="hdr"><div class="title">FORMULARIO DE ACCIÓN<br>DISCIPLINARIA</div><div class="logo">🐔 Los Filtros FSU<span>Chick-fil-A</span></div></div><div class="meta"><div class="mf"><span class="ml">Nombre del Miembro del Equipo:</span><span class="mv">${WU.currentEmpName}</span></div><div class="mf"><span class="ml">Fecha del Incidente:</span><span class="mv">${incDateFmt}</span></div><div class="mf"><span class="ml">Fecha:</span><span class="mv">${today}</span></div><div class="mf"><span class="ml">Supervisor:</span><span class="mv">${sup}</span></div></div><div class="sec">VIOLACIÓN DE POLÍTICA</div><div class="cats"><div>${allCats[0].map(catItem).join('')}</div><div>${allCats[1].map(catItem).join('')}</div></div><div class="sec">DESCRIBA EL INCIDENTE</div><div class="tbox">${incident.replace(/\n/g,'<br/>')}</div><div class="sec">ACCIÓN DISCIPLINARIA</div><div class="chks">${chkRow(levelRows,level)}</div><div class="sec">ACCIÓN CORRECTIVA</div><div class="tbox">${corrective.replace(/\n/g,'<br/>')}</div><div class="sec">FALTA DE MEJORA</div><div class="chks">${chkRow(faltaRows,faltaKey)}</div><div class="tbox" style="min-height:48px">${consequence.replace(/\n/g,'<br/>')}</div><div class="signotice">Al firmar este documento reconozco que este informe ha sido completamente discutido y explicado por mi supervisor y entiendo que se me ha brindado la oportunidad de corregir mis acciones. Confirmo que se me brindó la oportunidad de explicar mi versión de los hechos.</div><div class="sigs"><div><label>Firma del Miembro del Equipo</label><div class="sl"></div></div><div><label>Fecha</label><div class="sl"></div></div><div><label>Firma del Supervisor</label><div class="sl"></div></div><div><label>Fecha</label><div class="sl"></div></div><div><label>Firma del Testigo</label><div class="sl"></div></div><div><label>Fecha</label><div class="sl"></div></div></div><div class="neg"><div class="negtitle">NEGATIVA DE FIRMA (si aplica)</div><div style="display:flex;align-items:center;gap:7px;font-size:8.5pt;margin-bottom:8px"><div style="width:13px;height:13px;border:1.5px solid #004f71;border-radius:2px;flex-shrink:0"></div><span>El Miembro del Equipo se negó a firmar después de que este documento le fue explicado completamente.</span></div><div class="sigs" style="margin-bottom:0"><div><label>Firma del Testigo</label><div class="sl"></div></div><div><label>Fecha</label><div class="sl"></div></div></div></div><div class="footer">Los Filtros FSU — Generado: ${today}</div><script>window.onload=()=>window.print();<\/script></body></html>`);win.document.close();}




// ══════════════════════════════════════════════════════════════════
// EOM PACKAGE GENERATOR MODULE
// Generates CFA Digital Package PDF from Gastos CSV + receipt images
// File format: 30014_YYYY_MM_PR.pdf
// ══════════════════════════════════════════════════════════════════

let _eomInited = false;
let _eomState = {
  payments: [],
  month: null,
  csvLoaded: false,
};

function eomInit() {
  if (_eomInited) { eomUpdateStats(); return; }
  _eomInited = true;
  document.getElementById('eomApp').innerHTML = eomBuildHTML();
  eomSetupDnD();
}

function eomBuildHTML() {
  return `
<style>
  #eomApp * { box-sizing: border-box; }
  .eom-layout { display: grid; grid-template-columns: 300px 1fr; min-height: calc(100vh - 120px); gap: 0; }
  .eom-left { background: #f8f9fa; border-right: 1px solid var(--border); padding: 18px; display: flex; flex-direction: column; gap: 16px; overflow-y: auto; }
  .eom-right { padding: 20px 24px; overflow-y: auto; display: flex; flex-direction: column; gap: 14px; }
  .eom-section-label { font-family: monospace; font-size: .68rem; color: var(--text-light); letter-spacing: .08em; text-transform: uppercase; margin-bottom: 6px; }
  .eom-upload-zone { border: 1.5px dashed var(--border); border-radius: 10px; padding: 16px 12px; text-align: center; cursor: pointer; transition: all .15s; background: #fff; }
  .eom-upload-zone:hover, .eom-upload-zone.drag-over { border-color: var(--navy); background: rgba(0,32,91,.04); }
  .eom-upload-zone .eom-uz-icon { font-size: 1.5rem; margin-bottom: 4px; opacity: .7; }
  .eom-upload-zone .eom-uz-title { font-size: .82rem; font-weight: 600; }
  .eom-upload-zone .eom-uz-sub { font-size: .72rem; color: var(--text-light); margin-top: 2px; }
  .eom-stats-row { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .eom-stat-card { background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; }
  .eom-stat-val { font-family: monospace; font-size: 1.25rem; font-weight: 700; color: var(--navy); line-height: 1; }
  .eom-stat-lbl { font-size: .68rem; color: var(--text-light); margin-top: 2px; }
  .eom-progress-bar { background: #e5e7eb; border-radius: 999px; height: 6px; overflow: hidden; margin-top: 8px; }
  .eom-progress-fill { height: 100%; background: var(--navy); border-radius: 999px; transition: width .4s; }
  .eom-progress-label { font-family: monospace; font-size: .7rem; color: var(--text-light); margin-top: 4px; }
  .eom-btn-generate { background: var(--navy); color: #fff; border: none; border-radius: 8px; padding: 11px; font-size: .88rem; font-weight: 700; cursor: pointer; width: 100%; transition: all .15s; display: flex; align-items: center; justify-content: center; gap: 8px; }
  .eom-btn-generate:hover:not(:disabled) { background: #001a5e; }
  .eom-btn-generate:disabled { opacity: .45; cursor: not-allowed; }
  .eom-tbl-wrap { border: 1px solid var(--border); border-radius: 10px; overflow: hidden; background: #fff; }
  .eom-tbl-header { padding: 11px 14px; display: flex; align-items: center; justify-content: space-between; border-bottom: 1px solid var(--border); background: #f8f9fa; font-size: .82rem; font-weight: 600; }
  .eom-table { width: 100%; border-collapse: collapse; font-size: .78rem; }
  .eom-table th { background: #f8f9fa; padding: 8px 10px; text-align: left; font-family: monospace; font-size: .67rem; color: var(--text-light); letter-spacing: .06em; border-bottom: 1px solid var(--border); white-space: nowrap; }
  .eom-table td { padding: 8px 10px; border-bottom: 1px solid rgba(0,0,0,.05); vertical-align: middle; }
  .eom-table tr:last-child td { border-bottom: none; }
  .eom-table tr:hover td { background: rgba(0,32,91,.02); }
  .eom-pmt-id { font-family: monospace; color: var(--navy); font-size: .75rem; }
  .eom-amount { font-family: monospace; text-align: right; }
  .eom-amount.pos { color: #16a34a; }
  .eom-amount.neg { color: var(--red); }
  .eom-receipt-slot { display: inline-flex; align-items: center; gap: 5px; font-size: .72rem; cursor: pointer; transition: color .15s; }
  .eom-receipt-slot.has { color: #16a34a; }
  .eom-receipt-slot.none { color: var(--text-light); }
  .eom-receipt-slot:hover { color: var(--navy); }
  .eom-badge { display: inline-block; padding: 2px 7px; border-radius: 99px; font-size: .67rem; font-family: monospace; font-weight: 700; }
  .eom-badge-ok { background: #dcfce7; color: #166534; border: 1px solid #bbf7d0; }
  .eom-badge-miss { background: #fee2e2; color: #991b1b; border: 1px solid #fecaca; }
  .eom-badge-wh { background: #f3f4f6; color: #6b7280; border: 1px solid #e5e7eb; }
  .eom-log { background: #f8f9fa; border: 1px solid var(--border); border-radius: 8px; padding: 10px 12px; font-family: monospace; font-size: .72rem; max-height: 150px; overflow-y: auto; display: none; }
  .eom-log.visible { display: block; }
  .eom-log-line { color: var(--text-mid); line-height: 1.7; }
  .eom-log-line.ok { color: #16a34a; }
  .eom-log-line.err { color: var(--red); }
  .eom-log-line.info { color: var(--navy); font-weight: 700; }
  .eom-wh-row td { opacity: .5; font-style: italic; }
  .eom-tbl-footer { padding: 9px 14px; display: flex; justify-content: flex-end; gap: 18px; border-top: 1px solid var(--border); background: #f8f9fa; }
  .eom-tbl-footer .fs { font-family: monospace; font-size: .76rem; color: var(--text-light); }
  .eom-tbl-footer .fs span { color: var(--text); font-weight: 700; }
  .eom-toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; background: #fff; border: 1px solid var(--border); border-radius: 8px; padding: 9px 12px; }
  .eom-search { background: #f8f9fa; border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-size: .78rem; padding: 6px 10px; outline: none; width: 200px; }
  .eom-search:focus { border-color: var(--navy); }
  .eom-empty { text-align: center; padding: 50px 20px; color: var(--text-light); }
  .eom-empty .big { font-size: 2.5rem; margin-bottom: 10px; }
  input[type=month].eom-month { background: #f8f9fa; border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-family: monospace; font-size: .8rem; padding: 7px 10px; outline: none; width: 100%; }
  input[type=month].eom-month:focus { border-color: var(--navy); }
</style>

<div class="eom-layout">
  <!-- LEFT PANEL -->
  <div class="eom-left">

    <div>
      <div class="eom-section-label">① Cargar GASTOS CSV</div>
      <div class="eom-upload-zone" id="eomCsvZone" onclick="document.getElementById('eomCsvInput').click()">
        <div class="eom-uz-icon">📄</div>
        <div class="eom-uz-title">GASTOS_PMT_DTL_EXPORT</div>
        <div class="eom-uz-sub">Arrastra o haz clic · .CSV</div>
        <input type="file" id="eomCsvInput" accept=".csv" style="display:none" onchange="eomHandleCSV(event)">
      </div>
    </div>

    <div id="eomStatsArea" style="display:none">
      <div class="eom-section-label">Resumen del Mes</div>
      <div class="eom-stats-row">
        <div class="eom-stat-card"><div class="eom-stat-val" id="eomStatPmt">0</div><div class="eom-stat-lbl">Payment IDs</div></div>
        <div class="eom-stat-card"><div class="eom-stat-val" id="eomStatTotal">$0</div><div class="eom-stat-lbl">Total Gastos</div></div>
        <div class="eom-stat-card"><div class="eom-stat-val" id="eomStatReady" style="color:#16a34a">0</div><div class="eom-stat-lbl">Recibos listos</div></div>
        <div class="eom-stat-card"><div class="eom-stat-val" id="eomStatMiss" style="color:var(--red)">0</div><div class="eom-stat-lbl">Sin recibo</div></div>
      </div>
      <div class="eom-progress-bar"><div class="eom-progress-fill" id="eomProgressFill" style="width:0%"></div></div>
      <div class="eom-progress-label" id="eomProgressLabel">0 de 0 listos</div>
    </div>

    <div id="eomMonthArea" style="display:none">
      <div class="eom-section-label">② Período del Paquete</div>
      <input type="month" id="eomMonthPicker" class="eom-month" onchange="eomUpdateMonth()">
      <div style="margin-top:6px;font-size:.71rem;color:var(--text-light)">
        Archivo: <span style="color:var(--navy);font-family:monospace" id="eomFilenamePrev">30014_YYYY_MM_PR.pdf</span>
      </div>
    </div>

    <div id="eomBulkArea" style="display:none">
      <div class="eom-section-label">③ Subir Recibos (Bulk)</div>
      <div class="eom-upload-zone" id="eomBulkZone" onclick="document.getElementById('eomBulkInput').click()">
        <div class="eom-uz-icon">🖼</div>
        <div class="eom-uz-title">Subir todos los recibos</div>
        <div class="eom-uz-sub">JPG, PNG, PDF · múltiples archivos<br>Nombra con el Payment ID para auto-asignación</div>
        <input type="file" id="eomBulkInput" accept="image/*,.pdf" multiple style="display:none" onchange="eomHandleBulkReceipts(event)">
      </div>
    </div>

    <div id="eomGenArea" style="display:none">
      <div class="eom-section-label">④ Generar Paquete</div>
      <button class="eom-btn-generate" id="eomGenBtn" onclick="eomGeneratePackage()">
        ⬇ Generar PDF EOM
      </button>
      <div id="eomLogPanel" class="eom-log" style="margin-top:10px"></div>
    </div>

    <div>
      <button class="btn btn-sm" onclick="eomReset()" style="width:100%;color:var(--red);border-color:var(--red)">↺ Reset</button>
    </div>

  </div><!-- /eom-left -->

  <!-- RIGHT PANEL -->
  <div class="eom-right" id="eomRight">
    <div class="eom-empty">
      <div class="big">📂</div>
      <p>Carga el CSV de Gastos para comenzar.<br>Los Payment IDs se mostrarán aquí.</p>
    </div>
  </div>
</div>`;
}

// ── CSV Parsing ────────────────────────────────────────────────
async function eomHandleCSV(e) {
  const file = e.target.files[0];
  if (!file) return;
  const ab = await file.arrayBuffer();
  const text = new TextDecoder('windows-1252').decode(ab);
  eomParseCSV(text);
}

function eomParseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (!lines.length) return;

  const headers = eomParseLine(lines[0]);
  const rows = lines.slice(1).map(l => {
    const vals = eomParseLine(l);
    const obj = {};
    headers.forEach((h, i) => obj[h.trim()] = (vals[i] || '').trim());
    return obj;
  }).filter(r => r.PAYMENT_ID);

  const pmtMap = new Map();
  rows.forEach(r => {
    const id = r.PAYMENT_ID;
    if (!pmtMap.has(id)) {
      pmtMap.set(id, { pmtId: id, vendor: r.VENDOR, date: r.PAYMENT_DATE, invoices: [], receipts: [], totalNet: 0 });
    }
    const p = pmtMap.get(id);
    const amt = parseFloat(r.AMOUNT) || 0;
    p.invoices.push({ invNum: r.INVOICE_NUMBER, invDate: r.INVOICE_DATE, category: r.EXPENSE_CATEGORY, description: r.DESCRIPTION, amount: amt });
    p.totalNet += amt;
  });

  _eomState.payments = Array.from(pmtMap.values()).sort((a, b) => a.pmtId.localeCompare(b.pmtId));
  _eomState.csvLoaded = true;

  eomDetectMonth();
  eomRenderTable();
  eomUpdateStats();
  eomShowPanels();

  const zone = document.getElementById('eomCsvZone');
  if (zone) { zone.style.borderColor = '#16a34a'; zone.querySelector('.eom-uz-title').textContent = `✓ ${_eomState.payments.length} Payment IDs`; }
  showToast(`✅ CSV cargado — ${_eomState.payments.length} Payment IDs`, 'success');
}

function eomParseLine(line) {
  const result = [];
  let inQ = false, cur = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { inQ = !inQ; continue; }
    if (c === ',' && !inQ) { result.push(cur); cur = ''; continue; }
    cur += c;
  }
  result.push(cur);
  return result;
}

function eomDetectMonth() {
  if (!_eomState.payments.length) return;
  const mmap = { JAN:'01',FEB:'02',MAR:'03',APR:'04',MAY:'05',JUN:'06',JUL:'07',AUG:'08',SEP:'09',OCT:'10',NOV:'11',DEC:'12' };
  const date = _eomState.payments[0].date; // e.g. "03-NOV-2025"
  if (!date) return;
  const parts = date.split('-');
  if (parts.length === 3) {
    const yr = parts[2], mo = mmap[parts[1].toUpperCase()] || '01';
    const val = `${yr}-${mo}`;
    const picker = document.getElementById('eomMonthPicker');
    if (picker) picker.value = val;
    _eomState.month = val;
    eomUpdateMonth();
  }
}

function eomUpdateMonth() {
  const val = document.getElementById('eomMonthPicker')?.value;
  if (!val) return;
  _eomState.month = val;
  const [yr, mo] = val.split('-');
  const prev = document.getElementById('eomFilenamePrev');
  if (prev) prev.textContent = `30014_${yr}_${mo}_PR.pdf`;
}

// ── Bulk Receipt Upload ────────────────────────────────────────
async function eomHandleBulkReceipts(e) {
  const files = Array.from(e.target.files);
  let matched = 0, unmatched = 0;
  files.forEach(file => {
    const name = file.name.replace(/\.[^.]+$/, '');
    const pmtId = name.replace(/[^0-9]/g, '');
    const payment = _eomState.payments.find(p => p.pmtId === pmtId);
    if (payment) { payment.receipts = [file]; matched++; }
    else unmatched++;
  });
  eomUpdateStats();
  eomRenderTable();
  showToast(`📎 ${matched} asignados${unmatched ? `, ${unmatched} sin coincidencia` : ''}`, 'info');
}

// ── Per-Row Receipt Upload ─────────────────────────────────────
function eomHandleRowReceipt(pmtId, input) {
  const file = input.files[0];
  if (!file) return;
  const payment = _eomState.payments.find(p => p.pmtId === pmtId);
  if (!payment) return;
  payment.receipts = [file];
  eomUpdateStats();
  eomRenderTable();
}

// ── Render Table ───────────────────────────────────────────────
function eomRenderTable() {
  const right = document.getElementById('eomRight');
  if (!right) return;

  const totals = eomCalcTotals();

  right.innerHTML = `
    <div class="eom-toolbar">
      <input type="search" class="eom-search" id="eomSearch" placeholder="Vendor, Payment ID..." oninput="eomFilterTable(this.value)">
      <button class="btn btn-sm" onclick="eomFilterTable(''); document.getElementById('eomSearch').value=''">Todos</button>
      <button class="btn btn-sm" onclick="eomFilterMissing()">Sin recibo</button>
      <span style="margin-left:auto;font-size:.75rem;color:var(--text-light)" id="eomFilterInfo"></span>
    </div>
    <div class="eom-tbl-wrap">
      <div class="eom-tbl-header">
        <span>Invoices por Payment ID</span>
        <span style="font-size:.72rem;font-weight:400;color:var(--text-light)">Orden: <span style="font-family:monospace;color:var(--navy)">Payment ID ↑</span></span>
      </div>
      <div style="max-height:calc(100vh - 280px);overflow-y:auto">
        <table class="eom-table">
          <thead><tr>
            <th>PAYMENT ID</th><th>VENDOR</th><th>FECHA PMT</th>
            <th>INVOICE #</th><th>CATEGORÍA</th><th style="text-align:right">MONTO</th><th>RECIBO</th>
          </tr></thead>
          <tbody id="eomTableBody"></tbody>
        </table>
      </div>
      <div class="eom-tbl-footer">
        <span class="fs">Positivo: <span style="color:#16a34a">$${totals.positive.toFixed(2)}</span></span>
        <span class="fs">Withholding: <span style="color:var(--red)">$${Math.abs(totals.negative).toFixed(2)}</span></span>
        <span class="fs">Net: <span>$${totals.net.toFixed(2)}</span></span>
      </div>
    </div>`;

  eomPopulateBody(_eomState.payments);
}

function eomPopulateBody(payments) {
  const tbody = document.getElementById('eomTableBody');
  if (!tbody) return;
  let html = '';
  payments.forEach(p => {
    const hasR = p.receipts.length > 0;
    const isWH = p.totalNet <= 0;
    const badge = isWH ? `<span class="eom-badge eom-badge-wh">WH</span>` :
                  hasR  ? `<span class="eom-badge eom-badge-ok">✓ Listo</span>` :
                          `<span class="eom-badge eom-badge-miss">Falta</span>`;
    const rowClass = isWH ? 'eom-wh-row' : '';
    const receiptCell = hasR
      ? `<label class="eom-receipt-slot has" title="Cambiar recibo"><span>📎 ${p.receipts[0].name.substring(0,14)}…</span><input type="file" accept="image/*,.pdf" style="display:none" onchange="eomHandleRowReceipt('${p.pmtId}',this)"></label>`
      : `<label class="eom-receipt-slot none"><span>＋ Subir</span><input type="file" accept="image/*,.pdf" style="display:none" onchange="eomHandleRowReceipt('${p.pmtId}',this)"></label>`;

    p.invoices.forEach((inv, idx) => {
      const isFirst = idx === 0;
      const rspan = p.invoices.length;
      html += `<tr class="${rowClass}" data-pmtid="${p.pmtId}">
        ${isFirst ? `<td class="eom-pmt-id" rowspan="${rspan}">${p.pmtId}</td>` : ''}
        ${isFirst ? `<td rowspan="${rspan}" style="max-width:130px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${p.vendor}">${p.vendor}</td>` : ''}
        ${isFirst ? `<td rowspan="${rspan}" style="font-size:.74rem;white-space:nowrap">${p.date}</td>` : ''}
        <td style="font-family:monospace;font-size:.74rem">${inv.invNum || '—'}</td>
        <td style="font-size:.72rem;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${inv.category}">${inv.category || '—'}</td>
        <td class="eom-amount ${inv.amount < 0 ? 'neg' : 'pos'}">${inv.amount < 0 ? '-' : ''}$${Math.abs(inv.amount).toFixed(2)}</td>
        ${isFirst ? `<td rowspan="${rspan}">${badge}<br><div style="margin-top:4px">${receiptCell}</div></td>` : ''}
      </tr>`;
    });
  });
  tbody.innerHTML = html || '<tr><td colspan="7" style="text-align:center;padding:20px;color:var(--text-light)">Sin resultados</td></tr>';
}

function eomFilterTable(query) {
  const lq = (query || '').toLowerCase();
  const filtered = lq
    ? _eomState.payments.filter(p => p.pmtId.includes(lq) || p.vendor.toLowerCase().includes(lq) || p.invoices.some(i => (i.invNum||'').toLowerCase().includes(lq)))
    : _eomState.payments;
  eomPopulateBody(filtered);
  const info = document.getElementById('eomFilterInfo');
  if (info) info.textContent = filtered.length < _eomState.payments.length ? `Mostrando ${filtered.length} de ${_eomState.payments.length}` : '';
}

function eomFilterMissing() {
  const el = document.getElementById('eomSearch');
  if (el) el.value = '';
  const filtered = _eomState.payments.filter(p => p.receipts.length === 0 && p.totalNet > 0);
  eomPopulateBody(filtered);
  const info = document.getElementById('eomFilterInfo');
  if (info) info.textContent = `${filtered.length} sin recibo`;
}

function eomCalcTotals() {
  let positive = 0, negative = 0;
  _eomState.payments.forEach(p => p.invoices.forEach(inv => {
    if (inv.amount >= 0) positive += inv.amount;
    else negative += inv.amount;
  }));
  return { positive, negative, net: positive + negative };
}

// ── Stats ──────────────────────────────────────────────────────
function eomUpdateStats() {
  if (!_eomState.payments.length) return;
  const totals = eomCalcTotals();
  const ready = _eomState.payments.filter(p => p.receipts.length > 0 || p.totalNet <= 0).length;
  const missing = _eomState.payments.filter(p => p.receipts.length === 0 && p.totalNet > 0).length;
  const total = totals.positive;

  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('eomStatPmt', _eomState.payments.length);
  set('eomStatTotal', '$' + total.toLocaleString('en-US', {minimumFractionDigits:2, maximumFractionDigits:2}));
  set('eomStatReady', ready);
  set('eomStatMiss', missing);

  const pct = Math.round((ready / _eomState.payments.length) * 100);
  const fill = document.getElementById('eomProgressFill');
  if (fill) fill.style.width = pct + '%';
  const lbl = document.getElementById('eomProgressLabel');
  if (lbl) lbl.textContent = `${ready} de ${_eomState.payments.length} listos (${pct}%)`;
}

function eomShowPanels() {
  ['eomStatsArea','eomMonthArea','eomBulkArea','eomGenArea'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = 'block';
  });
}

// ── PDF Generation ─────────────────────────────────────────────
async function eomGeneratePackage() {
  if (!window.PDFLib) { showToast('pdf-lib no cargado. Recarga la página.', 'error'); return; }
  const btn = document.getElementById('eomGenBtn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Generando…'; }

  const log = document.getElementById('eomLogPanel');
  if (log) { log.innerHTML = ''; log.classList.add('visible'); }

  function addLog(msg, type = '') {
    if (!log) return;
    const d = document.createElement('div');
    d.className = `eom-log-line ${type}`;
    d.textContent = msg;
    log.appendChild(d);
    log.scrollTop = log.scrollHeight;
  }

  try {
    const { PDFDocument, StandardFonts, rgb } = PDFLib;
    addLog('▶ Iniciando generación del paquete EOM…', 'info');

    const pdfDoc = await PDFDocument.create();
    const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const fontReg = await pdfDoc.embedFont(StandardFonts.Helvetica);

    const sorted = [..._eomState.payments].sort((a, b) => parseInt(a.pmtId) - parseInt(b.pmtId));

    addLog('📄 Portada…');
    await eomAddCoverPage(pdfDoc, font, fontReg, rgb);
    addLog('📋 Resumen…');
    await eomAddSummaryPage(pdfDoc, font, fontReg, rgb, sorted);

    let processed = 0, skipped = 0;

    for (const payment of sorted) {
      if (payment.totalNet <= 0) { skipped++; continue; }
      if (!payment.receipts.length) {
        addLog(`⚠ Sin recibo: PMT ${payment.pmtId} — ${payment.vendor}`, 'err');
        await eomAddPlaceholderPage(pdfDoc, font, fontReg, rgb, payment);
        continue;
      }
      addLog(`✓ PMT ${payment.pmtId} — ${payment.vendor}`, 'ok');
      const file = payment.receipts[0];
      try {
        if (file.type === 'application/pdf') await eomAddReceiptPDF(pdfDoc, font, rgb, file, payment);
        else await eomAddReceiptImage(pdfDoc, font, fontReg, rgb, file, payment);
        processed++;
      } catch (err) {
        addLog(`  ✗ Error: ${err.message}`, 'err');
        await eomAddPlaceholderPage(pdfDoc, font, fontReg, rgb, payment);
      }
    }

    addLog(`\n✅ ${processed} recibos procesados, ${skipped} withholding omitidos`, 'ok');
    addLog('📦 Guardando PDF…', 'info');

    const pdfBytes = await pdfDoc.save();
    const mb = (pdfBytes.length / 1024 / 1024).toFixed(2);
    addLog(`📊 Tamaño: ${mb} MB ${parseFloat(mb) > 50 ? '⚠ EXCEDE 50MB!' : '✓'}`, parseFloat(mb) > 50 ? 'err' : 'ok');

    const [yr, mo] = (_eomState.month || '2025-01').split('-');
    const filename = `30014_${yr}_${mo}_PR.pdf`;
    eomDownloadPDF(pdfBytes, filename);
    addLog(`⬇ Descargado: ${filename}`, 'ok');
    showToast(`✅ Paquete EOM generado — ${mb} MB`, 'success');

  } catch (err) {
    addLog(`✗ Error: ${err.message}`, 'err');
    showToast('Error al generar el PDF: ' + err.message, 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = '⬇ Generar PDF EOM'; }
  }
}

async function eomAddCoverPage(pdfDoc, font, fontReg, rgb) {
  const page = pdfDoc.addPage([612, 792]);
  const { width, height } = page.getSize();
  page.drawRectangle({ x:0,y:0,width,height, color:rgb(0.05,0.08,0.22) });
  page.drawRectangle({ x:0,y:height-8,width,height:8, color:rgb(0.75,0.19,0.22) });
  page.drawText('END OF MONTH PACKAGE', { x:50,y:height-70,size:24,font,color:rgb(1,1,1) });
  page.drawText('Los Filtros FSU — Store #30014', { x:50,y:height-98,size:13,font:fontReg,color:rgb(0.8,0.85,0.9) });
  const [yr,mo] = (_eomState.month||'2025-01').split('-');
  const mNames=['','Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  page.drawText(`${mNames[parseInt(mo)]||mo} ${yr}`, { x:50,y:height-125,size:17,font,color:rgb(0.92,0.63,0.13) });
  page.drawLine({ start:{x:50,y:height-148},end:{x:width-50,y:height-148},thickness:1,color:rgb(0.15,0.18,0.35) });
  const totals = eomCalcTotals();
  const ready = _eomState.payments.filter(p=>p.receipts.length>0).length;
  const stats = [
    ['Payment IDs', _eomState.payments.length.toString()],
    ['Total Gastos', '$'+totals.positive.toLocaleString('en-US',{minimumFractionDigits:2})],
    ['Withholding', '$'+Math.abs(totals.negative).toLocaleString('en-US',{minimumFractionDigits:2})],
    ['Net Total', '$'+totals.net.toLocaleString('en-US',{minimumFractionDigits:2})],
    ['Recibos Incluidos', ready.toString()],
  ];
  let y = height-190;
  stats.forEach(([lbl,val]) => {
    page.drawText(lbl+':', {x:50,y,size:11,font:fontReg,color:rgb(0.5,0.55,0.65)});
    page.drawText(val, {x:240,y,size:11,font,color:rgb(0.9,0.92,0.95)});
    y -= 22;
  });
  page.drawText(`Generado: ${new Date().toLocaleDateString('es-PR')} · GlobalDigitalFCRPackage@chick-fil-a.com`, {x:50,y:28,size:8,font:fontReg,color:rgb(0.4,0.45,0.55)});
}

async function eomAddSummaryPage(pdfDoc, font, fontReg, rgb, payments) {
  const page = pdfDoc.addPage([612, 792]);
  const { width, height } = page.getSize();
  page.drawRectangle({ x:0,y:0,width,height,color:rgb(1,1,1) });
  page.drawText('RESUMEN DE PAYMENT IDs', {x:50,y:height-48,size:15,font,color:rgb(0.05,0.08,0.22)});
  page.drawLine({start:{x:50,y:height-62},end:{x:width-50,y:height-62},thickness:1,color:rgb(0.85,0.87,0.9)});
  let y = height-86;
  const cols = [[50,'PAYMENT ID'],[140,'VENDOR'],[285,'FECHA'],[360,'NET'],[430,'RECIBO']];
  cols.forEach(([x,lbl]) => page.drawText(lbl,{x,y,size:8,font,color:rgb(0.55,0.58,0.65)}));
  y-=5; page.drawLine({start:{x:50,y},end:{x:width-50,y},thickness:.5,color:rgb(0.85,0.87,0.9)}); y-=12;
  for (const p of payments) {
    if (y < 50) { const np=pdfDoc.addPage([612,792]); np.drawRectangle({x:0,y:0,width:612,height:792,color:rgb(1,1,1)}); y=742; }
    const hasR=p.receipts.length>0, isWH=p.totalNet<=0;
    const rCol=isWH?rgb(0.6,0.63,0.7):hasR?rgb(0.09,0.67,0.28):rgb(0.86,0.14,0.16);
    const vendor=p.vendor.length>22?p.vendor.substring(0,22)+'…':p.vendor;
    page.drawText(p.pmtId,{x:50,y,size:8,font,color:rgb(0.05,0.08,0.22)});
    page.drawText(vendor,{x:140,y,size:8,font:fontReg,color:rgb(0.2,0.22,0.28)});
    page.drawText(p.date,{x:285,y,size:8,font:fontReg,color:rgb(0.35,0.38,0.45)});
    page.drawText('$'+p.totalNet.toFixed(2),{x:360,y,size:8,font,color:p.totalNet<0?rgb(0.86,0.14,0.16):rgb(0.09,0.67,0.28)});
    page.drawText(isWH?'WH':hasR?'✓':'✗',{x:430,y,size:8,font,color:rCol});
    y-=13;
  }
}

async function eomAddReceiptImage(pdfDoc, font, fontReg, rgb, file, payment) {
  const page = pdfDoc.addPage([612, 792]);
  const { width, height } = page.getSize();
  page.drawRectangle({x:0,y:0,width,height,color:rgb(1,1,1)});
  page.drawRectangle({x:0,y:height-46,width,height:46,color:rgb(0.05,0.08,0.22)});
  page.drawText(`PMT ID: ${payment.pmtId}`,{x:12,y:height-22,size:12,font,color:rgb(0.92,0.63,0.13)});
  page.drawText(payment.vendor.substring(0,42),{x:12,y:height-36,size:8,font:fontReg,color:rgb(0.8,0.85,0.9)});
  page.drawText('$'+Math.abs(payment.totalNet).toFixed(2),{x:width-80,y:height-24,size:11,font,color:rgb(0.09,0.67,0.28)});
  page.drawText(payment.date,{x:width-90,y:height-37,size:8,font:fontReg,color:rgb(0.6,0.65,0.72)});

  const ab = await file.arrayBuffer();
  let img;
  if (file.type === 'image/png') img = await pdfDoc.embedPng(ab);
  else img = await pdfDoc.embedJpg(ab);
  const dim = img.scaleToFit(width-40, height-100);
  const imgX = (width-dim.width)/2, imgY = 18;
  page.drawImage(img,{x:imgX,y:imgY,width:dim.width,height:dim.height});
  page.drawText(payment.pmtId,{x:imgX+4,y:imgY+dim.height-18,size:13,font,color:rgb(0.92,0.63,0.13),opacity:0.95});
}

async function eomAddReceiptPDF(pdfDoc, font, rgb, file, payment) {
  const ab = await file.arrayBuffer();
  const src = await PDFLib.PDFDocument.load(ab);
  const count = src.getPageCount();
  for (let i = 0; i < count; i++) {
    const [pg] = await pdfDoc.copyPages(src,[i]);
    pdfDoc.addPage(pg);
    if (i===0) {
      const last = pdfDoc.getPage(pdfDoc.getPageCount()-1);
      const {width,height} = last.getSize();
      last.drawRectangle({x:0,y:height-30,width,height:30,color:rgb(0.05,0.08,0.22),opacity:0.9});
      last.drawText(`PMT ID: ${payment.pmtId} — ${payment.vendor.substring(0,35)} — $${payment.totalNet.toFixed(2)}`,{x:10,y:height-20,size:10,font,color:rgb(0.92,0.63,0.13)});
    }
  }
}

async function eomAddPlaceholderPage(pdfDoc, font, fontReg, rgb, payment) {
  const page = pdfDoc.addPage([612, 792]);
  const { width, height } = page.getSize();
  page.drawRectangle({x:0,y:0,width,height,color:rgb(1,1,1)});
  page.drawRectangle({x:0,y:height-46,width,height:46,color:rgb(0.95,0.3,0.3)});
  page.drawText(`PMT ID: ${payment.pmtId} — RECIBO FALTANTE`,{x:12,y:height-22,size:11,font,color:rgb(1,1,1)});
  page.drawText(payment.vendor,{x:12,y:height-37,size:8,font:fontReg,color:rgb(1,1,1)});
  page.drawText('RECIBO NO CARGADO',{x:width/2-80,y:height/2,size:16,font,color:rgb(0.8,0.25,0.25)});
}

function eomDownloadPDF(bytes, filename) {
  const blob = new Blob([bytes],{type:'application/pdf'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href=url; a.download=filename;
  document.body.appendChild(a); a.click();
  document.body.removeChild(a);
  setTimeout(()=>URL.revokeObjectURL(url),5000);
}

// ── Reset ──────────────────────────────────────────────────────
function eomReset() {
  _eomState = { payments: [], month: null, csvLoaded: false };
  _eomInited = false;
  document.getElementById('eomApp').innerHTML = '';
  eomInit();
  showToast('Reset completo', 'info');
}

// ── Drag & Drop ────────────────────────────────────────────────
function eomSetupDnD() {
  const zone = document.getElementById('eomCsvZone');
  if (!zone) return;
  zone.addEventListener('dragover', e => { e.preventDefault(); zone.classList.add('drag-over'); });
  zone.addEventListener('dragleave', () => zone.classList.remove('drag-over'));
  zone.addEventListener('drop', e => {
    e.preventDefault(); zone.classList.remove('drag-over');
    const files = e.dataTransfer.files;
    if (files.length) eomHandleCSV({ target: { files } });
  });
}
