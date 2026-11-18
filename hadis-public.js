(() => {
  'use strict';

  const excerptCount = 44;
  const tileWidth = 720;
  const tileHeight = 200;
  const columns = 4;
  const sourceAsset = 'hadis-excerpts.webp';
  const canvas = document.getElementById('publicHadisCanvas');
  const button = document.getElementById('publicHadisNext');
  const source = document.getElementById('publicHadisSource');
  const status = document.getElementById('publicHadisStatus');
  const context = canvas.getContext('2d');
  let selected = -1;
  let asset = null;
  let state = 'loading';
  let language = document.documentElement.lang;
  try { if (localStorage.getItem('library-language') === 'tr') language = 'tr'; } catch {}

  const text = (de, tr) => language === 'tr' ? tr : de;
  function updateLabels() {
    button.textContent = text('Neuer Zufallsauszug', 'Yeni rastgele hadis');
    button.disabled = state === 'loading';
    status.textContent = state === 'loading'
      ? text('Hadis wird geladen …', 'Hadis yükleniyor …')
      : state === 'error'
        ? text('Der Ausschnitt konnte nicht geladen werden.', 'Hadis yüklenemedi.')
        : '';
    canvas.setAttribute('aria-label', text('Arabisch-türkischer Hadis im Originalscan', 'Arapça ve Türkçe orijinal hadis taraması'));
    if (selected >= 0) {
      const page = Math.floor(selected / 22) + 1;
      source.textContent = `Haftanın Hadis-i Şerifleri · Hadis ${selected + 1} · ${text('Seite', 'Sayfa')} ${page}`;
    }
  }

  function drawRandom() {
    const possible = selected < 0 ? excerptCount : excerptCount - 1;
    let next = Math.floor(Math.random() * possible);
    if (selected >= 0 && next >= selected) next++;
    const x = next % columns * tileWidth;
    const y = Math.floor(next / columns) * tileHeight;
    context.drawImage(asset, x, y, tileWidth, tileHeight, 0, 0, tileWidth, tileHeight);
    selected = next;
    canvas.hidden = false;
    state = 'ready';
    updateLabels();
  }

  function loadExcerpts() {
    state = 'loading';
    updateLabels();
    const image = new Image();
    image.addEventListener('load', () => {
      asset = image;
      drawRandom();
    }, {once:true});
    image.addEventListener('error', () => {
      state = 'error';
      updateLabels();
    }, {once:true});
    image.src = sourceAsset;
  }

  button.addEventListener('click', () => {
    if (asset) drawRandom();
    else loadExcerpts();
  });
  document.addEventListener('library-language', () => {
    language = document.documentElement.lang;
    updateLabels();
  });
  loadExcerpts();
})();
