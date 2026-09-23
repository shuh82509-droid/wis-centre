import test from 'node:test';
import assert from 'node:assert/strict';
import { proxyHubAuth } from './hub-auth-proxy.mjs';

function responseRecorder() {
  const state = {};
  return {
    state,
    writeHead(status, headers) { state.status = status; state.headers = headers; },
    end(body = '') { state.body = body; },
  };
}

const request = (path, extras = {}) => ({
  method: 'POST',
  headers: { host: 'hub.example.test', origin: 'https://hub.example.test', ...extras },
  path,
});

test('login forwards only an OA-issued secure session cookie', async () => {
  const res = responseRecorder();
  let cleared = 0;
  await proxyHubAuth(request('/api/hub-auth/login'), res, '/api/hub-auth/login', {
    authorityBase: 'http://authority.test/api',
    readBody: async () => Buffer.from('{"username":"FD-1","password":"secret"}'),
    clearSessionCache: () => { cleared += 1; },
    fetchImpl: async (url, options) => {
      assert.equal(url, 'http://authority.test/api/auth/login');
      assert.equal(options.headers['X-Forwarded-Proto'], 'https');
      return new Response('{"user":{"number":"FD-1"}}', {
        status: 200,
        headers: { 'set-cookie': 'wis_oa_session=signed; Path=/; Secure; HttpOnly; SameSite=Lax' },
      });
    },
  });
  assert.equal(res.state.status, 200);
  assert.match(res.state.headers['Set-Cookie'], /wis_oa_session=signed/u);
  assert.equal(cleared, 1);
});

test('login refuses an upstream response without secure cookie', async () => {
  const res = responseRecorder();
  await proxyHubAuth(request('/api/hub-auth/login'), res, '/api/hub-auth/login', {
    authorityBase: 'http://authority.test/api',
    readBody: async () => Buffer.from('{}'),
    clearSessionCache: () => assert.fail('must not cache invalid login'),
    fetchImpl: async () => new Response('{}', { status: 200 }),
  });
  assert.equal(res.state.status, 503);
});

test('cross-origin login request is rejected before forwarding credentials', async () => {
  const res = responseRecorder();
  await proxyHubAuth(request('/api/hub-auth/login', {origin: 'https://attacker.test'}), res, '/api/hub-auth/login', {
    authorityBase: 'http://authority.test/api',
    readBody: async () => assert.fail('body should not be read'),
    clearSessionCache: () => {},
    fetchImpl: async () => assert.fail('request should not be forwarded'),
  });
  assert.equal(res.state.status, 403);
});

test('logout clears the cookie with the same site-wide scope', async () => {
  const res = responseRecorder();
  await proxyHubAuth(request('/api/hub-auth/logout', {cookie: 'wis_oa_session=signed'}), res, '/api/hub-auth/logout', {
    authorityBase: 'http://authority.test/api',
    readBody: async () => Buffer.from('{}'),
    clearSessionCache: () => {},
    fetchImpl: async () => new Response('{"ok":true}', { status: 200 }),
  });
  assert.equal(res.state.status, 200);
  assert.match(res.state.headers['Set-Cookie'], /Max-Age=0; Path=\/; Secure; HttpOnly; SameSite=Lax/u);
});
