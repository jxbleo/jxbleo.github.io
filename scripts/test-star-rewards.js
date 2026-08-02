#!/usr/bin/env node

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const rewards = require("../cloudfunctions/_shared/star-rewards");

function achievement(id, type, setId, extra = {}) {
  return {
    _id: id,
    achievement_id: id,
    student_uid: "student-1",
    set_id: setId,
    star_type: type,
    created_at: new Date("2026-08-01T00:00:00.000Z"),
    ...extra,
  };
}

function testClassificationAndHistory() {
  const rows = [
    achievement("yellow-1", "yellow", "SET-A", { assignment_id: "assignment-1" }),
    achievement("yellow-legacy-duplicate", "yellow", "SET-A", { assignment_id: "assignment-old" }),
    achievement("yellow-legacy-source", undefined, "SET-LEGACY", {
      assignment_id: undefined,
      source: "assignment",
      status: "star",
      protected: true,
    }),
    achievement("blue-old", "blue", "SET-B", { status: "active", updated_at: new Date("2026-07-01") }),
    achievement("blue-current", "blue", "SET-B", { status: "converted", updated_at: new Date("2026-08-01") }),
  ];
  const buckets = rewards.normalizedStarBuckets(rows);
  assert.equal(buckets.yellowStars.length, 3, "legacy Yellow duplicates and source=assignment records remain credited");
  assert.equal(rewards.isYellowAchievement(rows[2]), true, "legacy source=assignment is Yellow even without assignment_id");
  assert.equal(rewards.isBlueAchievement(rows[2]), false, "legacy source=assignment must never be Blue");
  assert.equal(buckets.blueStars.length, 1, "Blue history is stable per student + set");
  assert.equal(buckets.activeBlueStars.length, 0, "converted Blue is retained but not active");
}

function testBlueConversionGate() {
  assert.equal(rewards.canConvertBlueToYellow({ masteryEnabled: true, bestPercentage: 95, starRate: 95 }), true);
  assert.equal(rewards.canConvertBlueToYellow({ masteryEnabled: false, bestPercentage: 100, starRate: 95 }), false);
  assert.equal(rewards.canConvertBlueToYellow({ bestPercentage: 100, starRate: 95 }), false);
  assert.equal(rewards.canConvertBlueToYellow({ masteryEnabled: true, bestPercentage: 94, starRate: 95 }), false);
  assert.equal(rewards.canConvertBlueToYellow({ masteryEnabled: true, masteryLocked: true, bestPercentage: 100, starRate: 95 }), false);
}

function testAppendOnlyWallet() {
  const ids = ["yellow-1", "yellow-2"];
  const entries = [
    rewards.ledgerEntry({ ledgerId: "credit-1", studentUid: "student-1", achievementIds: [ids[0]], entryType: "credit" }),
    rewards.ledgerEntry({ ledgerId: "credit-2", studentUid: "student-1", achievementIds: [ids[1]], entryType: "credit" }),
    rewards.ledgerEntry({ ledgerId: "reserve", studentUid: "student-1", requestId: "cash-1", achievementIds: ids, entryType: "reserve" }),
    rewards.ledgerEntry({ ledgerId: "redeem", studentUid: "student-1", requestId: "cash-1", achievementIds: ids, entryType: "redeem" }),
    rewards.ledgerEntry({ ledgerId: "refund", studentUid: "student-1", requestId: "cash-1", achievementIds: ids, entryType: "refund" }),
  ];
  assert.deepEqual(rewards.walletProjection(entries), { available: 2, reserved: 0, spent: 0, lifetimeEarned: 2 });
  const rows = ids.map((id, index) => achievement(id, "yellow", `SET-${index}`, { assignment_id: `assignment-${index}` }));
  assert.equal(rewards.availableYellowAchievements(rows, entries).length, 2);
}

function testRequestRules() {
  assert.equal(rewards.wholeStarCount(5), 5);
  assert.throws(() => rewards.wholeStarCount(0), /STAR_COUNT_INVALID/);
  assert.throws(() => rewards.wholeStarCount(1.5), /STAR_COUNT_INVALID/);
  const created = new Date("2026-08-01T00:00:00.000Z");
  const expires = rewards.requestExpiresAt(created);
  assert.equal(expires.getTime() - created.getTime(), 7 * 24 * 60 * 60 * 1000);
  assert.equal(rewards.isRequestExpired({ status: "awaiting_proof", expires_at: expires }, new Date(expires.getTime() + 1)), true);
  assert.equal(rewards.isRequestExpired({ status: "completed", expires_at: expires }, new Date(expires.getTime() + 1)), false);
}

function fakeDatabase() {
  const rows = [];
  let nextId = 1;
  return {
    rows,
    collection(name) {
      assert.equal(name, "student_set_achievements");
      return {
        where(query) {
          return {
            limit() { return this; },
            async get() {
              return { data: rows.filter((row) => Object.entries(query).every(([key, value]) => row[key] === value)) };
            },
          };
        },
        doc(id) {
          return {
            async update(update) {
              const row = rows.find((item) => item._id === id);
              assert(row, `missing fake achievement ${id}`);
              Object.assign(row, update);
            },
          };
        },
        async add(record) {
          rows.push({ ...record, _id: `record-${nextId++}` });
        },
      };
    },
  };
}

