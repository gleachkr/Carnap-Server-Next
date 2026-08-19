import type { FC } from "hono/jsx";

/**
 * Reader-driven column sorting for the site's ledger tables.
 *
 * The sort itself happens in the browser — see `TABLE_SORT_SCRIPT` in
 * `./layout-scripts` — because a round trip to reorder rows already on the
 * screen is slower than the reader's own scroll. What the server ships is the
 * material the sort needs: a `data-sort` marker on each sortable heading, and,
 * where a column's text is not what it should be ordered by, a
 * `data-sort-value` on each cell.
 *
 * That division is the point. Ordering a role column by rank rather than by the
 * word "Instructor", and knowing that an unsubmitted assignment is not a zero,
 * are facts about the domain; the client only compares the values it is handed,
 * with an empty value sorting last while ascending. So a table's sort order
 * stays defined in the same file as the table, in the reader's language, while
 * the browser does the reordering.
 *
 * The heading ships as plain text and is upgraded into a button on load: with
 * no script there is nothing to click, so the table must not advertise a
 * control that would do nothing.
 *
 * Not every table wants this. A ledger read newest-first — an audit log, an
 * attempt history, a revision list — says something by its order that a sort
 * would destroy, and a table the server paginates or filters would sort only
 * the page in hand, which is a lie about the rest.
 */
export const SortHeader: FC<{ readonly label: string }> = ({ label }) => (
  <th data-sort="" scope="col">
    {label}
  </th>
);

/**
 * A cell's place in a domain order — roles by rank, states by how live they
 * are — so the column sorts the way the course works rather than the way the
 * reader's language happens to alphabetize its labels.
 */
export function sortRank<Member>(
  order: readonly Member[],
  member: Member,
): string {
  return String(order.indexOf(member));
}

/**
 * A numeric sort value, where absent is a real answer: no due date, no score,
 * nothing submitted. The empty string is what the client reads as absent, and
 * absent sorts after every value while ascending — so one more click on the
 * heading brings them all to the top, which is usually why a reader is sorting
 * that column at all.
 */
export function sortNumber(value: number | null): string {
  return value === null ? "" : String(value);
}
