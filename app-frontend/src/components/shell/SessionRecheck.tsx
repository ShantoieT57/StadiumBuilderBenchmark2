'use client';

import { useEffect } from 'react';

import { getCurrentUser } from '@/lib/api/endpoints';
import { statusOf } from '@/lib/api/errors';
import { redirectToSignIn } from '@/lib/auth/signIn';
import type { APIError } from '@/types/api';

/**
 * Re-checks the session when a signed-in page is restored from the browser's
 * back/forward cache (`pageshow` with `persisted`), e.g. Back after signing
 * out. Only that restore triggers the check; nothing polls `/auth/me`.
 */
export function SessionRecheck() {
  useEffect(() => {
    const onPageShow = (event: PageTransitionEvent) => {
      if (!event.persisted) return;
      getCurrentUser().catch((error: unknown) => {
        if (statusOf(error) === 401) {
          redirectToSignIn((error as APIError).reason);
        }
      });
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  return null;
}
