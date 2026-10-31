/**
 * Browser voice sessions of the provider web SDKs, behind one small interface. Shared by the
 * dashboard's test call and the embeddable widget's call panel (bundled by
 * scripts/build-widget.mjs), so it has no imports and touches the DOM only when called.
 *
 * The SDKs are pinned, licence-compatible builds served from this site (public/vendor/voice-sdk,
 * see scripts/vendor-voice-sdks.mjs) and loaded on demand:
 *   - ElevenLabs Agents: @elevenlabs/client (MIT), signed WebSocket URL from our server
 *   - Retell AI: retell-client-js-sdk (ISC) with livekit-client (Apache-2.0), access token
 * Nothing is fetched from a third-party CDN at call time.
 */

export type VoiceSdk = "elevenlabs" | "retell";

export interface VoiceTurn {
  role: "agent" | "caller";
  text: string;
  /** ms since the session started. */
  at: number;
}

export interface VoiceCallbacks {
  onStatus(status: "connecting" | "connected" | "ended"): void;
  onTranscript(turns: VoiceTurn[]): void;
  onSpeaking(agentSpeaking: boolean): void;
  /** Time from the caller's last words to the agent's answer, ms. */
  onLatency(ms: number): void;
  onError(message: string): void;
}

export interface VoiceHandle {
  setMuted(muted: boolean): void;
  end(): Promise<void>;
}

const SDK_FILES: Record<VoiceSdk, { file: string; global: string }> = {
  elevenlabs: { file: "elevenlabs-client.js", global: "ElevenLabsClient" },
  retell: { file: "retell-client.js", global: "DzRetellClient" },
};

const loading = new Map<string, Promise<unknown>>();

/** Loads one vendored SDK build once and returns its global. */
export function loadSdk(base: string, sdk: VoiceSdk): Promise<unknown> {
  const { file, global } = SDK_FILES[sdk];
  const w = window as unknown as Record<string, unknown>;
  if (w[global]) return Promise.resolve(w[global]);
  const src = `${base.replace(/\/+$/, "")}/vendor/voice-sdk/${file}`;
  let p = loading.get(src);
  if (!p) {
    p = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = () => (w[global] ? resolve(w[global]) : reject(new Error("sdk")));
      s.onerror = () => {
        loading.delete(src);
        reject(new Error("sdk"));
      };
      document.head.appendChild(s);
    });
    loading.set(src, p);
  }
  return p;
}

/** Asks for the microphone up front so the UI can explain a refusal. */
export async function requestMicrophone(): Promise<"granted" | "denied" | "unsupported"> {
  if (!navigator.mediaDevices?.getUserMedia) return "unsupported";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    stream.getTracks().forEach((track) => track.stop());
    return "granted";
  } catch {
    return "denied";
  }
}

interface ElConversation {
  endSession(): Promise<void>;
  setMicMuted(muted: boolean): void;
}
interface ElModule {
  Conversation: { startSession(options: Record<string, unknown>): Promise<ElConversation> };
}
interface RetellClient {
  startCall(config: { accessToken: string; sampleRate?: number }): Promise<void>;
  stopCall(): void;
  mute(): void;
  unmute(): void;
  on(event: string, fn: (...args: unknown[]) => void): void;
}
interface RetellModule {
  RetellWebClient: new () => RetellClient;
}

/** Merges Retell's sliding transcript window into the full list. */
export function mergeWindow(list: VoiceTurn[], window: VoiceTurn[]): VoiceTurn[] {
  if (!window.length) return list;
  const first = window[0];
  for (let k = list.length - 1; k >= Math.max(0, list.length - window.length - 1); k--) {
    const t = list[k];
    if (t.role === first.role && (first.text.startsWith(t.text) || t.text.startsWith(first.text))) {
      return [...list.slice(0, k), ...window.map((w, i) => ({ ...w, at: list[k + i]?.at ?? w.at }))];
    }
  }
  return [...list, ...window];
}

/**
 * Starts a voice session with the session data our server minted (signed URL or access token).
 * Resolves once connecting has started; progress arrives through the callbacks.
 */
