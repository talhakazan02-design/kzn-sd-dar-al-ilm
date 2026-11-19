# MENBA Cloudflare-Pilot

Der Test ist für das verifizierte Eigentümerkonto reserviert. Er wird erst sichtbar, wenn `data-endpoint` am Element `menbaCloudPilot` eine Worker-URL enthält. Jede Sitzung erfordert eine ausdrückliche Auswahl im Quellenmenü.

1. Im Workers-Free-Konto `kzn-menba-pilot` mit der beiliegenden Wrangler-Konfiguration bereitstellen. Das Workers-AI-Binding heißt `AI`. Als `SUPABASE_PUBLISHABLE_KEY` den bereits in der Website verwendeten veröffentlichbaren Supabase-Schlüssel hinterlegen.
2. Den Zugang, die Herkunft und die Auswertung zuerst mit erfundenen Beispieltexten prüfen. Der Worker verlangt die bestehende Supabase-Eigentümerrolle und nimmt höchstens drei kurze Auszüge an.
3. Für den Bibliothekstest die HTTPS-URL des Workers mit `/menba/answer` als `data-endpoint` eintragen. Die Vorschau sendet nach Auswahl der Option Fragen und passende eigene Textausschnitte. Gemeinsame PDFs und OCR-Auszüge bleiben im Quellenchat.

Lokaler Worker-Test: `node cloudflare/check-menba-worker.mjs` im Repository. Die Beispiele benötigen keine Zugangsdaten und simulieren Supabase sowie das KI-Binding.
