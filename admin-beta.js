(() => {
  'use strict';

  const panel = $('betaAdminPanel');
  const opener = $('betaAdminNav');
  const title = $('betaAdminTitle');
  const form = $('betaAdminForm');
  const select = $('betaAdminMember');
  const permissions = $('betaAdminPermissions');
  const checks = [...permissions.querySelectorAll('input[name="permissions"]')];
  const save = $('betaAdminSave');
  const retry = $('betaAdminRetry');
  const status = $('betaAdminStatus');
  const supported = new Set(checks.map(check => check.value));

  const messages = {
    loading: ['Wird geladen …', 'Yükleniyor …'],
    empty: ['Es gibt keine freigegebenen Mitglieder zur Auswahl.', 'Seçilebilecek onaylı üye yok.'],
    loadError: ['Die Daten konnten nicht geladen werden.', 'Veriler yüklenemedi.'],
    saved: ['Rechte gespeichert.', 'Yetkiler kaydedildi.'],
    saveError: ['Rechte konnten nicht gespeichert werden.', 'Yetkiler kaydedilemedi.']
  };

  let epoch = 0;
  let ownerId = null;
  let open = false;
  let members = [];
  let selected = '';
  let assigned = null;
  let request = 0;
  let pending = false;
  let saving = false;
  let feedback = null;
  let retryAction = null;

  const approvedUser = () => accessState === 'approved' ? currentUser?.id ?? null : null;
  const isOwner = () => Boolean(ownerId && ownerId === approvedUser());
  const visible = () => isOwner() && open;
  const wanted = () => checks.filter(check => check.checked).map(check => check.value).sort();
  const validGrants = value => Array.isArray(value) && value.every(grant => typeof grant === 'string');
  const knownGrants = value => [...new Set(value.filter(grant => supported.has(grant)))].sort();

  function publishAccess(data) {
    const grants = validGrants(data?.capabilities) ? knownGrants(data.capabilities) : [];
    const detail = {
      isOwner: isOwner(),
      canManageSharedCategories: grants.includes('shared_category_manage'),
      canReviewSharedLoans: grants.includes('shared_loan_review')
    };
    const dataset = document.documentElement.dataset;
    dataset.betaOwner = String(detail.isOwner);
    dataset.betaCategoryAdmin = String(detail.canManageSharedCategories);
    dataset.betaLoanReviewer = String(detail.canReviewSharedLoans);
    document.dispatchEvent(new CustomEvent('beta-role-access', { detail }));
  }

  function needsSave() {
    return assigned !== null && wanted().join(',') !== assigned.join(',');
  }

  function render() {
    const canOpen = isOwner();
    opener.hidden = !canOpen;
    opener.setAttribute('aria-expanded', String(canOpen && open));
    panel.hidden = !visible();
    if (panel.hidden) return;

    panel.querySelectorAll('[data-beta-admin-de]').forEach(element => {
      element.textContent = tr(element.dataset.betaAdminDe, element.dataset.betaAdminTr);
    });
    select.options[0].textContent = tr('Mitglied auswählen', 'Üye seç');
    select.disabled = members.length === 0 || saving;
    permissions.disabled = assigned === null || pending || saving;
    save.disabled = permissions.disabled || !needsSave();
    retry.hidden = !retryAction;
    status.textContent = saving
      ? tr('Rechte werden gespeichert …', 'Yetkiler kaydediliyor …')
      : feedback ? tr(...messages[feedback]) : '';
  }

  function setMembers(rows) {
    members = rows;
    select.replaceChildren(
      new Option('', ''),
      ...rows.map(({ user_id, email }) => new Option(email || user_id, user_id))
    );
  }

  function setGrants(grants) {
    assigned = grants;
    for (const check of checks) check.checked = grants?.includes(check.value) ?? false;
  }

  function clearPanel() {
    request++;
    open = false;
    pending = false;
    saving = false;
    feedback = null;
    retryAction = null;
    selected = '';
    setMembers([]);
    setGrants(null);
    status.textContent = '';
    render();
  }

  function startLoad() {
    const session = epoch;
    const token = ++request;
    pending = true;
    feedback = 'loading';
    retryAction = null;
    render();
    return () => session === epoch && token === request && visible();
  }

  async function loadMembers() {
    if (!visible()) return;
    selected = '';
    setMembers([]);
    setGrants(null);
    const live = startLoad();
    try {
      const { data, error } = await db.rpc('library_beta_list_delegate_candidates');
      if (!live()) return;
      if (error || !Array.isArray(data) || !data.every(row => typeof row?.user_id === 'string')) {
        feedback = 'loadError';
        retryAction = loadMembers;
        return;
      }
      setMembers(data);
      feedback = data.length ? null : 'empty';
    } catch {
      if (!live()) return;
      feedback = 'loadError';
      retryAction = loadMembers;
    } finally {
      if (live()) {
        pending = false;
        render();
      }
    }
  }

  async function loadGrants(id) {
    if (!visible() || saving) return;
    selected = id;
    setGrants(null);
    if (!members.some(member => member.user_id === id)) {
      request++;
      pending = false;
      feedback = null;
      retryAction = null;
      render();
      return;
    }
    const live = startLoad();
    try {
      const { data, error } = await db.rpc('library_beta_get_capabilities', { target_user_id: id });
      if (!live()) return;
      if (error || !validGrants(data)) {
        feedback = 'loadError';
        retryAction = () => loadGrants(id);
        return;
      }
      setGrants(knownGrants(data));
      feedback = null;
    } catch {
      if (!live()) return;
      feedback = 'loadError';
      retryAction = () => loadGrants(id);
    } finally {
      if (live()) {
        pending = false;
        render();
      }
    }
  }

  async function saveGrants() {
    if (!visible() || !selected || pending || saving || !needsSave()) return;
    const id = selected;
    const session = epoch;
    const token = ++request;
    const next = wanted();
    const live = () => session === epoch && token === request && visible() && selected === id;
    saving = true;
    feedback = null;
    render();
    try {
      const { data, error } = await db.rpc('library_beta_set_capabilities', {
        target_user_id: id,
        capabilities: next
      });
      if (!live()) return;
      if (error || !validGrants(data)) {
        feedback = 'saveError';
        return;
      }
      setGrants(knownGrants(data));
      feedback = 'saved';
    } catch {
      if (live()) feedback = 'saveError';
    } finally {
      if (live()) {
        saving = false;
        render();
      }
    }
  }

  async function syncAccess() {
    const session = ++epoch;
    const id = approvedUser();
    ownerId = null;
    clearPanel();
    publishAccess(null);
    if (!id) return;
    try {
      const { data, error } = await db.rpc('library_beta_get_access');
      if (session !== epoch || id !== approvedUser() || error) return;
      const access = Array.isArray(data) && data.length === 1 ? data[0] : data;
      if (typeof access?.is_owner !== 'boolean' || !validGrants(access.capabilities)) return;
      ownerId = access.is_owner ? id : null;
      publishAccess(access);
      render();
    } catch {
      // Leave controls hidden if authorization cannot be verified.
    }
  }

  opener.setAttribute('aria-controls', panel.id);
  opener.addEventListener('click', () => {
    if (!isOwner()) return;
    if (!open) {
      open = true;
      void loadMembers();
    }
    panel.scrollIntoView({ block: 'start', behavior: 'instant' });
    title.focus({ preventScroll: true });
  });
  $('betaAdminClose').addEventListener('click', () => {
    clearPanel();
    if (isOwner()) opener.focus();
  });
  select.addEventListener('change', () => { void loadGrants(select.value); });
  permissions.addEventListener('change', render);
  retry.addEventListener('click', () => { if (retryAction) void retryAction(); });
  form.addEventListener('submit', event => {
    event.preventDefault();
    void saveGrants();
  });
  document.addEventListener('library-access', () => { void syncAccess(); });
  document.addEventListener('library-language', render);
  void syncAccess();
})();
