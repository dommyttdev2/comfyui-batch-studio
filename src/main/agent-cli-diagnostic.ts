import type { AgentEvent } from '../shared/types.js';

const SECRET_NAME = /(?:token|secret|password|credential|authorization|api[_-]?key)/i;
const SECRET_ASSIGNMENT =
  /((?:token|secret|password|credential|authorization|api[_-]?key)\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;]+)/gi;
const BEARER = /(\bBearer\s+)[^\s,;]+/gi;
const SECRET_PREFIX = /\b(?:sk|xai)[-_][A-Za-z0-9.*_~-]{6,}\b/gi;
const SECRET_QUERY =
  /([?&](?:token|secret|password|credential|authorization|api[_-]?key|signature)=)[^&#\s]*/gi;
const MAX_DIAGNOSTIC = 4_000;

export function sanitizeAgentDiagnostic(
  value: unknown,
  env: NodeJS.ProcessEnv = process.env,
): string {
  let text = value instanceof Error ? value.message : String(value ?? '');
  for (const [name, secret] of Object.entries(env)) {
    if (!SECRET_NAME.test(name) || typeof secret !== 'string' || secret.length < 4) continue;
    text = text.split(secret).join('[REDACTED]');
  }
  text = text
    .replace(BEARER, '$1[REDACTED]')
    .replace(SECRET_ASSIGNMENT, '$1[REDACTED]')
    .replace(SECRET_QUERY, '$1[REDACTED]')
    .replace(SECRET_PREFIX, '[REDACTED]');
  return text.slice(0, MAX_DIAGNOSTIC);
}

export function sanitizeAgentEvent(
  event: AgentEvent,
  env: NodeJS.ProcessEnv = process.env,
): AgentEvent {
  if (event.type === 'turn.failed')
    return { ...event, error: sanitizeAgentDiagnostic(event.error, env) };
  if (event.type === 'activity' && event.detail)
    return { ...event, detail: sanitizeAgentDiagnostic(event.detail, env) };
  return event;
}
