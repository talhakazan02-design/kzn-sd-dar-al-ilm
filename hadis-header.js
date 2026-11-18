(() => {
  'use strict';

  const card = document.getElementById('publicHadis');
  const button = document.getElementById('publicHadisNext');
  const quote = document.getElementById('publicHadisQuote');
  const arabic = document.getElementById('publicHadisArabic');
  const turkish = document.getElementById('publicHadisTurkish');
  const source = document.getElementById('publicHadisSource');
  const status = document.getElementById('publicHadisStatus');
  let entries = [];
  let selected = -1;
  let state = 'loading';
  let language = document.documentElement.lang;
  try { if (localStorage.getItem('library-language') === 'tr') language = 'tr'; } catch {}

  const text = (de, tr) => language === 'tr' ? tr : de;

  function updateLabels() {
    button.textContent = text('Weiterer Hadis', 'Başka bir hadis');
    button.disabled = state === 'loading';
    status.textContent = state === 'loading'
      ? text('Hadis wird geladen …', 'Hadis yükleniyor …')
      : state === 'error'
        ? text('Der Hadis konnte nicht geladen werden.', 'Hadis yüklenemedi.')
        : '';
    card.setAttribute('aria-busy', String(state === 'loading'));
    if (selected >= 0) {
      const {number} = entries[selected];
      const page = number <= 22 ? 1 : 2;
      source.textContent = `Haftanın Hadis-i Şerifleri · Hadis ${number} · ${text('Seite', 'Sayfa')} ${page}`;
    }
  }

  function drawRandom() {
    const possible = selected < 0 ? entries.length : entries.length - 1;
    let next = Math.floor(Math.random() * possible);
    if (selected >= 0 && next >= selected) next++;
    selected = next;
    arabic.textContent = entries[next].arabic;
    turkish.textContent = entries[next].turkish;
    quote.hidden = false;
    state = 'ready';
    updateLabels();
  }

  async function loadEntries() {
    state = 'loading';
    updateLabels();
    try {
      const response = await fetch('hadis-text.json');
      if (!response.ok) throw new Error('Could not load Hadis collection');
      const loaded = await response.json();
      if (!Array.isArray(loaded) || loaded.length < 2) throw new Error('Missing Hadis entries');
      entries = loaded;
      drawRandom();
    } catch {
      state = 'error';
      updateLabels();
    }
  }

  button.addEventListener('click', () => {
    if (entries.length) drawRandom();
    else loadEntries();
  });
  document.addEventListener('library-language', () => {
    language = document.documentElement.lang;
    updateLabels();
  });
  loadEntries();
})();
