/**
 * /api/geo?u=<url> — minimal vidarebefordran (CORS-brygga).
 *
 * Vissa myndighetstjänster (SGU resource, SMHI, Naturvårdsverket, Länsstyrelserna)
 * skickar inte CORS-headers och kan därför inte anropas direkt från
 * webbläsaren. Den här funktionen vidarebefordrar GET-anrop till en HÅRD
 * ALLOWLIST av värdar. Inga nycklar, inga cookies, ingen loggning av innehåll.
 *
 * Lägg ALDRIG till värdar slentrianmässigt — bara öppna myndighets-API:er
 * som verifierats sakna CORS-stöd.
 *
 * OBS: håll listan i synk med PROXY_HOSTS i app/assets/js/config.js
 * (frontendens lista avgör vilka anrop som faktiskt går via proxyn).
 */
const { app } = require("@azure/functions");

const ALLOWED_HOSTS = new Set([
  "resource.sgu.se",
  "opendata-download-metfcst.smhi.se",
  "geodata.naturvardsverket.se",
  "ext-geodata-nationella.lansstyrelsen.se",
  "ext-geodata.lansstyrelsen.se"
]);

// Bara sajtens egna origins får använda proxyn (stoppar andra webbplatser
// från att låna den som gratis CORS-brygga). Anrop utan Origin/Referer
// (curl, samma origin) släpps igenom — proxyn är ändå bara GET mot
// publika myndighetsservrar.
const ALLOWED_ORIGINS = [
  "https://purple-bush-015972603.7.azurestaticapps.net",
  "https://samhallsbyggare.projektledarpodden.se",
  "http://localhost:4280", // swa start (lokal utveckling)
  "http://localhost:3060"
];

// Svarstyper vi förväntar oss från WMS/REST-tjänsterna. Allt annat
// (särskilt text/html) skrivs om till text/plain så att en reflekterande
// endpoint hos en godkänd värd inte kan köra skript på vår origin.
const SAFE_TYPES = /^(application\/(json|geo\+json|xml|vnd\.ogc\.[\w.-]+)|text\/(xml|plain)|image\/(png|jpeg|gif|svg\+xml))/i;

const TIMEOUT_MS = 25000;
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB räcker gott för GetFeatureInfo/JSON

app.http("geo", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (request, context) => {
    const from = request.headers.get("origin") || request.headers.get("referer") || "";
    if (from && !ALLOWED_ORIGINS.some(o => from === o || from.startsWith(o + "/"))) {
      return json(403, { error: "Proxyn är bara till för Samhällsbyggarkartan" });
    }

    const raw = request.query.get("u");
    if (!raw) return json(400, { error: "Ange ?u=<url>" });

    let target;
    try { target = new URL(raw); }
    catch { return json(400, { error: "Ogiltig URL" }); }

    if (target.protocol !== "https:") return json(400, { error: "Endast https" });
    if (target.port && target.port !== "443") return json(400, { error: "Endast standardport" });
    if (!ALLOWED_HOSTS.has(target.hostname)) {
      return json(403, { error: "Värden är inte i godkänd lista", host: target.hostname });
    }

    try {
      const upstream = await fetch(target.toString(), {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        redirect: "error", // en redirect kunde annars lämna allowlisten (SSRF)
        headers: { "User-Agent": "samhallsbyggarkartan.se (oppen demo, github.com/VisionInno/samhallsbyggare)" }
      });

      const declared = parseInt(upstream.headers.get("content-length") || "0", 10);
      if (declared > MAX_BYTES) return json(502, { error: "Svaret var för stort" });

      // Läs strömmande och avbryt direkt om taket passeras — buffra inte
      // först och kontrollera sen.
      const reader = upstream.body.getReader();
      const chunks = [];
      let total = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > MAX_BYTES) {
          reader.cancel();
          return json(502, { error: "Svaret var för stort" });
        }
        chunks.push(value);
      }
      const buf = Buffer.concat(chunks);

      const upstreamType = upstream.headers.get("content-type") || "application/octet-stream";
      const contentType = SAFE_TYPES.test(upstreamType) ? upstreamType : "text/plain; charset=utf-8";

      return {
        status: upstream.status,
        headers: {
          "Content-Type": contentType,
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "public, max-age=600"
        },
        body: buf
      };
    } catch (err) {
      context.warn("Uppströmsfel mot " + target.hostname + ": " + err.message);
      return json(502, { error: "Källan svarade inte", host: target.hostname });
    }
  }
});

function json(status, obj) {
  return {
    status,
    headers: { "Content-Type": "application/json", "X-Content-Type-Options": "nosniff" },
    jsonBody: obj
  };
}
