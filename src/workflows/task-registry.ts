export type TaskInputType = "string" | "file" | "directory" | "number" | "boolean" | "enum";
export type TaskOutputType = "text" | "json" | "file";
export type TaskToolId =
  | "csv.analyze"
  | "document.analyze"
  | "repository.inspect"
  | "software.check"
  | "web.search"
  | "browser.audit";

export interface TaskInputField {
  readonly name: string;
  readonly type: TaskInputType;
  readonly required: boolean;
  readonly description: string;
  readonly choices?: readonly string[];
}

export interface TaskOutputField {
  readonly name: string;
  readonly type: TaskOutputType;
  readonly description: string;
}

export interface TaskExample {
  readonly prompt: string;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly expectedResult: string;
}

export interface TaskConformanceCase {
  readonly name: string;
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly expectedOutputNames: readonly string[];
}

export interface TaskDefinition {
  readonly id: string;
  readonly version: 1;
  readonly name: string;
  readonly description: string;
  readonly instructions: string;
  readonly inputs: readonly TaskInputField[];
  readonly outputs: readonly TaskOutputField[];
  readonly requiredTools: readonly TaskToolId[];
  readonly examples: readonly TaskExample[];
  readonly tests: readonly TaskConformanceCase[];
}

export interface TaskValidationResult {
  readonly inputs: Readonly<Record<string, unknown>>;
  readonly fieldNames: readonly string[];
}

export class TaskRegistryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TaskRegistryError";
  }
}

const TASK_TOOL_IDS: readonly TaskToolId[] = [
  "csv.analyze",
  "document.analyze",
  "repository.inspect",
  "software.check",
  "web.search",
  "browser.audit",
];
const TASK_TOOL_ID_SET: ReadonlySet<string> = new Set(TASK_TOOL_IDS);
const DEFINITION_KEYS = ["id", "version", "name", "description", "instructions", "inputs", "outputs", "requiredTools", "examples", "tests"];
const ID_PATTERN = /^[a-z][a-z0-9-]{1,47}$/u;
const FIELD_PATTERN = /^[a-z][a-zA-Z0-9]{0,47}$/u;
const MAX_INSTRUCTIONS = 4_000;
const MAX_DEFINITION_FIELDS = 32;
const MAX_EXAMPLES = 12;
const MAX_TESTS = 24;

type RecordValue = Record<string, unknown>;

function isRecord(value: unknown): value is RecordValue {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTaskToolId(value: string): value is TaskToolId {
  return TASK_TOOL_ID_SET.has(value);
}

function boundedText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string" || value.trim().length === 0 || value.length > maximum) {
    throw new TaskRegistryError(`${label} must be non-empty text within its size limit.`);
  }
  return value;
}

function exactKeys(value: RecordValue, keys: readonly string[], label: string): void {
  if (Object.keys(value).some((key) => !keys.includes(key))) {
    throw new TaskRegistryError(`${label} contains unsupported fields.`);
  }
}

function parseInputType(value: unknown): TaskInputType {
  if (value === "string" || value === "file" || value === "directory" || value === "number" || value === "boolean" || value === "enum") return value;
  throw new TaskRegistryError("Task input type is unsupported.");
}

function parseOutputType(value: unknown): TaskOutputType {
  if (value === "text" || value === "json" || value === "file") return value;
  throw new TaskRegistryError("Task output type is unsupported.");
}

function parseInputField(value: unknown): TaskInputField {
  if (!isRecord(value)) throw new TaskRegistryError("Task input declaration is invalid.");
  exactKeys(value, ["name", "type", "required", "description", "choices"], "Task input declaration");
  const name = value["name"];
  const type = parseInputType(value["type"]);
  const required = value["required"];
  if (typeof name !== "string" || !FIELD_PATTERN.test(name) ||
      typeof required !== "boolean") {
    throw new TaskRegistryError("Task input declaration is invalid.");
  }
  const description = boundedText(value["description"], "Task input description", 256);
  if (type === "enum") {
    const choices = value["choices"];
    if (!Array.isArray(choices) || choices.length < 2 || choices.length > 16) {
      throw new TaskRegistryError("Enum task inputs require unique bounded choices.");
    }
    const parsedChoices = choices.map((choice) => {
      if (typeof choice !== "string" || choice.length < 1 || choice.length > 64) {
        throw new TaskRegistryError("Enum task inputs require unique bounded choices.");
      }
      return choice;
    });
    if (new Set(parsedChoices).size !== parsedChoices.length) {
      throw new TaskRegistryError("Enum task inputs require unique bounded choices.");
    }
    return { name, type, required, description, choices: parsedChoices };
  }
  if (value["choices"] !== undefined) throw new TaskRegistryError("Only enum inputs may declare choices.");
  return { name, type, required, description };
}

