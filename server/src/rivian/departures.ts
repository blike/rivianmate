import type { DepartureSchedule } from './types.js';

/** A departure schedule as Rivian's gateway schema defines it. */
interface RawDepartureSchedule {
  id?: string | null;
  name?: string | null;
  isEnabled?: boolean | null;
  /** Union `ScheduledOccurrence`; weekly repeats carry days and a start time. */
  occurrence?: { __typename?: string; days?: string[] | null; startsAtMin?: number | null } | null;
  departureSettings?: {
    comfortSettings?: {
      /** One level per seat and the wheel, e.g. `{ frontLeftSeat: 'Heat3' }`. */
      surfaceHeatVentLevels?: Record<string, string | null> | null;
      cabinTempCelsius?: number | null;
      frontDefogDefrost?: string | null;
    } | null;
  } | null;
}

/** Rivian's `vehicleDepartureSchedules` entries in our (API) shape. */
export function mapDepartureSchedules(raw: unknown): DepartureSchedule[] {
  if (!Array.isArray(raw)) return [];
  return (raw as (RawDepartureSchedule | null)[])
    .filter((s): s is RawDepartureSchedule => s != null && typeof s.id === 'string')
    .map((s) => {
      const comfort = s.departureSettings?.comfortSettings;
      return {
        id: s.id!,
        name: s.name ?? null,
        enabled: s.isEnabled ?? null,
        occurrence: s.occurrence
          ? {
              type: s.occurrence.__typename ?? 'RepeatsWeekly',
              weekDays: s.occurrence.days ?? null,
              timeOfDayMinutes: s.occurrence.startsAtMin ?? null,
            }
          : null,
        comfortSettings: comfort
          ? {
              surfaces: Object.fromEntries(
                Object.entries(comfort.surfaceHeatVentLevels ?? {}).filter(
                  (e): e is [string, string] => typeof e[1] === 'string' && e[0] !== '__typename',
                ),
              ),
              cabinClimateSetTemp: comfort.cabinTempCelsius ?? null,
              defrost: comfort.frontDefogDefrost ?? null,
            }
          : null,
      };
    });
}
