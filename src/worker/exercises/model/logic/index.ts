/**
 * The model type's logic core: first-order syntax, finite models, and the check.
 *
 * Every module here is DOM-free and free of any i18n import, because the client
 * element imports the same code the worker grades with.
 */

export type {
  ModelInput,
  ModelProblem,
  ModelRead,
  ModelTarget,
  ModelTask,
  ModelVerdict,
} from "./check";
export { checkModel, judgeModel, readModel } from "./check";
export type {
  Associativity,
  BinaryConnective,
  ConnectiveSpellings,
  DisplayNotation,
  FirstOrderDialect,
  PrecedenceLevel,
} from "./dialect";
export {
  DEFAULT_DIALECT_ID,
  dialectById,
  FIRST_ORDER_DIALECTS,
  FORALLX_CALGARY_2019,
} from "./dialect";
export type { FieldParse, FunctionRow } from "./fields";
export {
  formatFunctionTable,
  formatTupleList,
  MAX_DOMAIN_SIZE,
  MAX_FUNCTION_ROWS,
  parseDomain,
  parseFunctionTable,
  parseNatural,
  parseTupleList,
  tupleKey,
  tuplesOver,
} from "./fields";
export type { Formula, ParseError, ParseResult, Term } from "./formula";
export {
  formulaToDisplay,
  formulaToString,
  parseFormula,
  termToString,
} from "./formula";
export type { FiniteModel } from "./model";
export { evaluateTerm, satisfies } from "./model";
export type { ModelField, ModelFieldKind } from "./signature";
export {
  blankedLabel,
  DOMAIN_FIELD,
  DOMAIN_FIELD_LABEL,
  modelSignature,
  symbolKey,
} from "./signature";
