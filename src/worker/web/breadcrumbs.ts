import type { CourseStaffTier } from "../domain/courses";
import type { Translator } from "../i18n/translator";
import type { Crumb, LinkedCrumb } from "./layout";

/**
 * Shared breadcrumb-trail builders. Each page passes the ancestor trail to
 * `renderShell`; the current page itself is the shell `title`, so these helpers
 * produce ancestor crumbs — linked, bar the one case `staffAssignmentCrumb`
 * explains.
 *
 * The three section crumbs take a translator rather than being constants: their
 * labels are the same words as the top-level nav — the trail reads as a
 * continuation of it — and the nav is rendered in the viewer's language, so a
 * fixed English label here would read as a different section. Passing `i18n`
 * also keeps those words defined once, instead of once here and once in the
 * layout's nav where the two could drift.
 */

export function coursesCrumb(i18n: Translator): LinkedCrumb {
  return { href: "/courses", label: i18n.t("Courses") };
}

export function contentCrumb(i18n: Translator): LinkedCrumb {
  return { href: "/content", label: i18n.t("Content") };
}

export function adminCrumb(i18n: Translator): LinkedCrumb {
  return { href: "/admin", label: i18n.t("Admin") };
}

export function courseCrumb(courseId: string, title: string): LinkedCrumb {
  return { href: `/courses/${courseId}`, label: title };
}

export function instructorAssignmentCrumb(
  courseId: string,
  assignmentId: string,
  title: string,
): LinkedCrumb {
  return {
    href: `/courses/${courseId}/instructor/assignments/${assignmentId}`,
    label: title,
  };
}

/**
 * The assignment crumb on a page both tiers of staff can open — the review
 * queue, the attempt ledger, the grade table. An instructor's leads to the
 * assignment's own page; a teaching assistant cannot open that page, so
 * theirs leads to the review queue, which is where an assignment lives for a
 * grader. On the review queue itself an assistant's crumb links nowhere: the
 * page it would name is the one they are on.
 */
export function staffAssignmentCrumb(
  tier: CourseStaffTier,
  courseId: string,
  assignmentId: string,
  title: string,
  options: { readonly onReviewPage?: boolean } = {},
): Crumb {
  if (tier === "instructor") {
    return instructorAssignmentCrumb(courseId, assignmentId, title);
  }

  return options.onReviewPage
    ? { label: title }
    : {
        href: `/courses/${courseId}/instructor/assignments/${assignmentId}/submissions`,
        label: title,
      };
}

export function studentAssignmentCrumb(
  courseId: string,
  assignmentId: string,
  title: string,
): LinkedCrumb {
  return {
    href: `/courses/${courseId}/assignments/${assignmentId}`,
    label: title,
  };
}

export function contentItemCrumb(itemId: string, title: string): LinkedCrumb {
  return { href: `/content/${itemId}`, label: title };
}
