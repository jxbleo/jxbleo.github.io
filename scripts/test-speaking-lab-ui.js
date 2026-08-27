#!/usr/bin/env node
"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

function read(file) { return fs.readFileSync(path.join(__dirname, "..", file), "utf8"); }
function run() {
  const page = read("speaking-lab.html");
  const report = read("speaking-report.html");
  const app = read("assets/js/speaking-lab.js");
  const reportJs = read("assets/js/speaking-report.js");
  const teacher = read("assets/js/teacher-speaking.js");
  const teacherPage = read("teacher.html");
  const dashboard = read("dashboard.html");
  const css = read("assets/css/speaking-lab.css");
  assert.match(page, /speaking-lab\.js\?v=/);
  assert.match(page, /speaking-lab\.css\?v=/);
  assert.match(page, /Record now|Upload audio/);
  assert.match(dashboard, /speaking-lab\.html\?v=/);
  assert.match(teacherPage, /data-view="speaking"/);
  assert.match(teacherPage, /teacher-speaking\.js\?v=/);
  assert.match(teacherPage, /speaking-lab\.css\?v=/);
  assert.match(page, /Voice Reference|New Discussion/);
  assert.match(page, /invitation-dialog/);
  assert.match(page, /discussion-duration/);
  assert.match(report, /noindex|nofollow/);
  assert.match(report, /speaking-report\.js\?v=/);
  assert.doesNotMatch(report, /<audio\b|download\s*=/i);
  assert.match(app, /MediaRecorder/);
  assert.match(app, /getUserMedia/);
  assert.match(app, /AnalyserNode|createAnalyser/);
  assert.match(app, /-45|0\.98|INPUT_LOSS_SECONDS/);
  assert.match(app, /SPEAKING_PROVIDER_NOT_CONFIGURED|feature not enabled/i);
  assert.match(app, /Many people have different ideas/);
  assert.match(app, /This is my voice/);
  assert.match(app, /This isn\\'t my voice/);
  assert.match(app, /updateDiscussionDuration/);
  assert.match(app, /addVipParticipant|addGuestParticipant/);
  assert.match(app, /renameGuest|removeParticipant/);
  assert.match(app, /data-voice-record/);
  assert.doesNotMatch(app, /localStorage|sessionStorage/);
  assert.match(reportJs, /SHARE_NOT_AVAILABLE|expired|revoked/i);
  assert.match(teacher, /visible_participant_ids|Select all|Clear all/);
  assert.match(teacher, /data-share-content|Individual analysis|Transcript/);
  assert.doesNotMatch(teacher, /speaker_keys\s*:|candidate_speaker_keys\s*:/);
  assert.match(reportJs, /snapshot\.self|participant_summaries/);
  assert.match(css, /prefers-reduced-motion/);
  console.log("Speaking Lab UI contracts passed.");
}

run();
