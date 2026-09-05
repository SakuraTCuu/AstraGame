import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const directory = resolve(process.argv[2] || "temp/zhushen-runtime-checked");
const manifest = JSON.parse(await readFile(join(directory, "host-probe.json"), "utf8"));
if (manifest.failed) throw new Error("The host probe was not prepared successfully");
const files = manifest.files.filter((file) => file.source !== "generated"), changed = [], stagedCodeChanged = [];
for (let index = 0; index < files.length; index += 32) {
  await Promise.all(files.slice(index, index + 32).map(async (file) => {
    const digest = createHash("sha256").update(await readFile(file.source)).digest("hex");
    if (digest !== (file.sourceSha256 || file.sha256)) changed.push(file.source);
    if (/\.(ts|js)$/.test(file.path)) {
      const staged = createHash("sha256").update(await readFile(join(directory, file.path))).digest("hex");
      if (staged !== file.sha256) stagedCodeChanged.push(file.path);
    }
  }));
}
const report = { sourceFilesVerified: files.length, changed, stagedCodeChanged,
  runtimeFiles: manifest.files.filter((file) => /comm\/(view\/(BaseUI|BaseView)|manager\/(UIManager|StorageMgr|ResourceManager|LayerManager)|util\/MessageCenter)\.ts$/.test(file.path)) };
await writeFile(join(directory, "source-verification.json"), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ sourceFilesVerified: files.length, changed, stagedCodeChanged }, null, 2));
if (changed.length || stagedCodeChanged.length) process.exitCode = 1;
