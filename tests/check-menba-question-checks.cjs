const assert = require('node:assert/strict');
require('../menba-quran.js');
require('../menba-search.js');
require('../menba-answers.js');
require('../menba-question-checks.js');

const checks = globalThis.MenbaQuestionChecks;
const fragment = (str,left,width,hasEOL=false)=>({str,dir:'ltr',transform:[12,0,0,12,left,100],width,hasEOL});
assert.equal(MenbaSearch.pageText([fragment('Na',10,13),fragment('mazın',23.2,30),fragment('farzları',56,38,true),fragment('İç',10,10)]),'Namazın farzları\nİç');
assert.equal(MenbaSearch.pageText([{str:'الأمثلة',dir:'rtl'},{str:'العربية',dir:'rtl'}]),'الأمثلة العربية');
assert.equal(checks.ocrSamplePage(24,new Set([24]),null),3);
assert.equal(checks.ocrSamplePage(64,new Set([1,3]),null),4);
assert.equal(checks.ocrSamplePage(3,new Set([2]),null),1);
assert.equal(checks.ocrSamplePage(1,new Set(),null),1);
assert.equal(checks.ocrSamplePage(2,new Set([1,2]),null),null);
assert.equal(checks.ocrSamplePage(24,new Set([24]),9),9);
assert.equal(checks.ocrSamplePage(24,new Set([24]),24),null);
assert.equal(checks.ocrSamplePage(24,new Set(),25),null);
assert.deepEqual(checks.candidates([{sourceId:'e',page:24,text:'Bandrol uygulamasına tabidir. ISBN: 1234.'}],'tr'),[]);
const emsile = {sourceId:'e',source:'Emsile',page:4,text:'Emsile, Arapça fiil çekimlerini örneklerle gösterir. Masdar konusuna giriş.'};
const maksud = {sourceId:'m',source:'Maksud',page:8,text:'Arapçada fiil çekimleri bu bölümde öğretilir.'};
const distinct = {sourceId:'s',source:'Seçilmemiş kitap',page:1,text:'Saklı bilgi: astronomi.'};
const scopes = [
  {id:'e',title:'Emsile'},{id:'m',title:'Maksud'}
];
const env = {sources:scopes,hadisId:'curated',isQuran:()=>false,language:'tr'};
const snapshot = {pages:[emsile,maksud,distinct],quranSources:new Set()};

for (const question of ['Emsile nedir?','Emsile konusunu açıkla.','Emsile hakkında bilgi ver.',
  'Was bedeutet Emsile?','Erkläre das Thema Emsile auf Deutsch.','ما موضوع كتاب الأمثلة؟']) {
  assert.equal(MenbaSearch.find(question,[emsile,maksud])[0]?.page,4,question);
}
assert.equal(MenbaSearch.find('Maksud kitabında fiiller nasıl açıklanıyor?', [emsile,maksud])[0]?.page,8);
assert.deepEqual(MenbaSearch.find('„Seçilmemiş kitap“ kitabında astronomi hakkında ne yazıyor?', [emsile,maksud]),[]);
assert.deepEqual(MenbaSearch.find('Was steht in „Kein Buch“ zum Thema Emsile?', [emsile,maksud]),[]);
assert.equal(MenbaSearch.find('Bu kitapta hangi konular anlatılıyor?', [
  {...emsile,text:'İçindekiler\nSarf ilmine giriş\nTemel fiil çekimleri'}
])[0]?.page,4);

const approved = {text:'Hangi metin bölümünde çekimlerini geçiyor?',expected:{sourceId:'e',page:4}};
assert.deepEqual(checks.test(approved,snapshot,env),{
  text:approved.text,status:'pass',found:1,valid:true,citation:{source:'Emsile',page:4,verse:undefined}
});
assert.equal(checks.test({...approved,expected:{sourceId:'e',page:7}},snapshot,env).status,'review');
assert.equal(checks.test(approved,{...snapshot,pages:[{...emsile,ocr:true}]},env).status,'review');
assert.ok(checks.candidates([{...emsile,ocr:true}],'tr').length > 0);
assert.equal(checks.test(approved,snapshot,{...env,sources:[]}).status,'fail');
assert.equal(checks.test({text:'Astronomie'},snapshot,env).status,'fail');
assert.equal(checks.checkCitation({...emsile,page:17},snapshot.pages),false);
assert.equal(checks.checkCitation({...emsile,source:'Falsches Buch'},snapshot.pages),false);
assert.equal(checks.checkCitation({...emsile,text:'Das Buch behauptet etwas anderes.'},snapshot.pages),false);

