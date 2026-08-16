import { requireAccess } from "@/auth/guard";
import { allowedResources } from "@/auth/roles";

/**
 * Placeholder. Real dashboard metrics arrive in Phase 3, once there is
 * dispatch data to compute OTD from.
 *
 * For now it prints what the role matrix grants, which is the quickest way to
 * confirm that a given login sees what section 2 says it should.
 */
export default async function DashboardPage() {
  const user = await requireAccess("dashboard");
  const resources = allowedResources(user.role);

  return (
    <div>
      <h1 className="page-title">Dashboard</h1>
      <p className="text-muted-foreground mt-1 text-sm">
        Signed in as {user.name} ({user.username}) · {user.role}
      </p>

      <div className="mt-8">
        <h2 className="text-sm font-medium">This role can reach</h2>
        <ul className="text-muted-foreground mt-2 space-y-1 text-sm">
          {resources.map((r) => (
            <li key={r}>{r.replace(/_/g, " ")}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
