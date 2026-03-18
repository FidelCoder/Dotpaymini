import { ActivityScreen } from "@/components/activity-screen";
import { getSession } from "@/lib/session";

export default function ActivityPage() {
  const session = getSession();

  return <ActivityScreen session={session} />;
}
