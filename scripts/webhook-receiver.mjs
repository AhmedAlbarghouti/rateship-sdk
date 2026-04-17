#!/usr/bin/env node
/**
 * Webhook receiver for dogfooding client.webhooks.verify() against real
 * provider events. Captures raw body, logs the signature header, runs it
 * through the SDK, and prints the verification result.
 *
 * Usage:
 *   1. Start the receiver:
 *        node scripts/webhook-receiver.mjs
 *      Expects env vars SHIPPO_WEBHOOK_SECRET and/or EASYPOST_WEBHOOK_SECRET.
 *      Missing secrets mean the corresponding provider events log raw only.
 *
 *   2. In another terminal, expose it with ngrok:
 *        ngrok http 3000
 *
 *   3. Paste the https://<random>.ngrok-free.app URL into the provider
 *      webhook dashboards:
 *        Shippo:    https://apps.goshippo.com/settings/api — Webhooks → Add
 *                   Path:    <ngrok>/shippo
 *        EasyPost:  https://www.easypost.com/account/webhooks-and-events
 *                   Path:    <ngrok>/easypost
 *
 *   4. Trigger a test event from each dashboard (or wait for a real one).
 *
 *   5. This script prints what happened per request.
 */

import { createServer } from "node:http";
import { RateShip, easypost, shippo } from "../dist/index.js";

const PORT = 3000;

const shippoSecret = process.env.SHIPPO_WEBHOOK_SECRET ?? "";
const easypostSecret = process.env.EASYPOST_WEBHOOK_SECRET ?? "";

const client = new RateShip({
  providers: [
    // Auth keys aren't needed for webhook verify, but RateShip requires at
    // least one provider to construct. Dummy API keys are fine here.
    shippo({ apiKey: "placeholder" }),
    easypost({ apiKey: "placeholder" }),
  ],
});

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function providerFromPath(pathname) {
  if (pathname === "/shippo" || pathname === "/webhooks/shippo") return "shippo";
  if (pathname === "/easypost" || pathname === "/webhooks/easypost")
    return "easypost";
  return null;
}

const server = createServer(async (req, res) => {
  const now = new Date().toISOString();
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (req.method === "GET" && url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("webhook receiver ready. POST to /shippo or /easypost.\n");
    return;
  }

  if (req.method !== "POST") {
    res.writeHead(405);
    res.end();
    return;
  }

  const provider = providerFromPath(url.pathname);
  if (!provider) {
    res.writeHead(404);
    res.end();
    return;
  }

  const rawBody = await readRawBody(req);
  const headers = req.headers;

  console.log("\n" + "=".repeat(72));
  console.log(`[${now}] ${req.method} ${url.pathname} (${rawBody.length} bytes)`);

  // Log interesting headers
  const interestingHeaders = [
    "shippo-auth-signature",
    "x-hmac-signature",
    "x-easypost-hmac-signature",
    "x-shippo-timestamp",
    "user-agent",
    "content-type",
  ];
  for (const h of interestingHeaders) {
    if (headers[h]) console.log(`  ${h}: ${headers[h]}`);
  }

  // Pretty-print the body (first 500 bytes)
  const preview = rawBody.toString("utf8").slice(0, 500);
  console.log(`  body preview: ${preview}${rawBody.length > 500 ? "…" : ""}`);

  let signatureHeader = "";
  let secret = "";
  if (provider === "shippo") {
    signatureHeader = headers["shippo-auth-signature"] ?? "";
    secret = shippoSecret;
  } else if (provider === "easypost") {
    signatureHeader =
      headers["x-hmac-signature"] ?? headers["x-easypost-hmac-signature"] ?? "";
    secret = easypostSecret;
  }

  if (!signatureHeader) {
    console.log(`  → verify skipped: no signature header for ${provider}`);
  } else if (!secret) {
    console.log(
      `  → verify skipped: no ${provider.toUpperCase()}_WEBHOOK_SECRET in env`,
    );
  } else {
    try {
      const event = client.webhooks.verify({
        provider,
        rawBody,
        signature: signatureHeader,
        secret,
      });
      console.log(`  ✓ verified. event.type = ${event.type}`);
      console.log(`    tracking: ${event.tracking_number} (${event.carrier})`);
      if (event.type === "tracking.updated") {
        console.log(
          `    status: ${event.status}${event.status_detail ? ` — ${event.status_detail}` : ""}`,
        );
      } else {
        console.log(`    delivered_at: ${event.delivered_at}`);
      }
    } catch (err) {
      console.log(`  ✗ verification FAILED: ${err.code} — ${err.message}`);
    }
  }

  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("ok");
});

server.listen(PORT, () => {
  console.log(`webhook receiver listening on http://localhost:${PORT}`);
  console.log(
    `  shippo:   http://localhost:${PORT}/shippo    (secret: ${shippoSecret ? "set" : "UNSET"})`,
  );
  console.log(
    `  easypost: http://localhost:${PORT}/easypost  (secret: ${easypostSecret ? "set" : "UNSET"})`,
  );
  console.log(`\nrun 'ngrok http ${PORT}' in another terminal to expose.`);
});
