---
description: Bump patch version and push via GitHub CLI (mandatory after each addition)
---

Run these steps in `workdir=/home/jesus/l-town`:

1. `npm version patch --no-git-tag-version` — increments `package.json:version` x.y.z → x.y.(z+1)
2. Verify: `cat package.json | grep version` and `node --check server.js`
3. `git add package.json && git commit -m "chore: bump version <old> -> <new>"`
4. `git push` (if branch already pushed) or `git push -u origin <branch>`
5. If PR exists, it auto-updates; else `gh pr create --head <branch> --base main --title "chore: bump version ..." --body "..."`

Do not skip. $ARGUMENTS
