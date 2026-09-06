# AGENTS — L-Town

> **RULE: After each code addition, bump patch version and GitHub CLI push is mandatory.**
> See `.opencode/rules.md` for the exact `npm version patch` + `git push` + `gh pr` sequence.

- Workdir: `/home/jesus/l-town`
- Stack: Node >=18, Three.js, ws, 750x750 arena, 20Hz tick
- Always use `workdir` param instead of `cd`
- Verify with `node --check server.js` before committing
