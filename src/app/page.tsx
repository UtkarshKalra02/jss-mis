import { redirect } from "next/navigation";

import { currentUser } from "@/auth";
import { LANDING_ROUTE } from "@/auth/roles";

/**
 * Root sends each role to its own landing page. FLOOR goes straight to Stage
 * Update rather than a dashboard it cannot act on (see roles.ts).
 */
export default async function Home() {
  const user = await currentUser();
  if (!user) redirect("/login");
  redirect(LANDING_ROUTE[user.role] ?? "/dashboard");
}
