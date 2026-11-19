(() => {
  'use strict';

  const databaseName = 'kzn-sd-menba-preferences';
  const storeName = 'sources';
  const indexName = 'document-text';
  const maxBytes = 50 * 1024 * 1024;

  const approvedAccount = accountId => typeof accountId === 'string' && accountId.length > 0
    && accessState === 'approved' && currentUser?.id === accountId;
  const validFile = file => file instanceof File && file.type === 'application/pdf'
    && file.size > 0 && file.size <= maxBytes;

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, 2);
      let blocked = false;
      request.onupgradeneeded = () => {
        for (const name of [storeName,indexName]) {
          if (!request.result.objectStoreNames.contains(name)) request.result.createObjectStore(name);
        }
      };
      request.onerror = () => reject(request.error);
      request.onblocked = () => {
        blocked = true;
        reject(new Error('Source preferences are unavailable'));
      };
      request.onsuccess = () => {
        const database = request.result;
        database.onversionchange = () => database.close();
        if (blocked) database.close();
        else resolve(database);
      };
    });
  }

  async function useStore(accountId, mode, operation, name = storeName) {
    const revision = accessRequest;
    const allowed = () => approvedAccount(accountId) && revision === accessRequest;
    const denied = () => new Error('Source preferences require the active account');
    if (!allowed()) throw denied();

    const database = await openDatabase();
    try {
      if (!allowed()) throw denied();
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(name, mode);
        const request = operation(transaction.objectStore(name));
        const abortIfAccountChanged = () => {
          if (!allowed()) {
            try { transaction.abort(); } catch { /* The transaction can already have committed. */ }
          }
        };
        const clearListener = () => document.removeEventListener('library-access', abortIfAccountChanged);

        transaction.onabort = () => {
          clearListener();
          reject(transaction.error || denied());
        };
        transaction.oncomplete = () => {
          clearListener();
          if (allowed()) resolve(request.result);
          else reject(denied());
        };
        document.addEventListener('library-access', abortIfAccountChanged);
      });
    } finally {
      database.close();
    }
  }

  function sanitizeIds(ids) {
    if (!Array.isArray(ids)) return [];
    return [...new Set(ids.filter(id => typeof id === 'string' && id.length > 0))];
  }

  async function load(accountId) {
    const entry = await useStore(accountId, 'readonly', store => store.get(accountId));
    if (!entry || !Array.isArray(entry.ids)) return null;
    return {ids:sanitizeIds(entry.ids), file:validFile(entry.file) ? entry.file : null};
  }

  async function save(accountId, {ids, file = null}) {
    if (file !== null && !validFile(file)) throw new Error('Invalid local PDF');
    await useStore(accountId, 'readwrite', store => store.put({ids:sanitizeIds(ids),file},accountId));
  }

  async function loadIndex(accountId, sourceId, version) {
    const entry = await useStore(accountId,'readonly',store => store.get([accountId,sourceId]),indexName);
    return entry?.version === version ? entry : null;
  }

  async function saveIndex(accountId, sourceId, version, update) {
    await useStore(accountId,'readwrite',store => {
      const key = [accountId,sourceId];
      const request = store.get(key);
      request.onsuccess = () => {
        const previous = request.result?.version === version ? request.result : {version,ocr:[]};
        const pages = new Map(previous.ocr.map(row => [row.page,row]));
        for (const row of update.ocr ?? []) pages.set(row.page,row);
        store.put({...previous,...update,ocr:[...pages.values()]},key);
      };
      return request;
    },indexName);
  }

  globalThis.MenbaSourcePreferences = Object.freeze({load, save, loadIndex, saveIndex});
})();
