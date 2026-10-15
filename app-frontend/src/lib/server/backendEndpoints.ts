/**
 * The back-end operations the browser may reach through the same-origin `/api`
 * proxy — exactly the paths documented in `app-backend/docs/TransactionApi.yaml`.
 * SERVER ONLY. Anything not listed here (e.g. `/swagger`) is never forwarded.
 *
 * Each path is a Zod schema over the URL's path segments (relative to `/api`),
 * with ids validated as UUIDs. New back-end operations add a row.
 */
import { z } from 'zod';

export type ProxyMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface BackendEndpoint {
  methods: readonly ProxyMethod[];
  path: z.ZodType<readonly string[]>;
  /** Reachable without a session (signing in, signing out). */
  anonymous?: boolean;
}

const id = z.string().uuid();
const seg = <T extends string>(value: T) => z.literal(value);

export const BACKEND_ENDPOINTS: readonly BackendEndpoint[] = [
  {
    methods: ['POST'],
    path: z.tuple([seg('auth'), seg('sign-in')]),
    anonymous: true,
  },
  {
    methods: ['POST'],
    path: z.tuple([seg('auth'), seg('sign-out')]),
    anonymous: true,
  },
  { methods: ['GET'], path: z.tuple([seg('auth'), seg('me')]) },
  { methods: ['GET'], path: z.tuple([seg('dashboard'), seg('summary')]) },
  { methods: ['GET'], path: z.tuple([seg('events')]) },
  { methods: ['GET', 'POST'], path: z.tuple([seg('files')]) },
  { methods: ['GET'], path: z.tuple([seg('files'), id]) },
  { methods: ['GET'], path: z.tuple([seg('files'), id, seg('content')]) },
  {
    methods: ['GET', 'PATCH'],
    path: z.tuple([seg('files'), id, seg('invalid-rows')]),
  },
  { methods: ['POST'], path: z.tuple([seg('files'), id, seg('recheck')]) },
  { methods: ['POST'], path: z.tuple([seg('files'), id, seg('cancel')]) },
  { methods: ['GET'], path: z.tuple([seg('transactions')]) },
  { methods: ['GET'], path: z.tuple([seg('transactions'), seg('export')]) },
  {
    methods: ['GET'],
    path: z.tuple([seg('transactions'), seg('imported-count')]),
  },
  { methods: ['GET'], path: z.tuple([seg('transactions'), id]) },
  {
    methods: ['POST'],
    path: z.tuple([seg('transactions'), id, seg('approve')]),
  },
  {
    methods: ['POST'],
    path: z.tuple([seg('transactions'), id, seg('reject')]),
  },
];
