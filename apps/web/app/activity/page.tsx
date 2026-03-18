import { FlowPage } from "@/components/flow-page";
import { pageContent } from "@/lib/product";
import { getSession } from "@/lib/session";

export default function ActivityPage() {
  const session = getSession();

  return (
    <FlowPage
      session={session}
      eyebrow={pageContent.activity.eyebrow}
      title={pageContent.activity.title}
      subtitle={pageContent.activity.subtitle}
      checklist={pageContent.activity.checklist}
    />
  );
}
