import "server-only";
import crypto from "node:crypto";
import path from "node:path";
import { EDU_HOME, getSettings, readJson, writeJson } from "./store";

// Narrator voices (Kokoro, on this PC). Each video gets ONE voice, picked when its script is
// written: the chosen voices are shuffled and used in turn, so every voice is used once per round
// and the same voice never narrates two videos in a row. Rahul can swap a video's voice on its
// review page while the script is still in review.

export type VoiceInfo = { id: string; name: string; gender: "female" | "male"; accent: "American" | "British" };

export const VOICES: VoiceInfo[] = [
  { id: "af_heart", name: "Heart", gender: "female", accent: "American" },
  { id: "af_bella", name: "Bella", gender: "female", accent: "American" },
  { id: "am_michael", name: "Michael", gender: "male", accent: "American" },
  { id: "am_fenrir", name: "Fenrir", gender: "male", accent: "American" },
  { id: "af_sarah", name: "Sarah", gender: "female", accent: "American" },
  { id: "bf_emma", name: "Emma", gender: "female", accent: "British" },
  { id: "am_puck", name: "Puck", gender: "male", accent: "American" },
  { id: "bm_george", name: "George", gender: "male", accent: "British" },
  { id: "bm_fable", name: "Fable", gender: "male", accent: "British" },
];
export const DEFAULT_VOICES = ["af_heart", "af_bella", "am_michael", "am_fenrir"];
export const VOICE_IDS = VOICES.map((v) => v.id);

export const voiceInfo = (id: string | undefined) => VOICES.find((v) => v.id === id);
export const voiceLabel = (id: string | undefined) => {
  const v = voiceInfo(id);
  return v ? `${v.name} (${v.gender}, ${v.accent})` : (id ?? "Heart (female, American)");
};

type Bag = { bag: string[]; last?: string };
const BAG = () => path.join(EDU_HOME, "voices.json");

function shuffle<T>(a: T[]) {
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j]!, a[i]!];
  }
  return a;
}

/** The next narrator in the shuffled rotation of the voices chosen in Settings. */
export function nextVoice(): string {
  const chosen = getSettings().voices.filter((v) => VOICE_IDS.includes(v));
  const pool = chosen.length ? chosen : DEFAULT_VOICES;
  const st = readJson<Bag>(BAG()) ?? { bag: [] };
  let bag = st.bag.filter((v) => pool.includes(v));
  if (!bag.length) {
    bag = shuffle([...pool]);
    // a new round must not start with the voice that ended the last one
    if (bag.length > 1 && bag[0] === st.last) bag.push(bag.shift()!);
  }
  const voice = bag.shift()!;
  writeJson(BAG(), { bag, last: voice });
  return voice;
}
