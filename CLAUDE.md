# CLAUDE.md — Samhällsbyggarkartan

Den här filen läses automatiskt av Claude Code och ger kontext om projektet.
Mattias är ingenjör men inte programmerare — förklara steg enkelt och undvik onödig jargong.
Kommunicera på svenska.

## Vad det här är

**Samhällsbyggarkartan** — en demosajt som visar hur mycket öppen svensk geodata som går att
använda **utan API-nycklar eller registrering**, byggd med Claude Code. Målgrupp: samhällsbyggare
(exploatörer, planerare, byggare) som vill få en snabb platsbild av en tomt eller ett område.

Skriv in en adress eller klicka i kartan → få en **platsrapport**: översvämningsrisk (MSB),
jordarter/berggrund/brunnar (SGU), fornlämningar (RAÄ), skyddad natur (NVV), förorenade områden
(Länsstyrelserna), befolkningsstatistik (SCB), närhet till service (OpenStreetMap) och väder (SMHI).

- **Publik URL (mål):** samhallsbyggare.projektledarpodden.se (+ redirect från projektledarpodden.se/samhallsbyggare när huvuddomänen flyttats till Azure)
- **Git/källkod:** GitHub `VisionInno/samhallsbyggare` (publikt), branch `main`
- **Hosting:** Azure Static Web App i resursgrupp `samhallsbyggare-rg` (West Europe, Free).
  Push till `main` → GitHub Actions bygger och deployar automatiskt.

## Struktur

```
app/                    Statisk webbplats (ingen byggprocess — ren HTML/CSS/JS)
  index.html            Startsida
  verktyg/index.html    Kartverktyget (huvudappen)
  datakallor/index.html Datakällorna dokumenterade
  om/index.html         Hur sajten byggdes (Claude Code-berättelsen)
  assets/css/style.css  All CSS (designsystem i :root-variabler)
  assets/js/config.js   ALLA datakällor & lagerdefinitioner (ändra här först!)
  assets/js/karta.js    Kartan, lagerpanel, legender
  assets/js/analys.js   Platsanalysen + rapportpanelen
  staticwebapp.config.json  Azure-headers m.m.
api/                    Azure Functions (managed) — en enda liten CORS-proxy
  src/functions/geo.js  GET /api/geo?u=<url> — vidarebefordrar till godkända värdar
docs/                   Arkitektur & sessionslogg
```

## Kommandon

```powershell
# Lokal utveckling — enklast (bara frontend, proxyberoende data faller bort snyggt):
cd app; npx serve .    # eller: python -m http.server 8080

# Med proxy-API:t lokalt (kräver Azure Static Web Apps CLI):
npm install -g @azure/static-web-apps-cli
swa start app --api-location api
```

Ingen byggprocess. Inga npm-beroenden i frontend (Leaflet/MapLibre läses från CDN).

## Arkitekturprincip (viktig!)

Varje datakälla är en **adapter** definierad i `app/assets/js/config.js`. Frontenden vet inte
om en källa hämtas direkt eller via proxyn — den anropar `fetchViaProxyIfNeeded()`.
Så kan Lantmäteriet (kräver konto) kopplas in i fas 2 utan att bygga om något.

**CORS-läget styr allt** (verifierat i webbläsare 2026-07-06):

| Källa | Tiles (WMS-bilder) | Datafrågor (JSON/XML) |
|---|---|---|
| Nominatim, Overpass, MSB, SCB, RAÄ, OpenFreeMap | direkt | direkt (CORS OK) |
| SGU, SMHI, Naturvårdsverket, Länsstyrelsen | direkt (`<img>` via Leaflet, CORS krävs ej) | via `/api/geo`-proxyn (saknar CORS) |

Proxyn har en **hård allowlist** av värdnamn i `api/src/functions/geo.js`. Lägg aldrig till
värdar slentrianmässigt. Inga nycklar, inga hemligheter — den vidarebefordrar bara GET.

## Verifierade endpoints (2026-07-06)

