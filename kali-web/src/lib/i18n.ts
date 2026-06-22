// i18n setup. Uses react-i18next + browser language detection.
//
// Locale catalogues live in src/locale/{en,es}/common.json. Adding a new
// language is a matter of dropping a new folder with a common.json; see
// docs/I18N.md.
import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";

import enCommon from "../locale/en/common.json";
import esCommon from "../locale/es/common.json";

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { common: enCommon },
      es: { common: esCommon },
    },
    fallbackLng: "en",
    ns: ["common"],
    defaultNS: "common",
    interpolation: {
      escapeValue: false, // React escapes by default
    },
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: "kali.lang",
      caches: ["localStorage"],
    },
  });

export default i18n;