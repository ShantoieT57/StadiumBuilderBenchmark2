import { Suspense } from 'react';

import { SignInForm } from '@/components/auth/SignInForm';
import { SignInReasonNotice } from '@/components/auth/SignInReasonNotice';

/** `/sign-in`: reachable while signed out. `?reason=` explains an ended session. */
export default function SignInPage() {
  return (
    <main className="bg-muted flex min-h-screen items-center justify-center px-4 py-8">
      <Suspense fallback={null}>
        <SignInReasonNotice />
      </Suspense>
      <SignInForm />
    </main>
  );
}
