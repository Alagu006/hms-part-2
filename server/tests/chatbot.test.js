// Coverage for the chatbot module: intent detection, rate limiting, Redis
// history, handoff to receptionists, Gemini/Ollama LLM calls with fallback
// replies, appointment booking via parsed intent data.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  q, redisIncr, redisExpire, redisGet, redisSetex, redisDel,
  createNotifMock, loggerError, fetchMock,
} = vi.hoisted(() => ({
  q: vi.fn(),
  redisIncr: vi.fn(),
  redisExpire: vi.fn(),
  redisGet: vi.fn(),
  redisSetex: vi.fn(),
  redisDel: vi.fn(),
  createNotifMock: vi.fn(),
  loggerError: vi.fn(),
  fetchMock: vi.fn(),
}));

vi.mock('../src/shared/services/redis.service.js', () => ({
  redis: {
    incr: redisIncr, expire: redisExpire, get: redisGet,
    setex: redisSetex, del: redisDel,
  },
}));

vi.mock('../src/shared/db/pool.js', () => ({
  query: q,
  pool : { query: q, connect: vi.fn() },
  withTransaction: vi.fn(),
}));

vi.mock('../src/shared/services/notification.service.js', () => ({
  createNotification: createNotifMock,
  NotificationType  : { PATIENT_ASSIGNED: 'PATIENT_ASSIGNED', BROADCAST: 'BROADCAST' },
}));

vi.mock('../src/shared/logger.js', () => ({
  logger: { error: loggerError, warn: vi.fn(), info: vi.fn() },
}));

import * as chatbot from '../src/modules/chatbot/chatbot.service.js';

vi.stubGlobal('fetch', fetchMock);

const PATIENT = { id: 'p1', first_name: 'Jane', last_name: 'Doe' };

function mockQuery({ patient = PATIENT, appts = [], rxs = [], dept = null, doc = null, receps = [], insertError = false } = {}) {
  q.mockImplementation(async (sql, params) => {
    if (sql.includes('FROM patients')) return { rows: patient ? [patient] : [] };
    if (sql.includes('FROM appointments')) return { rows: appts };
    if (sql.includes('FROM prescriptions')) return { rows: rxs };
    if (sql.includes('INSERT INTO appointments')) {
      if (insertError) throw new Error('insert failed');
      return { rows: [{ id: 'appt1' }] };
    }
    if (sql.includes('name ILIKE')) return { rows: dept ? [dept] : [] };
    if (sql.includes('FROM departments')) return { rows: [{ name: 'Cardiology' }, { name: 'General Medicine' }] };
    if (sql.includes("ur.role = 'DOCTOR'")) return { rows: doc ? [doc] : [] };
    if (sql.includes("ur.role = 'RECEPTIONIST'")) return { rows: receps };
    return { rows: [] };
  });
}

function geminiReply(text) {
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ candidates: [{ content: { parts: [{ text }] } }] }),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  process.env.GEMINI_API_KEY = 'test-key';
  delete process.env.CHATBOT_PROVIDER;
  delete process.env.HOSPITAL_NAME;
  redisIncr.mockResolvedValue(1);
  redisExpire.mockResolvedValue(1);
  redisGet.mockResolvedValue(null);
  redisSetex.mockResolvedValue('OK');
  redisDel.mockResolvedValue(1);
  createNotifMock.mockResolvedValue(undefined);
});

afterEach(() => {
  delete process.env.GEMINI_API_KEY;
  delete process.env.CHATBOT_PROVIDER;
  delete process.env.HOSPITAL_NAME;
});

