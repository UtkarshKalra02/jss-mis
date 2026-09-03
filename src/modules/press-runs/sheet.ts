/**
 * Which sheet a job card is actually printing on.
 *
 * A job card carries its own paper, plate and machine. So does a press run,
 * since J15 — because a ganged run has ONE of each, entered once, shared by
 * every job on the plate.
 *
 * THE RULE, AND IT ONLY GOES ONE WAY: when a card is on a run, the RUN wins.
 * A ganged card's own paper and plate columns go dormant; they are not merged,
 * not preferred when the run's are blank, and not used as a fallback. Any of
 * those would produce two answers to "what is this printing on", and the wrong
 * one would always be whichever nobody updated — the failure I7 removed
 * `design.die_id` to avoid.
 *
 * A card that is NOT on a run is unaffected, which is almost all of them:
 * ganging is three to eight jobs a month (H1).
 *
 * ONE FUNCTION, used by the card screen, the card print, the run screen and
 * the run print. A second copy of this resolution is how the sheet somebody
 * reads stops matching the sheet somebody printed.
 */

export type SheetFields = {
  paperSize: string | null;
  paperGsm: string | null;
  paperFinish: string | null;
  sheetsPerReam: number | null;
  paperRemarks: string | null;
  plateJobId: string | null;
  paperSupplyBy: string | null;
  plateSupplyBy: string | null;
  machineName: string | null;
  machineSheetSize: string | null;
};

export type ResolvedSheet = SheetFields & {
  /** True when these values came from the run rather than the card itself. */
  fromRun: boolean;
  /** The run's number, when they did. */
  runNo: string | null;
};

export function resolvedSheet(
  card: SheetFields & { pressRunId: string | null },
  run: (SheetFields & { runNo: string }) | null,
): ResolvedSheet {
  if (card.pressRunId && run) {
    return {
      paperSize: run.paperSize,
      paperGsm: run.paperGsm,
      paperFinish: run.paperFinish,
      sheetsPerReam: run.sheetsPerReam,
      paperRemarks: run.paperRemarks,
      plateJobId: run.plateJobId,
      paperSupplyBy: run.paperSupplyBy,
      plateSupplyBy: run.plateSupplyBy,
      machineName: run.machineName,
      machineSheetSize: run.machineSheetSize,
      fromRun: true,
      runNo: run.runNo,
    };
  }

  return {
    paperSize: card.paperSize,
    paperGsm: card.paperGsm,
    paperFinish: card.paperFinish,
    sheetsPerReam: card.sheetsPerReam,
    paperRemarks: card.paperRemarks,
    plateJobId: card.plateJobId,
    paperSupplyBy: card.paperSupplyBy,
    plateSupplyBy: card.plateSupplyBy,
    machineName: card.machineName,
    machineSheetSize: card.machineSheetSize,
    fromRun: false,
    runNo: null,
  };
}
