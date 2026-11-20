const assert = require('node:assert/strict');
const {readFile} = require('node:fs/promises');
const path = require('node:path');
const {chromium} = require('playwright');

const root = path.join(__dirname, '..');
const origin = 'https://library.example';
const excerpt = 'Die Sternlaterne wird am Donnerstag im Lesesaal aufgestellt.';
const fixture = `
window.fileGranted = true;
window.signedRequests = 0;
const fixtureUser = {id:'reader'};
const fixtureBooks = [
  {id:'text',owner_id:fixtureUser.id,title:'Bibliotheksordnung',visibility:'private',file_path:'test.pdf'},
  {id:'other',owner_id:fixtureUser.id,title:'Weitere Quelle',visibility:'private',file_path:'other.pdf'}
];
const templateRows = JSON.parse(localStorage.getItem('fixture.templates') || '[]');
const templateMarks = JSON.parse(localStorage.getItem('fixture.favorites') || '[]');
function templateQuery(name) {
  const templates = name === 'library_menba_templates';
  const dataRows = templates ? templateRows : templateMarks;
  let action = 'read', values = null, equals = null, singular = false;
  return {
    select(){return this}, order(){return this}, limit(){return this}, gt(){return this},
    eq(key,value){equals = item=>item[key] === value; return this},
    insert(row){action='insert'; values=row; return this},
    update(row){action='update'; values=row; return this},
    delete(){action='delete'; return this},
    single(){singular=true; return this},
    then(resolve,reject){
      let data = dataRows.filter(equals ?? (()=>true));
      if (action === 'insert') {
        const row = templates ? {...values,id:crypto.randomUUID()} : {...values};
        dataRows.push(row);
        data = [row];
      } else if (action === 'update') {
        for (const row of data) Object.assign(row,values);
      } else if (action === 'delete') {
        for (const row of data) dataRows.splice(dataRows.indexOf(row),1);
      }
      if (action !== 'read') {
        localStorage.setItem('fixture.templates',JSON.stringify(templateRows));
        localStorage.setItem('fixture.favorites',JSON.stringify(templateMarks));
      }
      return Promise.resolve({data:singular ? data[0] : data,error:null}).then(resolve,reject);
    }
  };
}
const query = name => ({
  select(){return this}, eq(){return this}, is(){return this}, or(){return this},
  order(){return this}, maybeSingle(){return this}, limit(){return this}, range(){return this},
  then(resolve,reject){
    const data = name === 'books' ? fixtureBooks : name === 'library_members' ? {status:'approved'} : [];
    return Promise.resolve({data,error:null,count:0}).then(resolve,reject);
  }
});
window.supabase = {createClient:()=>({
  auth:{getSession:async()=>({data:{session:{user:fixtureUser,access_token:'synthetic-fixture-session-token'}}}),getUser:async()=>({data:{user:fixtureUser}}),onAuthStateChange(){}},
  from:name=>name.startsWith('library_menba_template') ? templateQuery(name) : query(name),
  rpc:async name=>({data:name === 'library_beta_get_access' ? [{is_owner:true,capabilities:[]}] : [],error:null}),
  storage:{from:()=>({async createSignedUrl(file){
    if(file !== 'test.pdf') throw Error('Unexpected source was used');
    window.signedRequests++;
    return window.fileGranted ? {data:{signedUrl:'/test.pdf'}} : {data:null,error:{statusCode:'403'}};
  }})}
})};`;

const pdfParser = `
export const GlobalWorkerOptions = {};
export function getDocument({data}) {
  const str = new TextDecoder().decode(data);
  return {destroy:async()=>{},promise:Promise.resolve({
    getMetadata:async()=>({}),numPages:1,
    getPage:async()=>({getTextContent:async()=>({items:[{str}]}),cleanup(){}})
  })};
}`;

