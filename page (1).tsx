import { redirect } from "next/navigation";
import ChatApp from "@/components/chat/ChatApp";
import { getCurrentUser } from "@/lib/auth";
import { toMe } from "@/lib/serialize";

export const metadata = { title: "الدردشات — Friend ID" };
export const dynamic = "force-dynamic";

export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const add = typeof sp.add === "string" && /^[A-Za-z0-9_.@-]{2,40}$/.test(sp.add) ? sp.add : undefined;
  // The session is restored server-side from the HttpOnly cookie on every load/refresh.
  const user = await getCurrentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(add ? `/chat?add=${add}` : "/chat")}`);
  return <ChatApp initialMe={toMe(user)} initialAdd={add} />;
}
