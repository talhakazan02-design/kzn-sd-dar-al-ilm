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
  const quranFile = $('menbaQuranFile');
  const pdfBase = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.5.438/';
  const hadisId = 'hadis-collection';
  const localQuranId = 'quran-on-device';
  const sourceKey = source => source.file || source.path || source.id;
  const selected = new Set();
  const cachedPages = new Map();
  const recognizedPages = new Map();
  let owner = null;
  let options = [];
  let request = null;
  let pdfModule = null;
  let notice = null;
  let turns = [];
  let localQuran = null;

  function allowed() {
    return Boolean(owner && owner === currentUser?.id && accessState === 'approved');
  }

  function syncSources() {
    if (!allowed()) return;
    const prior = new Map(options.map(source => [source.id, sourceKey(source)]));
    const privatePdfs = books.filter(book =>
      book.owner_id === owner && book.visibility === 'private' && !book.deleted_at && book.file_path
    );
    options = [
      {id:hadisId, title:'Haftanın Hadis-i Şerifleri', path:null},
      ...privatePdfs.map(book => ({id:book.id, title:book.title || book.file_name || 'PDF', path:book.file_path,
        quran:MenbaQuran.isSource(book.title) || MenbaQuran.isSource(book.file_name)}))
    ];
    if (localQuran) options.push(localQuran);
    const active = new Set(options.map(source => source.id));
    const changed = new Set(options.filter(source => prior.has(source.id) && prior.get(source.id) !== sourceKey(source)).map(source => source.id));
    for (const id of selected) if (!active.has(id)) selected.delete(id);
    const paths = new Set(options.map(sourceKey));
    for (const key of cachedPages.keys()) if (!paths.has(key)) cachedPages.delete(key);
    for (const key of recognizedPages.keys()) if (!paths.has(key)) recognizedPages.delete(key);
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
      name.textContent = source.id === hadisId ? tr('Haftanın Hadis-i Şerifleri · Textfassung', 'Haftanın Hadis-i Şerifleri · Metin') : source.title;
      label.append(input, name);
      return label;
    }) : [];
    picker.replaceChildren(...choices);
    sourceSummary.textContent = tr(`Quellen (${selected.size})`, `Kaynaklar (${selected.size})`);
    quranFile.disabled = !canAsk || busy;
    const scans = options.filter(source => source.path || source.file);
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
      const verse = entry.verse ? `${tr('Koran', 'Kur’an')} ${entry.verse} · ` : '';
      const pageLabel = turn.quran ? tr('PDF-Seite', 'PDF sayfası') : tr('Seite', 'Sayfa');
      const cite = paragraph(`[${index+1}] ${verse}${entry.source} · ${pageLabel} ${entry.page}${entry.ocr ? ' · OCR' : ''}`,'menba-citation');
      if (entry.meal) passage.append(paragraph(tr('Türkische Bedeutung aus der PDF', 'PDF’den Türkçe meal'), 'menba-meal-label'));
      passage.append(quote, cite);
      if (turn.quran) {
        if (entry.preview) {
          const preview = document.createElement('img');
          preview.className = 'menba-original';
          preview.src = entry.preview;
          preview.alt = entry.ranges ? tr(`Arabischer Originalvers ${entry.verse}`, `${entry.verse} ayetinin Arapça aslı`)
            : tr(`Originalseite ${entry.page}`, `Özgün PDF sayfası ${entry.page}`);
          passage.insertBefore(preview, passage.firstChild);
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
    let bytes;
    if (source.file) bytes = await source.file.arrayBuffer();
    else {
      const {data, error} = await db.storage.from(STORAGE_BUCKET).createSignedUrl(source.path, 60);
      signal.throwIfAborted();
      if (error || !data?.signedUrl) throw Error('Source is not available');
      const response = await fetch(data.signedUrl, {signal, referrerPolicy:'no-referrer'});
      if (!response.ok) throw Error('Source is not available');
      bytes = await response.arrayBuffer();
    }
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
      const parsedEdition = source.quran && MenbaQuranEdition.isEdition(await pdf.getMetadata());
      const pages = [];
      for (let number = 1; number <= pdf.numPages; number++) {
        signal.throwIfAborted();
        const page = await pdf.getPage(number);
        const {items} = await page.getTextContent();
        const verses = parsedEdition ? MenbaQuranEdition.parse(items,number) : [];
        const text = parsedEdition ? verses.map(row => row.text).join('\n')
          : items.map(item => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '')).join('').trim();
        page.cleanup();
        if (text) pages.push({sourceId:source.id, source:source.title, page:number, text, verses});
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

  function findQuran(query,pages) {
    const verses = pages.flatMap(page => (page.verses || []).map(row => ({
      ...row, sourceId:page.sourceId, source:page.source, page:page.page, meal:true
    })));
    const results = MenbaQuran.findVerses(query,verses);
    if (results.length >= 3) return results;
    const found = new Set(results.map(result => result.verse).filter(Boolean));
    const excerpts = MenbaQuran.find(query,pages.filter(page => !page.verses?.length));
    return results.concat(excerpts.filter(entry => !found.has(entry.verse))).slice(0,3);
  }

  async function originalImage(entry,source,work) {
    const {signal} = work.controller;
    try {
      const pdf = await openPdf(source,work);
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

  async function run() {
    const text = question.value.trim();
    if (!allowed() || request || !text || !selected.size) return;
    const picked = options.filter(source => selected.has(source.id));
    const anyQuran = picked.some(source => source.quran);
    const hadith = /\b(?:hadis|hadith|hadise|hadisi|hadisi serif)\b/iu.test(text) || /حديث/u.test(text);
    const genericHadis = /^(?:(?:nenne?|zeig(?:e)?|gib|finde)\s+mir\s+(?:ein(?:en?)?\s+)?hadi(?:s|th)|(?:bana\s+)?bir\s+hadis\s+(?:soyle|goster)|hadi(?:s|th))$/iu
      .test(text.normalize('NFKD').replace(/\p{M}|[^\p{L}\p{Z}]+$/gu,'').trim());
    const quran = MenbaQuran.inspect(text,{inQuran:anyQuran && !hadith && picked.every(source => source.quran || source.id === hadisId)});
    const sources = quran ? picked.filter(source => source.quran) : genericHadis ? picked.filter(source => source.id === hadisId) : picked;
    if (quran && !sources.length) {
      sourceSummary.parentElement.open = true;
      notice = ['Wähle unter Quellen eine Koran-PDF aus oder öffne sie von deinem Gerät.', 'Kaynaklar bölümünde bir Kur’an PDF’si seç veya cihazından aç.'];
      renderNotice();
      return;
    }
    if (quran && !quran.topic && !quran.reference) {
      notice = ['Nenne ein Thema wie Namaz oder eine Versnummer wie 2:43.', 'Namaz gibi bir konu veya 2:43 gibi bir ayet numarası yaz.'];
      renderNotice();
      return;
    }
    if (genericHadis && !sources.length) {
      sourceSummary.parentElement.open = true;
      notice = ['Wähle unter Quellen die Hadis-Textfassung aus.', 'Kaynaklar bölümünde Hadis metnini seç.'];
      renderNotice();
      return;
    }
    const turn = {question:text, sources, evidence:[], notice:null, quran:Boolean(quran)};
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
        const key = sourceKey(source);
        try {
          let extracted = cachedPages.get(key);
          if (!extracted) {
            extracted = source.id === hadisId ? await fetchHadis(work) : await extractPdf(source, work);
            if (request !== work || !allowed()) return;
            cachedPages.set(key, extracted);
          }
          const ocr = recognizedPages.get(key);
          if (!extracted.length && !ocr?.size) scans.push(source.title);
          const textPages = new Set(extracted.filter(page => page.verses?.length).map(page => page.page));
          for (const page of extracted) if (textPages.has(page.page) || !ocr?.has(page.page)) pages.push(page);
          if (ocr) pages.push(...[...ocr.values()].filter(page => !textPages.has(page.page)));
        } catch {
          if (request !== work) return;
          const ocr = recognizedPages.get(key);
          if (ocr?.size) pages.push(...ocr.values());
          else unavailable.push(source.title);
        }
      }
      if (request !== work || !allowed()) return;
      const ocrKeys = new Set(pages.filter(page => page.ocr).map(page => `${page.sourceId}:${page.page}`));
      const rows = quran ? findQuran(quran,pages) : window.MenbaSearch.find(text, pages);
      const hadithRows = genericHadis ? pages.filter(page => page.sourceId === hadisId) : [];
      turn.evidence = (hadithRows.length ? [hadithRows[Math.floor(Math.random()*hadithRows.length)]] : rows).map(entry => ({
        ...entry, ocr:ocrKeys.has(`${entry.sourceId}:${entry.page}`)
      }));
      turn.notice = turn.evidence.length
        ? quran ? ['Passende Fundstellen aus deiner Koran-PDF', 'Kur’an PDF’indeki ilgili bölümler']
          : ['Passende Stellen aus deinen Quellen', 'Kaynaklarındaki ilgili bölümler']
        : ['In den durchsuchbaren Quellen habe ich keine passende Stelle gefunden.', 'Aranabilen kaynaklarda uygun bir bölüm bulamadım.'];
      if (unavailable.length) {
        const labels = unavailable.join(', ');
        turn.notice = [turn.notice[0]+` Nicht durchsuchbar: ${labels}.`, turn.notice[1]+` Aranamadı: ${labels}.`];
      }
      if (scans.length) {
        const labels = scans.join(', ');
        turn.notice = [turn.notice[0]+` Ohne lesbare Textebene: ${labels}. Nutze die Texterkennung unter Quellen.`, turn.notice[1]+` Okunabilir metin katmanı yok: ${labels}. Kaynaklar menüsündeki metin tanımayı kullan.`];
      }
      const [first] = turn.evidence;
      if (quran && first?.ranges) {
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
    const source = options.find(entry => entry.id !== hadisId && entry.id === ocrSource.value);
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
      const key = sourceKey(source);
      const data = recognizedPages.get(key) || new Map();
      let count = 0;
      for (const row of rows) {
        if (!row.text.trim()) continue;
        data.set(row.page,{page:row.page,text:row.text,sourceId:source.id,source:source.title,ocr:true});
        count++;
      }
      if (count) {
        recognizedPages.set(key,data);
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
  quranFile.addEventListener('change', () => {
    const [file] = quranFile.files;
    quranFile.value = '';
    if (!allowed() || request || !file) return;
    try {
      validateUpload(file,'pdf');
      localQuran = {id:localQuranId, title:file.name, file, quran:true};
      selected.add(localQuranId);
      syncSources();
      notice = ['Koran-PDF geöffnet. Du kannst jetzt nach einem Thema suchen.', 'Kur’an PDF’si açıldı. Artık konuya göre arayabilirsin.'];
    } catch (error) {
      notice = [error.message,error.message];
    }
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
      localQuran = null;
      quranFile.value = '';
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
