/**
 * The shared, DOM-free truth-table logic core. Imported by the worker (compile
 * + authoritative grade) and the client element (instant local check).
 */

export type {
  BinaryConnective,
  Formula,
  ParseError,
  ParseResult,
} from "./formula";
export { formulaToString, parseFormula } from "./formula";
export type { CellRole, CellSegment, FormulaSegment } from "./layout";
export { formulaCells, formulaLayout } from "./layout";
export type {
  FormulaColumn,
  FormulaTable,
  TruthTable,
  TruthTableBuildError,
  TruthTableResult,
} from "./truth-table";
export {
  buildTruthTable,
  collectAtoms,
  enumerateValuations,
  evaluate,
  isTautology,
  MAX_TABLE_ATOMS,
  subformulaColumns,
} from "./truth-table";
