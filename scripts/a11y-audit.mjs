/**
 * Tier 2 accessibility audit — full axe-core (WCAG 2.2 AA) in real headless
 * Chromium against a running dev server. This is the high-fidelity half of the
 * a11y strategy (see docs/a11y.md): unlike the jsdom gate, a real browser
 * renders the page, so colour-contrast, target-size, the content iframe, open
 * shadow DOM, and post-hydration (enhanced) widget states all get audited.
 *
 * Node builtins only (Node >= 22 for global WebSocket) — same CDP approach as
 * the page-shot skill; nothing is installed for the driver. axe-core is read
 * from node_modules and injected into every frame.
 *
 * Prereqs: `bun run dev` (or `wrangler dev`) serving the base URL, and a login
 * account (defaults to the local site_admin used for screenshots).
 *
 *   bun run a11y:audit           gate: fail (exit 1) on findings not baselined
 *   bun run a11y:audit:dark      the same, as a reader whose OS is dark
 *   bun run a11y:audit:report    print the full inventory; never fails
 *   node scripts/a11y-audit.mjs --update   rewrite baseline.browser.json
 *
 * Flags: --report, --update, --dark, --base=URL, --email=ADDR, plus extra
 * route paths as positional args (added to the audited set).
 *
 *   --dark        emulate `prefers-color-scheme: dark`, which is the whole of
 *                 how the dark palette is reached — there is no toggle and no
 *                 cookie. Findings are fingerprinted `dark :: …`, so one
 *                 baseline file holds both palettes and neither run prunes the
 *                 other's entries. Contrast is the reason this exists: it is
 *                 the one rule class that cannot be checked without rendering,
 *                 and the one the second palette puts most at risk.
 *
 * Two flags serve the i18n work rather than a11y, because this is the only
 * harness here with a real layout engine:
 *
 *   --lang=TAG    send `Accept-Language: TAG` on every request, so the whole
 *                 audit runs in that language. `--lang=en-XA` is the
 *                 pseudolocale, whose ~35% text expansion is the cheap way to
 *                 find copy that only fits in English.
 *   --overflow    additionally report text clipped by its own container, or
 *                 spilling past the viewport. Advisory only — it never changes
 *                 the exit status, since the pseudolocale is deliberately
 *                 harsher than any real language.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = join(
  HERE,
  "..",
  "tests",
  "a11y",
  "baseline.browser.json",
);
const AXE_PATH = join(HERE, "..", "node_modules", "axe-core", "axe.min.js");
const AXE_SRC = readFileSync(AXE_PATH, "utf8");

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => {
  const hit = args.find((a) => a.startsWith(`${name}=`));
  return hit ? hit.slice(name.length + 1) : fallback;
};
const REPORT = flag("--report");
const UPDATE = flag("--update");
const BASE = opt("--base", "http://localhost:8787").replace(/\/$/, "");
const EMAIL = opt("--email", "claude-agent@example.test");
const EXTRA_ROUTES = args.filter((a) => a.startsWith("/"));
const LANG = opt("--lang", "");
const OVERFLOW = flag("--overflow");
const DARK = flag("--dark");

const AA_TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];
const CHROME =
  process.env.CHROME ||
  [
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
  ].find(existsSync) ||
  "chromium";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.sessionId = undefined;
    ws.addEventListener("message", (e) => {
      const m = JSON.parse(e.data);
      if (m.id && this.pending.has(m.id)) {
        const { resolve, reject } = this.pending.get(m.id);
        this.pending.delete(m.id);
        m.error ? reject(new Error(m.error.message)) : resolve(m.result);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.ws.send(
      JSON.stringify({ id, method, params, sessionId: this.sessionId }),
    );
    return new Promise((res, rej) =>
      this.pending.set(id, { resolve: res, reject: rej }),
    );
  }
}

/** Passwordless local login: POST /login, pull the dev confirm link. */
async function loginConfirmPath() {
  const response = await fetch(`${BASE}/login`, {
    body: new URLSearchParams({ email: EMAIL }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST",
    redirect: "manual",
  });
  const html = await response.text();
  const match = html.match(/href="([^"]*\/login\/confirm[^"]+)"/);
  if (!match) {
    throw new Error(
      `Could not find a local login-confirm link for ${EMAIL}. Is the dev ` +
        `server in local mode? (status ${response.status})`,
    );
  }
  const url = new URL(match[1], BASE);
  return `${url.pathname}${url.search}`;
}

function flattenTarget(target) {
  return Array.isArray(target)
    ? target.map(flattenTarget).join(" ")
    : String(target);
}

/**
 * Collapse a positional axe selector to the meaningful trailing token, so the
 * baseline keys on the offending *component* rather than its row/column in
 * whatever data the dev DB happens to hold (`tr:nth-child(10) > td:nth-child(3)
 * > .status-badge-ok` → `.status-badge-ok`). Without this the baseline would
 * churn on every data change.
 */
function normalizeTarget(target) {
  const stripped = target
    .replace(/:nth-child\(\d+\)/g, "")
    .replace(/:nth-of-type\(\d+\)/g, "")
    .trim();
  const segments = stripped.split(/\s*>\s*|\s+/).filter(Boolean);
  return segments.at(-1) || stripped;
}

/** Template out per-record id/token path segments so routes are stable keys. */
function normalizeRoute(route) {
  return route
    .split("/")
    .map((seg) =>
      /^[0-9a-f]{8}-[0-9a-f-]+$/i.test(seg) ||
      /^[a-z]+_[A-Za-z0-9_-]{6,}$/.test(seg)
        ? ":id"
        : seg,
    )
    .join("/");
}

async function main() {
  const confirmPath = await loginConfirmPath();

  const chrome = spawn(
    CHROME,
    [
      "--headless=new",
      "--no-sandbox",
      "--no-first-run",
      "--hide-scrollbars",
      "--remote-debugging-port=0",
      "--force-device-scale-factor=1",
      "--window-size=1280,1400",
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  const wsUrl = await new Promise((res, rej) => {
    let buf = "";
    const to = setTimeout(
      () => rej(new Error("Chrome DevTools timeout")),
      15000,
    );
    chrome.stderr.on("data", (d) => {
      buf += d;
      const m = buf.match(/ws:\/\/\S+/);
      if (m) {
        clearTimeout(to);
        res(m[0]);
      }
    });
  });
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.addEventListener("open", res);
    ws.addEventListener("error", rej);
  });
  const cdp = new CDP(ws);
  const { targetId } = await cdp.send("Target.createTarget", {
    url: "about:blank",
  });
  const { sessionId } = await cdp.send("Target.attachToTarget", {
    targetId,
    flatten: true,
  });
  cdp.sessionId = sessionId;
  await cdp.send("Page.enable");
  await cdp.send("Runtime.enable");
  if (LANG) {
    // The header, not a query parameter: `?lang=` is deliberately not a
    // detection source (see middleware/locale.ts), so this is the only way in.
    await cdp.send("Network.enable");
    await cdp.send("Network.setExtraHTTPHeaders", {
      headers: { "Accept-Language": LANG },
    });
  }
  if (DARK) {
    // The dark palette is a media query and nothing else -- no cookie, no
    // attribute -- so emulating the query is the only way in, and it is also
    // the whole of what a reader with a dark desktop does. It applies to every
    // frame of the target, which matters: the content document is a separate
    // document that answers the query for itself.
    await cdp.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: "dark" }],
    });
  }
  // axe present in every frame — parent AND the same-origin content iframe.
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
    source: AXE_SRC,
  });

  const go = async (path) => {
    await cdp.send("Page.navigate", { url: `${BASE}${path}` });
    await sleep(1400); // load + custom-element upgrade + settle
  };
  const evaluate = async (expression) => {
    const { result, exceptionDetails } = await cdp.send("Runtime.evaluate", {
      awaitPromise: true,
      expression,
      returnByValue: true,
    });
    if (exceptionDetails) {
      throw new Error(
        exceptionDetails.exception?.description || exceptionDetails.text,
      );
    }
    return result.value;
  };

  // Authenticate (confirm link lands on /courses and sets the session cookie).
  await go(confirmPath);

  // Did `--lang` actually take? A *stored* account language preference outranks
  // `Accept-Language` on every page a signed-in reader sees (see
  // middleware/locale.ts `applyLocale`), and the header is the only way in
  // because `?lang=` is deliberately not a detection source. So for a real
  // language, an audit account that has ever used the switcher renders its own
  // instead, and every finding below describes the wrong copy.
  //
  // The pseudolocale is the exception: `applyLocale` lets it outrank a stored
  // preference precisely so this check can work, so a mismatch there is not
  // audit-account hygiene but a precedence regression — `bun run i18n:overflow`
  // would otherwise go on measuring real, unexpanded copy and reporting a clean
  // run over a page it never rendered in en-XA. Hence a hard failure, even
  // though `--report` suppresses the finding-driven one.
  if (LANG) {
    const landedLang = await evaluate("document.documentElement.lang");
    if (landedLang !== LANG) {
      const pseudo = LANG.toLowerCase() === "en-xa";
      console.error(
        `\n!! --lang=${LANG} did NOT take: pages are rendering in ` +
          `"${landedLang}".\n` +
          (pseudo
            ? "   The pseudolocale is supposed to outrank a stored " +
              "preference — see `applyLocale`\n   in " +
              "src/worker/middleware/locale.ts. Layout findings below " +
              "describe the wrong\n   language, and the overflow check is " +
              "measuring nothing it claims to.\n"
            : `   ${EMAIL} has a stored language preference, which outranks ` +
              "Accept-Language.\n   Clear it (or audit with --email=ADDR for " +
              "an account that has never set one),\n   otherwise every " +
              "finding below describes the wrong language.\n"),
      );
      if (pseudo) {
        process.exitCode = 1;
      }
    }
  }

  /**
   * Same-origin link paths on the current page matching `source` (a RegExp
   * source string, compiled in the page — so no backslash has to survive two
   * levels of quoting on the way in).
   */
  const links = async (source) =>
    evaluate(
      `(() => {
         const re = new RegExp(${JSON.stringify(source)});
         return [...document.querySelectorAll("a[href]")]
           .map((a) => { try { return new URL(a.href).pathname; }
                         catch { return ""; } })
           .filter((p) => re.test(p));
       })()`,
    );

  // Discover real records to audit: every page worth auditing hangs off an id,
  // so the routes are read out of the dev server's own navigation rather than
  // hard-coded. The audit account is course *staff*, so a course page links to
  // the instructor assignment pages — which is why matching only
  // `/courses/:id/assignments/:id` used to discover nothing at all, leaving the
  // whole assignment/review/gradebook half of the app unaudited.
  await go("/courses");
  const courses = [...new Set(await links("^/courses/[^/]+$"))].slice(0, 2);
  const assignmentPaths = new Set();
  const instructorPaths = new Set();
  for (const course of courses) {
    await go(course);
    for (const path of await links("^/courses/[^/]+/assignments/[^/]+$")) {
      assignmentPaths.add(path);
    }
    const instructor = "^/courses/[^/]+/instructor/assignments/[^/]+$";
    for (const path of await links(instructor)) {
      instructorPaths.add(path);
    }
  }
  // The student-facing page for an assignment reached instructor-side: the same
  // record, a different template, and the one carrying the exercise iframe that
  // the enhanced-state pass below interacts with.
  for (const path of [...instructorPaths].slice(0, 2)) {
    assignmentPaths.add(
      path.replace("/instructor/assignments/", "/assignments/"),
    );
  }

  // A revision editor over a real lesson: the authoring page and its live
  // preview iframe, which no other audited route renders.
  await go("/content");
  const [contentItem] = await links("^/content/[^/]+$");

  // A saved revision, for the read-only source viewer — a CodeMirror region
  // that only exists once its bundle has run, so it is invisible to Tier 1.
  let contentRevision;
  if (contentItem) {
    await go(contentItem);
    [contentRevision] = await links("^/content/revisions/[^/]+$");
  }

  const derived = [];
  const [assignment] = [...instructorPaths];
  if (assignment) {
    // Instructor detail, both review surfaces, and the per-assignment
    // gradebook — the pages most recently changed and least audited.
    derived.push(
      assignment,
      `${assignment}/gradebook`,
      `${assignment}/submissions?review=all`,
      `${assignment}/attempts`,
    );
  }
  const [studentAssignment] = [...assignmentPaths];
  if (studentAssignment) {
    derived.push(`${studentAssignment}/results`);
  }
  for (const course of courses) {
    derived.push(`${course}/instructor/gradebook`);
  }
  if (contentItem) {
    derived.push(`${contentItem}/revisions/new`);
  }
  if (contentRevision) {
    derived.push(contentRevision);
  }

  const routes = [
    ...new Set([
      "/courses",
      "/content",
      "/profile",
      "/donate",
      "/admin",
      "/admin/users",
      "/admin/audit",
      "/admin/lti",
      ...[...assignmentPaths].slice(0, 3),
      ...derived,
      ...EXTRA_ROUTES,
    ]),
  ];

  const axeConfig = JSON.stringify({
    resultTypes: ["violations"],
    runOnly: { type: "tag", values: AA_TAGS },
  });
  const runAxeHere = async () =>
    evaluate(
      `(async () => {
         if (!window.axe) return { violations: [] };
         const r = await window.axe.run(document, ${axeConfig});
         return { violations: r.violations.map(v => ({
           id: v.id,
           impact: v.impact,
           wcag: v.tags.filter(t => t.startsWith('wcag')),
           nodes: v.nodes.map(n => ({ target: n.target, summary: n.failureSummary || '' })),
         })) };
       })()`,
    );

  /**
   * Text clipped by its own box, or spilling past the viewport. Runs in the page
   * and in every reachable same-origin frame, so exercise content counts.
   *
   * Elements that scroll on purpose are excluded by computed `overflow`: a code
   * block or a wide table is *meant* to scroll sideways, and flagging those
   * would bury the real finding. Only leaf-ish elements are considered, since a
   * clipped child otherwise reports once per ancestor.
   */
  const overflowHere = async () =>
    evaluate(
      `(() => {
         const scan = (doc, frame) => {
           const out = [];
           const docWidth = doc.documentElement.clientWidth;
           for (const el of doc.querySelectorAll("body *")) {
             const text = (el.textContent || "").trim();
             if (text.length === 0) continue;
             // Leaf-ish only: an element whose children hold the text reports
             // through them instead.
             if (el.querySelector("*") && el.children.length > 1) continue;
             const style = doc.defaultView.getComputedStyle(el);
             if (style.display === "none" || style.visibility === "hidden") continue;
             const scrolls = /auto|scroll/.test(style.overflowX + style.overflowY);
             const clipped =
               !scrolls &&
               (el.scrollWidth > el.clientWidth + 1 ||
                el.scrollHeight > el.clientHeight + 1) &&
               /hidden|clip/.test(style.overflowX + style.overflowY);
             // "Spills past the viewport" only means anything if nothing
             // between the element and the viewport scrolls. A wide table or a
             // code block is *meant* to extend beyond the fold inside its own
             // scroller, and counting those buries every real finding.
             let inScroller = false;
             for (let p = el.parentElement; p; p = p.parentElement) {
               const ps = doc.defaultView.getComputedStyle(p);
               if (/auto|scroll/.test(ps.overflowX + ps.overflowY)) {
                 inScroller = true;
                 break;
               }
             }
             const rect = el.getBoundingClientRect();
             const spills =
               !inScroller && rect.width > 0 && rect.right > docWidth + 1;
             if (!clipped && !spills) continue;
             out.push({
               frame,
               kind: clipped ? "clipped" : "spills",
               tag: el.tagName.toLowerCase() +
                    (el.className && typeof el.className === "string"
                      ? "." + el.className.trim().split(/\\s+/).slice(0, 2).join(".")
                      : ""),
               text: text.slice(0, 70),
             });
           }
           return out;
         };
         const found = scan(document, "page");
         for (const f of document.querySelectorAll("iframe")) {
           let d;
           try { d = f.contentDocument; } catch { continue; }
           if (d) found.push(...scan(d, "content-frame"));
         }
         return found;
       })()`,
    );

  const overflowFindings = [];

  // Deduped by normalized fingerprint: N identical rows collapse to one entry.
  const byFingerprint = new Map();
  for (const route of routes) {
    await go(route);
    const landed = await evaluate("location.pathname");
    // Interact with the first exercise control, if any, then re-audit that
    // enhanced state (best-effort — a missing/þrown control must not abort).
    try {
      await evaluate(
        `(() => {
           for (const f of document.querySelectorAll('iframe')) {
             let d; try { d = f.contentDocument; } catch { continue; }
             if (!d) continue;
             const el = d.querySelector(
               '.tt-cell, .mc-input, .tree-toolbar button, input[type=radio]');
             if (el) { el.click(); return true; }
           }
           return false;
         })()`,
      );
      await sleep(500);
    } catch {
      /* ignore interaction failures */
    }
    if (OVERFLOW) {
      try {
        for (const hit of await overflowHere()) {
          overflowFindings.push({ ...hit, route: normalizeRoute(route) });
        }
      } catch {
        /* a frame that refuses inspection must not abort the audit */
      }
    }

    const result = await runAxeHere();
    for (const violation of result.violations) {
      for (const node of violation.nodes) {
        const target = normalizeTarget(flattenTarget(node.target));
        const normRoute = normalizeRoute(route);
        // The palette is part of what was audited, so it is part of the
        // identity of a finding: the same rule on the same element is a
        // different fact under a different set of colours. Prefixed only when
        // dark, so the light fingerprints already in the baseline keep their
        // spelling and one baseline file holds both runs.
        const fingerprint = `${DARK ? "dark :: " : ""}${normRoute} :: ${violation.id} :: ${target}`;
        const existing = byFingerprint.get(fingerprint);
        if (existing) {
          existing.occurrences += 1;
          continue;
        }
        byFingerprint.set(fingerprint, {
          detail: (node.summary || "").split("\n")[0],
          fingerprint,
          impact: violation.impact,
          occurrences: 1,
          route: normRoute,
          rule: violation.id,
          target,
          wcag: violation.wcag,
        });
      }
    }
    console.error(
      `audited ${route}${landed === route ? "" : ` (→ ${landed})`}: ` +
        `${result.violations.reduce((n, v) => n + v.nodes.length, 0)} finding(s)`,
    );
  }

  ws.close();
  chrome.kill();

  const findings = [...byFingerprint.values()].sort((a, b) =>
    a.fingerprint.localeCompare(b.fingerprint),
  );
  report(findings, routes);
  if (OVERFLOW) reportOverflow(overflowFindings);
}

