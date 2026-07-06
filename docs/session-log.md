# Sessionslogg

## 2026-07-06 — Projektet skapas (Claude i Cowork-läge)

- Läste ChatGPT-researchrapporten om öppna geodata utan registrering; egna beslut därefter.
- **Verifierade alla källor i webbläsare** (CORS-läget avgör arkitekturen):
  - Direkt: Nominatim, Overpass, MSB (WMS + ArcGIS REST), SCB (WMS/WFS), RAÄ (WMS, JSON-GetFeatureInfo), OpenFreeMap
  - Utan CORS → via proxy: SGU, SMHI, Naturvårdsverket, Länsstyrelserna
  - Nere/långsam vid bygget: ext-geodata-nationella.lansstyrelsen.se (EBH) — hanteras tolerant
  - Död host: nvpub.vic-metria.nu (NVV:s gamla) → ersatt av geodata.naturvardsverket.se/naturvardsregistret/wms
- Byggde sajten: startsida, kartverktyg (Leaflet + MapLibre GL/OpenFreeMap-basemap, 13 WMS-lager,
  platsrapport i vågor med riskchips, print-CSS, delningslänk), datakällssida, om-sida.
- Proxy: Azure Function `/api/geo?u=` med hård host-allowlist (inga nycklar).
- Beslut: subdomän `samhallsbyggare.projektledarpodden.se` (huvuddomänen pekar ännu inte på Azure;
  redirect från `/samhallsbyggare` läggs i huvudsajtens staticwebapp.config.json när domänbytet är gjort).
- Konventioner följda från projektledarpodden-projektet: egen resursgrupp (`samhallsbyggare-rg`),
  SWA Free i West Europe, GitHub VisionInno, auto-deploy via Actions.

### Kvar att göra efter denna session
- [ ] Verifiera EBH-lagret när Länsstyrelsens server svarar igen
- [ ] DNS: CNAME `samhallsbyggare` → SWA:ns default-host (görs hos dnshost.net-panelen)
- [ ] Redirect `/samhallsbyggare` i projektledarpodden-repot (efter domänbytet)