async function testProtectionFlow() {
  const db = fakeDatabase();
  const student = { auth_uid: "student-1", student_id: "student-login" };
  await rewards.protectBlueStar({
    db,
    student,
    attempt: { attempt_id: "self-1", set_id: "SET-A", percentage: 96 },
    masteryPercentage: 90,
  });
  assert.equal(db.rows.length, 1);
  assert.equal(db.rows[0].star_type, "blue");

  const baseAssignment = { assignment_id: "assignment-1", set_id: "SET-A", mastery_enabled: false };
  assert.equal(await rewards.protectYellowStar({ db, student, assignment: baseAssignment, bestPercentage: 100, starRate: 95, masteryEnabled: false }), null);
  assert.equal(db.rows[0].status, "active", "Earn STAR off cannot convert Blue");

  const enabled = { ...baseAssignment, mastery_enabled: true };
  assert.equal(await rewards.protectYellowStar({ db, student, assignment: enabled, bestPercentage: 94, starRate: 95, masteryEnabled: true }), null);
  assert.equal(db.rows[0].status, "active", "below STAR Rate cannot convert Blue");

  const yellow = await rewards.protectYellowStar({ db, student, assignment: enabled, bestPercentage: 95, starRate: 95, masteryEnabled: true });
  assert.equal(yellow.star_type, "yellow");
  assert.equal(db.rows.length, 2);
  assert.equal(db.rows.find((item) => item.star_type === "blue").status, "converted");

  await rewards.protectYellowStar({ db, student, assignment: { ...enabled, assignment_id: "assignment-2" }, bestPercentage: 100, bestAttemptId: "assigned-2", starRate: 95, masteryEnabled: true });
  assert.equal(db.rows.filter((item) => item.star_type === "yellow").length, 1, "new Yellow is lifetime-unique by student + set");
  assert.equal(db.rows.find((item) => item.star_type === "yellow").best_percentage, 100);

  const laterBlue = await rewards.protectBlueStar({ db, student, attempt: { attempt_id: "self-2", set_id: "SET-A", percentage: 100 }, masteryPercentage: 90 });
  assert.equal(laterBlue, null, "Yellow blocks a new Blue for the same set");
}

function testIntegrationContracts() {
  const dashboard = fs.readFileSync(path.resolve(__dirname, "../assets/js/dashboard.js"), "utf8");
  const dashboardHtml = fs.readFileSync(path.resolve(__dirname, "../dashboard.html"), "utf8");
  const appCss = fs.readFileSync(path.resolve(__dirname, "../assets/css/app.css"), "utf8");
  const teacher = fs.readFileSync(path.resolve(__dirname, "../assets/js/teacher.js"), "utf8");
  const backend = fs.readFileSync(path.resolve(__dirname, "../cloudfunctions/teacherAdmin/index.js"), "utf8");
  assert(dashboard.includes("createCashRequest"));
  assert(dashboard.includes("type=\"range\""));
  assert(dashboard.includes('data-wallet-view="redeem">Redeem</button>'));
  assert(dashboard.includes('data-wallet-view="source"><span>STAR Source</span>'));
  assert(dashboard.includes('data-wallet-view="history"><span>History</span>'));
  assert(dashboard.includes("starSourceSection('yellow', 'YELLOW STAR')"), "Yellow STAR sources must render above Blue sources");
  assert(dashboard.includes("starSourceSection('blue', 'BLUE STAR')"));
  assert(dashboard.includes("safeAccountStarHistoryRow"), "one malformed legacy STAR must not blank the unified history");
  assert(dashboard.includes("Unable to display STAR history"), "wallet rendering must have a visible error state");
  assert(dashboardHtml.includes('id="student-star-overlay"'), "My STARs must use an independent modal");
  assert(dashboardHtml.includes('id="student-star-content"'));
  assert(appCss.includes(".student-star-dialog"), "wallet must use its own opaque dialog surface");
  assert(dashboardHtml.includes("assets/css/app.css?v=20260802-2"));
  assert(dashboardHtml.includes("assets/js/dashboard.js?v=20260802-3"));
  assert(dashboard.includes('<h2 id="student-star-title">STAR WALLET</h2>'));
  assert(dashboard.includes('account-wallet-pass'), "wallet landing must use the selected gold pass balance card");
  assert(!dashboard.includes('account-star-history-count self-study-star-counter'), "wallet landing must not show a Blue balance");
  assert(!dashboard.includes('Yellow STARs available</span>'), "gold pass must not show a visible balance label");
  assert(!dashboard.includes('<div class="account-star-wallet">'), "wallet must not show Available/Lifetime/Active summary tiles");
  assert(dashboard.includes("if (button.dataset.walletBack === 'account') closeStarPanel(true);"), "STAR Back must not bubble into the global Personal Center closer");
  assert(teacher.includes("Final confirmation: mark this request completed"));
  assert(backend.includes('action === "confirmStarRedemption"'));
  assert(backend.includes('action === "migrateStarRewards"'));
}

async function main() {
  testClassificationAndHistory();
  testBlueConversionGate();
  testAppendOnlyWallet();
  testRequestRules();
  testIntegrationContracts();
  await testProtectionFlow();
  console.log("STAR rewards tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
