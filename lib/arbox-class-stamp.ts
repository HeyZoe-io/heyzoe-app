export type ArboxScheduleRemovedNotice = {
  detected_at: string;
  dismissed: boolean;
};

export type ArboxClassStamp = {
  arbox_box_category_id: number | null;
  arbox_class_name: string;
  schedule_removed_notice: ArboxScheduleRemovedNotice | null;
};

export type ServiceDescriptionBlob = Record<string, unknown>;

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
}

export function parseArboxClassStamp(meta: ServiceDescriptionBlob): ArboxClassStamp {
  const idRaw = meta.arbox_box_category_id;
  const idNum = typeof idRaw === "number" ? idRaw : Number.parseInt(String(idRaw ?? "").trim(), 10);
  const arbox_box_category_id = Number.isFinite(idNum) && idNum > 0 ? idNum : null;
  const arbox_class_name = String(meta.arbox_class_name ?? "").trim();
  const noticeRaw = asRecord(meta.schedule_removed_notice);
  let schedule_removed_notice: ArboxScheduleRemovedNotice | null = null;
  if (noticeRaw) {
    const detected_at = String(noticeRaw.detected_at ?? "").trim();
    if (detected_at) {
      schedule_removed_notice = { detected_at, dismissed: noticeRaw.dismissed === true };
    }
  }
  return { arbox_box_category_id, arbox_class_name, schedule_removed_notice };
}
