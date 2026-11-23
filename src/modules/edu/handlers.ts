import "server-only";
import fs from "node:fs";
import path from "node:path";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { UserError, defineAction } from "@/core/action";
import { audit } from "@/core/audit";
import { disconnect } from "@/modules/chaos/youtube";
import { MAX_LOGO_BYTES, removeLogo, saveLogo } from "./brand";
import { MAX_TOPICS_CSV, parseTopicsCsv } from "./csv";
import { VOICE_IDS, voiceLabel } from "./voices";
import { discardLibraryCopy, stopMaking } from "./making";
import { resendThumbnail, startPublish } from "./publish";
import { resetSchedule, writeNow } from "./scheduler";
import {
  EDU_LIBRARY,
  addRows,
  deleteRow,
  dismissEvents,
  getRow,
  getSettings,
  listRows,
  logEvent,
  moveRow,
  normTopic,
  saveSettings,
  similarRows,
  updateRow,
  type RowStatus,
} from "./store";
import { VISUAL_MODES } from "./visuals";
import { MAX_INSTRUCTIONS, MAX_MESSAGE, SCENE_TYPES, addVisuals, getDraft, normaliseScenes, saveDraft, saveInstructions } from "./writer";

// Edu videos (owner only, like Chaos Creators: nothing to do with the classroom).
const PERMISSION = "settings.manage" as const;
const id = z.string().regex(/^[a-z0-9]{6,40}$/);
const opt = (max: number) => z.string().trim().max(max).optional();
const bool = z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean());

const done = (message: string) => {
  revalidatePath("/edu", "layout");
  return { ok: true as const, message };
};

function mustBe(rowId: string, allowed: RowStatus[], what: string) {
  const r = getRow(rowId);
  if (!r) throw new UserError("That topic no longer exists.");
  if (!allowed.includes(r.status)) throw new UserError(`You can't ${what} now: it is "${r.status.replace("_", " ")}".`);
  return r;
}

// ------------------------------------ topics ------------------------------------

