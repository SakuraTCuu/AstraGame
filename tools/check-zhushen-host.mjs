import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

const exportRoot = resolve(process.argv[2] || "temp/zhushen-module");
if (!process.argv[3]) throw new Error("Provide the Zhushen host path after the export directory");
const hostRoot = resolve(process.argv[3]);
const require = createRequire(import.meta.url);
const ts = require(join(hostRoot, "node_modules/typescript"));
const physicalPath = (path) => {
  if (existsSync(path)) return path;
  const suffix = relative(exportRoot, path);
  return suffix.startsWith("..") || isAbsolute(suffix) ? path : join(hostRoot, suffix);
};
const options = { target: ts.ScriptTarget.ES2017, module: ts.ModuleKind.CommonJS, moduleResolution: ts.ModuleResolutionKind.NodeJs,
  experimentalDecorators: true, skipLibCheck: true, strict: false, noEmit: true, allowJs: true, esModuleInterop: true };
const host = ts.createCompilerHost(options);
host.getCurrentDirectory = () => exportRoot;
host.fileExists = (path) => { const physical = physicalPath(path); return existsSync(physical) && statSync(physical).isFile(); };
host.directoryExists = (path) => { const physical = physicalPath(path); return existsSync(physical) && statSync(physical).isDirectory(); };
host.readFile = (path) => { const physical = physicalPath(path); return host.fileExists(path) ? readFileSync(physical, "utf8") : undefined; };
host.getDirectories = (path) => host.directoryExists(path) ? readdirSync(physicalPath(path), { withFileTypes: true }).filter((entry) => entry.isDirectory()).map((entry) => entry.name) : [];
host.realpath = (path) => path;
host.getSourceFile = (path, languageVersion) => {
  const source = host.readFile(path);
  return source === undefined ? undefined : ts.createSourceFile(path, source, languageVersion, true);
};
const moduleRoot = join(exportRoot, "assets/scripts/modules/auto_explore");
const roots = [join(moduleRoot, "AstraExploreView.ts"), join(hostRoot, "creator.d.ts"), join(hostRoot, "data_config.d.ts")];
const program = ts.createProgram(roots.filter(existsSync), options, host);
const diagnostics = ts.getPreEmitDiagnostics(program);
const owned = diagnostics.filter((entry) => entry.file && resolve(entry.file.fileName).toLowerCase().startsWith(moduleRoot.toLowerCase() + sep));
const errors = owned.map((entry) => ({
  file: relative(exportRoot, entry.file.fileName),
  line: entry.file.getLineAndCharacterOfPosition(entry.start || 0).line + 1,
  code: entry.code,
  message: ts.flattenDiagnosticMessageText(entry.messageText, "\n"),
}));
console.log(JSON.stringify({ moduleErrors: errors, otherHostDiagnostics: diagnostics.length - owned.length, checkedAgainst: hostRoot, installed: false }, null, 2));
if (errors.length) process.exitCode = 1;
