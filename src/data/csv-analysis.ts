const MAX_CSV_BYTES = 8 * 1024 * 1024;
const MAX_CSV_RECORDS = 50_000;
const MAX_CSV_COLUMNS = 256;
const MAX_DECIMAL_DIGITS = 100;
const MAX_DECIMAL_SCALE = 100;

export class CsvAnalysisError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CsvAnalysisError";
  }
}

export interface CsvAnalysisOptions {
  readonly numericColumns: readonly string[];
}

export interface CsvAnalysisResult {
  readonly headers: readonly string[];
  readonly rowCount: number;
  readonly duplicateRowCount: number;
  readonly missingValues: Readonly<Record<string, number>>;
  readonly numericTotals: Readonly<Record<string, string>>;
}

interface DecimalValue {
  readonly coefficient: bigint;
  readonly scale: number;
}

function parseCsvRecords(input: string): string[][] {
  const records: string[][] = [];
  let record: string[] = [];
  let field = "";
  let inQuotes = false;
  let afterQuote = false;
  let hasRecordContent = false;

  const pushField = (): void => {
    record.push(field);
    field = "";
    afterQuote = false;
    hasRecordContent = true;
  };
  const pushRecord = (): void => {
    pushField();
    records.push(record);
    if (records.length > MAX_CSV_RECORDS) {
      throw new CsvAnalysisError("CSV exceeds the supported record limit.");
    }
    record = [];
    hasRecordContent = false;
  };

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    if (character === undefined) {
      continue;
    }
    if (inQuotes) {
      if (character === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
          afterQuote = true;
        }
      } else if (character === "\r" && input[index + 1] === "\n") {
        field += "\n";
        index += 1;
      } else {
        field += character;
      }
      continue;
    }

    if (afterQuote && character !== "," && character !== "\r" && character !== "\n") {
      throw new CsvAnalysisError("CSV contains characters after a closing quote.");
    }
    if (character === '"') {
      if (field.length !== 0 || afterQuote) {
        throw new CsvAnalysisError("CSV contains a quote inside an unquoted field.");
      }
      inQuotes = true;
      hasRecordContent = true;
    } else if (character === ",") {
      pushField();
    } else if (character === "\r" || character === "\n") {
      pushRecord();
      if (character === "\r" && input[index + 1] === "\n") {
        index += 1;
      }
    } else {
      field += character;
      hasRecordContent = true;
    }
  }

  if (inQuotes) {
    throw new CsvAnalysisError("CSV contains an unterminated quoted field.");
  }
  if (hasRecordContent || field.length > 0 || record.length > 0 || afterQuote) {
    pushField();
    records.push(record);
  }
  if (records.length === 0 || records[0]?.length === 0) {
    throw new CsvAnalysisError("CSV must include a header row.");
  }
  if (records.length > MAX_CSV_RECORDS) {
    throw new CsvAnalysisError("CSV exceeds the supported record limit.");
  }
  return records;
}

function parseDecimal(value: string): DecimalValue | undefined {
  const normalized = value.trim();
  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/u.exec(normalized);
  if (match === null) {
    return undefined;
  }
  const signText = match[1] ?? "";
  const whole = match[2] ?? "";
  const fraction = match[3] ?? "";
  const exponentText = match[4] ?? "0";
  if (whole.length + fraction.length > MAX_DECIMAL_DIGITS) {
    return undefined;
  }
  const exponent = Number(exponentText);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > MAX_DECIMAL_SCALE) {
    return undefined;
  }
  let coefficient = BigInt(`${whole}${fraction}`);
  if (signText === "-") {
    coefficient *= -1n;
  }
  let scale = fraction.length - exponent;
  if (scale < 0) {
    if (-scale > MAX_DECIMAL_SCALE) {
      return undefined;
    }
    coefficient *= 10n ** BigInt(-scale);
    scale = 0;
  }
  if (scale > MAX_DECIMAL_SCALE) {
    return undefined;
  }
  return { coefficient, scale };
}

