import assert from 'node:assert/strict';
import {MenbaQuota,reservationCost,reportedCost} from '../cloudflare/menba-quota.mjs';
import worker from '../cloudflare/menba-worker.mjs';
import '../menba-learning.js';

const owner = '00000000-0000-0000-0000-000000000001';
const student = '00000000-0000-0000-0000-000000000002';
const outsider = '00000000-0000-0000-0000-000000000003';
const host = 'https://library.example';
const studentToken = 'synthetic-test-token-student';
const ownerToken = 'synthetic-test-token-owner';
const invalidToken = 'synthetic-test-token-invalid';

const database = new Map();
const metering = new MenbaQuota({storage:{
  kv:{get:key=>structuredClone(database.get(key)),put:(key,value)=>database.set(key,structuredClone(value))},
  transactionSync:operation=>operation()
}});
const quota = async (operation,fields={}) => metering.fetch(new Request('https://internal.test',{
  method:'POST',body:JSON.stringify({operation,account:student,...fields})
}));

assert.equal((await quota('status')).status,200);
assert.equal((await quota('reserve',{amount:1,id:'disabled'})).status,429);
assert.equal((await quota('limit',{limit:50})).status,200);
const results = await Promise.all(Array.from({length:10},(_,index)=>quota('reserve',{amount:30,id:String(index)})));
assert.equal(results.filter(row=>row.ok).length,1);
const winner = results.findIndex(row=>row.ok);
const reservation = await results[winner].json();
await quota('settle',{id:String(winner),day:reservation.day,used:15});
await quota('settle',{id:String(winner),day:reservation.day,used:1});
const settled = await (await quota('status')).json();
assert.equal(settled.used,15);
assert.equal(settled.total,15);
assert.equal((await quota('limit',{limit:10001})).status,400);
database.set('usage',{day:'1970-01-01',total:9999,members:{[student]:9999},holds:{}});
assert.equal((await (await quota('status')).json()).used,0);
assert.equal((await quota('limit',{limit:500})).status,200);
assert.equal(reportedCost({prompt_tokens:1000,completion_tokens:100}),11.8183);

globalThis.fetch = async (url,{headers,redirect}) => {
  assert.equal(redirect,'manual');
  const token = headers.Authorization?.replace(/^Bearer /u,'');
  if (![studentToken,ownerToken].includes(token)) return new Response(null,{status:401});
  if (url.pathname.endsWith('/library_menba_access')) {
    return Response.json([{user_id:token === ownerToken ? owner : student,is_owner:token === ownerToken,is_hoca:token === ownerToken}]);
  }
  if (url.pathname.endsWith('/library_beta_list_delegate_candidates') && token === ownerToken) {
    return Response.json([{user_id:student}]);
  }
  return new Response(null,{status:403});
};
let calls = 0;
const inference = [];
let supported = true;
const evidence = 'Die Lesestunde beginnt am Freitag und alle Teilnehmer bringen das Buch mit.';
const env = {
  MENBA_ALLOWED_ORIGIN:host,
  SUPABASE_URL:'https://database.example',
  SUPABASE_PUBLISHABLE_KEY:'synthetic-public-key',
  MENBA_QUOTA:{idFromName:()=>0,get:()=>({fetch:(url,init)=>metering.fetch(new Request(url,init))})},
  AI:{async run(model,options){
    calls++;
    inference.push({model,options});
    const result = calls % 2
      ? {text:'Für die Lesestunde am Freitag braucht jeder das Buch.',citations:[{number:1,quote:evidence}]}
      : {supported};
    return {response:JSON.stringify(result),usage:{prompt_tokens:300,completion_tokens:100}};
  }}
};
const request = (path,token,data,origin=host) => worker.fetch(new Request('https://worker.example'+path,{
  method:'POST',headers:{Origin:origin,'Content-Type':'application/json',Authorization:`Bearer ${token}`},
  body:JSON.stringify(data)
}),env);
const ask = {language:'de',question:'Wann beginnt die Lesestunde?',excerpts:[{number:1,text:evidence}]};

assert.equal((await request('/menba/quota',studentToken,{account:student,limit:9999})).status,403);
assert.equal((await request('/menba/quota',ownerToken,{account:outsider,limit:1})).status,403);
assert.equal((await request('/menba/answer',invalidToken,ask)).status,403);
assert.equal((await request('/menba/answer',studentToken,ask,'https://wrong.example')).status,403);
assert.equal((await request('/menba/answer',studentToken,{...ask,mode:'scholarly',depth:'deep'})).status,403);
assert.equal((await request('/menba/answer',ownerToken,{...ask,mode:'unknown'})).status,400);
assert.equal((await request('/menba/answer',ownerToken,{...ask,mode:['scholarly']})).status,400);
assert.equal((await request('/menba/answer',ownerToken,{...ask,mode:'simple',draft:{minutes:15,audience:'youth'}})).status,400);
assert.equal(calls,0);
assert.equal((await request('/menba/quota',ownerToken,{account:student,limit:0})).status,200);
assert.equal((await request('/menba/answer',studentToken,ask)).status,429);
assert.equal(calls,0);
assert.equal((await request('/menba/quota',ownerToken,{account:student,limit:500})).status,200);
const answer = await request('/menba/answer',studentToken,ask);
assert.equal(answer.status,200);
assert.deepEqual((await answer.json()).citations,[{number:1,quote:evidence}]);
assert.equal(calls,2);
const usage = await (await request('/menba/quota',ownerToken,{account:student})).json();
assert.equal(usage.used,11);
assert.equal(usage.total,11);
assert.equal(usage.limit,500);
database.set('usage',{day:usage.day,total:9999,members:{},holds:{}});
assert(reservationCost(ask)>1);
assert.equal((await request('/menba/answer',studentToken,ask)).status,429);
assert.equal(calls,2);

