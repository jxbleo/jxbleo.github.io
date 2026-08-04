#!/usr/bin/env node

const assert = require("assert");
const reports = require("../cloudfunctions/_shared/learning-reports");

function student(uid, name, extra = {}) {
  return {
    auth_uid: uid,
    student_id: `${uid}-login`,
    name,
    role: "student",
    active: true,
    ...extra,
  };
}

function membership(uid, startedAt, extra = {}) {
  return {
    membership_id: `${uid}-membership`,
    student_uid: uid,
    class_id: "class-a",
    active: true,
    started_at: startedAt,
    ended_at: null,
    ...extra,
  };
}

function assignment(uid, id, taskId, setId, dueAt) {
  return {
    _id: id,
    assignment_id: id,
    assignment_scope: "class",
    class_id: "class-a",
    class_task_id: taskId,
    student_uid: uid,
    set_id: setId,
    due_at: dueAt,
    status: "to_do",
  };
}

function attempt(uid, assignmentId, setId, submittedAt, extra = {}) {
  return {
    attempt_id: `${uid}-${assignmentId || setId}-${new Date(submittedAt).getTime()}`,
    student_uid: uid,
    assignment_id: assignmentId,
    set_id: setId,
    submitted_at: submittedAt,
    passed: true,
    mode: "default",
    ...extra,
  };
}

function testShanghaiPeriods() {
  const mondayShanghai = new Date("2026-08-02T16:05:00.000Z"); // Monday 00:05 in Shanghai.
  const weekly = reports.periodForDate("weekly", mondayShanghai);
  assert.equal(weekly.period_key, "2026-W32");
  assert.equal(weekly.start_at.toISOString(), "2026-08-02T16:00:00.000Z");
  assert.equal(weekly.end_at.toISOString(), "2026-08-09T15:59:59.999Z");
  assert.equal(reports.previousPeriod(weekly).period_key, "2026-W31");

  const monthly = reports.periodForDate("monthly", mondayShanghai);
  assert.equal(monthly.period_key, "2026-08");
  assert.equal(monthly.start_at.toISOString(), "2026-07-31T16:00:00.000Z");
  assert.equal(monthly.end_at.toISOString(), "2026-08-31T15:59:59.999Z");
  assert.equal(reports.latestClosedPeriod("weekly", mondayShanghai).period_key, "2026-W31");
  assert.equal(reports.reportIdFor("class-a", weekly), reports.reportIdFor("class-a", weekly));
  assert.match(reports.reportUrlFor("lr-weekly-2026-W32-class-a"), /^reports\.html\?report=/);
}

function snapshotFixture() {
  const period = reports.periodForDate("weekly", new Date("2026-08-01T04:00:00.000Z"));
  const dueAt = period.end_at;
  const startBeforePeriod = new Date("2026-07-01T00:00:00.000Z");
  const students = [
    student("alice", "Alice 王", { chinese_name: "王小美", english_name: "Alice" }),
    student("david", "David 李", { chinese_name: "李大卫", english_name: "David" }),
    student("bob", "Bob 新", { chinese_name: "新同学", english_name: "Bob" }),
    student("carol", "Carol 转", { chinese_name: "转班生", english_name: "Carol" }),
  ];
  const memberships = [
    membership("alice", startBeforePeriod),
    membership("david", startBeforePeriod),
    membership("bob", new Date("2026-07-30T00:00:00.000Z")),
    membership("carol", startBeforePeriod, { ended_at: new Date("2026-07-31T00:00:00.000Z") }),
  ];
  const assignments = [
    assignment("alice", "a-1", "task-1", "BBC-1", dueAt),
    assignment("david", "d-1", "task-1", "BBC-1", dueAt),
    assignment("alice", "a-2", "task-2", "IELTS-R-1", dueAt),
    assignment("alice", "a-3", "task-3", "BBC-1", dueAt),
    assignment("david", "d-2", "task-2", "IELTS-R-1", dueAt),
    assignment("bob", "b-1", "task-1", "BBC-1", dueAt),
    assignment("carol", "c-1", "task-1", "BBC-1", dueAt),
  ];
  const attempts = [
    attempt("alice", "a-1", "BBC-1", new Date("2026-07-28T02:00:00.000Z")),
    attempt("david", "d-1", "BBC-1", new Date("2026-07-28T02:00:00.000Z")),
    attempt("alice", "a-2", "IELTS-R-1", new Date("2026-07-29T02:00:00.000Z")),
    attempt("alice", "a-3", "BBC-1", new Date(period.end_at.getTime() + 1)),
    attempt("david", "d-2", "IELTS-R-1", new Date("2026-07-29T02:00:00.000Z")),
    attempt("alice", null, "SELF-V", new Date("2026-07-30T02:00:00.000Z"), { mode: "vocabulary_test" }),
    attempt("alice", null, "SELF-V", new Date("2026-07-31T02:00:00.000Z"), { mode: "vocabulary_practice_timed" }),
    attempt("bob", "b-1", "BBC-1", new Date(period.end_at.getTime() + 1)),
  ];
  const sets = [
    { set_id: "BBC-1", title: "BBC", section_id: "bbc-six-minute-english" },
    { set_id: "IELTS-R-1", title: "Reading", section_id: "ielts-reading" },
    { set_id: "SELF-V", title: "Words", section_id: "vocabulary" },
  ];
  return { period, students, memberships, assignments, attempts, sets };
}

