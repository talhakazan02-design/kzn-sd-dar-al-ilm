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
const query = name => ({
  select(){return this}, eq(){return this}, is(){return this}, or(){return this},
  order(){return this}, maybeSingle(){return this}, limit(){return this}, range(){return this},
  then(resolve,reject){
    const data = name === 'books' ? fixtureBooks : name === 'library_members' ? {status:'approved'} : [];
    return Promise.resolve({data,error:null,count:0}).then(resolve,reject);
  }
});
window.supabase = {createClient:()=>({
  auth:{getSession:async()=>({data:{session:{user:fixtureUser}}}),getUser:async()=>({data:{user:fixtureUser}}),onAuthStateChange(){}},
  from:query,
  rpc:async()=>({data:[],error:null}),
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
    const page = await browser.newPage({viewport:{width:1100,height:850}});
    const errors = [];
    page.on('pageerror', error=>errors.push(error.message));
    let downloads = 0;
    let externalPosts = 0;
    const types = {js:'text/javascript',css:'text/css',json:'application/json'};
    await page.route('**/*', async route=>{
      const url = new URL(route.request().url());
      if (url.hostname === 'cdn.jsdelivr.net' && url.pathname.endsWith('/build/pdf.min.mjs')) {
        return route.fulfill({contentType:'text/javascript',headers:{'Access-Control-Allow-Origin':'*'},body:pdfParser});
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
    const ask = async () => {
      await page.locator('#menbaQuestion').fill('Wo steht die Sternlaterne im Lesesaal?');
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
    assert.equal(await page.evaluate(()=>window.signedRequests),3);
    assert.equal(downloads,1);

    await page.evaluate(()=>{ window.fileGranted = true; });
    await ask();
    assert.equal(await citation.count(),1);
    assert.equal(downloads,1,'After a valid grant the saved index is reusable');
    assert.equal(externalPosts,0);
    assert.deepEqual(errors,[]);
    console.log('PASS: source consent, fresh Storage grant, removed stale citations and reused authorized PDF index.');
  } finally {
    await browser.close();
  }
}

check().catch(error=>{console.error(error);process.exitCode=1;});
