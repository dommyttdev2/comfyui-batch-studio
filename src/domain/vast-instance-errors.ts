export class VastAiInstanceNotFoundError extends Error {
  constructor(public readonly instanceId: number) {
    super(`Vast.ai Instance ${instanceId} が見つかりません。`);
    this.name = 'VastAiInstanceNotFoundError';
  }
}
