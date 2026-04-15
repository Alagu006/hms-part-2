function authHeaders() {
  return { Authorization: `Bearer ${sessionStorage.getItem('accessToken')}` };
}

export { authHeaders };

let _csrfToken = null;
async function getCsrfToken() {
  if (_csrfToken) return _csrfToken;
  const res = await fetch('/api/auth/csrf-token', { credentials: 'include' });
  const data = await res.json();
  _csrfToken = data.csrfToken;
  return _csrfToken;
}

const MUTATING = ['POST', 'PUT', 'PATCH', 'DELETE'];

export async function apiFetch(url, options = {}) {
  const method = (options.method ?? 'GET').toUpperCase();
  const extraHeaders = {};
  if (MUTATING.includes(method)) {
    extraHeaders['x-csrf-token'] = await getCsrfToken();
  }

  const response = await fetch(url, {
    ...options,
    credentials: 'include',
    headers: {
      ...authHeaders(),
      ...extraHeaders,
      ...options.headers,
    },
  });

  if (response.status === 401) {
    const { useAuth } = await import('../store/index.js');
    useAuth.getState()?.clearAuth?.();
    window.location.href = '/login';
    return response;
  }

  if (response.status === 403) {
    _csrfToken = null; // invalidate cached token
  }

  return response;
}
