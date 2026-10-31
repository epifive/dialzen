/**
 * Small, dependency-free CSV reader and writer (RFC 4180 quoting) used by the contact import, the
 * DNC upload and the CSV exports. Works in Server and Client Components alike.
 */

export interface ParsedCsv {
  headers: string[];
  /** Data rows (without the header row), each padded / cut to the header's width. */
  rows: string[][];
  delimiter: string;
  /** True when rows beyond `maxRows` were dropped. */
  truncated: boolean;
}

/** The delimiter of the first line: comma, semicolon (European Excel) or tab. */
export function detectDelimiter(text: string): string {
  const first = text.slice(0, 4000).split(/\r?\n/, 1)[0] ?? "";
  let best = ",";
  let bestCount = -1;
  for (const d of [",", ";", "\t"]) {
    let count = 0;
    let quoted = false;
    for (const ch of first) {
      if (ch === '"') quoted = !quoted;
      else if (ch === d && !quoted) count += 1;
    }
    if (count > bestCount) {
      best = d;
      bestCount = count;
    }
  }
  return best;
}

/** All records of a CSV text (quotes, escaped quotes, CRLF and line breaks inside quotes). Empty lines are skipped. */
export function parseCsvRecords(text: string, delimiter = detectDelimiter(text), maxRecords = Infinity): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const out: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let i = 0;
  const pushRow = () => {
    row.push(field);
    field = "";
    if (row.length > 1 || row[0].trim() !== "") out.push(row);
    row = [];
  };
  while (i < src.length && out.length < maxRecords) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        quoted = false;
        i += 1;
        continue;
      }
      field += ch;
      i += 1;
      continue;
    }
    if (ch === '"' && field.trim() === "") {
      quoted = true;
      field = "";
      i += 1;
    } else if (ch === delimiter) {
      row.push(field);
      field = "";
      i += 1;
    } else if (ch === "\n" || ch === "\r") {
      pushRow();
      i += ch === "\r" && src[i + 1] === "\n" ? 2 : 1;
    } else {
      field += ch;
      i += 1;
    }
  }
  if (out.length < maxRecords && (field !== "" || row.length)) pushRow();
  return out;
}

/** Header row + data rows. `maxRows` counts data rows. */
export function parseCsv(text: string, maxRows = 10_000): ParsedCsv {
  const delimiter = detectDelimiter(text);
  const records = parseCsvRecords(text, delimiter, maxRows + 2);
  const headers = (records[0] ?? []).map((h, i) => h.trim() || `column_${i + 1}`);
  const body = records.slice(1);
  const truncated = body.length > maxRows;
  const rows = body.slice(0, maxRows).map((r) => headers.map((_, i) => (r[i] ?? "").trim()));
  return { headers, rows, delimiter, truncated };
}

/**
 * One CSV cell. Values that a spreadsheet would run as a formula (= + - @ at the start) are
 * prefixed with an apostrophe (CSV injection), except plain numbers and E.164 phone numbers.
 */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s) && !/^[+-]?\d[\d.,\s]*$/.test(s)) s = `'${s}`;
  return /[",\r\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows to CSV text (CRLF line ends, as Excel expects). */
export function toCsv(rows: ReadonlyArray<ReadonlyArray<unknown>>): string {
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

const BOM = String.fromCharCode(0xfeff);

/** A CSV download response (UTF-8 with BOM so Excel shows accents and Arabic correctly). */
export function csvResponse(filename: string, rows: ReadonlyArray<ReadonlyArray<unknown>>): Response {
  return new Response(BOM + toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename.replace(/[^\w.-]+/g, "-")}"`,
      "Cache-Control": "no-store",
    },
  });
}
