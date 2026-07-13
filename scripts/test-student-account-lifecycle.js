#!/usr/bin/env node

const assert = require("assert");
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

let nextProfileId = 1;
let nextAuthUid = 1;

function matches(record, where) {
  return Object.entries(where || {}).every(([key, value]) => record[key] === value);
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

const db = {
  collection(name) {
    if (name !== "students") throw new Error(`Unexpected collection access: ${name}`);
    return studentCollection();
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

  const renameResult = await call("updateStudent", {
    auth_uid: recreateResult.student.auth_uid,
    name: "Corrected Again",
  });
  assert.equal(renameResult.success, true);
  assert.equal(
    students.find((student) => student.auth_uid === recreateResult.student.auth_uid).name,
    "Corrected Again"
  );

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

  console.log("Student account lifecycle tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
