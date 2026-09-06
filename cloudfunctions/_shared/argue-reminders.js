"use strict";

const notifications = require("./argue-notifications");
const SHANGHAI_OFFSET_MS = 8 * 60 * 60 * 1000;
const REMINDER_POLICY = "argue_daily_reminder";

function reminderWindow(now) {
  const day = new Date(now.getTime() + SHANGHAI_OFFSET_MS).toISOString().slice(0, 10);
  const start = new Date(`${day}T00:00:00+08:00`);
  const due = new Date(start.getTime() + (11 * 60 + 30) * 60 * 1000);
  return { day, start, due, ready: now >= due };
}

// One request/day event is immutable delivery history. The marker and outbox
// insert commit together, so overlapping timer ticks cannot queue it twice.
async function queueDailyReminders(db, now, limit = 20) {
  const window = reminderWindow(now);
  if (!window.ready) return 0;
  const result = await db.collection("answer_disputes").where({
    status: "pending",
    created_at: db.command.lt(window.start),
    email_reminder_day: db.command.neq(window.day),
  }).limit(limit).get();
  let queued = 0;
  for (const candidate of result.data || []) {
    const created = await db.runTransaction(async (transaction) => {
      const currentResult = await transaction.collection("answer_disputes")
        .where({ dispute_id: candidate.dispute_id }).limit(1).get();
      const dispute = currentResult.data && currentResult.data[0];
      if (!dispute || dispute.status !== "pending" || dispute.email_reminder_day === window.day ||
          !(new Date(dispute.created_at).getTime() > 0) || new Date(dispute.created_at) >= window.start) return false;
      const event = notifications.eventForDispute(dispute);
      let available = Boolean(event && !dispute.resolution_decision);
      if (available) {
        try { await notifications.loadContext(transaction, dispute.dispute_id); }
        catch (error) {
          if (error.message !== "DISPUTE_NOT_AVAILABLE") throw error;
          available = false;
        }
      }
      if (available) {
        event.event_id += `-reminder-${window.day}`;
        event.delivery_policy = REMINDER_POLICY;
        event.reminder_day = window.day;
        event.due_at = window.due;
        event.created_at = now;
        event.updated_at = now;
        const existing = await transaction.collection("teacher_attempt_email_events")
          .where({ event_id: event.event_id }).limit(1).get();
        if (!(existing.data && existing.data[0])) {
          await transaction.collection("teacher_attempt_email_events").doc(event.event_id).create(event);
        }
      }
      await transaction.collection("answer_disputes").doc(dispute._id).update({ email_reminder_day: window.day });
      return available;
    });
    if (created) queued += 1;
  }
  return queued;
}

function assertCurrentReminder(event, dispute, now) {
  if (event.delivery_policy !== REMINDER_POLICY) return;
  const window = reminderWindow(now);
  // A delayed SMTP retry from yesterday must not create a second reminder today.
  if (event.reminder_day !== window.day || !window.ready) throw new Error("ARGUE_REMINDER_EXPIRED");
  if (dispute.resolution_decision) throw new Error("DISPUTE_ALREADY_RESOLVED");
}

module.exports = { REMINDER_POLICY, reminderWindow, queueDailyReminders, assertCurrentReminder };
