# MENBA Diagnose

## Reproduzierte Ursachen

- Formulierungen wie „Emsile konusunu açıkla“, „Erkläre Emsile auf Deutsch“ und „ما موضوع كتاب الأمثلة؟“ konnten trotz vorhandener Belegstelle leer bleiben. Der bisherige Suchfilter behandelte Fragefloskeln und Sprachangaben als Fachbegriffe. An einem kontrollierten Emsile-Auszug wurde das vor und nach der Änderung nachgestellt.
- „Maksud kitabında fiiller nasıl açıklanıyor?“ berücksichtigte den Buchtitel, suchte im Buchtext jedoch nach mehreren Fragewörtern. Die Suche nutzte „fiiller“ außerdem noch nicht als Entsprechung für „Verben“ oder „الأفعال“.
- PDFs mit einzelnen technischen Lesefehlern führten auf spätere Fragen zu einem erneuten vollständigen Download. Teilindizes werden jetzt gespeichert. Ein technischer Wiederholungsversuch startet weiterhin eine neue Verarbeitung.
- Leere Seiten konnten den nächsten OCR-Durchlauf blockieren. Beim automatischen Weiterblättern überspringt MENBA Seiten, auf denen es in dieser Sitzung schon nach Text gesucht hat. Ein manuell gewählter Seitenbereich kann erneut verarbeitet werden.
- Ein Bildscan braucht OCR. PDF.js allein lieferte für die bereitgestellte Hadis-PDF keine Textebene. Der Testbericht unterscheidet Dateizugriff, PDF-Text, OCR und durchsuchbaren Index.
- Der Cloud-Endpunkt ist auf der veröffentlichten Seite leer. Freie Modellantworten und zentrale Cloud-Logs sind damit derzeit nicht verfügbar. Lokale Auszüge und die vorhandenen belegten Kurzantworten sind unabhängig davon.

## Verarbeitung und Zugriff

MENBA liest eigene Bücher und freigegebene gemeinsame PDFs über das vorhandene Supabase-Storage. Die gemeinsame Freigabe wird vor jedem Suchlauf erneut geprüft. Der Dokumentindex liegt für eigene und ausdrücklich geöffnete lokale Dateien kontobezogen in IndexedDB. Gemeinsame PDFs werden sitzungsbezogen verarbeitet. Die Suche läuft im Browser mit Volltext, sprachübergreifenden Begriffen und den vorhandenen Koran-Ausgaben. Es gibt keinen Supabase-Volltextindex und keine Vektorsuche.

MENBA Test Merkezi prüft die Hauptadmin-Rolle per Supabase vor jeder Diagnose. Ein Lauf verwendet jeweils eine ausdrücklich ausgewählte Quelle. Die OCR-Probe liest eine fehlende Seite. Die Seitenzahl ist optional und MENBA bevorzugt automatisch eine Seite im Buchinneren. Die Tests verwenden die Produktionssuche und die lokale Antwortprüfung. Originaldateien bleiben erhalten. Ein verifizierter Teststatus gilt für die aktuelle Auswahl und den aktuellen Index.

## Prüfungen

- `node tests/check-menba-question-checks.cjs` prüft Fragevarianten DE/TR/AR, ausgewählte Bücher, korrekte Seiten und Titel, wortgetreue Auszüge und die Kennzeichnung von OCR.
- `node tests/check-menba-sources.cjs` prüft lokale Belege und den Zugriff auf freigegebene Quellen.
- Browserprüfung mit der bereitgestellten `@kuran-kelime-meali.pdf`. Im Test Merkezi bestanden sechs von 15 Fragen vollständig. Buch, Seite und Text wurden im Index abgeglichen.
- Die bereitgestellte `Hadisi Serfler.pdf` hat auf keiner der zwei Seiten eine PDF-Textebene. Die OCR erkannte Text auf beiden Seiten und speicherte ihn im Browser. Bei der erneuten Prüfung wurde zuerst ausdrücklich Seite 2 gewählt. Die automatische Folgeprobe fand anschließend Seite 1. OCR-Resultate benötigen vor einem bestätigten Antworttest den Abgleich mit der Originalseite.
- Zwei private Uploads wurden als Hauptadmin in der Live-Bibliothek geprüft. Bei beiden bestätigte Supabase den erlaubten Dateizugriff. Emsile hat eine von 24 Seiten mit Textebene. Sie enthält Verlagsangaben. Drei von zwölf Fragen führten technisch zu dieser Seite. Alle inhaltlichen Emsile-Fragen blieben offen. Maksud hat auf 64 Seiten keine Textebene. Die OCR-Probe erkannte Text auf Seite 1. Keine der zwölf Fragen bestand vollständig. Der Browser meldete bei beiden PDFs null PDF-Lesefehler. Damit ist fehlender direkt durchsuchbarer Buchinhalt für diese Uploads konkret belegt.
- Im jüngsten Stand werden erkannte Verlagsseiten bei automatisch vorgeschlagenen Fragen übersprungen. Teilweise indexierte PDFs erhalten im Testbericht den Status „Prüfung erforderlich“.

### Geprüfte Fragen zur Koran-PDF

| Frage | Ayet | PDF-Seite |
| --- | --- | --- |
| Ist Schweinefleisch essen haram? | 2:173 | 26 |
| Ist Fasten Pflicht? | 2:183 | 28 |
| Muss man das Gebet verrichten? | 2:43 | 7 |
| Koran 1:1 | 1:1 | 1 |
| Koran 1:2 | 1:2 | 1 |
| Koran 1:3 | 1:3 | 1 |

## Beta-Umfang

Talebe Modu unterstützt Wiederholung, Übungen, Lückentests und Markierungen innerhalb der Sitzung. Hoca Modu erstellt persönliche Unterrichtsentwürfe, Leselisten, Quiz und Hausaufgabenentwürfe aus gewählten Quellen. Schülerverwaltung, Abgaben und eine Veröffentlichung von Unterrichtsmaterial sind noch offen. Das Menü führt in dieselbe bestehende MENBA-Oberfläche und prüft weiter die Hoca-Rolle.