function testSnapshotRules() {
  const fixture = snapshotFixture();
  const snapshot = reports.buildReportSnapshot({
    class_id: "class-a",
    cutoff_at: fixture.period.end_at,
    existing_report: {
      student_details: [{
        student_uid: "alice",
        teacher_comment: "Keep the momentum.",
        teacher_goals: ["Read one BBC lesson"],
      }],
    },
    previous_report: {
      status: "published",
      student_details: [{
        student_uid: "alice",
        class_task_summary: { completed_class_item_count: 1 },
      }],
    },
    ...fixture,
  });
  const alice = snapshot.student_details.find((detail) => detail.student_uid === "alice");
  const bob = snapshot.student_details.find((detail) => detail.student_uid === "bob");
  const carol = snapshot.student_details.find((detail) => detail.student_uid === "carol");
  assert.equal(alice.class_task_summary.completed_class_item_count, 2);
  assert.equal(alice.class_task_summary.assigned_class_item_count, 3, "after-cutoff work remains assigned but does not alter the frozen count");
  assert.equal(alice.self_study.completed_self_study_item_count, 1);
  assert.equal(alice.actual_activity.countable_attempt_count, 3, "timed Vocabulary practice is excluded");
  assert.equal(alice.delta_completed_class_item_count, 1, "deltas are integer item counts only");
  assert.equal(alice.teacher_comment, "Keep the momentum.", "preview comments survive refreshes");
  assert.deepEqual(alice.teacher_goals, ["Read one BBC lesson"]);
  assert.equal(bob.ranking_eligible, false, "mid-period entrants are not ranked");
  assert.equal(carol.ranking_eligible, false, "mid-period transfers out are not ranked");
  assert.equal(snapshot.leaderboard.length, 2);
  assert.equal(snapshot.leaderboard[0].rank, 1);
  assert.equal(snapshot.leaderboard[1].rank, 1, "equal completed item counts share rank");
  assert(snapshot.leaderboard.every((row) => row.self_study_completed_count === 0 || row.student_uid === "alice"));
  assert.equal(Object.hasOwn(alice.actual_activity, "average_percentage"), false, "no cross-family score average is produced");
  assert.equal(alice.actual_activity.families.some((family) => family.family === "ielts-reading"), true);

  const publicRows = reports.publicLeaderboard(snapshot.leaderboard);
  assert.equal(Object.hasOwn(publicRows[0], "student_uid"), false, "other students never receive UID values in the leaderboard");
  assert.equal(Object.hasOwn(reports.studentDetailView(alice), "student_uid"), false, "student detail is UID-redacted");
}

function testMonthlyLateCompletionUsesReportCutoff() {
  const monthlyPeriod = reports.periodForDate("monthly", new Date("2026-07-15T04:00:00.000Z"));
  const weeklyPeriod = reports.periodForDate("weekly", new Date("2026-07-08T04:00:00.000Z"));
  const dueAt = new Date("2026-07-12T15:59:59.999Z");
  const passedAt = new Date("2026-07-20T02:00:00.000Z");
  const options = {
    class_id: "class-a",
    students: [student("alice", "Alice 王")],
    memberships: [membership("alice", new Date("2026-06-01T00:00:00.000Z"))],
    assignments: [assignment("alice", "late-1", "late-task", "BBC-1", dueAt)],
    attempts: [attempt("alice", "late-1", "BBC-1", passedAt)],
    sets: [{ set_id: "BBC-1", title: "BBC", section_id: "bbc-six-minute-english" }],
  };
  const weekly = reports.buildReportSnapshot({ ...options, period: weeklyPeriod, cutoff_at: weeklyPeriod.end_at });
  const monthly = reports.buildReportSnapshot({ ...options, period: monthlyPeriod, cutoff_at: monthlyPeriod.end_at });
  assert.equal(weekly.student_details[0].class_task_summary.completed_class_item_count, 0,
    "the frozen due-week report stays incomplete after its cutoff");
  assert.equal(monthly.student_details[0].class_task_summary.completed_class_item_count, 1,
    "the month report counts a due-month task passed later before month end");
}

function main() {
  testShanghaiPeriods();
  testSnapshotRules();
  testMonthlyLateCompletionUsesReportCutoff();
  console.log("Learning report tests passed.");
}

main();
