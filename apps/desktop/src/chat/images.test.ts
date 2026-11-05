import assert from 'node:assert/strict';
import { test } from 'vite-plus/test';
import {
  ATTACHMENT_ERRORS,
  attachmentProblem,
  isInlineImage,
  withAttachedFiles,
} from './images';

const file = (mediaType: string, bytes = 3, filename?: string) => ({
  url: `data:${mediaType};base64,${'A'.repeat(Math.ceil((bytes * 4) / 3))}`,
  mediaType,
  ...(filename && { filename }),
});

test('only small images of the four agent types go inline', () => {
  assert.equal(isInlineImage(file('image/png')), true);
  assert.equal(isInlineImage(file('image/svg+xml')), false);
  assert.equal(isInlineImage(file('application/pdf')), false);
  assert.equal(isInlineImage(file('image/png', 6_000_000)), false);
});

test('any file type passes; size, count and where it goes can refuse', () => {
  assert.equal(attachmentProblem([file('application/zip')]), null);
  assert.equal(
    attachmentProblem([file('text/csv', 21_000_000)]),
    ATTACHMENT_ERRORS.max_file_size,
  );
  assert.equal(
    attachmentProblem(Array.from({ length: 9 }, () => file('image/png'))),
    ATTACHMENT_ERRORS.max_files,
  );
  assert.equal(
    attachmentProblem([{ url: 'blob:x', mediaType: 'image/png' }]),
    ATTACHMENT_ERRORS.accept,
  );
  assert.equal(attachmentProblem([file('image/png')], 'Studio'), null);
  assert.match(
    attachmentProblem([file('application/pdf')], 'Studio') ?? '',
    /can go to Studio$/,
  );
});

test('files that aren’t inline images are kept and named in the text', async () => {
  const saved: string[] = [];
  const save = async (name: string) => (saved.push(name), `/data/${name}`);
  const files = [
    file('image/png'),
    file('application/pdf', 3, 'report.pdf'),
    file('image/heic'),
  ];
  assert.equal(
    await withAttachedFiles('Read these', files, save),
    'Read these\n\nAttached files:\n- `/data/report.pdf`\n- `/data/attachment`',
  );
  assert.deepEqual(saved, ['report.pdf', 'attachment']);
  assert.equal(
    await withAttachedFiles('', [file('text/plain', 3, 'a.txt')], save),
    'Attached files:\n- `/data/a.txt`',
  );
  assert.equal(
    await withAttachedFiles('Just an image', [file('image/png')], save),
    'Just an image',
  );
});
