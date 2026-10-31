/**
 * Call panel of the Dialzen web voice widget (public/dz-widget-call.js), loaded by the loader on
 * the first click. Talks through the provider's web SDK (sdk.ts, vendored builds loaded from
 * this site), or chats in text when the agent runs on the simulated provider.
 */

import { listenOnce, requestMicrophone, speechRecognition, startVoice, type VoiceHandle, type VoiceTurn } from "./sdk";

interface Labels {
  start: string;
  connecting: string;
  listening: string;
  speaking: string;
  chatting: string;
  end: string;
  mute: string;
  unmute: string;
  send: string;
  speak: string;
  type: string;
  ended: string;
  again: string;
  mic: string;
  error: string;
  busy: string;
  unavailable: string;
  close: string;
  notice: string;
  you: string;
  agent: string;
}

interface Config {
  title: string;
  color: string;
  position: "bottom-right" | "bottom-left";
  mode: "voice" | "chat";
  lang: string;
  dir: "ltr" | "rtl";
  name: string;
  poweredBy: string;
  labels: Labels;
}

interface OpenOptions {
  base: string;
  key: string;
  cfg: Config;
  root: ShadowRoot;
  anchor: HTMLElement;
}

const CSS = (c: Config) => {
  const side = c.position === "bottom-left" ? "left" : "right";
  return `.p{position:fixed;bottom:84px;${side}:20px;z-index:2147483001;width:min(360px,calc(100vw - 24px));max-height:min(560px,calc(100vh - 110px));display:flex;flex-direction:column;background:#fff;color:#1f1d24;border-radius:18px;box-shadow:0 18px 50px rgba(0,0,0,.28);overflow:hidden;font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
@media (max-width:480px){.p{${side}:12px;bottom:76px}}
@media (prefers-color-scheme:dark){.p{background:#1d1b22;color:#f1eef6}.m.a{background:#2a2731}.f input{background:#141218;color:#f1eef6;border-color:#3a3642}.n{background:#24212b}}
.h{display:flex;align-items:center;gap:10px;padding:12px 14px;background:${c.color};color:#fff}
.h b{display:block;font-size:15px}.h small{opacity:.85}.h div{flex:1;min-width:0}.h b,.h small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:block}
.x{background:transparent;border:0;color:#fff;font-size:22px;line-height:1;cursor:pointer;padding:4px 6px;border-radius:8px}.x:focus-visible,.btn:focus-visible{outline:2px solid ${c.color};outline-offset:2px}
.n{font-size:12px;padding:8px 14px;background:#f6f3f8;color:inherit;opacity:.85}
.t{flex:1;overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:8px;min-height:120px}
.m{max-width:82%;padding:8px 12px;border-radius:16px;white-space:pre-wrap;word-wrap:break-word}
.m.a{align-self:flex-start;background:#f1edf4;border-end-start-radius:4px}
.m.c{align-self:flex-end;background:${c.color};color:#fff;border-end-end-radius:4px}
.s{display:flex;align-items:center;gap:8px;padding:6px 14px;font-size:12px;opacity:.8}
.d{width:8px;height:8px;border-radius:50%;background:#bbb}.d.on{background:#16a34a}.d.sp{background:${c.color};animation:k 1s infinite}
@keyframes k{50%{opacity:.3}}
.f{display:flex;gap:8px;padding:10px 12px;border-top:1px solid rgba(127,127,127,.2);align-items:center}
.f input{flex:1;min-width:0;height:38px;border:1px solid #ddd;border-radius:10px;padding:0 10px;font:inherit}
.btn{height:38px;border:0;border-radius:10px;padding:0 14px;font:600 14px system-ui,sans-serif;cursor:pointer;background:${c.color};color:#fff;white-space:nowrap}
.btn.o{background:transparent;color:inherit;border:1px solid rgba(127,127,127,.4)}.btn.r{background:#dc2626}.btn.w{flex:1}
.btn[disabled]{opacity:.5;cursor:default}
.e{color:#dc2626;font-size:12px;padding:0 14px 8px}
.pw{font-size:11px;text-align:center;opacity:.6;padding:0 0 8px}`;
};

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

let panel: HTMLElement | null = null;

