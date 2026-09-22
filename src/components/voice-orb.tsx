"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export type OrbPhase = "idle" | "listening" | "thinking" | "speaking";

/**
 * VoiceOrb — the AI interviewer's face. All animation is driven by REAL state:
 * `level` (0-1 RMS from the user's mic) while listening, CSS keyframes while
 * the AI speaks (driven by the actual TTS utterance lifecycle in the page).
 * Fully responsive: the SVG uses a fixed viewBox and scales with its container.
 */
export function VoiceOrb({ phase, level = 0 }: { phase: OrbPhase; level?: number }) {
  const clamped = Math.min(1, Math.max(0, level));
  const S = 200; // viewBox units
  const R = S / 2;

  return (
    <div
      className={cn("relative h-[150px] w-[150px] select-none sm:h-[190px] sm:w-[190px] lg:h-[220px] lg:w-[220px]")}
      role="img"
      aria-label={
        phase === "speaking" ? "Interviewer is speaking" : phase === "listening" ? "Listening to you" : phase === "thinking" ? "Thinking" : "Idle"
      }
    >
      {/* Glow halo — pulses only when active */}
      <div
        aria-hidden
        className={cn(
          "absolute inset-[-24px] rounded-full blur-2xl transition-opacity duration-700",
          phase === "speaking" && "opacity-70 animate-pulse-soft",
          phase === "listening" && "opacity-50",
          phase === "thinking" && "opacity-40",
          phase === "idle" && "opacity-25"
        )}
        style={{
          background:
            phase === "speaking"
              ? "radial-gradient(circle, var(--glow-brand) 0%, transparent 70%)"
              : "radial-gradient(circle, var(--glow-muted) 0%, transparent 70%)",
        }}
      />

      <svg viewBox={`0 0 ${S} ${S}`} width="100%" height="100%" className="relative">
        <defs>
          <radialGradient id="orbCore" cx="38%" cy="32%" r="75%">
            <stop offset="0%" stopColor="var(--orb-hi)" />
            <stop offset="55%" stopColor="var(--orb-mid)" />
            <stop offset="100%" stopColor="var(--orb-lo)" />
          </radialGradient>
        </defs>

        {/* Expanding sonar ring — breathing while listening, rippling while speaking */}
        <circle
          cx={R} cy={R} r={R - 2}
          fill="none" stroke="var(--orb-ring)" strokeWidth="1.5"
          className={cn(
            phase === "speaking" && "orb-ring-speak",
            phase === "listening" && "orb-ring-listen",
            phase === "thinking" && "orb-ring-think"
          )}
        />

        {/* Reactive blob core: scales with mic RMS; keyframe-driven when AI speaks */}
        <circle
          cx={R} cy={R}
          r={R * 0.52}
          fill="url(#orbCore)"
          className={cn(
            "orb-core",
            phase === "listening" && "orb-core-listen",
            phase === "speaking" && "orb-core-speak",
            phase === "thinking" && "orb-core-think"
          )}
          style={phase === "listening" ? { transform: `scale(${1 + clamped * 0.18})` } : undefined}
        />

        {/* Mic-level waveform bars along the bottom arc (listening only) */}
        {phase === "listening" && (
          <g aria-hidden>
            {Array.from({ length: 24 }).map((_, i) => {
              const wave = Math.sin((i / 23) * Math.PI);
              const h = 6 + wave * (4 + clamped * 26);
              const x = 12 + i * ((S - 24) / 23);
              return <rect key={i} x={x} y={S - 10 - h} width={3.2} height={h} rx={1.6} fill="var(--orb-ring)" opacity={0.25 + wave * 0.5} />;
            })}
          </g>
        )}

        {/* Thinking dashes — orbiting arc */}
        {phase === "thinking" && (
          <g className="orb-think" aria-hidden>
            <circle cx={R} cy={R} r={R * 0.72} fill="none" stroke="var(--orb-ring)" strokeWidth="2" strokeDasharray="4 10" strokeLinecap="round" />
          </g>
        )}
      </svg>

      {/* Speaking equalizer — real TTS playback lifecycle, decays to still */}
      {phase === "speaking" && (
        <div aria-hidden className="absolute inset-x-0 -bottom-1 flex items-end justify-center gap-[3px]">
          {Array.from({ length: 5 }).map((_, i) => (
            <span
              key={i}
              className="w-1 rounded-full bg-brand"
              style={{
                height: `${8 + ((i * 7) % 10)}px`,
                animation: `orb-bar 0.9s ease-in-out ${i * 0.12}s infinite alternate`,
              }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
