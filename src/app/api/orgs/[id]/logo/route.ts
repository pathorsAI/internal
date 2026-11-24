import { serveOwnerAvatar } from "@/lib/owner-avatar-route";

export const dynamic = "force-dynamic";

/** 組織 logo（bucket 非公開）：只有該組織的成員拿得到，見 serveOwnerAvatar。 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return serveOwnerAvatar("org", (await params).id);
}
