import assert from "node:assert/strict";
import { test } from "node:test";
import { deflateSync } from "node:zlib";
import { decodeUuid, inside, mergeBundleParts, readTableArchive, tableRow } from "../tools/reference-cache.mjs";
import { compileReferenceCondition, parseReferenceItem, referenceFogPolygon } from "../tools/reference-rules.mjs";

test("cache paths cannot escape the authorized root", () => {
  assert.throws(() => inside("C:/cache", "../outside.png"), /escapes/);
  assert.throws(() => inside("C:/cache", "C:/other/private.png"), /escapes/);
  assert.match(inside("C:/cache", "map/tile.png"), /map[\\/]tile.png$/);
});

test("split bundle indices retain cross-part texture dependencies and packed order", () => {
  const texture = "d7Mv0ZwJtBq5umRfnOtJwb";
  const skeleton = "43Sfyi8XdCRYA57JcC6B3h";
  const merged = mergeBundleParts([
    { uuids: [texture], types: ["cc.Texture2D"], paths: {}, packs: { texturePack: [0] }, versions: { import: ["texturePack", "12345"], native: [0, "abcde"] } },
    { uuids: [skeleton, texture], types: ["sp.SkeletonData", "cc.Texture2D"], paths: { 0: ["spine/example", 0] }, packs: {}, versions: { import: [0, "67890"] } },
  ]);
  assert.deepEqual(merged.packs.texturePack, [0]);
  assert.deepEqual(merged.versions.native, [0, "abcde"]);
  assert.deepEqual(merged.paths[1], ["spine/example", 1]);
  assert.equal(merged.uuids[0], "d732fd19-c09b-41ab-9ba6-45f9ceb49c1b");
  assert.equal(decodeUuid(merged.uuids[0]), merged.uuids[0]);
});

test("compressed table envelopes reject truncation and trailing data", () => {
  const integer = (value: number) => { const result = Buffer.alloc(4); result.writeUInt32BE(value); return result; };
  const data = deflateSync(Buffer.from('{"42":{"datas":[[42,"example"]]}}'));
  const archive = Buffer.concat([integer(1), integer(4), Buffer.from("Demo"), Buffer.from([1]), integer(data.length), data]);
  assert.equal(readTableArchive(archive).Demo[42].datas[0][1], "example");
  assert.throws(() => readTableArchive(archive.subarray(0, archive.length - 2)), /Truncated/);
  assert.throws(() => readTableArchive(Buffer.concat([archive, Buffer.from([0])])), /Trailing/);
});

test("table references resolve by field index and reject cycles", () => {
  const table = { __KEY_MAP__: { id: 0, name: 1 }, 1: { datas: [[1, "original"]] }, 2: { datas: [[2, "$1"]] }, 3: { datas: [[3, "$3"]] } };
  assert.deepEqual(tableRow(table, 2), { id: 2, name: "original" });
  assert.throws(() => tableRow(table, 3), /Circular/);
});

test("source progression expressions preserve combined gates and reject unsupported syntax", () => {
  const condition = compileReferenceCondition("AndCondition|[HisKillMonsterCondition|id:12,PlayerLevel|minLevel:3]", () => ({ name: "Warden" }));
  assert.equal(condition.kind, "all");
  assert.equal(condition.conditions[0].id, "defeat:12");
  assert.equal(condition.conditions[1].value, 3);
  assert.equal(compileReferenceCondition("TriggerNpcCondition|{npcSpawnId:15}", () => null).id, "poi:reference_npc_15");
  assert.throws(() => compileReferenceCondition("UnknownCondition|id:12", () => null), /Unsupported/);
  assert.throws(() => compileReferenceCondition("AndCondition|[PlayerLevel|minLevel:3", () => null), /Invalid compound/);
});

test("resource probabilities and fog coordinates retain the source data contract", () => {
  assert.deepEqual(parseReferenceItem("item|id:4_num:2_prob:500/1000"), { itemId: 4, amount: 2, chance: 0.5 });
  assert.throws(() => parseReferenceItem("item|id:4_num:2_prob:1/0"), /Invalid/);
  const corners = referenceFogPolygon({ x: 1200, y: -2400, w: 120, h: 120 }, (x, y) => ({ x, y }));
  assert.deepEqual(corners, [{ x: 3000, y: 600 }, { x: 3100, y: 540 }, { x: 3000, y: 480 }, { x: 2900, y: 540 }]);
});
