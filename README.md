# Samhällsbyggarkartan

**Hela platsbilden på en minut — byggd på öppna svenska geodata, utan en enda API-nyckel.**

Skriv in en adress eller klicka i kartan och få en samlad platsrapport för tidig
platsanalys: översvämningsrisk, jordarter, berggrund, brunnar, fornlämningar, skyddad
natur, förorenade områden, befolkningsstatistik, närhet till service och väder.

Byggd med [Claude Code](https://claude.com/claude-code) som en demonstration av hur
långt man kommer med öppna data och AI-assisterad utveckling.

🌐 **Live:** https://samhallsbyggare.projektledarpodden.se

## Datakällor (alla öppna, ingen registrering)

| Källa | Data | Licens |
|---|---|---|
| MSB | Översvämningskarteringar, kustöversvämning | Öppen tjänst |
| SGU | Jordarter, genomsläpplighet, berggrund, brunnar | CC0 |
| SCB | Befolkning per km-ruta, DeSO, tätorter | CC0 |
| Riksantikvarieämbetet | Fornlämningar och kulturhistoriska lämningar | Öppna data |
| Naturvårdsverket | Nationalparker, naturreservat, vattenskyddsområden | Öppna data |
| Länsstyrelserna | Potentiellt förorenade områden (EBH) | Öppna data |
| SMHI | Väderprognos för punkt | Öppna data |
| OpenStreetMap | Geokodning, service-POI:er, basdata | ODbL |
| OpenFreeMap | Vektorbaskarta | Öppen tjänst |

## Teknik

- Ren statisk HTML/CSS/JS — ingen byggprocess, inga npm-beroenden i frontend
- Leaflet + MapLibre GL (vektorbaskarta) från CDN
- Azure Static Web Apps (Free) med en liten Azure Function som CORS-brygga
  för de myndighets-API:er som saknar CORS-headers (inga nycklar, bara vidarebefordran)
- Deploy: push till `main` → GitHub Actions → Azure

## Kör lokalt

```bash
cd app
npx serve .          # eller: python -m http.server 8080
```

Med proxy-API:t (för SGU/SMHI/NVV-datafrågor):

```bash
npm install -g @azure/static-web-apps-cli
swa start app --api-location api
```

## Viktigt

Rapporten är **vägledande screening i tidigt skede** — inte juridisk information eller
beslutsunderlag. Fastighetsgränser, officiella adresser och ortofoto kommer från
Lantmäteriet och kräver konto (medvetet utanför den här friktionsfria versionen).

## Licens

Koden: MIT. Data: respektive källas licens (se tabellen ovan och /datakallor på sajten).
