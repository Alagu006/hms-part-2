let csrfToken = null;

export async function initCSRF() {
  const res = await fetch('/api/auth/csrf-token', { credentials: 'include' });
  if (res.ok) {
    const data = await res.json();
    csrfToken = data.csrfToken;
  }
}

export function getCSRFToken() {
  return csrfToken;
}

export async function csrfFetch(url, options = {}) {
  const headers = {
    ...(options.headers || {}),
  };
  if (csrfToken) {
    headers['x-csrf-token'] = csrfToken;
  }
  return fetch(url, { ...options, headers });
}

initCSRF();
