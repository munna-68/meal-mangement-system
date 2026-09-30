/**
 * Parsing for the "paste a CSV to bulk-add deposits" workflow.
 *
 * The manager photographs the paper deposit book, has a multimodal model read
 * it, and pastes the resulting CSV here. The model is imperfect, so this module
 * is deliberately forgiving: it finds the columns it recognises, strips currency
 * symbols and Bengali digits out of amounts, and normalises a few common date
 * shapes. Anything it cannot understand is returned as an invalid row with a
 * reason rather than throwing, so the UI can show a preview and let the manager
 * decide what to import.
 *
 * Pure functions only — no database, no framework — so the messy parts are unit
 * tested directly.
 */

import { isValidDateKey, type DateKey } from "./dates";

const BENGALI_DIGITS = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];

function toAsciiDigits(value: string): string {
  return value.replace(/[০-৯]/g, (digit) => String(BENGALI_DIGITS.indexOf(digit)));
}

/** Splits CSV text into records of cells, honouring quoted fields and `""`. */
export function parseCsvRecords(text: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let inQuotes = false;

  const endField = () => {
    record.push(field);
    field = "";
  };
  const endRecord = () => {
    endField();
    records.push(record);
    record = [];
  };

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      endField();
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i += 1;
      endRecord();
    } else {
      field += ch;
    }
  }
  if (field !== "" || record.length > 0) endRecord();

  return records.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

/**
 * Turns a money cell into a whole-taka integer, or null when it is not a
 * number. Accepts `৳1,200`, `1200 tk`, `(250)` for negative, and Bengali digits.
 */
export function parseAmountCell(raw: string | undefined): number | null {
  if (raw == null) return null;
  let value = toAsciiDigits(raw).trim();
  if (!value) return null;

  let negative = false;
  if (/^\(.*\)$/.test(value)) {
    negative = true;
    value = value.slice(1, -1);
  }
  value = value
    .replace(/[৳$€£¥]/g, "")
    .replace(/\b(taka|tk|bdt|usd|rs)\b/gi, "")
    .replace(/[\s,]/g, "")
    .trim();

  if (value.startsWith("-")) {
    negative = true;
    value = value.slice(1);
  }
  if (value.startsWith("+")) value = value.slice(1);

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.round(parsed);
  return negative ? -rounded : rounded;
}

/**
 * Normalises a date cell to `YYYY-MM-DD`, or null when it is not recognisable.
 * Supports ISO plus the common `D/M/Y` and `D-M-Y` shapes a book would use.
 */
