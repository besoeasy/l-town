import type { Plugin } from "@opencode-ai/plugin"

export default (async () => {
  let editsSinceBump = 0
  let lastBumpVersion = ""

  return {
    "tool.execute.after": async (input, output) => {
      const tool = (input as any).tool as string

      // Track code-changing edits
      if (["edit", "write", "bash"].includes(tool)) {
        const args = (output as any).args ?? (input as any).args ?? {}
        const filePath = args.filePath ?? args.filepath ?? ""
        const command = args.command ?? ""

        const isCodeChange =
          (tool === "edit" || tool === "write") && !filePath.endsWith("package.json") ||
          (tool === "bash" && /(server\.js|public\/|map\.js|game\.js)/.test(command ?? ""))

        if (isCodeChange) {
          editsSinceBump++
        }

        // Detect version bump (package.json edit or npm version patch)
        const isBump =
          (filePath.endsWith("package.json") && tool !== "bash") ||
          (tool === "bash" && /npm version patch/.test(command ?? ""))

        if (isBump) {
          editsSinceBump = 0
          try {
            const fs = await import("fs/promises")
            const pkg = JSON.parse(await fs.readFile("package.json", "utf8"))
            lastBumpVersion = pkg.version
          } catch {}
        }

        // Warn if edits accumulate without bump — surfaces in tool output
        if (editsSinceBump >= 1 && tool === "bash" && /git (commit|push)/.test(command ?? "")) {
          if (editsSinceBump > 0) {
            // Let the commit go through, but remind in next turn via console
            console.warn(
              `[auto-bump] Rule: after each addition you must run: npm version patch --no-git-tag-version && git add package.json && git commit -m "chore: bump version -> ${lastBumpVersion || "x.y.z"}" && git push`
            )
          }
        }
      }
    },
  }
}) satisfies Plugin
