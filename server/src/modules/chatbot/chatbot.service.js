import { redis }       from '../../shared/services/redis.service.js';
import { query }       from '../../shared/db/pool.js';
import { createNotification, NotificationType } from '../../shared/services/notification.service.js';
import { logger }      from '../../shared/logger.js';

// ---------------------------------------------------------------------------
// Redis key helpers
// ---------------------------------------------------------------------------
const HISTORY_KEY  = (userId) => `chatbot:history:${userId}`;
const RATE_KEY     = (userId) => `chatbot:rate:${userId}`;
const HISTORY_TTL  = 2 * 60 * 60;   // 2 hours
const RATE_WINDOW  = 60 * 60;        // 1 hour
const MAX_MESSAGES = 20;
const RATE_LIMIT   = 20;

// ---------------------------------------------------------------------------
// Intent detection — keyword-based, runs before LLM to short-circuit
// ---------------------------------------------------------------------------
const INTENT_PATTERNS = [
  { intent: 'BOOK_APPOINTMENT',          patterns: [/book\s+appoint/i, /schedule\s+appoint/i, /make\s+appoint/i, /see\s+a\s+doctor/i] },
  { intent: 'VIEW_APPOINTMENTS',         patterns: [/my\s+appoint/i, /upcoming\s+appoint/i, /when\s+is\s+my/i, /next\s+appoint/i] },
  { intent: 'VIEW_PRESCRIPTION',         patterns: [/my\s+prescript/i, /my\s+medicine/i, /my\s+medication/i, /what\s+medicine/i] },
  { intent: 'HOSPITAL_INFO',             patterns: [/hospital\s+hour/i, /visiting\s+hour/i, /location/i, /address/i, /contact/i, /phone\s+number/i, /department/i] },
  { intent: 'SYMPTOM_INQUIRY',           patterns: [/i\s+have\s+a/i, /i\s+feel/i, /my\s+\w+\s+hurt/i, /symptom/i, /pain/i, /fever/i, /headache/i, /nausea/i] },
  { intent: 'HANDOFF_TO_RECEPTIONIST',   patterns: [/speak\s+to\s+(a\s+)?human/i, /talk\s+to\s+(a\s+)?person/i, /receptionist/i, /real\s+person/i, /connect\s+me/i, /urgent\s+help/i] },
];

function detectIntent(text) {
  for (const { intent, patterns } of INTENT_PATTERNS) {
    if (patterns.some((p) => p.test(text))) return intent;
  }
  return 'GENERAL';
}

// ---------------------------------------------------------------------------
// Patient context — fetch appointments + prescriptions for grounding
// ---------------------------------------------------------------------------
async function getPatientContext(userId) {
  try {
    // Get patient record
    const { rows: patRows } = await query(
      `SELECT p.id, p.first_name, p.last_name
       FROM patients p WHERE p.user_id = $1 AND p.deleted_at IS NULL`,
      [userId]
    );
    if (!patRows[0]) return null;

    const patientId = patRows[0].id;

    // Upcoming appointments (next 5)
    const { rows: apptRows } = await query(
      `SELECT a.scheduled_at, a.status, a.type,
              u.first_name || ' ' || u.last_name AS doctor_name,
              d.name AS department
       FROM appointments a
       JOIN users u ON u.id = a.doctor_id
       LEFT JOIN departments d ON d.id = a.department_id
       WHERE a.patient_id = $1
         AND a.scheduled_at >= NOW()
         AND a.deleted_at IS NULL
       ORDER BY a.scheduled_at ASC
       LIMIT 5`,
      [patientId]
    );

    // Recent prescriptions (last 3)
    const { rows: rxRows } = await query(
      `SELECT p.status, p.created_at,
              u.first_name || ' ' || u.last_name AS doctor_name,
              COUNT(pi.id) AS item_count
       FROM prescriptions p
       JOIN users u ON u.id = p.prescribed_by
       LEFT JOIN prescription_items pi ON pi.prescription_id = p.id
       WHERE p.patient_id = $1 AND p.deleted_at IS NULL
       GROUP BY p.id, u.first_name, u.last_name
       ORDER BY p.created_at DESC
       LIMIT 3`,
      [patientId]
    );

    return {
      patientId,
      patientName: `${patRows[0].first_name} ${patRows[0].last_name}`,
      appointments: apptRows,
      prescriptions: rxRows,
    };
  } catch (err) {
    logger.error('[chatbot] Failed to fetch patient context', { message: err.message });
    return null;
  }
}

