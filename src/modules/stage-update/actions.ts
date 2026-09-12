"use server";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";

import { requireAccess } from "@/auth/guard";
import { db } from "@/db";
import { auditedAppend, type Actor } from "@/db/audit";
import { stage, stageEvent } from "@/db/schema";
import { vPoItemStatus } from "@/db/views";
import { actionError } from "@/lib/action-error";

import { describeMoves, pairMoves } from "./moves";

export type FormState = { ok: boolean; error: string | null; message?: string };

const ok = (message?: string): FormState => ({ ok: true, error: null, message });
const fail = (error: string): FormState => ({ ok: false, error });

/** Spec 6.7: PLANNER on a laptop, FLOOR on a phone. */
async function requireStageWriter(): Promise<Actor> {
  const user = await requireAccess("stage_update", "write");
  return { id: user.id, role: user.role };
}

const schema = z.object({
  moves: z
    .array(z.object({ poItemId: z.uuid(), stageCode: z.string().min(1) }))
    .min(1, "Choose at least one item."),
  remarks: z
    .string()
    .trim()
    .transform((v) => (v.length === 0 ? undefined : v))
    .optional(),
  /**
   * When it actually happened on the floor, not when it was typed. Optional:
   * the phone view deliberately does not ask (spec 6.7 — "single stage
   * dropdown, nothing else"), and defaults to now.
   */
  eventAt: z
    .string()
    .trim()
    .transform((v) => (v.length === 0 ? undefined : v))
    .optional(),
});

/**
 * Moves one or more items, each to its own stage (K22).
 *
 * The single-row action and the bulk action are the same function, because
 * they are the same operation: spec 6.7 asks for "row action → set new stage"
 * and "bulk select → set same stage for many rows", and writing those as two
 * code paths is how they drift into disagreeing about backward moves or
 * remarks. The form sends (item, stage) pairs; "the same stage for many rows"
 * is simply many pairs with the same stage, and the phone card is one pair.
 * The time and the remarks are shared across the batch — one "here is what
 * happened", not a timestamp per row.
 *
 * Every event is appended through the audit wrapper (F1), so a stage change is
 * logged like every other write and an OWNER cannot make one. All of them
 * commit or none do: a bulk update that half-applied would leave Preeti
 * guessing which rows took.
 *
 * NOTHING VALIDATES THE DIRECTION OF THE MOVE. Backward moves are allowed
 * deliberately (F4) — rework is real — and the confirmation lives at the
 * screen, where the person can see what they are about to do. Enforcing it
 * here would make rework impossible rather than deliberate.
 */
export async function updateStageAction(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  try {
    const actor = await requireStageWriter();

    const paired = pairMoves(
      formData.getAll("poItemId").map(String),
      formData.getAll("stageCode").map(String),
    );
    if (!paired.ok) return fail(paired.error);

    const parsed = schema.safeParse({
      moves: paired.moves,
      remarks: formData.get("remarks"),
      eventAt: formData.get("eventAt"),
    });
    if (!parsed.success) return fail(parsed.error.issues[0]!.message);
    const v = parsed.data;

    // A datetime-local value has no timezone. It is typed by somebody standing
    // in the factory, so it means IST (C10) — parsing it as the server's local
    // time would silently shift every batch entry.
    const eventAt = v.eventAt ? new Date(`${v.eventAt}:00+05:30`) : new Date();
    if (Number.isNaN(eventAt.getTime())) return fail("That is not a valid date and time.");

    // Every target is checked before anything is written, so one bad code
    // refuses the batch rather than writing the rest and reporting a mystery.
    const wanted = [...new Set(v.moves.map((m) => m.stageCode))];
    const targets = await db
      .select({ code: stage.code, name: stage.name })
      .from(stage)
      .where(and(inArray(stage.code, wanted), isNull(stage.deletedAt)));
    const nameOf = new Map(targets.map((t) => [t.code, t.name]));
    const unknown = wanted.find((code) => !nameOf.has(code));
    if (unknown) return fail(`"${unknown}" is not a stage.`);

    const written = await db.transaction(async (tx) => {
      // Only items that are actually live get an event. A row the person had
      // on screen may have been cancelled or completed since it loaded, and
      // appending to it would be recording work on a dead item.
      const live = await tx
        .select({ poItemId: vPoItemStatus.poItemId })
        .from(vPoItemStatus)
        .where(
          and(
            inArray(
              vPoItemStatus.poItemId,
              v.moves.map((m) => m.poItemId),
            ),
            eq(vPoItemStatus.status, "Open"),
          ),
        );
      const isLive = new Set(live.map((l) => l.poItemId));

      const done: { stageName: string }[] = [];
      for (const move of v.moves) {
        if (!isLive.has(move.poItemId)) continue;
        await auditedAppend(
          actor,
          stageEvent,
          {
            poItemId: move.poItemId,
            stageCode: move.stageCode,
            eventAt,
            remarks: v.remarks ?? null,
          },
          tx,
        );
        done.push({ stageName: nameOf.get(move.stageCode)! });
      }

      return done;
    });

    revalidatePath("/stage-update");
    revalidatePath("/items");

    if (written.length === 0) {
      return fail("Nothing was updated — those items are no longer open.");
    }

    return ok(describeMoves(written, v.moves.length - written.length));
  } catch (error) {
    unstable_rethrow(error);
    return fail(actionError(error, "Could not update the stage."));
  }
}
