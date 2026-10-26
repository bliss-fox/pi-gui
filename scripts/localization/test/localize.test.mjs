import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { entryAt, readArchive, readEntry, replaceEntries, sha256 } from "../src/archive.mjs";
import {
  applyArchive,
  buildLocalizedArchive,
  restoreArchive,
  translateRenderer,
} from "../src/localize.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const artifacts = path.join(root, ".artifacts", "localization-tests");
mkdirSync(artifacts, { recursive: true });
const dictionary = JSON.parse(
  readFileSync(new URL("../locales/zh-CN.json", import.meta.url), "utf8"),
);

function archiveFixture() {
  const rendererPath = "out/renderer.js";
  const htmlPath = "out/index.html";
  const labels = [
    "Settings",
    "Appearance",
    "Providers",
    "Models",
    "New thread",
    "Open first folder",
    "Skills",
    "Scheduled",
    "Back to app",
  ];
  const files = new Map([
    [rendererPath, Buffer.from(`export const labels = ${JSON.stringify(labels)};\n`)],
    [htmlPath, Buffer.from('<html lang="en"><body></body></html>')],
    ["unchanged.bin", Buffer.from([0, 255, 10, 13, 200])],
  ]);
  const header = { files: {} };
  let offset = 0;
  for (const [name, buffer] of files) {
    const parts = name.split("/");
    let directory = header;
    for (const part of parts.slice(0, -1)) directory = directory.files[part] ??= { files: {} };
    directory.files[parts.at(-1)] = { size: buffer.length, offset: String(offset) };
    offset += buffer.length;
  }
  header.files["native.node"] = { size: 123, unpacked: true };
  header.files["linked.bin"] = { link: "unchanged.bin" };
  const json = Buffer.from(JSON.stringify(header));
  const encoded = Buffer.alloc(8 + Math.ceil(json.length / 4) * 4);
  encoded.writeUInt32LE(encoded.length - 4, 0);
  encoded.writeUInt32LE(json.length, 4);
  json.copy(encoded, 8);
  const size = Buffer.alloc(8);
  size.writeUInt32LE(4, 0);
  size.writeUInt32LE(encoded.length, 4);
  const source = Buffer.concat([size, encoded, ...files.values()]);
  const profile = {
    version: "fixture",
    rendererPath,
    htmlPath,
    rendererSha256: sha256(files.get(rendererPath)),
    sourceSha256: sha256(source),
  };
  profile.localizedSha256 = sha256(buildLocalizedArchive(source, profile, dictionary).output);
  return { source, profile };
}

function diskFixture() {
  const fixture = archiveFixture();
  const directory = mkdtempSync(path.join(artifacts, "case-"));
  const archivePath = path.join(directory, "app.asar");
  const backupPath = path.join(directory, "app.asar.en.original");
  writeFileSync(archivePath, fixture.source);
  return { ...fixture, archivePath, backupPath };
}

test("translates UI literals while preserving identifiers, property keys and protocol values", () => {
  const source =
    'const Settings = {id: "Settings", role: "Settings", name: "Settings", title: "Settings"}; const value = Settings["Settings"];';
  const { output } = translateRenderer(source, { Settings: "设置" });
  assert.match(output, /const Settings/);
  assert.match(output, /id: "Settings"/);
  assert.match(output, /role: "Settings"/);
  assert.match(output, /name: "Settings"/);
  assert.match(output, /title: "设置"/);
  assert.match(output, /Settings\["Settings"\]/);
});

