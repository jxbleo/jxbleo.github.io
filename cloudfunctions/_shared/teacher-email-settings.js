"use strict";

const MAX_TEACHER_EMAIL_RECIPIENTS = 10;

function text(value) {
  return String(value == null ? "" : value).trim();
}

function normalizeEmail(value) {
  const email = text(value).toLowerCase();
  if (!email || email.length > 254 || /[\r\n]/.test(email)) return "";
  const parts = email.split("@");
  if (parts.length !== 2 || !parts[0] || parts[0].length > 64 || !parts[1]) return "";
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/i.test(email)) return "";
  if (parts[0].startsWith(".") || parts[0].endsWith(".") || parts[0].includes("..")) return "";
  const domainLabels = parts[1].split(".");
  if (domainLabels.some((label) => !label || label.length > 63 || label.startsWith("-") || label.endsWith("-"))) return "";
  return email;
}

function teacherEmailRecipients(profile) {
  const source = Array.isArray(profile && profile.attempt_email_recipients)
    ? profile.attempt_email_recipients : [];
  const seenIds = new Set();
  const seenEmails = new Set();
  return source.map((item) => {
    const emailId = text(item && item.email_id);
    const email = normalizeEmail(item && item.email);
    if (!emailId || !email || seenIds.has(emailId) || seenEmails.has(email)) return null;
    seenIds.add(emailId);
    seenEmails.add(email);
    return {
      email_id: emailId,
      email,
      enabled: item.enabled === true,
      created_at: item.created_at || null,
      updated_at: item.updated_at || null,
    };
  }).filter(Boolean).slice(0, MAX_TEACHER_EMAIL_RECIPIENTS);
}

function enabledTeacherEmailAddresses(profiles) {
  const seen = new Set();
  const output = [];
  (profiles || []).forEach((profile) => {
    teacherEmailRecipients(profile).forEach((recipient) => {
      if (!recipient.enabled || seen.has(recipient.email)) return;
      seen.add(recipient.email);
      output.push(recipient.email);
    });
  });
  return output;
}

module.exports = {
  MAX_TEACHER_EMAIL_RECIPIENTS,
  enabledTeacherEmailAddresses,
  normalizeEmail,
  teacherEmailRecipients,
};
