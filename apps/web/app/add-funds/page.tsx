import { FlowPage } from "@/components/flow-page";
import { pageContent } from "@/lib/product";
import { getSession } from "@/lib/session";

export default function AddFundsPage() {
  const session = getSession();

  return (
    <FlowPage
      session={session}
      eyebrow={pageContent.addFunds.eyebrow}
      title={pageContent.addFunds.title}
      subtitle={pageContent.addFunds.subtitle}
      checklist={pageContent.addFunds.checklist}
    />
  );
}
