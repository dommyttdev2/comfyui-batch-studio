import { Sha256 } from './file-sha256';

self.onmessage = async (event: MessageEvent<File>) => {
  try {
    const file = event.data,
      hash = new Sha256();
    for (let offset = 0; offset < file.size; offset += 1024 * 1024) {
      hash.update(new Uint8Array(await file.slice(offset, offset + 1024 * 1024).arrayBuffer()));
      self.postMessage({ progress: Math.min(offset + 1024 * 1024, file.size) });
    }
    self.postMessage({ sha256: hash.digest() });
  } catch {
    self.postMessage({ error: 'FILE_HASH_FAILED' });
  }
};
