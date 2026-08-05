#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const Module = require("module");
const path = require("path");

process.env.INITIAL_STUDENT_PASSWORD = "Test1!";
process.env.TENCENTCLOUD_TCB_ENVID = "test-environment";

const students = [
  {
    _id: "teacher-profile",
    auth_uid: "teacher-uid",
    student_id: "teacher-login",
    name: "Teacher",
    role: "teacher",
    active: true,
  },
  {
    _id: "student-profile-old",
    auth_uid: "student-uid-old",
    student_id: "student-login",
    name: "Wrong Name",
    role: "student",
    active: true,
  },
];

const authUsers = [
  { UUId: "teacher-uid", UserName: "teacher-login", IsDisabled: false },
  { UUId: "student-uid-old", UserName: "student-login", IsDisabled: false },
];

const classes = [];
const classMemberships = [];
const assignments = [];
const achievements = [];
const sets = [];

let nextProfileId = 1;
let nextAuthUid = 1;

function matches(record, where) {
  return Object.entries(where || {}).every(([key, value]) => {
    if (value && Array.isArray(value.__in)) return value.__in.includes(record[key]);
    return record[key] === value;
  });
}

function studentCollection() {
  const state = { where: null, offset: 0, limit: null };
  const query = {
    where(where) {
      state.where = where;
      return query;
    },
    orderBy() {
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
      const filtered = students.filter((record) => matches(record, state.where));
      const end = state.limit == null ? undefined : state.offset + state.limit;
      return { data: filtered.slice(state.offset, end) };
    },
    doc(id) {
      return {
        async update(update) {
          const record = students.find((item) => item._id === id);
          if (!record) throw new Error(`Missing student profile ${id}`);
          Object.assign(record, update);
          return { updated: 1 };
        },
        async remove() {
          const index = students.findIndex((item) => item._id === id);
          if (index === -1) throw new Error(`Missing student profile ${id}`);
          students.splice(index, 1);
          return { deleted: 1 };
        },
      };
    },
    async add(record) {
      const stored = { ...record, _id: `student-profile-new-${nextProfileId++}` };
      students.push(stored);
      return { id: stored._id };
    },
  };
  return query;
}

function simpleCollection(rows, prefix) {
  const state = { where: null, offset: 0, limit: null };
  const query = {
    where(where) {
      state.where = where;
      return query;
    },
    orderBy() { return query; },
    skip(offset) {
      state.offset = offset;
      return query;
    },
    limit(limit) {
      state.limit = limit;
      return query;
    },
    async get() {
      const filtered = rows.filter((record) => matches(record, state.where));
      const end = state.limit == null ? undefined : state.offset + state.limit;
      return { data: filtered.slice(state.offset, end) };
    },
    doc(id) {
      return {
        async update(update) {
          const record = rows.find((item) => item._id === id);
          if (!record) throw new Error(`Missing ${prefix} ${id}`);
          Object.assign(record, update);
          return { updated: 1 };
        },
      };
    },
    async add(record) {
      const stored = { ...record, _id: `${prefix}-${rows.length + 1}` };
      rows.push(stored);
      return { id: stored._id };
    },
  };
  return query;
}

const db = {
  collection(name) {
    if (name === "students") return studentCollection();
    if (name === "classes") return simpleCollection(classes, "class");
    if (name === "class_memberships") return simpleCollection(classMemberships, "membership");
    if (name === "assignments") return simpleCollection(assignments, "assignment");
    if (name === "student_set_achievements") return simpleCollection(achievements, "achievement");
    if (name === "sets") return simpleCollection(sets, "set");
    throw new Error(`Unexpected collection access: ${name}`);
  },
  command: {
    in(values) { return { __in: values }; },
  },
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
        return { uid: "teacher-uid" };
      },
    };
  },
};

const manager = {
  user: {
    async getEndUserList({ limit, offset }) {
      return { Users: authUsers.slice(offset, offset + limit), Total: authUsers.length };
    },
    async createEndUser({ username }) {
      if (authUsers.some((user) => user.UserName.toLowerCase() === username.toLowerCase())) {
        throw new Error("USERNAME_EXISTS");
      }
      const user = { UUId: `student-uid-new-${nextAuthUid++}`, UserName: username, IsDisabled: false };
      authUsers.push(user);
      return { User: user };
    },
    async setEndUserStatus({ uuid, status }) {
      const user = authUsers.find((item) => item.UUId === uuid);
      if (!user) throw new Error("AUTH_USER_NOT_FOUND");
      user.IsDisabled = status === "DISABLE";
      return { RequestId: "status-request" };
    },
    async deleteEndUsers({ userList }) {
      userList.forEach((uid) => {
        const index = authUsers.findIndex((user) => user.UUId === uid);
        if (index === -1) throw new Error("AUTH_USER_NOT_FOUND");
        authUsers.splice(index, 1);
      });
      return { RequestId: "delete-request" };
    },
  },
};

