import assert from 'node:assert/strict';
import { token } from './server-fixtures.mjs';
export async function login(runtime, config) {
  const base = {
    'x-batch-api-version': '1',
    'x-batch-build-id': config.buildId,
    'x-request-id': 'api-request',
    'content-type': 'application/json',
    origin: runtime.origin,
  };
  const res = await fetch(runtime.origin + '/api/v1/session', {
    method: 'POST',
    headers: { ...base, authorization: 'Bearer ' + token },
    body: '{}',
  });
  assert.equal(res.status, 200);
  const body = await res.json();
  return {
    ...base,
    cookie: res.headers.get('set-cookie').split(';')[0],
    'x-csrf-token': body.csrfToken,
  };
}
