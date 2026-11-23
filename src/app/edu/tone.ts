import type { RowStatus } from "@/modules/edu/store";

/** Badge colour for each step of a topic. */
export const TONE: Record<RowStatus, "ok" | "warn" | "bad" | "neutral" | "accent"> = {
  queued: "neutral",
  writing: "accent",
  script_review: "warn",
  approved: "accent",
  making: "accent",
  video_review: "warn",
  ready: "ok",
  uploading: "accent",
  published: "ok",
  rejected: "neutral",
  failed: "bad",
};
