/** Raw-deflate decompression capped at `maxBytes`: `zlib.inflateRawSync` in main, `DecompressionStream` on the web. */
export type Inflate = (
  data: Uint8Array,
  maxBytes: number,
) => Promise<Uint8Array>;

interface Entry {
  method: number;
  compressedSize: number;
  size: number;
  headerOffset: number;
}

/**
 * Reads single files out of a zip without extracting it: the central directory is parsed once, and `read` inflates only
 * the entry asked for. Encrypted, zip64 and anything but stored/deflated entries are refused.
 */
export function openZip(bytes: Uint8Array, inflate: Inflate) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const entries = centralDirectory(bytes, view);
  return {
    has: (name: string) => entries.has(name),
    async read(name: string, maxBytes: number) {
      const entry = entries.get(name);
      if (!entry) throw new Error(`${name} is not in the package`);
      if (entry.size > maxBytes)
        throw new Error(`${name} is larger than ${maxBytes} bytes`);
      const at = entry.headerOffset;
      if (at + 30 > bytes.length || view.getUint32(at, true) !== 0x04034b50)
        throw new Error(`${name}: bad local header`);
      const start =
        at + 30 + view.getUint16(at + 26, true) + view.getUint16(at + 28, true);
      const data = bytes.subarray(start, start + entry.compressedSize);
      if (data.length !== entry.compressedSize)
        throw new Error(`${name}: truncated`);
      if (entry.method === 0) return data;
      if (entry.method === 8) return inflate(data, maxBytes);
      throw new Error(`${name}: unsupported compression ${entry.method}`);
    },
  };
}

function centralDirectory(bytes: Uint8Array, view: DataView) {
  const eocd = findEndRecord(view);
  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  if (count === 0xffff || at === 0xffffffff)
    throw new Error('zip64 packages are not supported');
  const names = new TextDecoder();
  const entries = new Map<string, Entry>();
  for (let i = 0; i < count; i++) {
    if (at + 46 > bytes.length || view.getUint32(at, true) !== 0x02014b50)
      throw new Error('bad central directory');
    const nameLength = view.getUint16(at + 28, true);
    const name = names.decode(bytes.subarray(at + 46, at + 46 + nameLength));
    if (view.getUint16(at + 8, true) & 1)
      throw new Error(`${name} is encrypted`);
    entries.set(name, {
      method: view.getUint16(at + 10, true),
      compressedSize: view.getUint32(at + 20, true),
      size: view.getUint32(at + 24, true),
      headerOffset: view.getUint32(at + 42, true),
    });
    at +=
      46 +
      nameLength +
      view.getUint16(at + 30, true) +
      view.getUint16(at + 32, true);
  }
  return entries;
}

/** The end-of-central-directory record sits in the last 22 bytes plus up to 64 KiB of comment. */
function findEndRecord(view: DataView) {
  for (
    let at = view.byteLength - 22;
    at >= Math.max(0, view.byteLength - 22 - 0xffff);
    at--
  ) {
    if (view.getUint32(at, true) === 0x06054b50) return at;
  }
  throw new Error('not a zip file');
}
