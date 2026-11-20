# MENBA AI – Änderungsverlauf

## Beta 0.4.0 · Chat-Oberfläche und Hoca-Talebe-Erklärungen · Release-Kandidat

- MENBA Anlatım, Sade Anlatım, Rehberli Anlatım und İlmî Anlatım. Talebeler können Schritt für Schritt weitergehen. Hocalar wählen Öz, İzah, Tafsil oder Derin Tetkik.
- „Sohbet Hazırla“ übernimmt Thema, Dauer, Zielgruppe, Vertiefung und ausgewählte Quellen. Der Chat kennzeichnet fertige Entwürfe zur Prüfung durch den Hoca. Bei geringer Quellenabdeckung bleiben die belegten Fundstellen verfügbar.
- Auf breiten Bildschirmen stehen Sitzungsverlauf und Vorlagen links, der Chat in der Mitte und die Quellenauswahl rechts. Auf kleinen Bildschirmen sind die Menüs einklappbar. Quellensuche, Filter für ausgewählte Bücher, Startaktionen und kontextbezogene Rückfragen sind auf Deutsch und Türkisch verfügbar.
- Die formulierte Erklärung steht vor den Quellen. MENBA zeigt Buch, vorhandenen Dateinamen, PDF-Seite und geprüften Auszug. Die Originalseite lässt sich bei vorhandener PDF direkt aus der Fundstelle öffnen. Neu verarbeitete PDFs behalten zusammenhängende Wörter bei eng benachbarten PDF-Textfragmenten. Für Scanquellen führt die leere Trefferansicht direkt zur lokalen Texterkennung.
- Der Worker verwendet weiter Gemma 4. Pro Anfrage sind höchstens zwei Modellaufrufe vorgesehen, einer zum Formulieren und einer zur Belegprüfung. Bis zu sechs Auszüge und 2.200 Ausgabetokens bei Derin Tetkik. Die Verbrauchsschätzung wird mit den von Cloudflare gemeldeten Tokenzahlen abgerechnet, sofern diese verfügbar sind.
- Getestet mit Chrome auf PC und Smartphone, lokaler Worker- und Supabase-Prüfung, echten DE/TR-Fragen in der bereitgestellten Koran-PDF und lokaler OCR in den bereitgestellten Hadis- und İlmihal-Dateien. „Namazın farzları“ und „Namazın içindeki farzlar nelerdir?“ lieferten PDF-Seite 54 im *Resimli Muhtasar İlmihal*. Der Treffer wurde mit der Originalseite verglichen. Die simulierten Worker-Antworten prüfen Abläufe, Belegbindung und Limits. Der produktive Worker wurde für diese Version noch nicht bereitgestellt.

## Beta 0.3.0 · Phase 2 · Release-Kandidat

### Neu · Yenilikler

- Freigeschaltete Mitglieder können private Fragevorlagen anlegen, bearbeiten, duplizieren und nach Bestätigung löschen. Titel, Kategorie, Fragetext und eine optionale Beschreibung gehören zu jeder Vorlage.
- `[BUCH]`, `[THEMA]` und andere Platzhalter erzeugen auffüllbare Felder. Wiederholte Platzhalter verwenden denselben Wert. Der ausgefüllte Text kann vor dem Senden im Chat bearbeitet werden.
- Gespeicherte Vorlagen lassen sich nach Text, Kategorie und Favoriten filtern. Der Hauptadmin kann zentrale Vorlagen anlegen. Favoriten werden je Konto gespeichert.
- „Vorlage testen“ führt eine ausgefüllte Frage mit der aktuellen Quellenauswahl lokal durch den bestehenden Chat. Das Ergebnis zeigt die regulären Fundstellen und den Antwortstatus. Ein dauerhafter Testnachweis pro Vorlage gehört zu Phase 4.

### Supabase-Aktivierung

