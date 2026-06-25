import type { ReactNode } from "react";

export default function PagePurpose({
  icon,
  title,
  description,
  note,
  compact = false
}: {
  icon: ReactNode;
  title: string;
  description: string;
  note?: ReactNode;
  compact?: boolean;
}) {
  return (
    <section className={`page-purpose ${compact ? "compact" : ""}`} aria-label="Purpose of this page">
      <span className="page-purpose-icon">{icon}</span>
      <div>
        <span className="page-purpose-label">What this page is for</span>
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {note ? <div className="page-purpose-note">{note}</div> : null}
    </section>
  );
}
