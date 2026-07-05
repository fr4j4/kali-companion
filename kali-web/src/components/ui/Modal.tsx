import { type ReactNode } from "react";
import { Overlay } from "./Overlay";

interface Props {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  title?: string;
  size?: "sm" | "md" | "lg" | "xl";
  bare?: boolean;
  panelClassName?: string;
}

export function Modal({ open, onClose, children, title, size = "md", bare = false, panelClassName }: Props) {
  return (
    <Overlay
      open={open}
      onClose={onClose}
      title={title}
      variant="modal"
      size={size}
      bare={bare}
      panelClassName={panelClassName}
    >
      {children}
    </Overlay>
  );
}
