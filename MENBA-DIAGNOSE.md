# MENBA Diagnose

## Phase 1 des neuen Auftrags zur Antwortqualität

### Reproduzierte Ursachen

| Situation | Verhalten der Beta 0.2.0 | Korrektur |
| --- | --- | --- |
| „Was steht in ‹Emsile› zum Thema Koran lesen?“ bei ausgewähltem Emsile und Koran | Der Suchplan enthielt nur die Koran-Quelle. | Der genannte Buchtitel wird zuerst mit der aktuellen Auswahl abgeglichen. Titel außerhalb der Auswahl führen zum Quellenhinweis. |
| Suche nach dem genauen Wortlaut „Sternlaterne Lesesaal“, wenn die Wörter getrennt vorkommen | Die Stichwortsuche lieferte einen Treffer, den die nachfolgende Antwortprüfung als Wortlaut verwarf. | Ein exakter Suchmodus setzt einen zusammenhängenden Treffer voraus. Unterschiedliche Leerzeichen oder Zeilenumbrüche gelten dabei als Trennung der Wörter. |
| Test oder Chat mit unvollständiger Verarbeitung | Fehlende Zugriffsrechte, nicht erkannter Text und unbelegte Modellantworten konnten zusammen mit einer allgemeinen Meldung erscheinen. | Fehlerstufen bleiben im Testbericht erkennbar. Im Chat wird auf den tatsächlich durchsuchten Teil und den betroffenen Verarbeitungsschritt hingewiesen. |

### Verarbeitung und Diagnosegrenzen

