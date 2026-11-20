(() => {
  'use strict';

  const modes = {menba:'MENBA Anlatım',simple:'Sade Anlatım',guided:'Rehberli Anlatım',scholarly:'İlmî Anlatım'};
  const depths = {brief:'Öz',balanced:'İzah',detail:'Tafsil',deep:'Derin Tetkik'};
  const profiles = {
    brief:{sources:2,characters:1000,tokens:480},
    balanced:{sources:3,characters:2300,tokens:900},
    detail:{sources:5,characters:4000,tokens:1500},
    deep:{sources:6,characters:6000,tokens:2200}
  };
  const standard = {sources:3,characters:1550,tokens:680};
  const guided = {sources:3,characters:1050,tokens:480};
  const profile = (mode,depth) => mode === 'scholarly' ? profiles[depth] : mode === 'guided' ? guided : standard;
  const state = () => ({manual:{},depth:'balanced',misses:0,step:1});
  const defaultMode = area => area === 'talebe' ? 'simple' : 'menba';
  const choices = area => area === 'hoca' ? ['menba','scholarly'] : area === 'talebe' ? ['simple','guided'] : ['menba'];
  const activeMode = (area,session) => session.manual[area] ?? (area === 'talebe' && session.misses >= 2 ? 'guided' : defaultMode(area));

  function signal(text) {
    const input = text.normalize('NFKD').toLowerCase().replace(/\p{M}/gu,'').replaceAll('ı','i').replace(/[^\p{L}\s]/gu,' ').replace(/\s+/gu,' ').trim();
    if (/^(?:(?:hocam|uzgunum|sorry|hayir|maalesef|leider|ben|ich) )?(?:(?:yine|hala|hic|pek|tam|bunu|konuyu) ){0,3}(?:anlamadim|anlamiyorum|anlayamadim)(?: hocam)?$/u.test(input)
      || /^(?:ich )?(?:verstehe|versteh|habe|hab)(?: (?:es|das|immer|noch|leider)){0,5} nicht(?: ganz)?(?: verstanden)?$/u.test(input)
      || /^(?:kannst du (?:es|das)(?: mir)? (?:anders|einfacher) erklaren|(?:bunu )?(?:daha )?(?:basit|farkli) (?:anlat|anlatir misin)|daha kolay aciklar misin)$/u.test(input)) return 'confused';
    if (/^(?:(?:evet|simdi|tamam|hocam) )*(?:anladim|anliyorum)(?: hocam)?$|^(?:(?:ja|jetzt|ich|habe|hab|es|das) ){0,6}verstanden$|^jetzt verstehe ich (?:es|das)$/u.test(input)) return 'understood';
    if (/^(?:nachster schritt|weiter zum nachsten schritt|sonraki adim|bir sonraki adim)$/u.test(input)) return 'next';
    return null;
  }

  function advance(session,event) {
    if (event === 'confused') return {...session,misses:Math.min(session.misses+1,2)};
    if (event === 'next' && activeMode('talebe',session) === 'guided') return {...session,step:Math.min(session.step+1,4)};
    return {...session,misses:0,step:1};
  }

  globalThis.MenbaExplanations = Object.freeze({modes,depths,profile,state,choices,activeMode,signal,advance});
})();
