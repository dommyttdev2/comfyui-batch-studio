import { createHash } from 'node:crypto';

export function normalizeWorkflowTemplateText(text: string) {
  return text.replace(/\r\n?/g, '\n');
}

export function hashWorkflowTemplate(text: string) {
  return createHash('sha256')
    .update(Buffer.from(normalizeWorkflowTemplateText(text), 'utf8'))
    .digest('hex');
}
