import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

export type ImageFormat = 'png' | 'jpeg';
export type ImageDecoder = (bytes: Buffer) => { width: number; height: number } | null;
export type ImageOutputIo = {
  mkdir: typeof mkdir;
  readFile: typeof readFile;
  rename: typeof rename;
  unlink: typeof unlink;
  writeFile: typeof writeFile;
  delay: (attempt: number) => Promise<void>;
};

const nativeIo: ImageOutputIo = {
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
  delay: (attempt) => new Promise((resolve) => setTimeout(resolve, 100 * (attempt + 1))),
};
const pending = new Map<string, Promise<void>>();

async function withOutputLock<T>(key: string, action: () => Promise<T>): Promise<T> {
  const previous = pending.get(key) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => gate);
  pending.set(key, tail);
  await previous;
  try {
    return await action();
  } finally {
    release();
    if (pending.get(key) === tail) pending.delete(key);
  }
}

function validateImage(bytes: Buffer, format: ImageFormat, decode: ImageDecoder) {
  const signature =
    format === 'png'
      ? bytes.length >= 24 &&
        bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) &&
        bytes.toString('ascii', 12, 16) === 'IHDR'
      : bytes.length >= 4 &&
        bytes[0] === 0xff &&
        bytes[1] === 0xd8 &&
        bytes[bytes.length - 2] === 0xff &&
        bytes[bytes.length - 1] === 0xd9;
  const size = signature ? decode(bytes) : null;
  if (
    !size ||
    !Number.isSafeInteger(size.width) ||
    !Number.isSafeInteger(size.height) ||
    size.width < 1 ||
    size.height < 1
  )
    throw new Error('サムネイル画像をデコードできません。既存の出力を保持しました。');
}

export async function writeImageAtomic(
  outputPath: string,
  bytes: Buffer,
  format: ImageFormat,
  decode: ImageDecoder,
  lockKey: string = outputPath,
  io: ImageOutputIo = nativeIo,
): Promise<void> {
  return withOutputLock(lockKey, async () => {
    validateImage(bytes, format, decode);
    await io.mkdir(path.dirname(outputPath), { recursive: true });
    const temp = path.join(
      path.dirname(outputPath),
      `.${path.basename(outputPath)}.${randomUUID()}.tmp`,
    );
    try {
      await io.writeFile(temp, bytes, { flag: 'wx' });
      const staged = await io.readFile(temp);
      if (staged.length !== bytes.length || !staged.equals(bytes))
        throw new Error('一時画像の検証に失敗しました。既存の出力を保持しました。');
      validateImage(staged, format, decode);
      for (let attempt = 0; ; attempt++) {
        try {
          await io.rename(temp, outputPath);
          break;
        } catch (error) {
          const code = (error as NodeJS.ErrnoException).code;
          if (!['EPERM', 'EBUSY', 'EACCES'].includes(code ?? '') || attempt >= 4) throw error;
          await io.delay(attempt);
        }
      }
    } finally {
      try {
        await io.unlink(temp);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
          console.warn('Could not remove temporary thumbnail image:', temp, error);
      }
    }
  });
}
