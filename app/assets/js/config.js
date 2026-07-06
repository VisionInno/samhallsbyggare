/* ============================================================
   Samhällsbyggarkartan — konfiguration av ALLA datakällor.
   Ändra här först. Varje källa är en "adapter": frontenden vet
   inte om den hämtas direkt eller via /api/geo-proxyn.
   ============================================================ */

window.CFG = (function () {

  // Värdar som saknar CORS-headers → datafrågor går via vår lilla proxy.
  // (WMS-BILDER berörs inte — Leaflet laddar dem som <img> utan CORS.)
  const PROXY_HOSTS = [
    "resource.sgu.se",
    "opendata-download-metfcst.smhi.se",
    "geodata.naturvardsverket.se",
    "ext-geodata-nationella.lansstyrelsen.se",
    "ext-geodata.lansstyrelsen.se"
  ];

  /** Slår in en URL i proxyn om värden kräver det. */
  function viaProxy(url) {
    try {
      const h = new URL(url).hostname;
      if (PROXY_HOSTS.includes(h)) return "/api/geo?u=" + encodeURIComponent(url);
    } catch (e) { /* ogiltig url – låt fetch klaga */ }
    return url;
  }

  /** fetch med timeout + proxy vid behov. Returnerar Response. */
  async function smartFetch(url, ms) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms || 18000);
    try {
      return await fetch(viaProxy(url), { signal: ctrl.signal });
    } finally { clearTimeout(t); }
  }

  // ---------- Bas ----------
  const BASEMAP_STYLE = "https://tiles.openfreemap.org/styles/positron";
  const BASEMAP_FALLBACK = {
    url: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    attribution: "© OpenStreetMaps bidragsgivare"
  };

  // ---------- WMS-tjänster ----------
  const MSB_KART_WMS = "https://gisapp.msb.se/arcgis/services/Oversvamningskarteringar/karteringar/MapServer/WmsServer";
  const MSB_KUST_WMS = "https://gisapp.msb.se/arcgis/services/Oversvamningskarteringar/kustoversvamning/MapServer/WmsServer";
  const MSB_KART_REST = "https://gisapp.msb.se/arcgis/rest/services/Oversvamningskarteringar/karteringar/MapServer";
  const MSB_KUST_REST = "https://gisapp.msb.se/arcgis/rest/services/Oversvamningskarteringar/kustoversvamning/MapServer";

  const SGU_WMS = {
    jordarter: "https://resource.sgu.se/service/wms/130/jordarter-25-100-tusen",
    genomslapplighet: "https://resource.sgu.se/service/wms/130/jordarter-25-100-tusen-genomslapplighet",
    berggrund: "https://resource.sgu.se/service/wms/130/berggrund-50-250-tusen",
    brunnar: "https://resource.sgu.se/service/wms/130/brunnar"
  };
  const SGU_LAYERS = {
    jordarter: "jord:SE.GOV.SGU.JORD.GRUNDLAGER.25K",
    genomslapplighet: "SE.GOV.SGU.JORD.GRUNDLAGER.GENOMSLAPPLIGHET.25K",
    berggrund: "SE.GOV.SGU.BERG.GEOLOGISK_ENHET.YTA.50K",
    brunnar: "SE.GOV.SGU.BRUNNAR.250K"
  };

  const RAA_WMS = "https://pub.raa.se/visning/lamningar_v1/wms";
  const RAA_LAYERS = "fornlamning,mojligfornlamning,ovrkulthistlamning";

  const NVV_WMS = "https://geodata.naturvardsverket.se/naturvardsregistret/wms";
  const NVV_LAYERS = "Nationalpark,Naturreservat,Naturreservat_kommunalt,Naturvardsomrade,Vattenskyddsomrade";

  const LST_WMS = "https://ext-geodata-nationella.lansstyrelsen.se/arcgis/services/LST/lst_wms_miljodata/MapServer/WMSServer";
  const LST_REST = "https://ext-geodata-nationella.lansstyrelsen.se/arcgis/rest/services/LST/lst_wms_miljodata/MapServer";

  const SCB_WMS = "https://geodata.scb.se/geoserver/stat/wms";
  const SCB_WFS = "https://geodata.scb.se/geoserver/stat/wfs";

  // Kustöversvämning: lager-id i MSB:s tjänst = havsnivå i decimeter − 1
  const KUST_LEVELS = [
    { label: "+0,5 m havsnivå", id: 4 },
    { label: "+1,0 m havsnivå", id: 9 },
    { label: "+1,5 m havsnivå", id: 14 },
    { label: "+2,0 m havsnivå", id: 19 },
    { label: "+2,5 m havsnivå", id: 24 },
    { label: "+3,0 m havsnivå", id: 29 }
  ];

  // ---------- Kartlager för panelen ----------
  // type: "wms" → L.tileLayer.wms. legendLayer → GetLegendGraphic-bild i panelen.
  const LAYER_GROUPS = [
    {
      id: "risk", title: "Översvämning & risk", color: "#4A90D9", open: true,
      layers: [
        { id: "msb100", title: "100-årsflöde (klimatanpassat)", src: "MSB", wms: MSB_KART_WMS,
          params: { layers: "3", format: "image/png", transparent: true }, on: true, opacity: 0.65 },
        { id: "msb200", title: "200-årsflöde (klimatanpassat)", src: "MSB", wms: MSB_KART_WMS,
          params: { layers: "4", format: "image/png", transparent: true }, opacity: 0.65 },
        { id: "msbbhf", title: "Beräknat högsta flöde", src: "MSB", wms: MSB_KART_WMS,
          params: { layers: "5", format: "image/png", transparent: true }, opacity: 0.6 },
        { id: "msbkust", title: "Kustöversvämning", src: "MSB", wms: MSB_KUST_WMS, kustSelect: true,
          params: { layers: "9", format: "image/png", transparent: true }, opacity: 0.6 }
      ]
    },
    {
      id: "geo", title: "Mark & geologi", color: "#B0813B",
      layers: [
        { id: "jordarter", title: "Jordarter", src: "SGU", wms: SGU_WMS.jordarter,
          params: { layers: SGU_LAYERS.jordarter, format: "image/png", transparent: true },
          opacity: 0.55, legendLayer: SGU_LAYERS.jordarter },
        { id: "genomslapp", title: "Markens genomsläpplighet", src: "SGU", wms: SGU_WMS.genomslapplighet,
          params: { layers: SGU_LAYERS.genomslapplighet, format: "image/png", transparent: true },
          opacity: 0.55, legendLayer: SGU_LAYERS.genomslapplighet },
        { id: "berggrund", title: "Berggrund", src: "SGU", wms: SGU_WMS.berggrund,
          params: { layers: SGU_LAYERS.berggrund, format: "image/png", transparent: true }, opacity: 0.5 },
        { id: "brunnar", title: "Brunnar", src: "SGU", wms: SGU_WMS.brunnar,
          params: { layers: SGU_LAYERS.brunnar, format: "image/png", transparent: true }, opacity: 0.85 }
      ]
    },
    {
      id: "miljo", title: "Natur & miljö", color: "#2E7D4F",
      layers: [
        { id: "nvvskydd", title: "Skyddad natur", src: "Naturvårdsverket", wms: NVV_WMS,
          params: { layers: NVV_LAYERS, format: "image/png", transparent: true }, opacity: 0.55 },
        { id: "ebh", title: "Potentiellt förorenade områden", src: "Länsstyrelserna",
          note: "källan kan vara långsam", wms: LST_WMS,
          params: { layers: "0", format: "image/png", transparent: true, version: "1.3.0" }, opacity: 0.7 }
      ]
    },
    {
      id: "kultur", title: "Kulturmiljö", color: "#8E5DA2",
      layers: [
        { id: "raa", title: "Forn- och kulturlämningar", src: "Riksantikvarieämbetet", wms: RAA_WMS,
          params: { layers: RAA_LAYERS, format: "image/png", transparent: true }, opacity: 0.8 }
      ]
    },
    {
      id: "omrade", title: "Befolkning & områden", color: "#C8722C",
      layers: [
        { id: "befruta", title: "Befolkning per km²-ruta (2024)", src: "SCB", wms: SCB_WMS,
          params: { layers: "befolkning_1km_2024", format: "image/png", transparent: true },
          opacity: 0.55, legendLayer: "befolkning_1km_2024" },
        { id: "deso", title: "DeSO-områden (2025)", src: "SCB", wms: SCB_WMS,
          params: { layers: "DeSO_2025", format: "image/png", transparent: true }, opacity: 0.6 }
      ]
    }
  ];

  // ---------- Analys-endpoints ----------
  const NOMINATIM = "https://nominatim.openstreetmap.org";
  const OVERPASS = "https://overpass-api.de/api/interpreter";
  const SMHI_POINT = (lon, lat) =>
    "https://opendata-download-metfcst.smhi.se/api/category/pmp3g/version/2/geotype/point/lon/" +
    lon.toFixed(4) + "/lat/" + lat.toFixed(4) + "/data.json";

  // Kategorier för närhetsanalysen (Overpass)
  const POI_CATS = [
    { key: "hallplats", label: "Hållplats", q: '["highway"="bus_stop"]', alt: '["railway"~"station|tram_stop|halt"]' },
    { key: "skola", label: "Skola", q: '["amenity"="school"]' },
    { key: "forskola", label: "Förskola", q: '["amenity"="kindergarten"]' },
    { key: "vard", label: "Vård", q: '["amenity"~"clinic|doctors|hospital"]' },
    { key: "apotek", label: "Apotek", q: '["amenity"="pharmacy"]' },
    { key: "livs", label: "Livsmedel", q: '["shop"~"supermarket|convenience"]' },
    { key: "lek", label: "Lekplats", q: '["leisure"="playground"]' },
    { key: "ladd", label: "Laddstation", q: '["amenity"="charging_station"]' }
  ];

  return {
    viaProxy, smartFetch,
    BASEMAP_STYLE, BASEMAP_FALLBACK,
    LAYER_GROUPS, KUST_LEVELS,
    MSB_KART_REST, MSB_KUST_REST,
    SGU_WMS, SGU_LAYERS,
    RAA_WMS, RAA_LAYERS,
    NVV_WMS, NVV_LAYERS,
    LST_REST,
    SCB_WFS,
    NOMINATIM, OVERPASS, SMHI_POINT, POI_CATS
  };
})();
