// Coverage for the prescription drug-interaction checker: local fallback
// table, OpenFDA fetch with Redis caching, result merging/dedupe, and
// allergy cross-checks.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { redisGet, redisSetex, loggerWarn, loggerError, fetchMock } = vi.hoisted(() => ({
  redisGet: vi.fn(),
  redisSetex: vi.fn(),
  loggerWarn: vi.fn(),
  loggerError: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.mock('../src/shared/services/redis.service.js', () => ({
  redis: {
    get: redisGet, setex: redisSetex,
    incr: vi.fn(), expire: vi.fn(), del: vi.fn(),
  },
}));

vi.mock('../src/shared/logger.js', () => ({
  logger: { error: loggerError, warn: loggerWarn, info: vi.fn() },
}));

import { checkInteractions, checkAllergies } from '../src/modules/prescription/interactions.js';

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubGlobal('fetch', fetchMock);
  redisGet.mockResolvedValue(null);
  redisSetex.mockResolvedValue('OK');
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('interactions — checkInteractions', () => {
  it('returns [] for an empty medicine list', async () => {
    await expect(checkInteractions([])).resolves.toEqual([]);
    await expect(checkInteractions()).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns local table results when the OpenFDA cache is warm', async () => {
    redisGet.mockResolvedValue('[]');
    const res = await checkInteractions(['Warfarin', 'Aspirin']);

    expect(res).toEqual([{
      drug1: 'warfarin', drug2: 'aspirin', severity: 'HIGH',
      description: expect.stringContaining('bleeding risk'),
      source: 'local',
    }]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('merges local + OpenFDA results and dedupes the reverse pair', async () => {
    // both fetches mention the other drug → two openfda results, but the
    // reverse pair is dropped by the reverse-key dedupe
    fetchMock.mockImplementation(async (url) => ({
      ok: true,
      json: async () => ({
        results: [{ drug_interactions: url.includes('Warfarin') ? ['Interacts with Aspirin'] : ['Interacts with Warfarin'] }],
      }),
    }));

    const res = await checkInteractions(['Warfarin', 'Aspirin']);

    expect(res).toHaveLength(2);
    const sources = res.map(r => r.source).sort();
    expect(sources).toEqual(['local', 'openfda']);
    expect(redisSetex).toHaveBeenCalled();
  });

  it('adds unique OpenFDA pairs and handles string/array interaction text', async () => {
    fetchMock.mockImplementation(async (url) => {
      if (url.includes('Ampicillin')) {
        return { ok: true, json: async () => ({ results: [{ drug_interactions: ['Aspirin interaction warning'] }] }) };
      }
      // Aspirin label uses a plain string (non-array)
      return { ok: true, json: async () => ({ results: [{ drug_interactions: 'no relevant mentions' }] }) };
    });

    const res = await checkInteractions(['Ampicillin', 'Aspirin']);

    expect(res).toEqual([{
      drug1: 'Ampicillin', drug2: 'Aspirin', severity: 'MODERATE',
      description: expect.stringContaining('FDA label for Ampicillin'),
      source: 'openfda',
    }]);
  });

  it('skips non-OK OpenFDA responses', async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    const res = await checkInteractions(['Ampicillin', 'Aspirin']);
    expect(res).toEqual([]);
    expect(redisSetex).toHaveBeenCalled();
  });

  it('skips responses without interaction data', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ results: [] }) });
    const res = await checkInteractions(['Ampicillin', 'Aspirin']);
    expect(res).toEqual([]);
  });

  it('logs a warning on a fetch error', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const res = await checkInteractions(['Ampicillin']);
    expect(res).toEqual([]);
    expect(loggerWarn).toHaveBeenCalledWith(
      '[interactions] OpenFDA fetch error',
      expect.objectContaining({ drug: 'Ampicillin', message: 'network down' })
    );
  });

  it('does not warn on AbortError', async () => {
    fetchMock.mockRejectedValue({ name: 'AbortError' });
    const res = await checkInteractions(['Ampicillin']);
    expect(res).toEqual([]);
    expect(loggerWarn).not.toHaveBeenCalled();
  });

  it('continues when Redis reads fail', async () => {
    redisGet.mockRejectedValue(new Error('redis down'));
    fetchMock.mockResolvedValue({ ok: false });
    const res = await checkInteractions(['Ampicillin']);
    expect(res).toEqual([]);
  });

  it('swallows Redis write failures', async () => {
    fetchMock.mockResolvedValue({ ok: false });
    redisSetex.mockRejectedValue(new Error('write failed'));
    await expect(checkInteractions(['Ampicillin'])).resolves.toEqual([]);
  });
});

describe('interactions — checkAllergies', () => {
  it('returns [] when there are no allergies', () => {
    expect(checkAllergies([], ['Penicillin'])).toEqual([]);
    expect(checkAllergies()).toEqual([]);
  });

  it('matches an allergen embedded in a medicine name', () => {
    const res = checkAllergies(['Penicillin'], ['Penicillin V', 'Amoxicillin']);
    expect(res).toEqual([{ medicine: 'penicillin v', allergen: 'Penicillin' }]);
  });

  it('matches when the allergen is broader than the medicine name', () => {
    const res = checkAllergies(['Amoxicillin Sodium'], ['amoxicillin']);
    expect(res).toEqual([{ medicine: 'amoxicillin', allergen: 'Amoxicillin Sodium' }]);
  });

  it('returns [] when nothing matches', () => {
    expect(checkAllergies(['Sulfa'], ['Penicillin V'])).toEqual([]);
  });
});