const originalLoad = Module._load;
Module._load = function mockedLoad(request, parent, isMain) {
  if (request === "@cloudbase/node-sdk") {
    return { SYMBOL_CURRENT_ENV: Symbol("current-env"), init: () => app };
  }
  if (request === "@cloudbase/manager-node") {
    return { init: () => manager };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const teacherAdminPath = path.resolve(__dirname, "../cloudfunctions/teacherAdmin/index.js");
delete require.cache[teacherAdminPath];
const teacherAdmin = require(teacherAdminPath);
Module._load = originalLoad;

async function call(action, payload = {}) {
  return teacherAdmin.main({ action, ...payload });
}

async function main() {
  const deleteResult = await call("deleteStudentAccount", { auth_uid: "student-uid-old" });
  assert.equal(deleteResult.success, true);
  const deletedProfile = students.find((student) => student._id === "student-profile-old");
  assert.equal(deletedProfile.student_id, "__deleted__:student-profile-old");
  assert.equal(deletedProfile.deleted_student_id_snapshot, "student-login");
  assert.equal(deletedProfile.deleted, true);
  assert.equal(authUsers.some((user) => user.UUId === "student-uid-old"), false);

  const recreateResult = await call("createStudent", {
    student_id: "student-login",
    name: "Correct Name",
    class_group: "Class A",
    curriculum_track: "IELTS",
  });
  assert.equal(recreateResult.success, true);
  assert.notEqual(recreateResult.student.auth_uid, "student-uid-old");
  assert.equal(recreateResult.student.student_id, "student-login");
  assert(recreateResult.student.class_id, "class group should create a canonical class");
  assert.equal(classMemberships.filter((membership) => membership.student_uid === recreateResult.student.auth_uid && membership.ended_at == null).length, 1);

  sets.push({ _id: "set-a", set_id: "SET-A", title: "Assignment STAR source" });
  achievements.push(
    {
      _id: "yellow-star",
      achievement_id: "yellow-star",
      student_uid: recreateResult.student.auth_uid,
      set_id: "SET-A",
      assignment_id: "assignment-star",
      star_type: "yellow",
      status: "star",
      best_percentage: 98,
      first_earned_at: new Date("2026-07-20T00:00:00.000Z"),
    },
    {
      _id: "blue-star",
      achievement_id: "blue-star",
      student_uid: recreateResult.student.auth_uid,
      set_id: "SELF-STUDY",
      assignment_id: null,
      star_type: "blue",
      source: "self_study",
      status: "active",
      best_percentage: 100,
      first_earned_at: new Date("2026-07-21T00:00:00.000Z"),
    }
  );
  const starSourcesResult = await call("getStudentStarSources", { auth_uid: recreateResult.student.auth_uid });
  assert.equal(starSourcesResult.success, true);
  assert.equal(starSourcesResult.stars.length, 2);
  assert.equal(starSourcesResult.stars.find((star) => star.star_type === "yellow").set_title, "Assignment STAR source");
  assert.equal(starSourcesResult.stars.find((star) => star.star_type === "blue").source, "self_study");

  const renameResult = await call("updateStudent", {
    auth_uid: recreateResult.student.auth_uid,
    name: "Corrected Again",
  });
  assert.equal(renameResult.success, true);
  assert.equal(
    students.find((student) => student.auth_uid === recreateResult.student.auth_uid).name,
    "Corrected Again"
  );
  assert.equal(
    classMemberships.find((membership) => membership.student_uid === recreateResult.student.auth_uid && membership.ended_at == null).student_name_snapshot,
    "Corrected Again"
  );

  const originalClassId = recreateResult.student.class_id;
  const initialClassList = await call("listClasses");
  assert.equal(initialClassList.success, true);
  assert(initialClassList.classes.some((classRecord) => classRecord.class_id === originalClassId && classRecord.name === "Class A"));

  const customizeClassResult = await call("updateStudent", {
    auth_uid: recreateResult.student.auth_uid,
    class_group: "Class B",
  });
  assert.equal(customizeClassResult.success, true);
  assert.equal(customizeClassResult.class_group, "Class B");
  assert.notEqual(customizeClassResult.class_id, originalClassId);
  assert.equal(classMemberships.filter((membership) => membership.student_uid === recreateResult.student.auth_uid && membership.ended_at == null).length, 1);
  assert.equal(classMemberships.find((membership) => membership.student_uid === recreateResult.student.auth_uid && membership.ended_at == null).class_id, customizeClassResult.class_id);

  const chooseExistingClassResult = await call("updateStudent", {
    auth_uid: recreateResult.student.auth_uid,
    class_id: originalClassId,
  });
  assert.equal(chooseExistingClassResult.success, true);
  assert.equal(chooseExistingClassResult.class_group, "Class A");
  assert.equal(classMemberships.filter((membership) => membership.student_uid === recreateResult.student.auth_uid && membership.ended_at == null).length, 1);
  assert.equal(classMemberships.find((membership) => membership.student_uid === recreateResult.student.auth_uid && membership.ended_at == null).class_id, originalClassId);

  const disableResult = await call("updateStudent", { auth_uid: recreateResult.student.auth_uid, active: false });
  assert.equal(disableResult.success, true);
  assert.equal(classMemberships.some((membership) => membership.student_uid === recreateResult.student.auth_uid && membership.ended_at == null), false);
  const enableResult = await call("updateStudent", { auth_uid: recreateResult.student.auth_uid, active: true });
  assert.equal(enableResult.success, true);
  assert.equal(classMemberships.filter((membership) => membership.student_uid === recreateResult.student.auth_uid && membership.ended_at == null).length, 1);

  const classId = students.find((student) => student.auth_uid === recreateResult.student.auth_uid).class_id;
  students.push({
    _id: "peer-profile",
    auth_uid: "peer-uid",
    student_id: "peer-login",
    name: "Peer",
    class_id: classId,
    class_group: "Class A",
    role: "student",
    active: true,
  });
  classMemberships.push({
    _id: "peer-membership",
    membership_id: "peer-membership",
    student_uid: "peer-uid",
    class_id: classId,
    active: true,
    started_at: new Date("2026-01-01T00:00:00.000Z"),
    ended_at: null,
  });
  assignments.push(
    { _id: "legacy-a", assignment_batch_id: "legacy-batch", student_uid: recreateResult.student.auth_uid, set_id: "BBC-TEST" },
    { _id: "legacy-b", assignment_batch_id: "legacy-batch", student_uid: "peer-uid", set_id: "BBC-TEST" }
  );

  const reportModelDryRun = await call("backfillLearningReportModel", { limit: 10 });
  assert.equal(reportModelDryRun.success, true);
  assert.equal(reportModelDryRun.dry_run, true);
  assert.equal(reportModelDryRun.assignment_scope.class_batches.length, 1, "only exact full-class legacy batches become Class Tasks");
  const reportModelApply = await call("backfillLearningReportModel", { apply: true, limit: 10 });
  assert.equal(reportModelApply.success, true);
  assert.equal(reportModelApply.dry_run, false);
  assert.equal(assignments.every((assignment) => assignment.assignment_scope === "class" && assignment.class_id === classId), true);

  const originalConsoleError = console.error;
  console.error = () => {};
  let duplicateResult;
  try {
    duplicateResult = await call("createStudent", {
      student_id: "student-login",
      name: "Duplicate",
    });
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(duplicateResult.success, false);
  assert.equal(duplicateResult.code, "STUDENT_ID_EXISTS");

  students.push({
    _id: "legacy-deleted-profile",
    auth_uid: "legacy-deleted-uid",
    student_id: "legacy-login",
    name: "Legacy Deleted Student",
    role: "student",
    active: false,
    deleted: true,
    deleted_at: new Date("2026-07-01T00:00:00.000Z"),
  });
  const legacyRecreateResult = await call("createStudent", {
    student_id: "legacy-login",
    name: "New Legacy Login Owner",
  });
  assert.equal(legacyRecreateResult.success, true);
  const legacyDeletedProfile = students.find((student) => student._id === "legacy-deleted-profile");
  assert.equal(legacyDeletedProfile.student_id, "__deleted__:legacy-deleted-profile");
  assert.equal(legacyDeletedProfile.deleted_student_id_snapshot, "legacy-login");

  const teacherSource = fs.readFileSync(path.resolve(__dirname, "../assets/js/teacher.js"), "utf8");
  const teacherHtml = fs.readFileSync(path.resolve(__dirname, "../teacher.html"), "utf8");
  const teacherAdminSource = fs.readFileSync(path.resolve(__dirname, "../cloudfunctions/teacherAdmin/index.js"), "utf8");
  const appCss = fs.readFileSync(path.resolve(__dirname, "../assets/css/app.css"), "utf8");
  assert(teacherSource.includes('name="class_choice"'), "student detail should render a class selector");
  assert(teacherSource.includes('<option value="__customize__">Customize'), "class selector should end with Customize");
  assert(teacherSource.includes('name="custom_class_group"') && teacherSource.includes('hidden>'), "custom class input should start hidden");
  assert(teacherSource.includes("classChoice.addEventListener('change'"), "Customize should reveal its input only after selection");
  const accountSettingsIndex = teacherSource.indexOf('id="student-account-detail-title">ACCOUNT SETTINGS');
  const accountClassIndex = teacherSource.indexOf('data-edit-student-field="class"', accountSettingsIndex);
  assert(accountSettingsIndex >= 0 && accountClassIndex > accountSettingsIndex,
    "class display and Edit action should live inside the Account Settings dialog");
  assert(teacherSource.includes('class="student-identity-capsule"') &&
    teacherSource.includes('class="student-identity-copy"'),
    "student detail should show Chinese and English names in one identity capsule");
  assert(teacherSource.includes('class="student-summary-capsule is-star"') &&
    teacherSource.includes('class="student-summary-capsule is-completed"') &&
    teacherSource.includes('class="student-summary-capsule is-account"'),
    "student detail should show STAR, Completed, and Account as three action capsules");
  assert(!teacherSource.includes('<details class="profile-card student-account-details"'),
    "student detail should not retain the bottom Account settings disclosure");
  assert(!teacherSource.includes('<p class="eyebrow accent">MY WORDS</p>'),
    "student detail should not render the teacher-facing My Words panel");
  assert(appCss.includes("overflow-x: hidden;") && appCss.includes("touch-action: pan-y pinch-zoom;"),
    "student lookup should allow vertical interaction without horizontal panning");
  assert(!teacherHtml.includes('id="student-lookup-title"'),
    "selected student name should not be repeated in the lookup title bar");
  assert(teacherSource.includes('data-student-metric="star"') && teacherSource.includes('data-student-metric="completed"'),
    "STAR and Completed metrics should open independent detail dialogs");
  assert(/\.student-metric-detail-modal,\s*\.student-account-detail-modal\s*\{[^}]*position:\s*fixed;[^}]*inset:\s*0;/s.test(appCss),
    "student metric and Account dialogs should stay fixed over the viewport instead of entering document flow");
  assert(teacherHtml.includes('class="teacher-header-icon-button student-lookup-create"') &&
    /id="student-lookup-create"[\s\S]*?<svg class="teacher-header-icon"/.test(teacherHtml),
    "student lookup STAR and create actions should use the shared header icon treatment");
  assert(/\.student-lookup-create\s*\{[^}]*width:\s*40px;[^}]*height:\s*40px;/s.test(appCss) &&
    /\.student-lookup-star\s*\{[^}]*width:\s*40px;[^}]*height:\s*40px;/s.test(appCss),
    "student lookup utility icons should match the 40px header navigation controls");
  assert(teacherHtml.includes('id="teacher-star-back"') && !teacherHtml.includes('id="teacher-star-close"'),
    "STAR Redemption should use a top-left back button instead of an external Close button");
  assert(teacherHtml.includes('id="create-student-back"') && !teacherHtml.includes('id="close-create-student"'),
    "Create Student should use a top-left back button instead of a top-right close control");
  assert(teacherSource.includes('data-student-metric-back') && !teacherSource.includes('data-student-metric-close'),
    "student STAR and Completed dialogs should use an in-card back button instead of an external Close button");
  assert(teacherSource.includes('data-student-account-back') && teacherSource.includes('openStudentAccountModal(student)'),
    "Account Settings should open as a subordinate dialog with a top-left back button");
  assert(!teacherSource.includes('OVERALL PROGRESS'),
    "student detail should not retain the Overall Progress card");
  assert(teacherAdminSource.includes('if (action === "getStudentStarSources")') &&
    teacherAdminSource.includes('where: { student_uid: authUid }'),
    "STAR sources should load through one teacher-authorized student-bounded action");

  console.log("Student account lifecycle tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
