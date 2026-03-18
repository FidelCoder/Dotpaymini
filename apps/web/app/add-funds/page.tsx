import { QuoteWorkbench } from "@/components/quote-workbench";
import { getSession } from "@/lib/session";

export default function AddFundsPage() {
  const session = getSession();

  return <QuoteWorkbench session={session} variant="add-funds" />;
}
