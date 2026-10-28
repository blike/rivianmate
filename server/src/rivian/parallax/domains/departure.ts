/**
 * `departure.*`: departure (precondition) schedules, as a probe:
 * subscribed and archived, so its fields can be checked against legacy's
 * departure schedules before anything reads it. Field meanings are the
 * Rivian app's, not yet seen.
 */
import { defineRvm } from '../define.js';

export const departureSchedules = defineRvm({
  rvm: 'departure.schedule.schedule',
  group: 'core',
  maturity: 'probe',
  store: true,
  fieldNames: {
    '1.1': 'Schedule: id',
    '1.2': 'Schedule: name',
    '1.3': 'Schedule: on',
    '1.4.1.1': 'Schedule: Monday',
    '1.4.1.2': 'Schedule: Tuesday',
    '1.4.1.3': 'Schedule: Wednesday',
    '1.4.1.4': 'Schedule: Thursday',
    '1.4.1.5': 'Schedule: Friday',
    '1.4.1.6': 'Schedule: Saturday',
    '1.4.1.7': 'Schedule: Sunday',
    '1.4.2': 'Schedule: departs (minutes after midnight)',
    '1.5.1.1': 'Schedule: departs once (s since epoch)',
    '1.6.1.1': 'Schedule: cabin (°C)',
    '1.6.1.2': 'Schedule: defrost (1 defog, 2 defrost)',
    '1.6.2': 'Schedule: charge first, past the charging schedule',
    '2.1': 'Updated (s since epoch)',
  },
});

export const DEPARTURE_RVMS = [departureSchedules] as const;
