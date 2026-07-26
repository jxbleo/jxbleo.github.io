#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");
const vm = require("vm");

process.env.INITIAL_STUDENT_PASSWORD = "Test1!";
process.env.TENCENTCLOUD_TCB_ENVID = "test-environment";

const collections = {
  students: [
    {
      _id: "teacher-profile",
      auth_uid: "teacher-uid",
      student_id: "teacher-login",
      name: "Teacher",
      role: "teacher",
      active: true,
    },
    {
      _id: "student-profile",
      auth_uid: "student-uid",
      student_id: "student-login",
      name: "Student",
      role: "student",
      active: true,
    },
  ],
  sets: [
    {
      _id: "set-record",
      set_id: "TEST-SET",
      title: "Test set",
      visible: true,
      passing_percentage: 50,
      mastery_percentage: 90,
    },
    {
      _id: "vocabulary-default-set",
      set_id: "NGSL-DEFAULT",
      title: "Vocabulary default set",
      section_id: "vocabulary",
      visible: true,
    },
    {
      _id: "bbc-default-set",
      set_id: "BBC-DEFAULT",
      title: "BBC default set",
      section_id: "bbc-six-minute-english",
      visible: true,
    },
  ],
  assignments: [
    {
      _id: "legacy-assignment-record",
      assignment_id: "legacy-assignment",
      student_uid: "student-uid",
      set_id: "TEST-SET",
      status: "passed",
      assigned_at: new Date("2026-06-14T16:00:00.000Z"),
      due_at: null,
      created_at: new Date("2026-06-14T16:00:00.000Z"),
    },
  ],
  attempts: [],
  student_set_achievements: [],
};

let nextId = 1;
let currentUid = "teacher-uid";
const collectionReadCounts = {};

const command = {
  in(values) {
    return { __testOperator: "in", values };
  },
};

function matches(record, where) {
  return Object.entries(where || {}).every(([key, value]) => {
    if (value && value.__testOperator === "in") return value.values.includes(record[key]);
    return record[key] === value;
  });
}

function collection(name) {
  const rows = collections[name] || (collections[name] = []);
  const state = { where: null, offset: 0, limit: null, order: null };
  const query = {
    where(where) {
      state.where = where;
      return query;
    },
    orderBy(field, direction) {
      state.order = { field, direction };
      return query;
    },
    skip(offset) {
      state.offset = offset;
      return query;
    },
    limit(limit) {
      state.limit = limit;
      return query;
    },
    async get() {
      collectionReadCounts[name] = Number(collectionReadCounts[name] || 0) + 1;
      let result = rows.filter((record) => matches(record, state.where));
      if (state.order) {
        const multiplier = state.order.direction === "desc" ? -1 : 1;
        result = result.slice().sort((left, right) => {
          const a = left[state.order.field];
          const b = right[state.order.field];
          return (new Date(a || 0) - new Date(b || 0)) * multiplier;
        });
      }
      const end = state.limit == null ? undefined : state.offset + state.limit;
      return { data: result.slice(state.offset, end) };
    },
    doc(id) {
      return {
        async update(update) {
          const record = rows.find((item) => item._id === id);
          if (!record) throw new Error(`Missing ${name} record ${id}`);
          Object.assign(record, update);
          return { updated: 1 };
        },
      };
    },
    async add(record) {
      const stored = { ...record, _id: `${name}-${nextId++}` };
      rows.push(stored);
      return { id: stored._id };
    },
  };
  return query;
}

const app = {
  database() {
    return { collection, command };
  },
  auth() {
    return {
      async getUserInfo() {
        return { uid: currentUid };
      },
    };
  },
};

