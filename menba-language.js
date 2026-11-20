(() => {
  'use strict';

  const explicit = {
    en:/\b(?:in english|auf englisch|ingilizce(?: olarak)?)\b|بالانجليزية/u,
    de:/\b(?:in german|auf deutsch|almanca(?: olarak)?)\b|بالالمانية/u,
    tr:/\b(?:in turkish|auf turkisch|turkce(?: olarak)?)\b|بالتركية/u,
    ar:/\b(?:in arabic|auf arabisch|arapca(?: olarak)?)\b|بالعربية/u
  };
  const indicators = {
    de:/\b(?:ist|sind|warum|wo|welche[rsnm]?|kannst|darf|darfst|muss|mussen|was|erklare|nenne|zeige|suche|wie|nicht|bitte|schweinefleisch)\b/gu,
    tr:/\b(?:nedir|nelerdir|neden|niye|nasil|peki|hangi|midir|mi|mu|musun|misin|hakkinda|hakkindaki|bana|bir|goster|anlat|anlamadim|anladim|acikla|aciklar|ayeti|kerime|farzlari)\b/gu,
    en:/\b(?:is|are|can|could|would|should|must|does|do|what|why|how|which|where|please|tell|explain|show|find|give|about|the|this|prayer|fasting|pork|ablution|understood|understand|next)\b/gu
  };

  function detect(question,preferred='',fallback='de') {
    if (Object.hasOwn(explicit,preferred)) return preferred;
    const raw = question.slice(0,500);
    const text = raw.normalize('NFKD').toLowerCase().replace(/\p{M}/gu,'').replaceAll('ı','i');
    for (const [language,pattern] of Object.entries(explicit)) {
      if (pattern.test(text)) return language;
    }
    const ranks = Object.entries(indicators).map(([language,pattern])=>[language,[...text.matchAll(pattern)].length]);
    ranks.find(([language])=>language==='tr')[1] += /[çğıöşüİ]/u.test(raw) ? 1 : 0;
    ranks.push(['ar',(raw.match(/\p{Script=Arabic}/gu)?.length ?? 0) >= 5 ? 2 : 0]);
    ranks.sort((a,b)=>b[1]-a[1]);
    return ranks[0][1] > ranks[1][1] ? ranks[0][0] : fallback;
  }

  globalThis.MenbaLanguage = Object.freeze({detect});
})();
