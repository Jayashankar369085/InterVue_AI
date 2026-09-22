"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { Mic, MicOff, PhoneOff, AlertCircle, Zap, Send, Radio, Loader2, Play } from "lucide-react";
import { Logo, ThemeToggle } from "@/components/site-nav";
import { VoiceOrb } from "@/components/voice-orb";
import { cn } from "@/lib/utils";
import type { Interview } from "@/types/interview";

// ---------------------------------------------------------------------------
// Audio pipeline: mic → 16 kHz mono PCM16 → AssemblyAI v3 streaming WebSocket.
// Worklet source is created from a Blob URL so no extra public file is needed.
// ---------------------------------------------------------------------------

const WORKLET_SRC = `
class PCMCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Int16Array(2048);
    this.offset = 0;
  }
  process(inputs) {
    const input = inputs[0];
    if (input && input[0]) {
      const ch = input[0];
      for (let i = 0; i < ch.length; i++) {
        const s = Math.max(-1, Math.min(1, ch[i]));
        this.buffer[this.offset++] = s < 0 ? s * 0x8000 : s * 0x7fff;
        if (this.offset === this.buffer.length) {
          this.port.postMessage(this.buffer.slice(0));
          this.offset = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("pcm-capture", PCMCapture);
`;

type Phase = "LOADING" | "READY" | "CONNECTING" | "LISTENING" | "THINKING" | "SPEAKING" | "ENDED" | "ERROR";

type Entry = { role: "ai" | "user"; text: string };

