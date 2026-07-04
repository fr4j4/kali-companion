import { useTranslation } from "react-i18next";
import { Heart, Info } from "lucide-react";
import { SectionHeader } from "./SectionHeader";
import { SettingsCard } from "./SettingsCard";

export function AboutSection() {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col gap-4">
      <SectionHeader
        icon={Info}
        title={t("about.title")}
        description={t("about.description")}
      />

      {/* App info */}
      <SettingsCard>
        <Row label={t("about.author")} value={t("about.author_name")} />
        <Row label={t("about.version")} value="0.1.0" />
      </SettingsCard>

      {/* Engine */}
      <SettingsCard title={t("about.engine_label")}>
        <p className="text-xs text-muted leading-relaxed">
          {t("about.engine_desc")}
        </p>
        <div className="flex items-center gap-2 text-xs">
          <span className="text-muted">{t("about.engine_repo")}:</span>
          <a
            href="https://github.com/ServeurpersoCom/qwentts.cpp"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline font-mono truncate"
          >
            github.com/ServeurpersoCom/qwentts.cpp
          </a>
        </div>
      </SettingsCard>

      {/* Other Engines */}
      <SettingsCard title={t("about.other_engines")}>
        <div className="flex flex-col">
          <EngineRow name="Piper" description={t("about.engine_piper")} />
          <EngineRow name="Vosk" description={t("about.engine_vosk")} />
          <EngineRow name="Qwen3-ASR" description={t("about.engine_qwen3asr")} />
        </div>
      </SettingsCard>

      {/* Icons attribution */}
      <SettingsCard title={t("about.icons")}>
        <p className="text-xs text-muted leading-relaxed">
          {t("about.icons_prefix")}{" "}
          <a
            href="https://www.svgrepo.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline"
          >
            SVG Repo
          </a>
          . {t("about.icons_suffix")}
        </p>
      </SettingsCard>

      {/* Made with love */}
      <div className="flex items-center justify-center gap-1.5 pt-2 text-[10px] text-muted">
        <span>{t("about.made_with")}</span>
        <Heart size={10} className="text-red-400 fill-red-400" />
        <span>{t("about.made_by")}</span>
      </div>
    </div>
  );
}

function EngineRow({ name, description }: { name: string; description: string }) {
  return (
    <div className="flex items-start gap-3 px-1 py-2 border-b border-border/50 last:border-0">
      <span className="text-xs font-bold text-fg whitespace-nowrap mt-0.5">{name}</span>
      <span className="text-xs text-muted leading-relaxed">{description}</span>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center py-1 border-b border-border/50 last:border-0">
      <span className="text-xs text-muted">{label}</span>
      <span className="text-xs font-mono font-bold text-fg">{value}</span>
    </div>
  );
}
