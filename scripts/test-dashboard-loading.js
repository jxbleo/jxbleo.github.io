const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../assets/js/dashboard.js'), 'utf8');
const start = source.indexOf('    function mergeProtectedCatalogResources(');
const end = source.indexOf('    function loadStudentData(', start);
assert(start > 0 && end > start);
const plain = value => JSON.parse(JSON.stringify(value));
const assignment = (id, status = 'to_do') => ({ assignment_id: id, set: { set_id: id }, status });

function harness(respond, options = {}) {
  const calls = [];
  const state = {
    session: { mode: 'student' }, assignments: [], resources: [], libraryProgress: [],
    teacherReplies: [], starRewards: { available: false },
    assignmentPages: { todo: {}, finished: {} }
  };
  let renders = 0, cacheWrites = 0;
  const context = {
    state, studentDashboardWarmPromise: null, libraryActiveTab: 'general',
    window: { MrCatCloud: { callFunction(name, payload = {}) {
      const call = { name, ...payload };
      calls.push(call);
      return Promise.resolve().then(() => respond(call));
    } } },
    fetch: async () => ({ ok: true }),
    openTodoAssignments: () => [],
    assignmentSetId: item => item.set && item.set.set_id || item.set_id,
    assignmentSet: item => item.set || item,
    libraryItemIdentity: item => item.set_id || item.id,
    todoAssignments: () => state.assignments.filter(item => item.status === 'to_do'),
    upcomingAssignments: () => [],
    finishedAssignments: () => state.assignments.filter(item => item.status !== 'to_do'),
    updateStarCounter() {},
    saveStudentDashboardCache() { cacheWrites += 1; },
    renderWeeklyFocusProgress() { renders += 1; },
    renderAssignments() {}, libraryLoadTabContent() {}, renderProfile() {}, updateDashboardTabNotices() {},
    loadPublicCatalog: options.catalog || (async () => [
      { set_id: 'A', title: 'Public title' },
      { set_id: 'protected-reference', access: 'student-preview' }
    ])
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end) + '\nthis.hooks = { applyDashboardBootstrap, warmStudentDashboard, prefetchAssignmentPages };', context);
  context.hooks.applyDashboardBootstrap({
    success: true, bootstrap: true,
    assignments: [assignment('A'), assignment('OLD', 'passed')],
    assignment_counts: { todo: 12, upcoming: 3, finished: 13 },
    weekly_summary: { this_week_total: 8, this_week_finished: 2 },
    assignment_pages: {
      todo: { next_cursor: 10, has_more: true },
      finished: { next_cursor: 10, has_more: true }
    },
    assignment_star_count: 2, self_study_star_count: 1,
    teacher_reply_count: 2, teacher_replies: [{ dispute_id: 'unread', student_seen: false }],
    teacher_reply_unread_count: 1
  });
  return { ...context.hooks, state, calls, renders: () => renders, cacheWrites: () => cacheWrites };
}

const full = {
  success: true,
  assignments: [assignment('A'), assignment('FINISHED', 'passed'),
    { assignment_id: null, source: 'self_study', set: { set_id: 'SELF' }, status: 'mastered', best_percentage: 100 }],
  library_progress: [{ set_id: 'A', best_percentage: 88, status: 'passed' }],
  star_count: 5, assignment_star_count: 3, self_study_star_count: 2,
  star_achievements: [{ achievement_id: 'yellow' }, { achievement_id: 'converted-blue', status: 'converted' }],
  star_rewards: { available: true, wallet: { available_yellow_stars: 2 }, cash_requests: [{ request_id: 'cash', status: 'completed' }] },
  teacher_replies: [{ dispute_id: 'unread', student_seen: false }, { dispute_id: 'read', student_seen: true }]
};

async function testSuccessfulWarmUsesOneFullResult() {
  const h = harness(call => {
    if (call.name === 'getDashboard' && !call.action) return full;
    if (call.name === 'getResources') return { success: true, resources: [{ set_id: 'A', title: 'Cloud title' }] };
    throw new Error('Unexpected duplicate request');
  });
  const first = h.warmStudentDashboard();
  assert.equal(first, h.warmStudentDashboard(), 'Concurrent warm calls share one request chain');
  await first;
  assert.deepEqual(h.calls, [{ name: 'getDashboard' }, { name: 'getResources' }]);
  assert.deepEqual(plain(h.state.assignments), full.assignments, 'Self-study and all finished rows come from authoritative full result');
  assert.deepEqual(plain(h.state.starAchievements), full.star_achievements);
  assert.deepEqual(plain(h.state.starRewards), full.star_rewards, 'Wallet and redemption history remain intact');
  assert.deepEqual(plain(h.state.teacherReplies), full.teacher_replies);
  assert.equal(h.state.teacherReplyUnreadCount, 1);
  assert.equal(h.state.teacherRepliesComplete, true);
  assert.equal(h.state.assignmentsComplete, true);
  assert.equal(h.state.weeklySummary, null);
  assert.equal(h.state.assignmentStarCount, 3);
  assert.equal(h.state.selfStudyStarCount, 2);
  assert.equal(h.state.starCount, 5);
  assert.equal(h.state.resources[0].title, 'Cloud title');
  assert.equal(h.state.resources[0].best_percentage, 88);
  assert.equal(h.state.resources[1].set_id, 'protected-reference');
  assert.equal(h.renders(), 1);
}

