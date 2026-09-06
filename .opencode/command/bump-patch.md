---
description: Bump patch version and push via GitHub CLI (mandatory after each addition)
---

Run these steps in `workdir=/home/jesus/l-town` (direct to main, no PR):

1. `npm version patch --no-git-tag-version` — increments `package.json:version` x.y.z → x.y.(z+1)
2. Verify: `cat package.json | grep version` and `node --check server.js`
3. `git add package.json && git commit -m "chore: bump version <old> -> <new>"`
4. `git push origin main` — direct push via GitHub CLI auth (no `gh pr create`)

Do not skip. $ARGUMENTS
