import { describe, expect, it } from "vitest";
import { mapDepartureSchedules } from "./departures.js";
import { DEPARTURE_SCHEDULES_SUBSCRIPTION } from "./graphql.js";

describe("mapDepartureSchedules", () => {
  it("maps Rivian's schema onto our schedule shape", () => {
    expect(
      mapDepartureSchedules([
        {
          id: "s1",
          name: "Work",
          isEnabled: true,
          occurrence: { days: ["Monday", "Friday"], startsAtMin: 450, skippedOn: [] },
          departureSettings: {
            shouldOverrideChargeSchedule: false,
            comfortSettings: {
              surfaceHeatVentLevels: { frontLeftSeat: "Heat2", frontRightSeat: "Off" },
              cabinTempCelsius: 21.5,
              frontDefogDefrost: "Defrost",
            },
          },
        },
        null,
      ]),
    ).toEqual([
      {
        id: "s1",
        name: "Work",
        enabled: true,
        occurrence: { type: "RepeatsWeekly", weekDays: ["Monday", "Friday"], timeOfDayMinutes: 450 },
        comfortSettings: {
          seatFrontLeftHeat: "Heat2",
          seatFrontRightHeat: "Off",
          cabinClimateSetTemp: 21.5,
          defrost: "Defrost",
        },
      },
    ]);
    expect(mapDepartureSchedules(null)).toEqual([]);
  });

  // Rivian rejects unknown fields, which disables the subscription.
  it("queries the fields Rivian's schema defines", () => {
    expect(DEPARTURE_SCHEDULES_SUBSCRIPTION).toContain("isEnabled");
    // `occurrence` is a union (ScheduledOccurrence): fields need a fragment.
    expect(DEPARTURE_SCHEDULES_SUBSCRIPTION).toContain("... on RepeatsWeekly { days startsAtMin }");
    for (const stale of [" enabled ", "weekDays", "timeOfDayMinutes", "cabinClimateSetTemp"]) {
      expect(DEPARTURE_SCHEDULES_SUBSCRIPTION).not.toContain(stale);
    }
  });
});
