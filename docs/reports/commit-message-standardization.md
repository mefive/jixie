# English commit message standardization

## Completion status

Approved and applied on 2026-09-11 after human review. Both local branches were
rewritten and verified. Documentation and tooling are delivered with this report.
Remote-tracking references and the remote repository were not changed.

The approved scope covers all 461 commits reachable from the two local branches,
starting at the root. There are no merge commits or tags. All inspected commits
are unsigned and have no explicit encoding header. The working tree was clean
before this task.

The plan changes 387 messages and retains 74 already-compliant messages. It
translates 135 Chinese bodies; the other eight existing bodies contain only
attribution. All 461 historical IDs change because the root changes. Translation
preserves the historical meaning, qualifications, reported verification results,
and attribution; those historical results are not new verification claims.

Review the [subject comparison](commit-message-standardization-review.md) and
[complete message/hash plan](commit-message-standardization.json). The JSON
includes original and proposed bodies and exact expected IDs. Original Chinese
text is audit evidence, not guidance for future commits.

Documentation/tooling commit message:

```text
chore(repo): standardize English commit messages and contribution guidelines
```

## Delivered files

- `CLAUDE.md`: canonical English-only commit policy and contribution-guide link.
- `CONTRIBUTING.md`: English message, scope, body, attribution, and review rules.
- `package.json`: commit-msg hook and explicit checker/test commands.
- `scripts/check-commit-message.mjs`: dependency-free static message checker.
- `scripts/check-commit-message.test.mjs`: format, attribution, breaking-change,
  invalid-message, and file/CLI verification cases; all three test groups passed.
- This report, the subject comparison, and the JSON plan: review and audit records.

The checker requires a type and lowercase kebab-case scope, a lowercase-starting
English description of at most 100 characters, no terminal subject punctuation,
and a blank line before a body. It rejects Chinese prose while preserving names
in attribution trailers. English grammar and diff accuracy require review.
Existing pre-commit formatting remains in place; no dependencies were added.

## Backup and application

A 54 MB Git bundle and preparation inputs are stored in the ignored local directory
`data/git-history-backup-20260911/`. The bundle includes all original references.
It is excluded from the public commit and must be retained until remote history
and other clones have been reconciled. A second copy exists in
`/private/tmp/jixie-commit-standardization/`; temporary storage is not the durable
backup.

The local `rewrite-history.py` in the backup directory consumes the reviewed JSON.
It checks exact source messages, tree IDs, complete history coverage, unique IDs,
branch targets, and unsupported headers before writing. It preserves original
raw metadata, maps parent IDs, writes only commit objects, verifies every stored
byte, and then atomically updates both local branches with expected-old-ID guards.
A changed branch causes it to stop instead of overwriting concurrent work.

Completed after review approval:

1. All three checker test groups passed; relevant static checks passed.
2. The bundle verified as complete and was cloned into an isolated bare repository.
3. The isolated rewrite and independent verification pass preserved all 461 trees,
   raw metadata, mapped parent relationships, and reviewed messages. Git fsck
   passed. A repeated application was rejected without changing any branch.
4. The identical plan was applied to both local branches and verified again.
   Git fsck passed, and the old/new main trees had no differences.
5. All 461 messages read from the actual rewritten branches passed the checker.
   Installed hooks accepted the approved message and rejected an invalid one.
6. This report was updated for the documentation/tooling commit above.

Historical branch targets (before the documentation/tooling commit):

- `main`: `a45688c1c6ef0c1951134f77256af5d9e126844d` to
  `cc714612fb94cccb08aff5656cde7c0359d9fc50`.
- `feat/factor-ide-align`: `a4b38ddba40558eb581eb2d37c8134d6216c3807` to
  `056d3b44d8b61bb82c6040653eb059eba0111bed`.

The JSON reference targets describe the historical rewrite boundary; `main`
subsequently includes the documentation/tooling commit. The application script's
`--verify-only` mode intentionally expects those boundary tips.

For recovery, clone `data/git-history-backup-20260911/original.bundle` into a new
local directory. This reconstructs the original branches without modifying this
working tree. Retain the message/hash map to resolve old references.

Remote-tracking references remain unchanged because they describe the last known
remote history. No push is performed. Existing hashes in historical files, external
links, release/deployment records, and other clones still refer to the old history;
they can be resolved through the mapping and bundle. Historical file contents are
preserved rather than edited to change those references. Remote synchronization
must be performed by the maintainer with explicit expected-old-ID protection.

## Static verification before review

- Node syntax checks for the checker and its test file: passed.
- ESLint for both JavaScript files: passed after replacing a control-character
  regex with explicit code-point checks.
- Prettier checks for JavaScript, package configuration, and JSON plan: passed.
- Static message validation: all 461 proposed messages passed.
- Attribution comparison: all existing trailers were preserved exactly.
- Python AST parse for the local application script: passed.
- Git diff whitespace checks: passed.

Behavioral tests, bundle verification, isolated rewriting, local rewriting, and
hook installation passed after approval as recorded above. No application,
database, service, or frontend behavior is changed by this task.


## Manual remote synchronization

The maintainer can update the remote main branch with an exact expected-old-ID
lease after choosing to publish the rewritten history:

```sh
git push --force-with-lease=refs/heads/main:a45688c1c6ef0c1951134f77256af5d9e126844d origin main:main
```

This command refuses to overwrite a different remote tip. Do not replace that
protection with an unconditional force push if it fails; inspect the remote
changes first. No remote publication is performed by this task.
