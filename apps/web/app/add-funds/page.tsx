import { OnrampWorkbench } from "@/components/onramp-workbench";
import { getSession } from "@/lib/session";

export default function AddFundsPage() {
  const session = getSession();

  return <OnrampWorkbench session={session} />;
}
