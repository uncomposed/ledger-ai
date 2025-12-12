# initial: ruleset
Bypass list
Bypass list is empty
Target branches
Branch targeting criteria
Default
## Rules
Branch rules

Restrict deletions
Only allow users with bypass permissions to delete matching refs.

Require signed commits
Commits pushed to matching refs must have verified signatures.

Require a pull request before merging
Require all commits be made to a non-target branch and submitted via a pull request before they can be merged.
Required approvals: 1

Dismiss stale pull request approvals when new commits are pushed
New, reviewable commits pushed will dismiss previous pull request review approvals.

Require status checks to pass
Choose which status checks must pass before the ref is updated. When enabled, commits must first be pushed to another ref where the checks pass.

Require branches to be up to date before merging
Whether pull requests targeting a matching branch must be tested with the latest code. This setting will not take effect unless at least one status check is enabled.

Allow repositories and branches to be created if a check would otherwise prohibit it.
No required checks
No checks have been added
Learn more about status checks

Block force pushes
Prevent users with push access from force pushing to refs.
