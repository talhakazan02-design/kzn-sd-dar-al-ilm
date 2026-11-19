(() => {
  'use strict';

  const mealMarker = /^(\d{1,3})(?:\s*[-–]\s*(\d{1,3}))?\.$/u;
  const arabicMarker = /^\(\s*(\d{1,3})\s*\)$/u;
  const sameLine = (left, right) => Math.abs(left - right) < 0.7;

  function readMeal(parts) {
    return parts.join('\n').replace(/[\u0000-\u0009\u000b-\u001f]/gu, '')
      .replace(/Iǚ/gu, 'İ').replace(/Oǆ/gu, 'Ö').replace(/Uǆ/gu, 'Ü').replace(/ϐ/gu, 'f')
      .replace(/(\p{L})-\s*\n\s*(\p{Ll})/gu, '$1$2').replace(/\s+/gu, ' ').trim();
  }

  function originalRanges(items, verse) {
    const ends = items.filter(item => item.height >= 11 && arabicMarker.test(item.text));
    const last = ends.filter(item => Number(item.text.match(arabicMarker)[1]) === verse);
    const prior = ends.filter(item => Number(item.text.match(arabicMarker)[1]) === verse - 1);
    if (last.length !== 1 || prior.length !== 1) return null;
    const [start] = prior;
    const [end] = last;
    if (start.y < end.y || (sameLine(start.y, end.y) && start.x <= end.x)) return null;

    const content = items.filter(item => item.height >= 11 && item.width > 0 && !arabicMarker.test(item.text)
      && item.y <= start.y + 0.5 && item.y >= end.y - 0.5
      && (!sameLine(item.y, start.y) || item.x + item.width <= start.x + 0.5)
      && (!sameLine(item.y, end.y) || item.x >= end.x + end.width - 0.5));
    if (!content.length) return null;

    const lines = [];
    for (const item of content.sort((a, b) => b.y - a.y)) {
      const line = lines.at(-1);
      if (line && sameLine(line.y, item.y)) {
        line.left = Math.min(line.left, item.x);
        line.right = Math.max(line.right, item.x + item.width);
      } else {
        lines.push({y:item.y, left:item.x, right:item.x + item.width});
      }
    }
    return lines.length <= 20 ? lines.map(({left,right,y}) => [left-1.5, y-4, right+1.5, y+14]) : null;
  }

  function parse(items, page) {
    const words = items.filter(item => item.str?.trim()).map(item => ({
      text:item.str.normalize('NFC').trim(), x:item.transform[4], y:item.transform[5],
      width:item.width, height:item.height, font:item.fontName,
    }));
    const header = words.find(item => item.y > 615 && /S[ûüu]re\s*:\s*\d+/iu.test(item.text));
    const chapter = Number(header?.text.match(/S[ûüu]re\s*:\s*(\d+)/iu)?.[1]);
    const compact = value => value.normalize('NFKD').replace(/[^\p{L}]/gu,'').toLocaleUpperCase('tr');
    const headingText = words.filter(item => header && item.font === header.font && sameLine(item.y,header.y))
      .sort((a,b) => a.x-b.x).map(item => item.text).join('');
    const numbers = words.filter(item => item.height >= 8 && item.height <= 10
      && item.y > 35 && item.y < 612 && mealMarker.test(item.text)).sort((a,b) => b.y-a.y || a.x-b.x);
    if (!numbers.length) return [];

    const headings = words.filter(item => item.height >= 8 && item.height <= 10
      && item.y > 35 && item.y < 612 && /S[ÛÜU]RES/u.test(item.text))
      .map(item => ({y:item.y, title:words.filter(part => part.font === item.font && sameLine(part.y,item.y))
        .sort((a,b) => a.x-b.x).map(part => part.text).join('').replace(/\s*S[ÛÜU]RES.*$/u, '').trim()}))
      .sort((a,b) => b.y-a.y);
    const knownFirst = /^(?:FÂT[İI]?HA|BAKARA)$/u.test(headings[0]?.title) && page <= 2 ? page : null;
    const original = words.filter(item => page <= 2 || (numbers[0].x < 230 ? item.x > 185 : item.x < 280));
    return numbers.flatMap((marker,index) => {
      const next = numbers[index+1];
      const [section] = headings.filter(item => item.y > marker.y).slice(-1);
      const numberedChapter = !headings.length || (section?.title && compact(headingText).includes(compact(section.title)))
        ? chapter : section === headings[0] ? knownFirst : null;
      const lowerHeading = headings.find(item => item.y < marker.y && item.y > (next?.y ?? 0));
      const floor = lowerHeading?.y ?? next?.y ?? 27;
      const textFont = words.find(item => sameLine(item.y,marker.y) && item.x >= marker.x+marker.width-.7
        && item.x <= marker.x+marker.width+18 && item.height >= 8 && item.height <= 10
        && /\p{Script=Latin}/u.test(item.text))?.font;
      if (!textFont) return [];

      const lines = words.filter(item => item.font === textFont && item.y > floor+0.5 && item.y <= marker.y+0.5
        && (page <= 2 ? item.x > 90 && item.x < 365 : marker.x < 230 ? item.x < 180 : item.x > 280))
        .sort((a,b) => b.y-a.y || a.x-b.x);
      const text = readMeal(lines.map(item => item.text));
      if (!text) return [];

      const [,first,last] = marker.text.match(mealMarker);
      const extra = words.find(item => sameLine(item.y,marker.y) && item.x < marker.x
        && item.x + item.width >= marker.x-3 && /^\d{1,3}\s*-$/u.test(item.text));
      const verseNumber = extra ? `${extra.text}${first}` : last ? `${first}-${last}` : first;
      const verse = numberedChapter ? `${numberedChapter}:${verseNumber}` : section?.title ? `${section.title} ${verseNumber}` : null;
      const ranges = verse && !verseNumber.includes('-') ? originalRanges(original, Number(first)) : null;
      return [{text, verse, ranges}];
    });
  }

  function isEdition(metadata) {
    return metadata?.info?.Title === 'Kelime Meal_01.indd';
  }

  globalThis.MenbaQuranEdition = Object.freeze({isEdition, parse});
})();
