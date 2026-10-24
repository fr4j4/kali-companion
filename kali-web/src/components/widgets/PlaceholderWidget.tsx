/**
 * PlaceholderWidget — a type this version cannot draw yet. Says so plainly, and keeps the data
 * one click away instead of filling the window with it.
 */

import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Package, ChevronDown, ChevronRight } from "lucide-react";
import { BaseWidget } from "./base/BaseWidget";

interface Props {
  content?: unknown;
}

export function PlaceholderWidget({ content }: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const json = useMemo(() => {
    if (!content) return t("widget.placeholder.no_content");
    try {
      return JSON.stringify(content, null, 2).slice(0, 4000);
    } catch {
      return String(content).slice(0, 4000);
    }
  }, [content, t]);

  return (
    <BaseWidget>
      <div className="kw-empty-state">
        <span className="kw-empty-icon"><Package size={22} aria-hidden="true" /></span>
        <h3>{t("widget.placeholder.unrecognized")}</h3>
        <p>{t("widget.placeholder.description")}</p>
        <button type="button" className="kw-term-more" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? <ChevronDown size={12} aria-hidden="true" /> : <ChevronRight size={12} aria-hidden="true" />}
          {t("v2.placeholder.show_data")}
        </button>
        {open && <pre className="kw-raw scrollbar-thin">{json}</pre>}
      </div>
    </BaseWidget>
  );
}
