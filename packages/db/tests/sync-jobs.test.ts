import { describe, expect, it } from "vitest";
import { nextSyncRunAt } from "../src/sync-jobs";

describe("nextSyncRunAt", () => {
  it("keeps a daily schedule anchored to Asia/Taipei time", () => {
    expect(
      nextSyncRunAt(
        1440,
        "06:50",
        new Date("2026-07-17T00:05:00.000Z"),
        "2026-07-16T22:50:00.000Z",
      ),
    ).toBe("2026-07-17T22:50:00.000Z");
  });

  it("does not postpone an already-future anchored run after manual sync", () => {
    expect(
      nextSyncRunAt(
        1440,
        "06:50",
        new Date("2026-07-17T07:00:00.000Z"),
        "2026-07-17T22:50:00.000Z",
      ),
    ).toBe("2026-07-17T22:50:00.000Z");
  });

  it("uses rolling intervals for sub-daily schedules", () => {
    expect(
      nextSyncRunAt(360, "06:50", new Date("2026-07-17T00:00:00.000Z")),
    ).toBe("2026-07-17T06:00:00.000Z");
  });

  it("anchors weekly schedules to the selected Taipei weekday", () => {
    expect(
      nextSyncRunAt(
        10080,
        "06:50",
        new Date("2026-07-17T00:00:00.000Z"),
        undefined,
        1,
      ),
    ).toBe("2026-07-19T22:50:00.000Z");
  });
});
