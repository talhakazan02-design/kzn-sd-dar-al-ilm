(() => {
  'use strict';

  const questionFrame = new Set(`
    a ben bana bunu bu bir icin da de dini gore haram mi midir mu mudur mubah miymis mevzu ne neden nedir
    caiz helal sayilir sayiliyor sayilmis yemek yemesi yemem yememiz yenir yenmesi yenen
    kilmak kilmaliyim kilmakla tutmak tutmaliyim tutmakla farz mi lazim gerekir gerekiyor sart mi zorunlu
    gunah yasak hukmu kuran kuranda kurandan kerim islam islamda muslumanlara musluman icin nasil buyruluyor
    soyluyor soyler diyor der gecer geciyor hakkinda hakkindaki konusunda var mi istisna istisnasi istisnalar
    zorda zor zorunda zorunluluk durumda kalinca kalirsam kalirsa mecbur mecburiyet zaruret kalmak olursa
    hayati tehlike ac ac kalirsa yolculukta seferde seyahatte hasta hastalik ve veya ile olur olursa muaf
    aber auch als eigentlich allgemein antwort aus beim bekanntlich besagt darf darfs duerfen darfst durfen
    das dass dein deine dem den der des die du ein eine einen erlaubt erlauben es esse essen fressen verzehr
    verzehren fur gibt gilt gläubige glaubige gott halal haram heisst ich im in islam islamisch ist kann
    kommt laut lesen man mir mit moslem moslems muslim muslime muslimen muss mussen nach
    pflicht verpflichtend verboten verbot sunde tun und um uber uberhaupt was weil welche wenn wer
    weshalb wie wieso wirklich wird zu zum zur gebot geboten aussage koran quran sagt sage sagen
    befiehlt fordert verrichten steht geschrieben ausnahme ausnahmen ausnahmsweise an aus not notlage
    lebensgefahr darum leben tod gefahr gezwungen krank krankheit reisen reise unterwegs
    bin sonst nichts anderes hat haben werde geben geht noch nicht untersagt
    nein ja nur keine kein verpflichtung
  `.trim().split(/\s+/u));

  const topics = {
    pork: {query: 'domuz', subject: /\b(?:schwein(?:e|s|en)?(?:fleisch(?:es)?)?|domuz(?:u|un)?(?: et(?:i|ini|inin|inden|ine|le))?)\b/u},
    prayer: {query: 'namaz', subject: /\b(?:namaz(?:i|in|la)?|ritualgebet(?:s|e)?|gebet(?:s|e)?|bet(?:en|et|e)|salat)\b/u},
    fasting: {query: 'oruc', subject: /\b(?:oruc(?:u|un|la)?|oruc tutmak|fast(?:en|et|e))\b/u},
  };
  const askForm = /\b(?:ist|sind|gilt|darf|durfen|muss|mussen|haram|helal|halal|caiz|mubah|yasak|farz|pflicht|geboten|verpflichtend|untersagt|verboten|erlaubt|sag(?:t|e|en)|midir|mudur|mi|mu|gerekiyor|gerekir|nedir|hukmu|diyor|der|gecer|geciyor)\b/u;
  const exceptionForm = /\b(?:ausnahme(?:n)?|ausnahmsweise|notlage|lebensgefahr|leben und tod|gezwungen|not|nichts anderes|istisna(?:si|lar)?|zaruret|zor(?:da| durumda|unda)|mecbur(?:iyet)?|tehlike)\b/u;
  const fastingExceptionForm = /\b(?:krank|krankheit|reise|reisen|unterwegs|hasta|hastalik|yolculukta|seferde|seyahatte|muaf)\b/u;
  const sourceQuestion = /^(?:(?:und |aber )?(?:welche quelle(?: ist das)?|was ist (?:die|deine) quelle|welche stelle|wo steht das|wo im koran|welcher vers(?: sagt das)?|quelle)|(?:bunun )?(?:kaynagi(?: ne| nedir)?|kaynak|hangi ayet|bu nerede geciyor))$/u;

  function normalize(value) {
    return value.normalize('NFKD').toLowerCase().replace(/\p{M}/gu, '')
      .replaceAll('ı', 'i').replaceAll('ß','ss').replace(/[ىی]/gu,'ي').replace(/ک/gu,'ك')
      .replace(/[^\p{L}\p{N}]+/gu,' ').trim();
  }

  function fitsQuestion(value) {
    return value.split(/\s+/u).every(word => !word || questionFrame.has(word));
  }

  function inspect(question, previous = null) {
    if (typeof question !== 'string' || question.length > 500) return null;
    const value = normalize(question);
    const matches = Object.entries(topics).filter(([, rule]) => rule.subject.test(value));
    if (matches.length > 1) return null;
    const topic = matches[0]?.[0] ?? previous?.topic;
    if (!Object.hasOwn(topics, topic)) return null;
    const rule = topics[topic];
    if (!matches.length && sourceQuestion.test(value)) {
      const claim = previous.kind === 'exception' || previous.claim === 'exception' ? 'exception' : 'ruling';
      return {kind:'source', topic, query:rule.query, claim};
    }
    const remainder = value.replace(rule.subject, ' ').trim();
    if (!fitsQuestion(remainder)) return null;
    if (exceptionForm.test(value) || (topic === 'fasting' && fastingExceptionForm.test(value))) {
      return {kind:'exception', topic, query:rule.query};
    }
    if (matches.length && askForm.test(value)) return {kind:'ruling', topic, query:rule.query};
    return null;
  }

  const sourceDoubt = /\b(?:nicht|kein(?:e|en|er)?|behauptet|luge|frage|falsch|degil|iddia|sormak|sanilir|yalan)\b/u;
  const porkText = /(?:\b(?:domuz et(?:i|ini|inden|inin)|schweinefleisch(?:es)?|fleisch (?:vom schwein|des schweins))\b|لحم\s+(?:ال)?خنزير)/u;
  const prohibitionText = /(?:\b(?:haram ki(?:ldi|lindi|linmistir|lmistir)|yasak(?:ladi|landi|lanmistir)|verboten|untersagt|verwehrt|verbietet|verbot)\b|(?:حرمت\s+عليكم|حرم\s+عليكم))/u;
  const prayerText = /(?:\b(?:namazi|namazlari) (?:dosdogru |geregi gibi )?kilin\b|\bverrichtet (?:das |die )?(?:ritualgebet|gebet(?:e)?)\b|اقيموا\s+الصلو?ا?ة)/u;
  const fastingText = /(?:\b(?:oruc(?:u)?|fasten)\b|الصيام|تصوموا)/u;
  const dutyText = /(?:\b(?:farz kilin(?:di|mistir)|yazildi|vorgeschrieben|auferlegt)\b|كتب\s+عليكم)/u;

  function clauses(text) {
    const sentences = text.match(/[^.!?؛؟]+[.!?؛؟]?/gu) ?? [];
    return sentences.filter(sentence => !/[?؟]\s*$/u.test(sentence)).map(normalize);
  }

  function closePair(clause, term, predicate) {
    const a = term.exec(clause);
    const b = predicate.exec(clause);
    return Boolean(a && b && Math.abs(a.index - b.index) <= 220);
  }

  const inNeed = /(?:\b(?:mecbur kal(?:irsa|ana|an)|caresiz kal(?:irsa|ana|an)|zor(?:da| durumda|unlu) kal(?:irsa|ana|an)|zorunluluk|zaruret|notlage|zwangslage|gezwungen|in not)\b|من\s+اضطر)/u;
  const notSin = /(?:\b(?:gunah (?:yoktur|yok|olmaz|yukletilmez|degildir|sayilmaz)|yiyebilir|keine sunde)\b|لا\s+اثم)/u;
  const limitedNeed = /(?:\b(?:zaruret miktarini gecmemek|zorunlu miktari asmamak|haddi asmamak|siniri asmamak|das mass nicht zu uberschreiten|nicht das mass uberschreitet|ohne.{0,90}das mass zu uberschreiten)\b|غير\s+باغ\s+ولا\s+عاد)/u;
  const otherRights = /\b(?:baskasinin hakkina tecavuz etmemek|baska bir caresizin hakkini cignememek)\b/u;
  const ill = /(?:\b(?:hasta|hastaysa|krank)\b|مريضا)/u;
  const travel = /(?:\b(?:yolculukta|yolculuk|seferde|reise|unterwegs)\b|على\s+سفر)/u;
  const defer = /(?:\b(?:(?:baska|diger|sonraki) gunlerde[n]?|sayinca baska gun|an anderen tagen|anderen tagen nach(?:holen|geholt))\b|فعدة\s+من\s+ايام\s+اخر)/u;
  const makeUp = /(?:\b(?:tutar|kaza etsin|tamamlar|tamamlayabilir|nach(?:holen|holt|geholt))\b|فعدة\s+من\s+ايام\s+اخر)/u;

  function prove(topic, kind, text) {
    const clean = normalize(text);
    const direct = clauses(text).filter(clause => !sourceDoubt.test(clause));
    switch (topic) {
      case 'pork': {
        const ruling = direct.some(clause => closePair(clause, porkText, prohibitionText));
        const exception = ruling && inNeed.test(clean) && limitedNeed.test(clean) && notSin.test(clean);
        return {supported:kind === 'exception' ? exception : ruling, exception, rights:exception && otherRights.test(clean)};
      }
      case 'prayer':
        return {supported:kind !== 'exception' && direct.some(clause => prayerText.test(clause))};
      case 'fasting':
        return {supported:kind === 'exception'
          ? fastingText.test(clean) && clauses(text).some(clause => ill.test(clause) && travel.test(clause) && defer.test(clause) && makeUp.test(clause))
          : direct.some(clause => closePair(clause, fastingText, dutyText))};
      default:
        return {supported:false};
    }
  }

  function validReference(row) {
    if (!row || row.ocr === true || typeof row.text !== 'string' || typeof row.source !== 'string' || !row.source.trim()) return false;
    if (!Number.isSafeInteger(row.page) || row.page < 1 || typeof row.verse !== 'string') return false;
    const parsed = /^(\d{1,3}):(\d{1,3})$/u.exec(row.verse.trim());
    if (!parsed) return false;
    const [,chapter,verse] = parsed.map(Number);
    return chapter > 0 && chapter <= 114 && verse > 0 && verse <= 286;
  }

  function response(topic, kind, proof, language) {
    const tr = language === 'tr';
    if (kind === 'source') return tr ? 'Dayanak, bu yanıta eklenen ayettir.' : 'Die Grundlage ist die unten angegebene Koranstelle.';
    if (topic === 'pork') {
      if (kind !== 'exception') {
        const main = tr ? 'Bu ayet, domuz etini yemeyi yasaklıyor.' : 'Die Stelle verbietet, Schweinefleisch zu essen.';
        const exception = tr ? ' Zorunlu bir durum için sınırlı bir istisna da belirtiliyor.' : ' Für eine Zwangslage nennt sie eine begrenzte Ausnahme.';
        return main + (proof.exception ? exception : '');
      }
      const main = tr ? 'Zor durumda kalan kişi için ayette bir istisna var. İzin, belirtilen sınırı aşmama şartına bağlı.'
        : 'Die Stelle nennt eine Ausnahme für eine Zwangslage. Sie gilt unter der Bedingung, das genannte Maß einzuhalten.';
      const rights = tr ? ' Başkasının hakkı da gözetilmeli.' : ' Auch die Rechte anderer müssen gewahrt bleiben.';
      return main + (proof.rights ? rights : '');
    }
    if (topic === 'prayer') return tr ? 'Ayet, namaz kılmayı emrediyor.' : 'Die Stelle fordert dazu auf, das Gebet zu verrichten.';
    if (kind === 'exception') return tr ? 'Bu ayete göre hasta olan veya yolculukta bulunan kişi, oruç tutamadığı günleri başka günlerde tamamlayabilir.'
      : 'Die Stelle nennt Krankheit und Reisen als Fälle, in denen die Fastentage an anderen Tagen nachgeholt werden.';
    return tr ? 'Bu ayet, inananlara oruç tutmanın farz kılındığını bildiriyor.' : 'Die Stelle beschreibt das Fasten als Pflicht für die Gläubigen.';
  }

  function compose(intent, evidence, language = 'de') {
    if (!intent || !Array.isArray(evidence) || !Object.hasOwn(topics, intent.topic)) return null;
    if (!['ruling', 'exception', 'source'].includes(intent.kind)) return null;
    for (const [index, row] of evidence.entries()) {
      if (!validReference(row)) continue;
      const claim = intent.kind === 'source' ? intent.claim ?? 'ruling' : intent.kind;
      const proof = prove(intent.topic, claim, row.text);
      if (proof.supported) return {text:response(intent.topic, intent.kind, proof, language), citations:[index + 1]};
    }
    return null;
  }

  globalThis.MenbaAnswers = Object.freeze({inspect, compose});
})();
