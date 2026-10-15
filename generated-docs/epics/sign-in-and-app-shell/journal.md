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
