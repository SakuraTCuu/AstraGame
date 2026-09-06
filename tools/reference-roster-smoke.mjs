import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tableRow } from "./reference-cache.mjs";

const profilePath = process.argv[2] || "build/web-mobile/reference-preview/profile.json";
const tablesPath = process.argv[3] || join(dirname(profilePath), "tables.json");
const profile = JSON.parse(readFileSync(profilePath, "utf8"));
const tables = JSON.parse(readFileSync(tablesPath, "utf8"));

function lookup(family, id) {
  for (const [name, table] of Object.entries(tables)) {
    if (new RegExp(`^${family}(?:_(?:\\d+|Xs))?$`).test(name) && Object.prototype.hasOwnProperty.call(table, String(id))) return tableRow(table, id);
  }
  return null;
}

assert.ok(profile.roster?.heroes?.length, "Generated profile has no roster heroes");
for (const hero of profile.roster.heroes) {
  const source = lookup("Hero", hero.sourceId);
  assert.ok(source, `Missing source Hero ${hero.sourceId}`);
  assert.ok(Number.isSafeInteger(source.chip) && Number.isSafeInteger(source.chipNum) && source.chipNum > 0, `Invalid source activation cost for Hero ${hero.sourceId}`);
  const resource = source.chip === 4 ? "incense" : `item:${source.chip}`;
  assert.deepEqual(hero.activationCost, { resource, amount: source.chipNum }, `Activation cost drift for Hero ${hero.sourceId}`);
  assert.ok(profile.world.progression.resources[resource], `Activation resource ${resource} is missing from world progression`);
}

console.log(JSON.stringify({ heroes: profile.roster.heroes.length, activationCosts: profile.roster.heroes.filter((hero) => hero.activationCost).length }));
