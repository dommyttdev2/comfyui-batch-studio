const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const repo = path.resolve(__dirname, '..');
const runtime = require('node:fs').mkdtempSync(
  path.join(os.tmpdir(), 'batch-studio-image-output-'),
);
execFileSync(
  process.execPath,
  [
    path.join(repo, 'node_modules/typescript/bin/tsc'),
    '-p',
    path.join(repo, 'tsconfig.electron.json'),
    '--outDir',
    runtime,
  ],
  { cwd: repo, stdio: 'inherit' },
);
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

(async () => {
  const { writeImageAtomic } = await import(
    pathToFileURL(path.join(runtime, 'main/atomic-image-output.js')).href
  );
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'batch-studio-image-target-'));
  const output = path.join(directory, 'thumbnail-01.png');
  const image = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC',
    'base64',
  );
  const replacement = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYPgPAAEDAQAIicLsAAAAAElFTkSuQmCC',
    'base64',
  );
  const decode = (bytes) => (bytes.length === image.length ? { width: 1, height: 1 } : null);
  await writeImageAtomic(output, image, 'png', decode);
  const original = digest(await fs.readFile(output));
  const native = {
    mkdir: fs.mkdir,
    readFile: fs.readFile,
    rename: fs.rename,
    unlink: fs.unlink,
    writeFile: fs.writeFile,
    delay: async () => {},
  };
  const interrupted = {
    ...native,
    writeFile: async (file, bytes) => fs.writeFile(file, bytes.subarray(0, 12)),
  };
  await assert.rejects(
    () => writeImageAtomic(output, replacement, 'png', decode, output, interrupted),
    /検証に失敗/,
  );
  assert.equal(digest(await fs.readFile(output)), original);
  assert.deepEqual(
    (await fs.readdir(directory)).filter((name) => name.endsWith('.tmp')),
    [],
  );

  let retries = 0;
  const locked = {
    ...native,
    rename: async (source, target) => {
      if (retries++ < 2) throw Object.assign(new Error('Windows lock'), { code: 'EPERM' });
      return fs.rename(source, target);
    },
  };
  await writeImageAtomic(output, replacement, 'png', decode, output, locked);
  assert.equal(retries, 3);
  assert.equal(digest(await fs.readFile(output)), digest(replacement));
  const denied = {
    ...native,
    rename: async () => {
      throw Object.assign(new Error('busy'), { code: 'EBUSY' });
    },
  };
  await assert.rejects(() => writeImageAtomic(output, image, 'png', decode, output, denied), {
    code: 'EBUSY',
  });
  assert.equal(digest(await fs.readFile(output)), digest(replacement));
  assert.deepEqual(
    (await fs.readdir(directory)).filter((name) => name.endsWith('.tmp')),
    [],
  );

  let active = 0,
    maximum = 0;
  const slow = {
    ...native,
    writeFile: async (...args) => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      try {
        return await fs.writeFile(...args);
      } finally {
        active--;
      }
    },
  };
  await Promise.all([
    writeImageAtomic(output, image, 'png', decode, output, slow),
    writeImageAtomic(output, replacement, 'png', decode, output, slow),
  ]);
  assert.equal(maximum, 1, 'exports for the same document must be serialized');
  assert.equal(digest(await fs.readFile(output)), digest(replacement));
  await assert.rejects(
    () => writeImageAtomic(output, Buffer.from('bad'), 'png', decode),
    /デコード/,
  );
  assert.equal(digest(await fs.readFile(output)), digest(replacement));
  const jpegRed = Buffer.from(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDi6KKK+ZP3E//Z',
    'base64',
  );
  const jpegBlue = Buffer.from(
    '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDxyiiiv3E8w//Z',
    'base64',
  );
  const jpegPath = path.join(directory, 'thumbnail-01.jpg');
  await writeImageAtomic(jpegPath, jpegRed, 'jpeg', () => ({ width: 1, height: 1 }));
  const jpegOriginal = digest(await fs.readFile(jpegPath));
  await assert.rejects(
    () =>
      writeImageAtomic(
        jpegPath,
        jpegBlue,
        'jpeg',
        () => ({ width: 1, height: 1 }),
        jpegPath,
        denied,
      ),
    { code: 'EBUSY' },
  );
  assert.equal(digest(await fs.readFile(jpegPath)), jpegOriginal);
  await writeImageAtomic(jpegPath, jpegBlue, 'jpeg', () => ({ width: 1, height: 1 }));
  assert.equal(digest(await fs.readFile(jpegPath)), digest(jpegBlue));
  console.log('Atomic thumbnail image output tests passed.');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
