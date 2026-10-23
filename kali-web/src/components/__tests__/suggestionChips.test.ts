import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react-dom/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "../../lib/i18n";
import { SuggestionChips } from "../SuggestionChips";
import { suggestionMessage } from "../../hooks/useChat";
import type { SuggestionEvent } from "../../lib/protocol";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const SUGGESTION: SuggestionEvent = { event: "suggestion", id: "sug_1", session_id: "s", kind: "region", reason: "Puedo leer el error si me lo muestras" };

describe("suggestion chips", () => {
  let host: HTMLDivElement;
  const mount = (suggestion: SuggestionEvent | null, onChoose = vi.fn()) => {
    act(() => { createRoot(host).render(createElement(SuggestionChips, { suggestion, onChoose })); });
    return onChoose;
  };
  beforeEach(() => { vi.useFakeTimers(); host = document.createElement("div"); document.body.appendChild(host); });
  afterEach(() => { vi.useRealTimers(); host.remove(); });

  it("renders nothing without a suggestion", () => {
    mount(null);
    expect(host.innerHTML).toBe("");
  });

  it("shows the reason and the three choices, and reports the clicked one", () => {
    const onChoose = mount(SUGGESTION);
    expect(host.textContent).toContain(SUGGESTION.reason);
    const kinds = [...host.querySelectorAll("button")].map((b) => b.getAttribute("data-kind"));
    expect(kinds).toEqual(["region", "screen", "dismiss"]);
    act(() => { (host.querySelector('[data-kind="screen"]') as HTMLButtonElement).click(); });
    expect(onChoose).toHaveBeenCalledWith("screen");
  });

  it("the message sent for a choice is a normal chat sentence, not a command", () => {
    expect(suggestionMessage("region")).toMatch(/zona|area/i);
    expect(suggestionMessage("screen")).toMatch(/pantalla|screen/i);
  });
});
