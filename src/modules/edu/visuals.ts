import "server-only";
import fs from "node:fs";
import path from "node:path";
import { EDU_ENGINE } from "./store";

// The 3D visuals the engine can draw (src/Edu videos/engine/visuals.py + sci3d.py) and the 3D
// stickers it has (src/Edu videos/stickers: Microsoft Fluent Emoji 3D, MIT licence).

export const ANIM_KINDS = ["molecule", "reaction", "states", "balloon", "atom", "ions", "lattice", "mixture", "beaker", "formula", "sticker"] as const;
export type AnimKind = (typeof ANIM_KINDS)[number];
export const VISUAL_MODES = ["animation", "sticker", "none"] as const;
export type VisualMode = (typeof VISUAL_MODES)[number];

export const ANIM_HELP: Record<AnimKind, string> = {
  molecule: 'a formula, e.g. "H2O", "CO2", "CH4", "NH3", "O2", "N2", "C2H5OH", "H2SO4": the molecule in its true 3D shape (ball-and-stick, turning) + its 3D formula + an atom colour key',
  reaction:
    'a BALANCED equation with "->", e.g. "2H2 + O2 -> 2H2O", "CH4 + 2O2 -> CO2 + 2H2O", "2Mg + O2 -> 2MgO": the reactant molecules collide and their atoms regroup into the products (atoms are conserved), with the 3D equation under it. At most 8 molecules a side',
  states:
    "solid | liquid | gas | melting | freezing | boiling | evaporation | condensation | sublimation | heating (solid -> liquid -> gas) | cooling: each state in its real shape, never a box: an ice cube with its particles packed and vibrating, a puddle of water (a water drop when it is liquid alone) with particles sliding, water vapour with particles flying apart; changes of state morph one shape into the next on the cue words; with heating the particles speed up gradually, slow to fast, with a flame and a thermometer. Add \":<substance>\" for something other than water (\"melting:wax\")",
  balloon:
    '"gas" or "air" or molecules ("N2*6, O2*2"), plus "heat" (the particles speed up slow to fast and the balloon swells) or "inflate" (it fills up on the cue): a 3D balloon with the gas particles flying inside and hitting its skin',
  atom: 'an element symbol, e.g. "Na", "C", "O": Bohr model in 3D, protons and neutrons in the nucleus, electrons orbiting in shells, with the counts and shells (2, 8, 1) written under it',
  ions: '"Na>Cl" (metal>non-metal): the outer electron(s) jump from one atom to the other, both become ions (Na+ Cl-) and attract: ionic bonding',
  lattice: '"NaCl" (a turning 3D ionic crystal) or a metal symbol like "Cu" (metal ions in a sea of moving electrons)',
  mixture: 'molecules with counts, e.g. "N2*8, O2*2, Ar, CO2" (air: flying in the open), "H2O*10, Na^+*2, Cl^-*2" (salt water: moving inside a water drop): different particles moving around together',
  beaker:
    'comma list for a 3D glass beaker: a colour (red, blue, green, purple, yellow, orange, pink, colourless) or acid / base / neutral / water; "x->y" = the liquid changes colour on the cue (an indicator drop falls in); "fizz" = gas bubbles; "ph:3" = a pH tag',
  formula: "a formula or equation shown in big 3D letters (when no molecule shape fits)",
  sticker: 'sticker names from the list: one name, "a, b, c" (pop in one by one, on their words) or "a -> b -> c" (a change, with arrows)',
};

let names: string[] | null = null;
/** The sticker names the engine has (file names without .png). */
export function stickerNames(): string[] {
  if (names) return names;
  try {
    names = Object.keys(JSON.parse(fs.readFileSync(path.join(EDU_ENGINE, "..", "stickers", "stickers.json"), "utf8")) as Record<string, string>).sort();
  } catch {
    names = [];
  }
  return names;
}

/** Cleans a formula / equation / list a visual is about. */
export const cleanSubject = (s: string | undefined) =>
  (s ?? "")
    .replace(/→/g, "->")
    .replace(/[^A-Za-z0-9 +\-^>*,:.()_]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);

/** A sticker name as the engine spells it (lower case, underscores). */
export const cleanSticker = (s: string | undefined) =>
  (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 40);

/** An item icon: a formula (kept as written: "H2O") or a sticker name. */
export function cleanIcon(s: string | undefined) {
  const t = (s ?? "").trim();
  if (!t) return "";
  if (/^[A-Z][A-Za-z0-9()^+\-]*$/.test(t) && /[A-Z]/.test(t) && !/^[A-Z][a-z]{3,}/.test(t)) return t.slice(0, 24); // a formula
  return cleanSticker(t);
}

/** The visual rules for Claude (the instructions add them under "3D visuals"). */
export function visualRules() {
  return `3D visuals (a video is never just text: every scene shows something clear, 3D and scientific that moves with the narration):
- anim + anim_subject: the scene's 3D animation, drawn scientifically by the engine. The kinds:
${ANIM_KINDS.map((k) => `  - ${k}: anim_subject = ${ANIM_HELP[k]}`).join("\n")}
- anim_cue: the word(s) in this scene's narration, comma separated and in order, on which the animation's main moments happen: the collision of a reaction, each change of state, the electron jump, each sticker of a list. Use words that really are in that scene's "say".
- sticker: one sticker name for the scene, always set (shown when Rahul switches the scene to a still sticker, or when the animation can't be drawn).
- items[].icon: EVERY item of bullets, steps, cycle, diagram, timeline and recap and EVERY quiz option gets an icon: a chemical formula (shows a small turning 3D molecule: "H2O", "CO2", "O2", "NaCl") or a sticker name. In compare, icon = the left cell, icon2 = the right cell.
- Show real science: substances as their molecules, every chemical change as a reaction with its correct balanced equation, states of matter and physical changes as particle boxes, atomic structure as atom models, ionic bonding as ions, solids as lattices, acids/bases/indicators as beakers. Use stickers for everyday objects and examples (food, fire, ice, body parts, tools) and for topics with no scientific animation.
- Show things in their real shape: a liquid as a liquid (puddle, drop), ice as ice, vapour as vapour, a balloon as a balloon. Never use a box or container unless the narration is about a box or container. When the narration mentions a balloon, the visual is the balloon animation (or the balloon sticker). When it says particles move faster with heat, use a heating animation (they speed up gradually, slow to fast).
- Everything must be scientifically correct (true formulas, balanced equations, the right state change, real colours of indicators) and match exactly what the narration says at that moment.
- Where the animation shows: title, keyword, stat and demo scenes show it large; bullets, steps and recap with up to 3 items show it above the list; other scenes show only the item icons.
- The big animation of a list scene must add something its item icons don't show (the key reaction, the process), never the same stickers again. Prefer a real animation (reaction, states, molecule, atom...) over a sticker animation whenever the science allows it; ionic compounds (NaCl, MgO, Fe2O3, CaCl2) can be used in reactions.
- Use the "demo" scene type to show a process (a reaction, a change of state, an atom, electron transfer) with the animation filling the screen. Every video has at least 2 demo scenes or keyword scenes with an animation.
- Sticker names (use exactly these): ${stickerNames().join(", ")}`;
}
