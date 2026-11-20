(() => {
  'use strict';

  const maxPassages = 3;
  const maxPassageLength = 440;
  const maxEvidenceSpan = 350;
  const tokenPattern = /[\p{L}\p{N}][\p{L}\p{M}\p{N}\u0640\u200c\u200d]*/gu;
  const phraseSeparator = /^[\s'’\u2010\u2011-]*$/u;

  function normalize(word) {
    return word.normalize('NFKD').toLowerCase()
      .replace(/[\p{M}\u0640\u200c\u200d]/gu, '')
      .replaceAll('ß', 'ss')
      .replaceAll('ı', 'i')
      .replace(/[ىیۍېے]/gu, 'ي')
      .replace(/[کڪ]/gu, 'ك')
      .replace(/[ٱٲٳٵ]/gu, 'ا')
      .replace(/[ةۀە]/gu, 'ه')
      .replace(/[٠-٩۰-۹]/gu, digit => String(digit.charCodeAt(0) & 15));
  }

  const stopWords = new Set(`
    aber alle als also am an auch auf aus bei bin bis bist da dadurch damit danach
    dann das dass dazu dein dem den denn der deren des dessen dich die dies diese
    dieser dieses dir doch dort du durch ein eine einem einen einer eines er es
    etwas euch für ganz gegen gewesen gibt ging habe haben hat hatte hier hin ich
    ihm ihn ihnen ihr im in indem ins ist ja jede jedem jeden jeder jedes kann
    kannst kein keine kurz man mehr mein mich mir mit muss nach nein nicht noch
    nun nur ob oder ohne schreib schreibe schon sehr sei sein selbst sich sie sind
    so soll sollen sowas über um und uns unter vom von vor war waren was weil
    weiter welche welchem welchen welcher welches wem wen wenn wer werde werden
    weshalb wie wieder wir wird wo woher wohin wozu zu zum zur zwar zwischen
    erklär erkläre erklären erklärt erklaerung beschreib beschreibe beschreiben sag sage sagt sagen bitte
    möchte wissen erfahren bitte allgemein religiös islamisch
    deutsch deutsche deutschen deutsches türkisch türkische türkischen türkisches
    schritt schritten einfach einfacher vereinfacht beispiel beispiele übungen übung
    ausschnitt auszug textabschnitt abschnitt kapitel seite zusammenfassung zusammenfassen
    wiederholungsfragen vorbereiten fünf quellenbasiert enthalten
    bedeuten bedeutet nenn nenne nennen zeig zeigt zeigen zeige steht stehen quelle quellen buch
    finde finden find finr sucht suche such suchen gib gefunden stelle stellen fundstelle fundstellen
    passende passendes passenden passender thema themen bezüglich dazu erklären erfahre erfahren nennt
    arabisch arabischen osmanisch osmanischen turkisch turkischen yazili
    osmanlica osmanli arapca arapcasinda turkce
    besteht worin woruber woraus auskunft antwort frage bedeutung erklarung definition
    kitap kitapta kaynak kaynakta kaynaklar nedir nedirki ne nasil nereye nerede
    nereden neden neyi neye neyin niye hangi hangisi kim kime kac kactir bir birde
    bu bunu buna bunlar su sunu ona o ve veya ile icin gibi hem ama ya da de
    daha en mi mu musun ben sen biz siz onlar olarak olan olur oldu degil
    ifade et anlat acikla soyle soyler goster gosterir bul bulabilir bulabilirsen bulur kisaca bilgi hakkinda anlamina geliyor
    bana sana bize size ver verir verebilir soyler misin misiniz ilgili dair konu konusunda konulu bahseden ornek lutfen bahseder serifi serif
    demek denir yaziyor diyor bahsediyor nelerdir miymis gore nasildir yapilir
    soru cevap anlami tanimi nasilca
    konusu konusunu konusunun konular konulari kitabinin kitabinda kitabin kitabi
    basit basitce aciklar aciklaniyor aciklanir aciklamasi anlatir anlatiliyor anlatilan
    adim adimlara bolum bolumu bolumunu bolumunde ozet ozetle ozetler hazirla
    hazirlar olustur olusturur ornegi ornekler ornekleri Almanca Turkce anlayamadim anlamadim
    soruluk dayali misin musun hazirlar hazirlayabilir verebilir tekrar
    ما ماذا من لمن بم عن عند بعد مع قبل على الى في هذا هذه ذلك تلك هو هي هما
    هم هن كان كانت يكون تكون هل متى اين كيف لماذا كم يا او كل بين الذي التي
    الذين نحن انت انتم انا ان انه وان فان بان فإن ولم لن لا لكي لكن ثم اذا
    اشرح وضح اخبرني اذكر ورد يقول نص كتاب السؤال جواب الرجاء معنى تعريف حكم اعطني اعطيني هات ارني اريد ابحث
    موضوع مواضيع باللغة بالالمانية بالتركية ببساطة اشرحها شرح مقطع فقرة ذكر يذكر
  `.trim().split(/\s+/u).map(normalize));

  function significant(word) {
    return !stopWords.has(word) &&
      (word.length >= 3 || (word.length >= 2 && /\p{Script=Arabic}/u.test(word)));
  }

  function withoutArabicArticle(word) {
    return word.replace(/^(?:[وفبك]?ال|[وف]?لل)(?=\p{Script=Arabic}{3,}$)/u, '');
  }

  const inflections = new Set([
    'e', 'en', 'er', 'ern', 'es', 'n', 's', 'i', 'in', 'a', 'da', 'de',
    'ta', 'te', 'dan', 'den', 'tan', 'ten', 'daki', 'deki', 'lar', 'ler',
    'lari', 'leri', 'larin', 'lerin', 'ini', 'ina', 'inin', 'nin', 'unun', 'nun',
    'umuz', 'imiz', 'imizde', 'dir', 'tir', 'ya', 'ye', 'yi', 'yu', 'la', 'le',
    'si', 'su', 'sina', 'sine', 'sini', 'sunu', 'indan', 'inden'
  ]);

  // These equivalents help find a citation. They never contribute text to one.
  const equivalents = [
    ['tecvid', 'tecwid', 'tajwid', 'tajweed', 'tadschwid', 'tadjwid', 'تجويد'],
    ['emsile', 'emsila', 'amthila', 'amsila', 'أمثلة', 'امثله'],
    ['maksud', 'maksoud', 'maqsud', 'maqsoud', 'maqsood', 'مقصود'],
    ['ilmihal', 'ilmihaal', 'ilm-i hâl', 'ilm i hal', 'علم حال', 'علم الحال'],
    ['elif', 'alif', 'ألف'],
    ['idgam', 'idghaam', 'idgham', 'إدغام'],
    ['ihfa', 'ikhfa', 'إخفاء'],
    ['izhar', 'ithhar', 'izhaar', 'إظهار'],
    ['iklab', 'iqlab', 'إقلاب'],
    ['mahrec', 'machradsch', 'makhraj', 'makharij', 'مخرج', 'مخارج'],
    ['gunne', 'ghunna', 'ghunnah', 'غنة'],
    ['med', 'madd', 'مد'],
    ['sarf', 'tasrif', 'صرف', 'تصريف'],
    ['nahiv', 'nahw', 'نحو'],
    ['masdar', 'mastar', 'مصدر'],
    ['fiil', 'fiili', 'fiiller', 'fiillerin', 'çekimli fiil', 'Verben', 'Verb', 'الأفعال', 'فعل', 'أفعال'],
    ['abdest', 'wudu', 'wudhu', 'wuzu', 'Gebetswaschung', 'rituelle Waschung', 'وضوء'],
    ['gusul', 'ghusl', 'غسل'],
    ['namaz', 'gebet', 'ritualgebet', 'pflichtgebet', 'salah', 'salat', 'صلاة'],
    ['salavat', 'salat u selam', 'salat ve selam', 'salatu selam', 'salatus selam', 'الصلاة والسلام'],
    ['oruc', 'fasten', 'sawm', 'صوم', 'صيام'],
    ['zekat', 'zakat', 'pflichtabgabe', 'زكاة'],
    ['domuz', 'schwein', 'schweinefleisch', 'domuz eti', 'خنزير', 'لحم الخنزير'],
    ['haram', 'haramdır', 'verboten', 'Verbot', 'yasak', 'حرام', 'محرم', 'حرمت'],
    ['yemek', 'essen', 'verzehr', 'verzehren', 'yeme', 'أكل'],
    ['sehadet', 'Glaubensbekenntnis', 'kelime-i şehadet', 'الشهادة'],
    ['hac', 'hacc', 'hadsch', 'pilgerfahrt', 'حج'],
    ['istigfar', 'um Vergebung bitten', 'istiğfar', 'استغفار'],
    ['sabir', 'sabr', 'geduld', 'geduldig', 'صبر'],
    ['gunah', 'sünde', 'sünden', 'sündigen', 'ذنب', 'ذنوب'],
    ['tovbe', 'reue', 'bereuen', 'توبة'],
    ['merhamet', 'barmherzigkeit', 'erbarmen', 'rahmet', 'رحمة'],
    ['allah', 'gott', 'ٱللَّه'],
    ['anne', 'ana', 'mutter', 'أم'],
    ['baba', 'vater', 'أب'],
    ['ebeveyn', 'eltern', 'anne baba', 'ana baba', 'والدين']
  ];
  const aliases = new Map();
  const phrases = [];
  for (const [key, ...members] of equivalents) {
    for (const alias of [key, ...members]) {
      const parts = [...alias.matchAll(tokenPattern)].map(match => normalize(match[0]));
      if (parts.length === 1) aliases.set(parts[0], key);
      else phrases.push({key, parts});
    }
  }
  const titleTerms = new Set(['tecvid', 'emsile', 'maksud', 'ilmihal']);
  const suffixes = [...inflections, 'nda', 'nde', 'daki', 'deki'].sort((a, b) => b.length - a.length);

  function canonical(word) {
    const alias = aliases.get(word) || aliases.get(withoutArabicArticle(word));
    if (alias) return alias;
    if (!/^[a-z]+$/u.test(word)) return word;
    for (const ending of suffixes) {
      if (word.length - ending.length < 4 || !word.endsWith(ending)) continue;
      const root = aliases.get(word.slice(0, -ending.length));
      if (root) return root;
    }
    return word;
  }

  function* tokens(text) {
    const pieces = [...text.matchAll(tokenPattern)].map(match => ({
      word: normalize(match[0]), start:match.index, end:match.index + match[0].length
    }));
    for (let index = 0; index < pieces.length; index++) {
      const first = pieces[index];
      const phrase = phrases.find(({parts}) => parts.every((part, offset) => {
        const piece = pieces[index + offset];
        if (piece?.word !== part) return false;
        return !offset || phraseSeparator.test(text.slice(pieces[index + offset - 1].end, piece.start));
      }));
      if (phrase) {
        index += phrase.parts.length - 1;
        yield {word:phrase.key, start:first.start, end:pieces[index].end};
      } else yield {...first, word:canonical(first.word)};
    }
  }

  function strength(a, b) {
    if (withoutArabicArticle(a) === withoutArabicArticle(b)) return 2;
    const shorter = a.length <= b.length ? a : b;
    const longer = shorter === a ? b : a;
    if (shorter.length < 4 || !longer.startsWith(shorter)) return 0;
    const suffix = longer.slice(shorter.length);
    if (inflections.has(suffix)) return 2;
    return shorter.length >= 5 && suffix.length <= 4 ? 1 : 0;
  }

  function pageHits(text, terms, indexes) {
    const hits = [];
    for (const {word, start, end} of tokens(text)) {
      if (!significant(word)) continue;
      let term = indexes.get(word) ?? -1;
      let matchStrength = term >= 0 ? 3 : 0;
      if (!matchStrength) {
        for (const [index, query] of terms.entries()) {
          const candidate = strength(query, word);
          if (candidate > matchStrength) {
            term = index;
            matchStrength = candidate;
          }
          if (candidate === 2) break;
        }
      }
      if (term >= 0) hits.push({term, exact: matchStrength >= 2, start, end});
    }
    return hits;
  }

  function bestWindow(hits, threshold) {
    let start = 0;
    let exactOccurrences = 0;
    const seen = new Map();
    const exact = new Map();
    let best = null;
    const add = (counts, key) => counts.set(key, (counts.get(key) || 0) + 1);
    const remove = (counts, key) => {
      if (counts.get(key) === 1) counts.delete(key);
      else counts.set(key, counts.get(key) - 1);
    };
    for (const hit of hits) {
      add(seen, hit.term);
      if (hit.exact) {
        add(exact, hit.term);
        exactOccurrences++;
      }
      while (hit.end - hits[start].start > maxEvidenceSpan) {
        const prior = hits[start++];
        remove(seen, prior.term);
        if (prior.exact) {
          remove(exact, prior.term);
          exactOccurrences--;
        }
        if (start === hits.length) return best;
        if (prior === hit) break;
      }
      // Prefix overlap alone does not establish a relevant passage.
      if (seen.size < threshold || exact.size === 0) continue;
      const span = hit.end - hits[start].start;
      const repeatedEvidence = Math.min(2, exactOccurrences - exact.size) * .7;
      const score = seen.size * 12 + exact.size * 2 + repeatedEvidence + (1 - span / maxEvidenceSpan);
      if (!best || score > best.score) best = {start: hits[start].start, end: hit.end, score};
    }
    return best;
  }

  function getExcerpt(text, first, last) {
    const slack = maxPassageLength - (last - first);
    const left = Math.max(0, first - Math.min(100, Math.floor(slack / 2)));
    const right = Math.min(text.length, left + maxPassageLength);
    const leading = text.slice(left, first);
    const trailing = text.slice(last, right);
    const sentenceEnd = /[.!?؟…](?:\s+|$)/gu;
    const precedingBreak = [...leading.matchAll(sentenceEnd)].pop();
    const followingBreak = trailing.match(sentenceEnd)?.[0];
    const naturalStart = precedingBreak ? left + precedingBreak.index + precedingBreak[0].length : left;
    const naturalEnd = followingBreak ? last + trailing.indexOf(followingBreak) + followingBreak.length : right;
    let start = naturalStart;
    let end = naturalEnd;
    if (start === left && left > 0 && !/\s/u.test(text[left - 1])) {
      const space = leading.search(/\s/u);
      start = space === -1 ? first : left + space + 1;
    }
    if (end === right && right < text.length && !/\s/u.test(text[right])) {
      const space = trailing.search(/\s\S*$/u);
      end = space === -1 ? last : last + space;
    }
    return text.slice(start, end).trim();
  }

  const hadithWord = /^(?:hadis(?:i|in|ler|leri|lerden|te)?|hadith(?:e|en)?|(?:ال)?حديث(?:ا)?|(?:ال)?احاديث)$/u;

  function queryTerms(question) {
    return [...new Set([...tokens(question.slice(0, 1000))].map(({word}) => word))];
  }

  const prayerPartWords = {
    duties: /^(?:farz(?:i|lar\p{L}{0,5})|pflichtbestandteil(?:e|en)?|gebetspflicht(?:en)?|(?:ال)?(?:فرايض|فروض))$/u,
    conditions: /^(?:sart(?:i|lar\p{L}{0,5})|voraussetzung(?:en)?|bedingung(?:en)?|(?:ال)?شروط)$/u,
    pillars: /^(?:rukun(?:leri|ler|u)?|saeulen?|saulen?|(?:ال)?اركان)$/u
  };
  const partQualifiers = /^(?:des|vom|beim|im|icin|icindeki|disindaki|icinde|disinda|onceki|esnasindaki|temel|toplam|iki|uc|dort|bes|alti|yedi|sekiz|dokuz|on|\d+)$/u;
  const partSeparator = /^[\s'’:,\u2010\u2011-]*$/u;

  function prayerPartsQuestion(question) {
    const terms = queryTerms(question);
    if (!terms.includes('namaz') && !terms.some(term=>/^gebetspflicht(?:en)?$/u.test(term))) return [];
    return Object.keys(prayerPartWords).filter(kind=>terms.some(term=>prayerPartWords[kind].test(term)));
  }

  function prayerPartsPassage(text, kinds) {
    if (/^\s*(?:icindekiler|inhaltsverzeichnis|فهرس)(?:\s|$)/u.test(normalize(text))) return null;
    const words = [...tokens(text)];
    for (const [index, first] of words.entries()) {
      if (first.word !== 'namaz' && !kinds.some(kind=>prayerPartWords[kind].test(first.word))) continue;
      const related = word => first.word === 'namaz'
        ? kinds.some(kind=>prayerPartWords[kind].test(word)) : word === 'namaz';
      for (let next = index + 1; next < Math.min(words.length, index + 6); next++) {
        const last = words[next];
        if (!partSeparator.test(text.slice(words[next - 1].end, last.start))) break;
        const after = text.slice(last.end, last.end + 330);
        const counted = kinds.includes('duties') && first.word === 'namaz' && next > index + 1
          && last.word === 'farz' && /^\s+vardir\b/u.test(normalize(after));
        if (!related(last.word) && !counted) {
          if (!partQualifiers.test(last.word)) break;
          continue;
        }
        if (/^[\t .·…]*\d+[\t ]*(?:\r?\n|$)/u.test(after)) break;
        const passage = text.slice(first.start, first.start + maxPassageLength).trim();
        // A heading alone does not establish what the duties are.
        if ((after.match(tokenPattern)?.length ?? 0) >= 2) return passage;
        break;
      }
    }
    return null;
  }

  function inspectHadith(question) {
    const terms = queryTerms(question);
    if (!terms.some(word => hadithWord.test(word))) return null;
    const topical = terms.some(word => significant(word) && !hadithWord.test(word));
    const definition = /^(?:was (?:ist|sind|bedeutet)|(?:hadis|hadith) ne(?:dir| demek)|ما(?: هو| معني))(?=$|[\p{Z}\p{P}])/u.test(normalize(question.trim()));
    return {sample:!topical && !definition};
  }

  function isHadithSource(title) {
    if (typeof title !== 'string') return false;
    const knownCollection = /(?:^|[^\p{L}])(?:sahih(?:i)?[\s'-]+(?:al[\s'-]+)?muslim|riyazu[s'’]*[\s'-]+salihin|eb[uû][\s'-]+dav[uû]d)(?=$|[^\p{L}])/u;
    return knownCollection.test(normalize(title)) || [...tokens(title)].some(({word}) =>
      hadithWord.test(word) || /^(?:hadithsammlung(?:en)?|hadithbuch|buhari|bukhari|tirmizi|tirmidhi|nesai|nasai|muvatta|muwatta)$/u.test(word));
  }

  const bookKey = value => normalize(value).replace(/[^\p{L}\p{N}]+/gu,' ').trim();

  function requestedBook(question) {
    const quoted = /„([^“]{2,160})“|«([^»]{2,160})»|“([^”]{2,160})”|"([^"\n]{2,160})"/u.exec(question);
    if (!quoted) return null;
    const before = question.slice(0,quoted.index);
    const after = question.slice(quoted.index+quoted[0].length);
    if (!/\b(?:in|aus|buch|buchtitel|kitap)\s*$/iu.test(before)
        && !/(?:^\s*(?:kitab\p{L}*|buch\b)|^\s*كتاب)/iu.test(after)
        && !/(?:^|\s)كتاب\s*$/u.test(before)) return null;
    const title = quoted.slice(1).find(Boolean).trim();
    const key = bookKey(title);
    return key ? {title,query:`${before} ${after}`,matches:value=>bookKey(value || '') === key} : null;
  }

  function exactPattern(phrase) {
    const value = phrase.normalize('NFC').trim();
    if (!value || value.length > maxPassageLength) return null;
    const pattern = value.split(/\s+/u).map(part=>part.replace(/[.*+?^${}()|[\]\\]/gu,'\\$&')).join('\\s+');
    return new RegExp(`(?<![\\p{L}\\p{M}\\p{N}])${pattern}(?![\\p{L}\\p{M}\\p{N}])`,'iu');
  }

  function findExact(phrase,pages) {
    const pattern = exactPattern(phrase);
    if (!pattern) return [];
    const hits = [];
    for (const page of pages) {
      const rows = page.verses?.length ? page.verses.map(verse=>({...page,...verse,meal:true})) : [page];
      for (const row of rows) {
        if (typeof row.text !== 'string') continue;
        const text = row.text.normalize('NFC');
        const match = pattern.exec(text);
        if (!match) continue;
        const {sourceId,source,page:number,verse,ranges,meal,ocr} = row;
        const snippet = verse ? row.text : getExcerpt(text,match.index,match.index+match[0].length);
        hits.push({sourceId,source,page:number,verse,ranges,meal,ocr,text:snippet});
        if (hits.length === maxPassages) return hits;
      }
    }
    return hits;
  }

  function matchesExact(text,phrase) {
    return exactPattern(phrase)?.test(text.normalize('NFC')) ?? false;
  }

  function find(question, pages) {
    if (typeof question !== 'string' || !Array.isArray(pages)) return [];
    const book = requestedBook(question);
    const body = book?.query ?? question;
    const questionWords = queryTerms(body).filter(word=>significant(word) && !/^\d+$/u.test(word));
    const mainTerms = questionWords.filter(word => !hadithWord.test(word));
    const terms = (mainTerms.length ? mainTerms : questionWords).slice(0, 16);
    const prayerParts = prayerPartsQuestion(body);
    const available = [];
    const titleCache = new Map();
    for (const page of pages) {
      if (!page || typeof page.text !== 'string' || !page.text.trim()) continue;
      const sourceTitle = typeof page.source === 'string' ? page.source : '';
      if (!titleCache.has(sourceTitle)) titleCache.set(sourceTitle, new Set([...tokens(sourceTitle)].map(({word}) => word)));
      const title = titleCache.get(sourceTitle);
      const exactBook = book?.matches(sourceTitle);
      const named = exactBook || terms.some(term => titleTerms.has(term) && title.has(term));
      if (book && !exactBook) continue;
      if (prayerParts.length && terms.includes('ilmihal') && !title.has('ilmihal')) continue;
      available.push({page, title, named});
    }
    const namedSource = available.some(({named}) => named);
    if (/\b(?:inhalt(?:sverzeichnis)?|icindekiler|hangi konular|ilk konusunu)\b|فهرس/u.test(normalize(question))) {
      const scoped = available.filter(entry=>!namedSource || entry.named).map(({page})=>page);
      if (new Set(scoped.map(page=>page.sourceId)).size === 1) {
        const heading = /(?:^|\n)\s*(?:[iİ][cç]indekiler|inhaltsverzeichnis|(?:ال)?فهرس)(?:\s|$)/iu;
        const contents = scoped.find(page=>heading.test(page.text));
        const match = contents?.text.match(heading);
        if (match) {
          const text = contents.text.slice(match.index).trim().slice(0,maxPassageLength).trim();
          if (text.split(/\s+/u).length >= 5) return [{sourceId:contents.sourceId,source:contents.source,page:contents.page,text}];
        }
      }
    }
    if (!terms.length) return [];
    const candidates = [];
    for (const {page, title, named} of available) {
      if (namedSource && !named) continue;
      if (prayerParts.length) {
        const text = prayerPartsPassage(page.text, prayerParts);
        if (text) candidates.push({sourceId:page.sourceId,source:page.source,page:page.page,text,score:title.has('ilmihal') ? 1 : 0});
        continue;
      }
      // A named source narrows the search but is never evidence for a passage.
      const remaining = terms.filter(term => !title.has(term) || !titleTerms.has(term));
      const bodyTerms = remaining.length ? remaining : terms;
      const indexes = new Map(bodyTerms.map((term, index) => [term, index]));
      const threshold = bodyTerms.length === 1 ? 1 : Math.max(2, Math.ceil(bodyTerms.length / 2));
      const match = bestWindow(pageHits(page.text, bodyTerms, indexes), threshold);
      if (!match) continue;
      const text = getExcerpt(page.text, match.start, match.end);
      if (text) candidates.push({sourceId: page.sourceId, source: page.source, page: page.page, text, score: match.score + (terms.length - remaining.length) * 0.5});
    }
    candidates.sort((a, b) => b.score - a.score);
    const unique = new Set();
    const result = [];
    for (const {score, ...passage} of candidates) {
      const key = normalize(passage.text).replace(/\s+/gu, ' ');
      if (unique.has(key)) continue;
      unique.add(key);
      result.push(passage);
      if (result.length === maxPassages) break;
    }
    return result;
  }

  function keywords(text) {
    const original = new Map();
    for (const {word,start,end} of tokens(text.slice(0,3000))) {
      const value = text.slice(start,end);
      if (!significant(word) || value.length < 5 || value.length > 42 || !/\p{L}/u.test(value) || hadithWord.test(word)) continue;
      if (!original.has(word)) original.set(word,value);
    }
    return [...original.values()].slice(0,16);
  }

  globalThis.MenbaSearch = Object.freeze({find,findExact,matchesExact,requestedBook,inspectHadith,isHadithSource,keywords,prayerPartsQuestion});
})();
