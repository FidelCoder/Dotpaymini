import { HomeScreen } from "@/components/home-screen";
import { getSession } from "@/lib/session";

export default function HomePage() {
  const session = getSession();

  return <HomeScreen session={session} />;
}
