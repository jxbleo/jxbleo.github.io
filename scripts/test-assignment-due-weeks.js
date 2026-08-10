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
  grading_keys: [
    {
      _id: "bbc-default-grading-key",
      set_id: "BBC-DEFAULT",
      answers: { "1": "expected answer" },
      explanations: { "1": "A detailed private explanation." },
    },
  ],
  student_set_achievements: [],
};

let nextId = 1;
let currentUid = "teacher-uid";
const collectionReadCounts = {};

const command = {
  in(values) {
    return { __testOperator: "in", values };
  },
  gt(value) {
    return { __testOperator: "gt", value };
  },
};

function matches(record, where) {
  return Object.entries(where || {}).every(([key, value]) => {
    if (value && value.__testOperator === "in") return value.values.includes(record[key]);
    if (value && value.__testOperator === "gt") return new Date(record[key] || 0) > new Date(value.value || 0);
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
    async count() {
      return { total: rows.filter((record) => matches(record, state.where)).length };
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

const db = {
  collection,
  command,
  async runTransaction(callback) {
    await callback(this);
    return undefined;
  },
};

const app = {
  database() {
    return db;
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
      calendarButtonDateModel: calendarButtonDateModel,
      studentCalendarCompletionDate: studentCalendarCompletionDate,
      renderStudentCalendarTask: renderStudentCalendarTask,
      renderTeacherReplyItem: renderTeacherReplyItem,
      renderStudentMessageTask: renderStudentMessageTask,
      renderStudentMessageSection: renderStudentMessageSection,
      renderDefaultStudentMessageSections: renderDefaultStudentMessageSections,
      renderStudentMessageFlatList: renderStudentMessageFlatList,
      accountStarItems: accountStarItems,
      accountStarHistoryRow: accountStarHistoryRow,
      renderStarSource: renderStarSource,
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

function teacherAssignmentEditHooks() {
  const teacherPath = path.resolve(__dirname, "../assets/js/teacher.js");
  const source = fs.readFileSync(teacherPath, "utf8");
  const cutoffMarker = "\n    document.querySelectorAll('.tab-button').forEach(function(button) {";
  const cutoff = source.lastIndexOf(cutoffMarker);
  assert(cutoff > 0, "Unable to locate Teacher bootstrap cutoff");
  const instrumented = source.slice(0, cutoff) + `
    window.__assignmentEditTestHooks = {
      state: state,
      assignmentStableId: assignmentStableId,
      assignmentEditTriggerAttributes: assignmentEditTriggerAttributes,
      handleAssignmentEditTrigger: handleAssignmentEditTrigger,
      matrixAttemptEntries: matrixAttemptEntries,
      renderMatrixAttemptChart: renderMatrixAttemptChart,
      attemptHasDetail: attemptHasDetail,
      mergeAttemptDetail: mergeAttemptDetail,
      renderMatrixAttemptWrongRows: renderMatrixAttemptWrongRows
    };
})();`;

  const message = { textContent: "", className: "" };
  const children = [];
  const classList = { add() {}, remove() {}, toggle() {} };
  const makeControl = (extra = {}) => ({
    addEventListener() {},
    setAttribute() {},
    focus() {},
    classList,
    ...extra,
  });
  const body = {
    style: {},
    appendChild(element) {
      element.parentElement = body;
      element.isConnected = true;
      children.push(element);
      return element;
    },
  };
  const root = { style: {}, classList };

  function createOverlay() {
    const closeButton = makeControl();
    const masteryInput = makeControl({ checked: true });
    const masteryShell = { classList };
    const masteryPicker = makeControl({
      disabled: false,
      closest(selector) {
        return selector === ".assignment-edit-percentage" ? masteryShell : null;
      },
    });
    const form = makeControl({
      elements: {
        mastery_enabled: masteryInput,
        due_week: { value: "" },
        passing_percentage: { value: "" },
        mastery_percentage: { value: "" },
      },
      querySelector() { return makeControl(); },
    });
    const cancelButton = makeControl();
    return {
      className: "",
      innerHTML: "",
      parentElement: null,
      isConnected: false,
      addEventListener() {},
      querySelectorAll(selector) {
        return selector === "[data-percent-picker]" ? [] : [];
      },
      querySelector(selector) {
        if (selector === "[data-assignment-edit-close]") return closeButton;
        if (selector === 'input[name="mastery_enabled"]') return masteryInput;
        if (selector === '[data-percent-input="mastery_percentage"]') return masteryPicker;
        if (selector === "form") return form;
        if (selector === "[data-cancel-assignments]") return cancelButton;
        return null;
      },
      remove() {
        const index = children.indexOf(this);
        if (index >= 0) children.splice(index, 1);
        this.isConnected = false;
      },
    };
  }

  const document = {
    body,
    documentElement: root,
    activeElement: null,
    getElementById(id) { return id === "teacher-message" ? message : null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    createElement() { return createOverlay(); },
    addEventListener() {},
    removeEventListener() {},
  };
  const window = {
    innerWidth: 1200,
    scrollX: 0,
    scrollY: 0,
    localStorage: { getItem() { return null; }, setItem() {}, removeItem() {} },
    addEventListener() {},
    removeEventListener() {},
    scrollTo() {},
    matchMedia() { return { matches: false }; },
  };
  class MutationObserver {
    observe() {}
    disconnect() {}
  }

  vm.runInNewContext(instrumented, {
    window,
    document,
    MutationObserver,
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
  return { hooks: window.__assignmentEditTestHooks, children, message };
}

function testTeacherAssignmentEditDelegation() {
  const teacherPath = path.resolve(__dirname, "../assets/js/teacher.js");
  const source = fs.readFileSync(teacherPath, "utf8");
  assert(!source.includes("container.querySelectorAll('[data-edit-assignment-scope]')"));
  const { hooks, children, message } = teacherAssignmentEditHooks();
  const assignmentStableId = hooks.assignmentStableId;
  assert.equal(assignmentStableId({ assignment_id: "canonical-id", _id: "document-id" }), "canonical-id");
  assert.equal(assignmentStableId({ _id: "document-id" }), "document-id");
  assert.equal(assignmentStableId({ progress_id: "assigned::progress-fallback-id" }), "progress-fallback-id");
  assert.equal(assignmentStableId({ progress_id: "self_study::student::set" }), "");
  const assignment = {
    source: "assigned",
    progress_id: "assigned::legacy-document-id",
    student_uid: "student-uid",
    student_id: "student-login",
    student_name: "Student",
    set_id: "TEST-SET",
    set_title: "Test set",
    status: "to_do",
    due_at: "2026-07-26T15:59:59.000Z",
    passing_percentage: 50,
    mastery_percentage: 90,
    mastery_enabled: true,
  };
  hooks.state.progressItems = [assignment];
  hooks.state.assignments = [];
  hooks.state.assignmentEditScopes = {};
  const trigger = {
    dataset: {
      editAssignmentScope: "matrix-assignment::stale-scope",
      assignmentEditIds: '["legacy-document-id"]',
      assignmentEditTitle: "Student",
      assignmentEditSubtitle: "Test set",
    },
    closest(selector) {
      return selector === "[data-edit-assignment-scope]" ? this : null;
    },
  };
  let prevented = false;
  let stopped = false;
  assert.equal(hooks.handleAssignmentEditTrigger({
    target: trigger,
    preventDefault() { prevented = true; },
    stopPropagation() { stopped = true; },
  }), true);
  assert.equal(prevented, true);
  assert.equal(stopped, true);
  assert.equal(children.length, 1, "click should append the assignment parameter modal");
  assert.equal(children[0].className, "assignment-edit-overlay");
  assert(children[0].innerHTML.includes("Student"));
  assert(children[0].innerHTML.includes("1 selected assignment"));

  children[0].remove();
  hooks.state.progressItems = [];
  assert.equal(hooks.handleAssignmentEditTrigger({ target: trigger }), true);
  assert.equal(children.length, 0, "a missing assignment must not open an empty modal");
  assert(message.textContent.includes("temporarily unavailable"));

  const triggerAttributes = hooks.assignmentEditTriggerAttributes([assignment], "Student", "Test set");
  assert(triggerAttributes.includes("data-assignment-edit-ids="));
  assert(triggerAttributes.includes("legacy-document-id"));
  assert(source.includes("assignment_ids: items.map(assignmentStableId)"));
  assert(source.includes("assignment_ids: cancelableItems.map(assignmentStableId)"));
  assert(source.includes("assignmentStableId(item) && status !== 'cancelled'"));
}

function testTeacherAttemptChartBackendThresholds() {
  const { hooks } = teacherAssignmentEditHooks();
  const attempts = [{
    attempt_id: "attempt-threshold",
    attempt_number: 1,
    percentage: 82,
    passing_percentage: 61,
    mastery_percentage: 88,
    mastery_enabled: true,
  }];
  const entries = hooks.matrixAttemptEntries(attempts);
  const assignmentHtml = hooks.renderMatrixAttemptChart(entries, {
    passing_percentage: 73,
    mastery_percentage: 94,
    mastery_enabled: true,
  });
  assert(assignmentHtml.includes("PASS 73%"));
  assert(assignmentHtml.includes("STAR 94%"));
  assert(!assignmentHtml.includes("PASS 61%"));

  const attemptFallbackHtml = hooks.renderMatrixAttemptChart(entries, {});
  assert(attemptFallbackHtml.includes("PASS 61%"));
  assert(attemptFallbackHtml.includes("STAR 88%"));

  const missingHtml = hooks.renderMatrixAttemptChart(hooks.matrixAttemptEntries([{
    attempt_id: "attempt-without-thresholds",
    percentage: 82,
  }]), {});
  assert(!missingHtml.includes("PASS "));
  assert(!missingHtml.includes("STAR "));

  const summary = {
    attempt_id: "attempt-summary",
    percentage: 40,
    correct_count: 1,
    question_count: 2,
    detail_loaded: false,
  };
  hooks.state.attempts = [summary];
  assert.equal(hooks.attemptHasDetail(summary), false);
  assert.equal(hooks.renderMatrixAttemptWrongRows(summary), "");
  hooks.mergeAttemptDetail({
    attempt_id: "attempt-summary",
    detail_loaded: true,
    question_results: [{
      question_id: "1",
      submitted_answer: "wrong",
      correct_answer: "right",
      correct: false,
      explanation: "Private explanation",
    }],
  });
  assert.equal(hooks.attemptHasDetail(hooks.state.attempts[0]), true);
  assert(hooks.renderMatrixAttemptWrongRows(hooks.state.attempts[0]).includes("Q1"));
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

  const calendarButtonDate = hooks.calendarButtonDateModel(new Date("2026-07-27T16:30:00.000Z"));
  assert.equal(calendarButtonDate.day, 28);
  assert.equal(calendarButtonDate.isDoubleDigit, true);
  assert.equal(calendarButtonDate.ariaLabel, "Progress calendar, 28 July");

  const finishedSection = hooks.renderStudentMessageSection(
    "Finished",
    1,
    "<article>Finished task</article>",
    "No finished work.",
    "finished",
    true
  );
  assert(finishedSection.startsWith('<details class="student-message-section is-collapsible'));
  assert(finishedSection.includes('<summary class="student-message-section-head">'));
  assert(!finishedSection.includes('<details open'));
  assert(finishedSection.includes('<span class="student-message-section-count">1</span>'));

  const thisWeekSection = hooks.renderStudentMessageSection(
    "This Week",
    1,
    "<article>Current task</article>",
    "No unfinished work.",
    "todo",
    true,
    true
  );
  assert(thisWeekSection.startsWith('<details class="student-message-section is-collapsible todo" open>'));
  assert(thisWeekSection.includes('<span class="student-message-section-count">1</span>'));

  const defaultSections = hooks.renderDefaultStudentMessageSections(
    [{ assignment_id: "current", status: "to_do" }],
    [],
    [{ assignment_id: "finished", status: "passed", best_percentage: 90 }]
  );
  assert(defaultSections.includes('role="tablist"'));
  assert.equal((defaultSections.match(/role="tab"/g) || []).length, 3);
  assert.equal((defaultSections.match(/role="tabpanel"/g) || []).length, 3);
  assert(defaultSections.includes('data-message-tab="week"'));
  assert(defaultSections.includes('data-message-tab="upcoming"'));
  assert(defaultSections.includes('data-message-tab="finished"'));
  assert(defaultSections.includes('id="student-message-panel-week" role="tabpanel"'));
  assert(defaultSections.includes('id="student-message-panel-upcoming" role="tabpanel" aria-labelledby="student-message-tab-upcoming" data-message-panel="upcoming" hidden'));
  assert(defaultSections.includes('id="student-message-panel-finished" role="tabpanel" aria-labelledby="student-message-tab-finished" data-message-panel="finished" hidden'));
  assert(defaultSections.indexOf("This Week") < defaultSections.indexOf("Upcoming"));
  assert(defaultSections.indexOf("Upcoming") < defaultSections.indexOf("Finished"));
  assert(defaultSections.includes("No upcoming assignments."));
  assert.equal((defaultSections.match(/student-message-tab-count/g) || []).length, 3);
  assert(defaultSections.includes('<span class="student-message-tab-count">0</span>'));
  assert.equal((defaultSections.match(/aria-selected="true"/g) || []).length, 1);

  const populatedSections = hooks.renderDefaultStudentMessageSections(
    [{ assignment_id: "current", status: "to_do" }],
    [{ assignment_id: "upcoming", status: "to_do" }],
    [{ assignment_id: "finished", status: "passed", best_percentage: 90 }]
  );
  assert.equal((populatedSections.match(/<span class="student-message-tab-count">1<\/span>/g) || []).length, 3);
  assert(populatedSections.includes('data-message-panel="week"'));
  assert(populatedSections.includes('data-message-panel="upcoming" hidden'));
  assert(populatedSections.includes('data-message-panel="finished" hidden'));

  const teacherReply = hooks.renderTeacherReplyItem({
    status: "approved",
    set_id: "BBC-TEST",
    set_title: "Test Practice",
    question_id: "Question_24",
    question_text: "Which answer is supported by the passage?",
    answer_snapshot: "B",
    submitted_answer: "C",
    created_at: "2026-08-05T06:32:00.000Z"
  });
  assert(teacherReply.indexOf("Test Practice") < teacherReply.indexOf("Which answer is supported by the passage?"));
  assert(teacherReply.includes('class="student-message-title-window teacher-reply-title-window"'));
  assert(teacherReply.includes('role="button" tabindex="0"'));
  assert(teacherReply.includes('data-open-href="'));
  assert(teacherReply.includes('focus=Question_24'));
  assert(teacherReply.includes('<p>Which answer is supported by the passage?</p>'));
  assert(!teacherReply.includes("Q24."));
  assert(teacherReply.includes("<b>Expected</b><span>B</span>"));
  assert(teacherReply.includes('<div class="teacher-reply-answer submitted"><b>Submitted</b><span>C</span></div>'));
  assert(teacherReply.includes('<div class="teacher-reply-footer"><time class="teacher-reply-timestamp"'));
  assert(teacherReply.indexOf("Argued &middot; 2026-08-05 14:32") < teacherReply.indexOf('class="teacher-reply-status approved"'));
  assert(teacherReply.includes("Argued &middot; 2026-08-05 14:32"));
  assert(!teacherReply.includes("teacher-reply-arrow"));
  assert(!teacherReply.includes("teacher-reply-go"));
  assert(!teacherReply.includes("<b>Before</b>"));
  assert(!teacherReply.includes("<b>Yours</b>"));

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
  const dashboardJs = fs.readFileSync(path.resolve(__dirname, "../assets/js/dashboard.js"), "utf8");
  const appCss = fs.readFileSync(path.resolve(__dirname, "../assets/css/app.css"), "utf8");
  const liquidGlassCss = fs.readFileSync(path.resolve(__dirname, "../assets/css/liquid-glass-shell.css"), "utf8");
  const vocabularyHtml = fs.readFileSync(path.resolve(__dirname, "../vocabulary.html"), "utf8");
  const bbcHtml = fs.readFileSync(path.resolve(__dirname, "../bbc.html"), "utf8");
  const ieltsReadingHtml = fs.readFileSync(path.resolve(__dirname, "../ielts-reading.html"), "utf8");
  assert(dashboardHtml.includes('class="account-panel student-account-overlay"'));
  assert(dashboardHtml.includes('class="student-account-stack" role="dialog" aria-modal="true"'));
  assert(dashboardHtml.includes('class="student-account-dialog"'));
  assert(dashboardHtml.includes('class="logout-confirm-overlay" id="logout-confirm-overlay" hidden'));
  assert(dashboardHtml.includes('id="logout-confirm-cancel"'));
  assert(dashboardHtml.includes('id="logout-confirm-submit"'));
  assert(dashboardHtml.includes('class="logout-confirm-dialog" role="alertdialog"'));
  assert(dashboardHtml.includes('<strong id="logout-confirm-title">Ready to leave?</strong>'));
  assert(dashboardHtml.includes('Your progress is saved. You can sign in again anytime.'));
  assert(!dashboardHtml.includes('id="logout-confirm-back"'));
  assert(!dashboardHtml.includes('id="logout-confirm-close"'));
  assert(dashboardHtml.includes('id="student-account-close"'));
  assert(dashboardHtml.includes('id="student-replies-button"'));
  assert(dashboardHtml.includes('id="student-calendar-date" aria-hidden="true"'));
  assert(dashboardHtml.indexOf('id="student-message-button"') < dashboardHtml.indexOf('id="student-replies-button"'));
  assert(dashboardJs.includes("studentDashboardCacheName = 'mrcat-student-dashboard-v1'"));
  assert(dashboardJs.includes("action: 'dashboardBootstrap'"));
  assert(dashboardJs.includes("action: 'listAssignmentPage'"));
  assert(dashboardJs.includes("action: 'listTeacherReplies'"));
  assert(dashboardJs.includes("todos.slice(0, 10)"));
  assert(dashboardJs.includes("finished.slice(0, 10)"));
  assert(dashboardJs.includes("rendered + 10"));
  assert(dashboardJs.includes("visibleReplyCount + 5"));
  assert(appCss.includes("position: sticky;\n    top: 0;\n    z-index: 3;"));
  assert(appCss.includes(".student-calendar-day {\n    --student-calendar-day-fill:"));
  assert(appCss.includes("position: relative;\n    display: flex;\n    align-items: center;\n    justify-content: center;"));
  assert(appCss.includes("-webkit-appearance: none;\n    appearance: none;"));
  assert(appCss.includes("font-weight: 820;\n    line-height: 1;"));
  assert(appCss.includes(".student-calendar-date {\n    position: absolute;\n    top: 57%;"));
  assert(!appCss.includes(".student-todo-button svg {"));
  assert(!liquidGlassCss.includes(".liquid-glass-dashboard .student-todo-button {"));
  assert(appCss.includes(".student-words-stack,\n.student-calendar-stack"));
  assert(appCss.includes("width: min(720px, 100%);\n    height: min(720px, 86vh);"));
  assert(appCss.includes(".student-words-stack,\n    .student-calendar-stack"));
  assert(appCss.includes("height: min(700px, 84vh);"));
  assert(appCss.includes(".student-message-close,\n.student-words-outside-close,\n.student-calendar-outside-close"));
  assert(appCss.includes(".practice-entry-card,\n.liquid-glass-dashboard :is("));
  [
    ".student-account-dialog",
    ".student-star-dialog",
    ".student-words-dialog",
    ".student-calendar-dialog",
    ".student-message-dialog",
    ".teacher-replies-dialog",
    ".password-dialog",
    ".my-word-merge-card",
  ].forEach((selector) => assert(appCss.includes(selector)));
  assert(appCss.includes("animation: practiceEntryPop 560ms cubic-bezier(.18,.95,.26,1.16) both;"));
  assert(dashboardJs.includes('class="teacher-replies-stack" role="dialog" aria-modal="true"'));
  assert(dashboardJs.includes('class="eyebrow accent" id="teacher-replies-title">Teacher Replies</h2>'));
  assert(dashboardJs.includes('id="teacher-replies-close"'));
  assert(!dashboardJs.includes('id="teacher-replies-back"'));
  assert(!dashboardJs.includes("replies in your history"));
  assert(dashboardJs.includes('class="password-dialog-stack" role="dialog" aria-modal="true"'));
  assert(dashboardJs.includes('class="eyebrow accent" id="password-dialog-title">Change Password</p>'));
  assert(dashboardJs.includes('data-dialog-back aria-label="Back to Personal Center"'));
  assert(dashboardJs.includes('class="student-message-close password-dialog-outside-close"'));
  assert(!dashboardJs.includes("data-dialog-cancel"));
  assert(dashboardJs.includes("setAccountPanel(false);\n                if (identityChip) identityChip.focus"));
  assert(appCss.includes(".password-dialog-title-row {\n    display: grid;\n    grid-template-columns: 38px minmax(0, 1fr) 38px;"));
  assert(appCss.includes(".password-dialog-actions {\n    grid-template-columns: minmax(180px, 240px);\n    justify-content: center;"));
  assert(!dashboardJs.includes('<p class="eyebrow accent">Account</p>'));
  assert(!dashboardJs.includes('class="dialog-close-button"'));
  assert(dashboardJs.includes("document.getElementById('logout-button').addEventListener('click', openLogoutConfirmDialog)"));
  assert(!dashboardJs.includes("document.getElementById('logout-button').addEventListener('click', window.MrCatAuth.logout)"));
  assert(dashboardJs.includes("window.MrCatAuth.logout();"));
  assert(dashboardJs.includes('<p class="eyebrow accent" id="student-star-title">'));
  assert(!dashboardJs.includes('<section class="profile-card account-star-history'));
  assert(!appCss.includes('.student-star-dialog .profile-card'));
  assert(appCss.includes('.account-star-history-head > .eyebrow {'));
  assert(appCss.includes(".student-account-stack,\n.student-star-stack,\n.password-dialog-stack"));
  assert(appCss.includes("height: min(490px, 86dvh);"));
  assert(dashboardJs.includes("var isAccountFinishedFlow = scope === 'finished';"));
  assert(dashboardJs.includes("student-message-shell' + (isAccountFinishedFlow ? ' is-account-finished' : '')"));
  assert(appCss.includes(".student-message-shell.is-account-finished {\n    grid-template-rows: minmax(0, 1fr) auto;\n    gap: 11px;\n    width: min(430px, 100%);\n    height: min(490px, 86vh);\n    height: min(490px, 86dvh);\n    max-height: none;"));
  assert(appCss.includes(".student-message-dialog.is-account-finished {\n    height: 100%;\n    max-height: none;\n    padding: 16px;"));
  assert(appCss.includes(".logout-confirm-stack {\n    width: min(320px, calc(100% - 32px));"));
  assert(appCss.includes(".logout-confirm-dialog {\n    width: 100%;\n    overflow: hidden;\n    border: 1px solid rgba(255,255,255,0.88);\n    border-radius: 22px;"));
  assert(appCss.includes(".logout-confirm-actions {\n    display: grid;\n    grid-template-columns: repeat(2, minmax(0, 1fr));\n    border-top: 0.5px solid rgba(24,49,43,0.16);"));
  assert(appCss.includes("#logout-confirm-submit {\n    border-left: 0.5px solid rgba(24,49,43,0.16);\n    color: var(--danger);\n    background: transparent;"));
  assert(appCss.includes(".student-account-outside-close,\n.student-star-outside-close,\n.password-dialog-outside-close"));
  assert(!liquidGlassCss.includes(".password-dialog, .logout-confirm-dialog"));
  assert(appCss.includes(".account-feedback-row:hover,\n.account-feedback-row:active {\n    background: transparent;\n    transform: none;\n}"));
  assert(!appCss.includes(".account-feedback-row:hover,\n.account-finished-row:hover"));
  assert(!appCss.includes(".account-feedback-row:active,\n.account-finished-row:active"));
  assert(appCss.includes(".teacher-replies-stack {\n    display: grid;\n    grid-template-rows: minmax(0, 1fr) auto;"));
  assert(appCss.includes(".teacher-reply-item {\n    width: 100%;\n    min-width: 0;"));
  assert(appCss.includes(".teacher-reply-title-window {\n    width: 100%;\n    min-width: 0;"));
  assert(appCss.includes(".teacher-reply-title-track {\n    min-width: 100%;"));
  assert(appCss.includes("text-align: center;"));
  assert(appCss.includes("flex: 1 0 max-content;"));
  assert(appCss.includes("min-width: min(100%, 160px);"));
  assert(appCss.includes(".teacher-reply-flow { flex-direction: column; }"));
  assert(!appCss.includes(".teacher-reply-arrow {"));
  assert(!appCss.includes(".teacher-reply-go {"));
  assert(dashboardJs.includes("overlay.querySelectorAll('.teacher-reply-item[data-open-href]')"));
  assert(dashboardJs.includes("enterLabel: 'Go to question'"));
  assert(dashboardJs.includes("hideStatus: true"));
  assert(!dashboardJs.includes("if (event.target === overlay) closePracticeEntryDialog();"), "student task-entry confirmation must ignore backdrop clicks");
  assert(!dashboardJs.includes("function handlePracticeEntryKeydown(event)"), "student task-entry confirmation must ignore Escape");
  assert(!dashboardJs.includes("if (event.target === overlay) close(true);"), "To Do List and Teacher Replies must ignore backdrop clicks");
  assert(!dashboardJs.includes("if (event.target !== accountPanel) return;"), "Personal Center must ignore backdrop clicks");
  assert(!dashboardJs.includes("if (event.target === starOverlay) closeStarPanel(false);"), "STAR Wallet must ignore backdrop clicks");
  assert(!dashboardJs.includes("if (event.target !== calendarOverlay) return;"), "Calendar must ignore backdrop clicks");
  assert(!dashboardJs.includes("if (e.key === 'Escape' && state.starPanelOpen)"), "STAR Wallet must ignore Escape");
  assert(!dashboardJs.includes("if (e.key === 'Escape' && state.accountPanelOpen)"), "Personal Center must ignore Escape");
  assert(!dashboardJs.includes("if (e.key === 'Escape' && state.calendarPanelOpen)"), "Calendar must ignore Escape");
  assert(!vocabularyHtml.includes("if (event.target === overlay) {\n                    close();"), "Vocabulary worksheet download must ignore backdrop clicks");
  assert(!vocabularyHtml.includes("function handleKeydown(event) {\n                if (event.key !== 'Escape') return;"), "Vocabulary worksheet download must ignore Escape");
  assert(!vocabularyHtml.includes("if (event.target === overlay) close(false);"), "Vocabulary quiz dialogs must ignore backdrop clicks");
  assert(!vocabularyHtml.includes("if (action === 'close' || event.target === overlay) overlay.remove();"), "Vocabulary results must require their Close action");
  assert(!bbcHtml.includes("if (action === 'close' || event.target === overlay) overlay.remove();"), "BBC results must require their Close action");
  assert(!bbcHtml.includes("if (event.target === modal) closeArgueModal();"), "BBC student Argue must ignore backdrop clicks");
  const studentArgueStart = ieltsReadingHtml.indexOf("function openStudentArgueModal");
  const studentArgueEnd = ieltsReadingHtml.indexOf("function renderStudentArgueButton", studentArgueStart);
  assert(studentArgueStart >= 0 && studentArgueEnd > studentArgueStart);
  assert(!ieltsReadingHtml.slice(studentArgueStart, studentArgueEnd).includes("event.target === modal"), "IELTS Reading student Argue must ignore backdrop clicks");
  assert(!appCss.includes("height: min(620px, 74vh);"));
  assert(!appCss.includes("height: min(590px, 72vh);"));
}

function testTeacherModalEntranceAnimation() {
  const appCss = fs.readFileSync(path.resolve(__dirname, "../assets/css/app.css"), "utf8");
  const selectorStart = appCss.indexOf(".liquid-glass-teacher :is(");
  const selectorEnd = appCss.indexOf(") {", selectorStart);
  assert(selectorStart >= 0 && selectorEnd > selectorStart);
  const selectorBlock = appCss.slice(selectorStart, selectorEnd);
  [
    ".account-panel",
    ".teacher-utility-dialog",
    ".create-student-dialog",
    ".create-student-success-card",
    ".assign-picker-dialog",
    ".assignment-edit-dialog",
    ".percentage-picker-dialog",
    ".assignment-cancel-confirm-dialog",
    ".progress-matrix-modal",
  ].forEach((selector) => assert(selectorBlock.includes(selector)));
  const animationBlock = appCss.slice(selectorStart, appCss.indexOf("}", selectorEnd) + 1);
  assert(animationBlock.includes("animation: practiceEntryPop 560ms cubic-bezier(.18,.95,.26,1.16) both;"));
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
      star_type: "blue",
      set_id: "BBC-260101",
      assignment_id: null,
      earned_at: "2026-07-26T04:00:00.000Z",
      best_percentage: 96,
      best_attempt_id: "attempt-blue",
      set: { set_id: "BBC-260101", title: "Blue source", link: "bbc.html?set=BBC-260101" },
    },
    {
      achievement_id: "star-yellow",
      star_type: "yellow",
      set_id: "NGSL-A",
      assignment_id: "assignment-yellow",
      earned_at: "2026-07-25T04:00:00.000Z",
      best_percentage: 100,
      best_attempt_id: "attempt-yellow",
      set: { set_id: "NGSL-A", title: "Yellow source", link: "vocabulary.html?set=NGSL-A" },
    },
  ];

  assert.equal(hooks.accountStarItems("blue").length, 1);
  assert.equal(hooks.accountStarItems("yellow")[0].assignment_id, "assignment-yellow");
  const blueRow = hooks.accountStarHistoryRow(hooks.state.starAchievements[0]);
  assert(blueRow.includes("Blue source"));
  assert(blueRow.includes("Best 96%"));
  assert(blueRow.includes("is-self-study"));
  assert(!blueRow.includes("NOT REDEEMABLE"));
  assert(!blueRow.includes("data-open-href"));
  assert(!blueRow.includes('role="link"'));
  assert(!blueRow.includes("account-star-history-chevron"));
  const sourceView = hooks.renderStarSource();
  assert(sourceView.includes("YELLOW STAR<em>REDEEMABLE</em>"));
  assert(sourceView.includes("BLUE STAR<em>NOT REDEEMABLE</em>"));
  assert(!sourceView.includes("profile-card"));
  assert(sourceView.includes('class="eyebrow accent" id="student-star-title"'));
}

async function main() {
  testTeacherAssignmentEditDelegation();
  testTeacherAttemptChartBackendThresholds();
  testTeacherPhoneMatrixDensityIsolation();
  testDashboardScheduleModel();
  testStudentCalendarModel();
  testAccountStarHistoryModel();
  testStudentModalShellMarkup();
  testTeacherModalEntranceAnimation();
  const teacherFeedSource = fs.readFileSync(path.resolve(__dirname, "../assets/js/teacher.js"), "utf8");
  const teacherFeedHtml = fs.readFileSync(path.resolve(__dirname, "../teacher.html"), "utf8");
  assert(teacherFeedSource.includes("var NOTIFICATION_FEED_PAGE_SIZE = 10;"));
  assert(teacherFeedSource.includes("var DISPUTE_FEED_PAGE_SIZE = 5;"));
  assert(teacherFeedSource.includes("cacheAllUnreadNotificationPages"));
  assert(teacherFeedSource.includes("prefetchNotificationItems(activityItems().filter(function(item) { return item.unread; }))"));
  assert(teacherFeedSource.includes("bindNotificationInfiniteScroll"));
  assert(teacherFeedSource.includes("loadNextNotificationPageForScroll"));
  const notificationScrollSource = teacherFeedSource.slice(
    teacherFeedSource.indexOf("function loadNextNotificationPageForScroll"),
    teacherFeedSource.indexOf("function relatedAttemptIdsForAttempt")
  );
  assert(!notificationScrollSource.includes("prefetchNotificationItems"), "read-history scrolling must not prefetch private attempt details");
  assert(!notificationScrollSource.includes("requestAnimationFrame"), "opening the bell must not recursively fill beyond the first ten-row page");
  assert(!teacherFeedSource.includes("data-notification-load-more>Load 5 more"));
  assert(teacherFeedSource.includes("data-dispute-load-more>Load 5 more"));
  assert(teacherFeedHtml.includes("teacher-updates-button is-loading"));
  assert(teacherFeedHtml.includes('id="teacher-updates-button" type="button" aria-label="Notifications" aria-expanded="false" aria-busy="true"'));
  assert(!teacherFeedHtml.includes("teacher-review-button is-loading"));
  const setsResult = await call("listSets");
  assert.equal(setsResult.success, true);
  const vocabularyDefaults = setsResult.sets.find((set) => set.set_id === "NGSL-DEFAULT");
  const bbcDefaults = setsResult.sets.find((set) => set.set_id === "BBC-DEFAULT");
  assert.equal(vocabularyDefaults.passing_percentage, 90);
  assert.equal(vocabularyDefaults.mastery_percentage, 100);
  assert.equal(bbcDefaults.passing_percentage, 80);
  assert.equal(bbcDefaults.mastery_percentage, 95);

  collections.attempts.push({
    _id: "self-study-threshold-attempt",
    attempt_id: "self-study-threshold-attempt",
    student_uid: "student-uid",
    student_id_snapshot: "student-login",
    set_id: "BBC-DEFAULT",
    assignment_id: null,
    attempt_number: 1,
    percentage: 96,
    passing_percentage: 80,
    mastery_percentage: 95,
    mastery_enabled: true,
    passed: true,
    mastered: true,
    submitted_at: new Date("2026-07-31T10:00:00.000Z"),
    question_results: [{
      question_id: "1",
      submitted_answer: "student answer",
      correct: false,
    }],
  });
  const attemptListResult = await call("listAttempts");
  const attemptSummary = attemptListResult.attempts.find((item) =>
    item.attempt_id === "self-study-threshold-attempt"
  );
  assert(attemptSummary);
  assert.equal(attemptSummary.detail_loaded, false);
  assert.equal(Object.prototype.hasOwnProperty.call(attemptSummary, "question_results"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(attemptSummary, "group_results"), false);

  const progressResult = await call("listProgress");
  const selfStudyProgress = progressResult.progress.find((item) =>
    item.source === "self_study" && item.set_id === "BBC-DEFAULT"
  );
  assert(selfStudyProgress);
  assert.equal(selfStudyProgress.passing_percentage, 80);
  assert.equal(selfStudyProgress.mastery_percentage, 95);
  assert.equal(selfStudyProgress.mastery_enabled, true);
  assert.equal(Object.prototype.hasOwnProperty.call(selfStudyProgress, "attempts"), false);

  const detailResult = await call("getAttemptDetail", {
    attempt_id: "self-study-threshold-attempt",
  });
  assert.equal(detailResult.success, true);
  assert.equal(detailResult.attempt.detail_loaded, true);
  assert.equal(detailResult.attempt.question_results.length, 1);
  assert.equal(detailResult.attempt.question_results[0].correct_answer, "expected answer");
  assert.equal(detailResult.attempt.question_results[0].explanation, "A detailed private explanation.");
  collections.attempts.splice(collections.attempts.findIndex((item) =>
    item.attempt_id === "self-study-threshold-attempt"
  ), 1);

  const notificationAttempts = Array.from({ length: 12 }, (_, index) => ({
    _id: `notification-attempt-record-${index}`,
    attempt_id: `notification-attempt-${index}`,
    student_uid: "student-uid",
    student_id_snapshot: "student-login",
    set_id: "TEST-SET",
    assignment_id: `notification-assignment-${index}`,
    percentage: 70 + index,
    passed: true,
    submitted_at: new Date(Date.UTC(2026, 7, 9, 10, 0, index)),
  }));
  collections.attempts.push(...notificationAttempts);
  const notificationPageOne = await call("listAttemptNotifications", { cursor: 0 });
  assert.equal(notificationPageOne.attempts.length, 10, "notification pages contain ten newest threads");
  assert.equal(notificationPageOne.attempts[0].attempt_id, "notification-attempt-11");
  assert.equal(notificationPageOne.has_more, true);
  const notificationPageTwo = await call("listAttemptNotifications", {
    cursor: notificationPageOne.next_cursor,
    exclude_thread_keys: notificationPageOne.thread_keys,
  });
  assert.equal(notificationPageTwo.attempts.length, 2);
  assert.equal(notificationPageTwo.has_more, false);
  const activityState = await call("getActivityState");
  assert.equal(activityState.unread_thread_count, 12);
  const teacherProfile = collections.students.find((item) => item.auth_uid === "teacher-uid");
  teacherProfile.teacher_activity_attempts_read_all_at = new Date(Date.UTC(2026, 7, 9, 10, 0, 2));
  teacherProfile.teacher_activity_attempt_reviewed_ids = ["notification-attempt-11"];
  const boundedActivityState = await call("getActivityState");
  assert.equal(boundedActivityState.unread_thread_count, 8, "the unread count honors the read-all cutoff and reviewed IDs");
  delete teacherProfile.teacher_activity_attempts_read_all_at;
  delete teacherProfile.teacher_activity_attempt_reviewed_ids;
  const notificationThread = await call("listAttemptThread", {
    student_uid: "student-uid",
    assignment_id: "notification-assignment-11",
    set_id: "TEST-SET",
  });
  assert.equal(notificationThread.attempts.length, 1);
  collections.attempts.splice(0, collections.attempts.length);

  collections.answer_disputes = Array.from({ length: 7 }, (_, index) => ({
    _id: `paged-dispute-record-${index}`,
    dispute_id: `paged-dispute-${index}`,
    student_uid: "student-uid",
    set_id: "TEST-SET",
    assignment_id: null,
    question_id: `Question_${index + 1}`,
    submitted_answer: "student answer",
    answer_snapshot: "expected answer",
    status: "pending",
    created_at: new Date(Date.UTC(2026, 7, 9, 11, 0, index)),
  }));
  const disputePageOne = await call("listDisputePage", { status: "pending", cursor: 0 });
  assert.equal(disputePageOne.disputes.length, 5, "Argue pages contain five requests");
  assert.equal(disputePageOne.counts.pending, 7);
  assert.equal(disputePageOne.has_more, true);
  const disputePageTwo = await call("listDisputePage", { status: "pending", cursor: disputePageOne.next_cursor });
  assert.equal(disputePageTwo.disputes.length, 2);
  assert.equal(disputePageTwo.has_more, false);
  collections.answer_disputes = [];

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
  const duplicateIndividualResult = await call("createAssignments", {
    set_ids: ["TEST-SET"],
    student_uids: ["student-uid"],
    set_options: [{
      set_id: "TEST-SET",
      due_at: "2026-07-20T00:00:00+08:00",
      passing_percentage: 50,
      mastery_enabled: false,
    }],
  });
  assert.equal(duplicateIndividualResult.created.length, 0);
  assert.equal(duplicateIndividualResult.skipped[0].reason, "in_progress");

  collections.sets.push({
    _id: "class-merge-set-record",
    set_id: "CLASS-MERGE-SET",
    title: "Class merge set",
    visible: true,
    passing_percentage: 50,
    mastery_percentage: 90,
  });
  collections.students.push({
    _id: "student-two-profile",
    auth_uid: "student-two-uid",
    student_id: "student-two-login",
    name: "Student Two",
    role: "student",
    active: true,
    class_id: "class-one",
  });
  collections.students.find((item) => item.auth_uid === "student-uid").class_id = "class-one";
  collections.classes = [{ _id: "class-one-record", class_id: "class-one", name: "Class One", active: true }];
  collections.class_memberships = [
    { _id: "membership-one", class_id: "class-one", student_uid: "student-uid", active: true },
    { _id: "membership-two", class_id: "class-one", student_uid: "student-two-uid", active: true },
  ];
  const originalIndividualAssignment = {
    _id: "individual-before-class",
    assignment_id: "individual-before-class",
    assignment_batch_id: "old-individual-batch",
    assignment_scope: "individual",
    class_id: null,
    class_task_id: null,
    student_uid: "student-uid",
    set_id: "CLASS-MERGE-SET",
    status: "to_do",
    due_at: new Date("2026-07-19T15:59:59.000Z"),
    assigned_at: new Date("2026-07-19T15:59:59.000Z"),
    passing_percentage: 50,
    mastery_percentage: 90,
    mastery_enabled: false,
    created_at: new Date("2026-07-01T02:00:00.000Z"),
    updated_at: new Date("2026-07-01T02:00:00.000Z"),
  };
  collections.assignments.push(originalIndividualAssignment);
  const classMergeResult = await call("createAssignments", {
    set_ids: ["CLASS-MERGE-SET"],
    student_uids: ["student-uid", "student-two-uid"],
    set_options: [{
      set_id: "CLASS-MERGE-SET",
      due_at: "2026-08-10T00:00:00+08:00",
      passing_percentage: 72,
      mastery_percentage: 96,
      mastery_enabled: true,
    }],
  });
  assert.equal(classMergeResult.success, true);
  assert.equal(classMergeResult.created.length, 2);
  const integratedResult = classMergeResult.created.find((item) => item.student_uid === "student-uid");
  assert.equal(integratedResult.assignment_id, "individual-before-class", "class Assign must preserve the open individual assignment ID");
  assert.equal(integratedResult.integrated_existing_assignment, true);
  const mergedRows = collections.assignments.filter((item) => item.set_id === "CLASS-MERGE-SET");
  assert.equal(mergedRows.length, 2, "class integration must not skip or duplicate a student");
  assert(mergedRows.every((item) => item.assignment_scope === "class" && item.class_id === "class-one"));
  assert(mergedRows.every((item) => item.class_task_id === mergedRows[0].class_task_id));
  assert.equal(originalIndividualAssignment.passing_percentage, 72);
  assert.equal(originalIndividualAssignment.mastery_percentage, 96);
  assert.equal(originalIndividualAssignment.promoted_from_individual, true);

  collections.sets.push({
    _id: "prior-progress-set-record",
    set_id: "PRIOR-PROGRESS-SET",
    title: "Prior progress set",
    visible: true,
    passing_percentage: 90,
    mastery_percentage: 100,
  });
  collections.attempts.push({
    _id: "prior-assigned-attempt-record",
    attempt_id: "prior-assigned-attempt",
    student_uid: "student-uid",
    set_id: "PRIOR-PROGRESS-SET",
    assignment_id: "historical-assignment-context",
    mode: "vocabulary_test",
    percentage: 93,
    raw_percentage: 93,
    submitted_at: new Date("2026-07-02T04:00:00.000Z"),
  });
  const priorProgressAssignResult = await call("createAssignments", {
    set_ids: ["PRIOR-PROGRESS-SET"],
    student_uids: ["student-uid"],
    set_options: [{
      set_id: "PRIOR-PROGRESS-SET",
      due_at: "2026-08-17T00:00:00+08:00",
      passing_percentage: 90,
      mastery_enabled: false,
    }],
  });
  assert.equal(priorProgressAssignResult.created[0].completed_before_assignment, true);
  const priorProgressAssignment = collections.assignments.find((item) =>
    item.assignment_id === priorProgressAssignResult.created[0].assignment_id
  );
  assert.equal(priorProgressAssignment.status, "passed");
  assert.equal(priorProgressAssignment.best_percentage, 93);
  assert.equal(priorProgressAssignment.best_attempt_id, "prior-assigned-attempt");

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

  collections.student_set_achievements.push({
    _id: "blue-before-earned-star",
    achievement_id: "student-uid::TEST-SET::blue",
    student_uid: "student-uid",
    student_id_snapshot: "student-login",
    set_id: "TEST-SET",
    assignment_id: null,
    star_type: "blue",
    source: "self_study",
    status: "active",
    best_percentage: 95,
    best_attempt_id: "missing-but-snapshotted-attempt",
    first_earned_at: new Date("2026-07-01T10:00:00.000Z"),
  });
  const enableEarnStar = await call("updateAssignments", {
    assignment_ids: [created.assignment_id],
    passing_percentage: 75,
    mastery_percentage: 95,
    mastery_enabled: true,
  });
  assert.equal(enableEarnStar.success, true);
  assert.equal(created.status, "mastered", "enabling Earn STAR immediately compares the Blue snapshot");
  assert.equal(collections.student_set_achievements.find((item) => item._id === "blue-before-earned-star").status, "converted");
  assert.equal(collections.student_set_achievements.filter((item) => item.set_id === "TEST-SET" && item.star_type === "yellow").length, 1);
  collections.student_set_achievements = collections.student_set_achievements.filter((item) => item.set_id !== "TEST-SET");
  Object.assign(created, {
    status: "to_do",
    mastery_enabled: false,
    mastery_percentage: 90,
    completed_at: null,
    mastered_at: null,
    best_percentage: null,
    raw_best_percentage: null,
    best_attempt_id: null,
  });

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
  const expectedDashboardAssignmentCount = new Set(
    collections.assignments.filter((item) => item.status !== "cancelled").map((item) => item.set_id)
  ).size + 61;
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
  collections.answer_disputes = [{
    _id: "resolved-dispute",
    dispute_id: "resolved-dispute",
    student_uid: "student-uid",
    set_id: "TEST-SET",
    attempt_id: "resolved-attempt",
    assignment_id: "legacy-assignment",
    question_id: "Question_1",
    question_text_snapshot: "Resolved question",
    submitted_answer: "student answer",
    answer_snapshot: "expected answer",
    status: "approved",
    created_at: new Date("2026-08-05T06:32:00.000Z"),
    updated_at: new Date("2026-08-05T07:00:00.000Z"),
    resolved_at: new Date("2026-08-05T07:00:00.000Z"),
  }];
  const setReadsBeforeDashboard = Number(collectionReadCounts.sets || 0);
  const dashboardResult = await getDashboard.main({});
  assert.equal(dashboardResult.success, true);
  assert.equal(dashboardResult.assignments.length, expectedDashboardAssignmentCount);
  assert.equal(Number(collectionReadCounts.sets || 0) - setReadsBeforeDashboard, 1);
  assert.equal(dashboardResult.star_achievements.length, 2);
  assert.equal(dashboardResult.star_achievements[0].star_type, "blue");
  assert.equal(dashboardResult.star_achievements[0].set.title, "Self-study history set");
  assert.equal(dashboardResult.star_achievements[1].star_type, "yellow");
  assert.equal(dashboardResult.star_achievements[1].assignment_id, "history-assignment-0");
  assert.equal(new Date(dashboardResult.teacher_replies[0].created_at).toISOString(), "2026-08-05T06:32:00.000Z");
  assert.equal(
    dashboardResult.assignments.filter((item) => item.set && item.set.set_id === "TEST-SET").length,
    1,
    "the student dashboard must project one visible participation per set"
  );
  const dashboardBootstrap = await getDashboard.main({ action: "dashboardBootstrap" });
  assert.equal(dashboardBootstrap.success, true);
  assert.equal(dashboardBootstrap.bootstrap, true);
  assert.equal(dashboardBootstrap.assignment_pages.finished.items.length, 10);
  assert.equal(dashboardBootstrap.assignment_pages.finished.has_more, true);
  assert.equal(dashboardBootstrap.assignment_pages.finished.next_cursor, 10);
  assert.equal(dashboardBootstrap.assignments.length <= 20, true);
  assert.equal(Object.prototype.hasOwnProperty.call(dashboardBootstrap, "library_progress"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(dashboardBootstrap, "star_rewards"), false);
  assert.equal(dashboardBootstrap.teacher_reply_unread_count, 1);
  assert.equal(dashboardBootstrap.teacher_replies.length, 1);
  assert.equal(dashboardBootstrap.teacher_replies[0].dispute_id, "resolved-dispute");

  const secondFinishedPage = await getDashboard.main({
    action: "listAssignmentPage",
    kind: "finished",
    cursor: 10,
  });
  assert.equal(secondFinishedPage.success, true);
  assert.equal(secondFinishedPage.page.items.length, 10);
  assert.equal(secondFinishedPage.page.next_cursor, 20);

  const studentReplyPage = await getDashboard.main({ action: "listTeacherReplies" });
  assert.equal(studentReplyPage.success, true);
  assert.equal(studentReplyPage.teacher_replies.length, 1);
  assert.equal(studentReplyPage.teacher_replies[0].dispute_id, "resolved-dispute");
  currentUid = "teacher-uid";

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

  const classTaskRows = ["a", "b"].map((suffix) => ({
    _id: `class-task-record-${suffix}`,
    assignment_id: `class-task-${suffix}`,
    assignment_batch_id: "class-batch-partial",
    assignment_scope: "class",
    class_id: "class-a",
    class_task_id: "class-task-class-a-partial",
    student_uid: suffix === "a" ? "student-uid" : "peer-uid",
    set_id: "TEST-SET",
    status: "to_do",
    due_at: new Date("2026-07-05T15:59:59.000Z"),
    passing_percentage: 50,
    mastery_percentage: 90,
    mastery_enabled: false,
  }));
  collections.assignments.push(...classTaskRows);
  const partialEdit = await call("updateAssignments", {
    assignment_ids: ["class-task-a"],
    due_at: "2026-07-12T15:59:59.000Z",
  });
  assert.equal(partialEdit.success, true);
  assert(classTaskRows.every((assignment) => assignment.assignment_scope === "individual" && assignment.class_task_id == null),
    "a partial Class Task edit atomically downgrades every row before the personal edit");

  const cancelRows = ["a", "b"].map((suffix) => ({
    _id: `cancel-task-record-${suffix}`,
    assignment_id: `cancel-task-${suffix}`,
    assignment_batch_id: "class-batch-cancel",
    assignment_scope: "class",
    class_id: "class-a",
    class_task_id: "class-task-class-a-cancel",
    student_uid: suffix === "a" ? "student-uid" : "peer-uid",
    set_id: "TEST-SET",
    status: "to_do",
    due_at: new Date("2026-07-05T15:59:59.000Z"),
  }));
  collections.assignments.push(...cancelRows);
  const partialCancel = await call("cancelAssignments", { assignment_ids: ["cancel-task-a"] });
  assert.equal(partialCancel.success, true);
  assert(cancelRows.every((assignment) => assignment.assignment_scope === "individual" && assignment.class_task_id == null));
  assert.equal(cancelRows[0].status, "cancelled");
  assert.equal(cancelRows[1].status, "to_do");

  console.log("Assignment due-week tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
