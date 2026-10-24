import { createElement } from "react";
import { createRoot } from "react-dom/client";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useCanvasKeys } from "../useCanvasKeys";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function mount(back: () => boolean) {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  const actions = { palette: vi.fn(), mode: vi.fn(), windowAt: vi.fn(), space: vi.fn(), fullscreen: vi.fn(), back };
  function Probe() { useCanvasKeys(actions, []); return null; }
  act(() => root.render(createElement(Probe)));
  return () => { act(() => root.unmount()); host.remove(); };
}

function escapeOn(el: HTMLElement) {
  el.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }));
}

describe("useCanvasKeys Escape", () => {
  afterEach(() => { document.body.innerHTML = ""; });

  it("leaves a text field alone when no overlay is open", () => {
    const back = vi.fn(() => true);
    const unmount = mount(back);
    const input = document.body.appendChild(document.createElement("input"));
    escapeOn(input);
    expect(back).not.toHaveBeenCalled();
    unmount();
  });

  it("closes an overlay from its own empty search field", () => {
    const back = vi.fn(() => true);
    const unmount = mount(back);
    const board = document.body.appendChild(document.createElement("div"));
    board.className = "v2-board";
    const input = board.appendChild(document.createElement("input"));
    escapeOn(input);
    expect(back).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("lets a search field with text clear it first", () => {
    const back = vi.fn(() => true);
    const unmount = mount(back);
    const panel = document.body.appendChild(document.createElement("div"));
    panel.className = "v2-board";
    const input = panel.appendChild(document.createElement("input"));
    input.value = "ventas";
    escapeOn(input);
    expect(back).not.toHaveBeenCalled();
    unmount();
  });

  it("closes an overlay from the composer below it", () => {
    const back = vi.fn(() => true);
    const unmount = mount(back);
    document.body.appendChild(document.createElement("div")).className = "v2-palette";
    const composer = document.body.appendChild(document.createElement("textarea"));
    composer.value = "hola";
    escapeOn(composer);
    expect(back).toHaveBeenCalledTimes(1);
    unmount();
  });
});
