import { SignInForm } from '@/components/auth/SignInForm';

/** `/sign-in`: reachable while signed out. */
export default function SignInPage() {
  return (
    <main className="bg-muted flex min-h-screen items-center justify-center px-4 py-8">
      <SignInForm />
    </main>
  );
}
