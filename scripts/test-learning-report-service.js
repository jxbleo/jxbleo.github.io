#!/usr/bin/env node

const assert = require("assert");
const Module = require("module");
const path = require("path");

const rules = require("../cloudfunctions/_shared/learning-reports");
let authenticatedUid = "teacher-uid";
let beforeTransaction = null;

const period = rules.periodForDate("weekly", new Date());
const reportId = rules.reportIdFor("class-a", period);
const rows = {
  students: [
    { _id: "teacher", auth_uid: "teacher-uid", role: "teacher", active: true, name: "Teacher" },
    { _id: "student-a", auth_uid: "student-a", student_id: "alice", role: "student", active: true, name: "王小美", chinese_name: "王小美", english_name: "Alice" },
    { _id: "student-b", auth_uid: "student-b", student_id: "bob", role: "student", active: true, name: "李大卫", chinese_name: "李大卫", english_name: "David" },
  ],
  classes: [{ _id: "class-doc", class_id: "class-a", name: "Class A", active: true }],
  class_memberships: [
    { _id: "member-a", membership_id: "member-a", class_id: "class-a", student_uid: "student-a", active: true, started_at: new Date(period.start_at.getTime() - 86400000), ended_at: null },
    { _id: "member-b", membership_id: "member-b", class_id: "class-a", student_uid: "student-b", active: true, started_at: new Date(period.start_at.getTime() - 86400000), ended_at: null },
  ],
  assignments: [],
  attempts: [],
  sets: [],
  learning_reports: [{
    _id: "report-doc",
    report_id: reportId,
    status: "preview",
    class_id: "class-a",
    class_name: "Class A",
    period_type: "weekly",
    period_key: period.period_key,
    period_start: period.start_at,
    period_end: period.end_at,
    membership_snapshot: [{ student_uid: "student-a" }, { student_uid: "student-b" }],
    leaderboard: [
      { student_uid: "student-a", rank: 1, chinese_name: "王小美", english_name: "Alice", completed_class_item_count: 2, assigned_class_item_count: 2 },
      { student_uid: "student-b", rank: 2, chinese_name: "李大卫", english_name: "David", completed_class_item_count: 1, assigned_class_item_count: 2 },
    ],
    student_details: [
      { student_uid: "student-a", chinese_name: "王小美", english_name: "Alice", teacher_comment: "Original", teacher_goals: [] },
      { student_uid: "student-b", chinese_name: "李大卫", english_name: "David", teacher_comment: "Private", teacher_goals: [] },
    ],
  }],
};

function matches(record, where) {
  return Object.entries(where || {}).every(([key, expected]) => {
    if (expected && Array.isArray(expected.__in)) return expected.__in.includes(record[key]);
    return record[key] === expected;
  });
}

function collection(name) {
  const state = { where: null, offset: 0, limit: null };
  const data = rows[name];
  if (!data) throw new Error(`Unexpected collection ${name}`);
  const query = {
    where(where) { state.where = where; return query; },
    orderBy() { return query; },
    skip(offset) { state.offset = offset; return query; },
    limit(limit) { state.limit = limit; return query; },
    async get() {
      const filtered = data.filter((record) => matches(record, state.where));
      const end = state.limit == null ? undefined : state.offset + state.limit;
      return { data: filtered.slice(state.offset, end) };
    },
    doc(id) {
      return {
        async update(update) {
          const record = data.find((item) => item._id === id);
          if (!record) throw new Error(`Missing ${name} ${id}`);
          Object.assign(record, update);
          return { updated: 1 };
        },
      };
    },
    async add(record) {
      const stored = { ...record, _id: `${name}-${data.length + 1}` };
      data.push(stored);
      return { id: stored._id };
    },
  };
  return query;
}

const db = {
  command: { in(values) { return { __in: values }; } },
  collection,
  async runTransaction(callback) {
    if (beforeTransaction) {
      const hook = beforeTransaction;
      beforeTransaction = null;
      hook();
    }
    await callback(this);
    return undefined; // CloudBase 3.18.1 does not return the callback value.
  },
};

const cloudbaseMock = {
  SYMBOL_CURRENT_ENV: "test",
  init() {
    return {
      database() { return db; },
      auth() { return { async getUserInfo() { return { uid: authenticatedUid }; } }; },
    };
  },
};

const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (request === "@cloudbase/node-sdk") return cloudbaseMock;
  return originalLoad.call(this, request, parent, isMain);
};

const servicePath = path.resolve(__dirname, "../cloudfunctions/learningReports/index.js");
delete require.cache[servicePath];
const service = require(servicePath);
Module._load = originalLoad;

