type ProgressBarProps = {
  label: string;
  current: number;
  total: number;
};

export default function ProgressBar({ label, current, total }: ProgressBarProps) {
  const safeTotal = Math.max(total, 1);
  const percent = Math.min(100, Math.round((current / safeTotal) * 100));

  return (
    <div className="progress-card" role="status" aria-live="polite">
      <div className="progress-head">
        <strong>{label}</strong>
        <span>{percent}%</span>
      </div>
      <div className="progress-track" aria-hidden>
        <span style={{ width: `${percent}%` }} />
      </div>
      <span className="subtle">
        {current} of {total} complete
      </span>
    </div>
  );
}
