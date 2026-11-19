(() => {
  'use strict';

  const databaseName = 'kzn-sd-menba-preferences';
  const storeName = 'sources';
  const maxBytes = 50 * 1024 * 1024;

  const approvedAccount = accountId => typeof accountId === 'string' && accountId.length > 0
    && accessState === 'approved' && currentUser?.id === accountId;
  const validFile = file => file instanceof File && file.type === 'application/pdf'
    && file.size > 0 && file.size <= maxBytes;

  function openDatabase() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      let blocked = false;
      request.onupgradeneeded = () => request.result.createObjectStore(storeName);
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

  async function useStore(accountId, mode, operation) {
    const revision = accessRequest;
    const allowed = () => approvedAccount(accountId) && revision === accessRequest;
    const denied = () => new Error('Source preferences require the active account');
    if (!allowed()) throw denied();

    const database = await openDatabase();
    try {
      if (!allowed()) throw denied();
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(storeName, mode);
        const request = operation(transaction.objectStore(storeName));
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

  globalThis.MenbaSourcePreferences = Object.freeze({load, save});
})();
