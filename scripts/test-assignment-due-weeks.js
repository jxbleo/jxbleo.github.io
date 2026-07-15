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

function matches(record, where) {
  return Object.entries(where || {}).every(([key, value]) => record[key] === value);
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
    return { collection };
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
      studentMessageTotal: studentMessageTotal,
      weeklyFocusModel: weeklyFocusModel,
      renderWeeklyFocusProgress: renderWeeklyFocusProgress,
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
  assert.equal(hooks.upcomingAssignments().length, 1);
  assert.equal(hooks.studentMessageTotal(), 2);
  assert.equal(hooks.weeklyFocusModel().overdue.length, 1);
  assert.equal(hooks.weeklyFocusModel().thisWeek.length, 1);
  assert.equal(hooks.weeklyFocusModel().nextWeek.length, 1);

  const target = {
    innerHTML: "",
    classList: { remove() {} },
    setAttribute() {},
  };
  hooks.setWeeklyFocusProgress(target);
  hooks.renderWeeklyFocusProgress();
  assert(target.innerHTML.includes("THIS WEEK"));
  assert(!target.innerHTML.includes("UPCOMING"));

  current.status = "passed";
  hooks.renderWeeklyFocusProgress();
  assert(target.innerHTML.includes("UPCOMING"));
  assert(!target.innerHTML.includes("THIS WEEK"));

  hooks.state.assignments = [overdue, upcoming];
  hooks.renderWeeklyFocusProgress();
  assert(target.innerHTML.includes("UPCOMING"));
}

async function main() {
  testDashboardScheduleModel();
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

  currentUid = "student-uid";
  const dashboardResult = await getDashboard.main({});
  currentUid = "teacher-uid";
  assert.equal(dashboardResult.success, true);
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