const originalLoad = Module._load;
Module._load = function mockedLoad(request, parent, isMain) {
  if (request === "@cloudbase/node-sdk") {
    return { SYMBOL_CURRENT_ENV: Symbol("current-env"), init: () => app };
  }
  if (request === "@cloudbase/manager-node") {
    return { init: () => ({ user: {} }) };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const teacherAdminPath = path.resolve(__dirname, "../cloudfunctions/teacherAdmin/index.js");
delete require.cache[teacherAdminPath];
const teacherAdmin = require(teacherAdminPath);
const getDashboardPath = path.resolve(__dirname, "../cloudfunctions/getDashboard/index.js");
delete require.cache[getDashboardPath];
const getDashboard = require(getDashboardPath);
Module._load = originalLoad;

async function call(action, payload = {}) {
  return teacherAdmin.main({ action, ...payload });
}

function dashboardScheduleHooks() {
  const dashboardPath = path.resolve(__dirname, "../assets/js/dashboard.js");
  const source = fs.readFileSync(dashboardPath, "utf8");
  const cutoffMarker = "\n    document.querySelectorAll('.tab-button').forEach(function(button) {";
  const cutoff = source.lastIndexOf(cutoffMarker);
  assert(cutoff > 0, "Unable to locate Dashboard bootstrap cutoff");
  const instrumented = source.slice(0, cutoff) + `
    window.__scheduleTestHooks = {
      state: state,
      todoAssignments: todoAssignments,
      upcomingAssignments: upcomingAssignments,
      finishedAssignments: finishedAssignments,
      studentMessageTotal: studentMessageTotal,
      weeklyFocusModel: weeklyFocusModel,
      renderWeeklyFocusProgress: renderWeeklyFocusProgress,
      studentCalendarModel: studentCalendarModel,
      studentCalendarCompletionDate: studentCalendarCompletionDate,
      renderStudentCalendarTask: renderStudentCalendarTask,
      renderStudentMessageTask: renderStudentMessageTask,
      renderStudentMessageSection: renderStudentMessageSection,
      renderDefaultStudentMessageSections: renderDefaultStudentMessageSections,
      renderStudentMessageFlatList: renderStudentMessageFlatList,
      accountStarItems: accountStarItems,
      accountStarHistoryRow: accountStarHistoryRow,
      setWeeklyFocusProgress: function(target) { weeklyFocusProgress = target; }
    };
})();`;
  const window = { addEventListener() {} };
  const document = {
    body: null,
    documentElement: null,
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
  };
  vm.runInNewContext(instrumented, {
    window,
    document,
    console,
    Date,
    Intl,
    Math,
    Number,
    Object,
    Array,
    String,
    Set,
    Map,
    Promise,
    URL,
    URLSearchParams,
    encodeURIComponent,
    decodeURIComponent,
    setTimeout,
    clearTimeout,
  });
  return window.__scheduleTestHooks;
}

function testTeacherAssignmentEditDelegation() {
  const teacherPath = path.resolve(__dirname, "../assets/js/teacher.js");
  const source = fs.readFileSync(teacherPath, "utf8");
  assert(source.includes("event.target.closest('[data-edit-assignment-scope]')"));
  assert(!source.includes("container.querySelectorAll('[data-edit-assignment-scope]')"));
  const functionStart = source.indexOf("function assignmentStableId(item)");
  const functionEnd = source.indexOf("\n    function editableAssignments", functionStart);
  assert(functionStart >= 0 && functionEnd > functionStart);
  const assignmentStableId = vm.runInNewContext(`(${source.slice(functionStart, functionEnd).trim()})`);
  assert.equal(assignmentStableId({ assignment_id: "canonical-id", _id: "document-id" }), "canonical-id");
  assert.equal(assignmentStableId({ _id: "document-id" }), "document-id");
  assert.equal(assignmentStableId({ progress_id: "assigned::progress-fallback-id" }), "progress-fallback-id");
  assert.equal(assignmentStableId({ progress_id: "self_study::student::set" }), "");
  assert(source.includes("assignment_ids: items.map(assignmentStableId)"));
  assert(source.includes("assignment_ids: cancelableItems.map(assignmentStableId)"));
  assert(source.includes("assignmentStableId(item) && status !== 'cancelled'"));
}

function testTeacherPhoneMatrixDensityIsolation() {
  const teacherPath = path.resolve(__dirname, "../assets/js/teacher.js");
  const teacherSource = fs.readFileSync(teacherPath, "utf8");
  const cssPath = path.resolve(__dirname, "../assets/css/app.css");
  const cssSource = fs.readFileSync(cssPath, "utf8");
  assert(teacherSource.includes("if (matrixUsesPhoneLayout()) return null;"));
  assert(teacherSource.includes("phone_layout: matrixUsesPhoneLayout()"));
  assert(teacherSource.includes("matrix.phone_layout === matrixUsesPhoneLayout()"));
  assert(teacherSource.includes("state.matrixDensityStep = nextPhoneLayout ? null : readMatrixDensityPreference();"));
  assert(cssSource.includes(".matrix-density-fit .progress-matrix-row"));
  assert(cssSource.includes("minmax(0, var(--matrix-student-col-fit, 5ch))"));
}

function testStudentCalendarModel() {
  const hooks = dashboardScheduleHooks();
  const now = new Date();
  const values = {};
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now).forEach((part) => {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  });
  const activityDay = Math.max(1, Math.min(values.day, 12));
  const dayKey = `${values.year}-${String(values.month).padStart(2, "0")}-${String(activityDay).padStart(2, "0")}`;
  const completedAt = new Date(`${dayKey}T09:30:00+08:00`).toISOString();
  hooks.state.assignments = [
    { assignment_id: "passed", status: "passed", completed_at: completedAt, best_percentage: 84 },
    { assignment_id: "mastered", status: "mastered", mastered_at: completedAt, best_percentage: 100, star_claimed: true },
    { assignment_id: null, achievement_id: "self-study", source: "self_study", status: "mastered", mastered_at: completedAt, best_percentage: 96, star_claimed: true },
    { assignment_id: "unfinished", status: "to_do", updated_at: completedAt },
    { assignment_id: "cancelled", status: "cancelled", completed_at: completedAt },
  ];

  const model = hooks.studentCalendarModel(values.year, values.month, dayKey, now);
  assert(model.days.length === 35 || model.days.length === 42);
  assert.equal(model.days.length % 7, 0);
  assert.equal(model.canGoNext, false);
  const activity = model.days.find((day) => day && day.key === dayKey);
  assert(activity);
  assert.equal(activity.level, 3);
  assert.equal(activity.hasStar, true);
  assert.equal(activity.items.length, 3);
  assert.equal(model.selected.key, dayKey);

  const firstDay = model.days.find((day) => day);
  const expectedMondayIndex = (new Date(Date.UTC(values.year, values.month - 1, 1)).getUTCDay() + 6) % 7;
  assert.equal(model.days.indexOf(firstDay), expectedMondayIndex);

  const finishedSection = hooks.renderStudentMessageSection(
    "Finished",
    null,
    "<article>Finished task</article>",
    "No finished work.",
    "finished",
    true
  );
  assert(finishedSection.startsWith('<details class="student-message-section is-collapsible'));
  assert(finishedSection.includes('<summary class="student-message-section-head">'));
  assert(!finishedSection.includes('<details open'));
  assert(!finishedSection.includes('student-message-section-count'));

  const thisWeekSection = hooks.renderStudentMessageSection(
    "This Week",
    null,
    "<article>Current task</article>",
    "No unfinished work.",
    "todo",
    true,
    true
  );
  assert(thisWeekSection.startsWith('<details class="student-message-section is-collapsible todo" open>'));
  assert(!thisWeekSection.includes('student-message-section-count'));

  const defaultSections = hooks.renderDefaultStudentMessageSections(
    [{ assignment_id: "current", status: "to_do" }],
    [],
    [{ assignment_id: "finished", status: "passed", best_percentage: 90 }]
  );
  assert.equal((defaultSections.match(/<details /g) || []).length, 3);
  assert.equal((defaultSections.match(/ open>/g) || []).length, 3);
  assert(defaultSections.indexOf("This Week") < defaultSections.indexOf("Upcoming"));
  assert(defaultSections.indexOf("Upcoming") < defaultSections.indexOf("Finished"));
  assert(defaultSections.includes("No upcoming assignments."));
  assert(!defaultSections.includes("student-message-section-count"));

  const calendarTask = hooks.renderStudentCalendarTask({
    assignment_id: "calendar-task",
    status: "passed",
    completed_at: completedAt,
    best_percentage: 88,
    set: { set_id: "BBC-CALENDAR", title: "A long calendar task title", link: "bbc.html?set=BBC-CALENDAR" },
  });
  assert(calendarTask.includes('class="student-message-task finished"'));
  assert(calendarTask.includes('class="student-message-title-window"'));
  assert(calendarTask.includes('data-open-href='));
  assert(calendarTask.includes('88%'));

  const thisWeekTodo = hooks.renderStudentMessageTask({
    assignment_id: "week-todo",
    status: "to_do",
    set: { set_id: "WEEK-TODO", title: "Unfinished first", link: "vocabulary.html?set=WEEK-TODO" },
  }, "todo");
  assert(thisWeekTodo.includes('<span class="student-message-score is-todo">0%</span>'));
  assert(!thisWeekTodo.includes(">TO DO<"));
  const thisWeekFinished = hooks.renderStudentMessageTask({
    assignment_id: "week-finished",
    status: "passed",
    completed_at: completedAt,
    best_percentage: 92,
    set: { set_id: "WEEK-FINISHED", title: "Finished second", link: "bbc.html?set=WEEK-FINISHED" },
  }, "finished");
  const focusedWeekList = hooks.renderStudentMessageFlatList(thisWeekTodo + thisWeekFinished, "No assignments this week.");
  assert(!focusedWeekList.includes("student-message-section-head"));
  assert(!focusedWeekList.includes("student-message-section-count"));
  assert(focusedWeekList.indexOf("Unfinished first") < focusedWeekList.indexOf("Finished second"));
}

function testStudentModalShellMarkup() {
  const dashboardHtml = fs.readFileSync(path.resolve(__dirname, "../dashboard.html"), "utf8");
  const appCss = fs.readFileSync(path.resolve(__dirname, "../assets/css/app.css"), "utf8");
  assert(dashboardHtml.includes('class="account-panel student-account-overlay"'));
  assert(dashboardHtml.includes('class="student-account-stack" role="dialog" aria-modal="true"'));
  assert(dashboardHtml.includes('class="student-account-dialog"'));
  assert(dashboardHtml.includes('id="student-account-close"'));
  assert(dashboardHtml.includes('id="student-replies-button"'));
  assert(dashboardHtml.indexOf('id="student-message-button"') < dashboardHtml.indexOf('id="student-replies-button"'));
  assert(appCss.includes("position: sticky;\n    top: 0;\n    z-index: 3;"));
  assert(appCss.includes(".student-calendar-day {\n    position: relative;\n    display: flex;\n    align-items: center;\n    justify-content: center;"));
  assert(appCss.includes("-webkit-appearance: none;\n    appearance: none;"));
  assert(appCss.includes("font-weight: 820;\n    line-height: 1;"));
  assert(appCss.includes(".student-words-stack,\n.student-calendar-stack"));
  assert(appCss.includes("width: min(720px, 100%);\n    height: min(720px, 86vh);"));
  assert(appCss.includes(".student-words-stack,\n    .student-calendar-stack"));
  assert(appCss.includes("height: min(700px, 84vh);"));
  assert(appCss.includes(".student-message-close,\n.student-words-outside-close,\n.student-calendar-outside-close"));
  assert(!appCss.includes("height: min(620px, 74vh);"));
  assert(!appCss.includes("height: min(590px, 72vh);"));
}

function relativeDueWeekEnd(weekOffset) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const values = {};
  parts.forEach((part) => {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  });
  const today = new Date(Date.UTC(values.year, values.month - 1, values.day));
  const mondayIndex = (today.getUTCDay() + 6) % 7;
  return new Date(Date.UTC(
    values.year,
    values.month - 1,
    values.day - mondayIndex + (weekOffset * 7) + 6,
    15,
    59,
    59
  )).toISOString();
}

