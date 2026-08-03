// Coverage for the nurse-assignments module: listing a nurse's assignments
// for today with vitals recency and overdue flags.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const { q } = vi.hoisted(() => ({ q: vi.fn() }));

vi.mock('../src/shared/db/pool.js', () => ({
  query: q,
  pool : { query: q, connect: vi.fn() },
  withTransaction: vi.fn(),
}));

import * as nurseAssignments from '../src/modules/nurse-assignments/nurse-assignments.service.js';

beforeEach(() => {
  vi.resetAllMocks();
});

describe('nurse-assignments.service — getMyAssignmentsToday', () => {
  it('maps rows and flags overdue vitals', async () => {
    q.mockResolvedValue({
      rows: [
        {
          assignment_id: 'a1', shift_type: 'MORNING', patient_id: 'p1', mrn: 'MRN1',
          first_name: 'Ann', last_name: 'A', bed_number: 'B1', room_number: 'R1',
          room_type: 'PRIVATE', department_name: 'Ward', last_vitals_id: 'v1',
          last_vitals_at: '2026-01-01', hours_since_vitals: 5.1234,
        },
        {
          assignment_id: 'a2', shift_type: 'EVENING', patient_id: 'p2', mrn: 'MRN2',
          first_name: 'Bob', last_name: 'B', bed_number: null, room_number: null,
          room_type: null, department_name: null, last_vitals_id: null,
          last_vitals_at: null, hours_since_vitals: null,
        },
      ],
    });

    const res = await nurseAssignments.getMyAssignmentsToday('n1', '2026-03-03');

    expect(q.mock.calls[0][1]).toEqual(['n1', '2026-03-03']);
    expect(res[0]).toMatchObject({
      assignmentId: 'a1', shiftType: 'MORNING', patientId: 'p1', mrn: 'MRN1',
      firstName: 'Ann', lastName: 'A', bedNumber: 'B1', roomNumber: 'R1',
      roomType: 'PRIVATE', departmentName: 'Ward', lastVitalsAt: '2026-01-01',
      hoursSinceVitals: 5.12, isOverdue: true,
    });
    expect(res[1]).toMatchObject({
      assignmentId: 'a2', hoursSinceVitals: null, isOverdue: false,
    });
  });

  it('defaults the date to today when not provided', async () => {
    q.mockResolvedValue({ rows: [] });
    await nurseAssignments.getMyAssignmentsToday('n1');
    expect(q.mock.calls[0][1]).toEqual(['n1', new Date().toISOString().split('T')[0]]);
  });

  it('marks recent vitals as not overdue', async () => {
    q.mockResolvedValue({ rows: [{ assignment_id: 'a1', hours_since_vitals: 2 }] });
    const res = await nurseAssignments.getMyAssignmentsToday('n1', '2026-03-03');
    expect(res[0].isOverdue).toBe(false);
    expect(res[0].hoursSinceVitals).toBe(2);
  });
});
