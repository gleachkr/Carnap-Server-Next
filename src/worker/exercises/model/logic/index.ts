/**
 * The model type's logic core: finite models and the check. The first-order
 * syntax the formulas are written in lives one level up in
 * `exercises/first-order/` (it serves the translation type too) and is
 * re-exported here so the model's own modules read from one barrel.
 *
 * Every module here is DOM-free and free of any i18n import, because the client
 * element imports the same code the worker grades with.
 */

export type {
  Associativity,
  BinaryConnective,
  ConnectiveSpellings,
  DisplayNotation,
  FirstOrderDialect,
  Formula,
  ParseError,
  ParseResult,
  PrecedenceLevel,
  Term,
} from "../../first-order";
export {
  DEFAULT_DIALECT_ID,
  dialectById,
  FIRST_ORDER_DIALECTS,
  FORALLX_CALGARY_2019,
  formulaToDisplay,
  formulaToString,
  parseFormula,
  splitFormulaList,
  termToString,
} from "../../first-order";
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
  FieldParse,
  FunctionRow,
  FunctionTableLayout,
  FunctionTableRow,
} from "./fields";
export {
  formatFunctionTable,
  formatTupleList,
  functionTableLayout,
  MAX_DOMAIN_SIZE,
  MAX_FUNCTION_ROWS,
  parseDomain,
  parseFunctionTable,
  parseNatural,
  parseTupleList,
  tupleKey,
  tuplesOver,
} from "./fields";
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
