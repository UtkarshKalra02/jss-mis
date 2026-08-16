"use server";

import { AuthError } from "next-auth";

import { signIn } from "@/auth";

export type LoginState = { error: string | null };

/**
 * One message for every failure mode — unknown user, wrong password, disabled
 * account, and never-set password all produce the same text. Telling the user
 * which one it was tells an attacker which usernames exist.
 *
 * "no password set yet" is a real state here (accounts are seeded without one,
 * decision A4), so the message points at the person who can fix it rather than
 * leaving someone stuck retyping a password that was never going to work.
 */
const GENERIC_FAILURE =
  "Incorrect username or password. If your account is new, ask Utkarsh to set your password.";

export async function loginAction(
  _prev: LoginState,
  formData: FormData,
): Promise<LoginState> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");

  if (!username || !password) {
    return { error: "Enter both username and password." };
  }

  try {
    // redirectTo is resolved by Auth.js, which throws a NEXT_REDIRECT that
    // must be allowed to propagate — hence the rethrow below.
    await signIn("credentials", { username, password, redirectTo: "/" });
    return { error: null };
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: GENERIC_FAILURE };
    }
    throw error;
  }
}