// ---------------------------------------------------------------------------
// Book appointment intent handler
// ---------------------------------------------------------------------------
export async function handleBookAppointment(userId, patientCtx, extractedData) {
  // extractedData comes from LLM response JSON block
  if (!extractedData?.department) {
    return 'To book an appointment, please tell me which department you need (e.g., General Medicine, Cardiology, Orthopedics) and your preferred date.';
  }

  try {
    const { rows: deptRows } = await query(
      `SELECT id, name FROM departments WHERE name ILIKE $1 AND deleted_at IS NULL LIMIT 1`,
      [`%${extractedData.department}%`]
    );

    if (!deptRows[0]) {
      const { rows: allDepts } = await query(
        `SELECT name FROM departments WHERE deleted_at IS NULL ORDER BY name LIMIT 10`
      );
      const deptList = allDepts.map((d) => d.name).join(', ');
      return `I couldn't find that department. Available departments are: ${deptList}. Which one would you like?`;
    }

    // Find available doctor in department
    const { rows: docRows } = await query(
      `SELECT u.id, u.first_name, u.last_name
       FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       WHERE ur.role = 'DOCTOR'
         AND u.department_id = $1
         AND ur.revoked_at IS NULL
         AND u.deleted_at IS NULL
       LIMIT 1`,
      [deptRows[0].id]
    );

    if (!docRows[0]) {
      return `No doctors are currently available in ${deptRows[0].name}. Please contact reception to schedule manually.`;
    }

    const scheduledAt = extractedData.date
      ? new Date(extractedData.date).toISOString()
      : new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(); // tomorrow

    await query(
      `INSERT INTO appointments
         (id, patient_id, doctor_id, department_id, scheduled_at, status, type, created_at, updated_at)
       VALUES
         (gen_random_uuid(), $1, $2, $3, $4, 'SCHEDULED', 'IN_PERSON', NOW(), NOW())`,
      [patientCtx.patientId, docRows[0].id, deptRows[0].id, scheduledAt]
    );

    const dateStr = new Date(scheduledAt).toLocaleString('en-GB', {
      dateStyle: 'medium', timeStyle: 'short',
    });

    return `✅ Your appointment has been booked!\n\n**Department:** ${deptRows[0].name}\n**Doctor:** Dr. ${docRows[0].first_name} ${docRows[0].last_name}\n**Date:** ${dateStr}\n\nYou'll receive a confirmation notification shortly.`;
  } catch (err) {
    // A genuine booking conflict (unique/exclusion constraint) is a
    // user-facing condition — surface it distinctly.
    if (err?.code === '23505' || err?.code === '23P01') {
      logger.warn('[chatbot] Booking conflict detected', {
        message: err.message,
        constraint: err.constraint,
        userId,
      });
      return 'That time slot appears to already be taken. Please try a different time or date, or contact reception to schedule manually.';
    }
    // Any other failure is a code defect — log it loudly rather than
    // swallowing it silently (previously every error, including the
    // appointments.type CHECK violation, was hidden behind a generic message).
    logger.error('[chatbot] Book appointment failed unexpectedly', {
      message: err.message,
      code: err.code,
      constraint: err.constraint,
      detail: err.detail,
      stack: err.stack,
      userId,
    });
    return 'I was unable to book the appointment automatically. Please contact reception at the hospital front desk or call our helpline.';
  }
}

// ---------------------------------------------------------------------------
// Handoff to receptionist
// ---------------------------------------------------------------------------
async function handleHandoff(userId, patientCtx, io) {
  try {
    // Find a receptionist to notify
    const { rows: recRows } = await query(
      `SELECT DISTINCT u.id FROM users u
       JOIN user_roles ur ON ur.user_id = u.id
       WHERE ur.role = 'RECEPTIONIST' AND ur.revoked_at IS NULL AND u.deleted_at IS NULL
       LIMIT 3`
    );

    const patientName = patientCtx?.patientName ?? 'A patient';

    await Promise.allSettled(
      recRows.map((r) =>
        createNotification(
          r.id,
          NotificationType.PATIENT_ASSIGNED,
          'Patient requesting assistance',
          `${patientName} has requested to speak with a receptionist via the chatbot.`,
          { entityType: 'CHATBOT_HANDOFF', patientUserId: userId },
          io
        )
      )
    );

    return '📞 I\'ve notified the reception team. A receptionist will reach out to you shortly. You can also call our front desk directly if it\'s urgent.';
  } catch (err) {
    logger.error('[chatbot] Handoff error', { message: err.message });
    return 'Please contact our reception desk directly. They\'ll be happy to assist you.';
  }
}

