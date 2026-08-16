/**
 * The shared first-order syntax core: notation dialects and the parser they
 * drive. The model and translation types both read formulas through this
 * barrel; everything semantic (finite models, equivalence theories) stays with
 * the type that owns it.
 *
 * Every module here is DOM-free and free of any i18n import, because the client
 * elements import the same code the worker grades with.
 */

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
export type { Formula, ParseError, ParseResult, Term } from "./formula";
export {
  formulaToDisplay,
  formulaToString,
  parseFormula,
  splitFormulaList,
  termToString,
} from "./formula";
