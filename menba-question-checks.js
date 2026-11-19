(() => {
  'use strict';

  const standardQuestions = [
    'Emsile nedir?', 'Emsile konusunu açıkla.', 'Emsile hakkında bilgi ver.',
    'Emsile kitabının ilk konusunu özetle.', 'Bu kitapta hangi konular anlatılıyor?',
    'Maksud kitabında fiiller nasıl açıklanıyor?', 'Was bedeutet Emsile?',
    'Erkläre das Thema Emsile auf Deutsch.', 'ما موضوع كتاب الأمثلة؟'
  ];
  const supportedQuestions = [
    ['2:173','Ist Schweinefleisch essen haram?','Domuz eti yemek haram mı?'],
    ['2:183','Ist Fasten Pflicht?','Oruç tutmak farz mı?'],
    ['2:43','Muss man das Gebet verrichten?','Namaz kılmak farz mı?']
  ];

  const lookup = text => /^(?:Welche Textstelle erwähnt |Hangi metin bölümünde |في أي مقطع وردت كلمة )(.+?)(?: geçiyor)?[?؟]$/iu.exec(text)?.[1];

  function plan(text,picked,intent,isQuran,hadisId) {
    const literal = lookup(text);
    if (literal) return {text:literal,sources:picked,quran:null,hadith:null,quranOnly:false};
    const anyQuran = picked.some(isQuran);
    const hadith = MenbaSearch.inspectHadith(text);
    const onlyQuran = anyQuran && picked.every(source=>isQuran(source) || source.id === hadisId);
    const inspected = !hadith && MenbaQuran.inspect(text,{inQuran:onlyQuran || (anyQuran && Boolean(intent))});
    const quran = inspected && intent && !inspected.reference && !inspected.quranRequested && !inspected.dietaryRuling
      ? {...inspected,topic:intent.query} : inspected;
    const quranOnly = Boolean(quran && (quran.quranRequested || (onlyQuran && !quran.dietaryRuling)));
    let sources = picked;
    if (quranOnly) sources = anyQuran ? picked.filter(isQuran) : picked.filter(source=>source.id !== hadisId);
    else if (hadith) sources = picked.filter(source=>source.hadith && !source.quran);
    return {text,sources,quran,hadith,quranOnly};
  }

  function findQuran(query,pages) {
    const verses = pages.flatMap(page=>(page.verses || []).map(row=>({
      ...row,sourceId:page.sourceId,source:page.source,page:page.page,meal:true
    })));
    const results = MenbaQuran.findVerses(query,verses);
    if (results.length >= 3) return results;
    const found = new Set(results.map(result=>result.verse).filter(Boolean));
    const excerpts = MenbaQuran.find(query,pages.filter(page=>!page.verses?.length));
    return results.concat(excerpts.filter(entry=>!found.has(entry.verse))).slice(0,3);
  }

  function rank(plan,{pages,quranSources},hadisId) {
    const {quran,quranOnly,text,hadith} = plan;
    const scope = new Set(plan.sources.map(source=>source.id));
    const eligible = pages.filter(page=>scope.has(page.sourceId) && (!quranOnly || quranSources.has(page.sourceId)));
    const quranRows = quran ? findQuran(quran,eligible.filter(page=>quranSources.has(page.sourceId))) : [];
    const dietaryRows = !quranOnly && !quranRows.length && quran?.dietaryRuling
      ? MenbaQuran.findVerses(quran,eligible.filter(page=>!quranSources.has(page.sourceId))) : [];
    const rows = quranOnly || quranRows.length ? quranRows : dietaryRows.length ? dietaryRows : MenbaSearch.find(text,eligible);
    const samples = hadith?.sample ? eligible.filter(page=>page.sourceId === hadisId) : [];
    const ocr = new Set(eligible.filter(row=>row.ocr).map(row=>`${row.sourceId}:${row.page}`));
    const evidence = (samples.length ? [samples[Math.floor(Math.random()*samples.length)]] : rows).map(entry=>({
      ...entry,quran:quranSources.has(entry.sourceId),ocr:ocr.has(`${entry.sourceId}:${entry.page}`)
    }));
    return {evidence,quranRows};
  }

  const normalize = value => value.normalize('NFC').replace(/\s+/gu,' ').trim();

  function checkCitation(row,rawPages) {
    if (!row || typeof row.text !== 'string' || !row.text.trim() || !Number.isSafeInteger(row.page) || row.page < 1) return false;
    return rawPages.some(page=>{
      if (page.sourceId !== row.sourceId || page.source !== row.source || page.page !== row.page) return false;
      if (row.verse && page.verses?.length) {
        return page.verses.some(verse=>verse.verse === row.verse && normalize(verse.text).includes(normalize(row.text)));
      }
      return normalize(page.text).includes(normalize(row.text));
    });
  }

  function localAnswer(text,intent,evidence,language) {
    const supported = MenbaAnswers.compose(intent,evidence,language);
    if (supported) return supported;
    const searchTerm = lookup(text);
    const reference = MenbaQuran.inspect(text)?.reference;
    if (!searchTerm && !reference) return null;
    const citation = evidence.findIndex(entry=>!entry.ocr && (searchTerm
      ? normalize(entry.text).toLowerCase().includes(normalize(searchTerm).toLowerCase())
      : entry.verse === `${reference.surah}:${reference.ayah}`));
    if (citation < 0) return null;
    const messages = {
      de:'Die gesuchte Stelle steht im folgenden Auszug.',
      tr:'Aradığın ifade aşağıdaki kaynak bölümünde yer alıyor.',
      ar:'المقطع المطلوب موجود في الاقتباس أدناه.'
    };
    return {kind:'excerpt',text:messages[language] ?? messages.de,citations:[citation+1]};
  }

  function candidates(pages,language,max=6) {
    const questions = [];
    const seen = new Set();
    const samples = pages.filter(page=>!page.ocr && page.text.trim()).slice(0,70);
    if (language !== 'ar' && max > 1) {
      for (const [reference,de,turkish] of supportedQuestions.slice(0,Math.min(max-1,3))) {
        const page = samples.find(item=>item.verses?.some(verse=>verse.verse === reference));
        const verse = page?.verses.find(item=>item.verse === reference);
        const text = language === 'tr' ? turkish : de;
        const evidence = verse && {...verse,source:page.source,page:page.page};
        if (!evidence || !MenbaAnswers.compose(MenbaAnswers.inspect(text),[evidence],language)) continue;
        seen.add(reference);
        questions.push({text,expected:{page:page.page,sourceId:page.sourceId,verse:reference}});
      }
    }
    for (const page of samples) {
      for (const verse of page.verses ?? []) {
        if (!/^\d{1,3}:\d{1,3}$/u.test(verse.verse) || !verse.text.trim() || seen.has(verse.verse)) continue;
        seen.add(verse.verse);
        const name = language === 'tr' ? 'Kur’an' : language === 'ar' ? 'القرآن' : 'Koran';
        questions.push({text:`${name} ${verse.verse}`,expected:{page:page.page,sourceId:page.sourceId,verse:verse.verse}});
        if (questions.length >= max) return questions;
      }
    }
    const prompt = language === 'tr' ? term=>`Hangi metin bölümünde ${term} geçiyor?`
      : language === 'ar' ? term=>`في أي مقطع وردت كلمة ${term}؟`
        : term=>`Welche Textstelle erwähnt ${term}?`;
    const readable = [...samples,...pages.filter(page=>page.ocr && page.text.trim()).slice(0,20)];
    for (const page of readable) {
      for (const term of MenbaSearch.keywords(page.text).slice(0,3)) {
        if (seen.has(term.toLowerCase())) continue;
        seen.add(term.toLowerCase());
        questions.push({text:prompt(term),expected:{page:page.page,sourceId:page.sourceId}});
        if (questions.length >= max) return questions;
      }
    }
    return questions;
  }

  function test(candidate,snapshot,{hadisId,sources,isQuran,language}) {
    const intent = MenbaAnswers.inspect(candidate.text);
    const prepared = plan(candidate.text,sources,intent,isQuran,hadisId);
    const {evidence} = rank(prepared,snapshot,hadisId);
    const answer = localAnswer(candidate.text,intent,evidence,language);
    const cited = answer?.citations.map(index=>evidence[index-1]) ?? [];
    const valid = cited.length > 0 && cited.every(row=>checkCitation(row,snapshot.pages));
    const target = candidate.expected && (valid ? cited : evidence).find(row=>
      row.sourceId === candidate.expected.sourceId && row.page === candidate.expected.page
      && (!candidate.expected.verse || row.verse === candidate.expected.verse));
    const status = valid && target ? 'pass' : !evidence.length ? 'fail' : 'review';
    return {text:candidate.text,status,found:evidence.length,valid,
      citation:target ? {source:target.source,page:target.page,verse:target.verse} : null};
  }

  globalThis.MenbaQuestionChecks = Object.freeze({standardQuestions,plan,rank,localAnswer,checkCitation,candidates,test});
})();
