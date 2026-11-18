(() => {
  'use strict';

  const area = $('libraryArea');
  const top = area.querySelector('.portal');
  const toolsMenu = $('libraryToolsMenu');
  const categoryPanel = $('libraryCategories');
  const back = $('categoryBack');
  const toolOpeners = {
    betaNotesNav: 'notes',
    betaWishlistNav: 'notes',
    betaWishlistDash: 'notes',
    betaLoansNav: 'loans',
    betaLoansDash: 'loans',
    betaAdminNav: 'admin'
  };
  let topicTitle = '';
  let previous = 'home';

  function show(screen) {
    area.dataset.workspace = screen;
    area.dataset.selectedPortal = portal;
    back.hidden = screen !== 'topic';
    top.querySelectorAll('[data-portal]').forEach(button => {
      const selected = button.dataset.portal === portal;
      button.classList.toggle('selected', selected);
      button.setAttribute('aria-current', String(selected));
    });
    if (screen === 'topic') {
      $('sectionTitle').textContent = topicTitle;
      $('sectionDescription').textContent = tr('Bücher aus dieser Kategorie', 'Bu kategorideki kitaplar');
    }
  }

  function openPortal(name, search = '') {
    topicTitle = '';
    $('category').value = '';
    $('search').value = search;
    $('dashboardSearch').value = search;
    switchPortal(name);
  }

  function fromPortal() {
    show(portal === 'library' ? 'home' : portal === 'mine' ? 'catalog' : portal);
  }

  document.addEventListener('library-portal', fromPortal);
  document.addEventListener('library-language', () => show(area.dataset.workspace));
  top.addEventListener('click', event => {
    const button = event.target.closest('[data-portal]');
    if (!button) return;
    event.stopImmediatePropagation();
    openPortal(button.dataset.portal);
  }, true);
  categoryPanel.addEventListener('click', event => {
    const button = event.target.closest('[data-dash-category]');
    if (!button) return;
    event.stopImmediatePropagation();
    topicTitle = button.querySelector('.kzn-cat-name')?.textContent || button.dataset.dashCategory;
    $('search').value = '';
    $('category').value = button.dataset.dashCategory;
    render();
    show('topic');
  }, true);
  back.addEventListener('click', () => openPortal('categories'));
  $('category').addEventListener('change', () => {
    if (area.dataset.workspace !== 'topic') return;
    if (!$('category').value) {
      openPortal('categories');
      return;
    }
    topicTitle = $('category').selectedOptions[0].textContent;
    show('topic');
  });

  for (const [id, name] of Object.entries(toolOpeners)) {
    $(id)?.addEventListener('click', () => {
      if (area.dataset.workspace !== name && !['notes', 'loans', 'admin'].includes(area.dataset.workspace)) {
        previous = area.dataset.workspace;
      }
      show(name);
    }, true);
    $(id)?.addEventListener('click', () => { toolsMenu.open = false; });
  }
  for (const id of ['betaToolsClose', 'betaLendingClose', 'betaAdminClose']) {
    $(id).addEventListener('click', () => {
      show(previous);
      toolsMenu.querySelector('summary').focus({preventScroll:true});
    });
  }
  $('dashAllBooks').addEventListener('click', event => {
    event.stopImmediatePropagation();
    openPortal('mine');
  }, true);
  $('dashboardSearch').addEventListener('input', event => {
    const query = event.target.value;
    openPortal('mine', query);
    $('search').focus();
    $('search').setSelectionRange(query.length, query.length);
  }, true);
  document.addEventListener('library-access', event => {
    toolsMenu.hidden = !event.detail.approved;
    if (!event.detail.approved) toolsMenu.open = false;
    if (!event.detail.approved && accessState !== 'loading') {
      previous = 'home';
      openPortal('library');
    }
  });
  toolsMenu.hidden = accessState !== 'approved';
  fromPortal();
})();
