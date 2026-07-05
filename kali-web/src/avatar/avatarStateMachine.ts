import type { AvatarState, AvatarEmotion } from "./avatarConfig";
import type { EmotionProvider, EmotionContext } from "./EmotionProvider";
import type { DebugAvatarState } from "./debugAvatarState";

export interface AvatarContext extends EmotionContext {
  debug: DebugAvatarState;
  consentRequest: unknown | null;
  ttsPlaying: boolean;
  pttState: "idle" | "recording" | "listening" | "processing";
  streaming: boolean;
  typing: boolean;
  overrideEmotion?: { emotion: AvatarEmotion; until: number } | null;
  currentMood: AvatarEmotion;
  emotionProvider: EmotionProvider;
  staleToolKey: string | null;
  lastActivityTs: number;
  sleepMs: number;
}

function _toolKey(e: { session_id: string; tool: string }) {
  return `${e.session_id}::${e.tool}`;
}

export function deriveState(ctx: AvatarContext): AvatarState {
  if (ctx.debug.overrideState) return ctx.debug.overrideState;
  if (ctx.consentRequest) return "idle";
  const hasLiveTool = ctx.toolEvents.some(
    (e) => e.status === "running" && _toolKey(e) !== ctx.staleToolKey,
  );
  if (hasLiveTool) return "idle";
  if (ctx.ttsPlaying) return "hablando";
  if (ctx.pttState === "recording" || ctx.pttState === "listening") return "escuchando";
  if (ctx.streaming) return "pensando";
  const idleTime = ctx.now - ctx.lastActivityTs;
  if (idleTime > ctx.sleepMs) return "durmiendo";
  return "idle";
}

export async function deriveEmotion(
  ctx: AvatarContext,
  _state: AvatarState,
): Promise<AvatarEmotion> {
  if (ctx.overrideEmotion && ctx.now < ctx.overrideEmotion.until) {
    return ctx.overrideEmotion.emotion;
  }

  if (ctx.debug.overrideEmotion && ctx.debug.forceEmotion) {
    return ctx.debug.overrideEmotion;
  }

  const hasLiveTool = ctx.toolEvents.some(
    (e) => e.status === "running" && _toolKey(e) !== ctx.staleToolKey,
  );
  if (hasLiveTool) {
    return "concentrado";
  }

  if (ctx.consentRequest) {
    return "esperando";
  }

  const llmResult = await ctx.emotionProvider.getEmotion(ctx);

  const lastTool = ctx.toolEvents[ctx.toolEvents.length - 1];
  if (lastTool && lastTool.status === "error" && !llmResult.emotion) {
    return "confundido";
  }

  if (llmResult.emotion) {
    return llmResult.emotion;
  }

  return ctx.currentMood;
}
