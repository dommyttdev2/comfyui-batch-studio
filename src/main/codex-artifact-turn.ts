// Parse only the user request associated with a Codex turn. Assistant replies may
// mention artifact names as ordinary text; they must not classify a turn as a task.
export function codexTaskFileForTurn(turn: unknown): string | null {
  const items = (turn as { items?: unknown[] } | null)?.items;
  if (!Array.isArray(items)) return null;
  const userMessage = items.find(
    (item) => (item as { type?: string } | null)?.type === 'userMessage',
  );
  if (!userMessage || typeof userMessage !== 'object') return null;
  const message = userMessage as { text?: unknown; content?: unknown };
  const text =
    typeof message.text === 'string'
      ? message.text
      : Array.isArray(message.content)
        ? message.content
            .filter(
              (part): part is { text: string } =>
                part !== null &&
                typeof part === 'object' &&
                typeof (part as { text?: unknown }).text === 'string',
            )
            .map((part) => part.text)
            .join('\n')
        : '';
  if (!text.includes('## Codex向け出力契約')) return null;
  // Story discussion can mention story.md without requesting an artifact.
  // Capture only the filename, not the entire phrase "回答の最後に ...".
  const match = text.match(
    /回答の最後に\s*(story\.md|model_loras\.json|prompt_plan\.json|prompt_plan_patch\.json|caption_content\.json)/,
  );
  return match?.[1] ?? null;
}

export function latestCompletedArtifactTurn<T extends { status?: unknown }>(
  turns: T[],
  fileName: string | readonly string[],
): T | null {
  const allowed = Array.isArray(fileName) ? fileName : [fileName];
  return (
    [...turns]
      .reverse()
      .find(
        (turn) =>
          turn.status === 'completed' &&
          allowed.includes(codexTaskFileForTurn(turn) ?? ''),
      ) ?? null
  );
}
