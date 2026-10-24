import type { AvatarConfig } from "./avatarConfig";
import { ALL_PATTERNS } from "./avatarPresets";

/** Apply the user's appearance (colours, species, pattern, accessories) to the avatar's DOM. */
export function applyAvatarConfig(el: HTMLElement, svg: SVGSVGElement | null, head: SVGGElement | null, cfg: AvatarConfig): void {
  el.style.setProperty("--cat-base", cfg.colors.base);
  el.style.setProperty("--cat-spot1", cfg.colors.spot1);
  el.style.setProperty("--cat-spot2", cfg.colors.spot2);
  el.style.setProperty("--cat-ears", cfg.colors.ears);
  el.style.setProperty("--eye-light", cfg.eyes.light);
  el.style.setProperty("--eye-main", cfg.eyes.main);
  el.style.setProperty("--eye-dark", cfg.eyes.dark);
  el.style.setProperty("--eye-pupil", cfg.eyes.pupil);
  el.style.setProperty("--collar-band", cfg.collar);
  el.style.setProperty("--acc-scarf", cfg.collar);
  el.style.setProperty("--acc-hat", cfg.hatColor);
  el.style.setProperty("--acc-glasses", cfg.glassesColor);

  if (head) {
    head.setAttribute("data-animal", cfg.species);
    head.setAttribute("data-ears", cfg.ears);
  }
  svg?.setAttribute("data-animal", cfg.species);

  for (const id of ALL_PATTERNS) {
    const p = el.querySelector(`#${id}`);
    if (p) { p.classList.remove("visible-pattern"); p.classList.add("hidden-pattern"); }
  }
  const activePattern = el.querySelector(`#${cfg.pattern}`);
  if (activePattern) { activePattern.classList.remove("hidden-pattern"); activePattern.classList.add("visible-pattern"); }

  const show = (selector: string, on: boolean) => {
    const node = el.querySelector(selector) as HTMLElement | null;
    if (node) node.style.display = on ? "block" : "none";
  };
  for (const acc of ["acc-cascabel", "acc-placa", "acc-corazon", "acc-corbatin", "acc-flor", "acc-estrella", "acc-scarf"]) show(`#${acc}`, false);
  show("#base-collar-path", true);
  if (cfg.accessory === "bufanda") {
    show("#base-collar-path", false);
    show("#acc-scarf", true);
  } else if (cfg.accessory !== "ninguno") {
    show(`#acc-${cfg.accessory}`, true);
  } else {
    show("#base-collar-path", false);
  }
  for (const g of ["glasses-round", "glasses-square"]) show(`#${g}`, false);
  if (cfg.glasses !== "none") show(`#glasses-${cfg.glasses}`, true);
  for (const h of ["hat-gorro", "hat-copa", "hat-fiesta"]) show(`#${h}`, false);
  if (cfg.hat !== "none") show(`#hat-${cfg.hat}`, true);
}
