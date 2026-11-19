import assert from 'node:assert/strict';
import worker from './menba-worker.mjs';

const origin = 'https://library.example';
const endpoint = 'https://worker.example/menba/answer';
const token = 'Bearer synthetic.authorized-token.owner';
const input = {question:'Depoyu kim açar?',language:'tr',previousQuestion:'',excerpts:[
  {number:1,text:'Yasemin Korkut hat den einzigen Schlüssel. Eine frühere Fassung nennt Mehmet, das ist falsch.'},
]};
const cite = {number:1,quote:'Yasemin Korkut hat den einzigen Schlüssel.'};
const result = {text:'Depoyu açabilecek kişi Yasemin Korkut. Anahtar yalnızca onda var.',citations:[cite]};
const authHeaders = {Origin:origin,Authorization:token,'Content-Type':'application/json'};
let owner = true;
let authCalls = 0;
let aiCalls = [];
let aiReplies = [];
globalThis.fetch = async (url, options) => {
  assert.equal(url.href,'https://database.example/rest/v1/rpc/library_beta_get_access');
  assert.equal(options.method,'POST');
  assert.equal(options.redirect,'error');
  assert.equal(options.headers.Authorization,token);
  assert.equal(options.headers.apikey,'public-key');
  assert.equal(options.body,'{}');
  authCalls++;
  return Response.json([{is_owner:owner,capabilities:[]}]);
};
const env = {
  MENBA_ALLOWED_ORIGIN:origin,SUPABASE_URL:'https://database.example',SUPABASE_PUBLISHABLE_KEY:'public-key',
  AI:{async run(model,options) {
    assert.equal(model,'@cf/google/gemma-4-26b-a4b-it');
    assert.equal(options.store,false);
    assert.equal(options.response_format.type,'json_object');
    assert.equal(options.chat_template_kwargs.enable_thinking,false);
    const payload = JSON.parse(options.messages[1].content);
    assert.equal(options.messages[1].content.includes(token),false);
    aiCalls.push(payload);
    const next = aiReplies.shift();
    return {choices:[{message:{content:JSON.stringify(next)}}]};
  }},
};
const request = (body = input, headers = authHeaders) => new Request(endpoint,{
  method:'POST',headers,body:JSON.stringify(body),
});

const cors = await worker.fetch(new Request(endpoint,{method:'OPTIONS',headers:{Origin:origin}}),env);
assert.equal(cors.status,204);
assert.equal(cors.headers.get('Access-Control-Allow-Origin'),origin);
assert.equal(cors.headers.get('Cache-Control'),'no-store');
assert.equal((await worker.fetch(request(input,{...authHeaders,Origin:'https://evil.example'}),env)).status,403);
assert.equal((await worker.fetch(request(input,{Origin:origin,'Content-Type':'application/json'}),env)).status,401);
assert.equal(authCalls,0);
owner = false;
assert.equal((await worker.fetch(request(),env)).status,403);
assert.equal(aiCalls.length,0);
owner = true;
assert.equal((await worker.fetch(request({ ...input,excerpts:[{number:1,text:'x'.repeat(650)}]}),env)).status,400);
assert.equal((await worker.fetch(request({ ...input,question:'x'.repeat(13000)}),env)).status,400);
assert.equal((await worker.fetch(request({ ...input,excerpts:[input.excerpts[0],input.excerpts[0]]}),env)).status,400);
assert.equal(aiCalls.length,0);

aiReplies = [result,{supported:true}];
const approved = await worker.fetch(request({...input,sourceFile:'a-private-filename.pdf',userId:'private-id'}),env);
assert.equal(approved.status,200);
assert.deepEqual(await approved.json(),result);
assert.deepEqual(aiCalls[0],input);
assert.deepEqual(aiCalls[1].answer,result);
assert.deepEqual(aiCalls[1].excerpts,input.excerpts);
assert.equal(approved.headers.get('Cache-Control'),'no-store');

aiCalls = [];
aiReplies = [{...result,citations:[{number:2,quote:cite.quote}]}];
assert.equal((await worker.fetch(request(),env)).status,204);
assert.equal(aiCalls.length,1);
aiReplies = [{...result,citations:[{number:1,quote:'Eine frei erfundene Belegstelle'}]}];
assert.equal((await worker.fetch(request(),env)).status,204);
aiReplies = [{...result,text:'Mehmet açar.'},{supported:false}];
assert.equal((await worker.fetch(request(),env)).status,204);
aiReplies = [{...result,text:cite.quote}];
assert.equal((await worker.fetch(request(),env)).status,204);
aiReplies = [{text:'',citations:[]}];
assert.equal((await worker.fetch(request(),env)).status,204);
console.log('PASS: origin, owner-only auth, request limits, minimal evidence, exact citations, full-context verification, fallback.');
