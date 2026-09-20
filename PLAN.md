# PLAN.md — Samhällsbyggarkartan

Uppdaterad 2026-09-20 (em).

## Nästa steg för Claude

1. Efter 2026-09-24: kontrollera i GitHub Actions att jobbet "Stäng av sajten (2026-09-24)" gick igenom
   och att https://samhallsbyggare.projektledarpodden.se visar stängt-sidan.
2. Verifiera EBH-lagret (Länsstyrelsen) om servern svarar igen.
3. MSB:s översvämningstjänst (gisapp.msb.se) svarade inte vid publiceringstestet 2026-09-20 —
   kontrollera igen; koden hanterar det tolerant ("källan svarar inte just nu").
4. Testsvit saknas fortfarande (`tests/` med Playwright) — bygg innan nästa funktionsändring.

## Att göra för Mattias

1. **Testa QR-koden** i `docs/qr-samhallsbyggare.png` (eller `.svg`) på en PowerPoint-sida.
   Koden pekar på https://samhallsbyggare.projektledarpodden.se, som är live med giltigt certifikat.
2. **Beslut (valfritt):** Static Web App:en ligger på Free-nivån och kostar 0 kr även efter avstängningen
   24/9. Vill du ändå ta bort resursen helt:
   ```powershell
   az staticwebapp delete -n samhallsbyggare -g samhallsbyggare-rg --yes
   ```
   Det raderar även domänkopplingen; repot och koden finns kvar på GitHub. CNAME-posten i Cloudflare
   kan då också tas bort.
3. **Vill du öppna sajten igen efter 24/9:** be Claude ta bort steget "Datumspärr" i
   `.github/workflows/azure-static-web-apps-purple-bush-015972603.yml` och pusha.
