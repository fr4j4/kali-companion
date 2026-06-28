import { useTranslation } from "react-i18next";
import { injectHashGuard } from './htmlUtils';

interface Props {
  content: string;
}

export function HtmlArtifact({ content }: Props) {
  const { t } = useTranslation();
  return (
    <iframe
      className="w-full h-full border-none bg-white"
      sandbox="allow-scripts allow-modals"
      srcDoc={injectHashGuard(content)}
      title={t("widget.html.iframe_title") as string}
    />
  );
}
