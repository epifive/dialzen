"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bot, Ear, ExternalLink, Mic, MicOff, Phone, PhoneOff, Send, User, Volume2, VolumeX } from "lucide-react";
import { startTestCallAction, testChatAction } from "@/app/actions/dashboard/agents";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/field";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/voice/format";
import { listenOnce, pickVoice, requestMicrophone, speak, speechRecognition, startVoice, type VoiceHandle, type VoiceTurn } from "@/widget/sdk";

type Phase = "idle" | "starting" | "live" | "ended";

const noop = () => () => {};

function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

/** Transcript bubbles: agent on the start side, caller on the end side (mirrors in RTL). */
export function TranscriptBubbles({ turns, agentLabel, callerLabel, live = false }: { turns: Array<{ role: string; text: string; at?: number }>; agentLabel: string; callerLabel: string; live?: boolean }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (live) end.current?.scrollIntoView({ block: "nearest" });
  }, [turns.length, live]);
  return (
    <div className="space-y-3" aria-live={live ? "polite" : undefined}>
      {turns.map((turn, i) => {
        const agent = turn.role === "agent";
        return (
          <div key={i} className={cn("flex items-end gap-2", agent ? "justify-start" : "flex-row-reverse justify-start")}>
            <span className={cn("grid size-7 shrink-0 place-items-center rounded-full", agent ? "bg-primary-soft text-primary" : "bg-line text-ink")} aria-hidden>
              {agent ? <Bot className="size-4" /> : <User className="size-4" />}
            </span>
            <div className={cn("max-w-[80%] rounded-2xl px-3.5 py-2 text-sm", agent ? "rounded-es-sm bg-paper ring-1 ring-line" : "rounded-ee-sm bg-primary text-white")}>
              <span className="sr-only">{agent ? agentLabel : callerLabel}: </span>
              <p dir="auto" className="whitespace-pre-wrap">
                {turn.text}
              </p>
            </div>
          </div>
        );
      })}
      <div ref={end} />
    </div>
  );
}

