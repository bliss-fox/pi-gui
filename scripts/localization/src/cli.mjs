#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sha256 } from "./archive.mjs";
import {
  applyArchive,
  buildLocalizedArchive,
  readArchiveFile,
  restoreArchive,
} from "./localize.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const profile = JSON.parse(
  readFileSync(path.join(root, "profiles/windows-x64-1.0.1.json"), "utf8"),
);
const dictionary = JSON.parse(readFileSync(path.join(root, "locales/zh-CN.json"), "utf8"));

const help = `pi-gui Simplified Chinese localization (Windows x64 1.0.1)

node src/cli.mjs inspect <app-directory>
node src/cli.mjs apply   <app-directory>
node src/cli.mjs restore <app-directory>
node src/cli.mjs build   <original-app.asar> <output-app.asar>

Close pi-gui before apply/restore. Unknown versions are rejected.
The original archive is retained at <app-directory>/localization/app.asar.en.original.
build creates a separate output and works on any supported Node platform.
`;

function requireClosedWindowsApp() {
  if (process.platform !== profile.platform || process.arch !== profile.architecture) {
    throw new Error(
      "Apply/restore supports Windows x64 only. Use build for offline archive output.",
    );
  }
  const tasklist = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "tasklist.exe");
  const result = spawnSync(tasklist, ["/FI", "IMAGENAME eq pi-gui.exe", "/FO", "CSV", "/NH"], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error || result.status !== 0)
    throw new Error("Cannot verify whether pi-gui is closed.");
  if (/"pi-gui\.exe"/i.test(result.stdout))
    throw new Error("Close all pi-gui windows before applying or restoring translations.");
}

try {
  const [command, target, outputPath, ...extra] = process.argv.slice(2);
  if (!command || command === "--help" || command === "-h") {
    process.stdout.write(help);
  } else {
    if (!target || extra.length || (command === "build" ? !outputPath : outputPath)) {
      throw new Error("Invalid arguments. Run with --help for usage.");
    }
    if (!["build", "inspect", "apply", "restore"].includes(command))
      throw new Error("Unknown command.");
    let result;
    if (command === "build") {
      const built = buildLocalizedArchive(
        readArchiveFile(path.resolve(target)),
        profile,
        dictionary,
      );
      writeFileSync(path.resolve(outputPath), built.output, { flag: "wx" });
      result = { status: "built", ...built.report };
    } else {
      const appDirectory = path.resolve(target);
      const archivePath = path.join(appDirectory, "resources", "app.asar");
      const backupDirectory = path.join(appDirectory, "localization");
      const backupPath = path.join(backupDirectory, "app.asar.en.original");
      if (command === "inspect") {
        const hash = sha256(readArchiveFile(archivePath));
        result = {
          status:
            hash === profile.sourceSha256
              ? "supported-original"
              : hash === profile.localizedSha256
                ? "supported-chinese"
                : "unsupported",
          sha256: hash,
        };
      } else {
        requireClosedWindowsApp();
        if (command === "apply") {
          // Validate before creating even the backup directory.
          const current = sha256(readArchiveFile(archivePath));
          if (current !== profile.sourceSha256 && current !== profile.localizedSha256) {
            throw new Error("Archive does not match the supported release. No files changed.");
          }
          mkdirSync(backupDirectory, { recursive: true });
          result = applyArchive(archivePath, backupPath, profile, dictionary);
        } else {
          result = restoreArchive(archivePath, backupPath, profile);
        }
      }
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
