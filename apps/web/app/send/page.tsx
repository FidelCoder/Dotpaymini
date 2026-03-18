import { QuoteWorkbench } from "@/components/quote-workbench";
import { getSession } from "@/lib/session";

export default function SendPage() {
  const session = getSession();

  return <QuoteWorkbench session={session} variant="send" />;
}
