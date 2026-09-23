import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('./src/api.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020 },
}).outputText;
const { api, ApiError } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('a 200 HTML login fallback yields a recoverable access error instead of a blank app', async (context) => {
  context.mock.method(globalThis, 'fetch', async () => new Response('<!doctype html><title>login</title>', {
    status: 200, headers: { 'content-type': 'text/html' },
  }));
  await assert.rejects(api.session(), (error) =>
    error instanceof ApiError && error.status === 502 && /登录态响应异常/.test(error.message));
});

test('a structurally valid session still enters the app', async (context) => {
  const session = {
    user: { number: 'fixture-user', name: '测试用户' },
    permissions: { super_admin: false, operation_admin: false, manage_permissions: false },
    access: { master_access: true, access_mode: 'all', allowed_modules: [], modules: [] },
    workspace: { role: 'specialist', role_label: '专员', home: 'personal', dashboard_scope: 'none', department: '测试', center: '测试' },
  };
  context.mock.method(globalThis, 'fetch', async () => Response.json(session));
  assert.deepEqual(await api.session(), session);
});
