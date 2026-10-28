import React, {
  Fragment, useEffect, useState,
  type ChangeEvent as ReactChangeEvent, type CSSProperties, type ReactNode,
} from "react";

export type ChangeEvent<T = Element> = ReactChangeEvent<T>;
export { Fragment, useEffect, useState };

export type Tone = "success" | "warning" | "danger" | "info";

type Theme = {
  text: { primary: string; secondary: string; tertiary: string; accent: string; danger: string; warning: string; success: string };
  bg: { page: string; subtle: string; elevated: string };
  fill: { accentSubtle: string; dangerSubtle: string; warningSubtle: string; successSubtle: string; infoSubtle: string };
  border: { default: string; strong: string; focus: string };
  font: { family: string };
};

const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

const LIGHT: Theme = {
  text: { primary: "#142028", secondary: "#4c5e6a", tertiary: "#7d8d98", accent: "#0c6b6b", danger: "#b42318", warning: "#8a5a00", success: "#0d7a3f" },
  bg: { page: "#f3f6f7", subtle: "#e7eef1", elevated: "#ffffff" },
  fill: { accentSubtle: "#e3f3f3", dangerSubtle: "#fdecea", warningSubtle: "#fff4dc", successSubtle: "#e5f6ec", infoSubtle: "#e7f0f8" },
  border: { default: "#d3dee4", strong: "#7f97a6", focus: "#0c6b6b" },
  font: { family: FONT },
};

const DARK: Theme = {
  text: { primary: "#e7eef2", secondary: "#a9b8c2", tertiary: "#7d8e99", accent: "#7ed4d0", danger: "#ff8d84", warning: "#f0c14b", success: "#78d9a4" },
  bg: { page: "#0e1418", subtle: "#182127", elevated: "#1b262d" },
  fill: { accentSubtle: "#163433", dangerSubtle: "#3a1c1c", warningSubtle: "#3a2e14", successSubtle: "#143226", infoSubtle: "#152838" },
  border: { default: "#2c3b46", strong: "#5c7382", focus: "#7ed4d0" },
  font: { family: FONT },
};

function applyTheme(theme: Theme, dark: boolean): void {
  const r = document.documentElement;
  r.dataset.theme = dark ? "dark" : "light";
  r.style.colorScheme = dark ? "dark" : "light";
  const set = (k: string, v: string): void => r.style.setProperty(k, v);
  set("--bg", theme.bg.page);
  set("--subtle", theme.bg.subtle);
  set("--elevated", theme.bg.elevated);
  set("--text", theme.text.primary);
  set("--text-secondary", theme.text.secondary);
  set("--text-tertiary", theme.text.tertiary);
  set("--accent", theme.text.accent);
  set("--danger", theme.text.danger);
  set("--warning", theme.text.warning);
  set("--success", theme.text.success);
  set("--accent-subtle", theme.fill.accentSubtle);
  set("--danger-subtle", theme.fill.dangerSubtle);
  set("--warning-subtle", theme.fill.warningSubtle);
  set("--success-subtle", theme.fill.successSubtle);
  set("--info-subtle", theme.fill.infoSubtle);
  set("--border", theme.border.default);
  set("--border-strong", theme.border.strong);
  set("--focus", theme.border.focus);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", dark ? "#0e1418" : "#0c6b6b");
}

export function useGrokTheme(): Theme {
  const [dark, setDark] = useState<boolean>(() => {
    try { return window.matchMedia("(prefers-color-scheme: dark)").matches; } catch (e) { return false; }
  });
  useEffect(() => {
    applyTheme(dark ? DARK : LIGHT, dark);
    let mq: MediaQueryList | null = null;
    const onChange = (): void => { try { setDark(mq ? mq.matches : false); } catch (e) { /* ignore */ } };
    try {
      mq = window.matchMedia("(prefers-color-scheme: dark)");
      mq.addEventListener("change", onChange);
    } catch (e) { /* ignore */ }
    return () => { try { if (mq) mq.removeEventListener("change", onChange); } catch (e) { /* ignore */ } };
  }, [dark]);
  return dark ? DARK : LIGHT;
}

export function Page({ title, summary, children }: { title?: string; summary?: string; width?: string; children?: ReactNode }) {
  return (
    <main className="page">
      <header className="mast">
        <p className="eyebrow">UK / metric · silica in µg/L</p>
        <h1>{title}</h1>
        {summary ? <p className="summary">{summary}</p> : null}
      </header>
      {children}
    </main>
  );
}

