"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ProductSession } from "@/lib/product";
import type { ReactNode } from "react";

const tabs = [
  { href: "/", icon: "◉", label: "Home" },
  { href: "/send", icon: "↑", label: "Send" },
  { href: "/pay", icon: "◎", label: "Pay" },
  { href: "/activity", icon: "≣", label: "Activity" },
  { href: "/settings", icon: "⚙", label: "Settings" },
];

function initials(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return "DP";
  return trimmed.slice(0, 2).toUpperCase();
}

export function AppShell({
  eyebrow,
  title,
  subtitle,
  session,
  children,
}: {
  eyebrow: string;
  title: string;
  subtitle: string;
  session: ProductSession | null;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const activeName = session?.userProfile?.username || session?.userProfile?.worldUsername || session?.username || "Guest";

  return (
    <main className="shell">
      <div className="frame stack">
        <section className="topbar">
          <div className="hero-glow">
            <p className="eyebrow">{eyebrow}</p>
            <h1 className="title">{title}</h1>
            <p className="subtitle">{subtitle}</p>
          </div>
          <div className="badge">
            <span>Mode</span>
            <strong>Foundation</strong>
          </div>
        </section>

        {session ? (
          <section className="panel">
            <div className="user-card">
              <div className="avatar">{initials(activeName)}</div>
              <div className="user-meta">
                <strong>@{activeName}</strong>
                <span>
                  {session.userProfile?.dotpayId
                    ? `${session.userProfile.dotpayId} is synced with the backend profile store.`
                    : "Wallet Auth session is active and verified locally."}
                </span>
              </div>
            </div>
          </section>
        ) : null}

        {children}
      </div>

      <nav className="tabbar" aria-label="Primary">
        {tabs.map((tab) => {
          const isActive = pathname === tab.href;
          return (
            <Link key={tab.href} href={tab.href} className={`tab${isActive ? " active" : ""}`}>
              <span>{tab.icon}</span>
              <span>{tab.label}</span>
            </Link>
          );
        })}
      </nav>
    </main>
  );
}