describe('chatbot.service — sendMessage rate limiting', () => {
  it('throws 429 when the hourly limit is reached', async () => {
    redisIncr.mockResolvedValue(21);
    await expect(chatbot.sendMessage('u1', 'hello')).rejects.toMatchObject({
      message: expect.stringContaining('limit of 20 messages'),
      status : 429,
    });
    expect(redisIncr).toHaveBeenCalledWith('chatbot:rate:u1');
    expect(redisExpire).not.toHaveBeenCalled();
  });

  it('sets the rate window expiry on first message', async () => {
    mockQuery({ patient: null });
    geminiReply('hi');
    await chatbot.sendMessage('u1', 'hello');
    expect(redisExpire).toHaveBeenCalledWith('chatbot:rate:u1', expect.any(Number));
  });
});

describe('chatbot.service — sendMessage handoff (rule-based)', () => {
  it('notifies receptionists and persists history', async () => {
    mockQuery({ receps: [{ id: 'r1' }, { id: 'r2' }] });

    const io = null;
    const res = await chatbot.sendMessage('u1', 'I need to speak to a human please', io);

    expect(res).toEqual({
      reply : expect.stringContaining("I've notified the reception team"),
      intent: 'HANDOFF_TO_RECEPTIONIST',
      source: 'rule',
    });

    expect(q.mock.calls.some(([sql, params]) =>
      sql.includes("ur.role = 'RECEPTIONIST'") && (!params || params.length === 0)
    )).toBe(true);
    expect(createNotifMock).toHaveBeenCalledTimes(2);
    const [uid, type, title, message, metadata, ioArg] = createNotifMock.mock.calls[0];
    expect(type).toBe('PATIENT_ASSIGNED');
    expect(message).toContain('Jane Doe');
    expect(metadata).toEqual({ entityType: 'CHATBOT_HANDOFF', patientUserId: 'u1' });
    expect(ioArg).toBeNull();

    // history persisted with the user + assistant pair
    expect(redisSetex).toHaveBeenCalledWith(
      'chatbot:history:u1',
      expect.any(Number),
      expect.stringContaining('speak to a human')
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to a generic patient name without context', async () => {
    mockQuery({ patient: null, receps: [{ id: 'r1' }] });
    await chatbot.sendMessage('u1', 'connect me to reception', null);
    expect(createNotifMock.mock.calls[0][3]).toContain('A patient');
  });

  it('returns a contact message when reception lookup fails', async () => {
    mockQuery({ patient: null });
    q.mockImplementation(async () => { throw new Error('db down'); });

    const res = await chatbot.sendMessage('u1', 'urgent help', null);
    expect(res.reply).toContain('contact our reception desk');
    expect(loggerError).toHaveBeenCalledWith(
      '[chatbot] Handoff error',
      expect.objectContaining({ message: 'db down' })
    );
  });
});

describe('chatbot.service — sendMessage with Gemini + booking', () => {
  it('books an appointment from parsed intent data', async () => {
    mockQuery({
      appts: [{ scheduled_at: '2026-08-10T10:00:00.000Z', doctor_name: 'Dr A', department: 'Cardiology', status: 'SCHEDULED' }],
      rxs  : [{ created_at: '2026-07-01', doctor_name: 'Dr B', item_count: '2', status: 'DISPENSED' }],
      dept : { id: 'd1', name: 'Cardiology' },
      doc  : { id: 'doc1', first_name: 'Sam', last_name: 'Stone' },
    });
    geminiReply('Sure! INTENT_DATA:{"intent":"BOOK_APPOINTMENT","department":"Cardiology","date":"2026-08-10"}');

    const res = await chatbot.sendMessage('u1', 'book an appointment please', null);

    expect(res.intent).toBe('BOOK_APPOINTMENT');
    expect(res.source).toBe('llm');
    expect(res.reply).toContain('Your appointment has been booked');
    expect(res.reply).toContain('Cardiology');
    expect(res.reply).toContain('Dr. Sam Stone');

    // verify the gemini call
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain('generativelanguage.googleapis.com');
    expect(opts.headers['x-goog-api-key']).toBe('test-key');
    const body = JSON.parse(opts.body);
    expect(body.system_instruction.parts[0].text).toContain('HMS assistant');
    expect(body.contents.at(-1).parts[0].text).toBe('book an appointment please');

    // verify the appointment insert
    const insertCall = q.mock.calls.find(([sql]) => sql.includes('INSERT INTO appointments'));
    expect(insertCall).toBeDefined();
    expect(insertCall[1][0]).toBe('p1');
    expect(insertCall[1][3]).toBe('2026-08-10T00:00:00.000Z');
  });

  it('asks for a department when none is provided', async () => {
    mockQuery();
    geminiReply('INTENT_DATA:{"intent":"BOOK_APPOINTMENT"}');
    const res = await chatbot.sendMessage('u1', 'book an appointment', null);
    expect(res.reply).toContain('which department you need');
  });

  it('lists available departments when the department is unknown', async () => {
    mockQuery({ dept: null });
    geminiReply('INTENT_DATA:{"intent":"BOOK_APPOINTMENT","department":"Magic"}');
    const res = await chatbot.sendMessage('u1', 'book an appointment', null);
    expect(res.reply).toContain('Available departments are:');
    expect(res.reply).toContain('Cardiology');
  });

  it('returns a manual-contact message when no doctor is available', async () => {
    mockQuery({ dept: { id: 'd1', name: 'Cardiology' }, doc: null });
    geminiReply('INTENT_DATA:{"intent":"BOOK_APPOINTMENT","department":"Cardiology"}');
    const res = await chatbot.sendMessage('u1', 'book an appointment', null);
    expect(res.reply).toContain('No doctors are currently available');
  });

  it('handles a booking insert failure gracefully', async () => {
    mockQuery({ dept: { id: 'd1', name: 'Cardiology' }, doc: { id: 'doc1', first_name: 'S', last_name: 'T' }, insertError: true });
    geminiReply('INTENT_DATA:{"intent":"BOOK_APPOINTMENT","department":"Cardiology"}');
    const res = await chatbot.sendMessage('u1', 'book an appointment', null);
    expect(res.reply).toContain('unable to book the appointment automatically');
    expect(loggerError).toHaveBeenCalledWith(
      '[chatbot] Book appointment error',
      expect.objectContaining({ message: 'insert failed' })
    );
  });

  it('strips malformed INTENT_DATA but keeps the message', async () => {
    mockQuery({ patient: null });
    geminiReply('Here is your info INTENT_DATA:{"intent":"VIEW_APPOINTMENTS","bad":}');
    const res = await chatbot.sendMessage('u1', 'my appointments', null);
    expect(res.reply).toBe('Here is your info');
    expect(res.intent).toBe('VIEW_APPOINTMENTS');
  });
});

describe('chatbot.service — LLM fallback replies', () => {
  it('falls back for BOOK_APPOINTMENT when the LLM errors', async () => {
    mockQuery({ patient: null });
    delete process.env.GEMINI_API_KEY; // callGemini throws before fetch
    const res = await chatbot.sendMessage('u1', 'I need to see a doctor', null);
    expect(res.reply).toContain('contact our reception desk');
    expect(res.source).toBe('llm');
  });

  it('falls back for VIEW_APPOINTMENTS with a list when appointments exist', async () => {
    mockQuery({ appts: [{ scheduled_at: '2026-08-10T10:00:00.000Z', doctor_name: 'Dr A' }] });
    delete process.env.GEMINI_API_KEY;
    const res = await chatbot.sendMessage('u1', 'my appointments', null);
    expect(res.reply).toContain('Here are your upcoming appointments');
    expect(res.reply).toContain('Dr. Dr A');
  });

  it('falls back for VIEW_APPOINTMENTS without context', async () => {
    mockQuery({ patient: null });
    delete process.env.GEMINI_API_KEY;
    const res = await chatbot.sendMessage('u1', 'my appointments', null);
    expect(res.reply).toContain('"My Appointments" section');
  });

  it('falls back for VIEW_PRESCRIPTION with a list', async () => {
    mockQuery({ rxs: [{ created_at: '2026-07-01', doctor_name: 'Dr B', status: 'DISPENSED' }] });
    delete process.env.GEMINI_API_KEY;
    const res = await chatbot.sendMessage('u1', 'my medicine', null);
    expect(res.reply).toContain('Here are your recent prescriptions');
    expect(res.reply).toContain('Dr. Dr B');
  });

  it('falls back for VIEW_PRESCRIPTION without context', async () => {
    mockQuery({ patient: null });
    delete process.env.GEMINI_API_KEY;
    const res = await chatbot.sendMessage('u1', 'my medicine', null);
    expect(res.reply).toContain('"My Prescriptions" section');
  });

  it('falls back for SYMPTOM_INQUIRY with a disclaimer', async () => {
    mockQuery({ patient: null });
    delete process.env.GEMINI_API_KEY;
    const res = await chatbot.sendMessage('u1', 'I have a fever', null);
    expect(res.reply).toContain('consult a doctor');
  });

  it('falls back to the default branch for general intents', async () => {
    mockQuery({ patient: null });
    delete process.env.GEMINI_API_KEY;
    const res = await chatbot.sendMessage('u1', 'hospital hours?', null);
    expect(res.reply).toContain('contact the hospital reception');
  });

  it('handles a Gemini HTTP error', async () => {
    mockQuery({ patient: null });
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' });
    const res = await chatbot.sendMessage('u1', 'hello there', null);
    expect(loggerError).toHaveBeenCalledWith(
      '[chatbot] LLM error',
      expect.objectContaining({ message: expect.stringContaining('Gemini API error 500') })
    );
    expect(res.reply).toContain('contact the hospital reception');
  });
});

describe('chatbot.service — Ollama provider', () => {
  it('uses Ollama when configured', async () => {
    process.env.CHATBOT_PROVIDER = 'ollama';
    process.env.OLLAMA_BASE_URL = 'http://ollama:11434';
    mockQuery({ patient: null });
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ message: { content: 'hi there' } }) });

    const res = await chatbot.sendMessage('u1', 'my appointments', null);
    expect(res.reply).toBe('hi there');
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe('http://ollama:11434/api/chat');
    const body = JSON.parse(opts.body);
    expect(body.messages[0].role).toBe('system');
  });

  it('falls back on an Ollama error', async () => {
    process.env.CHATBOT_PROVIDER = 'OLLAMA';
    mockQuery({ patient: null });
    fetchMock.mockResolvedValue({ ok: false, status: 500 });
    const res = await chatbot.sendMessage('u1', 'my appointments', null);
    expect(loggerError).toHaveBeenCalledWith(
      '[chatbot] LLM error',
      expect.objectContaining({ message: 'Ollama error 500' })
    );
    expect(res.source).toBe('llm');
  });
});

describe('chatbot.service — history utilities', () => {
  it('getChatHistory returns empty array when nothing stored', async () => {
    redisGet.mockResolvedValue(null);
    await expect(chatbot.getChatHistory('u1')).resolves.toEqual([]);
  });

  it('parses a stored JSON history', async () => {
    redisGet.mockResolvedValue(JSON.stringify([{ role: 'user', content: 'hi' }]));
    const res = await chatbot.getChatHistory('u1');
    expect(res).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('returns an array when redis stores a raw array', async () => {
    redisGet.mockResolvedValue([{ role: 'assistant', content: 'hey' }]);
    const res = await chatbot.getChatHistory('u1');
    expect(res).toEqual([{ role: 'assistant', content: 'hey' }]);
  });

  it('returns empty array on a parse error', async () => {
    redisGet.mockRejectedValue(new Error('redis down'));
    await expect(chatbot.getChatHistory('u1')).resolves.toEqual([]);
  });

  it('clearHistory deletes the key', async () => {
    await chatbot.clearHistory('u1');
    expect(redisDel).toHaveBeenCalledWith('chatbot:history:u1');
  });
});
