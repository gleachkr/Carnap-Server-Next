import type { WorkerLspServer } from "@aufbau/lsp";
import type { EquivalenceCheckSources } from "../worker/exercises/translation/logic/mm0";
import { proofCompilerLocale } from "./proof-compiler";

/**
 * The one Aufbau language server a page gets — the `auto?` proof search behind
 * the translation widget's equivalence check.
 *
 * Search lives in `@aufbau/lsp`'s wasm, not the compiler's: `compile()` treats
 * an `auto?` placeholder as an unfilled hole. The protocol loop here is
 * the one Aufbau's own web editor runs — sync a sibling `current.mm0` /
 * `current.auf` document pair (mm0 first; the server analyzes a proof against
 * its sibling by path), request `textDocument/codeAction` at the placeholder,
 * and apply the returned edits to get an ordinary proof the compiler can
 * certify.
 *
 * The server runs in a Web Worker (its ~11 MB wasm instantiates off-thread,
 * and a search on a big goal can take a couple hundred milliseconds), loaded
 * lazily on the first check. One server per page, one document pair, and one
 * request in flight at a time: calls queue on {@link searchChain}, because two
 * checks interleaving their didChange/codeAction pairs would race on the
 * shared documents.
 */

/** Where `build:client` copies the package trio. The worker imports its
 * `./index.js` sibling and fetches `./lsp.wasm`, so the three must stay
 * together and same-origin (our CSP has no `worker-src` carve-outs). */
const LSP_WORKER_URL = "/assets/aufbau-lsp/worker.js";

const MM0_URI = "file:///translation/current.mm0";
const AUF_URI = "file:///translation/current.auf";

/** A dead worker should surface as an error, not an eternal spinner. The
 * search itself is budgeted far below this. */
const REQUEST_TIMEOUT_MS = 30_000;

interface LspPosition {
  readonly character: number;
  readonly line: number;
}

interface LspTextEdit {
  readonly newText: string;
  readonly range: { readonly end: LspPosition; readonly start: LspPosition };
}

interface LspCodeAction {
  readonly edit?: { readonly changes?: Record<string, LspTextEdit[]> };
}

interface SearchSession {
  readonly server: WorkerLspServer;
  readonly pending: Map<
    number,
    {
      resolve: (result: unknown) => void;
      reject: (error: Error) => void;
    }
  >;
  nextRequestId: number;
  nextVersion: number;
  opened: boolean;
}

let sessionPromise: Promise<SearchSession> | null = null;

/** Strictly serializes searches; see the module note. */
let searchChain: Promise<unknown> = Promise.resolve();

function request(
  session: SearchSession,
  method: string,
  params: unknown,
): Promise<unknown> {
  session.nextRequestId += 1;
  const id = session.nextRequestId;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      session.pending.delete(id);
      reject(new Error(`LSP request timed out: ${method}`));
    }, REQUEST_TIMEOUT_MS);
    session.pending.set(id, {
      reject: (error) => {
        clearTimeout(timer);
        reject(error);
      },
      resolve: (result) => {
        clearTimeout(timer);
        resolve(result);
      },
    });
    session.server.send({ id, jsonrpc: "2.0", method, params });
  });
}

async function loadSession(): Promise<SearchSession> {
  const { loadLspServerWorker } = await import("@aufbau/lsp");
  const locale = proofCompilerLocale();
  const server = await loadLspServerWorker({
    ...(locale === undefined ? {} : { locale }),
    workerUrl: LSP_WORKER_URL,
  });
  const session: SearchSession = {
    nextRequestId: 0,
    nextVersion: 0,
    opened: false,
    pending: new Map(),
    server,
  };

  server.subscribe((message) => {
    let parsed: unknown;
    try {
      parsed = typeof message === "string" ? JSON.parse(message) : message;
    } catch {
      return;
    }
    if (typeof parsed !== "object" || parsed === null) {
      return;
    }
    const response = parsed as {
      readonly id?: number;
      readonly error?: { readonly message?: string };
      readonly result?: unknown;
    };
    if (response.id === undefined) {
      return; // a notification (diagnostics); nothing here consumes them
    }
    const handler = session.pending.get(response.id);
    if (handler === undefined) {
      return;
    }
    session.pending.delete(response.id);
    if (response.error !== undefined) {
      handler.reject(
        new Error(response.error.message ?? "LSP request failed"),
      );
    } else {
      handler.resolve(response.result);
    }
  });

  await request(session, "initialize", { capabilities: {} });
  server.send({ jsonrpc: "2.0", method: "initialized", params: {} });
  return session;
}

