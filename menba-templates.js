(() => {
  'use strict';

  const templatesTable = 'library_menba_templates';
  const favoritesTable = 'library_menba_template_favorites';
  const fields = 'id,is_central,title,category,question,description';
  const categories = [
    ['Thema erklären','Konu Anlatımı'], ['Buchrecherche','Kitap Araştırması'],
    ['Zusammenfassen','Özetleme'], ['Wiederholen','Tekrar'],
    ['Tests und Fragen','Test ve Sorular'], ['Sprache und Übersetzung','Dil ve Tercüme'],
    ['Eigene Vorlagen','Kendi Şablonlarım']
  ];
  const menu = $('menbaSavedTemplates');
  const status = $('menbaTemplateStatus');
  const create = $('menbaTemplateNew');
  const reload = $('menbaTemplateReload');
  const filters = $('menbaTemplateFilters');
  const search = $('menbaTemplateSearch');
  const category = $('menbaTemplateCategory');
  const onlyFavorites = $('menbaOnlyFavorites');
  const list = $('menbaTemplateList');
  const editor = $('menbaTemplateEditor');
  const editorTitle = $('menbaTemplateEditorTitle');
  const centralField = $('menbaTemplateCentralField');
  const useForm = $('menbaCustomTemplateUse');
  const inputs = $('menbaCustomTemplateInputs');
  const preview = $('menbaCustomTemplatePreview');
  const chatInput = $('menbaQuestion');

  let session = null;
  let busy = false;
  let loaded = false;
  let rows = [];
  let favorites = new Set();
  let editing = null;
  let prepared = null;
  let message = null;

  const owner = () => document.documentElement.dataset.betaOwner === 'true';
  const editable = row => !row.is_central || owner();
  const current = active => active !== null && active === session && accessState === 'approved'
    && currentUser?.id === active.account && accessRequest === active.revision;

  function compile(question) {
    const parts = question.split(/(\[[^\[\]\r\n]*\])/u);
    const slots = new Set();
    for (let index = 0; index < parts.length; index++) {
      if (index % 2) {
        const name = parts[index].slice(1,-1).trim();
        if (!name) return null;
        slots.add(name);
        parts[index] = name;
      } else if (/[\[\]]/u.test(parts[index])) return null;
    }
    return {parts,slots};
  }

  function setMessage(de,turkish) {
    message = de ? [de,turkish] : null;
    status.textContent = message ? tr(...message) : '';
  }

  function describeError(error) {
    if (error?.code === '42P01' || error?.code === 'PGRST205') {
      setMessage('Die Vorlagenverwaltung wartet auf die Supabase-Einrichtung.','Şablon yönetimi Supabase kurulumunu bekliyor.');
    } else if (error?.code === '42501') {
      setMessage('Der Server hat die Aktion abgelehnt.','Sunucu işlemi reddetti.');
    } else setMessage('Die Vorlagenaktion ist fehlgeschlagen. Versuche es erneut.','Şablon işlemi başarısız oldu. Yeniden dene.');
  }

  function button(de,turkish,action) {
    const element = document.createElement('button');
    element.type = 'button';
    element.textContent = tr(de,turkish);
    element.disabled = busy;
    element.addEventListener('click',action);
    return element;
  }

  function textNode(tag,value) {
    const node = document.createElement(tag);
    node.dir = 'auto';
    node.textContent = value;
    return node;
  }

  const fold = value => value.normalize('NFKD').toLowerCase().replace(/\p{M}/gu,'').replaceAll('ı','i');

  function render() {
    menu.hidden = !session;
    create.hidden = !session;
    create.disabled = busy;
    reload.hidden = busy || !message;
    filters.hidden = !loaded || !rows.length;
    for (const control of editor.elements) control.disabled = busy;
    centralField.hidden = Boolean(editing) || !owner();
    editorTitle.textContent = editing ? tr('Vorlage bearbeiten','Şablonu düzenle') : tr('Neue Vorlage','Yeni şablon');
    status.textContent = message ? tr(...message) : '';
    const previousCategory = category.value;
    const values = [...new Set(rows.map(row=>row.category))].sort((a,b)=>a.localeCompare(b,lang));
    category.replaceChildren(new Option(tr('Alle Kategorien','Tüm kategoriler'),''),...values.map(value=>new Option(value,value)));
    if (values.includes(previousCategory)) category.value = previousCategory;
    const presets = [...new Set([...categories.map(names=>tr(...names)),...values])];
    $('menbaTemplateCategories').replaceChildren(...presets.map(value=>new Option(value,value)));
    if (!loaded) { list.replaceChildren(); return; }
    const term = fold(search.value.trim());
    const visible = rows.filter(row=> (!category.value || category.value === row.category)
      && (!onlyFavorites.checked || favorites.has(row.id))
      && fold([row.title,row.category,row.question,row.description].join(' ')).includes(term));
    visible.sort((a,b)=>Number(favorites.has(b.id))-Number(favorites.has(a.id)) || a.title.localeCompare(b.title,lang));
    if (!visible.length) {
      list.replaceChildren(textNode('li',rows.length ? tr('Keine passenden Vorlagen.','Eşleşen şablon yok.') : tr('Noch keine gespeicherten Vorlagen.','Henüz kayıtlı şablon yok.')));
      return;
    }
    list.replaceChildren(...visible.map(row=>{
      const item = document.createElement('li');
      item.append(textNode('strong',row.title),textNode('small',`${row.category} · ${row.is_central ? tr('Zentral','Ortak') : tr('Privat','Özel')}`));
      if (row.description) item.append(textNode('p',row.description));
      const actions = document.createElement('div');
      actions.className = 'menba-source-actions';
      const marked = favorites.has(row.id);
      const favorite = button(marked ? 'Favorit entfernen' : 'Als Favorit markieren',marked ? 'Favorilerden çıkar' : 'Favorilere ekle',()=>void toggleFavorite(row));
      favorite.setAttribute('aria-pressed',String(marked));
      actions.append(button('Verwenden','Kullan',()=>prepare(row,false)),favorite,
        button('Duplizieren','Çoğalt',()=>beginEdit(null,row)));
      if (editable(row)) actions.append(button('Bearbeiten','Düzenle',()=>beginEdit(row)),button('Löschen','Sil',()=>void remove(row)));
      item.append(actions);
      return item;
    }));
  }

  async function readRows(active,table,columns,key) {
    const items = [];
    let cursor = null;
    do {
      if (!current(active)) throw Error('session');
      let query = db.from(table).select(columns).order(key).limit(100);
      if (cursor) query = query.gt(key,cursor);
      const {data,error} = await query;
      if (error) throw error;
      if (!Array.isArray(data)) throw Error('invalid response');
      items.push(...data);
      cursor = data.length === 100 ? data.at(-1)[key] : null;
    } while (cursor);
    return items;
  }

  async function operation(action) {
    const active = session;
    if (!current(active) || busy) return false;
    busy = true;
    render();
    try {
      const apply = await action(active);
      if (!current(active)) return false;
      apply();
      return true;
    } catch(error) {
      if (current(active)) describeError(error);
      return false;
    } finally {
      if (current(active)) { busy = false; render(); }
    }
  }

  function load() {
    setMessage('Vorlagen werden geladen …','Şablonlar yükleniyor …');
    return operation(async active=>{
      const [saved,marks] = await Promise.all([
        readRows(active,templatesTable,fields,'id'),readRows(active,favoritesTable,'template_id','template_id')
      ]);
      return ()=>{
        rows = saved;
        favorites = new Set(marks.map(row=>row.template_id));
        loaded = true;
        setMessage();
      };
    });
  }

  function beginEdit(row,duplicate) {
    if (!loaded || busy || (row && !editable(row))) return;
    editing = row;
    const draft = row ?? duplicate;
    editor.reset();
    for (const key of ['title','category','question','description']) editor.elements[key].value = draft?.[key] ?? '';
    editor.elements.is_central.checked = row?.is_central === true;
    editor.hidden = false;
    useForm.hidden = true;
    prepared = null;
    setMessage();
    render();
    editor.elements.title.focus();
  }

  function prepare(row,test) {
    const compiled = compile(row.question);
    if (!compiled) {
      setMessage('Prüfe die eckigen Klammern im Fragetext.','Soru metnindeki köşeli parantezleri kontrol et.');
      return;
    }
    prepared = {row,test,compiled};
    setMessage();
    inputs.replaceChildren();
    for (const slot of compiled.slots) {
      const label = textNode('label',slot);
      const input = document.createElement('input');
      input.name = slot;
      input.required = true;
      input.maxLength = chatInput.maxLength;
      input.dir = 'auto';
      label.append(input);
      inputs.append(label);
    }
    renderUse();
    useForm.hidden = false;
    (inputs.querySelector('input') ?? $('menbaCustomTemplateSubmit')).focus();
  }

  function format(placeholderFallback) {
    const values = new Map([...inputs.querySelectorAll('input')].map(input=>[input.name,input.value.trim()]));
    return prepared.compiled.parts.map((text,index)=>index % 2 ? values.get(text) || (placeholderFallback ? `[${text}]` : '') : text).join('');
  }

  function renderUse() {
    if (!prepared) return;
    $('menbaCustomTemplateTitle').textContent = prepared.row.title;
    $('menbaCustomTemplateSubmit').textContent = prepared.test ? tr('Testfrage im Chat stellen','Test sorusunu sohbette sor') : tr('In den Chat übernehmen','Sohbete aktar');
    preview.textContent = format(true);
  }

  async function save(event) {
    event.preventDefault();
    if (!loaded || busy) return;
    const data = new FormData(editor);
    const draft = Object.fromEntries(['title','category','question','description'].map(key=>[key,String(data.get(key) ?? '').trim()]));
    if (!draft.title || !draft.category || !draft.question || !compile(draft.question)) {
      setMessage('Fülle die Pflichtfelder aus und prüfe die Platzhalter in eckigen Klammern.','Zorunlu alanları doldur ve köşeli parantezli yer tutucuları kontrol et.');
      return;
    }
    if (event.submitter?.value === 'test') { prepare(draft,true); return; }
    const existing = editing;
    const central = !existing && owner() && data.has('is_central');
    await operation(async()=>{
      const query = db.from(templatesTable);
      const mutation = existing ? query.update(draft).eq('id',existing.id) : query.insert({...draft,is_central:central});
      const {data:row,error} = await mutation.select(fields).single();
      if (error) throw error;
      if (!row?.id) throw Error('invalid response');
      return ()=>{
        rows = [...rows.filter(currentRow=>currentRow.id !== row.id),row];
        editor.hidden = useForm.hidden = true;
        prepared = editing = null;
        setMessage('Vorlage gespeichert.','Şablon kaydedildi.');
      };
    });
  }

  async function toggleFavorite(row) {
    const marked = favorites.has(row.id);
    await operation(async()=>{
      const query = db.from(favoritesTable);
      const {error} = await (marked ? query.delete().eq('template_id',row.id) : query.insert({template_id:row.id}));
      if (error && (marked || error.code !== '23505')) throw error;
      return ()=>{
        if (marked) favorites.delete(row.id);
        else favorites.add(row.id);
        setMessage();
      };
    });
  }

  async function remove(row) {
    if (busy || !editable(row) || !window.confirm(tr(`Vorlage „${row.title}“ löschen?`,`“${row.title}” şablonu silinsin mi?`))) return;
    await operation(async()=>{
      const {error} = await db.from(templatesTable).delete().eq('id',row.id).select('id').single();
      if (error) throw error;
      return ()=>{
        rows = rows.filter(item=>item.id !== row.id);
        favorites.delete(row.id);
        if (editing === row) { editing = null; editor.hidden = true; }
        if (prepared?.row === row) { prepared = null; useForm.hidden = true; }
        setMessage('Vorlage gelöscht.','Şablon silindi.');
      };
    });
  }

  function syncAccess() {
    if (!current(session)) {
      session = accessState === 'approved' && currentUser?.id ? {account:currentUser.id,revision:accessRequest} : null;
      rows = [];
      favorites = new Set();
      busy = loaded = false;
      editing = prepared = null;
      editor.reset();
      editor.hidden = useForm.hidden = true;
      inputs.replaceChildren();
      preview.textContent = '';
      search.value = category.value = '';
      onlyFavorites.checked = false;
      menu.open = false;
      setMessage();
    }
    render();
  }

  menu.addEventListener('toggle',()=>{ if (menu.open && current(session) && !loaded && !busy) void load(); });
  create.addEventListener('click',async()=>{
    menu.open = true;
    if (loaded || await load()) beginEdit(null);
  });
  reload.addEventListener('click',()=>{ if (!busy) void load(); });
  for (const filter of [search,category,onlyFavorites]) filter.addEventListener('input',render);
  $('menbaTemplateCancel').addEventListener('click',()=>{ editing = null; editor.hidden = true; });
  $('menbaCustomTemplateClose').addEventListener('click',()=>{ prepared = null; useForm.hidden = true; });
  editor.addEventListener('submit',event=>void save(event));
  useForm.addEventListener('input',renderUse);
  useForm.addEventListener('submit',event=>{
    event.preventDefault();
    if (!prepared || !current(session) || chatInput.disabled) return;
    const text = format(false).trim();
    if (!text || text.length > chatInput.maxLength || [...inputs.querySelectorAll('input')].some(input=>!input.value.trim())) {
      setMessage('Fülle alle Platzhalter aus. Die Frage darf höchstens 500 Zeichen haben.','Tüm yer tutucuları doldur. Soru en fazla 500 karakter olabilir.');
      return;
    }
    $('menbaCloudConsent').checked = false;
    chatInput.value = text;
    useForm.hidden = true;
    chatInput.focus();
    if (prepared.test) $('menbaForm').requestSubmit();
    prepared = null;
  });
  document.addEventListener('library-access',syncAccess);
  document.addEventListener('beta-role-access',render);
  document.addEventListener('library-language',()=>{ render(); renderUse(); });
  syncAccess();
})();
