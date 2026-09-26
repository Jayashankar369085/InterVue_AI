"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export type OrbPhase = "idle" | "listening" | "thinking" | "speaking";

/**
 * VoiceOrb — the AI interviewer's face.
 *
 * Design: a calm gradient core wrapped in concentric pulse rings and a perfectly
 * symmetrical radial waveform. Everything is driven by REAL state:
 *   • `level` — mic RMS while listening, the interviewer's actual playback
 *     amplitude while speaking (smoothed here so motion stays fluid).
 *   • phase — switches ring speed/direction, core motion and waveform shape.
 * All loops are CSS transform/opacity keyframes (GPU-cheap); the only per-frame
 * work is the radial bar heights. Honors prefers-reduced-motion.
 */

const BARS = 36;
const S = 240; // viewBox units
const C = S / 2;
const BAR_INNER = 86; // bars start here, radially
const BAR_MAX = 34; // extra length at full level

/** Round to 2 decimals so SSR and client agree bit-for-bit (prevents hydration drift). */
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Symmetrical amplitude envelope: tallest at the vertical axis, tapering to both sides. */
function barLength(i: number, level: number, phase: OrbPhase): number {
  const centered = Math.abs(i - (BARS - 1) / 2) / ((BARS - 1) / 2); // 0 center → 1 edge
  const envelope = Math.pow(1 - centered, 1.35); // smooth symmetric taper — no randomness
  // A slow breathing wave adds life. Math.abs keeps bars i and BARS-1-i
  // identical, so the left/right mirror symmetry is never broken.
  const wave = phase === "speaking" ? 0.18 * Math.abs(Math.sin((i / (BARS - 1)) * Math.PI * 2)) : 0;
  const base = phase === "idle" ? 2.5 : 5;
  const amp = phase === "speaking" ? 1 : phase === "listening" ? 0.85 : 0.25;
  return base + (envelope + wave) * amp * level * BAR_MAX;
}

export function VoiceOrb({ phase, level = 0 }: { phase: OrbPhase; level?: number }) {
  const [smooth, setSmooth] = React.useState(0);
  const smoothRef = React.useRef(0);

  // Ease toward the raw level so bars glide instead of jittering.
  React.useEffect(() => {
    let raf = 0;
    const tick = () => {
      const target = Math.min(1, Math.max(0, level));
      smoothRef.current += (target - smoothRef.current) * 0.22;
      setSmooth(smoothRef.current);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [level]);

  const showWave = phase === "listening" || phase === "speaking" || phase === "idle";

  return (
    <div
      className={cn("relative h-[150px] w-[150px] select-none sm:h-[190px] sm:w-[190px] lg:h-[220px] lg:w-[220px]")}
      role="img"
      aria-label={
        phase === "speaking"
          ? "Interviewer is speaking"
          : phase === "listening"
            ? "Listening to you"
            : phase === "thinking"
              ? "Thinking"
              : "Ready"
      }
    >
      {/* Ambient glow halo — intensity follows the phase */}
      <div
        aria-hidden
        className={cn(
          "absolute inset-[-26px] rounded-full blur-2xl transition-opacity duration-700",
          phase === "speaking" && "opacity-75",
          phase === "listening" && "opacity-55 vorb-glow-listen",
          phase === "thinking" && "opacity-40 vorb-glow-think",
          phase === "idle" && "opacity-25 vorb-glow-idle"
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
          <radialGradient id="vorbCore" cx="38%" cy="32%" r="75%">
            <stop offset="0%" stopColor="var(--orb-hi)" />
            <stop offset="55%" stopColor="var(--orb-mid)" />
            <stop offset="100%" stopColor="var(--orb-lo)" />
          </radialGradient>
        </defs>

        {/* Concentric pulse rings — outward sonar while active, still when idle */}
        <g fill="none" stroke="var(--orb-ring)">
          <circle
            cx={C} cy={C} r={C - 6} strokeWidth="1.5"
            className={cn(
              "vorb-ring vorb-ring-a",
              phase === "speaking" && "vorb-ring-fast",
              phase === "listening" && "vorb-ring-slow",
              phase === "thinking" && "vorb-ring-shimmer"
            )}
          />
          <circle
            cx={C} cy={C} r={C - 6} strokeWidth="1.5"
            className={cn(
              "vorb-ring vorb-ring-b",
              (phase === "speaking" || phase === "listening") && "vorb-ring-fast",
              phase === "thinking" && "vorb-ring-shimmer"
            )}
          />
          {phase === "speaking" && <circle cx={C} cy={C} r={C - 6} strokeWidth="1.5" className="vorb-ring vorb-ring-c vorb-ring-fast" />}
        </g>

        {/* Gradient core — breathes while listening, pulses while speaking */}
        <circle
          cx={C} cy={C} r={C * 0.5}
          fill="url(#vorbCore)"
          className={cn(
            "vorb-core",
            phase === "listening" && "vorb-core-listen",
            phase === "speaking" && "vorb-core-speak",
            phase === "thinking" && "vorb-core-think"
          )}
          style={phase === "listening" ? { transform: `scale(${1 + smooth * 0.12})`, transformOrigin: "center" } : undefined}
        />

        {/* Radial waveform — 36 symmetric bars reacting to real audio */}
        {showWave && (
          <g aria-hidden strokeLinecap="round" strokeWidth="3.4" stroke="var(--orb-ring)">
            {Array.from({ length: BARS }).map((_, i) => {
              const angle = (i / BARS) * Math.PI * 2 - Math.PI / 2;
              const len = barLength(i, smooth, phase);
              const x1 = r2(C + Math.cos(angle) * BAR_INNER);
              const y1 = r2(C + Math.sin(angle) * BAR_INNER);
              const x2 = r2(C + Math.cos(angle) * (BAR_INNER + len));
              const y2 = r2(C + Math.sin(angle) * (BAR_INNER + len));
              return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} opacity={phase === "idle" ? 0.3 : 0.55 + smooth * 0.4} />;
            })}
          </g>
        )}

        {/* Thinking — orbiting dashes + slow counter-rotating arc */}
        {phase === "thinking" && (
          <g aria-hidden fill="none" stroke="var(--orb-ring)">
            <g className="vorb-think">
              <circle cx={C} cy={C} r={C * 0.66} strokeWidth="2.5" strokeDasharray="6 12" strokeLinecap="round" />
            </g>
            <g className="vorb-think-rev" opacity="0.6">
              <circle cx={C} cy={C} r={C * 0.78} strokeWidth="1.5" strokeDasharray="3 18" strokeLinecap="round" />
            </g>
          </g>
        )}
      </svg>
    </div>
  );
}
