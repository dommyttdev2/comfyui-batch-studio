import { createHash } from 'node:crypto';
import { normalizeWorkflowTemplateText } from '../domain/template-policy.js';

export { normalizeWorkflowTemplateText } from '../domain/template-policy.js';
export function hashWorkflowTemplate(text: string) {
  return createHash('sha256').update(normalizeWorkflowTemplateText(text), 'utf8').digest('hex');
}