function testDashboardScheduleModel() {
  const hooks = dashboardScheduleHooks();
  const overdue = { assignment_id: "overdue", status: "to_do", due_at: relativeDueWeekEnd(-1) };
  const current = { assignment_id: "current", status: "to_do", due_at: relativeDueWeekEnd(0) };
  const upcoming = { assignment_id: "upcoming", status: "to_do", due_at: relativeDueWeekEnd(1) };
  hooks.state.session = { mode: "student" };
  hooks.state.teacherReplies = [];
  hooks.state.assignments = [overdue, current, upcoming];

  assert.equal(hooks.todoAssignments().length, 2);
  assert.equal(hooks.todoAssignments()[0].assignment_id, "overdue");
  assert.equal(hooks.upcomingAssignments().length, 1);
  assert.equal(hooks.studentMessageTotal(), 2);
  assert.equal(hooks.weeklyFocusModel().overdue.length, 1);
  assert.equal(hooks.weeklyFocusModel().thisWeek.length, 1);
  assert.equal(hooks.weeklyFocusModel().nextWeek.length, 1);

  const target = {
    innerHTML: "",
    classList: { remove() {} },
    setAttribute() {},
    querySelectorAll() { return []; },
  };
  hooks.setWeeklyFocusProgress(target);
  hooks.renderWeeklyFocusProgress();
  assert(!target.innerHTML.includes("OVERDUE"));
  assert(target.innerHTML.includes("THIS WEEK"));
  assert(target.innerHTML.includes("UPCOMING"));
  assert(target.innerHTML.includes("0 of 2 assignments are finished"));
  assert(target.innerHTML.includes("include 1 overdue"));
  assert(target.innerHTML.includes("this-week has-overdue"));
  assert(!target.innerHTML.includes('data-weekly-focus-scope="overdue"'));
  assert(target.innerHTML.includes('data-weekly-focus-scope="week"'));
  assert(target.innerHTML.includes('data-weekly-focus-scope="upcoming"'));

  current.status = "passed";
  hooks.renderWeeklyFocusProgress();
  assert(target.innerHTML.includes("50%"));
  assert(target.innerHTML.includes("UPCOMING"));
  assert(target.innerHTML.includes("THIS WEEK"));

  hooks.state.assignments = [overdue, upcoming];
  hooks.renderWeeklyFocusProgress();
  assert(target.innerHTML.includes("UPCOMING"));

  hooks.state.assignments = [overdue];
  hooks.renderWeeklyFocusProgress();
  const upcomingMarkup = target.innerHTML.slice(target.innerHTML.indexOf("UPCOMING"));
  assert(upcomingMarkup.includes("NO TASKS"));
  assert(upcomingMarkup.includes("weekly-progress-empty-status"));
  assert(upcomingMarkup.includes('d="m8.8 15.4 2.1 2.1 4.5-4.5"'));
  assert(!upcomingMarkup.includes("weekly-progress-percent"));
  assert(!upcomingMarkup.includes('data-weekly-focus-scope="upcoming"'));

  hooks.state.assignments = [
    { assignment_id: "finished-old", status: "passed", completed_at: "2026-01-01T10:00:00.000Z" },
    { assignment_id: "finished-new", status: "mastered", mastered_at: "2026-02-01T10:00:00.000Z" },
  ];
  assert.equal(hooks.finishedAssignments()[0].assignment_id, "finished-new");
}

