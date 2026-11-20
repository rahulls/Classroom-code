import "server-only";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { auth, type OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { UserError } from "@/core/action";
import { decrypt, encrypt } from "@/core/crypto";
import { CHAOS_HOME } from "./jobs";

// Chaos Creators ↔ Canva. The studio talks to Canva's MCP server (the same one Claude uses) with
// its own Canva login: "Connect Canva" runs the OAuth sign-in once, and the tokens (refreshed
// automatically) are kept encrypted in %LOCALAPPDATA%\RSC Classroom\chaos\canva.json.
// Canva's AI ("create-design") makes the thumbnail and the intro / ending artwork; every design is
// filed in Rahul's Canva folder for the studio, then exported as PNG.

const SERVER = "https://mcp.canva.com/mcp";
export const CANVA_CALLBACK_PATH = "/chaos/canva/callback";
/** Rahul's Canva folder "Chaos Creators - Video Templates": every design the studio makes goes here. */
const FOLDER = process.env.CHAOS_CANVA_FOLDER || "FAHbNKpGaH0";
const P_KEY = "chaos.canva.oauth";

type Stored = {
  /** Encrypted JSON of the fields below */
  data?: string;
};
type Secret = {
  client?: OAuthClientInformationMixed;
  /** The callback the client was registered with (a different port needs a new registration) */
  redirectUri?: string;
  tokens?: OAuthTokens;
  verifier?: string;
  state?: string;
  connectedAt?: string;
};

const file = () => path.join(CHAOS_HOME, "canva.json");

function read(): Secret {
  try {
    const s = JSON.parse(fs.readFileSync(file(), "utf8")) as Stored;
    return s.data ? (JSON.parse(decrypt(s.data, P_KEY)) as Secret) : {};
  } catch {
    return {};
  }
}

function write(s: Secret) {
  fs.mkdirSync(CHAOS_HOME, { recursive: true });
  fs.writeFileSync(file() + ".tmp", JSON.stringify({ data: encrypt(JSON.stringify(s), P_KEY) } satisfies Stored), "utf8");
  fs.renameSync(file() + ".tmp", file());
}

const update = (patch: Partial<Secret>) => write({ ...read(), ...patch });

export function canvaConnection(): { connected: boolean; connectedAt?: string } {
  const s = read();
  return { connected: !!s.tokens?.access_token, connectedAt: s.connectedAt };
}

export function disconnectCanva() {
  fs.rmSync(file(), { force: true });
}

/** The address Canva sends Rahul back to after signing in. */
export function canvaRedirectUri(h: Headers) {
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:4310";
  const proto = h.get("x-forwarded-proto") ?? (/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(host) ? "http" : "https");
  return `${proto}://${host}${CANVA_CALLBACK_PATH}`;
}

/** The OAuth client the MCP SDK drives: registration, PKCE, tokens and refresh, all kept in canva.json. */
class Provider implements OAuthClientProvider {
  /** Set when the SDK wants Rahul to sign in */
  authUrl: URL | null = null;
  constructor(private readonly redirectUri: string | undefined) {}

  get redirectUrl() {
    return this.redirectUri;
  }
  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "RSC Classroom – Chaos Creators studio",
      redirect_uris: this.redirectUri ? [this.redirectUri] : [],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }
  state() {
    const state = randomBytes(24).toString("base64url");
    update({ state });
    return state;
  }
  clientInformation() {
    const s = read();
    // Registered for another address (e.g. the dev port): register again
    if (this.redirectUri && s.redirectUri && s.redirectUri !== this.redirectUri) return undefined;
    return s.client;
  }
  saveClientInformation(client: OAuthClientInformationMixed) {
    update({ client, redirectUri: this.redirectUri });
  }
  tokens() {
    return read().tokens;
  }
  saveTokens(tokens: OAuthTokens) {
    const s = read();
    write({ ...s, tokens, connectedAt: s.connectedAt ?? new Date().toISOString() });
  }
  redirectToAuthorization(url: URL) {
    this.authUrl = url;
  }
  saveCodeVerifier(verifier: string) {
    update({ verifier });
  }
  codeVerifier() {
    const v = read().verifier;
    if (!v) throw new UserError("The Canva sign-in expired. Click Connect Canva again.");
    return v;
  }
  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier") {
    const s = read();
    if (scope === "all") return write({});
    if (scope === "client") return write({ ...s, client: undefined, redirectUri: undefined });
    if (scope === "tokens") return write({ ...s, tokens: undefined });
    write({ ...s, verifier: undefined });
  }
}

/** "Connect Canva": the URL of Canva's sign-in page (registers the studio with Canva the first time). */
export async function startCanvaConnect(redirectUri: string): Promise<string> {
  update({ tokens: undefined, connectedAt: undefined });
  const p = new Provider(redirectUri);
  const res = await auth(p, { serverUrl: SERVER });
  if (res === "AUTHORIZED") return "";
  if (!p.authUrl) throw new UserError("Canva didn't give a sign-in page. Try again.");
  return p.authUrl.toString();
}

/** Canva sent Rahul back with a code: check the state and swap the code for tokens. */
export async function finishCanvaConnect(redirectUri: string, code: string, state: string) {
  const s = read();
  if (!s.state || s.state !== state) throw new UserError("The Canva sign-in took too long or came from somewhere else. Click Connect Canva again.");
  const res = await auth(new Provider(redirectUri), { serverUrl: SERVER, authorizationCode: code });
  update({ state: undefined, verifier: undefined, connectedAt: new Date().toISOString() });
  if (res !== "AUTHORIZED") throw new UserError("Canva didn't finish the sign-in. Try again.");
}

