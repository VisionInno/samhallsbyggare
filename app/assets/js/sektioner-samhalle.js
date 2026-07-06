/* ============================================================
   sektioner-samhalle.js — rapportsektioner om samhället runt
   platsen: adress (Nominatim), kulturmiljö (RAÄ), befolkning (SCB),
   närhet & service (Overpass/OSM). Fabrik: rapport.js skickar in
   ui-hjälpare { fresh, body, done, fail, row, setRisk, esc,
   prettyKey, signal }.
   ============================================================ */

window.SEKTIONER_SAMHALLE = function (ui) {
  const C = window.CFG, G = window.GEO;
  const { fresh, body, done, fail, row, setRisk, esc, prettyKey, signal } = ui;
  const $ = id => document.getElementById(id);

  async function adress(my, lat, lng, label) {
    if (label) return;
    try {
      const r = await C.smartFetch(C.NOMINATIM + "/reverse?lat=" + lat + "&lon=" + lng +
        "&format=jsonv2&zoom=18&addressdetails=1&accept-language=sv", 12000, signal());
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

  async function kultur(my, lat, lng) {
    const id = "sec-kultur";
    try {
      const j = await G.gfiJson(C.RAA_WMS, C.RAA_LAYERS, lat, lng, 150, 50, signal());
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

  async function omrade(my, lat, lng) {
    const id = "sec-omrade";
    const p = G.toMerc(lat, lng);
    const bb = [p.x - 5, p.y - 5, p.x + 5, p.y + 5].join(",") + ",EPSG:3857";
    const wfs = t => C.SCB_WFS + "?service=WFS&version=1.1.0&request=GetFeature&typeName=" +
      encodeURIComponent(t) + "&bbox=" + bb + "&srsName=EPSG:3857&outputFormat=application/json&maxFeatures=3";
    try {
      const [ruta, deso] = await Promise.allSettled([
        C.smartFetch(wfs("stat:befolkning_1km_2024"), 20000, signal()).then(r => r.json()),
        C.smartFetch(wfs("stat:DeSO_2025"), 20000, signal()).then(r => r.json())
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

  async function service(my, lat, lng) {
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
      const r = await C.smartFetch(C.OVERPASS + "?data=" + encodeURIComponent(q), 30000, signal());
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
        const d = G.haversine(lat, lng, elat, elon);
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
            "</span><span class='pd'>" + G.fmtDist(hit.best.d) + "</span></li>";
        } else {
          html += "<li><span class='pn'>" + c.label + "</span><span class='pd'>— &gt;800 m</span></li>";
        }
      });
      html += "</ul><p class='note'>Fågelvägsavstånd inom 800 m (ringarna i kartan: 250/500/800 m). Gångvägar kan vara längre.</p>";
      body(id).innerHTML = html;
    } catch (e) { if (fresh(my)) fail(id, "OpenStreetMap/Overpass kunde inte nås."); }
  }

  return { adress, kultur, omrade, service };
};
