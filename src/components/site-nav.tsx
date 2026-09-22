"use client";

import * as React from "react";
import Link from "next/link";
import { Mic, Moon, Sun, History, ArrowLeft } from "lucide-react";
import { useTheme } from "@/components/theme";
import { cn } from "@/lib/utils";

export function Logo({ className = "" }: { className?: string }) {
  return (
    <Link href="/" className={cn("group flex items-center gap-2.5 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-brand", className)}>
      <span className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-tr from-brand to-brand-2 text-on-accent shadow-card transition-transform duration-300 group-hover:scale-105 group-active:scale-95">
        <Mic className="h-4.5 w-4.5" aria-hidden />
      </span>
      <span className="text-[15px] font-semibold tracking-tight text-foreground">
        InterVue <span className="text-brand">AI</span>
      </span>
    </Link>
  );
}

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggle } = useTheme();
  const isDark = theme === "dark";
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className={cn(
        "relative flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-surface-2 text-muted-foreground transition-all duration-200",
        "hover:border-line-strong hover:text-foreground hover:shadow-card active:scale-90",
        "outline-none focus-visible:ring-2 focus-visible:ring-brand",
        className
      )}
    >
      <Sun className={cn("h-4 w-4 transition-all duration-300", isDark ? "scale-0 rotate-90 opacity-0" : "scale-100 rotate-0 opacity-100")} aria-hidden />
      <Moon className={cn("absolute h-4 w-4 transition-all duration-300", isDark ? "scale-100 rotate-0 opacity-100" : "scale-0 -rotate-90 opacity-0")} aria-hidden />
    </button>
  );
}

/** Standard top bar for setup/results/history pages. */
export function SiteNav({ backHref }: { backHref?: string }) {
  return (
    <header className="sticky top-0 z-40 border-b border-line/60 bg-surface/80 backdrop-blur-xl">
      <div className="mx-auto flex h-16 w-full max-w-5xl items-center gap-3 px-4 sm:px-6">
        {backHref && (
          <Link
            href={backHref}
            aria-label="Go back"
            className="mr-1 flex h-9 w-9 items-center justify-center rounded-xl border border-line bg-surface-2 text-muted-foreground transition-all hover:border-line-strong hover:text-foreground active:scale-90"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
          </Link>
        )}
        <Logo />
        <nav className="ml-auto flex items-center gap-2">
          <Link
            href="/history"
            className="flex h-9 items-center gap-2 rounded-xl border border-line bg-surface-2 px-3.5 text-sm font-medium text-muted-foreground transition-all hover:border-line-strong hover:text-foreground"
          >
            <History className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">History</span>
          </Link>
          <ThemeToggle />
        </nav>
      </div>
    </header>
  );
}