test("escapes template translations without introducing expressions or changing variables", () => {
  const source = 'const workspace = "example"; const title = `Settings${workspace} tail`;';
  const { output } = translateRenderer(source, { Settings: "`中文${injected}\\" });
  assert.match(output, /\\`中文\\\$\{injected\}\\\\\$\{workspace\}/);
  assert.equal((output.match(/\$\{workspace\}/g) || []).length, 1);
});

test("updates UTF-8 offsets and integrity while retaining all original data and unpacked metadata", () => {
  const { source, profile } = archiveFixture();
  const original = readArchive(source);
  const { output, report } = buildLocalizedArchive(source, profile, dictionary);
  const localized = readArchive(output);
  assert(localized.data.subarray(0, original.data.length).equals(original.data));
  assert(readEntry(localized, "unchanged.bin").equals(readEntry(original, "unchanged.bin")));
  assert.deepEqual(entryAt(localized, "native.node"), entryAt(original, "native.node"));
  assert.deepEqual(entryAt(localized, "linked.bin"), entryAt(original, "linked.bin"));
  assert.match(readEntry(localized, profile.rendererPath).toString(), /设置/);
  assert.match(readEntry(localized, profile.htmlPath).toString(), /lang="zh-CN"/);
  for (const filePath of report.patchedFiles) {
    assert.equal(
      entryAt(localized, filePath).integrity.hash,
      sha256(readEntry(localized, filePath)),
    );
  }
});

test("rejects unsupported archives before creating a backup or replacing the installation", () => {
  const fixture = diskFixture();
  writeFileSync(fixture.archivePath, "not the supported release");
  assert.throws(
    () => applyArchive(fixture.archivePath, fixture.backupPath, fixture.profile, dictionary),
    /supported release/,
  );
  assert.equal(readFileSync(fixture.archivePath, "utf8"), "not the supported release");
  assert.equal(existsSync(fixture.backupPath), false);
});

test("apply is idempotent and restore reproduces the exact original while retaining its backup", () => {
  const fixture = diskFixture();
  assert.equal(
    applyArchive(fixture.archivePath, fixture.backupPath, fixture.profile, dictionary).status,
    "applied",
  );
  const localized = readFileSync(fixture.archivePath);
  assert.equal(sha256(localized), fixture.profile.localizedSha256);
  assert.equal(
    applyArchive(fixture.archivePath, fixture.backupPath, fixture.profile, dictionary).status,
    "already-applied",
  );
  assert(readFileSync(fixture.archivePath).equals(localized));
  assert.equal(
    restoreArchive(fixture.archivePath, fixture.backupPath, fixture.profile).status,
    "restored",
  );
  assert(readFileSync(fixture.archivePath).equals(fixture.source));
  assert(readFileSync(fixture.backupPath).equals(fixture.source));
  assert.equal(
    restoreArchive(fixture.archivePath, fixture.backupPath, fixture.profile).status,
    "already-original",
  );
});

test("does not overwrite a conflicting existing backup", () => {
  const fixture = diskFixture();
  writeFileSync(fixture.backupPath, "a different backup");
  assert.throws(
    () => applyArchive(fixture.archivePath, fixture.backupPath, fixture.profile, dictionary),
    /will not be overwritten/,
  );
  assert(readFileSync(fixture.archivePath).equals(fixture.source));
  assert.equal(readFileSync(fixture.backupPath, "utf8"), "a different backup");
});

test("restore refuses an updated installation or a corrupted backup", () => {
  const fixture = diskFixture();
  applyArchive(fixture.archivePath, fixture.backupPath, fixture.profile, dictionary);
  const localized = readFileSync(fixture.archivePath);
  writeFileSync(fixture.backupPath, "corrupt backup");
  assert.throws(
    () => restoreArchive(fixture.archivePath, fixture.backupPath, fixture.profile),
    /backup hash mismatch/,
  );
  assert(readFileSync(fixture.archivePath).equals(localized));
  writeFileSync(fixture.backupPath, fixture.source);
  writeFileSync(fixture.archivePath, "new application version");
  assert.throws(
    () => restoreArchive(fixture.archivePath, fixture.backupPath, fixture.profile),
    /another version/,
  );
  assert.equal(readFileSync(fixture.archivePath, "utf8"), "new application version");
});

test("rejects malformed archive bounds and non-packed paths", () => {
  const { source } = archiveFixture();
  const malformed = Buffer.from(source);
  malformed.writeUInt32LE(0xfffffff0, 4);
  assert.throws(() => readArchive(malformed), /bounds/);
  const archive = readArchive(source);
  assert.throws(() => readEntry(archive, "native.node"), /Invalid packed/);
  assert.throws(() => readEntry(archive, "linked.bin"), /Invalid packed/);
  assert.throws(() => readEntry(archive, "../unchanged.bin"), /Invalid archive/);
  assert.throws(
    () => replaceEntries(source, new Map([["missing", Buffer.from("中文")]])),
    /not found/,
  );
});

test("CLI documents supported versions and rejects unknown arguments", () => {
  const cli = fileURLToPath(new URL("../src/cli.mjs", import.meta.url));
  const help = spawnSync(process.execPath, [cli, "--help"], { encoding: "utf8" });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Windows x64 1\.0\.1/);
  const invalid = spawnSync(process.execPath, [cli, "not-a-command", "target"], {
    encoding: "utf8",
  });
  assert.equal(invalid.status, 1);
  assert.match(invalid.stderr, /Unknown command/);
});
