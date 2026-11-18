(() => {
  'use strict';

  const form = $('menbaForm');
  const picker = $('menbaSources');
  const sourceSummary = $('menbaSourcesSummary');
  const sourceStatus = $('menbaSourceStatus');
  const question = $('menbaQuestion');
  const ask = $('menbaAsk');
  const status = $('menbaStatus');
  const results = $('menbaResults');
  const stop = $('menbaCancel');
  const ocrTools = $('menbaOcrTools');
  const ocrForm = $('menbaOcrForm');
  const ocrSource = $('menbaOcrSource');
  const pdfBase = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.5.438/';
  const hadisId = 'hadis-collection';
  const selected = new Set();
  const cachedPages = new Map();
  const recognizedPages = new Map();
  let owner = null;
  let options = [];
  let request = null;
  let pdfModule = null;
  let notice = null;
  let turns = [];

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
    for (const key of recognizedPages.keys()) if (!paths.has(key)) recognizedPages.delete(key);
    if (request && request.sources.some(source => !paths.has(source.path || source.id))) {
      cancel();
      notice = ['Die Quellen wurden geändert. Stelle die Frage erneut.', 'Kaynaklar değişti. Soruyu yeniden sor.'];
    }
    const validTurns = turns.filter(turn => !turn.sources.some(source => !active.has(source.id) || changed.has(source.id)));
    if (validTurns.length !== turns.length) {
      turns = validTurns;
      notice = ['Die Quellen wurden geändert. Stelle die Frage erneut.', 'Kaynaklar değişti. Soruyu yeniden sor.'];
    }
    render();
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
    sourceSummary.textContent = tr(`Quellen (${selected.size})`, `Kaynaklar (${selected.size})`);
    const scans = options.filter(source => source.path);
    const previous = ocrSource.value;
    ocrTools.hidden = !canAsk || !scans.length;
    ocrSource.replaceChildren(...scans.map(source => new Option(source.title,source.id)));
    if (scans.some(source => source.id === previous)) ocrSource.value = previous;
    for (const input of ocrForm.elements) input.disabled = !canAsk || busy;
    stop.hidden = !busy;
    ask.disabled = !canAsk || busy || !selected.size;
    question.disabled = !canAsk || busy;
    ask.textContent = busy ? tr('Suche läuft …', 'Aranıyor …') : tr('Frage stellen', 'Sor');
    renderNotice();
    form.setAttribute('aria-busy', String(busy));
    results.replaceChildren(...turns.map(renderTurn));
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
    reply.append(paragraph(tr(...turn.notice)));
    turn.evidence.forEach((entry,index) => {
      const passage = document.createElement('div');
      passage.className = 'menba-passage';
      const quote = document.createElement('blockquote');
      quote.append(...entry.text.split(/\r?\n/u).map(line => paragraph(line)));
      const cite = paragraph(`[${index+1}] ${entry.source} · ${tr('Seite', 'Sayfa')} ${entry.page}${entry.ocr ? ' · OCR' : ''}`,'menba-citation');
      passage.append(quote, cite);
      reply.append(passage);
    });
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

  async function openPdf(source, work) {
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
    return task.promise;
  }

  async function extractPdf(source, work) {
    const {signal} = work.controller;
    try {
      const pdf = await openPdf(source, work);
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
      await releasePdf(work);
    }
  }

  async function releasePdf(work) {
    if (!work.task) return;
    const task = work.task;
    work.task = null;
    await task.destroy().catch(() => {});
  }

  function progress(source) {
    notice = [`Durchsuche „${source.title}“ …`, `“${source.title}” taranıyor …`];
    renderNotice();
  }

  async function run() {
    const text = question.value.trim();
    if (!allowed() || request || !text || !selected.size) return;
    const sources = options.filter(source => selected.has(source.id));
    const turn = {question:text, sources, evidence:[], notice:null};
    const work = {controller:new AbortController(), sources, task:null, turn};
    request = work;
    turns.push(turn);
    question.value = '';
    render();
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
          const ocr = recognizedPages.get(key);
          if (!extracted.length && !ocr?.size) scans.push(source.title);
          for (const page of extracted) if (!ocr?.has(page.page)) pages.push(page);
          if (ocr) pages.push(...ocr.values());
        } catch {
          if (request !== work) return;
          const ocr = recognizedPages.get(key);
          if (ocr?.size) pages.push(...ocr.values());
          else unavailable.push(source.title);
        }
      }
      if (request !== work || !allowed()) return;
      const ocrKeys = new Set(pages.filter(page => page.ocr).map(page => `${page.sourceId}:${page.page}`));
      turn.evidence = window.MenbaSearch.find(text, pages).map(entry => ({
        ...entry, ocr:ocrKeys.has(`${entry.sourceId}:${entry.page}`)
      }));
      turn.notice = turn.evidence.length
        ? ['Passende Stellen aus deinen Quellen', 'Kaynaklarındaki ilgili bölümler']
        : ['In den durchsuchbaren Quellen habe ich keine passende Stelle gefunden.', 'Aranabilen kaynaklarda uygun bir bölüm bulamadım.'];
      if (unavailable.length) {
        const labels = unavailable.join(', ');
        turn.notice = [turn.notice[0]+` Nicht durchsuchbar: ${labels}.`, turn.notice[1]+` Aranamadı: ${labels}.`];
      }
      if (scans.length) {
        const labels = scans.join(', ');
        turn.notice = [turn.notice[0]+` Ohne lesbare Textebene: ${labels}. Nutze die Texterkennung unter Quellen.`, turn.notice[1]+` Okunabilir metin katmanı yok: ${labels}. Kaynaklar menüsündeki metin tanımayı kullan.`];
      }
    } catch {
      if (request === work) turn.notice = ['Die Suche konnte nicht abgeschlossen werden.', 'Arama tamamlanamadı.'];
    } finally {
      if (request === work) {
        request = null;
        notice = null;
        render();
        question.focus({preventScroll:true});
      }
    }
  }

  async function readScan() {
    const source = options.find(entry => entry.path && entry.id === ocrSource.value);
    const start = $('menbaOcrStart').valueAsNumber;
    const end = $('menbaOcrEnd').valueAsNumber;
    const language = $('menbaOcrLanguage').value;
    if (!allowed() || request || !source) return;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end-start >= 5) {
      notice = ['Wähle einen gültigen Bereich mit höchstens fünf Seiten.', 'En fazla beş sayfalık geçerli bir aralık seç.'];
      renderNotice();
      return;
    }
    const work = {controller:new AbortController(),sources:[source],task:null};
    request = work;
    notice = ['Texterkennung wird vorbereitet …', 'Metin tanıma hazırlanıyor …'];
    render();
    try {
      const pdf = await openPdf(source, work);
      if (request !== work) return;
      if (end > pdf.numPages) {
        notice = [`Die PDF hat ${pdf.numPages} Seiten. Passe den Bereich an.`, `PDF ${pdf.numPages} sayfa. Aralığı değiştir.`];
        return;
      }
      const rows = await window.MenbaOCR.recognize(pdf,{
        start,end,language,signal:work.controller.signal,
        onProgress({page}) {
          if (request !== work) return;
          notice = [`Texterkennung auf Seite ${page} …`, `${page}. sayfada metin tanınıyor …`];
          renderNotice();
        }
      });
      if (request !== work || !allowed()) return;
      const data = recognizedPages.get(source.path) || new Map();
      let count = 0;
      for (const row of rows) {
        if (!row.text.trim()) continue;
        data.set(row.page,{page:row.page,text:row.text,sourceId:source.id,source:source.title,ocr:true});
        count++;
      }
      if (count) {
        recognizedPages.set(source.path,data);
        selected.add(source.id);
        notice = ['Erkannter Text ist für die nächste Frage verfügbar. Prüfe Zitate am Original.', 'Tanınan metin sonraki soruda kullanılabilir. Alıntıları özgün sayfadan kontrol et.'];
      } else {
        notice = ['Auf diesen Seiten wurde kein Text erkannt.', 'Bu sayfalarda metin tanınamadı.'];
      }
    } catch {
      if (request === work) notice = ['Texterkennung derzeit nicht verfügbar. Prüfe Datei, Seiten und Verbindung.', 'Metin tanıma kullanılamıyor. Dosyayı, sayfaları ve bağlantını kontrol et.'];
    } finally {
      await releasePdf(work);
      if (request === work) { request = null; render(); }
    }
  }

  picker.addEventListener('change', event => {
    const input = event.target;
    if (!allowed() || request || !(input instanceof HTMLInputElement)) return;
    if (input.checked) selected.add(input.value);
    else selected.delete(input.value);
    notice = null;
    ask.disabled = selected.size === 0;
    sourceSummary.textContent = tr(`Quellen (${selected.size})`, `Kaynaklar (${selected.size})`);
    renderNotice();
  });
  form.addEventListener('submit', event => {
    event.preventDefault();
    void run();
  });
  ocrForm.addEventListener('submit', event => {
    event.preventDefault();
    void readScan();
  });
  stop.addEventListener('click', () => {
    cancel();
    notice = ['Vorgang abgebrochen.', 'İşlem iptal edildi.'];
    render();
  });
  document.addEventListener('library-access', () => {
    const next = accessState === 'approved' ? currentUser?.id ?? null : null;
    if (next !== owner) {
      cancel();
      owner = next;
      cachedPages.clear();
      recognizedPages.clear();
      options = [];
      selected.clear();
      if (owner) selected.add(hadisId);
      notice = null;
      turns = [];
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
