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
  }
}
