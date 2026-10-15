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

export const EMAIL_REQUIRED_MESSAGE = 'Email is required';
export const PASSWORD_REQUIRED_MESSAGE = 'Password is required';
