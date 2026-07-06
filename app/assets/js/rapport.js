/* ============================================================
   rapport.js — platsrapportens huvudflöde: panelens skelett,
   riskchips, körningskontroll (avbryt gamla anrop), sökrutan
   och knapparna. Sektionerna bor i sektioner-plats.js och
   sektioner-samhalle.js; protokollklienterna i lib/geoclients.js.
   ============================================================ */

window.ANALYS = (function () {
  const C = window.CFG;

  // ---------- småverktyg ----------
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  const prettyKey = k => esc(String(k).replace(/[_-]+/g, " ").replace(/^./, c => c.toUpperCase()));

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

  // ---------- körningskontroll ----------
  let runId = 0;
  let runCtrl = null;
  const fresh = my => my === runId;
  const runSignal = () => runCtrl && runCtrl.signal;

  // sektionerna får rapportens hjälpfunktioner via fabrikerna
  const ui = { fresh, body, done, fail, row, setRisk, esc, prettyKey, signal: runSignal };
  const sek = Object.assign({}, window.SEKTIONER_PLATS(ui), window.SEKTIONER_SAMHALLE(ui));

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
    sek.adress(my, lat, lng, label);
    sek.vader(my, lat, lng);
    sek.flood(my, lat, lng);
    sek.geo(my, lat, lng);
    sek.miljo(my, lat, lng);
    sek.kultur(my, lat, lng);
    sek.omrade(my, lat, lng);
    sek.service(my, lat, lng);
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
    if (e.key === "ArrowDown") {
      const first = results.querySelector("button");
      if (first) { first.focus(); e.preventDefault(); }
    }
    if (e.key === "Escape") results.classList.remove("open");
  });
  // piltangenter i träfflistan
  results.addEventListener("keydown", e => {
    const btns = [...results.querySelectorAll("button")];
    const i = btns.indexOf(document.activeElement);
    if (i === -1) return;
    if (e.key === "ArrowDown" && btns[i + 1]) { btns[i + 1].focus(); e.preventDefault(); }
    if (e.key === "ArrowUp") { (btns[i - 1] || input).focus(); e.preventDefault(); }
    if (e.key === "Escape") { results.classList.remove("open"); input.focus(); }
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
