import { parse } from "acorn";
import {
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import { readArchive, readEntry, replaceEntries, sha256 } from "./archive.mjs";

const protectedProperties = new Set([
  "id",
  "key",
  "value",
  "type",
  "role",
  "kind",
  "method",
  "operation",
  "format",
  "action",
  "scope",
  "className",
  "name",
  "mode",
  "source",
  "providerId",
  "modelId",
]);

function visit(node, callback, parent) {
  if (!node || typeof node !== "object") return;
  callback(node, parent);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) value.forEach((child) => visit(child, callback, node));
    else if (value && typeof value === "object" && value.type) visit(value, callback, node);
  }
}

function signature(ast) {
  const result = [];
  visit(ast, (node) => {
    if (node.type) result.push(node.type);
    if (node.type === "Identifier") result.push(node.name);
  });
  return JSON.stringify(result);
}

export function translateRenderer(source, dictionary) {
  if (
    !dictionary ||
    typeof dictionary !== "object" ||
    Array.isArray(dictionary) ||
    Object.values(dictionary).some((value) => typeof value !== "string")
  ) {
    throw new Error("Translations must be a string-to-string dictionary.");
  }
  const fragments = {
    ...dictionary,
    "Connect providers and manage auth for ": "连接服务商并管理工作区认证：",
    "New thread in ": "新建会话，工作区：",
    "Search ": "搜索 ",
    "Show ": "显示 ",
    " more": " 项更多内容",
    " models": " 个模型",
    " model": " 个模型",
    "No matches for ": "未找到匹配项：",
    "No results for ": "未找到结果：",
  };
  const ast = parse(source, { ecmaVersion: "latest", sourceType: "module" });
  const edits = [];
  const counts = new Map();
  visit(ast, (node, parent) => {
    if (
      node.type === "Literal" &&
      typeof node.value === "string" &&
      Object.hasOwn(dictionary, node.value)
    ) {
      const property =
        parent?.type === "Property" ? (parent.key.name ?? parent.key.value) : undefined;
      const isPropertyKey = parent?.type === "Property" && parent.key === node;
      const isMemberKey = parent?.type === "MemberExpression" && parent.property === node;
      if (!isPropertyKey && !isMemberKey && !protectedProperties.has(property)) {
        edits.push({
          start: node.start,
          end: node.end,
          text: JSON.stringify(dictionary[node.value]),
        });
        counts.set(node.value, (counts.get(node.value) || 0) + 1);
      }
    }
    if (node.type === "TemplateElement" && Object.hasOwn(fragments, node.value.cooked)) {
      const text = fragments[node.value.cooked]
        .replace(/\\/g, "\\\\")
        .replace(/`/g, "\\`")
        .replace(/\$\{/g, "\\${");
      edits.push({ start: node.start, end: node.end, text });
      counts.set(node.value.cooked, (counts.get(node.value.cooked) || 0) + 1);
    }
  });
  edits.sort((a, b) => a.start - b.start);
  for (let index = 1; index < edits.length; index++) {
    if (edits[index].start < edits[index - 1].end)
      throw new Error("Overlapping translation edits.");
  }
  let output = source;
  for (const edit of [...edits].reverse()) {
    output = output.slice(0, edit.start) + edit.text + output.slice(edit.end);
  }
  const translatedAst = parse(output, { ecmaVersion: "latest", sourceType: "module" });
  if (signature(ast) !== signature(translatedAst)) {
    throw new Error("JavaScript structure or identifiers changed.");
  }
  return { output, counts, occurrences: edits.length };
}

export function buildLocalizedArchive(source, profile, dictionary) {
  if (sha256(source) !== profile.sourceSha256) {
    throw new Error("Archive does not match the supported release. No files changed.");
  }
  const archive = readArchive(source);
  const renderer = readEntry(archive, profile.rendererPath);
  if (sha256(renderer) !== profile.rendererSha256) throw new Error("Renderer hash mismatch.");
  const translated = translateRenderer(renderer.toString("utf8"), dictionary);
  for (const label of [
    "Settings",
    "Appearance",
    "Providers",
    "Models",
    "New thread",
    "Open first folder",
    "Skills",
    "Scheduled",
    "Back to app",
  ]) {
    if (!translated.counts.has(label)) throw new Error(`Required translation missing: ${label}`);
  }
  const originalHtml = readEntry(archive, profile.htmlPath).toString("utf8");
  if (!originalHtml.includes('<html lang="en">'))
    throw new Error("Expected English HTML language marker.");
  const html = originalHtml.replace('<html lang="en">', '<html lang="zh-CN">');
  const patches = new Map([
    [profile.rendererPath, Buffer.from(translated.output)],
    [profile.htmlPath, Buffer.from(html)],
  ]);
  const output = replaceEntries(source, patches);
  if (profile.localizedSha256 && sha256(output) !== profile.localizedSha256) {
    throw new Error("Localized archive differs from the verified output. No files changed.");
  }
  return {
    output,
    report: {
      version: profile.version,
      sourceSha256: sha256(source),
      localizedSha256: sha256(output),
      translatedUniqueStrings: translated.counts.size,
      translatedOccurrences: translated.occurrences,
      patchedFiles: [...patches.keys()],
    },
  };
}

export function readArchiveFile(filePath) {
  const stat = lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 512 * 1024 * 1024) {
    throw new Error("Expected a regular ASAR file smaller than 512 MiB.");
  }
  return readFileSync(filePath);
}

function replaceFile(filePath, output, expectedHash) {
  const temporary = `${filePath}.localization-${process.pid}-${Date.now()}.tmp`;
  const descriptor = openSync(temporary, "wx");
  try {
    writeFileSync(descriptor, output);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  // Revalidate just before replacement in case an updater changed the archive.
  // On failure retain the staged file for diagnosis instead of deleting it.
  if (sha256(readArchiveFile(filePath)) !== expectedHash) {
    throw new Error(
      `Archive changed while preparing the update; staged output retained: ${temporary}`,
    );
  }
  renameSync(temporary, filePath);
}

export function applyArchive(filePath, backupPath, profile, dictionary) {
  const source = readArchiveFile(filePath);
  const currentHash = sha256(source);
  if (currentHash === profile.localizedSha256) {
    if (!existsSync(backupPath) || sha256(readArchiveFile(backupPath)) !== profile.sourceSha256) {
      throw new Error("Already localized, but the verified original backup is missing.");
    }
    return { status: "already-applied" };
  }
  const { output, report } = buildLocalizedArchive(source, profile, dictionary);
  if (existsSync(backupPath)) {
    if (sha256(readArchiveFile(backupPath)) !== profile.sourceSha256) {
      throw new Error("Existing original backup differs; it will not be overwritten.");
    }
  } else {
    writeFileSync(backupPath, source, { flag: "wx" });
  }
  replaceFile(filePath, output, currentHash);
  return { status: "applied", ...report };
}

export function restoreArchive(filePath, backupPath, profile) {
  const currentHash = sha256(readArchiveFile(filePath));
  if (currentHash === profile.sourceSha256) return { status: "already-original" };
  if (currentHash !== profile.localizedSha256) {
    throw new Error("Installed archive has changed. Refusing to replace another version.");
  }
  const original = readArchiveFile(backupPath);
  if (sha256(original) !== profile.sourceSha256) throw new Error("Original backup hash mismatch.");
  replaceFile(filePath, original, currentHash);
  return { status: "restored" };
}
