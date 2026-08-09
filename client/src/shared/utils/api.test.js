// Regression test: the axios instance has `baseURL: API_BASE` (api.js), so a
// call site passing `${API_BASE}/path` used to resolve to `/api/api/path` and
// 404. `apiFetch` must normalise both calling styles to the same final URL.
import { describe, it, expect, beforeEach, vi } from 'vitest';

// The real store touches `sessionStorage` at module scope (node has none).
vi.mock('../store/index.js', () => ({
  useStore: { getState: () => ({ accessToken: null }) },
}));

import api, { apiFetch, API_BASE, normalizeApiUrl } from './api.js';

// Replicates axios's baseURL+url combination for the adapter assertion.
function buildFinalUrl(baseURL, url) {
  if (!baseURL || /^https?:\/\//i.test(url)) return url;
  return `${baseURL.replace(/\/+$/, '')}/${url.replace(/^\/+/, '')}`;
}

describe('apiFetch URL normalisation (doubled /api/api regression)', () => {
  let recorded;

  beforeEach(() => {
    recorded = [];
    api.defaults.adapter = async (config) => {
      recorded.push({
        url     : config.url,
        baseURL : config.baseURL,
        finalUrl: buildFinalUrl(config.baseURL, config.url),
        method  : config.method,
      });
      return { data: {}, status: 200, statusText: 'OK', headers: {}, config, request: {} };
    };
  });

  it('resolves a plain "/path" and "${API_BASE}/path" to the SAME final URL', async () => {
    await apiFetch('/some/path');
    await apiFetch(`${API_BASE}/some/path`);

    expect(recorded).toHaveLength(2);
    const [plain, doubled] = recorded;

    // Both must hit /api/some/path — a regression to /api/api/some/path fails here.
    expect(doubled.finalUrl).toBe(plain.finalUrl);
    expect(plain.finalUrl).toBe('/api/some/path');
    expect(doubled.url).toBe(plain.url);
    expect(doubled.url).toBe('/some/path');
  });

  it('does not mangle query strings or dynamic segments', async () => {
    await apiFetch(`${API_BASE}/patients?search=smith&limit=8`);
    await apiFetch(`${API_BASE}/admin/users/${42}/status`);
    await apiFetch(`${API_BASE}/files/${'abc 123'}/download`);

    expect(recorded[0].url).toBe('/patients?search=smith&limit=8');
    expect(recorded[1].url).toBe('/admin/users/42/status');
    expect(recorded[2].url).toBe('/files/abc 123/download');
  });

  it('keeps absolute URLs untouched', async () => {
    const abs = 'https://cdn.example.com/external.png';
    await apiFetch(abs);
    expect(recorded[0].finalUrl).toBe(abs);
  });
});

describe('normalizeApiUrl', () => {
  it('strips a leading API_BASE prefix', () => {
    expect(normalizeApiUrl(`${API_BASE}/users`)).toBe('/users');
    expect(normalizeApiUrl(`${API_BASE}/`)).toBe('/');
    expect(normalizeApiUrl(API_BASE)).toBe('/');
  });

  it('leaves already-normal paths unchanged', () => {
    expect(normalizeApiUrl('/users')).toBe('/users');
    expect(normalizeApiUrl('users')).toBe('users');
    expect(normalizeApiUrl('/auth/login')).toBe('/auth/login');
  });

  it('does not strip when API_BASE is only a substring', () => {
    expect(normalizeApiUrl('/apiary')).toBe('/apiary');
    expect(normalizeApiUrl('/apix/v1')).toBe('/apix/v1');
  });
});
