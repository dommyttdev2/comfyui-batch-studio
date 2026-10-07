export function normalizeWorkflowTemplateText(text: string) {
  return text.replace(/\r\n?/g, '\n');
}