/**
 * Load the search server, instantiating it at most once per page. A failed
 * load is deliberately *not* remembered — same rationale as
 * `proof-compiler.ts`: the first attempt happens on the first check, and a
 * network blip there would otherwise disable checking for the session.
 */
function loadProofSearch(): Promise<SearchSession> {
  if (sessionPromise === null) {
    sessionPromise = loadSession().catch((error: unknown) => {
      sessionPromise = null;

      throw error;
    });
  }

  return sessionPromise;
}

function syncDocuments(
  session: SearchSession,
  mm0: string,
  auf: string,
): void {
  const documents = [
    { languageId: "mm0", text: mm0, uri: MM0_URI },
    { languageId: "aufbau", text: auf, uri: AUF_URI },
  ];
  for (const { languageId, text, uri } of documents) {
    session.nextVersion += 1;
    session.server.send(
      session.opened
        ? {
            jsonrpc: "2.0",
            method: "textDocument/didChange",
            params: {
              contentChanges: [{ text }],
              textDocument: { uri, version: session.nextVersion },
            },
          }
        : {
            jsonrpc: "2.0",
            method: "textDocument/didOpen",
            params: {
              textDocument: { languageId, text, uri, version: 1 },
            },
          },
    );
  }
  session.opened = true;
}

/** Apply LSP text edits to a document, bottom-up so positions stay valid. */
function applyEdits(text: string, edits: readonly LspTextEdit[]): string {
  let lines = text.split("\n");
  const sorted = [...edits].sort(
    (a, b) =>
      b.range.start.line - a.range.start.line ||
      b.range.start.character - a.range.start.character,
  );
  for (const edit of sorted) {
    const { start, end } = edit.range;
    const startLine = lines[start.line] ?? "";
    const endLine = lines[end.line] ?? "";
    const before =
      lines.slice(0, start.line).join("\n") +
      (start.line > 0 ? "\n" : "") +
      startLine.slice(0, start.character);
    const after =
      endLine.slice(end.character) +
      (end.line < lines.length - 1
        ? `\n${lines.slice(end.line + 1).join("\n")}`
        : "");
    lines = (before + edit.newText + after).split("\n");
  }
  return lines.join("\n");
}

/**
 * Search for the `auto?` proof the sources ask for.
 *
 * Resolves to the *expanded proof text* — the one-line `by auto?` proof with
 * the found rule application spliced in, ready for the compiler — or `null`
 * when the search comes up empty, which for these goals means the two sides
 * are not equivalent. Throws when the machinery itself fails (worker won't
 * load, request times out); callers show that as a malfunction, not a
 * verdict.
 */
export async function findEquivalenceProof(
  sources: EquivalenceCheckSources,
): Promise<string | null> {
  const run = searchChain.then(async () => {
    const session = await loadProofSearch();
    syncDocuments(session, sources.mm0, sources.auf);
    const actions = (await request(session, "textDocument/codeAction", {
      context: { diagnostics: [] },
      range: { end: sources.placeholder, start: sources.placeholder },
      textDocument: { uri: AUF_URI },
    })) as readonly LspCodeAction[] | null | undefined;

    const edits = (actions ?? []).flatMap((action) =>
      action.edit?.changes ? Object.values(action.edit.changes).flat() : [],
    );

    return edits.length === 0 ? null : applyEdits(sources.auf, edits);
  });

  // The chain must survive a failed run, or one hiccup wedges every later
  // check behind a rejected promise.
  searchChain = run.catch(() => undefined);
  return run;
}
