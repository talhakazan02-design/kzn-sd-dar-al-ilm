(() => {
  'use strict';

  const ownValue = $('sidebarOwnBooks');
  const sharedValue = $('sidebarSharedBooks');
  const pageSize = 50;
  let session = 0;
  let owner = null;
  let ownRequest = 0;
  let sharedRequest = 0;
  let own = null;
  let shared = null;

  const approvedUser = () => accessState === 'approved' ? currentUser?.id ?? null : null;

  function render() {
    const format = new Intl.NumberFormat(libraryLocale());
    ownValue.textContent = own === null ? '—' : format.format(own);
    sharedValue.textContent = shared === null ? '—' : format.format(shared);
  }

  async function loadOwnCount() {
    const user = owner;
    const epoch = session;
    const request = ++ownRequest;
    try {
      const { count, error } = await db.from('books').select('id', { count: 'exact', head: true })
        .eq('owner_id', user).eq('visibility', 'private').is('deleted_at', null);
      if (epoch !== session || request !== ownRequest || user !== approvedUser()) return;
      own = error || !Number.isSafeInteger(count) || count < 0 ? null : count;
    } catch {
      if (epoch !== session || request !== ownRequest || user !== approvedUser()) return;
      own = null;
    }
    render();
  }

  async function loadSharedCount() {
    const epoch = session;
    const request = ++sharedRequest;
    const current = () => epoch === session && request === sharedRequest && owner === approvedUser();
    const ids = new Set();
    try {
      for (let start = 0; ; start += pageSize) {
        const { data, error } = await db.rpc('library_list_shared_books', { start_at: start });
        if (!current()) return;
        if (error || !Array.isArray(data) || data.length > pageSize) throw new Error('Incomplete catalog');
        for (const row of data) {
          if (!row?.id || ids.has(row.id)) throw new Error('Catalog changed during pagination');
          ids.add(row.id);
        }
        if (data.length < pageSize) break;
      }
      shared = ids.size;
    } catch {
      if (!current()) return;
      shared = null;
    }
    render();
  }

  function refresh() {
    if (!owner || owner !== approvedUser()) return;
    void loadOwnCount();
    void loadSharedCount();
  }

  function syncAccess() {
    const next = approvedUser();
    if (next === owner) return;
    owner = next;
    session++;
    own = shared = null;
    render();
    if (owner && booksLoaded) refresh();
  }

  document.addEventListener('library-access', syncAccess);
  document.addEventListener('library-books', refresh);
  document.addEventListener('library-shared-books', () => {
    if (owner && owner === approvedUser()) void loadSharedCount();
  });
  document.addEventListener('library-language', render);
  syncAccess();
})();
