import type { Metadata } from "next";
import Image from "next/image";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in · saveBOARD ERP" };

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-nav px-4">
      <div className="w-full max-w-sm rounded-lg bg-surface p-8 shadow-xl">
        <div className="mb-6">
          <Image src="/logo.png" alt="saveBOARD" width={900} height={272} priority className="h-14 w-auto" />
          <p className="mt-3 text-sm text-muted">ERP · Sign in with the username your admin gave you.</p>
        </div>
        <LoginForm />
      </div>
    </main>
  );
}
