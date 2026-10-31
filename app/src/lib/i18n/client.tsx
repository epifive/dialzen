"use client";

import { createContext, useCallback, useContext, type ReactNode } from "react";
import { interpolate, MESSAGES, type MessageKey, type Translator } from "./messages";

const I18nContext = createContext<Record<string, string> | null>(null);

/** Provides translated interface strings to client components. */
export function I18nProvider({ messages, children }: { messages: Record<string, string>; children: ReactNode }) {
  return <I18nContext.Provider value={messages}>{children}</I18nContext.Provider>;
}

/** Translation function for client components. Falls back to English outside a provider. */
export function useT(): Translator {
  const messages = useContext(I18nContext);
  return useCallback(
    (key: MessageKey, vars?: Record<string, string | number>) => interpolate(messages?.[key] ?? MESSAGES[key], vars),
    [messages],
  );
}
