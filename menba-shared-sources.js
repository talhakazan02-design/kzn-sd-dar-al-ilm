(() => {
  'use strict';

  const pageSize = 50;
  const sourceId = shareId => `shared:${shareId}`;

  function guard(accountId, signal) {
    const session = accessRequest;
    return () => {
      signal?.throwIfAborted();
      if (!accountId || accessState !== 'approved' || currentUser?.id !== accountId || accessRequest !== session) {
        throw new DOMException('Shared catalog session changed', 'AbortError');
      }
    };
  }

  async function list({accountId, signal} = {}) {
    const verify = guard(accountId, signal);
    const sources = [];
    const seen = new Set();
    verify();
    for (let start = 0; ; start += pageSize) {
      const {data, error} = await db.rpc('library_list_shared_books', {start_at:start});
      verify();
      if (error || !Array.isArray(data) || data.length > pageSize) throw Error('Shared catalog is unavailable');
      for (const row of data) {
        if (typeof row?.id !== 'string' || !row.id || seen.has(row.id)) throw Error('Shared catalog changed during loading');
        seen.add(row.id);
        if (row.has_pdf === true) {
          const title = typeof row.title === 'string' && row.title.trim() ? row.title.trim() : 'PDF';
          sources.push({id:sourceId(row.id), shareId:row.id, title,
            category:typeof row.category === 'string' ? row.category : undefined});
        }
      }
      if (data.length < pageSize) return sources;
    }
  }

  async function signedUrl(source, {accountId, signal} = {}) {
    const verify = guard(accountId, signal);
    verify();
    if (typeof source?.shareId !== 'string' || !source.shareId || source.id !== sourceId(source.shareId)) {
      throw Error('Invalid shared source');
    }
    const {data:path, error:lookupError} = await db.rpc('library_shared_book_pdf_path', {target_submission:source.shareId});
    verify();
    if (lookupError || typeof path !== 'string' || !path) throw Error('Shared PDF is unavailable');
    const {data, error} = await db.storage.from(STORAGE_BUCKET).createSignedUrl(path, 60);
    verify();
    if (error || typeof data?.signedUrl !== 'string' || !data.signedUrl) throw Error('Shared PDF is unavailable');
    return {path, url:data.signedUrl};
  }

  window.MenbaSharedSources = Object.freeze({list, signedUrl});
})();
