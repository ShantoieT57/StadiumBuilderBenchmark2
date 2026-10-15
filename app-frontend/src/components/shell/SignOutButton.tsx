'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

import { Button } from '@/components/ui/button';
import { useEvents } from '@/contexts/EventsContext';
import { useToast } from '@/contexts/ToastContext';
import { signOut } from '@/lib/api/endpoints';
import { SIGN_IN_PATH } from '@/lib/auth/signIn';
import {
  SIGN_OUT_FAILED_MESSAGE,
  SIGN_OUT_FAILED_TITLE,
  SIGNED_OUT_MESSAGE,
} from '@/lib/auth/messages';

/**
 * The shell's Sign out control (R8 / BR6). Closes the live connection first
 * (so the back-end's own `session-ended` for this sign-out is not mistaken for
 * an ended session), ends the person's sessions on every device, and only
 * then returns to sign-in. If sign-out fails the person stays signed in, is
 * told so, and the live connection comes back.
 */
export function SignOutButton() {
  const router = useRouter();
  const { showToast } = useToast();
  const events = useEvents();
  const [signingOut, setSigningOut] = useState(false);

  const handleSignOut = async () => {
    setSigningOut(true);
    events.close();
    try {
      await signOut();
    } catch {
      events.reopen();
      setSigningOut(false);
      showToast({
        variant: 'error',
        title: SIGN_OUT_FAILED_TITLE,
        message: SIGN_OUT_FAILED_MESSAGE,
      });
      return;
    }

    showToast({ variant: 'success', title: SIGNED_OUT_MESSAGE });
    router.replace(SIGN_IN_PATH);
    // Drop every cached signed-in screen so Back cannot show one again.
    router.refresh();
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleSignOut}
      disabled={signingOut}
    >
      {signingOut ? 'Signing out…' : 'Sign out'}
    </Button>
  );
}
