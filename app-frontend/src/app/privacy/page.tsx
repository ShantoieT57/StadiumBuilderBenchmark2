import type { Metadata } from 'next';
import Link from 'next/link';

import { ADMINISTRATOR_CONTACT, APP_NAME } from '@/lib/auth/messages';

export const metadata: Metadata = {
  title: `Privacy notice | ${APP_NAME}`,
};

/**
 * `/privacy`: static privacy notice (POPIA), reachable while signed out and
 * linked from the sign-in screen. Placeholder text approved at planning.
 */
export default function PrivacyPage() {
  return (
    <main className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8">
      <h1 className="text-2xl font-semibold">Privacy notice</h1>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Why we hold your information</h2>
        <p>
          {APP_NAME} is used to review and approve bank transactions. Personal
          information is used only for that purpose.
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">What we hold</h2>
        <ul className="list-disc pl-6">
          <li>Your name and email address, so you can sign in.</li>
          <li>
            The bank account details contained in the transactions you import
            and review.
          </li>
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-semibold">Access and deletion requests</h2>
        <p>
          To see the personal information held about you, or to ask for it to be
          corrected or deleted, contact {ADMINISTRATOR_CONTACT}. Requests cannot
          be made from within the app.
        </p>
      </section>

      <p>
        <Link
          href="/sign-in"
          className="text-primary underline underline-offset-4"
        >
          Back to sign in
        </Link>
      </p>
    </main>
  );
}
