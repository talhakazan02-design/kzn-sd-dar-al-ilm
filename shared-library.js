(() => {
  'use strict';

  const panel = $('betaSharedLibrary');
  if (!panel) return;

  const dash = $('betaShareDash');
  const adminOpener = $('betaShareReview');
  const feedback = $('betaShareFeedback');
  const form = $('betaShareForm');
  const bookPicker = form.elements.namedItem('book');
  const pdfChoice = form.elements.namedItem('includePdf');
  const submit = form.querySelector('[type="submit"]');
  const reviewSection = $('betaShareReviewSection');
  const reload = $('betaShareReload');
  const pageSize = 50;

  function pagination(prefix, rpc, empty) {
    return {
      rpc, empty, list: $(prefix + 'List'), message: $(prefix + 'State'), pages: $(prefix + 'Pages'),
      previous: $(prefix + 'Previous'), next: $(prefix + 'Next'), label: $(prefix + 'PageLabel')
    };
  }

  const collections = {
    catalog: pagination('betaShareCatalog', 'library_list_shared_books',
      ['Auf dieser Seite sind keine Bücher freigegeben.', 'Bu sayfada paylaşılan kitap yok.']),
    own: pagination('betaShareOwn', 'library_list_my_book_shares',
      ['Auf dieser Seite sind keine eigenen Einträge vorhanden.', 'Bu sayfada kaydın yok.']),
    review: pagination('betaShareReview', 'library_list_book_shares_for_review',
      ['Auf dieser Seite sind keine Anfragen offen.', 'Bu sayfada bekleyen istek yok.'])
  };
  const statuses = {
    pending: ['Wartet auf Freigabe', 'Onay bekliyor'],
    approved: ['Freigegeben', 'Onaylandı'],
    declined: ['Abgelehnt', 'Reddedildi'],
    withdrawn: ['Zurückgezogen', 'Geri çekildi']
  };
  const newList = () => ({ rows: [], page: 0, loading: false, error: false, serial: 0 });
  const newLists = () => ({ catalog: newList(), own: newList(), review: newList() });
  let lists = newLists();
  let epoch = 0;
  let owner = null;
  let open = false;
  let busy = false;
  let message = null;
  let openedBy = null;

  const allowed = () => Boolean(owner && owner === currentUser?.id && accessState === 'approved');
  const canReview = () => allowed() && document.documentElement.dataset.betaOwner === 'true';
  const activeLists = () => canReview() ? ['catalog', 'own', 'review'] : ['catalog', 'own'];
  const ownBooks = () => books.filter(book => book.owner_id === owner && book.visibility === 'private' && !book.deleted_at);

  function resetSelection() {
    form.reset();
    bookPicker.replaceChildren();
    pdfChoice.checked = false;
  }

  function renderBookPicker() {
    const selected = bookPicker.value;
    const available = ownBooks();
    const selectedBook = available.find(book => book.id === selected);
    bookPicker.replaceChildren(new Option(tr('Buch auswählen', 'Kitap seç'), ''),
      ...available.map(book => new Option(book.title, book.id)));
    if (selectedBook) bookPicker.value = selected;
    if (!selectedBook?.file_path) pdfChoice.checked = false;
    bookPicker.disabled = busy || !available.length;
    pdfChoice.disabled = busy || !selectedBook?.file_path;
    submit.disabled = busy || !selectedBook;
  }

  function bookRow(book, address, actions) {
    const item = document.createElement('li');
    const title = document.createElement('strong');
    title.textContent = book.title;
    item.append(title);
    const details = [book.author, book.category, ...address].filter(Boolean);
    for (const value of details) {
      const line = document.createElement('p');
      line.textContent = value;
      item.append(line);
    }
    if (actions.length) {
      const buttons = document.createElement('div');
      buttons.className = 'beta-share-actions';
      for (const [label, execute] of actions) {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = tr(...label);
        button.disabled = busy;
        button.addEventListener('click', execute);
        buttons.append(button);
      }
      item.append(buttons);
    }
    return item;
  }

  function renderCatalog(book) {
    const actions = book.has_pdf ? [
      [['PDF öffnen', 'PDF’yi aç'], () => { void openPdf(book.id); }]
    ] : [];
    return bookRow(book, [], actions);
  }

  function renderOwn(book) {
    const info = [statuses[book.status] ? tr(...statuses[book.status]) : ''];
    if (book.include_pdf) {
      info.push(book.has_pdf ? tr('PDF freigegeben', 'PDF paylaşıldı')
        : tr('PDF zur Freigabe eingereicht', 'PDF onaya gönderildi'));
    }
    const actions = book.status === 'pending' || book.status === 'approved' ? [
      [['Freigabe zurückziehen', 'Paylaşımı geri çek'], () => withdraw(book.id)]
    ] : [];
    return bookRow(book, info, actions);
  }

  function renderReview(book) {
    const detail = book.include_pdf ? tr('Mit beantragter PDF-Freigabe', 'PDF paylaşımı istendi')
      : tr('Nur Buchdaten', 'Yalnızca kitap bilgileri');
    return bookRow(book, [detail], [
      [['Freigeben', 'Onayla'], () => review(book.id, true)],
      [['Ablehnen', 'Reddet'], () => review(book.id, false)]
    ]);
  }

  function clearList(key) {
    const controls = collections[key];
    controls.list.replaceChildren();
    controls.message.textContent = '';
    controls.pages.hidden = true;
    controls.label.textContent = '';
  }

  function renderList(key, makeRow) {
    const state = lists[key];
    const controls = collections[key];
    controls.message.textContent = state.loading ? tr('Wird geladen …', 'Yükleniyor …')
      : state.error ? tr('Die Bücher konnten nicht geladen werden.', 'Kitaplar yüklenemedi.')
        : state.rows.length ? '' : tr(...controls.empty);
    controls.list.replaceChildren(...state.rows.map(makeRow));
    const next = state.rows.length === pageSize;
    controls.pages.hidden = state.page === 0 && !next;
    controls.previous.disabled = busy || state.loading || state.page === 0;
    controls.next.disabled = busy || state.loading || !next;
    controls.label.textContent = tr('Seite ', 'Sayfa ') + (state.page + 1);
  }

  function render() {
    const visible = allowed() && open;
    const reviewer = canReview();
    panel.hidden = !visible;
    if (dash) {
      dash.hidden = !allowed();
      dash.setAttribute('aria-expanded', String(visible));
    }
    if (adminOpener) {
      adminOpener.hidden = !reviewer;
      adminOpener.setAttribute('aria-expanded', String(visible && reviewer));
    }
    reviewSection.hidden = !reviewer;
    if (!visible) {
      for (const key of Object.keys(collections)) clearList(key);
      feedback.textContent = '';
      return;
    }
    for (const label of panel.querySelectorAll('[data-share-de]')) {
      label.textContent = tr(label.dataset.shareDe, label.dataset.shareTr);
    }
    renderBookPicker();
    feedback.textContent = message ? tr(...message) : '';
    renderList('catalog', renderCatalog);
    renderList('own', renderOwn);
    if (reviewer) renderList('review', renderReview);
    else clearList('review');
    reload.hidden = !activeLists().some(key => lists[key].error);
    reload.disabled = busy;
  }

  async function load(key, page = lists[key].page) {
    if (!allowed() || (key === 'review' && !canReview())) return;
    const session = epoch;
    const state = lists[key];
    const serial = ++state.serial;
    const current = () => epoch === session && state.serial === serial && allowed() && (key !== 'review' || canReview());
    state.loading = true;
    state.error = false;
    render();
    try {
      const { data, error } = await db.rpc(collections[key].rpc, { start_at: page * pageSize });
      if (!current()) return;
      if (error || !Array.isArray(data)) throw error || new Error('Invalid catalog response');
      state.rows = data;
      state.page = page;
    } catch {
      if (current()) {
        state.error = true;
        state.rows = [];
      }
    } finally {
      if (current()) {
        state.loading = false;
        render();
      }
    }
  }

  async function refresh() {
    if (open) await Promise.all(activeLists().map(key => load(key)));
  }

  function explain(error) {
    if (error?.code === '23505') {
      return ['Für dieses Buch gibt es bereits eine aktive Freigabe oder Anfrage.', 'Bu kitap için zaten etkin bir paylaşım veya istek var.'];
    }
    if (error?.code === '42501') {
      return ['Für diese Aktion fehlt die Berechtigung.', 'Bu işlem için yetki yok.'];
    }
    if (error?.code === '22023') {
      return ['Dieser Eintrag ist nicht mehr aktuell. Lade die Liste neu.', 'Bu kayıt artık güncel değil. Listeyi yeniden yükle.'];
    }
    return ['Die Aktion konnte nicht gespeichert werden. Versuche es erneut.', 'İşlem kaydedilemedi. Tekrar dene.'];
  }

  async function write(rpc, args, success, after = () => {}) {
    if (!allowed() || busy) return;
    const session = epoch;
    const current = () => session === epoch && allowed();
    busy = true;
    message = null;
    render();
    try {
      const { error } = await db.rpc(rpc, args);
      if (!current()) return;
      if (error) throw error;
      after();
      message = success;
      await refresh();
    } catch (error) {
      if (current()) message = explain(error);
    } finally {
      if (session === epoch) {
        busy = false;
        render();
      }
    }
  }

  function withdraw(id) {
    void write('library_withdraw_book_share', { target_submission: id },
      ['Freigabe zurückgezogen.', 'Paylaşım geri çekildi.']);
  }

  function review(id, approve) {
    if (!canReview()) return;
    const result = approve ? ['Buch freigegeben.', 'Kitap paylaşıldı.'] : ['Anfrage abgelehnt.', 'İstek reddedildi.'];
    void write('library_review_book_share', { target_submission: id, approve }, result);
  }

  async function openPdf(id) {
    if (!allowed() || busy) return;
    const reader = window.open('about:blank', '_blank');
    if (!reader) {
      message = ['Bitte Pop-ups für diese Website erlauben.', 'Lütfen bu site için açılır pencerelere izin ver.'];
      render();
      return;
    }
    const session = epoch;
    const current = () => session === epoch && allowed();
    busy = true;
    message = null;
    render();
    try {
      reader.opener = null;
      const { data: path, error: lookupError } = await db.rpc('library_shared_book_pdf_path', { target_submission: id });
      if (!current() || reader.closed) { reader.close(); return; }
      if (lookupError || typeof path !== 'string' || !path) throw lookupError || new Error('Missing PDF path');
      const { data, error } = await db.storage.from(STORAGE_BUCKET).createSignedUrl(path, 60);
      if (!current() || reader.closed) { reader.close(); return; }
      if (error || !data?.signedUrl) throw error || new Error('Missing signed URL');
      reader.location.replace(data.signedUrl);
    } catch {
      reader.close();
      if (current()) {
        message = ['Diese PDF ist gerade nicht verfügbar. Lade die Liste neu.', 'Bu PDF şu anda açılamıyor. Listeyi yeniden yükle.'];
      }
    } finally {
      if (session === epoch) {
        busy = false;
        render();
      }
    }
  }

  function show(opener, scroll, focusReview = false) {
    if (!allowed()) return;
    if (opener) openedBy = opener;
    open = true;
    render();
    if (scroll) {
      const target = focusReview ? reviewSection : panel;
      target.scrollIntoView({ block: 'start', behavior: 'instant' });
      $(focusReview ? 'betaShareReviewTitle' : 'betaSharedLibraryTitle').focus({ preventScroll: true });
    }
    void refresh();
  }

  function syncPortal() {
    if (portal === 'shared') show(null, false);
    else {
      open = false;
      render();
    }
  }

  function syncAccess() {
    const next = accessState === 'approved' ? currentUser?.id ?? null : null;
    if (accessState !== 'loading' && next !== owner) {
      owner = next;
      epoch++;
      lists = newLists();
      open = busy = false;
      message = openedBy = null;
      resetSelection();
    }
    if (allowed() && portal === 'shared') {
      show(null, false);
      return;
    }
    render();
    if (allowed()) void refresh();
  }

  function syncRole() {
    if (!canReview()) {
      lists.review.serial++;
      lists.review = newList();
      clearList('review');
    }
    render();
    if (open && canReview()) void load('review');
  }

  for (const opener of [dash, adminOpener].filter(Boolean)) opener.setAttribute('aria-controls', panel.id);
  dash?.addEventListener('click', () => show(dash, true));
  adminOpener?.addEventListener('click', () => { if (canReview()) show(adminOpener, true, true); });
  $('betaShareClose').addEventListener('click', () => {
    if (portal === 'shared') switchPortal('library');
    open = false;
    render();
    openedBy?.focus();
  });
  bookPicker.addEventListener('change', renderBookPicker);
  form.addEventListener('submit', event => {
    event.preventDefault();
    const target = ownBooks().find(book => book.id === bookPicker.value);
    if (!target) return;
    const includePdf = Boolean(target.file_path && pdfChoice.checked);
    void write('library_submit_book_share', { target_book: target.id, include_pdf: includePdf },
      ['Buch zur Freigabe eingereicht.', 'Kitap paylaşım onayına gönderildi.'], () => {
        resetSelection();
        lists.own.page = 0;
      });
  });
  for (const [key, controls] of Object.entries(collections)) {
    controls.previous.addEventListener('click', () => { void load(key, Math.max(0, lists[key].page - 1)); });
    controls.next.addEventListener('click', () => { void load(key, lists[key].page + 1); });
  }
  reload.addEventListener('click', () => { void refresh(); });
  document.addEventListener('library-access', syncAccess);
  document.addEventListener('library-language', render);
  document.addEventListener('library-books', render);
  document.addEventListener('library-portal', syncPortal);
  document.addEventListener('beta-role-access', syncRole);
  syncAccess();
})();
