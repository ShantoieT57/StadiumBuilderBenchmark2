# Journal — Sign-in and app shell

## Story 1: Sign in and land on your screen

- **Same-origin proxy.** It is a small Next.js route handler rather than next.config rewrites.
  - The real back-end address can be changed when the server starts.
  - A stopped back-end shows a clear "can't reach the app" message instead of a generic server error.
  - Checked against the running back-end: sign-in through the proxy sets the session cookie, and the signed-in pages see it.
- **Back-end unreachable on a signed-in page.** The person is sent to the sign-in screen. Trying to sign in then shows the connection-problem message.

## Story 2: Role-based menu and no-access screen

- **One access map.** The menu items each role sees come from one access map, `lib/auth/access.ts`. The server-side page check reads the same map, so a hidden item and a blocked screen can never disagree.
- **No-access screen.** When an Approver opens /upload directly, they stay on that address and see "You don't have access to this screen. Ask your administrator if you need it." inside the normal app frame.
- **Narrow screens.** Below tablet width, the menu folds into a menu button that opens a side panel with the same links. Escape closes the panel.

## Story 3: Shared success and problem messages

- **One way to show messages.** Success and problem messages now work the same way across the whole app.
  - Success messages close themselves after about 5 seconds.
  - Problem messages stay until the person closes them, or until the screen that raised them clears them once the problem is fixed.
  - Every message says what kind it is in words.
  - The close button shows a "Dismiss message" label on hover or keyboard focus.
- **Sign-in connection message.** The "can't reach the app" message still appears inside the sign-in card rather than as a pop-up, because moving it would have broken the sign-in checks.
- **Colour tokens.** Added two tokens, success (green) and warning (amber), with light and dark values, so messages no longer use hard-coded colours.

## Story 4: Sign out and being signed out

- **Signing out.** It ends the session everywhere, closes the live connection and takes you to the sign-in page with a "You have signed out" message. If sign-out fails, you stay signed in and are told so.
- **Session ended by the back-end.** If the back-end says your session has ended, on a request or through the live connection, the app sends you to sign-in with the matching reason:
  - An idle timeout shows a "60 minutes" inactivity message.
  - A sign-in elsewhere shows an "another device" message.
  - An ordinary signed-out visit shows nothing extra.
- **Live connection.** It reuses the existing /api proxy rather than a separate route. The proxy now marks event streams so they are never buffered or compressed. Checked against the real back-end: the retry line and the heartbeats arrive straight away.
