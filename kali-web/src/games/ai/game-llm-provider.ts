import type { ConnectionSummary, StatusEvent } from "../../lib/protocol";

export interface GameLLMProvider {
  complete(prompt: string): Promise<string>;
}

/**
 * Build a lightweight LLM provider for in-game AI slots from the current
 * system status. Returns null when no LLM is configured, allowing the UI to
 * disable Kali-as-opponent modes gracefully.
 *
 * Note: The primary game AI path goes through the backend (WS → _handle_game_move
 * → llm.stream). This provider exists only for UI-side integration checks.
 */
export function createGameLLMProvider(_systemStatus: StatusEvent | null): GameLLMProvider | null {
  return null;
}

export function hasLLMIntegration(
  systemStatus: StatusEvent | null,
  connections: ConnectionSummary[],
): boolean {
  if (!systemStatus) return false;

  const gameConnId = systemStatus.game_connection_id;
  if (!gameConnId || gameConnId === "active") {
    return Boolean(systemStatus.llm_provider && systemStatus.llm_api_url && systemStatus.llm_model);
  }

  const conn = connections.find((c) => c.id === gameConnId);
  return Boolean(conn && conn.model_count > 0);
}
