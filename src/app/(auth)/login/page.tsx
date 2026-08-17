import type { Metadata } from "next";

import { LoginForm } from "@/components/auth/login-form";
import { Logo } from "@/components/brand/logo";
import { ModeToggle } from "@/components/shell/mode-toggle";

export const metadata: Metadata = { title: "Sign in · JSS MIS" };

export default function LoginPage() {
  return (
    <main className="relative flex flex-1 items-center justify-center px-6 py-12">
      {/* Reachable before sign-in on purpose: somebody working a night shift
          should not have to log in to a white screen first. */}
      <div className="absolute top-3 right-3">
        <ModeToggle />
      </div>

      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <Logo size={40} />
          <div>
            <h1 className="page-title leading-none">JSS MIS</h1>
            <p className="text-muted-foreground mt-1.5 text-sm">
              The Print Zone — order tracking
            </p>
          </div>
        </div>

        <LoginForm />
      </div>
    </main>
  );
}