// ------------------------------ calling Canva ------------------------------

async function connect(): Promise<Client> {
  if (!canvaConnection().connected) throw new UserError("Connect Canva first (Chaos Creators → Canva).");
  const client = new Client({ name: "rsc-chaos-studio", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(SERVER), { authProvider: new Provider(read().redirectUri) });
  try {
    await client.connect(transport);
  } catch (e) {
    if (/unauthori[sz]ed|401|invalid_grant/i.test(String(e))) throw new UserError("Canva signed the studio out. Connect Canva again.");
    throw e;
  }
  return client;
}

/** One Canva tool call; its answer is JSON in a text block. */
async function call<T>(client: Client, name: string, args: Record<string, unknown>): Promise<T> {
  const res = await client.callTool({ name, arguments: { ...args, user_intent: "Chaos Creators studio: quiz video thumbnail and intro/ending artwork" } }, undefined, {
    timeout: 120_000,
  });
  const text = (res.content as { type: string; text?: string }[]).find((c) => c.type === "text")?.text ?? "";
  if (res.isError) throw new UserError(`Canva: ${text.slice(0, 300) || "the request failed"}`);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new UserError(`Canva sent an answer the studio couldn't read: ${text.slice(0, 200)}`);
  }
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

type JobAnswer = {
  job_id?: string;
  status?: string;
  continuation_token?: string;
  polling_policy?: { wait_seconds?: number };
  design?: { id: string; url?: string };
  error?: unknown;
};

/**
 * Canva's AI makes a design from a brief, files it in the studio folder and exports it as PNG.
 * Returns the PNG of every page (Canva sometimes adds a blank first page; the caller picks).
 * About 1–2 minutes.
 */
export async function canvaDesign(brief: string, format: string, client?: Client, references?: string[]): Promise<{ designId: string; url?: string; pages: Buffer[] }> {
  const c = client ?? (await connect());
  try {
    let job = await call<JobAnswer>(c, "create-design", { brief, format, ...(references?.length ? { references } : {}) });
    const started = Date.now();
    while (!job.design) {
      if (job.status && /fail|error/i.test(job.status)) throw new UserError(`Canva couldn't make the design (${job.status}).`);
      if (Date.now() - started > 6 * 60_000) throw new UserError("Canva took more than 6 minutes. Try again.");
      if (!job.job_id || !job.continuation_token) throw new UserError("Canva didn't start the design.");
      await wait(Math.max(5, job.polling_policy?.wait_seconds ?? 10) * 1000 + 500);
      const next = await call<JobAnswer>(c, "get-create-design-async-job", { job_id: job.job_id, continuation_token: job.continuation_token });
      job = { ...next, job_id: next.job_id ?? job.job_id };
    }
    const designId = job.design.id;
    await call(c, "move-item-to-folder", { item_id: designId, to_folder_id: FOLDER }).catch((e) => console.error("[canva] couldn't file the design", e));
    const exp = await call<{ job?: { status?: string; urls?: string[] } }>(c, "export-design", { design_id: designId, format: { type: "png" } });
    const urls = exp.job?.urls ?? [];
    if (!urls.length) throw new UserError("Canva didn't export the design.");
    const pages: Buffer[] = [];
    for (const u of urls) {
      const r = await fetch(u); // export links must be used exactly as given
      if (!r.ok) throw new UserError(`Couldn't download Canva's export (${r.status}).`);
      pages.push(Buffer.from(await r.arrayBuffer()));
    }
    return { designId, url: job.design.url, pages };
  } finally {
    if (!client) await c.close().catch(() => {});
  }
}

export async function withCanva<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const c = await connect();
  try {
    return await fn(c);
  } finally {
    await c.close().catch(() => {});
  }
}

type ImageJob = { jobId?: string; status?: string; result?: { results?: { type: string; id: string }[] }; failureType?: string; failureMessage?: string };

/** Canva's AI image generator: returns the new image's Canva media id (about 20–60 s). */
export async function canvaImage(prompt: string, aspectRatio: "PORTRAIT_9_16" | "LANDSCAPE_16_9", client: Client): Promise<string> {
  const start = await call<ImageJob>(client, "generate-image", { prompt, aspectRatio });
  if (!start.jobId) throw new UserError("Canva didn't start the picture.");
  const t0 = Date.now();
  for (;;) {
    await wait(5000);
    const j = await call<ImageJob>(client, "get-generate-image-job", { jobId: start.jobId });
    const id = j.result?.results?.find((r) => r.type === "MEDIA")?.id;
    if (j.status === "SUCCESS" && id) return id;
    if (j.status === "FAILURE") throw new UserError(`Canva couldn't make the picture: ${j.failureMessage ?? j.failureType ?? "unknown reason"}`);
    if (Date.now() - t0 > 4 * 60_000) throw new UserError("Canva took more than 4 minutes for a picture.");
  }
}

/**
 * A full-size picture: Canva's image tool only hands back a small preview, so the image is put on
 * a one-page design of its own (one image per design: with several, Canva's AI mixes them up)
 * and exported. Returns the exported pages (the caller skips blank ones).
 */
export async function canvaPicture(prompt: string, vertical: boolean, client: Client): Promise<Buffer[]> {
  const media = await canvaImage(prompt, vertical ? "PORTRAIT_9_16" : "LANDSCAPE_16_9", client);
  const d = await canvaDesign(
    "A single page showing only the reference image, filling the entire page edge to edge. Nothing else: no text, no shapes, no logos, no borders.",
    vertical ? "Your Story" : "Presentation (16:9)",
    client,
    [media],
  );
  return d.pages;
}
