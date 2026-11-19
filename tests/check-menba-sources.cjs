const assert = require('node:assert/strict');
const {readFileSync} = require('node:fs');
const path = require('node:path');
const {runInNewContext} = require('node:vm');

require('../menba-search.js');
require('../menba-answers.js');
const {find} = globalThis.MenbaSearch;
const {inspect, compose} = globalThis.MenbaAnswers;

const porkQuestion = 'Ist Schweinefleisch essen haram?';
const porkPage = {sourceId:'tr',source:'Türkisches Testbuch',page:12,text:'Domuz eti yemek haramdır.'};
const arabicPage = {sourceId:'ar',source:'Arabisches Testbuch',page:9,text:'الْوُضُوءُ عِبَادَةٌ. لِلصَّلَاةِ شُرُوطٌ.'};
const germanPage = {sourceId:'de',source:'Deutsches Testbuch',page:2,text:'Die rituelle Waschung wird in diesem Kapitel erklärt.'};
const pages = [porkPage,arabicPage,germanPage];

assert.deepEqual(find(porkQuestion,pages),[porkPage]);
const intent = inspect(porkQuestion);
assert.deepEqual(compose(intent,find(porkQuestion,pages)),{
  text:'Die Stelle verbietet, Schweinefleisch zu essen.',citations:[1]
});
assert.deepEqual(new Set(find('Abdest nedir?',pages).map(row=>row.sourceId)),new Set(['ar','de']));
assert.equal(find('Wie wird die Gebetswaschung erklärt?', [arabicPage])[0]?.page,9);
assert.deepEqual(find('Was bedeutet die Vulkanasche?', pages),[]);
assert.equal(compose(intent,[{...porkPage,ocr:true}]),null);
assert.equal(compose(intent,[{...porkPage,page:0}]),null);
assert.equal(compose(intent,[{...porkPage,quran:true}]),null);
assert.equal(compose(intent,[{...porkPage,verse:'115:1'}]),null);
assert.equal(compose(intent,[{...porkPage,text:'Domuz eti yemek haram değildir.'}]),null);
assert.equal(compose(intent,[{...porkPage,text:'Ist Schweinefleisch essen verboten?'}]),null);
assert.equal(compose(intent,[{...porkPage,text:'Schweinefleisch ist nicht verboten.'}]),null);

async function checkSharedAccess() {
  const state = {
    currentUser:{id:'reader'},accessState:'approved',accessRequest:1,
    window:{},DOMException,STORAGE_BUCKET:'library-files'
  };
  let granted = true;
  let signs = 0;
  state.db = {
    async rpc(name) {
      if (name === 'library_list_shared_books') return {data:[
        {id:'shared-pdf',title:'Freigegebenes PDF',category:'Fiqh',has_pdf:true},
        {id:'metadata-only',title:'Buchinformationen',category:'Fiqh',has_pdf:false},
      ]};
      if (name === 'library_shared_book_pdf_path') return {data:granted ? 'owner/book/example.pdf' : null};
      throw new Error('Unexpected call');
    },
    storage:{from:()=>({createSignedUrl:async()=>{
      signs++;
      return {data:{signedUrl:'https://example.invalid/signed'}};
    }})}
  };
  const adapter = path.join(__dirname,'..','menba-shared-sources.js');
  runInNewContext(readFileSync(adapter,'utf8'),state);
  const api = state.window.MenbaSharedSources;
  const auth = {accountId:'reader'};
  const catalog = await api.list(auth);
  assert.equal(catalog.length,1);
  const [source] = catalog;
  assert.equal(source.category,'Fiqh');
  assert.equal(source.id,'shared:shared-pdf');
  await api.signedUrl(source, auth);
  assert.equal(signs,1);
  granted = false;
  await assert.rejects(api.signedUrl(source,auth),/unavailable/);
  state.currentUser = {id:'another-account'};
  await assert.rejects(api.list(auth),/session changed/);
  await assert.rejects(api.signedUrl(source,auth),/session changed/);
  assert.equal(signs,1);
}

checkSharedAccess().then(()=>console.log('MENBA source, answer and shared access tests passed.')).catch(error=>{
  console.error(error);
  process.exitCode = 1;
});
