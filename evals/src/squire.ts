/**
 * Thin async wrapper around the `squire-tool` CLI.
 *
 * The harness drives Squire through the same task-scoped MCP surface the
 * gateway exposes, via the CLI (`squire-tool call <tool> '<json>'`). It works
 * wherever `squire-tool` is on PATH and authenticated — inside a Squire env
 * (the dogfooding path) or on an operator workstation enrolled with the
 * gateway. Override the binary with SQUIRE_TOOL.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const SQUIRE_TOOL = process.env.SQUIRE_TOOL ?? "squire-tool";
const CALL_TIMEOUT_MS = Number(process.env.EVALS_SQUIRE_CALL_TIMEOUT_MS ?? 660_000);

export class SquireToolError extends Error {
  readonly tool: string;
  readonly stderr: string;
  constructor(tool: string, stderr: string) {
    super(`squire-tool call ${tool} failed: ${stderr.trim()}`);
    this.name = "SquireToolError";
    this.tool = tool;
    this.stderr = stderr;
  }
}

export async function callTool<T = unknown>(tool: string, args: Record<string, unknown> = {}): Promise<T> {
  let stdout: string;
  try {
    const out = await execFileAsync(SQUIRE_TOOL, ["call", tool, JSON.stringify(args)], {
      timeout: CALL_TIMEOUT_MS,
      maxBuffer: 64 * 1024 * 1024,
    });
    stdout = out.stdout;
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    throw new SquireToolError(tool, e.stderr ?? e.message ?? String(err));
  }
  try {
    return JSON.parse(stdout) as T;
  } catch {
    throw new SquireToolError(tool, `unparseable output: ${stdout.slice(0, 500)}`);
  }
}

export interface CreatedEnv {
  id: string;
  name?: string;
  status?: string;
}

export interface TaskInfo {
  id: string;
  status: string;
  title?: string;
  model?: string;
  [key: string]: unknown;
}

export interface StreamPage {
  events: StreamEvent[];
  next_seq?: number;
  [key: string]: unknown;
}

/**
 * Raw firehose event: {id, type, message, timestamp, data, seq}. The `data`
 * payload varies by harness; the normalizer owns the aliases.
 */
export interface StreamEvent {
  id?: string;
  type?: string;
  seq?: number;
  timestamp?: string;
  data?: unknown;
  [key: string]: unknown;
}

export interface WaitEvent {
  type: string;
  task_id?: string;
  env_id?: string;
  status?: string;
  [key: string]: unknown;
}

export interface WaitEventsPage {
  events: WaitEvent[];
  next?: string;
  timed_out?: boolean;
  [key: string]: unknown;
}

export const squire = {
  listImages: () => callTool<{ images?: Array<{ id: string; slug: string }> }>("squire.list_images"),

  createEnv: (args: {
    image: string;
    initial_prompt: string;
    model?: string;
    idle_timeout_minutes?: number;
    auto_delete_minutes?: number;
    name?: string;
  }) => callTool<CreatedEnv>("squire.create_env", args),

  getEnv: (envId: string) => callTool<{ id: string; status: string }>("squire.get_env", { env_id: envId }),

  stopEnv: (envId: string) => callTool("squire.stop_env", { env_id: envId }),

  taskCreate: (args: {
    env_id: string;
    prompt: string;
    model?: string;
    harness?: string;
    title?: string;
  }) => callTool<{ id: string; task_id?: string; status?: string }>("squire.task.create", args),

  getTask: (taskId: string, envId?: string) =>
    callTool<TaskInfo>("squire.get_task", envId ? { task_id: taskId, env_id: envId } : { task_id: taskId }),

  taskStream: (taskId: string, sinceSeq = 0, envId?: string) =>
    callTool<StreamPage>("squire.task.stream", {
      task_id: taskId,
      ...(envId ? { env_id: envId } : {}),
      ...(sinceSeq ? { since_seq: sinceSeq } : {}),
      limit: 500,
    }),

  waitEvents: (args: { timeout_seconds: number; task_ids?: string[]; env_id?: string; since?: string }) =>
    callTool<WaitEventsPage>("squire.wait_events", args),

  fsRead: (path: string) => callTool<{ content?: string; content_base64?: string }>("squire.fs.read", { path }),

  fsWrite: (path: string, content: string) => callTool("squire.fs.write", { path, content }),

  fsWriteBase64: (path: string, contentBase64: string) =>
    callTool("squire.fs.write", { path, content_base64: contentBase64 }),

  fsList: (prefix: string) => callTool<{ files?: Array<{ path: string }> }>("squire.fs.list", { prefix }),
};

/** Best-effort read of an arena FS binary file as raw base64; null when absent. */
export async function fsReadBase64(path: string): Promise<string | null> {
  try {
    const res = await squire.fsRead(path);
    if (typeof res.content_base64 === "string") return res.content_base64;
    if (typeof res.content === "string") return Buffer.from(res.content, "utf8").toString("base64");
    return null;
  } catch {
    return null;
  }
}

/** Best-effort read of an arena FS text file; null when absent. */
export async function fsReadText(path: string): Promise<string | null> {
  try {
    const res = await squire.fsRead(path);
    if (typeof res.content === "string") return res.content;
    if (typeof res.content_base64 === "string") {
      return Buffer.from(res.content_base64, "base64").toString("utf8");
    }
    return null;
  } catch {
    return null;
  }
}
