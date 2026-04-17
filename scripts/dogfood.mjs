#!/usr/bin/env node
/**
 * Dogfood script. Runs the SDK against real provider test keys to verify
 * the whole flow works end-to-end before cutting a release.
 *
 * Set whichever provider keys you have in your environment:
 *   EASYPOST_KEY, SHIPPO_KEY, SHIPENGINE_KEY
 *
 * Usage: node scripts/dogfood.mjs
 *
 * Only configures providers for which the key is present, so you can run
 * with one, two, or all three. All keys must be test-mode keys — the
 * script will attempt real API calls but will NOT purchase labels unless
 * you pass `--buy-label`.
 */

import { RateShip, easypost, shippo, shipengine } from "../dist/index.js";

const BUY_LABEL = process.argv.includes("--buy-label");

const providers = [];
if (process.env.EASYPOST_KEY) {
  providers.push(easypost({ apiKey: process.env.EASYPOST_KEY }));
}
if (process.env.SHIPPO_KEY) {
  providers.push(shippo({ apiKey: process.env.SHIPPO_KEY }));
}
if (process.env.SHIPENGINE_KEY) {
  providers.push(shipengine({ apiKey: process.env.SHIPENGINE_KEY }));
}

if (providers.length === 0) {
  console.error(
    "No provider keys set. Export at least one of EASYPOST_KEY, SHIPPO_KEY, SHIPENGINE_KEY.",
  );
  process.exit(1);
}

const client = new RateShip({ providers });

const request = {
  from: {
    name: "Dogfood Sender",
    street1: "500 Terry A Francois Blvd",
    city: "San Francisco",
    state: "CA",
    zip: "94158",
    country: "US",
    phone: "4155551212",
  },
  to: {
    name: "Dogfood Recipient",
    street1: "1600 Amphitheatre Pkwy",
    city: "Mountain View",
    state: "CA",
    zip: "94043",
    country: "US",
    phone: "6505551212",
  },
  parcel: {
    weight: 2,
    weight_unit: "lb",
    length: 10,
    width: 8,
    height: 6,
    distance_unit: "in",
  },
};

console.log(
  `\nConfigured providers: ${providers.map((p) => p.name).join(", ")}\n`,
);

console.log("Calling client.getRates(...)");
const t0 = Date.now();
const { rates, errors } = await client.getRates(request);
const elapsed = Date.now() - t0;
console.log(`  done in ${elapsed}ms\n`);

console.log(`Rates (${rates.length}):`);
for (const r of rates.slice(0, 10)) {
  console.log(
    `  ${r.provider.padEnd(10)}  ${r.carrier.padEnd(8)}  ${r.service.padEnd(28)}  $${(r.price_cents / 100).toFixed(2).padStart(6)}`,
  );
}
if (rates.length > 10) console.log(`  ... ${rates.length - 10} more`);

if (errors.length > 0) {
  console.log(`\nErrors (${errors.length}):`);
  for (const e of errors) {
    console.log(`  ${e.provider}  [${e.code}]  ${e.message}`);
  }
}

if (!BUY_LABEL) {
  console.log(
    "\nSkipping label purchase. Re-run with --buy-label on a test-mode key to buy a real test label.",
  );
  process.exit(0);
}

if (rates.length === 0) {
  console.log("\nNo rates available; nothing to buy.");
  process.exit(1);
}

const pick = rates[0];
console.log(
  `\nBuying cheapest rate: ${pick.provider} ${pick.carrier} ${pick.service} $${(pick.price_cents / 100).toFixed(2)}`,
);
const label = await client.createLabel(pick);
console.log(`  tracking_number: ${label.tracking_number}`);
console.log(`  label_url:       ${label.label_url}`);
console.log(`  label_id:        ${label.label_id}`);
console.log(`\nDogfood complete.\n`);
