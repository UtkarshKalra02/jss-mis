import { describe, expect, it } from "vitest";

import { issuePresetFromCard } from "@/modules/materials/issue-preset";

const card = {
  id: "card-1",
  jcNo: "JC-2026-0001",
  itemName: "Nicobar carry bag",
  materialId: "mat-1",
  paperQty: 5,
  paperBundle: "Packet",
  paperParts: 4,
};

/**
 * The store deducts parent sheets, not the pieces they are cut into. A card
 * that says five packets, cut in four, sends 500 sheets to the floor; the
 * 2,000 press sheets exist only after the cutter, and never in the store.
 */
describe("issuing from a job card deducts parent sheets", () => {
  it("pre-fills the parent-sheet count, ignoring parts", () => {
    expect(issuePresetFromCard(card).qty).toBe("500");
    expect(issuePresetFromCard({ ...card, paperParts: null }).qty).toBe("500");
    expect(issuePresetFromCard({ ...card, paperParts: 1 }).qty).toBe("500");
  });

  it("leaves the quantity blank when the card has no paper figure", () => {
    expect(issuePresetFromCard({ ...card, paperQty: null }).qty).toBeUndefined();
    expect(issuePresetFromCard({ ...card, paperBundle: null }).qty).toBeUndefined();
  });

  it("names the card, the job and the paper so the job's own batch is offered first", () => {
    const p = issuePresetFromCard({ ...card, materialId: null }, "fallback-mat");
    expect(p).toMatchObject({
      materialId: "fallback-mat",
      jobCardId: "card-1",
      jcNo: "JC-2026-0001",
      jobRef: "Nicobar carry bag",
      department: "Offset Printing",
    });
  });
});