function open({ base, key, cfg, root, anchor }: OpenOptions) {
  if (panel) {
    panel.hidden = !panel.hidden;
    anchor.setAttribute("aria-expanded", String(!panel.hidden));
    return;
  }
  const L = cfg.labels;
  const api = `${base}/api/widget/${encodeURIComponent(key)}`;
  const style = el("style");
  style.textContent = CSS(cfg);
  root.appendChild(style);

  const p = el("div", "p");
  p.dir = cfg.dir;
  p.setAttribute("role", "dialog");
  p.setAttribute("aria-label", cfg.title);
  const head = el("div", "h");
  const titles = el("div");
  titles.append(el("b", "", cfg.title), el("small", "", cfg.name));
  const close = el("button", "x", "×");
  close.type = "button";
  close.setAttribute("aria-label", L.close);
  head.append(titles, close);
  const notice = el("div", "n", L.notice);
  const list = el("div", "t");
  list.setAttribute("aria-live", "polite");
  const status = el("div", "s");
  const dot = el("span", "d");
  const statusText = el("span", "", "");
  status.append(dot, statusText);
  const err = el("div", "e");
  err.setAttribute("role", "alert");
  const foot = el("div", "f");
  p.append(head, notice, list, status, err, foot);
  if (cfg.poweredBy) p.append(el("div", "pw", cfg.poweredBy));
  root.appendChild(p);
  panel = p;
  anchor.setAttribute("aria-expanded", "true");

  let handle: VoiceHandle | null = null;
  let chatToken = "";
  let live = false;
  let muted = false;

  const setStatus = (text: string, cls = "") => {
    statusText.textContent = text;
    dot.className = `d ${cls}`;
  };
  const render = (turns: Array<{ role: string; text: string }>) => {
    list.replaceChildren(
      ...turns.map((tn) => {
        const m = el("div", `m ${tn.role === "agent" ? "a" : "c"}`, tn.text);
        m.dir = "auto";
        m.setAttribute("aria-label", `${tn.role === "agent" ? L.agent : L.you}: ${tn.text}`);
        return m;
      }),
    );
    list.scrollTop = list.scrollHeight;
  };
  let chat: VoiceTurn[] = [];
  const push = (role: "agent" | "caller", text: string) => {
    chat = [...chat, { role, text, at: 0 }];
    render(chat);
  };

  const button = (label: string, cls: string, fn: () => void) => {
    const b = el("button", `btn ${cls}`, label);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  };

  const idle = (again = false) => {
    live = false;
    handle = null;
    setStatus(again ? L.ended : "");
    foot.replaceChildren(button(again ? L.again : L.start, "w", start));
  };

  const finish = () => {
    if (!live) return;
    idle(true);
  };

  const post = async (url: string, body: unknown) => {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(body), credentials: "omit" });
    const j = (await r.json().catch(() => ({}))) as Record<string, string> & { dynamicVariables?: Record<string, string> };
    // A suspended account (403 "suspended") gets a neutral message, never the reason.
    if (!r.ok) throw new Error(r.status === 403 && j.error === "suspended" ? L.unavailable || L.busy : r.status === 429 || r.status === 402 ? L.busy : L.error);
    return j;
  };

  async function start() {
    err.textContent = "";
    chat = [];
    render([]);
    foot.replaceChildren();
    setStatus(L.connecting);
    if (cfg.mode === "voice" && (await requestMicrophone()) !== "granted") {
      err.textContent = L.mic;
      return idle();
    }
    let s: Record<string, string> & { dynamicVariables?: Record<string, string> };
    try {
      s = await post(`${api}/token`, {});
    } catch (e) {
      err.textContent = (e as Error).message;
      return idle();
    }
    live = true;
    if (s.sdk === "simulated") {
      chatToken = s.chatToken;
      if (s.greeting) push("agent", s.greeting);
      setStatus(L.chatting, "on");
      return chatControls();
    }
    try {
      handle = await startVoice(base, { sdk: s.sdk as "elevenlabs" | "retell", token: s.token, url: s.url, dynamicVariables: s.dynamicVariables }, {
        onStatus: (st) => (st === "ended" ? finish() : setStatus(st === "connected" ? L.listening : L.connecting, st === "connected" ? "on" : "")),
        onTranscript: render,
        onSpeaking: (sp) => live && setStatus(sp ? L.speaking : L.listening, sp ? "sp" : "on"),
        onLatency: () => undefined,
        onError: () => {
          err.textContent = L.error;
        },
      });
    } catch {
      err.textContent = L.error;
      return idle();
    }
    const mute = button(L.mute, "o", () => {
      muted = !muted;
      handle?.setMuted(muted);
      mute.textContent = muted ? L.unmute : L.mute;
      mute.setAttribute("aria-pressed", String(muted));
    });
    foot.replaceChildren(mute, button(L.end, "r w", () => void handle?.end().finally(finish)));
  }

  function chatControls() {
    const form = el("form");
    form.style.cssText = "display:contents";
    const input = el("input");
    input.placeholder = L.type;
    input.setAttribute("aria-label", L.type);
    input.maxLength = 1000;
    input.dir = "auto";
    const send = el("button", "btn", L.send);
    send.type = "submit";
    form.append(input, send);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text || !live) return;
      input.value = "";
      send.disabled = true;
      push("caller", text);
      try {
        const r = await post(`${api}/chat`, { chatToken, message: text });
        if (r.reply) push("agent", r.reply);
        if (r.end) finish();
      } catch (e2) {
        err.textContent = (e2 as Error).message;
      }
      send.disabled = false;
      input.focus();
    });
    const extra: HTMLElement[] = [];
    if (speechRecognition()) {
      const mic = button("🎤", "o", async () => {
        const heard = await listenOnce(cfg.lang).promise;
        if (heard) {
          input.value = heard;
          form.requestSubmit();
        }
      });
      mic.setAttribute("aria-label", L.speak);
      mic.title = L.speak;
      extra.push(mic);
    }
    foot.replaceChildren(...extra, form, button(L.end, "r", () => void post(`${api}/chat`, { chatToken, end: true }).catch(() => undefined).finally(finish)));
    input.focus();
  }

  close.addEventListener("click", () => {
    p.hidden = true;
    anchor.setAttribute("aria-expanded", "false");
    anchor.focus();
  });
  idle();
}

(window as unknown as { DzWidgetCall: { open: typeof open } }).DzWidgetCall = { open };