`MENBA-TEMPLATES.sql` ergänzt zwei Tabellen und eigene Zugriffsregeln für Vorlagen und Favoriten. Die Regeln verwenden die bereits vorhandene Funktion `library_menba_access()`. Die Migration läuft in einer Transaktion und betrifft die neuen Tabellen. Zum Freischalten in der Live-Bibliothek braucht es die Migration im bestehenden Supabase-Projekt und die Veröffentlichung dieses Zweigs. Bis dahin zeigt der neue Bereich bei fehlendem Schema einen Einrichtungshinweis.

`node tests/check-menba-admin-db.cjs` prüft die Supabase-Regeln mit PGlite. `node tests/check-menba-source-session.cjs` prüft die Vorlagenaktionen im Browser mit Testkonten. Beide Prüfungen verwenden isolierte Testdaten.

## Beta 0.2.1 · Phase 1 des Zuverlässigkeitsupdates · Release-Kandidat

### Behobene Fehler · Düzeltilen Hatalar

- Ein ausdrücklich genanntes und ausgewähltes Buch bestimmt den Suchbereich. Die automatische Erkennung von Koranfragen oder Hadis-Fragen verdrängt es nicht mehr.
- Die Suche nach einem Wortlaut verlangt eine zusammenhängende Textstelle. Getrennte Stichwörter führen nur noch in der normalen Stichwortsuche zu Treffern. Bei einem exakten Treffer in der Koran-Ausgabe bleibt der Ayet dem Auszug zugeordnet.

### Verbesserungen · İyileştirmeler

- Der Admin-Testbereich prüft eine konkrete Frage anhand einer ausgewählten Quelle. Er zeigt Zugriff, Texterkennung, Index, Suchmethode, Fundstelle, mögliche Cloud-Übermittlung und Antwortprüfung.
- Die Diagnose nutzt den vorhandenen Index. „Quelle neu verarbeiten“ stößt die Verarbeitung ausdrücklich erneut an.
- Bei unvollständiger Suche unterscheidet die Oberfläche den lesbaren Teil, fehlenden Dateizugriff und fehlgeschlagene OCR. Eine unbestätigte Modellantwort hat einen eigenen Status.

### Bekannte Grenzen · Bilinen Sorunlar

- Buchscans brauchen OCR und eine Sichtprüfung. Ohne ausreichende Stelle erscheint keine belegte fachliche Antwort. Vorhandene lokale Fundstellen bleiben bei einer Störung des Cloud-Dienstes verfügbar.
- Die Versionsübersicht und der Diagnosebericht enthalten den geprüften Stand. Eigene Vorlagen sind für die nächste freizugebende Phase vorgesehen.

## Beta 0.2.0 · Phase 2 · Release-Kandidat

### Neu · Yenilikler

- Neue Unterhaltung aus der Chat-Kopfzeile beginnen. Die Quellenauswahl bleibt dabei verfügbar.
- Eine frühere Frage in der Eingabe bearbeiten, eine Antwort samt Belegen kopieren und einen Suchlauf erneut versuchen. Quizlösungen erscheinen weiterhin beim Aufklappen der jeweiligen Übung.

### Verbesserungen · İyileştirmeler

- Quellen und Fragevorlagen liegen auf breiten Bildschirmen neben dem Verlauf und auf schmalen Bildschirmen darüber. Der Verlauf hat einen eigenen Scrollbereich, die Frageeingabe und die Senden-Schaltfläche stehen am Ende.
- Jede Fundstelle zeigt Buch und Seite im sichtbaren Titel. Auszüge können einzeln aufgeklappt werden. Wenn der Auszug selbst die Antwort ist, erscheint er sofort.
- Die Zustimmung zur Cloud-Antwort erklärt auch den Kontext bei Rückfragen. Direktes Wiederholen startet lokal. Für eine neue Cloud-Antwort lässt sich die Frage bearbeiten und die Zustimmung erneut setzen.

### Geprüft

- Browserprüfung mit 390, 768 und 1.440 Pixeln Breite, deutscher und türkischer Oberfläche, Quellen, Vorlagen, Bearbeiten, Kopieren und Neustart. Quellenzugriff und Cloud-Zustimmung aus Phase 1 sind im selben Test enthalten.

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