- Eigene und gemeinsame PDFs werden über den bestehenden Supabase-Zugriff autorisiert. Der Browser verarbeitet PDF-Text und OCR. Der Textindex liegt für eigene und lokal geöffnete Quellen in IndexedDB und für gemeinsame Quellen in der Sitzung. Supabase verwaltet den Zugriff und die Dateien.
- Die Suche kombiniert einen exakten Modus mit der vorhandenen Stichwort-, Volltext- und Ayet-Suche sowie bekannten Begriffen in Deutsch, Türkisch und Arabisch. Eine Anbindung an Vektorsuche ist für den aktuellen Fix nicht erforderlich.
- Der Admin-Test prüft eine ausgewählte Quelle. Er weist für eine konkrete Frage Suchbereich, Treffer, Belegprüfung und Status des Modellaufrufs aus. Ein freiwilliger Cloud-Test startet bei Bedarf einmal für die eingegebene Frage. Ungeprüfte OCR-Auszüge werden dafür ausgelassen. Ohne explizite Auswahl bleibt die Frage im Browser.
- Im bestehenden Worker ist `@cf/google/gemma-4-26b-a4b-it` konfiguriert. Die vorgeschaltete Anwendung begrenzt den Kontext auf bis zu drei kurze Auszüge. Der Worker prüft die Antwort gegen das Zitat. Der Adminbereich zeigt den aus dem Token-Verbrauch geschätzten MENBA-Verbrauch. Cloudflare dokumentiert eine kostenlose Zuteilung von 10.000 Neurons je UTC-Tag. [Gemma-Modell](https://developers.cloudflare.com/workers-ai/models/gemma-4-26b-a4b-it/) · [Workers-AI-Kontingente](https://developers.cloudflare.com/workers-ai/platform/pricing/)

### Erneut mit echten Quellen geprüft

| Quelle und Frage | Ergebnis |
| --- | --- |
| `@kuran-kelime-meali.pdf` · „Hangi metin bölümünde Namazı dosdoğru kılın geçiyor?“ | Im Chat und in der Admin-Diagnose belegt. Der Auszug stammt aus Ayet **2:43** auf **PDF-Seite 7**. Die Diagnose hat den vorhandenen Index benutzt. |
| Veröffentlichte Hadis-Textfassung · „Hangi metin bölümünde Ana babaya bakmak ibadettir geçiyor?“ | Der Chat belegte die Antwort mit **Hadis 41, Seite 2**. |
| Veröffentlichte Hadis-Textfassung · „Bu hadis anne ve babaya bakmayı nasıl nitelendiriyor?“ | Separater Test des bestehenden Worker-Codes mit Cloudflare Workers AI und dem öffentlich bereitgestellten Satz. Das Modell formulierte die Antwort auf Türkisch und lieferte das überprüfte Originalzitat. Der aus der Antwort und ihrer Belegprüfung geschätzte Verbrauch betrug **5 Neurons**. Die Anmeldung und das Kontingent waren in diesem Modelltest nachgebildet. [Öffentliche Hadis-Textfassung](https://talhakazan02-design.github.io/kzn-sd-dar-al-ilm/hadis-text.json) |
| `Hadisi Serfler.pdf` · gezielte OCR | **0 von 2 Seiten** mit eingebetteter Textebene. OCR erkannte Text auf beiden Seiten. Der automatisch formulierte Antworttest blieb bei dieser Probe offen, weil OCR-Text vor einer bestätigten Antwort am Original geprüft werden muss. |

### Fehlgeschlagene Fälle und nächste Schritte

- Die beiden Regressionen ließen sich auf Beta 0.2.0 nachstellen. Nach der Korrektur bestehen die Tests für Buchbindung, exakten Wortlaut und Seitenangabe.
- In der wiederholten Prüfung der echten Koran-PDF bestanden **6 von 15** Beispielen vollständig. Die neun Standardfragen zu anderen Quellen wie Emsile oder Maksud wurden in dieser Koran-PDF nicht belegt. Der Durchlauf belegt keine allgemeine Trefferquote für die Bibliothek.
- Emsile und Maksud bleiben anhand der früheren Sichtung Scan-Fälle mit kaum beziehungsweise ohne eingebettete Textebene. Die genaue İlmihal-Seite zu „Namazın farzları“ wartet weiterhin auf Bestätigung am Original. Diese privaten Dateien wurden für den neuen Testlauf nicht erneut geprüft.
- Technischer Browsertest mit Testdaten prüft die neue Admin-Diagnose, die Einwilligung, den Umgang mit verweigertem Zugriff, erneute Indexnutzung und die Darstellung eines belegten Modellresultats. Such-, Kontingent- und SQL-Rollentests sind ebenfalls Teil der Prüfung.
- Die nächste freizugebende Phase ist die Verwaltung eigener und zentraler Vorlagen. Weitere Phasen können den überprüften Text der Scanbücher gezielt ausbauen und Laufzeit und Trefferabdeckung messen.

## Bestandsaufnahme Phase 1

| Bereich | Komponente | Geprüfter Stand und Grenze |
| --- | --- | --- |
| Quellen und Rechte | `menba-shared-sources.js`, `menba-source-preferences.js`, `menba.js`, Supabase-RLS | Eigene und freigegebene PDFs, gespeicherte Auswahl je Konto und Browser. Gemeinsame PDFs werden sitzungsbezogen verarbeitet. |
| Dokumentverarbeitung | `menba.js`, PDF.js, `menba-ocr.js` | Textextraktion aus PDFs, browserseitige OCR für Scans und Fotos, getrennte Status für Teilindex und Fehler. |
| Suche und Nachweise | `menba-search.js`, `menba-quran.js`, `menba-quran-edition.js`, `menba-question-checks.js` | Volltext, mehrsprachige Begriffe, ausgewählte Koran-Ausgaben, Abgleich von Buch, Seite und tatsächlich gefundener Textstelle. |
| Antwort und Zugriff auf das Modell | `menba-answers.js`, `menba-cloud-chat.js`, `cloudflare/` | Lokale belegte Kurzantworten und optional formulierte Antworten aus geprüften Auszügen. Die Worker-Routen prüfen Supabase-Rollen und Kontingente. |
| Lernen und Diagnose | `menba-learning.js`, `menba-guidance.js`, `menba-admin.js` | Erste Hoca- und Talebe-Funktionen, bearbeitbare Vorlagen, Admin-Testzentrum und manuelles erneutes Verarbeiten. |
| Oberfläche | `index.html`, `menba.js`, `menba.css` | Deutsch-türkischer Chat mit Quellenauswahl. Phase 2 behandelt die weitere Bedienung. |

### Nachgestellte Fehler und Korrekturen

| Fehler | Nachweis im veröffentlichten Ausgangscode | Ergebnis des Tests nach der Korrektur |
| --- | --- | --- |
| Alter Browserindex umging die aktuelle Storage-Freigabe eines privaten PDFs | Nach zwei erfolgreichen Suchen wurde die Freigabe in der Testumgebung entzogen. Der Chat zeigte daraufhin noch drei Belege aus derselben Datei. | Der Serverzugriff wird vor jeder Suche erneut geprüft. Nach verweigerter Freigabe zeigt der Chat null alte Fundstellen dieser Quelle und meldet den Zugriffsfehler. Erlaubte wiederholte Suchen brauchen weiterhin nur einen PDF-Download. |
| Cloud-Zustimmung blieb nach Quellenwechsel gesetzt | Nach dem Ankreuzen einer zusätzlichen Quelle war die Zustimmung aus der alten Auswahl weiterhin aktiv. | Einzel- und Sammelauswahl setzen das Häkchen zurück. Änderungen an den verfügbaren oder verarbeiteten Quellen melden der Oberfläche die neue Auswahl. |

Bei verweigertem oder technisch fehlgeschlagenem Storage-Zugriff antwortet MENBA mit einer technischen Meldung. Hat eine erreichbare Quelle keine Textebene, verweist MENBA auf die OCR. Eine erreichbare und lesbare Quelle ohne passenden Beleg führt zu einer inhaltlichen Rückmeldung. Der Zugriffstest schützt die Anzeige in MENBA. Bereits heruntergeladene Dateien und lokale Browserdaten unterliegen den Möglichkeiten des jeweiligen Endgeräts.

## Reproduzierte Ursachen

- Formulierungen wie „Emsile konusunu açıkla“, „Erkläre Emsile auf Deutsch“ und „ما موضوع كتاب الأمثلة؟“ konnten trotz vorhandener Belegstelle leer bleiben. Der bisherige Suchfilter behandelte Fragefloskeln und Sprachangaben als Fachbegriffe. An einem kontrollierten Emsile-Auszug wurde das vor und nach der Änderung nachgestellt.
- „Maksud kitabında fiiller nasıl açıklanıyor?“ berücksichtigte den Buchtitel, suchte im Buchtext jedoch nach mehreren Fragewörtern. Die Suche nutzte „fiiller“ außerdem noch nicht als Entsprechung für „Verben“ oder „الأفعال“.
- PDFs mit einzelnen technischen Lesefehlern führten auf spätere Fragen zu einem erneuten vollständigen Download. Teilindizes werden jetzt gespeichert. Ein technischer Wiederholungsversuch startet weiterhin eine neue Verarbeitung.
- Leere Seiten konnten den nächsten OCR-Durchlauf blockieren. Beim automatischen Weiterblättern überspringt MENBA Seiten, auf denen es in dieser Sitzung schon nach Text gesucht hat. Ein manuell gewählter Seitenbereich kann erneut verarbeitet werden.
- Ein Bildscan braucht OCR. PDF.js allein lieferte für die bereitgestellte Hadis-PDF keine Textebene. Der Testbericht unterscheidet Dateizugriff, PDF-Text, OCR und durchsuchbaren Index.
- Die veröffentlichte Seite verwendet den Cloudflare-Pilot für freiwillig gewählte, formulierte Antworten. Ein separater Modelltest mit erfundenen türkischen Daten bestätigte Antwort und Wortlaut des Belegs. Lokale Auszüge und belegte Kurzantworten stehen auch ohne Modellaufruf zur Verfügung. [Cloudflare-Verbindung](https://github.com/talhakazan02-design/kzn-sd-dar-al-ilm/pull/23)

## Verarbeitung und Zugriff

MENBA liest eigene Bücher und freigegebene gemeinsame PDFs über das vorhandene Supabase-Storage. Die gemeinsame Freigabe wird vor jedem Suchlauf erneut geprüft. Der Dokumentindex liegt für eigene und ausdrücklich geöffnete lokale Dateien kontobezogen in IndexedDB. Gemeinsame PDFs werden sitzungsbezogen verarbeitet. Die Suche läuft im Browser mit Volltext, sprachübergreifenden Begriffen und den vorhandenen Koran-Ausgaben. Es gibt keinen Supabase-Volltextindex und keine Vektorsuche.

Im Phase-1-Kandidaten prüft MENBA für ausgewählte private PDFs ebenfalls bei jedem Suchlauf eine aktuelle Storage-Freigabe. Derselbe signierte Zugriff wird bei Bedarf für den Download genutzt. Private PDFs werden über ihren Storage-Pfad versioniert, lokale Dateien anhand ihres Inhalts und gemeinsame PDFs anhand des jeweils freigegebenen Pfads. Quellenauswahl und Cloud-Zustimmung sind getrennte Schritte. Bei einer Rückfrage kann der vorherige Suchsatz als Kontext an den Worker gehen. Das ist bei der weiteren Gestaltung der Zustimmung zu berücksichtigen.

MENBA Test Merkezi prüft die Hauptadmin-Rolle per Supabase vor jeder Diagnose. Ein Lauf verwendet jeweils eine ausdrücklich ausgewählte Quelle. Die OCR-Probe liest eine fehlende Seite. Die Seitenzahl ist optional und MENBA bevorzugt automatisch eine Seite im Buchinneren. Die Tests verwenden die Produktionssuche und die lokale Antwortprüfung. Originaldateien bleiben erhalten. Ein verifizierter Teststatus gilt für die aktuelle Auswahl und den aktuellen Index.

## Prüfungen

- `node tests/check-menba-question-checks.cjs` prüft Fragevarianten DE/TR/AR, ausgewählte Bücher, korrekte Seiten und Titel, wortgetreue Auszüge und die Kennzeichnung von OCR.
- `node tests/check-menba-sources.cjs` prüft lokale Belege und den Zugriff auf freigegebene Quellen.
- `node tests/check-menba-source-session.cjs` führt die neue Zugriffskontrolle und Zustimmung im Browser mit lokalen Testdaten aus. Der Test verwendet Playwright mit installiertem Chromium. Alternativ kann `MENBA_CHROME_PATH` auf einen vorhandenen Chrome-Browser verweisen. Der Test verwendet die echten MENBA-Skripte und nachgebildete Antworten für Storage und PDF-Parser.
- `node tests/check-menba-admin.mjs` prüft Worker-Rollen, Kontingente, parallele Reservierung, UTC-Wechsel und den Beleg einer Modellantwort mit Testdaten.
- `node tests/check-menba-admin-db.cjs` prüft die SQL-Rollen und Berechtigungen in einem lokalen PGlite-Modell mit `@electric-sql/pglite`.
- Browserprüfung mit der bereitgestellten `@kuran-kelime-meali.pdf`. Im Test Merkezi bestanden sechs von 15 Fragen vollständig. Buch, Seite und Text wurden im Index abgeglichen.
- Die bereitgestellte `Hadisi Serfler.pdf` hat auf keiner der zwei Seiten eine PDF-Textebene. Die OCR erkannte Text auf beiden Seiten und speicherte ihn im Browser. Bei der erneuten Prüfung wurde zuerst ausdrücklich Seite 2 gewählt. Die automatische Folgeprobe fand anschließend Seite 1. OCR-Resultate benötigen vor einem bestätigten Antworttest den Abgleich mit der Originalseite.
- Zwei private Uploads wurden als Hauptadmin in der Live-Bibliothek geprüft. Bei beiden bestätigte Supabase den erlaubten Dateizugriff. Emsile hat eine von 24 Seiten mit Textebene. Sie enthält Verlagsangaben. Drei von zwölf Fragen führten technisch zu dieser Seite. Alle inhaltlichen Emsile-Fragen blieben offen. Maksud hat auf 64 Seiten keine Textebene. Die OCR-Probe erkannte Text auf Seite 1. Keine der zwölf Fragen bestand vollständig. Der Browser meldete bei beiden PDFs null PDF-Lesefehler. Damit ist fehlender direkt durchsuchbarer Buchinhalt für diese Uploads konkret belegt.
- In einer früheren Live-Prüfung lieferte die browserseitige OCR Text auf den ersten fünf PDF-Seiten von İlmihal. Die genaue Fundstelle zu den Gebetspflichten wartet weiterhin auf Prüfung am Original.
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

## Abschluss Phase 1

- Beide zuvor fehlschlagenden Browserprüfungen bestanden nach dem Fix. Der neue Repository-Test prüft zusätzlich den wieder erlaubten Zugriff, die erneute Benutzung des gespeicherten Index und den Verzicht auf externe Anfragen im Testlauf.
- Der erneute Lauf mit der echten Koran-PDF bestätigte alle sechs Fundstellen aus der Tabelle. Die 15 geprüften Fragen enthielten auch allgemeine Fragen zu anderen Büchern. Der Lauf prüfte außerdem die Grenze von 50 MiB, die türkische Oberfläche und die mobile Darstellung.
- Der erneute Lauf mit dem echten Hadis-Scan erkannte und speicherte Seiten 1 und 2. Die hinterlegten OCR-Fragen bleiben bis zur Sichtprüfung als ungeprüft gekennzeichnet.
- Der Live-Worker akzeptierte die erlaubte Website für die Vorabanfrage (`204`) und wies die Anfrage ohne Anmeldung ab (`401`). Die reguläre Antwort und die Kontingente wurden mit Testdaten geprüft. Die privaten Buchtexte der Tests blieben bei der lokalen Verarbeitung.
- Die zusätzliche Freigabeprüfung für private PDFs verursacht pro verwendeter privater Datei einen kurzen Storage-Aufruf. Die Laufzeit für große Quellenauswahlen sowie die OCR ganzer Bücher wurden in diesem Stand noch nicht vermessen. Die technische Verarbeitung beginnt bei der Nutzung oder über die manuelle Diagnose.

## Beta-Umfang

Talebe Modu unterstützt Wiederholung, Übungen, Lückentests und Markierungen innerhalb der Sitzung. Hoca Modu erstellt persönliche Unterrichtsentwürfe, Leselisten, Quiz und Hausaufgabenentwürfe aus gewählten Quellen. Schülerverwaltung, Abgaben und eine Veröffentlichung von Unterrichtsmaterial sind noch offen. Das Menü führt in dieselbe bestehende MENBA-Oberfläche und prüft weiter die Hoca-Rolle.
