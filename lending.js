(() => {
  'use strict';

  const panel = $('betaLending');
  if (!panel) return;

  const feedback = $('betaLendingFeedback');
  const personalForm = $('betaPersonalLoanForm');
  const offerForm = $('betaSharedOfferForm');
  const requestForm = $('betaSharedRequestForm');
  const personalBook = personalForm.elements.namedItem('book');
  const offeredBook = offerForm.elements.namedItem('book');
  const openers = [$('betaLoansNav'), $('betaLoansDash')].filter(Boolean);
  const tabs = { personal: $('betaLendingPersonal'), shared: $('betaLendingShared') };
  const reloadButton = $('betaLendingReload');
  const pagination = (prefix, pageSize, empty) => ({
    list: $(prefix + 'List'), message: $(prefix + 'State'), pages: $(prefix + 'Pages'),
    previous: $(prefix + 'Previous'), next: $(prefix + 'Next'), pageLabel: $(prefix + 'PageLabel'),
    pageSize, empty
  });
  const collections = {
    personal: pagination('betaPersonalLoan', 20, ['Noch keine Ausleihen eingetragen.', 'Henüz ödünç kaydı yok.']),
    offers: pagination('betaSharedOffer', 50, ['Keine Angebote auf dieser Seite.', 'Bu sayfada teklif yok.']),
    requests: pagination('betaSharedRequest', 50, ['Keine Anfragen auf dieser Seite.', 'Bu sayfada istek yok.'])
  };
  const statusLabels = {
    pending: ['Offen', 'Bekliyor'],
    approved: ['Ausgeliehen', 'Ödünç verildi'],
    declined: ['Abgelehnt', 'Reddedildi'],
    cancelled: ['Zurückgezogen', 'Geri çekildi'],
    returned: ['Zurückgegeben', 'İade edildi']
  };
  const newList = () => ({ page: 0, rows: [], more: false, loading: false, error: false, serial: 0 });
  const newLists = () => ({ personal: newList(), offers: newList(), requests: newList() });
  let owner = null;
  let epoch = 0;
  let activePage = null;
  let openedBy = null;
  let draft = null;
  let busy = false;
  let message = null;
  let lists = newLists();
  let openCount = null;
  let countSerial = 0;

  const allowed = () => Boolean(owner && owner === currentUser?.id && accessState === 'approved');
  const myBooks = () => books.filter(book => book.owner_id === owner);
  const activeBooks = () => myBooks().filter(book => !book.deleted_at && book.visibility === 'private');
  const booksById = () => new Map(myBooks().map(book => [book.id, book]));
  const activeLists = () => activePage === 'personal' ? ['personal'] : ['offers', 'requests'];
  const formatDate = value => new Intl.DateTimeFormat(lang === 'tr' ? 'tr-TR' : 'de-DE')
    .format(new Date(value.length === 10 ? value + 'T00:00:00' : value));

  function chooseBook(select, list) {
    const selected = select.value;
    select.replaceChildren(new Option(tr('Buch auswählen', 'Kitap seç'), ''));
    for (const book of list) select.add(new Option(book.title, book.id));
    if (list.some(book => book.id === selected)) select.value = selected;
  }

  function row(title, details, actions) {
    const item = document.createElement('li');
    const name = document.createElement('strong');
    name.textContent = title;
    item.append(name);
    for (const detail of details.filter(Boolean)) {
      const line = document.createElement('p');
      line.textContent = detail;
      item.append(line);
    }
    if (actions.length) {
      const tools = document.createElement('div');
      tools.className = 'beta-lending-actions';
      for (const [label, onClick] of actions) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = tr(...label);
        button.disabled = busy;
        button.addEventListener('click', onClick);
        tools.append(button);
      }
      item.append(tools);
    }
    return item;
  }

  function personalRow(loan, byId) {
    const title = byId.get(loan.book_id)?.title || tr('Buch nicht mehr im Bestand', 'Kitap artık koleksiyonda yok');
    const borrowed = tr('Ausgeliehen an: ', 'Ödünç alan: ') + loan.borrower_label;
    const due = loan.due_date && tr('Fällig am: ', 'İade tarihi: ') + formatDate(loan.due_date);
    const returned = loan.returned_at && tr('Zurück am: ', 'İade edildi: ') + formatDate(loan.returned_at);
    const actions = loan.returned_at ? [] : [
      [['Rückgabe erfassen', 'İadeyi kaydet'], () => runWrite(() => recordReturn(loan.id))]
    ];
    return row(title, [borrowed, due, returned], actions);
  }

  function offerRow(offer) {
    const state = offer.available ? tr('Verfügbar', 'Uygun') : tr('Gerade nicht verfügbar', 'Şu anda uygun değil');
    const origin = offer.mine ? tr('Dein Angebot', 'Senin teklifin') : '';
    const actions = offer.available && !offer.mine ? [
      [['Ausleihe anfragen', 'Ödünç iste'], () => {
        draft = offer;
        requestForm.reset();
        render();
        requestForm.elements.namedItem('note').focus();
      }]
    ] : [];
    return row(offer.title, [offer.author, origin, state], actions);
  }

  function requestRow(request) {
    const actions = [];
    function action(label, target) {
      actions.push([label, () => runWrite(() => db.rpc('library_update_loan_request', {
        target_request: request.id, target_status: target
      }))]);
    }
    if (request.requested_by_me && request.status === 'pending') {
      action(['Anfrage zurückziehen', 'İsteği geri çek'], 'cancelled');
    }
    if (request.can_review && request.status === 'pending') {
      action(['Annehmen', 'Onayla'], 'approved');
      action(['Ablehnen', 'Reddet'], 'declined');
    }
    if (request.can_review && request.status === 'approved') {
      action(['Rückgabe erfassen', 'İadeyi kaydet'], 'returned');
    }
    const mine = request.requested_by_me ? tr('Meine Anfrage', 'İsteğim') : '';
    const status = statusLabels[request.status];
    const label = status ? tr(...status) : '';
    return row(request.offer_title, [mine, label, request.handover_note], actions);
  }

  function renderList(key, makeRow) {
    const state = lists[key];
    const controls = collections[key];
    controls.message.textContent = state.loading ? tr('Wird geladen …', 'Yükleniyor …')
      : state.error ? tr('Die Einträge konnten nicht geladen werden.', 'Kayıtlar yüklenemedi.')
        : state.rows.length ? '' : tr(...controls.empty);
    controls.list.replaceChildren(...state.rows.map(makeRow));
    controls.pages.hidden = !state.more && state.page === 0;
    controls.previous.disabled = busy || state.loading || state.page === 0;
    controls.next.disabled = busy || state.loading || !state.more;
    controls.pageLabel.textContent = tr('Seite ', 'Sayfa ') + (state.page + 1);
  }

  function render() {
    const authorised = allowed();
    const visible = authorised && activePage !== null;
    panel.hidden = !visible;
    for (const opener of openers) {
      opener.hidden = !authorised;
      opener.setAttribute('aria-expanded', String(visible));
    }
    const counter = $('dashLoans');
    if (counter) counter.textContent = authorised && openCount !== null ? String(openCount) : '—';
    panel.querySelectorAll('[data-lend-de]').forEach(element => {
      element.textContent = tr(element.dataset.lendDe, element.dataset.lendTr);
    });
    if (!visible) {
      for (const controls of Object.values(collections)) {
        controls.list.replaceChildren();
        controls.message.textContent = '';
      }
      feedback.textContent = '';
      return;
    }
    const personal = activePage === 'personal';
    $('betaLendingPersonalPane').hidden = !personal;
    $('betaLendingSharedPane').hidden = personal;
    tabs.personal.setAttribute('aria-pressed', String(personal));
    tabs.shared.setAttribute('aria-pressed', String(!personal));
    chooseBook(personalBook, activeBooks());
    chooseBook(offeredBook, activeBooks());
    feedback.textContent = message ? tr(...message) : '';
    for (const form of [personalForm, offerForm, requestForm]) {
      for (const control of form.elements) control.disabled = busy;
    }
    personalForm.querySelector('[type="submit"]').disabled = busy || personalBook.options.length < 2;
    offerForm.querySelector('[type="submit"]').disabled = busy || offeredBook.options.length < 2;
    $('betaSharedWithdraw').disabled = busy || offeredBook.options.length < 2;
    requestForm.hidden = personal || !draft;
    $('betaSharedRequestTitle').textContent = draft?.title || '';
    reloadButton.hidden = !activeLists().some(key => lists[key].error);
    reloadButton.disabled = busy;
    if (personal) {
      const byId = booksById();
      renderList('personal', loan => personalRow(loan, byId));
    } else {
      renderList('offers', offerRow);
      renderList('requests', requestRow);
    }
  }

  async function loadCount() {
    if (!allowed()) return;
    const session = epoch;
    const serial = ++countSerial;
    try {
      const result = await db.from('personal_book_loans').select('id', { count: 'exact', head: true })
        .eq('owner_id', owner).is('returned_at', null);
      if (session === epoch && serial === countSerial && allowed()) {
        openCount = result.error ? null : result.count ?? null;
        render();
      }
    } catch {
      if (session === epoch && serial === countSerial && allowed()) {
        openCount = null;
        render();
      }
    }
  }

  function fetchPage(key, start, pageSize) {
    if (key === 'personal') {
      return db.from('personal_book_loans').select('id,book_id,borrower_label,due_date,lent_at,returned_at', { count: 'exact' })
        .eq('owner_id', owner).order('lent_at', { ascending: false }).order('id', { ascending: false })
        .range(start, start + pageSize - 1);
    }
    const rpc = key === 'offers' ? 'library_list_lending_offers' : 'library_list_loan_requests';
    return db.rpc(rpc, { start_at: start });
  }

  async function load(key, page = lists[key].page) {
    if (!allowed()) return;
    const state = lists[key];
    const session = epoch;
    const serial = ++state.serial;
    const current = () => session === epoch && state.serial === serial && allowed();
    state.loading = true;
    state.error = false;
    render();
    try {
      const size = collections[key].pageSize;
      const result = await fetchPage(key, page * size, size);
      if (!current()) return;
      if (result.error) throw result.error;
      if (page > 0 && !result.data?.length) {
        state.more = false;
        return;
      }
      state.rows = result.data ?? [];
      state.page = page;
      state.more = result.count == null ? state.rows.length === size : (page + 1) * size < result.count;
    } catch {
      if (current()) state.error = true;
    } finally {
      if (current()) {
        state.loading = false;
        render();
      }
    }
  }

  async function refresh() {
    if (activePage) await Promise.all(activeLists().map(key => load(key)));
  }

  function explain(error) {
    if (error?.code === '23505') {
      return ['Es gibt schon eine offene Anfrage oder Ausleihe für dieses Buch.', 'Bu kitap için zaten açık bir istek veya ödünç kaydı var.'];
    }
    if (error?.code === '22023') {
      return ['Dieses Buch ist für die Ausleihe gerade nicht verfügbar.', 'Bu kitap şu anda ödünç verilemiyor.'];
    }
    if (error?.code === '42501') {
      return ['Für diese Aktion fehlt die Berechtigung.', 'Bu işlem için yetki yok.'];
    }
    return ['Die Aktion konnte nicht gespeichert werden. Versuche es erneut.', 'İşlem kaydedilemedi. Tekrar dene.'];
  }

  async function runWrite(operation, after = () => {}) {
    if (!allowed() || busy) return;
    const session = epoch;
    busy = true;
    message = null;
    render();
    try {
      const result = await operation();
      if (session !== epoch || !allowed()) return;
      if (result.error) throw result.error;
      after(result);
      message = ['Gespeichert.', 'Kaydedildi.'];
      await Promise.all([refresh(), loadCount()]);
    } catch (error) {
      if (session === epoch && allowed()) message = explain(error);
    } finally {
      if (session === epoch) {
        busy = false;
        render();
      }
    }
  }

  async function recordReturn(id) {
    const result = await db.from('personal_book_loans').update({ returned_at: new Date().toISOString() })
      .eq('owner_id', owner).eq('id', id).is('returned_at', null).select('id').maybeSingle();
    if (!result.error && !result.data) return { error: { code: '22023' } };
    return result;
  }

  function show(key) {
    if (!allowed()) return;
    activePage = key;
    message = null;
    render();
    void refresh();
  }

  function syncAccess() {
    const verified = accessState === 'approved' ? currentUser?.id ?? null : null;
    if (accessState !== 'loading' && verified !== owner) {
      owner = verified;
      epoch++;
      activePage = openedBy = draft = message = openCount = null;
      busy = false;
      lists = newLists();
      for (const form of [personalForm, offerForm, requestForm]) form.reset();
      for (const select of [personalBook, offeredBook]) select.replaceChildren();
      $('betaSharedRequestTitle').textContent = '';
    }
    render();
    if (allowed()) {
      void loadCount();
      void refresh();
    }
  }

  for (const opener of openers) {
    opener.setAttribute('aria-controls', panel.id);
    opener.addEventListener('click', () => {
      if (!allowed()) return;
      openedBy = opener;
      show(activePage ?? 'personal');
      panel.scrollIntoView({ block: 'start', behavior: 'instant' });
      $('betaLendingTitle').focus({ preventScroll: true });
    });
  }
  for (const [key, tab] of Object.entries(tabs)) tab.addEventListener('click', () => show(key));
  $('betaLendingClose').addEventListener('click', () => {
    activePage = null;
    render();
    openedBy?.focus();
  });
  for (const [key, controls] of Object.entries(collections)) {
    controls.previous.addEventListener('click', () => { void load(key, lists[key].page - 1); });
    controls.next.addEventListener('click', () => { void load(key, lists[key].page + 1); });
  }
  reloadButton.addEventListener('click', () => { void refresh(); });
  personalForm.addEventListener('submit', event => {
    event.preventDefault();
    const borrower = personalForm.elements.namedItem('borrower').value.trim();
    const bookId = personalBook.value;
    if (!bookId || !borrower) return;
    const payload = {
      owner_id: owner, book_id: bookId, borrower_label: borrower,
      due_date: personalForm.elements.namedItem('due').value || null
    };
    void runWrite(() => db.from('personal_book_loans').insert(payload).select('id').single(), () => {
      personalForm.reset();
      lists.personal.page = 0;
    });
  });
  function setOffer(available) {
    const bookId = offeredBook.value;
    if (!bookId) return;
    void runWrite(() => db.rpc('library_set_lending_offer', { target_book: bookId, available }), () => {
      offerForm.reset();
      lists.offers.page = 0;
    });
  }
  offerForm.addEventListener('submit', event => {
    event.preventDefault();
    setOffer(true);
  });
  $('betaSharedWithdraw').addEventListener('click', () => setOffer(false));
  $('betaSharedCancelDraft').addEventListener('click', () => {
    draft = null;
    requestForm.reset();
    render();
  });
  requestForm.addEventListener('submit', event => {
    event.preventDefault();
    if (!draft) return;
    const target = draft.id;
    const note = requestForm.elements.namedItem('note').value.trim();
    void runWrite(() => db.rpc('library_request_loan', { target_offer: target, note }), () => {
      draft = null;
      requestForm.reset();
      lists.requests.page = 0;
    });
  });
  document.addEventListener('library-access', syncAccess);
  document.addEventListener('library-language', render);
  document.addEventListener('library-books', render);
  syncAccess();
})();
