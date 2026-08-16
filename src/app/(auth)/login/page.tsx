import type { Metadata } from "next";

import { LoginForm } from "@/components/auth/login-form";

export const metadata: Metadata = { title: "Sign in · JSS MIS" };

export default function LoginPage() {
  return (
    <main className="flex flex-1 items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8">
          <h1 className="page-title">JSS MIS</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            The Print Zone — order tracking
          </p>
        </div>

        <LoginForm />
      </div>
    </main>
  );
}
