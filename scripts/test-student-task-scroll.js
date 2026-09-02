#!/usr/bin/env node

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const dashboardJs = fs.readFileSync(path.join(root, 'assets/js/dashboard.js'), 'utf8');
const appCss = fs.readFileSync(path.join(root, 'assets/css/app.css'), 'utf8');
const dashboardHtml = fs.readFileSync(path.join(root, 'dashboard.html'), 'utf8');

function sourceBetween(startMarker, endMarker) {
  const start = dashboardJs.indexOf(startMarker);
  const end = dashboardJs.indexOf(endMarker, start);
  assert(start >= 0 && end > start, `Expected ${startMarker} before ${endMarker}`);
  return dashboardJs.slice(start, end);
}

const replyPagination = sourceBetween(
  'function setupTeacherRepliesPagination',
  'function openStudentMessageCenter'
);
const messageCenter = sourceBetween(
  'function openStudentMessageCenter',
  'function openTeacherRepliesDialog'
);

for (const panel of ['todo', 'finished', 'replies']) {
  assert.match(
    dashboardJs,
    new RegExp(`data-message-panel="${panel}"[^>]*tabindex="0"`),
    `${panel} must be a keyboard-focusable scroll region`
  );
}

assert.doesNotMatch(dashboardJs, /teacher-replies-pull-loader/);
assert.doesNotMatch(replyPagination, /preventDefault|touchmove|wheel/);
assert.match(replyPagination, /addEventListener\('scroll', revealWhenNearEdge, \{ passive: true \}\)/);
assert.match(replyPagination, /visibleReplyCount \+ 5/);
assert.match(messageCenter, /scrollContainer: repliesPanel/);
assert.match(messageCenter, /tabId === 'replies' && checkTeacherRepliesEdge/);
assert.match(messageCenter, /panel\.addEventListener\('scroll'/);
assert.match(messageCenter, /appendNextAssignmentBatch\(panel\)/);
assert.match(messageCenter, /messagePanelScrollPositions\[panelId\] = panel\.scrollTop/);
assert.match(messageCenter, /selectedPanel\.scrollTop = Number\(messagePanelScrollPositions\[tabId\] \|\| 0\)/);
assert.doesNotMatch(messageCenter, /dialog\.scrollTop = 0/);

assert.match(
  appCss,
  /\.student-message-dialog:not\(\.is-focused-scope\)\s*\{[^}]*display:\s*grid;[^}]*overflow:\s*hidden;/s
);
assert.match(
  appCss,
  /\.student-message-dialog:not\(\.is-focused-scope\) \.student-message-sections\s*\{[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\);[^}]*height:\s*100%;/s
);
assert.match(
  appCss,
  /\.student-message-tab-panel\s*\{[^}]*overflow-y:\s*auto;[^}]*scrollbar-gutter:\s*stable;[^}]*-webkit-overflow-scrolling:\s*touch;[^}]*touch-action:\s*pan-y pinch-zoom;/s
);
assert.doesNotMatch(appCss, /teacher-replies-pull-loader/);

assert.match(dashboardHtml, /assets\/css\/app\.css\?v=20260902-1/);
assert.match(dashboardHtml, /assets\/js\/dashboard\.js\?v=20260902-2/);

console.log('Student task-list scrolling regression checks passed.');
