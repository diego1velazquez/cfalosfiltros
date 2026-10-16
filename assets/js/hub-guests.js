/* ═══════════════════════════════════════════════════════════
   LOS FILTROS HUB — Guests & marketing
   Marketing (approvals, calendar, campaigns, community, social,
   assets & ideas) · Reputación · Data sources panel
   Writes only to: marketing_posts, marketing_events,
   community_requests, social_stats, marketing_assets,
   marketing_ideas, rep_snapshots, rep_reviews, storage bucket "marketing".
   ═══════════════════════════════════════════════════════════ */
(function () {
  'use strict';
  const H = window.H;
  const MK = { tab: 'approvals', status: 'waiting', sel: null, calMonth: null, calDay: null, comm: 'upcoming' };
  const POST_ST = { waiting: ['Waiting for approval', 'amber'], changes: ['Changes requested', 'red'], approved: ['Approved', 'green'], denied: ['Denied', ''], posted: ['Posted', 'blue'] };
  const COMM_KIND = { spirit_night: 'Spirit night', donation: 'Food donation', sponsorship: 'Sponsorship', event: 'Event / visit' };
  const COMM_ST = { requested: ['Requested', 'amber'], approved: ['Approved', 'green'], done: ['Done', 'blue'], declined: ['Declined', ''] };
  const canApprove = () => ['operator', 'director'].includes(H.role());

  async function uploadFile(file, folder) {
    if (!file) return null;
    const path = `${folder}/${Date.now()}-${file.name.replace(/[^\w.\-]+/g, '_')}`;
    const { error } = await getSupa().storage.from('marketing').upload(path, file, { upsert: false });
    if (error) throw new Error('Upload failed: ' + error.message);
    const { data } = getSupa().storage.from('marketing').getPublicUrl(path);
    return (data && data.publicUrl) || null;
  }
  const chan = s => String(s || '').split(/[,·]/).map(x => x.trim()).filter(Boolean);

  H.pages.marketing = {
    async render(host) {
      const tabs = [['approvals', 'Approvals'], ['calendar', 'Calendar'], ['campaigns', 'Campaigns'], ['community', 'Community'], ['social', 'Social results'], ['assets', 'Assets & ideas']];
      host.innerHTML = `<div class="ph"><div><h2>Marketing</h2><p>Your marketing team uploads posts here for approval. Campaigns, community events and results live in the same place.</p></div>
        <div class="actions"><button class="btn" onclick="H.pages.marketing.addCommunity()">Community request</button><button class="btn btn-primary" onclick="H.pages.marketing.addPost()">Upload a post</button></div></div>
        <div class="subtabs">${tabs.map(([k, l]) => `<button class="subtab ${MK.tab === k ? 'active' : ''}" onclick="H.pages.marketing.setTab('${k}')">${l}</button>`).join('')}</div>
        <div id="mkBody"><div class="li-empty">Loading…</div></div>`;
      const body = document.getElementById('mkBody');
      try { await this['tab_' + MK.tab](body); } catch (e) { console.error(e); body.innerHTML = `<div class="source warn">${H.esc(e.message)}</div>`; }
    },
    setTab(t) { MK.tab = t; this.render(document.getElementById('marketingApp')); },

    // ── approvals ──
    async tab_approvals(body) {
      const posts = await H.db.list('marketing_posts', { order: 'scheduled_at', asc: true, cache: false });
      if (posts === null) { body.innerHTML = ''; return H.missingTable(body, 'marketing_posts'); }
      const counts = {}; posts.forEach(p => { counts[p.status] = (counts[p.status] || 0) + 1; });
      const list = posts.filter(p => MK.status === 'all' || p.status === MK.status);
      if (!MK.sel || !list.some(p => p.id === MK.sel)) MK.sel = list[0] && list[0].id;
      const sel = posts.find(p => p.id === MK.sel);
      body.innerHTML = `
        <div class="kpis">
          <div class="kpi ${counts.waiting ? 'warn' : 'ok'}"><div class="kpi-label">Waiting for you</div><div class="kpi-val">${counts.waiting || 0}</div><div class="kpi-sub">Posts to approve</div></div>
          <div class="kpi"><div class="kpi-label">Changes requested</div><div class="kpi-val">${counts.changes || 0}</div><div class="kpi-sub">With marketing</div></div>
          <div class="kpi"><div class="kpi-label">Approved · scheduled</div><div class="kpi-val">${counts.approved || 0}</div><div class="kpi-sub">Ready to post</div></div>
          <div class="kpi"><div class="kpi-label">Posted</div><div class="kpi-val">${counts.posted || 0}</div><div class="kpi-sub">All time</div></div>
        </div>
        <div class="chips">${[['waiting', 'Waiting'], ['changes', 'Changes requested'], ['approved', 'Approved'], ['denied', 'Denied'], ['posted', 'Posted'], ['all', 'All']].map(([k, l]) => `<button class="chip ${MK.status === k ? 'active' : ''}" onclick="H.pages.marketing.setStatus('${k}')">${l}<span class="n">${k === 'all' ? posts.length : counts[k] || 0}</span></button>`).join('')}</div>
        <div class="split">
          <div class="list">${list.map(p => `<div class="li click" style="${p.id === MK.sel ? 'background:var(--surface-2)' : ''}" onclick="H.pages.marketing.select('${p.id}')">${p.image_url ? `<img src="${H.esc(p.image_url)}" alt="" style="width:30px;height:30px;border-radius:7px;object-fit:cover"/>` : H.icon('image', 'purple')}
            <div style="min-width:0"><div class="li-title">${H.esc(p.title)}</div><div class="li-sub">${p.scheduled_at ? H.fmtDT(p.scheduled_at) : 'No date'} · ${H.esc(chan(p.channels).join(' + ') || '—')}${p.comment_count ? ` · ${p.comment_count} comment${p.comment_count === 1 ? '' : 's'}` : ''}</div></div>
            <span class="pill ${POST_ST[p.status][1]}">${POST_ST[p.status][0]}</span></div>`).join('') || '<div class="li-empty">No posts here.</div>'}</div>
          <div>${sel ? postPreview(sel) : '<div class="card card-pad muted small">Select a post to review it.</div>'}</div>
        </div>`;
    },
    setStatus(s) { MK.status = s; MK.sel = null; this.render(document.getElementById('marketingApp')); },
    select(id) { MK.sel = id; this.render(document.getElementById('marketingApp')); },
    async decide(id, status) {
      const comment = (document.getElementById('mkComment') || {}).value || '';
      if (status === 'changes' && !comment.trim()) { H.toast('Add a comment saying what to change'); document.getElementById('mkComment').focus(); return; }
      const posts = await H.db.list('marketing_posts', { cache: false }); const p = posts.find(x => x.id === id);
      const thread = Array.isArray(p.comments) ? p.comments.slice() : [];
      if (comment.trim()) thread.push({ by: H.who(), at: new Date().toISOString(), text: comment.trim() });
      await H.db.update('marketing_posts', id, { status, comments: thread, comment_count: thread.length, decided_by: status === 'posted' ? p.decided_by : H.who(), decided_at: new Date().toISOString() });
      H.toast({ approved: 'Approved', changes: 'Changes requested', denied: 'Denied', posted: 'Marked posted' }[status]); this.render(document.getElementById('marketingApp')); hubRefreshCounts();
    },
    addPost() {
      H.form({ title: 'Upload a post', intro: 'It goes to the operator for approval before it is posted.', wide: true, fields: [
        { id: 'title', label: 'Title', required: true, placeholder: 'e.g. Family Night is tonight', half: true },
        { id: 'when', label: 'Post date & time', type: 'datetime-local', required: true, half: true },
        { id: 'channels', label: 'Where', type: 'select', options: ['Instagram + Facebook', 'Instagram', 'Facebook', 'Instagram + Facebook + TikTok', 'TikTok', 'In-store signage'], half: true },
        { id: 'image', label: 'Image', type: 'file', accept: 'image/*', half: true },
        { id: 'caption', label: 'Caption', type: 'textarea', required: true, placeholder: 'Escribe el texto en español e inglés si aplica.' },
      ], submit: 'Send for approval', onSubmit: async v => {
        const url = await uploadFile(v.image, 'posts');
        await H.db.insert('marketing_posts', { title: v.title, caption: v.caption, channels: v.channels, scheduled_at: new Date(v.when + ':00-04:00').toISOString(), image_url: url, status: 'waiting', uploaded_by: H.who(), comments: [], comment_count: 0 });
        MK.tab = 'approvals'; MK.status = 'waiting'; H.toast('Sent for approval'); this.render(document.getElementById('marketingApp')); hubRefreshCounts();
      } });
    },

    // ── calendar ──
    async tab_calendar(body) {
      const [ev, posts, comm] = await Promise.all([H.db.list('marketing_events', { cache: false }), H.db.list('marketing_posts'), H.db.list('community_requests')]);
      if (ev === null) { body.innerHTML = ''; return H.missingTable(body, 'marketing_events'); }
      const now = H.prNow();
      MK.calMonth = MK.calMonth || H.iso(now).slice(0, 7);
      MK.calDay = MK.calDay || H.today();
      const [y, m] = MK.calMonth.split('-').map(Number);
      const first = new Date(y, m - 1, 1); const start = new Date(first); start.setDate(1 - ((first.getDay() + 6) % 7));
      const items = calItems(ev, posts || [], comm || []);
      const cells = []; for (let i = 0; i < 42; i++) { const d = new Date(start); d.setDate(start.getDate() + i); cells.push(H.iso(d)); }
      const dayItems = items.filter(x => x.date === MK.calDay);
      body.innerHTML = `<div class="split" style="grid-template-columns:minmax(0,2fr) minmax(0,1fr)">
        <div><div class="between mb"><div class="strong" style="font-size:1.05rem">${H.monthLabel(MK.calMonth, true)}</div><div class="row"><button class="btn btn-sm" onclick="H.pages.marketing.calMove(-1)" aria-label="Previous month">‹</button><button class="btn btn-sm" onclick="H.pages.marketing.calMove(0)">Today</button><button class="btn btn-sm" onclick="H.pages.marketing.calMove(1)" aria-label="Next month">›</button></div></div>
          <div class="cal">${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map(d => `<div class="dow">${d}</div>`).join('')}
          ${cells.map(c => { const its = items.filter(x => x.date === c); return `<div class="day ${c.slice(0, 7) !== MK.calMonth ? 'out' : ''} ${c === H.today() ? 'today' : ''} ${c === MK.calDay ? 'sel' : ''}" onclick="H.pages.marketing.calPick('${c}')"><span class="dn">${+c.slice(8)}</span>${its.slice(0, 3).map(x => `<span class="ev ${x.kind}" title="${H.esc(x.title)}">${H.esc(x.title)}</span>`).join('')}${its.length > 3 ? `<span class="small muted">+${its.length - 3}</span>` : ''}</div>`; }).join('')}</div>
          <div class="legend"><span><i style="background:var(--info-wash);border:1px solid var(--info)"></i>Event</span><span><i style="background:var(--ok-wash);border:1px solid var(--ok)"></i>Post</span><span><i style="background:var(--lead-wash);border:1px solid var(--lead)"></i>Community</span><span><i style="background:var(--warn-wash);border:1px solid var(--warn)"></i>Campaign</span></div></div>
        <div class="card card-pad"><div class="between"><div class="strong">${H.fmtD(MK.calDay, { weekday: 'long', month: 'long', day: 'numeric' })}</div><button class="btn btn-sm" onclick="H.pages.marketing.addEvent('${MK.calDay}')">+ Add</button></div>
          <div class="stack mt" style="gap:10px">${dayItems.map(x => `<div style="border:1px solid var(--border);border-radius:8px;padding:10px 12px"><span class="pill ${{ event: 'blue', post: 'green', community: 'purple', campaign: 'amber' }[x.kind]}">${{ event: 'Event', post: 'Post', community: 'Community', campaign: 'Campaign' }[x.kind]}</span><div class="strong mt-s">${H.esc(x.title)}</div>${x.sub ? `<div class="small muted">${H.esc(x.sub)}</div>` : ''}${x.del ? `<button class="btn btn-sm btn-ghost mt-s" onclick="H.pages.marketing.delEvent('${x.del}')">Remove</button>` : ''}</div>`).join('') || '<div class="small muted">Nothing on this day.</div>'}</div></div>
      </div>`;
    },
    calMove(d) { if (d === 0) { MK.calMonth = H.today().slice(0, 7); MK.calDay = H.today(); } else { const [y, m] = MK.calMonth.split('-').map(Number); MK.calMonth = H.iso(new Date(y, m - 1 + d, 1)).slice(0, 7); } this.render(document.getElementById('marketingApp')); },
    calPick(d) { MK.calDay = d; this.render(document.getElementById('marketingApp')); },
    addEvent(date, kind) {
      H.form({ title: kind === 'campaign' ? 'New campaign' : 'Add to calendar', wide: kind === 'campaign', fields: [
        { id: 'title', label: 'Title', required: true, half: true },
        { id: 'kind', label: 'Type', type: 'select', value: kind || 'event', half: true, options: [{ value: 'event', label: 'In-store event' }, { value: 'campaign', label: 'Campaign' }] },
        { id: 'start', label: 'Starts', type: 'date', value: date || H.today(), required: true, half: true },
        { id: 'end', label: 'Ends', type: 'date', half: true },
        { id: 'owner', label: 'Owner', value: H.who(), half: true },
        { id: 'budget', label: 'Budget', type: 'number', step: '0.01', half: true },
        { id: 'goal', label: 'Goal', placeholder: 'e.g. 30 new catering accounts', half: true },
        { id: 'channels', label: 'Channels', placeholder: 'In-store, Instagram, App', half: true },
        { id: 'details', label: 'Details', type: 'textarea' },
      ], submit: 'Save', onSubmit: async v => {
        await H.db.insert('marketing_events', { title: v.title, kind: v.kind, starts_on: v.start, ends_on: v.end || v.start, owner: v.owner, budget: v.budget, goal: v.goal, channels: v.channels, details: v.details, created_by: H.who() });
        H.toast('Saved'); this.render(document.getElementById('marketingApp'));
      } });
    },
    delEvent(id) { H.confirm('Remove from calendar?', 'This removes the event or campaign.', 'Remove', async () => { await H.db.remove('marketing_events', id); this.render(document.getElementById('marketingApp')); }, true); },

    // ── campaigns ──
    async tab_campaigns(body) {
      const ev = await H.db.list('marketing_events', { eq: { kind: 'campaign' }, order: 'starts_on', asc: false, cache: false });
      if (ev === null) { body.innerHTML = ''; return H.missingTable(body, 'marketing_events'); }
      const t = H.today();
      const live = ev.filter(e => e.starts_on <= t && (e.ends_on || e.starts_on) >= t), soon = ev.filter(e => e.starts_on > t), past = ev.filter(e => (e.ends_on || e.starts_on) < t);
      const spent30 = ev.filter(e => (e.ends_on || e.starts_on) >= H.addDays(t, -30)).reduce((s, e) => s + (+e.spent || 0), 0);
      const planned = ev.filter(e => e.starts_on >= t.slice(0, 7) + '-01').reduce((s, e) => s + (+e.budget || 0), 0);
      body.innerHTML = `<div class="kpis">
          <div class="kpi ok"><div class="kpi-label">Live now</div><div class="kpi-val">${live.length}</div><div class="kpi-sub">${H.esc(live.map(e => e.title).slice(0, 2).join(', ') || 'None')}</div></div>
          <div class="kpi"><div class="kpi-label">Coming up</div><div class="kpi-val">${soon.length}</div><div class="kpi-sub">Scheduled</div></div>
          <div class="kpi"><div class="kpi-label">Spent · last 30 days</div><div class="kpi-val">${H.money(spent30)}</div><div class="kpi-sub">Logged on campaigns</div></div>
          <div class="kpi"><div class="kpi-label">Planned budget</div><div class="kpi-val">${H.money(planned)}</div><div class="kpi-sub">This month onward</div></div></div>
        <div class="between mb"><div class="section-label" style="margin:0">Campaigns</div><button class="btn btn-sm btn-primary" onclick="H.pages.marketing.addEvent(null,'campaign')">New campaign</button></div>
        <div class="grid g3">${[...live, ...soon, ...past].map(e => { const st = live.includes(e) ? ['Live', 'green'] : soon.includes(e) ? ['Coming up', 'blue'] : ['Ended', '']; const pct = e.budget ? Math.min(100, (+e.spent || 0) / e.budget * 100) : 0;
          return `<div class="card card-pad ${live.includes(e) ? 'top-ok' : ''}"><div class="between small muted"><span>${H.fmtD(e.starts_on)} – ${H.fmtD(e.ends_on || e.starts_on)}</span><span class="pill ${st[1]}">${st[0]}</span></div>
            <div class="strong mt-s" style="font-size:1rem">${H.esc(e.title)}</div>${e.details ? `<div class="small muted mt-s">${H.esc(e.details)}</div>` : ''}
            ${e.channels ? `<div class="row mt-s" style="flex-wrap:wrap;gap:5px">${chan(e.channels).map(c => `<span class="pill">${H.esc(c)}</span>`).join('')}</div>` : ''}
            ${e.goal ? `<div class="small mt"><span class="muted">Goal</span> · ${H.esc(e.goal)}${e.result ? `<br><span class="muted">Result</span> · <strong>${H.esc(e.result)}</strong>` : ''}</div>` : ''}
            ${e.budget ? `<div class="between small mt-s"><span class="muted">Budget</span><span class="strong">${H.money(e.spent || 0)} / ${H.money(e.budget)}</span></div><div class="bar ${pct > 100 ? 'bad' : 'warn'}" style="margin-top:4px"><i style="width:${pct}%"></i></div>` : ''}
            <div class="row mt"><button class="btn btn-sm" onclick="H.pages.marketing.updateCampaign('${e.id}')">Update</button></div></div>`; }).join('') || '<div class="list" style="grid-column:1/-1"><div class="li-empty">No campaigns yet.</div></div>'}</div>`;
    },
    async updateCampaign(id) {
      const e = (await H.db.list('marketing_events', { cache: false })).find(x => x.id === id);
      H.form({ title: e.title, fields: [
        { id: 'spent', label: 'Spent so far', type: 'number', step: '0.01', value: e.spent, half: true },
        { id: 'end', label: 'Ends', type: 'date', value: e.ends_on, half: true },
        { id: 'result', label: 'Result', value: e.result, placeholder: 'e.g. 22 new catering accounts' },
        { id: 'details', label: 'Details', type: 'textarea', value: e.details },
      ], extraButtons: `<button type="button" class="btn btn-danger-quiet" onclick="H.closeModal();H.pages.marketing.delEvent('${id}')">Delete</button>`, onSubmit: async v => { await H.db.update('marketing_events', id, { spent: v.spent, ends_on: v.end, result: v.result, details: v.details }); H.toast('Saved'); this.render(document.getElementById('marketingApp')); } });
    },

    // ── community ──
    async tab_community(body) {
      const rows = await H.db.list('community_requests', { order: 'event_on', asc: true, cache: false });
      if (rows === null) { body.innerHTML = ''; return H.missingTable(body, 'community_requests'); }
      const t = H.today(), yr = t.slice(0, 4);
      const upcoming = rows.filter(r => r.event_on >= t && r.status !== 'declined');
      const doneYr = rows.filter(r => r.status === 'done' && (r.event_on || '').startsWith(yr));
      const given = doneYr.reduce((s, r) => s + (+r.donated || 0), 0);
      const sNight = doneYr.filter(r => r.kind === 'spirit_night').reduce((s, r) => s + (+r.sales || 0), 0);
      const flt = { upcoming: r => r.event_on >= t && r.status !== 'declined', requested: r => r.status === 'requested', approved: r => r.status === 'approved', done: r => r.status === 'done', declined: r => r.status === 'declined' }[MK.comm] || (() => true);
      const list = rows.filter(flt);
      body.innerHTML = `<div class="kpis">
          <div class="kpi ${rows.filter(r => r.status === 'requested').length ? 'warn' : ''}"><div class="kpi-label">New requests</div><div class="kpi-val">${rows.filter(r => r.status === 'requested').length}</div><div class="kpi-sub">Waiting for a yes or no</div></div>
          <div class="kpi"><div class="kpi-label">Coming up</div><div class="kpi-val">${upcoming.length}</div><div class="kpi-sub">${upcoming.slice(0, 2).map(r => H.fmtD(r.event_on)).join(', ') || '&nbsp;'}</div></div>
          <div class="kpi ok"><div class="kpi-label">Given back · ${yr}</div><div class="kpi-val">${H.money(given)}</div><div class="kpi-sub">${doneYr.length} event${doneYr.length === 1 ? '' : 's'} done</div></div>
          <div class="kpi"><div class="kpi-label">Spirit night sales</div><div class="kpi-val">${H.money(sNight)}</div><div class="kpi-sub">During the events</div></div></div>
        <div class="chips">${[['upcoming', 'Upcoming'], ['requested', 'Requested'], ['approved', 'Approved'], ['done', 'Done'], ['declined', 'Declined'], ['all', 'All']].map(([k, l]) => `<button class="chip ${MK.comm === k ? 'active' : ''}" onclick="H.pages.marketing.setComm('${k}')">${l}</button>`).join('')}</div>
        <div class="grid g3">${list.map(r => `<div class="card card-pad"><div class="between"><span class="pill purple">${COMM_KIND[r.kind] || H.esc(r.kind)}</span><span class="pill ${COMM_ST[r.status][1]}">${COMM_ST[r.status][0]}</span></div>
            <div class="strong mt-s" style="font-size:1rem">${H.esc(r.org)}</div>
            <div class="small muted">${H.fmtD(r.event_on, { weekday: 'short', month: 'short', day: 'numeric' })}${r.time_window ? ' · ' + H.esc(r.time_window) : ''}${r.contact ? ' · ' + H.esc(r.contact) : ''}</div>
            ${r.notes ? `<div class="small mt-s" style="color:var(--text-mid)">${H.esc(r.notes)}</div>` : ''}
            <div class="small mt-s">${r.donation_pct ? `<div class="between"><span class="muted">Donation</span><strong>${+r.donation_pct}% of sales from their guests</strong></div>` : ''}${r.expected_guests ? `<div class="between"><span class="muted">Expected guests</span><strong>${r.expected_guests}</strong></div>` : ''}</div>
            ${r.status === 'done' ? `<div style="background:var(--ok-wash);color:var(--ok);border-radius:8px;padding:8px 10px;margin-top:8px" class="small strong">${r.sales ? H.money(r.sales) + ' sales · ' : ''}${H.money(r.donated || 0)} donated</div>` : ''}
            <div class="row mt" style="flex-wrap:wrap;gap:6px">${r.status === 'requested' && canApprove() ? `<button class="btn btn-sm btn-ok-quiet" onclick="H.pages.marketing.commStatus('${r.id}','approved')">Approve</button><button class="btn btn-sm btn-ghost" onclick="H.pages.marketing.commStatus('${r.id}','declined')">Decline</button>` : ''}${r.status === 'approved' ? `<button class="btn btn-sm" onclick="H.pages.marketing.commDone('${r.id}')">Mark done</button>` : ''}</div></div>`).join('') || '<div class="list" style="grid-column:1/-1"><div class="li-empty">Nothing here.</div></div>'}</div>`;
    },
    setComm(k) { MK.comm = k; this.render(document.getElementById('marketingApp')); },
    addCommunity() {
      H.form({ title: 'Community request', wide: true, fields: [
        { id: 'org', label: 'Organization', required: true, placeholder: 'e.g. Escuela Superior Central · Banda', half: true },
        { id: 'kind', label: 'Type', type: 'select', options: Object.entries(COMM_KIND).map(([k, v]) => ({ value: k, label: v })), half: true },
        { id: 'date', label: 'Date', type: 'date', required: true, half: true },
        { id: 'time', label: 'Time', placeholder: '5:00 PM – 8:00 PM', half: true },
        { id: 'contact', label: 'Contact', placeholder: 'Name · phone', half: true },
        { id: 'pct', label: 'Donation % of sales', type: 'number', step: '1', value: 15, half: true },
        { id: 'guests', label: 'Expected guests', type: 'number', half: true },
        { id: 'notes', label: 'Notes', type: 'textarea' },
      ], submit: 'Save request', onSubmit: async v => {
        await H.db.insert('community_requests', { org: v.org, kind: v.kind, event_on: v.date, time_window: v.time, contact: v.contact, donation_pct: v.kind === 'spirit_night' ? v.pct : null, expected_guests: v.guests, notes: v.notes, status: 'requested', created_by: H.who() });
        MK.tab = 'community'; MK.comm = 'requested'; H.toast('Request saved'); this.render(document.getElementById('marketingApp')); hubRefreshCounts();
      } });
    },
    async commStatus(id, st) { await H.db.update('community_requests', id, { status: st, decided_by: H.who() }); H.toast(st === 'approved' ? 'Approved · on the calendar' : 'Declined'); this.render(document.getElementById('marketingApp')); hubRefreshCounts(); },
    async commDone(id) {
      const r = (await H.db.list('community_requests', { cache: false })).find(x => x.id === id);
      H.form({ title: `Wrap up ${r.org}`, fields: [
        { id: 'sales', label: 'Sales from their guests', type: 'number', step: '0.01', half: true },
        { id: 'don', label: 'Amount donated', type: 'number', step: '0.01', half: true, help: r.donation_pct ? `${+r.donation_pct}% of sales` : '' },
      ], submit: 'Mark done', onSubmit: async v => { const don = v.don != null ? v.don : (v.sales && r.donation_pct ? +(v.sales * r.donation_pct / 100).toFixed(2) : null); await H.db.update('community_requests', id, { status: 'done', sales: v.sales, donated: don }); H.toast('Marked done'); this.render(document.getElementById('marketingApp')); } });
    },

    // ── social results ──
    async tab_social(body) {
      const rows = await H.db.list('social_stats', { order: 'captured_on', cache: false });
      if (rows === null) { body.innerHTML = ''; return H.missingTable(body, 'social_stats'); }
      const plats = ['instagram', 'facebook', 'tiktok'];
      const names = { instagram: 'Instagram', facebook: 'Facebook', tiktok: 'TikTok' };
      const colors = { instagram: '#C13584', facebook: '#1877F2', tiktok: '#18181B' };
      body.innerHTML = `<div class="source">These numbers come from each platform's insights page. Ask Claude to pull them, or paste them with Update numbers.</div>
        <div class="between mb"><div class="section-label" style="margin:0">Followers and reach</div><button class="btn btn-sm" onclick="H.pages.marketing.importSocial()">Update numbers</button></div>
        <div class="grid g3">${plats.map(p => { const r = rows.filter(x => x.platform === p); const last = r[r.length - 1]; const ago = r.filter(x => x.captured_on <= H.addDays(last ? last.captured_on : H.today(), -28)).pop();
          return `<div class="card card-pad" style="border-top:3px solid ${colors[p]}"><div class="strong">${names[p]}</div>
            ${last ? `<div class="between" style="align-items:flex-end"><div><div class="label mt-s">Followers</div><div style="font-size:1.6rem;font-weight:700">${H.num(last.followers)}</div><div class="small">${ago ? `<span style="color:${last.followers >= ago.followers ? 'var(--ok)' : 'var(--bad)'};font-weight:600">${last.followers >= ago.followers ? '+' : ''}${H.num(last.followers - ago.followers)}</span> <span class="muted">in 4 weeks</span>` : '<span class="muted">&nbsp;</span>'}</div></div>${H.spark(r.map(x => x.followers), colors[p])}</div>
            <div class="between" style="align-items:flex-end;margin-top:10px"><div><div class="label">Reach this week</div><div class="strong" style="font-size:1.15rem">${H.num(last.reach)}</div></div>${H.spark(r.map(x => x.reach), colors[p])}</div>
            <div class="small muted mt-s">As of ${H.fmtD(last.captured_on)}</div>` : '<div class="small muted mt-s">No numbers yet.</div>'}</div>`; }).join('')}</div>`;
    },
    importSocial() {
      H.form({ title: 'Update social numbers', intro: 'One line per platform: followers and reach for the last 7 days.', fields: [
        { id: 'date', label: 'As of', type: 'date', value: H.today(), required: true },
        { id: 'ig_f', label: 'Instagram followers', type: 'number', half: true }, { id: 'ig_r', label: 'Instagram reach (7 days)', type: 'number', half: true },
        { id: 'fb_f', label: 'Facebook followers', type: 'number', half: true }, { id: 'fb_r', label: 'Facebook reach (7 days)', type: 'number', half: true },
        { id: 'tt_f', label: 'TikTok followers', type: 'number', half: true }, { id: 'tt_r', label: 'TikTok views (7 days)', type: 'number', half: true },
      ], onSubmit: async v => {
        const rows = [['instagram', v.ig_f, v.ig_r], ['facebook', v.fb_f, v.fb_r], ['tiktok', v.tt_f, v.tt_r]].filter(x => x[1] != null || x[2] != null).map(([platform, followers, reach]) => ({ platform, captured_on: v.date, followers, reach, source: 'Entered', pulled_at: new Date().toISOString() }));
        if (rows.length) await H.db.upsert('social_stats', rows, 'platform,captured_on');
        H.toast('Updated'); this.render(document.getElementById('marketingApp'));
      } });
    },

    // ── assets & ideas ──
    async tab_assets(body) {
      const [assets, ideas] = await Promise.all([H.db.list('marketing_assets', { order: 'created_at', asc: false, cache: false }), H.db.list('marketing_ideas', { order: 'votes', asc: false, cache: false })]);
      if (assets === null) { body.innerHTML = ''; return H.missingTable(body, 'marketing_assets'); }
      const KC = { photo: ['#E8D5F7', 'Photo'], template: ['#DCD3FB', 'Template'], video: ['#FAD9C8', 'Video'], guide: ['#D3E3FB', 'Guide'], logo: ['#D6F0E0', 'Logo'] };
      body.innerHTML = `<div class="split">
        <div><div class="between mb"><div class="section-label" style="margin:0">Assets</div><button class="btn btn-sm btn-primary" onclick="H.pages.marketing.addAsset()">Upload</button></div>
          <div class="grid g3">${assets.map(a => `<a href="${H.esc(a.url || '#')}" target="_blank" rel="noopener" class="card" style="overflow:hidden;text-decoration:none;color:inherit;display:block">
            <div style="height:88px;background:${(KC[a.kind] || ['#EEE'])[0]};display:flex;align-items:center;justify-content:center">${a.thumb_url ? `<img src="${H.esc(a.thumb_url)}" alt="" style="width:100%;height:100%;object-fit:cover"/>` : `<span class="ico" style="background:rgba(255,255,255,.6)">${H.svg('image')}</span>`}</div>
            <div style="padding:10px 12px"><div class="strong small">${H.esc(a.title)}</div><div class="small muted">${(KC[a.kind] || ['', a.kind])[1]} · ${H.esc(H.shortName(a.added_by || ''))} · ${H.fmtD(H.isoOfTs(a.created_at))}</div></div></a>`).join('') || '<div class="list" style="grid-column:1/-1"><div class="li-empty">Upload photos, templates and guides your team reuses.</div></div>'}</div></div>
        <div class="card card-pad"><div class="section-label">Ideas from the team</div>
          <div class="stack" style="gap:8px">${(ideas || []).map(i => `<div class="row" style="align-items:flex-start;border-top:1px solid #F0F0F2;padding-top:8px"><button class="btn btn-sm" style="flex-direction:column;gap:0;padding:3px 8px;min-width:36px" onclick="H.pages.marketing.vote('${i.id}')" aria-label="Upvote">▲<span class="small">${i.votes || 0}</span></button>
            <div style="min-width:0;flex:1"><div class="small" style="color:var(--text)">${H.esc(i.text)}</div><div class="small muted">${H.esc(H.shortName(i.added_by || ''))}</div></div>${i.status === 'doing' ? '<span class="pill green">Doing it</span>' : canApprove() ? `<button class="btn btn-sm btn-ok-quiet" onclick="H.pages.marketing.doIdea('${i.id}')">Do it</button>` : ''}</div>`).join('') || '<div class="small muted">No ideas yet.</div>'}</div>
          <form class="row mt" onsubmit="event.preventDefault();H.pages.marketing.addIdea(this.idea.value);this.reset()"><input name="idea" class="sel" style="flex:1" placeholder="Share an idea" aria-label="Share an idea"/><button class="btn btn-sm">Add</button></form></div>
      </div>`;
    },
    addAsset() {
      H.form({ title: 'Upload an asset', fields: [
        { id: 'title', label: 'Title', required: true, half: true },
        { id: 'kind', label: 'Type', type: 'select', half: true, options: [{ value: 'photo', label: 'Photo' }, { value: 'template', label: 'Template' }, { value: 'video', label: 'Video' }, { value: 'guide', label: 'Guide' }, { value: 'logo', label: 'Logo' }] },
        { id: 'file', label: 'File', type: 'file' },
        { id: 'url', label: 'Or a link (Canva, Google Drive…)', type: 'url' },
      ], submit: 'Save', onSubmit: async v => {
        let url = v.url; let thumb = null;
        if (v.file) { url = await uploadFile(v.file, 'assets'); if (/^image\//.test(v.file.type)) thumb = url; }
        if (!url) throw new Error('Add a file or a link');
        await H.db.insert('marketing_assets', { title: v.title, kind: v.kind, url, thumb_url: thumb, added_by: H.who() });
        H.toast('Saved'); this.render(document.getElementById('marketingApp'));
      } });
    },
    async addIdea(text) { if (!String(text || '').trim()) return; await H.db.insert('marketing_ideas', { text: text.trim(), votes: 1, status: 'new', added_by: H.who() }); this.render(document.getElementById('marketingApp')); },
    async vote(id) { const i = (await H.db.list('marketing_ideas', { cache: false })).find(x => x.id === id); await H.db.update('marketing_ideas', id, { votes: (i.votes || 0) + 1 }); this.render(document.getElementById('marketingApp')); },
    async doIdea(id) { await H.db.update('marketing_ideas', id, { status: 'doing' }); this.render(document.getElementById('marketingApp')); },

    // ── dashboard hooks ──
    async count() { const p = await H.db.list('marketing_posts'); if (!p) return null; const c = await H.db.list('community_requests') || []; return { n: p.filter(x => x.status === 'waiting').length + c.filter(x => x.status === 'requested').length, alert: false }; },
  };

  function postPreview(p) {
    const thread = Array.isArray(p.comments) ? p.comments : [];
    return `<div class="card" style="overflow:hidden">
      ${p.image_url ? `<img src="${H.esc(p.image_url)}" alt="${H.esc(p.title)}" style="width:100%;max-height:300px;object-fit:cover;display:block"/>` : `<div style="height:140px;background:linear-gradient(135deg,#B5002A,#DD0033);display:flex;align-items:flex-end;padding:16px;color:#fff;font-weight:700;font-size:1.3rem">${H.esc(p.title)}</div>`}
      <div class="card-pad">
        <div class="between"><div class="strong">${H.esc(p.title)}</div><span class="pill ${POST_ST[p.status][1]}">${POST_ST[p.status][0]}</span></div>
        <div class="small muted">${p.scheduled_at ? H.fmtDT(p.scheduled_at) : 'No date'} · ${H.esc(chan(p.channels).join(' + '))} · uploaded by ${H.esc(H.shortName(p.uploaded_by || ''))}</div>
        <div class="label mt">Caption</div><div class="small" style="white-space:pre-wrap;margin-top:4px">${H.esc(p.caption || '')}</div>
        <div class="small muted mt-s">${(p.caption || '').length} characters</div>
        ${thread.length ? `<div class="label mt">Comments</div>${thread.map(c => `<div class="small" style="border-left:2px solid var(--border);padding:4px 0 4px 10px;margin-top:6px"><strong>${H.esc(H.shortName(c.by))}</strong> <span class="muted">${H.fmtDT(c.at)}</span><div>${H.esc(c.text)}</div></div>`).join('')}` : ''}
        ${canApprove() && ['waiting', 'changes'].includes(p.status) ? `<div class="field mt"><label for="mkComment">Comment (needed to ask for changes or deny)</label><textarea id="mkComment" placeholder="e.g. Use the photo from Family Night instead"></textarea></div>
          <div class="row mt-s" style="flex-wrap:wrap"><button class="btn btn-green" onclick="H.pages.marketing.decide('${p.id}','approved')">Approve</button><button class="btn" onclick="H.pages.marketing.decide('${p.id}','changes')">Request changes</button><button class="btn btn-ghost" onclick="H.pages.marketing.decide('${p.id}','denied')">Deny</button></div>` : ''}
        ${p.status === 'approved' ? `<button class="btn btn-sm mt" onclick="H.pages.marketing.decide('${p.id}','posted')">Mark as posted</button>` : ''}
      </div></div>`;
  }
  function calItems(ev, posts, comm) {
    const out = [];
    ev.forEach(e => { let d = e.starts_on; const end = e.ends_on || e.starts_on; let guard = 0; while (d <= end && guard++ < 62) { out.push({ date: d, kind: e.kind === 'campaign' ? 'campaign' : 'event', title: e.title, sub: [e.details, e.owner && 'Owner: ' + e.owner].filter(Boolean).join(' · '), del: e.id }); if (e.kind === 'campaign') break; d = H.addDays(d, 1); } });
    posts.filter(p => p.scheduled_at && ['approved', 'waiting', 'posted', 'changes'].includes(p.status)).forEach(p => out.push({ date: H.isoOfTs(p.scheduled_at), kind: 'post', title: p.title, sub: `${H.fmtTime(p.scheduled_at)} · ${POST_ST[p.status][0]}` }));
    comm.filter(c => ['approved', 'done', 'requested'].includes(c.status)).forEach(c => out.push({ date: c.event_on, kind: 'community', title: c.org, sub: `${COMM_KIND[c.kind] || ''}${c.time_window ? ' · ' + c.time_window : ''} · ${COMM_ST[c.status][0]}` }));
    return out;
  }

  // ═════════════ REPUTACIÓN ═════════════
  const RP = { filter: 'all' };
  const PLAT = {
    google: { name: 'Google', kind: 'rating', color: '#4285F4' },
    uber_eats: { name: 'Uber Eats', kind: 'rating', color: '#06C167' },
    smg: { name: 'SMG CEM', kind: 'score', color: '#DD0033' },
    doordash: { name: 'DoorDash', kind: 'rating', color: '#FF3008' },
    facebook: { name: 'Facebook', kind: 'rating', color: '#1877F2' },
  };
  async function rpLoad() {
    const [snaps, reviews] = await Promise.all([H.db.list('rep_snapshots', { order: 'captured_on' }), H.db.list('rep_reviews', { order: 'review_date', asc: false })]);
    return { snaps, reviews };
  }
  H.pages.reputation = {
    async render(host) {
      host.innerHTML = `<div class="ph"><div><h2>Reputación</h2><p>Ratings and guest comments from every platform in one place. Google updates live; the others update when Claude pulls them.</p></div>
        <div class="actions"><button class="btn" onclick="H.pages.reputation.importRows()">Update from Claude</button><button class="btn btn-primary" id="rpRefresh" onclick="H.pages.reputation.refreshGoogle()">Actualizar Google</button></div></div><div id="rpBody"><div class="li-empty">Loading…</div></div>`;
      const { snaps, reviews } = await rpLoad();
      const body = document.getElementById('rpBody'); if (!body) return;
      if (snaps === null) { body.innerHTML = ''; return H.missingTable(body, 'rep_snapshots'); }
      const latest = {}; const series = {};
      snaps.forEach(s => { latest[s.platform] = s; (series[s.platform] ||= []).push(s); });
      const show = Object.keys(PLAT).filter(p => latest[p] || ['google', 'uber_eats', 'smg'].includes(p));
      const since = H.addDays(H.today(), -30);
      const recent = (reviews || []).filter(r => r.review_date >= since);
      const shown = recent.filter(r => RP.filter === 'all' || (RP.filter === 'low' ? (r.rating != null && r.rating <= 3) : r.platform === RP.filter));
      body.innerHTML = `
        <div class="kpis">${show.map(p => { const s = latest[p]; const meta = PLAT[p]; const prev = (series[p] || []).filter(x => x.captured_on <= H.addDays(s ? s.captured_on : H.today(), -28)).pop();
          const val = !s ? '—' : meta.kind === 'score' ? (s.score != null ? H.pct(s.score, 1) : '—') : (s.rating != null ? (+s.rating).toFixed(1) : '—');
          const d = s && prev ? (meta.kind === 'score' ? (s.score - prev.score) : (s.rating - prev.rating)) : null;
          return `<div class="kpi" style="border-top:3px solid ${meta.color}"><div class="kpi-label">${meta.name}</div><div class="kpi-val">${val}${meta.kind === 'rating' && s ? ' <small class="stars">★</small>' : ''}</div>
            <div class="kpi-sub">${!s ? 'Not pulled yet' : meta.kind === 'score' ? `OSAT · ${s.review_count ? H.num(s.review_count) + ' surveys' : 'last 30 days'}` : `${H.num(s.review_count)} reviews`}${d != null && Math.abs(d) >= 0.05 ? ` · <span style="color:${d >= 0 ? 'var(--ok)' : 'var(--bad)'};font-weight:600">${d >= 0 ? '+' : ''}${d.toFixed(1)}</span> in 4 wks` : ''}</div>
            <div class="small muted" style="margin-top:2px">${s ? 'as of ' + H.fmtD(s.captured_on) : ''}</div></div>`; }).join('')}</div>
        ${latest.smg ? `<div class="card card-pad mb"><div class="section-label">SMG CEM · last 30 days</div><div class="grid g4" style="gap:10px">${[['Overall satisfaction', 'score'], ['Taste', 'taste'], ['Speed', 'speed'], ['Order accuracy', 'accuracy']].map(([l, k]) => { const v = k === 'score' ? latest.smg.score : (latest.smg.details || {})[k]; return `<div><div class="label">${l}</div><div class="strong" style="font-size:1.25rem;color:${v != null && v < 70 ? 'var(--bad)' : 'var(--text)'}">${v != null ? H.pct(v, 1) : '—'}</div></div>`; }).join('')}</div></div>` : ''}
        <div class="split">
          <div><div class="between mb"><div class="section-label" style="margin:0">Guest comments · last 30 days <span class="muted" style="text-transform:none;letter-spacing:0">(${recent.length})</span></div></div>
            <div class="chips">${[['all', 'All'], ['low', '3 stars or less'], ...Object.keys(PLAT).filter(p => recent.some(r => r.platform === p)).map(p => [p, PLAT[p].name])].map(([k, l]) => `<button class="chip ${RP.filter === k ? 'active' : ''}" onclick="H.pages.reputation.setFilter('${k}')">${l}</button>`).join('')}</div>
            <div class="list">${shown.slice(0, 25).map(r => `<div class="li" style="grid-template-columns:30px minmax(0,1fr) auto;align-items:flex-start">
              ${H.icon('star', r.rating != null && r.rating <= 3 ? 'red' : 'green')}
              <div style="min-width:0"><div class="row" style="gap:8px;flex-wrap:wrap"><span class="stars">${r.rating != null ? '★'.repeat(Math.round(r.rating)) + '<span style="color:#DDD">' + '★'.repeat(5 - Math.round(r.rating)) + '</span>' : ''}</span><span class="li-title" style="font-size:.84rem">${H.esc(r.author || 'Guest')}</span><span class="small muted">${PLAT[r.platform] ? PLAT[r.platform].name : H.esc(r.platform)} · ${H.fmtD(r.review_date)}</span></div>
                <div class="small" style="color:var(--text-mid);margin-top:3px">${H.esc(r.text || '')}</div>
                ${r.reply ? `<div class="small" style="border-left:2px solid var(--border);padding-left:8px;margin-top:6px"><strong>Your reply:</strong> ${H.esc(r.reply)}</div>` : ''}</div>
              ${r.url ? `<a class="btn btn-sm" href="${H.esc(r.url)}" target="_blank" rel="noopener">${r.platform === 'google' && !r.reply ? 'Reply' : 'Open'}</a>` : '<span></span>'}</div>`).join('') || '<div class="li-empty">No comments in the last 30 days.</div>'}</div></div>
          <div class="card card-pad"><div class="section-label">Rating history</div>${['google', 'uber_eats'].filter(p => (series[p] || []).length > 1).map(p => `<div class="between small" style="padding:8px 0;border-top:1px solid #F0F0F2"><span>${PLAT[p].name}</span>${H.spark(series[p].map(x => +x.rating), PLAT[p].color)}</div>`).join('')}
            ${(series.smg || []).length > 1 ? `<div class="between small" style="padding:8px 0;border-top:1px solid #F0F0F2"><span>SMG OSAT</span>${H.spark(series.smg.map(x => +x.score), PLAT.smg.color)}</div>` : ''}
            <div class="small muted mt-s">Each update adds a point, so trends build up over time.</div></div>
        </div>`;
    },
    setFilter(k) { RP.filter = k; this.render(document.getElementById('reputationApp')); },
    async kpi() {
      const { snaps } = await rpLoad(); if (!snaps || !snaps.length) return null;
      const g = snaps.filter(s => s.platform === 'google').pop(); const smg = snaps.filter(s => s.platform === 'smg').pop();
      if (smg && smg.score != null) return { label: 'SMG OSAT · 30 days', val: H.pct(smg.score, 1), cls: smg.score >= 75 ? 'ok' : 'bad', sub: g ? `Google ${(+g.rating).toFixed(1)} ★` : '' };
      if (g) return { label: 'Google rating', val: `${(+g.rating).toFixed(1)} <small class="stars">★</small>`, sub: `${H.num(g.review_count)} reviews` };
      return null;
    },
    async refreshGoogle() {
      const btn = document.getElementById('rpRefresh'); if (btn) { btn.disabled = true; btn.textContent = 'Actualizando…'; }
      try {
        const res = await fetch('https://places.googleapis.com/v1/places:searchText', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': GOOGLE_API_KEY, 'X-Goog-FieldMask': 'places.id,places.rating,places.userRatingCount,places.reviews,places.googleMapsUri' }, body: JSON.stringify({ textQuery: GOOGLE_PLACE_QUERY, maxResultCount: 1, languageCode: 'es' }) });
        const data = await res.json(); const p = data.places && data.places[0];
        if (!p) throw new Error('Google did not return the restaurant');
        await H.db.upsert('rep_snapshots', [{ platform: 'google', captured_on: H.today(), rating: p.rating, review_count: p.userRatingCount, source: 'Google Places API', pulled_at: new Date().toISOString() }], 'platform,captured_on');
        const revs = (p.reviews || []).map(r => ({ platform: 'google', external_id: r.name, author: r.authorAttribution && r.authorAttribution.displayName, rating: r.rating, text: (r.text && r.text.text) || (r.originalText && r.originalText.text) || '', review_date: (r.publishTime || '').slice(0, 10) || H.today(), url: r.googleMapsUri || p.googleMapsUri || null }));
        if (revs.length) await H.db.upsert('rep_reviews', revs, 'platform,external_id');
        H.toast(`Google updated · ${p.rating} ★`);
      } catch (e) { H.toast('Google update failed: ' + e.message); }
      this.render(document.getElementById('reputationApp')); hubRefreshCounts();
    },
    importRows() {
      H.modal(`<h3>Update ratings from Claude</h3><p class="muted small" style="margin:-10px 0 14px">Paste what Claude pulled from SMG, Uber Eats or DoorDash. Ratings go in the first box, guest comments in the second.</p>
        <div class="field"><label for="rpSnap">Ratings (CSV: platform,date,rating,review_count,score,taste,speed,accuracy)</label><textarea id="rpSnap" style="height:90px;font-family:ui-monospace,Menlo,monospace;font-size:.78rem" placeholder="smg,2026-10-13,,412,78.4,81.2,72.5,88.0&#10;uber_eats,2026-10-13,4.7,1820"></textarea></div>
        <div class="field mt"><label for="rpRev">Comments (CSV: platform,date,rating,author,text)</label><textarea id="rpRev" style="height:110px;font-family:ui-monospace,Menlo,monospace;font-size:.78rem" placeholder="smg,2026-10-12,2,Guest,&quot;Fries were cold on a mobile order pickup&quot;"></textarea></div>
        <details class="mt"><summary class="small" style="cursor:pointer;font-weight:600">What to tell Claude</summary><div class="small" style="background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:10px 12px;margin-top:8px">Sign in to SMG 360 and copy the last 30 days of Overall Satisfaction, Taste, Speed of Service and Order Accuracy (% top box) with the survey count, plus every guest comment with its date and score. Open the Uber Eats Manager and copy the store rating and number of ratings. Then open losfiltroshub.com → Reputación → Update from Claude and paste them in the CSV formats shown.</div></details>
        <div id="rpErr" class="small mt-s"></div>
        <div class="mfooter"><button class="btn" onclick="H.closeModal()">Cancel</button><button class="btn btn-primary" id="rpSave">Save</button></div>`, true);
      document.getElementById('rpSave').onclick = async () => {
        const err = document.getElementById('rpErr');
        try {
          const hdrS = 'platform,date,rating,review_count,score,taste,speed,accuracy\n', hdrR = 'platform,date,rating,author,text\n';
          const sTxt = document.getElementById('rpSnap').value.trim(), rTxt = document.getElementById('rpRev').value.trim();
          const sRows = sTxt ? H.parseRows(/^platform/i.test(sTxt) ? sTxt : hdrS + sTxt) : [];
          const rRows = rTxt ? H.parseRows(/^platform/i.test(rTxt) ? rTxt : hdrR + rTxt) : [];
          const norm = p => String(p || '').toLowerCase().replace(/\s+/g, '_').replace('ubereats', 'uber_eats').replace('cem', 'smg').replace('smg_smg', 'smg');
          const snaps = sRows.map(r => ({ platform: norm(r.platform), captured_on: H.toISO(r.date) || H.today(), rating: H.toNum(r.rating), review_count: H.toNum(r.review_count), score: H.toNum(r.score), details: { taste: H.toNum(r.taste), speed: H.toNum(r.speed), accuracy: H.toNum(r.accuracy) }, source: 'Pulled by Claude', pulled_at: new Date().toISOString() })).filter(r => r.platform);
          const revs = rRows.map(r => ({ platform: norm(r.platform), review_date: H.toISO(r.date) || H.today(), rating: H.toNum(r.rating), author: r.author || null, text: r.text || '', external_id: `${norm(r.platform)}:${H.toISO(r.date)}:${String(r.text || '').slice(0, 60)}` })).filter(r => r.platform && r.text);
          if (!snaps.length && !revs.length) throw new Error('Nothing to save. Check the format.');
          if (snaps.length) await H.db.upsert('rep_snapshots', snaps, 'platform,captured_on');
          if (revs.length) await H.db.upsert('rep_reviews', revs, 'platform,external_id');
          H.closeModal(); H.toast(`Saved ${snaps.length} rating${snaps.length === 1 ? '' : 's'} and ${revs.length} comment${revs.length === 1 ? '' : 's'}`); this.render(document.getElementById('reputationApp')); hubRefreshCounts();
        } catch (e) { err.innerHTML = `<span style="color:var(--bad)">${H.esc(e.message)}</span>`; }
      };
    },
  };

  // ═════════════ DATA SOURCES (dashboard panel) ═════════════
  H.renderSources = async host => {
    if (!host) return;
    const vis = H.visible();
    const rows = [];
    const ageTxt = iso => { if (!iso) return ['Never', 'red']; const d = H.daysBetween(iso, H.today()); return [d <= 0 ? 'Today' : d === 1 ? 'Yesterday' : `${d} days ago`, d <= 2 ? 'green' : d <= 7 ? 'amber' : 'red']; };
    if (vis.includes('foodcost')) { const f = await H.db.list('food_cost_periods') || []; const pulled = f.map(x => x.pulled_at).filter(Boolean).sort().pop(); const lastM = f.map(x => x.period_start).sort().pop(); rows.push(['Food cost', `cfahome · Food Cost Report${lastM ? ' · through ' + H.monthLabel(lastM.slice(0, 7), true) : ''}`, H.isoOfTs(pulled), 'foodcost']); }
    if (vis.includes('productivity')) { const p = await H.db.list('productivity_days') || []; const pulled = p.map(x => x.pulled_at).filter(Boolean).sort().pop(); const lastD = p.map(x => x.day).sort().pop(); rows.push(['Productivity', `cfahome · Analytics Hub${lastD ? ' · through ' + H.fmtD(lastD) : ''}`, H.isoOfTs(pulled) || lastD, 'productivity']); }
    const mLast = async (metric, label, src, go) => { const r = H.metricRows ? await H.metricRows(metric, H.addDays(H.today(), -120)) : null; if (!r) return; const mr = r.filter(x => x.metric === metric), last = mr.map(x => x.on_date).sort().pop(), monthly = mr.some(x => x.grain === 'month'); rows.push([label, `${src}${last ? ' · through ' + (monthly ? H.monthLabel(last.slice(0, 7), true) : H.fmtD(last)) : ''}`, H.isoOfTs(r.map(x => x.pulled_at).filter(Boolean).sort().pop()), go]); };
    if (vis.includes('sales')) await mLast('sales:drive_thru', 'Sales by channel', 'cfahome · Sales Analytics', 'sales');
    if (vis.includes('pl')) { const p = await H.db.list('pl_months') || []; const lastM = p.map(x => x.period_start).sort().pop(); rows.push(['Monthly P&L', `cfahome · Management Tool${lastM ? ' · through ' + H.monthLabel(lastM.slice(0, 7), true) : ''}`, H.isoOfTs(p.map(x => x.pulled_at).filter(Boolean).sort().pop()), 'pl']); }
    if (vis.includes('quality')) await mLast('sos:drive_thru:total_sec', 'Speed of service & AHA', 'cfahome · Analytics Hub', 'quality');
    if (vis.includes('cash')) await mLast('cash:discounts:pctile', 'Cash risk', 'cfahome · Cash Management Risk', 'cash');
    if (vis.includes('reputation')) { const s = await H.db.list('rep_snapshots') || []; for (const [k, n, src] of [['smg', 'SMG CEM scores', 'SMG 360'], ['uber_eats', 'Uber Eats rating', 'Uber Eats Manager'], ['google', 'Google rating', 'Google · live']]) { const l = s.filter(x => x.platform === k).map(x => x.captured_on).sort().pop(); rows.push([n, src, l, 'reputation']); } }
    if (!rows.length) { host.innerHTML = ''; return; }
    host.innerHTML = `<div class="section-label" style="margin-top:24px">How fresh your numbers are <a href="#" onclick="H.claudeUpdate();return false">Update with Claude</a></div>
      <div class="list">${rows.map(([n, src, iso, go]) => { const [t, c] = ageTxt(iso); return `<div class="li click" onclick="goTab('${go}')">${H.icon('import', c === 'green' ? 'green' : c === 'amber' ? 'amber' : 'red')}<div><div class="li-title">${H.esc(n)}</div><div class="li-sub">${H.esc(src)}</div></div><span class="pill ${c}">${iso ? 'Updated ' + t.toLowerCase() : 'Never updated'}</span></div>`; }).join('')}</div>`;
  };
  // ═════════════ UPDATE WITH CLAUDE ═════════════
  // One engine for the "Update with Claude" button, the /update shortcut in Claude in Chrome and the
  // scheduled pull. The hub works out exactly which periods each page is missing; the instructions
  // Claude follows live in the prompt/shortcut (the page only supplies the list).
  const OPEN_MONTH = '2026-04';                     // Pertenecen LLC took over Los Filtros on Apr 1, 2026
  const OPEN_DAY = OPEN_MONTH + '-01';
  const addMonths = H.addMonths;
  const monthRange = (a, b) => { const out = []; for (let k = a; k <= b; k = addMonths(k, 1)) out.push(k); return out; };
  const toRanges = days => { const out = []; for (const d of days) { const l = out[out.length - 1]; if (l && H.addDays(l[1], 1) === d) l[1] = d; else out.push([d, d]); } return out; };
  const nextOpen = d => { let x = d; for (let i = 0; i < 4 && H.storeClosed(x); i++) x = H.addDays(x, 1); return x; };
  const mergeClosed = rs => rs.reduce((out, r) => { const l = out[out.length - 1]; if (l && nextOpen(H.addDays(l[1], 1)) === r[0]) l[1] = r[1]; else out.push([...r]); return out; }, []);
  const longD = H.longD;
  const rangeTxt = ([a, b]) => a === b ? longD(a) : `${longD(a)} to ${longD(b)}`;
  const rangesIso = rs => rs.map(([a, b]) => a === b ? a : `${a} to ${b}`).join('; ');
  const missingDays = (have, from, to) => { const miss = []; for (let d = from; d <= to; d = H.addDays(d, 1)) if (!have.has(d) && !H.storeClosed(d)) miss.push(d); return miss; };
  const monthsTxt = ks => { const runs = []; for (const k of ks) { const l = runs[runs.length - 1]; if (l && addMonths(l[1], 1) === k) l[1] = k; else runs.push([k, k]); } return runs.map(([a, b]) => a === b ? H.monthLabel(a) : `${H.monthLabel(a)} – ${H.monthLabel(b)}`).join(', '); };
  const metricDates = async (metric, from) => { const rows = H.metricRows ? await H.metricRows(metric, from) : []; return rows === null ? null : rows.filter(r => r.metric === metric); };

  // How Claude gets each kind of data (paths from the cfahome data source map, Oct 14 2026)
  const HOW = {
    foodcost: `FOOD COST. cfahome → Reports and Tools → Chick-fil-A Report Galleries → Financial tab → Target Food Cost Report (PDF) for each listed month: actual food cost %, target food cost % (put it in theoretical_pct), beginning inventory $, purchases $, ending inventory $, waste $, employee meals $, promo $. Total sales for the month come from the Management Tool (Management tab). For 2025 months (before Pertenecen LLC), the LLC reports show 0; use Analytics Hub → Financial Stewardship → Food Cost Gap Trend or the International Restaurant Data Report, and if a month's actual food cost % isn't there, skip it and say so.
   Hub: Food cost → Update from cfahome. Header: month,sales,food_cost_pct,theoretical_pct,beginning_inventory,purchases,ending_inventory,waste,employee_meals,promo (month as YYYY-MM, numbers only). Check rows.`,
    pl: `MONTHLY P&L. cfahome → Reports and Tools → Chick-fil-A Report Galleries → Management tab → Management Tool, current-month (CM) column for each listed month. Dollars for Sales, Food, Paper, Talent Investment, Utilities, Marketing, R&M, Insurance, Financial Fees, Other Taxes, CFA PR LLC Fees, Misc, Net Profit.
   Hub: Monthly P&L → Update from cfahome. Header: month,sales,food,paper,talent,utilities,marketing,repairs,insurance,financial_fees,other_taxes,cfa_fees,misc,net_profit. Check rows.`,
    productivity: `PRODUCTIVITY. cfahome → Analytics Hub → Talent → Labor Productivity Analytics (day grain, table view) for sales, labor hours, labor cost; Sales & Brand Growth → Sales Analytics for forecast, same-day-last-year sales and transactions; Talent → Actual vs Scheduled Labor Hours for scheduled hours. Tableau dashboards have Download → CSV if copying is slow.
   Hub: Productivity → Update from cfahome. Header: date,sales,forecast_sales,last_year_sales,labor_hours,last_year_labor_hours,labor_cost,overtime_hours,transactions,scheduled_hours (date as YYYY-MM-DD). Check rows.`,
    sales: `SALES BY CHANNEL. cfahome → Analytics Hub → Sales & Brand Growth → Sales Analytics, day grain, by channel (Dine In, Drive Thru, Carry Out, 3PD, Catering) and by source (POS, Mobile, Web, ExtPOS), with last year.
   Hub: Sales → Update from cfahome. Header: date,channel,sales,transactions,ly_sales,ly_transactions (one row per day per channel or source). Check rows.`,
    quality: `SPEED & QUALITY. Analytics Hub → Customer Experience → Speed of Service (drive-thru and front counter, day grain): orders, total, line, order and fulfillment time. AHA Dashboard (aha.smartrest.cfahome.com): daily usage, hold %, target zone %, stock-out %. Smart Shop: monthly index, the five category scores and the chain average. Operations Hub → Report: the latest food safety audit round and level.
   Hub: Speed & quality → Update from cfahome, pick the kind, paste in the format shown there. Check rows.`,
    cash: `CASH. Analytics Hub → Financial Stewardship → Cash Management Risk (rolling 3 months): amount and peer percentile for discounts/promo-free, refunds, corrections, change fund, payouts, cash over/short. Daily Restaurant Deposit Activity Alerts: each alert's date, type, amount, note.
   Hub: Cash → Update from cfahome (header month,item,amount,percentile) and Add deposit alerts (header date,type,amount,note).`,
    retention: `RETENTION. Analytics Hub → Talent → Retention & Turnover Report: for each listed month, retention %, turnover %, past-12-months turnover %, hires, exits, headcount. Totals only, no names.
   Hub: Staffing → Retention & turnover → Update. Header: month,retention_pct,turnover_pct,turnover_p12_pct,hires,exits,headcount.`,
    reputation: `RATINGS. SMG 360 (separate login), last 30 days: Overall Satisfaction, Taste, Speed of Service, Order Accuracy (% top box) and the survey count, plus every guest comment with its date and score. Uber Eats Manager: store rating and number of ratings.
   Hub: Reputación → Update from Claude, paste in the formats shown, Save. For Google, click Actualizar Google.`,
    events: `EVENTS NEAR THE STORE. Analytics Hub → Sales & Brand Growth → Events Around Your Restaurant: every event in the next 60 days within 10 miles (date, end date, name, venue, expected attendance).
   Hub: Calendar → Import events. Header: date,end_date,title,notes.`,
    news: `NEWS. Search the web for news from the last 14 days that could affect the store (Avenida Los Filtros, Bayamón/Guaynabo): LUMA outages, AAA water interruptions, road work and closures, new businesses, PR labor/economy news for restaurants, Chick-fil-A company news, storms.
   Hub: Home → Add a story, paste a JSON list with published_on, title, source, url, category (luma, aaa, construction, local, business, cfa, weather), severity (act, watch, info), starts_on, ends_on, impact (one sentence: why it matters for the store).`,
  };

  H.claudeNeeds = async () => {
    const vis = H.visible(), today = H.today(), yesterday = H.addDays(today, -1), lastClosed = addMonths(today.slice(0, 7), -1);
    const closedMonths = lastClosed >= OPEN_MONTH ? monthRange(OPEN_MONTH, lastClosed) : [];
    const items = [];
    const push = (key, label, list, status, sub) => items.push({ key, label, list, status, sub, need: !!list });
    if (vis.includes('foodcost')) {
      const rows = await H.db.list('food_cost_periods', { cache: false });
      if (rows) {
        const have = new Map(rows.filter(r => r.period_type === 'month').map(r => [H.monthKey(r.period_start), r]));
        const want = new Set(), ly = new Set();
        for (const k of closedMonths) {
          const r = have.get(k);
          if (!r || (r.pulled_at && H.isoOfTs(r.pulled_at) <= r.period_end)) want.add(k);
          const l = addMonths(k, -12); if (!have.has(l)) ly.add(l);
        }
        const all = [...want, ...ly].sort();
        push('foodcost', 'Food cost', all.length ? `FOOD COST months: ${all.join(', ')}` : null, all.length ? `${all.length} month${all.length === 1 ? '' : 's'}` : 'Up to date',
          all.length ? [want.size ? monthsTxt([...want].sort()) : '', ly.size ? `${monthsTxt([...ly].sort())} <span class="muted">(last year, for comparison)</span>` : ''].filter(Boolean).join('; ') : `Through ${H.monthLabel([...have.keys()].sort().pop() || lastClosed, true)}`);
      }
    }
    if (vis.includes('pl')) {
      const rows = await H.db.list('pl_months', { cache: false });
      if (rows) { const have = new Set(rows.map(r => H.monthKey(r.period_start))); const miss = closedMonths.filter(k => !have.has(k));
        push('pl', 'Monthly P&L', miss.length ? `P&L months: ${miss.join(', ')}` : null, miss.length ? `${miss.length} month${miss.length === 1 ? '' : 's'}` : 'Up to date', miss.length ? monthsTxt(miss) : 'Every closed month is in'); }
    }
    if (vis.includes('productivity')) {
      const rows = await H.db.list('productivity_days', { cache: false });
      if (rows) { const miss = missingDays(new Set(rows.map(r => r.day)), OPEN_DAY, yesterday), rs = mergeClosed(toRanges(miss));
        push('productivity', 'Productivity', miss.length ? `PRODUCTIVITY days (${miss.length}, Sundays and closed holidays left out): ${rangesIso(rs)}` : null, miss.length ? `${miss.length} day${miss.length === 1 ? '' : 's'}` : 'Up to date',
          miss.length ? H.esc(rs.slice(0, 3).map(rangeTxt).join('; ')) + (rs.length > 3 ? ` and ${rs.length - 3} more` : '') : 'Through yesterday'); }
    }
    if (vis.includes('sales')) {
      const rows = await metricDates('sales:drive_thru', OPEN_DAY);
      if (rows) { const miss = missingDays(new Set(rows.map(r => r.on_date)), OPEN_DAY, yesterday), rs = mergeClosed(toRanges(miss));
        push('sales', 'Sales by channel', miss.length ? `SALES BY CHANNEL days (${miss.length}): ${rangesIso(rs)}` : null, miss.length ? `${miss.length} day${miss.length === 1 ? '' : 's'}` : 'Up to date',
          miss.length ? H.esc(rs.slice(0, 3).map(rangeTxt).join('; ')) + (rs.length > 3 ? ` and ${rs.length - 3} more` : '') : 'Through yesterday'); }
    }
    if (vis.includes('quality')) {
      const sosFrom = [OPEN_DAY, H.addDays(today, -90)].sort().pop(), ahaFrom = H.addDays(today, -30);
      const [sos, aha, ss, au] = await Promise.all([metricDates('sos:drive_thru:total_sec', sosFrom), metricDates('aha:usage', ahaFrom), metricDates('smartshop:index'), metricDates('audit:level')]);
      if (sos) {
        const sMiss = missingDays(new Set(sos.map(r => r.on_date)), sosFrom, yesterday), aMiss = missingDays(new Set((aha || []).map(r => r.on_date)), ahaFrom, yesterday);
        const ssHave = new Set((ss || []).map(r => H.monthKey(r.on_date))), ssMiss = monthRange(addMonths(lastClosed, -5), lastClosed).filter(k => !ssHave.has(k));
        const lastAudit = (au || []).map(r => r.on_date).sort().pop();
        const parts = [];
        if (sMiss.length) parts.push(`speed of service days ${rangesIso(mergeClosed(toRanges(sMiss)))}`);
        if (aMiss.length) parts.push(`AHA days ${rangesIso(mergeClosed(toRanges(aMiss)))}`);
        if (ssMiss.length) parts.push(`Smart Shop months ${ssMiss.join(', ')}`);
        parts.push(lastAudit ? `food safety audit: only if there is a round after ${lastAudit}` : 'food safety audit: the latest round');
        const realNeed = sMiss.length || aMiss.length || ssMiss.length;
        push('quality', 'Speed & quality', `SPEED & QUALITY: ${parts.join('; ')}`, realNeed ? [sMiss.length && `${sMiss.length} SOS days`, aMiss.length && `${aMiss.length} AHA days`, ssMiss.length && `${ssMiss.length} Smart Shop`].filter(Boolean).join(' · ') : 'Up to date',
          realNeed ? H.esc(parts.slice(0, -1).join('; ')) : `Audit check${lastAudit ? ` after ${longD(lastAudit)}` : ''}`);
        if (!realNeed) items[items.length - 1].light = true;
      }
    }
    if (vis.includes('cash')) {
      const [risk, dep] = await Promise.all([metricDates('cash:discounts:pctile', OPEN_DAY), H.metricRows ? H.metricRows('deposit:', H.addDays(today, -30)) : []]);
      if (risk) { const have = new Set(risk.map(r => H.monthKey(r.on_date))), miss = closedMonths.filter(k => !have.has(k)).slice(-3);
        const lastDep = (dep || []).map(r => r.on_date).sort().pop(), depFrom = lastDep ? H.addDays(lastDep, 1) : H.addDays(today, -14);
        const depDue = depFrom <= yesterday, parts = [];
        if (miss.length) parts.push(`Cash Management Risk for ${miss.join(', ')} (the latest rolling 3 months is enough if older ones aren't available)`);
        if (depDue) parts.push(`deposit alerts from ${depFrom} to ${yesterday}`);
        push('cash', 'Cash', parts.length ? `CASH: ${parts.join('; ')}` : null, miss.length ? `${miss.length} month${miss.length === 1 ? '' : 's'}` : depDue ? 'Alerts only' : 'Up to date', miss.length ? monthsTxt(miss) + (depDue ? ' + deposit alerts' : '') : depDue ? `Deposit alerts since ${longD(depFrom)}` : 'Risk and alerts are current');
        if (!miss.length && depDue) items[items.length - 1].light = true; }
    }
    if (vis.includes('staffing')) {
      const rows = await metricDates('retention:retention_pct', OPEN_DAY);
      if (rows) { const have = new Set(rows.map(r => H.monthKey(r.on_date))), miss = closedMonths.filter(k => !have.has(k));
        push('retention', 'Retention & turnover', miss.length ? `RETENTION months: ${miss.join(', ')}` : null, miss.length ? `${miss.length} month${miss.length === 1 ? '' : 's'}` : 'Up to date', miss.length ? monthsTxt(miss) : 'Every closed month is in'); }
    }
    if (vis.includes('reputation')) {
      const s = (await H.db.list('rep_snapshots', { cache: false })) || [];
      const last = p => s.filter(x => x.platform === p).map(x => x.captured_on).sort().pop() || null;
      const due = [['smg', 'SMG CEM'], ['uber_eats', 'Uber Eats'], ['google', 'Google']].filter(([k]) => last(k) !== today);
      const oldest = [last('smg'), last('uber_eats')].filter(Boolean).sort()[0];
      push('reputation', 'Ratings', due.length ? `RATINGS to refresh today (${today}): ${due.map(d => d[1]).join(', ')}` : null, due.length ? 'Refresh' : 'Today', due.length ? `${due.map(d => d[1]).join(', ')}${oldest ? ` · last pulled ${longD(oldest)}` : ''}` : 'Pulled today');
    }
    if (vis.includes('calendar')) {
      const cal = (await H.db.list('hub_calendar', { cache: false })) || [];
      const lastEv = cal.filter(e => e.source === 'cfahome Events').map(e => e.created_at).filter(Boolean).sort().pop();
      const due = !lastEv || Date.now() - new Date(lastEv).getTime() > 30 * 864e5;
      push('events', 'Events near the store', due ? `EVENTS near the store: ${today} to ${H.addDays(today, 60)}` : null, due ? 'Refresh' : 'Up to date', due ? 'Next 60 days, from Events Around Your Restaurant' : `Imported ${longD(H.isoOfTs(lastEv))}`);
    }
    if (vis.includes('home')) {
      const news = (await H.db.list('hub_news', { cache: false })) || [];
      const last = news.map(n => n.fetched_at).filter(Boolean).sort().pop();
      const due = !last || Date.now() - new Date(last).getTime() > 24 * 3600e3;
      push('news', 'News', due ? `NEWS: anything since ${last ? H.isoOfTs(last) : H.addDays(today, -14)}` : null, due ? 'Check' : 'Today', due ? (last ? `Last checked ${longD(H.isoOfTs(last))}` : 'Never checked') : 'Checked in the last day');
      if (due) items[items.length - 1].light = true;
    }
    return { today, items };
  };

  H.claudeList = n => n.items.map(i => i.list || `${i.label.toUpperCase()}: up to date, nothing to pull`).join('\n');
  H.claudeNothing = n => !n.items.some(i => i.need && !i.light);
  const RULES = `Rules:
- After Check rows, read what it says. If anything shows in red, do not Save that box; tell me what it said. Otherwise click Save.
- Check every date range in cfahome before copying: whole calendar months for monthly numbers, single days for daily numbers. Never copy a month-to-date or week total into a month or a day.
- Reports built on the LLC (Pertenecen, since Apr 1, 2026) show last year as 0. Take last-year numbers from location reports (Sales Analytics, Talent Investment Report, International Restaurant Data Report).
- If cfahome doesn't have a period, skip it and tell me. Don't copy team members' personal details, only totals.
- Only use the hub's import boxes. Don't change or delete anything else in the hub, and don't submit or approve anything in cfahome.
- When you're done, tell me what you added, what you skipped, and anything that looked off.`;
  H.claudePrompt = n => `Update my Los Filtros Hub (losfiltroshub.com) from cfahome and my other sites. Use the tabs I have open in Chrome; I'm already signed in.

What to pull (worked out by the hub just now):
${n.items.filter(i => i.need).map(i => '- ' + i.list).join('\n')}

How:
${n.items.filter(i => i.need).map(i => HOW[i.key]).filter(Boolean).join('\n')}

${RULES}`;
  H.claudeShortcut = `Update my Los Filtros Hub from cfahome and my other sites. Use my Chrome; I'm already signed in.

First, go to the losfiltroshub.com tab (if it isn't open, open https://losfiltroshub.com/#update). If the "Update with Claude" panel isn't showing, click "Update with Claude" at the top right. Read the box called "Exact list for Claude". That is everything to pull; do only the lines that list something. If everything says up to date, stop and tell me.

How, for each kind of line:
${Object.values(HOW).join('\n')}

${RULES}`;

  H.claudeUpdate = async () => {
    H.modal(`<h3>Update with Claude</h3><div id="cuBody"><div class="li-empty">Checking what's missing…</div></div>`, true);
    const n = await H.claudeNeeds(), body = document.getElementById('cuBody'); if (!body) return;
    const rows = n.items.map(i => `<div class="li">${H.icon('import', i.need && !i.light ? 'amber' : 'green')}<div><div class="li-title">${H.esc(i.label)}</div><div class="li-sub">${i.sub}</div></div><span class="pill ${i.need && !i.light ? 'amber' : i.need ? 'gray' : 'green'}">${H.esc(i.status)}</span></div>`);
    const nothing = H.claudeNothing(n);
    body.innerHTML = `<p class="muted small" style="margin:-10px 0 14px">${nothing ? 'All your numbers are up to date. Claude can still check news, events and ratings.' : 'Have cfahome open in another Chrome tab. Click <strong>Copy request</strong>, open Claude in Chrome, paste, and press Enter. Claude pulls exactly what is listed and checks every box before saving.'}</p>
      <div class="list">${rows.join('') || '<div class="li-empty">You don\'t have access to the sections Claude updates.</div>'}</div>
      <div class="section-label" style="margin-top:16px">Exact list for Claude</div>
      <pre id="claudeChecklist" style="white-space:pre-wrap;background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:10px 12px;font-size:.74rem;margin:0;max-height:180px;overflow:auto">${H.esc(H.claudeList(n))}</pre>
      <details class="mt"><summary class="small" style="cursor:pointer;font-weight:600">Set up the /update shortcut in Claude in Chrome</summary>
        <div class="small" style="margin-top:8px">In Claude in Chrome, create a shortcut named <strong>update</strong> and paste the text below as its prompt. After that, typing <strong>/update</strong> in the extension does the same as this button, any time.</div>
        <div class="row mt-s"><button class="btn btn-sm" onclick="H.copyText(H.claudeShortcut,'Shortcut copied')">Copy shortcut text</button></div></details>
      <div class="mfooter"><button class="btn" onclick="H.closeModal()">Close</button>${n.items.some(i => i.need) ? '<button class="btn btn-primary" id="cuCopy">Copy request</button>' : ''}</div>`;
    const b = document.getElementById('cuCopy'); if (b) b.onclick = () => H.copyText(H.claudePrompt(n), 'Copied. Paste it into Claude in Chrome.');
  };
  H.copyText = async (txt, msg) => {
    try { await navigator.clipboard.writeText(txt); H.toast(msg || 'Copied'); }
    catch (e) { H.modal(`<h3>Copy this</h3><p class="muted small" style="margin:-10px 0 12px">Your browser blocked automatic copying. Select all and copy.</p><textarea style="width:100%;height:300px;font-size:.78rem;border:1px solid var(--border);border-radius:8px;padding:10px" readonly onfocus="this.select()">${H.esc(txt)}</textarea><div class="mfooter"><button class="btn" onclick="H.closeModal()">Close</button></div>`, true); }
  };

  // Show the button only to people who can see a section Claude updates; open the panel on /#update
  const showUpdBtn = () => { const b = document.getElementById('claudeUpdBtn'); if (b) b.style.display = H.visible().some(s => ['foodcost', 'productivity', 'reputation', 'sales', 'pl', 'cash', 'quality'].includes(s)) ? '' : 'none'; };
  const _loginCU = window.hubOnLogin, _viewCU = window.hubSetViewAs;
  window.hubOnLogin = async user => { await _loginCU(user); showUpdBtn(); if (location.hash === '#update') setTimeout(() => H.claudeUpdate(), 400); };
  window.hubSetViewAs = role => { _viewCU(role); showUpdBtn(); };
  window.addEventListener('hashchange', () => { if (location.hash === '#update' && H.user()) H.claudeUpdate(); });
})();