async function check() {
  const html = (await readFile(path.join(root,'index.html'),'utf8')).replace(
    /<script src="https:\/\/cdn\.jsdelivr\.net\/npm\/@supabase\/[^"]+"><\/script>/u,
    () => `<script>${fixture}</script>`
  );
  assert(html.includes('window.fileGranted = true;'), 'Browser fixture did not replace the Supabase script');
  const executablePath = process.env.MENBA_CHROME_PATH;
  const browser = await chromium.launch(executablePath ? {executablePath} : {});
  try {
    const page = await browser.newPage({viewport:{width:1440,height:900}});
    await page.addInitScript(()=>{
      Object.defineProperty(navigator,'clipboard',{value:{async writeText(text){window.copiedText = text;}}});
    });
    const errors = [];
    page.on('pageerror', error=>errors.push(error.message));
    let downloads = 0;
    let externalPosts = 0;
    let cloudCalls = 0;
    const types = {js:'text/javascript',css:'text/css',json:'application/json'};
    await page.route('**/*', async route=>{
      const url = new URL(route.request().url());
      if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.endsWith('/build/pdf.min.mjs')) {
        return route.fulfill({contentType:'text/javascript',headers:{'Access-Control-Allow-Origin':'*'},body:pdfParser});
      }
      if (url.hostname === 'kzn-menba-pilot.talhakazan02.workers.dev' && url.pathname === '/menba/answer') {
        const headers = {'Access-Control-Allow-Origin':origin,'Access-Control-Allow-Headers':'authorization,content-type','Access-Control-Allow-Methods':'POST,OPTIONS'};
        if (route.request().method() === 'OPTIONS') return route.fulfill({status:204,headers});
        cloudCalls++;
        return route.fulfill({status:200,headers,json:{text:'Die Laterne steht im Lesesaal.',citations:[{number:1,quote:excerpt}]}});
      }
      if (url.origin !== origin) {
        if (route.request().method() === 'POST') externalPosts++;
        return route.abort();
      }
      if (url.pathname === '/') return route.fulfill({contentType:'text/html',body:html});
      if (url.pathname === '/test.pdf') {
        downloads++;
        return route.fulfill({contentType:'application/pdf',body:excerpt});
      }
      const filename = /^\/([a-z0-9-]+\.(js|css|json))$/iu.exec(url.pathname);
      if (filename) {
        try {
          const body = await readFile(path.join(root,filename[1]));
          return route.fulfill({contentType:types[filename[2]],body});
        } catch { /* Some optional page assets are unavailable in the fixture. */ }
      }
      return route.fulfill({status:404,body:''});
    });

    await page.goto(origin);
    await page.locator('#libraryArea .portal [data-portal=menba]').click();
    await page.locator('#menbaSourcesSummary').click();
    const picker = page.locator('#menbaSources');
    const book = picker.locator('[value=text]');
    const other = picker.locator('[value=other]');
    const consent = page.locator('#menbaCloudConsent');
    await picker.locator('[value=hadis-collection]').uncheck();
    await book.check();
    await consent.check();
    await other.check();
    assert.equal(await consent.isChecked(),false,'Changing a source must invalidate consent');
    await consent.check();
    await page.locator('#menbaSelectAll').click();
    assert.equal(await consent.isChecked(),false,'Bulk selection must invalidate consent');
    await other.uncheck();
    await picker.locator('[value=hadis-collection]').uncheck();

    const chat = page.locator('#menbaResults');
    const citation = chat.locator('.menba-citation').filter({hasText:'Bibliotheksordnung · Seite 1'});
    const question = page.locator('#menbaQuestion');
    const questionText = 'Wo steht die Sternlaterne im Lesesaal?';
    const ask = async () => {
      await question.fill(questionText);
      await page.locator('#menbaAsk').click();
      await page.waitForFunction(()=>!document.getElementById('menbaAsk').disabled);
    };
    await ask();
    await ask();
    assert.equal(await citation.count(),2);
    assert.equal(downloads,1,'A fresh grant does not require a fresh PDF download');
    assert.equal(await page.evaluate(()=>window.signedRequests),2);

    await page.evaluate(()=>{ window.fileGranted = false; });
    await ask();
    assert.equal(await citation.count(),0,'The revoked file must disappear from answers');
    await chat.getByText(/technischer Fehler/u).waitFor();
    await chat.getByText(/Datei nicht erreichbar oder Zugriff verweigert/u).waitFor();
    assert.equal(await page.evaluate(()=>window.signedRequests),3);
    assert.equal(downloads,1);

    await page.evaluate(()=>{ window.fileGranted = true; });
    await ask();
    assert.equal(await citation.count(),1);
    assert.equal(downloads,1,'After a valid grant the saved index is reusable');
    assert.equal(externalPosts,0);

    const tools = page.locator('.menba-tools');
    const conversation = page.locator('.menba-conversation');
    const boxes = async () => Promise.all([tools.boundingBox(),conversation.boundingBox()]);
    const [aside, desktopChat] = await boxes();
    assert(aside.x + aside.width <= desktopChat.x,'Desktop places sources beside the conversation');
    const sourceMenu = tools.locator('.menba-source-menu').first();
    await page.locator('#menbaSourcesSummary').click();
    assert.equal(await sourceMenu.evaluate(element=>element.open),false);
    const templates = page.locator('#menbaQuestionTemplates');
    await templates.locator(':scope > summary').click();
    await templates.locator('#menbaTemplateChoice').selectOption('0');
    await templates.getByRole('textbox',{name:'Thema',exact:true}).fill('Gebetswaschung');
    await templates.getByRole('button',{name:'Frage übernehmen'}).click();
    assert.match(await question.inputValue(),/Gebetswaschung/u);
    await templates.locator(':scope > summary').click();

    await consent.check();
    await ask();
    const latest = chat.locator('.menba-turn').last();
    await latest.locator('.menba-answer').getByText(/Laterne steht im Lesesaal/u).waitFor();
    assert.equal(cloudCalls,1);
    const evidence = latest.locator('.menba-passage');
    assert.equal(await evidence.evaluate(element=>element.open),false);
    await evidence.locator('summary').click();
    assert.equal(await evidence.locator('blockquote').textContent(),excerpt);
    await latest.getByRole('button',{name:'Antwort kopieren'}).click();
    await latest.getByText('Kopiert.').waitFor();
    assert.equal(await page.evaluate(()=>window.copiedText),'Die Laterne steht im Lesesaal.\n\n[1] Bibliotheksordnung · Seite 1');

    const turns = chat.locator('.menba-turn');
    const beforeEdit = await turns.count();
    await consent.check();
    await latest.getByRole('button',{name:'Frage bearbeiten'}).click();
    assert.equal(await question.inputValue(),questionText);
    assert.equal(await turns.count(),beforeEdit);
    assert.equal(await consent.isChecked(),false);
    await question.fill('Mein neuer Entwurf');
    await consent.check();
    await latest.getByRole('button',{name:'Lokal erneut versuchen'}).click();
    await page.waitForFunction(()=>!document.getElementById('menbaAsk').disabled);
    assert.equal(await turns.count(),beforeEdit+1);
    assert.equal(await question.inputValue(),'Mein neuer Entwurf');
    assert.equal(await consent.isChecked(),false);
    assert.equal(cloudCalls,1,'Retry must not implicitly send to Cloudflare');

    await page.locator('#langBtn').click();
    await latest.getByRole('button',{name:'Soruyu düzenle'}).waitFor();
    assert.match(await latest.locator('.menba-citation').textContent(),/Sayfa 1/u);
    assert.equal(await page.locator('#menbaClearChat').textContent(),'Yeni sohbet');
    const saveScreenshot = async name=>{
      if (process.env.MENBA_QA_SCREENSHOTS) await page.locator('.menba-panel').screenshot({path:path.join(process.env.MENBA_QA_SCREENSHOTS,name)});
    };
    await saveScreenshot('menba-phase-2-desktop.png');
    await page.setViewportSize({width:768,height:1024});
    const [tabletTools, tabletChat] = await boxes();
    assert(tabletTools.y + tabletTools.height <= tabletChat.y,'Tablet keeps tools above the conversation');
    await page.setViewportSize({width:390,height:780});
    const [mobileTools, mobileChat] = await boxes();
    assert(mobileTools.y + mobileTools.height <= mobileChat.y,'Mobile keeps tools above the conversation');
    assert(await page.locator('.menba-panel').evaluate(element=>element.scrollWidth <= element.clientWidth+1));
    await page.locator('#menbaClearChat').click();
    assert.equal(await turns.count(),0);
    assert.equal(await question.inputValue(),'');
    assert(await book.isChecked());
    await ask();
    await latest.locator('.menba-citation').filter({hasText:'Bibliotheksordnung · Sayfa 1'}).waitFor();
    assert(await question.evaluate(element=>parseFloat(getComputedStyle(element).fontSize) >= 18));
    assert(await latest.locator('blockquote').evaluate(element=>parseFloat(getComputedStyle(element).fontSize) >= 18));
    await saveScreenshot('menba-phase-2-mobile.png');

    await page.setViewportSize({width:1440,height:900});
    await page.locator('#langBtn').click();
    await page.locator('#betaAdminNav').click();
    await page.locator('#menbaTestCenter summary').click();
    await page.locator('#menbaTestQuestion').fill('Welche Textstelle erwähnt „Donnerstag im Lesesaal“?');
    await page.locator('#menbaTestRun').click();
    const report = page.locator('#menbaTestReport');
    await report.getByText('Antwort und Fundstelle belegt.').waitFor();
    await report.getByText('Kein Cloud-Transfer für diese Frage.').waitFor();
    await report.getByText(/Bibliotheksordnung · PDF-Seite 1/u).waitFor();
    await report.getByText(/Vorhandenen Index wiederverwendet/u).waitFor();
    assert.equal(downloads,1,'Admin diagnosis must reuse the authorized index');
    assert.equal(cloudCalls,1,'An admin test stays local by default');

    await page.locator('#betaAdminClose').click();
    await templates.locator(':scope > summary').click();
    await page.locator('#menbaTemplateNew').click();
    const editor = page.locator('#menbaTemplateEditor');
    const editorField = name=>editor.locator(`[name=${name}]`);
    await editorField('title').fill('Exakte Buchstelle');
    await editorField('category').fill('Recherche');
    await editorField('description').fill('Nur in der gewählten Quelle suchen.');
    const fill = page.locator('#menbaCustomTemplateUse');
    await editorField('question').fill('Welche Textstelle erwähnt [ ]?');
    await editor.getByRole('button',{name:'Vorlage testen'}).click();
    await page.locator('#menbaTemplateStatus').getByText(/prüfe die Platzhalter/u).waitFor();
    assert.equal(await fill.isVisible(),false);
    await editorField('question').fill('[BEGRIFF] und [ BEGRIFF ]');
    await editor.getByRole('button',{name:'Vorlage testen'}).click();
    assert.equal(await fill.getByLabel('BEGRIFF').count(),1);
    await fill.getByLabel('BEGRIFF').fill('Wasser');
    assert.equal(await fill.locator('#menbaCustomTemplatePreview').textContent(),'Wasser und Wasser');
    await fill.locator('#menbaCustomTemplateClose').click();
    await editorField('question').fill('Welche Textstelle erwähnt „[BEGRIFF]“?');
    await editor.getByRole('button',{name:'Vorlage testen'}).click();
    await fill.getByLabel('BEGRIFF').fill('Donnerstag im Lesesaal');
    await fill.getByRole('button',{name:'Testfrage im Chat stellen'}).click();
    await latest.getByText(/gesuchte Stelle steht im folgenden Auszug/u).waitFor();
    assert.equal(cloudCalls,1);
    await editor.getByRole('button',{name:'Speichern'}).click();
    const saved = page.locator('#menbaTemplateList');
    const row = title=>saved.locator('li').filter({has:page.getByText(title,{exact:true})});
    await row('Exakte Buchstelle').getByRole('button',{name:'Als Favorit markieren'}).click();
    await row('Exakte Buchstelle').getByRole('button',{name:'Favorit entfernen'}).waitFor();

    await row('Exakte Buchstelle').getByRole('button',{name:'Duplizieren'}).click();
    assert.equal(await editorField('question').inputValue(),'Welche Textstelle erwähnt „[BEGRIFF]“?');
    assert.equal(await editorField('is_central').isChecked(),false);
    await editorField('title').fill('Gemeinsame Suchvorlage');
    await editorField('category').fill('Gemeinsam');
    await editorField('is_central').check();
    await editor.getByRole('button',{name:'Speichern'}).click();
    await row('Gemeinsame Suchvorlage').getByText('Gemeinsam · Zentral').waitFor();
    await page.locator('#menbaTemplateCategory').selectOption('Gemeinsam');
    assert.equal(await row('Exakte Buchstelle').count(),0);
    await page.locator('#menbaTemplateCategory').selectOption('');
    await page.locator('#menbaOnlyFavorites').check();
    assert.equal(await row('Gemeinsame Suchvorlage').count(),0);
    await page.locator('#menbaOnlyFavorites').uncheck();
    await page.locator('#menbaTemplateSearch').fill('exakte');
    assert.equal(await row('Gemeinsame Suchvorlage').count(),0);
    await page.locator('#menbaTemplateSearch').fill('');

    await row('Exakte Buchstelle').getByRole('button',{name:'Bearbeiten'}).click();
    await editorField('title').fill('Eigene Fundstellensuche');
    await editor.getByRole('button',{name:'Speichern'}).click();
    await row('Eigene Fundstellensuche').getByRole('button',{name:'Verwenden'}).click();
    await fill.getByLabel('BEGRIFF').fill('Donnerstag im Lesesaal');
    const turnCount = await turns.count();
    await fill.getByRole('button',{name:'In den Chat übernehmen'}).click();
    assert.equal(await question.inputValue(),'Welche Textstelle erwähnt „Donnerstag im Lesesaal“?');
    assert.equal(await turns.count(),turnCount);

    page.once('dialog',dialog=>void dialog.dismiss());
    await row('Gemeinsame Suchvorlage').getByRole('button',{name:'Löschen'}).click();
    assert.equal(await row('Gemeinsame Suchvorlage').count(),1);
    page.once('dialog',dialog=>void dialog.accept());
    await row('Gemeinsame Suchvorlage').getByRole('button',{name:'Löschen'}).click();
    await row('Gemeinsame Suchvorlage').waitFor({state:'detached'});
    await page.reload();
    await page.locator('#libraryArea .portal [data-portal=menba]').click();
    await templates.locator(':scope > summary').click();
    await page.locator('#menbaSavedTemplates > summary').click();
    await row('Eigene Fundstellensuche').getByRole('button',{name:'Favorit entfernen'}).waitFor();
    assert.equal(await row('Gemeinsame Suchvorlage').count(),0);
    await page.setViewportSize({width:390,height:780});
    assert(await templates.evaluate(element=>element.scrollWidth <= element.clientWidth+1));
    await row('Eigene Fundstellensuche').getByRole('button',{name:'Verwenden'}).click();
    await fill.getByLabel('BEGRIFF').fill('Donnerstag im Lesesaal');
    assert(await fill.evaluate(element=>element.scrollWidth <= element.clientWidth+1));
    await fill.getByRole('button',{name:'In den Chat übernehmen'}).click();
    assert.equal(await question.inputValue(),'Welche Textstelle erwähnt „Donnerstag im Lesesaal“?');

    assert.deepEqual(errors,[]);
    console.log('PASS: source consent, fresh Storage grant, removed stale citations and reused authorized PDF index.');
    console.log('PASS: desktop and mobile conversation, templates, sources, editing, copying, local retry, new conversation and TR labels.');
    console.log('PASS: admin question trace checks the exact quote, citation, cache reuse and optional cloud transfer.');
    console.log('PASS: create, test, edit, duplicate, save, favorite, find, filter, fill, confirm deletion and restore templates.');
  } finally {
    await browser.close();
  }
}

check().catch(error=>{console.error(error);process.exitCode=1;});