export function parseDateCell(raw: string | undefined): DateKey | null {
  if (raw == null) return null;
  const value = toAsciiDigits(raw).trim();
  if (!value) return null;

  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value);
  if (iso) {
    const key = `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
    return isValidDateKey(key) ? key : null;
  }

  const parts = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(value);
  if (parts) {
    let year = Number(parts[3]);
    if (year < 100) year += 2000;
    const key = `${year}-${parts[2].padStart(2, "0")}-${parts[1].padStart(2, "0")}`;
    return isValidDateKey(key) ? key : null;
  }

  return null;
}

export interface CsvImportRow {
  /** 1-based line in the pasted text, for error messages. */
  line: number;
  name: string;
  room: string;
  amount: number | null;
  date: DateKey | null;
  notes: string;
  /** Why the row cannot be imported, or null when it looks fine. */
  problem: string | null;
}

export interface CsvImportParse {
  rows: CsvImportRow[];
  /** True when a recognised header row was found and used. */
  headerDetected: boolean;
}

function findColumn(header: string[], pattern: RegExp): number {
  return header.findIndex((cell) => pattern.test(cell));
}

/**
 * Reads pasted CSV into import rows. When the first record looks like a header
 * (`name`, `room`, `amount`, ...) its columns are used; otherwise the columns
 * are taken positionally as name, room, amount, date, notes.
 */
export function parseCsvImport(text: string): CsvImportParse {
  const records = parseCsvRecords(text);
  if (records.length === 0) return { rows: [], headerDetected: false };

  const first = records[0].map((cell) => cell.trim().toLowerCase());
  const nameIndex = findColumn(first, /name|member|নাম/);
  const amountIndex = findColumn(first, /amount|deposit|balance|taka|টাকা|পরিমাণ/);
  const headerDetected = nameIndex >= 0 || amountIndex >= 0;

  const roomIndex = findColumn(first, /room|ঘর/);
  const dateIndex = findColumn(first, /date|তারিখ/);
  const notesIndex = findColumn(first, /note|comment|remark|মন্তব্য/);

  const body = headerDetected ? records.slice(1) : records;
  const at = (cells: string[], index: number) =>
    index >= 0 && index < cells.length ? (cells[index] ?? "").trim() : "";

  const rows: CsvImportRow[] = [];
  for (let i = 0; i < body.length; i += 1) {
    const cells = body[i];
    const line = headerDetected ? i + 2 : i + 1;
    const name = headerDetected ? at(cells, nameIndex) : at(cells, 0);
    const room = headerDetected ? at(cells, roomIndex) : at(cells, 1);
    const rawAmount = headerDetected ? at(cells, amountIndex) : at(cells, 2);
    const amount = parseAmountCell(rawAmount);
    const date = parseDateCell(headerDetected ? at(cells, dateIndex) : at(cells, 3));
    const notes = headerDetected ? at(cells, notesIndex) : at(cells, 4);

    // An unquoted grouped number ("1,200") is torn into two cells by the CSV
    // reader, which would silently import "1". "80,200" is genuinely
    // ambiguous — one grouped number or two columns — and no parser can tell
    // them apart. So rather than guess, a small amount followed by a short
    // all-digit group that is not a date is refused for review. Importing a
    // silently wrong deposit is far worse than asking for a correction.
    const nextCell = headerDetected ? at(cells, amountIndex + 1) : at(cells, 3);
    const amountSplitByComma =
      amount !== null &&
      /^[^\d]*\d{1,3}$/.test(rawAmount) &&
      /^\d{1,3}$/.test(nextCell) &&
      parseDateCell(nextCell) === null;

    let problem: string | null = null;
    if (!name) problem = "No name";
    else if (amount === null) problem = "Amount is not a number";
    else if (amountSplitByComma) {
      problem = "Amount may be split by a comma — re-paste as plain digits";
    }

    rows.push({ line, name, room, amount, date, notes, problem });
  }

  return { rows, headerDetected };
}

export interface ImportMember {
  id: string;
  name: string;
  roomNumber: string;
}

export type MemberMatch =
  | { ok: true; id: string }
  | { ok: false; reason: "not-found" | "ambiguous"; candidates: string[] };

function normalise(value: string): string {
  return value.toLowerCase().replace(/\s+/g, " ").trim();
}

function sameRoom(a: string, b: string): boolean {
  return normalise(a).replace(/[\s-]/g, "") === normalise(b).replace(/[\s-]/g, "");
}

/**
 * Maps a CSV row onto a real member by name, using the room number only to
 * break a tie between two members who share a name.
 *
 * The match is exact, after normalising case and spacing. A partial name is
 * deliberately *not* guessed at: "Rahim" is not matched to "Abdur Rahim", and
 * "Q" is not matched to "QA-B". The input is usually a CSV read off a
 * handwritten book, where a name is easily truncated — and a deposit silently
 * credited to the wrong person is far worse than one skipped row the manager
 * has to fix. An unmatched row is reported with the members it *could* have
 * meant, so fixing it takes seconds.
 */
export function resolveMember(
  name: string,
  room: string,
  members: ImportMember[],
): MemberMatch {
  const needle = normalise(name);
  if (!needle) return { ok: false, reason: "not-found", candidates: [] };

  const all = members.map((member) => member.id);
  const candidates = members.filter(
    (member) => normalise(member.name) === needle,
  );

  if (candidates.length === 0) return { ok: false, reason: "not-found", candidates: all };
  if (candidates.length > 1 && room) {
    const byRoom = candidates.filter((member) => sameRoom(member.roomNumber, room));
    if (byRoom.length === 1) return { ok: true, id: byRoom[0].id };
    if (byRoom.length > 1) {
      return { ok: false, reason: "ambiguous", candidates: byRoom.map((m) => m.id) };
    }
  }
  if (candidates.length > 1) {
    return { ok: false, reason: "ambiguous", candidates: candidates.map((m) => m.id) };
  }
  return { ok: true, id: candidates[0].id };
}

/**
 * The prompt for the multimodal model that reads the paper book. Kept as one
 * constant so the copy button and any future docs stay in step.
 */
export function aiBookPrompt(): string {
  return [
    "You are reading photographs of a handwritten/printed mess deposit book.",
    "Extract every deposit row and return ONLY a CSV code block, no commentary.",
    "",
    "Format — a header row followed by one row per person:",
    "name,room,amount",
    "",
    "Rules:",
    "- name: the person's name exactly as written.",
    "- room: their room number/number, or empty if not shown.",
    "- amount: the deposit amount as a plain number with no currency symbol,",
    "  no commas and no Bengali digits (e.g. 1500, not ৳১,৫০০).",
    "- Use a minus sign for a negative amount if the book shows one.",
    "- If a name is hard to read, use your best reading; do not skip the row.",
    "- Do not invent rows for people not present in the photos.",
    "",
    "Return only the CSV, nothing else.",
  ].join("\n");
}
