"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { assertEntityAccess, requireUser } from "@/lib/dal";
import { ENTITY_COOKIE } from "@/lib/session";

export async function switchEntity(formData: FormData) {
  const user = await requireUser();
  const entityId = String(formData.get("entity") ?? "");
  await assertEntityAccess(user.id, entityId);
  (await cookies()).set(ENTITY_COOKIE, entityId, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/", "layout");
}
