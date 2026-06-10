# Agent Safety Rules

## Ownership

The Tencent Cloud account, CloudBase environments, billing, domains and
production deployment authority belong only to the project owner.

## Secrets

Never commit or hard-code:

- Tencent Cloud `SecretId` or `SecretKey`
- access tokens, refresh tokens or administrator credentials
- private keys or service account files
- student passwords
- server-side password reset values
- private grading keys

The CloudBase environment ID and region are public browser configuration and
may be committed.

## Cloud Operations

- Prepare code locally before changing cloud resources.
- Use the development environment only after explicit owner approval.
- Never create, modify or deploy a production environment without explicit
  owner review.
- Never change billing, DNS, domain, ICP or Tencent Cloud account settings.
- Never weaken `ADMINONLY` database permissions for convenience.
- Cloud functions must derive student identity from authenticated server
  context, never from a browser-provided Student ID.

## Content and Grading

- Public repository data may contain questions and choices.
- Correct answers, explanations, accepted variants and scoring rules belong in
  CloudBase private storage.
- Do not add new grading answers to public JSON after private grading migration.