async function testFallbackRetainsPagedAssignmentsAndReplies(failure) {
  const h = harness(call => {
    if (call.name === 'getResources') return { success: true, resources: [] };
    if (!call.action) {
      if (failure === 'transport') throw new Error('Network unavailable');
      return failure === 'empty' ? null : { success: false };
    }
    if (call.action === 'listTeacherReplies') return { success: true, teacher_replies: full.teacher_replies };
    assert.equal(call.action, 'listAssignmentPage');
    return { success: true, page: {
      items: [assignment(call.kind + call.cursor, call.kind === 'todo' ? 'to_do' : 'passed')],
      next_cursor: call.cursor === 10 ? 20 : null,
      has_more: call.cursor === 10
    } };
  });
  await h.warmStudentDashboard();
  assert.deepEqual(h.calls.filter(call => call.action === 'listAssignmentPage').map(call => [call.kind, call.cursor]),
    [['todo', 10], ['todo', 20], ['finished', 10], ['finished', 20]]);
  assert.equal(h.state.assignments.length, 6);
  assert.equal(h.state.assignmentsComplete, false, 'Fallback must not claim self-study and wallet data are complete');
  assert.equal(h.state.assignmentCounts.todo, 12, 'Retain authoritative bootstrap totals while only partial data is available');
  assert.deepEqual(plain(h.state.teacherReplies), full.teacher_replies);
  assert.equal(h.state.assignmentPages.todo.loading, false);
  assert.equal(h.state.assignmentPages.finished.loading, false);
  assert.equal(h.renders(), 1);
}

async function testFailedOrStalledPageDoesNotLoop(result) {
  const h = harness(() => {
    if (result === 'transport') throw new Error('Offline');
    return result;
  });
  await h.prefetchAssignmentPages('todo');
  assert.equal(h.calls.length, 1, 'Do not repeatedly request a failed or non-advancing cursor');
  assert.equal(h.state.assignmentPages.todo.loading, false);
  assert.equal(h.state.assignmentsComplete, false);
}

async function testCatalogFailureKeepsFullDashboard() {
  const h = harness(call => call.name === 'getDashboard' ? full : { success: true, resources: [{ set_id: 'A' }] },
    { catalog: async () => { throw new Error('Public catalog unavailable'); } });
  await h.warmStudentDashboard();
  assert.equal(h.calls.length, 2);
  assert.deepEqual(plain(h.state.assignments), full.assignments);
  assert.equal(h.state.resources[0].best_percentage, 88);
  assert.equal(h.renders(), 1);
}

async function testResourceFailureDoesNotTriggerAssignmentFallback() {
  const h = harness(call => {
    if (call.name === 'getDashboard') return full;
    throw new Error('Resource catalog unavailable');
  });
  await h.warmStudentDashboard();
  assert.equal(h.calls.length, 2);
  assert.equal(h.state.assignmentsComplete, true);
  assert.deepEqual(plain(h.state.starRewards), full.star_rewards);
  assert.equal(h.state.resources[0].title, 'Public title');
  assert.equal(h.state.resources[0].best_percentage, 88);
}

(async () => {
  await testSuccessfulWarmUsesOneFullResult();
  for (const failure of ['transport', 'application', 'empty']) await testFallbackRetainsPagedAssignmentsAndReplies(failure);
  for (const result of ['transport', null, { success: false },
    { success: true, page: { items: [], next_cursor: 10, has_more: true } },
    { success: true, page: { items: [], next_cursor: 'invalid', has_more: true } }]) {
    await testFailedOrStalledPageDoesNotLoop(result);
  }
  await testCatalogFailureKeepsFullDashboard();
  await testResourceFailureDoesNotTriggerAssignmentFallback();
  console.log('Dashboard loading regression passed: no duplicate normal requests; full data parity and bounded page fallback retained.');
})().catch(error => { console.error(error); process.exitCode = 1; });
