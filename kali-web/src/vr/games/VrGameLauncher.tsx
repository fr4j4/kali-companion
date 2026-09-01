import { useEffect, useState } from "react";
import { Container, Text } from "@react-three/uikit";
import { GAME_CATALOG } from "../../games/game-catalog";
import { GameRegistry } from "../../games/core/game-registry";
import { registerGames } from "../../games/register-games";
import type { GameTypeValue } from "../../games/core/constants/game-types";
import { TYPE_COLORS } from "../VrMiniCard";

const CAT_COLORS: Record<string, string> = {
  single: "#38bdf8", coop: "#34d399", versus: "#f472b6", trivia: "#fbbf24",
};

/**
 * B2: catálogo de juegos dentro del artefacto "game" en VR.
 * Cada card: dot de color por categoría (la fuente MSDF no tiene emojis),
 * nombre, descripción corta, badge jugadores, botón Jugar.
 */
export function VrGameLauncher({ onLaunch }: { onLaunch: (gt: GameTypeValue) => void }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!GameRegistry.isRegistered("snake" as GameTypeValue)) registerGames();
    setTick((v) => v + 1);
  }, []);
  void tick; // fuerza re-render post-registro

  return (
    <Container flexDirection="column" gap={8} width="100%">
      <Text fontSize={12} color="#f43f5e" fontWeight={700}>Juegos — toca Jugar</Text>
      {GAME_CATALOG.map((g) => {
        const available = GameRegistry.isRegistered(g.id);
        const catColor = CAT_COLORS[g.category] ?? "#64748b";
        return (
          <Container key={g.id} flexDirection="row" alignItems="center" gap={8} backgroundColor="#111827" borderRadius={8} padding={8}>
            <Container width={10} height={10} borderRadius={5} backgroundColor={catColor} />
            <Container flexDirection="column" flexGrow={1} gap={2}>
              <Container flexDirection="row" gap={6} alignItems="center">
                <Text fontSize={11} color="#e2e8f0">{g.name}</Text>
                <Text fontSize={8} color="#64748b">{g.players}</Text>
              </Container>
              <Text fontSize={9} color="#94a3b8">{g.description.slice(0, 64)}</Text>
            </Container>
            {available ? (
              <Container backgroundColor="#22c55e" borderRadius={6} padding={8} hover={{ backgroundColor: "#16a34a" }} onClick={() => onLaunch(g.id)}>
                <Text fontSize={10} color="#022c22" fontWeight={700}>Jugar</Text>
              </Container>
            ) : (
              <Container backgroundColor="#1e293b" borderRadius={6} padding={8}>
                <Text fontSize={9} color="#64748b">pronto</Text>
              </Container>
            )}
          </Container>
        );
      })}
      <Text fontSize={8} color="#475569">{TYPE_COLORS ? "" : ""}los que aparecen como "pronto" aún no están implementados</Text>
    </Container>
  );
}
