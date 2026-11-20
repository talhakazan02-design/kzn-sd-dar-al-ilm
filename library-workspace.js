(() => {
  'use strict';

  const area = $('libraryArea');
  const top = area.querySelector('.portal');
  const toolsMenu = $('libraryToolsMenu');
  const sidebar = $('librarySidebar');
  const sidebarContent = $('sidebarContent');
  const toggle = $('sidebarToggle');
  const close = $('sidebarClose');
  const backdrop = $('sidebarBackdrop');
  const mobile = matchMedia('(max-width: 760px)');
  const background = document.querySelectorAll('body > :is(header, main, footer)');
  const priorInert = new Map();
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
  const toolButtons = ['betaNotesNav', 'betaWishlistNav', 'betaLoansNav', 'betaAdminNav'].map($);
  let activeTool = null;
  let drawerOpen = false;
  let sidebarUser = null;
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
    for (const button of sidebar.querySelectorAll('[data-sidebar-portal]')) {
      const current = !['notes', 'loans', 'admin'].includes(screen) && button.dataset.sidebarPortal === portal;
      if (current) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
    for (const button of toolButtons) {
      if (button === activeTool) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
    if (screen === 'topic') {
      $('sectionTitle').textContent = categoryLabel(topicTitle);
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
    activeTool = null;
    show(portal === 'library' ? 'home' : portal === 'mine' ? 'catalog' : portal);
  }

  function setDrawer(open, restoreFocus = true) {
    const wasOpen = drawerOpen;
    drawerOpen = open && mobile.matches && accessState === 'approved';
    document.body.classList.toggle('sidebar-open', drawerOpen);
    backdrop.hidden = !drawerOpen;
    toggle.setAttribute('aria-expanded', String(drawerOpen));
    sidebar.inert = mobile.matches && !drawerOpen;
    if (drawerOpen) {
      sidebar.setAttribute('role', 'dialog');
      sidebar.setAttribute('aria-modal', 'true');
      if (!wasOpen) {
        close.focus();
        for (const element of background) {
          priorInert.set(element, element.inert);
          element.inert = true;
        }
      }
    } else {
      sidebar.removeAttribute('role');
      sidebar.removeAttribute('aria-modal');
      if (wasOpen) {
        for (const [element, inert] of priorInert) element.inert = inert;
        priorInert.clear();
        if (restoreFocus && mobile.matches && !toggle.hidden) toggle.focus({preventScroll:true});
      }
    }
  }

  function syncSidebarAccess() {
    const approved = accessState === 'approved';
    sidebarContent.hidden = toolsMenu.hidden = toggle.hidden = !approved;
    if (!approved) setDrawer(false, false);
  }

  function updateSidebarLanguage() {
    sidebar.setAttribute('aria-label', tr('Bibliotheksmenü', 'Kütüphane menüsü'));
  }

  toggle.addEventListener('click', () => setDrawer(true));
  close.addEventListener('click', () => setDrawer(false));
  backdrop.addEventListener('click', () => setDrawer(false));
  mobile.addEventListener('change', () => setDrawer(false));
  document.addEventListener('keydown', event => {
    if (!drawerOpen) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      setDrawer(false);
    }
    if (event.key !== 'Tab') return;
    const visible = [...sidebar.querySelectorAll('button:not(:disabled)')].filter(button => button.getClientRects().length);
    const [first] = visible;
    const last = visible.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  });
  sidebar.addEventListener('click', event => {
    const mode = event.target.closest('[data-menba-mode]');
    if (mode && !mode.hidden && accessState === 'approved') {
      if (drawerOpen) setDrawer(false,false);
      openPortal('menba');
      document.dispatchEvent(new CustomEvent('menba-select-mode',{detail:mode.dataset.menbaMode}));
      $('menbaMode')?.focus({preventScroll:true});
      return;
    }
    const button = event.target.closest('[data-sidebar-portal]');
    if (!button || accessState !== 'approved') return;
    const fromDrawer = drawerOpen;
    if (fromDrawer) setDrawer(false, false);
    openPortal(button.dataset.sidebarPortal);
    top.scrollIntoView({block:'nearest', behavior:'instant'});
    if (fromDrawer) top.querySelector('.selected')?.focus({preventScroll:true});
  });

  document.addEventListener('library-portal', fromPortal);
  document.addEventListener('library-language', () => {
    updateSidebarLanguage();
    show(area.dataset.workspace);
  });
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
    topicTitle = $('category').value;
    show('topic');
  });

  for (const [id, name] of Object.entries(toolOpeners)) {
    const opener = $(id);
    opener?.addEventListener('click', () => {
      if (accessState !== 'approved' || opener.hidden) return;
      if (area.dataset.workspace !== name && !['notes', 'loans', 'admin'].includes(area.dataset.workspace)) {
        previous = area.dataset.workspace;
      }
      if (drawerOpen && sidebar.contains(opener)) setDrawer(false, false);
      activeTool = id === 'betaWishlistDash' ? $('betaWishlistNav') : id === 'betaLoansDash' ? $('betaLoansNav') : opener;
      show(name);
    }, true);
  }
  for (const id of ['betaToolsClose', 'betaLendingClose', 'betaAdminClose']) {
    $(id).addEventListener('click', () => {
      const opener = activeTool;
      activeTool = null;
      show(previous);
      if (opener && (document.activeElement === document.body || !document.activeElement?.getClientRects().length)) {
        (mobile.matches ? toggle : opener).focus({preventScroll:true});
      }
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
    syncSidebarAccess();
    if (event.detail.approved) {
      if (sidebarUser && sidebarUser !== currentUser?.id) {
        previous = 'home';
        openPortal('library');
      }
      sidebarUser = currentUser?.id ?? null;
    }
    if (!event.detail.approved && accessState !== 'loading') {
      sidebarUser = null;
      previous = 'home';
      openPortal('library');
    }
  });
  syncSidebarAccess();
  sidebarUser = accessState === 'approved' ? currentUser?.id ?? null : null;
  updateSidebarLanguage();
  setDrawer(false);
  fromPortal();
})();
