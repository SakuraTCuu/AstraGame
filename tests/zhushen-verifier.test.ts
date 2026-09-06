import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");

test("Zhushen verifier checks generated exported folder metadata", async () => {
  const directory = await mkdtemp(join(tmpdir(), "astra-verify-"));
  const path = "assets/scripts/modules/auto_explore.meta";
  const destination = join(directory, path);
  const verifier = resolve("tools/verify-zhushen-runtime.mjs");
  try {
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, "expected\n");
    await writeFile(join(directory, "host-probe.json"), JSON.stringify({ failed: false, files: [
      { path, source: "generated", sha256: hash("expected\n") },
    ] }));
    execFileSync(process.execPath, [verifier, directory], { stdio: "pipe" });

    await writeFile(destination, "changed\n");
    const failed = spawnSync(process.execPath, [verifier, directory], { encoding: "utf8" });
    assert.equal(failed.status, 1);
    assert.match(failed.stdout, /auto_explore\.meta/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Zhushen verifier accepts meta formatting changes but rejects semantic changes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "astra-verify-meta-"));
  const path = "assets/scripts/modules/auto_explore/AstraExploreView.ts.meta";
  const source = join(directory, "source.meta"), destination = join(directory, path);
  const verifier = resolve("tools/verify-zhushen-runtime.mjs");
  const expected = '{\n  "uuid": "fixture",\n  "importer": "typescript",\n  "subMetas": {}\n}\n';
  try {
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(source, expected);
    await writeFile(destination, '{"subMetas":{},"importer":"typescript","uuid":"fixture"}');
    await writeFile(join(directory, "host-probe.json"), JSON.stringify({ failed: false, files: [
      { path, source, sha256: hash(expected), sourceSha256: hash(expected) },
    ] }));
    execFileSync(process.execPath, [verifier, directory], { stdio: "pipe" });

    await writeFile(destination, '{"subMetas":{},"importer":"typescript","uuid":"changed"}');
    const failed = spawnSync(process.execPath, [verifier, directory], { encoding: "utf8" });
    assert.equal(failed.status, 1);
    assert.match(failed.stdout, /AstraExploreView\.ts\.meta/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Zhushen verifier rejects unlisted files inside exported directories", async () => {
  const directory = await mkdtemp(join(tmpdir(), "astra-verify-extra-"));
  const listedPath = "assets/scripts/modules/auto_explore/Listed.ts";
  const listed = join(directory, listedPath), extra = join(directory, "assets/scripts/modules/auto_explore/Retired.ts");
  const verifier = resolve("tools/verify-zhushen-runtime.mjs"), expected = "export const listed = true;\n";
  try {
    await mkdir(dirname(listed), { recursive: true });
    await writeFile(listed, expected); await writeFile(extra, "export const retired = true;\n");
    await writeFile(join(directory, "host-probe.json"), JSON.stringify({ failed: false, files: [
      { path: listedPath, source: "generated", sha256: hash(expected) },
    ] }));
    const failed = spawnSync(process.execPath, [verifier, directory], { encoding: "utf8" });
    assert.equal(failed.status, 1);
    assert.match(failed.stdout, /Retired\.ts/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
