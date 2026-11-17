/**
 * The bearer token for the signed-in session.
 *
 * It is held in module scope so that the `api()` helper in App.tsx can attach it
 * to every request without each of its call sites having to pass it down. That is
 * what keeps this login gate a handful of lines instead of a rewrite of the page.
 *
 * Deliberately NOT persisted. Nothing is written to localStorage or sessionStorage,
 * so a page refresh signs you out and the gate asks for the password again, and a
 * shared or borrowed browser is never left holding a live session. That is the
 * owner's choice for this proof-of-concept page (S6-1); the trade-off is that a
 * refresh mid-task means signing in again.
 */
let bearer: string | null = null;

/** Called by the gate after a successful sign-in, and with null to sign out. */
export function setAuthToken(token: string | null): void {
  bearer = token;
}

/** The Authorization header, or nothing at all when no one is signed in. */
export function authHeaders(): Record<string, string> {
  return bearer === null ? {} : { authorization: `Bearer ${bearer}` };
}
