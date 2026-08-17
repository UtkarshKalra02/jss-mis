import { z } from "zod";

import { ROLES } from "@/auth/roles";
import { MIN_PASSWORD_LENGTH } from "@/lib/password";

/**
 * Usernames are lowercase, no spaces. They are typed at a login box by people
 * in a hurry, sometimes on a phone keyboard that likes to capitalise, so the
 * narrow character set is deliberate.
 */
export const usernameSchema = z
  .string()
  .trim()
  .min(2, "Username must be at least 2 characters.")
  .max(32, "Username must be 32 characters or fewer.")
  .regex(
    /^[a-z][a-z0-9._-]*$/,
    "Username must start with a lowercase letter and contain only lowercase letters, numbers, dot, underscore or hyphen.",
  );

export const createUserSchema = z.object({
  username: usernameSchema,
  name: z.string().trim().min(1, "Name is required.").max(120),
  email: z
    .union([z.string().trim().email("Enter a valid email address."), z.literal("")])
    .optional(),
  role: z.enum(ROLES),
});

export const updateUserSchema = z.object({
  name: z.string().trim().min(1, "Name is required.").max(120),
  email: z
    .union([z.string().trim().email("Enter a valid email address."), z.literal("")])
    .optional(),
  role: z.enum(ROLES),
});

export const setPasswordSchema = z
  .object({
    password: z.string().min(MIN_PASSWORD_LENGTH, `At least ${MIN_PASSWORD_LENGTH} characters.`),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: "Passwords do not match.",
    path: ["confirm"],
  });

export const changeOwnPasswordSchema = z
  .object({
    // Requiring the current password stops someone changing the credential on
    // an unattended, already-signed-in machine.
    currentPassword: z.string().min(1, "Enter your current password."),
    password: z.string().min(MIN_PASSWORD_LENGTH, `At least ${MIN_PASSWORD_LENGTH} characters.`),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: "Passwords do not match.",
    path: ["confirm"],
  });

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
