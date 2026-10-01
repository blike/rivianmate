/**
 * App password policy, shared by the API and the web UI (keep this file free
 * of Node-only imports).
 *
 * Follows NIST SP 800-63B: favour length, reject guessable passwords, and
 * skip composition rules ("one uppercase, one symbol…"), which push people
 * toward predictable patterns like "Password1!".
 */

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

/** Characters that must remain once guessable parts are removed. */
const MIN_UNGUESSABLE_LENGTH = 8;
const MIN_DISTINCT_CHARS = 5;

/** Common passwords and app-specific words, matched case-insensitively. */
const WEAK_WORDS = [
  "rivianmate",
  "rivian",
  "r1t",
  "r1s",
  "password",
  "passw0rd",
  "p@ssw0rd",
  "p@ssword",
  "letmein",
  "welcome",
  "admin",
  "administrator",
  "changeme",
  "iloveyou",
  "trustno1",
  "monkey",
  "dragon",
  "football",
  "baseball",
  "sunshine",
  "princess",
  "superman",
  "batman",
  "master",
  "secret",
  "login",
  "qwerty",
  "azerty",
].sort((a, b) => b.length - a.length);

/** Runs of 4+ consecutive characters from these count as sequences. */
const SEQUENCES = [
  "abcdefghijklmnopqrstuvwxyz",
  "01234567890",
  "qwertyuiop",
  "asdfghjkl",
  "zxcvbnm",
];
const MIN_SEQUENCE_RUN = 4;

function isSequence(run: string): boolean {
  const reversed = [...run].reverse().join("");
  return SEQUENCES.some((seq) => seq.includes(run) || seq.includes(reversed));
}

/** Removes sequences like "1234", "abcd", "qwer" and runs like "aaaa". */
function stripSequences(text: string): string {
  let out = "";
  let i = 0;
  while (i < text.length) {
    let end = i + 1;
    // Repeated character runs ("aaaa", "1111").
    while (end < text.length && text[end] === text[i]) end++;
    if (end - i >= MIN_SEQUENCE_RUN) {
      i = end;
      continue;
    }
    // Longest ascending/descending or keyboard-row run starting at i.
    end = i + MIN_SEQUENCE_RUN;
    if (end <= text.length && isSequence(text.slice(i, end))) {
      while (end < text.length && isSequence(text.slice(i, end + 1))) end++;
      i = end;
      continue;
    }
    out += text[i];
    i++;
  }
  return out;
}

/** The part of a password left after removing common words and patterns. */
export function unguessablePart(password: string): string {
  let rest = password.toLowerCase();
  for (const word of WEAK_WORDS) rest = rest.split(word).join("");
  return stripSequences(rest);
}

/**
 * Why `password` is unacceptable as a new app password, or null if it's fine.
 * Messages are written to be shown directly to the user.
 */
export function passwordProblem(password: string): string | null {
  const length = [...password].length;
  if (length < PASSWORD_MIN_LENGTH) {
    return `Use at least ${PASSWORD_MIN_LENGTH} characters`;
  }
  if (length > PASSWORD_MAX_LENGTH) {
    return `Use at most ${PASSWORD_MAX_LENGTH} characters`;
  }
  if (new Set(password.toLowerCase()).size < MIN_DISTINCT_CHARS) {
    return "Use a wider mix of characters";
  }
  if ([...unguessablePart(password)].length < MIN_UNGUESSABLE_LENGTH) {
    return "Too easy to guess. Avoid common words, the app name, and patterns like 1234 or qwerty";
  }
  return null;
}
