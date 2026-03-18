import { AppShell } from "@/components/app-shell";
import { type ProductSession } from "@/lib/product";

function statusLabel(index: number) {
  if (index === 0) return "live";
  if (index === 1) return "building";
  return "building";
}

export function FlowPage({
  session,
  eyebrow,
  title,
  subtitle,
  checklist,
}: {
  session: ProductSession | null;
  eyebrow: string;
  title: string;
  subtitle: string;
  checklist: readonly string[];
}) {
  return (
    <AppShell eyebrow={eyebrow} title={title} subtitle={subtitle} session={session}>
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2 className="panel-title">Current delivery slice</h2>
            <p className="panel-copy">
              This page marks the intended parity workstream for the feature. The next implementation step is to port
              the shared backend transaction model and wire the first real flow end to end.
            </p>
          </div>
        </div>

        <ul className="list">
          {checklist.map((item, index) => (
            <li key={item} className="list-item">
              <div>
                <strong>{item}</strong>
                <span>Tracked in `docs/TASK_BREAKDOWN.md`.</span>
              </div>
              <span className={`pill ${statusLabel(index)}`}>{statusLabel(index)}</span>
            </li>
          ))}
        </ul>
      </section>
    </AppShell>
  );
}
