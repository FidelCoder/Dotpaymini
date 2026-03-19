import { ReceiveScreen } from "@/components/receive-screen";
import { getSession } from "@/lib/session";

export default function ReceivePage() {
  const session = getSession();

  return <ReceiveScreen session={session} />;
}
