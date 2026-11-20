const assert = require('node:assert/strict');
const {readFile} = require('node:fs/promises');
const {join} = require('node:path');
const {PGlite} = require('@electric-sql/pglite');

const owner = '00000000-0000-0000-0000-000000000001';
const student = '00000000-0000-0000-0000-000000000002';
const pending = '00000000-0000-0000-0000-000000000003';
const unconfirmed = '00000000-0000-0000-0000-000000000004';
const underReview = '00000000-0000-0000-0000-000000000005';
const ownLoan = '00000000-0000-0000-0000-000000000006';
const pendingLoan = '00000000-0000-0000-0000-000000000007';

(async()=>{
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon;
      create role authenticated;
      create schema auth;
      grant usage on schema auth to anon,authenticated;
      create function auth.uid() returns uuid language sql stable
        as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create table auth.users(id uuid primary key,email text,created_at timestamptz default now(),email_confirmed_at timestamptz);
      create type public.member_status as enum ('approved','pending','rejected');
      create table public.library_members(user_id uuid primary key,status public.member_status,is_admin boolean default false);
      create function public.library_beta_is_owner() returns boolean language sql stable
        as $$ select auth.uid() = '${owner}'::uuid $$;
      create table public.library_lending_offers(id uuid primary key,title text);
      create table public.library_lending_requests(
        id uuid primary key,offer_id uuid,borrower_id uuid,status text,handover_note text,created_at timestamptz default now()
      );
      insert into auth.users(id,email,email_confirmed_at) values
        ('${owner}','owner@example.invalid',now()),('${student}','student@example.invalid',now()),
        ('${pending}','pending@example.invalid',now()),('${unconfirmed}','unconfirmed@example.invalid',null);
      insert into public.library_members(user_id,status,is_admin) values
        ('${owner}','approved',true),('${student}','approved',false),('${pending}','pending',false),('${unconfirmed}','pending',false);
      insert into public.library_lending_offers values ('${underReview}','Testbuch');
      insert into public.library_lending_requests(id,offer_id,borrower_id,status,handover_note) values
        ('${ownLoan}','${underReview}','${owner}','pending','own request'),
        ('${pendingLoan}','${underReview}','${student}','pending','public handover');
    `);
    const migration = await readFile(join(__dirname,'..','MENBA-ADMIN.sql'),'utf8');
    await db.exec(migration);
    await db.exec(migration);
    const templates = await readFile(join(__dirname,'..','MENBA-TEMPLATES.sql'),'utf8');
    await db.exec(templates);
    await db.exec(templates);
    const identify = id=>db.exec(`reset role; set role authenticated; set request.jwt.claim.sub='${id}';`);
    const select = async source=>(await db.query(source)).rows;

    await identify(student);
    assert.deepEqual(await select('select * from public.library_menba_access()'),[{user_id:student,is_owner:false,is_hoca:false}]);
    await assert.rejects(select('select * from public.library_list_membership_requests()'),{code:'42501'});
    await assert.rejects(select('select * from public.library_list_pending_admin_loans()'),{code:'42501'});
    await assert.rejects(select(`select public.library_menba_set_hoca('${student}',true)`),{code:'42501'});
    await assert.rejects(select(`select public.library_review_membership('${pending}',true)`),{code:'42501'});
    await assert.rejects(select('select * from public.library_menba_hocas'),{code:'42501'});
    const addTemplate = (title,central=false)=>select(`insert into public.library_menba_templates(is_central,title,category,question) values (${central},'${title}','Recherche','Was steht in [BUCH]?') returning id`);
    const [ownTemplate] = await addTemplate('Private Vorlage');
    await assert.rejects(addTemplate('Unerlaubte zentrale Vorlage',true),{code:'42501'});
    await assert.rejects(select(`update public.library_menba_templates set is_central=true where id='${ownTemplate.id}'`),{code:'42501'});
    await select(`insert into public.library_menba_template_favorites(template_id) values ('${ownTemplate.id}')`);
    assert.deepEqual(await select('select template_id from public.library_menba_template_favorites'),[{template_id:ownTemplate.id}]);

    await identify(owner);
    const [centralTemplate] = await addTemplate('Zentrale Vorlage',true);
    assert.deepEqual(await select('select id from public.library_menba_templates'),[centralTemplate]);
    assert.deepEqual(await select('select template_id from public.library_menba_template_favorites'),[]);
    await assert.rejects(select(`insert into public.library_menba_template_favorites(template_id) values ('${ownTemplate.id}')`),{code:'42501'});
    assert.equal((await select('select * from public.library_list_membership_requests()')).length,2);
    assert.deepEqual((await select('select * from public.library_list_pending_admin_loans()')).map(row=>row.id),[pendingLoan]);
    await assert.rejects(select(`select public.library_review_membership('${unconfirmed}',true)`),{code:'22023'});
    await assert.rejects(select(`select public.library_menba_set_hoca('${pending}',true)`),{code:'22023'});
    await select(`select public.library_review_membership('${pending}',true)`);
    await select(`select public.library_review_membership('${unconfirmed}',false)`);
    await assert.rejects(select(`select public.library_review_membership('${pending}',true)`),{code:'22023'});
    await select(`select public.library_menba_set_hoca('${student}',true)`);
    await identify(student);
    assert.equal((await select('select * from public.library_menba_access()'))[0].is_hoca,true);
    assert.equal((await select('select id from public.library_menba_templates')).length,2);
    assert.deepEqual(await select(`update public.library_menba_templates set title='Unzulässig' where id='${centralTemplate.id}' returning id`),[]);
    assert.deepEqual(await select(`delete from public.library_menba_templates where id='${centralTemplate.id}' returning id`),[]);
    assert.deepEqual(await select(`update public.library_menba_templates set title='Eigene Bearbeitung' where id='${ownTemplate.id}' returning id`),[ownTemplate]);
    await select(`insert into public.library_menba_template_favorites(template_id) values ('${centralTemplate.id}')`);
    await assert.rejects(select('select owner_id from public.library_menba_templates'),{code:'42501'});
    await identify(pending);
    assert.equal((await select('select * from public.library_menba_access()'))[0].is_owner,false);
    await identify(unconfirmed);
    assert.deepEqual(await select('select * from public.library_menba_access()'),[]);
    assert.deepEqual(await select('select id from public.library_menba_templates'),[]);
    await assert.rejects(addTemplate('Nicht freigeschaltet'),{code:'42501'});
    await identify(owner);
    assert.deepEqual(await select(`delete from public.library_menba_templates where id='${centralTemplate.id}' returning id`),[centralTemplate]);
    await select(`select public.library_menba_set_hoca('${student}',false)`);
    await identify(student);
    assert.equal((await select('select * from public.library_menba_access()'))[0].is_hoca,false);
    assert.deepEqual(await select('select template_id from public.library_menba_template_favorites'),[{template_id:ownTemplate.id}]);
    await db.exec('reset role; set role anon;');
    await assert.rejects(select('select * from public.library_menba_access()'),{code:'42501'});
    await assert.rejects(select('select id from public.library_menba_templates'),{code:'42501'});
    console.log('PASS: private templates, central template permissions, per-user favorites and revoked access.');
    console.log('PASS: Mitgliederanfragen, E-Mail-Status, Ausleihe und serverseitige Hoca-Berechtigungen.');
  } finally { await db.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
