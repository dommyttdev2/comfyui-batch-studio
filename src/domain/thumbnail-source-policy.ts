export interface ThumbnailSourceFacts {
  documentIds: readonly number[];
  outputs: Readonly<Record<string, { fileName: string }>>;
}

export function isEligibleThumbnailSource(fileName: string, facts: ThumbnailSourceFacts): boolean {
  const match = /^thumbnail-(\d+)\.(png|jpe?g)$/i.exec(fileName);
  if (!match || !facts.documentIds.includes(Number(match[1]))) return false;
  const tracked = facts.outputs[String(Number(match[1]))];
  return !!tracked && tracked.fileName === fileName;
}

export function assertEligibleThumbnailSource(fileName: string, facts: ThumbnailSourceFacts): void {
  if (!isEligibleThumbnailSource(fileName, facts))
    throw new Error('現在有効なサムネイルの出力済み画像を選択してください。');
}
