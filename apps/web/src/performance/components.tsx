import type { ReactNode } from "react";
import type { PeakRecord } from "./bridge";
import { peakName, peakAmount, songTime } from "./format";
import "./performance.css";

/** Inline value that can carry a peak highlight and a peak-info popover trigger. */
export interface Highlighted {
  text: string;
  peak?: boolean;
  records?: PeakRecord[];
  onShowPeak?: (records: PeakRecord[]) => void;
}

export function Value({ value }: { value: string | Highlighted }) {
  if (typeof value === "string") return <>{value}</>;
  return (
    <>
      <span className={value.peak ? "peak" : undefined} title={value.peak ? "达到本次监测峰值（不代表故障）" : undefined}>
        {value.text}
      </span>
      {value.records?.length ? (
        <button
          type="button"
          className={"perf-peak-info" + (value.peak ? " peak" : "")}
          title="查看峰值对应的歌曲与时间"
          aria-label="查看峰值对应的歌曲与时间"
          onClick={event => {
            event.stopPropagation();
            value.onShowPeak?.(value.records!);
          }}
        >
          i
        </button>
      ) : null}
    </>
  );
}

export interface CardDef {
  label: string;
  value: string | Highlighted;
  hint: string;
  onClick?: () => void;
}

export function CardGrid({ cards }: { cards: CardDef[] }) {
  return (
    <div className="perf-grid">
      {cards.map(card => (
        <div
          key={card.label}
          className="perf-card"
          role={card.onClick ? "button" : undefined}
          tabIndex={card.onClick ? 0 : undefined}
          onClick={card.onClick}
          onKeyDown={card.onClick ? (event => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); card.onClick!(); } }) : undefined}
        >
          <small>{card.label}</small>
          <div className="perf-value"><Value value={card.value} /></div>
          <div className="perf-hint">{card.hint}</div>
        </div>
      ))}
    </div>
  );
}

export function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <h2>{title}</h2>
      {children}
    </>
  );
}

export { peakName, peakAmount, songTime };
