# MENBA AI – Änderungsverlauf

## Beta 0.1.0 · Phase 1 · Release-Kandidat

### Neu · Yenilikler

- Entwicklungsplan, Bestandsaufnahme und ein wiederholbarer Browsertest für Quellenauswahl, Zugriff und Browserindex.

### Verbesserungen · İyileştirmeler

- MENBA überprüft bei jeder Suche den aktuellen Zugriff auf ausgewählte private PDFs. Bei gültiger Freigabe wird der lesbare Browserindex wiederverwendet.
- Im Test Merkezi kann ein Fehler bei der Autorisierung von PDF-Dateien als solcher eingeordnet werden.

### Behobene Fehler · Düzeltilen Hatalar

- Ein privates PDF konnte nach einer verweigerten Freigabe weiter als Beleg aus dem Browserindex erscheinen. MENBA blendet die betroffenen Fundstellen jetzt aus.
- Nach einer geänderten Auswahl konnte ein bereits gesetztes Cloud-Häkchen für andere Quellen gelten. Einzel- und Sammelauswahl setzen die Zustimmung zurück.

### Bekannte Probleme · Bilinen Sorunlar

- Gescannte PDFs benötigen lokale OCR und einen Abgleich mit der Originalseite. Der verifizierte Seitenbeleg zu „Namazın farzları“ im privaten İlmihal steht noch aus.
- Der lokale Wortabgleich deckt ausgewählte deutsch-türkisch-arabische Begriffe ab. Suchqualität hängt von Text, Formulierung und Dokument ab.
- Status und Verarbeitung sind tabbezogen. Eine Verarbeitung ganzer Scanbücher und eine kontoübergreifende Fortschrittsanzeige gehören zu späteren Entwicklungsschritten.

## Veröffentlichter Ausgangsstand

- Quellenbasierter Chat mit optionaler Cloud-Antwort, Admin-Kontingenten und Test Merkezi.
- Fragevorlagen, erste Lernfunktionen sowie Hoca und Talebe als Beta verfügbar.
- Suchkorrektur für „Namazın farzları“ mit Vorrang für belegte Abschnitte eines ausgewählten İlmihal. OCR-Fundstellen können mit der Original-PDF-Seite verglichen werden. [Veröffentlichter Ausgangsstand](https://github.com/talhakazan02-design/kzn-sd-dar-al-ilm/pull/24)
