(() => {
  'use strict';

  const panel = $('betaMemberTools');
  const title = $('betaToolsTitle');
  const list = $('betaToolsList');
  const stateLabel = $('betaToolsState');
  const feedbackLabel = $('betaToolsFeedback');
  const retry = $('betaToolsRetry');
  const pages = $('betaToolsPages');
  const previous = $('betaPagePrev');
  const next = $('betaPageNext');
  const pageLabel = $('betaToolsPageLabel');
  const pageSize = 20;
  const sections = {
    notes: {
      table: 'library_notes', field: 'body', form: $('betaNotesForm'), heading: $('betaNotesFormTitle'),
      cancel: $('betaNotesCancel'), openers: [$('betaNotesNav')],
      title: ['Meine Notizen', 'Notlarım'], add: ['Neue Notiz', 'Yeni not'],
      edit: ['Notiz bearbeiten', 'Notu düzenle'], empty: ['Noch keine Notizen gespeichert.', 'Henüz kayıtlı not yok.'],
      remove: ['Diese Notiz löschen?', 'Bu not silinsin mi?']
    },
    wishlist: {
      table: 'library_wishlist', field: 'author', form: $('betaWishlistForm'), heading: $('betaWishlistFormTitle'),
      cancel: $('betaWishlistCancel'), openers: [$('betaWishlistNav'), $('betaWishlistDash')].filter(Boolean),
      title: ['Wunschliste', 'İstek Listesi'], add: ['Buch vormerken', 'Kitabı listeye ekle'],
      edit: ['Wunsch bearbeiten', 'Liste kaydını düzenle'], empty: ['Deine Wunschliste ist leer.', 'İstek listen boş.'],
      remove: ['Dieses Buch von der Wunschliste entfernen?', 'Bu kitap istek listesinden kaldırılsın mı?']
    }
  };
  const initialState = () => ({
    items: [], count: null, page: 0, request: 0, loading: false,
    error: false, busy: false, editing: null, feedback: null
  });
  let states = { notes: initialState(), wishlist: initialState() };
  let ownerId = null;
  let epoch = 0;
  let active = null;
  let focusedOpener = null;

  const approved = () => Boolean(ownerId && ownerId === currentUser?.id && accessState === 'approved');
  const value = (form, field) => form.elements.namedItem(field).value.trim();

  function selectRow(key, row = null) {
    const section = sections[key];
    states[key].editing = row;
    section.form.elements.namedItem('title').value = row?.title ?? '';
    section.form.elements.namedItem(section.field).value = row?.[section.field] ?? '';
  }

  function hasDraft(key) {
    const { form, field } = sections[key];
    const row = states[key].editing;
    return value(form, 'title') !== (row?.title ?? '') || value(form, field) !== (row?.[field] ?? '');
  }

  function allowReplaceDraft(key) {
    return !hasDraft(key) || confirm(tr('Nicht gespeicherte Änderungen verwerfen?', 'Kaydedilmemiş değişiklikler atılsın mı?'));
  }

  function rowButton(label, onClick, disabled) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.disabled = disabled;
    button.addEventListener('click', onClick);
    return button;
  }

  function renderItems(key) {
    const state = states[key];
    const entries = state.items.map(row => {
      const item = document.createElement('li');
      const heading = document.createElement('h3');
      heading.textContent = row.title;
      item.append(heading);
      const detail = row[sections[key].field];
      if (detail) {
        const content = document.createElement('p');
        content.textContent = detail;
        item.append(content);
      }
      const actions = document.createElement('div');
      actions.className = 'beta-tools-actions';
      actions.append(
        rowButton(tr('Bearbeiten', 'Düzenle'), () => {
          if (!approved() || state.busy || !allowReplaceDraft(key)) return;
          state.feedback = null;
          selectRow(key, row);
          renderTools();
          sections[key].form.elements.namedItem('title').focus();
        }, state.busy),
        rowButton(tr('Entfernen', 'Kaldır'), () => remove(key, row), state.busy)
      );
      item.append(actions);
      return item;
    });
    list.replaceChildren(...entries);
  }

  function renderTools() {
    const allowed = approved();
    const visible = allowed && active !== null;
    panel.hidden = !visible;
    for (const [key, section] of Object.entries(sections)) {
      const selected = visible && active === key;
      for (const opener of section.openers) {
        opener.hidden = !allowed;
        opener.setAttribute('aria-expanded', String(selected));
      }
      section.form.hidden = !selected;
      section.cancel.hidden = !states[key].editing;
      for (const field of section.form.elements) field.disabled = states[key].busy;
      section.heading.textContent = tr(...(states[key].editing ? section.edit : section.add));
    }
    const counter = $('dashWishlist');
    const wish = states.wishlist;
    if (counter) counter.textContent = allowed && wish.count !== null ? String(wish.count) : '—';
    if (!visible) {
      list.replaceChildren();
      feedbackLabel.textContent = '';
      stateLabel.textContent = '';
      return;
    }
    const state = states[active];
    const section = sections[active];
    title.textContent = tr(...section.title);
    panel.querySelectorAll('[data-beta-de]').forEach(element => {
      element.textContent = tr(element.dataset.betaDe, element.dataset.betaTr);
    });
    stateLabel.textContent = '';
    if (state.loading) stateLabel.textContent = tr('Wird geladen …', 'Yükleniyor …');
    else if (state.error) stateLabel.textContent = tr('Die Einträge konnten nicht geladen werden.', 'Kayıtlar yüklenemedi.');
    else if (state.items.length === 0) stateLabel.textContent = tr(...section.empty);
    feedbackLabel.textContent = state.feedback ? tr(...state.feedback) : '';
    retry.hidden = !state.error;
    const pageCount = Math.ceil((state.count ?? 0) / pageSize);
    pages.hidden = state.error || pageCount <= 1;
    previous.disabled = state.loading || state.busy || state.page === 0;
    next.disabled = state.loading || state.busy || state.page + 1 >= pageCount;
    pageLabel.textContent = tr(`Seite ${state.page + 1} von ${pageCount}`, `Sayfa ${state.page + 1} / ${pageCount}`);
    renderItems(active);
  }

  async function load(key, page = states[key].page) {
    if (!approved()) return;
    const session = epoch;
    const id = ownerId;
    const section = sections[key];
    const state = states[key];
    const request = ++state.request;
    const stillCurrent = () => session === epoch && state.request === request && approved();
    state.loading = true;
    state.error = false;
    renderTools();
    try {
      const start = page * pageSize;
      const { data, error, count } = await db.from(section.table)
        .select(`id,title,${section.field},updated_at`, { count: 'exact' })
        .eq('owner_id', id)
        .order('updated_at', { ascending: false })
        .order('id', { ascending: false })
        .range(start, start + pageSize - 1);
      if (!stillCurrent()) return;
      if (page > 0 && (error?.code === 'PGRST103' || (!error && !data?.length))) {
        await load(key, 0);
        return;
      }
      if (error) throw error;
      state.items = data ?? [];
      state.count = count ?? null;
      state.page = page;
    } catch {
      if (stillCurrent()) state.error = true;
    } finally {
      if (stillCurrent()) {
        state.loading = false;
        renderTools();
      }
    }
  }

  async function write(key, query, failed, success) {
    const session = epoch;
    const state = states[key];
    state.busy = true;
    state.feedback = null;
    renderTools();
    try {
      const result = await query;
      if (session !== epoch) return;
      if (result.error) throw result.error;
      if (!result.data) {
        state.feedback = [
          'Der Eintrag ist nicht mehr aktuell. Öffne ihn erneut in der Liste.',
          'Kayıt artık güncel değil. Listeden yeniden aç.'
        ];
      } else {
        success();
        state.feedback = ['Gespeichert.', 'Kaydedildi.'];
      }
      await load(key);
    } catch {
      if (session === epoch) state.feedback = failed;
    } finally {
      if (session === epoch) {
        state.busy = false;
        renderTools();
      }
    }
  }

  function save(key) {
    const state = states[key];
    if (!approved() || state.busy) return;
    const { form, field, table } = sections[key];
    const payload = { title: value(form, 'title'), [field]: value(form, field) };
    if (!payload.title || (key === 'notes' && !payload.body)) {
      state.feedback = ['Bitte fülle die Pflichtfelder aus.', 'Lütfen zorunlu alanları doldur.'];
      renderTools();
      return;
    }
    const row = state.editing;
    const base = db.from(table);
    const change = row
      ? base.update(payload).eq('id', row.id).eq('owner_id', ownerId).eq('updated_at', row.updated_at)
      : base.insert({ ...payload, owner_id: ownerId });
    void write(
      key, change.select('id').maybeSingle(),
      ['Speichern fehlgeschlagen. Dein Entwurf ist erhalten.', 'Kaydetme başarısız oldu. Taslağın duruyor.'],
      () => {
        selectRow(key);
        state.page = 0;
      }
    );
  }

  function remove(key, row) {
    const state = states[key];
    const section = sections[key];
    if (!approved() || state.busy || !confirm(tr(...section.remove))) return;
    const query = db.from(section.table).delete()
      .eq('id', row.id).eq('owner_id', ownerId).eq('updated_at', row.updated_at).select('id').maybeSingle();
    void write(
      key, query, ['Entfernen fehlgeschlagen.', 'Kaldırma başarısız oldu.'],
      () => {
        if (state.editing?.id === row.id) selectRow(key);
        if (state.items.length === 1 && state.page > 0) state.page--;
      }
    );
  }

  function open(key, opener) {
    if (!approved()) return;
    active = key;
    focusedOpener = opener;
    renderTools();
    panel.scrollIntoView({ block: 'start', behavior: 'instant' });
    title.focus({ preventScroll: true });
    void load(key);
  }

  function syncAccess() {
    const id = accessState === 'approved' ? currentUser?.id ?? null : null;
    // The app shows loading during token refresh, before it has verified the same member.
    if (accessState !== 'loading' && id !== ownerId) {
      epoch++;
      ownerId = id;
      active = null;
      focusedOpener = null;
      states = { notes: initialState(), wishlist: initialState() };
      for (const section of Object.values(sections)) section.form.reset();
    }
    renderTools();
    if (!approved()) return;
    void load('wishlist');
    if (active === 'notes') void load('notes');
  }

  for (const [key, section] of Object.entries(sections)) {
    for (const opener of section.openers) {
      opener.setAttribute('aria-controls', panel.id);
      opener.addEventListener('click', () => open(key, opener));
    }
    section.form.addEventListener('submit', event => {
      event.preventDefault();
      save(key);
    });
    section.cancel.addEventListener('click', () => {
      if (allowReplaceDraft(key)) {
        selectRow(key);
        states[key].feedback = null;
        renderTools();
      }
    });
  }
  $('betaToolsClose').addEventListener('click', () => {
    active = null;
    renderTools();
    focusedOpener?.focus();
  });
  retry.addEventListener('click', () => { if (active) void load(active); });
  previous.addEventListener('click', () => { if (active) void load(active, states[active].page - 1); });
  next.addEventListener('click', () => { if (active) void load(active, states[active].page + 1); });
  document.addEventListener('library-access', syncAccess);
  document.addEventListener('library-language', renderTools);
  syncAccess();
})();
