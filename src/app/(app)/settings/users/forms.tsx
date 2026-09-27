"use client";

import { useActionState, useState } from "react";
import { createUser, resetPassword } from "./actions";

function Message({ state }: { state: { ok?: string; error?: string } | undefined }) {
  if (!state) return null;
  return (
    <p role="status" className={state.error ? "text-sm text-bad" : "text-sm text-ok"}>
      {state.error ?? state.ok}
    </p>
  );
}

export function NewUserForm() {
  const [state, action, pending] = useActionState(createUser, undefined);
  return (
    <form action={action} className="grid gap-4 rounded border border-line bg-surface p-5">
      <h2 className="font-medium">Add a user</h2>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="grid gap-1 text-sm">
          Name
          <input id="new-displayName" name="displayName" required className="input" placeholder="e.g. Mark Atkinson" />
        </label>
        <label className="grid gap-1 text-sm">
          Username
          <input id="new-username" name="username" required className="input" placeholder="e.g. mark" autoComplete="off" />
        </label>
        <label className="grid gap-1 text-sm">
          Temporary password
          <input id="new-password" name="password" type="text" required minLength={10} className="input" autoComplete="new-password" />
        </label>
      </div>
      <div className="flex flex-wrap gap-6 text-sm">
        <span className="text-muted">Access:</span>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="entities" value="NZ" defaultChecked /> New Zealand
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="entities" value="AUS" defaultChecked /> Australia
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" name="isAdmin" /> Admin (can manage users)
        </label>
      </div>
      <div className="flex items-center gap-4">
        <button className="btn-primary" disabled={pending}>
          {pending ? "Adding…" : "Add user"}
        </button>
        <Message state={state} />
      </div>
    </form>
  );
}

export function ResetPasswordForm({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [state, action, pending] = useActionState(resetPassword, undefined);
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="btn-secondary text-xs">
        Reset password
      </button>
    );
  return (
    <form action={action} className="grid gap-1">
      <input type="hidden" name="userId" value={userId} />
      <div className="flex gap-1">
        <input
          id={`reset-${userId}`}
          name="password"
          type="text"
          minLength={10}
          required
          placeholder="New password"
          aria-label="New password"
          className="input w-40 py-1 text-xs"
          autoComplete="new-password"
        />
        <button className="btn-primary px-2 py-1 text-xs" disabled={pending}>
          Save
        </button>
      </div>
      <Message state={state} />
    </form>
  );
}
