import { requireAccess } from "@/auth/guard";
import { buildTemplate } from "@/modules/imports/template";

/**
 * Serves the .xlsx template.
 *
 * A route rather than a server action because the response is a FILE — actions
 * return values to React, and streaming bytes through one to trigger a download
 * means base64 in a JSON payload for no gain.
 *
 * Guarded like every other screen: requireAccess redirects rather than throwing,
 * so an unauthorised request lands on /login rather than downloading anything.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  await requireAccess("import", "write");

  const bytes = await buildTemplate();

  return new Response(bytes, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="jss-import-template.xlsx"',
      // The example row and headings change with the code, so a cached copy
      // from three deploys ago is a file the parser may no longer accept.
      "Cache-Control": "no-store",
    },
  });
}
