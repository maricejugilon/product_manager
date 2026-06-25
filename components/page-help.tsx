"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import { CheckCircle2, HelpCircle, X } from "lucide-react";

type HelpStep = {
  title: string;
  description: string;
};

type HelpTerm = {
  term: string;
  description: string;
};

export default function PageHelp({
  title,
  intro,
  steps,
  terms = [],
  termsTitle = "What you will see",
  safety,
  buttonLabel = "Help",
  className = ""
}: {
  title: string;
  intro: string;
  steps: HelpStep[];
  terms?: HelpTerm[];
  termsTitle?: string;
  safety: ReactNode;
  buttonLabel?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const titleId = useId();

  useEffect(() => {
    if (!open) {
      return;
    }

    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open]);

  return (
    <>
      <button
        className={`button secondary ${className}`.trim()}
        type="button"
        onClick={() => setOpen(true)}
      >
        <HelpCircle size={16} />
        {buttonLabel}
      </button>

      {open ? (
        <div className="make-model-help-backdrop" role="presentation" onMouseDown={() => setOpen(false)}>
          <section
            className="make-model-help-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="make-model-help-head">
              <div>
                <span className="make-model-help-icon">
                  <HelpCircle size={20} />
                </span>
                <div>
                  <h2 id={titleId}>{title}</h2>
                  <p>{intro}</p>
                </div>
              </div>
              <button
                className="icon-button secondary"
                type="button"
                onClick={() => setOpen(false)}
                aria-label={`Close ${title}`}
              >
                <X size={18} />
              </button>
            </div>

            <div className="make-model-help-steps">
              {steps.map((step, index) => (
                <article key={step.title}>
                  <span>{index + 1}</span>
                  <div>
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </div>
                </article>
              ))}
            </div>

            {terms.length > 0 ? (
              <div className="make-model-help-statuses">
                <h3>{termsTitle}</h3>
                <dl>
                  {terms.map((item) => (
                    <div key={item.term}>
                      <dt>{item.term}</dt>
                      <dd>{item.description}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            ) : null}

            <div className="make-model-help-safety">
              <CheckCircle2 size={18} />
              <p>{safety}</p>
            </div>

            <div className="make-model-help-footer">
              <button className="button" type="button" onClick={() => setOpen(false)}>
                Got it
              </button>
            </div>
          </section>
        </div>
      ) : null}
    </>
  );
}
