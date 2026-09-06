import assert from "node:assert/strict";
import test from "node:test";
import { categorizedMissingArt, referenceArtBinding, referenceNpcArtBinding, validateReferenceSummon } from "../tools/build-reference-profile.mjs";
import { referencePoiAnimation, shouldRestartPoiAnimation } from "../assets/scripts/presentation/ReferenceArtLayer";

const avatars = {
  4048: { id: 4048, prefab: "prefab/avatar/MapBoxAvatar", height: 80, fps: 12 },
  4013: { id: 4013, atlasName: "mapbox08", spriteAtlasPath: "spine", height: 80, dx: -13, dy: -223 },
};
const lookup = (family: string, id: number) => family === "Avatar" ? avatars[id] || null : null;
const assets = [{ path: "spine/mapbox08", type: "sp.SkeletonData", native: "mapbox08.bin" }];

test("only the five first-map 4048 coffin POIs use the source-supported mapbox08 fallback", () => {
  const coffinIds = [250001, 250003, 250004, 250005, 250006];
  const bindings = coffinIds.map((id) => [`reference_npc_${id}`, referenceNpcArtBinding(id, 4048, lookup, assets)]);
  assert.equal(bindings.filter(([, binding]) => binding).length, 5);
  for (const [id, binding] of bindings) assert.deepEqual(binding, {
    path: "spine/mapbox08", kind: "spine", scale: 1, height: 80, fps: 12, flip: false,
    offsetX: -13, offsetY: -223, avatarId: 4048, sourceAvatarId: 4013,
  }, id);
  assert.equal(referenceArtBinding(4048, lookup, assets), null);
  assert.equal(referenceNpcArtBinding(250002, 4048, lookup, assets), null);
  assert.equal(referenceNpcArtBinding(250001, 4999, lookup, assets), null);
});

test("missing art audit separates monster, hero and NPC records without changing missingArt", () => {
  const monsters = Array.from({ length: 945 }, (_, index) => ({ spawnId: index + 1, monsterId: 1000 + index, avatar: 2000 + index }));
  const npcs = [250001, 250003, 250004, 250005, 250006].map((source) => ({
    id: `reference_npc_${source}`, source, avatar: 4048, path: null, reason: "unsupported_prefab",
  }));
  const issues = Array.from({ length: 14 }, (_, index) => ({ owner: index + 20, kind: "hero_art", avatar: 5000 + index }));
  const audit = categorizedMissingArt(monsters, npcs, issues, lookup, assets);
  assert.strictEqual(audit.missingArt, monsters);
  assert.strictEqual(audit.missingMonsterArt, monsters);
  assert.equal(audit.missingArtCount, 945);
  assert.equal(audit.missingMonsterArtCount, 945);
  assert.equal(audit.missingHeroArtCount, 14);
  assert.equal(audit.missingNpcArtCount, 5);
  assert.deepEqual(Object.keys(audit.missingHeroArt[0]), ["id", "source", "avatar", "path", "reason"]);
  assert.deepEqual(Object.keys(audit.missingNpcArt[0]), ["id", "source", "avatar", "path", "reason"]);
});

test("Spine POIs loop closed state and freeze completed state on the final pose", () => {
  const closed = referencePoiAnimation(false, ["dead", "idle", "skill"]), opened = referencePoiAnimation(true, ["dead", "idle", "skill"]);
  assert.deepEqual(closed, { action: "idle", loop: true, freezeAtEnd: false });
  assert.deepEqual(opened, { action: "dead", loop: false, freezeAtEnd: true });
  assert.equal(shouldRestartPoiAnimation("idle", true, opened), true);
  const fallback = referencePoiAnimation(true, ["idle"]);
  assert.deepEqual(fallback, { action: "idle", loop: false, freezeAtEnd: true });
  assert.equal(shouldRestartPoiAnimation("idle", true, fallback), true);
  assert.equal(shouldRestartPoiAnimation("idle", false, fallback), false);
});

test("the bounded 5001603 summon templates fail closed on source contract drift", () => {
  const warrior = { id: 1601, display: 10168, attributes: { movespeed: 200 }, skill: "5001608", goDieWithMaster: 0,
    tagAction: "[backHomeRemoveTag]", inherit: { atk: 1700, def: 10000, maxhp: 500 } };
  const mage = { ...warrior, id: 1602, display: 10169, attributes: { movespeed: 50 }, skill: "5001609" };
  assert.strictEqual(validateReferenceSummon(1601, warrior), warrior);
  assert.strictEqual(validateReferenceSummon(1602, mage), mage);
  assert.throws(() => validateReferenceSummon(1601, { ...warrior, inherit: { ...warrior.inherit, atk: 1701 } }), /Summon 1601 contract/);
  assert.throws(() => validateReferenceSummon(1601, { ...warrior, goDieWithMaster: 1 }), /Summon 1601 contract/);
  assert.throws(() => validateReferenceSummon(1602, { ...mage, tagAction: null }), /Summon 1602 contract/);
  assert.throws(() => validateReferenceSummon(1601, { ...warrior, skill: "5001609" }), /Summon 1601 contract/);
  assert.throws(() => validateReferenceSummon(1602, { ...mage, attributes: { movespeed: 51 } }), /Summon 1602 contract/);
});
