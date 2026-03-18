import { SettingsScreen } from "@/components/settings-screen";
import { getSession } from "@/lib/session";

export default function SettingsPage() {
  const session = getSession();

  return <SettingsScreen session={session} />;
}
