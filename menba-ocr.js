(function () {
  'use strict';

  const TESSERACT_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js@7.0.0/dist';
  const TESSERACT_CORE_URL = 'https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0';
  const MODELS = new Map([
    ['mixed', 'ara+tur'],
    ['arabic', 'ara'],
    ['ottoman', 'ara+fas'],
    ['turkish', 'tur'],
  ]);
  const MAX_PAGES = 5;
  const REQUEST_TIMEOUT = 120_000;

  // This file also runs in a dedicated worker so cancellation can stop model loading.
  if (typeof WorkerGlobalScope !== 'undefined' && globalThis instanceof WorkerGlobalScope) {
    let tesseractWorker;
    globalThis.onmessage = async ({ data }) => {
      try {
        if (data.type === 'start') {
          importScripts(`${TESSERACT_URL}/tesseract.min.js`);
          const { createWorker, OEM, PSM } = globalThis.Tesseract;
          tesseractWorker = await createWorker(MODELS.get(data.language), OEM.LSTM_ONLY, {
            workerPath: `${TESSERACT_URL}/worker.min.js`,
            corePath: TESSERACT_CORE_URL,
            logger(event) {
              if (event.status === 'recognizing text') {
                globalThis.postMessage({ type: 'progress', progress: event.progress });
              }
            },
            errorHandler(error) {
              globalThis.postMessage({ type: 'error', message: String(error) });
            },
          });
          await tesseractWorker.setParameters({ tessedit_pageseg_mode: PSM.AUTO });
          globalThis.postMessage({ type: 'result' });
        } else {
          const { data: { text, confidence } } = await tesseractWorker.recognize(data.image);
          globalThis.postMessage({ type: 'result', value: { text, confidence } });
        }
      } catch (error) {
        globalThis.postMessage({ type: 'error', message: error.message || String(error) });
      }
    };
    return;
  }

  const workerScript = document.currentScript.src;

  function cancelable(promise, signal) {
    if (!signal) return promise;
    return new Promise((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
      if (signal.aborted) abort();
    });
  }

  async function workerRequest(worker, message, signal, onProgress) {
    signal?.throwIfAborted();
    let timeout;
    let handleMessage;
    let handleError;

    try {
      const result = new Promise((resolve, reject) => {
        handleMessage = ({ data }) => {
          if (data.type === 'progress') onProgress?.(data.progress);
          if (data.type === 'result') resolve(data.value);
          if (data.type === 'error') reject(new Error(data.message));
        };
        handleError = event => reject(new Error(event.message || 'OCR worker failed'));
        worker.addEventListener('message', handleMessage);
        worker.addEventListener('error', handleError);
        timeout = setTimeout(() => reject(new Error('OCR worker timed out')), REQUEST_TIMEOUT);
        worker.postMessage(message);
      });
      return await cancelable(result, signal);
    } finally {
      clearTimeout(timeout);
      worker.removeEventListener('message', handleMessage);
      worker.removeEventListener('error', handleError);
    }
  }

  async function renderPage(page, signal) {
    const { width, height } = page.getViewport({ scale: 1 });
    const scale = Math.min(3.5, 3200 / Math.max(width, height), Math.sqrt(8_000_000 / (width * height)));
    const viewport = page.getViewport({ scale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.ceil(viewport.width));
    canvas.height = Math.max(1, Math.ceil(viewport.height));
    const canvasContext = canvas.getContext('2d', { alpha: false });
    if (!canvasContext) throw new Error('OCR canvas is unavailable');

    const renderTask = page.render({ canvas, canvasContext, viewport, background: '#fff' });
    const abortRender = () => renderTask.cancel();
    signal?.addEventListener('abort', abortRender, { once: true });
    try {
      await cancelable(renderTask.promise, signal);
      const image = await cancelable(new Promise(resolve => canvas.toBlob(resolve)), signal);
      if (!image) throw new Error('OCR page could not be rendered');
      return image;
    } finally {
      signal?.removeEventListener('abort', abortRender);
      canvas.width = 0;
      canvas.height = 0;
    }
  }

  async function recognize(pdf, { start = 1, end = start, language = 'mixed', signal, onProgress } = {}) {
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end < start || end > pdf.numPages) {
      throw new RangeError('Invalid OCR page range');
    }
    const total = end - start + 1;
    if (total > MAX_PAGES) throw new RangeError(`OCR supports up to ${MAX_PAGES} pages per run`);
    if (!MODELS.has(language)) throw new RangeError('Invalid OCR language');
    signal?.throwIfAborted();

    const worker = new Worker(workerScript, { name: 'Menba OCR' });
    const pages = [];
    try {
      onProgress?.({ page: start, total, completed: 0, progress: 0 });
      await workerRequest(worker, { type: 'start', language }, signal);

      for (let pageNumber = start; pageNumber <= end; pageNumber += 1) {
        signal?.throwIfAborted();
        const completed = pages.length;
        const page = await cancelable(pdf.getPage(pageNumber), signal);
        signal?.throwIfAborted();
        const image = await renderPage(page, signal);
        const result = await workerRequest(worker, { type: 'recognize', image }, signal, progress => {
          onProgress?.({ page: pageNumber, total, completed, progress: (completed + progress) / total });
        });
        pages.push({ page: pageNumber, text: result.text.normalize('NFC').trim(), confidence: result.confidence });
        onProgress?.({ page: pageNumber, total, completed: pages.length, progress: pages.length / total });
      }
      return pages;
    } finally {
      worker.terminate();
    }
  }

  globalThis.MenbaOCR = Object.freeze({ recognize });
})();
