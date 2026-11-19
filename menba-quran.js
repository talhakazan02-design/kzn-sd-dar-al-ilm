(() => {
  'use strict';

  const maxPassages = 3;
  const words = /[\p{L}\p{N}][\p{L}\p{M}\p{N}\u0640\u200c\u200d]*/gu;
  const quranName = /(?:^|[^\p{L}\p{N}])(?:koran(?:s|ausgabe|text|ubersetzung)?|(?:kur|qur)['’\s-]?an(?:i|in|a|da|dan|de|den|daki)?|mushafi?|(?:بال|لل|ال)?قران|(?:ال)?مصحف)(?![\p{L}\p{N}])/u;
  const otherSource = /(?:^|[^\p{L}])(?:tafsir\w*|tefsir\w*|hadis\w*|hadith\w*|tecvid\w*|tajwid\w*|grammatik\w*|kommentar\w*|تفسير)(?!\p{L})/u;
  const otherVerse = /(?:^|[^\p{L}])(?:gedicht|strophe|lied|songtext|bibel|injil|incil)(?!\p{L})/u;
  const verseName = /^(?:ayy?et|ayet(?:i|in|ler|leri|lerden|le)?|ayetikerime(?:yi|ye|de|den|nin|ler|leri|lerden)?|aya[th]?|ayahs|(?:koran|quran)?vers(?:e|en|es)?|ايه|ايات|الايه|الايات)$/u;
  const verseHonorific = /^(?:kerime(?:yi|ye|de|den|nin|si|ler|leri|lerden)?|(?:ال)?كريمه)$/u;
  const wordEnd = /^(?:e|en|er|es|n|s|a|i|u|da|de|ta|te|ya|ye|yi|yu|dan|den|tan|ten|la|le|in|un|lar|ler|lari|leri|larda|lerde|lardan|lerden|nda|nde|ina|ine|ini|nin|nun|imiz|umuz|niz|nuz|dir|tir)$/u;
  const stop = new Set(`
    a an am auf aus bei bitte da das dass deine dem den der des die dies diese du ein eine einen einer eines er es euch fur gib gibt habe hat her hier ich ihr im in ist kann kannst liste los mal mein meiner mir mit nach nenn nenne noch nur sag sage sagst sein sich sind sie soll sowie stell suche such suchst text uber und uns vom von vor was welche welcher welchen welches wem wen wenn wer wie wird wir wo zum zur zu thema themen bezug bezuglich find finde findet finden finr frage fragen suchwort zeig zeige zeigt rund steht geschrieben laut nennung passende passenden passendes relevant heraus daruber dazu drin denn man handelt handeln sagt erwahnt
    ara arar arama bana ben benim bir bize bu bul bulabilir bulabilirsin misin misiniz bulan bulmak bulun bulur bunun dair de da diye gecer geciyor gecen gectigi getir goster gosterir gosterir misiniz hakkinda hakkindaki hangisi hangi icin ile ilgili iliskin kadar kac kerim kelime konu konulu konusu konusuna konusuyla kuran kurani kuraninda meal meali mushaf nasilda nasil nedir ne nerede neyle olur olan ornek sor sorar soru sayfa kaynaktan sure suresi suresinde tane var ver verir ve yaz yazan yaziyor yer yuzunden gecmistir lutfen kur i n in dan den tan ten
    nennen zeigen heisst alakali bulabilirsen bulunmaktadir diyor getirir getirebilir getirebilirsin gonderir gonderebilir gonderebilirsin gosterebilir gosterebilirsin konusunda konusundaki listeler listeleyebilir listeleyebilirsin mi mu midir mudur musun musunuz miyim muyum miyiz muyuz onerir onerebilir onerebilirsin paylasir paylasabilir paylasabilirsin soyle soyler soyleyebilir soyleyebilirsin verebilir verebilirsin yazar yazabilir yazabilirsin ornegi ornegini
    عن ما ماذا من في القران القرآن بالمصحف حول اريد ايتني اريد اعثر ابحث ابحثلي اعطني هات هل لي على اي التي الذي ورد ذكرت اذكر اذكرلي كريم الشريف سوره كلمات موضوع بخصوص الايه الايات مع بعد قبل او كيف اين هي هو لنا او اعطيني ارني شاهد
    koran quran qur an qurani mushafi ubersetzung koranubersetzung korantext koranausgabe sure surah kerim pdf
  `.trim().split(/\s+/u).map(normalize));

  function normalize(value) {
    return value.normalize('NFKD').toLowerCase()
      .replace(/[\p{M}\u0640\u200c\u200d]/gu, '')
      .replaceAll('ı', 'i').replaceAll('ß', 'ss')
      .replace(/[ىی]/gu, 'ي').replace(/ک/gu, 'ك').replace(/ٱ/gu, 'ا').replace(/ة/gu, 'ه')
      .replace(/[٠-٩۰-۹]/gu, digit => String(digit.codePointAt(0) & 15));
  }

  // Equivalents guide local retrieval. The returned quote always comes from the supplied source.
  const equivalents = [
    'namaz salat salah salahh ritualgebet pflichtgebet gebet beten betet الصلاة صلاه صلوه الصلوه صلوات',
    'oruc savm siyam fasten fastet fastenzeit صوم صيام',
    'zekat zakat pflichtabgabe almose almosen زكاه زكوة',
    'sabir geduld geduldig sabret sabreden صبر صابرين اصبر',
    'adalet adil gerechtigkeit gerecht عدل قسط',
    'rahmet merhamet barmherzigkeit barmherzig erbarmen رحمه رحيم',
    'sukur dankbarkeit dankbar dankt sukret شكر تشكرون',
    'bagislanma vergebung vergib vergibt magfiret istigfar مغفره استغفر',
    'gunah sunde sunden sundigen sundigt ذنب ذنوب اثم اثام',
    'sadaka spende spenden sadaka صدقه صدقات',
    'hac hadsch pilgerfahrt hajj حج',
    'cennet paradies جنه جنات',
    'ebeveyn eltern والدين'
  ];
  const aliases = new Map();
  for (const group of equivalents) {
    const [canonical, ...terms] = group.split(' ').map(normalize);
    for (const word of [canonical, ...terms]) aliases.set(word, canonical);
  }
  const longestTerms = [...aliases.keys()].filter(term => /^[a-z]{4,}$/u.test(term)).sort((a,b) => b.length - a.length);
  const queryTypos = new Map([
    ['nama', 'namaz'], ['nmaz', 'namaz'], ['namza', 'namaz'], ['gunh', 'gunah'],
    ['hakinda', 'hakkinda'], ['hakindaki', 'hakkindaki'],
  ]);

  function stem(word) {
    return word.replace(/^(?:[وفبك]?ال|[وف]?لل)(?=\p{Script=Arabic}{3,}$)/u, '');
  }

  function key(word) {
    const stripped = stem(word);
    const known = aliases.get(word) || aliases.get(stripped);
    if (known) return known;
    if (!/^[a-z]{5,}$/u.test(word)) return stripped;
    const base = longestTerms.find(term => word.startsWith(term) && wordEnd.test(word.slice(term.length)));
    return base ? aliases.get(base) : stripped;
  }

  function isSource(title) {
    if (typeof title !== 'string') return false;
    const name = normalize(title);
    return (quranName.test(name) || /(?:^|[^\p{L}])kelime[\s_-]+meali?(?!\p{L})/u.test(name)) && !otherSource.test(name);
  }

  function inspect(question, {inQuran = false} = {}) {
    if (typeof question !== 'string') return null;
    const value = normalize(question.slice(0, 500));
    const tokens = [...value.matchAll(words)].map(([word]) => queryTypos.get(word) ?? word);
    const hasVerseName = tokens.some(word => verseName.test(word));
    const requested = quranName.test(value) || (hasVerseName && !otherVerse.test(value));
    if (!inQuran && !requested) return null;
    const ref = value.match(/(?:^|[^\p{L}\d])(\d{1,3})\s*[:/：]\s*(\d{1,3})(?!\d)/u);
    const surah = Number(ref?.[1]);
    const ayah = Number(ref?.[2]);
    const reference = surah >= 1 && surah <= 114 && ayah >= 1 && ayah <= 286 ? {surah, ayah} : null;
    const terms = tokens.filter(word => !stop.has(word) && !verseName.test(word)
      && !(hasVerseName && verseHonorific.test(word)) && /\p{L}{2,}/u.test(word));
    return {topic:[...new Set(terms.map(key))].slice(0, 12).join(' '), reference};
  }

  function findVerses(question, verses) {
    if (!Array.isArray(verses)) return [];
    const query = typeof question === 'string' ? inspect(question, {inQuran:true}) : question;
    if (!query) return [];
    const {topic, reference} = query;
    const ref = reference ? `${reference.surah}:${reference.ayah}` : null;
    const terms = topic.split(' ').filter(Boolean);
    if (!ref && !terms.length) return [];
    const candidates = [];
    for (const entry of verses) {
      if (typeof entry?.text !== 'string' || !entry.text.trim()) continue;
      if (ref) {
        if (entry.verse === ref) candidates.push({entry, score:0});
        continue;
      }
      const hits = new Set();
      let first = null;
      for (const token of entry.text.matchAll(words)) {
        const word = key(normalize(token[0]));
        const term = terms.find(term => term === word || (term.length >= 4 && word.startsWith(term) && wordEnd.test(word.slice(term.length))));
        if (!term) continue;
        hits.add(term);
        first ??= token.index;
      }
      if (hits.size < Math.ceil(terms.length * .7)) continue;
      const text = entry.verse ? entry.text : excerpt(entry.text, first);
      candidates.push({entry:{...entry,text}, score:hits.size * 2 + (entry.verse ? 1 : 0)});
    }
    candidates.sort((a,b) => b.score - a.score);
    const found = [];
    const seen = new Set();
    for (const {entry} of candidates) {
      const identity = entry.verse || normalize(entry.text).replace(/\s+/gu, ' ');
      if (seen.has(identity)) continue;
      seen.add(identity);
      found.push(entry);
      if (found.length === maxPassages) break;
    }
    return found;
  }

  function excerpt(text, position) {
    const maxLength = 440;
    if (text.length <= maxLength) return text;
    const start = Math.max(0, position - 120);
    const window = text.slice(start, start + maxLength);
    const left = start > 0 ? window.search(/\s/u) + 1 : 0;
    const last = window.search(/\s\S*$/u);
    const right = start + maxLength < text.length && last > position - start ? last : window.length;
    return window.slice(left, right).trim();
  }

  function find(question, pages) {
    if (!Array.isArray(pages)) return [];
    return findVerses(question, pages.flatMap(page => {
      if (typeof page?.text !== 'string' || page.verse || page.ocr) return [page];
      // Leading chapter:verse markers are stronger evidence than inline cross-references.
      const markers = [...page.text.matchAll(/^[\t ]*[\[(]?(\d{1,3}|[٠-٩۰-۹]{1,3})[\t ]*[:：][\t ]*(\d{1,3}|[٠-٩۰-۹]{1,3})(?:[\])])?\.?[\t ]+(?=\S)/gmu)];
      if (!markers.length) return [page];
      const rows = [];
      const introduction = page.text.slice(0, markers[0].index).trim();
      if (introduction) rows.push({...page, text:introduction});
      markers.forEach((marker, index) => {
        const surah = Number(normalize(marker[1]));
        const ayah = Number(normalize(marker[2]));
        const verse = surah >= 1 && surah <= 114 && ayah >= 1 && ayah <= 286 ? `${surah}:${ayah}` : undefined;
        const text = page.text.slice(marker.index + marker[0].length, markers[index + 1]?.index).trim();
        if (text) rows.push({...page, text, verse});
      });
      return rows;
    }));
  }

  globalThis.MenbaQuran = Object.freeze({isSource, inspect, find, findVerses});
})();