/**
 * Advisory: never touches the exit status. The pseudolocale expands text ~35%,
 * which is harsher than any real language, so this is a list to look at rather
 * than a bar to clear.
 */
function reportOverflow(findings) {
  const label = LANG ? ` under ${LANG}` : "";

  console.log(
    `\nLayout overflow${label} — ${findings.length} element(s)` +
      (findings.length === 0 ? "  (nothing clipped or spilling)" : "") +
      "\n",
  );

  const byRoute = new Map();
  for (const f of findings) {
    const bucket = byRoute.get(f.route) ?? [];
    bucket.push(f);
    byRoute.set(f.route, bucket);
  }

  for (const route of [...byRoute.keys()].sort()) {
    const bucket = byRoute.get(route);
    console.log(`■ ${route}  (${bucket.length})`);
    for (const f of bucket) {
      const where = f.frame === "page" ? "" : ` [${f.frame}]`;
      console.log(`    ${f.kind} ${f.tag}${where}: "${f.text}"`);
    }
  }

  console.log("");
}

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) return { findings: [] };
  return JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
}

function report(findings, routes) {
  const baseline = loadBaseline();
  const baselineSet = new Set(baseline.findings.map((f) => f.fingerprint));
  const current = new Set(findings.map((f) => f.fingerprint));
  const regressions = findings.filter((f) => !baselineSet.has(f.fingerprint));
  // One baseline file holds both palettes, and a run only saw one of them.
  // Everything below has to be scoped accordingly, or a dark run reports every
  // light entry as passing and `--update` deletes the lot.
  const audited = (fingerprint) =>
    fingerprint.startsWith("dark :: ") === DARK;
  const untouched = baseline.findings.filter((f) => !audited(f.fingerprint));
  const stale = [...baselineSet].filter(
    (fp) => audited(fp) && !current.has(fp),
  );

  const byRule = new Map();
  for (const f of findings) {
    const bucket = byRule.get(f.rule) ?? [];
    bucket.push(f);
    byRule.set(f.rule, bucket);
  }
  console.log(
    `\nTier 2 a11y audit — ${routes.length} route(s), ${findings.length} finding(s)\n`,
  );
  for (const rule of [...byRule.keys()].sort()) {
    const bucket = byRule.get(rule);
    const wcag = [...new Set(bucket.flatMap((f) => f.wcag))]
      .sort()
      .join(", ");
    console.log(`■ ${rule}  (${bucket.length})  [${wcag}]`);
    for (const f of bucket) {
      const times = f.occurrences > 1 ? ` ×${f.occurrences}` : "";
      console.log(`    ${f.route}: ${f.target}${times}`);
    }
  }

  if (UPDATE) {
    const payload = {
      findings: [
        ...untouched,
        ...findings.map((f) => ({
          fingerprint: f.fingerprint,
          route: f.route,
          rule: f.rule,
          target: f.target,
          wcag: f.wcag,
        })),
      ].sort((a, b) => a.fingerprint.localeCompare(b.fingerprint)),
      note:
        "Known Tier 2 (browser) accessibility violations, accepted-for-now. " +
        "`bun run a11y:audit` fails on any finding absent here. Regenerate " +
        "with `node scripts/a11y-audit.mjs --update`; a shrinking list is " +
        "progress.",
    };
    writeFileSync(BASELINE_PATH, `${JSON.stringify(payload, null, 2)}\n`);
    console.log(`\nWrote ${findings.length} finding(s) to ${BASELINE_PATH}`);
    return;
  }

  if (stale.length > 0) {
    console.log(
      `\n${stale.length} baseline entr(y/ies) now pass — prune with ` +
        "`node scripts/a11y-audit.mjs --update`.",
    );
  }
  if (REPORT) {
    console.log(`\nReport mode — ${regressions.length} not in baseline.`);
    return;
  }
  if (regressions.length > 0) {
    console.log(
      `\n✖ ${regressions.length} NEW violation(s) not in baseline:`,
    );
    for (const f of regressions) {
      console.log(
        `  • [${f.rule}] ${f.route}: ${f.target} (${f.wcag.join(", ")})`,
      );
    }
    process.exitCode = 1;
    return;
  }
  console.log("\n✓ No new accessibility violations beyond the baseline.");
}

await main();
process.exit(process.exitCode ?? 0);