// ---------------------------------------------------------------------------
// Build system prompt
// ---------------------------------------------------------------------------
function buildSystemPrompt(patientCtx) {
  const today    = new Date().toLocaleDateString('en-GB', { dateStyle: 'full' });
  const hospName = process.env.HOSPITAL_NAME || 'the hospital';

  let contextBlock = '';
  if (patientCtx) {
    const appts = patientCtx.appointments.length
      ? patientCtx.appointments.map((a) =>
          `- ${new Date(a.scheduled_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })} with Dr. ${a.doctor_name} (${a.department ?? 'General'}) — ${a.status}`
        ).join('\n')
      : 'No upcoming appointments.';

    const rxs = patientCtx.prescriptions.length
      ? patientCtx.prescriptions.map((r) =>
          `- ${new Date(r.created_at).toLocaleDateString('en-GB')} by Dr. ${r.doctor_name} — ${r.item_count} item(s) — ${r.status}`
        ).join('\n')
      : 'No recent prescriptions.';

    contextBlock = `\n\nPatient context (for this session only — do NOT share with others):\nName: ${patientCtx.patientName}\nUpcoming appointments:\n${appts}\nRecent prescriptions:\n${rxs}`;
  }

  return `You are a helpful HMS assistant for ${hospName}. You help patients with:
- Booking appointments (extract department and preferred date from their message)
- Checking their upcoming appointments and prescriptions
- Answering general questions about the hospital
- Connecting them with reception staff

Today's date: ${today}.

IMPORTANT RULES:
1. You are NOT a doctor. Never diagnose conditions or recommend specific medications.
2. Always add a medical disclaimer when discussing symptoms: "⚠️ This is general information only. Please consult a doctor for medical advice."
3. Never share or reference other patients' data.
4. When the user wants to book an appointment, respond with a JSON block in this exact format on a new line: INTENT_DATA:{"intent":"BOOK_APPOINTMENT","department":"<dept>","date":"<ISO date or null>"}
5. Keep responses concise and friendly.
6. If you cannot help, suggest contacting reception.${contextBlock}`;
}

