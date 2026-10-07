import { SCHEDULE_BOARD_CAPTION } from "@/lib/sales-flow";
import { scheduleTimesReplyUsesImage } from "@/lib/wa-studio-schedule-cta";
import { UNKNOWN_CLASS_SLOT_HANDOFF_REPLY } from "@/lib/wa-unknown-class-slot";

export type ScheduleSource = "image" | "link" | "data" | "none";

export type ScheduleResponse =
  | { source: "image"; kind: "image" }
  | { source: "link"; kind: "link"; text: string }
  | { source: "data"; kind: "body"; text: string }
  | { source: "none"; kind: "handoff"; text: string };

export function configuredTimetableLink(input: {
  schedulePublicUrl?: string | null;
  arboxLink?: string | null;
}): string {
  return (input.schedulePublicUrl?.trim() || input.arboxLink?.trim() || "").trim();
}

/** Precedence: timetable image, then a configured link, then schedule data in the prompt, then team handoff. */
export function resolveScheduleSource(input: {
  slug?: string | null;
  schedulePublicUrl?: string | null;
  arboxLink?: string | null;
  hasScheduleData?: boolean;
}): ScheduleSource {
  if (scheduleTimesReplyUsesImage(input.slug)) return "image";
  if (configuredTimetableLink(input)) return "link";
  if (input.hasScheduleData) return "data";
  return "none";
}

export function resolveScheduleResponse(input: {
  slug?: string | null;
  schedulePublicUrl?: string | null;
  arboxLink?: string | null;
  hasScheduleData?: boolean;
  claudeBody: string;
  caption?: string | null;
}): ScheduleResponse {
  const source = resolveScheduleSource(input);
  if (source === "image") return { source, kind: "image" };
  if (source === "link") {
    const link = configuredTimetableLink(input);
    const caption = String(input.caption ?? "").trim() || SCHEDULE_BOARD_CAPTION;
    return { source, kind: "link", text: `${caption}: ${link}` };
  }
  if (source === "data") return { source, kind: "body", text: String(input.claudeBody ?? "").trim() };
  return { source, kind: "handoff", text: UNKNOWN_CLASS_SLOT_HANDOFF_REPLY };
}
