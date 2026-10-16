// Los Filtros Hub v2 — Home (welcome, snapshot, news that matters, what's coming up) and Calendar.
// News is written into hub_news by Claude: the "Refresh news" button (claude-proxy + web search),
// Update with Claude / the scheduled pull, or the Add news box. Calendar = PR holidays and store
// closures (computed), your own entries (hub_calendar), dated news (outages, closures) and catering pickups.
(function () {
  const H = window.H;
  const svg = p => `<svg viewBox="0 0 24 24">${p}</svg>`;
  const ICO = {
    cfa: '<path d="M12 21s-7-4.4-7-10.2A4.3 4.3 0 0 1 12 8a4.3 4.3 0 0 1 7 2.8C19 16.6 12 21 12 21z"/>',
    business: '<path d="M4 20V10M10 20V4M16 20v-7M20 20H3"/>',
    construction: '<path d="M3 20h18"/><path d="M6 20 10 6h4l4 14"/><path d="M8 14h8M9 10h6"/>',
    luma: '<path d="M13 3 5 13.5h6L10 21l8-10.5h-6z"/>',
    aaa: '<path d="M12 3.5s6 6.5 6 10.5a6 6 0 0 1-12 0c0-4 6-10.5 6-10.5z"/>',
    local: '<path d="M12 21s-6.5-6.2-6.5-11a6.5 6.5 0 0 1 13 0c0 4.8-6.5 11-6.5 11z"/><circle cx="12" cy="10" r="2.3"/>',
    weather: '<path d="M7 17.5h10a4 4 0 0 0 .6-8A5.5 5.5 0 0 0 7 10.5a3.5 3.5 0 0 0 0 7z"/>',
  };
  const CATS = [
    ['all', 'All'], ['near', 'Near the store'], ['luma', 'LUMA'], ['aaa', 'AAA'], ['construction', 'Roads & construction'],
    ['cfa', 'Chick-fil-A'], ['business', 'Business in PR'], ['weather', 'Weather'],
  ];
  const CAT_LABEL = { cfa: 'Chick-fil-A', business: 'Business in PR', construction: 'Roads & construction', luma: 'LUMA', aaa: 'AAA', local: 'Bayamón', weather: 'Weather' };
  const SEV = { act: ['Act now', 'red'], watch: ['Watch', 'amber'], info: ['FYI', ''] };
  const NEAR = ['luma', 'aaa', 'construction', 'local', 'weather'];
  const longD = H.longD;
  const shortD = iso => H.fmtD(iso, { weekday: 'short', month: 'short', day: 'numeric' });
  const firstName = () => String(H.who() || '').split(/[\s@._]+/)[0] || 'there';

  // ═════════════ CALENDAR DATA ═════════════
  // PR government holidays (1 LPRA §71: fixed dates move to Monday when they fall on a Sunday), plus Juneteenth (federal).
  const nthDow = (y, m, dow, n) => { const d = new Date(y, m, 1); const add = (dow - d.getDay() + 7) % 7; d.setDate(1 + add + (n - 1) * 7); return d; };
  const lastDow = (y, m, dow) => { const d = new Date(y, m + 1, 0); d.setDate(d.getDate() - ((d.getDay() - dow + 7) % 7)); return d; };
  const easter = y => { const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451), mo = Math.floor((h + l - 7 * m + 114) / 31), da = ((h + l - 7 * m + 114) % 31) + 1; return new Date(y, mo - 1, da); };
  const sunToMon = d => { if (d.getDay() === 0) d.setDate(d.getDate() + 1); return d; };
  H.builtinEvents = y => {
    const E = [], add = (d, title, kind, notes) => E.push({ day: H.iso(d), title, kind, notes, builtin: true });
    const fixed = (m, d) => sunToMon(new Date(y, m, d));
    add(fixed(0, 1), 'Año Nuevo', 'holiday');
    add(fixed(0, 6), 'Día de Reyes', 'holiday');
    add(new Date(y, 0, 5), 'Víspera de Reyes', 'event', 'Usually a busy evening.');
    add(nthDow(y, 0, 1, 3), 'Martin Luther King Jr.', 'holiday');
    add(nthDow(y, 1, 1, 3), 'Día de los Presidentes', 'holiday');
    add(fixed(2, 22), 'Abolición de la Esclavitud', 'holiday');
    const gf = easter(y); gf.setDate(gf.getDate() - 2); add(gf, 'Viernes Santo', 'holiday');
    const md = nthDow(y, 4, 0, 2); const mdSat = new Date(md); mdSat.setDate(md.getDate() - 1);
    add(mdSat, 'Mother\'s Day weekend', 'event', `Mother's Day is Sunday ${H.fmtD(H.iso(md))} (closed). Expect a busy Saturday.`);
    const fd = nthDow(y, 5, 0, 3); const fdSat = new Date(fd); fdSat.setDate(fd.getDate() - 1);
    add(fdSat, 'Father\'s Day weekend', 'event', `Father's Day is Sunday ${H.fmtD(H.iso(fd))} (closed).`);
    add(lastDow(y, 4, 1), 'Memorial Day', 'holiday');
    add(fixed(5, 19), 'Juneteenth (federal)', 'holiday', 'Federal holiday: banks and post office closed.');
    add(fixed(6, 4), 'Independence Day', 'holiday');
    add(fixed(6, 25), 'Día de la Constitución', 'holiday');
    add(nthDow(y, 8, 1, 1), 'Labor Day', 'holiday');
    add(fixed(10, 11), 'Veterans Day', 'holiday');
    add(fixed(10, 19), 'Descubrimiento de Puerto Rico', 'holiday');
    const tg = nthDow(y, 10, 4, 4); add(tg, 'Thanksgiving: restaurant closed', 'closed');
    const bf = new Date(tg); bf.setDate(tg.getDate() + 1); add(bf, 'Black Friday', 'event', 'Heavy traffic around the shopping centers.');
    add(new Date(y, 11, 24), 'Nochebuena', 'event');
    add(new Date(y, 11, 25), 'Christmas: restaurant closed', 'closed');
    add(new Date(y, 11, 31), 'Despedida de año', 'event');
    for (let m = 0; m < 12; m++) { let d = new Date(y, m + 1, 0); while (d.getDay() === 0) d.setDate(d.getDate() - 1); add(d, 'Month-end inventory count', 'cfa', 'Counts feed the Target Food Cost Report.'); }
    return E;
  };
  const KINDS = {
    holiday: ['Holiday', 'blue'], closed: ['Closed', 'red'], event: ['Event', 'gray'], deadline: ['Deadline', 'amber'], cfa: ['Chick-fil-A', 'red'],
    community: ['Community', 'purple'], personal: ['Personal', 'green'], alert: ['Outage / closure', 'amber'], catering: ['Catering', 'green'],
  };
  // Everything on the calendar between two dates (inclusive), from every source.
  H.calendarEvents = async (from, to) => {
    const vis = H.visible(), out = [];
    for (let y = +from.slice(0, 4); y <= +to.slice(0, 4); y++) out.push(...H.builtinEvents(y));
    const mine = await H.db.list('hub_calendar', { cache: false }) || [];
    mine.forEach(e => out.push({ ...e, kind: e.kind || 'event' }));
    const news = await H.db.list('hub_news') || [];
    news.filter(n => n.starts_on && !n.hidden).forEach(n => out.push({ day: n.starts_on, end_day: n.ends_on, title: n.title, kind: 'alert', notes: n.impact, url: n.url, news: true }));
    if (vis.includes('bonus') && H.bonusDates) for (let y = +from.slice(0, 4); y <= +to.slice(0, 4); y++) {
      const d = H.bonusDates(y);
      out.push({ day: d.opens, title: 'Christmas bonus: payment window opens', kind: 'deadline', notes: `Bono de Navidad for Oct 1, ${y - 1} – Sep 30, ${y}. Pay by Dec 15.`, builtin: true },
        { day: d.exemptionBy, title: 'Christmas bonus: exemption filing deadline', kind: 'deadline', notes: 'Only if claiming an exemption for lack of profits: CPA-certified P&L and balance sheet to the Departamento del Trabajo.', builtin: true },
        { day: d.payBy, title: 'Christmas bonus: last day to pay', kind: 'deadline', notes: 'Paying late adds 50% (within six months) or 100% after that.', builtin: true });
    }
    if (vis.includes('catering')) {
      const cat = window._hubCatering || await H.db.list('catering_orders') || [];
      cat.forEach(o => { const d = H.toISO(o.pickup_time || o.order_date); if (d) out.push({ day: d, title: `Catering: ${o.guest_name || 'order'}${o.pickup_time && /\d:\d\d/.test(o.pickup_time) ? ' · ' + o.pickup_time.replace(/^\S+\s*/, '') : ''}`, kind: 'catering', notes: [o.items, o.total_amount].filter(Boolean).join(' · '), catering: true }); });
    }
    return out.filter(e => (e.end_day || e.day) >= from && e.day <= to).sort((a, b) => a.day < b.day ? -1 : a.day > b.day ? 1 : (a.kind === 'closed' ? -1 : 0));
  };
  const evPill = e => { const [l, c] = KINDS[e.kind] || KINDS.event; return `<span class="pill ${c}">${H.esc(l)}</span>`; };

  // ═════════════ NEWS ═════════════
  const PROXY = () => { try { return `${SUPABASE_URL}/functions/v1/claude-proxy`; } catch (e) { return null; } };
  const ANON = () => { try { return SUPABASE_ANON; } catch (e) { return ''; } };
  const NEWS_SYSTEM = `You keep a Chick-fil-A Operator in Puerto Rico informed. The restaurant is Chick-fil-A Los Filtros (#30014) on Avenida Los Filtros (PR-177) in Bayamón, Puerto Rico, near Guaynabo, Santa Rosa and Lomas Verdes. About 80 team members; drive-thru, dine-in, mobile, catering, delivery.
Search the web for news from the last 14 days that could affect the restaurant's business, team, guests or operations:
- LUMA power outages, planned interruptions or rate changes affecting Bayamón or Guaynabo
- AAA water interruptions or breaks affecting Bayamón or Guaynabo (Superacueducto, La Plata, Los Filtros area)
- road work, closures, construction or traffic on PR-177 Avenida Los Filtros, PR-2, PR-5, PR-22, PR-167, PR-174, PR-199, PR-889 and nearby
- new businesses, competitors or big developments in Bayamón / Guaynabo
- Puerto Rico business, labor and economic news that matters to a restaurant employer (minimum wage, labor law, taxes, electricity costs, tourism, consumer spending)
- Chick-fil-A company news (menu, operations, leadership, Puerto Rico)
- weather or storms affecting Puerto Rico
Skip crime stories unless they directly involve the restaurant's immediate area or roads, and skip anything older than 14 days unless it describes a future date.
Return ONLY a JSON array (no prose) of up to 12 items, newest first, each:
{"published_on":"YYYY-MM-DD","title":"headline as published","source":"outlet name","url":"https://...","category":"luma|aaa|construction|local|business|cfa|weather","severity":"act|watch|info","starts_on":"YYYY-MM-DD or null","ends_on":"YYYY-MM-DD or null","impact":"one plain sentence: why this matters for Los Filtros and what to do"}
Use "act" only when something affects the restaurant within the next 7 days. starts_on/ends_on only for scheduled outages, closures or events that reach Bayamón (they go on the calendar as alerts); leave them null for anything elsewhere, such as an outage list that doesn't include Bayamón. Only include items you found in search results, with their real URLs.`;
  H.refreshNews = async (quiet) => {
    if (window.__HUB_PREVIEW__) { if (!quiet) H.toast('In the preview, news is a fixed sample pulled on Oct 15.'); return { added: 0 }; }
    const url = PROXY(); if (!url) throw new Error('The Claude connection isn\'t set up on this site.');
    const have = (await H.db.list('hub_news', { cache: false }) || []).map(n => n.url).filter(Boolean).slice(-60);
    const res = await fetch(url, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${ANON()}` },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6', max_tokens: 4000, system: NEWS_SYSTEM,
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 8, user_location: { type: 'approximate', city: 'Bayamón', region: 'Puerto Rico', country: 'US', timezone: 'America/Puerto_Rico' } }],
        messages: [{ role: 'user', content: `Today is ${H.today()}. Already in the hub (skip these URLs): ${have.join(' ') || 'none'}` }],
      }),
    });
    if (!res.ok) { const t = await res.text(); throw new Error(res.status === 400 && /tool/i.test(t) ? 'The claude-proxy function needs to allow web search before news can refresh from here. Update with Claude can add news meanwhile.' : `News refresh failed (${res.status}).`); }
    const data = await res.json();
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    const a = text.indexOf('['), b = text.lastIndexOf(']');
    if (a < 0 || b < a) throw new Error('Claude didn\'t return any news this time. Try again later.');
    let items; try { items = JSON.parse(text.slice(a, b + 1).replace(/,\s*([\]}])/g, '$1')); } catch (e) { throw new Error('Couldn\'t read the news Claude returned.'); }
    const rows = cleanNews(items, 'Refreshed by Claude');
    if (rows.length) await H.db.upsert('hub_news', rows, 'url');
    return { added: rows.filter(r => !have.includes(r.url)).length };
  };
  const cleanNews = (items, by) => (Array.isArray(items) ? items : []).map(n => ({
    published_on: H.toISO(n.published_on || n.date) || null, title: String(n.title || '').trim().slice(0, 300), source: n.source || null,
    url: /^https?:\/\//.test(n.url || '') ? n.url : null, category: CAT_LABEL[n.category] ? n.category : 'local',
    severity: SEV[n.severity] ? n.severity : 'info', starts_on: H.toISO(n.starts_on) || null, ends_on: H.toISO(n.ends_on) || null,
    impact: n.impact ? String(n.impact).slice(0, 400) : null, fetched_at: new Date().toISOString(), added_by: by,
  })).filter(n => n.title && n.url);

  const newsItem = n => {
    const [sl, sc] = SEV[n.severity] || SEV.info;
    const when = n.starts_on ? `${shortD(n.starts_on)}${n.ends_on && n.ends_on !== n.starts_on ? ' – ' + shortD(n.ends_on) : ''}` : '';
    const past = (n.ends_on || n.starts_on) && (n.ends_on || n.starts_on) < H.today();
    return `<div class="news-item${past ? ' past' : ''}">
      <span class="ico ${sc === 'red' ? 'red' : sc === 'amber' ? 'amber' : ''}">${svg(ICO[n.category] || ICO.local)}</span>
      <div style="min-width:0">
        <div class="news-meta"><span>${H.esc(CAT_LABEL[n.category] || 'News')}</span>${n.source ? `<span>${H.esc(n.source)}</span>` : ''}${n.published_on ? `<span>${H.esc(longD(n.published_on))}</span>` : ''}</div>
        <a class="news-title" href="${H.esc(n.url || '#')}" target="_blank" rel="noopener">${H.esc(n.title)}</a>
        ${n.impact ? `<div class="news-impact">${H.esc(n.impact)}</div>` : ''}
        ${when ? `<div class="mt-s"><span class="pill ${past ? '' : 'amber'}">${past ? 'Was ' : ''}${H.esc(when)}</span></div>` : ''}
      </div>
      <div class="news-side">${sl !== 'FYI' ? `<span class="pill ${sc}">${sl}</span>` : ''}${H.isOperator() ? `<button class="btn btn-sm btn-ghost" title="Hide this story" onclick="H.pages.home.hideNews('${n.id}')">Hide</button>` : ''}</div>
    </div>`;
  };

  // ═════════════ HOME ═════════════
  const HOME = { cat: 'all', refreshing: false };
  H.pages.home = {
    async render(host) {
      const now = H.prNow(), hr = now.getHours();
      const greet = hr < 12 ? 'Good morning' : hr < 18 ? 'Good afternoon' : 'Good evening';
      host.innerHTML = `<div class="home-hero">
          <div><div class="home-kicker">${H.esc(greet)} · ${H.esc(now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }))}</div>
          <h2 class="home-title">Welcome back, ${H.esc(firstName())}</h2>
          <p class="muted" style="margin:4px 0 0">What's happening around the store.</p></div>
        </div>
        <div class="home-grid">
          <section><div class="section-label">What could affect the store <span class="row" style="gap:8px">${H.isOperator() ? '<a href="#" onclick="H.pages.home.addNews();return false">Add a story</a>' : ''}<a href="#" id="newsRefresh" onclick="H.pages.home.refresh();return false">Refresh news</a></span></div>
            <div class="chips" id="newsChips"></div>
            <div class="card" id="newsList"><div class="li-empty">Loading…</div></div></section>
          <section><div id="homeSources"></div></section>
        </div>`;
      this.news();
      if (H.renderSources) H.renderSources(document.getElementById('homeSources'));
      // Fresh news once a day, in the background, for the operator
      if (H.isOperator() && !window.__HUB_PREVIEW__) {
        const items = await H.db.list('hub_news', { cache: false }) || [];
        const last = items.filter(n => n.added_by === 'Refreshed by Claude').map(n => n.fetched_at).sort().pop();
        if (!last || Date.now() - new Date(last).getTime() > 12 * 3600e3) this.refresh(true);
      }
    },

    async news() {
      const list = document.getElementById('newsList'), chips = document.getElementById('newsChips'); if (!list) return;
      const all = await H.db.list('hub_news', { cache: false });
      if (all === null) { list.innerHTML = ''; return H.missingTable(list, 'hub_news'); }
      const items = all.filter(n => !n.hidden).sort((a, b) => (b.published_on || '') < (a.published_on || '') ? -1 : 1);
      const inCat = (n, c) => c === 'all' || (c === 'near' ? NEAR.includes(n.category) : n.category === c);
      chips.innerHTML = CATS.filter(([c]) => c === 'all' || items.some(n => inCat(n, c))).map(([c, l]) => `<button class="chip${HOME.cat === c ? ' active' : ''}" onclick="H.pages.home.setCat('${c}')">${H.esc(l)}<span class="n">${items.filter(n => inCat(n, c)).length}</span></button>`).join('');
      const shown = items.filter(n => inCat(n, HOME.cat));
      // Act-now items first, then newest
      shown.sort((a, b) => (b.severity === 'act') - (a.severity === 'act') || ((b.published_on || '') < (a.published_on || '') ? -1 : 1));
      const last = all.map(n => n.fetched_at).filter(Boolean).sort().pop();
      list.innerHTML = shown.length ? shown.slice(0, 12).map(newsItem).join('') + `<div class="news-foot">${last ? `Last checked ${H.esc(H.fmtDT(last))}. ` : ''}Claude reads the news and writes why each story matters for the store. Open the story to check the details.</div>`
        : `<div class="li-empty">${items.length ? 'Nothing in this category right now.' : 'No news yet. Click <strong>Refresh news</strong> and Claude will look for anything that could affect the store.'}</div>`;
    },
    setCat(c) { HOME.cat = c; this.news(); },
    async refresh(quiet) {
      if (HOME.refreshing) return; HOME.refreshing = true;
      const a = document.getElementById('newsRefresh'); if (a) a.textContent = 'Checking the news…';
      try { const r = await H.refreshNews(quiet); if (!quiet && !window.__HUB_PREVIEW__) H.toast(r.added ? `${r.added} new stor${r.added === 1 ? 'y' : 'ies'}` : 'No new stories'); this.news(); this.upcoming(); }
      catch (e) { if (!quiet) H.toast(e.message); else console.warn('[hub] news', e.message); }
      finally { HOME.refreshing = false; const b = document.getElementById('newsRefresh'); if (b) b.textContent = 'Refresh news'; }
    },
    async hideNews(id) { await H.db.update('hub_news', id, { hidden: true }); this.news(); },
    addNews() {
      H.modal(`<h3>Add news</h3><p class="muted small" style="margin:-10px 0 14px">Paste stories Claude found (JSON or CSV with: published_on, title, source, url, category, severity, starts_on, ends_on, impact), or fill in one story below.</p>
        <div class="field"><label for="nwPaste">Paste from Claude</label><textarea id="nwPaste" style="height:110px;font-family:ui-monospace,Menlo,monospace;font-size:.76rem" placeholder='[{"published_on":"2026-10-15","title":"…","source":"El Nuevo Día","url":"https://…","category":"aaa","severity":"watch","starts_on":"2026-10-20","ends_on":"2026-10-21","impact":"…"}]'></textarea></div>
        <div class="frow mt" style="row-gap:10px">
          <div class="field" style="grid-column:1/-1"><label for="nwTitle">Or one story: headline</label><input id="nwTitle"/></div>
          <div class="field" style="grid-column:1/-1"><label for="nwUrl">Link</label><input id="nwUrl" placeholder="https://"/></div>
          <div class="field"><label for="nwCat">Category</label><select id="nwCat">${Object.entries(CAT_LABEL).map(([k, v]) => `<option value="${k}">${H.esc(v)}</option>`).join('')}</select></div>
          <div class="field"><label for="nwSev">How urgent</label><select id="nwSev"><option value="info">FYI</option><option value="watch">Watch</option><option value="act">Act now</option></select></div>
          <div class="field"><label for="nwFrom">Starts (optional)</label><input id="nwFrom" type="date"/></div>
          <div class="field"><label for="nwTo">Ends (optional)</label><input id="nwTo" type="date"/></div>
          <div class="field" style="grid-column:1/-1"><label for="nwImpact">Why it matters</label><input id="nwImpact"/></div>
        </div><div id="nwErr" class="small mt-s"></div>
        <div class="mfooter"><button class="btn" onclick="H.closeModal()">Cancel</button><button class="btn btn-primary" id="nwSave">Save</button></div>`, true);
      document.getElementById('nwSave').onclick = async () => {
        const err = document.getElementById('nwErr');
        try {
          const paste = document.getElementById('nwPaste').value.trim();
          let rows = paste ? cleanNews(H.parseRows(paste), 'Pasted from Claude') : [];
          const t = document.getElementById('nwTitle').value.trim();
          const link = document.getElementById('nwUrl').value.trim();
          if (t) rows.push({ title: t, url: /^https?:\/\//.test(link) ? link : `manual:${Date.now()}`, source: link ? (link.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]) : 'Added by hand', category: document.getElementById('nwCat').value, severity: document.getElementById('nwSev').value, starts_on: document.getElementById('nwFrom').value || null, ends_on: document.getElementById('nwTo').value || null, impact: document.getElementById('nwImpact').value.trim() || null, published_on: H.today(), added_by: H.who(), fetched_at: new Date().toISOString() });
          if (!rows.length) throw new Error('Nothing to save. Each story needs a headline and a link.');
          await H.db.upsert('hub_news', rows, 'url'); H.closeModal(); H.toast(`${rows.length} stor${rows.length === 1 ? 'y' : 'ies'} saved`); this.news(); this.upcoming();
        } catch (e) { err.innerHTML = `<span style="color:var(--bad)">${H.esc(e.message)}</span>`; }
      };
    },

    async upcoming() {
      const host = document.getElementById('homeCal'); if (!host) return;
      const today = H.today(), to = H.addDays(today, 21);
      const ev = (await H.calendarEvents(today, to)).filter(e => e.kind !== 'catering' || e.day === today || e.day === H.addDays(today, 1));
      if (!ev.length) { host.innerHTML = '<div class="li-empty">Nothing in the next three weeks.</div>'; return; }
      let lastDay = '';
      host.innerHTML = ev.slice(0, 14).map(e => {
        const head = e.day !== lastDay ? `<div class="up-day">${e.day === today ? 'Today' : e.day === H.addDays(today, 1) ? 'Tomorrow' : H.esc(shortD(e.day))} <span>${H.daysBetween(today, e.day) > 1 ? `in ${H.daysBetween(today, e.day)} days` : ''}</span></div>` : '';
        lastDay = e.day;
        return `${head}<div class="up-ev">${evPill(e)}<div style="min-width:0"><div class="up-title">${e.url ? `<a href="${H.esc(e.url)}" target="_blank" rel="noopener">${H.esc(e.title)}</a>` : H.esc(e.title)}</div>${e.notes ? `<div class="li-sub">${H.esc(e.notes)}</div>` : ''}</div></div>`;
      }).join('');
    },
  };

  // ═════════════ CALENDAR ═════════════
  const CAL = { month: null, sel: null, hide: new Set() };
  H.pages.calendar = {
    async render(host) {
      const today = H.today();
      if (!CAL.month) CAL.month = today.slice(0, 7);
      if (!CAL.sel) CAL.sel = today;
      const [y, m] = CAL.month.split('-').map(Number);
      const first = new Date(y, m - 1, 1), start = new Date(first); start.setDate(1 - first.getDay());
      const end = new Date(start); end.setDate(start.getDate() + 41);
      const ev = (await H.calendarEvents(H.iso(start), H.iso(end))).filter(e => !CAL.hide.has(e.kind));
      const byDay = {}; ev.forEach(e => { let d = e.day; const last = e.end_day && e.end_day > e.day ? e.end_day : e.day; for (let i = 0; i < 31 && d <= last; i++, d = H.addDays(d, 1)) (byDay[d] = byDay[d] || []).push(e); });
      const kindsUsed = [...new Set(Object.values(byDay).flat().map(e => e.kind))];
      let cells = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => `<div class="dow">${d}</div>`).join('');
      for (let i = 0; i < 42; i++) {
        const d = new Date(start); d.setDate(start.getDate() + i); const iso = H.iso(d), list = byDay[iso] || [];
        const sunday = d.getDay() === 0;
        cells += `<div class="day${d.getMonth() !== m - 1 ? ' out' : ''}${iso === today ? ' today' : ''}${iso === CAL.sel ? ' sel' : ''}${sunday ? ' sun' : ''}" onclick="H.pages.calendar.pick('${iso}')">
          <span class="dn">${d.getDate()}</span>${sunday ? '<span class="cal-closed">Closed</span>' : ''}
          ${list.slice(0, 3).map(e => `<span class="ev k-${e.kind}" title="${H.esc(e.title)}">${H.esc(e.title)}</span>`).join('')}${list.length > 3 ? `<span class="small muted">+${list.length - 3} more</span>` : ''}</div>`;
      }
      const sel = byDay[CAL.sel] || [];
      host.innerHTML = `<div class="ph"><div><h2>Calendar</h2><p>Holidays, store closures, your deadlines and events, outages and road closures from the news, and catering pickups, in one place.</p></div>
          <div class="actions"><button class="btn" onclick="H.pages.calendar.importEvents()">Import events</button><button class="btn btn-primary" onclick="H.pages.calendar.add()">Add to calendar</button></div></div>
        <div class="row" style="justify-content:space-between;margin-bottom:12px;flex-wrap:wrap">
          <div class="row"><button class="btn btn-sm" onclick="H.pages.calendar.move(-1)" aria-label="Previous month">‹</button><strong style="min-width:150px;text-align:center;font-size:1.05rem">${H.esc(H.monthLabel(CAL.month, true))}</strong><button class="btn btn-sm" onclick="H.pages.calendar.move(1)" aria-label="Next month">›</button><button class="btn btn-sm" onclick="H.pages.calendar.move(0)">Today</button></div>
          <div class="chips" style="margin:0">${Object.entries(KINDS).filter(([k]) => kindsUsed.includes(k) || CAL.hide.has(k)).map(([k, [l]]) => `<button class="chip${CAL.hide.has(k) ? '' : ' active'}" onclick="H.pages.calendar.toggle('${k}')"><i class="kdot k-${k}"></i>${H.esc(l)}</button>`).join('')}</div>
        </div>
        <div class="cal-wrap"><div class="cal">${cells}</div>
          <aside class="card cal-side"><div class="cal-side-h">${H.esc(H.fmtD(CAL.sel, { weekday: 'long', month: 'long', day: 'numeric' }))}${H.d(CAL.sel).getDay() === 0 ? ' <span class="pill">Closed Sundays</span>' : ''}</div>
            ${sel.length ? sel.map(e => `<div class="up-ev">${evPill(e)}<div style="min-width:0"><div class="up-title">${e.url ? `<a href="${H.esc(e.url)}" target="_blank" rel="noopener">${H.esc(e.title)}</a>` : H.esc(e.title)}</div>${e.notes ? `<div class="li-sub">${H.esc(e.notes)}</div>` : ''}${e.id && !e.builtin && !e.news && !e.catering ? `<div class="mt-s"><a href="#" class="small" onclick="H.pages.calendar.edit('${e.id}');return false">Edit</a></div>` : ''}</div></div>`).join('') : '<div class="li-empty" style="padding:12px 0">Nothing on this day.</div>'}
            <button class="btn btn-sm mt" onclick="H.pages.calendar.add('${CAL.sel}')">Add on this day</button></aside></div>
        <p class="small muted mt">Holidays follow Puerto Rico's official list (1 LPRA §71), with dates that fall on a Sunday moved to Monday, plus Juneteenth. Check new laws each year.</p>`;
    },
    move(n) { if (!n) { CAL.month = H.today().slice(0, 7); CAL.sel = H.today(); } else { const [y, m] = CAL.month.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); CAL.month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; CAL.sel = CAL.month + '-01'; } this.render(document.getElementById('calendarApp')); },
    pick(iso) { CAL.sel = iso; if (iso.slice(0, 7) !== CAL.month) CAL.month = iso.slice(0, 7); this.render(document.getElementById('calendarApp')); },
    toggle(k) { CAL.hide.has(k) ? CAL.hide.delete(k) : CAL.hide.add(k); this.render(document.getElementById('calendarApp')); },
    add(day, e) {
      H.form({ title: e ? 'Edit calendar entry' : 'Add to calendar', fields: [
        { id: 'title', label: 'What', value: e && e.title, required: true },
        { id: 'day', label: 'Date', type: 'date', value: (e && e.day) || day || H.today(), required: true, half: true },
        { id: 'end_day', label: 'Ends', type: 'date', value: e && e.end_day, half: true },
        { id: 'kind', label: 'Type', type: 'select', value: (e && e.kind) || 'event', options: [{ value: 'event', label: 'Event' }, { value: 'deadline', label: 'Deadline' }, { value: 'cfa', label: 'Chick-fil-A' }, { value: 'community', label: 'Community' }, { value: 'personal', label: 'Personal' }, { value: 'closed', label: 'Store closed' }], half: true },
        { id: 'notes', label: 'Notes', type: 'textarea', value: e && e.notes },
      ], extraButtons: e ? `<button type="button" class="btn" style="margin-right:auto;color:var(--bad)" onclick="H.pages.calendar.remove('${e.id}')">Delete</button>` : '',
      onSubmit: async v => {
        if (v.end_day && v.end_day < v.day) throw new Error('The end date is before the start date.');
        const row = { title: v.title, day: v.day, end_day: v.end_day, kind: v.kind, notes: v.notes };
        if (e) await H.db.update('hub_calendar', e.id, row); else await H.db.insert('hub_calendar', { ...row, source: 'Added in the hub', created_by: H.who() });
        CAL.sel = v.day; CAL.month = v.day.slice(0, 7); H.toast('Saved'); this.render(document.getElementById('calendarApp'));
      } });
    },
    importEvents() {
      H.importModal({
        title: 'Import events near the store',
        intro: 'From cfahome → Analytics Hub → Sales & Brand Growth → Events Around Your Restaurant. One row per event. Re-importing the same event updates it.',
        example: 'date,end_date,title,notes\n2026-10-24,,Festival de la Chiringa · Parque Lineal,Expected 8,000 · 2.1 mi\n2026-11-07,2026-11-08,Torneo de voleibol · Coliseo Rubén Rodríguez,Expected 3,500',
        prompt: 'cfahome → Analytics Hub → Sales & Brand Growth → Events Around Your Restaurant. For the next 60 days copy each event: date, end date, name and venue, and expected attendance or distance as notes.',
        onRows: async (rows, dry) => {
          const out = rows.map(r => { const d = H.toISO(H.pick(r, 'date', 'start_date', 'day')); const t = String(H.pick(r, 'title', 'event', 'name') || '').trim(); if (!d || !t) return null; return { day: d, end_day: H.toISO(H.pick(r, 'end_date', 'end')) || null, title: t.slice(0, 200), kind: 'event', notes: H.pick(r, 'notes', 'venue', 'attendance') || null, source: 'cfahome Events', created_by: H.who(), created_at: new Date().toISOString() }; }).filter(Boolean);
          if (dry) { const red = []; out.forEach(e => { if (e.end_day && e.end_day < e.day) red.push(`${e.title}: ends before it starts.`); }); return { rows: out, block: red.length > 0, html: out.length ? `<span style="color:var(--ok);font-weight:600">${out.length} event${out.length === 1 ? '' : 's'} read</span>${H.flagHtml(red, [])}` : '<span style="color:var(--bad)">No rows with a date and a title were found.</span>' }; }
          await H.db.upsert('hub_calendar', rows, 'day,title'); H.toast(`${rows.length} events saved`); this.render(document.getElementById('calendarApp'));
        },
      });
    },
    async edit(id) { const all = await H.db.list('hub_calendar', { cache: false }) || []; const e = all.find(x => x.id === id); if (e) this.add(null, e); },
    remove(id) { H.confirm('Delete this entry?', 'It comes off the calendar for everyone.', 'Delete', async () => { await H.db.remove('hub_calendar', id); this.render(document.getElementById('calendarApp')); }, true); },
  };
})();
