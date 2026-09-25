import { config } from "dotenv";
config({ path: ".env.local" });
process.env.AUTH_SECRET ??= "unused-by-probe";
const { db } = await import("@/db");
const { sql } = await import("drizzle-orm");
const q = async (label: string, s: never) => {
  const r: any = await db.execute(s);
  console.log("\n== " + label + "\n" + JSON.stringify(r.rows ?? r).slice(0, 1000));
};
await q("totals", sql`
  select count(*)::int total,
         count(design_id)::int with_design,
         count(*) filter (where job_type = 'Repeat')::int repeats
  from po_item where deleted_at is null` as never);
await q("designs with >1 open item", sql`
  select d.design_code, d.job_name, count(*)::int items
  from po_item i join design d on d.id = i.design_id
  where i.deleted_at is null and i.status = 'Open'
  group by 1,2 having count(*) > 1 order by 3 desc limit 8` as never);
await q("client+item_name with >1 open item", sql`
  select c.name, i.item_name, count(*)::int items, sum(i.ordered_qty)::int qty
  from po_item i
  join purchase_order po on po.id = i.purchase_order_id
  join client c on c.id = po.client_id
  where i.deleted_at is null and i.status = 'Open'
  group by 1,2 having count(*) > 1 order by 3 desc limit 8` as never);
process.exit(0);
