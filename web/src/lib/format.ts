/** An ISO timestamp or epoch milliseconds. */
type When = string | number;

/** "12:53 PM" */
export const clock = (when: When) =>
  new Date(when).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** "Oct 10" */
export const shortDate = (when: When) =>
  new Date(when).toLocaleDateString([], { month: 'short', day: 'numeric' });

/** "Oct 10, 2026" */
export const longDate = (when: When) =>
  new Date(when).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' });

/** "Sat, Oct 10, 2026" */
export const longDay = (when: When) =>
  new Date(when).toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });

/** "Oct 10, 12:53 PM": no seconds. */
export const dateTime = (when: When) =>
  new Date(when).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