const quran = {id:'q',title:'Koran',quran:true};
const verse = {verse:'2:43',text:'Namazı dosdoğru kılın ve zekâtı verin.'};
const rawQuran = {sourceId:'q',source:'Koran',page:7,text:verse.text,verses:[verse]};
const tecvid = {id:'t',title:'Tecvid'};
const unrelatedPreface = {sourceId:'t',source:'Tecvid',page:5,text:'Onunla amel etmeyi farz Allahü Teâlâ’ya mahsustur. Salat-ü Selam; en güzel okuyan ve ümmetine Peygamber Efendimiz Hz.'};
const ilmihal = {id:'i',title:'İlmihal'};
const lesson = {sourceId:'i',source:'İlmihal',page:64,text:'Namazın Farzları\nNamazın dışında ve içinde yerine getirilen farzlar vardır. Kıyam, rükû ve secde namazın içindeki farzlardandır.'};
const otherLesson = {...lesson,sourceId:'t',source:'Tecvid',text:'Namazın içindeki farzlar arasında kıyam ve rükû yer alır.'};
const contents = {...lesson,text:'İçindekiler\nNamazın Farzları ..... 64\nNamazın Vacipleri ..... 68'};
const prayerSnapshot = {pages:[unrelatedPreface,rawQuran,otherLesson,lesson],quranSources:new Set(['q'])};
function prayerEvidence(question,sources,pages=prayerSnapshot.pages) {
  const plan=checks.plan(question,sources,MenbaAnswers.inspect(question),source=>Boolean(source.quran),'curated');
  return checks.rank(plan,{...prayerSnapshot,pages},'curated').evidence;
}
for (const question of ['Namazin Farzlari','Namazın farzları nelerdir?', 'Namazın farzlarını açıklar mısın?']) {
  assert.deepEqual(prayerEvidence(question,[tecvid,quran],[unrelatedPreface,rawQuran]),[],question);
  assert.equal(prayerEvidence(question,[tecvid,quran,ilmihal])[0]?.sourceId,ilmihal.id,question);
}
assert.deepEqual(prayerEvidence('İlmihal’de namazın farzları nelerdir?', [tecvid,ilmihal],[otherLesson]),[]);
assert.deepEqual(prayerEvidence('Namazın farzları',[ilmihal],[contents]),[]);
assert.deepEqual(prayerEvidence('Namazın farzları',[ilmihal],[{...lesson,text:'Namazın Farzları'}]),[]);
assert.deepEqual(prayerEvidence('Namazın farzları',[ilmihal],[{...lesson,text:'Namaz kılmak her Müslümana farzdır.'}]),[]);
assert.equal(prayerEvidence('Namazın farzları',[ilmihal],[{...lesson,ocr:true}])[0]?.ocr,true);
assert.equal(prayerEvidence('Was sind die Pflichtbestandteile des Gebets?', [ilmihal])[0]?.page,64);
assert.equal(prayerEvidence('ما فرائض الصلاة؟',[ilmihal])[0]?.page,64);
assert.equal(prayerEvidence('Namaz hakkında bir ayet',[quran])[0]?.verse,'2:43');
assert.deepEqual(MenbaSearch.find('Namaz',[unrelatedPreface]),[]);
const candidates = checks.candidates([rawQuran],'tr');
assert.ok(candidates.length >= 1);
const observed = checks.test(candidates[0],{pages:[rawQuran],quranSources:new Set(['q'])},{
  ...env,sources:[quran],isQuran:source=>source.quran
});
assert.equal(observed.status,'pass');
assert.equal(observed.citation.page,7);
assert.equal(observed.citation.verse,'2:43');

const descriptions = {...emsile,text:'Dieses Kapitel erläutert das Lesen des Korans. Das Lesen des Korans wird erklärt.'};
const testScope = {...env,sources:[scopes[0],quran],isQuran:source=>source.quran};
const scopedQuestion = 'Was steht in „Emsile“ zum Thema Koran lesen?';
const mixed = {pages:[descriptions,rawQuran],quranSources:new Set(['q'])};
assert.deepEqual(checks.evaluate(scopedQuestion,mixed,testScope).evidence.map(page=>page.sourceId),['e']);
assert.deepEqual(checks.evaluate(scopedQuestion,mixed,{...testScope,sources:[quran]}).evidence,[]);
const arabicScope = checks.plan('ماذا ورد في كتاب «Emsile» عن القرآن؟',testScope.sources,null,testScope.isQuran,'curated');
assert.deepEqual(arabicScope.sources.map(source=>source.id),['e']);
const curated = {id:'curated',title:'Hadis',hadith:true};
assert.deepEqual(checks.plan('„Emsile“ kitabında hangi hadis yazıyor?',[scopes[0],curated],null,()=>false,'curated').sources,[scopes[0]]);

const exactTerms = {sourceId:'e',source:'Emsile',page:2,text:'Die Sternlaterne steht im Lesesaal.'};
const exactPhrase = {...exactTerms,page:3,text:'Dort lautet der Titel: Sternlaterne\nLesesaal.'};
const exactQuestion = 'Welche Textstelle erwähnt „Sternlaterne Lesesaal“?';
const exactSnapshot = {pages:[exactTerms,exactPhrase],quranSources:new Set()};
assert.deepEqual(checks.evaluate(exactQuestion,{...exactSnapshot,pages:[exactTerms]},env).evidence,[]);
const exactResult = checks.evaluate(exactQuestion,exactSnapshot,env);
assert.equal(exactResult.evidence.length,1);
assert.equal(exactResult.evidence[0].page,3);
assert.deepEqual(exactResult.answer?.citations,[1]);
assert.equal(checks.evaluate('Hangi metin bölümünde Namazı dosdoğru kılın geçiyor?',mixed,testScope).evidence[0].verse,'2:43');
assert.deepEqual(MenbaSearch.findExact('Lesesaal',[{...exactTerms,text:'Unser Lesesaalbau.'}]),[]);
assert.equal(MenbaSearch.findExact('[1].',[{...exactTerms,text:'Die belegte Aussage. [1]. Hier folgt Kontext.'}]).length,1);
console.log('PASS: DE/TR/AR-Fragevarianten, Buchgrenzen, echte Belegprüfung, OCR-Kennzeichnung und Buch/Seitenabgleich.');
