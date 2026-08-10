import type { Context } from "hono";

import type { AppBindings } from "../http";

export type StatusTone = "danger" | "neutral" | "ok" | "warn";

export function wantsHtml(context: Context<AppBindings>): boolean {
  const accept = context.req.header("Accept") ?? "";

  return accept.includes("text/html") || accept.includes("*/*");
}

/**
 * Is this a browser navigation — a request whose failure a person will read?
 *
 * Deliberately stricter than {@link wantsHtml}, which also answers yes to a
 * wildcard `Accept`. That is right for a route where the page and the JSON are
 * two views of one thing (it lets `curl /courses` show the page), but wrong for
 * an error: a wildcard `Accept` is what every scripted client sends, and the
 * JSON envelope is the contract those clients parse. A browser navigating always
 * names `text/html` outright, so that is what an error page is keyed on.
 */
export function wantsHtmlErrorPage(context: Context<AppBindings>): boolean {
  return (context.req.header("Accept") ?? "").includes("text/html");
}

export function isFormSubmission(context: Context<AppBindings>): boolean {
  const contentType = context.req.header("Content-Type") ?? "";

  return (
    contentType.includes("application/x-www-form-urlencoded") ||
    contentType.includes("multipart/form-data")
  );
}

export function redirect(
  location: string,
  status: 303 | 302 = 303,
): Response {
  return new Response(null, {
    headers: { Location: location },
    status,
  });
}

export function safeNext(value: string | null): string | null {
  if (value === null || !value.startsWith("/") || value.startsWith("//")) {
    return null;
  }

  return value;
}

export function fieldValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}
