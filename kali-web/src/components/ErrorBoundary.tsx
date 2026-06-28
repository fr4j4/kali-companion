import { Component, type ReactNode } from "react";
import { useTranslation } from "react-i18next";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
}

function DefaultFallback() {
  const { t } = useTranslation();
  return (
    <div className="flex-1 flex items-center justify-center p-4 text-sm text-muted">
      {t("error.render")}
    </div>
  );
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error("ErrorBoundary caught:", error);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback ?? <DefaultFallback />;
    }
    return this.props.children;
  }
}