import type { Context } from "hono";
import type { FC } from "hono/jsx";

import type {
  AdminAuditEvent,
  AdminGlobalStats,
  AdminUserProfile,
  PlatformCapabilityGrant,
} from "../domain/admin";
import type { Course } from "../domain/courses";
import type { JsonValue } from "../domain/json";
import type { User } from "../domain/users";
import type { AppBindings } from "../http";
import { splitAtValue, VALUE } from "../i18n/translator";
import { adminCrumb } from "./breadcrumbs";
import {
  CreateBar,
  CsrfInput,
  Notice,
  Sheet,
  StatusBadge,
  SummaryStrip,
  TableScroll,
  Time,
} from "./components";
import {
  capabilityLabel,
  courseRoleOptions,
  identityProviderLabel,
  membershipStatusOptions,
  type SelectOption,
} from "./labels";
import { renderShell, useI18n } from "./layout";
import { type UserDirectory, userDisplayName } from "./users";

const SelectOptions: FC<{
  readonly options: readonly SelectOption[];
  readonly selected: string;
}> = ({ options, selected }) => (
  <>
    {options.map((option) => (
      <option selected={option.value === selected} value={option.value}>
        {option.label}
      </option>
    ))}
  </>
);

const UserStatusBadge: FC<{ readonly user: User }> = ({ user }) => {
  const i18n = useI18n();

  return user.disabledAt === null ? (
    <StatusBadge label={i18n.t("Active")} tone="ok" />
  ) : (
    <StatusBadge label={i18n.t("Suspended")} tone="danger" />
  );
};

const StatsSummary: FC<{ readonly stats: AdminGlobalStats }> = ({
  stats,
}) => {
  const i18n = useI18n();

  return (
    <SummaryStrip
      items={[
        { label: i18n.t("Users"), value: stats.users.toString() },
        {
          label: i18n.t("Active courses"),
          value: stats.activeCourses.toString(),
        },
        { label: i18n.t("Assignments"), value: stats.assignments.toString() },
        { label: i18n.t("Submissions"), value: stats.submissions.toString() },
        {
          label: i18n.t("Manual grading work"),
          value: stats.gradingWork.toString(),
        },
      ]}
    />
  );
};

const SearchForm: FC<{ readonly query?: string }> = ({ query }) => {
  const i18n = useI18n();

  return (
    <form action="/admin/users" method="get">
      <label>
        {i18n.t("Find user")}
        <br />
        <input name="query" value={query ?? ""} />
      </label>
      <button type="submit">{i18n.t("Search")}</button>
    </form>
  );
};

const UsersTable: FC<{ readonly users: readonly User[] }> = ({ users }) => {
  const i18n = useI18n();

  if (users.length === 0) {
    return <p>{i18n.t("No users matched.")}</p>;
  }

  return (
    <TableScroll>
      <thead>
        <tr>
          <th>{i18n.t("Email")}</th>
          <th>{i18n.t("Name")}</th>
          <th>{i18n.t("Status")}</th>
        </tr>
      </thead>
      <tbody>
        {users.map((user) => (
          <tr>
            <td>
              <a href={`/admin/users/${user.id}`}>{user.email}</a>
            </td>
            <td>{user.name ?? ""}</td>
            <td>
              <UserStatusBadge user={user} />
            </td>
          </tr>
        ))}
      </tbody>
    </TableScroll>
  );
};

const CapabilityGrantBar: FC<{
  readonly context: Context<AppBindings>;
  readonly userId: string;
}> = ({ context, userId }) => {
  const i18n = useI18n();

  return (
    <CreateBar
      action={`/admin/users/${userId}/capabilities`}
      context={context}
      submitLabel={i18n.t("Grant capability")}
    >
      <select aria-label={i18n.t("Capability")} name="capability" required>
        <option value="content_author">
          {capabilityLabel(i18n, "content_author")}
        </option>
        <option value="course_creator">
          {capabilityLabel(i18n, "course_creator")}
        </option>
        <option value="support_operator">
          {capabilityLabel(i18n, "support_operator")}
        </option>
        <option value="site_admin">
          {capabilityLabel(i18n, "site_admin")}
        </option>
      </select>
    </CreateBar>
  );
};

