import { FlowPage } from "@/components/flow-page";
import { pageContent } from "@/lib/product";
import { getSession } from "@/lib/session";

export default function SendPage() {
  const session = getSession();

  return (
    <FlowPage
      session={session}
      eyebrow={pageContent.send.eyebrow}
      title={pageContent.send.title}
      subtitle={pageContent.send.subtitle}
      checklist={pageContent.send.checklist}
    />
  );
}
