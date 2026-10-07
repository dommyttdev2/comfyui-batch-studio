import type { ArtifactKey } from '../domain/contracts.js';
import type { RenderSize } from '../domain/image-policy.js';
// No safeStorage/nativeImage, paths, Buffer, or process environment in core types.
export interface SecretStore {
  read(reference: string): Promise<string>;
}
export interface ImageCodec {
  render(
    source: Uint8Array,
    size: RenderSize,
    format: 'png' | 'jpeg' | 'webp',
  ): Promise<Uint8Array>;
}
export interface ResourceStore {
  read(projectId: string, resourceId: string): Promise<Uint8Array>;
}
export interface ArtifactRepository {
  read(projectId: string, key: ArtifactKey): Promise<string>;
}
