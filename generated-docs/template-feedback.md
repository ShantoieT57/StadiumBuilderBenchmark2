# Template Feedback

## shadcn CLI resolves `cn` to an npm package named `cn`

- **Symptom:** `npx shadcn add tooltip sheet --yes` generated `import { cn } from "cn"` and added the unrelated npm package `cn` to `app-frontend/package.json`, instead of importing from `@/lib/utils`.
- **Cause (confirmed):** the upstream shadcn registry itself. `https://ui.shadcn.com/r/styles/new-york-v4/alert.json` (the Tailwind v4 registry the CLI uses for this project) ships `import { cn } from "cn"` with `"dependencies": ["cn"]`; the older `styles/new-york/` items still use `@/lib/utils`. Reproduced in a clean scratch project with no `src/lib/utils/` directory, with and without `baseUrl` and the `lib` alias. `components.json` is not the cause: its aliases (`utils: @/lib/utils`) are unambiguous and correct, so there is nothing to change there.
- **Workaround:** after every `npx shadcn add`, rewrite the generated `import { cn } from "cn"` to `@/lib/utils` and run `npm uninstall cn` (check `package.json` has no `cn` entry).
- **Suggested fix:** add a post-`shadcn add` check to the template (e.g. a lint `no-restricted-imports` rule for `cn`, or a script that rewrites the import and removes the dependency) until the upstream registry is fixed.
