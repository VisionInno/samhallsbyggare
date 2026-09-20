# PLAN.md — Samhällsbyggarkartan

Uppdaterad 2026-09-20.

## Nästa steg för Claude

1. När CNAME-posten finns i Cloudflare (se nedan): registrera subdomänen på Static Web App:en
   och verifiera att https://samhallsbyggare.projektledarpodden.se svarar med giltigt certifikat:
   ```powershell
   az staticwebapp hostname set -n samhallsbyggare -g samhallsbyggare-rg --hostname samhallsbyggare.projektledarpodden.se
   az staticwebapp hostname show -n samhallsbyggare -g samhallsbyggare-rg --hostname samhallsbyggare.projektledarpodden.se
   ```
   Kontrollera sedan i Chrome (kartverktyget + en platsrapport) och ta bort DNS-påminnelsen i minnet.
2. Efter 2026-09-24: kontrollera i GitHub Actions att jobbet "Stäng av sajten (2026-09-24)" gick igenom
   och att domänen visar stängt-sidan.
3. Verifiera EBH-lagret (Länsstyrelsen) om servern svarar igen.
4. Testsvit saknas fortfarande (`tests/` med Playwright) — bygg innan nästa funktionsändring.

## Att göra för Mattias

1. **Lägg CNAME-posten i Cloudflare** (kräver din inloggning, blockerar publiceringen):
   - Logga in på https://dash.cloudflare.com → zonen `projektledarpodden.se` → DNS → Records → Add record
   - Type: `CNAME` · Name: `samhallsbyggare` · Target: `purple-bush-015972603.7.azurestaticapps.net`
   - **Proxy status: DNS only (grått moln)** — annars kan Azure inte validera domänen och utfärda certifikat
   - Spara. Säg sedan till Claude ("CNAME är inlagd") så körs steg 1 ovan.
2. **Testa QR-koden** i `docs/qr-samhallsbyggare.png` (eller `.svg`) på en PowerPoint-sida när
   subdomänen svarar. Koden pekar på https://samhallsbyggare.projektledarpodden.se.
3. **Beslut (valfritt):** Static Web App:en ligger på Free-nivån och kostar 0 kr även efter avstängningen.
   Vill du ändå ta bort resursen helt efter 24/9:
   ```powershell
   az staticwebapp delete -n samhallsbyggare -g samhallsbyggare-rg --yes
   ```
   Det raderar även domänkopplingen; repot och koden finns kvar på GitHub.
