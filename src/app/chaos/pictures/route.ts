import { requirePermission } from "@/core/auth/guard";
import { UserError } from "@/core/action";
import { MAX_PICTURE_BYTES, stagePicture } from "@/modules/chaos/canva-jobs";

/**
 * The studio's picture table: one picture per request (so big photos don't hit the form's size
 * limit). Form fields: token, name (q3 / s3), file (none = take the picture off).
 */
export async function POST(req: Request) {
  await requirePermission("settings.manage");
  // Only from the studio page itself
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) return Response.json({ error: "Not allowed." }, { status: 403 });
  try {
    const fd = await req.formData();
    const token = String(fd.get("token") ?? "");
    const name = String(fd.get("name") ?? "");
    const file = fd.get("file");
    if (file instanceof File && file.size > 0) {
      if (file.size > MAX_PICTURE_BYTES) throw new UserError("The picture must be under 10 MB.");
      if (!/\.(jpe?g|png|webp)$/i.test(file.name)) throw new UserError("Use a .jpg, .png or .webp picture.");
      stagePicture(token, name, Buffer.from(await file.arrayBuffer()));
    } else stagePicture(token, name, null);
    return Response.json({ ok: true });
  } catch (e) {
    if (e instanceof UserError) return Response.json({ error: e.message }, { status: 400 });
    console.error("[chaos] staged picture", e);
    return Response.json({ error: "Couldn't save the picture. Try again." }, { status: 500 });
  }
}