function testAccountStarHistoryModel() {
  const hooks = dashboardScheduleHooks();
  hooks.state.session = { mode: "student" };
  hooks.state.starAchievements = [
    {
      achievement_id: "star-blue",
      star_type: "self_study",
      set_id: "BBC-260101",
      assignment_id: null,
      earned_at: "2026-07-26T04:00:00.000Z",
      best_percentage: 96,
      best_attempt_id: "attempt-blue",
      set: { set_id: "BBC-260101", title: "Blue source", link: "bbc.html?set=BBC-260101" },
    },
    {
      achievement_id: "star-yellow",
      star_type: "assignment",
      set_id: "NGSL-A",
      assignment_id: "assignment-yellow",
      earned_at: "2026-07-25T04:00:00.000Z",
      best_percentage: 100,
      best_attempt_id: "attempt-yellow",
      set: { set_id: "NGSL-A", title: "Yellow source", link: "vocabulary.html?set=NGSL-A" },
    },
  ];

  assert.equal(hooks.accountStarItems("self_study").length, 1);
  assert.equal(hooks.accountStarItems("assignment")[0].assignment_id, "assignment-yellow");
  const blueRow = hooks.accountStarHistoryRow(hooks.state.starAchievements[0]);
  assert(blueRow.includes("Blue source"));
  assert(blueRow.includes("history=attempt-blue"));
  assert(blueRow.includes("Best 96%"));
  assert(blueRow.includes("is-self-study"));
}