export function Section({
  heading, caption, collapsible, defaultOpen, actions, children,
}: {
  heading?: string; caption?: string; collapsible?: boolean; defaultOpen?: boolean; actions?: ReactNode; children?: ReactNode;
}) {
  const [open, setOpen] = useState<boolean>(defaultOpen !== false);
  const shown = !collapsible || open;
  return (
    <section className="sec">
      <div className="sec-head">
        <div className="sec-titles">
          {collapsible ? (
            <button type="button" className="sec-toggle" aria-expanded={shown} onClick={() => setOpen((o: boolean) => !o)}>
              <span className="chev" aria-hidden="true">{shown ? "▾" : "▸"}</span>
              <h2>{heading}</h2>
            </button>
          ) : <h2>{heading}</h2>}
          {caption ? <p className="cap">{caption}</p> : null}
        </div>
        {actions ? <div className="sec-actions">{actions}</div> : null}
      </div>
      {shown ? <div className="sec-body">{children}</div> : null}
    </section>
  );
}

export function Text({ children }: { children?: ReactNode }) {
  const s = typeof children === "string" ? children : "";
  const status = s.startsWith("✔") || s.startsWith("Autosaved");
  return <p className={status ? "prose status" : "prose"}>{children}</p>;
}

type Cell = string | number | { text?: ReactNode; tone?: string } | null | undefined;

function renderCell(c: Cell): ReactNode {
  if (c == null || c === "") return "";
  if (typeof c === "object") {
    const tone = c.tone ? `tone tone-${c.tone}` : undefined;
    return <span className={tone}>{c.text ?? ""}</span>;
  }
  return String(c);
}

