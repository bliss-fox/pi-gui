import { createHash } from "node:crypto";

export function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function readArchive(buffer) {
  if (buffer.length < 16 || buffer.readUInt32LE(0) !== 4) {
    throw new Error("Not a supported ASAR archive.");
  }
  const headerSize = buffer.readUInt32LE(4);
  const jsonSize = buffer.readUInt32LE(12);
  const dataOffset = 8 + headerSize;
  if (
    headerSize < 8 ||
    headerSize > 16 * 1024 * 1024 ||
    headerSize % 4 !== 0 ||
    jsonSize > headerSize - 8 ||
    buffer.readUInt32LE(8) !== headerSize - 4 ||
    dataOffset > buffer.length
  ) {
    throw new Error("Invalid ASAR header bounds.");
  }
  const header = JSON.parse(buffer.subarray(16, 16 + jsonSize).toString("utf8"));
  if (!header?.files || typeof header.files !== "object" || Array.isArray(header.files)) {
    throw new Error("Missing ASAR file inventory.");
  }
  return { header, data: buffer.subarray(dataOffset) };
}

export function entryAt(archive, filePath) {
  const parts = filePath.split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || part.includes("\\"))) {
    throw new Error("Invalid archive file path.");
  }
  let entry = archive.header;
  for (const name of parts) {
    if (!entry.files || !Object.hasOwn(entry.files, name)) {
      throw new Error(`Archive file not found: ${filePath}`);
    }
    entry = entry.files[name];
  }
  return entry;
}

export function readEntry(archive, filePath) {
  const entry = entryAt(archive, filePath);
  const offset = Number(entry.offset);
  if (
    entry.files ||
    entry.link ||
    entry.unpacked ||
    typeof entry.offset !== "string" ||
    !/^\d+$/.test(entry.offset) ||
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(entry.size) ||
    entry.size < 0 ||
    offset + entry.size > archive.data.length
  ) {
    throw new Error(`Invalid packed archive entry: ${filePath}`);
  }
  return archive.data.subarray(offset, offset + entry.size);
}

// Keep the original data region byte-for-byte. Only the selected entries point
// at appended translations; native modules, links and unpacked entries retain
// their existing metadata and offsets.
export function replaceEntries(source, patches) {
  const archive = readArchive(source);
  let offset = archive.data.length;
  for (const [filePath, buffer] of patches) {
    readEntry(archive, filePath);
    const entry = entryAt(archive, filePath);
    const blockSize = entry.integrity?.blockSize || 4 * 1024 * 1024;
    if (!Number.isSafeInteger(blockSize) || blockSize <= 0) {
      throw new Error("Invalid ASAR integrity block size.");
    }
    const blocks = [];
    for (let index = 0; index < buffer.length; index += blockSize) {
      blocks.push(sha256(buffer.subarray(index, index + blockSize)));
    }
    entry.offset = String(offset);
    entry.size = buffer.length;
    entry.integrity = { algorithm: "SHA256", hash: sha256(buffer), blockSize, blocks };
    offset += buffer.length;
  }
  const json = Buffer.from(JSON.stringify(archive.header));
  const header = Buffer.alloc(8 + Math.ceil(json.length / 4) * 4);
  header.writeUInt32LE(header.length - 4, 0);
  header.writeUInt32LE(json.length, 4);
  json.copy(header, 8);
  const size = Buffer.alloc(8);
  size.writeUInt32LE(4, 0);
  size.writeUInt32LE(header.length, 4);
  const output = Buffer.concat([size, header, archive.data, ...patches.values()]);
  const verified = readArchive(output);
  if (!verified.data.subarray(0, archive.data.length).equals(archive.data)) {
    throw new Error("Original archive data changed.");
  }
  for (const [filePath, expected] of patches) {
    const actual = readEntry(verified, filePath);
    if (!actual.equals(expected) || sha256(actual) !== entryAt(verified, filePath).integrity.hash) {
      throw new Error(`Patched archive integrity check failed: ${filePath}`);
    }
  }
  return output;
}
