'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';

import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { isNetworkError, statusOf } from '@/lib/api/errors';
import { signIn } from '@/lib/api/endpoints';
import { landingPathFor } from '@/lib/auth/landing';
import {
  APP_NAME,
  CANNOT_REACH_APP_MESSAGE,
  FORGOTTEN_PASSWORD_MESSAGE,
  INVALID_CREDENTIALS_MESSAGE,
  SIGN_IN_FAILED_MESSAGE,
} from '@/lib/auth/messages';
import { signInSchema, type SignInValues } from '@/lib/validation/signIn';

/** The message for a failed sign-in. Never includes what was typed (BR12). */
function signInFailureMessage(error: unknown): string {
  if (isNetworkError(error)) return CANNOT_REACH_APP_MESSAGE;
  if (statusOf(error) === 401) return INVALID_CREDENTIALS_MESSAGE;
  return SIGN_IN_FAILED_MESSAGE;
}

function RequiredMark() {
  return (
    <span aria-hidden="true" className="text-destructive">
      *
    </span>
  );
}

/**
 * The sign-in card (SI-01..SI-05): required email and password checked on
 * leaving a field and on submit (GN-04), the failure messages, the
 * forgotten-password guidance and the privacy-notice link.
 */
export function SignInForm() {
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  // Stays true once signed in: the form must not be re-submitted while the
  // landing page loads (a second sign-in would end the first session).
  const [signedIn, setSignedIn] = useState(false);

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SignInValues>({
    resolver: zodResolver(signInSchema),
    mode: 'onBlur',
    reValidateMode: 'onBlur',
    defaultValues: { email: '', password: '' },
  });

  const onSubmit = async (values: SignInValues) => {
    setFormError(null);
    try {
      const user = await signIn(values);
      setSignedIn(true);
      router.replace(landingPathFor(user.role));
    } catch (error) {
      setFormError(signInFailureMessage(error));
    }
  };

  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>
          <h1 className="text-2xl">Sign in</h1>
        </CardTitle>
        <CardDescription>{APP_NAME}</CardDescription>
      </CardHeader>

      <form noValidate onSubmit={handleSubmit(onSubmit)}>
        <CardContent className="flex flex-col gap-4">
          <p className="text-muted-foreground text-sm">
            Fields marked <RequiredMark /> are required.
          </p>

          {formError && (
            <Alert variant="destructive" className="border-destructive">
              <AlertDescription>{formError}</AlertDescription>
            </Alert>
          )}

          <div className="flex flex-col gap-2">
            <Label htmlFor="sign-in-email">
              Email <RequiredMark />
            </Label>
            <Input
              id="sign-in-email"
              type="email"
              autoComplete="username"
              required
              aria-invalid={errors.email ? true : undefined}
              aria-describedby={
                errors.email ? 'sign-in-email-error' : undefined
              }
              {...register('email')}
            />
            {errors.email && (
              <p
                id="sign-in-email-error"
                role="alert"
                className="text-destructive text-sm"
              >
                {errors.email.message}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="sign-in-password">
              Password <RequiredMark />
            </Label>
            <Input
              id="sign-in-password"
              type="password"
              autoComplete="current-password"
              required
              aria-invalid={errors.password ? true : undefined}
              aria-describedby={
                errors.password ? 'sign-in-password-error' : undefined
              }
              {...register('password')}
            />
            {errors.password && (
              <p
                id="sign-in-password-error"
                role="alert"
                className="text-destructive text-sm"
              >
                {errors.password.message}
              </p>
            )}
          </div>

          <Button
            type="submit"
            className="w-full"
            disabled={isSubmitting || signedIn}
          >
            {isSubmitting || signedIn ? 'Signing in…' : 'Sign in'}
          </Button>
        </CardContent>
      </form>

      <CardFooter className="flex flex-col items-start gap-2 text-sm">
        <p>{FORGOTTEN_PASSWORD_MESSAGE}</p>
        <Link
          href="/privacy"
          className="text-primary underline underline-offset-4"
        >
          Privacy notice
        </Link>
      </CardFooter>
    </Card>
  );
}
