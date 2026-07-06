/* ============================================================
   karta.js — kartan, baskartan, lagerpanelen och markören.
   ============================================================ */

window.KARTA = (function () {
  const C = window.CFG;

  // ---------- karta ----------
  const map = L.map("map", {
    center: [59.334, 18.063], // Stockholm som start
    zoom: 6,
    zoomControl: false,
    attributionControl: true
  });
  L.control.zoom({ position: "bottomright" }).addTo(map);
  map.attributionControl.setPrefix(false);
  map.attributionControl.addAttribution(
    'Basdata © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · <a href="https://openfreemap.org">OpenFreeMap</a>'
  );

  // Vektorbaskarta (OpenFreeMap via MapLibre GL). Faller tillbaka till OSM-raster.
  let basemapOk = false;
  let glLayer = null;
  try {
    if (window.maplibregl && L.maplibreGL) {
      glLayer = L.maplibreGL({ style: C.BASEMAP_STYLE, attribution: "" });
      glLayer.addTo(map);
      basemapOk = true;
    }
  } catch (e) { console.warn("Vektorbaskartan kunde inte laddas:", e); }
  if (!basemapOk) {
    L.tileLayer(C.BASEMAP_FALLBACK.url, { attribution: C.BASEMAP_FALLBACK.attribution, maxZoom: 19 }).addTo(map);
  }

  // ---------- overlays ----------
  const active = {};   // layerId -> L.tileLayer.wms
  const defs = {};     // layerId -> definition

  function makeWms(def) {
    const params = Object.assign({
      format: "image/png", transparent: true, version: "1.1.1"
    }, def.params);
    const layer = L.tileLayer.wms(def.wms, Object.assign({}, params, {
      opacity: def.opacity == null ? 0.65 : def.opacity,
      attribution: def.src,
      tiled: true,
      maxZoom: 19
    }));
    layer.on("tileerror", () => { noteFlaky(def.id); });
    return layer;
  }

  let flakyNoted = {};
  function noteFlaky(id) {
    if (flakyNoted[id]) return;
    flakyNoted[id] = true;
    const el = document.querySelector('[data-lnote="' + id + '"]');
    if (el) el.textContent = "⚠ källan svarar inte just nu";
  }

  function legendUrl(def) {
    const layerName = def.legendLayer || (def.params && def.params.layers || "").split(",")[0];
    return def.wms + "?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetLegendGraphic&FORMAT=image/png&LAYER=" +
      encodeURIComponent(layerName);
  }

  // ---------- panelbygge ----------
  function buildPanel() {
    const root = document.getElementById("layer-groups");
    C.LAYER_GROUPS.forEach(group => {
      const details = document.createElement("details");
      details.className = "layer-group";
      if (group.open) details.open = true;
      details.innerHTML =
        '<summary><span class="dot" style="background:' + group.color + '"></span>' +
        group.title +
        '<svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="m6 9 6 6 6-6"/></svg>' +
        "</summary>";

      group.layers.forEach(def => {
        defs[def.id] = def;
        const row = document.createElement("div");
        row.className = "layer-row";

        const noteHtml = def.note
          ? ' <span class="lsrc" data-lnote="' + def.id + '">(' + def.note + ")</span>"
          : ' <span class="lsrc" data-lnote="' + def.id + '"></span>';

        row.innerHTML =
          '<label><input type="checkbox" data-layer="' + def.id + '"' + (def.on ? " checked" : "") + ">" +
          '<span class="lname">' + def.title +
          '<span class="lsrc">' + def.src + "</span>" + noteHtml + "</span></label>" +
          (def.kustSelect ? kustSelectHtml() : "") +
          '<input type="range" min="10" max="100" value="' + Math.round((def.opacity || 0.65) * 100) +
          '" data-op="' + def.id + '" title="Genomskinlighet" style="display:none">' +
          (def.legendLayer ? '<div class="layer-legend" data-legend="' + def.id + '" style="display:none"></div>' : "");

        details.appendChild(row);
      });
      root.appendChild(details);
    });

    // händelser
    root.addEventListener("change", e => {
      const t = e.target;
      if (t.matches("input[type=checkbox][data-layer]")) toggleLayer(t.dataset.layer, t.checked);
      if (t.matches("select[data-kust]")) swapKustLevel(t.value);
    });
    root.addEventListener("input", e => {
      const t = e.target;
      if (t.matches("input[type=range][data-op]")) {
        const l = active[t.dataset.op];
        if (l) l.setOpacity(t.value / 100);
      }
    });

    // tänd förvalda lager
    Object.values(defs).forEach(d => { if (d.on) toggleLayer(d.id, true, true); });
  }

  function kustSelectHtml() {
    return '<select class="kust-select" data-kust>' +
      C.KUST_LEVELS.map(k =>
        '<option value="' + k.id + '"' + (k.id === 9 ? " selected" : "") + ">" + k.label + "</option>"
      ).join("") + "</select>";
  }

  function toggleLayer(id, on, silent) {
    const def = defs[id];
    if (!def) return;
    const op = document.querySelector('input[data-op="' + id + '"]');
    const lg = document.querySelector('[data-legend="' + id + '"]');
    if (on) {
      if (!active[id]) { active[id] = makeWms(def); active[id].addTo(map); }
      if (op) op.style.display = "";
      if (lg) {
        lg.style.display = "";
        if (!lg.dataset.loaded) {
          lg.dataset.loaded = "1";
          const img = new Image();
          img.alt = "Teckenförklaring " + def.title;
          img.onerror = () => { lg.style.display = "none"; };
          img.src = legendUrl(def);
          lg.appendChild(img);
        }
      }
    } else {
      if (active[id]) { map.removeLayer(active[id]); delete active[id]; }
      if (op) op.style.display = "none";
      if (lg) lg.style.display = "none";
    }
    const box = document.querySelector('input[data-layer="' + id + '"]');
    if (box && !silent) box.checked = on;
  }

  let kustLayerId = 9;
  function swapKustLevel(newId) {
    kustLayerId = parseInt(newId, 10);
    const def = defs["msbkust"];
    def.params.layers = String(kustLayerId);
    if (active["msbkust"]) {
      map.removeLayer(active["msbkust"]);
      active["msbkust"] = makeWms(def);
      active["msbkust"].addTo(map);
      const op = document.querySelector('input[data-op="msbkust"]');
      if (op) active["msbkust"].setOpacity(op.value / 100);
    }
    // uppdatera ev. pågående rapport nästa gång
  }

  // ---------- vald punkt ----------
  let marker = null;
  const rings = [];
  const pinIcon = L.divIcon({
    className: "sel-marker",
    html: '<svg width="38" height="48" viewBox="0 0 38 48"><path d="M19 1C9.6 1 2 8.6 2 18c0 12.4 17 29 17 29s17-16.6 17-29C36 8.6 28.4 1 19 1Z" fill="#C8722C" stroke="#8F4E17" stroke-width="1.5"/><circle cx="19" cy="18" r="7" fill="#fff"/></svg>',
    iconSize: [38, 48], iconAnchor: [19, 47]
  });

  function setPoint(lat, lng, opts) {
    opts = opts || {};
    if (marker) map.removeLayer(marker);
    rings.forEach(r => map.removeLayer(r));
    rings.length = 0;

    marker = L.marker([lat, lng], { icon: pinIcon }).addTo(map);
    [250, 500, 800].forEach((r, i) => {
      rings.push(L.circle([lat, lng], {
        radius: r, color: "#0E5B63", weight: 1.2, opacity: 0.55 - i * 0.12,
        fillColor: "#0E5B63", fillOpacity: 0.04, interactive: false, dashArray: "4 6"
      }).addTo(map));
    });

    const welcome = document.getElementById("map-welcome");
    if (welcome) welcome.style.display = "none";

    if (!opts.noFly) {
      const z = Math.max(map.getZoom(), 14);
      map.flyTo([lat, lng], z, { duration: 0.8 });
    }
    location.hash = "p=" + lat.toFixed(5) + "," + lng.toFixed(5);
    if (window.ANALYS) window.ANALYS.run(lat, lng, opts.label);
  }

  map.on("click", e => setPoint(e.latlng.lat, e.latlng.lng));

  // ---------- mobil lagerpanel ----------
  const panel = document.getElementById("layer-panel");
  const ltoggle = document.getElementById("layers-toggle");
  if (ltoggle) ltoggle.addEventListener("click", () => panel.classList.toggle("open"));
  map.on("click", () => panel.classList.remove("open"));

  // ---------- min position ----------
  document.getElementById("btn-locate").addEventListener("click", () => {
    if (!navigator.geolocation) return alert("Din webbläsare saknar platstjänst.");
    navigator.geolocation.getCurrentPosition(
      pos => setPoint(pos.coords.latitude, pos.coords.longitude),
      () => alert("Kunde inte hämta din position."),
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });

  // ---------- återställ från länk (#p=lat,lng) ----------
  function restoreFromHash() {
    const m = location.hash.match(/p=([0-9.\-]+),([0-9.\-]+)/);
    if (m) {
      const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
      if (isFinite(lat) && isFinite(lng)) {
        map.setView([lat, lng], 14);
        setTimeout(() => setPoint(lat, lng, { noFly: true }), 400);
      }
    }
  }

  buildPanel();
  restoreFromHash();

  // Säkerställ att kartan (och GL-baskartan) får rätt storlek när
  // flex-layouten och typsnitten är klara — annars kan kartan bli vit.
  // OBS: GL-lagret behöver en explicit resize(), invalidateSize räcker inte.
  function nudgeSize() {
    map.invalidateSize();
    Object.values(map._layers).forEach(l => {
      if (l.getMaplibreMap) {
        const m = l.getMaplibreMap();
        if (m) { try { m.resize(); m.triggerRepaint(); } catch (e) { /* ignorera */ } }
      }
    });
  }
  window.addEventListener("resize", nudgeSize);
  window.addEventListener("load", () => setTimeout(nudgeSize, 100));
  [300, 800, 1600, 3000, 6000, 10000].forEach(ms => setTimeout(nudgeSize, ms));

  // Nudga även när GL-kartan själv är klar (style laddad resp. alla tiles ritade)
  // — det är först DÅ en repaint garanterat visar kartbilden.
  (function hookGl(tries) {
    const m = glLayer && glLayer.getMaplibreMap && glLayer.getMaplibreMap();
    if (!m) { if ((tries || 0) < 50) setTimeout(() => hookGl((tries || 0) + 1), 200); return; }
    m.on("load", nudgeSize);
    m.once("idle", nudgeSize);
    m.on("styledata", nudgeSize);
  })(0);

  return { map, setPoint, getKustLevel: () => kustLayerId };
})();
