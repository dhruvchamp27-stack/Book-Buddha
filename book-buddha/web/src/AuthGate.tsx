import { useCallback, useEffect, useState, type FormEvent, type ReactElement, type ReactNode } from "react";
import { setAuthToken } from "./session.js";

/**
 * The sign-in gate for the proof-of-concept page.
 *
 * The API now refuses every financial route without a session, so this page could
 * not load a single one of its fourteen endpoints without it. The gate asks
 * `GET /auth/status` which way to go: an unconfigured database gets a
 * create-password form posting to `/auth/setup`, an configured one gets a sign-in
 * form posting to `/auth/login`. The token goes into `session.ts`, where the
 * `api()` helper in App.tsx picks it up.
 *
 * Deliberately small and self-contained, so that it can be deleted in one piece
 * when the real UI arrives rather than unpicked from the page.
 */

interface AuthStatus {
  configured: boolean;
  locked: boolean;
  lockedUntil?: string;
}

/**
 * Mirrors `passwordPolicyProblem` in src/auth/password.ts. It is restated here
 * rather than imported because that module imports node:crypto, which must not be
 * pulled into the browser bundle. This text is only a hint — the server stays the
 * single enforcer, and its own message is what gets shown when a password is
 * refused, so the two cannot disagree in front of the user.
 */
const POLICY_HINT = "At least 8 characters, including a letter and a number.";

type Phase = "checking" | "setup" | "login" | "ready";

async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}

export function AuthGate({ children }: { children: ReactNode }): ReactElement {
  const [phase, setPhase] = useState<Phase>("checking");
  const [lockedUntil, setLockedUntil] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const check = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch("/api/auth/status");
      if (!response.ok) {
        setError(await readError(response, "Book Buddha is not responding."));
        return;
      }
      const status = (await response.json()) as AuthStatus;
      setLockedUntil(status.locked ? (status.lockedUntil ?? null) : null);
      setPhase(status.configured ? "login" : "setup");
    } catch {
      // The API is a separate local process; it may simply not be running yet.
      setError("Could not reach Book Buddha. Is the API running on port 3000?");
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  const submit = useCallback(
    async (event: FormEvent): Promise<void> => {
      event.preventDefault();
      setBusy(true);
      setError(null);
      try {
        if (phase === "setup") {
          if (password !== confirmPassword) {
            setError("The two passwords do not match.");
            return;
          }
          const created = await fetch("/api/auth/setup", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ password }),
          });
          if (!created.ok) {
            setError(await readError(created, "Could not create the administrator."));
            return;
          }
        }

        const signedIn = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ password }),
        });
        if (!signedIn.ok) {
          setError(await readError(signedIn, "Sign in failed."));
          // A wrong password may have just locked the account; re-read the status
          // so the lock and its expiry are shown rather than a bare refusal.
          await check();
          return;
        }
        const body = (await signedIn.json()) as { token?: string };
        if (body.token === undefined) {
          setError("Book Buddha did not return a session token.");
          return;
        }
        setAuthToken(body.token);
        setPassword("");
        setConfirmPassword("");
        setPhase("ready");
      } catch {
        setError("Could not reach Book Buddha. Is the API running on port 3000?");
      } finally {
        setBusy(false);
      }
    },
    [phase, password, confirmPassword, check],
  );

  if (phase === "ready") return <>{children}</>;

  const isSetup = phase === "setup";
  return (
    <main className="shell">
      <header className="header">
        <div>
          <p className="eyebrow">Offline-first accounting</p>
          <h1>Book Buddha</h1>
        </div>
      </header>
      <section className="card">
        {phase === "checking" && error === null ? (
          <p className="muted">Checking this workspace…</p>
        ) : (
          <>
            <p className="eyebrow">{isSetup ? "First run" : "Sign in"}</p>
            <h3>{isSetup ? "Choose a password for this workspace" : "Enter your password"}</h3>
            {isSetup ? (
              <p className="muted">
                No one has set this database up yet. The password you choose here becomes the
                administrator password. {POLICY_HINT}
              </p>
            ) : (
              <p className="muted">This workspace is protected. Your books stay on this PC.</p>
            )}
            {lockedUntil !== null && (
              <p className="danger">
                Too many wrong attempts. Locked until {new Date(lockedUntil).toLocaleTimeString()}.
              </p>
            )}
            <form className="form" onSubmit={(event) => void submit(event)}>
              <div className="form-row">
                <label>
                  Password
                  <input
                    type="password"
                    value={password}
                    autoComplete={isSetup ? "new-password" : "current-password"}
                    onChange={(event) => setPassword(event.target.value)}
                    disabled={busy || phase === "checking"}
                  />
                </label>
                {isSetup && (
                  <label>
                    Confirm password
                    <input
                      type="password"
                      value={confirmPassword}
                      autoComplete="new-password"
                      onChange={(event) => setConfirmPassword(event.target.value)}
                      disabled={busy}
                    />
                  </label>
                )}
              </div>
              {error !== null && <p className="danger">{error}</p>}
              <button className="primary" disabled={busy || password === ""}>
                {busy ? "Working…" : isSetup ? "Create and sign in" : "Sign in"}
              </button>
            </form>
            {phase === "checking" && (
              <button onClick={() => void check()} disabled={busy}>
                Try again
              </button>
            )}
          </>
        )}
      </section>
    </main>
  );
}
