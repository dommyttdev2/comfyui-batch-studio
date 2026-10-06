import {
  authorize,
  BusinessError,
  requireId,
  type ActorContext,
  type Command,
} from '../domain/contracts.js';
import { assertRenderSize, type RenderSize } from '../domain/image-policy.js';
import type { ImageCodec, ResourceStore, SecretStore } from './platform-ports.js';
export class PlatformUseCases {
  constructor(
    private readonly secrets: SecretStore,
    private readonly resources: ResourceStore,
    private readonly images: ImageCodec,
  ) {}
  async withCredential<T>(
    reference: string,
    operation: (secret: string) => Promise<T>,
  ): Promise<T> {
    requireId(reference, 'Configured credential reference');
    const secret = await this.secrets.read(reference);
    if (!secret)
      throw new BusinessError('DEPENDENCY_UNAVAILABLE', 'Configured credential is unavailable.');
    return operation(secret);
  }
  async render(
    actor: ActorContext,
    command: Command & { assetId: string; size: RenderSize; format: 'png' | 'jpeg' | 'webp' },
  ) {
    authorize(actor, command.projectId, 'edit');
    requireId(command.assetId, 'Asset');
    assertRenderSize(command.size);
    if (!['png', 'jpeg', 'webp'].includes(command.format))
      throw new BusinessError('INVALID_INPUT', 'Unsupported image format.');
    // The infrastructure resolves only scope-authorized asset IDs, never client paths.
    const source = await this.resources.read(command.projectId, command.assetId);
    return this.images.render(source, command.size, command.format);
  }
}
