const redirects = new Set([301, 302, 303, 307, 308]);
const transientStatuses = new Set([408, 425, 429, 500, 502, 503, 504]);

export function authorityTarget({ authorityBase, sessionBase }, path, method = "GET") {
  // The lightweight authority only implements this read-only session endpoint.
  // Permission mutations, organization data and all business APIs stay put.
  const useSession = sessionBase && method === "GET" && path.split("?", 1)[0] === "/central-auth/me";
  return `${String(useSession ? sessionBase : authorityBase).replace(/\/+$/u, "")}${path}`;
}

export async function requestAuthority({ authorityBase, sessionBase, fetchImpl = fetch }, { path, method = "GET", body, headers, timeoutMs = 15000 }) {
  const unavailable = { status: 503, payload: { detail: "统一权限服务暂时不可用，请稍后刷新" } };
  try {
    const upstream = await fetchImpl(authorityTarget({ authorityBase, sessionBase }, path, method), {
      method, headers, body: body?.length ? body : undefined,
      redirect: "manual", signal: AbortSignal.timeout(timeoutMs)
    });
    if (redirects.has(upstream.status)) {
      await upstream.body?.cancel();
      return { status: 401, payload: { detail: "统一登录状态已失效，请返回中枢首页重新登录" } };
    }
    if (upstream.status === 204) return { status: 204, payload: {} };
    // Reading the body belongs to the same deadline and error boundary as
    // receiving headers. A truncated response is not a revoked authorization.
    const raw = await upstream.text();
    try {
      return { status: upstream.status, payload: JSON.parse(raw) };
    } catch {
      const transient = transientStatuses.has(upstream.status) || upstream.status < 400;
      const status = upstream.status === 401 ? 401 : transient ? 503 : upstream.status;
      return { status, payload: { detail: status === 401
        ? "统一登录状态已失效，请返回中枢首页重新登录"
        : transient ? unavailable.payload.detail : `统一权限服务请求未完成（${status}）` } };
    }
  } catch {
    // Never retry a mutation or fall back to another identity/authority.
    return unavailable;
  }
}
