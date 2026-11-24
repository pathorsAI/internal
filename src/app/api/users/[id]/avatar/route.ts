import { serveOwnerAvatar } from "@/lib/owner-avatar-route";

export const dynamic = "force-dynamic";

/** 使用者頭像（bucket 非公開）：本人或同組織的人拿得到，見 serveOwnerAvatar。 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return serveOwnerAvatar("user", (await params).id);
}
