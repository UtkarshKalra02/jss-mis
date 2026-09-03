import { compare, hash } from "bcryptjs";

/**
 * Password rules, in one place so the CLI, the admin panel, and the
 * self-service screen cannot drift apart on what they accept.
 */

export const MIN_PASSWORD_LENGTH = 8;
export const BCRYPT_ROUNDS = 12;

/*
 * passwordProblem() removed — nothing called it.
 *
 * It re-implemented the minimum-length rule that `userSchema` and
 * `changeOwnPasswordSchema` already enforce through zod, using the constant
 * above. Two definitions of one rule is one too many: the moment they
 * disagree, which one fires depends on the path the password took, and this
 * file's own header says the point is that the CLI, the admin panel and the
 * self-service screen cannot drift apart.
 *
 * The "only spaces" half was never enforced anywhere and is not reinstated
 * here — an eight-character run of spaces is a weak password, not an invalid
 * one, and password strength is a separate decision from where the rule lives.
 */

export function hashPassword(password: string): Promise<string> {
  return hash(password, BCRYPT_ROUNDS);
}

export function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  return compare(password, storedHash);
}
