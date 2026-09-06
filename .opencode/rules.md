# Project Rules — L-Town

## Version bump & push rule (MANDATORY)

After **every** code addition / fix / feature (any `edit`/`write`/`bash` that changes `server.js`, `public/**`, `package.json` except the version bump itself):

1. **Bump patch version**: `npm version patch --no-git-tag-version` (or manually increment `package.json:version` `x.y.z` → `x.y.(z+1)`)
2. **Commit & push directly to `main` via GitHub CLI** (no PR):
   ```bash
   git add -A
   git commit -m "chore: bump version x.y.z -> x.y.(z+1)"
   git push origin main
   # or: gh repo view --json url to verify
   ```
3. Verify: `cat package.json | grep version` + `git log --oneline -1` + `git push origin main`

**Severity**: This rule is enforced by `.opencode/plugin/auto-bump.ts`. The plugin will warn if an edit is made without a subsequent version bump+push in the same session. Do not skip.

**Applies to**: `l-town` repo only. Use `workdir=/home/jesus/l-town` for all commands.