const CapabilitiesTable: FC<{
  readonly context: Context<AppBindings>;
  readonly grants: readonly PlatformCapabilityGrant[];
}> = ({ context, grants }) => {
  const i18n = useI18n();

  if (grants.length === 0) {
    return <p class="small">{i18n.t("No active platform capabilities.")}</p>;
  }

  return (
    <TableScroll>
      <thead>
        <tr>
          <th>{i18n.t("Capability")}</th>
          <th>{i18n.t("Granted")}</th>
          <th>{i18n.t("Actions")}</th>
        </tr>
      </thead>
      <tbody>
        {grants.map((grant) => (
          <tr>
            <td>{capabilityLabel(i18n, grant.capability)}</td>
            <td>
              <Time value={grant.grantedAt} />
            </td>
            <td>
              <form
                action={`/admin/users/${grant.userId}/capabilities/revoke`}
                method="post"
              >
                <CsrfInput context={context} />
                <input
                  name="capability"
                  type="hidden"
                  value={grant.capability}
                />
                <button class="danger" type="submit">
                  {i18n.t("Revoke")}
                </button>
              </form>
            </td>
          </tr>
        ))}
      </tbody>
    </TableScroll>
  );
};

const SuspensionForm: FC<{
  readonly context: Context<AppBindings>;
  readonly profile: AdminUserProfile;
}> = ({ context, profile }) => {
  const i18n = useI18n();
  const suspending = profile.user.disabledAt === null;

  return (
    <form
      action={`/admin/users/${profile.user.id}/${
        suspending ? "suspend" : "reactivate"
      }`}
      method="post"
    >
      <CsrfInput context={context} />
      <button class={suspending ? "danger" : "secondary"} type="submit">
        {suspending ? i18n.t("Suspend user") : i18n.t("Reactivate user")}
      </button>
    </form>
  );
};

const IdentitiesTable: FC<{ readonly profile: AdminUserProfile }> = ({
  profile,
}) => {
  const i18n = useI18n();

  if (profile.identities.length === 0) {
    return <p class="small">{i18n.t("No external identities.")}</p>;
  }

  return (
    <TableScroll>
      <thead>
        <tr>
          <th>{i18n.t("Provider")}</th>
          <th>{i18n.t("Subject")}</th>
        </tr>
      </thead>
      <tbody>
        {profile.identities.map((identity) => (
          <tr>
            <td>{identityProviderLabel(i18n, identity.provider)}</td>
            <td>{identity.providerSubject}</td>
          </tr>
        ))}
      </tbody>
    </TableScroll>
  );
};

/** "Verified <date>", split so the date element lands where the translator put it. */
const VerifiedAt: FC<{ readonly at: string }> = ({ at }) => {
  const i18n = useI18n();
  const [before, after] = splitAtValue(
    i18n.t("Verified {when}", { when: VALUE }),
  );

  return (
    <>
      {before}
      <Time value={at} />
      {after}
    </>
  );
};

const MembershipRepairForm: FC<{
  readonly context: Context<AppBindings>;
  readonly entry: AdminUserProfile["courses"][number];
  readonly userId: string;
}> = ({ context, entry, userId }) => {
  const i18n = useI18n();

  return (
    <form action="/admin/memberships" class="create-bar" method="post">
      <CsrfInput context={context} />
      <input name="courseId" type="hidden" value={entry.course.id} />
      <input name="userId" type="hidden" value={userId} />
      <select aria-label={i18n.t("Role")} name="role" required>
        <SelectOptions
          options={courseRoleOptions(i18n)}
          selected={entry.membership.role}
        />
      </select>
      <select aria-label={i18n.t("Status")} name="status" required>
        <SelectOptions
          options={membershipStatusOptions(i18n)}
          selected={entry.membership.status}
        />
      </select>
      <button class="secondary" type="submit">
        {i18n.t("Save")}
      </button>
    </form>
  );
};

const ProfileCoursesTable: FC<{
  readonly context: Context<AppBindings>;
  readonly profile: AdminUserProfile;
}> = ({ context, profile }) => {
  const i18n = useI18n();

  if (profile.courses.length === 0) {
    return <p class="small">{i18n.t("No course memberships.")}</p>;
  }

  return (
    <TableScroll>
      <thead>
        <tr>
          <th>{i18n.t("Course")}</th>
          <th>{i18n.t("Role & status")}</th>
        </tr>
      </thead>
      <tbody>
        {profile.courses.map((entry) => (
          <tr>
            <td>
              <a href={`/courses/${entry.course.id}`}>{entry.course.title}</a>
            </td>
            <td>
              <MembershipRepairForm
                context={context}
                entry={entry}
                userId={profile.user.id}
              />
            </td>
          </tr>
        ))}
      </tbody>
    </TableScroll>
  );
};

