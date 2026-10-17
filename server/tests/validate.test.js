// Coverage for the zod validation middleware (validate.js).
//
// Exercises every branch: 422 with field/message issues on body/params/query
// failures, passthrough + field replacement on success, coercion, unknown-key
// stripping, nested field paths, multiple simultaneous issues, and the
// parsedQuery side-channel for query strings.

import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';

import { validate } from '../src/shared/middleware/validate.js';

function makeRes() {
  const res = { _status: null, _body: null };
  res.status = (s) => { res._status = s; return res; };
  res.json   = (b) => { res._body   = b; return res; };
  return res;
}

describe('validate() — failure path (422)', () => {
  it('returns 422 with field + message when the body fails validation', () => {
    const schema = z.object({
      body: z.object({ name: z.string().min(3) }),
    });
    const res  = makeRes();
    const next = vi.fn();

    validate(schema)({ body: { name: 'x' }, query: {}, params: {} }, res, next);

    expect(res._status).toBe(422);
    expect(res._body.error).toBe('Validation failed');
    expect(res._body.issues).toEqual([
      { field: 'body.name', message: expect.stringContaining('at least 3') },
    ]);
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 422 with a coerced-path issue for params failures', () => {
    const schema = z.object({
      params: z.object({ id: z.string().uuid() }),
    });
    const res  = makeRes();
    const next = vi.fn();

    validate(schema)({ body: {}, query: {}, params: { id: 'not-a-uuid' } }, res, next);

    expect(res._status).toBe(422);
    expect(res._body.issues[0]).toEqual({ field: 'params.id', message: expect.stringContaining('uuid') });
    expect(next).not.toHaveBeenCalled();
  });

  it('returns 422 for a failing query section', () => {
    const schema = z.object({
      query: z.object({ status: z.enum(['active', 'archived']) }),
    });
    const res  = makeRes();
    const next = vi.fn();

    validate(schema)({ body: {}, query: { status: 'bogus' }, params: {} }, res, next);

    expect(res._status).toBe(422);
    expect(res._body.issues[0].field).toBe('query.status');
    expect(next).not.toHaveBeenCalled();
  });

  it('reports multiple issues across different fields at once', () => {
    const schema = z.object({
      body: z.object({
        email: z.string().email(),
        age  : z.number().min(0),
      }),
    });
    const res  = makeRes();
    const next = vi.fn();

    validate(schema)({ body: { email: 'nope', age: -1 }, query: {}, params: {} }, res, next);

    expect(res._status).toBe(422);
    expect(res._body.issues.map((i) => i.field).sort()).toEqual(['body.age', 'body.email']);
    expect(next).not.toHaveBeenCalled();
  });

  it('joins nested array paths with dots', () => {
    const schema = z.object({
      body: z.object({ items: z.array(z.object({ qty: z.number().int().positive() })) }),
    });
    const res  = makeRes();
    const next = vi.fn();

    validate(schema)({ body: { items: [{ qty: 0 }] }, query: {}, params: {} }, res, next);

    expect(res._status).toBe(422);
    expect(res._body.issues[0].field).toBe('body.items.0.qty');
  });
});

describe('validate() — success path (passthrough + replacement)', () => {
  it('calls next() and never writes a response on success', () => {
    const schema = z.object({
      body: z.object({ name: z.string().min(3) }),
    });
    const res  = makeRes();
    const next = vi.fn();

    validate(schema)({ body: { name: 'alice' }, query: {}, params: {} }, res, next);

    expect(res._status).toBeNull();
    expect(res._body).toBeNull();
    expect(next).toHaveBeenCalledOnce();
  });

  it('replaces req.body with the parsed (coerced) value', () => {
    const schema = z.object({
      body: z.object({ amount: z.coerce.number(), name: z.string() }),
    });
    const req = { body: { amount: '42.50', name: 'bill' }, query: {}, params: {} };

    validate(schema)(req, makeRes(), vi.fn());

    expect(req.body.amount).toBe(42.5);
    expect(req.body.name).toBe('bill');
  });

  it('strips unknown keys from req.body on success', () => {
    const schema = z.object({
      body: z.object({ name: z.string() }),
    });
    const req = { body: { name: 'ok', admin: true, secret: 'x' }, query: {}, params: {} };

    validate(schema)(req, makeRes(), vi.fn());

    expect(req.body).toEqual({ name: 'ok' });
  });

  it('replaces req.params with coerced values', () => {
    const schema = z.object({
      params: z.object({ id: z.coerce.number() }),
    });
    const req = { body: {}, query: {}, params: { id: '7' } };

    validate(schema)(req, makeRes(), vi.fn());

    expect(req.params).toEqual({ id: 7 });
  });

  it('exposes parsed query values on req.parsedQuery (not req.query)', () => {
    const schema = z.object({
      query: z.object({ limit: z.coerce.number().max(100) }),
    });
    const req = { body: {}, query: { limit: '50' }, params: {} };

    validate(schema)(req, makeRes(), vi.fn());

    expect(req.parsedQuery).toEqual({ limit: 50 });
    expect(req.query).toEqual({ limit: '50' });
  });

  it('passes through when optional sections are absent', () => {
    const schema = z.object({
      body: z.object({ note: z.string().optional() }),
    });
    const req  = { body: {}, query: {}, params: {} };
    const next = vi.fn();

    validate(schema)(req, makeRes(), next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.parsedQuery).toBeUndefined();
    expect(req.params).toEqual({});
  });
});
