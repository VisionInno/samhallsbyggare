/* ============================================================
   sektioner-plats.js — rapportsektioner om platsens fysik:
   väder (SMHI), översvämning (MSB), geologi (SGU), natur &
   förorening (NVV/LST). Fabrik: rapport.js skickar in ui-hjälpare
   { fresh, body, done, fail, row, setRisk, esc, signal }.
   ============================================================ */

window.SEKTIONER_PLATS = function (ui) {
  const C = window.CFG, G = window.GEO;
  const { fresh, body, done, fail, row, setRisk, esc, signal } = ui;

  async function vader(my, lat, lng) {
    const id = "sec-vader";
    try {
      const r = await C.smartFetch(C.SMHI_POINT(lng, lat), 15000, signal());
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

  async function flood(my, lat, lng) {
    const id = "sec-flood";
    const kustId = window.KARTA ? window.KARTA.getKustLevel() : 9;
    const kustLabel = (C.KUST_LEVELS.find(k => k.id === kustId) || {}).label || "";
    const [kartRes, kustRes] = await Promise.allSettled([
      G.arcgisIdentify(C.MSB_KART_REST, "2,3,4,5,15", lat, lng, 2, 600, signal()),
      G.arcgisQueryHit(C.MSB_KUST_REST, kustId, lat, lng, signal())
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

  async function geo(my, lat, lng) {
    const id = "sec-geo";
    const jobs = [
      { name: "Jordart (grundlager)", layers: C.SGU_GFI_LAYERS.jordarter, re: [/jordart/i, /jg\d/i, /beskr/i] },
      { name: "Genomsläpplighet", layers: C.SGU_GFI_LAYERS.genomslapplighet, re: [/genoms/i, /klass/i] },
      { name: "Berggrund", layers: C.SGU_GFI_LAYERS.berggrund, re: [/bergart/i, /rock/i, /lito/i, /beskr/i] }
    ];
    const out = await Promise.allSettled(jobs.map(j => G.gfiJson(C.SGU_GFI, j.layers, lat, lng, 40, undefined, signal())));
    if (!fresh(my)) return;
    done(id);
    let html = "";
    out.forEach((res, i) => {
      const j = jobs[i];
      if (res.status === "fulfilled" && res.value.features && res.value.features.length) {
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

  async function miljo(my, lat, lng) {
    const id = "sec-miljo";
    let html = "";
    // Skyddad natur (NVV, GetFeatureInfo via proxy — esri_wms-XML)
    try {
      const feats = await G.gfiEsri(C.NVV_WMS, C.NVV_LAYERS, lat, lng, 80, 20, signal());
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
      const j = await G.arcgisIdentify(C.LST_REST, "0", lat, lng, 10, 500, signal());
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

  return { vader, flood, geo, miljo };
};
