/**
 * מרווחים בתשובת וואטסאפ ארוכה: שורה ריקה בין נושאים, וכל אימון בשורה.
 * אפס קריאות API — רץ על הטקסט אחרי הניסוח.
 */

type PieceKind = "prose" | "schedule" | "option";

type Piece = {
  kind: PieceKind;
  text: string;
  topicStart: boolean;
  dayHeader: boolean;
  forceBreak: boolean;
};

const TIME_RE_SRC = String.raw`\b\d{1,2}(?::\d{2})?\s*[AaPp][Mm]\b|\b\d{1,2}:\d{2}\b`;

const DAY_WORD_SRC = String.raw`today|tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday|сегодня|завтра|воскресенье|понедельник|вторник|среду|среда|четверг|пятницу|пятница|субботу|суббота|היום|מחר|ראשון|שני|שלישי|רביעי|חמישי|שישי|שבת`;

const TOPIC_START_SRC = String.raw`our classes|the classes|classes are|we run|we offer|we have classes|here(?:'s| is) what|this is what|what you need|what to know|(?:the |our )?(?:address|location|policy|price|cost)\b|payment\b|you can pay|we accept|parking\b|cancellation\b|please bring|branch\b|האימונים|אימוני|השיעורים|שיעורי|מערכת השעות|לוח השיעורים|הזמנים|המועדים|הכתובת|כתובת|המיקום|מיקום|המדיניות|מדיניות|המחיר|מחיר|העלות|עלות|התשלום|תשלום|אפשר לשלם|חניה|הגעה|ככה מגיעים|ביטול|הקפאה|מה שצריך|הנה מה|זה מה שיש|סניף|בסניף|адрес|политика|цена|стоимость|расписание|занятия|тренировки|оплата|парковка|филиал`;

function timeRe(): RegExp {
  return new RegExp(TIME_RE_SRC, "giu");
}

function dayWordRe(): RegExp {
  return new RegExp(`(?<![\\p{L}])(?:${DAY_WORD_SRC})(?![\\p{L}])`, "iu");
}

function countTimes(s: string): number {
  return [...s.matchAll(timeRe())].length;
}

function hasDayWord(s: string): boolean {
  return dayWordRe().test(s);
}

