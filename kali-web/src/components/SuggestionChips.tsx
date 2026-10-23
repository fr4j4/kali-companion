// SuggestionChips — Kali offers to look at the screen; the user picks, nothing is captured here.
//
// Choosing only sends a short chat message (the capture still waits for the consent card on the
// user's computer). "Not now" is remembered by the server and makes Kali stay quiet for a while.

import { useTranslation } from "react-i18next";
import type { SuggestionChoice, SuggestionEvent } from "../lib/protocol";

interface Props {
  suggestion: SuggestionEvent | null;
  onChoose: (choice: SuggestionChoice) => void;
}

/** The chat hook hides the chips on its own after this long, without counting it as a refusal. */
export const SUGGESTION_VISIBLE_MS = 30000;

export function SuggestionChips({ suggestion, onChoose }: Props) {
  const { t } = useTranslation();
  if (!suggestion) return null;
  const chip = "rounded-full border border-border bg-surface px-3 py-1 text-sm hover:bg-surface-hover focus:outline-none focus:ring-2 focus:ring-accent";
  return (
    <div role="group" aria-label={t("suggestion.label") as string}
      className="pointer-events-auto fixed bottom-24 left-1/2 z-40 flex max-w-[90vw] -translate-x-1/2 flex-col items-center gap-2 rounded-2xl border border-border bg-surface/95 p-3 shadow-lg">
      {suggestion.reason && <p className="text-sm text-text">{suggestion.reason}</p>}
      <div className="flex flex-wrap justify-center gap-2">
        <button type="button" className={chip} data-kind="region" onClick={() => onChoose("region")}>{t("suggestion.region")}</button>
        <button type="button" className={chip} data-kind="screen" onClick={() => onChoose("screen")}>{t("suggestion.screen")}</button>
        <button type="button" className={chip} data-kind="dismiss" onClick={() => onChoose("dismiss")}>{t("suggestion.dismiss")}</button>
      </div>
    </div>
  );
}
