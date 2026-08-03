// Regression coverage for the UUID v7 generator.
// Guards against sign-bit overflow producing malformed UUIDs
// (e.g. rand[4] >= 128 made the 5th group negative: "a755--50254fb87e0e").

import { describe, it, expect } from 'vitest';
import { uuidv7 } from '../src/shared/utils/uuid.js';

const UUID_V7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('uuidv7', () => {
  it('always produces a valid RFC 9562 UUID v7 string', () => {
    for (let i = 0; i < 5000; i++) {
      expect(uuidv7()).toMatch(UUID_V7_RE);
    }
  });

  it('is unique across many calls', () => {
    const seen = new Set();
    for (let i = 0; i < 5000; i++) seen.add(uuidv7());
    expect(seen.size).toBe(5000);
  });

  it('is time-ordered (timestamp prefix increases with time)', async () => {
    const a = uuidv7();
    await new Promise((r) => setTimeout(r, 5));
    const b = uuidv7();
    expect(parseInt(b.slice(0, 8), 16)).toBeGreaterThanOrEqual(parseInt(a.slice(0, 8), 16));
  });
});
