const zlib = require('node:zlib');

function makeZip(files) {
  // files: array of { name, content, method, unixType }
  const localHeaders = [];
  const cdHeaders = [];
  let offset = 0;

  for (const f of files) {
    const rawData = Buffer.isBuffer(f.content) ? f.content : Buffer.from(f.content || '', 'utf8');
    const method = f.method !== undefined ? f.method : 8; // 8 = deflate, 0 = store
    let compressedData = rawData;
    if (method === 8) {
      compressedData = zlib.deflateRawSync(rawData);
    }

    const nameBuf = Buffer.from(f.name, 'utf8');
    const localHeader = Buffer.alloc(30 + nameBuf.length + compressedData.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // signature
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0, 6); // flags
    localHeader.writeUInt16LE(method, 8); // method
    localHeader.writeUInt16LE(0, 10); // time
    localHeader.writeUInt16LE(0, 12); // date
    localHeader.writeUInt32LE(0, 14); // crc32
    localHeader.writeUInt32LE(compressedData.length, 18);
    localHeader.writeUInt32LE(rawData.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28); // extra len
    nameBuf.copy(localHeader, 30);
    compressedData.copy(localHeader, 30 + nameBuf.length);
    localHeaders.push(localHeader);

    const cdHeader = Buffer.alloc(46 + nameBuf.length);
    cdHeader.writeUInt32LE(0x02014b50, 0); // signature
    cdHeader.writeUInt16LE(20, 4); // version made by
    cdHeader.writeUInt16LE(20, 6); // version needed
    cdHeader.writeUInt16LE(0, 8); // flags
    cdHeader.writeUInt16LE(method, 10); // method
    cdHeader.writeUInt16LE(0, 12); // time
    cdHeader.writeUInt16LE(0, 14); // date
    cdHeader.writeUInt32LE(0, 16); // crc32
    cdHeader.writeUInt32LE(compressedData.length, 20);
    cdHeader.writeUInt32LE(rawData.length, 24);
    cdHeader.writeUInt16LE(nameBuf.length, 28);
    cdHeader.writeUInt16LE(0, 30); // extra len
    cdHeader.writeUInt16LE(0, 32); // comment len
    cdHeader.writeUInt16LE(0, 34); // disk number
    cdHeader.writeUInt16LE(0, 36); // internal attr
    const extAttr = f.unixType ? ((f.unixType * 65536) >>> 0) : 0;
    cdHeader.writeUInt32LE(extAttr, 38); // external attr (symlink, permissions)
    cdHeader.writeUInt32LE(offset, 42); // local header offset
    nameBuf.copy(cdHeader, 46);
    cdHeaders.push(cdHeader);

    offset += localHeader.length;
  }

  const localPart = Buffer.concat(localHeaders);
  const cdPart = Buffer.concat(cdHeaders);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // signature
  eocd.writeUInt16LE(0, 4); // disk
  eocd.writeUInt16LE(0, 6); // cd disk
  eocd.writeUInt16LE(files.length, 8); // total entries on disk
  eocd.writeUInt16LE(files.length, 10); // total entries
  eocd.writeUInt32LE(cdPart.length, 12); // cd size
  eocd.writeUInt32LE(localPart.length, 16); // cd offset
  eocd.writeUInt16LE(0, 20); // comment len

  return Buffer.concat([localPart, cdPart, eocd]);
}

module.exports = { makeZip };