// ---------------------------------------------------------------------------
// LLM providers
// ---------------------------------------------------------------------------
async function callGemini(messages, systemPrompt) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY not configured');

  const model   = process.env.GEMINI_MODEL || 'gemini-1.5-flash';
  const url     = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

  // Convert history to Gemini format
  const contents = messages.map((m) => ({
    role : m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const body = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents,
    generationConfig: {
      temperature    : 0.7,
      maxOutputTokens: 512,
      topP           : 0.9,
    },
    safetySettings: [
      { category: 'HARM_CATEGORY_HARASSMENT',        threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_HATE_SPEECH',       threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
      { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_MEDIUM_AND_ABOVE' },
    ],
  };

  const res = await fetch(url, {
    method : 'POST',
    headers: {
      'Content-Type'  : 'application/json',
      'x-goog-api-key': apiKey,
    },
    body   : JSON.stringify(body),
    signal : AbortSignal.timeout(15_000),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Gemini API error ${res.status}: ${err.slice(0, 200)}`);
  }

  const json = await res.json();
  return json.candidates?.[0]?.content?.parts?.[0]?.text ?? null;
}

async function callOllama(messages, systemPrompt) {
  const baseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
  const model   = process.env.OLLAMA_MODEL    || 'llama3';

  const ollamaMessages = [
    { role: 'system', content: systemPrompt },
    ...messages,
  ];

  const res = await fetch(`${baseUrl}/api/chat`, {
    method : 'POST',
    headers: { 'Content-Type': 'application/json' },
    body   : JSON.stringify({ model, messages: ollamaMessages, stream: false }),
    signal : AbortSignal.timeout(30_000),
  });

  if (!res.ok) throw new Error(`Ollama error ${res.status}`);
  const json = await res.json();
  return json.message?.content ?? null;
}

async function callLLM(messages, systemPrompt) {
  const provider = (process.env.CHATBOT_PROVIDER || 'gemini').toLowerCase();
  if (provider === 'ollama') return callOllama(messages, systemPrompt);
  return callGemini(messages, systemPrompt);
}

// ---------------------------------------------------------------------------
// Parse INTENT_DATA block from LLM response
// ---------------------------------------------------------------------------
function parseIntentData(text) {
  const match = text.match(/INTENT_DATA:(\{.*?\})/s);
  if (!match) return null;
  try { return JSON.parse(match[1]); } catch { return null; }
}

function stripIntentData(text) {
  return text.replace(/INTENT_DATA:\{.*?\}/s, '').trim();
}

// ---------------------------------------------------------------------------
// Rate limit check (Redis counter, 20/hour per user)
// ---------------------------------------------------------------------------
async function checkRateLimit(userId) {
  const key   = RATE_KEY(userId);
  const count = await redis.incr(key);
  if (count === 1) await redis.expire(key, RATE_WINDOW);
  return count <= RATE_LIMIT;
}

// ---------------------------------------------------------------------------
// History management
// ---------------------------------------------------------------------------
async function getHistory(userId) {
  try {
    const raw = await redis.get(HISTORY_KEY(userId));
    if (!raw) return [];
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function appendHistory(userId, userMsg, assistantMsg) {
  const history = await getHistory(userId);
  history.push({ role: 'user',      content: userMsg });
  history.push({ role: 'assistant', content: assistantMsg });

  // Keep last MAX_MESSAGES (pairs)
  const trimmed = history.slice(-MAX_MESSAGES);
  await redis.setex(HISTORY_KEY(userId), HISTORY_TTL, JSON.stringify(trimmed));
}

// ---------------------------------------------------------------------------
// Main: send message
// ---------------------------------------------------------------------------
export async function sendMessage(userId, userMessage, io) {
  // 1. Rate limit
  const allowed = await checkRateLimit(userId);
  if (!allowed) {
    throw Object.assign(
      new Error('You have reached the limit of 20 messages per hour. Please try again later.'),
      { status: 429 }
    );
  }

  // 2. Fetch patient context + history in parallel
  const [patientCtx, history] = await Promise.all([
    getPatientContext(userId),
    getHistory(userId),
  ]);

  // 3. Detect intent (keyword shortcut)
  const intent = detectIntent(userMessage);

  // 4. Handle HANDOFF immediately without LLM
  if (intent === 'HANDOFF_TO_RECEPTIONIST') {
    const reply = await handleHandoff(userId, patientCtx, io);
    await appendHistory(userId, userMessage, reply);
    return { reply, intent, source: 'rule' };
  }

  // 5. Build messages for LLM
  const systemPrompt = buildSystemPrompt(patientCtx);
  const messages     = [...history, { role: 'user', content: userMessage }];

  // 6. Call LLM with graceful fallback
  let rawReply;
  try {
    rawReply = await callLLM(messages, systemPrompt);
    if (!rawReply) throw new Error('Empty response from LLM');
  } catch (err) {
    logger.error('[chatbot] LLM error', { message: err.message });
    rawReply = getFallbackReply(intent, patientCtx);
  }

  // 7. Parse intent data from LLM response
  const intentData = parseIntentData(rawReply);
  let   finalReply = stripIntentData(rawReply);

  // 8. Execute intent actions
  if (intentData?.intent === 'BOOK_APPOINTMENT' && patientCtx) {
    const actionReply = await handleBookAppointment(userId, patientCtx, intentData);
    finalReply = actionReply;
  }

  // 9. Persist history
  await appendHistory(userId, userMessage, finalReply);

  return { reply: finalReply, intent: intentData?.intent ?? intent, source: 'llm' };
}

// ---------------------------------------------------------------------------
// Fallback replies when LLM is unavailable
// ---------------------------------------------------------------------------
function getFallbackReply(intent, patientCtx) {
  const hospName = process.env.HOSPITAL_NAME || 'the hospital';
  const base     = `I'm having trouble connecting to my AI service right now. `;

  switch (intent) {
    case 'BOOK_APPOINTMENT':
      return `${base}To book an appointment, please contact our reception desk or visit the appointments section in your patient portal.`;
    case 'VIEW_APPOINTMENTS':
      if (patientCtx?.appointments?.length) {
        const list = patientCtx.appointments
          .map((a) => `• ${new Date(a.scheduled_at).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })} — Dr. ${a.doctor_name}`)
          .join('\n');
        return `Here are your upcoming appointments:\n${list}`;
      }
      return `${base}You can view your appointments in the "My Appointments" section of your portal.`;
    case 'VIEW_PRESCRIPTION':
      if (patientCtx?.prescriptions?.length) {
        const list = patientCtx.prescriptions
          .map((r) => `• ${new Date(r.created_at).toLocaleDateString('en-GB')} — Dr. ${r.doctor_name} (${r.status})`)
          .join('\n');
        return `Here are your recent prescriptions:\n${list}`;
      }
      return `${base}You can view your prescriptions in the "My Prescriptions" section.`;
    case 'SYMPTOM_INQUIRY':
      return `${base}⚠️ For medical concerns, please consult a doctor. You can book an appointment through the portal or contact ${hospName} directly.`;
    default:
      return `${base}For assistance, please contact ${hospName} reception or try again in a few minutes.`;
  }
}

// ---------------------------------------------------------------------------
// Get history for patient
// ---------------------------------------------------------------------------
export async function getChatHistory(userId) {
  return getHistory(userId);
}

// ---------------------------------------------------------------------------
// Clear history (optional utility)
// ---------------------------------------------------------------------------
export async function clearHistory(userId) {
  await redis.del(HISTORY_KEY(userId));
}
