"use client";

import * as React from "react";
import { UploadCloud, FileText, X, Loader2, CheckCircle2, FileUp } from "lucide-react";
import { cn } from "@/lib/utils";

export type UploadState = "empty" | "processing" | "done" | "error";

export function UploadCard({
  title,
  hint,
  accept,
  state,
  fileName,
  fileSize,
  error,
  onFile,
  onRemove,
}: {
  title: string;
  hint: string;
  accept: string;
  state: UploadState;
  fileName?: string | null;
  fileSize?: number | null;
  error?: string | null;
  onFile: (f: File) => void;
  onRemove: () => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [drag, setDrag] = React.useState(false);
  const busy = state === "processing";

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${title} — ${state === "done" ? `${fileName} uploaded, press Enter to replace` : "press Enter to choose a file"}`}
      onClick={() => !busy && inputRef.current?.click()}
      onKeyDown={(e) => {
        if ((e.key === "Enter" || e.key === " ") && !busy) {
          e.preventDefault();
          inputRef.current?.click();
        }
      }}
      onDragOver={(e) => {
        e.preventDefault();
        if (!busy) setDrag(true);
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDrag(false);
        const f = e.dataTransfer.files?.[0];
        if (f && !busy) onFile(f);
      }}
      className={cn(
        "group relative cursor-pointer overflow-hidden rounded-2xl border p-5 text-left outline-none transition-all duration-300",
        "focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
        state === "done"
          ? "border-success/40 bg-success-soft/60"
          : drag
            ? "border-brand bg-brand-soft shadow-glow-brand"
            : "border-line bg-surface-2 hover:border-brand/50 hover:bg-surface-3 hover:shadow-card"
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="sr-only"
        tabIndex={-1}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
          e.currentTarget.value = "";
        }}
      />

      {state === "done" && fileName ? (
        <div className="flex items-center gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-success/15 text-success">
            <CheckCircle2 className="h-5 w-5" aria-hidden />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium text-foreground" title={fileName}>{fileName}</span>
            <span className="text-xs text-muted-foreground">
              {fileSize ? `${(fileSize / 1024).toFixed(0)} KB · ` : ""}Parsed for personalization
            </span>
          </span>
          <button
            type="button"
            aria-label={`Remove ${fileName}`}
            onClick={(e) => {
              e.stopPropagation();
              onRemove();
            }}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-surface-3 hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ) : (
        <div className="flex items-start gap-3">
          <span
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-all duration-300",
              busy ? "bg-brand-soft text-brand" : "bg-surface-3 text-muted-foreground group-hover:text-brand",
              drag && "scale-110 text-brand"
            )}
          >
            {busy ? (
              <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
            ) : state === "error" ? (
              <FileUp className="h-5 w-5 text-warning" aria-hidden />
            ) : (
              <UploadCloud className={cn("h-5 w-5 transition-transform duration-300", drag && "-translate-y-0.5")} aria-hidden />
            )}
          </span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-foreground">{busy ? "Parsing document…" : title}</span>
            <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{error ?? hint}</span>
            <span className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
              <FileText className="h-3 w-3" aria-hidden /> PDF · DOCX · TXT
            </span>
          </span>
        </div>
      )}
    </div>
  );
}
