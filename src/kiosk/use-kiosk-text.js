import { useStudio } from "../studio";
import { kioskText } from "./kiosk-texts.js";

// Chữ trên máy chụp theo cài đặt của tiệm (Thiết lập → Chữ trên máy chụp): t("layout.title").
export function useKioskText() {
  const { settings = {} } = useStudio();
  return (key, vars) => kioskText(settings.kioskTexts, key, vars);
}
