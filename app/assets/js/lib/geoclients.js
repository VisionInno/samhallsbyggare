/* ============================================================
   lib/geoclients.js — rena protokollklienter för geodatatjänster.
   Ingen DOM, inget rapportvetande: tar koordinater + AbortSignal,
   returnerar data. Används av sektioner via window.GEO.
   ============================================================ */

window.GEO = (function () {
  const C = window.CFG;

  function toMerc(lat, lng) {
    const x = lng * 20037508.34 / 180;
    const y = Math.log(Math.tan((90 + lat) * Math.PI / 360)) / (Math.PI / 180) * 20037508.34 / 180;
    return { x, y };
  }
  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000, dLat = (lat2 - lat1) * Math.PI / 180, dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
    return Math.round(2 * R * Math.asin(Math.sqrt(a)));
  }
  const fmtDist = m => m < 1000 ? m + " m" : (m / 1000).toFixed(1).replace(".", ",") + " km";

  // ---------- GetFeatureInfo (GeoServer-stil, EPSG:3857) ----------
  function gfiUrl(base, layers, lat, lng, halfM, bufPx, fmt) {
    const p = toMerc(lat, lng), h = halfM || 60;
    const bbox = [p.x - h, p.y - h, p.x + h, p.y + h].join(",");
    return base + "?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetFeatureInfo" +
      "&LAYERS=" + encodeURIComponent(layers) + "&QUERY_LAYERS=" + encodeURIComponent(layers) +
      "&STYLES=&SRS=EPSG:3857&BBOX=" + bbox + "&WIDTH=101&HEIGHT=101&X=50&Y=50" +
      "&BUFFER=" + (bufPx || 3) +
      "&INFO_FORMAT=" + encodeURIComponent(fmt || "application/json") + "&FEATURE_COUNT=15";
  }
  async function gfiJson(base, layers, lat, lng, halfM, bufPx, signal) {
    const r = await C.smartFetch(gfiUrl(base, layers, lat, lng, halfM, bufPx), 20000, signal);
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }
  // ArcGIS-WMS (t.ex. Naturvårdsverket) svarar med esri_wms-XML i stället för JSON.
  async function gfiEsri(base, layers, lat, lng, halfM, bufPx, signal) {
    const r = await C.smartFetch(gfiUrl(base, layers, lat, lng, halfM, bufPx, "text/xml"), 20000, signal);
    if (!r.ok) throw new Error("HTTP " + r.status);
    const doc = new DOMParser().parseFromString(await r.text(), "text/xml");
    return [...doc.querySelectorAll("FIELDS")].map(f => {
      const o = {};
      [...f.attributes].forEach(a => { o[a.name] = a.value; });
      return o;
    });
  }

  // ---------- ArcGIS REST ----------
  async function arcgisIdentify(restBase, layerIds, lat, lng, tolPx, extentM, signal) {
    const p = toMerc(lat, lng), h = extentM || 600;
    const url = restBase + "/identify?f=json&geometry=" +
      encodeURIComponent(p.x.toFixed(1) + "," + p.y.toFixed(1)) +
      "&geometryType=esriGeometryPoint&sr=3857&layers=all:" + layerIds +
      "&tolerance=" + (tolPx || 2) +
      "&mapExtent=" + [p.x - h, p.y - h, p.x + h, p.y + h].map(v => v.toFixed(1)).join(",") +
      "&imageDisplay=400,400,96&returnGeometry=false";
    const r = await C.smartFetch(url, 20000, signal);
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }

  // Kusttjänstens identify tar ~30 s hos MSB — lagrets query-API svarar på ~1 s.
  async function arcgisQueryHit(restBase, layerId, lat, lng, signal) {
    const p = toMerc(lat, lng);
    const url = restBase + "/" + layerId + "/query?f=json&geometry=" +
      encodeURIComponent(p.x.toFixed(1) + "," + p.y.toFixed(1)) +
      "&geometryType=esriGeometryPoint&inSR=3857&spatialRel=esriSpatialRelIntersects" +
      "&returnGeometry=false&returnCountOnly=true";
    const r = await C.smartFetch(url, 20000, signal);
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    if (j.error) throw new Error("ArcGIS-fel " + j.error.code);
    return (j.count || 0) > 0;
  }

  return { toMerc, haversine, fmtDist, gfiJson, gfiEsri, arcgisIdentify, arcgisQueryHit };
})();
