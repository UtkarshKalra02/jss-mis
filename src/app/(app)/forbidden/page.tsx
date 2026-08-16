import Link from "next/link";

import { currentUser } from "@/auth";
import { LANDING_ROUTE } from "@/auth/roles";
import { Button } from "@/components/ui/button";

export default async function ForbiddenPage() {
  const user = await currentUser();
  const home = user ? (LANDING_ROUTE[user.role] ?? "/dashboard") : "/login";

  return (
    <div className="max-w-prose">
      <h1 className="page-title">Not available for your role</h1>
      <p className="text-muted-foreground mt-2 text-sm">
        {user
          ? `Your account (${user.username}) has the ${user.role} role, which does not have access to that screen. If you think it should, ask an administrator.`
          : "You are not signed in."}
      </p>
      <Button asChild className="mt-6">
        <Link href={home}>Go back</Link>
      </Button>
    </div>
  );
}
