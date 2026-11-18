(() => {
  'use strict';

  const form = $('menbaForm');
  const picker = $('menbaSources');
  const sourceStatus = $('menbaSourceStatus');
  const question = $('menbaQuestion');
  const ask = $('menbaAsk');
  const status = $('menbaStatus');
  const results = $('menbaResults');
  const pdfBase = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.5.438/';
  const hadisId = 'hadis-collection';
  const selected = new Set();
  const cachedPages = new Map();
  let owner = null;
  let options = [];
  let request = null;
  let pdfModule = null;
  let notice = null;
  let answer = [];

  function allowed() {
    return Boolean(owner && owner === currentUser?.id && accessState === 'approved');
  }

  function syncSources() {
    if (!allowed()) return;
    const prior = new Map(options.map(source => [source.id, source.path]));
    const privatePdfs = books.filter(book =>
      book.owner_id === owner && book.visibility === 'private' && !book.deleted_at && book.file_path
    );
    options = [
      {id:hadisId, title:'Haftanın Hadis-i Şerifleri', path:null},
      ...privatePdfs.map(book => ({id:book.id, title:book.title || book.file_name, path:book.file_path}))
    ];
    const active = new Set(options.map(source => source.id));
    const changed = new Set(options.filter(source => prior.has(source.id) && prior.get(source.id) !== source.path).map(source => source.id));
    for (const id of selected) if (!active.has(id)) selected.delete(id);
    const paths = new Set(options.map(source => source.path || source.id));
    for (const key of cachedPages.keys()) if (!paths.has(key)) cachedPages.delete(key);
    if (request && request.sources.some(source => !paths.has(source.path || source.id))) {
      cancel();
      answer = [];
      notice = ['Die Quellen wurden geändert. Stelle die Frage erneut.', 'Kaynaklar değişti. Soruyu yeniden sor.'];
    }
    if (answer.some(entry => !active.has(entry.sourceId) || changed.has(entry.sourceId))) {
      answer = [];
      notice = ['Die Quellen wurden geändert. Stelle die Frage erneut.', 'Kaynaklar değişti. Soruyu yeniden sor.'];
    }
    render();
  }

  function cancel() {
    if (!request) return;
    const previous = request;
    request = null;
    previous.controller.abort();
    if (previous.task) {
      const task = previous.task;
      previous.task = null;
      void task.destroy().catch(() => {});
    }
  }

  function render() {
    const canAsk = allowed();
    const busy = request !== null;
    sourceStatus.textContent = canAsk && !booksLoaded
      ? tr('Deine Bibliotheks-PDFs werden geladen …', 'Kütüphane PDF dosyaların yükleniyor …')
      : '';
    const choices = canAsk ? options.map(source => {
      const label = document.createElement('label');
      label.className = 'menba-source-option';
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.value = source.id;
      input.checked = selected.has(source.id);
      input.disabled = busy;
      const name = document.createElement('span');
      name.textContent = source.path ? source.title : tr('Haftanın Hadis-i Şerifleri · Textfassung', 'Haftanın Hadis-i Şerifleri · Metin');
      label.append(input, name);
      return label;
    }) : [];
    picker.replaceChildren(...choices);
    ask.disabled = !canAsk || busy || !selected.size;
    question.disabled = !canAsk || busy;
    ask.textContent = busy ? tr('Suche läuft …', 'Aranıyor …') : tr('Frage stellen', 'Sor');
    status.textContent = notice ? tr(...notice) : '';
    form.setAttribute('aria-busy', String(busy));
    const items = answer.map(entry => {
      const item = document.createElement('article');
      const quote = document.createElement('blockquote');
      quote.dir = 'auto';
      quote.textContent = entry.text;
      const cite = document.createElement('p');
      cite.className = 'menba-citation';
      cite.textContent = `${entry.source} · ${tr('Seite', 'Sayfa')} ${entry.page}`;
      item.append(quote, cite);
      return item;
    });
    results.replaceChildren(...items);
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

  async function extractPdf(source, work) {
    const {signal} = work.controller;
    const {data, error} = await db.storage.from(STORAGE_BUCKET).createSignedUrl(source.path, 60);
    signal.throwIfAborted();
    if (error || !data?.signedUrl) throw Error('Source is not available');
    const response = await fetch(data.signedUrl, {signal, referrerPolicy:'no-referrer'});
    if (!response.ok) throw Error('Source is not available');
    const bytes = await response.arrayBuffer();
    pdfModule ??= import(pdfBase+'build/pdf.min.mjs').catch(error => { pdfModule = null; throw error; });
    const pdfjs = await pdfModule;
    signal.throwIfAborted();
    pdfjs.GlobalWorkerOptions.workerSrc = pdfBase+'build/pdf.worker.min.mjs';
    const task = pdfjs.getDocument({
      data:bytes, isEvalSupported:false, cMapUrl:pdfBase+'cmaps/', cMapPacked:true,
      standardFontDataUrl:pdfBase+'standard_fonts/', wasmUrl:pdfBase+'wasm/'
    });
    work.task = task;
    try {
      const pdf = await task.promise;
      const pages = [];
      for (let number = 1; number <= pdf.numPages; number++) {
        signal.throwIfAborted();
        const page = await pdf.getPage(number);
        const {items} = await page.getTextContent();
        const text = items.map(item => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '')).join('').trim();
        page.cleanup();
        if (text) pages.push({sourceId:source.id, source:source.title, page:number, text});
      }
      return pages;
    } finally {
      if (work.task === task) {
        work.task = null;
        await task.destroy().catch(() => {});
      }
    }
  }

  function progress(source) {
    notice = [`Durchsuche „${source.title}“ …`, `“${source.title}” taranıyor …`];
    render();
  }

  async function run() {
    const text = question.value.trim();
    if (!allowed() || request || !text || !selected.size) return;
    const work = {controller:new AbortController(), sources:options.filter(source => selected.has(source.id)), task:null};
    request = work;
    answer = [];
    try {
      const pages = [];
      const unavailable = [];
      const scans = [];
      for (const source of work.sources) {
        if (request !== work) return;
        progress(source);
        const key = source.path || source.id;
        try {
          let extracted = cachedPages.get(key);
          if (!extracted) {
            extracted = source.path ? await extractPdf(source, work) : await fetchHadis(work);
            if (request !== work || !allowed()) return;
            cachedPages.set(key, extracted);
          }
          if (!extracted.length) scans.push(source.title);
          for (const page of extracted) pages.push(page);
        } catch {
          if (request !== work) return;
          unavailable.push(source.title);
        }
      }
      if (request !== work || !allowed()) return;
      answer = window.MenbaSearch.find(text, pages);
      notice = answer.length
        ? ['Passende Stellen aus deinen Quellen', 'Kaynaklarındaki ilgili bölümler']
        : ['In den durchsuchbaren Quellen habe ich keine passende Stelle gefunden.', 'Aranabilen kaynaklarda uygun bir bölüm bulamadım.'];
      if (unavailable.length) {
        const labels = unavailable.join(', ');
        notice = [notice[0]+` Nicht durchsuchbar: ${labels}.`, notice[1]+` Aranamadı: ${labels}.`];
      }
      if (scans.length) {
        const labels = scans.join(', ');
        notice = [notice[0]+` Ohne lesbare Textebene: ${labels}.`, notice[1]+` Okunabilir metin katmanı yok: ${labels}.`];
      }
    } catch {
      if (request === work) notice = ['Die Suche konnte nicht abgeschlossen werden.', 'Arama tamamlanamadı.'];
    } finally {
      if (request === work) {
        request = null;
        render();
      }
    }
  }

  picker.addEventListener('change', event => {
    const input = event.target;
    if (!allowed() || request || !(input instanceof HTMLInputElement)) return;
    if (input.checked) selected.add(input.value);
    else selected.delete(input.value);
    answer = [];
    notice = null;
    ask.disabled = selected.size === 0;
    results.replaceChildren();
    status.textContent = '';
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    void run();
  });
  document.addEventListener('library-access', () => {
    const next = accessState === 'approved' ? currentUser?.id ?? null : null;
    if (next !== owner) {
      cancel();
      owner = next;
      cachedPages.clear();
      options = [];
      selected.clear();
      if (owner) selected.add(hadisId);
      notice = null;
      answer = [];
      question.value = '';
    }
    if (owner) syncSources();
    else render();
  });
  document.addEventListener('library-books', syncSources);
  document.addEventListener('library-language', render);
  document.addEventListener('library-portal', () => {
    if (portal !== 'menba' && request) {
      cancel();
      notice = null;
      render();
    }
  });
  owner = accessState === 'approved' ? currentUser?.id ?? null : null;
  if (owner) {
    selected.add(hadisId);
    syncSources();
  } else render();
})();
