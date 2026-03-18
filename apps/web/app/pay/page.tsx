import { FlowPage } from "@/components/flow-page";
import { pageContent } from "@/lib/product";
import { getSession } from "@/lib/session";

export default function PayPage() {
  const session = getSession();

  return (
    <FlowPage
      session={session}
      eyebrow={pageContent.pay.eyebrow}
      title={pageContent.pay.title}
      subtitle={pageContent.pay.subtitle}
      checklist={pageContent.pay.checklist}
    />
  );
}
