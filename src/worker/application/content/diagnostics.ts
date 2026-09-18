import type { TranslatableMessage } from "../../i18n/translator";
import type { DiagnosticMessageId } from "./diagnostic-strings";

/**
 * What the compiler says when it refuses, or hesitates over, an author's
 * source — the shape of one complaint and the two ways of raising one.
 *
 * A leaf module: the Markdown pipeline (`authoring-toolkit.ts`, `mm0.ts`,
 * `compiler.ts`), the exercise kit's directive helpers, every type's
 * `authoring.ts`, and the browser's editor preview all report through it,
 * and it depends on nothing but the message catalog's id type. The wording
 * itself lives in `diagnostic-strings.ts`; this is the envelope.
 */
/**
 * How much a diagnostic is entitled to insist.
 *
 * An `error` refuses the save. A `warning` does not: it names something the
 * compiler is confident is worth knowing and not confident is wrong — the
 * author is the one who can tell. Nothing else distinguishes them, and in
 * particular a warning is not a lesser error to be silenced: if a condition
 * is *always* a mistake it should be an error, and if the author can
 * legitimately want it, a warning is the whole of what the compiler may do.
 */
export type DiagnosticSeverity = "error" | "warning";

/**
 * One complaint about the author's source, positioned in it.
 *
 * The message is carried as data — an unfilled English template plus its values
 * — rather than as a finished sentence, because the compiler runs both in the
 * Worker and in the author's browser and has no translator in either place. The
 * revision editor words it when it lists it; everything else (the JSON error a
 * failed save returns, the tests) resolves it to English with the same call.
 */
export interface CompilerDiagnostic extends TranslatableMessage {
  readonly code: string;
  readonly column: number;
  readonly line: number;
  readonly message: DiagnosticMessageId;
  readonly severity: DiagnosticSeverity;
}

/**
 * The `{placeholder}` names in one message template.
 *
 * Recursive on purpose: it lets {@link diagnostic} demand exactly the values its
 * own sentence interpolates, so forgetting `params`, misspelling a name, or
 * passing one the sentence has no slot for are all type errors rather than a
 * `{name}` left showing in an author's face.
 */
type Placeholders<Message extends string> =
  Message extends `${string}{${infer Name}}${infer Rest}`
    ? Name | Placeholders<Rest>
    : never;

type DiagnosticValues<Message extends DiagnosticMessageId> = Readonly<
  Record<Placeholders<Message>, TranslatableMessage | number | string>
>;

/**
 * Report one problem in the author's source. `params` is required exactly when
 * `message` has placeholders, and then only its own names are accepted.
 */
export function diagnostic<Message extends DiagnosticMessageId>(
  line: number,
  code: string,
  message: Message,
  ...rest: [Placeholders<Message>] extends [never]
    ? [
        options?: {
          readonly column?: number;
          readonly severity?: DiagnosticSeverity;
        },
      ]
    : [
        options: {
          readonly column?: number;
          readonly params: DiagnosticValues<Message>;
          readonly severity?: DiagnosticSeverity;
        },
      ]
): CompilerDiagnostic {
  const options: {
    readonly column?: number;
    readonly params?: TranslatableMessage["params"];
    readonly severity?: DiagnosticSeverity;
  } = rest[0] ?? {};

  return {
    code,
    column: options.column ?? 1,
    line,
    message,
    // Errors are the default because refusing is the safe direction: a new
    // diagnostic that forgets to say which it is stops the save rather than
    // being quietly ignored.
    severity: options.severity ?? "error",
    ...(options.params === undefined ? {} : { params: options.params }),
  };
}

/**
 * Report a problem a sub-parser already worded — the starter-tree parser, whose
 * issues carry their own message and values. Separate from {@link diagnostic}
 * because the message is a variable there, so which placeholders it has is not
 * known statically and the check above cannot apply.
 */
export function diagnosticFrom(
  line: number,
  code: string,
  message: TranslatableMessage & { readonly message: DiagnosticMessageId },
  column = 1,
): CompilerDiagnostic {
  return {
    code,
    column,
    line,
    message: message.message,
    severity: "error",
    ...(message.params === undefined ? {} : { params: message.params }),
  };
}
