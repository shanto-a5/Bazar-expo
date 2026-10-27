/**
 * Auth error (M7-Q).
 *
 * Lives in its own module so local and remote auth throw the *same class*. Screens
 * branch on `error instanceof AuthError` to attach a message to a specific input
 * (see app/(home)/account.tsx), so a second error class would silently stop those
 * messages from rendering in remote mode.
 */
export class AuthError extends Error {
  constructor(message: string, readonly field?: string) {
    super(message);
    this.name = 'AuthError';
  }
}
