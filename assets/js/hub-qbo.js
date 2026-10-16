// Los Filtros Hub v2 — QuickBooks pull for Reconciliation.
// Talks only to the "qbo" Supabase Edge Function (supabase/functions/qbo): the QuickBooks keys and tokens stay there.
// Fills the Amex / Chase / Amazon / Banco Popular side of Reconciliation for the month; Gastos still comes from R365.
(function () {
  const H = window.H;
  const KINDS = { amex: 'Amex', chase: 'Chase Ink', amazon: 'Amazon Business', bank: 'Banco Popular', ignore: "Don't use" };
  // Same exclusions the statement upload applies to bank lines (CFA wires, card payments, deposits…)
  const BANK_SKIP = ['CHICK FIL A PR', 'CHASE CREDIT CRD', 'AMERICAN EXPRESS', 'CURRENCY CASH', 'TELEPAGO', 'BPPR MERCHANT', 'COMM SVC', 'STATE IVU', 'MUNICIPAL IVU', 'AJUSTE', 'CFA CORP WEB', 'VIRTUAL S DEPOSIT', 'BPPR MRCH. DEP', 'EFT DEPOSIT', 'UBER USA', 'DEPOSITO'];
  const guess = a => { const n = `${a.name || ''}`.toLowerCase(); if (/amex|american|platinum/.test(n)) return 'amex'; if (/chase|ink/.test(n)) return 'chase'; if (/amazon/.test(n)) return 'amazon'; if (a.type === 'Bank' || /popular|bppr|checking|operat/.test(n)) return 'bank'; return 'ignore'; };

  async function call(action, extra) {
    if (window.__HUB_PREVIEW__) throw new Error('In the preview, QuickBooks isn\'t connected. On the live hub this pulls the month\'s card and bank activity.');
    const { data, error } = await getSupa().functions.invoke('qbo', { body: { action, ...(extra || {}) } });
    if (error) {
      let msg = error.message || 'QuickBooks request failed';
      try { const b = await error.context.json(); if (b && b.error) msg = b.error; } catch (e) {}
      if (/Failed to send|not found|404/i.test(msg)) msg = 'The QuickBooks connection (Supabase function "qbo") isn\'t set up yet. See the setup steps.';
      throw new Error(msg);
    }
    if (data && data.error) throw new Error(data.error);
    return data;
  }

  function setupModal(st) {
    H.modal(`<h3>Connect QuickBooks</h3>
      <p class="muted small" style="margin:-10px 0 14px">Reconciliation can read your card and bank activity straight from QuickBooks, so you only upload the Gastos export. The hub only reads; it never changes anything in QuickBooks.</p>
      ${st && st.configured ? `<div class="list"><div class="li"><span></span><div><div class="li-title">Ready to connect</div><div class="li-sub">You'll sign in to Intuit, pick Pertenecen LLC and approve. You come right back here.</div></div><button class="btn btn-primary" onclick="H.qbo.connect()">Connect QuickBooks</button></div></div>`
        : `<div class="source warn"><span>The QuickBooks keys aren't set up in Supabase yet. This is a one-time setup (about 20 minutes): see <strong>QUICKBOOKS-SETUP.md</strong> in the hub's files.</span></div>`}
      <div class="small muted mt">QuickBooks only shares transactions that have been accepted or categorized in its Banking screen. Items still under "For review" won't come through until they're accepted.</div>
      <div class="mfooter"><button class="btn" onclick="H.closeModal()">Close</button></div>`, true);
  }

  async function mapAccounts(accounts, existing) {
    return new Promise(resolve => {
      H.modal(`<h3>Which account is which?</h3><p class="muted small" style="margin:-10px 0 14px">Tell the hub which QuickBooks accounts are your cards and bank. You only do this once.</p>
        <div class="list">${accounts.map((a, i) => `<div class="li"><span></span><div><div class="li-title">${H.esc(a.name)}</div><div class="li-sub">${H.esc(a.type)}${a.subtype ? ' · ' + H.esc(a.subtype) : ''}</div></div>
          <select class="sel" data-a="${i}">${Object.entries(KINDS).map(([k, l]) => `<option value="${k}" ${(existing[a.id] || guess(a)) === k ? 'selected' : ''}>${H.esc(l)}</option>`).join('')}</select></div>`).join('')}</div>
        <div class="mfooter"><button class="btn" onclick="H.closeModal()">Cancel</button><button class="btn btn-primary" id="qbMapSave">Save</button></div>`, true);
      document.getElementById('qbMapSave').onclick = async () => {
        const rows = [...document.querySelectorAll('select[data-a]')].map(s => { const a = accounts[+s.dataset.a]; return { account_id: a.id, account_name: a.name, kind: s.value, updated_by: H.who(), updated_at: new Date().toISOString() }; });
        await H.db.upsert('qbo_account_map', rows, 'account_id'); H.closeModal(); resolve(Object.fromEntries(rows.map(r => [r.account_id, r.kind])));
      };
    });
  }

  H.qbo = {
    async connect() {
      try { const { url } = await call('connect'); location.href = url; } catch (e) { H.toast(e.message); }
    },
    async disconnect() {
      H.confirm('Disconnect QuickBooks?', 'The hub forgets its QuickBooks sign-in. Nothing in QuickBooks changes. You can connect again any time.', 'Disconnect', async () => { try { await call('disconnect'); H.toast('QuickBooks disconnected'); } catch (e) { H.toast(e.message); } }, true);
    },
    async settings() {
      let st; try { st = await call('status'); } catch (e) { return H.toast(e.message); }
      if (!st.connected) return setupModal(st);
      const map = await H.db.list('qbo_account_map', { cache: false }) || [];
      H.modal(`<h3>QuickBooks</h3><p class="muted small" style="margin:-10px 0 14px">Connected to <strong>${H.esc(st.company || 'your company')}</strong> since ${H.esc(H.fmtDT(st.connected_at))}.</p>
        <div class="list">${map.map(m => `<div class="li"><span></span><div><div class="li-title">${H.esc(m.account_name)}</div></div><span class="pill ${m.kind === 'ignore' ? 'gray' : 'blue'}">${H.esc(KINDS[m.kind] || m.kind)}</span></div>`).join('') || '<div class="li-empty">No accounts mapped yet.</div>'}</div>
        <div class="mfooter"><button class="btn" style="margin-right:auto;color:var(--bad)" onclick="H.qbo.disconnect()">Disconnect</button><button class="btn" onclick="H.qbo.remap()">Change accounts</button><button class="btn" onclick="H.closeModal()">Close</button></div>`, true);
    },
    async remap() {
      try { const { accounts } = await call('accounts'); const map = Object.fromEntries((await H.db.list('qbo_account_map', { cache: false }) || []).map(m => [m.account_id, m.kind])); await mapAccounts(accounts.filter(a => a.active), map); H.toast('Saved'); } catch (e) { H.toast(e.message); }
    },
    async pull() {
      let st;
      try { st = await call('status'); } catch (e) { return H.toast(e.message); }
      if (!st.connected) return setupModal(st);
      const month = H.reconMonth(), [y, m] = month.split('-').map(Number);
      const from = H.addDays(`${month}-01`, -14), to = H.monthEnd(month);   // the bank side looks back 14 days, like the statement upload
      H.toast(`Pulling ${H.monthLabel(month, true)} from QuickBooks…`);
      let tx;
      try { ({ transactions: tx } = await call('transactions', { from, to })); } catch (e) { return H.toast(e.message); }
      // Make sure every account that has activity is mapped
      let map = Object.fromEntries((await H.db.list('qbo_account_map', { cache: false }) || []).map(r => [r.account_id, r.kind]));
      const unmapped = [...new Map(tx.filter(t => t.account_id && !map[t.account_id]).map(t => [t.account_id, { id: t.account_id, name: t.account_name, type: /bank|check/i.test(t.pay_type) ? 'Bank' : 'Credit Card' }])).values()];
      if (unmapped.length) {
        let accounts = unmapped; try { const all = (await call('accounts')).accounts; accounts = all.filter(a => unmapped.some(u => u.id === a.id)); } catch (e) {}
        map = { ...map, ...(await mapAccounts(accounts, map)) };
      }
      const lists = { amex: [], chase: [], amazon: [], bank: [] };
      tx.forEach(t => {
        const kind = map[t.account_id]; if (!kind || kind === 'ignore' || !lists[kind]) return;
        const description = [t.payee, t.memo].filter(Boolean).join(' · ') || '(no description)';
        if (kind === 'bank' && BANK_SKIP.some(k => description.toUpperCase().includes(k))) return;
        lists[kind].push({ id: `qbo-${t.id}`, source: kind, date: H.d(t.date), amount: Math.round(t.amount * 100) / 100, description });
      });
      Object.entries(lists).forEach(([k, v]) => { RECON_DATA[k] = v; });
      RECON_DATA.allCC = [...RECON_DATA.amex, ...RECON_DATA.chase, ...RECON_DATA.amazon];
      RECON_DATA._fromQbo = `QuickBooks · ${st.company || ''} · pulled ${new Date().toLocaleString('en-US', { timeZone: 'America/Puerto_Rico', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}`;
      const n = Object.entries(lists).map(([k, v]) => `${KINDS[k]} ${v.length}`).join(' · ');
      if (RECON_DATA.gastos.length) { await window.runReconciliation(); H.toast(`From QuickBooks: ${n}`); }
      else { renderReconReport(); if (H.recon && H.recon.refresh) H.recon.refresh(); H.toast(`From QuickBooks: ${n}. Now drop the Gastos export to reconcile.`); }
    },
  };

  // Changing the month re-pulls when the card/bank side came from QuickBooks
  if (H.recon) { const setMonth = H.recon.setMonth.bind(H.recon); H.recon.setMonth = async m => { const fromQbo = !!RECON_DATA._fromQbo; await setMonth(m); if (fromQbo) H.qbo.pull(); }; }

  // Coming back from Intuit: say how it went and open Reconciliation once signed in
  const qs = new URLSearchParams(location.search), result = qs.get('qbo');
  if (result) {
    try { history.replaceState(null, '', location.pathname + (location.hash || '')); } catch (e) {}
    const msg = { connected: 'QuickBooks is connected. Pull a month from Reconciliation.', cancelled: 'QuickBooks connection was cancelled.', expired: 'That QuickBooks sign-in link expired. Try Connect again.', error: 'QuickBooks did not finish connecting. Try again.' }[result];
    const prev = window.hubOnLogin;
    window.hubOnLogin = async user => { await prev(user); if (msg) setTimeout(() => { H.toast(msg); if (H.visible().includes('recon')) goTab('recon'); }, 500); };
  }
})();