async function main() {
  testTeacherAssignmentEditDelegation();
  testTeacherPhoneMatrixDensityIsolation();
  testDashboardScheduleModel();
  testStudentCalendarModel();
  testAccountStarHistoryModel();
  testStudentModalShellMarkup();
  const setsResult = await call("listSets");
  assert.equal(setsResult.success, true);
  const vocabularyDefaults = setsResult.sets.find((set) => set.set_id === "NGSL-DEFAULT");
  const bbcDefaults = setsResult.sets.find((set) => set.set_id === "BBC-DEFAULT");
  assert.equal(vocabularyDefaults.passing_percentage, 90);
  assert.equal(vocabularyDefaults.mastery_percentage, 100);
  assert.equal(bbcDefaults.passing_percentage, 80);
  assert.equal(bbcDefaults.mastery_percentage, 95);

  const originalConsoleError = console.error;
  console.error = () => {};
  const missingDue = await call("createAssignments", {
    set_ids: ["TEST-SET"],
    student_uids: ["student-uid"],
  });
  console.error = originalConsoleError;
  assert.equal(missingDue.success, false);
  assert.equal(missingDue.code, "DUE_WEEK_REQUIRED");

  const createResult = await call("createAssignments", {
    set_ids: ["TEST-SET"],
    student_uids: ["student-uid"],
    set_options: [{
      set_id: "TEST-SET",
      due_at: "2026-07-15T00:00:00+08:00",
      passing_percentage: 50,
      mastery_enabled: false,
    }],
  });
  assert.equal(createResult.success, true);
  assert.equal(createResult.created.length, 1);
  const created = collections.assignments.find((item) => item.assignment_id === createResult.created[0].assignment_id);
  assert.equal(created.due_at.toISOString(), "2026-07-19T15:59:59.000Z");
  assert.equal(created.assigned_at.toISOString(), created.due_at.toISOString());

  const updateResult = await call("updateAssignments", {
    assignment_ids: [created.assignment_id],
    assigned_at: "2026-07-20T00:00:00+08:00",
  });
  assert.equal(updateResult.success, true);
  assert.equal(created.due_at.toISOString(), "2026-07-26T15:59:59.000Z");

  const disabledMasteryUpdate = await call("updateAssignments", {
    assignment_ids: [created.assignment_id],
    passing_percentage: 95,
    mastery_enabled: false,
  });
  assert.equal(disabledMasteryUpdate.success, true);
  assert.equal(created.passing_percentage, 95);
  assert.equal(created.mastery_enabled, false);

  const legacyDocumentIdAssignment = {
    _id: "legacy-document-id-only",
    student_uid: "student-uid",
    set_id: "TEST-SET",
    status: "to_do",
    due_at: new Date("2026-07-19T15:59:59.000Z"),
    assigned_at: new Date("2026-07-19T15:59:59.000Z"),
    passing_percentage: 50,
    mastery_percentage: 90,
    mastery_enabled: false,
    created_at: new Date("2026-07-13T10:00:00.000Z"),
  };
  collections.assignments.push(legacyDocumentIdAssignment);
  const legacyStableIdUpdate = await call("updateAssignments", {
    assignment_ids: [legacyDocumentIdAssignment._id],
    due_at: "2026-07-27T00:00:00+08:00",
    passing_percentage: 72,
    mastery_enabled: false,
  });
  assert.equal(legacyStableIdUpdate.success, true);
  assert.equal(legacyStableIdUpdate.updated.length, 1);
  assert.equal(legacyStableIdUpdate.missing.length, 0);
  assert.equal(legacyDocumentIdAssignment.due_at.toISOString(), "2026-08-02T15:59:59.000Z");
  assert.equal(legacyDocumentIdAssignment.passing_percentage, 72);

  const mixedStableIdBatchUpdate = await call("updateAssignments", {
    assignment_ids: [created.assignment_id, legacyDocumentIdAssignment._id],
    due_at: "2026-08-03T00:00:00+08:00",
    passing_percentage: 75,
    mastery_enabled: false,
  });
  assert.equal(mixedStableIdBatchUpdate.success, true);
  assert.equal(mixedStableIdBatchUpdate.updated.length, 2);
  assert.equal(created.passing_percentage, 75);
  assert.equal(legacyDocumentIdAssignment.passing_percentage, 75);
  assert.equal(created.due_at.toISOString(), "2026-08-09T15:59:59.000Z");
  assert.equal(legacyDocumentIdAssignment.due_at.toISOString(), "2026-08-09T15:59:59.000Z");

  console.error = () => {};
  const invalidEnabledMasteryUpdate = await call("updateAssignments", {
    assignment_ids: [created.assignment_id],
    passing_percentage: 95,
    mastery_percentage: 90,
    mastery_enabled: true,
  });
  console.error = originalConsoleError;
  assert.equal(invalidEnabledMasteryUpdate.success, false);
  assert.equal(invalidEnabledMasteryUpdate.code, "PASSING_ABOVE_MASTERY");

  currentUid = "student-uid";
  const expectedDashboardAssignmentCount = collections.assignments.length + 61;
  for (let index = 0; index < 60; index += 1) {
    const setId = `HISTORY-${String(index + 1).padStart(2, "0")}`;
    collections.sets.push({
      _id: `history-set-${index}`,
      set_id: setId,
      title: `History set ${index + 1}`,
      visible: true,
      passing_percentage: 50,
      mastery_percentage: 90,
    });
    collections.assignments.push({
      _id: `history-assignment-record-${index}`,
      assignment_id: `history-assignment-${index}`,
      student_uid: "student-uid",
      set_id: setId,
      status: "passed",
      best_percentage: 80,
      completed_at: new Date(`2026-05-${String(index % 28 + 1).padStart(2, "0")}T10:00:00.000Z`),
      assigned_at: new Date("2026-05-01T10:00:00.000Z"),
      due_at: new Date("2026-05-03T15:59:59.000Z"),
      created_at: new Date("2026-05-01T10:00:00.000Z"),
    });
  }
  collections.sets.push({
    _id: "self-study-history-set",
    set_id: "SELF-STUDY-HISTORY",
    title: "Self-study history set",
    section_id: "vocabulary",
    visible: true,
  });
  collections.student_set_achievements.push(
    {
      _id: "assignment-star-record",
      achievement_id: "student-uid::history-assignment-0",
      student_uid: "student-uid",
      set_id: "HISTORY-01",
      assignment_id: "history-assignment-0",
      source: "assignment_claim",
      first_earned_at: new Date("2026-05-20T10:00:00.000Z"),
      best_percentage: 100,
      best_attempt_id: "assignment-star-attempt",
    },
    {
      _id: "self-study-star-record",
      achievement_id: "student-uid::SELF-STUDY-HISTORY::self",
      student_uid: "student-uid",
      set_id: "SELF-STUDY-HISTORY",
      assignment_id: null,
      source: "self_study",
      first_earned_at: new Date("2026-05-21T10:00:00.000Z"),
      best_percentage: 100,
      best_attempt_id: "self-study-star-attempt",
    }
  );
  const setReadsBeforeDashboard = Number(collectionReadCounts.sets || 0);
  const dashboardResult = await getDashboard.main({});
  currentUid = "teacher-uid";
  assert.equal(dashboardResult.success, true);
  assert.equal(dashboardResult.assignments.length, expectedDashboardAssignmentCount);
  assert.equal(Number(collectionReadCounts.sets || 0) - setReadsBeforeDashboard, 1);
  assert.equal(dashboardResult.star_achievements.length, 2);
  assert.equal(dashboardResult.star_achievements[0].star_type, "self_study");
  assert.equal(dashboardResult.star_achievements[0].set.title, "Self-study history set");
  assert.equal(dashboardResult.star_achievements[1].star_type, "assignment");
  assert.equal(dashboardResult.star_achievements[1].assignment_id, "history-assignment-0");
  const legacyDashboardAssignment = dashboardResult.assignments.find((item) => item.assignment_id === "legacy-assignment");
  assert.equal(new Date(legacyDashboardAssignment.due_at).toISOString(), "2026-06-21T15:59:59.000Z");

  const dryRun = await call("backfillAssignmentDueWeeks", { limit: 100 });
  assert.equal(dryRun.success, true);
  assert.equal(dryRun.dry_run, true);
  assert.equal(dryRun.candidate_count, 1);
  assert.equal(dryRun.candidates[0].assignment_id, "legacy-assignment");

  const applyResult = await call("backfillAssignmentDueWeeks", { apply: true, limit: 100 });
  assert.equal(applyResult.success, true);
  assert.equal(applyResult.updated_count, 1);
  const legacy = collections.assignments.find((item) => item.assignment_id === "legacy-assignment");
  assert.equal(legacy.due_at.toISOString(), "2026-06-21T15:59:59.000Z");

  console.log("Assignment due-week tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
