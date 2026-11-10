import type { ReactNode } from "react";

interface ComicPanelProps {
  children: ReactNode;
  className?: string;
  ariaLabel?: string;
}

export default function ComicPanel({
  children,
  className = "",
  ariaLabel,
}: ComicPanelProps) {
  return (
    <section
      className={`comic-panel ${className}`.trim()}
      aria-label={ariaLabel}
    >
      {children}
    </section>
  );
}
