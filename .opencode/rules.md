# Project Rules — L-Town

## Version bump & push rule (MANDATORY)

After **every** code addition / fix / feature (any `edit`/`write`/`bash` that changes `server.js`, `public/**`, `package.json` except the version bump itself):

1. **Bump patch version**: `npm version patch --no-git-tag-version` (or manually increment `package.json:version` `x.y.z` → `x.y.(z+1)`)
2. **Commit & push via GitHub CLI**:
   ```bash
   git add -A
   git commit -m "chore: bump version x.y.z -> x.y.(z+1)"
   git push
   gh pr create --head <branch> --base main --title "chore: bump ..." --body "..."  # if new branch
   # or if on existing PR branch:
   git push
   ```
3. Verify: `cat package.json | grep version` + `git log --oneline -1` + `gh pr view --json url`

**Severity**: This rule is enforced by `.opencode/plugin/auto-bump.ts`. The plugin will warn if an edit is made without a subsequent version bump+push in the same session. Do not skip.

**Applies to**: `l-town` repo only. Use `workdir=/home/jesus/l-town` for all commands.
