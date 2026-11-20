(() => {
  'use strict';

  const form = $('menbaForm');
  const picker = $('menbaSources');
  const sourceSummary = $('menbaSourcesSummary');
  const sourceStatus = $('menbaSourceStatus');
  const selectAll = $('menbaSelectAll');
  const saveSources = $('menbaSaveSources');
  const selectionStatus = $('menbaSelectionStatus');
  const localSaveHint = $('menbaLocalSaveHint');
  const question = $('menbaQuestion');
  const ask = $('menbaAsk');
  const status = $('menbaStatus');
  const results = $('menbaResults');
  const stop = $('menbaCancel');
  const ocrTools = $('menbaOcrTools');
  const ocrForm = $('menbaOcrForm');
  const ocrSource = $('menbaOcrSource');
  const quranFile = $('menbaQuranFile');
  const photoFile = $('menbaPhotoFile');
  const category = $('menbaCategory');
  const clearChat = $('menbaClearChat');
  const retry = $('menbaRetry');
  const learningMode = $('menbaMode');
  const learningTask = $('menbaTask');
  const useTopic = $('menbaUseTopic');
  const cloud = $('menbaCloudPilot');
  const consent = $('menbaCloudConsent');
  const pdfBase = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.5.438/';
  const hadisId = 'hadis-collection';
  const localQuranId = 'quran-on-device';
  const photoId = 'photo-on-device';
  const sourceKey = source => source.file || source.path || source.id;
  const selected = new Set();
  const cachedPages = new Map();
  const recognizedPages = new Map();
  const attemptedOcr = new Map();
  const sharedVersions = new Map();
  const sourceStates = new Map();
  const loadedIndexes = new Set();
  const fileVersions = new WeakMap();
  let owner = null;
  let accountEpoch = 0;
  let options = [];
  let sharedSources = [];
  let sharedState = 'idle';
  let sharedLoad = null;
  let loadingPreferences = false;
  let savingPreferences = false;
  let selectionNotice = null;
  let request = null;
  let pdfModule = null;
  let notice = null;
  let turns = [];
  let localQuran = null;
  let localPhoto = null;
  let retryQuestion = null;
  let hocaAllowed = false;
  let hocaRequest = 0;
  let nextDiagnosticAt = 0;

  function allowed() {
    return Boolean(owner && owner === currentUser?.id && accessState === 'approved');
  }

  const pickableSources = () => options.filter(source => selected.has(source.id));
  function sourcesChanged() {
    document.dispatchEvent(new Event('menba-source-change'));
  }

  function sourceLabels(source) {
    return {...source,
      quran: MenbaQuran.isSource(source.title) || MenbaQuran.isSource(source.fileName),
      hadith: MenbaSearch.isHadithSource(source.title) || MenbaSearch.isHadithSource(source.fileName)};
  }

  function syncSources() {
    if (!allowed()) return;
    const prior = new Map(options.map(source => [source.id, sourceKey(source)]));
    const privatePdfs = books.filter(book =>
      book.owner_id === owner && book.visibility === 'private' && !book.deleted_at && book.file_path
    );
    options = [
      {id:hadisId, title:'Haftanın Hadis-i Şerifleri', path:null, hadith:true},
      ...privatePdfs.map(book => sourceLabels({id:book.id, title:book.title || book.file_name || 'PDF',
        path:book.file_path, fileName:book.file_name, category:book.category})),
      ...sharedSources.map(sourceLabels)
    ];
    if (localQuran) options.push(localQuran);
    if (localPhoto) options.push(localPhoto);
    const active = new Set(options.map(source => source.id));
    const changed = new Set(options.filter(source => prior.has(source.id) && prior.get(source.id) !== sourceKey(source)).map(source => source.id));
    if (changed.size || prior.size !== options.length || options.some(source=>!prior.has(source.id))) sourcesChanged();
    const paths = new Set(options.map(sourceKey));
    for (const key of cachedPages.keys()) if (!paths.has(key)) cachedPages.delete(key);
    for (const key of recognizedPages.keys()) if (!paths.has(key)) recognizedPages.delete(key);
    for (const key of attemptedOcr.keys()) if (!paths.has(key)) attemptedOcr.delete(key);
    for (const key of sourceStates.keys()) if (!paths.has(key)) sourceStates.delete(key);
    for (const key of loadedIndexes) if (!paths.has(key)) loadedIndexes.delete(key);
    for (const key of sharedVersions.keys()) if (!active.has(key)) sharedVersions.delete(key);
    if (request && request.sources.some(source => !paths.has(sourceKey(source)))) {
      cancel();
      notice = ['Die Quellen wurden geändert. Stelle die Frage erneut.', 'Kaynaklar değişti. Soruyu yeniden sor.'];
    }
    const validTurns = turns.filter(turn => !turn.sources.some(source => !active.has(source.id) || changed.has(source.id)));
    if (validTurns.length !== turns.length) {
      turns = validTurns;
      notice = ['Die Quellen wurden geändert. Stelle die Frage erneut.', 'Kaynaklar değişti. Soruyu yeniden sor.'];
    }
    render();
    if (portal === 'menba') for (const source of pickableSources()) void useIndex(source);
  }

  async function indexVersion(source) {
    if (source.shareId || source.id === hadisId) return null;
    if (source.path) return `pdf-v1:${source.path}`;
    if (!source.file || !globalThis.crypto?.subtle) return null;
    if (!fileVersions.has(source.file)) fileVersions.set(source.file,(async file => {
      const digest = await crypto.subtle.digest('SHA-256',await file.arrayBuffer());
      return 'file-v1:'+Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
    })(source.file));
    return fileVersions.get(source.file);
  }

  async function useIndex(source, update) {
    const key = sourceKey(source);
    const account = owner;
    const epoch = accountEpoch;
    if (source.shareId || source.id === hadisId || (!update && loadedIndexes.has(key))) return;
    const current = () => allowed() && epoch === accountEpoch && options.some(option => sourceKey(option) === key);
    try {
      const version = await indexVersion(source);
      if (!version || !current()) return;
      if (update) {
        await MenbaSourcePreferences.saveIndex(account,source.id,version,update);
        return true;
      }
      const index = await MenbaSourcePreferences.loadIndex(account,source.id,version);
      if (!current()) return;
      loadedIndexes.add(key);
      if (!index) return;
      const label = row => ({...row,sourceId:source.id,source:source.title});
      if (!cachedPages.has(key) && index.parsed) cachedPages.set(key,{...index.parsed,pages:index.parsed.pages.map(label)});
      if (!recognizedPages.has(key) && index.ocr?.length) recognizedPages.set(key,new Map(index.ocr.map(row=>[row.page,label(row)])));
      updateSourceBadge(source);
    } catch { /* The current tab can still search when browser storage is unavailable. */ }
  }

  function statusFor(source) {
    const key = sourceKey(source);
    const state = sourceStates.get(key);
    if (state === 'working') return tr('Wird verarbeitet', 'İşleniyor');
    if (state === 'error') return tr('Verarbeitungsfehler', 'Hata');
    const pdf = cachedPages.get(key);
    const ocr = recognizedPages.get(key);
    const ready = new Set([...(pdf?.pages.map(row=>row.page) ?? []),...(ocr?.keys() ?? [])]).size;
    const total = source.image ? 1 : pdf?.totalPages;
    if (ready && total && ready < total) return tr(`Teilweise bereit (${ready}/${total})`, `Kısmen hazır (${ready}/${total})`);
    if (ready) return tr('Bereit', 'Hazır');
    if (state === 'unreadable' || pdf?.totalPages) return tr('Kein lesbarer Text', 'Metin tanınamadı');
    return tr('Noch nicht geladen', 'Henüz yüklenmedi');
  }

  function setSourceState(source,state) {
    const key = sourceKey(source);
    if (state) sourceStates.set(key,state);
    else sourceStates.delete(key);
    updateSourceBadge(source);
  }

  function updateSourceBadge(source) {
    for (const label of picker.querySelectorAll('label')) {
      if (label.querySelector('input').value === source.id) label.querySelector('small').textContent = statusFor(source);
    }
  }

  async function refreshSharedSources() {
    if (!allowed() || sharedLoad) return;
    const controller = new AbortController();
    sharedLoad = controller;
    sharedState = 'loading';
    renderSourceControls();
    try {
      const catalog = await MenbaSharedSources.list({accountId:owner, signal:controller.signal});
      if (sharedLoad !== controller || !allowed()) return;
      sharedSources = catalog;
      sharedState = 'ready';
    } catch {
      if (sharedLoad !== controller || !allowed()) return;
      sharedSources = [];
      sharedState = 'unavailable';
    } finally {
      if (sharedLoad === controller) {
        sharedLoad = null;
        syncSources();
      }
    }
  }

  async function restoreSelection(accountId, epoch) {
    try {
      const preferences = await MenbaSourcePreferences.load(accountId);
      if (epoch !== accountEpoch || !allowed() || !preferences) return;
      selected.clear();
      for (const id of preferences.ids) selected.add(id);
      if (preferences.file && selected.has(localQuranId)) {
        localQuran = {id:localQuranId, title:preferences.file.name, file:preferences.file, quran:true};
      }
    } catch {
      if (epoch === accountEpoch && allowed()) {
        selectionNotice = ['Die gespeicherte Auswahl ließ sich nicht laden.', 'Kaydedilen seçim yüklenemedi.'];
      }
    } finally {
      if (epoch === accountEpoch && allowed()) {
        loadingPreferences = false;
        syncSources();
      }
    }
  }

  function preferencesChanged() {
    sourcesChanged();
    selectionNotice = null;
    renderSourceControls();
  }

  async function saveSelection() {
    if (!allowed() || loadingPreferences || savingPreferences || request) return;
    const epoch = accountEpoch;
    const ids = [...selected];
    const file = selected.has(localQuranId) ? localQuran?.file ?? null : null;
    savingPreferences = true;
    selectionNotice = null;
    render();
    try {
      await MenbaSourcePreferences.save(owner, {ids, file});
      if (epoch === accountEpoch && allowed()) {
        selectionNotice = ['Auswahl für dein Konto auf diesem Gerät gespeichert.', 'Seçim, hesabın için bu cihaza kaydedildi.'];
      }
    } catch {
      if (epoch === accountEpoch && allowed()) {
        selectionNotice = ['Die Auswahl konnte auf diesem Gerät nicht gespeichert werden.', 'Seçim bu cihaza kaydedilemedi.'];
      }
    } finally {
      if (epoch === accountEpoch && allowed()) {
        savingPreferences = false;
        render();
      }
    }
  }

  function cancel() {
    if (!request) return;
    const previous = request;
    request = null;
    previous.controller.abort();
    if (previous.turn && !previous.turn.notice) {
      previous.turn.notice = ['Suche abgebrochen.', 'Arama iptal edildi.'];
    }
    if (previous.task) {
      const task = previous.task;
      previous.task = null;
      void task.destroy().catch(() => {});
    }
  }

  function renderSourceControls() {
    const canAsk = allowed();
    const busy = request !== null || loadingPreferences || savingPreferences;
    const pickedCount = pickableSources().length;
    sourceSummary.textContent = tr(`Quellen (${pickedCount})`, `Kaynaklar (${pickedCount})`);
    const loading = !booksLoaded || loadingPreferences || sharedState === 'loading';
    sourceStatus.textContent = !canAsk ? '' : loading ? tr('Quellen werden geladen …', 'Kaynaklar yükleniyor …')
      : sharedState === 'unavailable' ? tr('Gemeinsame Quellen konnten nicht geladen werden.', 'Ortak kaynaklar yüklenemedi.') : '';
    selectAll.disabled = !canAsk || busy || loading || !options.length;
    selectAll.textContent = options.length && pickedCount === options.length
      ? tr('Alle abwählen', 'Tüm seçimi kaldır') : tr('Alle auswählen', 'Tümünü seç');
    saveSources.disabled = !canAsk || busy;
    selectionStatus.textContent = selectionNotice ? tr(...selectionNotice) : '';
    localSaveHint.hidden = !(canAsk && localQuran && selected.has(localQuranId));
  }

  function render() {
    const canAsk = allowed();
    const busy = request !== null || loadingPreferences;
    renderSourceControls();
    const priorCategory = category.value;
    const categories = [...new Set(options.map(source => source.category).filter(Boolean))].sort();
    category.replaceChildren(new Option(tr('Alle Kategorien','Tüm kategoriler'),''),...categories.map(name=>new Option(categoryLabel(name),name)));
    if (categories.includes(priorCategory)) category.value = priorCategory;
    const visibleSources = options.filter(source => !category.value || source.category === category.value);
    const choices = canAsk ? visibleSources.map(source => {
      const label = document.createElement('label');
      label.className = 'menba-source-option';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = source.id;
      input.checked = selected.has(source.id);
      input.disabled = busy || savingPreferences;
      const name = document.createElement('span');
      name.textContent = source.id === hadisId ? tr('Haftanın Hadis-i Şerifleri · Textfassung', 'Haftanın Hadis-i Şerifleri · Metin')
        : source.shareId ? `${source.title} · ${tr('Gemeinsame Bibliothek', 'Ortak Kütüphane')}` : source.title;
      const state = document.createElement('small');
      state.textContent = statusFor(source);
      name.append(state);
      label.append(input, name);
      return label;
    }) : [];
    picker.replaceChildren(...choices);
    quranFile.disabled = !canAsk || busy || savingPreferences;
    photoFile.disabled = quranFile.disabled;
    category.disabled = !canAsk || busy || !categories.length;
    clearChat.hidden = !canAsk || !turns.length;
    clearChat.disabled = !canAsk || busy || !turns.length;
    retry.hidden = !canAsk || !retryQuestion;
    retry.disabled = busy;
    renderLearning(canAsk,busy);
    cloud.hidden = !canAsk || !MenbaCloudChat.canUse(cloud.dataset.endpoint);
    consent.disabled = busy;
    const scans = options.filter(source => source.id !== hadisId);
    const previous = ocrSource.value;
    ocrTools.hidden = !canAsk || !scans.length;
    ocrSource.replaceChildren(...scans.map(source => new Option(source.title,source.id)));
    if (scans.some(source => source.id === previous)) ocrSource.value = previous;
    for (const input of ocrForm.elements) input.disabled = !canAsk || busy;
    updateOcrControls();
    stop.hidden = !request;
    ask.disabled = !canAsk || busy;
    question.disabled = !canAsk || busy;
    ask.textContent = request ? tr('Suche läuft …', 'Aranıyor …') : tr('Frage stellen', 'Sor');
    renderNotice();
    form.setAttribute('aria-busy', String(busy));
    results.replaceChildren(...turns.map(renderTurn));
    document.dispatchEvent(new CustomEvent('menba-busy',{detail:busy}));
  }

  function renderLearning(canAsk,busy) {
    if (hocaAllowed && !learningMode.querySelector('[value="hoca"]')) {
      learningMode.add(new Option('Hoca Modu','hoca'));
    }
    if (!hocaAllowed) learningMode.querySelector('[value="hoca"]')?.remove();
    $('menbaHocaNav').hidden = !canAsk || !hocaAllowed;
    for (const button of document.querySelectorAll('[data-menba-mode]')) {
      if (portal === 'menba' && learningMode.value === button.dataset.menbaMode) button.setAttribute('aria-current','page');
      else button.removeAttribute('aria-current');
    }
    if (portal === 'menba' && learningMode.value !== 'chat') {
      document.querySelector('#librarySidebar [data-sidebar-portal="menba"]')?.removeAttribute('aria-current');
    }
    const info = $('menbaModeInfo');
    info.hidden = learningMode.value === 'chat';
    info.replaceChildren();
    if (!info.hidden) {
      const heading = document.createElement('h3');
      heading.textContent = learningMode.selectedOptions[0].textContent+' · '+tr('Beta-Version','Beta Sürümü');
      const hoca = learningMode.value === 'hoca';
      info.append(heading,paragraph(hoca
        ? tr('Plane deinen Unterricht und entwirf Quiz und Hausaufgaben mit ausgewählten Quellen.',
          'Derslerini planla, seçili kaynaklarla test ve ödev taslakları hazırla.')
        : tr('Wiederhole Themen, löse Übungen und prüfe dein Wissen mit MENBA.',
          'Konuları tekrar et, alıştırmaları çöz ve MENBA ile kendini sına.')));
    }
    const picked = learningTask.value;
    const activities = MenbaLearning.tasks[learningMode.value] ?? [];
    learningTask.replaceChildren(...activities.map(([key,de,turkish])=>new Option(tr(de,turkish),key)));
    if (activities.some(([key])=>key === picked)) learningTask.value = picked;
    $('menbaTaskField').hidden = !activities.length;
    useTopic.hidden = !activities.length || !turns.length;
    for (const control of [learningMode,learningTask,useTopic]) control.disabled = !canAsk || busy;
  }

  async function syncHoca() {
    const version = ++hocaRequest;
    if (!allowed()) return;
    if (learningMode.dataset.hocaRoles !== 'true') {
      hocaAllowed = document.documentElement.dataset.betaOwner === 'true';
      renderLearning(true,Boolean(request || loadingPreferences));
      return;
    }
    const account = owner;
    try {
      const {data,error} = await db.rpc('library_menba_access');
      if (version !== hocaRequest || !allowed() || account !== owner) return;
      hocaAllowed = error ? document.documentElement.dataset.betaOwner === 'true'
        : Array.isArray(data) && data.some(row => row.user_id === account && row.is_hoca === true);
      renderLearning(true,Boolean(request || loadingPreferences));
    } catch { /* Role and session checks continue to guard the owner and Hoca controls. */ }
  }

  function updateOcrControls() {
    const photo = ocrSource.value === photoId;
    ocrForm.querySelector('.menba-page-range').hidden = photo;
    for (const id of ['menbaOcrStart','menbaOcrEnd']) $(id).required = !photo;
    $('menbaOcrNext').hidden = photo;
  }

  function renderNotice() {
    status.textContent = notice ? tr(...notice) : '';
  }

  function paragraph(value, className = '') {
    const element = document.createElement('p');
    element.dir = 'auto';
    element.className = className;
    element.textContent = value;
    return element;
  }

  function helpButton(de,turkish,action) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'menba-help-button';
    button.textContent = tr(de,turkish);
    button.addEventListener('click',action);
    return button;
  }

  function showSources() {
    sourceSummary.parentElement.open = true;
    sourceSummary.focus();
  }

  function renderTurn(turn) {
    const item = document.createElement('article');
    item.className = 'menba-turn';
    item.append(paragraph(turn.question,'menba-user'));
    if (!turn.notice) return item;
    const reply = document.createElement('div');
    reply.className = 'menba-reply';
    const heading = document.createElement('h3');
    heading.textContent = 'MENBA';
    reply.append(heading);
    if (turn.answer) {
      const references = turn.answer.citations.map(number => `[${number}]`).join(' ');
      reply.append(paragraph(`${turn.answer.text} ${references}`, 'menba-answer'));
    } else reply.append(paragraph(tr(...turn.notice)));
    if (turn.warning.length) reply.append(paragraph(turn.warning.map(message => tr(...message)).join(' '),'menba-status'));
    if (turn.learning) {
      const study = document.createElement('section');
      study.className = 'menba-learning-card';
      const title = document.createElement('h4');
      title.textContent = tr(...turn.learning.title);
      study.append(title);
      if (turn.learning.draft) study.append(paragraph(tr('Unterrichtsentwurf zur Prüfung','İnceleme için ders taslağı')));
      if (turn.learning.steps.length) {
        const steps = document.createElement('ol');
        for (const step of turn.learning.steps) {
          const line = document.createElement('li');
          line.textContent = tr(...step);
          steps.append(line);
        }
        study.append(steps);
      }
      reply.append(study);
    }
    if (turn.mode === 'talebe' && turn.evidence.length) {
      const mark = document.createElement('button');
      mark.type = 'button';
      mark.className = 'menba-mark';
      const update = () => {
        mark.setAttribute('aria-pressed',String(Boolean(turn.difficult)));
        mark.textContent = turn.difficult ? tr('Als schwierig markiert','Zor olarak işaretlendi') : tr('Als schwierig markieren','Zor olarak işaretle');
      };
      update();
      mark.addEventListener('click',()=>{ turn.difficult = !turn.difficult; update(); });
      reply.append(mark);
    }
    turn.evidence.forEach((entry,index) => {
      const passage = document.createElement('div');
      passage.className = 'menba-passage';
      const quote = document.createElement('blockquote');
      quote.append(...entry.text.split(/\r?\n/u).map(line => paragraph(line)));
      const verse = entry.verse ? `${tr('Koran', 'Kur’an')} ${entry.verse} · ` : '';
      const pageLabel = entry.quran ? tr('PDF-Seite', 'PDF sayfası') : tr('Seite', 'Sayfa');
      const locator = entry.sourceId === photoId ? tr('Seitenfoto','Sayfa fotoğrafı') : `${pageLabel} ${entry.page}`;
      const cite = paragraph(`[${index+1}] ${verse}${entry.source} · ${locator}${entry.ocr ? ' · OCR' : ''}`,'menba-citation');
      if (entry.meal) passage.append(paragraph(tr('Türkische Bedeutung aus der PDF', 'PDF’den Türkçe meal'), 'menba-meal-label'));
      const quiz = turn.learning?.quiz?.[index];
      if (quiz) {
        const reveal = document.createElement('details');
        const summary = document.createElement('summary');
        summary.textContent = tr('Lösung und Fundstelle anzeigen','Cevabı ve kaynağı göster');
        reveal.append(summary,paragraph(quiz.answer),quote);
        passage.append(paragraph(quiz.prompt),reveal,cite);
      } else passage.append(quote,cite);
      if ((entry.quran || entry.ocr && entry.sourceId !== photoId) && !quiz) {
        if (entry.preview) {
          const frame = document.createElement('div');
          frame.className = 'menba-original-frame';
          frame.dir = entry.ranges ? 'rtl' : 'ltr';
          const preview = document.createElement('img');
          preview.className = 'menba-original';
          preview.src = entry.preview;
          preview.alt = entry.ranges ? tr(`Arabischer Originalvers ${entry.verse}`, `${entry.verse} ayetinin Arapça aslı`)
            : tr(`Originalseite ${entry.page}`, `Özgün PDF sayfası ${entry.page}`);
          frame.append(preview);

          const zoom = document.createElement('button');
          zoom.type = 'button';
          zoom.className = 'menba-original-zoom';
          const updateZoom = () => {
            const expanded = Boolean(entry.zoomed);
            frame.dataset.expanded = String(expanded);
            frame.tabIndex = expanded ? 0 : -1;
            zoom.setAttribute('aria-expanded', String(expanded));
            zoom.textContent = expanded ? tr('Original verkleinern', 'Orijinali küçült')
              : tr('Original vergrößern', 'Orijinali büyüt');
          };
          zoom.addEventListener('click', () => { entry.zoomed = !entry.zoomed; updateZoom(); });
          updateZoom();
          passage.prepend(frame, zoom);
        } else {
          const button = document.createElement('button');
          button.type = 'button';
          button.className = 'menba-original-button';
          button.textContent = entry.ranges ? tr('Arabischen Vers anzeigen', 'Arapça ayeti göster')
            : tr('Originalseite anzeigen', 'PDF sayfasını göster');
          button.disabled = request !== null;
          button.addEventListener('click', () => void showOriginal(entry, turn));
          passage.append(button);
        }
      }
      reply.append(passage);
    });
    if (!turn.evidence.length) {
      const actions = document.createElement('div');
      actions.append(
        helpButton('Quellen auswählen','Kaynak Seç',showSources),
        helpButton('Beispielfragen','Örnek Sorular',()=>{
          const templates = $('menbaQuestionTemplates');
          templates.open = true;
          templates.querySelector('summary').focus();
        }),
        helpButton('Andere Frage stellen','Başka Soru Dene',()=>question.focus())
      );
      reply.append(actions);
    }
    item.append(reply);
    return item;
  }

  async function fetchHadis(work) {
    const response = await fetch('hadis-text.json', {signal:work.controller.signal});
    if (!response.ok) throw Error('Source is not available');
    const entries = await response.json();
    return entries.map(entry => ({
      sourceId:hadisId,
      source:`Haftanın Hadis-i Şerifleri · Hadis ${entry.number}`,
      page:entry.number <= 22 ? 1 : 2,
      text:`${entry.arabic}\n${entry.turkish}`
    }));
  }

  function clearSharedText(source, work) {
    cachedPages.delete(source.id);
    recognizedPages.delete(source.id);
    attemptedOcr.delete(source.id);
    sharedVersions.delete(source.id);
    sourcesChanged();
    turns = turns.filter(turn => turn === work.turn || !turn.sources.some(item => item.id === source.id));
    if (work.turn?.evidence.some(entry => entry.sourceId === source.id)) {
      work.turn.answer = null;
      work.turn.evidence = work.turn.evidence.filter(entry => entry.sourceId !== source.id);
      if (!work.turn.evidence.length) {
        work.turn.notice = ['Die PDF-Freigabe hat sich geändert. Stelle die Frage erneut.', 'PDF erişimi değişti. Soruyu yeniden sor.'];
      }
    }
  }

  async function authorizeShared(source, work) {
    const {signal} = work.controller;
    try {
      const grant = await MenbaSharedSources.signedUrl(source, {accountId:owner, signal});
      if (sharedVersions.has(source.id) && sharedVersions.get(source.id) !== grant.path) clearSharedText(source, work);
      sharedVersions.set(source.id, grant.path);
      return grant;
    } catch (error) {
      if (request === work && allowed() && !signal.aborted) clearSharedText(source, work);
      throw error;
    }
  }

  async function openPdf(source, work, grant) {
    const {signal} = work.controller;
    let bytes;
    if (source.file) bytes = await source.file.arrayBuffer();
    else {
      const {data, error} = source.shareId
        ? {data:{signedUrl:(grant ?? await authorizeShared(source, work)).url}}
        : await db.storage.from(STORAGE_BUCKET).createSignedUrl(source.path, 60);
      signal.throwIfAborted();
      if (error || !data?.signedUrl) throw Object.assign(new Error('PDF access denied'),{stage:'sign'});
      const response = await fetch(data.signedUrl, {signal, referrerPolicy:'no-referrer'}).catch(error=>{
        signal.throwIfAborted();
        throw Object.assign(new Error('PDF download failed',{cause:error}),{stage:'download'});
      });
      if (!response.ok) throw Object.assign(new Error('PDF unavailable'),{stage:`HTTP ${response.status}`});
      bytes = await response.arrayBuffer();
    }
    if (!(bytes.byteLength > 0 && bytes.byteLength <= 50*1024*1024)) {
      throw Object.assign(new Error('Invalid PDF size'),{stage:'size'});
    }
    work.report?.(source,'download',{bytes:bytes.byteLength});
    pdfModule ??= import(pdfBase+'build/pdf.min.mjs').catch(error => { pdfModule = null; throw error; });
    const pdfjs = await pdfModule;
    signal.throwIfAborted();
    pdfjs.GlobalWorkerOptions.workerSrc = pdfBase+'build/pdf.worker.min.mjs';
    const task = pdfjs.getDocument({
      data:bytes, isEvalSupported:false, cMapUrl:pdfBase+'cmaps/', cMapPacked:true,
      standardFontDataUrl:pdfBase+'standard_fonts/', wasmUrl:pdfBase+'wasm/'
    });
    work.task = task;
    return task.promise;
  }

  async function extractPdf(source, work, grant, requireQuran) {
    const {signal} = work.controller;
    try {
      const pdf = await openPdf(source, work, grant);
      const metadata = await pdf.getMetadata().catch(() => null);
      const parsedEdition = MenbaQuranEdition.isEdition(metadata);
      const quran = source.quran || parsedEdition || MenbaQuran.isSource(metadata?.info?.Title);
      if (requireQuran && !quran) return null;
      const pages = [];
      const failedPages = [];
      for (let number = 1; number <= pdf.numPages; number++) {
        signal.throwIfAborted();
        if (number === 1 || number % 20 === 0 || number === pdf.numPages) work.report?.(source,'page',{number,total:pdf.numPages});
        let page;
        try {
          page = await pdf.getPage(number);
          const {items} = await page.getTextContent();
          const verses = parsedEdition ? MenbaQuranEdition.parse(items,number) : [];
          const text = parsedEdition ? verses.map(row => row.text).join('\n')
            : items.map(item => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '')).join('').trim();
          if (/\p{L}/u.test(text)) pages.push({sourceId:source.id, source:source.title, page:number, text, verses});
        } catch {
          signal.throwIfAborted();
          failedPages.push(number);
        } finally { page?.cleanup(); }
      }
      return {pages,quran,totalPages:pdf.numPages,failedPages};
    } finally {
      await releasePdf(work);
    }
  }

  async function releasePdf(work) {
    if (!work.task) return;
    const task = work.task;
    work.task = null;
    await task.destroy().catch(() => {});
  }

  async function originalImage(entry,source,work) {
    const {signal} = work.controller;
    try {
      const grant = source.shareId ? await authorizeShared(source,work) : null;
      if (grant && grant.path !== entry.sharedVersion) throw Error('Shared PDF version changed');
      const pdf = await openPdf(source,work,grant);
      const page = await pdf.getPage(entry.page);
      signal.throwIfAborted();
      const base = page.getViewport({scale:1});
      const viewport = page.getViewport({scale:Math.min(3,1900/Math.max(base.width,base.height))});
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const canvasContext = canvas.getContext('2d',{alpha:false});
      const renderTask = page.render({canvas,canvasContext,viewport,background:'#fff'});
      const abort = () => renderTask.cancel();
      signal.addEventListener('abort',abort,{once:true});
      try {
        await renderTask.promise;
        signal.throwIfAborted();
        if (!entry.ranges?.length) return canvas.toDataURL('image/png');
        const [a,b,c,d,e,f] = viewport.transform;
        const lines = entry.ranges.map(([left,bottom,right,top]) => {
          const x1 = a*left + c*bottom + e;
          const x2 = a*right + c*top + e;
          const y1 = b*left + d*bottom + f;
          const y2 = b*right + d*top + f;
          return [Math.floor(Math.min(x1,x2)),Math.floor(Math.min(y1,y2)),Math.ceil(Math.abs(x2-x1)),Math.ceil(Math.abs(y2-y1))];
        });
        const crop = document.createElement('canvas');
        const padding = 12;
        crop.width = Math.max(...lines.map(([, ,width]) => width)) + 2*padding;
        crop.height = lines.reduce((height,[,,,lineHeight]) => height+lineHeight,2*padding);
        const context = crop.getContext('2d',{alpha:false});
        context.fillStyle = '#fff';
        context.fillRect(0,0,crop.width,crop.height);
        let top = padding;
        for (const [left,y,width,height] of lines) {
          context.drawImage(canvas,left,y,width,height,crop.width-padding-width,top,width,height);
          top += height;
        }
        return crop.toDataURL('image/png');
      } finally {
        signal.removeEventListener('abort',abort);
        page.cleanup();
      }
    } finally {
      await releasePdf(work);
    }
  }

  async function showOriginal(entry,turn) {
    const source = turn.sources.find(option => option.id === entry.sourceId);
    if (!allowed() || request || !source) return;
    const work = {controller:new AbortController(),sources:[source],task:null};
    request = work;
    notice = ['Original wird aus der PDF geladen …', 'Orijinal metin PDF’den yükleniyor …'];
    render();
    try {
      const preview = await originalImage(entry,source,work);
      if (request === work && allowed()) { entry.preview = preview; notice = null; }
    } catch {
      if (request === work) notice = ['Die Originalseite konnte nicht angezeigt werden.', 'Özgün sayfa görüntülenemedi.'];
    } finally {
      if (request === work) { request = null; render(); }
    }
  }

  function progress(source) {
    notice = [`Durchsuche „${source.title}“ …`, `“${source.title}” taranıyor …`];
    renderNotice();
  }

  function addDocumentPages(pages, parsed, ocr) {
    const verses = new Set(parsed.pages.filter(page=>page.verses?.length).map(page=>page.page));
    for (const page of parsed.pages) if (verses.has(page.page) || !ocr?.has(page.page)) pages.push(page);
    if (ocr) pages.push(...[...ocr.values()].filter(page=>!verses.has(page.page)));
  }

  function quranSourceHelp() {
    return ['Wähle unter Quellen eine Koran-PDF aus oder öffne sie von deinem Gerät.', 'Kaynaklar bölümünde bir Kur’an PDF’si seç veya cihazından aç.'];
  }

  function contextFor(question, intent, last) {
    if (!last?.evidence.length) return null;
    if (intent?.kind === 'exception' || intent?.kind === 'source') return last;
    const normalized = question.normalize('NFKD').toLowerCase().replace(/\p{M}/gu,'').replaceAll('ı','i').trim();
    const referring = /^(?:(?:und|aber|peki)\s+)?(?:warum|wieso|gibt es ausnahmen|was bedeutet (?:das|dies)|wie ist das gemeint|kannst du das (?:einfacher|genauer) erklaren|wo steht (?:das|es)|welche quelle|neden|niye|istisnasi var mi|bu ne demek|bunu acikla|(?:bunu )?(?:daha )?basit anlat|hocam[,]? anlamadim|hangi ayet|nerede yaziyor|kaynagi ne)\s*[?.!]*$/u;
    return referring.test(normalized) ? last : null;
  }

  function requestsSource(question) {
    return /^(?:(?:und|peki)\s+)?(?:wo steht (?:das|es)|welche quelle|hangi ayet|nerede yazıyor|kaynağı ne)\s*[?.!]*$/iu.test(question.trim());
  }

  function answerLanguage(question) {
    if (/\b(?:auf deutsch|almanca)\b/iu.test(question)) return 'de';
    if (/\b(?:auf türkisch|türkçe)\b/iu.test(question)) return 'tr';
    if ((question.match(/\p{Script=Arabic}/gu)?.length ?? 0) >= 5) return 'ar';
    if (/\b(?:ist|sind|warum|wo steht|welche|schwein(?:efleisch)?|kannst|darf|darfst)\b/iu.test(question)) return 'de';
    if (/[çğıöşüİ]/u.test(question) || /\b(?:domuz|haram mi|nedir|neden|nedeni|nasil|peki|hangi|ne demek)\b/iu.test(question)) return 'tr';
    return lang;
  }

  const isQuran = source => source.quran || cachedPages.get(sourceKey(source))?.quran === true;

  async function collectSources(work,quranOnly = false) {
    const pages = [];
    const quranSources = new Set();
    const unavailable = [];
    const scans = [];
    let foundQuran = work.sources.some(isQuran);
    for (const source of work.sources) {
      if (request !== work) return;
      progress(source);
      const key = sourceKey(source);
      let grant;
      try {
        if (source.shareId) grant = await authorizeShared(source,work);
        await useIndex(source);
        if (request !== work || !allowed()) return;
        let extracted = cachedPages.get(key);
        if (work.force || !extracted) {
          setSourceState(source,'working');
          extracted = source.id === hadisId ? {pages:await fetchHadis(work), quran:false}
            : source.image ? {pages:[],quran:false,totalPages:1} : await extractPdf(source, work, grant, quranOnly);
          if (request !== work || !allowed()) return;
          if (extracted) {
            cachedPages.set(key, extracted);
            sourcesChanged();
            const persisted = await useIndex(source,{parsed:extracted});
            work.report?.(source,'extract',{total:extracted.totalPages ?? extracted.pages.length,readable:extracted.pages.length,failed:extracted.failedPages?.length ?? 0,persisted:Boolean(persisted)});
          }
          if (request !== work || !allowed()) return;
        }
        if (!extracted || (quranOnly && !extracted.quran)) continue;
        if (extracted.quran) { foundQuran = true; quranSources.add(source.id); }
        const ocr = recognizedPages.get(key);
        const indexed = new Set([...extracted.pages.map(page=>page.page),...(ocr?.keys() ?? [])]);
        const failed = (extracted.failedPages ?? []).some(page=>!indexed.has(page));
        if (failed) unavailable.push(source.title);
        if (extracted.totalPages && indexed.size < extracted.totalPages && !failed) {
          scans.push(indexed.size ? `${source.title} (${indexed.size}/${extracted.totalPages})` : source.title);
        }
        addDocumentPages(pages,extracted,ocr);
        setSourceState(source,failed && !indexed.size ? 'error' : null);
      } catch (error) {
        if (request !== work) return;
        work.report?.(source,'error',error?.stage ?? 'extract');
        const ocr = !source.shareId || grant ? recognizedPages.get(key) : null;
        if (ocr?.size && (!quranOnly || isQuran(source))) {
          foundQuran ||= isQuran(source);
          if (isQuran(source)) quranSources.add(source.id);
          pages.push(...ocr.values());
        }
        else { unavailable.push(source.title); setSourceState(source,'error'); }
      } finally {
        if (sourceStates.get(key) === 'working') setSourceState(source,null);
      }
    }
    if (request !== work || !allowed()) return;
    return {pages,quranSources,unavailable,scans,foundQuran};
  }

  async function run(force = false) {
    const text = question.value.trim();
    if (!allowed() || request || loadingPreferences || !text) return;
    retryQuestion = null;
    const last = turns.at(-1);
    const useCloud = consent.checked && !cloud.hidden;
    consent.checked = false;
    const mode = learningMode.value;
    const task = learningTask.value;
    const directIntent = MenbaAnswers.inspect(text);
    const intent = directIntent ?? MenbaAnswers.inspect(text,last?.answer ? last.intent : null);
    const previous = directIntent ? null : contextFor(text,intent,last);
    const retrievalQuestion = previous?.retrievalQuestion ?? text;
    const picked = pickableSources();
    const plan = MenbaQuestionChecks.plan(retrievalQuestion,pickableSources(),intent,isQuran,hadisId);
    const {sources,quran,quranOnly,hadith} = plan;
    if (!sources.length) {
      sourceSummary.parentElement.open = true;
      if (quranOnly) notice = quranSourceHelp();
      else if (hadith) notice = ['Wähle unter Quellen eine Hadis-Sammlung aus.', 'Kaynaklar bölümünde bir Hadis derlemesi seç.'];
      else notice = ['Wähle zuerst eine Quelle.', 'Lütfen önce kaynak seçin.'];
      renderNotice();
      return;
    }
    if (quranOnly && !quran.topic && !quran.reference) {
      notice = ['Nenne ein Thema wie Namaz oder eine Versnummer wie 2:43.', 'Namaz gibi bir konu veya 2:43 gibi bir ayet numarası yaz.'];
      renderNotice();
      return;
    }
    const turn = {question:text, retrievalQuestion, sources, evidence:[], notice:null, warning:[], answer:null, intent, mode};
    const work = {controller:new AbortController(), sources, task:null, turn, force};
    request = work;
    turns.push(turn);
    question.value = '';
    render();
    try {
      const snapshot = await collectSources(work,quranOnly);
      if (!snapshot) return;
      const {unavailable,scans,foundQuran} = snapshot;
      const {evidence,quranRows} = MenbaQuestionChecks.rank(plan,snapshot,hadisId);
      turn.evidence = evidence.map(entry=>({...entry,sharedVersion:sharedVersions.get(entry.sourceId)}));
      turn.answer = MenbaQuestionChecks.localAnswer(retrievalQuestion,intent,turn.evidence,answerLanguage(text));
      if (mode !== 'chat') {
        turn.learning = MenbaLearning.prepare(mode,task,turn.evidence);
        if (turn.learning?.quiz) turn.answer = null;
      }
      let modelFailure = null;
      if (useCloud && !turn.answer && !turn.learning?.quiz && turn.evidence.some(entry=>!entry.ocr)
          && (mode === 'chat' || mode === 'talebe' && ['explain','simple'].includes(task))) {
        notice = ['Formulierte Antwort wird geprüft …','Yazılı yanıt doğrulanıyor …'];
        renderNotice();
        turn.answer = await MenbaCloudChat.answer({
          endpoint:cloud.dataset.endpoint,consent:true,
          question:mode === 'talebe' && task === 'simple'
            ? tr(`Erkläre einfach: ${text}`,`Basitçe açıkla: ${text}`).slice(0,500) : text,
          previousQuestion:previous?.retrievalQuestion,
          evidence:turn.evidence,language:answerLanguage(text),signal:work.controller.signal,
          onFailure:reason=>{modelFailure=reason;}
        });
        if (request !== work || !allowed()) return;
        if (modelFailure === 'limit') {
          turn.warning.push(['Das Tageslimit für KI-Antworten ist erreicht oder für dieses Konto zu niedrig.','Yapay zekâ yanıtları için günlük sınır doldu veya bu hesap için çok düşük.']);
        } else if (modelFailure) {
          turn.warning.push(['Die KI-Verbindung ist derzeit unterbrochen. Hier sind die lokalen Fundstellen.','Yapay zekâ bağlantısı şu anda kesik. Yerel kaynak bölümleri aşağıda.']);
          retryQuestion = text;
        }
      }
      if (!turn.answer && previous && requestsSource(text) && turn.evidence.length) {
        turn.answer = {
          text: answerLanguage(text) === 'tr' ? 'Bu konunun kaynakları aşağıda, sayfa numaralarıyla birlikte yer alıyor.'
            : 'Die Fundstellen dazu stehen unten mit Buch und Seitenzahl.',
          citations: turn.evidence.map((_,index) => index+1)
        };
      }
      const needsAnswer = !turn.learning && (intent?.kind === 'ruling' || intent?.kind === 'exception');
      const insufficient = ['In den ausgewählten Quellen fehlt ein ausreichender Beleg für diese Frage.', 'Seçtiğiniz kaynaklarda bu soruya cevap verebilecek yeterli bilgi bulunamadı.'];
      turn.notice = turn.evidence.length && !(needsAnswer && !turn.answer)
        ? quranRows.length ? ['Passende Fundstellen aus den ausgewählten Koran-PDFs', 'Seçili Kur’an PDF’lerindeki ilgili bölümler']
          : ['Passende Stellen aus deinen Quellen', 'Kaynaklarındaki ilgili bölümler']
        : quranOnly && !foundQuran ? quranSourceHelp()
          : insufficient;
      if (!turn.evidence.length && unavailable.length && !snapshot.pages.length) {
        turn.notice = ['Beim Laden der Quellen ist ein technischer Fehler aufgetreten.', 'Kaynak araması sırasında teknik bir sorun oluştu.'];
      } else if (!turn.evidence.length && scans.length && !snapshot.pages.length) {
        turn.notice = ['Diese Quelle ist noch nicht durchsuchbar.', 'Bu kaynak henüz okunabilir hâle getirilmedi.'];
      }
      if (!turn.evidence.length && sources.length === 1 && sources[0].id === hadisId && !unavailable.length) {
        turn.notice = [turn.notice[0]+' Durchsucht wurde nur die ausgewählte Hadis-Textfassung. Weitere PDFs kannst du unter Quellen auswählen.',
          turn.notice[1]+' Yalnızca seçili Hadis metni arandı. Kaynaklar bölümünden başka PDF’ler seçebilirsin.'];
      }
      if (unavailable.length) {
        const labels = unavailable.join(', ');
        turn.warning.push([`Nicht durchsuchbar: ${labels}.`, `Aranamadı: ${labels}.`]);
        retryQuestion = text;
      }
      if (scans.length) {
        const labels = scans.join(', ');
        turn.warning.push([`Seiten ohne lesbaren Text: ${labels}. Nutze die Texterkennung unter Quellen.`, `Okunabilir metni olmayan sayfalar: ${labels}. Kaynaklar menüsündeki metin tanımayı kullan.`]);
      }
      const [first] = turn.evidence;
      if ((!turn.answer || turn.answer.kind === 'excerpt') && !turn.learning?.quiz && first?.quran && first.ranges) {
        const source = sources.find(option => option.id === first.sourceId);
        if (source) {
          notice = ['Arabischer Vers wird aus der PDF geladen …', 'Arapça ayet PDF’den yükleniyor …'];
          render();
          try {
            const preview = await originalImage(first,source,work);
            if (request === work && allowed()) first.preview = preview;
          } catch { /* Keep the meaning and reference available if the image cannot render. */ }
        }
      }
    } catch {
      if (request === work) {
        turn.notice = ['Die Suche konnte wegen eines technischen Fehlers nicht abgeschlossen werden.', 'Teknik bir hata nedeniyle arama tamamlanamadı.'];
        retryQuestion = text;
      }
    } finally {
      if (request === work) {
        request = null;
        notice = null;
        render();
        question.focus({preventScroll:true});
      }
    }
  }

  async function readScan(next = false) {
    const source = options.find(entry => entry.id !== hadisId && entry.id === ocrSource.value);
    let start = source?.image ? 1 : $('menbaOcrStart').valueAsNumber;
    let end = source?.image ? 1 : $('menbaOcrEnd').valueAsNumber;
    const language = $('menbaOcrLanguage').value;
    if (!allowed() || request || !source) return;
    if (!next && (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end-start >= 5)) {
      notice = ['Wähle einen gültigen Bereich mit höchstens fünf Seiten.', 'En fazla beş sayfalık geçerli bir aralık seç.'];
      renderNotice();
      return;
    }
    const work = {controller:new AbortController(),sources:[source],task:null};
    request = work;
    setSourceState(source,'working');
    notice = ['Texterkennung wird vorbereitet …', 'Metin tanıma hazırlanıyor …'];
    render();
    try {
      await useIndex(source);
      if (request !== work) return;
      const pdf = source.image ? null : await openPdf(source, work);
      if (request !== work) return;
      const key = sourceKey(source);
      const data = recognizedPages.get(key) || new Map();
      const totalPages = pdf?.numPages ?? 1;
      const tried = attemptedOcr.get(key) ?? new Set();
      if (next) {
        const known = new Set([...(cachedPages.get(key)?.pages.map(page=>page.page) ?? []),...data.keys()]);
        const finished = number => known.has(number) || tried.has(number);
        start = 1;
        while (start <= totalPages && finished(start)) start++;
        if (start > totalPages) {
          notice = known.size === totalPages
            ? ['Alle Seiten haben bereits lesbaren Text.', 'Tüm sayfalarda okunabilir metin var.']
            : ['Alle Seiten wurden geprüft. Einzelne unlesbare Seiten kannst du mit einer anderen Sprache erneut versuchen.',
              'Tüm sayfalar kontrol edildi. Okunamayan sayfaları farklı bir dil seçerek tekrar deneyebilirsin.'];
          return;
        }
        end = start;
        while (end < totalPages && end-start < 4 && !finished(end+1)) end++;
      }
      if (end > totalPages) {
        notice = [`Die PDF hat ${pdf.numPages} Seiten. Passe den Bereich an.`, `PDF ${pdf.numPages} sayfa. Aralığı değiştir.`];
        return;
      }
      const settings = {
        start,end,language,signal:work.controller.signal,
        onProgress({page}) {
          if (request !== work) return;
          notice = [`Texterkennung auf Seite ${page} …`, `${page}. sayfada metin tanınıyor …`];
          renderNotice();
        }
      };
      const rows = source.image ? await MenbaOCR.recognizeImage(source.file,settings) : await MenbaOCR.recognize(pdf,settings);
      if (request !== work || !allowed()) return;
      const recognized = [];
      for (const row of rows) {
        tried.add(row.page);
        if (row.confidence < 25 || !/\p{L}/u.test(row.text)) continue;
        const indexed = {page:row.page,text:row.text,sourceId:source.id,source:source.title,ocr:true};
        data.set(row.page,indexed);
        recognized.push(indexed);
      }
      attemptedOcr.set(key,tried);
      if (recognized.length) {
        recognizedPages.set(key,data);
        sourcesChanged();
        await useIndex(source,{ocr:recognized});
        if (request !== work || !allowed()) return;
        const missed = rows.length-recognized.length;
        notice = missed ? [`${recognized.length} von ${rows.length} Seiten erkannt. ${missed} ohne lesbaren Text.`, `${rows.length} sayfanın ${recognized.length} tanesi okundu. ${missed} sayfada okunabilir metin yok.`]
          : ['Erkannter Text ist für die nächste Frage verfügbar. Prüfe Zitate am Original.', 'Tanınan metin sonraki soruda kullanılabilir. Alıntıları özgün sayfadan kontrol et.'];
        if (!selected.has(source.id)) notice = [
          'Wähle das erkannte Dokument unter Quellen aus, um es zu durchsuchen. '+notice[0],
          'Aramak için tanınan belgeyi Kaynaklar bölümünde seç. '+notice[1]
        ];
      } else {
        setSourceState(source,'unreadable');
        notice = ['Auf diesen Seiten wurde kein Text erkannt.', 'Bu sayfalarda metin tanınamadı.'];
      }
    } catch {
      if (request === work) {
        setSourceState(source,'error');
        notice = ['Texterkennung derzeit nicht verfügbar. Prüfe Datei, Seiten und Verbindung.', 'Metin tanıma kullanılamıyor. Dosyayı, sayfaları ve bağlantını kontrol et.'];
      }
    } finally {
      await releasePdf(work);
      if (sourceStates.get(sourceKey(source)) === 'working') setSourceState(source,null);
      if (request === work) { request = null; render(); }
    }
  }

  async function testOwner() {
    const account = owner;
    const epoch = accountEpoch;
    if (!allowed() || document.documentElement.dataset.betaOwner !== 'true') return false;
    const {data,error} = await db.rpc('library_beta_get_access');
    return !error && Array.isArray(data) && data.length === 1 && data[0]?.is_owner === true
      && allowed() && owner === account && accountEpoch === epoch;
  }

  async function processForTest(sourceIds,{admin=false,useOcr=false,ocrPage=null,language='turkish',signal,onProgress} = {}) {
    if (!allowed() || request || loadingPreferences || signal?.aborted) throw Error('busy');
    if (admin && !await testOwner()) throw Error('access');
    if (!allowed() || request || signal?.aborted) throw Error('busy');
    if (admin && Date.now() < nextDiagnosticAt) throw Error('rate');
    const sources = pickableSources().filter(source=>sourceIds.includes(source.id)).slice(0,admin ? 1 : 3);
    if (!sources.length) throw Error('selection');
    const controller = new AbortController();
    const diagnostics = new Map();
    const work = {controller,sources,task:null,force:admin,report(source,stage,value) {
      const entries = diagnostics.get(source.id) ?? {};
      entries[stage] = value;
      diagnostics.set(source.id,entries);
      onProgress?.(stage,value);
    }};
    const abort = () => { controller.abort(); void releasePdf(work); };
    signal?.addEventListener('abort',abort,{once:true});
    const timeout = setTimeout(abort,120000);
    if (admin) nextDiagnosticAt = Date.now()+5000;
    request = work;
    render();
    try {
      const snapshot = await collectSources(work);
      controller.signal.throwIfAborted();
      if (!snapshot || request !== work || !allowed()) throw Error('access');
      const [source] = sources;
      const key = sourceKey(source);
      const record = diagnostics.get(source.id) ?? {};
      const pdfState = cachedPages.get(key);
      let ocr = {state:'skip'};
      if (admin && useOcr && source.id !== hadisId && !record.error && pdfState?.totalPages) {
        const indexed = new Set([...pdfState.pages.map(page=>page.page),...(recognizedPages.get(key)?.keys() ?? [])]);
        const total = pdfState.totalPages;
        const page = MenbaQuestionChecks.ocrSamplePage(total,indexed,ocrPage);
        if (ocrPage !== null && page === null) ocr = {state:'skip',reason:indexed.has(ocrPage) ? 'indexed' : 'range',page:ocrPage,total};
        if (page !== null) {
          try {
            const pdf = source.image ? null : await openPdf(source,work);
            const settings = {start:page,end:page,language,signal:controller.signal,onProgress:()=>onProgress?.('ocr',{page})};
            const [row] = source.image ? await MenbaOCR.recognizeImage(source.file,settings) : await MenbaOCR.recognize(pdf,settings);
            controller.signal.throwIfAborted();
            if (request !== work || !allowed()) throw Error('access');
            if (!row || row.confidence < 25 || !/\p{L}/u.test(row.text)) ocr = {state:'review',page};
            else {
              const entry = {sourceId:source.id,source:source.title,page,text:row.text,ocr:true};
              const recognized = recognizedPages.get(key) ?? new Map();
              recognized.set(page,entry);
              recognizedPages.set(key,recognized);
              await useIndex(source,{ocr:[entry]});
              snapshot.pages.push(entry);
              sourcesChanged();
              ocr = {state:'pass',page};
            }
          } catch(error) {
            if (controller.signal.aborted) throw error;
            ocr = {state:'fail',page};
          } finally { await releasePdf(work); }
        }
      }
      let stored = null;
      if (admin && record.extract?.persisted) {
        try {
          const version = await indexVersion(source);
          const index = await MenbaSourcePreferences.loadIndex(owner,source.id,version);
          stored = index?.parsed?.pages.length === record.extract.readable && (ocr.state !== 'pass' || index.ocr.some(row=>row.page === ocr.page));
        } catch { stored = false; }
      }
      controller.signal.throwIfAborted();
      if (request !== work || !allowed()) throw Error('access');
      return {snapshot,source,sources,record,ocr,stored};
    } finally {
      clearTimeout(timeout);
      signal?.removeEventListener('abort',abort);
      if (request === work) { request = null; notice = null; render(); }
    }
  }

  const testOptions = sources => ({sources,hadisId,isQuran,language:lang});
  async function suggestQuestions(signal) {
    const {snapshot,sources} = await processForTest(pickableSources().map(source=>source.id),{signal});
    return MenbaQuestionChecks.candidates(snapshot.pages,lang).map(candidate=>
      MenbaQuestionChecks.test(candidate,snapshot,testOptions(sources)));
  }

  async function diagnoseSource(sourceId,settings) {
    const {snapshot,source,sources,record,ocr,stored} = await processForTest([sourceId],{...settings,admin:true});
    const configuration = testOptions(sources);
    const candidates = MenbaQuestionChecks.candidates(snapshot.pages,lang,6);
    const questions = [...MenbaQuestionChecks.standardQuestions.map(text=>({text})),...candidates]
      .map(candidate=>MenbaQuestionChecks.test(candidate,snapshot,configuration));
    const multilingual = ['de','tr','ar'].map(language=>{
      const [candidate] = MenbaQuestionChecks.candidates(snapshot.pages,language,1);
      return candidate ? MenbaQuestionChecks.test(candidate,snapshot,{...configuration,language}).status : 'skip';
    });
    const missing = MenbaQuestionChecks.test({text:'Xylutronium Befund XQQZK'},snapshot,configuration);
    const emptyScope = MenbaQuestionChecks.test({text:candidates[0]?.text ?? 'Emsile nedir?'},snapshot,{...configuration,sources:[]});
    return {
      title:source.title,record,ocr,stored,questions,multilingual,
      pages:snapshot.pages.length,wrongMatch:missing.found>0,scopeClean:emptyScope.found===0,
      privateIndex:!source.shareId && source.id !== hadisId,localFile:Boolean(source.file),
      publicText:source.id === hadisId,
      cloudConfigured:MenbaCloudChat.canUse(cloud.dataset.endpoint)
    };
  }

  window.MenbaDiagnosticAccess = Object.freeze({
    selectedSources:()=>allowed() ? pickableSources().map(({id,title,shareId})=>({id,title,shared:Boolean(shareId)})) : [],
    suggestQuestions,diagnoseSource
  });

  picker.addEventListener('change', event => {
    const input = event.target;
    if (!allowed() || request || loadingPreferences || savingPreferences || !(input instanceof HTMLInputElement)) return;
    if (input.checked) {
      selected.add(input.value);
      const source = options.find(row=>row.id === input.value);
      if (source) void useIndex(source);
    }
    else selected.delete(input.value);
    notice = null;
    preferencesChanged();
    renderNotice();
  });
  selectAll.addEventListener('click', () => {
    if (!allowed() || selectAll.disabled) return;
    const clear = pickableSources().length === options.length;
    selected.clear();
    if (!clear) for (const source of options) selected.add(source.id);
    notice = null;
    selectionNotice = null;
    render();
  });
  saveSources.addEventListener('click', () => void saveSelection());
  quranFile.addEventListener('change', () => {
    const [file] = quranFile.files;
    quranFile.value = '';
    if (!allowed() || request || loadingPreferences || savingPreferences || !file) return;
    try {
      validateUpload(file,'pdf');
      localQuran = {id:localQuranId, title:file.name, file, quran:true};
      selected.add(localQuranId);
      selectionNotice = null;
      syncSources();
      notice = ['Koran-PDF geöffnet. Du kannst jetzt nach einem Thema suchen.', 'Kur’an PDF’si açıldı. Artık konuya göre arayabilirsin.'];
    } catch (error) {
      notice = [error.message,error.message];
    }
    renderNotice();
  });
  photoFile.addEventListener('change', async () => {
    const [file] = photoFile.files;
    photoFile.value = '';
    if (!allowed() || request || loadingPreferences || savingPreferences || !file) return;
    if (!['image/jpeg','image/png','image/webp'].includes(file.type) || file.size > 20*1024*1024) {
      notice = ['Wähle ein JPG, PNG oder WebP bis 20 MB.', 'En fazla 20 MB boyutunda JPG, PNG veya WebP seç.'];
      renderNotice();
      return;
    }
    localPhoto = {id:photoId,title:file.name,file,image:true};
    selected.add(photoId);
    syncSources();
    await useIndex(localPhoto);
    if (!allowed() || localPhoto?.file !== file || request || recognizedPages.get(file)?.size) return;
    ocrSource.value = photoId;
    updateOcrControls();
    $('menbaOcrLanguage').value = 'multilingual';
    ocrTools.open = true;
    void readScan();
  });
  category.addEventListener('change',render);
  learningMode.addEventListener('change',()=>renderLearning(allowed(),Boolean(request)));
  document.addEventListener('menba-select-mode',event=>{
    if (!allowed() || request || !['talebe','hoca'].includes(event.detail) || (event.detail === 'hoca' && !hocaAllowed)) return;
    learningMode.value = event.detail;
    renderLearning(true,false);
  });
  useTopic.addEventListener('click',()=>{
    question.value = turns.at(-1)?.retrievalQuestion ?? '';
    question.focus();
  });
  ocrSource.addEventListener('change',updateOcrControls);
  clearChat.addEventListener('click', () => {
    if (!allowed() || request) return;
    turns = [];
    retryQuestion = notice = null;
    question.value = '';
    render();
  });
  retry.addEventListener('click', () => {
    if (!allowed() || request || !retryQuestion) return;
    question.value = retryQuestion;
    void run(true);
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    void run();
  });
  ocrForm.addEventListener('submit', event => {
    event.preventDefault();
    void readScan();
  });
  $('menbaOcrNext').addEventListener('click',()=>void readScan(true));
  stop.addEventListener('click', () => {
    cancel();
    notice = ['Vorgang abgebrochen.', 'İşlem iptal edildi.'];
    render();
  });
  function syncAccount() {
    const next = accessState === 'approved' ? currentUser?.id ?? null : null;
    if (next !== owner) {
      cancel();
      sharedLoad?.abort();
      sharedLoad = null;
      sharedState = 'idle';
      sharedSources = [];
      owner = next;
      ++accountEpoch;
      ++hocaRequest;
      hocaAllowed = false;
      nextDiagnosticAt = 0;
      learningMode.value = 'chat';
      sourcesChanged();
      loadingPreferences = Boolean(owner);
      savingPreferences = false;
      selectionNotice = null;
      cachedPages.clear();
      recognizedPages.clear();
      attemptedOcr.clear();
      sharedVersions.clear();
      sourceStates.clear();
      loadedIndexes.clear();
      options = [];
      localQuran = null;
      localPhoto = null;
      quranFile.value = '';
      photoFile.value = '';
      consent.checked = false;
      selected.clear();
      notice = null;
      retryQuestion = null;
      turns = [];
      question.value = '';
      if (owner) {
        void restoreSelection(owner, accountEpoch);
        if (portal === 'menba') void refreshSharedSources();
      }
    }
    if (owner) syncSources();
    else render();
  }
  document.addEventListener('library-access', syncAccount);
  document.addEventListener('library-books', syncSources);
  document.addEventListener('library-shared-books', () => {
    if (portal === 'menba') void refreshSharedSources();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && portal === 'menba') void refreshSharedSources();
  });
  document.addEventListener('library-language', render);
  document.addEventListener('beta-role-access',event=>{
    if (!allowed()) return;
    if (event.detail.isOwner === true) {
      hocaAllowed = true;
      renderLearning(true,Boolean(request || loadingPreferences));
    }
    if (portal === 'menba') void syncHoca();
  });
  document.addEventListener('menba-role-change',()=>{ if (portal === 'menba') void syncHoca(); });
  document.addEventListener('library-portal', () => {
    if (portal === 'menba') { void refreshSharedSources(); void syncHoca(); }
    if (portal !== 'menba' && request) {
      cancel();
      notice = null;
      render();
    }
  });
  syncAccount();
})();
