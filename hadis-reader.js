(() => {
  'use strict';

  const reader = $('hadisReader');
  const sourcePicker = $('hadisSource');
  const filePicker = $('hadisFile');
  const drawButton = $('hadisRandom');
  const preview = $('hadisPreview');
  const sourceNote = $('hadisSourceNote');
  const status = $('hadisStatus');

  const pdfBase = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@6.5.438/';
  const knownDigest = '09af87fe99667762616708871a8501249e398e781e1dbd4655a2e78b7cc66e72';
  // Normalized original-scan boxes in printed order, excluding date captions.
  const excerptBoxes = [
    [1,0.096403,0.104888,0.397122,0.069246],
    [1,0.096403,0.182281,0.397122,0.069246],
    [1,0.096403,0.259674,0.397122,0.069246],
    [1,0.096403,0.338086,0.397122,0.069246],
    [1,0.096403,0.415479,0.397122,0.069246],
    [1,0.096403,0.49389,0.397122,0.069246],
    [1,0.096403,0.572301,0.397122,0.069246],
    [1,0.096403,0.648676,0.397122,0.069246],
    [1,0.096403,0.726069,0.397122,0.069246],
    [1,0.096403,0.804481,0.397122,0.069246],
    [1,0.096403,0.880855,0.397122,0.069246],
    [1,0.564029,0.107943,0.398561,0.069246],
    [1,0.564029,0.185336,0.398561,0.069246],
    [1,0.564029,0.262729,0.398561,0.069246],
    [1,0.564029,0.341141,0.398561,0.069246],
    [1,0.564029,0.418534,0.398561,0.069246],
    [1,0.564029,0.495927,0.398561,0.069246],
    [1,0.564029,0.574338,0.398561,0.069246],
    [1,0.564029,0.651731,0.398561,0.069246],
    [1,0.564029,0.729124,0.398561,0.069246],
    [1,0.564029,0.806517,0.398561,0.069246],
    [1,0.564029,0.884929,0.398561,0.069246],
    [2,0.093525,0.105906,0.4,0.069246],
    [2,0.093525,0.184318,0.4,0.069246],
    [2,0.093525,0.261711,0.4,0.069246],
    [2,0.093525,0.339104,0.4,0.069246],
    [2,0.093525,0.416497,0.4,0.069246],
    [2,0.093525,0.495927,0.4,0.069246],
    [2,0.093525,0.572301,0.4,0.069246],
    [2,0.093525,0.650713,0.4,0.069246],
    [2,0.093525,0.727088,0.4,0.069246],
    [2,0.093525,0.805499,0.4,0.069246],
    [2,0.093525,0.881874,0.4,0.069246],
    [2,0.558273,0.102851,0.392806,0.069246],
    [2,0.558273,0.181263,0.392806,0.069246],
    [2,0.558273,0.257637,0.392806,0.069246],
    [2,0.558273,0.337067,0.392806,0.069246],
    [2,0.558273,0.41446,0.392806,0.069246],
    [2,0.558273,0.492872,0.392806,0.069246],
    [2,0.558273,0.570265,0.392806,0.069246],
    [2,0.558273,0.647658,0.392806,0.069246],
    [2,0.558273,0.726069,0.392806,0.069246],
    [2,0.558273,0.804481,0.392806,0.069246],
    [2,0.558273,0.881874,0.392806,0.069246]
  ];
  let generation = 0;
  let owner = null;
  let selected = null;
  let pdfModule = null;
  let documentTask = null;
  let rendering = null;
  let controller = null;
  let documentPdf = null;
  let excerpts = false;
  let lastIndex = -1;
  let currentPage = null;
  let message = null;
  let busy = false;

  const ownPdfs = () => books.filter(book =>
    book.owner_id === currentUser?.id && book.visibility === 'private' && !book.deleted_at && book.file_path
  );
  const entryLabel = () => excerpts ? tr('Ganze Originalseite', 'Orijinal sayfanın tamamı') : '';

  function updateLabels() {
    sourcePicker.options[0].textContent = tr('PDF aus meinen Büchern wählen', 'Kitaplarımdan PDF seç');
    drawButton.textContent = excerpts
      ? tr('Zufälliger Hadis-i Şerif', 'Rastgele hadis-i şerif')
      : tr('Zufällige Seite', 'Rastgele sayfa');
    drawButton.disabled = !selected || busy;
    status.textContent = message ? tr(...message) : '';
    reader.setAttribute('aria-busy', String(busy));
    const canvas = preview.querySelector('canvas');
    if (canvas && currentPage) {
      canvas.setAttribute('aria-label', tr('Originalscan aus der PDF-Datei', 'PDF dosyasından orijinal tarama'));
      sourceNote.textContent = `${selected.name} · ${tr('Seite', 'Sayfa')} ${currentPage} / ${documentPdf.numPages}`;
    }
    $('hadisFullPage').textContent = entryLabel();
  }

  function clearPreview() {
    currentPage = null;
    preview.hidden = true;
    preview.replaceChildren();
    sourceNote.textContent = '';
    $('hadisFullPage').hidden = true;
  }

  function setSource(source) {
    generation++;
    controller?.abort();
    rendering?.cancel();
    documentTask?.destroy().catch(() => {});
    controller = rendering = documentTask = documentPdf = null;
    selected = source;
    excerpts = false;
    lastIndex = -1;
    busy = false;
    message = null;
    clearPreview();
    updateLabels();
  }

  async function loadPdf(source, request) {
    controller = new AbortController();
    const {signal} = controller;
    let bytes;
    if (source.file) {
      bytes = await source.file.arrayBuffer();
    } else {
      const {data, error} = await db.storage.from(STORAGE_BUCKET).createSignedUrl(source.path, 900);
      if (error || !data?.signedUrl) throw new Error('PDF access failed');
      if (signal.aborted) return;
      const response = await fetch(data.signedUrl, {signal, referrerPolicy: 'no-referrer'});
      if (!response.ok) throw new Error('PDF download failed');
      bytes = await response.arrayBuffer();
    }
    if (request !== generation) return;

    const digest = await crypto.subtle?.digest('SHA-256', bytes);
    const fingerprint = digest && Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    pdfModule ??= import(pdfBase + 'build/pdf.min.mjs').catch(error => {
      pdfModule = null;
      throw error;
    });
    const pdfjs = await pdfModule;
    if (request !== generation) return;
    pdfjs.GlobalWorkerOptions.workerSrc = pdfBase + 'build/pdf.worker.min.mjs';
    documentTask = pdfjs.getDocument({
      data: bytes,
      isEvalSupported: false,
      cMapUrl: pdfBase + 'cmaps/',
      cMapPacked: true,
      standardFontDataUrl: pdfBase + 'standard_fonts/',
      wasmUrl: pdfBase + 'wasm/'
    });
    const loaded = await documentTask.promise;
    if (request !== generation) return;
    documentPdf = loaded;
    excerpts = fingerprint === knownDigest && loaded.numPages === 2;
  }

  function randomIndex(count) {
    if (count < 2) return 0;
    if (lastIndex < 0) return Math.floor(Math.random() * count);
    const index = Math.floor(Math.random() * (count - 1));
    return index < lastIndex ? index : index + 1;
  }

  async function showRandom(fullPage = false) {
    if (!selected || busy || !currentUser || accessState !== 'approved') return;
    const request = generation;
    busy = true;
    message = [ 'PDF wird geladen …', 'PDF yükleniyor …' ];
    updateLabels();
    try {
      if (!documentPdf) await loadPdf(selected, request);
      if (request !== generation) return;
      const index = fullPage ? lastIndex : randomIndex(excerpts ? excerptBoxes.length : documentPdf.numPages);
      const pageNumber = excerpts ? excerptBoxes[index][0] : index + 1;
      const page = await documentPdf.getPage(pageNumber);
      if (request !== generation) return;
      const crop = excerpts && !fullPage ? excerptBoxes[index] : null;
      const [, x, y, width, height] = crop || [];
      const reference = page.getViewport({scale: 1});
      const scale = crop ? 820 / (reference.width * width) : Math.min(1100 / reference.width, 1550 / reference.height);
      const viewport = page.getViewport({scale});
      const canvas = document.createElement('canvas');
      canvas.setAttribute('role','img');
      canvas.width = Math.round(crop ? viewport.width * width : viewport.width);
      canvas.height = Math.round(crop ? viewport.height * height : viewport.height);
      const transform = crop ? [1, 0, 0, 1, -viewport.width * x, -viewport.height * y] : null;
      rendering = page.render({canvas, viewport, transform});
      await rendering.promise;
      if (request !== generation) return;
      lastIndex = index;
      currentPage = pageNumber;
      preview.replaceChildren(canvas);
      preview.hidden = false;
      $('hadisFullPage').hidden = !crop;
      message = null;
    } catch {
      if (request !== generation) return;
      if (!documentPdf) {
        documentTask?.destroy().catch(() => {});
        documentTask = null;
      }
      message = ['Die PDF konnte nicht angezeigt werden. Wähle die Datei erneut.', 'PDF görüntülenemedi. Dosyayı yeniden seç.'];
    } finally {
      if (request === generation) {
        rendering = null;
        busy = false;
        updateLabels();
      }
    }
  }

  const bookSource = book => ({id: book.id, path: book.file_path, name: book.title || book.file_name});
  function syncBooks() {
    const available = ownPdfs();
    sourcePicker.replaceChildren(new Option('', ''), ...available.map(book => new Option(book.title || book.file_name, book.id)));
    const book = available.find(entry => entry.id === selected?.id);
    if (selected?.id && (!book || book.file_path !== selected.path)) setSource(book ? bookSource(book) : null);
    if (!selected) {
      // Recognize the attached collection by its title for automatic selection;
      // apply excerpt coordinates only after checking the full file digest.
      const match = available.find(entry => [entry.title, entry.file_name].some(name =>
        /hadis\s*i?\s*[sş]e[rt]?i?f/i.test((name || '').normalize('NFKC').replace(/[-_]/g, ' '))
      ));
      if (match) {
        setSource(bookSource(match));
        showRandom();
      }
    }
    sourcePicker.value = selected?.id || '';
    updateLabels();
  }

  sourcePicker.addEventListener('change', () => {
    const book = ownPdfs().find(entry => entry.id === sourcePicker.value);
    filePicker.value = '';
    setSource(book ? bookSource(book) : null);
    if (book) showRandom();
  });
  filePicker.addEventListener('change', () => {
    const file = filePicker.files[0];
    if (!file || !currentUser || accessState !== 'approved') return;
    filePicker.value = '';
    if (!/\.pdf$/i.test(file.name) || file.size > PDF_MAX_BYTES) {
      message = ['Wähle eine PDF-Datei bis 50 MB.', 'En fazla 50 MB boyutunda bir PDF seç.'];
      updateLabels();
      return;
    }
    sourcePicker.value = '';
    setSource({file, name: file.name});
    showRandom();
  });
  drawButton.addEventListener('click', () => showRandom());
  $('hadisFullPage').addEventListener('click', () => showRandom(true));
  document.addEventListener('library-books', syncBooks);
  document.addEventListener('library-language', updateLabels);
  document.addEventListener('library-access', event => {
    const nextOwner = event.detail.approved ? currentUser?.id : null;
    if (owner !== nextOwner) {
      owner = nextOwner;
      filePicker.value = '';
      setSource(null);
      syncBooks();
    }
  });
  owner = accessState === 'approved' ? currentUser?.id : null;
  syncBooks();
})();
