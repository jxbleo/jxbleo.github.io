const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const backend = fs.readFileSync(path.join(root, "cloudfunctions/teacherAdmin/index.js"), "utf8");
const frontend = fs.readFileSync(path.join(root, "assets/js/teacher.js"), "utf8");

assert(backend.includes('async function acceptAttemptAnswer(event, teacher)'));
assert(backend.includes('if (result.correct === true) throw new Error("ANSWER_ALREADY_CORRECT")'));
assert(backend.includes('throw new Error("ARGUE_ALREADY_EXISTS")'));
assert(backend.includes('source: "teacher_attempt_review_quick_accept"'));
assert(backend.includes('decision: "add"'));
assert(backend.includes('if (action === "acceptAttemptAnswer")'));
assert(backend.includes('has_argue: disputedQuestionIds.has(String(questionId))'));

assert(frontend.includes("options && options.allowQuickAccept === true"));
assert(frontend.includes("result.has_argue !== true"));
assert(frontend.includes("Add as accepted answer"));
assert(frontend.includes("teacherCall('acceptAttemptAnswer'"));
assert(frontend.includes("renderMatrixCellDetail(detailItem, { allowQuickAccept: true })"));
assert(frontend.includes("renderMatrixAttemptReview(reviewEntry, entries, item, options)"));

console.log("Teacher quick accepted-answer checks passed.");
