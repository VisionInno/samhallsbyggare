/* ============================================================
   analys.js — platsanalysen: hämtar data från alla källor
   parallellt och bygger platsrapporten + sökrutan.
   ============================================================ */

window.ANALYS = (function () {
  const C = window.CFG;

  // ---------- småverktyg ----------
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

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
  const prettyKey = k => esc(String(k).replace(/[_-]+/g, " ").replace(/^./, c => c.toUpperCase()));

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
  async function gfiJson(base, layers, lat, lng, halfM, bufPx) {
    const r = await C.smartFetch(gfiUrl(base, layers, lat, lng, halfM, bufPx), 20000, runSignal());
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }
  // ArcGIS-WMS (t.ex. Naturvårdsverket) svarar med esri_wms-XML i stället för JSON.
  async function gfiEsri(base, layers, lat, lng, halfM, bufPx) {
    const r = await C.smartFetch(gfiUrl(base, layers, lat, lng, halfM, bufPx, "text/xml"), 20000, runSignal());
    if (!r.ok) throw new Error("HTTP " + r.status);
    const doc = new DOMParser().parseFromString(await r.text(), "text/xml");
    return [...doc.querySelectorAll("FIELDS")].map(f => {
      const o = {};
      [...f.attributes].forEach(a => { o[a.name] = a.value; });
      return o;
    });
  }

  // ---------- ArcGIS identify ----------
  async function arcgisIdentify(restBase, layerIds, lat, lng, tolPx, extentM) {
    const p = toMerc(lat, lng), h = extentM || 600;
    const url = restBase + "/identify?f=json&geometry=" +
      encodeURIComponent(p.x.toFixed(1) + "," + p.y.toFixed(1)) +
      "&geometryType=esriGeometryPoint&sr=3857&layers=all:" + layerIds +
      "&tolerance=" + (tolPx || 2) +
      "&mapExtent=" + [p.x - h, p.y - h, p.x + h, p.y + h].map(v => v.toFixed(1)).join(",") +
      "&imageDisplay=400,400,96&returnGeometry=false";
    const r = await C.smartFetch(url, 20000, runSignal());
    if (!r.ok) throw new Error("HTTP " + r.status);
    return r.json();
  }

  // Kusttjänstens identify tar ~30 s hos MSB — lagrets query-API svarar på ~1 s.
  async function arcgisQueryHit(restBase, layerId, lat, lng) {
    const p = toMerc(lat, lng);
    const url = restBase + "/" + layerId + "/query?f=json&geometry=" +
      encodeURIComponent(p.x.toFixed(1) + "," + p.y.toFixed(1)) +
      "&geometryType=esriGeometryPoint&inSR=3857&spatialRel=esriSpatialRelIntersects" +
      "&returnGeometry=false&returnCountOnly=true";
    const r = await C.smartFetch(url, 20000, runSignal());
    if (!r.ok) throw new Error("HTTP " + r.status);
    const j = await r.json();
    if (j.error) throw new Error("ArcGIS-fel " + j.error.code);
    return (j.count || 0) > 0;
  }

  // ---------- rapportpanelens skelett ----------
  const SECTIONS = [
    { id: "sec-vader",  icon: "🌤", title: "Väder just nu",            src: "SMHI" },
    { id: "sec-flood",  icon: "💧", title: "Översvämningsrisk",        src: "MSB" },
    { id: "sec-geo",    icon: "🪨", title: "Mark & geologi",           src: "SGU" },
    { id: "sec-miljo",  icon: "🌿", title: "Natur, miljö & förorening", src: "NVV · Länsstyrelserna" },
    { id: "sec-kultur", icon: "🏺", title: "Kulturmiljö",              src: "Riksantikvarieämbetet" },
    { id: "sec-omrade", icon: "👥", title: "Befolkning & område",      src: "SCB" },
    { id: "sec-service",icon: "🚏", title: "Närhet & service (fågelväg)", src: "OpenStreetMap" }
  ];

  const RISK_KEYS = [
    { key: "flod", label: "Översvämning" },
    { key: "kust", label: "Kustöversvämning" },
    { key: "ebh", label: "Förorenade områden" },
    { key: "kultur", label: "Fornlämningar" },
    { key: "natur", label: "Skyddad natur" }
  ];
  const riskState = {};

  function setRisk(key, level, text) {
    riskState[key] = { level, text };
    const wrap = $("risk-overview");
    wrap.innerHTML = RISK_KEYS.map(rk => {
      const st = riskState[rk.key];
      if (!st) return '<span class="risk-chip na"><span class="rdot"></span>' + rk.label + " …</span>";
      return '<span class="risk-chip ' + st.level + '"><span class="rdot"></span>' +
        rk.label + ": " + esc(st.text) + "</span>";
    }).join("");
  }

  function sectionShell(s) {
    return '<div class="rsec loading" id="' + s.id + '">' +
      '<div class="rsec-head"><span class="sico" aria-hidden="true">' + s.icon + "</span>" + s.title +
      '<span class="src-note">' + s.src + "</span></div>" +
      '<div class="rsec-body"></div></div>';
  }
  function body(id) { return document.querySelector("#" + id + " .rsec-body"); }
  function done(id) { const el = $(id); if (el) el.classList.remove("loading"); }
  function fail(id, msg) {
    done(id);
    body(id).innerHTML = '<div class="empty">⚠ ' + esc(msg || "Kunde inte hämtas just nu.") + "</div>";
  }
  const row = (k, v, cls) =>
    '<div class="rrow"><span class="k">' + k + '</span><span class="v ' + (cls || "") + '">' + v + "</span></div>";

  // ---------- huvudflödet ----------
  let runId = 0;
  let runCtrl = null;
  const runSignal = () => runCtrl && runCtrl.signal;

  async function run(lat, lng, label) {
    const my = ++runId;
    if (runCtrl) runCtrl.abort();       // avbryt förra körningens anrop på nätet
    runCtrl = new AbortController();
    const panel = $("report-panel");
    panel.classList.add("open");

    const addrEl = $("report-addr");
    addrEl.textContent = label || "Hämtar adress …";
    addrEl.focus({ preventScroll: true });
    $("report-coords").textContent = lat.toFixed(5) + "° N, " + lng.toFixed(5) + "° Ö (WGS84)";
    RISK_KEYS.forEach(rk => delete riskState[rk.key]);
    setRisk("_init", "na", "");   // rita chips i vänteläge
    $("report-sections").innerHTML = SECTIONS.map(sectionShell).join("");

    // alla sektioner startar parallellt — rapporten fylls i vågor
    secAdress(my, lat, lng, label);
    secVader(my, lat, lng);
    secFlood(my, lat, lng);
    secGeo(my, lat, lng);
    secMiljo(my, lat, lng);
    secKultur(my, lat, lng);
    secOmrade(my, lat, lng);
    secService(my, lat, lng);
  }
  const fresh = my => my === runId;

  // ---------- sektioner ----------
  async function secAdress(my, lat, lng, label) {
    if (label) return;
    try {
      const r = await C.smartFetch(C.NOMINATIM + "/reverse?lat=" + lat + "&lon=" + lng +
        "&format=jsonv2&zoom=18&addressdetails=1&accept-language=sv", 12000, runSignal());
      const j = await r.json();
      if (!fresh(my)) return;
      const a = j.address || {};
      const street = [a.road, a.house_number].filter(Boolean).join(" ");
      const place = a.city || a.town || a.village || a.municipality || "";
      $("report-addr").textContent = street ? street + ", " + place : (j.display_name || "Vald punkt").split(",").slice(0, 2).join(",");
      const kommun = a.municipality || "";
      const lan = a.state || a.county || "";
      $("report-coords").textContent = lat.toFixed(5) + "° N, " + lng.toFixed(5) + "° Ö · " +
        [kommun, lan].filter(Boolean).join(" · ");
    } catch (e) { if (fresh(my)) $("report-addr").textContent = "Vald punkt"; }
  }

  async function secVader(my, lat, lng) {
    const id = "sec-vader";
    try {
      const r = await C.smartFetch(C.SMHI_POINT(lng, lat), 15000, runSignal());
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      if (!fresh(my)) return;
      // Nya SNOW-formatet: timeSeries[i] = { time, data: { air_temperature, wind_speed, ... } }
      const ts = j.timeSeries && j.timeSeries[0];
      if (!ts || !ts.data) throw new Error("tomt svar");
      const d = ts.data;
      const num = v => (v == null || isNaN(v)) ? null : Number(v);
      const t = num(d.air_temperature), ws = num(d.wind_speed),
            gust = num(d.wind_speed_of_gust), rh = num(d.relative_humidity);
      let cloud = num(d.cloud_area_fraction);
      if (cloud != null) cloud = Math.round(cloud <= 1 ? cloud * 100 : cloud);
      const precipKey = Object.keys(d).find(k => /precipitation/.test(k) && /amount|mean|rate/.test(k));
      const nb = precipKey ? num(d[precipKey]) : null;
      done(id);
      body(id).innerHTML =
        (t != null ? row("Temperatur", t.toFixed(0) + " °C") : "") +
        (ws != null ? row("Vind", ws.toFixed(0) + (gust != null ? " m/s (byar " + gust.toFixed(0) + ")" : " m/s")) : "") +
        (cloud != null ? row("Molnighet", cloud + " %") : "") +
        (rh != null ? row("Luftfuktighet", Math.round(rh) + " %") : "") +
        (nb != null && nb > 0 ? row("Nederbörd", nb.toFixed(1).replace(".", ",") + " mm/h") : "") +
        '<p class="note">SMHI:s punktprognos (SNOW-modellen) för närmaste timme.</p>';
    } catch (e) { if (fresh(my)) fail(id, "SMHI-prognosen kunde inte hämtas."); }
  }

  async function secFlood(my, lat, lng) {
    const id = "sec-flood";
    const kustId = window.KARTA ? window.KARTA.getKustLevel() : 9;
    const kustLabel = (C.KUST_LEVELS.find(k => k.id === kustId) || {}).label || "";
    const [kartRes, kustRes] = await Promise.allSettled([
      arcgisIdentify(C.MSB_KART_REST, "2,3,4,5,15", lat, lng, 2, 600),
      arcgisQueryHit(C.MSB_KUST_REST, kustId, lat, lng)
    ]);
    if (!fresh(my)) return;
    done(id);
    let html = "";
    if (kartRes.status === "fulfilled") {
      const names = [...new Set((kartRes.value.results || []).map(h => h.layerName))];
      if (names.length) {
        setRisk("flod", "risk", "träff");
        html += row("Vattendragsöversvämning", "TRÄFF", "risk");
        names.forEach(n => { html += row("• zon", esc(n), "warn"); });
      } else {
        setRisk("flod", "ok", "ingen känd");
        html += row("Vattendragsöversvämning", "Ingen känd träff", "ok");
      }
    } else {
      setRisk("flod", "na", "okänt");
      html += row("Vattendragsöversvämning", "källan svarar inte just nu", "warn");
    }
    if (kustRes.status === "fulfilled") {
      if (kustRes.value) {
        setRisk("kust", "risk", "träff vid " + kustLabel.replace(" havsnivå", ""));
        html += row("Kustöversvämning (" + esc(kustLabel) + ")", "TRÄFF", "risk");
      } else {
        setRisk("kust", "ok", "ingen vid " + kustLabel.replace(" havsnivå", ""));
        html += row("Kustöversvämning (" + esc(kustLabel) + ")", "Ingen känd träff", "ok");
      }
    } else {
      setRisk("kust", "na", "okänt");
      html += row("Kustöversvämning", "källan svarar inte just nu", "warn");
    }
    html += '<p class="note">MSB:s karteringar täcker utpekade vattendrag och kuststräckor — ' +
      "avsaknad av träff kan bero på att området inte är karterat. Nivå väljs i lagerpanelen. " +
      "Svarar en källa inte: klicka på punkten igen för ett nytt försök.</p>";
    body(id).innerHTML = html;
  }

  function pickProps(feature, patterns, max) {
    const props = feature && feature.properties || {};
    const keys = Object.keys(props);
    const picked = [];
    patterns.forEach(re => keys.forEach(k => {
      if (re.test(k) && props[k] != null && props[k] !== "" && !picked.find(p => p[0] === k)) picked.push([k, props[k]]);
    }));
    keys.forEach(k => {
      if (picked.length < (max || 4) && !picked.find(p => p[0] === k) &&
          typeof props[k] === "string" && props[k] && props[k].length < 80) picked.push([k, props[k]]);
    });
    return picked.slice(0, max || 4);
  }

  async function secGeo(my, lat, lng) {
    const id = "sec-geo";
    const jobs = [
      { name: "Jordart (grundlager)", layers: C.SGU_GFI_LAYERS.jordarter, re: [/jordart/i, /jg\d/i, /beskr/i] },
      { name: "Genomsläpplighet", layers: C.SGU_GFI_LAYERS.genomslapplighet, re: [/genoms/i, /klass/i] },
      { name: "Berggrund", layers: C.SGU_GFI_LAYERS.berggrund, re: [/bergart/i, /rock/i, /lito/i, /beskr/i] }
    ];
    const out = await Promise.allSettled(jobs.map(j => gfiJson(C.SGU_GFI, j.layers, lat, lng, 40)));
    if (!fresh(my)) return;
    done(id);
    let html = "", any = false;
    out.forEach((res, i) => {
      const j = jobs[i];
      if (res.status === "fulfilled" && res.value.features && res.value.features.length) {
        any = true;
        const picked = pickProps(res.value.features[0], j.re, 2);
        const val = picked.length ? picked.map(p => esc(p[1])).join(" · ") : "träff (se kartan)";
        html += row(j.name, val);
      } else if (res.status === "fulfilled") {
        html += row(j.name, "Ingen data på punkten", "");
      } else {
        html += row(j.name, "källan svarar inte just nu", "warn");
      }
    });
    html += '<p class="note">Tänd SGU-lagren i panelen för kartbild och teckenförklaring. ' +
      "Jordart ger tidiga signaler om grundläggning och dagvatten — ersätter inte geoteknisk undersökning.</p>";
    body(id).innerHTML = html || '<div class="empty">Ingen geologidata.</div>';
  }

  async function secMiljo(my, lat, lng) {
    const id = "sec-miljo";
    let html = "";
    // Skyddad natur (NVV, GetFeatureInfo via proxy — esri_wms-XML)
    try {
      const feats = await gfiEsri(C.NVV_WMS, C.NVV_LAYERS, lat, lng, 80, 20);
      if (!fresh(my)) return;
      if (feats.length) {
        setRisk("natur", "warn", "inom skydd");
        feats.slice(0, 4).forEach(f => {
          const namn = f.NAMN || f.Namn || f.namn || "";
          const typ = f.SKYDDSTYP || f.Skyddstyp || f.SKYDDSFORM || "Skyddat område";
          html += row(esc(typ), esc(namn || "träff"), "warn");
        });
      } else {
        setRisk("natur", "ok", "utanför");
        html += row("Skyddad natur", "Punkten ligger inte i skyddat område", "ok");
      }
    } catch (e) {
      if (!fresh(my)) return;
      setRisk("natur", "na", "okänt");
      html += row("Skyddad natur", "källan svarar inte just nu", "warn");
    }
    // Förorenade områden (LST, identify via proxy — servern kan vara nere)
    try {
      const j = await arcgisIdentify(C.LST_REST, "0", lat, lng, 10, 500);
      if (!fresh(my)) return;
      const hits = j.results || [];
      if (hits.length) {
        setRisk("ebh", "risk", "indikation");
        html += row("Potentiellt förorenat område", "INDIKATION nära punkten", "risk");
        const nm = hits[0].attributes && (hits[0].attributes.Namn || hits[0].attributes.NAMN || hits[0].attributes.Bransch);
        if (nm) html += row("• objekt", esc(nm), "warn");
      } else {
        setRisk("ebh", "ok", "ingen känd");
        html += row("Potentiellt förorenat område", "Ingen känd indikation", "ok");
      }
    } catch (e) {
      if (!fresh(my)) return;
      setRisk("ebh", "na", "källa nere");
      html += row("Potentiellt förorenat område", "källan svarar inte just nu", "warn");
    }
    done(id);
    html += '<p class="note">EBH-registret är inte heltäckande: ett område kan vara förorenat även om uppgift saknas.</p>';
    body(id).innerHTML = html;
  }

  async function secKultur(my, lat, lng) {
    const id = "sec-kultur";
    try {
      const j = await gfiJson(C.RAA_WMS, C.RAA_LAYERS, lat, lng, 150, 50);
      if (!fresh(my)) return;
      done(id);
      const feats = j.features || [];
      if (feats.length) {
        setRisk("kultur", "warn", feats.length + " nära");
        let html = row("Lämningar inom ~150 m", String(feats.length), "warn");
        feats.slice(0, 5).forEach(f => {
          const p = f.properties || {};
          const typ = p.lamningstyp || p.lamningstyp_namn || String(f.id || "").split(".")[0];
          const nr = p.lamningsnummer || p.raa_nummer || "";
          html += row("• " + esc(typ || "lämning"), esc(nr || "se Fornsök"));
        });
        html += '<p class="note">Fornlämningar har automatiskt skydd enligt kulturmiljölagen. Kontrollera i Fornsök och kontakta länsstyrelsen tidigt.</p>';
        body(id).innerHTML = html;
      } else {
        setRisk("kultur", "ok", "inga kända");
        body(id).innerHTML = row("Lämningar inom ~150 m", "Inga kända", "ok") +
          '<p class="note">Okända fornlämningar kan ändå finnas — särskilt i orörd mark.</p>';
      }
    } catch (e) {
      if (!fresh(my)) return;
      setRisk("kultur", "na", "okänt");
      fail(id, "RAÄ:s tjänst kunde inte nås.");
    }
  }

  async function secOmrade(my, lat, lng) {
    const id = "sec-omrade";
    const p = toMerc(lat, lng);
    const bb = [p.x - 5, p.y - 5, p.x + 5, p.y + 5].join(",") + ",EPSG:3857";
    const wfs = t => C.SCB_WFS + "?service=WFS&version=1.1.0&request=GetFeature&typeName=" +
      encodeURIComponent(t) + "&bbox=" + bb + "&srsName=EPSG:3857&outputFormat=application/json&maxFeatures=3";
    try {
      const [ruta, deso] = await Promise.allSettled([
        C.smartFetch(wfs("stat:befolkning_1km_2024"), 20000, runSignal()).then(r => r.json()),
        C.smartFetch(wfs("stat:DeSO_2025"), 20000, runSignal()).then(r => r.json())
      ]);
      if (!fresh(my)) return;
      done(id);
      let html = "";
      if (ruta.status === "fulfilled" && ruta.value.features && ruta.value.features.length) {
        const props = ruta.value.features[0].properties || {};
        const totKey = Object.keys(props).find(k => /^(beftot|tot|pop|bef)/i.test(k) && typeof props[k] === "number");
        if (totKey) html += row("Befolkning i km²-rutan", "<b>" + props[totKey] + "</b> personer");
        // åldersstaplar om det finns åldersnycklar
        const ages = Object.keys(props).filter(k => /ald|alder|age/i.test(k) && typeof props[k] === "number");
        if (ages.length >= 3) {
          const mx = Math.max(...ages.map(k => props[k]), 1);
          html += '<div class="minibar-wrap"><div class="minibar">' + ages.slice(0, 8).map(k =>
            '<div class="bar" style="height:' + Math.max(4, Math.round(props[k] / mx * 100)) + '%">' +
            "<span>" + prettyKey(k).replace(/ald(er)?/i, "").trim() + "</span></div>"
          ).join("") + "</div></div>";
        } else {
          Object.keys(props).filter(k => typeof props[k] === "number").slice(0, 5).forEach(k => {
            if (k !== totKey) html += row(prettyKey(k), String(props[k]));
          });
        }
      } else {
        html += row("Befolkning i km²-rutan", "ingen data (obebodd ruta?)");
      }
      if (deso.status === "fulfilled" && deso.value.features && deso.value.features.length) {
        const dp = deso.value.features[0].properties || {};
        const code = dp.deso || dp.Deso || dp.DESO || "";
        const kn = dp.kommunnamn || dp.kommun || "";
        if (code) html += row("DeSO-område", esc(code) + (kn ? " · " + esc(kn) : ""));
      }
      html += '<p class="note">SCB:s öppna geodata (CC0). DeSO = SCB:s demografiska statistikområden (ca 700–2 700 invånare). ' +
        'Rutstatistik är områdesdata — inte uppgifter om enskilda fastigheter.</p>';
      body(id).innerHTML = html;
    } catch (e) { if (fresh(my)) fail(id, "SCB:s tjänst kunde inte nås."); }
  }

  async function secService(my, lat, lng) {
    const id = "sec-service";
    const around = (q) => "node(around:800," + lat + "," + lng + ")" + q + ";";
    let q = "[out:json][timeout:25];(";
    C.POI_CATS.forEach(c => {
      q += around(c.q);
      if (c.alt) q += around(c.alt);
    });
    q += 'way(around:800,' + lat + "," + lng + ')["leisure"="playground"];';
    q += ");out center 80;";
    try {
      const r = await C.smartFetch(C.OVERPASS + "?data=" + encodeURIComponent(q), 30000, runSignal());
      if (!r.ok) throw new Error("HTTP " + r.status);
      const j = await r.json();
      if (!fresh(my)) return;
      done(id);
      const els = j.elements || [];
      const cats = {};
      els.forEach(el => {
        const t = el.tags || {};
        const elat = el.lat || (el.center && el.center.lat), elon = el.lon || (el.center && el.center.lon);
        if (elat == null) return;
        const d = haversine(lat, lng, elat, elon);
        let key = null;
        if (t.highway === "bus_stop" || /station|tram_stop|halt/.test(t.railway || "")) key = "hallplats";
        else if (t.amenity === "school") key = "skola";
        else if (t.amenity === "kindergarten") key = "forskola";
        else if (/clinic|doctors|hospital/.test(t.amenity || "")) key = "vard";
        else if (t.amenity === "pharmacy") key = "apotek";
        else if (/supermarket|convenience/.test(t.shop || "")) key = "livs";
        else if (t.leisure === "playground") key = "lek";
        else if (t.amenity === "charging_station") key = "ladd";
        if (!key) return;
        if (!cats[key]) cats[key] = { n: 0, best: null };
        cats[key].n++;
        if (!cats[key].best || d < cats[key].best.d) cats[key].best = { d, name: t.name || "" };
      });
      let html = '<ul class="poi-list">';
      C.POI_CATS.forEach(c => {
        const hit = cats[c.key];
        if (hit) {
          html += "<li><span class='pn'>" + c.label +
            (hit.best.name ? " · " + esc(hit.best.name) : "") +
            (hit.n > 1 ? " <small>(+" + (hit.n - 1) + " till)</small>" : "") +
            "</span><span class='pd'>" + fmtDist(hit.best.d) + "</span></li>";
        } else {
          html += "<li><span class='pn'>" + c.label + "</span><span class='pd'>— &gt;800 m</span></li>";
        }
      });
      html += "</ul><p class='note'>Fågelvägsavstånd inom 800 m (ringarna i kartan: 250/500/800 m). Gångvägar kan vara längre.</p>";
      body(id).innerHTML = html;
    } catch (e) { if (fresh(my)) fail(id, "OpenStreetMap/Overpass kunde inte nås."); }
  }

  // ---------- sök (Nominatim, snäll mot tjänsten) ----------
  const input = $("search-input"), results = $("search-results");
  let debounceT = null, lastHits = [];

  input.addEventListener("input", () => {
    clearTimeout(debounceT);
    lastHits = [];                      // gamla träffar gäller inte ny text
    const q = input.value.trim();
    if (q.length < 2) { results.classList.remove("open"); return; }
    debounceT = setTimeout(() => doSearch(q), 900);
  });
  input.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      if (lastHits.length) { pick(lastHits[0]); return; }
      clearTimeout(debounceT);          // Enter = sök direkt, vänta inte på debounce
      const q = input.value.trim();
      if (q.length >= 2) doSearch(q);
    }
    if (e.key === "Escape") results.classList.remove("open");
  });
  document.addEventListener("click", e => {
    if (!e.target.closest(".searchbox")) results.classList.remove("open");
  });

  async function doSearch(q) {
    results.innerHTML = '<div class="hint">Söker …</div>';
    results.classList.add("open");
    try {
      const r = await C.smartFetch(C.NOMINATIM + "/search?q=" + encodeURIComponent(q) +
        "&format=jsonv2&limit=5&countrycodes=se&addressdetails=1&accept-language=sv", 12000);
      const j = await r.json();
      lastHits = j;
      if (!j.length) { results.innerHTML = '<div class="hint">Inga träffar i Sverige.</div>'; return; }
      results.innerHTML = "";
      j.forEach(hit => {
        const b = document.createElement("button");
        b.textContent = hit.display_name.split(",").slice(0, 3).join(",");
        b.addEventListener("click", () => pick(hit));
        results.appendChild(b);
      });
    } catch (e) { results.innerHTML = '<div class="hint">Sökningen misslyckades — prova igen.</div>'; }
  }
  function pick(hit) {
    results.classList.remove("open");
    input.value = hit.display_name.split(",").slice(0, 2).join(",");
    const label = hit.display_name.split(",").slice(0, 2).join(",");
    window.KARTA.setPoint(parseFloat(hit.lat), parseFloat(hit.lon), { label });
  }

  // ---------- knappar ----------
  $("report-close").addEventListener("click", () => $("report-panel").classList.remove("open"));
  document.addEventListener("keydown", e => {
    if (e.key === "Escape") $("report-panel").classList.remove("open");
  });
  $("btn-print").addEventListener("click", () => window.print());
  $("btn-share").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      const b = $("btn-share"); const t = b.innerHTML;
      b.textContent = "✓ Kopierad!";
      setTimeout(() => { b.innerHTML = t; }, 1600);
    } catch (e) { alert("Kopiera adressfältets länk manuellt."); }
  });

  return { run };
})();
