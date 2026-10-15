# Journal — Sign-in and app shell

## Story 1: Sign in and land on your screen

- **Same-origin proxy.** It is a small Next.js route handler rather than next.config rewrites.
  - The real back-end address can be changed when the server starts.
  - A stopped back-end shows a clear "can't reach the app" message instead of a generic server error.
  - Checked against the running back-end: sign-in through the proxy sets the session cookie, and the signed-in pages see it.
- **Back-end unreachable on a signed-in page.** The person is sent to the sign-in screen. Trying to sign in then shows the connection-problem message.
