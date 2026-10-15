# Template Feedback

## shadcn CLI resolves `cn` to an npm package named `cn`

- **Symptom:** `npx shadcn add tooltip sheet --yes` generated `import { cn } from "cn"` and added the unrelated npm package `cn` to `app-frontend/package.json`, instead of importing from `@/lib/utils`.
- **Likely cause:** the template ships both `app-frontend/src/lib/utils.ts` and a `src/lib/utils/` directory, so the `utils` alias (`@/lib/utils`) is ambiguous to the CLI's resolver.
- **Workaround applied:** rewrote the import to `@/lib/utils` in the generated files and ran `npm uninstall cn`.
- **Suggested fix:** rename the `src/lib/utils/` directory (e.g. `src/lib/constants/`) or point `components.json` `aliases.utils` at `@/lib/utils.ts`-only path, so every future `shadcn add` produces a correct import.