function nonScheduleLeftover(chunk: string): string {
  return chunk
    .replace(timeRe(), " ")
    .replace(new RegExp(`(?<![\\p{L}])(?:${DAY_WORD_SRC})(?![\\p{L}])`, "giu"), " ")
    .replace(/[\s*():.,\-–—/'"״׳#]+/gu, " ")
    .replace(
      /\b(?:and|or|at|on|the|a|an|in|to|for|we|have|coming|up|here|what|is|are|am|pm|של|ביום|יום|בשעה|שעה)\b/giu,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
}

function isMostlyTime(chunk: string): boolean {
  return countTimes(chunk) === 1 && !hasDayWord(chunk) && nonScheduleLeftover(chunk).length === 0;
}

function isNumberedOption(line: string): boolean {
  return /^\d{1,2}[.)]\s+\S/u.test(line.trim());
}

function normalizeTopicStart(s: string): string {
  let t = s.trim().replace(/[’‘]/g, "'");
  for (let i = 0; i < 4; i++) {
    const next = t
      .replace(/^[\s"'“”«»*#_>|•\-–—]+/u, "")
      .replace(/^(?:[\p{Extended_Pictographic}\uFE0F\u200D]+\s*)+/u, "")
      .trim();
    if (next === t) break;
    t = next;
  }
  return t;
}

function isTopicStart(s: string): boolean {
  const t = normalizeTopicStart(s);
  if (!t) return false;
  return new RegExp(`^(?:${TOPIC_START_SRC})`, "iu").test(t);
}

function splitSentences(line: string): string[] {
  const parts = line
    .split(/(?<=[.!?])\s+(?=[\p{L}\p{Extended_Pictographic}*])/u)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length ? parts : [line.trim()].filter(Boolean);
}

function splitOffLastTime(chunk: string): { before: string; time: string } | null {
  const matches = [...chunk.matchAll(timeRe())];
  const last = matches[matches.length - 1];
  if (!last || last.index == null) return null;
  return {
    before: chunk.slice(0, last.index).trim(),
    time: last[0].trim(),
  };
}

function splitChunkOnNextDay(chunk: string): string[] {
  const re = new RegExp(`(?<![\\p{L}])(?:${DAY_WORD_SRC})(?![\\p{L}])`, "giu");
  let m: RegExpExecArray | null;
  while ((m = re.exec(chunk))) {
    if (m.index <= 0) continue;
    const before = chunk.slice(0, m.index);
    if (countTimes(before) < 1) continue;
    const left = before.trim();
    const right = chunk.slice(m.index).trim();
    if (!left || !right) continue;
    return [left, ...splitChunkOnNextDay(right)];
  }
  return [chunk.trim()].filter(Boolean);
}

function splitOnConjunction(part: string): string[] | null {
  const bits = part
    .split(/\s+\band\b\s+|\s+и\s+|\s+ו(?:גם)?\s+|(?<=\d)\s*ו(?=יום)/iu)
    .map((s) => s.trim())
    .filter(Boolean);
  if (bits.length < 2) return null;
  if (bits.filter((b) => countTimes(b) >= 1).length < 2) return null;
  return bits;
}

function splitListParts(line: string): string[] {
  const commaParts = line
    .split(/\s*[,;،]\s*/u)
    .map((s) => s.trim())
    .filter(Boolean);
  const base = commaParts.length >= 2 ? commaParts : [line.trim()];
  const out: string[] = [];
  for (const part of base) {
    const bits = countTimes(part) >= 2 ? splitOnConjunction(part) : null;
    const chunks = bits ?? [part];
    for (const chunk of chunks) out.push(...splitChunkOnNextDay(chunk));
  }
  return out.filter(Boolean);
}

function hasListSeparator(s: string): boolean {
  return /[,;،]/u.test(s) || /\s+\band\b\s+/iu.test(s) || /\s+ו(?:גם)?\s+/u.test(s) || /\d\s*ו(?=יום)/u.test(s);
}

function peelLeadingProse(sentence: string): { intro: string; rest: string } | null {
  if (countTimes(sentence) < 2 || !hasListSeparator(sentence)) return null;
  const re = new RegExp(`(?<![\\p{L}])(?:${DAY_WORD_SRC})(?![\\p{L}])`, "giu");
  let m: RegExpExecArray | null;
  while ((m = re.exec(sentence))) {
    const before = sentence.slice(0, m.index).trim();
    const after = sentence.slice(m.index).trim();
    if (!before || countTimes(before) > 0 || countTimes(after) < 2 || !hasListSeparator(after)) continue;
    if (before.length >= 12 || /[.!?]\s*$/u.test(before)) {
      return { intro: before, rest: after };
    }
  }
  const tail = sentence.match(
    new RegExp(`^(.*\\S)(\\s+${TIME_RE_SRC}(?:\\s*[,;،]\\s*${TIME_RE_SRC})+)$`, "iu")
  );
  if (!tail) return null;
  const intro = tail[1]?.trim() ?? "";
  const rest = tail[2]?.trim() ?? "";
  if (intro.length < 8 || countTimes(rest) < 2) return null;
  return { intro, rest };
}

function piecesFromScheduleParts(parts: string[]): Piece[] | null {
  if (parts.length < 2) return null;
  const timed = parts.filter((p) => countTimes(p) >= 1);
  if (timed.length < 2) return null;
  for (const part of parts) {
    if (countTimes(part) > 1) return null;
    if (nonScheduleLeftover(part).length > 40) return null;
  }

  const pieces: Piece[] = [];
  let i = 0;
  while (i < parts.length) {
    const cur = parts[i] ?? "";
    const split = splitOffLastTime(cur);
    const label = split?.before ?? "";
    const looksLabeled =
      Boolean(label) &&
      (hasDayWord(label) || /:\s*$/u.test(label) || /[*]/.test(label));
    const headerWithTimesBelow =
      looksLabeled && split && countTimes(cur) === 1 && isMostlyTime(parts[i + 1] ?? "");
    if (headerWithTimesBelow && split) {
      pieces.push({
        kind: "schedule",
        text: label.trim(),
        topicStart: false,
        dayHeader: true,
        forceBreak: false,
      });
      pieces.push({
        kind: "schedule",
        text: split.time.replace(/\.+$/u, ""),
        topicStart: false,
        dayHeader: false,
        forceBreak: false,
      });
      i += 1;
      while (i < parts.length && isMostlyTime(parts[i] ?? "")) {
        const time = (splitOffLastTime(parts[i] ?? "")?.time ?? (parts[i] ?? "").trim()).replace(
          /\.+$/u,
          ""
        );
        pieces.push({
          kind: "schedule",
          text: time,
          topicStart: false,
          dayHeader: false,
          forceBreak: false,
        });
        i += 1;
      }
      continue;
    }
    pieces.push({
      kind: "schedule",
      text: cur.trim().replace(/\.+$/u, ""),
      topicStart: false,
      dayHeader: hasDayWord(cur) && countTimes(cur) === 0,
      forceBreak: false,
    });
    i += 1;
  }
  return pieces.length ? pieces : null;
}

function tryExpandSchedule(sentence: string): Piece[] | null {
  const peeled = peelLeadingProse(sentence);
  if (peeled) {
    const sched = tryExpandSchedule(peeled.rest);
    if (!sched) return null;
    return [
      {
        kind: "prose",
        text: peeled.intro,
        topicStart: isTopicStart(peeled.intro),
        dayHeader: false,
        forceBreak: false,
      },
      ...sched,
    ];
  }
  if (countTimes(sentence) < 2 || !hasListSeparator(sentence)) return null;
  return piecesFromScheduleParts(splitListParts(sentence));
}

function isDayHeaderLine(line: string): boolean {
  if (countTimes(line) > 0 || !hasDayWord(line)) return false;
  return nonScheduleLeftover(line).length <= 16;
}

function isSingleClassLine(line: string): boolean {
  if (countTimes(line) !== 1) return false;
  return nonScheduleLeftover(line).length <= 40;
}

function lineToPieces(line: string): Piece[] {
  const trimmed = line.trim();
  if (!trimmed) return [];
  if (isNumberedOption(trimmed)) {
    return [
      {
        kind: "option",
        text: trimmed,
        topicStart: false,
        dayHeader: false,
        forceBreak: false,
      },
    ];
  }
  if (isDayHeaderLine(trimmed)) {
    return [
      {
        kind: "schedule",
        text: trimmed,
        topicStart: false,
        dayHeader: true,
        forceBreak: false,
      },
    ];
  }
  if (isSingleClassLine(trimmed) && (hasDayWord(trimmed) || isMostlyTime(trimmed))) {
    return [
      {
        kind: "schedule",
        text: trimmed,
        topicStart: false,
        dayHeader: false,
        forceBreak: false,
      },
    ];
  }

  const sentences = splitSentences(trimmed);
  const pieces: Piece[] = [];
  let buf: string[] = [];
  const flush = () => {
    if (!buf.length) return;
    const text = buf.join(" ");
    pieces.push({
      kind: "prose",
      text,
      topicStart: isTopicStart(buf[0] ?? ""),
      dayHeader: false,
      forceBreak: false,
    });
    buf = [];
  };

  for (const sentence of sentences) {
    const sched = tryExpandSchedule(sentence);
    if (sched) {
      flush();
      pieces.push(...sched);
      continue;
    }
    if (buf.length && isTopicStart(sentence)) flush();
    buf.push(sentence);
  }
  flush();
  return pieces;
}

function needsSpacing(raw: string): boolean {
  const lines = raw.split("\n");
  for (const line of lines) {
    if (countTimes(line) >= 2 && hasListSeparator(line)) return true;
  }
  const sentences = splitSentences(raw.replace(/\n+/g, " "));
  return sentences.slice(1).some((sentence) => isTopicStart(sentence));
}

function joinPieces(pieces: Piece[]): string {
  let out = "";
  let prev: Piece | null = null;
  for (const piece of pieces) {
    const text = piece.text.trim();
    if (!text) continue;
    if (!out) {
      out = text;
      prev = piece;
      continue;
    }
    const breakBefore =
      piece.forceBreak ||
      (piece.kind === "prose" && piece.topicStart && prev?.kind !== "option") ||
      (piece.kind === "schedule" && prev?.kind !== "schedule") ||
      (prev?.kind === "schedule" && piece.kind !== "schedule" && piece.kind !== "option") ||
      (piece.kind === "schedule" && piece.dayHeader && prev?.kind === "schedule");
    out += `${breakBefore ? "\n\n" : "\n"}${text}`;
    prev = piece;
  }
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

/** שורה ריקה בין נושאים, וכל אימון עם השעה שלו בשורה נפרדת. */
export function formatLongReplySpacing(text: string): string {
  const raw = String(text ?? "").replace(/\r\n/g, "\n").trim();
  if (!raw || !needsSpacing(raw)) return raw;

  const pieces: Piece[] = [];
  let forceNext = false;
  for (const line of raw.split("\n")) {
    if (!line.trim()) {
      forceNext = pieces.length > 0;
      continue;
    }
    const next = lineToPieces(line);
    if (forceNext && next[0]) next[0].forceBreak = true;
    forceNext = false;
    pieces.push(...next);
  }
  const formatted = joinPieces(pieces);
  return formatted || raw;
}