function parseOutputField(value: unknown): TaskOutputField {
  if (!isRecord(value)) throw new TaskRegistryError("Task output declaration is invalid.");
  exactKeys(value, ["name", "type", "description"], "Task output declaration");
  const name = value["name"];
  const type = parseOutputType(value["type"]);
  if (typeof name !== "string" || !FIELD_PATTERN.test(name) ||
      typeof type !== "string") {
    throw new TaskRegistryError("Task output declaration is invalid.");
  }
  return { name, type, description: boundedText(value["description"], "Task output description", 256) };
}

function parseExample(value: unknown, inputs: readonly TaskInputField[]): TaskExample {
  if (!isRecord(value)) throw new TaskRegistryError("Task example is invalid.");
  exactKeys(value, ["prompt", "inputs", "expectedResult"], "Task example");
  const prompt = boundedText(value["prompt"], "Task example prompt", 512);
  const inputValues = validateTaskInputs(inputs, value["inputs"]).inputs;
  const expectedResult = boundedText(value["expectedResult"], "Task example result", 512);
  return { prompt, inputs: inputValues, expectedResult };
}

function parseConformanceCase(value: unknown, inputs: readonly TaskInputField[], outputNames: ReadonlySet<string>): TaskConformanceCase {
  if (!isRecord(value)) throw new TaskRegistryError("Task conformance case is invalid.");
  exactKeys(value, ["name", "inputs", "expectedOutputNames"], "Task conformance case");
  const name = boundedText(value["name"], "Task conformance case name", 80);
  const inputValues = validateTaskInputs(inputs, value["inputs"]).inputs;
  const expected = value["expectedOutputNames"];
  if (!Array.isArray(expected) || expected.length < 1 || expected.length > outputNames.size ||
      expected.some((outputName) => typeof outputName !== "string" || !outputNames.has(outputName)) ||
      new Set(expected).size !== expected.length) {
    throw new TaskRegistryError("Task conformance case output names are invalid.");
  }
  return { name, inputs: inputValues, expectedOutputNames: expected };
}

export function validateTaskInputs(
  fields: readonly TaskInputField[],
  value: unknown,
): TaskValidationResult {
  if (!isRecord(value)) throw new TaskRegistryError("Task inputs must be a JSON object.");
  const definitions = new Map(fields.map((field) => [field.name, field]));
  if (Object.keys(value).some((name) => !definitions.has(name))) {
    throw new TaskRegistryError("Task inputs contain fields not declared by the task.");
  }
  const result: RecordValue = {};
  for (const field of fields) {
    const item = value[field.name];
    if (item === undefined) {
      if (field.required) throw new TaskRegistryError(`Required task input is missing: ${field.name}.`);
      continue;
    }
    const valid = field.type === "string" || field.type === "file" || field.type === "directory"
      ? typeof item === "string" && item.trim().length > 0 && item.length <= 2_048
      : field.type === "number"
        ? typeof item === "number" && Number.isFinite(item)
        : field.type === "boolean"
          ? typeof item === "boolean"
          : field.type === "enum" && typeof item === "string" && field.choices?.includes(item) === true;
    if (!valid) throw new TaskRegistryError(`Task input value is invalid: ${field.name}.`);
    result[field.name] = item;
  }
  return { inputs: result, fieldNames: Object.keys(result).sort() };
}

export function validateTaskDefinition(value: unknown): TaskDefinition {
  if (!isRecord(value)) throw new TaskRegistryError("Task definition must be a JSON object.");
  exactKeys(value, DEFINITION_KEYS, "Task definition");
  const id = value["id"];
  const version = value["version"];
  if (typeof id !== "string" || !ID_PATTERN.test(id) || version !== 1) {
    throw new TaskRegistryError("Task definition id or version is invalid.");
  }
  const name = boundedText(value["name"], "Task name", 80);
  const description = boundedText(value["description"], "Task description", 512);
  const instructions = boundedText(value["instructions"], "Task instructions", MAX_INSTRUCTIONS);
  const inputsValue = value["inputs"];
  const outputsValue = value["outputs"];
  const toolsValue = value["requiredTools"];
  const examplesValue = value["examples"];
  const testsValue = value["tests"];
  if (!Array.isArray(inputsValue) || inputsValue.length < 1 || inputsValue.length > MAX_DEFINITION_FIELDS ||
      !Array.isArray(outputsValue) || outputsValue.length < 1 || outputsValue.length > MAX_DEFINITION_FIELDS ||
      !Array.isArray(toolsValue) || toolsValue.length > TASK_TOOL_IDS.length ||
      !Array.isArray(examplesValue) || examplesValue.length < 1 || examplesValue.length > MAX_EXAMPLES ||
      !Array.isArray(testsValue) || testsValue.length < 1 || testsValue.length > MAX_TESTS) {
    throw new TaskRegistryError("Task definition fields exceed their limits or are missing.");
  }
  const inputs = inputsValue.map(parseInputField);
  const outputs = outputsValue.map(parseOutputField);
  if (new Set(inputs.map((field) => field.name)).size !== inputs.length ||
      new Set(outputs.map((field) => field.name)).size !== outputs.length) {
    throw new TaskRegistryError("Task field names must be unique.");
  }
  const requiredTools = toolsValue.map((tool): TaskToolId => {
    if (typeof tool !== "string" || !isTaskToolId(tool)) {
      throw new TaskRegistryError("Task definition requires an unknown tool.");
    }
    return tool;
  });
  if (new Set(requiredTools).size !== requiredTools.length) {
    throw new TaskRegistryError("Task tool declarations must be unique.");
  }
  const outputNames = new Set(outputs.map((field) => field.name));
  const examples = examplesValue.map((example) => parseExample(example, inputs));
  const tests = testsValue.map((testCase) => parseConformanceCase(testCase, inputs, outputNames));
  return { id, version: 1, name, description, instructions, inputs, outputs, requiredTools, examples, tests };
}

