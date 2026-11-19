(() => {
  'use strict';

  const tasks = {
    talebe: [
      ['explain','Thema erklären','Konuyu açıkla'],
      ['simple','Einfacher erklären','Daha basit anlat'],
      ['review','Thema wiederholen','Konuyu tekrar et'],
      ['quiz','Selbsttest mit Quellen','Kaynaklı test'],
      ['exercise','Übungen zur Buchstelle','Metne dayalı alıştırmalar']
    ],
    hoca: [
      ['lesson','Unterrichtsentwurf','Ders taslağı'],
      ['summary','Lesestellen zusammenstellen','Okuma bölümlerini derle'],
      ['homework','Hausaufgabe vorbereiten','Ödev hazırla'],
      ['quiz','Quiz vorbereiten','Test hazırla']
    ]
  };
  const guides = {
    simple:[
      ['Lies zuerst die passende Stelle. Formuliere den Hauptsatz in deinen eigenen Worten. Welche zwei Wörter brauchst du dafür?', 'Önce ilgili bölümü oku. Ana cümleyi kendi sözlerinle anlat. Bunun için hangi iki kelimeyi bilmen gerekiyor?']
    ],
    review:[
      ['Erkläre das Thema aus dem Gedächtnis in zwei Sätzen.', 'Konuyu kitaba bakmadan iki cümleyle anlat.'],
      ['Vergleiche deine Erklärung mit den Fundstellen. Ergänze einen fehlenden Punkt mit der zugehörigen Seite.', 'Açıklamanı kaynaklarla karşılaştır. Eksik bir noktayı sayfa numarasıyla ekle.']
    ],
    exercise:[
      ['Unterstreiche den Satz, der am besten zur Frage passt. Erkläre, warum.', 'Soruya en uygun cümlenin altını çiz ve nedenini açıkla.'],
      ['Schreibe eine eigene Verständnisfrage und beantworte sie mit einem Hinweis auf die Fundstelle.', 'Bir anlama sorusu yaz ve kaynak bölümünü göstererek cevapla.']
    ],
    lesson:[
      ['Einstieg: Sammle das Vorwissen zum Thema und kläre zwei Schlüsselbegriffe.', 'Giriş: Konuyla ilgili ön bilgileri ve iki anahtar kavramı belirle.'],
      ['Erarbeitung: Lies die Fundstellen in der angegebenen Reihenfolge. Lass die Lernenden den Kerngedanken jeder Stelle formulieren.', 'İşleyiş: Kaynak bölümlerini sırasıyla okuyun. Öğrenciler her bölümün ana fikrini kendi sözleriyle anlatsın.'],
      ['Abschluss: Jede Person nennt einen belegten Satz und die zugehörige Seite.', 'Kapanış: Her öğrenci bir bulguyu sayfa numarasıyla ifade etsin.']
    ],
    summary:[
      ['Die folgenden Lesestellen sind ein Entwurf für die Zusammenfassung. Prüfe Kernaussage und Kontext auf den Originalseiten.', 'Aşağıdaki okuma bölümleri özet için taslaktır. Ana fikri ve bağlamı özgün sayfalardan kontrol et.']
    ],
    homework:[
      ['Lies die angegebenen Seiten und schreibe pro Stelle einen Satz zur Leitfrage.', 'Belirtilen sayfaları oku ve her bölüm için konuya dair bir cümle yaz.'],
      ['Formuliere eine offene Frage für die nächste Stunde und notiere Buch und Seite.', 'Bir sonraki ders için açık bir soru yaz, kitap ve sayfayı belirt.']
    ]
  };

  function cloze(text) {
    const clean = text.replace(/\s+/gu,' ').trim();
    const sentence = clean.match(/[^.!?؟]{24,180}[.!?؟]/u)?.[0].trim() || clean.slice(0,180).trim();
    const terms = [...sentence.matchAll(/[\p{L}\p{M}]{5,}/gu)];
    const word = terms.reduce((best, next) => !best || next[0].length > best[0].length ? next : best, null);
    return word ? {
      prompt:sentence.slice(0,word.index)+' ______ '+sentence.slice(word.index+word[0].length),
      answer:word[0]
    } : null;
  }

  function prepare(mode, task, evidence) {
    const entry = tasks[mode]?.find(([key]) => key === task);
    if (!entry || task === 'explain' || !evidence.length) return null;
    const quiz = task === 'quiz' ? evidence.map(row => cloze(row.text)) : null;
    if (quiz && !quiz.some(Boolean)) return null;
    return {title:entry.slice(1),draft:mode === 'hoca',steps:guides[task] ?? [],quiz};
  }

  globalThis.MenbaLearning = Object.freeze({tasks,prepare});
})();
