import { injectHashGuard } from './htmlUtils';

interface Props {
  content: string;
}

export function HtmlArtifact({ content }: Props) {
  return (
    <iframe
      className="w-full h-full border-none bg-white"
      sandbox="allow-scripts allow-modals"
      srcDoc={injectHashGuard(content)}
      title="HTML artifact"
    />
  );
}
