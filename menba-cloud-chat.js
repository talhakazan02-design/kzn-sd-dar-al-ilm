(() => {
  'use strict';

  const maxQuestionLength = 500;
  const maxPreviousLength = 250;
  const maxExcerpts = 3;
  const maxExcerptLength = 640;
  const maxAnswerLength = 650;
  const minQuoteLength = 15;
  const maxQuoteLength = 240;
  const maxResponseBytes = 12000;
  const timeoutMs = 20000;

  function parseEndpoint(value) {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
      const url = new URL(value);
      const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
      if (url.username || url.password || url.search || url.hash || url.pathname !== '/menba/answer') return null;
      return url.protocol === 'https:' || (loopback && url.protocol === 'http:') ? url : null;
    } catch {
      return null;
    }
  }

  const normalize = value => typeof value === 'string'
    ? value.normalize('NFC').replace(/[\p{Cc}\s]+/gu, ' ').trim() : '';

  function buildRequest(question, previousQuestion, evidence, language) {
    const current = normalize(question);
    if (!current || current.length > maxQuestionLength || !Array.isArray(evidence)) return null;
    const excerpts = evidence.slice(0, maxExcerpts).flatMap((row, index) => {
      if (row?.ocr) return [];
      const text = normalize(row?.text).slice(0, maxExcerptLength).trimEnd();
      return text.length >= minQuoteLength ? [{number:index + 1, text}] : [];
    });
    if (!excerpts.length) return null;
    return {
      question:current,
      previousQuestion:normalize(previousQuestion).slice(0, maxPreviousLength).trimEnd(),
      language:language === 'tr' || language === 'ar' ? language : 'de',
      excerpts,
    };
  }

  function validateReply(reply, excerpts) {
    if (typeof reply?.text !== 'string' || reply.text.length > maxAnswerLength) return null;
    const text = normalize(reply?.text);
    const citations = reply?.citations;
    if (!/\p{L}/u.test(text) || /(?:https?:\/\/|www\.|<[^>]*>|\[\s*\d)/iu.test(text)) return null;
    if (!Array.isArray(citations) || !citations.length || citations.length > excerpts.length) return null;
    const byNumber = new Map(excerpts.map(excerpt => [excerpt.number, excerpt.text]));
    const confirmed = new Set();
    for (const citation of citations) {
      const number = citation?.number;
      if (typeof citation?.quote !== 'string' || citation.quote.length > maxQuoteLength) return null;
      const quote = normalize(citation?.quote);
      if (!Number.isInteger(number) || !byNumber.has(number) || confirmed.has(number)) return null;
      const excerpt = byNumber.get(number);
      if (quote.length < minQuoteLength || !excerpt.includes(quote) || excerpt.includes(text)) return null;
      confirmed.add(number);
    }
    return {text, citations:[...confirmed]};
  }

  const isApproved = () => accessState === 'approved' && Boolean(currentUser?.id);
  const isApprovedOwner = () => isApproved() && document.documentElement.dataset.betaOwner === 'true';

  async function answer({endpoint, consent = false, question, previousQuestion = '', evidence, language = 'de', signal, onFailure} = {}) {
    const url = parseEndpoint(endpoint);
    if (consent !== true || !url || !isApproved() || signal?.aborted) return null;
    const body = buildRequest(question, previousQuestion, evidence, language);
    if (!body) return null;

    const account = currentUser.id;
    const revision = accessRequest;
    const stillCurrent = () => isApproved() && currentUser.id === account && accessRequest === revision;
    const request = new AbortController();
    const abort = () => request.abort();
    const accessChanged = () => { if (!stillCurrent()) abort(); };
    const cancelled = new Promise(resolve => request.signal.addEventListener('abort', () => resolve(null), {once:true}));
    const timer = setTimeout(abort, timeoutMs);
    signal?.addEventListener('abort', abort, {once:true});
    document.addEventListener('library-access', accessChanged);
    document.addEventListener('beta-role-access', accessChanged);
    try {
      const auth = await Promise.race([db.auth.getSession(), cancelled]);
      const session = auth?.data?.session;
      if (!stillCurrent() || request.signal.aborted || auth?.error || session?.user?.id !== account
        || typeof session.access_token !== 'string' || !/^[A-Za-z0-9._-]{20,4096}$/u.test(session.access_token)) return null;
      const response = await fetch(url.href, {
        method:'POST',
        credentials:'omit',
        cache:'no-store',
        redirect:'error',
        referrerPolicy:'no-referrer',
        signal:request.signal,
        headers:{Accept:'application/json', 'Content-Type':'application/json', Authorization:`Bearer ${session.access_token}`},
        body:JSON.stringify(body),
      });
      if (!stillCurrent() || request.signal.aborted) return null;
      if (response.status !== 200) {
        if (response.status !== 204) onFailure?.(response.status === 429 ? 'limit' : 'technical');
        return null;
      }
      if (Number(response.headers.get('Content-Length')) > maxResponseBytes) return null;
      const raw = await response.text();
      if (!stillCurrent() || request.signal.aborted || raw.length > maxResponseBytes) return null;
      return validateReply(JSON.parse(raw), body.excerpts);
    } catch {
      if (stillCurrent() && !signal?.aborted) onFailure?.('technical');
      return null;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      document.removeEventListener('library-access', accessChanged);
      document.removeEventListener('beta-role-access', accessChanged);
    }
  }

  async function quota(endpoint, {account,limit,signal} = {}) {
    const answerUrl = parseEndpoint(endpoint);
    if (!answerUrl || !isApprovedOwner()) return null;
    const user = currentUser.id;
    const revision = accessRequest;
    const current = () => isApprovedOwner() && currentUser.id === user && accessRequest === revision && !signal?.aborted;
    const {data,error} = await db.auth.getSession();
    const token = data?.session?.access_token;
    if (error || !current() || data?.session?.user?.id !== user || typeof token !== 'string') return null;
    const response = await fetch(new URL('/menba/quota',answerUrl), {
      method:'POST', credentials:'omit', redirect:'error', cache:'no-store', referrerPolicy:'no-referrer',
      signal:signal ? AbortSignal.any([signal,AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000),
      headers:{'Content-Type':'application/json',Authorization:`Bearer ${token}`},
      body:JSON.stringify({account,limit})
    });
    if (!response.ok || !current()) return null;
    const status = await response.json();
    if (!current() || status?.budget !== 10000 || !/^\d{4}-\d{2}-\d{2}$/u.test(status.day)
        || ![status.total,status.limit,status.used].every(value=>Number.isSafeInteger(value) && value >= 0)) return null;
    return status;
  }

  globalThis.MenbaCloudChat = Object.freeze({canUse:endpoint => Boolean(parseEndpoint(endpoint)), answer, quota});
})();
