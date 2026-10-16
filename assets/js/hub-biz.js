// Los Filtros Hub v2 — tabs built from the cfahome data map (Oct 2026):
// Sales (Sales Analytics), Monthly P&L (Management Tool), Cash (Cash Management Risk + deposit alerts),
// Speed & quality (Speed of Service, AHA, Smart Shop, food safety audit), plus Actual vs scheduled hours
// on Productivity and Retention & turnover on Staffing.
// Daily/monthly numbers live in hub_metrics (one row per metric per day or month); the P&L in pl_months.
(function () {
  const H = window.H;
  const longD = H.longD, monthOf = H.monthKey, addMonths = H.addMonths, monthEnd = H.monthEnd;
  const sum = a => a.reduce((s, v) => s + (+v || 0), 0);
  const avg = a => { const v = a.filter(x => x != null && !isNaN(x)); return v.length ? sum(v) / v.length : null; };
  const secs = v => { if (v == null || v === '') return null; const s = String(v).trim(); const m = s.match(/^(\d+):(\d{1,2})(?::(\d{1,2}))?$/); if (m) return m[3] != null ? +m[1] * 3600 + +m[2] * 60 + +m[3] : +m[1] * 60 + +m[2]; return H.toNum(s); };
  const mmss = s => s == null ? '—' : `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;
  const pts = (a, b, d = 1) => { if (a == null || b == null) return ''; const x = +(a - b).toFixed(d); return x === 0 ? `<span style="font-weight:600">${(0).toFixed(d)}</span>` : `<span style="color:var(--${x > 0 ? 'ok' : 'bad'});font-weight:600">${x > 0 ? '+' : ''}${x.toFixed(d)}</span>`; };
  const srcNote = (when, what) => when ? `<div class="source">${H.svg('import').replace('<svg', '<svg width="15" height="15" stroke="currentColor" fill="none" stroke-width="2"')}<span>Last updated ${H.esc(H.fmtDT(when))} · ${H.esc(what)}</span></div>` : '';
  const emptyCard = (title, text, btn) => `<div class="card card-pad"><div class="li-title">${H.esc(title)}</div><div class="li-sub mt-s" style="max-width:66ch">${text}</div>${btn ? `<div class="row mt">${btn}</div>` : ''}</div>`;
  const monthSelect = (id, months, cur, fn) => `<div class="row mb"><label class="small muted" for="${id}">Month</label><select id="${id}" class="sel" onchange="${fn}(this.value)">${months.slice().reverse().map(k => `<option value="${k}" ${k === cur ? 'selected' : ''}>${H.esc(H.monthLabel(k, true))}</option>`).join('')}</select></div>`;

  // ── hub_metrics access (paged; Supabase returns at most 1,000 rows per request) ──
  H.metricRows = async (prefix, from) => {
    const out = [];
    for (let i = 0; i < 50; i++) {
      let q = getSupa().from('hub_metrics').select('*').like('metric', prefix + '%');
      if (from) q = q.gte('on_date', from);
      const { data, error } = await q.order('on_date', { ascending: true }).range(i * 1000, i * 1000 + 999);
      if (error) { console.warn('[hub] metrics', error.message); return out.length ? out : null; }
      out.push(...(data || [])); if (!data || data.length < 1000) break;
    }
    return out;
  };
  // rows → { 'YYYY-MM-DD': { metric: value } }
  const byDate = rows => { const o = {}; (rows || []).forEach(r => { (o[r.on_date] = o[r.on_date] || {})[r.metric] = r.value == null ? null : +r.value; }); return o; };
  const lastPulled = rows => (rows || []).map(r => r.pulled_at).filter(Boolean).sort().pop();
  const saveMetrics = async rows => { for (let i = 0; i < rows.length; i += 500) await H.db.upsert('hub_metrics', rows.slice(i, i + 500), 'metric,grain,on_date'); H.db.bust('hub_metrics'); };
  const M = (metric, grain, on_date, value, source, detail) => ({ metric, grain, on_date, value: value == null || isNaN(value) ? null : value, source, detail: detail || null, pulled_at: new Date().toISOString() });
  const dayChecks = (dates, red, amber) => {
    const today = H.today();
    dates.forEach(d => { if (d >= today) red.push(`${longD(d)} isn't finished yet. Only full days.`); if (H.storeClosed(d)) amber.push(`${longD(d)}: the store is normally closed that day.`); });
  };
  const readyHtml = (n, what, red, amber) => `<span style="color:var(--ok);font-weight:600">${n} ${what} read</span>${H.flagHtml(red, amber)}`;

  // ═════════════ SALES ═════════════
  const CHANNELS = [['drive_thru', 'Drive-thru', ['drive thru', 'drive-thru', 'drivethru', 'dt', 'drive']], ['dine_in', 'Dine-in', ['dine in', 'dine-in', 'dinein']], ['carry_out', 'Carry-out', ['carry out', 'carry-out', 'carryout', 'take out', 'to go']], ['delivery', 'Delivery (3PD)', ['3pd', 'delivery', 'third party', 'doordash', 'uber eats']], ['catering', 'Catering', ['catering']]];
  const SOURCES = [['mobile', 'Mobile app', ['mobile', 'app']], ['web', 'Web', ['web', 'online']], ['pos', 'Register (POS)', ['pos', 'register']], ['ext_pos', 'Outside POS', ['extpos', 'ext pos', 'external pos']]];
  const normKey = (v, list) => { const s = String(v || '').toLowerCase().replace(/[_]+/g, ' ').trim(); const hit = list.find(([k, , al]) => k === s.replace(/ /g, '_') || al.includes(s)); return hit ? hit[0] : null; };
  const SL = { month: null };
  H.pages.sales = {
    async render(host) {
      host.innerHTML = `<div class="ph"><div><h2>Sales</h2><p>Sales and guest counts by month and by channel from cfahome Sales Analytics, compared with the same month last year.</p></div>
        <div class="actions"><button class="btn btn-primary" onclick="H.pages.sales.importRows()">Update from cfahome</button></div></div><div id="slBody"><div class="li-empty">Loading…</div></div>`;
      const [days, ch, lyCh] = await Promise.all([H.db.list('productivity_days', { order: 'day' }), H.metricRows('sales:'), H.metricRows('ly_sales:')]);
      const body = document.getElementById('slBody'); if (!body) return;
      if (days === null) return H.missingTable(body, 'productivity_days');
      if (ch === null) return H.missingTable(body, 'hub_metrics');
      const chDays = byDate(ch), lyDays = byDate(lyCh);
      const months = [...new Set([...days.map(d => monthOf(d.day)), ...Object.keys(chDays).map(monthOf)])].sort();
      if (!months.length) { body.innerHTML = emptyCard('No sales yet', 'Click <strong>Update with Claude</strong> at the top, or paste daily sales by channel from cfahome → Analytics Hub → Sales &amp; Brand Growth → Sales Analytics (day view).', '<button class="btn btn-primary" onclick="H.pages.sales.importRows()">Update from cfahome</button>'); return; }
      if (!SL.month || !months.includes(SL.month)) SL.month = months[months.length - 1];
      const md = days.filter(d => monthOf(d.day) === SL.month && d.sales != null);
      const sales = sum(md.map(d => d.sales)), ly = sum(md.map(d => d.last_year_sales)), tc = sum(md.map(d => d.transactions));
      const lyHasAll = md.length && md.every(d => d.last_year_sales != null);
      // Channels for the month
      const chRows = CHANNELS.concat(SOURCES).map(([k, label]) => {
        const s = sum(Object.entries(chDays).filter(([d]) => monthOf(d) === SL.month).map(([, v]) => v['sales:' + k]));
        const l = sum(Object.entries(lyDays).filter(([d]) => monthOf(d) === SL.month).map(([, v]) => v['ly_sales:' + k]));
        return { k, label, s, l, src: SOURCES.some(x => x[0] === k) };
      });
      const chTotal = sum(chRows.filter(r => !r.src).map(r => r.s));
      const digital = sum(chRows.filter(r => ['mobile', 'web'].includes(r.k)).map(r => r.s));
      const lastDay = md.length ? md[md.length - 1].day : null;
      const partial = lastDay && lastDay < monthEnd(SL.month);
      const dow = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((n, i) => { const ds = md.filter(d => H.d(d.day).getDay() === i + 1); return { n, s: avg(ds.map(d => d.sales)), l: avg(ds.map(d => d.last_year_sales)) }; });
      const pulled = lastPulled(ch) || (md[md.length - 1] || {}).pulled_at;
      body.innerHTML = `${srcNote(pulled, 'cfahome Sales Analytics' + (lastDay ? ` · through ${longD(lastDay)}` : ''))}
        ${monthSelect('slMonth', months, SL.month, 'H.pages.sales.setMonth')}
        <div class="kpis">
          <div class="kpi"><div class="kpi-label">Sales · ${H.esc(H.monthLabel(SL.month, true))}</div><div class="kpi-val">${H.money(sales)}</div><div class="kpi-sub">${ly ? H.delta(sales, ly, true) + ' vs same days last year' : 'No last-year numbers yet'}${partial ? ` · through ${H.fmtD(lastDay)}` : ''}</div></div>
          <div class="kpi"><div class="kpi-label">Transactions</div><div class="kpi-val">${H.num(tc)}</div><div class="kpi-sub">${md.length} days open</div></div>
          <div class="kpi"><div class="kpi-label">Check average</div><div class="kpi-val">${tc ? H.money(sales / tc, true) : '—'}</div><div class="kpi-sub">Per transaction</div></div>
          <div class="kpi"><div class="kpi-label">Average day</div><div class="kpi-val">${md.length ? H.money(sales / md.length) : '—'}</div><div class="kpi-sub">${ly && md.length ? `Last year ${H.money(ly / md.length)}` : '&nbsp;'}</div></div>
          <div class="kpi"><div class="kpi-label">Digital share</div><div class="kpi-val">${chTotal ? H.pct(digital / chTotal * 100) : '—'}</div><div class="kpi-sub">Mobile app + web</div></div>
        </div>
        <div class="split">
          <div class="card card-pad"><div class="section-label">Sales by day · ${H.esc(H.monthLabel(SL.month, true))}</div>
            ${md.length ? H.barChart({ labels: md.map(d => String(H.d(d.day).getDate())), series: [{ name: 'This year', color: 'var(--red)', values: md.map(d => +d.sales) }, { name: 'Same day last year', color: '#C9CBD3', values: md.map(d => d.last_year_sales == null ? null : +d.last_year_sales) }], fmt: v => '$' + Math.round(v / 1000) + 'k', min: Math.max(0, Math.floor(Math.min(...md.map(d => +d.sales)) * 0.7 / 1000) * 1000) }) : '<div class="li-empty">No days yet.</div>'}
            ${!lyHasAll && md.length ? '<div class="small muted mt-s">Some days have no last-year sales. Comparisons use only days that have both.</div>' : ''}</div>
          <div class="card card-pad"><div class="section-label">Average day of the week</div>
            ${dow.map(d => `<div class="metric-row wide"><span>${d.n}</span><div class="bar ${d.l && d.s >= d.l ? 'ok' : d.l ? 'bad' : ''}"><i style="width:${d.s ? Math.min(100, d.s / (Math.max(...dow.map(x => x.s || 0)) || 1) * 100) : 0}%"></i></div><span class="v">${d.s ? H.money(d.s) : '—'}</span></div>`).join('')}
            <div class="small muted mt-s">Green when the weekday is ahead of the same weekdays last year.</div></div>
        </div>
        <div class="section-label" style="margin-top:24px">Channels · ${H.esc(H.monthLabel(SL.month, true))}</div>
        ${chTotal ? `<div class="tbl-wrap"><div class="tbl-scroll"><table><thead><tr><th>Channel</th><th class="r">Sales</th><th class="r">Share</th><th class="r">Last year</th><th class="r">vs last year</th></tr></thead><tbody>
          ${chRows.filter(r => !r.src && r.s).map(r => `<tr><td style="font-weight:600;color:var(--text)">${H.esc(r.label)}</td><td class="r">${H.money(r.s)}</td><td class="r">${H.pct(r.s / chTotal * 100)}</td><td class="r">${r.l ? H.money(r.l) : '—'}</td><td class="r">${r.l ? H.delta(r.s, r.l, true) : '—'}</td></tr>`).join('')}
          <tr><td colspan="5" class="small muted" style="background:var(--surface-2)">How guests ordered</td></tr>
          ${chRows.filter(r => r.src && r.s).map(r => `<tr><td>${H.esc(r.label)}</td><td class="r">${H.money(r.s)}</td><td class="r">${H.pct(r.s / chTotal * 100)}</td><td class="r">${r.l ? H.money(r.l) : '—'}</td><td class="r">${r.l ? H.delta(r.s, r.l, true) : '—'}</td></tr>`).join('')}
          </tbody></table></div></div>` : emptyCard('No channel split for this month', 'Totals come from Productivity. Paste the channel view from Sales Analytics to see drive-thru, dine-in, carry-out, delivery and catering.', '<button class="btn" onclick="H.pages.sales.importRows()">Add channels</button>')}`;
    },
    setMonth(k) { SL.month = k; this.render(document.getElementById('salesApp')); },
    importRows() {
      H.importModal({
        title: 'Update sales by channel from cfahome',
        intro: 'One row per day per channel (or per order source). Daily totals and labor still come in through Productivity.',
        example: 'date,channel,sales,transactions,ly_sales,ly_transactions\n2026-10-13,Drive Thru,17840,1102,16950,1080\n2026-10-13,Dine In,4120,268,4380,290\n2026-10-13,Mobile,6210,355,5100,301',
        prompt: 'cfahome → Analytics Hub → Sales & Brand Growth → Sales Analytics. Set the grain to day and the date range to the days needed, show sales by channel (Dine In, Drive Thru, Carry Out, 3PD, Catering) and by source (POS, Mobile, Web, ExtPOS) with last year. Copy date, channel, sales, transactions, last-year sales, last-year transactions.',
        onRows: async (rows, dry) => {
          const all = CHANNELS.concat(SOURCES), out = [], red = [], amber = [], days = new Set(), unknown = new Set();
          rows.forEach(r => {
            const d = H.toISO(H.pick(r, 'date', 'day', 'business_date')); if (!d) return;
            const k = normKey(H.pick(r, 'channel', 'source', 'destination'), all); if (!k) { unknown.add(H.pick(r, 'channel', 'source') || '(blank)'); return; }
            days.add(d); const src = 'cfahome Sales Analytics';
            out.push(M('sales:' + k, 'day', d, H.toNum(H.pick(r, 'sales', 'net_sales')), src), M('tc:' + k, 'day', d, H.toNum(H.pick(r, 'transactions', 'tc', 'trans')), src));
            if (H.pick(r, 'ly_sales', 'last_year_sales') != null) out.push(M('ly_sales:' + k, 'day', d, H.toNum(H.pick(r, 'ly_sales', 'last_year_sales')), src));
            if (H.pick(r, 'ly_transactions', 'last_year_transactions', 'ly_tc') != null) out.push(M('ly_tc:' + k, 'day', d, H.toNum(H.pick(r, 'ly_transactions', 'last_year_transactions', 'ly_tc')), src));
          });
          if (dry) {
            if (!out.length) return { rows: [], html: '<span style="color:var(--bad)">No rows with a date and a channel were found. Check the header row.</span>' };
            if (unknown.size) amber.push(`Skipped channels it doesn't know: ${[...unknown].join(', ')}.`);
            dayChecks([...days], red, amber);
            const keys = {}; out.forEach(o => { const key = o.metric + o.on_date; if (keys[key]) red.push(`${o.metric.split(':')[1]} on ${longD(o.on_date)} is in the paste twice.`); keys[key] = 1; });
            const pd = Object.fromEntries((await H.db.list('productivity_days', { cache: false }) || []).map(x => [x.day, x]));
            [...days].forEach(d => { const chSum = sum(out.filter(o => o.on_date === d && o.metric.startsWith('sales:') && CHANNELS.some(c => 'sales:' + c[0] === o.metric)).map(o => o.value)); const tot = pd[d] && pd[d].sales; if (tot && chSum && Math.abs(chSum - tot) / tot > 0.02) amber.push(`${longD(d)}: channels add to ${H.money(chSum)}, the day's total in the hub is ${H.money(tot)}.`); });
            return { rows: out, block: red.length > 0, html: readyHtml(days.size, days.size === 1 ? 'day' : 'days', [...new Set(red)], amber.slice(0, 12)) };
          }
          await saveMetrics(rows); H.toast(`Sales for ${new Set(rows.map(r => r.on_date)).size} days saved`); this.render(document.getElementById('salesApp'));
        },
      });
    },
  };

  // ═════════════ MONTHLY P&L ═════════════
  const PL_LINES = [['food', 'Food'], ['paper', 'Paper'], ['talent', 'Talent investment'], ['utilities', 'Utilities'], ['marketing', 'Marketing'], ['repairs', 'Repairs & maintenance'], ['insurance', 'Insurance'], ['financial_fees', 'Financial fees'], ['other_taxes', 'Other taxes'], ['cfa_fees', 'CFA PR LLC fees'], ['misc', 'Miscellaneous']];
  const PLS = { month: null };
  H.pages.pl = {
    async render(host) {
      host.innerHTML = `<div class="ph"><div><h2>Monthly P&amp;L <span class="pill dark" style="vertical-align:middle;margin-left:6px">Operator only</span></h2><p>Every line of the cfahome Management Tool, month by month, as dollars and as a share of sales.</p></div>
        <div class="actions"><button class="btn btn-primary" onclick="H.pages.pl.importRows()">Update from cfahome</button></div></div><div id="plBody"><div class="li-empty">Loading…</div></div>`;
      const rows = await H.db.list('pl_months', { order: 'period_start', cache: false });
      const body = document.getElementById('plBody'); if (!body) return;
      if (rows === null) return H.missingTable(body, 'pl_months');
      if (!rows.length) { body.innerHTML = emptyCard('No P&L months yet', 'Click <strong>Update with Claude</strong>, or paste months from cfahome → Reports and Tools → Chick-fil-A Report Galleries → Management → Management Tool.', '<button class="btn btn-primary" onclick="H.pages.pl.importRows()">Update from cfahome</button>'); return; }
      const keys = rows.map(r => monthOf(r.period_start));
      if (!PLS.month || !keys.includes(PLS.month)) PLS.month = keys[keys.length - 1];
      const by = Object.fromEntries(rows.map(r => [monthOf(r.period_start), r]));
      const cur = by[PLS.month], prev = by[addMonths(PLS.month, -1)], ly = by[addMonths(PLS.month, -12)];
      const ytdRows = rows.filter(r => monthOf(r.period_start).slice(0, 4) === PLS.month.slice(0, 4) && monthOf(r.period_start) <= PLS.month);
      const ytd = k => sum(ytdRows.map(r => r[k])), pct = (v, s) => s ? v / s * 100 : null;
      const np = pct(cur.net_profit, cur.sales), npPrev = prev ? pct(prev.net_profit, prev.sales) : null;
      const accounted = sum(PL_LINES.map(([k]) => cur[k])) + (+cur.net_profit || 0);
      const gap = cur.sales ? accounted - cur.sales : 0;
      body.innerHTML = `${srcNote(cur.pulled_at, cur.source || 'cfahome Management Tool')}
        ${monthSelect('plMonth', keys, PLS.month, 'H.pages.pl.setMonth')}
        <div class="kpis">
          <div class="kpi"><div class="kpi-label">Sales</div><div class="kpi-val">${H.money(cur.sales)}</div><div class="kpi-sub">${prev ? H.delta(cur.sales, prev.sales, true) + ' vs ' + H.monthLabel(addMonths(PLS.month, -1)) : '&nbsp;'}</div></div>
          <div class="kpi ${np != null && np < 0 ? 'bad' : 'ok'}"><div class="kpi-label">Net profit</div><div class="kpi-val">${H.money(cur.net_profit)}</div><div class="kpi-sub">${H.pct(np)} of sales${npPrev != null ? ` · ${pts(np, npPrev)} pts vs last month` : ''}</div></div>
          <div class="kpi"><div class="kpi-label">Food + paper</div><div class="kpi-val">${H.pct(pct((+cur.food || 0) + (+cur.paper || 0), cur.sales))}</div><div class="kpi-sub">${H.money((+cur.food || 0) + (+cur.paper || 0))}</div></div>
          <div class="kpi"><div class="kpi-label">Talent investment</div><div class="kpi-val">${H.pct(pct(cur.talent, cur.sales))}</div><div class="kpi-sub">${H.money(cur.talent)}</div></div>
          <div class="kpi"><div class="kpi-label">Year to date net profit</div><div class="kpi-val">${H.money(ytd('net_profit'))}</div><div class="kpi-sub">${H.pct(pct(ytd('net_profit'), ytd('sales')))} of ${H.money(ytd('sales'))} sales</div></div>
        </div>
        <div class="split">
          <div class="tbl-wrap"><div class="tbl-scroll"><table><thead><tr><th>${H.esc(H.monthLabel(PLS.month, true))}</th><th class="r">$</th><th class="r">% of sales</th><th class="r">vs last month</th><th class="r">YTD $</th><th class="r">YTD %</th></tr></thead><tbody>
            <tr><td style="font-weight:700;color:var(--text)">Sales</td><td class="r" style="font-weight:700">${H.money(cur.sales)}</td><td class="r">100%</td><td class="r">${prev ? H.delta(cur.sales, prev.sales, true) : '—'}</td><td class="r">${H.money(ytd('sales'))}</td><td class="r">100%</td></tr>
            ${PL_LINES.filter(([k]) => cur[k] != null || ytd(k)).map(([k, l]) => { const p = pct(cur[k], cur.sales), pp = prev ? pct(prev[k], prev.sales) : null; return `<tr><td>${H.esc(l)}</td><td class="r">${H.money(cur[k])}</td><td class="r">${H.pct(p)}</td><td class="r">${pp != null && p != null ? (Math.abs(p - pp) < 0.05 ? '<span class="muted">0.0 pts</span>' : `<span style="color:var(--${p - pp < 0 ? 'ok' : 'bad'});font-weight:600">${p - pp > 0 ? '+' : ''}${(p - pp).toFixed(1)} pts</span>`) : '—'}</td><td class="r">${H.money(ytd(k))}</td><td class="r">${H.pct(pct(ytd(k), ytd('sales')))}</td></tr>`; }).join('')}
            <tr><td style="font-weight:700;color:var(--text)">Net profit</td><td class="r" style="font-weight:700">${H.money(cur.net_profit)}</td><td class="r" style="font-weight:700">${H.pct(np)}</td><td class="r">${npPrev != null ? pts(np, npPrev) + ' pts' : '—'}</td><td class="r">${H.money(ytd('net_profit'))}</td><td class="r">${H.pct(pct(ytd('net_profit'), ytd('sales')))}</td></tr>
          </tbody></table></div></div>
          <div class="card card-pad"><div class="section-label">Net profit % by month</div>
            ${H.barChart({ labels: keys.map(k => H.monthLabel(k).split(' ')[0]), series: [{ name: 'Net profit %', color: 'var(--ok)', values: rows.map(r => pct(r.net_profit, r.sales)) }], fmt: v => v.toFixed(0) + '%', min: Math.min(0, ...rows.map(r => pct(r.net_profit, r.sales) || 0)) })}
            ${Math.abs(gap) > Math.max(50, (+cur.sales || 0) * 0.005) ? `<div class="source warn mt"><span>The lines plus net profit come to ${H.money(accounted)}, ${H.money(Math.abs(gap))} ${gap > 0 ? 'more' : 'less'} than sales. A line may be missing or entered twice.</span></div>` : ''}
            <div class="small muted mt-s">${ly ? `Same month last year: ${H.pct(pct(ly.net_profit, ly.sales))} net profit.` : 'The Management Tool shows last year as 0 because Pertenecen LLC started Apr 1, 2026.'}</div></div>
        </div>`;
    },
    setMonth(k) { PLS.month = k; this.render(document.getElementById('plApp')); },
    importRows() {
      const hdr = 'month,sales,' + PL_LINES.map(l => l[0]).join(',') + ',net_profit';
      H.importModal({
        title: 'Update P&L from cfahome',
        intro: 'One row per month, in dollars. Existing months are replaced. Only you can see this page.',
        example: `${hdr}\n2026-09,907128,272410,28450,231900,24800,8100,9450,6200,3900,2100,90700,4300,222718`,
        prompt: 'cfahome → Reports and Tools → Chick-fil-A Report Galleries → Management tab → Management Tool. Pick the month (CM column). Copy dollars for Sales, Food, Paper, Talent Investment, Utilities, Marketing, R&M, Insurance, Financial Fees, Other Taxes, CFA PR LLC Fees, Misc and Net Profit.',
        onRows: async (rows, dry) => {
          const clean = rows.map(r => { const m = H.toISO(H.pick(r, 'month', 'period')); if (!m) return null; const o = { period_start: m.slice(0, 7) + '-01', sales: H.toNum(r.sales), net_profit: H.toNum(H.pick(r, 'net_profit', 'profit')), source: 'cfahome Management Tool', pulled_at: new Date().toISOString(), updated_by: H.who() }; PL_LINES.forEach(([k]) => { o[k] = H.toNum(H.pick(r, k, k === 'repairs' ? 'r_m' : k, k === 'talent' ? 'talent_investment' : k, k === 'cfa_fees' ? 'cfa_pr_llc_fees' : k)); }); return o; }).filter(Boolean);
          if (dry) {
            if (!clean.length) return { rows: [], html: '<span style="color:var(--bad)">No rows with a month were found.</span>' };
            const red = [], amber = [], thisMonth = H.today().slice(0, 7), seen = {};
            const have = Object.fromEntries((await H.db.list('pl_months', { cache: false }) || []).map(r => [monthOf(r.period_start), r]));
            clean.forEach(c => {
              const k = monthOf(c.period_start), L = H.monthLabel(k);
              if (seen[k]) red.push(`${L} is in the paste twice.`); seen[k] = 1;
              if (k >= thisMonth) red.push(`${L} isn't closed yet.`);
              if (!c.sales) red.push(`${L}: sales are missing.`);
              if (c.net_profit == null) red.push(`${L}: net profit is missing.`);
              const acc = sum(PL_LINES.map(([x]) => c[x])) + (+c.net_profit || 0);
              if (c.sales && Math.abs(acc - c.sales) > Math.max(50, c.sales * 0.005)) amber.push(`${L}: the lines plus net profit come to ${H.money(acc)}, not ${H.money(c.sales)}.`);
              if (c.food != null && c.sales && (c.food / c.sales < 0.2 || c.food / c.sales > 0.45)) amber.push(`${L}: food is ${H.pct(c.food / c.sales * 100)} of sales.`);
              if (have[k] && Math.abs((+have[k].sales || 0) - (+c.sales || 0)) > 1) amber.push(`${L} is already in the hub with sales of ${H.money(have[k].sales)}. Saving replaces it.`);
            });
            const fc = Object.fromEntries((await H.db.list('food_cost_periods', { cache: false }) || []).map(r => [monthOf(r.period_start), r]));
            clean.forEach(c => { const f = fc[monthOf(c.period_start)]; if (f && f.sales && c.sales && Math.abs(f.sales - c.sales) > 1) amber.push(`${H.monthLabel(monthOf(c.period_start))}: sales differ from Food cost (${H.money(f.sales)}).`); });
            return { rows: clean, block: red.length > 0, html: readyHtml(clean.length, clean.length === 1 ? 'month' : 'months', red, amber) };
          }
          await H.db.upsert('pl_months', rows, 'period_start'); PLS.month = rows.map(r => monthOf(r.period_start)).sort().pop(); H.toast(`${rows.length} month${rows.length === 1 ? '' : 's'} saved`); this.render(document.getElementById('plApp'));
        },
      });
    },
  };

  // ═════════════ CASH ═════════════
  const CASH_ITEMS = [['discounts', 'Discounts & promo/free', ['discounts', 'discount', 'promo', 'promo_free', 'discounts_promo_free']], ['refunds', 'Refunds', ['refunds', 'refund']], ['corrections', 'Corrections / voids', ['corrections', 'correction', 'voids']], ['change_fund', 'Change fund', ['change_fund', 'change fund']], ['payouts', 'Payouts', ['payouts', 'payout', 'paid_outs']], ['over_short', 'Cash over/short', ['over_short', 'cash_over_short', 'over/short', 'over short']]];
  H.pages.cash = {
    async render(host) {
      host.innerHTML = `<div class="ph"><div><h2>Cash</h2><p>How your discounts, refunds, voids and cash over/short compare with similar restaurants, and the bank deposit alerts from cfahome.</p></div>
        <div class="actions"><button class="btn" onclick="H.pages.cash.importDeposits()">Add deposit alerts</button><button class="btn btn-primary" onclick="H.pages.cash.importRows()">Update from cfahome</button></div></div><div id="cashBody"><div class="li-empty">Loading…</div></div>`;
      const [risk, dep] = await Promise.all([H.metricRows('cash:'), H.metricRows('deposit:', H.addDays(H.today(), -45))]);
      const body = document.getElementById('cashBody'); if (!body) return;
      if (risk === null) return H.missingTable(body, 'hub_metrics');
      const months = [...new Set(risk.map(r => monthOf(r.on_date)))].sort();
      const cur = months[months.length - 1], prev = months[months.length - 2];
      const get = (m, k, f) => { const r = risk.find(x => monthOf(x.on_date) === m && x.metric === `cash:${k}:${f}`); return r && r.value != null ? +r.value : null; };
      const riskHtml = cur ? `<div class="tbl-wrap"><div class="tbl-scroll"><table><thead><tr><th>Rolling 3 months to ${H.esc(H.monthLabel(cur, true))}</th><th class="r">Amount</th><th style="width:38%">Compared with similar restaurants</th><th class="r">Last month</th></tr></thead><tbody>
          ${CASH_ITEMS.map(([k, l]) => { const p = get(cur, k, 'pctile'), a = get(cur, k, 'amount'), pp = prev ? get(prev, k, 'pctile') : null; if (p == null && a == null) return ''; const cls = p == null ? '' : p >= 75 ? 'bad' : p >= 50 ? 'warn' : 'ok'; return `<tr><td style="font-weight:600;color:var(--text)">${H.esc(l)}</td><td class="r">${H.money(a)}</td><td><div class="pct-track"><i class="${cls}" style="left:${Math.max(0, Math.min(100, p || 0))}%"></i></div><div class="small muted">${p == null ? '—' : `${Math.round(p)}th percentile${p >= 75 ? ' · higher than most' : p <= 25 ? ' · lower than most' : ''}`}</div></td><td class="r">${pp == null ? '—' : Math.round(pp) + 'th'}</td></tr>`; }).join('')}
        </tbody></table></div></div><div class="small muted mt-s">Higher percentile means more than similar restaurants. Red at the 75th and above.</div>` : emptyCard('No cash risk numbers yet', 'From cfahome → Analytics Hub → Financial Stewardship → Cash Management Risk. Click <strong>Update from cfahome</strong>.', '');
      const deps = (dep || []).slice().sort((a, b) => a.on_date < b.on_date ? 1 : -1);
      body.innerHTML = `${srcNote(lastPulled(risk), 'cfahome Cash Management Risk')}
        ${riskHtml}
        <div class="section-label" style="margin-top:24px">Deposit activity alerts · last 45 days</div>
        <div class="list">${deps.length ? deps.slice(0, 30).map(d => `<div class="li">${H.icon('dollar', /fee|adjust/i.test(d.metric) ? 'amber' : 'blue')}<div><div class="li-title">${H.esc((d.detail && d.detail.type) || d.metric.replace('deposit:', '').replace(/_/g, ' '))} · ${H.money(d.value)}</div><div class="li-sub">${H.esc(longD(d.on_date))}${d.detail && d.detail.note ? ' · ' + H.esc(d.detail.note) : ''}</div></div><span></span></div>`).join('') : '<div class="li-empty">No deposit alerts saved. They come from Analytics Hub → Daily Restaurant Deposit Activity Alerts.</div>'}</div>`;
    },
    importRows() {
      H.importModal({
        title: 'Update cash risk from cfahome',
        intro: 'One row per item for the month the report covers (its rolling 3 months end that month).',
        example: 'month,item,amount,percentile\n2026-09,Discounts,4210,62\n2026-09,Refunds,880,41\n2026-09,Corrections,1320,55\n2026-09,Change fund,0,10\n2026-09,Payouts,610,48\n2026-09,Cash over/short,-145,30',
        prompt: 'cfahome → Analytics Hub → Financial Stewardship → Cash Management Risk. For the latest rolling 3 months copy each item (discounts/promo-free, refunds, corrections, change fund, payouts, cash over/short) with its dollar amount and peer percentile.',
        onRows: async (rows, dry) => {
          const out = [], red = [], amber = [], unknown = new Set();
          rows.forEach(r => { const m = H.toISO(H.pick(r, 'month', 'period', 'date')); if (!m) return; const k = normKey(H.pick(r, 'item', 'measure', 'category'), CASH_ITEMS); if (!k) { unknown.add(H.pick(r, 'item') || '(blank)'); return; } const d = m.slice(0, 7) + '-01'; out.push(M(`cash:${k}:amount`, 'month', d, H.toNum(r.amount), 'cfahome Cash Management Risk'), M(`cash:${k}:pctile`, 'month', d, H.toNum(H.pick(r, 'percentile', 'pctile', 'peer_percentile')), 'cfahome Cash Management Risk')); });
          if (dry) {
            if (!out.length) return { rows: [], html: '<span style="color:var(--bad)">No rows found. Each row needs a month and an item.</span>' };
            if (unknown.size) amber.push(`Skipped items it doesn't know: ${[...unknown].join(', ')}.`);
            out.filter(o => o.metric.endsWith(':pctile')).forEach(o => { if (o.value != null && (o.value < 0 || o.value > 100)) red.push(`${o.metric.split(':')[1]}: percentile ${o.value} isn't between 0 and 100.`); if (o.value >= 75) amber.push(`${o.metric.split(':')[1].replace('_', ' ')} is at the ${Math.round(o.value)}th percentile.`); });
            return { rows: out, block: red.length > 0, html: readyHtml(out.length / 2, 'items', red, amber) };
          }
          await saveMetrics(rows); H.toast('Cash risk saved'); this.render(document.getElementById('cashApp'));
        },
      });
    },
    importDeposits() {
      H.importModal({
        title: 'Add deposit activity alerts',
        intro: 'One row per alert from cfahome → Analytics Hub → Daily Restaurant Deposit Activity Alerts.',
        example: 'date,type,amount,note\n2026-10-13,Smart safe deposit,8420.15,\n2026-10-12,Adjustment / fee,-35.00,Bank adjustment',
        prompt: 'cfahome → Analytics Hub → Financial Stewardship → Daily Restaurant Deposit Activity Alerts. Copy date, type (change fund, manual deposit, smart safe deposit, adjustment/fee, ACH), amount and any note for each alert.',
        onRows: async (rows, dry) => {
          const out = rows.map(r => { const d = H.toISO(H.pick(r, 'date', 'day')); const t = String(H.pick(r, 'type', 'activity') || 'other'); if (!d) return null; const key = t.toLowerCase().replace(/[^a-z]+/g, '_').replace(/^_|_$/g, ''); return M(`deposit:${key}:${Math.abs(H.toNum(r.amount) || 0).toFixed(2)}`, 'day', d, H.toNum(r.amount), 'cfahome Deposit Activity Alerts', { type: t, note: r.note || null }); }).filter(Boolean);
          if (dry) return { rows: out, html: out.length ? readyHtml(out.length, 'alerts', [], []) : '<span style="color:var(--bad)">No rows with a date found.</span>' };
          await saveMetrics(rows); H.toast(`${rows.length} alerts saved`); this.render(document.getElementById('cashApp'));
        },
      });
    },
  };

  // ═════════════ SPEED & QUALITY ═════════════
  const SOS_CH = [['drive_thru', 'Drive-thru', ['drive thru', 'drive-thru', 'dt', 'drive']], ['front_counter', 'Front counter', ['front counter', 'fc', 'counter', 'dine in']], ['overall', 'Overall', ['overall', 'all', 'total']]];
  const SS_CATS = [['index', 'Smart Shop index'], ['craveable', 'Craveable food'], ['friendly', 'Attentive & friendly'], ['fast_accurate', 'Fast & accurate'], ['second_mile', '2nd Mile'], ['welcoming', 'Welcoming']];
  H.pages.quality = {
    async render(host) {
      host.innerHTML = `<div class="ph"><div><h2>Speed &amp; quality</h2><p>Speed of service and AHA every day, Smart Shop every month, and your food safety audit rounds, from cfahome.</p></div>
        <div class="actions"><button class="btn btn-primary" onclick="H.pages.quality.importMenu()">Update from cfahome</button></div></div><div id="qBody"><div class="li-empty">Loading…</div></div>`;
      const from = H.addDays(H.today(), -120);
      const [sos, aha, ss, au] = await Promise.all([H.metricRows('sos:', from), H.metricRows('aha:', from), H.metricRows('smartshop:'), H.metricRows('audit:')]);
      const body = document.getElementById('qBody'); if (!body) return;
      if (sos === null) return H.missingTable(body, 'hub_metrics');
      const today = H.today(), d7 = H.addDays(today, -7), d14 = H.addDays(today, -14), d30 = H.addDays(today, -30);
      const sosD = byDate(sos), ahaD = byDate(aha);
      const avgOver = (D, key, a, b) => { const v = Object.entries(D).filter(([d]) => d >= a && d < b).map(([, x]) => x[key]).filter(x => x != null); return v.length ? avg(v) : null; };
      const dtNow = avgOver(sosD, 'sos:drive_thru:total_sec', d7, today), dtPrev = avgOver(sosD, 'sos:drive_thru:total_sec', d14, d7);
      const fcNow = avgOver(sosD, 'sos:front_counter:total_sec', d7, today), fcPrev = avgOver(sosD, 'sos:front_counter:total_sec', d14, d7);
      const usage = avgOver(ahaD, 'aha:usage', d7, H.addDays(today, 1)), hold = avgOver(ahaD, 'aha:hold_pct', d7, H.addDays(today, 1)), stock = avgOver(ahaD, 'aha:stockout_pct', d7, H.addDays(today, 1)), zone = avgOver(ahaD, 'aha:target_zone_pct', d7, H.addDays(today, 1));
      const ssD = byDate(ss), ssMonths = Object.keys(ssD).sort(), ssCur = ssMonths[ssMonths.length - 1], ssPrev = ssMonths[ssMonths.length - 2];
      const audits = (au || []).filter(r => r.metric === 'audit:level').sort((a, b) => a.on_date < b.on_date ? 1 : -1);
      const secDelta = (a, b) => (a == null || b == null) ? '' : `<span style="color:var(--${a <= b ? 'ok' : 'bad'});font-weight:600">${a <= b ? '−' : '+'}${Math.abs(Math.round(a - b))}s</span> vs prior 7 days`;
      const nothing = !sos.length && !(aha || []).length && !ssMonths.length && !audits.length;
      if (nothing) { body.innerHTML = emptyCard('Nothing here yet', 'Click <strong>Update with Claude</strong> at the top, or <strong>Update from cfahome</strong> to paste Speed of Service, AHA, Smart Shop or a food safety audit.', '<button class="btn btn-primary" onclick="H.pages.quality.importMenu()">Update from cfahome</button>'); return; }
      const dtDays = Object.keys(sosD).filter(d => d >= d30).sort();
      body.innerHTML = `${srcNote(lastPulled([...sos, ...(aha || [])]), 'cfahome Speed of Service · AHA')}
        <div class="kpis">
          <div class="kpi"><div class="kpi-label">Drive-thru total time</div><div class="kpi-val">${mmss(dtNow)}</div><div class="kpi-sub">${secDelta(dtNow, dtPrev) || 'Last 7 days'}</div></div>
          <div class="kpi"><div class="kpi-label">Front counter total time</div><div class="kpi-val">${mmss(fcNow)}</div><div class="kpi-sub">${secDelta(fcNow, fcPrev) || 'Last 7 days'}</div></div>
          <div class="kpi ${usage == null ? '' : usage >= 90 ? 'ok' : 'bad'}"><div class="kpi-label">AHA usage</div><div class="kpi-val">${usage == null ? '—' : Math.round(usage)}</div><div class="kpi-sub">Requirement 90+ · last 7 days</div></div>
          <div class="kpi"><div class="kpi-label">AHA hold · stock-outs</div><div class="kpi-val">${hold == null ? '—' : Math.round(hold) + '<small>%</small>'}</div><div class="kpi-sub">${stock == null ? '' : `Stock-outs ${H.pct(stock, 0)}`}${zone == null ? '' : ` · target zone ${H.pct(zone, 0)}`}</div></div>
          <div class="kpi"><div class="kpi-label">Smart Shop${ssCur ? ' · ' + H.esc(H.monthLabel(ssCur)) : ''}</div><div class="kpi-val">${ssCur && ssD[ssCur]['smartshop:index'] != null ? (+ssD[ssCur]['smartshop:index']).toFixed(1) : '—'}</div><div class="kpi-sub">${ssCur && ssD[ssCur]['smartshop:chain_avg'] != null ? `Chain ${(+ssD[ssCur]['smartshop:chain_avg']).toFixed(1)}` : '&nbsp;'}${ssPrev && ssCur ? ` · ${pts(ssD[ssCur]['smartshop:index'], ssD[ssPrev]['smartshop:index'])} vs last month` : ''}</div></div>
          <div class="kpi"><div class="kpi-label">Food safety audit</div><div class="kpi-val" style="font-size:1.15rem">${audits[0] ? H.esc((audits[0].detail && audits[0].detail.result) || ('Level ' + audits[0].value)) : '—'}</div><div class="kpi-sub">${audits[0] ? H.esc(longD(audits[0].on_date)) + (audits[1] ? ` · before: ${H.esc((audits[1].detail && audits[1].detail.result) || 'Level ' + audits[1].value)}` : '') : 'No rounds saved'}</div></div>
        </div>
        <div class="split">
          <div class="card card-pad"><div class="section-label">Drive-thru total time · last 30 days</div>
            ${dtDays.length ? H.barChart({ labels: dtDays.map((d, i) => (i % 5 === 0 || i === dtDays.length - 1) ? H.fmtD(d, { month: 'numeric', day: 'numeric' }) : ''), series: [{ name: 'Drive-thru (min:sec)', color: 'var(--foh)', values: dtDays.map(d => sosD[d]['sos:drive_thru:total_sec']) }, { name: 'Front counter', color: '#C9CBD3', values: dtDays.map(d => sosD[d]['sos:front_counter:total_sec']) }], fmt: v => mmss(v), min: 0 }) : '<div class="li-empty">No speed of service days yet.</div>'}</div>
          <div class="card card-pad"><div class="section-label">Smart Shop categories${ssCur ? ' · ' + H.esc(H.monthLabel(ssCur, true)) : ''}</div>
            ${ssCur ? SS_CATS.slice(1).map(([k, l]) => { const v = ssD[ssCur]['smartshop:' + k], p = ssPrev ? ssD[ssPrev]['smartshop:' + k] : null; return `<div class="metric-row wide"><span>${H.esc(l)}</span><div class="bar ${v == null ? '' : v >= 90 ? 'ok' : v < 80 ? 'bad' : 'warn'}"><i style="width:${v == null ? 0 : Math.min(100, v)}%"></i></div><span class="v">${v == null ? '—' : v.toFixed(1)}${p != null && v != null ? ` <small>${pts(v, p)}</small>` : ''}</span></div>`; }).join('') : '<div class="li-empty">No Smart Shop months yet.</div>'}</div>
        </div>
        ${audits.length ? `<div class="section-label" style="margin-top:24px">Food safety audit rounds</div><div class="list">${audits.slice(0, 8).map(a => `<div class="li">${H.icon('check', /elite|level 1/i.test((a.detail && a.detail.result) || '') ? 'green' : 'amber')}<div><div class="li-title">${H.esc((a.detail && a.detail.result) || 'Level ' + a.value)}</div><div class="li-sub">${H.esc(longD(a.on_date))}${a.detail && a.detail.round ? ' · ' + H.esc(a.detail.round) : ''}</div></div><span></span></div>`).join('')}</div>` : ''}`;
    },
    importMenu() {
      H.modal(`<h3>Update from cfahome</h3><p class="muted small" style="margin:-10px 0 14px">What are you adding?</p>
        <div class="list">
          <div class="li click" onclick="H.pages.quality.importSos()">${H.icon('clock', 'blue')}<div><div class="li-title">Speed of service</div><div class="li-sub">Daily drive-thru and front counter times</div></div><span></span></div>
          <div class="li click" onclick="H.pages.quality.importAha()">${H.icon('check', 'green')}<div><div class="li-title">AHA</div><div class="li-sub">Daily usage, hold, target zone, stock-outs</div></div><span></span></div>
          <div class="li click" onclick="H.pages.quality.importSmartShop()">${H.icon('star', 'amber')}<div><div class="li-title">Smart Shop</div><div class="li-sub">Monthly index and category scores</div></div><span></span></div>
          <div class="li click" onclick="H.pages.quality.importAudit()">${H.icon('flag', 'purple')}<div><div class="li-title">Food safety audit</div><div class="li-sub">A new round and its result</div></div><span></span></div>
        </div><div class="mfooter"><button class="btn" onclick="H.closeModal()">Cancel</button></div>`);
    },
    importSos() {
      H.importModal({
        title: 'Speed of service from cfahome', intro: 'One row per day per channel. Times as seconds or m:ss.',
        example: 'date,channel,orders,total_time,line_time,order_time,fulfillment_time\n2026-10-13,Drive Thru,1102,4:12,1:55,0:48,1:29\n2026-10-13,Front Counter,268,3:05,,,',
        prompt: 'cfahome → Analytics Hub → Customer Experience → Speed of Service (drive-thru and front counter), day grain. Copy date, channel, orders, total time, line time, order time and fulfillment time.',
        onRows: async (rows, dry) => {
          const out = [], red = [], amber = [], days = new Set();
          rows.forEach(r => { const d = H.toISO(H.pick(r, 'date', 'day')); const k = normKey(H.pick(r, 'channel', 'destination'), SOS_CH); if (!d || !k) return; days.add(d); const s = 'cfahome Speed of Service';
            out.push(M(`sos:${k}:total_sec`, 'day', d, secs(H.pick(r, 'total_time', 'total_time_sec', 'total')), s), M(`sos:${k}:orders`, 'day', d, H.toNum(r.orders), s));
            [['line_time', 'line_sec'], ['order_time', 'order_sec'], ['fulfillment_time', 'fulfill_sec']].forEach(([c, m]) => { const v = secs(H.pick(r, c, c + '_sec')); if (v != null) out.push(M(`sos:${k}:${m}`, 'day', d, v, s)); }); });
          if (dry) { if (!out.length) return { rows: [], html: '<span style="color:var(--bad)">No rows with a date and a channel (Drive Thru, Front Counter) were found.</span>' };
            dayChecks([...days], red, amber); out.filter(o => o.metric.endsWith('total_sec')).forEach(o => { if (o.value == null) red.push(`${longD(o.on_date)}: total time is missing.`); else if (o.value < 60 || o.value > 900) red.push(`${longD(o.on_date)}: total time ${mmss(o.value)} looks wrong. Check minutes vs seconds.`); });
            return { rows: out, block: red.length > 0, html: readyHtml(days.size, 'days', red, amber) }; }
          await saveMetrics(rows); H.toast('Speed of service saved'); this.render(document.getElementById('qualityApp'));
        },
      });
    },
    importAha() {
      H.importModal({
        title: 'AHA from cfahome', intro: 'One row per day.',
        example: 'date,usage,hold_pct,target_zone_pct,stockout_pct\n2026-10-13,99,95,28,9',
        prompt: 'AHA Dashboard (aha.smartrest.cfahome.com). For each day copy system usage, hold times %, target zone % and stock-out rate %.',
        onRows: async (rows, dry) => {
          const out = [], red = [], amber = [], days = new Set();
          rows.forEach(r => { const d = H.toISO(H.pick(r, 'date', 'day')); if (!d) return; days.add(d); const s = 'cfahome AHA'; [['usage', 'usage'], ['hold_pct', 'hold_pct'], ['target_zone_pct', 'target_zone_pct'], ['stockout_pct', 'stockout_pct']].forEach(([c, m]) => { const v = H.toNum(H.pick(r, c, c.replace('_pct', ''))); if (v != null) out.push(M('aha:' + m, 'day', d, v, s)); }); });
          if (dry) { if (!out.length) return { rows: [], html: '<span style="color:var(--bad)">No rows with a date were found.</span>' };
            dayChecks([...days].filter(d => d < H.today()), red, amber); out.forEach(o => { if (o.value < 0 || o.value > 100) red.push(`${longD(o.on_date)}: ${o.metric.split(':')[1]} of ${o.value} isn't between 0 and 100.`); if (o.metric === 'aha:usage' && o.value < 90) amber.push(`${longD(o.on_date)}: usage ${o.value} is under the 90 requirement.`); });
            return { rows: out, block: red.length > 0, html: readyHtml(days.size, 'days', red, amber) }; }
          await saveMetrics(rows); H.toast('AHA saved'); this.render(document.getElementById('qualityApp'));
        },
      });
    },
    importSmartShop() {
      H.importModal({
        title: 'Smart Shop from cfahome', intro: 'One row per month.',
        example: 'month,index,craveable_food,attentive_friendly,fast_accurate,second_mile,welcoming,chain_avg\n2026-09,88.4,91.2,90.1,84.7,86.0,92.3,86.9',
        prompt: 'cfahome → Analytics Hub → Customer Experience → Smart Shop. For each month copy the index score, each category score (Craveable Food, Attentive & Friendly, Fast & Accurate, 2nd Mile, Welcoming) and the chain-wide average.',
        onRows: async (rows, dry) => {
          const out = [], red = [], months = new Set();
          rows.forEach(r => { const m = H.toISO(H.pick(r, 'month', 'period')); if (!m) return; const d = m.slice(0, 7) + '-01'; months.add(d); const s = 'cfahome Smart Shop';
            [['index', ['index', 'index_score', 'score']], ['craveable', ['craveable_food', 'craveable']], ['friendly', ['attentive_friendly', 'friendly']], ['fast_accurate', ['fast_accurate']], ['second_mile', ['second_mile', '2nd_mile']], ['welcoming', ['welcoming']], ['chain_avg', ['chain_avg', 'chain_average']]].forEach(([k, cols]) => { const v = H.toNum(H.pick(r, ...cols)); if (v != null) out.push(M('smartshop:' + k, 'month', d, v, s)); }); });
          if (dry) { if (!out.length) return { rows: [], html: '<span style="color:var(--bad)">No rows with a month were found.</span>' };
            [...months].forEach(d => { if (monthOf(d) >= H.today().slice(0, 7)) red.push(`${H.monthLabel(monthOf(d))} isn't over yet.`); }); out.forEach(o => { if (o.value < 0 || o.value > 100) red.push(`${H.monthLabel(monthOf(o.on_date))}: ${o.metric.split(':')[1]} of ${o.value} isn't between 0 and 100.`); });
            return { rows: out, block: red.length > 0, html: readyHtml(months.size, 'months', red, []) }; }
          await saveMetrics(rows); H.toast('Smart Shop saved'); this.render(document.getElementById('qualityApp'));
        },
      });
    },
    importAudit() {
      H.form({ title: 'Food safety audit round', intro: 'From cfahome → Operations Hub → Report.', fields: [
        { id: 'date', label: 'Date of the visit', type: 'date', value: H.today(), required: true, half: true },
        { id: 'round', label: 'Round', placeholder: 'e.g. Round 3, 2026', half: true },
        { id: 'result', label: 'Result', placeholder: 'e.g. Level 1 Elite', required: true },
      ], onSubmit: async v => { const lvl = (v.result.match(/level\s*(\d)/i) || [])[1]; await saveMetrics([M('audit:level', 'round', v.date, lvl ? +lvl : null, 'cfahome Operations Hub', { round: v.round, result: v.result })]); H.toast('Audit saved'); this.render(document.getElementById('qualityApp')); } });
    },
  };

  // ═════════════ PRODUCTIVITY: actual vs scheduled hours ═════════════
  const prRender = H.pages.productivity && H.pages.productivity.render;
  if (prRender) H.pages.productivity.render = async function (host) {
    await prRender.call(this, host);
    const body = document.getElementById('prBody'), sel = document.getElementById('prMonth'); if (!body || !sel) return;
    const days = (await H.db.list('productivity_days') || []).filter(d => monthOf(d.day) === sel.value && d.labor_hours != null);
    const withSched = days.filter(d => d.scheduled_hours != null);
    const box = document.createElement('div');
    if (!withSched.length) { box.innerHTML = `<div class="section-label" style="margin-top:24px">Actual vs scheduled hours</div><div class="card card-pad small muted">No scheduled hours for this month yet. They come from cfahome → Analytics Hub → Talent → Actual vs Scheduled Labor Hours (add a <code>scheduled_hours</code> column when updating).</div>`; body.appendChild(box); return; }
    const act = sum(withSched.map(d => d.labor_hours)), sch = sum(withSched.map(d => d.scheduled_hours)), v = act - sch;
    const worst = withSched.map(d => ({ d, v: d.labor_hours - d.scheduled_hours })).sort((a, b) => Math.abs(b.v) - Math.abs(a.v)).slice(0, 5);
    box.innerHTML = `<div class="section-label" style="margin-top:24px">Actual vs scheduled hours · ${H.esc(H.monthLabel(sel.value, true))}</div>
      <div class="split"><div class="kpis" style="margin:0"><div class="kpi ${Math.abs(v) / (sch || 1) > 0.03 ? 'warn' : 'ok'}"><div class="kpi-label">Variance</div><div class="kpi-val">${v > 0 ? '+' : ''}${H.num(v, 1)}<small> hrs</small></div><div class="kpi-sub">${H.pct(sch ? v / sch * 100 : null)} · ${H.num(act, 1)} worked vs ${H.num(sch, 1)} scheduled</div></div></div>
      <div class="list">${worst.map(w => `<div class="li">${H.icon('clock', w.v > 0 ? 'amber' : 'blue')}<div><div class="li-title">${H.esc(H.fmtD(w.d.day, { weekday: 'short', month: 'short', day: 'numeric' }))}</div><div class="li-sub">${H.num(w.d.labor_hours, 1)} worked · ${H.num(w.d.scheduled_hours, 1)} scheduled</div></div><span class="pill ${w.v > 0 ? 'amber' : 'blue'}">${w.v > 0 ? '+' : ''}${H.num(w.v, 1)} hrs</span></div>`).join('')}</div></div>`;
    body.appendChild(box);
  };

  // ═════════════ STAFFING: retention & turnover ═════════════
  const stRender = H.pages.staffing && H.pages.staffing.render;
  if (stRender) {
    H.pages.staffing.render = async function (host) {
      await stRender.call(this, host);
      const body = document.getElementById('stBody'); if (!body) return;
      const rows = await H.metricRows('retention:'); if (rows === null) return;
      const D = byDate(rows), ms = Object.keys(D).sort(), cur = ms[ms.length - 1], prev = ms[ms.length - 2];
      const box = document.createElement('div'); box.className = 'mb';
      box.innerHTML = cur ? `<div class="section-label">Retention &amp; turnover · cfahome · ${H.esc(H.monthLabel(monthOf(cur), true))} <a href="#" onclick="H.pages.staffing.importRetention();return false">Update</a></div>
        <div class="kpis">
          <div class="kpi"><div class="kpi-label">Retention</div><div class="kpi-val">${H.pct(D[cur]['retention:retention_pct'])}</div><div class="kpi-sub">${prev ? pts(D[cur]['retention:retention_pct'], D[prev]['retention:retention_pct']) + ' pts vs last month' : '&nbsp;'}</div></div>
          <div class="kpi"><div class="kpi-label">Turnover</div><div class="kpi-val">${H.pct(D[cur]['retention:turnover_pct'])}</div><div class="kpi-sub">${D[cur]['retention:turnover_p12_pct'] != null ? `Past 12 months ${H.pct(D[cur]['retention:turnover_p12_pct'])}` : '&nbsp;'}</div></div>
          <div class="kpi"><div class="kpi-label">Hires · exits</div><div class="kpi-val">${H.num(D[cur]['retention:hires'])} <small>/ ${H.num(D[cur]['retention:exits'])}</small></div><div class="kpi-sub">This month</div></div>
          <div class="kpi"><div class="kpi-label">Year to date</div><div class="kpi-val">${H.num(sum(ms.filter(m => m.slice(0, 4) === cur.slice(0, 4)).map(m => D[m]['retention:hires'])))} <small>hires</small></div><div class="kpi-sub">${H.num(sum(ms.filter(m => m.slice(0, 4) === cur.slice(0, 4)).map(m => D[m]['retention:exits'])))} exits</div></div>
        </div>` : `<div class="source"><span>Retention and turnover from cfahome aren't in the hub yet. <a href="#" onclick="H.pages.staffing.importRetention();return false">Add them</a></span></div>`;
      body.insertBefore(box, body.firstChild);
    };
    H.pages.staffing.importRetention = () => H.importModal({
      title: 'Retention & turnover from cfahome', intro: 'One row per month. Totals only, no names.',
      example: 'month,retention_pct,turnover_pct,turnover_p12_pct,hires,exits,headcount\n2026-09,91.5,8.5,96.0,6,7,81',
      prompt: 'cfahome → Analytics Hub → Talent → Retention & Turnover Report. For each month copy retention %, turnover %, past-12-months turnover %, hires, exits and headcount.',
      onRows: async (rows, dry) => {
        const out = [], red = [], months = new Set();
        rows.forEach(r => { const m = H.toISO(H.pick(r, 'month', 'period')); if (!m) return; const d = m.slice(0, 7) + '-01'; months.add(d); const s = 'cfahome Retention & Turnover'; ['retention_pct', 'turnover_pct', 'turnover_p12_pct', 'hires', 'exits', 'headcount'].forEach(k => { const v = H.toNum(r[k]); if (v != null) out.push(M('retention:' + k, 'month', d, v, s)); }); });
        if (dry) { if (!out.length) return { rows: [], html: '<span style="color:var(--bad)">No rows with a month were found.</span>' };
          [...months].forEach(d => { if (monthOf(d) >= H.today().slice(0, 7)) red.push(`${H.monthLabel(monthOf(d))} isn't over yet.`); });
          return { rows: out, block: red.length > 0, html: readyHtml(months.size, 'months', red, []) }; }
        await saveMetrics(rows); H.toast('Retention saved'); H.pages.staffing.render(document.getElementById('staffingApp'));
      },
    });
  }
})();