const MembershipCreateBar: FC<{
  readonly context: Context<AppBindings>;
  readonly courses: readonly Course[];
  readonly userId: string;
}> = ({ context, courses, userId }) => {
  const i18n = useI18n();

  if (courses.length === 0) {
    return <p class="small">{i18n.t("No courses exist yet.")}</p>;
  }

  return (
    <CreateBar
      action="/admin/memberships"
      context={context}
      submitLabel={i18n.t("Add membership")}
    >
      <input name="userId" type="hidden" value={userId} />
      <select aria-label={i18n.t("Course")} name="courseId" required>
        {courses.map((course) => (
          <option value={course.id}>{course.title}</option>
        ))}
      </select>
      <select aria-label={i18n.t("Role")} name="role" required>
        <SelectOptions options={courseRoleOptions(i18n)} selected="student" />
      </select>
      <select aria-label={i18n.t("Status")} name="status" required>
        <SelectOptions
          options={membershipStatusOptions(i18n)}
          selected="active"
        />
      </select>
    </CreateBar>
  );
};

const AuditTargets: FC<{
  readonly directory: UserDirectory;
  readonly event: AdminAuditEvent;
}> = ({ directory, event }) => {
  const i18n = useI18n();

  return (
    <>
      {event.targetUserId !== null ? (
        <a href={`/admin/users/${event.targetUserId}`}>
          {userDisplayName(
            i18n,
            directory.get(event.targetUserId) ?? null,
            event.targetUserId,
          )}
        </a>
      ) : null}
      {event.targetUserId !== null && event.targetCourseId !== null
        ? " "
        : null}
      {event.targetCourseId !== null ? (
        <a href={`/courses/${event.targetCourseId}`}>
          {i18n.t("course {courseId}", { courseId: event.targetCourseId })}
        </a>
      ) : null}
    </>
  );
};

/**
 * Whether an event's metadata is worth a disclosure to open. Several actions
 * record `{}` — a suspension's whole story is its action and its target — and a
 * triangle that opens onto an empty object is worse than no triangle.
 */
function hasMetadata(metadata: JsonValue): boolean {
  if (metadata === null) {
    return false;
  }

  if (typeof metadata === "object") {
    return Object.keys(metadata).length > 0;
  }

  return true;
}

/**
 * The support half of an event, on its own full-width line under the row: the
 * request id, and the metadata behind a disclosure when there is any. Both are
 * load-bearing — a request id is what you grep the logs with — but as columns
 * they made every row as tall as its JSON and pushed the four fields the table
 * exists to be read by off the side of the sheet.
 */
const AuditDetail: FC<{ readonly event: AdminAuditEvent }> = ({ event }) => {
  const i18n = useI18n();
  // The id rides along inside the summary rather than behind it: it names the
  // disclosure (a page of these would otherwise be a page of identical
  // "Metadata" buttons) and support can read it without opening anything.
  const request = (
    <>
      {i18n.t("Request")} <code>{event.requestId}</code>
    </>
  );

  if (!hasMetadata(event.metadata)) {
    return <p class="audit-request">{request}</p>;
  }

  return (
    <details class="audit-request">
      <summary>{request}</summary>
      <pre>{JSON.stringify(event.metadata, null, 2)}</pre>
    </details>
  );
};

const AuditTable: FC<{
  readonly directory: UserDirectory;
  readonly events: readonly AdminAuditEvent[];
}> = ({ directory, events }) => {
  const i18n = useI18n();

  if (events.length === 0) {
    return <p class="small">{i18n.t("No admin audit events yet.")}</p>;
  }

  return (
    <TableScroll>
      <thead>
        <tr>
          <th>{i18n.t("Time")}</th>
          <th>{i18n.t("Action")}</th>
          <th>{i18n.t("Actor")}</th>
          <th>{i18n.t("Targets")}</th>
        </tr>
      </thead>
      <tbody>
        {events.map((event) => (
          <>
            <tr class="audit-event">
              <td>
                <Time value={event.createdAt} />
              </td>
              <td>{event.action}</td>
              <td>
                <a href={`/admin/users/${event.actorUserId}`}>
                  {userDisplayName(
                    i18n,
                    directory.get(event.actorUserId) ?? null,
                    event.actorUserId,
                  )}
                </a>
              </td>
              <td>
                <AuditTargets directory={directory} event={event} />
              </td>
            </tr>
            {/* One event is two rows, and the rule belongs after the pair —
                see the .audit-event rules in styles.ts. */}
            <tr class="audit-event-detail">
              <td colspan={4}>
                <AuditDetail event={event} />
              </td>
            </tr>
          </>
        ))}
      </tbody>
    </TableScroll>
  );
};

