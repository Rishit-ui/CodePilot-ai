const crypto = require('node:crypto');
const zlib = require('node:zlib');

class ArchiveError extends Error { constructor(message, status = 400) { super(message); this.status = status; } }

function safePath(name) {
  if (!name || name.includes('\0') || name.startsWith('/') || name.startsWith('\\') || /^[a-zA-Z]:/.test(name)) return false;
  const parts = name.split('/');
  return !parts.some((part) => part === '' || part === '.' || part === '..' || part.includes('\\'));
}

function findEndOfCentralDirectory(buffer) {
  const start = Math.max(0, buffer.length - 65_557);
  for (let offset = buffer.length - 22; offset >= start; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) return offset;
  }
  throw new ArchiveError('Malformed ZIP: end-of-central-directory record is missing.');
}

function readZip(buffer, limits) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 22) throw new ArchiveError('Upload is not a valid ZIP archive.');
  const maxArchiveBytes = limits.maxRemoteDownloadBytes || limits.maxUploadBytes;
  if (buffer.length > maxArchiveBytes) throw new ArchiveError('Archive exceeds the upload-size limit.', 413);
  const eocd = findEndOfCentralDirectory(buffer);
  const entriesCount = buffer.readUInt16LE(eocd + 10);
  const directorySize = buffer.readUInt32LE(eocd + 12);
  const directoryOffset = buffer.readUInt32LE(eocd + 16);
  if (entriesCount === 0xffff || directoryOffset === 0xffffffff) throw new ArchiveError('ZIP64 archives are not supported by this importer.');
  if (entriesCount > limits.maxFiles || directoryOffset + directorySize > buffer.length) throw new ArchiveError('Archive exceeds file-count limits or has an invalid directory.');
  const entries = [];
  const names = new Set();
  let cursor = directoryOffset;
  let totalUncompressed = 0;
  for (let i = 0; i < entriesCount; i += 1) {
    if (cursor + 46 > buffer.length || buffer.readUInt32LE(cursor) !== 0x02014b50) throw new ArchiveError('Malformed ZIP central-directory entry.');
    const flags = buffer.readUInt16LE(cursor + 8);
    const method = buffer.readUInt16LE(cursor + 10);
    const compressedSize = buffer.readUInt32LE(cursor + 20);
    const uncompressedSize = buffer.readUInt32LE(cursor + 24);
    const nameLength = buffer.readUInt16LE(cursor + 28);
    const extraLength = buffer.readUInt16LE(cursor + 30);
    const commentLength = buffer.readUInt16LE(cursor + 32);
    const externalAttributes = buffer.readUInt32LE(cursor + 38);
    const localOffset = buffer.readUInt32LE(cursor + 42);
    const end = cursor + 46 + nameLength + extraLength + commentLength;
    if (end > buffer.length) throw new ArchiveError('Malformed ZIP filename metadata.');
    if (flags & 0x1) throw new ArchiveError('Encrypted archives are not supported.');
    if (![0, 8].includes(method)) throw new ArchiveError(`Unsupported ZIP compression method for entry ${i + 1}.`);
    const name = buffer.subarray(cursor + 46, cursor + 46 + nameLength).toString((flags & 0x800) ? 'utf8' : 'utf8');
    const unixType = (externalAttributes >>> 16) & 0o170000;
    if (unixType === 0o120000) throw new ArchiveError('Symbolic links are not permitted in imports.');
    if (!name.endsWith('/')) {
      if (!safePath(name)) throw new ArchiveError(`Unsafe archive path: ${name}`);
      if (names.has(name)) throw new ArchiveError(`Duplicate archive path: ${name}`);
      names.add(name);
      
      const isOversized = uncompressedSize > limits.maxFileBytes;
      if (compressedSize && uncompressedSize / compressedSize > limits.maxCompressionRatio) throw new ArchiveError(`Suspicious compression ratio: ${name}`);
      
      if (localOffset + 30 > buffer.length || buffer.readUInt32LE(localOffset) !== 0x04034b50) throw new ArchiveError(`Invalid local ZIP record: ${name}`);
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      if (dataStart + compressedSize > buffer.length) throw new ArchiveError(`Truncated ZIP entry: ${name}`);
      
      if (!isOversized) {
        totalUncompressed += uncompressedSize;
        if (totalUncompressed > limits.maxExtractedBytes) throw new ArchiveError('Archive exceeds extracted-size limit.', 413);
      }
      entries.push({ name, method, compressedSize, uncompressedSize, dataStart, isOversized });
    }
    cursor = end;
  }
  return entries.map((entry) => {
    if (entry.isOversized) {
      return { path: entry.name, bytes: entry.uncompressedSize, data: Buffer.alloc(0), isOversized: true };
    }
    const compressed = buffer.subarray(entry.dataStart, entry.dataStart + entry.compressedSize);
    let data;
    try { data = entry.method === 0 ? compressed : zlib.inflateRawSync(compressed, { maxOutputLength: limits.maxFileBytes }); }
    catch { throw new ArchiveError(`Unable to safely decompress: ${entry.name}`); }
    if (data.length !== entry.uncompressedSize) throw new ArchiveError(`Unexpected decompressed size: ${entry.name}`);
    return { path: entry.name, bytes: data.length, data, isOversized: false };
  });
}

function contentHash(buffer) { return crypto.createHash('sha256').update(buffer).digest('hex'); }

module.exports = { ArchiveError, readZip, contentHash };
