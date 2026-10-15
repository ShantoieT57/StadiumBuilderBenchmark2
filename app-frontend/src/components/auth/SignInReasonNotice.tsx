'use client';

import { useEffect } from 'react';
import { useSearchParams } from 'next/navigation';

import { useToast } from '@/contexts/ToastContext';
import { SESSION_ENDED_TITLE, sessionEndedMessage } from '@/lib/auth/messages';

/**
 * Explains why the person is on the sign-in screen (R6 / R7, BR4): the
 * `?reason=` from a 401 or a `session-ended` event becomes a persistent
 * problem message. It is withdrawn when the person leaves the sign-in screen
 * (i.e. has signed in again). An ordinary signed-out visit shows nothing.
 */
export function SignInReasonNotice() {
  const reason = useSearchParams().get('reason');
  const { showToast, dismissToast } = useToast();

  useEffect(() => {
    const message = sessionEndedMessage(reason);
    if (!message) return;
    const id = showToast({
      variant: 'error',
      title: SESSION_ENDED_TITLE,
      message,
    });
    return () => dismissToast(id);
  }, [reason, showToast, dismissToast]);

  return null;
}
