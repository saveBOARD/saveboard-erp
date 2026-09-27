"use client";

import { useActionState } from "react";
import { login } from "./actions";

export function LoginForm() {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <form action={action} className="grid gap-4">
      <label className="grid gap-1 text-sm font-medium text-ink">
        Username
        <input
          id="username"
          name="username"
          autoComplete="username"
          defaultValue={state?.username}
          required
          autoFocus
          className="input"
        />
      </label>
      <label className="grid gap-1 text-sm font-medium text-ink">
        Password
        <input id="password" name="password" type="password" autoComplete="current-password" required className="input" />
      </label>
      {state?.error && (
        <p role="alert" className="rounded bg-bad-soft px-3 py-2 text-sm text-bad">
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} className="btn-primary justify-center py-2">
        {pending ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}
