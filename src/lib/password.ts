import { compare, hash } from "bcryptjs";

/**
 * Password rules, in one place so the CLI, the admin panel, and the
 * self-service screen cannot drift apart on what they accept.
 */

export const MIN_PASSWORD_LENGTH = 8;
export const BCRYPT_ROUNDS = 12;

export function passwordProblem(password: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`;
  }
  if (password.trim().length === 0) {
    return "Password cannot be only spaces.";
  }
  return null;
}

export function hashPassword(password: string): Promise<string> {
  return hash(password, BCRYPT_ROUNDS);
}

export function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  return compare(password, storedHash);
}
