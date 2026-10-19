// Regular files from a ustar stream, with pax `path` records for names over 100 bytes. Bodies `accept` rejects are skipped unread.
// `onComment` gets the global header's `comment`, where `git archive` (and so GitHub's codeload) puts the commit SHA.
export async function* readTar(stream: ReadableStream<Uint8Array>, accept: (path: string, size: number) => boolean, onComment?: (comment: string) => void) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = new Uint8Array(0);

  const fill = async (length: number) => {
    while (buffer.length < length) {
      const { done, value } = await reader.read();
      if (done) return false;
      const next = new Uint8Array(buffer.length + value.length);
      next.set(buffer);
      next.set(value, buffer.length);
      buffer = next;
    }
    return true;
  };
  const take = async (length: number) => {
    if (!(await fill(length))) throw new Error('The repository archive ended early');
    const bytes = buffer.slice(0, length);
    buffer = buffer.subarray(length);
    return bytes;
  };
  const skip = async (length: number) => {
    while (length > 0) {
      if (!buffer.length && !(await fill(1))) return;
      const step = Math.min(length, buffer.length);
      buffer = buffer.subarray(step);
      length -= step;
    }
  };

  let paxPath: string | undefined;
  while (await fill(512)) {
    const header = await take(512);
    if (header[0] === 0) break;
    const field = (start: number, length: number) => decoder.decode(header.subarray(start, start + length)).replace(/\0[\s\S]*$/, '');
    const size = parseInt(field(124, 12).trim() || '0', 8);
    const type = field(156, 1);
    const prefix = field(345, 155);
    const padding = Math.ceil(size / 512) * 512 - size;
    if (type === 'g') {
      const comment = decoder.decode(await take(size)).match(/^\d+ comment=(.*)$/m)?.[1];
      if (comment) onComment?.(comment);
      await skip(padding);
      continue;
    }
    if (type === 'x') {
      paxPath = decoder.decode(await take(size)).match(/^\d+ path=(.*)$/m)?.[1];
      await skip(padding);
      continue;
    }
    const path = paxPath ?? (prefix ? `${prefix}/${field(0, 100)}` : field(0, 100));
    paxPath = undefined;
    const isFile = type === '0' || type === '';
    if (isFile && accept(path, size)) yield { path, body: await take(size) };
    else await skip(size);
    await skip(padding);
  }
  await reader.cancel();
}
