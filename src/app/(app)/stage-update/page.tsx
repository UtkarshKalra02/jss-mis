import { requireAccess } from "@/auth/guard";

/**
 * Placeholder. The real screen is Phase 2 — it needs stage events, which need
 * PO items.
 *
 * It exists now because it is FLOOR's landing route: Ajay has no dashboard, so
 * without this his sign-in has nowhere to go.
 */
export default async function StageUpdatePage() {
  const user = await requireAccess("stage_update", "write");

  return (
    <div>
      <h1 className="page-title">Stage Update</h1>
      <p className="text-muted-foreground mt-1 text-sm">
        Signed in as {user.name} · {user.role}
      </p>
      <p className="text-muted-foreground mt-8 text-sm">
        This screen is built in Phase 2, once PO items exist to move through stages.
      </p>
    </div>
  );
}
