# benchmark-app-2

Built with Stadium Builder: describe what you want in plain language, and Claude Code plans, builds and tests it.

## Layout

| Folder | What's in it |
| --- | --- |
| `app-backend/` | The .NET back end: `BenchmarkApp2`, with tests in `BenchmarkApp2.Tests` |
| `app-frontend/` | The Next.js front end |
| `documentation/` | What you want built. Claude Code reads this at Intake |
| `generated-docs/` | Plans and progress the workflow writes as it goes |

## Running it

Back end:

```bash
dotnet run --project app-backend/BenchmarkApp2
dotnet test app-backend
```

In VS Code, `F5` launches the back end using the generated `.vscode/launch.json`.

Front end:

```bash
(cd app-frontend && npm install)
(cd app-frontend && npm run dev)
```

## Building features

Run `/start` in Claude Code. It reads `documentation/`, asks for anything it still needs, and takes the work through planning, building and review.

- [Getting started](.template-docs/users/Getting-Started.md) for the full walkthrough
- [What to put in `documentation/`](documentation/README.md)
- [Help](.template-docs/users/Help/) for deployment, quality gates and troubleshooting
- `CLAUDE.md` for the rules Claude Code follows here, split into front-end and back-end guidance