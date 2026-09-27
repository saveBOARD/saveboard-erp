"use client";

import { useActionState } from "react";
import { changePassword } from "./actions";

export function ChangePasswordForm() {
  const [state, action, pending] = useActionState(changePassword, undefined);
  return (
    <form action={action} className="grid gap-3">
      <label className="grid gap-1 text-sm">
        Current password
        <input id="current" name="current" type="password" required className="input" autoComplete="current-password" />
      </label>
      <label className="grid gap-1 text-sm">
        New password (10+ characters)
        <input id="next" name="next" type="password" required minLength={10} className="input" autoComplete="new-password" />
      </label>
      <label className="grid gap-1 text-sm">
        Repeat new password
        <input id="repeat" name="repeat" type="password" required minLength={10} className="input" autoComplete="new-password" />
      </label>
      {state && <p role="status" className={state.error ? "text-sm text-bad" : "text-sm text-ok"}>{state.error ?? state.ok}</p>}
      <button className="btn-primary justify-center" disabled={pending}>
        {pending ? "Saving…" : "Change password"}
      </button>
    </form>
  );
}
