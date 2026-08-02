const DEFAULT_ALLOWED_ROLES = new Set(["student", "teacher"]);

function allowedRoles(resource) {
  const configuredRoles = Array.isArray(resource && resource.allowed_roles)
    ? resource.allowed_roles.map((role) => String(role || "").trim()).filter(Boolean)
    : [];
  return configuredRoles.length ? new Set(configuredRoles) : DEFAULT_ALLOWED_ROLES;
}

function roleCanAccess(profile, resource) {
  return allowedRoles(resource).has(String(profile && profile.role || "student"));
}

module.exports = { roleCanAccess };