export async function startVoice(base: string, session: { sdk: VoiceSdk; token: string; url: string; dynamicVariables?: Record<string, string> }, cb: VoiceCallbacks): Promise<VoiceHandle> {
  const started = Date.now();
  let turns: VoiceTurn[] = [];
  let lastCaller = 0;
  const emit = () => cb.onTranscript(turns);
  const agentStarts = () => {
    if (lastCaller) {
      cb.onLatency(Date.now() - lastCaller);
      lastCaller = 0;
    }
    cb.onSpeaking(true);
  };
  cb.onStatus("connecting");

  if (session.sdk === "elevenlabs") {
    const el = (await loadSdk(base, "elevenlabs")) as ElModule;
    const conversation = await el.Conversation.startSession({
      signedUrl: session.url,
      connectionType: "websocket",
      dynamicVariables: session.dynamicVariables ?? {},
      onConnect: () => cb.onStatus("connected"),
      onDisconnect: () => cb.onStatus("ended"),
      onError: (message: unknown) => cb.onError(typeof message === "string" ? message : "error"),
      onModeChange: ({ mode }: { mode: string }) => (mode === "speaking" ? agentStarts() : cb.onSpeaking(false)),
      onMessage: ({ source, message }: { source: string; message: string }) => {
        const role = source === "user" ? "caller" : "agent";
        if (role === "caller") lastCaller = Date.now();
        turns = [...turns, { role, text: String(message ?? ""), at: Date.now() - started }];
        emit();
      },
    });
    return { setMuted: (m) => conversation.setMicMuted(m), end: () => conversation.endSession() };
  }

  const mod = (await loadSdk(base, "retell")) as RetellModule;
  const client = new mod.RetellWebClient();
  client.on("call_started", () => cb.onStatus("connected"));
  client.on("call_ended", () => cb.onStatus("ended"));
  client.on("agent_start_talking", agentStarts);
  client.on("agent_stop_talking", () => cb.onSpeaking(false));
  client.on("error", (e: unknown) => {
    cb.onError(e instanceof Error ? e.message : String(e ?? "error"));
    client.stopCall();
  });
  client.on("update", (update: unknown) => {
    const raw = (update as { transcript?: Array<{ role?: string; content?: string }> })?.transcript;
    if (!Array.isArray(raw)) return;
    const window = raw.map((u) => ({ role: u.role === "user" ? ("caller" as const) : ("agent" as const), text: String(u.content ?? ""), at: Date.now() - started }));
    const before = turns.length;
    turns = mergeWindow(turns, window);
    if (turns.length && turns[turns.length - 1].role === "caller" && turns.length >= before) lastCaller = Date.now();
    emit();
  });
  await client.startCall({ accessToken: session.token });
  return {
    setMuted: (m) => (m ? client.mute() : client.unmute()),
    end: async () => client.stopCall(),
  };
}

// ── Simulated provider: browser speech (preview only) ──

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }>; resultIndex: number }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
}

/** The browser's speech recognition constructor, when there is one (Chrome, Edge, Safari). */
export function speechRecognition(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** Listens for one utterance; resolves with the final text ("" when nothing was heard). */
export function listenOnce(lang: string): { promise: Promise<string>; stop(): void } {
  const Ctor = speechRecognition();
  if (!Ctor) return { promise: Promise.resolve(""), stop() {} };
  const rec = new Ctor();
  rec.lang = lang;
  rec.continuous = false;
  rec.interimResults = false;
  let text = "";
  const promise = new Promise<string>((resolve) => {
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) text += e.results[i][0].transcript;
    };
    rec.onend = () => resolve(text.trim());
    rec.onerror = () => resolve(text.trim());
  });
  rec.start();
  return { promise, stop: () => rec.stop() };
}

/** A voice for a language, optionally different from `avoid` (two speakers when reading a transcript). */
export function pickVoice(lang: string, avoid?: SpeechSynthesisVoice | null): SpeechSynthesisVoice | null {
  if (!("speechSynthesis" in window)) return null;
  const voices = window.speechSynthesis.getVoices();
  const code = lang.slice(0, 2).toLowerCase();
  const matching = voices.filter((v) => v.lang.toLowerCase().startsWith(code));
  const pool = matching.length ? matching : voices;
  return pool.find((v) => v !== avoid && v.name !== avoid?.name) ?? pool[0] ?? null;
}

/** Speaks a text; resolves when done (or at once without speech synthesis). */
export function speak(text: string, lang: string, voice?: SpeechSynthesisVoice | null, rate = 1): Promise<void> {
  if (!("speechSynthesis" in window) || !text.trim()) return Promise.resolve();
  return new Promise((resolve) => {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    if (voice) u.voice = voice;
    u.rate = rate;
    u.onend = () => resolve();
    u.onerror = () => resolve();
    window.speechSynthesis.speak(u);
  });
}
