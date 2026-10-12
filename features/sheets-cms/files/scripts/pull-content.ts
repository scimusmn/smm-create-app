/// <reference types="node" />
/**
 * yarn pull-content
 *
 * Download a public Google Sheet and write content/content.json.
 *
 * SHEETS_ID in .env or .env.local is the full Google Sheets URL. The first
 * tab is downloaded. Row 1 is column headers; each later row becomes a record.
 * A column named `key` is what getEntry() in lib/content.ts looks up.
 */
import fs from "node:fs";
import path from "node:path";

function loadEnvFile(filename: string) {
  const envPath = path.join(process.cwd(), filename);
  if (!fs.existsSync(envPath)) return;

  for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;

    const key = trimmed.slice(0, eq).trim();
    if (!key || process.env[key] !== undefined) continue;
    process.env[key] = trimmed.slice(eq + 1).trim();
  }
}

/** CSV download for the first tab of a Sheets edit URL. */
function resolveSheet(sheetUrl: string): { sheetId: string; url: string } {
  let url: URL;
  try {
    url = new URL(sheetUrl);
  } catch {
    throw new Error("SHEETS_ID should be a Google Sheets URL.");
  }

  const sheetId = url.pathname.match(/\/spreadsheets\/d\/([^/]+)/)?.[1];
  if (!sheetId) throw new Error("SHEETS_ID should be a Google Sheets URL.");
  return {
    sheetId,
    url: `https://docs.google.com/spreadsheets/d/${sheetId}/export?format=csv&gid=0`,
  };
}

function finishCell(value: string): string {
  return value.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
}

function parseCsv(text: string): string[][] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];

    if (inQuotes) {
      if (char === '"') {
        if (source[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ",") {
      row.push(finishCell(cell));
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && source[i + 1] === "\n") i += 1;
      row.push(finishCell(cell));
      cell = "";
      if (row.some((value) => value !== "")) rows.push(row);
      row = [];
    } else {
      cell += char;
    }
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(finishCell(cell));
    if (row.some((value) => value !== "")) rows.push(row);
  }

  return rows;
}

function toRecords(rows: string[][]): Record<string, string>[] {
  const [headers, ...body] = rows;
  if (!headers || headers.every((header) => header === "")) {
    throw new Error("The sheet has no header row.");
  }

  return body.flatMap((values) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      if (!header) return;
      record[header] = values[index] ?? "";
    });
    return Object.values(record).some((value) => value !== "") ? [record] : [];
  });
}

/** content/ is copied to src/content when the project uses a src/ directory. */
function outputFile(): string {
  const srcContent = path.join(process.cwd(), "src", "content", "content.json");
  const rootContent = path.join(process.cwd(), "content", "content.json");
  if (fs.existsSync(srcContent)) return srcContent;
  if (fs.existsSync(rootContent)) return rootContent;
  if (fs.existsSync(path.join(process.cwd(), "src", "app"))) return srcContent;
  return rootContent;
}

function looksLikeHtml(body: string, contentType: string | null): boolean {
  if (contentType && /text\/html|application\/xhtml/i.test(contentType)) return true;
  const start = body.trimStart().slice(0, 20).toLowerCase();
  return start.startsWith("<!doctype") || start.startsWith("<html");
}

async function main() {
  loadEnvFile(".env.local");
  loadEnvFile(".env");

  const sheetUrl = process.env.SHEETS_ID?.trim();
  if (!sheetUrl) {
    throw new Error("SHEETS_ID is not set. Add the Google Sheets URL to .env and run yarn pull-content again.");
  }

  const { sheetId, url } = resolveSheet(sheetUrl);
  console.log(`Downloading ${sheetId}...`);

  const response = await fetch(url, {
    redirect: "follow",
    headers: { "User-Agent": "smm-sheets-cms" },
  });
  if (!response.ok) {
    throw new Error(
      `Download failed (${response.status}). Share the sheet so anyone with the link can view it.`,
    );
  }

  const csv = await response.text();
  if (!csv.trim() || looksLikeHtml(csv, response.headers.get("content-type"))) {
    throw new Error(
      "Google returned a web page instead of CSV. Share the sheet so anyone with the link can view it.",
    );
  }

  const records = toRecords(parseCsv(csv));
  const dest = outputFile();
  const payload = {
    pulledAt: new Date().toISOString(),
    sheetId,
    range: "gid=0",
    records,
  };

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, `${JSON.stringify(payload, null, 2)}\n`);

  console.log(`Wrote ${records.length} records to ${path.relative(process.cwd(), dest)}`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