export const importTopicsAction = defineAction({
  permission: PERMISSION,
  schema: z.object({ csv: z.string().min(1, "Choose a CSV file first").max(MAX_TOPICS_CSV, "The file is too big"), fileName: opt(200) }),
  run: async ({ csv, fileName }) => {
    const { topics, issues } = parseTopicsCsv(csv, listRows());
    if (topics.length) {
      addRows(topics.map((t) => ({ ...t, source: fileName || "uploaded CSV" })));
      try {
        // keep the file as uploaded (OneDrive, backed up)
        const dir = path.join(EDU_LIBRARY, "csv");
        fs.mkdirSync(dir, { recursive: true });
        const base = (fileName || "topics.csv").replace(/[\\/:*?"<>|]+/g, " ").replace(/\.csv$/i, "").trim() || "topics";
        let file = path.join(dir, `${base}.csv`);
        for (let n = 2; fs.existsSync(file); n++) file = path.join(dir, `${base} (${n}).csv`);
        fs.writeFileSync(file, csv, "utf8");
      } catch (e) {
        console.error("[edu] couldn't keep the CSV", e);
      }
      logEvent("info", `Added ${topics.length} topic${topics.length === 1 ? "" : "s"} from ${fileName || "a CSV"}`);
    }
    revalidatePath("/edu", "layout");
    const problems = issues.map((i) => `Line ${i.line}: ${i.text}`);
    if (!topics.length) return { ok: false as const, error: problems.join(" · ") || "No topics found." };
    return { ok: true as const, message: `Added ${topics.length} topic${topics.length === 1 ? "" : "s"}.${problems.length ? ` Notes: ${problems.join(" · ")}` : ""}` };
  },
});

const topicFields = {
  topic: z.string().trim().min(3, "Write the topic").max(200),
  format: z.enum(["short", "long"]).default("short"),
  audience: opt(60),
  notes: opt(500),
  mustInclude: opt(300),
};

export const addTopicAction = defineAction({
  permission: PERMISSION,
  schema: z.object(topicFields),
  run: async (t) => {
    const rows = listRows();
    if (rows.some((r) => r.status !== "rejected" && normTopic(r.topic) === normTopic(t.topic))) throw new UserError("That topic is already in the list (no repeated topics).");
    const similar = similarRows(t.topic, rows);
    addRows([{ topic: t.topic, format: t.format, audience: t.audience || undefined, notes: t.notes || undefined, mustInclude: t.mustInclude || undefined, source: "added by hand" }]);
    return done(similar.length ? `Added. It looks close to "${similar[0]!.topic}": the script will take a different angle.` : "Added to the list.");
  },
});

export const editTopicAction = defineAction({
  permission: PERMISSION,
  schema: z.object({ id, ...topicFields }),
  run: async (t) => {
    mustBe(t.id, ["queued"], "edit this topic (its video has been started: add a new row instead)");
    if (listRows().some((r) => r.id !== t.id && r.status !== "rejected" && normTopic(r.topic) === normTopic(t.topic))) throw new UserError("That topic is already in the list.");
    updateRow(t.id, (r) => ({ ...r, topic: t.topic, format: t.format, audience: t.audience || undefined, notes: t.notes || undefined, mustInclude: t.mustInclude || undefined }));
    return done("Saved.");
  },
});

export const deleteTopicAction = defineAction({
  permission: PERMISSION,
  schema: z.object({ id }),
  run: async ({ id }) => {
    mustBe(id, ["queued"], "delete this topic (its video has been started)");
    deleteRow(id);
    return done("Removed from the list.");
  },
});

export const moveTopicAction = defineAction({
  permission: PERMISSION,
  schema: z.object({ id, dir: z.enum(["up", "down"]) }),
  run: async ({ id, dir }) => {
    moveRow(id, dir === "up" ? -1 : 1);
    return done("Moved.");
  },
});

// ----------------------------------- schedule -----------------------------------

export const saveSettingsAction = defineAction({
  permission: PERMISSION,
  schema: z.object({
    intervalHours: z.coerce.number().int().min(1, "At least 1 hour").max(168, "At most a week"),
    firstSlot: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM, e.g. 10:00"),
    keepAhead: z.coerce.number().int().min(1, "At least 1").max(15, "At most 15"),
    minReady: z.coerce.number().int().min(0).max(10),
    canvaThumbnail: bool,
    canvaPictures: bool,
    defaultKicker: z.string().trim().min(1).max(28),
    channelName: z.string().trim().max(60, "Keep the channel name under 60 characters").default(""),
    voices: z.preprocess((v) => v ?? [], z.array(z.enum(VOICE_IDS as [string, ...string[]])).min(1, "Tick at least one narrator voice").max(VOICE_IDS.length)),
  }),
  run: async (s) => {
    const before = getSettings();
    saveSettings({ ...s, defaultKicker: s.defaultKicker.toUpperCase() });
    if (before.intervalHours !== s.intervalHours || before.firstSlot !== s.firstSlot) resetSchedule();
    logEvent("info", `Settings saved: a video every ${s.intervalHours} h from ${s.firstSlot}, ${s.keepAhead} topics kept ahead, ${s.minReady} approved videos wanted ready.`);
    return done("Settings saved.");
  },
});

export const startScheduleAction = defineAction({
  permission: PERMISSION,
  schema: z.object({}),
  run: async () => {
    if (!listRows().some((r) => r.status === "queued")) throw new UserError("Add some topics first.");
    saveSettings({ paused: false, startedAt: new Date().toISOString() });
    resetSchedule();
    logEvent("info", "Schedule started: the first script is written within a minute.");
    return done("Started. The first script will be written within a minute.");
  },
});

export const pauseScheduleAction = defineAction({
  permission: PERMISSION,
  schema: z.object({}),
  run: async () => {
    saveSettings({ paused: true });
    logEvent("info", "Schedule paused.");
    return done("Paused. Work already running finishes; nothing new starts.");
  },
});

export const writeNowAction = defineAction({
  permission: PERMISSION,
  schema: z.object({ id: id.optional() }),
  run: async ({ id }) => {
    if (id) mustBe(id, ["queued"], "write this script");
    else if (!listRows().some((r) => r.status === "queued")) throw new UserError("The list has no topics waiting.");
    const r = await writeNow(id);
    if (!r) throw new UserError(getRow(id ?? "")?.error || "Couldn't write the script. See the log on the dashboard.");
    return done(`Script written: "${r.title}". Review it now.`);
  },
});

// ------------------------------------ review ------------------------------------

const SceneIn = z.object({
  type: z.enum(SCENE_TYPES),
  say: z.string().max(900),
  heading: z.string().max(120).optional(),
  big: z.string().max(60).optional(),
  items: z
    .array(z.object({ label: z.string().max(100), detail: z.string().max(160).optional(), value: z.string().max(30).optional(), icon: z.string().max(60).optional(), icon2: z.string().max(60).optional() }))
    .max(6)
    .optional(),
  left_title: z.string().max(40).optional(),
  right_title: z.string().max(40).optional(),
  unit: z.string().max(20).optional(),
  answer: z.number().int().min(0).max(5).optional(),
  picture_prompt: z.string().max(500).optional(),
  chapter: z.string().max(60).optional(),
  visual: z.enum(VISUAL_MODES).optional(),
  anim: z.string().max(20).optional(),
  anim_subject: z.string().max(160).optional(),
  anim_cue: z.string().max(100).optional(),
  sticker: z.string().max(60).optional(),
});
const DraftIn = z.object({
  title: z.string().trim().min(1).max(80),
  kicker: z.string().trim().max(28),
  thumbnail_text: z.string().trim().max(50),
  youtube_title: z.string().trim().min(1, "The YouTube title is empty").max(100),
  youtube_description: z.string().max(4500),
  youtube_tags: z.array(z.string().max(60)).max(30),
  scenes: z.array(SceneIn).min(2).max(40),
});

export const saveScriptAction = defineAction({
  permission: PERMISSION,
  schema: z.object({ id, draft: z.string().max(200_000) }),
  run: async ({ id, draft }) => {
    const row = mustBe(id, ["script_review"], "edit the script");
    const old = getDraft(id);
    if (!old) throw new UserError("The script is missing.");
    let parsed: z.infer<typeof DraftIn>;
    try {
      parsed = DraftIn.parse(JSON.parse(draft));
    } catch (e) {
      throw new UserError(e instanceof z.ZodError ? `Check the script: ${e.issues[0]?.path.join(".")} ${e.issues[0]?.message}` : "The edited script couldn't be read.");
    }
    saveDraft(id, {
      ...old,
      ...parsed,
      kicker: parsed.kicker.toUpperCase() || old.kicker,
      youtube_tags: parsed.youtube_tags.map((t) => t.trim().toLowerCase()).filter(Boolean),
      scenes: normaliseScenes(parsed.scenes, row.format),
      editedAt: new Date().toISOString(),
    });
    updateRow(id, (r) => ({ ...r, title: parsed.title }));
    return done("Script saved.");
  },
});

export const resendThumbnailAction = defineAction({
  permission: PERMISSION,
  schema: z.object({ id }),
  run: async ({ id }) => {
    mustBe(id, ["published"], "send the thumbnail");
    await resendThumbnail(id);
    return done("Thumbnail set on YouTube.");
  },
});

export const addVisualsAction = defineAction({
  permission: PERMISSION,
  schema: z.object({ id }),
  run: async ({ id }) => {
    const row = mustBe(id, ["script_review"], "add 3D visuals");
    await addVisuals(id, row.format);
    logEvent("info", `3D visuals added to "${row.title || row.topic}"`, id);
    return done("3D visuals added to every scene. Check the ticks and approve when ready.");
  },
});

export const approveScriptAction = defineAction({
  permission: PERMISSION,
  schema: z.object({ id }),
  run: async ({ id }) => {
    mustBe(id, ["script_review"], "approve the script");
    updateRow(id, (r) => ({ ...r, status: "approved", scriptApprovedAt: new Date().toISOString() }));
    logEvent("info", `Script approved: "${getRow(id)?.title}"`, id);
    return done(getSettings().paused ? "Approved. The video will be made when the schedule is running (Start on the dashboard)." : "Approved. The video will be made shortly.");
  },
});

export const rewriteScriptAction = defineAction({
  permission: PERMISSION,
  schema: z.object({ id, note: z.string().trim().min(3, "Say what to change").max(800) }),
  run: async ({ id, note }) => {
    mustBe(id, ["script_review"], "ask for a rewrite");
    updateRow(id, (r) => ({ ...r, rewriteNote: note }));
    const r = await writeNow(id);
    if (!r) throw new UserError(getRow(id)?.error || "The rewrite failed.");
    return done("Rewritten. Review the new script.");
  },
});

export const rejectAction = defineAction({
  permission: PERMISSION,
  schema: z.object({ id, reason: opt(500) }),
  run: async ({ id, reason }) => {
    const r = mustBe(id, ["script_review", "approved", "making", "video_review", "ready", "failed"], "reject this topic");
    if (r.status === "making") stopMaking(id);
    discardLibraryCopy(id);
    updateRow(id, (x) => ({ ...x, status: "rejected", rejectReason: reason || undefined, pid: undefined }));
    logEvent("info", `Rejected "${r.title || r.topic}"${reason ? `: ${reason}` : ""}`, id);
    return done("Rejected. The topic is closed: add a new row to try it again.");
  },
});

export const approveVideoAction = defineAction({
  permission: PERMISSION,
  schema: z.object({ id }),
  run: async ({ id }) => {
    mustBe(id, ["video_review"], "approve the video");
    updateRow(id, (r) => ({ ...r, status: "ready", videoApprovedAt: new Date().toISOString() }));
    logEvent("info", `Video approved: "${getRow(id)?.title}" will go up (private) at the next free slot.`, id);
    return done("Approved. It will be uploaded (private) at the next free slot.");
  },
});

export const remakeVideoAction = defineAction({
  permission: PERMISSION,
  schema: z.object({ id }),
  run: async ({ id }) => {
    mustBe(id, ["video_review", "ready"], "make the video again");
    updateRow(id, (r) => ({ ...r, status: "approved", scriptApprovedAt: new Date().toISOString() }));
    return done("It will be made again shortly.");
  },
});

export const backToScriptAction = defineAction({
  permission: PERMISSION,
  schema: z.object({ id }),
  run: async ({ id }) => {
    mustBe(id, ["approved", "video_review", "ready"], "edit the script again");
    discardLibraryCopy(id); // this video won't be used: a new one is made from the edited script
    updateRow(id, (r) => ({ ...r, status: "script_review" }));
    return done("Back to script review: edit it, then approve again to make a new video.");
  },
});

export const publishNowAction = defineAction({
  permission: PERMISSION,
  schema: z.object({ id }),
  run: async ({ id }) => {
    mustBe(id, ["ready"], "publish this video");
    if (!startPublish(id, "published by hand")) throw new UserError("Couldn't start the upload. Check that the Edu channel's YouTube is connected (Settings).");
    return done("Uploading to YouTube as private…");
  },
});

export const retryAction = defineAction({
  permission: PERMISSION,
  schema: z.object({ id }),
  run: async ({ id }) => {
    const r = mustBe(id, ["failed"], "retry");
    const back: RowStatus = r.failedAt === "queued" ? "queued" : r.failedAt === "ready" ? "ready" : "approved";
    updateRow(id, (x) => ({ ...x, status: back, error: undefined, failedAt: undefined, uploadAttempts: back === "ready" ? 0 : x.uploadAttempts }));
    if (back === "queued") {
      const w = await writeNow(id);
      if (!w) throw new UserError(getRow(id)?.error || "Writing failed again.");
      return done("Script written. Review it now.");
    }
    return done(back === "ready" ? "It will be uploaded at the next slot (or press Publish now)." : "It will be made again shortly.");
  },
});

export const dismissAlertsAction = defineAction({
  permission: PERMISSION,
  schema: z.object({ ids: z.array(z.string().max(60)).max(500) }),
  run: async ({ ids }) => {
    dismissEvents(ids);
    return done("Dismissed.");
  },
});

// ------------------------------------ channel ------------------------------------

export const saveLogoAction = defineAction({
  permission: PERMISSION,
  schema: z.object({
    file: z
      .instanceof(File)
      .refine((f) => f.size > 0, "Choose the logo file")
      .refine((f) => f.size <= MAX_LOGO_BYTES, "The logo must be under 5 MB")
      .refine((f) => /\.(png|jpe?g|webp)$/i.test(f.name), "Use a .png, .jpg or .webp image")
      .optional(),
    remove: z.string().optional(),
  }),
  run: async ({ file, remove }) => {
    if (remove) {
      removeLogo();
      logEvent("info", "Channel logo removed: new videos have no logo.");
      return done("Logo removed.");
    }
    if (!file) throw new UserError("Choose the logo file.");
    saveLogo(file.name, Buffer.from(await file.arrayBuffer()));
    logEvent("info", "Channel logo saved: videos made from now on use it.");
    return done("Logo saved. Videos made from now on use it.");
  },
});

export const disconnectEduYoutubeAction = defineAction({
  permission: PERMISSION,
  schema: z.object({}),
  run: async (_input, { user }) => {
    await disconnect("edu");
    await audit({ action: "edu.youtube.disconnected", actor: user, entity: "edu_youtube", entityId: "channel" });
    logEvent("alert", "The Edu channel's YouTube was disconnected: nothing will be published until it is connected again.");
    return done("Disconnected. Nothing is published until you connect the channel again.");
  },
});

export const setVoiceAction = defineAction({
  permission: PERMISSION,
  schema: z.object({ id, voice: z.enum(VOICE_IDS as [string, ...string[]]) }),
  run: async ({ id, voice }) => {
    mustBe(id, ["script_review", "approved"], "change the narrator");
    const d = getDraft(id);
    if (!d) throw new UserError("The script is missing.");
    saveDraft(id, { ...d, voice });
    return done(`Narrator: ${voiceLabel(voice)}.`);
  },
});

// ------------------------------------ the prompt ------------------------------------

export const regenerateScriptAction = defineAction({
  permission: PERMISSION,
  schema: z.object({
    id,
    instructions: z.string().trim().min(200, "The instructions are too short").max(MAX_INSTRUCTIONS, "The instructions are too long"),
    message: z.string().trim().min(10, "The topic message is empty").max(MAX_MESSAGE, "The topic message is too long"),
    saveDefault: bool,
  }),
  run: async ({ id, instructions, message, saveDefault }) => {
    const row = mustBe(id, ["script_review", "failed"], "regenerate the script");
    if (row.status === "failed" && row.failedAt !== "queued") throw new UserError("Only a script that failed to write can be regenerated here.");
    if (saveDefault) {
      saveInstructions(instructions);
      logEvent("info", "Script instructions saved as the default for all new scripts.");
    }
    updateRow(id, (r) => ({ ...r, rewriteNote: undefined }));
    const r = await writeNow(id, { instructions, message });
    if (!r) throw new UserError(getRow(id)?.error || "Regenerating failed.");
    return done(`Regenerated with your prompt${saveDefault ? " (instructions saved as the default)" : ""}. Review the new script.`);
  },
});

export const resetInstructionsAction = defineAction({
  permission: PERMISSION,
  schema: z.object({}),
  run: async () => {
    saveInstructions(null);
    logEvent("info", "Script instructions reset to the built-in default.");
    return done("Default instructions reset to the built-in ones.");
  },
});
