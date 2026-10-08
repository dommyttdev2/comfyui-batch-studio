export interface CurrentFormatRecoveryPorts<T> {
  exclusive<R>(work: () => Promise<R>): Promise<R>;
  load(): Promise<T>;
  corruption(error: unknown): 'corrupt' | 'missing' | null;
  restore(): Promise<void>;
  initialize(): Promise<void>;
}

// Called after a trusted, target-bound confirmation. Schema validation and byte
// preservation are repository contracts; automatic recovery is never invoked.
export async function recoverCurrentFormat<T>(
  ports: CurrentFormatRecoveryPorts<T>,
  operation: 'restore' | 'initialize',
): Promise<T> {
  return ports.exclusive(async () => {
    try {
      await ports.load();
    } catch (error) {
      if (ports.corruption(error) !== 'corrupt') throw error;
      if (operation === 'restore') await ports.restore();
      else await ports.initialize();
      return ports.load();
    }
    throw new Error(
      operation === 'restore'
        ? '編集データは正常です。復元は必要ありません。'
        : '編集データは正常です。初期化は必要ありません。',
    );
  });
}