async function main() {
  const originalConsoleError = console.error;
  const preview = rows.learning_reports[0];
  const saved = await service.main({ action: "saveComment", report_id: reportId, student_uid: "student-a", comment: "Updated", goals: ["Read"] });
  assert.equal(saved.success, true, "transaction callback return must not be required");
  assert.equal(saved.student_detail.teacher_comment, "Updated");

  beforeTransaction = () => { preview.status = "published"; };
  const refresh = await service.main({ action: "generatePreview", class_id: "class-a", period_type: "weekly" });
  assert.equal(refresh.success, true);
  assert.equal(refresh.report.status, "published", "a concurrent publish cannot regress to preview");
  assert.equal(refresh.already_published, true);

  console.error = () => {};
  const immutable = await service.main({ action: "saveComment", report_id: reportId, student_uid: "student-a", comment: "Too late" });
  assert.equal(immutable.success, false);
  assert.equal(immutable.code, "REPORT_IMMUTABLE");

  authenticatedUid = "student-a";
  const own = await service.main({ action: "getReport", report_id: reportId });
  assert.equal(own.success, true);
  assert.equal(own.student_detail.chinese_name, "王小美");
  assert.equal(Object.hasOwn(own.student_detail, "student_uid"), false);
  assert.equal(Object.hasOwn(own.report.leaderboard[0], "student_uid"), false);
  assert.equal(Object.hasOwn(own, "student_details"), false, "students never receive classmates' private details");

  authenticatedUid = "student-b";
  preview.membership_snapshot = [{ student_uid: "student-a" }];
  const denied = await service.main({ action: "getReport", report_id: reportId });
  assert.equal(denied.success, false);
  assert.equal(denied.code, "REPORT_NOT_FOUND");
  authenticatedUid = "student-a";
  preview.status = "preview";
  const previewDenied = await service.main({ action: "getReport", report_id: reportId });
  assert.equal(previewDenied.code, "REPORT_NOT_FOUND", "students cannot read teacher previews");
  preview.status = "published";

  const nextSaturday = new Date(period.end_at.getTime() + 6 * 86400000);
  const nextPeriod = rules.periodForDate("weekly", nextSaturday);
  const nextReportId = rules.reportIdFor("class-a", nextPeriod);
  await service.runScheduledGeneration(nextSaturday);
  const generatedPreview = rows.learning_reports.find((report) => report.report_id === nextReportId);
  assert(generatedPreview, "scheduled preview should be created");
  generatedPreview.student_details[0].teacher_comment = "Preserve me";
  await service.runScheduledGeneration(nextSaturday);
  assert.equal(rows.learning_reports.filter((report) => report.report_id === nextReportId).length, 1,
    "duplicate timer delivery reuses one logical report");
  assert.equal(generatedPreview.student_details[0].teacher_comment, "Preserve me");

  const generator = require("../cloudfunctions/generateLearningReports/index.js");
  delete process.env.LEARNING_REPORT_CRON_TOKEN;
  const unconfigured = await generator.main({ internal_token: "guess" });
  assert.equal(unconfigured.code, "REPORT_CRON_NOT_CONFIGURED");
  process.env.LEARNING_REPORT_CRON_TOKEN = "expected-token";
  const unauthorized = await generator.main({ internal_token: "wrong-token" });
  assert.equal(unauthorized.code, "REPORT_CRON_UNAUTHORIZED");
  const unauthorizedMessage = await generator.main({ Message: "wrong-token" });
  assert.equal(unauthorizedMessage.code, "REPORT_CRON_UNAUTHORIZED");
  const timerAuthorized = await generator.main({ Message: "expected-token" });
  assert.equal(timerAuthorized.success, true, "SCF timer CustomArgument is read from event.Message");
  const jsonTimerAuthorized = await generator.main({ Message: '{"internal_token":"expected-token"}' });
  assert.equal(jsonTimerAuthorized.success, true, "JSON timer messages remain compatible");
  const jsonStringTimerAuthorized = await generator.main({ Message: '"expected-token"' });
  assert.equal(jsonStringTimerAuthorized.success, true, "JSON-string timer messages remain compatible");
  process.env.LEARNING_REPORT_CRON_TOKEN = "123456789";
  const numericTimerAuthorized = await generator.main({ Message: "123456789" });
  assert.equal(numericTimerAuthorized.success, true, "arbitrary string timer tokens remain compatible");
  delete process.env.LEARNING_REPORT_CRON_TOKEN;
  console.error = originalConsoleError;

  console.log("Learning report service contract tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
