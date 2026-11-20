(() => {
  'use strict';

  const panel = $('betaAdminPanel');
  const inbox = $('betaAdminInbox');
  const settings = $('menbaAdminSettings');
  const members = $('menbaAdminMember');
  const memberSettings = $('menbaMemberSettings');
  const hocaForm = $('menbaHocaForm');
  const limitForm = $('menbaLimitForm');
  const limitInput = $('menbaLimit');
  const budget = $('menbaBudget');
  const hocaInput = $('menbaHocaEnabled');
  const settingsStatus = $('menbaSettingsStatus');
  const inboxStatus = $('betaAdminInboxStatus');
  const endpoint = $('menbaCloudPilot').dataset.endpoint;
  const cloudConfigured = MenbaCloudChat.canUse(endpoint);
  const groups = [
    {
      element:$('betaAdminMemberRequests'), list:'library_list_membership_requests',
      label:row=>row.email || row.user_id,
      detail:row=>!row.confirmed ? tr('E-Mail-Bestätigung steht aus','E-posta onayı bekleniyor') : '',
      canApprove:row=>row.confirmed === true,
      review:'library_review_membership',
      args:(row,approve)=>({target_user_id:row.user_id,approve})
    },
    {
      element:$('betaAdminShareRequests'), list:'library_list_book_shares_for_review',
      label:row=>[row.title,row.author].filter(Boolean).join(' · '),
      detail:row=>row.include_pdf ? tr('Mit PDF zur Freigabe','PDF ile paylaşım') : tr('Buchdaten','Kitap bilgileri'),
      review:'library_review_book_share',
      args:(row,approve)=>({target_submission:row.id,approve})
    },
    {
      element:$('betaAdminLoanRequests'), list:'library_list_pending_admin_loans',
      label:row=>row.offer_title,
      detail:row=>row.handover_note,
      review:'library_update_loan_request',
      args:(row,approve)=>({target_request:row.id,target_status:approve?'approved':'declined'})
    }
  ];
  let groupSerial = 0;
  let settingsSerial = 0;
  let memberRows = [];
  let reviewed = false;
  let intakeBusy = false;
  let settingsBusy = false;
  let quotaState = null;
  let originalHoca = null;

  const owner = () => accessState === 'approved' && document.documentElement.dataset.betaOwner === 'true'
    ? currentUser?.id ?? null : null;
  const view = () => owner() && !panel.hidden && $('libraryArea').dataset.workspace === 'admin';
  const session = () => {
    const id = owner();
    const revision = accessRequest;
    return () => Boolean(view() && id === owner() && accessRequest === revision);
  };
  const message = (element,de,turkish) => { element.textContent = tr(de,turkish); };

  function renderRows(group, rows) {
    group.element.replaceChildren();
    if (!rows.length) {
      message(group.element,'Keine offenen Anfragen.','Açık talep yok.');
      return;
    }
    const list = document.createElement('ul');
    list.className = 'beta-admin-requests';
    for (const row of rows) {
      const entry = document.createElement('li');
      const label = document.createElement('strong');
      label.textContent = group.label(row);
      entry.append(label);
      const detail = group.detail?.(row);
      if (detail) {
        const info = document.createElement('small');
        info.textContent = detail;
        entry.append(info);
      }
      const actions = document.createElement('div');
      actions.className = 'beta-admin-actions';
      for (const approve of [true,false]) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = approve ? tr('Freigeben','Onayla') : tr('Ablehnen','Reddet');
        button.disabled = approve && group.canApprove?.(row) === false;
        button.addEventListener('click',()=>void review(group,row,approve,actions));
        actions.append(button);
      }
      entry.append(actions);
      list.append(entry);
    }
    group.element.append(list);
  }

  async function loadInbox() {
    if (!view()) return;
    const current = session();
    const serial = ++groupSerial;
    await Promise.all([
      ...groups.map(async group=>{
        message(group.element,'Wird geladen …','Yükleniyor …');
        try {
          const {data,error} = await db.rpc(group.list);
          if (!current() || serial !== groupSerial) return;
          if (error || !Array.isArray(data)) throw Error('Unreadable request list');
          renderRows(group,data);
        } catch {
          if (current() && serial === groupSerial) message(group.element,'Liste konnte nicht geladen werden.','Liste yüklenemedi.');
        }
      }),
      loadResetRequests()
    ]);
  }

  async function review(group,row,approve,actions) {
    if (!view() || intakeBusy) return;
    const current = session();
    intakeBusy = true;
    for (const button of actions.children) button.disabled = true;
    try {
      const {error} = await db.rpc(group.review,group.args(row,approve));
      if (!current()) return;
      if (error) throw error;
      reviewed = true;
      message(inboxStatus,'Entscheidung gespeichert.','Karar kaydedildi.');
      if (group.review === 'library_review_book_share') document.dispatchEvent(new Event('library-shared-books'));
      await loadInbox();
    } catch {
      if (current()) {
        message(inboxStatus,'Die Entscheidung konnte nicht gespeichert werden.','Karar kaydedilemedi.');
        actions.children[0].disabled = group.canApprove?.(row) === false;
        actions.children[1].disabled = false;
      }
    } finally { intakeBusy = false; }
  }

  function updateBudget() {
    if (!cloudConfigured) {
      message(budget,'Cloudflare ist noch nicht verbunden. Tagesbudget nach Verbindung: 10.000 Neurons.',
        'Cloudflare henüz bağlı değil. Bağlantı sonrası günlük bütçe: 10.000 Neurons.');
      return;
    }
    if (!quotaState) {
      message(budget,'Kontingentdaten derzeit nicht verfügbar.','Kota bilgileri şu anda kullanılamıyor.');
      return;
    }
    const {total,budget:maximum,used,limit,day} = quotaState;
    const number = value => new Intl.NumberFormat(libraryLocale()).format(value);
    message(budget,
      `${day} (UTC) · ${number(total)} / ${number(maximum)} Neurons für MENBA verbucht · ${number(Math.max(0,maximum-total))} verfügbar. Verbrauch geschätzt.`,
      `${day} (UTC) · MENBA için ${number(total)} / ${number(maximum)} Neurons ayrıldı · ${number(Math.max(0,maximum-total))} kaldı. Tahmini kullanım.`);
    message($('menbaMemberUsage'),`${number(used)} / ${number(limit)} Neurons diesem Konto zugeordnet.`,`Bu hesaba ${number(used)} / ${number(limit)} Neurons kaydedildi.`);
    limitInput.value = String(limit);
  }

  function renderSettings() {
    const id = members.value;
    const active = Boolean(view() && id && memberRows.some(row=>row.user_id === id));
    memberSettings.hidden = !active;
    hocaForm.hidden = id === owner();
    limitForm.hidden = !cloudConfigured || !quotaState;
    if (originalHoca !== null) hocaInput.checked = originalHoca;
    hocaInput.disabled = hocaForm.querySelector('button').disabled = settingsBusy || originalHoca === null;
    limitInput.disabled = limitForm.querySelector('button').disabled = settingsBusy || !quotaState;
    members.disabled = settingsBusy;
    updateBudget();
  }

  async function loadMember() {
    if (!view() || !members.value) return;
    const current = session();
    const serial = ++settingsSerial;
    const id = members.value;
    const still = () => current() && serial === settingsSerial && id === members.value;
    settingsStatus.textContent = '';
    quotaState = originalHoca = null;
    renderSettings();
    const requests = await Promise.allSettled([
      id === owner() ? null : db.rpc('library_menba_get_hoca',{target_user_id:id}),
      cloudConfigured ? MenbaCloudChat.quota(endpoint,{account:id}) : null
    ]);
    if (!still()) return;
    const [role,meter] = requests;
    if (role.status === 'fulfilled' && typeof role.value?.data === 'boolean' && !role.value.error) originalHoca = role.value.data;
    else if (id !== owner()) message(settingsStatus,'Hoca-Rolle konnte nicht geladen werden.','Hoca yetkisi yüklenemedi.');
    if (meter.status === 'fulfilled') quotaState = meter.value;
    renderSettings();
  }

  async function loadSettings() {
    if (!view() || !settings.open) return;
    const current = session();
    const serial = ++settingsSerial;
    const prior = members.value;
    try {
      const {data,error} = await db.rpc('library_beta_list_delegate_candidates');
      if (!current() || serial !== settingsSerial) return;
      if (error || !Array.isArray(data)) throw Error('Unreadable members');
      memberRows = [{user_id:owner(),email:tr('Mein Admin-Konto','Yönetici hesabım')},...data];
      members.replaceChildren(...memberRows.map(row=>new Option(row.email || row.user_id,row.user_id)));
      if (memberRows.some(row=>row.user_id === prior)) members.value = prior;
      await loadMember();
    } catch {
      if (current()) message(settingsStatus,'Mitglieder konnten nicht geladen werden.','Üyeler yüklenemedi.');
    }
  }

  async function saveSettings(kind) {
    const id = members.value;
    if (!view() || !id || settingsBusy) return;
    const current = session();
    const hoca = hocaInput.checked;
    const limit = limitInput.valueAsNumber;
    settingsBusy = true;
    renderSettings();
    try {
      if (kind === 'role') {
        const {data,error} = await db.rpc('library_menba_set_hoca',{target_user_id:id,enabled:hoca});
        if (!current()) return;
        if (error || data !== hoca) throw Error('Role not saved');
        originalHoca = data;
        document.dispatchEvent(new Event('menba-role-change'));
      } else {
        const next = await MenbaCloudChat.quota(endpoint,{account:id,limit});
        if (!current()) return;
        if (!next || next.limit !== limit) throw Error('Limit not saved');
        quotaState = next;
      }
      message(settingsStatus,'Gespeichert.','Kaydedildi.');
    } catch {
      if (current()) message(settingsStatus,'Speichern fehlgeschlagen.','Kaydedilemedi.');
    } finally {
      settingsBusy = false;
      if (current()) renderSettings();
    }
  }

  function clear() {
    ++groupSerial;
    ++settingsSerial;
    memberRows = [];
    members.replaceChildren();
    memberSettings.hidden = true;
    quotaState = originalHoca = null;
    settingsStatus.textContent = inboxStatus.textContent = budget.textContent = '';
    $('menbaMemberUsage').textContent = '';
    limitInput.value = '';
    hocaInput.checked = false;
    for (const group of groups) group.element.replaceChildren();
  }

  $('betaAdminNav').addEventListener('click',()=>{
    if (!view()) return;
    reviewed = false;
    void loadInbox();
    void loadSettings();
  });
  $('betaAdminInboxReload').addEventListener('click',()=>void loadInbox());
  inbox.addEventListener('toggle',()=>{ if (inbox.open && view() && !groups[0].element.textContent) void loadInbox(); });
  settings.addEventListener('toggle',()=>{ if (settings.open) void loadSettings(); });
  members.addEventListener('change',()=>void loadMember());
  hocaForm.addEventListener('submit',event=>{ event.preventDefault(); void saveSettings('role'); });
  limitForm.addEventListener('submit',event=>{ event.preventDefault(); void saveSettings('limit'); });
  $('betaAdminClose').addEventListener('click',clear);
  document.addEventListener('library-access',clear);
  document.addEventListener('library-language',()=>{
    if (!view()) return;
    if (reviewed) message(inboxStatus,'Entscheidung gespeichert.','Karar kaydedildi.');
    void loadInbox();
    void loadSettings();
  });
})();
