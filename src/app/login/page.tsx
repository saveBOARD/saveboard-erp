import type { Metadata } from "next";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in · saveBOARD ERP" };

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-nav px-4">
      <div className="w-full max-w-sm rounded-lg bg-surface p-8 shadow-xl">
        <div className="mb-6">
          <div className="text-2xl font-bold tracking-tight text-ink">
            save<span className="text-brand">BOARD</span> ERP
          </div>
          <p className="mt-1 text-sm text-muted">Sign in with the username your admin gave you.</p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