- MSB översvämning (ArcGIS): `https://gisapp.msb.se/arcgis/rest/services/Oversvamningskarteringar/{karteringar|kustoversvamning|hotkartor}/MapServer` — WMS: samma bas + `/WmsServer`. Karteringar-lager: 2=100-år, 3=100-år klimat, 4=200-år klimat, 5=BHF, 15=1000-år. Kust: lager-id = nivå i dm − 1 (0=0,1 m … 29=3,0 m)
- SGU WMS (GeoServer): `https://resource.sgu.se/service/wms/130/<produkt>` där produkt är
  `jordarter-25-100-tusen` (lager `jord:SE.GOV.SGU.JORD.GRUNDLAGER.25K`),
  `jordarter-25-100-tusen-genomslapplighet` (lager `SE.GOV.SGU.JORD.GRUNDLAGER.GENOMSLAPPLIGHET.25K`),
  `berggrund-50-250-tusen` (lager `SE.GOV.SGU.BERG.GEOLOGISK_ENHET.YTA.50K`),
  `brunnar` (lager `SE.GOV.SGU.BRUNNAR.250K`)
- SCB (GeoServer): `https://geodata.scb.se/geoserver/stat/{wms|wfs}` — lager t.ex. `befolkning_1km_2024`, `DeSO_2025`, `Tatorter_2023`
- RAÄ lämningar: `https://pub.raa.se/visning/lamningar_v1/wms` — lager `fornlamning`, `mojligfornlamning`, `ovrkulthistlamning` m.fl. GetFeatureInfo stödjer `application/json`!
- NVV skyddad natur: `https://geodata.naturvardsverket.se/naturvardsregistret/wms` — lager `Nationalpark`, `Naturreservat`, `Naturreservat_kommunalt`, `Vattenskyddsomrade` m.fl.
- Länsstyrelsen EBH: `https://ext-geodata-nationella.lansstyrelsen.se/arcgis/rest/services/LST/lst_wms_miljodata/MapServer` (lager 0 = potentiellt förorenade områden). **OBS: servern var nere/långsam vid bygget — hanteras tolerant i koden.**
- SMHI punktprognos (nya SNOW-modellen, gamla pmp3g nedlagd mars 2026): `https://opendata-download-metfcst.smhi.se/api/category/snow1g/version/1/geotype/point/lon/{lon}/lat/{lat}/data.json` — svarformat: `timeSeries[i].data.air_temperature` osv.
- Nominatim: `https://nominatim.openstreetmap.org/search` + `/reverse` (max 1 req/s — debounce finns i koden, ändra inte bort den)
- Overpass: `https://overpass-api.de/api/interpreter`
- Basemap: MapLibre GL via Leaflet-plugin, stil `https://tiles.openfreemap.org/styles/positron`

## Kända begränsningar / medvetna val

- Publika Nominatim/Overpass är för lågtrafik — OK för demo, självhostas vid skarp drift (fas 2)
- Länsstyrelsens geodataserver är opålitlig — rapporten visar "kunde inte hämtas" i stället för att hänga
- Fastighetsgränser, ortofoto, officiella adresser = Lantmäteriet = kräver konto → medvetet utanför v1
- Ingen CSP i staticwebapp.config.json (många externa geodatakällor; omvärdera vid skarp drift)
- Rapporten är **vägledande screening**, inte beslutsunderlag — disclaimern får inte tas bort

## Backlog (fas 2-idéer)

1. Lantmäteriet via Geotorget-konto (fastighetsgränser, ortofoto) — adapter finns förberedd
2. K-samsök-API för rikare kulturmiljödata
3. Gångtidsisokroner (egen Valhalla/OSRM) i stället för fågelvägsringar
4. PDF-export av platsrapporten (nu: webbläsarens utskrift, print-CSS finns)
5. Spara/jämför flera platser
6. Kust-nivåväljare → animering av stigande hav

## Arbetssätt för Claude Code

- Testa i webbläsare efter ändringar (`npx serve app`), särskilt kartverktyget
- Nya datakällor: lägg till i `config.js` + dokumentera på `datakallor/index.html` + i den här filen
- Uppdatera `docs/session-log.md` efter varje arbetspass
- Förklara ändringar för Mattias på svenska, enkelt och utan jargong
