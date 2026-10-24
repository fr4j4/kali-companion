/**
 * ReasoningWidget — how Kali got to her last answer, as quiet serif notes. While she is still
 * thinking the text grows with a cursor at the end.
 */

import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ScrollableWidget } from "./base/ScrollableWidget";
import { useHeaderActions, type HeaderAction } from "./hooks/useHeaderActions";
import { useStage } from "../../stage/StageProvider";
import { WidgetFooter, WidgetToolbar } from "./base/WidgetChrome";
import { useShellSubtitle } from "../../stage/v2/shell";
import { wordCount } from "./DocumentWidget";

export function ReasoningWidget() {
  const { t } = useTranslation();
  const { chat } = useStage();

  const { text, live } = useMemo(() => {
    const msgs = [...chat.messages].reverse();
    const lastMsg = msgs.find((m) => m.reasoning);
    return { text: lastMsg?.reasoning ?? "", live: !!chat.isTurnActive && msgs[0] === lastMsg };
  }, [chat.messages, chat.isTurnActive]);

  const actions: HeaderAction[] = useMemo(() => [{ type: "copy", getContent: () => text, tip: t("widget.document.copy") }], [text, t]);
  const { rendered: headerActions } = useHeaderActions(actions);
  const paragraphs = useMemo(() => text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean), [text]);

  useShellSubtitle(live ? t("v2.reasoning.thinking") : t("v2.reasoning.last_answer"));

  return (
    <ScrollableWidget searchable={false} autoScroll>
      <WidgetToolbar>{headerActions}</WidgetToolbar>
      <div className="kw-reasoning">
        {paragraphs.length === 0 && <p className="kw-empty">{t("v2.reasoning.empty")}</p>}
        {paragraphs.map((p, i) => (
          <p key={i}>
            {p}
            {live && i === paragraphs.length - 1 && <span className="kw-term-caret" aria-hidden="true" />}
          </p>
        ))}
      </div>
      <WidgetFooter>
        <span className="v2-foot-item">{t("v2.subtitle.words", { count: wordCount(text) })}</span>
      </WidgetFooter>
    </ScrollableWidget>
  );
}
