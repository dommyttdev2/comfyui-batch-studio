export function storyBriefInputs(value: any) {
  const copy = JSON.parse(JSON.stringify(value ?? {}));
  if (copy?.generation && typeof copy.generation === 'object') delete copy.generation.modelFamily;
  return copy;
}
export function sameStoryBriefInputs(a: any, b: any) {
  return JSON.stringify(storyBriefInputs(a)) === JSON.stringify(storyBriefInputs(b));
}
