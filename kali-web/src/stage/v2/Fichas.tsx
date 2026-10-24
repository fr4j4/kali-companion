/**
 * stage/v2/Fichas.tsx — «Anteriores»: the Hub's cards for the artifacts that were on the lámina.
 *
 *   Escucha   a row above the dock      [▤ Plan] [</> styles.css] [▣ Terminal]  Ver todas
 *   Lámina    a list in Kali's column   ANTERIORES
 *                                       ▤ Plan            Documento
 *                                       </> styles.css    Código
 *
 * A card is 44 units tall: the type icon, the title and the type. A click brings it back to the
 * lámina; the × on hover closes the artifact (it stays in the library and in "Recently closed").
 * At most eight; the rest are one click away on the board.
 */

import { useTranslation } from "react-i18next";
import { X } from "lucide-react";
import type { CSSProperties } from "react";
import type { WindowData } from "../../workspace/types";
import { WindowTypeIcon } from "../windowIcons";

export const MAX_FICHAS = 8;

interface Props {
  ids: number[];
  windows: WindowData[];
  layout: "row" | "column";
  onShow: (id: number) => void;
  onClose: (id: number) => void;
  /** «Ver todas»: the board. */
  onAll: () => void;
  style?: CSSProperties;
}

export function Fichas({ ids, windows, layout, onShow, onClose, onAll, style }: Props) {
  const { t } = useTranslation();
  const cards = ids.map((id) => windows.find((w) => w.id === id && !w.closed)).filter((w): w is WindowData => !!w);
  if (!cards.length) return null;
  const shown = cards.slice(0, MAX_FICHAS);
  return (
    <section className={`v2-fichas is-${layout}`} style={style} aria-label={t("v2.panel.previous") as string}>
      {layout === "column" && <h3 className="v2-label">{t("v2.panel.previous")}</h3>}
      <ul>
        {shown.map((w) => (
          <li key={w.id} className="v2-ficha">
            <button type="button" className="v2-ficha-main" onClick={() => onShow(w.id)} title={t("v2.hub.show", { title: w.title }) as string}>
              <span className="v2-type-tile sm" aria-hidden="true"><WindowTypeIcon type={w.type} size={14} /></span>
              <span className="v2-ficha-title">{w.title}</span>
              {layout === "column" && <small>{t(`v2.type.${w.type}`, { defaultValue: w.type })}</small>}
            </button>
            <button type="button" className="v2-ficha-x" onClick={() => onClose(w.id)} aria-label={t("v2.hub.close_card", { title: w.title }) as string} title={t("window.close") as string}>
              <X size={12} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      {cards.length > MAX_FICHAS && (
        <button type="button" className="v2-ficha-all" onClick={onAll}>{t("v2.hub.see_all", { count: cards.length })}</button>
      )}
    </section>
  );
}
