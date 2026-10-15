/**
 * User-facing sign-in wording, kept in one place so it can change (e.g. a named
 * administrator contact) without touching components.
 */

/** App name shown in the header, page titles and the sign-in card. */
export const APP_NAME = 'Transaction Import and Approval';

/** Who to ask about passwords and access. Generic until a named contact is supplied. */
export const ADMINISTRATOR_CONTACT = 'your administrator';

/** SI-04. */
export const FORGOTTEN_PASSWORD_MESSAGE = `Forgotten your password? Contact ${ADMINISTRATOR_CONTACT}.`;

/** SI-02 / BR5: shown for a wrong email or a wrong password, never saying which. */
export const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password';

/** SI-03: the back-end could not be reached. Clearly distinct from wrong credentials. */
export const CANNOT_REACH_APP_MESSAGE =
  "We can't reach the app right now. Check your connection and try again.";

/** Any other sign-in failure. */
export const SIGN_IN_FAILED_MESSAGE =
  'Something went wrong while signing you in. Please try again.';

/** AC-02 / R11: a signed-in person opened a screen their role does not allow. */
export const NO_ACCESS_TITLE = 'No access';
export const NO_ACCESS_MESSAGE = `You don't have access to this screen. Ask ${ADMINISTRATOR_CONTACT} if you need it.`;

export const EMAIL_REQUIRED_MESSAGE = 'Email is required';
export const PASSWORD_REQUIRED_MESSAGE = 'Password is required';

/** R8: shown on the sign-in screen after choosing Sign out. */
export const SIGNED_OUT_MESSAGE = 'You have signed out';

/** Sign-out could not be completed, so the person is still signed in. */
export const SIGN_OUT_FAILED_TITLE = 'Could not sign you out';
export const SIGN_OUT_FAILED_MESSAGE =
  "You're still signed in. Check your connection and try again.";

/** R6 / R7 (BR4): why the person was returned to the sign-in screen. */
export const SESSION_ENDED_TITLE = 'You were signed out';
export const SESSION_EXPIRED_MESSAGE =
  'You were inactive for 60 minutes, so we signed you out. Sign in again to continue.';
export const SIGNED_IN_ELSEWHERE_MESSAGE =
  'Your account was signed in on another device or browser, so we signed you out here.';

/**
 * The persistent problem message for a sign-in `?reason=`, or null for an
 * ordinary signed-out visit (`NotSignedIn`, `SignedOut`, none).
 */
export function sessionEndedMessage(reason: string | null): string | null {
  if (reason === 'SessionExpired') return SESSION_EXPIRED_MESSAGE;
  if (reason === 'SignedInElsewhere') return SIGNED_IN_ELSEWHERE_MESSAGE;
  return null;
}