/** The Test tab: a browser call with the provider's web SDK, or a text chat with a simulated agent. */
export function AgentTestCall({ wid, agentId, language, provider, canTest }: { wid: number; agentId: number; language: string; provider: string; canTest: boolean }) {
  const t = useT();
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [mode, setMode] = useState<"voice" | "chat">(provider === "simulated" ? "chat" : "voice");
  const [error, setError] = useState("");
  const [micBlocked, setMicBlocked] = useState(false);
  const [callId, setCallId] = useState<number | null>(null);
  const [turns, setTurns] = useState<VoiceTurn[]>([]);
  const [status, setStatus] = useState<"connecting" | "connected" | "ended">("connecting");
  const [speaking, setSpeaking] = useState(false);
  const [muted, setMuted] = useState(false);
  const [latency, setLatency] = useState<number[]>([]);
  const [startedAt, setStartedAt] = useState(0);
  const [endedAt, setEndedAt] = useState(0);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [speakReplies, setSpeakReplies] = useState(false);
  const [listening, setListening] = useState(false);
  const handle = useRef<VoiceHandle | null>(null);
  const listener = useRef<{ stop(): void } | null>(null);
  const hasRecognition = useSyncExternalStore(noop, () => Boolean(speechRecognition()), () => false);
  const hasSynthesis = useSyncExternalStore(noop, () => "speechSynthesis" in window, () => false);
  const now = useNow(phase === "live");
  const elapsed = startedAt ? Math.floor(((endedAt || now) - startedAt) / 1000) : 0;

  useEffect(
    () => () => {
      void handle.current?.end().catch(() => undefined);
      listener.current?.stop();
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    },
    [],
  );

  const finish = () => {
    setPhase("ended");
    setEndedAt(Date.now());
    setSpeaking(false);
    router.refresh();
  };

  const say = async (text: string) => {
    if (!speakReplies || !hasSynthesis) return;
    setSpeaking(true);
    await speak(text, language, pickVoice(language));
    setSpeaking(false);
  };

  const start = async () => {
    setError("");
    setMicBlocked(false);
    setTurns([]);
    setLatency([]);
    setEndedAt(0);
    setPhase("starting");
    if (provider !== "simulated") {
      const mic = await requestMicrophone();
      if (mic !== "granted") {
        setMicBlocked(true);
        setPhase("idle");
        return;
      }
    }
    const res = await startTestCallAction({ wid, agentId });
    if (!res.ok) {
      setError(res.error);
      setPhase("idle");
      return;
    }
    setCallId(res.callId);
    setStartedAt(Date.now());
    if (res.session.sdk === "simulated") {
      setMode("chat");
      setStatus("connected");
      setPhase("live");
      const greeting = res.greeting;
      setTurns([{ role: "agent", text: greeting, at: 0 }]);
      void say(greeting);
      return;
    }
    setMode("voice");
    try {
      handle.current = await startVoice("", { ...(res.session as { sdk: "elevenlabs" | "retell"; token: string; url: string }), dynamicVariables: res.dynamicVariables }, {
        onStatus: (s) => {
          setStatus(s);
          if (s === "ended") finish();
        },
        onTranscript: setTurns,
        onSpeaking: setSpeaking,
        onLatency: (ms) => setLatency((l) => [...l.slice(-19), ms]),
        onError: (message) => setError(t("dash.test.err.sdk", { error: message })),
      });
      setPhase("live");
    } catch (e) {
      setError(t("dash.test.err.sdk", { error: e instanceof Error ? e.message : "" }));
      setPhase("idle");
    }
  };

  const end = async () => {
    if (mode === "voice") {
      await handle.current?.end().catch(() => undefined);
      handle.current = null;
      finish();
      return;
    }
    listener.current?.stop();
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    if (callId) await testChatAction({ wid, callId, end: true });
    finish();
  };

  const send = async (text: string) => {
    const message = text.trim();
    if (!message || !callId || sending) return;
    setDraft("");
    setSending(true);
    const sentAt = Date.now();
    setTurns((x) => [...x, { role: "caller", text: message, at: sentAt - startedAt }]);
    const res = await testChatAction({ wid, callId, message });
    setSending(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    setLatency((l) => [...l.slice(-19), Date.now() - sentAt]);
    if (res.reply) {
      setTurns((x) => [...x, { role: "agent", text: res.reply, at: Date.now() - startedAt }]);
      await say(res.reply);
    }
    if (res.end) finish();
  };

  const listen = async () => {
    if (listening) {
      listener.current?.stop();
      return;
    }
    setListening(true);
    const l = listenOnce(language);
    listener.current = l;
    const heard = await l.promise;
    setListening(false);
    if (heard) await send(heard);
  };

  const avgLatency = latency.length ? Math.round(latency.reduce((a, b) => a + b, 0) / latency.length) : 0;
  const statusText = phase === "starting" ? t("dash.test.connecting") : status === "connecting" ? t("dash.test.connecting") : speaking ? t("dash.test.agentSpeaking") : mode === "chat" ? t("dash.test.chatLive") : t("dash.test.listening");

  return (
    <div className="space-y-4">
      {provider === "simulated" ? <Alert tone="info">{t("dash.test.simulatedNote")}</Alert> : <Alert tone="info">{t("dash.test.realNote")}</Alert>}
      {micBlocked ? (
        <Alert tone="warning" title={t("dash.test.micBlocked")}>
          {t("dash.test.micHelp")}
        </Alert>
      ) : null}
      {error ? <Alert tone="error">{error}</Alert> : null}

      <div className="overflow-hidden rounded-xl border border-line bg-surface">
        <div className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
          <span className={cn("relative grid size-10 shrink-0 place-items-center rounded-full", phase === "live" ? "bg-primary text-white" : "bg-primary-soft text-primary")}>
            {phase === "live" && speaking ? <span className="absolute inset-0 animate-ping rounded-full bg-primary/40" aria-hidden /> : null}
            {mode === "chat" ? <Bot className="relative size-5" aria-hidden /> : <Phone className="relative size-5" aria-hidden />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium" role="status">
              {phase === "idle" ? t("dash.test.ready") : phase === "ended" ? t("dash.test.ended") : statusText}
            </p>
            <p className="text-xs text-muted tabular-nums">
              <bdi>{formatDuration(elapsed)}</bdi>
              {latency.length ? <> · {t("dash.test.latency", { last: latency[latency.length - 1], avg: avgLatency })}</> : null}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {phase === "live" && mode === "voice" ? (
              <Button
                variant="outline"
                size="sm"
                aria-pressed={muted}
                onClick={() => {
                  handle.current?.setMuted(!muted);
                  setMuted(!muted);
                }}
              >
                {muted ? <MicOff aria-hidden /> : <Mic aria-hidden />}
                {muted ? t("dash.test.unmute") : t("dash.test.mute")}
              </Button>
            ) : null}
            {phase === "live" ? (
              <Button variant="danger" size="sm" onClick={end}>
                <PhoneOff aria-hidden />
                {t("dash.test.end")}
              </Button>
            ) : (
              <Button size="sm" onClick={start} disabled={!canTest || phase === "starting"} aria-busy={phase === "starting"}>
                <Phone aria-hidden />
                {phase === "ended" ? t("dash.test.again") : provider === "simulated" ? t("dash.test.startChat") : t("dash.test.start")}
              </Button>
            )}
          </div>
        </div>

        <div className="max-h-[28rem] min-h-48 overflow-y-auto bg-paper/40 px-4 py-4">
          {turns.length ? (
            <TranscriptBubbles turns={turns} agentLabel={t("dash.call.agent")} callerLabel={t("dash.test.you")} live={phase === "live"} />
          ) : (
            <p className="py-10 text-center text-sm text-muted">{phase === "idle" ? (provider === "simulated" ? t("dash.test.emptyChat") : t("dash.test.emptyVoice")) : t("dash.test.waiting")}</p>
          )}
        </div>

        {phase === "live" && mode === "chat" ? (
          <div className="space-y-2 border-t border-line p-3">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void send(draft);
              }}
              className="flex items-center gap-2"
            >
              {hasRecognition ? (
                <Button variant={listening ? "primary" : "outline"} onClick={listen} aria-pressed={listening} aria-label={listening ? t("dash.test.stopListening") : t("dash.test.speak")} title={listening ? t("dash.test.stopListening") : t("dash.test.speak")}>
                  {listening ? <Ear aria-hidden /> : <Mic aria-hidden />}
                </Button>
              ) : null}
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder={listening ? t("dash.test.listeningNow") : t("dash.test.typePlaceholder")}
                aria-label={t("dash.test.typePlaceholder")}
                maxLength={1000}
                dir="auto"
                className="h-10 min-w-0 flex-1 rounded-lg border border-line bg-surface px-3 text-sm focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
                disabled={sending}
              />
              <Button type="submit" disabled={!draft.trim() || sending} aria-label={t("dash.test.send")}>
                <Send className="rtl:-scale-x-100" aria-hidden />
                <span className="hidden sm:inline">{t("dash.test.send")}</span>
              </Button>
            </form>
            {hasSynthesis ? (
              <Switch
                checked={speakReplies}
                onChange={(e) => {
                  setSpeakReplies(e.target.checked);
                  if (!e.target.checked && "speechSynthesis" in window) window.speechSynthesis.cancel();
                }}
                label={
                  <span className="inline-flex items-center gap-1.5">
                    {speakReplies ? <Volume2 className="size-4" aria-hidden /> : <VolumeX className="size-4" aria-hidden />}
                    {t("dash.test.voiceMode")}
                  </span>
                }
                description={t("dash.test.voiceModeHint")}
              />
            ) : null}
          </div>
        ) : null}
      </div>

      {phase === "ended" && callId ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-sm">
          <span className="text-muted">{provider === "simulated" ? t("dash.test.recordReady") : t("dash.test.recordSoon")}</span>
          <Link href={`/dashboard/w/${wid}/calls/${callId}`} className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
            {t("dash.test.viewRecord")}
            <ExternalLink className="size-3.5 rtl:-scale-x-100" aria-hidden />
          </Link>
        </div>
      ) : null}
    </div>
  );
}