function formatDecimal(value: DecimalValue): string {
  let coefficient = value.coefficient;
  let scale = value.scale;
  while (scale > 0 && coefficient % 10n === 0n) {
    coefficient /= 10n;
    scale -= 1;
  }
  const negative = coefficient < 0n;
  const digits = (negative ? -coefficient : coefficient).toString().padStart(scale + 1, "0");
  if (scale === 0) {
    return `${negative ? "-" : ""}${digits}`;
  }
  const decimalIndex = digits.length - scale;
  return `${negative ? "-" : ""}${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function analyzeCsv(input: unknown, options: CsvAnalysisOptions): CsvAnalysisResult {
  if (typeof input !== "string") {
    throw new CsvAnalysisError("CSV input must be text.");
  }
  if (Buffer.byteLength(input, "utf8") > MAX_CSV_BYTES) {
    throw new CsvAnalysisError("CSV exceeds the supported input size.");
  }
  const optionsValue: unknown = options;
  const numericColumnsValue = isRecord(optionsValue) ? optionsValue["numericColumns"] : undefined;
  if (!Array.isArray(numericColumnsValue)) {
    throw new CsvAnalysisError("Numeric column selection is invalid.");
  }
  const numericColumns: string[] = [];
  for (const column of numericColumnsValue) {
    if (typeof column !== "string") {
      throw new CsvAnalysisError("Numeric column selection is invalid.");
    }
    numericColumns.push(column);
  }

  const records = parseCsvRecords(input.charCodeAt(0) === 0xfeff ? input.slice(1) : input);
  const headerRow = records[0];
  if (headerRow === undefined || headerRow.length > MAX_CSV_COLUMNS) {
    throw new CsvAnalysisError("CSV header is missing or exceeds the supported column limit.");
  }
  const headers = headerRow.map((header) => header.trim());
  if (headers.some((header) => header.length === 0)) {
    throw new CsvAnalysisError("CSV headers must not be empty.");
  }
  const normalizedHeaders = headers.map((header) => header.toLocaleLowerCase("en-US"));
  if (new Set(normalizedHeaders).size !== headers.length) {
    throw new CsvAnalysisError("CSV headers must be unique, ignoring case.");
  }
  if (new Set(numericColumns).size !== numericColumns.length) {
    throw new CsvAnalysisError("Numeric columns must not be repeated.");
  }

  const selectedColumns = new Map<string, number>();
  for (const column of numericColumns) {
    const index = headers.indexOf(column);
    if (index < 0) {
      throw new CsvAnalysisError("A selected numeric column does not exist in the CSV header.");
    }
    selectedColumns.set(column, index);
  }

  const missingValues: Record<string, number> = Object.fromEntries(headers.map((header) => [header, 0]));
  const totals = new Map<string, DecimalValue>(numericColumns.map((column) => [column, { coefficient: 0n, scale: 0 }]));
  const seenRows = new Set<string>();
  let duplicateRowCount = 0;
  const dataRows = records.slice(1);

  for (const row of dataRows) {
    if (row.length !== headers.length) {
      throw new CsvAnalysisError("CSV contains a row with a different number of fields than its header.");
    }
    const rowKey = JSON.stringify(row);
    if (seenRows.has(rowKey)) {
      duplicateRowCount += 1;
    } else {
      seenRows.add(rowKey);
    }
    row.forEach((cell, index) => {
      const header = headers[index];
      if (header !== undefined && cell.trim().length === 0) {
        missingValues[header] = (missingValues[header] ?? 0) + 1;
      }
    });
    for (const [column, index] of selectedColumns) {
      const raw = row[index];
      if (raw === undefined || raw.trim().length === 0) {
        continue;
      }
      const parsed = parseDecimal(raw);
      if (parsed === undefined) {
        throw new CsvAnalysisError("A selected numeric column contains a non-numeric or out-of-range value.");
      }
      const current = totals.get(column);
      if (current === undefined) {
        throw new CsvAnalysisError("Numeric total state is invalid.");
      }
      const scale = Math.max(current.scale, parsed.scale);
      const currentCoefficient = current.coefficient * 10n ** BigInt(scale - current.scale);
      const parsedCoefficient = parsed.coefficient * 10n ** BigInt(scale - parsed.scale);
      totals.set(column, { coefficient: currentCoefficient + parsedCoefficient, scale });
    }
  }

  const numericTotals = Object.fromEntries([...totals].map(([column, total]) => [column, formatDecimal(total)] as const));
  return {
    headers,
    rowCount: dataRows.length,
    duplicateRowCount,
    missingValues,
    numericTotals,
  };
}