export function Table({
  columns, align, rows, emphasis,
}: {
  columns: string[];
  align?: Array<"start" | "end" | "center" | string>;
  rows: Cell[][];
  emphasis?: number;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((col: string, i: number) => (
              <th key={i} className={align && align[i] === "end" ? "num" : undefined}>{col}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row: Cell[], ri: number) => (
            <tr key={ri} className={emphasis === ri ? "em" : undefined}>
              {columns.map((_: string, ci: number) => (
                <td key={ci} className={align && align[ci] === "end" ? "num" : undefined}>{renderCell(row[ci])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Grid({ columns, children }: { columns?: number; plain?: boolean; children?: ReactNode }) {
  const style = { "--cols": String(columns || 1) } as CSSProperties;
  return <div className="grid" style={style}>{children}</div>;
}

export function Input({ label, type, value, onChange }: { label?: string; type?: string; value?: string; onChange?: (x: string) => void }) {
  const id = React.useId();
  const numeric = type === "number";
  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      <input
        id={id}
        type={numeric ? "text" : (type || "text")}
        inputMode={numeric ? "decimal" : undefined}
        autoComplete="off"
        value={value ?? ""}
        onChange={(e: ReactChangeEvent<HTMLInputElement>) => { if (onChange) onChange(e.target.value); }}
      />
    </label>
  );
}

export function Select({
  label, options, value, onChange,
}: {
  label?: string;
  options: { value: string; label: string }[];
  value?: string;
  onChange?: (x: string) => void;
}) {
  const id = React.useId();
  return (
    <label className="field" htmlFor={id}>
      <span>{label}</span>
      <select id={id} value={value ?? ""} onChange={(e: ReactChangeEvent<HTMLSelectElement>) => { if (onChange) onChange(e.target.value); }}>
        {options.map((o: { value: string; label: string }) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

export function Segmented({
  options, value, onChange,
}: {
  options: { value: string; label: string }[];
  value?: string;
  onChange?: (x: string) => void;
}) {
  return (
    <div className="tabs" role="tablist" aria-label="Calculators">
      {options.map((o: { value: string; label: string }) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          className={value === o.value ? "on" : undefined}
          onClick={() => { if (onChange) onChange(o.value); }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Callout({ tone, lead, children }: { tone?: Tone | string; lead?: ReactNode; children?: ReactNode }) {
  return (
    <aside className={`callout tone-${tone || "info"}`}>
      {lead ? <strong className="lead">{lead}</strong> : null}
      {children ? <div className="callout-body">{children}</div> : null}
    </aside>
  );
}

export function Equation({ children }: { children?: ReactNode }) {
  const parts = React.Children.toArray(children).map((c: ReactNode, i: number) => (typeof c === "string" || typeof c === "number" ? <span key={i}>{c}</span> : <React.Fragment key={i}>{c}</React.Fragment>));
  return <div className="eq">{parts}</div>;
}

export function Frac({ num, den }: { num: ReactNode; den: ReactNode }) {
  return (
    <span className="frac">
      <span className="num">{num}</span>
      <span className="den">{den}</span>
    </span>
  );
}

export function Pow({ base, exp }: { base: ReactNode; exp: ReactNode }) {
  return <span className="pow">{base}<sup>{exp}</sup></span>;
}

export function Button({ label, onClick }: { label: string; onClick?: () => void }) {
  return <button type="button" className="btn" onClick={onClick}>{label}</button>;
}

type Pt = { label?: string; value: number };
type Ann = { at: number; label: string };

export function LineChart({
  points, secondary, labels, ceiling, floor, format, annotations, unit, legend, secondaryScale,
}: {
  points: Pt[];
  secondary?: { label?: string; values: number[] };
  labels?: string[];
  ceiling?: number;
  floor?: number;
  format?: (x: number) => string;
  annotations?: Ann[];
  unit?: string;
  legend?: boolean;
  secondaryScale?: { floor?: number; ceiling?: number; format?: (x: number) => string };
}) {
  const fmtY = format || ((x: number) => (isFinite(x) ? String(Math.round(x * 100) / 100) : "–"));
  const fmtS = (secondaryScale && secondaryScale.format) || fmtY;
  const vals = points.map((p: Pt) => p.value).filter((x: number) => isFinite(x));
  const sec = secondary ? secondary.values.filter((x: number) => isFinite(x)) : [];
  const dual = !!secondaryScale && !!secondary;
  const all = dual ? vals : [...vals, ...sec];
  const y0 = floor != null && isFinite(floor) ? floor : (all.length ? Math.min(...all) : 0);
  let y1 = ceiling != null && isFinite(ceiling) ? ceiling : (all.length ? Math.max(...all) : 1);
  if (!(y1 > y0)) y1 = y0 + 1;
  const s0 = dual ? (secondaryScale!.floor != null && isFinite(secondaryScale!.floor) ? secondaryScale!.floor : (sec.length ? Math.min(...sec) : 0)) : y0;
  let s1 = dual ? (secondaryScale!.ceiling != null && isFinite(secondaryScale!.ceiling) ? secondaryScale!.ceiling : (sec.length ? Math.max(...sec) : 1)) : y1;
  if (!(s1 > s0)) s1 = s0 + 1;
  const w = 680, h = 240, padL = 56, padR = dual ? 58 : 16, padT = 18, padB = 32;
  const n = Math.max(points.length, 1);
  const X = (i: number): number => padL + (n <= 1 ? (w - padL - padR) / 2 : (i / (n - 1)) * (w - padL - padR));
  const Yof = (v: number, lo: number, hi: number): number => padT + (1 - (v - lo) / (hi - lo)) * (h - padT - padB);
  const Y = (v: number): number => Yof(v, y0, y1);
  const Y2 = (v: number): number => Yof(v, s0, s1);
  const path = (arr: number[], mapY: (v: number) => number): string => arr.map((v: number, i: number) => `${i === 0 || !isFinite(arr[i - 1]) ? "M" : "L"}${X(i).toFixed(1)},${isFinite(v) ? mapY(v).toFixed(1) : mapY(y0).toFixed(1)}`).join(" ");
  const ticks = [0, 1, 2, 3].map((i: number) => y0 + ((y1 - y0) * i) / 3);
  const ticks2 = [0, 1, 2, 3].map((i: number) => s0 + ((s1 - s0) * i) / 3);
  const showLegend = legend !== false && ((labels && labels.length > 0) || !!secondary);
  const nameA = (labels && labels[0]) || "Series";
  const nameB = (labels && labels[1]) || (secondary && secondary.label) || "Secondary";
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${w} ${h}`} width="100%" role="img" aria-label={showLegend ? `${nameA}${secondary ? ` and ${nameB}` : ""}` : "Chart"}>
        {ticks.map((t: number, i: number) => (
          <g key={i}>
            <line x1={padL} x2={w - padR} y1={Y(t)} y2={Y(t)} className="gridline" />
            <text x={padL - 8} y={Y(t) + 4} textAnchor="end" className="tick">{fmtY(t)}{unit && i === 3 ? unit : ""}</text>
          </g>
        ))}
        {dual ? ticks2.map((t: number, i: number) => (
          <text key={`s${i}`} x={w - padR + 8} y={Y2(t) + 4} textAnchor="start" className="tick">{fmtS(t)}</text>
        )) : null}
        <path d={path(points.map((p: Pt) => p.value), Y)} className="series a" />
        {secondary ? <path d={path(secondary.values, dual ? Y2 : Y)} className="series b" /> : null}
        {(annotations || []).map((a: Ann, i: number) => (
          isFinite(a.at) && a.at >= 0 && a.at < n ? (
            <g key={i}>
              <line x1={X(a.at)} x2={X(a.at)} y1={padT} y2={h - padB} className="ann" />
              <text x={X(a.at)} y={12} textAnchor="middle" className="ann-label">{a.label}</text>
            </g>
          ) : null
        ))}
        {points.map((p: Pt, i: number) => (
          p.label ? <text key={i} x={X(i)} y={h - 8} textAnchor="middle" className="tick">{p.label}</text> : null
        ))}
      </svg>
      {showLegend ? (
        <figcaption className="legend">
          <span><i className="swatch a" /> {nameA}</span>
          {secondary ? <span><i className="swatch b" /> {nameB}</span> : null}
          {unit ? <span className="unit">{unit}</span> : null}
        </figcaption>
      ) : null}
    </figure>
  );
}
