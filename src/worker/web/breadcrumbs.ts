import type { Translator } from "../i18n/translator";
import type { Crumb } from "./layout";

/**
 * Shared breadcrumb-trail builders. Each page passes the ancestor trail to
 * `renderShell`; the current page itself is the shell `title`, so these helpers
 * only ever produce linked ancestor crumbs.
 *
 * The three section crumbs take a translator rather than being constants: their
 * labels are the same words as the top-level nav — the trail reads as a
 * continuation of it — and the nav is rendered in the viewer's language, so a
 * fixed English label here would read as a different section. Passing `i18n`
 * also keeps those words defined once, instead of once here and once in the
 * layout's nav where the two could drift.
 */

export function coursesCrumb(i18n: Translator): Crumb {
  return { href: "/courses", label: i18n.t("Courses") };
}

export function contentCrumb(i18n: Translator): Crumb {
  return { href: "/content", label: i18n.t("Content") };
}

export function adminCrumb(i18n: Translator): Crumb {
  return { href: "/admin", label: i18n.t("Admin") };
}

export function courseCrumb(courseId: string, title: string): Crumb {
  return { href: `/courses/${courseId}`, label: title };
}

export function instructorAssignmentCrumb(
  courseId: string,
  assignmentId: string,
  title: string,
): Crumb {
  return {
    href: `/courses/${courseId}/instructor/assignments/${assignmentId}`,
    label: title,
  };
}

export function studentAssignmentCrumb(
  courseId: string,
  assignmentId: string,
  title: string,
): Crumb {
  return {
    href: `/courses/${courseId}/assignments/${assignmentId}`,
    label: title,
  };
}

export function contentItemCrumb(itemId: string, title: string): Crumb {
  return { href: `/content/${itemId}`, label: title };
}
