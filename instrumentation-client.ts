import posthog from "posthog-js";

const posthogKey =
  process.env.NEXT_PUBLIC_POSTHOG_KEY ||
  process.env.NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN ||
  "";

// Avoid crashing builds if the env var is missing.
if (posthogKey) {
  posthog.init(posthogKey, {
  api_host: "/ingest",
  ui_host: "https://us.posthog.com",
  defaults: "2026-01-30",
  capture_exceptions: true,
  debug: process.env.NODE_ENV === "development",
    session_recording: {
      maskAllInputs: true,
      maskInputFn: null,
    },
  });
}
