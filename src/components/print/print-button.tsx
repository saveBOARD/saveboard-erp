"use client";

import { Printer } from "lucide-react";

export function PrintButton() {
  return (
    <button type="button" onClick={() => window.print()} className="btn-primary">
      <Printer className="h-4 w-4" /> Print / Save as PDF
    </button>
  );
}