export default function InterviewPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [phase, setPhase] = useState<Phase>("LOADING");
  const [interview, setInterview] = useState<Interview | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [livePartial, setLivePartial] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [voiceStatus, setVoiceStatus] = useState<"off" | "connecting" | "open" | "failed">("off");
  const [muted, setMuted] = useState(false);
  const [textInput, setTextInput] = useState("");
  const [started, setStarted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [micLevel, setMicLevel] = useState(0);

  // ---- refs (stable across renders, used inside websocket/audio callbacks) ----
  const wsRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const nodeRef = useRef<AudioWorkletNode | ScriptProcessorNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const phaseRef = useRef<Phase>("LOADING");
  const mutedRef = useRef(false);
  const submittingRef = useRef(false);
  const submitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const answerRef = useRef<{ text: string; startMs: number | null; endMs: number | null }>({ text: "", startMs: null, endMs: null });
  const interviewIdRef = useRef(id);
  const endedRef = useRef(false);
  const reconnectRef = useRef({ attempts: 0, wanted: false });
  const keepAliveRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const ttsVoiceRef = useRef<SpeechSynthesisVoice | null>(null);
  const currentAiTextRef = useRef("");
  const echoGuardUntilRef = useRef(0);

  const setPhaseBoth = useCallback((p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  }, []);

  // ----------------------------- TTS ---------------------------------------
  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const pick = () => {
      const voices = window.speechSynthesis.getVoices().filter((v) => v.lang.startsWith("en"));
      ttsVoiceRef.current =
        voices.find((v) => /google (uk|us) english/i.test(v.name)) ||
        voices.find((v) => /samantha|jenny|aria|guy/i.test(v.name)) ||
        voices.find((v) => v.localService) ||
        voices[0] ||
        null;
    };
    pick();
    window.speechSynthesis.onvoiceschanged = pick;
    return () => {
      window.speechSynthesis.onvoiceschanged = null;
      window.speechSynthesis.cancel();
    };
  }, []);

  const speak = useCallback(
    (text: string, onDone?: () => void) => {
      currentAiTextRef.current = text;
      setPhaseBoth("SPEAKING");
      const synth = window.speechSynthesis;
      if (!synth) {
        // No TTS available: show the question and move on after a read delay.
        setTimeout(() => onDone?.(), Math.min(12000, 1500 + text.length * 45));
        return;
      }
      synth.cancel();
      const u = new SpeechSynthesisUtterance(text);
      if (ttsVoiceRef.current) u.voice = ttsVoiceRef.current;
      u.rate = 1.02;
      u.pitch = 1;
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        // Guard window: ignore transcripts right after TTS so speaker echo is
        // not captured as a user answer.
        echoGuardUntilRef.current = Date.now() + 1100;
        onDone?.();
      };
      u.onend = finish;
      u.onerror = finish;
      // Safety net: some browsers stall long utterances.
      setTimeout(finish, Math.min(45000, 4000 + text.length * 80));
      synth.speak(u);
    },
    [setPhaseBoth]
  );

  // ------------------------- answer submission ------------------------------
  const submitAnswer = useCallback(
    async (challenge = false) => {
      if (submittingRef.current || endedRef.current) return;
      const pending = answerRef.current;
      const answer = pending.text.trim();
      if (!answer && !challenge) return;
      submittingRef.current = true;
      setBusy(true);
      const dur =
        pending.startMs != null && pending.endMs != null && pending.endMs > pending.startMs
          ? Math.round((pending.endMs - pending.startMs) / 100) / 10
          : null;
      answerRef.current = { text: "", startMs: null, endMs: null };
      setLivePartial("");
      setPhaseBoth("THINKING");

      try {
        const res = await fetch(`/api/interviews/${interviewIdRef.current}/turn`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ answer, challenge, duration_seconds: dur, ended_by: "voice" }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Could not process that answer.");

        if (answer) setEntries((prev) => [...prev, { role: "user", text: answer }]);
        const updated: Interview | undefined = data.interview;
        if (updated) setInterview(updated);

        if (data.interview_complete) {
          endedRef.current = true;
          setPhaseBoth("ENDED");
          closeVoice();
          speak(data.reply || "Thank you. Wrapping up your evaluation.", () => {
            router.push(`/results/${interviewIdRef.current}`);
          });
        } else {
          setEntries((prev) => [...prev, { role: "ai", text: data.reply }]);
          speak(data.reply, () => {
            submittingRef.current = false;
            setBusy(false);
            setPhaseBoth("LISTENING");
            sendAgentContext(data.reply);
          });
        }
      } catch (err) {
        submittingRef.current = false;
        setBusy(false);
        setErrorMsg(err instanceof Error ? err.message : "Could not process that answer.");
        setPhaseBoth("LISTENING");
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [router, speak, setPhaseBoth]
  );

  const scheduleSubmit = useCallback(() => {
    if (submitTimerRef.current) clearTimeout(submitTimerRef.current);
    submitTimerRef.current = setTimeout(() => {
      submitTimerRef.current = null;
      void submitAnswer(false);
    }, 1900); // grace period so natural pauses don't split an answer
  }, [submitAnswer]);

  const cancelPendingSubmit = useCallback(() => {
    if (submitTimerRef.current) {
      clearTimeout(submitTimerRef.current);
      submitTimerRef.current = null;
    }
  }, []);

  // --------------------------- voice plumbing -------------------------------
  const sendJson = useCallback((msg: Record<string, unknown>) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  const sendAgentContext = useCallback(
    (reply: string) => {
      const iv = interviewRef.current;
      if (!iv) return;
      sendJson({
        type: "UpdateConfiguration",
        agent_context: reply.slice(0, 1750),
        prompt: `Live job interview conversation. Role: ${iv.blueprint.role}. Domain: ${iv.blueprint.domain}. The interviewee answers in detail.`,
      });
    },
    [sendJson]
  );

  const interviewRef = useRef<Interview | null>(null);
  useEffect(() => {
    interviewRef.current = interview;
  }, [interview]);

  const handleTurnMessage = useCallback(
    (msg: { transcript?: string; words?: { start: number; end: number }[]; end_of_turn?: boolean }) => {
      const text = String(msg.transcript ?? "").trim();
      if (!text) return;

      // Final turns arriving while the interviewer speaks are echo — drop them.
      // (Barge-in is handled by SpeechStarted instead.)
      if (msg.end_of_turn && phaseRef.current === "SPEAKING" && !submittingRef.current) return;

      if (msg.end_of_turn) {
        // Echo guard after TTS finishes.
        if (Date.now() < echoGuardUntilRef.current) return;
        // Echo detection: transcript matching the AI's last spoken line.
        const aiText = currentAiTextRef.current.toLowerCase();
        if (aiText && text.toLowerCase().split(/\s+/).filter(Boolean).length >= 4) {
          const aiWords = new Set(aiText.split(/\s+/));
          const overlap = text.toLowerCase().split(/\s+/).filter((w) => aiWords.has(w)).length;
          if (overlap / text.split(/\s+/).length > 0.7) return;
        }
        // Merge consecutive final turns separated only by brief pauses.
        const a = answerRef.current;
        if (!a.text) {
          a.text = text;
          a.startMs = msg.words?.[0]?.start ?? null;
          a.endMs = msg.words?.[msg.words.length - 1]?.end ?? null;
        } else {
          a.text = `${a.text} ${text}`;
          a.endMs = msg.words?.[msg.words.length - 1]?.end ?? a.endMs;
        }
        setLivePartial(a.text);
        scheduleSubmit();
      } else {
        setLivePartial(text);
        cancelPendingSubmit();
      }
    },
    [scheduleSubmit, cancelPendingSubmit]
  );

  const connectVoice = useCallback(async (): Promise<boolean> => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return true;
    setVoiceStatus("connecting");
    try {
      const tokenRes = await fetch("/api/voice/token", { method: "POST" });
      const tokenData = await tokenRes.json();
      if (!tokenRes.ok || !tokenData.token) throw new Error(tokenData.error || "Voice token unavailable");

      const ws = new WebSocket(
        `wss://streaming.assemblyai.com/v3/ws?token=${encodeURIComponent(tokenData.token)}&speech_model=universal-3-5-pro`
      );
      wsRef.current = ws;

      ws.onopen = () => {
        setVoiceStatus("open");
        reconnectRef.current.attempts = 0;
        const iv = interviewRef.current;
        sendJson({
          type: "UpdateConfiguration",
          prompt: `Live job interview conversation. Role: ${iv?.blueprint.role ?? "professional"}. Domain: ${iv?.blueprint.domain ?? "general"}. The interviewee gives detailed spoken answers.`,
        });
        // Keep the session warm during long thinking/speaking gaps.
        if (keepAliveRef.current) clearInterval(keepAliveRef.current);
        keepAliveRef.current = setInterval(() => sendJson({ type: "KeepAlive" }), 15000);
      };
      ws.onmessage = (event) => {
        if (typeof event.data !== "string") return;
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "Turn") handleTurnMessage(msg);
          else if (msg.type === "SpeechStarted") {
            if (phaseRef.current === "SPEAKING" && !submittingRef.current) {
              window.speechSynthesis?.cancel();
              setPhaseBoth("LISTENING");
            }
            cancelPendingSubmit();
          } else if (msg.type === "Termination") {
            setVoiceStatus("off");
          }
        } catch {
          /* non-JSON message — ignore */
        }
      };
      ws.onerror = () => {
        setVoiceStatus((s) => (s === "open" ? s : "failed"));
      };
      ws.onclose = () => {
        setVoiceStatus("off");
        if (keepAliveRef.current) {
          clearInterval(keepAliveRef.current);
          keepAliveRef.current = null;
        }
        // Auto-reconnect while the interview is live.
        if (reconnectRef.current.wanted && !endedRef.current && reconnectRef.current.attempts < 4) {
          reconnectRef.current.attempts += 1;
          const delay = 800 * reconnectRef.current.attempts;
          setTimeout(() => {
            if (reconnectRef.current.wanted && !endedRef.current) void connectVoice();
          }, delay);
        } else if (reconnectRef.current.wanted && !endedRef.current) {
          setVoiceStatus("failed");
          setErrorMsg("Voice connection was lost repeatedly. You can keep typing your answers instead.");
        }
      };
      return true;
    } catch (err) {
      console.error("voice connect failed:", err);
      setVoiceStatus("failed");
      setErrorMsg(
        err instanceof Error && err.message.includes("token")
          ? "Voice session could not start. Text input works — you can still do the whole interview."
          : "Voice is unavailable right now. Text input works — you can still do the whole interview."
      );
      return false;
    }
  }, [handleTurnMessage, sendJson, setPhaseBoth, cancelPendingSubmit]);

  const startAudioCapture = useCallback(async (): Promise<boolean> => {
    try {
      if (!streamRef.current) {
        streamRef.current = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
      }
      let ctx: AudioContext;
      try {
        ctx = new AudioContext({ sampleRate: 16000 });
      } catch {
        ctx = new AudioContext();
      }
      audioCtxRef.current = ctx;
      if (ctx.state === "suspended") await ctx.resume();
      const source = ctx.createMediaStreamSource(streamRef.current);
      sourceRef.current = source;

      // Level tap for the listening orb (additive; does not alter the send path).
      try {
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        analyser.smoothingTimeConstant = 0.75;
        source.connect(analyser);
        analyserRef.current = analyser;
      } catch {
        analyserRef.current = null;
      }

      const needsResample = ctx.sampleRate !== 16000;

      try {
        const blobUrl = URL.createObjectURL(new Blob([WORKLET_SRC], { type: "application/javascript" }));
        await ctx.audioWorklet.addModule(blobUrl);
        const node = new AudioWorkletNode(ctx, "pcm-capture");
        node.port.onmessage = (e: MessageEvent<Int16Array>) => {
          if (mutedRef.current || phaseRef.current === "SPEAKING") return;
          wsRef.current?.send(e.data.buffer);
        };
        source.connect(node);
        // Worklet runs at context rate; if != 16k the server still decodes PCM? No —
        // for correctness we downsample in the worklet path via context choice only.
        if (needsResample) {
          // Re-create context note: most browsers honor the 16k constructor; if not,
          // we accept server-side tolerance or fall back below.
          console.warn("AudioContext sample rate is", ctx.sampleRate, "— audio may need resampling");
        }
        nodeRef.current = node;
        return true;
      } catch {
        // Fallback: ScriptProcessorNode with manual downsampling to 16 kHz.
        const processor = ctx.createScriptProcessor(4096, 1, 1);
        const ratio = ctx.sampleRate / 16000;
        let pos = 0;
        let carry = 0;
        processor.onaudioprocess = (e) => {
          if (mutedRef.current || phaseRef.current === "SPEAKING") return;
          const input = e.inputBuffer.getChannelData(0);
          const out: number[] = [];
          if (ratio === 1) {
            for (let i = 0; i < input.length; i++) out.push(input[i]);
          } else {
            for (let i = 0; i < input.length; i++) {
              pos += ratio;
              if (pos >= 1) {
                pos -= 1;
                out.push(input[i]);
              }
            }
          }
          // Convert to Int16 and send.
          const buf = new ArrayBuffer(out.length * 2);
          const view = new DataView(buf);
          for (let i = 0; i < out.length; i++) {
            const s = Math.max(-1, Math.min(1, out[i]));
            view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
          }
          void carry;
          wsRef.current?.send(buf);
        };
        source.connect(processor);
        processor.connect(ctx.destination);
        processorRef.current = processor;
        return true;
      }
    } catch (err) {
      const name = (err as Error)?.name;
      if (name === "NotAllowedError") {
        setErrorMsg("Microphone permission was denied. Enable it in your browser settings, or type your answers below.");
      } else if (name === "NotFoundError") {
        setErrorMsg("No microphone was found on this device. Type your answers below — everything else works the same.");
      } else {
        setErrorMsg("Microphone could not start. Type your answers below — everything else works the same.");
      }
      return false;
    }
  }, []);

  const closeVoice = useCallback(() => {
    reconnectRef.current.wanted = false;
    if (submitTimerRef.current) clearTimeout(submitTimerRef.current);
    if (keepAliveRef.current) {
      clearInterval(keepAliveRef.current);
      keepAliveRef.current = null;
    }
    try {
      wsRef.current?.send(JSON.stringify({ type: "Terminate" }));
    } catch {
      /* already closed */
    }
    setTimeout(() => wsRef.current?.close(), 120);
    nodeRef.current?.disconnect();
    processorRef.current?.disconnect();
    sourceRef.current?.disconnect();
    analyserRef.current?.disconnect();
    audioCtxRef.current?.close().catch(() => {});
    streamRef.current?.getTracks().forEach((t) => t.stop());
    wsRef.current = null;
    nodeRef.current = null;
    processorRef.current = null;
    sourceRef.current = null;
    analyserRef.current = null;
    audioCtxRef.current = null;
    streamRef.current = null;
  }, []);

  // ----------------------------- lifecycle ---------------------------------
  // Load the interview (refresh recovery).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/interviews/${id}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Interview not found");
        if (cancelled) return;
        const iv: Interview = data.interview;
        setInterview(iv);
        interviewRef.current = iv;
        setEntries(iv.transcript.map((t) => ({ role: t.role, text: t.text })));
        if (iv.status === "completed" || iv.status === "aborted") {
          endedRef.current = true;
          setPhaseBoth("ENDED");
        } else if (iv.transcript.length > 0) {
          // Refreshed mid-interview: restore, ready to resume.
          setStarted(true);
          setPhaseBoth("READY");
        } else {
          setPhaseBoth("READY");
        }
      } catch (err) {
        if (!cancelled) {
          setErrorMsg(err instanceof Error ? err.message : "Could not load this interview.");
          setPhaseBoth("ERROR");
        }
      }
    })();
    return () => {
      cancelled = true;
      closeVoice();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const beginInterview = useCallback(async () => {
    const iv = interviewRef.current;
    if (!iv) return;
    setStarted(true);
    reconnectRef.current.wanted = true;

    // Natural warm-up opening (spec 2B): the greeting asks how their day is
    // going — its answer moves the interview to SELF_INTRO (server-side).
    // The blueprint's opening_line is woven in as the role framing.
    const opening =
      iv.transcript.length === 0
        ? `Hey, thanks for making the time today. I'm your interviewer for the ${iv.blueprint.role} role. Quick one before we start — how's your day going so far?`
        : "";
    if (iv.transcript.length === 0) {
      setEntries([{ role: "ai", text: opening }]);
      // Persist the spoken greeting so a refresh restores the exact state.
      void fetch(`/api/interviews/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ append_ai_line: opening }),
      }).catch(() => {});
    }

    setPhaseBoth("CONNECTING");
    const voiceOk = await connectVoice();
    if (!voiceOk) {
      // No voice: still run the interview over text.
      setPhaseBoth("LISTENING");
      return;
    }
    const micOk = await startAudioCapture();
    if (!micOk) {
      setPhaseBoth("LISTENING");
      return;
    }
    if (iv.transcript.length === 0) {
      speak(opening, () => {
        setPhaseBoth("LISTENING");
        sendAgentContext(opening);
      });
    } else {
      speak("Welcome back — let's pick up where we left off.", () => setPhaseBoth("LISTENING"));
    }
  }, [connectVoice, startAudioCapture, speak, setPhaseBoth, sendAgentContext]);

  const handleMute = useCallback(() => {
    setMuted((m) => {
      mutedRef.current = !m;
      return !m;
    });
  }, []);

  const sendTextAnswer = useCallback(() => {
    const text = textInput.trim();
    if (!text || submittingRef.current || endedRef.current) return;
    answerRef.current = { text, startMs: null, endMs: null };
    setTextInput("");
    void submitAnswer(false);
  }, [textInput, submitAnswer]);

  const handleChallenge = useCallback(() => {
    if (submittingRef.current || endedRef.current) return;
    // Challenge uses the last user answer as context but demands a harder question.
    const lastUser = [...entries].reverse().find((e) => e.role === "user");
    answerRef.current = { text: lastUser?.text ?? "", startMs: null, endMs: null };
    void submitAnswer(true);
  }, [entries, submitAnswer]);

  const handleEnd = useCallback(async () => {
    endedRef.current = true;
    setPhaseBoth("ENDED");
    closeVoice();
    window.speechSynthesis?.cancel();
    if (!interviewRef.current?.qa.length && interviewRef.current?.transcript.length) {
      // Nothing was answered; confirm before generating an empty report.
      const ok = window.confirm("No answers were recorded yet. End anyway and go to results?");
      if (!ok) {
        endedRef.current = false;
        setPhaseBoth("LISTENING");
        return;
      }
    }
    router.push(`/results/${interviewIdRef.current}`);
  }, [closeVoice, router]);

  useEffect(() => {
    const onUnload = () => closeVoice();
    window.addEventListener("pagehide", onUnload);
    return () => window.removeEventListener("pagehide", onUnload);
  }, [closeVoice]);

  // Mic level loop → drives the orb's listening animation with real audio.
  useEffect(() => {
    if (phase !== "LISTENING") {
      setMicLevel(0);
      return;
    }
    let raf = 0;
    const tick = () => {
      const analyser = analyserRef.current;
      if (analyser) {
        const buf = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) {
          const v = (buf[i] - 128) / 128;
          sum += v * v;
        }
        setMicLevel(Math.min(1, Math.sqrt(sum / buf.length) * 4));
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [phase]);

  // Auto-scroll transcript.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [entries, livePartial]);

  // ------------------------------ render -----------------------------------
  const bp = interview?.blueprint;
  const target = bp?.question_count ?? 10;
  const serverPhase = interview?.interview_phase ?? ((interview?.qa.length ?? 0) > 0 ? "TECHNICAL" : "WARMUP");
  const asked = interview?.substantive_asked ?? interview?.current_question ?? 0;
  const isWarmup = serverPhase === "WARMUP" || serverPhase === "SELF_INTRO";
  const progress = Math.min(1, asked / Math.max(1, target));
  const currentQuestion = [...entries].reverse().find((e) => e.role === "ai")?.text ?? "";

  const orbPhase =
    phase === "SPEAKING" ? "speaking" :
    phase === "THINKING" || phase === "CONNECTING" ? "thinking" :
    phase === "LISTENING" ? "listening" : "idle";

  const statusLabel =
    phase === "CONNECTING" ? "Connecting to voice…" :
    phase === "LISTENING" ? (livePartial ? "You're speaking…" : muted ? "Microphone muted" : "Listening") :
    phase === "THINKING" ? "Analyzing your answer" :
    phase === "SPEAKING" ? "Interviewer speaking" :
    phase === "ENDED" ? "Interview ended" :
    phase === "ERROR" ? "Something needs attention" :
    phase === "LOADING" ? "Loading interview…" : "Ready when you are";

  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      {/* Top progress hairline — advances only as substantive questions are asked */}
      <div className="fixed inset-x-0 top-0 z-50 h-[3px] bg-transparent" aria-hidden>
        <div
          className="h-full bg-gradient-to-r from-brand to-brand-2 transition-[width] duration-700 ease-out"
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-line/60 bg-surface/80 backdrop-blur-xl">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4 sm:px-6">
          <Logo />
          <div className="ml-2 hidden min-w-0 items-center gap-2 text-sm sm:flex">
            <span aria-hidden className="text-line-strong">·</span>
            <span className="truncate font-medium text-foreground">{bp?.role ?? "Loading…"}</span>
            {bp?.domain && <span className="truncate text-muted-foreground">— {bp.domain}</span>}
          </div>

          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            {isWarmup ? (
              <span className="rounded-full border border-line bg-surface-2 px-3 py-1 text-xs font-medium text-muted-foreground">
                Warm-up
              </span>
            ) : (
              <span className="flex items-center gap-2 rounded-full border border-line bg-surface-2 px-3 py-1">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Question</span>
                <span className="text-xs font-semibold tabular-nums text-foreground">
                  {String(Math.min(asked, target)).padStart(2, "0")}
                  <span className="text-muted-foreground"> / {target}</span>
                </span>
              </span>
            )}
            {interview?.mode === "demo" && (
              <span className="rounded-full border border-warning/40 bg-warning-soft px-2 py-1 text-[10px] font-semibold text-warning">DEMO</span>
            )}
            <span
              className={cn(
                "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
                voiceStatus === "open"
                  ? "border-success/30 bg-success-soft text-success"
                  : voiceStatus === "connecting"
                    ? "border-warning/30 bg-warning-soft text-warning"
                    : voiceStatus === "failed"
                      ? "border-error/30 bg-error-soft text-error"
                      : "border-line bg-surface-2 text-muted-foreground"
              )}
              title={voiceStatus === "open" ? "Voice connected" : voiceStatus === "failed" ? "Voice unavailable — text input" : "Voice off"}
            >
              <Radio className="h-3 w-3" aria-hidden />
              <span className="hidden sm:inline">{voiceStatus === "open" ? "Voice" : voiceStatus === "connecting" ? "…" : voiceStatus === "failed" ? "Text mode" : "Voice off"}</span>
            </span>
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="mx-auto grid w-full max-w-6xl flex-1 grid-cols-1 gap-6 px-4 pb-8 pt-6 sm:px-6 lg:grid-cols-[1fr_400px] lg:gap-8 lg:pt-8">
        {/* Left: orb + question */}
        <section className="flex min-w-0 flex-col items-center" aria-label="Interview conversation">
          {/* Start overlay before the interview begins */}
          {!started && phase === "READY" ? (
            <div className="flex w-full max-w-xl flex-1 flex-col items-center justify-center py-10 text-center animate-fade-up">
              <VoiceOrb phase="idle" />
              <h1 className="mt-8 text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                {bp?.role ? `Your ${bp.role} interview is ready` : "Your interview is ready"}
              </h1>
              <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
                {bp
                  ? `${bp.domain} · ${bp.seniority} · ${target} questions · ${bp.difficulty}`
                  : "Get comfortable — the interviewer will speak out loud."}
              </p>
              {bp && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {bp.domain} · {bp.seniority} · {target} questions · {bp.difficulty}
                </p>
              )}
              <button
                type="button"
                onClick={beginInterview}
                className="group mt-8 flex items-center gap-3 rounded-2xl bg-gradient-to-r from-brand to-brand-2 px-8 py-4 text-base font-semibold text-on-accent shadow-glow-brand transition-all duration-300 hover:shadow-glow-strong hover:brightness-110 active:scale-[0.98] outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              >
                <Play className="h-5 w-5 transition-transform group-hover:scale-110" aria-hidden />
                {interview?.transcript.length ? "Resume interview" : "Start interview"}
              </button>
              <p className="mt-4 text-xs text-muted-foreground">We&apos;ll ask for microphone access. You can also type answers.</p>
            </div>
          ) : (
            <>
              <div className="flex justify-center pt-2">
                <VoiceOrb phase={orbPhase} level={micLevel} />
              </div>
              <p className="mt-4 flex items-center gap-2 text-sm font-medium text-muted-foreground" aria-live="polite">
                {phase === "CONNECTING" && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
                {statusLabel}
              </p>

              {/* Current question card */}
              {currentQuestion && phase !== "READY" && (
                <div
                  key={currentQuestion}
                  className="mt-6 w-full max-w-xl rounded-2xl border border-line bg-surface-2 p-5 shadow-card animate-fade-up sm:p-6"
                  aria-live="polite"
                >
                  <div className="flex items-center gap-2">
                    <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-gradient-to-tr from-brand to-brand-2 text-on-accent">
                      <Zap className="h-3.5 w-3.5" aria-hidden />
                    </span>
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Interviewer</span>
                  </div>
                  <p className="mt-3 text-pretty text-[15px] leading-relaxed text-foreground sm:text-base">
                    {currentQuestion}
                  </p>
                </div>
              )}

              {/* Live partial transcript */}
              <div className="mt-4 h-10 max-w-xl text-center" aria-live="polite">
                {livePartial && (
                  <p className="rounded-xl border border-brand/20 bg-brand-soft/60 px-4 py-2 text-sm italic text-foreground">
                    &ldquo;{livePartial}&rdquo;
                  </p>
                )}
              </div>

              {errorMsg && (
                <div role="alert" className="mt-2 flex w-full max-w-xl items-start gap-2 rounded-xl border border-warning/30 bg-warning-soft p-3 text-sm text-foreground">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
                  <span>{errorMsg}</span>
                </div>
              )}
            </>
          )}
        </section>

        {/* Right: timeline + controls */}
        <aside className="flex min-w-0 flex-col rounded-2xl border border-line bg-surface-2/50 lg:max-h-[calc(100dvh-7.5rem)]" aria-label="Transcript and controls">
          <div ref={scrollRef} className="min-h-[220px] flex-1 space-y-3 overflow-y-auto p-4 lg:min-h-0">
            <h2 className="sticky top-0 z-10 -mx-4 bg-surface-2/80 px-4 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground backdrop-blur-sm">
              Conversation
            </h2>
            {entries.length === 0 && phase === "LOADING" && (
              <div className="flex justify-center py-10">
                <Loader2 className="h-6 w-6 animate-spin text-brand" aria-hidden />
              </div>
            )}
            {entries.length === 0 && phase !== "LOADING" && (
              <p className="py-10 text-center text-sm text-muted-foreground">The conversation will appear here.</p>
            )}
            {entries.map((t, i) => {
              const isLast = i === entries.length - 1;
              return (
                <div key={i} className={cn("flex flex-col animate-fade-up", t.role === "user" ? "items-end" : "items-start")}>
                  <span className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {t.role === "user" ? "You" : "Interviewer"}
                  </span>
                  <div
                    className={cn(
                      "max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed",
                      t.role === "user"
                        ? "rounded-tr-sm bg-gradient-to-tr from-brand to-brand-2 text-on-accent shadow-card"
                        : isLast
                          ? "rounded-tl-sm border border-brand/25 bg-brand-soft/70 text-foreground"
                          : "rounded-tl-sm border border-line bg-surface-3 text-foreground/90"
                    )}
                  >
                    {t.text}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Controls */}
          <div className="space-y-3 border-t border-line/60 p-4">
            {phase === "READY" && !started ? (
              <button
                type="button"
                onClick={beginInterview}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-brand to-brand-2 px-4 py-3 text-sm font-semibold text-on-accent shadow-glow-brand transition-all hover:brightness-110 active:scale-[0.98] outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
              >
                <Play className="h-4 w-4" aria-hidden />
                {interview?.transcript.length ? "Resume interview" : "Start interview"}
              </button>
            ) : (
              <>
                <div className="flex gap-2">
                  <input
                    value={textInput}
                    onChange={(e) => setTextInput(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && (e.preventDefault(), sendTextAnswer())}
                    placeholder="Type your answer here if voice isn't working…"
                    aria-label="Type your answer"
                    className="h-11 min-w-0 flex-1 rounded-xl border border-line bg-surface px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-brand/60 focus:shadow-glow-brand"
                    disabled={busy || phase === "ENDED"}
                  />
                  <button
                    type="button"
                    aria-label="Send answer"
                    onClick={sendTextAnswer}
                    disabled={busy || !textInput.trim() || phase === "ENDED"}
                    className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-brand text-on-accent transition-all hover:brightness-110 active:scale-90 disabled:pointer-events-none disabled:opacity-40 outline-none focus-visible:ring-2 focus-visible:ring-brand"
                  >
                    <Send className="h-4 w-4" aria-hidden />
                  </button>
                </div>
                <button
                  type="button"
                  onClick={handleChallenge}
                  disabled={busy || phase === "ENDED"}
                  className="flex w-full items-center justify-center gap-2 rounded-xl border border-line bg-surface-3 px-4 py-2.5 text-sm font-medium text-foreground transition-all hover:border-brand/40 hover:bg-brand-soft active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 outline-none focus-visible:ring-2 focus-visible:ring-brand"
                >
                  <Zap className="h-4 w-4 text-brand" aria-hidden />
                  Challenge my answer
                </button>
                <div className="flex items-center justify-center gap-4 pt-1">
                  <button
                    type="button"
                    title={muted ? "Unmute microphone" : "Mute microphone"}
                    aria-label={muted ? "Unmute microphone" : "Mute microphone"}
                    onClick={handleMute}
                    disabled={voiceStatus !== "open"}
                    className={cn(
                      "flex h-13 w-13 items-center justify-center rounded-full border transition-all active:scale-90 disabled:pointer-events-none disabled:opacity-40 outline-none focus-visible:ring-2 focus-visible:ring-brand",
                      muted ? "border-error/40 bg-error-soft text-error" : "border-line bg-surface-3 text-foreground hover:border-line-strong"
                    )}
                  >
                    {muted ? <MicOff className="h-5 w-5" aria-hidden /> : <Mic className="h-5 w-5" aria-hidden />}
                  </button>
                  <button
                    type="button"
                    title="End interview"
                    aria-label="End interview"
                    onClick={handleEnd}
                    className="flex h-13 w-13 items-center justify-center rounded-full border border-error/40 bg-error text-on-accent shadow-glow-error transition-all hover:brightness-110 active:scale-90 outline-none focus-visible:ring-2 focus-visible:ring-error"
                  >
                    <PhoneOff className="h-5 w-5" aria-hidden />
                  </button>
                </div>
              </>
            )}
          </div>
        </aside>
      </main>
    </div>
  );
}
