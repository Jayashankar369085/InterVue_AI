"use client";

import { useState, useEffect, useRef } from "react";
import { useParams, useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Mic, MicOff, PhoneOff, AlertCircle, RefreshCw, Zap } from "lucide-react";

type InterviewState = "LISTENING" | "THINKING" | "SPEAKING" | "USER_SPEAKING" | "PAUSED" | "ERROR";

type TranscriptEntry = {
  id: string;
  role: "ai" | "user";
  text: string;
  isComplete: boolean;
};

export default function InterviewPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [interviewState, setInterviewState] = useState<InterviewState>("SPEAKING");
  const [transcripts, setTranscripts] = useState<TranscriptEntry[]>([
    { id: "1", role: "ai", text: "Hello! I'm InterVue AI. I see you're preparing for an ML Engineer internship. Are you ready to begin?", isComplete: true },
  ]);
  const [isMuted, setIsMuted] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll transcript
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcripts]);

  // Mock state machine for demo purposes
  useEffect(() => {
    if (id !== "mock-123") return;

    let timeout: NodeJS.Timeout;
    
    if (interviewState === "SPEAKING") {
      timeout = setTimeout(() => {
        setInterviewState("LISTENING");
      }, 4000);
    } else if (interviewState === "USER_SPEAKING") {
      timeout = setTimeout(() => {
        setInterviewState("THINKING");
      }, 3000);
    } else if (interviewState === "THINKING") {
      timeout = setTimeout(() => {
        setInterviewState("SPEAKING");
        setTranscripts(prev => [
          ...prev, 
          { id: Date.now().toString(), role: "ai", text: "That makes sense. Can you elaborate on the model deployment process you used?", isComplete: true }
        ]);
      }, 2000);
    }

    return () => clearTimeout(timeout);
  }, [interviewState, id]);

  const handleSimulateUserSpeech = () => {
    setInterviewState("USER_SPEAKING");
    setTranscripts(prev => [
      ...prev,
      { id: Date.now().toString(), role: "user", text: "I used Docker and AWS for deployment.", isComplete: true }
    ]);
  };

  const handleEndInterview = () => {
    router.push(`/results/${id}`);
  };

  return (
    <div className="flex flex-col h-screen bg-background">
      {/* Header */}
      <header className="h-16 border-b border-white/5 px-6 flex items-center justify-between shrink-0 bg-background/80 backdrop-blur-md z-10">
        <div className="flex items-center gap-2">
          <Zap className="w-5 h-5 text-primary" />
          <span className="font-semibold">InterVue AI</span>
        </div>
        <div className="flex flex-col items-center">
          <span className="text-sm font-medium">ML Engineer Internship</span>
          <span className="text-xs text-muted-foreground">Question 2 of 10</span>
        </div>
        <div className="w-[100px] flex justify-end">
          <span className={`text-xs px-2 py-1 rounded-full border ${
            interviewState === "ERROR" ? "bg-destructive/10 text-destructive border-destructive/20" : 
            interviewState === "LISTENING" ? "bg-green-500/10 text-green-500 border-green-500/20" : 
            "bg-primary/10 text-primary border-primary/20"
          }`}>
            {interviewState}
          </span>
        </div>
      </header>

      {/* Main Content */}
      <main className="flex-1 flex flex-col md:flex-row overflow-hidden relative">
        {/* Left/Top: Voice Visualization */}
        <div className="flex-1 flex flex-col items-center justify-center p-8 relative border-r border-white/5">
          <div className="absolute inset-0 bg-gradient-to-b from-primary/5 to-transparent pointer-events-none" />
          
          {/* Orb Container */}
          <div className="relative w-48 h-48 md:w-64 md:h-64 flex items-center justify-center">
            {/* Pulsing background based on state */}
            <div className={`absolute inset-0 rounded-full transition-all duration-700 ease-in-out ${
              interviewState === "SPEAKING" ? "bg-primary/20 animate-ping" :
              interviewState === "THINKING" ? "bg-blue-500/20 animate-pulse" :
              interviewState === "USER_SPEAKING" ? "bg-green-500/20 animate-pulse" :
              "bg-white/5"
            }`} />
            
            {/* Core Orb */}
            <div className={`relative w-32 h-32 md:w-48 md:h-48 rounded-full flex items-center justify-center backdrop-blur-md border border-white/10 transition-all duration-500 ${
              interviewState === "SPEAKING" ? "bg-gradient-to-tr from-primary to-primary/50 shadow-[0_0_40px_rgba(var(--primary),0.5)] scale-105" :
              interviewState === "THINKING" ? "bg-gradient-to-tr from-blue-500/50 to-blue-600/50 scale-95" :
              interviewState === "USER_SPEAKING" ? "bg-gradient-to-tr from-green-500/20 to-green-600/20" :
              "bg-white/10 grayscale"
            }`}>
              {interviewState === "THINKING" ? (
                <RefreshCw className="w-12 h-12 animate-spin text-white/50" />
              ) : interviewState === "ERROR" ? (
                <AlertCircle className="w-12 h-12 text-destructive" />
              ) : (
                <div className="flex gap-1 items-center justify-center h-12">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div 
                      key={i} 
                      className={`w-1.5 rounded-full bg-white transition-all duration-300 ${
                        interviewState === "SPEAKING" ? "animate-pulse h-full" : 
                        "h-2"
                      }`}
                      style={{ 
                        animationDelay: `${i * 0.1}s`,
                        height: interviewState === "SPEAKING" ? `${Math.max(20, Math.random() * 100)}%` : '8px' 
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
          
          <div className="mt-12 text-center max-w-md">
            <p className="text-lg text-muted-foreground">
              {interviewState === "SPEAKING" && "InterVue is speaking..."}
              {interviewState === "LISTENING" && "Listening to you..."}
              {interviewState === "THINKING" && "Analyzing answer..."}
              {interviewState === "USER_SPEAKING" && "You are speaking..."}
              {interviewState === "PAUSED" && "Interview paused."}
            </p>
          </div>
        </div>

        {/* Right/Bottom: Transcript & Controls */}
        <div className="w-full md:w-[400px] lg:w-[500px] flex flex-col bg-card/30 shrink-0">
          {/* Transcript Area */}
          <div className="flex-1 overflow-y-auto p-6 space-y-6" ref={scrollRef}>
            {transcripts.map((t) => (
              <div key={t.id} className={`flex flex-col ${t.role === "user" ? "items-end" : "items-start"}`}>
                <span className="text-xs text-muted-foreground mb-1 ml-1">
                  {t.role === "user" ? "You" : "InterVue AI"}
                </span>
                <div className={`px-4 py-3 rounded-2xl max-w-[85%] ${
                  t.role === "user" 
                    ? "bg-primary text-primary-foreground rounded-tr-sm" 
                    : "bg-white/10 rounded-tl-sm"
                }`}>
                  <p className="text-sm leading-relaxed">{t.text}</p>
                </div>
              </div>
            ))}
            
            {/* Demo button to simulate speech */}
            {interviewState === "LISTENING" && (
              <div className="flex justify-center pt-4">
                <Button variant="outline" size="sm" onClick={handleSimulateUserSpeech} className="opacity-50 hover:opacity-100">
                  (Simulate Speech)
                </Button>
              </div>
            )}
          </div>

          {/* Controls Area */}
          <div className="p-6 border-t border-white/5 bg-background/50 backdrop-blur-md space-y-4">
            <Button variant="secondary" className="w-full bg-white/5 hover:bg-white/10 text-white font-medium">
              Challenge My Answer
            </Button>
            
            <div className="flex items-center justify-center gap-4">
              <Button 
                variant={isMuted ? "destructive" : "secondary"} 
                size="icon" 
                className="h-14 w-14 rounded-full"
                onClick={() => setIsMuted(!isMuted)}
              >
                {isMuted ? <MicOff className="w-6 h-6" /> : <Mic className="w-6 h-6" />}
              </Button>
              <Button 
                variant="destructive" 
                size="icon" 
                className="h-14 w-14 rounded-full bg-red-500 hover:bg-red-600"
                onClick={handleEndInterview}
              >
                <PhoneOff className="w-6 h-6" />
              </Button>
            </div>
            <p className="text-center text-xs text-muted-foreground mt-2">
              Microphone unavailable? <button className="underline hover:text-white">Type your answer</button>
            </p>
          </div>
        </div>
      </main>
    </div>
  );
}
