# AGENTS — L-Town

> **RULE: After each code addition, bump patch version and push directly to main via GitHub CLI is mandatory.**
> See `.opencode/rules.md` for the exact `npm version patch` + `git push origin main` sequence (no PR).

- Workdir: `/home/jesus/l-town`
- Stack: Node >=18, Three.js, ws, 750x750 arena, 20Hz tick
- Always use `workdir` param instead of `cd`
- Verify with `node --check server.js` before committing
