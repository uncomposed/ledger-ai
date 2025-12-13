# GitHub Repo Settings (M0)
note: @uncomposed is the manager of the GitHub repo
These protections live in GitHub settings (not in code), so we document them here.

## Ruleset / Branch protection (`main`)

Enable:

- Require a pull request before merging (min approvals: 1)
- Dismiss stale approvals on new commits
- Require branches to be up to date before merging
- Require status checks to pass (required checks listed below)
- Block force pushes
- Restrict deletions
- Require signed commits (recommended)

### Required status checks

From `.github/workflows/ci.yml`:

- `dangerous_change_detector`
- `node_checks`
- `db_migrate_and_verify`
- `event_schema_validate`
- `policy_tests`

## Secret scanning / push protection

Enable:

- Secret scanning
- Push protection for supported secrets