database.delete('usage');
const deep = { ...ask,mode:'scholarly',depth:'deep',draft:{minutes:30,audience:'youth'},
  excerpts:Array.from({length:6},(_,index)=>({number:index+1,text:`${evidence} Lesestunde ${index+1}.`}))};
const lecture = await request('/menba/answer',ownerToken,deep);
assert.equal(lecture.status,200);
assert.equal((await lecture.json()).mode,'scholarly');
assert.equal(calls,4);
assert.equal(inference[2].model,'@cf/google/gemma-4-26b-a4b-it');
assert.equal(inference[2].options.max_completion_tokens,2200);
assert.equal(inference[3].options.max_completion_tokens,120);
assert.match(inference[2].options.messages[0].content,/30-minute Sohbet for ages 12–17/u);
assert.equal(JSON.parse(inference[2].options.messages[1].content).excerpts.length,6);
assert(reservationCost(deep,2200,6000)>reservationCost(ask));
const deepStatus = await (await request('/menba/quota',ownerToken,{account:owner})).json();
assert.deepEqual([deepStatus.used,deepStatus.total],[11,11]);
assert.equal((await request('/menba/answer',ownerToken,{...deep,depth:'brief'})).status,400);
supported = false;
assert.equal((await request('/menba/answer',ownerToken,{...ask,mode:'guided',step:2,previousQuestion:'Wann beginnt die Lesestunde?'})).status,204);
assert.match(inference[4].options.messages[0].content,/only step 2/u);
assert.equal(calls,6);
supported = true;
const turkishExcerpt = 'Domuz eti yemek haramdır ve bu hüküm ilgili bölümde açıklanır.';
const englishReply = await worker.fetch(new Request('https://worker.example/menba/answer',{
  method:'POST',headers:{Origin:host,'Content-Type':'application/json',Authorization:`Bearer ${ownerToken}`},
  body:JSON.stringify({language:'en',question:'Is eating pork haram?',excerpts:[{number:1,text:turkishExcerpt}]})
}),{...env,AI:{async run(_,options){
  const prompt = options.messages[0].content;
  assert.match(prompt,/English/u);
  const data=JSON.parse(options.messages[1].content);
  assert.equal(data.excerpts[0].text,turkishExcerpt);
  return {response:JSON.stringify(data.answer ? {supported:true} : {
    text:'The passage prohibits eating pork.',citations:[{number:1,quote:turkishExcerpt}]
  }),usage:{prompt_tokens:300,completion_tokens:100}};
}}});
assert.equal(englishReply.status,200);
assert.deepEqual(await englishReply.json(),{
  mode:'menba',text:'The passage prohibits eating pork.',citations:[{number:1,quote:turkishExcerpt}]
});

const styles = globalThis.MenbaExplanations;
let conversation = styles.state();
assert.equal(styles.activeMode('chat',conversation),'menba');
assert.equal(styles.activeMode('hoca',conversation),'menba');
assert.equal(styles.activeMode('talebe',conversation),'simple');
for (const phrase of ['Hocam, anlamadım.','Yine anlamadım.','Hiç anlamıyorum.','Kannst du es anders erklären?','Ich verstehe es immer noch nicht.']) {
  assert.equal(styles.signal(phrase),'confused',phrase);
}
assert.equal(styles.signal('Ich verstehe es nicht. Was sind die Voraussetzungen?'),null);
conversation = styles.advance(styles.advance(conversation,'confused'),'confused');
assert.equal(styles.activeMode('talebe',conversation),'guided');
assert.equal(styles.advance(conversation,'next').step,2);
assert.equal(styles.activeMode('talebe',styles.advance(conversation,'understood')),'simple');
conversation.manual.talebe = 'simple';
assert.equal(styles.activeMode('talebe',conversation),'simple');

const page = [{text:evidence,source:'Testbuch',page:12}];
const quiz = MenbaLearning.prepare('talebe','quiz',page);
assert(quiz.quiz[0].prompt.includes('______'));
assert(evidence.includes(quiz.quiz[0].answer));
assert.equal(MenbaLearning.prepare('hoca','lesson',page).draft,true);
assert.equal(MenbaLearning.prepare('talebe','lesson',page),null);
assert.equal(MenbaLearning.prepare('hoca','homework',[]),null);
console.log('PASS: Lernaufgaben, Rollenprüfung, konkurrierende Reservierungen, UTC-Wechsel, Neuron-Limits und Quellennachweis.');
