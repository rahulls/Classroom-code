// Runs once when the server starts. Starts the background loop that delivers queued messages
// and queues class reminders, so reminders go out even if nobody opens the app after a restart.
// The import must sit inside this exact `if` so it is left out of the edge bundle.
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { ensureDeliveryLoop } = await import("@/modules/messages/service");
    ensureDeliveryLoop();
    // Exam Prep (separate module, own database): its scheduler only starts when the feature flag is on
    if (process.env.EXAM_PREP_ENABLED === "true") {
      const { startExamPrepScheduler } = await import("@/modules/exam-prep/jobs");
      startExamPrepScheduler();
    }
    // Edu videos (scheduled explainers for the YouTube channel): only the production server runs the
    // belt, so the dev / test servers never write scripts, make videos or upload. EDU_SCHEDULER=off stops it.
    // Chaos Creators: videos waiting for Canva's designs carry on after a restart (production only,
    // like the Edu belt, so a dev server never spends Canva's allowance on its own)
    if (process.env.NODE_ENV === "production") {
      const { startCanvaSweep } = await import("@/modules/chaos/canva-jobs");
      startCanvaSweep();
      // The daily Canva + Claude usage report, emailed to Rahul each morning
      const { startUsageReports } = await import("@/modules/chaos/usage");
      startUsageReports();
    }
    if (process.env.NODE_ENV === "production" && process.env.EDU_SCHEDULER !== "off") {
      const { startEduScheduler } = await import("@/modules/edu/scheduler");
      startEduScheduler();
    }
  }
}
