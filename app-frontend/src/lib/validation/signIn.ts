import { z } from 'zod';

import {
  EMAIL_REQUIRED_MESSAGE,
  PASSWORD_REQUIRED_MESSAGE,
} from '@/lib/auth/messages';

/**
 * Sign-in form (SI-01): both fields required. No format or strength rules here:
 * the back-end decides whether the credentials are valid (SI-02).
 */
export const signInSchema = z.object({
  email: z.string().trim().min(1, EMAIL_REQUIRED_MESSAGE),
  password: z.string().min(1, PASSWORD_REQUIRED_MESSAGE),
});

export type SignInValues = z.infer<typeof signInSchema>;
