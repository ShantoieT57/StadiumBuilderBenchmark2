/**
 * Mock identities for form-fill ONLY. Auth is mocked in every spec, so these are
 * never real accounts and the password is never checked. Never put real passwords here.
 */
import { seededUsers } from '../../src/mocks/data/identity';

const MOCK_PASSWORD = 'mock-password-not-real';

export const importerUser = {
  email: seededUsers.Importer.email,
  password: MOCK_PASSWORD,
};
export const approverUser = {
  email: seededUsers.Approver.email,
  password: MOCK_PASSWORD,
};
