import { describe, expect, it } from "vitest";
import { analyzeAssistantText, analyzeUserText } from "./textEmotionAnalyzer";

describe("textEmotionAnalyzer", () => {
  it("detects assistant surprise cues", () => {
    expect(analyzeAssistantText("Wow, eso fue inesperado")).toEqual({
      emotion: "sorprendido",
      confidence: 0.7,
    });
  });

  it("detects assistant failure cues", () => {
    expect(analyzeAssistantText("Failed to complete the task")).toEqual({
      emotion: "enojado",
      confidence: 0.7,
    });
  });

  it("detects user frustration cues", () => {
    expect(analyzeUserText("No funciona y estoy stuck")).toEqual({
      emotion: "confundido",
      confidence: 0.6,
    });
  });

  it("detects gratitude cues", () => {
    expect(analyzeUserText("Gracias, quedó perfecto")).toEqual({
      emotion: "feliz",
      confidence: 0.6,
    });
  });

  it("defaults to normal when no cue is present", () => {
    expect(analyzeAssistantText("Proceso en curso")).toEqual({
      emotion: "normal",
      confidence: 0.5,
    });
  });

  it("detects assistant sadness emoji", () => {
    expect(analyzeAssistantText("Lo siento mucho 😔")).toEqual({
      emotion: "triste",
      confidence: 0.7,
    });
  });

  it("detects assistant laughter as happy", () => {
    expect(analyzeAssistantText("jaja, qué divertido 😂")).toEqual({
      emotion: "feliz",
      confidence: 0.7,
    });
  });

  it("detects assistant confusion/apology", () => {
    expect(analyzeAssistantText("Me equivoqué, no entendí bien")).toEqual({
      emotion: "confundido",
      confidence: 0.7,
    });
  });

  it("detects assistant playful surprise", () => {
    expect(analyzeAssistantText("oooh, no esperaba eso!")).toEqual({
      emotion: "sorprendido",
      confidence: 0.7,
    });
  });

  it("does not match 'te quiero' as happy (ambiguous)", () => {
    expect(analyzeAssistantText("ya no te quiero")).toEqual({
      emotion: "normal",
      confidence: 0.5,
    });
  });
});
