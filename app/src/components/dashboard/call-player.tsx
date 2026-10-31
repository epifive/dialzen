"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Bot, Pause, Play, User, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";
import { formatDuration } from "@/voice/format";
import type { TranscriptTurn } from "@/voice/types";
import { pickVoice, speak } from "@/widget/sdk";

const noop = () => () => {};

/**
 * The recording (or, for simulated calls, the transcript read aloud by the browser with two
 * voices) and the timestamped transcript. The turn being played is highlighted; clicking a
 * timestamp seeks the recording.
 */
export function CallTranscriptPlayer({
  turns,
  recordingSrc,
  recordingUnavailable = false,
  simulated,
  language,
}: {
  turns: TranscriptTurn[];
  recordingSrc: string | null;
  /** The recording is only in the workspace's own provider account, whose keys were removed. */
  recordingUnavailable?: boolean;
  simulated: boolean;
  language: string;
}) {
  const t = useT();
  const audio = useRef<HTMLAudioElement>(null);
  const [current, setCurrent] = useState(-1);
  const [playing, setPlaying] = useState(false);
  const [recordingFailed, setRecordingFailed] = useState(false);
  const stop = useRef(false);
  const hasSynthesis = useSyncExternalStore(noop, () => "speechSynthesis" in window, () => false);

  useEffect(
    () => () => {
      stop.current = true;
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    },
    [],
  );

  const onTime = () => {
    const at = audio.current?.currentTime ?? 0;
    let idx = -1;
    turns.forEach((turn, i) => {
      if (turn.at <= at + 0.25) idx = i;
    });
    setCurrent(idx);
  };

  const readAloud = async () => {
    if (playing) {
      stop.current = true;
      window.speechSynthesis.cancel();
      setPlaying(false);
      setCurrent(-1);
      return;
    }
    stop.current = false;
    setPlaying(true);
    // Voices load asynchronously in some browsers.
    if (!window.speechSynthesis.getVoices().length) await new Promise((r) => setTimeout(r, 300));
    const agentVoice = pickVoice(language);
    const callerVoice = pickVoice(language, agentVoice);
    for (let i = 0; i < turns.length; i++) {
      if (stop.current) break;
      const turn = turns[i];
      if (turn.role === "tool") continue;
      setCurrent(i);
      await speak(turn.text, language, turn.role === "agent" ? agentVoice : callerVoice, turn.role === "agent" ? 1.02 : 0.96);
    }
    setPlaying(false);
    setCurrent(-1);
  };

  const seek = (at: number) => {
    if (!audio.current) return;
    audio.current.currentTime = at;
    void audio.current.play().catch(() => undefined);
  };

  return (
    <div className="space-y-4">
      {recordingSrc && !recordingFailed ? (
        <audio ref={audio} controls preload="metadata" src={recordingSrc} onTimeUpdate={onTime} onError={() => setRecordingFailed(true)} className="w-full">
          {t("dash.call.noAudioSupport")}
        </audio>
      ) : simulated ? (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-paper px-3 py-2">
          <Button size="sm" variant={playing ? "outline" : "primary"} onClick={readAloud} disabled={!hasSynthesis || !turns.length}>
            {playing ? <Pause aria-hidden /> : <Play aria-hidden />}
            {playing ? t("dash.call.stopPlaying") : t("dash.call.playSimulated")}
          </Button>
          <span className="text-xs text-muted">{hasSynthesis ? t("dash.call.simulatedAudio") : t("dash.call.noSpeech")}</span>
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-line px-3 py-2 text-sm text-muted">{recordingFailed ? t("dash.call.recordingFailed") : recordingUnavailable ? t("dash.call.recordingUnavailable") : t("dash.call.noRecording")}</p>
      )}

      {turns.length ? (
        <ol className="space-y-3">
          {turns.map((turn, i) => {
            if (turn.role === "tool") {
              return (
                <li key={i} className="flex items-center justify-center gap-2 text-xs text-muted">
                  <Wrench className="size-3.5" aria-hidden />
                  <span dir="auto">{turn.text}</span>
                </li>
              );
            }
            const agent = turn.role === "agent";
            return (
              <li key={i} className={cn("flex items-start gap-2", agent ? "" : "flex-row-reverse")}>
                <span className={cn("mt-1 grid size-7 shrink-0 place-items-center rounded-full", agent ? "bg-primary-soft text-primary" : "bg-line text-ink")} aria-hidden>
                  {agent ? <Bot className="size-4" /> : <User className="size-4" />}
                </span>
                <div className={cn("max-w-[85%] min-w-0", agent ? "" : "text-end")}>
                  <div className={cn("mb-0.5 flex items-center gap-2 text-[11px] text-muted", agent ? "" : "flex-row-reverse")}>
                    <span className="font-medium">{agent ? t("dash.call.agent") : t("dash.call.caller")}</span>
                    {recordingSrc && !recordingFailed ? (
                      <button type="button" onClick={() => seek(turn.at)} className="tabular-nums hover:text-primary" aria-label={t("dash.call.seek", { time: formatDuration(turn.at) })}>
                        <bdi>{formatDuration(turn.at)}</bdi>
                      </button>
                    ) : (
                      <bdi className="tabular-nums">{formatDuration(turn.at)}</bdi>
                    )}
                  </div>
                  <p
                    dir="auto"
                    className={cn(
                      "inline-block rounded-2xl px-3.5 py-2 text-start text-sm whitespace-pre-wrap transition-shadow",
                      agent ? "rounded-ss-sm bg-paper ring-1 ring-line" : "rounded-se-sm bg-primary-soft",
                      current === i && "ring-2 ring-primary",
                    )}
                    aria-current={current === i ? "true" : undefined}
                  >
                    {turn.text}
                  </p>
                </div>
              </li>
            );
          })}
        </ol>
      ) : (
        <p className="text-sm text-muted">{t("dash.call.noTranscript")}</p>
      )}
    </div>
  );
}
