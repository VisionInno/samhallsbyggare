/**
 * /api/geo?u=<url> — minimal vidarebefordran (CORS-brygga).
 *
 * Vissa myndighetstjänster (SGU, SMHI, Naturvårdsverket, Länsstyrelserna)
 * skickar inte CORS-headers och kan därför inte anropas direkt från
 * webbläsaren. Den här funktionen vidarebefordrar GET-anrop till en HÅRD
 * ALLOWLIST av värdar. Inga nycklar, inga cookies, ingen loggning av innehåll.
 *
 * Lägg ALDRIG till värdar slentrianmässigt — bara öppna myndighets-API:er
 * som verifierats sakna CORS-stöd.
 */
const { app } = require("@azure/functions");

const ALLOWED_HOSTS = new Set([
  "resource.sgu.se",
  "maps3.sgu.se",
  "opendata-download-metfcst.smhi.se",
  "geodata.naturvardsverket.se",
  "ext-geodata-nationella.lansstyrelsen.se",
  "ext-geodata.lansstyrelsen.se"
]);

const TIMEOUT_MS = 25000;
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB räcker gott för GetFeatureInfo/JSON

app.http("geo", {
  methods: ["GET"],
  authLevel: "anonymous",
  handler: async (request, context) => {
    const raw = request.query.get("u");
    if (!raw) return json(400, { error: "Ange ?u=<url>" });

    let target;
    try { target = new URL(raw); }
    catch { return json(400, { error: "Ogiltig URL" }); }

    if (target.protocol !== "https:") return json(400, { error: "Endast https" });
    if (!ALLOWED_HOSTS.has(target.hostname)) {
      return json(403, { error: "Värden är inte i godkänd lista", host: target.hostname });
    }

    try {
      const upstream = await fetch(target.toString(), {
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { "User-Agent": "samhallsbyggarkartan.se (oppen demo, github.com/VisionInno/samhallsbyggare)" }
      });

      const buf = Buffer.from(await upstream.arrayBuffer());
      if (buf.length > MAX_BYTES) return json(502, { error: "Svaret var för stort" });

      return {
        status: upstream.status,
        headers: {
          "Content-Type": upstream.headers.get("content-type") || "application/octet-stream",
          "Cache-Control": "public, max-age=600",
          "Access-Control-Allow-Origin": "*"
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
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    jsonBody: obj
  };
}
