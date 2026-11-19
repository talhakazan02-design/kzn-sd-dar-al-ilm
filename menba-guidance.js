(() => {
  'use strict';

  const templates = [
    ['Thema erklären','Konuyu Açıkla','Was ist {topic}? Kannst du es erklären?','{topic} nedir? Açıklar mısın?'],
    ['Einfach erklären','Basitçe Anlat','Kannst du {topic} einfacher erklären?','{topic} konusunu daha basit anlatır mısın?'],
    ['Im Buch nachschlagen','Kitaptan Bilgi Bul','Was steht in „{book}“ zum Thema {topic}?','„{book}“ kitabında {topic} hakkında ne yazıyor?'],
    ['Abschnitt zusammenfassen','Özet Hazırla','Kannst du den Abschnitt {chapter} in „{book}“ zusammenfassen?','„{book}“ kitabının {chapter} bölümünü özetler misin?'],
    ['Beispiele finden','Örnek Ver','Welche Beispiele für {topic} nennen meine Quellen?','{topic} hakkında kaynaklara dayalı örnekler verebilir misin?'],
    ['Wiederholungsfragen vorbereiten','Soru Hazırla','Kannst du fünf Wiederholungsfragen zu {topic} vorbereiten?','{topic} hakkında 5 tekrar sorusu hazırlar mısın?'],
    ['Test vorbereiten','Test Oluştur','Kannst du einen Test mit fünf Fragen zu {topic} vorbereiten?','{topic} hakkında 5 soruluk bir test hazırlar mısın?'],
    ['Auf Deutsch erklären','Almanca Açıkla','Kannst du {topic} auf Deutsch erklären?','{topic} konusunu Almanca açıklar mısın?'],
    ['Auf Türkisch erklären','Türkçe Açıkla','Kannst du {topic} auf Türkisch erklären?','{topic} konusunu Türkçe açıklar mısın?'],
    ['Schritt für Schritt erklären','Hocam, Anlamadım','Ich habe {topic} nicht verstanden. Kannst du es Schritt für Schritt erklären?','{topic} konusunu anlamadım. Bana adım adım anlatır mısın?']
  ];
  const labels = {topic:['Thema','Konu'],book:['Buchtitel','Kitap adı'],chapter:['Abschnitt','Bölüm']};
  const choice = $('menbaTemplateChoice');
  const templateForm = $('menbaTemplateFields');
  const templateInputs = $('menbaTemplateInputs');
  const preview = $('menbaTemplatePreview');
  const suggest = $('menbaSuggest');
  const suggestStatus = $('menbaSuggestStatus');
  const suggested = $('menbaSuggestedQuestions');
  const center = $('menbaTestCenter');
  const sourcePicker = $('menbaTestSource');
  const report = $('menbaTestReport');
  const status = $('menbaTestStatus');
  const run = $('menbaTestRun');
  const reprocess = $('menbaTestReprocess');
  const cancel = $('menbaTestCancel');
  const tests = window.MenbaDiagnosticAccess;
  let suggestionRun = null;
  let labRun = null;
  let result = null;
  let menbaBusy = false;
  const format = /\{(topic|book|chapter)\}/gu;
  const statuses = {
    pass:['Bestanden','Başarılı'],fail:['Fehlgeschlagen','Başarısız'],
    review:['Prüfung erforderlich','Kontrol gerekiyor'],skip:['Übersprungen','Atlandı']
  };

  function fillQuestion(text) {
    const input = $('menbaQuestion');
    if (input.disabled || !text || text.length > input.maxLength) return;
    input.value = text;
    input.focus();
  }

  function fields() {
    return new Map([...templateInputs.querySelectorAll('input')].map(input=>[input.name,input.value]));
  }

  function formatQuestion(showPlaceholders) {
    const template = templates[choice.value];
    if (!template) return '';
    const values = fields();
    return tr(template[2],template[3]).replace(format,(_,key)=>values.get(key)?.trim()
      || (showPlaceholders ? '['+tr(...labels[key])+']' : ''));
  }

  function renderFields(prefill = new Map()) {
    const template = templates[choice.value];
    templateForm.hidden = !template;
    templateInputs.replaceChildren();
    if (!template) { preview.textContent = ''; return; }
    for (const key of new Set([...tr(template[2],template[3]).matchAll(format)].map(match=>match[1]))) {
      const label = document.createElement('label');
      label.textContent = tr(...labels[key]);
      const input = document.createElement('input');
      input.dir = 'auto';
      input.name = key;
      input.required = true;
      input.maxLength = 130;
      input.value = prefill.get(key) ?? '';
      label.append(input);
      templateInputs.append(label);
    }
    preview.textContent = formatQuestion(true);
  }

  function renderTemplates() {
    const earlier = choice.value;
    const saved = fields();
    choice.replaceChildren(new Option(tr('Vorlage auswählen','Şablon seç'),''),...templates.map(([de,turkish],index)=>new Option(tr(de,turkish),String(index))));
    choice.value = earlier;
    renderFields(saved);
  }

  function clearSuggestions() {
    suggested.replaceChildren();
    suggestStatus.textContent = '';
  }

  async function showSuggestions() {
    if (suggestionRun || accessState !== 'approved') return;
    const active = new AbortController();
    const session = accessRequest;
    suggestionRun = active;
    clearSuggestions();
    suggest.disabled = true;
    suggestStatus.textContent = tr('Quellen und Fragen werden geprüft …','Kaynaklar ve sorular kontrol ediliyor …');
    try {
      const output = await tests.suggestQuestions(active.signal);
      if (active.signal.aborted || session !== accessRequest || accessState !== 'approved') return;
      const useful = output.filter(row=>row.citation);
      suggestStatus.textContent = useful.length ? tr('Gültig für die aktuell gewählten Quellen.','Geçerli kaynak seçimi için kontrol edildi.')
        : tr('Aus den ausgewählten Quellen ließ sich noch keine überprüfbare Frage ableiten. Prüfe die Texterkennung oder wähle ein lesbares PDF.',
          'Seçili kaynaklardan henüz doğrulanabilir bir soru çıkarılamadı. Metin tanımayı kontrol et veya okunabilir bir PDF seç.');
      for (const row of useful) {
        const li = document.createElement('li');
        const button = document.createElement('button');
        const tag = document.createElement('small');
        button.type = 'button';
        button.dir = 'auto';
        button.textContent = row.text;
        button.addEventListener('click',()=>fillQuestion(row.text));
        tag.textContent = row.status === 'pass' ? tr('Getestet – funktioniert','Test Edildi – Çalışıyor')
          : tr('Quellenbasiert','Kaynağa Dayalı');
        li.append(button,tag);
        suggested.append(li);
      }
    } catch (error) {
      if (active.signal.aborted || session !== accessRequest) return;
      suggestStatus.textContent = error.message === 'selection' ? tr('Wähle zuerst eine Quelle.','Lütfen önce kaynak seçin.')
        : tr('Die Quellen konnten gerade nicht geprüft werden.','Kaynaklar şu anda kontrol edilemedi.');
    } finally {
      if (suggestionRun === active) { suggestionRun = null; suggest.disabled = menbaBusy; }
    }
  }

  function isOwner() {
    return accessState === 'approved' && document.documentElement.dataset.betaOwner === 'true';
  }

  function syncCenter() {
    center.hidden = !isOwner();
    const old = sourcePicker.value;
    const sources = isOwner() ? tests.selectedSources() : [];
    sourcePicker.replaceChildren(new Option(tr('Quelle auswählen','Kaynak seç'),''),...sources.map(row=>new Option(row.title,row.id)));
    if (sources.some(row=>row.id === old)) sourcePicker.value = old;
    else if (sources.length === 1) sourcePicker.value = sources[0].id;
    cancel.hidden = !labRun;
    const busy = Boolean(labRun);
    sourcePicker.disabled = busy || !sources.length;
    run.disabled = reprocess.disabled = busy || menbaBusy || !sourcePicker.value;
    if (!busy && !sources.length && isOwner()) {
      status.textContent = tr('Wähle zuerst Quellen im MENBA-Bereich.','Önce MENBA bölümünde kaynak seç.');
    }
  }

  function renderReport() {
    report.replaceChildren();
    if (!result || !isOwner()) return;
    const {record,ocr,stored,questions,multilingual,pages,privateIndex,localFile,publicText} = result;
    const title = document.createElement('h3');
    title.textContent = result.title;
    const active = questions.filter(row=>row.status === 'pass');
    const extract = record.extract;
    const available = record.download || publicText && pages || localFile && !record.error;
    const reading = extract?.readable ? extract.failed ? 'review' : 'pass' : record.error ? 'fail' : 'review';
    const errors = {
      sign:tr('Storage hat keinen gültigen Zugriff erteilt.','Depolama erişimi verilemedi.'),
      download:tr('Der PDF-Download ist fehlgeschlagen.','PDF indirilemedi.'),
      size:tr('Die Datei ist leer oder größer als 50 MB.','Dosya boş veya 50 MB sınırını aşıyor.'),
      extract:tr('Das PDF konnte nicht geöffnet oder verarbeitet werden.','PDF açılamadı veya işlenemedi.')
    };
    const storageDetail = record.error ? errors[record.error] || record.error
      : available ? tr('Datei konnte gelesen werden.','Dosya okunabildi.') : tr('Kein Dateizugriff bestätigt.','Dosya erişimi doğrulanamadı.');
    const checks = [
      [tr('Dokumentverfügbarkeit','Belge erişimi'),available?'pass':'fail',storageDetail],
      [tr('PDF-Text / Index','PDF metni / dizin'),localFile && !extract?.readable && ocr.state === 'pass' ? 'review' : reading,
        extract ? tr(`${extract.readable}/${extract.total} Seiten mit Textebene · ${extract.failed} Lesefehler.`,`${extract.total} sayfanın ${extract.readable} tanesinde metin · ${extract.failed} okuma hatası.`) : storageDetail],
      [tr('OCR','OCR'),ocr.state,ocr.page ? tr(`Seite ${ocr.page} · mit Original vergleichen.`,`Sayfa ${ocr.page} · özgün sayfayla karşılaştır.`) : tr('Keine OCR-Probe in diesem Lauf.','Bu testte OCR örneği kullanılmadı.')],
      [tr('Lokale Speicherung','Yerel kayıt'),stored === true?'pass':privateIndex?(extract?'fail':'skip'):'skip',
        stored === true ? tr('Index erneut aus dem Browser-Speicher gelesen.','Dizin tarayıcı deposundan yeniden okundu.')
          : tr('Kein dauerhaft gespeicherter Index in diesem Lauf bestätigt. Gemeinsame Quellen werden sitzungsbezogen geprüft.','Bu testte kalıcı dizin doğrulanmadı. Ortak kaynaklar oturumda denetlenir.')],
      [tr('Volltextsuche','Tam metin araması'),active.length?'pass':pages?'review':'fail',tr(`${active.length} vollständig geprüfte Fragen.`,`${active.length} tam doğrulanmış soru.`)],
      [tr('Mehrsprachige Anfrageformen','Çok dilli soru biçimleri'),multilingual.every(value=>value==='pass')?'pass':'review',`DE / TR / AR · ${multilingual.map(value=>tr(...statuses[value])).join(' · ')}`],
      [tr('Vektorsuche','Vektör araması'),'skip',tr('MENBA verwendet Volltext und mehrsprachige Begriffe.','MENBA tam metin ve çok dilli terimler kullanır.')],
      [tr('Supabase-Textsuche','Supabase metin araması'),'skip',tr('Supabase prüft Konten und Dateien. Der Textindex wird im Browser durchsucht.','Supabase hesapları ve dosyaları denetler. Metin dizini tarayıcıda aranır.')],
      [tr('Quellenauswahl','Kaynak seçimi'),result.scopeClean?'pass':'fail',tr('Kontrollfrage ohne Quellen darf keine Treffer liefern.','Kaynaksız kontrol sorusu sonuç vermemeli.')],
      [tr('Berechtigungen','İzinler'),available?'pass':'review',tr('Admin-Rolle per Supabase geprüft. Zugriff auf diese Quelle separat geprüft.','Yönetici rolü Supabase ile kontrol edildi. Bu kaynağa erişim ayrıca denetlendi.')],
      [tr('Antworten und Zitate','Yanıtlar ve alıntılar'),active.length?'pass':pages?'review':'fail',tr('Auszug oder belegte Kurzantwort mit nachgeprüfter Quelle.','Alıntı veya kaynağı doğrulanmış kısa cevap.')],
      [tr('Seitenangaben','Sayfa bilgileri'),active.length?'pass':'skip',tr('Buch, Seite und Text wurden im Index abgeglichen. OCR-Zitate brauchen Sichtprüfung.','Kitap, sayfa ve metin dizinle karşılaştırıldı. OCR alıntıları görsel kontrol ister.')],
      [tr('Cloud-KI','Bulut yapay zekâsı'),'skip',result.cloudConfigured ? tr('Kein externer Aufruf im automatischen Test.','Otomatik test dış hizmeti çağırmadı.') : tr('Kein Modell-Endpunkt verbunden.','Model bağlantısı yapılandırılmamış.')],
      [tr('Kontrollfrage ohne Beleg','Kaynağı olmayan kontrol sorusu'),result.wrongMatch?'fail':'pass',tr('Eine absichtlich unpassende Frage darf keine Belege liefern.','Kasıtlı ilgisiz soru kaynak göstermemeli.')]
    ];
    const list = document.createElement('ul');
    list.className = 'menba-test-results';
    for (const [label,state,detail] of checks) {
      const li = document.createElement('li');
      const heading = document.createElement('strong');
      heading.textContent = label;
      const badge = document.createElement('span');
      badge.dataset.status = state;
      badge.textContent = tr(...statuses[state]);
      const description = document.createElement('small');
      description.textContent = detail;
      li.append(heading,badge,description);
      list.append(li);
    }
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = tr(`Fragen · ${active.length}/${questions.length} vollständig bestanden`,`Sorular · ${active.length}/${questions.length} tam başarılı`);
    const questionList = document.createElement('ul');
    questionList.className = 'menba-test-results';
    for (const row of questions) {
      const li = document.createElement('li');
      li.dir = 'auto';
      const question = document.createElement('strong');
      question.textContent = row.text;
      const detail = document.createElement('small');
      detail.textContent = row.citation ? `${row.citation.source} · ${tr('Seite','Sayfa')} ${row.citation.page}${row.citation.verse ? ` · ${row.citation.verse}` : ''}`
        : row.found ? tr('Treffer gefunden. Aussage oder Zuordnung braucht Prüfung.','Sonuç bulundu. Anlam veya kaynak eşleşmesi kontrol edilmeli.')
          : tr('Keine passende Textstelle.','Uygun metin bölümü bulunamadı.');
      li.append(question,document.createTextNode(tr(...statuses[row.status])),detail);
      questionList.append(li);
    }
    details.append(summary,questionList);
    report.append(title,list,details);
  }

  function clearReport() {
    result = null;
    report.replaceChildren();
    status.textContent = '';
  }

  async function diagnose(forceOcr = false) {
    if (!isOwner() || labRun || !sourcePicker.value) return;
    const session = accessRequest;
    const selected = sourcePicker.value;
    const active = new AbortController();
    labRun = active;
    clearReport();
    syncCenter();
    status.textContent = tr('Quelle wird geprüft …','Kaynak kontrol ediliyor …');
    const current = () => accessRequest === session && isOwner() && labRun === active;
    try {
      const next = await tests.diagnoseSource(selected,{
        signal:active.signal,useOcr:forceOcr || $('menbaTestOcr').checked,language:$('menbaTestLanguage').value,
        onProgress(stage,values) {
          if (!current()) return;
          if (stage === 'page') status.textContent = tr(`PDF-Seite ${values.number}/${values.total} wird gelesen …`,`PDF sayfası okunuyor: ${values.number}/${values.total} …`);
          if (stage === 'ocr') status.textContent = tr(`OCR liest Seite ${values.page} …`,`OCR ${values.page}. sayfayı okuyor …`);
        }
      });
      if (!current()) return;
      result = next;
      renderReport();
      status.textContent = tr('Prüfung abgeschlossen.','Kontrol tamamlandı.');
    } catch(error) {
      if (current()) status.textContent = active.signal.aborted ? tr('Prüfung abgebrochen.','Kontrol iptal edildi.')
        : error.message === 'access' ? tr('Der Server konnte die Admin-Berechtigung nicht bestätigen.','Sunucu yönetici yetkisini doğrulayamadı.')
          : error.message === 'rate' ? tr('Warte kurz zwischen zwei Diagnosen.','İki test arasında kısaca bekle.')
          : tr('Die Prüfung konnte nicht abgeschlossen werden.','Kontrol tamamlanamadı.');
    } finally {
      if (labRun === active) { labRun = null; syncCenter(); }
    }
  }

  choice.addEventListener('change',()=>renderFields());
  templateForm.addEventListener('input',()=>{ preview.textContent = formatQuestion(true); });
  templateForm.addEventListener('submit',event=>{
    event.preventDefault();
    if ([...fields().values()].every(value=>value.trim())) fillQuestion(formatQuestion(false));
  });
  suggest.addEventListener('click',()=>void showSuggestions());
  center.addEventListener('toggle',syncCenter);
  sourcePicker.addEventListener('change',()=>{ clearReport(); syncCenter(); });
  run.addEventListener('click',()=>void diagnose());
  reprocess.addEventListener('click',()=>void diagnose(true));
  cancel.addEventListener('click',()=>labRun?.abort());
  $('betaAdminClose').addEventListener('click',()=>{ labRun?.abort(); clearReport(); });
  document.addEventListener('menba-source-change',()=>{
    if (!suggestionRun) clearSuggestions();
    if (!labRun) clearReport();
    syncCenter();
  });
  document.addEventListener('library-access',()=>{
    suggestionRun?.abort();
    labRun?.abort();
    clearSuggestions();
    clearReport();
    choice.value = '';
    renderFields();
    syncCenter();
  });
  document.addEventListener('beta-role-access',syncCenter);
  document.addEventListener('menba-busy',event=>{
    menbaBusy = event.detail;
    suggest.disabled = menbaBusy || Boolean(suggestionRun);
    syncCenter();
  });
  document.addEventListener('library-language',()=>{
    renderTemplates();
    clearSuggestions();
    syncCenter();
    renderReport();
  });
  renderTemplates();
  syncCenter();
})();
