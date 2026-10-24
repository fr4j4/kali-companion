import { useTranslation } from "react-i18next";
import { Overlay } from "../components/ui/Overlay";
import { ConversationLog } from "./ConversationLog";

interface Props {
  open: boolean;
  onClose: () => void;
}

/** Full-screen conversation for narrow screens; wide screens use the docked ChatDock instead. */
export function ConversationModal({ open, onClose }: Props) {
  const { t } = useTranslation();
  return (
    <Overlay open={open} onClose={onClose} variant="modal" size="xl" title={t("conversation.title")}>
      <div className="-mx-5 -mb-5 flex min-h-0 flex-1 flex-col">
        <ConversationLog active={open} />
      </div>
    </Overlay>
  );
}
