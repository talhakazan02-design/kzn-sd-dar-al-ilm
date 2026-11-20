# MENBA AI – Entwicklungsplan

MENBA beantwortet Fachfragen anhand ausdrücklich ausgewählter und zugänglicher Quellen. Buch, PDF-Seite und gegebenenfalls Ayet gehören zum Beleg. Wenn der Beleg fehlt, bleibt die Frage offen. Externe Modellaufrufe brauchen eine aktive Zustimmung pro Frage. Das Original bleibt die Grundlage für die Prüfung von OCR und Übersetzungen.

**Beta 0.2.0** ist veröffentlicht. Dieser Zweig bereitet **Beta 0.2.1** für den neuen Auftrag vor. [Veröffentlichte Ausgangsversion](https://github.com/talhakazan02-design/kzn-sd-dar-al-ilm/commit/416adc1f275bf5e7b487d54a2f8b2055b8b572e7)

## Update für zuverlässige Antworten und eigene Vorlagen

| Phase | Umfang und Stand |
| --- | --- |
| 1 · Zuverlässigkeit | Buchauswahl, exakte Fundstellen, Fehlerdiagnose und Tests mit echten Quellen. Ergebnisse im [Diagnosebericht](MENBA-DIAGNOSE.md#phase-1-des-neuen-auftrags-zur-antwortqualität). |
| 2 · Vorlagenverwaltung | Eigene und zentrale Vorlagen, Platzhalter, Suche, Kategorien und Favoriten. Umsetzung nach Freigabe. |
| 3 · Oberfläche | Navigation für gespeicherte Vorlagen, Quellenpanel und weiterführende Antwortaktionen. Die Beta 0.2.0 liefert bereits den responsiven Chat als Grundlage. |
| 4 · Intelligente Vorschläge | Fragen aus echten Abschnitten ableiten und Vorlagentests mit nachvollziehbaren Ergebnissen ermöglichen. |
| 5 · Weiterentwicklung | Mehrsprachige Abdeckung, Indexierung und OCR für größere Bibliotheken, Laufzeiten und Verbrauchsmessung anhand realer Testfälle. |

## Bisheriger Entwicklungsplan der Beta

| Phase | Stand | Nächster Entwicklungsschritt |
| --- | --- | --- |
| 1 · Stabilität und Fehlerbehebung | Bestandsaufnahme, Reparaturen und Tests im separaten Zweig | Freigabe des geprüften Stands. Offene Scan- und Leistungsfragen stehen im Diagnosebericht. |
| 2 · Benutzeroberfläche | Freigegeben und im Review-Zweig umgesetzt. Einklappbare Quellen und Vorlagen, Chat mit Eingabe am Ende, neue Unterhaltung, Bearbeiten, Kopieren und Wiederholen. | Darstellung und Ablauf im Review prüfen. Danach Phase 3 zur Freigabe vorlegen. |
| 3 · Fragevorlagen | Bearbeitbare Vorlagen und geprüfte Vorschläge vorhanden | Verständlichkeit und Abdeckung anhand verarbeiteter Kursbücher prüfen. |
| 4 · Mehrsprachige Suche | Türkische, deutsche und arabische Begriffe in der lokalen Volltextsuche | Echte mehrsprachige Aufgaben erfassen, Suche und Antwortsprache daran prüfen. Semantische Suche nach belegtem Bedarf bewerten. |
| 5 · Lernfunktionen | Erste Erklärungen, Auszüge und lokale Übungen | Zusammenfassungen, Beispiele und Aufgaben mit überprüfbaren Nachweisen ausbauen. |
| 6 · Talebe Modu | Beta mit Wiederholung, Übungen und Markierungen in der Sitzung | Persönliche Wiederholungslisten und Arbeit mit freigegebenen Kursquellen ergänzen. Gespräche bleiben beim jeweiligen Konto. |
| 7 · Hoca Modu | Beta mit zuweisbarer Rolle und Unterrichtsentwürfen | Lernniveaus und Materialentwürfe verbessern. Erst nach Prüfung durch den Hoca veröffentlichen. |
| 8 · Qualität und Weiterentwicklung | Test Merkezi, Einzelprüfungen und Regressionstests vorhanden | Testfälle je Version, Laufzeiten und nachvollziehbare Qualitätsmessungen ergänzen. Feedback datensparsam erfassen und fachlich prüfen. |

## Prioritäten aus Phase 1

1. **Zugriff und Zustimmung.** Private und gemeinsame PDFs werden vor der Suche autorisiert. Bei fehlender Freigabe muss MENBA alte Fundstellen der betroffenen Quelle ausblenden. Nach Wechsel der Quellen ist eine neue Cloud-Zustimmung nötig.
2. **Index und Zitierqualität.** Lesbare PDFs sollen nach einer frischen Zugriffsprüfung aus dem vorhandenen Index durchsuchbar sein. Reale Stichproben mit Buch, Seite und Ayet zeigen, welche Fragen mitgetragen werden.
3. **Buchscans.** Die OCR hilft einzelnen Seiten. Emsile, Maksud und İlmihal benötigen weitere gezielte OCR und Sichtprüfung. Eine automatische Verarbeitung ganzer Scanbücher braucht messbare Grenzen für Laufzeit und Ressourcen.
4. **Wachsende Bibliothek.** Neu hochgeladene PDFs sind im vorhandenen Quellensystem auswählbar. Als nächste technische Etappe nach Freigabe prüfen, wie sich Verarbeitung aus dem Upload heraus planen und Fehler pro Dokument gezielt wiederholen lassen. Die Berechtigung bleibt Voraussetzung für jeden Suchlauf.

## Komponenten weiterentwickeln

Die bestehende Aufteilung ist in der [Bestandsaufnahme](MENBA-DIAGNOSE.md#bestandsaufnahme-phase-1) beschrieben. Neue Logik für Speicherung, Berechtigungen, Suche oder Modellzugriff kommt in die jeweils zuständige Komponente. `menba.js` verbindet den Ablauf mit der Oberfläche. Eine Umstellung erfolgt schrittweise, mit einzeln nachprüfbaren Änderungen.

Bei jeder späteren MENBA-Änderung diese Phasenübersicht und den [Änderungsverlauf](MENBA_CHANGELOG.md) mit Teststand und bekannten Einschränkungen aktualisieren. Ergebnisse aus Testläufen sollen die geprüfte Version, Quelle und Nachweisart nennen. Weitere Phasen beginnen nach Freigabe durch den Projektinhaber.
