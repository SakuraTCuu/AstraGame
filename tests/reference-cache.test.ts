import assert from "node:assert/strict";
import { test } from "node:test";
import { deflateSync } from "node:zlib";
import { decodeUuid, inside, mergeBundleParts, readTableArchive, tableRow } from "../tools/reference-cache.mjs";

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
