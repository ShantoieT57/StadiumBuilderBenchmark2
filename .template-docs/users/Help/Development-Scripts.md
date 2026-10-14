# Running Your App

Run each command from the project root in a subshell — `(cd app-frontend && npm run <script>)`. Your app lives in the `app-frontend` folder, so the `(cd app-frontend && … )` wrapper runs the command there and returns your terminal to the project root afterwards. (Running tests any other way — e.g. `npm --prefix app-frontend test` — can crash the test runner on some setups (Windows with Node 24), reporting "no tests found".)

---

## Starting the App

### Start the app in development mode

```bash
(cd app-frontend && npm run dev)
```

Opens at http://localhost:3000. Changes to your files take effect immediately — no restart needed.

---

### Prepare your app for deployment

```bash
(cd app-frontend && npm run build)
```

Checks your app for errors and prepares it for deployment. Output goes to `app-frontend/.next/`. Run this before deploying to a hosting platform like Vercel or Netlify.

---

### Run the deployed version locally

```bash
(cd app-frontend && npm run build)
(cd app-frontend && npm run start)
```

Lets you test the deployment-ready version of your app on your own machine before publishing it.

---

## Code Quality

Use Claude Code to run all checks at once:

```
/quality-check
```

---

## Testing

### Run all tests

```bash
(cd app-frontend && npm test)
```

### Run tests and see a coverage report

```bash
(cd app-frontend && npm run test:coverage)
```

### Run a single test file

```bash
(cd app-frontend && npm test -- path/to/file.test.tsx)
```

---

**Need help?** Ask Claude Code about any command or workflow.
