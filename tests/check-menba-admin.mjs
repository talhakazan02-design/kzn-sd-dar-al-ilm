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
    return Response.json([{user_id:token === ownerToken ? owner : student,is_owner:token === ownerToken}]);
  }
  if (url.pathname.endsWith('/library_beta_list_delegate_candidates') && token === ownerToken) {
    return Response.json([{user_id:student}]);
  }
  return new Response(null,{status:403});
};
let calls = 0;
const evidence = 'Die Lesestunde beginnt am Freitag und alle Teilnehmer bringen das Buch mit.';
const env = {
  MENBA_ALLOWED_ORIGIN:host,
  SUPABASE_URL:'https://database.example',
  SUPABASE_PUBLISHABLE_KEY:'synthetic-public-key',
  MENBA_QUOTA:{idFromName:()=>0,get:()=>({fetch:(url,init)=>metering.fetch(new Request(url,init))})},
  AI:{async run(){
    calls++;
    const result = calls % 2
      ? {text:'Für die Lesestunde am Freitag braucht jeder das Buch.',citations:[{number:1,quote:evidence}]}
      : {supported:true};
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

const page = [{text:evidence,source:'Testbuch',page:12}];
const quiz = MenbaLearning.prepare('talebe','quiz',page);
assert(quiz.quiz[0].prompt.includes('______'));
assert(evidence.includes(quiz.quiz[0].answer));
assert.equal(MenbaLearning.prepare('hoca','lesson',page).draft,true);
assert.equal(MenbaLearning.prepare('talebe','lesson',page),null);
assert.equal(MenbaLearning.prepare('hoca','homework',[]),null);
console.log('PASS: Lernaufgaben, Rollenprüfung, konkurrierende Reservierungen, UTC-Wechsel, Neuron-Limits und Quellennachweis.');
