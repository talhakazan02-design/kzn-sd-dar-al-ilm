# KZN · SD — دار العلم

Erste Vorschau der digitalen Bibliothek.

## Lokal testen
`index.html` im Browser öffnen.

## Hinweis
Diese Vorschau speichert Testeinträge lokal im Browser. Vor einer echten Veröffentlichung müssen Supabase Auth, Datenbanktabellen, Storage-Buckets und Row Level Security korrekt verbunden und getestet werden. Keine vertraulichen Schlüssel in den Quellcode schreiben.

## Staging für die Bibliothekskorrekturen

1. Richte eine separate Supabase-Instanz mit den bestehenden Tabellen `books` und `library_members` sowie dem Bucket `library-files` ein. Verwende dort ausschließlich Testdaten.
2. Führe zuerst `KATEGORIEN-SUPABASE.sql` und dann `BIBLIOTHEK-MIGRATION.sql` aus. Die Migration ergänzt das optionale Buchfeld `location`, benötigt den bestehenden Bucket und erwartet Dateipfade mit der Benutzer-ID als erstem Ordner.
3. Setze die Supabase-URL und den Publishable Key in einer lokalen Kopie von `index.html` auf die Staging-Instanz. Öffne sie über einen lokalen HTTP-Server.
4. Prüfe mit zwei freigegebenen Konten sowie einem nicht freigegebenen Konto, dass private Buchzeilen, PDFs und Cover nur dem jeweiligen Eigentümer zugänglich sind. Prüfe auch direkte Anfragen an Supabase. Bereits ausgegebene signierte URLs können bis zu ihrem Ablauf gültig bleiben.
5. Öffne PDFs und bearbeite Bücher aus der oberen Ergebnisübersicht sowie dem Katalog. Prüfe bestehende Buchkategorien, Datei-Ersatz, persönliche und gemeinsame Kategorien, das Löschen der letzten Kategorie und die Sprachwahl nach einem Neuladen.

Vorhandene Kategorien bleiben erhalten. Wenn eine Sammlung leer ist, können Kategorien über „Kategorien verwalten“ hinzugefügt werden. Gemeinsame Kategorien bearbeitet der Administrator. Die Migration erzeugt keine neue Freigabe für Buchdateien.
