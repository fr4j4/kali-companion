import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { ScrollableWidget } from "./base/ScrollableWidget";
import { useHeaderActions, type HeaderAction } from "./hooks/useHeaderActions";
import { useStage } from "../../stage/StageProvider";

export function ReasoningWidget() {
  const { t } = useTranslation();
  const { chat } = useStage();

  const text = useMemo(() => {
    const lastMsg = [...chat.messages].reverse().find((m) => m.reasoning);
    return lastMsg?.reasoning ?? "";
  }, [chat.messages]);

  const actions: HeaderAction[] = useMemo(() => {
    const acts: HeaderAction[] = [];
    acts.push({ type: "copy", getContent: () => text, tip: t("widget.document.copy") });
    return acts;
  }, [text, t]);

  const { rendered: headerActions } = useHeaderActions(actions);

  return (
    <ScrollableWidget searchable={false}>
      {headerActions.length > 0 && (
        <div className="flex items-center justify-end gap-0.5 px-2 py-1 border-b border-white/5 shrink-0">
          {headerActions}
        </div>
      )}
      <div className="flex-1 p-4 overflow-y-auto scrollbar-thin">
        <pre className="text-sm text-fg leading-relaxed whitespace-pre-wrap font-sans" style={{ fontStyle: "italic" }}>
          {text}
        </pre>
      </div>
    </ScrollableWidget>
  );
}