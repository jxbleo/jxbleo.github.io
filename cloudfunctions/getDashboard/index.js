const cloudbase = require("@cloudbase/node-sdk");

const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
const db = app.database();

async function getAuthenticatedStudent() {
  const userInfo = await app.auth().getUserInfo();
  const uid = userInfo && (userInfo.uid || userInfo.userId);
  if (!uid) throw new Error("AUTH_REQUIRED");
  const result = await db.collection("students").where({
    auth_uid: String(uid),
    active: true,
  }).limit(1).get();
  if (!result.data || !result.data[0]) throw new Error("STUDENT_NOT_LINKED");
  return result.data[0];
}

exports.main = async () => {
  try {
    const student = await getAuthenticatedStudent();
    const assignmentResult = await db.collection("assignments")
      .where({ student_uid: student.auth_uid })
      .orderBy("assigned_at", "desc")
      .limit(100)
      .get();
    const assignments = assignmentResult.data || [];
    const setIds = [...new Set(assignments.map((item) => item.set_id).filter(Boolean))];
    const setMap = new Map();

    for (const setId of setIds) {
      const setResult = await db.collection("sets").where({
        set_id: setId,
        visible: true,
      }).limit(1).get();
      if (setResult.data && setResult.data[0]) setMap.set(setId, setResult.data[0]);
    }

    return {
      success: true,
      assignments: assignments.map((assignment) => ({
        assignment_id: assignment.assignment_id || assignment._id,
        status: assignment.status || "not_done",
        assigned_at: assignment.assigned_at || null,
        due_at: assignment.due_at || null,
        completed_at: assignment.completed_at || null,
        updated_at: assignment.updated_at || null,
        attempt_count: assignment.attempt_count || 0,
        latest_percentage: assignment.latest_percentage == null ? null : assignment.latest_percentage,
        best_percentage: assignment.best_percentage == null ? null : assignment.best_percentage,
        set: setMap.get(assignment.set_id) || {
          set_id: assignment.set_id,
          title: assignment.set_id,
          link: "#",
        },
      })),
    };
  } catch (error) {
    return {
      success: false,
      code: error.message,
      message: error.message === "AUTH_REQUIRED" ? "Please log in." : "Unable to load assignments.",
      assignments: [],
    };
  }
};
