# Simplified Chinese localization package

[简体中文](README.zh-CN.md)

This optional package localizes the **Windows x64 pi-gui 1.0.1 release**. It includes
the Chinese dictionary, an archive builder, and reversible apply/restore commands.
It is a local display-text patch, not a built-in language selector or a full
internationalization framework. Other versions and platforms are rejected by hash.

The package translates 508 distinct strings at 682 occurrences in the verified
release: navigation, settings, providers, models, skills, scheduled tasks, and
common actions. Provider/model names, user content, code, backend messages, and
third-party extension content are not generally translated.

## Install and use

Requires Node.js 22.19 or newer and the supported Windows release. From a source
checkout, install the package's pinned dependency:

```sh
npm ci --prefix scripts/localization --ignore-scripts --no-audit --no-fund
node scripts/localization/src/cli.mjs inspect "C:\path\to\pi-gui"
```

Close all pi-gui windows before applying the patch:

```sh
node scripts/localization/src/cli.mjs apply "C:\path\to\pi-gui"
```

Reopen pi-gui normally. To restore English, close it and run:

```sh
node scripts/localization/src/cli.mjs restore "C:\path\to\pi-gui"
```

The corresponding `Apply-Chinese.cmd` and `Restore-English.cmd` accept the same
installation directory. Paths containing spaces are supported when quoted.

## Build a distributable package

After installing the pinned dependency, run:

```sh
npm pack ./scripts/localization --ignore-scripts
```

The tarball bundles Acorn and its license, so an extracted package runs without
another dependency download. From the extracted `package` directory:

```sh
node src/cli.mjs apply "C:\path\to\pi-gui"
```

The package contains no pi-gui executables, application archives, user profiles,
credentials, or sessions. Do not bundle an installed application or its data
directory when redistributing it.

## Compatibility and recovery

- The profile pins the original complete archive, renderer, and resulting Chinese
  archive by SHA-256. It derives from the release installer listed in
  [`profiles/windows-x64-1.0.1.json`](profiles/windows-x64-1.0.1.json).
- `apply` retains the original at `localization/app.asar.en.original` inside the
  installation. An existing conflicting backup is never overwritten. Applying
  twice does not append duplicate translations.
- `restore` verifies both the installed Chinese archive and original backup. It
  refuses to replace a newer or otherwise changed installation. Backups remain
  after restoration.
- A running Windows pi-gui process prevents apply/restore. No process is killed.
  Keep the app closed throughout either operation; do not run its updater at the
  same time. Normal filesystem permissions still apply.
- Updates can replace this local translation. A changed release needs its own
  reviewed profile; do not bypass the hash checks.

For offline generation on any Node platform, create a separate output archive:

```sh
node scripts/localization/src/cli.mjs build original-app.asar chinese-app.asar
```

`build` never overwrites an existing output. It only accepts the original archive
from the supported Windows release.

## Validation

```sh
npm --prefix scripts/localization test
```

The tests exercise Unicode archive offsets/integrity, preservation of original
data and native-module metadata, wrong-version refusal, conflicting backups,
idempotence, exact restoration, malformed inputs, and escaped template text.
Translation edits preserve the parsed JavaScript node types and identifiers.
This is a structural check, not proof of every runtime behavior.

The tool-generated real-release archive was byte-identical to the Chinese archive
verified on the installed Windows Electron app. Main navigation, general settings,
and the provider page displayed Chinese. No model request or provider login was
part of that verification. macOS/Linux application patches and native system
dialogs were not validated.
