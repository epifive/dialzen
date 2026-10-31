/**
 * Dialzen web voice widget loader (public/dz-widget.js, built by scripts/build-widget.mjs; size
 * gate: 3 KB gzip). Embed:
 *
 *   <script async src="https://your-site/dz-widget.js" data-agent="AGENT_KEY"></script>
 *
 * It only fetches the widget's public settings and draws a floating button in a shadow root.
 * The call panel and the provider's voice SDK load on the first click.
 */

declare const __DZ_CALL_VERSION__: string;

interface WidgetConfig {
  title: string;
  color: string;
  position: "bottom-right" | "bottom-left";
  dir: "ltr" | "rtl";
  [key: string]: unknown;
}

interface CallModule {
  open(options: { base: string; key: string; cfg: WidgetConfig; root: ShadowRoot; anchor: HTMLElement }): void;
}

(() => {
  const script = document.currentScript as HTMLScriptElement | null;
  const key = script?.dataset.agent;
  if (!script || !key) return;
  const w = window as unknown as { __dzWidgets?: Record<string, 1>; DzWidgetCall?: CallModule };
  const seen = (w.__dzWidgets ??= {});
  if (seen[key]) return;
  seen[key] = 1;
  const base = new URL(script.src).origin;

  // No cookies are sent, so tell the site which language the page is in (its lang attribute, then
  // the browser's); the endpoint uses the first one it has installed and active.
  const lang = [document.documentElement.lang, navigator.language].filter(Boolean).join(",");
  fetch(`${base}/api/widget/${encodeURIComponent(key)}${lang ? `?lang=${encodeURIComponent(lang)}` : ""}`, { credentials: "omit" })
    .then((r) => (r.ok ? r.json() : null))
    .then((cfg: WidgetConfig | null) => {
      if (cfg) mount(cfg);
    })
    .catch(() => undefined);

  function mount(cfg: WidgetConfig) {
    const host = document.createElement("div");
    host.setAttribute("data-dialzen-widget", "");
    const root = host.attachShadow({ mode: "open" });
    const side = cfg.position === "bottom-left" ? "left" : "right";
    if (!/^#[0-9a-f]{6}$/i.test(cfg.color)) cfg.color = "#a21caf";
    root.innerHTML = `<style>:host{all:initial}.b{position:fixed;bottom:20px;${side}:20px;z-index:2147483000;display:flex;align-items:center;gap:8px;max-width:calc(100vw - 40px);padding:12px 18px;border:0;border-radius:999px;background:${cfg.color};color:#fff;font:600 15px/1.2 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.25);cursor:pointer}.b:hover{filter:brightness(1.08)}.b:focus-visible{outline:3px solid #fff;outline-offset:2px;box-shadow:0 0 0 6px ${cfg.color}}.b svg{width:18px;height:18px;flex:none}.b span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}</style><button class="b" type="button" part="button"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg><span></span></button>`;
    const button = root.querySelector("button") as HTMLButtonElement;
    (button.lastChild as HTMLElement).textContent = cfg.title;
    button.dir = cfg.dir;
    document.body.appendChild(host);

    let loading = false;
    button.addEventListener("click", () => {
      if (w.DzWidgetCall) return w.DzWidgetCall.open({ base, key: key as string, cfg, root, anchor: button });
      if (loading) return;
      loading = true;
      button.setAttribute("aria-busy", "true");
      const s = document.createElement("script");
      s.src = `${base}/dz-widget-call.js?v=${__DZ_CALL_VERSION__}`;
      s.async = true;
      s.onload = () => {
        button.removeAttribute("aria-busy");
        w.DzWidgetCall?.open({ base, key: key as string, cfg, root, anchor: button });
      };
      s.onerror = () => {
        loading = false;
        button.removeAttribute("aria-busy");
      };
      document.head.appendChild(s);
    });
  }
})();
