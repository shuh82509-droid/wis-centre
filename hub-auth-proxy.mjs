const routes = Object.freeze({
  '/api/hub-auth/login': '/auth/login',
  '/api/hub-auth/captcha': '/auth/captcha',
  '/api/hub-auth/logout': '/auth/logout',
});

export async function proxyHubAuth(request, response, pathname, {
  authorityBase, readBody, clearSessionCache, fetchImpl = fetch,
}) {
  const target = routes[pathname];
  if (!target) return false;
  if (request.method !== 'POST') {
    response.writeHead(405, { Allow: 'POST', 'Cache-Control': 'no-store' });
    response.end();
    return true;
  }
  try {
    const origin = request.headers.origin;
    if (origin && new URL(origin).host !== request.headers.host) {
      response.writeHead(403, { 'Cache-Control': 'no-store' });
      response.end();
      return true;
    }
    const body = pathname === '/api/hub-auth/logout' ? Buffer.from('{}') : await readBody(request, 4096);
    const upstream = await fetchImpl(`${authorityBase}${target}`, {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'X-Forwarded-Proto': 'https',
        ...(pathname === '/api/hub-auth/logout' && request.headers.cookie
          ? { Cookie: request.headers.cookie } : {}),
      },
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(15000),
    });
    const raw = await upstream.text();
    const payload = JSON.parse(raw);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('invalid response');
    const headers = {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    };
    if (upstream.ok && target === '/auth/login') {
      const cookie = upstream.headers.get('set-cookie');
      if (!cookie || !/\bwis_oa_session=/u.test(cookie) || !/\bhttponly\b/iu.test(cookie) ||
          !/\bsecure\b/iu.test(cookie) || !/\bsamesite=lax\b/iu.test(cookie)) {
        throw new Error('missing secure session cookie');
      }
      headers['Set-Cookie'] = cookie;
      clearSessionCache();
    }
    if (upstream.ok && target === '/auth/logout') {
      headers['Set-Cookie'] = 'wis_oa_session=; Max-Age=0; Path=/; Secure; HttpOnly; SameSite=Lax';
      clearSessionCache();
    }
    response.writeHead(upstream.status, headers);
    response.end(JSON.stringify(payload));
  } catch {
    response.writeHead(503, {
      'Cache-Control': 'no-store',
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    });
    response.end(JSON.stringify({ detail: '统一登录服务暂时不可用，请稍后重试' }));
  }
  return true;
}
