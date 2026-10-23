import type { ReactNode } from "react";
import { AlertTriangle, Inbox } from "lucide-react";
import { Spinner } from "./Spinner";

interface Props {
  kind: "empty" | "error" | "loading";
  title: string;
  detail?: string;
  /** Actions (buttons) shown under the message. */
  children?: ReactNode;
  className?: string;
}

/** Shared empty / error / loading placeholder: icon, translated text and optional actions. */
export function StateMessage({ kind, title, detail, children, className = "" }: Props) {
  const Icon = kind === "error" ? AlertTriangle : Inbox;
  return (
    <div
      className={`flex flex-col items-center justify-center gap-3 p-6 text-center ${className}`}
      role={kind === "error" ? "alert" : "status"}
    >
      {kind === "loading"
        ? <Spinner size={22} className="text-accent" label={title} />
        : <Icon size={24} className={kind === "error" ? "text-err" : "text-muted"} aria-hidden="true" />}
      <p className={`text-sm ${kind === "error" ? "text-err" : "text-muted"}`}>{title}</p>
      {detail && <p className="max-w-md break-words text-xs text-muted">{detail}</p>}
      {children && <div className="flex gap-2">{children}</div>}
    </div>
  );
}
