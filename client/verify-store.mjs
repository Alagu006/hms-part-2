import assert from 'node:assert/strict';

const mem = new Map();
globalThis.sessionStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};

const { useStore, getAccessToken } = await import('./src/shared/store/index.js');

assert.ok(!mem.has('accessToken'), 'no raw accessToken key initially');
assert.ok(!mem.has('hms-auth'), 'no hms-auth blob initially');

useStore.getState().setAuth({ user: { id: 'u1', firstName: 'T', roles: ['ADMIN'] }, accessToken: 'tok-123' });

assert.equal(getAccessToken(), 'tok-123', 'getAccessToken returns token after setAuth');
assert.ok(!mem.has('accessToken'), 'setAuth does NOT write raw accessToken key');
assert.ok(mem.has('hms-auth'), 'setAuth persists hms-auth blob');
const blob = JSON.parse(mem.get('hms-auth'));
assert.equal(blob.state.accessToken, 'tok-123', 'hms-auth blob holds token');
assert.equal(blob.state.user.id, 'u1', 'hms-auth blob holds user');

// Simulate a page refresh: new JS context rehydrating from existing sessionStorage.
const freshUrl = new URL('./src/shared/store/index.js', import.meta.url).href + '?refresh=1';
const { useStore: freshStore, getAccessToken: freshGet } = await import(freshUrl);
assert.equal(freshGet(), 'tok-123', 'session survives refresh (rehydrated from hms-auth)');
assert.ok(!mem.has('accessToken'), 'no raw key after refresh');

freshStore.getState().clearAuth();
assert.ok(!mem.has('accessToken'), 'logout leaves no raw accessToken key');
assert.equal(freshGet(), null, 'token cleared after logout');
assert.ok(mem.has('hms-auth'), 'hms-auth blob still exists after logout');
const after = JSON.parse(mem.get('hms-auth'));
assert.equal(after.state.accessToken, null, 'hms-auth has no token after logout');
assert.equal(after.state.user, null, 'hms-auth has no user after logout');

console.log('PASS: setAuth/clearAuth no longer touch raw accessToken key; hms-auth is the single writer; session survives refresh and clears on logout.');
