/** `security.*`: the alarm, Gear Guard video and immobilizer; probes, nothing reads them yet. */
import { defineRvm } from '../define.js';

export const alarm = defineRvm({
  rvm: 'security.alarm.state',
  store: true,
  fieldNames: {
    '1': 'Alarm sounding (1 no, 2 yes, 3 no signal)',
    '2': 'Alarm disabled after repeats',
  },
});

export const gearGuardVideo = defineRvm({
  rvm: 'security.video_monitoring.state',
  store: true,
  fieldNames: {
    '1': 'Gear Guard video (1 disabled, 2 enabled, 3 recording, while locked, 4 faulted)',
    '2': 'Gear Guard video mode (1 everywhere, 2 away from home)',
    '3': 'Gear Guard video terms (1 not accepted, 2 accepted)',
  },
});

export const immobilizer = defineRvm({
  rvm: 'security.access.immobilizer_state',
  store: true,
  fieldNames: { '1': 'Immobilizer (1 not authorized, 2 authorized to drive)' },
});

export const SECURITY_RVMS = [alarm, gearGuardVideo, immobilizer] as const;
