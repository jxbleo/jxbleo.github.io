function normalizeVersion(value) {
  return String(value == null ? "" : value).trim();
}

function gradingVersion(gradingKey) {
  return normalizeVersion(gradingKey && gradingKey.grading_version) || "1";
}

function assertVocabularyContentVersion(contentVersion, gradingKey) {
  const submitted = normalizeVersion(contentVersion);
  const expected = gradingVersion(gradingKey);
  if (!submitted || submitted !== expected) {
    const error = new Error("VOCABULARY_CONTENT_OUTDATED");
    error.code = "VOCABULARY_CONTENT_OUTDATED";
    throw error;
  }
  return expected;
}

function buildVocabularyGradingSnapshot(gradingKey, questionIds) {
  const sourceAnswers = gradingKey && gradingKey.answers || {};
  const sourceExplanations = gradingKey && gradingKey.explanations || {};
  const answers = {};
  const explanations = {};

  (questionIds || []).forEach((questionId) => {
    if (!Object.prototype.hasOwnProperty.call(sourceAnswers, questionId)) {
      throw new Error("VOCABULARY_TEST_QUESTION_MISMATCH");
    }
    answers[questionId] = sourceAnswers[questionId];
    explanations[questionId] = sourceExplanations[questionId] || "";
  });

  return {
    grading_version: gradingVersion(gradingKey),
    answers,
    explanations,
    scoring_rules: gradingKey && gradingKey.scoring_rules || { type: "vocabulary_test" },
  };
}

function gradingKeyFromSessionSnapshot(session) {
  const answers = session && session.grading_answers_snapshot;
  const explanations = session && session.grading_explanations_snapshot;
  const version = normalizeVersion(session && session.grading_version);
  if (!version || !answers || typeof answers !== "object" || Array.isArray(answers)) {
    throw new Error("VOCABULARY_CONTENT_OUTDATED");
  }
  return {
    grading_version: version,
    answers,
    explanations: explanations && typeof explanations === "object" && !Array.isArray(explanations)
      ? explanations
      : {},
    scoring_rules: { type: "vocabulary_test" },
  };
}

module.exports = {
  assertVocabularyContentVersion,
  buildVocabularyGradingSnapshot,
  gradingKeyFromSessionSnapshot,
  gradingVersion,
  normalizeVersion,
};