export function renderAdminDashboard(
  context: Context<AppBindings>,
  model: {
    readonly auditEvents: readonly AdminAuditEvent[];
    readonly directory: UserDirectory;
    readonly saved: boolean;
    readonly stats: AdminGlobalStats;
  },
): Response {
  const i18n = context.get("i18n");

  return renderShell(
    context,
    { title: i18n.t("Platform administration") },
    <>
      {model.saved ? <Notice>{i18n.t("Change saved.")}</Notice> : null}
      <Sheet
        description={i18n.t("Operational counts for the local installation.")}
        summary={<StatsSummary stats={model.stats} />}
        title={i18n.t("Platform summary")}
      />
      <Sheet
        description={i18n.t(
          "Find users by email or name before changing platform state.",
        )}
        title={i18n.t("User search")}
      >
        <SearchForm />
      </Sheet>
      <Sheet
        description={i18n.t(
          "Register the LMS platforms and deployments allowed to launch into Carnap.",
        )}
        title={i18n.t("LMS integration")}
      >
        <p>
          <a href="/admin/lti">{i18n.t("Manage LTI platforms")}</a>
        </p>
      </Sheet>
      <Sheet
        description={i18n.t(
          "Recent administrative actions with request IDs.",
        )}
        title={i18n.t("Recent audit activity")}
      >
        <AuditTable directory={model.directory} events={model.auditEvents} />
        <p>
          <a href="/admin/audit">{i18n.t("View full audit log")}</a>
        </p>
      </Sheet>
    </>,
  );
}

export function renderAdminUsers(
  context: Context<AppBindings>,
  model: { readonly query: string; readonly users: readonly User[] },
): Response {
  const i18n = context.get("i18n");

  return renderShell(
    context,
    { breadcrumb: [adminCrumb(i18n)], title: i18n.t("User search") },
    <>
      <Sheet title={i18n.t("Search")}>
        <SearchForm query={model.query} />
      </Sheet>
      <Sheet title={i18n.t("Results")}>
        <UsersTable users={model.users} />
      </Sheet>
    </>,
  );
}

export function renderAdminUserProfile(
  context: Context<AppBindings>,
  model: {
    readonly courses: readonly Course[];
    readonly profile: AdminUserProfile;
    readonly saved: boolean;
  },
): Response {
  const i18n = context.get("i18n");
  const { profile } = model;

  return renderShell(
    context,
    {
      breadcrumb: [
        adminCrumb(i18n),
        { href: "/admin/users", label: i18n.t("Users") },
      ],
      title: profile.user.name ?? profile.user.email,
    },
    <>
      {model.saved ? <Notice>{i18n.t("Change saved.")}</Notice> : null}
      <Sheet
        footer={
          <CapabilityGrantBar context={context} userId={profile.user.id} />
        }
        summary={
          <div class="record-headline">
            <SummaryStrip
              items={[
                { label: i18n.t("Email"), value: profile.user.email },
                {
                  label: i18n.t("Email status"),
                  value:
                    profile.user.emailVerifiedAt === null ? (
                      i18n.t("Unverified")
                    ) : (
                      <VerifiedAt at={profile.user.emailVerifiedAt} />
                    ),
                },
              ]}
            />
            <SuspensionForm context={context} profile={profile} />
          </div>
        }
        title={i18n.t("User record")}
      >
        <h3>{i18n.t("Platform capabilities")}</h3>
        <CapabilitiesTable context={context} grants={profile.capabilities} />
      </Sheet>
      <Sheet title={i18n.t("Identities")}>
        <IdentitiesTable profile={profile} />
      </Sheet>
      <Sheet
        footer={
          <MembershipCreateBar
            context={context}
            courses={model.courses}
            userId={profile.user.id}
          />
        }
        title={i18n.t("Course memberships")}
      >
        <ProfileCoursesTable context={context} profile={profile} />
      </Sheet>
    </>,
  );
}

export function renderAdminAudit(
  context: Context<AppBindings>,
  events: readonly AdminAuditEvent[],
  directory: UserDirectory,
): Response {
  const i18n = context.get("i18n");

  return renderShell(
    context,
    { breadcrumb: [adminCrumb(i18n)], title: i18n.t("Admin audit log") },
    <Sheet
      description={i18n.t("The most recent administrative audit events.")}
      title={i18n.t("Audit events")}
    >
      <AuditTable directory={directory} events={events} />
    </Sheet>,
  );
}

export function renderBootstrap(context: Context<AppBindings>): Response {
  const i18n = context.get("i18n");
  const title = i18n.t("Bootstrap site administrator");

  return renderShell(
    context,
    { showTitle: false, title },
    <Sheet title={title}>
      <p>
        {i18n.t(
          "If no site administrator exists, you can bootstrap this account.",
        )}
      </p>
      <form action="/admin/bootstrap" method="post">
        <CsrfInput context={context} />
        <label>
          {i18n.t("Bootstrap token, if configured")}
          <br />
          <input name="bootstrapToken" />
        </label>
        <button type="submit">{title}</button>
      </form>
    </Sheet>,
  );
}
