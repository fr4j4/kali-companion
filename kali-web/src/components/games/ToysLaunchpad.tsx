import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { WorkspaceAPI } from "../../workspace/types";
import { GAME_CATALOG, CATEGORIES, type GameEntry } from "../../games/game-catalog";
import { GameRegistry } from "../../games/core/game-registry";
import { registerGames } from "../../games/register-games";

let registered = false;
function ensureRegistered() {
  if (!registered) {
    registerGames();
    registered = true;
  }
}

interface Props {
  api?: WorkspaceAPI;
}

function GameCard({ game, onPlay }: { game: GameEntry; onPlay: (g: GameEntry) => void }) {
  const { i18n } = useTranslation();
  const isEs = i18n.language?.startsWith("es");
  const available = GameRegistry.isRegistered(game.id);

  return (
    <button
      onClick={() => available && onPlay(game)}
      disabled={!available}
      className={`flex flex-col items-start gap-1 p-3 rounded-xl transition-colors text-left border ${
        available
          ? "bg-white/5 hover:bg-white/10 active:bg-white/15 border-transparent hover:border-white/10 group cursor-pointer"
          : "bg-white/[0.02] border-white/5 opacity-30 grayscale cursor-not-allowed"
      }`}
    >
      <span className="text-xl">{game.icon}</span>
      <span className="text-sm font-medium text-fg group-hover:text-accent transition-colors">
        {isEs ? game.nameEs : game.name}
      </span>
      <span className="text-[11px] text-muted leading-tight line-clamp-2">
        {isEs ? game.descriptionEs : game.description}
      </span>
      <span className="text-[10px] text-muted/60 mt-1">{game.players}</span>
    </button>
  );
}

export function ToysLaunchpad({ api }: Props) {
  const { t, i18n } = useTranslation();
  const isEs = i18n.language?.startsWith("es");
  const [, setTick] = useState(0);

  useEffect(() => {
    ensureRegistered();
    setTick((v) => v + 1);
  }, []);

  const handlePlay = useCallback((game: GameEntry) => {
    if (!api) return;
    api.createWindow("game", {
      title: isEs ? game.nameEs : game.name,
      icon: game.icon,
      content: { mode: "game", gameType: game.id },
      width: 520,
      height: 500,
      resizable: true,
      minW: 320,
      minH: 360,
    });
  }, [api, isEs]);

  return (
    <div className="flex flex-col flex-1 min-h-0 p-4 gap-4 overflow-y-auto">
      <h2 className="text-lg font-semibold text-fg flex items-center gap-2">
        <span>{'\u{1F3AE}'}</span>
        {t("game_launchpad.title", "Juegos")}
      </h2>
      <p className="text-sm text-muted/80 -mt-2">
        {t("game_launchpad.subtitle", "Seleccioná un juego. Kali puede ocupar cualquier rol.")}
      </p>
      {CATEGORIES.map((cat) => {
        const games = GAME_CATALOG.filter((g) => g.category === cat.id);
        if (games.length === 0) return null;
        return (
          <section key={cat.id}>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-muted/60 mb-2">
              {isEs ? cat.labelEs : cat.label}
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {games.map((game) => (
                <GameCard key={game.id} game={game} onPlay={handlePlay} />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
