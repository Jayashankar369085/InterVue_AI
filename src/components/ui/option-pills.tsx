import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Option pill — replaces native <select> for short option sets. Radio-group
 * semantics, full keyboard support, animated selection.
 */
export function OptionPills<T extends string>({
  label,
  options,
  value,
  onChange,
  name,
  columns = 2,
}: {
  label: string;
  name: string;
  options: { value: T; label: string; hint?: string; icon?: React.ReactNode }[];
  value: T;
  onChange: (v: T) => void;
  columns?: 1 | 2 | 3;
}) {
  return (
    <fieldset className="space-y-2.5">
      <legend className="text-sm font-medium text-foreground">{label}</legend>
      <div
        role="radiogroup"
        aria-label={label}
        className={cn("grid gap-2", columns === 1 && "grid-cols-1", columns === 2 && "grid-cols-1 xs:grid-cols-2", columns === 3 && "grid-cols-1 xs:grid-cols-3")}
      >
        {options.map((opt) => {
          const selected = opt.value === value;
          return (
            <button
              key={opt.value}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(opt.value)}
              className={cn(
                "group relative flex items-start gap-2.5 rounded-xl border p-3 text-left transition-all duration-200",
                selected
                  ? "border-brand/60 bg-brand-soft shadow-glow-brand"
                  : "border-line bg-surface-2 hover:border-line-strong hover:bg-surface-3 active:scale-[0.98]"
              )}
            >
              {opt.icon && (
                <span className={cn("mt-0.5 transition-colors", selected ? "text-brand" : "text-muted-foreground")}>{opt.icon}</span>
              )}
              <span className="min-w-0">
                <span className={cn("block text-sm font-medium", selected ? "text-foreground" : "text-foreground/90")}>{opt.label}</span>
                {opt.hint && <span className="mt-0.5 block text-xs leading-snug text-muted-foreground">{opt.hint}</span>}
              </span>
              <span
                aria-hidden
                className={cn(
                  "ml-auto mt-0.5 flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border transition-all duration-200",
                  selected ? "border-brand bg-brand" : "border-line-strong bg-transparent"
                )}
              >
                <span className={cn("h-2 w-2 rounded-full bg-on-accent transition-transform duration-200", selected ? "scale-100" : "scale-0")} />
              </span>
            </button>
          );
        })}
      </div>
      {/* Hidden input so the value participates in form semantics if ever needed. */}
      <input type="hidden" name={name} value={value} />
    </fieldset>
  );
}

/** Segmented control — compact single-row variant. */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  name,
}: {
  label: string;
  name: string;
  options: { value: T; label: string; hint?: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const index = Math.max(0, options.findIndex((o) => o.value === value));
  return (
    <div className="space-y-2.5">
      <span className="block text-sm font-medium text-foreground">{label}</span>
      <div
        role="radiogroup"
        aria-label={label}
        className="relative grid rounded-xl border border-line bg-surface-2 p-1"
        style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      >
        <span
          aria-hidden
          className="absolute inset-y-1 rounded-lg bg-brand shadow-card transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
          style={{ width: `calc((100% - 0.5rem) / ${options.length})`, left: `calc(0.25rem + ${index} * (100% - 0.5rem) / ${options.length})` }}
        />
        {options.map((opt) => (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={opt.value === value}
            onClick={() => onChange(opt.value)}
            className={cn(
              "relative z-10 rounded-lg px-2 py-2 text-center text-xs font-medium transition-colors duration-200 sm:text-sm",
              opt.value === value ? "text-on-accent" : "text-muted-foreground hover:text-foreground"
            )}
          >
            {opt.label}
          </button>
        ))}
      </div>
      <input type="hidden" name={name} value={value} />
    </div>
  );
}
