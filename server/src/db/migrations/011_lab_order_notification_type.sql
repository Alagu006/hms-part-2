-- Migration 011: Add LAB_ORDER to notifications type check constraint
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
    CHECK (type IN (
        'APPOINTMENT','LAB_RESULT','LAB_ORDER','PRESCRIPTION','MESSAGE','SYSTEM','ALERT','SHIFT','LEAVE',
        'OT_SCHEDULED','BLOOD_REQUEST','EMERGENCY_ALERT','DISCHARGE_SUMMARY','INCIDENT'
    ));