export function resolveTaskTools(
  task: TaskDefinition,
  availableTools: readonly TaskToolId[],
  approvedTools: readonly TaskToolId[],
): readonly TaskToolId[] {
  const available = new Set(availableTools);
  const approved = new Set(approvedTools);
  return task.requiredTools.filter((tool) => available.has(tool) && approved.has(tool));
}

const definitions: readonly unknown[] = [
  {
    id: "csv-summary",
    version: 1,
    name: "Summarize a CSV",
    description: "Read one approved CSV file and report deterministic aggregate statistics.",
    instructions: "Use the CSV analysis workflow on the exact approved input. Do not infer unprovided numeric columns or expose source rows.",
    inputs: [
      { name: "input", type: "file", required: true, description: "Path to one CSV file." },
      { name: "numericColumn", type: "string", required: false, description: "Optional exact header for decimal totals." },
    ],
    outputs: [
      { name: "summary", type: "text", description: "Row, duplicate, missing-cell and selected numeric total summary." },
      { name: "report", type: "file", description: "Optional new aggregate-only report." },
    ],
    requiredTools: ["csv.analyze"],
    examples: [{ prompt: "Summarize this synthetic sales CSV and total amount.", inputs: { input: "fixtures/sales.csv", numericColumn: "amount" }, expectedResult: "A bounded aggregate summary with the amount total." }],
    tests: [{ name: "requires an input file", inputs: { input: "fixtures/sales.csv" }, expectedOutputNames: ["summary"] }],
  },
  {
    id: "repository-inventory",
    version: 1,
    name: "Inspect a repository",
    description: "Inventory bounded repository metadata without reading source or running commands.",
    instructions: "Use repository inventory only for the explicitly approved root. Report bounded counts; do not read source contents or run commands.",
    inputs: [{ name: "root", type: "directory", required: true, description: "Exact repository root to inspect." }],
    outputs: [{ name: "inventory", type: "json", description: "Bounded metadata counts for the approved root." }],
    requiredTools: ["repository.inspect"],
    examples: [{ prompt: "Count the files in this synthetic repository.", inputs: { root: "fixtures/repository" }, expectedResult: "Bounded directory and file counts." }],
    tests: [{ name: "declares metadata output", inputs: { root: "fixtures/repository" }, expectedOutputNames: ["inventory"] }],
  },
  {
    id: "web-research",
    version: 1,
    name: "Research a question",
    description: "Retrieve bounded web sources and report an unverified answer with citations.",
    instructions: "Send only the explicitly approved query. Tie factual claims to retrieved sources and label unsupported claims as unknown.",
    inputs: [{ name: "query", type: "string", required: true, description: "Question to send after explicit transfer approval." }],
    outputs: [
      { name: "answer", type: "text", description: "Unverified answer with cited source URLs." },
      { name: "sources", type: "json", description: "Validated bounded source metadata." },
    ],
    requiredTools: ["web.search"],
    examples: [{ prompt: "Research a synthetic question about CSV quoting.", inputs: { query: "How are quoted newlines represented in CSV?" }, expectedResult: "An unverified answer with source links." }],
    tests: [{ name: "requires a bounded question", inputs: { query: "How does CSV quoting work?" }, expectedOutputNames: ["answer", "sources"] }],
  },
];

export const BUILT_IN_TASKS: readonly TaskDefinition[] = definitions.map(validateTaskDefinition);

export function getBuiltInTask(id: string): TaskDefinition | undefined {
  return BUILT_IN_TASKS.find((task) => task.id === id);
}
