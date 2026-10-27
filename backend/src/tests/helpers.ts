/**
 * Small shared helpers for suites that work against a repository bundle directly
 * rather than over HTTP.
 */
import * as bcrypt from 'bcryptjs';
import type { RepositoryBundle } from '../repositories/contracts';

/** True when the stored hash matches the password, using the production code path. */
export async function signInWith(repos: RepositoryBundle, email: string, password: string): Promise<boolean> {
  const user = await repos.users.findByEmail(email);
  if (!user) return false;
  return bcrypt.compare(password, user.passwordHash);
}
