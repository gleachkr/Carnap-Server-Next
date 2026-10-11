/** @jsxImportSource preact */
/**
 * `<carnap-world>` — the interactive world editor.
 *
 * The server renders the world into a Declarative Shadow Root, inert and
 * correctly drawn with no JS (see the worker-side `renderWorldElement`). On
 * connect this element replaces that body with a Preact island: a board the
 * student edits with a pointer or the keyboard, a table of the same objects
 * made of native controls, and the sentences with their live truth values.
 *
 * Every change goes through the world kind's `apply`, so the editor is a
 * reducer over typed moves: undo is a stack of states, a refusal carries its
 * reason, and each change is announced in a polite live region. The editor
 * never holds a world that breaks the physics — two blocks on a square, a name
 * on two blocks — because the kind refuses the move that would make one.
 *
 * As with the model, there is no answer key: the Check runs the very
 * `judgeWorld` the worker grades with, over public data.
 */

import { render } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { languageNames } from "../../worker/exercise-kit/formula";
import type { ResolvedWorld } from "../../worker/exercises/world/grading";
import {
  isWorldPublicData,
  resolveWorld,
} from "../../worker/exercises/world/grading";
import type {
  BlockShape,
  BlockSize,
  BlocksMove,
  BlocksState,
} from "../../worker/exercises/world/kinds/blocks";
import {
  BOARD_SIZE,
  blockGlyph,
  SHAPES,
  SIZES,
} from "../../worker/exercises/world/kinds/blocks";
import type {
  DrawPrimitive,
  WorldKind,
  WorldWords,
} from "../../worker/exercises/world/kinds/contract";
import type {
  TruthValue,
  WorldVerdict,
} from "../../worker/exercises/world/logic/check";
import {
  judgeDistinguish,
  judgeWorld,
  truthValues,
} from "../../worker/exercises/world/logic/check";
import type {
  GameChoice,
  PlayedGame,
  WorldGameAnswer,
} from "../../worker/exercises/world/logic/game";
import { playGame } from "../../worker/exercises/world/logic/game";
import type { WorldStructure } from "../../worker/exercises/world/logic/structure";
import { worldStructure } from "../../worker/exercises/world/logic/structure";
import type { WorldStringId } from "../../worker/exercises/world/strings";
import type {
  WorldAnswerData,
  WorldPublicData,
} from "../../worker/exercises/world/types";
import { describeWorldVerdict } from "../../worker/exercises/world/verdict-text";
import { CarnapExerciseElement, register } from "./base";
import islandStyles from "./carnap-world-v1.css" with { type: "text" };
import { isAuthorPreview, mountCopySource } from "./copy-source";
import {
  createHelpDialog,
  HELP_DIALOG_STYLES,
  mountHelpTrigger,
  openHelpDialog,
} from "./help-dialog";
import { ToolbarIcon } from "./toolbar-icon";
import { TOOLBAR_STYLES, type ToolbarIconName } from "./toolbar-icons";
import {
  GameSentence,
  gameLines,
  gameText,
  lossNote,
  partValuesText,
} from "./world-game";
import type { Highlight } from "./world-highlight";
import { FormulaView, highlightAnnouncement } from "./world-highlight";

const HISTORY_LIMIT = 100;

type Words = WorldWords;

interface Cursor {
  readonly col: number;
  readonly row: number;
}

/** A block picked up to be carried to another square. */
interface Carry {
  readonly id: string;
}

/** The blocks-specific moves the editor makes, and the state it makes them on. */
type Blocks = WorldKind<BlocksState, BlocksMove>;

function asBlocks(kind: WorldKind): Blocks {
  return kind as Blocks;
}

// ---------------------------------------------------------------------------
// Drawing.
// ---------------------------------------------------------------------------

function Primitive({ primitive }: { readonly primitive: DrawPrimitive }) {
  switch (primitive.el) {
    case "polygon":
      return (
        <polygon class={primitive.className} points={primitive.points} />
      );
    case "rect":
      return (
        <rect
          class={primitive.className}
          height={primitive.height}
          width={primitive.width}
          x={primitive.x}
          y={primitive.y}
        />
      );
    case "circle":
      return (
        <circle
          class={primitive.className}
          cx={primitive.cx}
          cy={primitive.cy}
          r={primitive.r}
        />
      );
    default:
      return (
        <text class={primitive.className} x={primitive.x} y={primitive.y}>
          {primitive.text}
        </text>
      );
  }
}

function Glyph({ glyph }: { readonly glyph: readonly DrawPrimitive[] }) {
  return (
    <svg
      aria-hidden="true"
      class="world-glyph"
      focusable="false"
      viewBox="0 0 100 100"
    >
      {glyph.map((primitive, index) => (
        <Primitive key={index} primitive={primitive} />
      ))}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// The board.
// ---------------------------------------------------------------------------

interface BoardProps {
  /** The evaluation game's bound variables, by the id of their block. */
  readonly badges?: ReadonlyMap<string, string> | undefined;
  readonly carry: Carry | null;
  /** The evaluation game is waiting for a block to be chosen. */
  readonly choosing?: boolean;
  readonly cursor: Cursor;
  readonly editable: boolean;
  readonly focusCursor: boolean;
  /** Objects to ring, keyed by id, with how to ring them. */
  readonly highlight: Highlight | null;
  readonly kind: Blocks;
  readonly label: string;
  readonly onCellPointer: (cell: Cursor) => void;
  readonly onDragMove: (id: string, to: Cursor) => void;
  readonly onKeyDown: (event: KeyboardEvent) => void;
  readonly onPaletteDrop: (shape: BlockShape, to: Cursor) => void;
  readonly pinned: ReadonlySet<string>;
  readonly state: BlocksState;
  readonly words: Words;
}

/** The cell a pointer is over, read off the elements under it. */
function cellAt(root: ShadowRoot | Document, x: number, y: number) {
  for (const element of root.elementsFromPoint(x, y)) {
    const cell = (element as HTMLElement).closest?.<HTMLElement>(
      "[data-col][data-row]",
    );

    if (cell != null) {
      return {
        col: Number(cell.dataset.col),
        row: Number(cell.dataset.row),
      };
    }
  }

  return null;
}

function Board(props: BoardProps) {
  const { state, kind, words, cursor, carry } = props;
  const gridRef = useRef<HTMLTableElement>(null);
  const frameRef = useRef<HTMLDivElement>(null);
  const [dragOver, setDragOver] = useState<Cursor | null>(null);
  const drag = useRef<{
    id: string;
    x: number;
    y: number;
    /** Where in its square the block was taken hold of. */
    grab: { x: number; y: number };
    size: number;
    moved: boolean;
  } | null>(null);
  // A copy of the dragged block under the pointer, in the frame's
  // coordinates, so a drag shows what is being carried.
  const [dragGhost, setDragGhost] = useState<{
    id: string;
    x: number;
    y: number;
    size: number;
  } | null>(null);

  useLayoutEffect(() => {
    if (!props.focusCursor) {
      return;
    }

    gridRef.current
      ?.querySelector<HTMLElement>(
        `[data-col="${cursor.col}"][data-row="${cursor.row}"]`,
      )
      ?.focus({ preventScroll: false });
  });

  const byCell = new Map(
    state.objects.map((block) => [`${block.col},${block.row}`, block]),
  );
  const carried =
    carry === null
      ? undefined
      : state.objects.find((block) => block.id === carry.id);
  const root = (): ShadowRoot | Document =>
    (gridRef.current?.getRootNode() as ShadowRoot | Document | undefined) ??
    document;

  const onPointerDown = (event: PointerEvent, cell: Cursor): void => {
    const block = byCell.get(`${cell.col},${cell.row}`);

    if (!props.editable || block === undefined || event.button !== 0) {
      return;
    }

    const square = (event.currentTarget as HTMLElement)
      .querySelector(".world-square")
      ?.getBoundingClientRect();

    drag.current = {
      grab: {
        x: event.clientX - (square?.left ?? event.clientX),
        y: event.clientY - (square?.top ?? event.clientY),
      },
      id: block.id,
      moved: false,
      size: square?.width ?? 0,
      x: event.clientX,
      y: event.clientY,
    };
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
  };

  const onPointerMove = (event: PointerEvent): void => {
    const current = drag.current;

    if (current === null) {
      return;
    }

    if (
      !current.moved &&
      Math.hypot(event.clientX - current.x, event.clientY - current.y) > 6
    ) {
      current.moved = true;
    }

    if (current.moved) {
      setDragOver(cellAt(root(), event.clientX, event.clientY));

      const frame = frameRef.current?.getBoundingClientRect();

      if (frame !== undefined) {
        setDragGhost({
          id: current.id,
          size: current.size,
          x: event.clientX - frame.left - current.grab.x,
          y: event.clientY - frame.top - current.grab.y,
        });
      }
    }
  };

  const onPointerUp = (event: PointerEvent, cell: Cursor): void => {
    const current = drag.current;
    drag.current = null;
    setDragOver(null);
    setDragGhost(null);

    if (current?.moved) {
      const to = cellAt(root(), event.clientX, event.clientY);

      if (to !== null && (to.col !== cell.col || to.row !== cell.row)) {
        props.onDragMove(current.id, to);
      }

      return;
    }

    props.onCellPointer(cell);
  };

  const onPointerCancel = (): void => {
    drag.current = null;
    setDragOver(null);
    setDragGhost(null);
  };

  const dragged =
    dragGhost === null
      ? undefined
      : state.objects.find((block) => block.id === dragGhost.id);

  const rows = [];

  const head = (
    <tr>
      <td aria-hidden="true" class="world-axis world-corner" />
      {Array.from({ length: BOARD_SIZE }, (_, index) => (
        <th class="world-axis world-axis-col" key={index} scope="col">
          {index + 1}
        </th>
      ))}
    </tr>
  );

  for (let row = 1; row <= BOARD_SIZE; row += 1) {
    const cells = [];

    for (let col = 1; col <= BOARD_SIZE; col += 1) {
      const block = byCell.get(`${col},${row}`);
      const here = cursor.col === col && cursor.row === row;
      const isCarried =
        block !== undefined &&
        (block.id === carry?.id || block.id === dragGhost?.id);
      const ghost =
        carried !== undefined && here && !isCarried ? carried : undefined;
      const ring =
        block === undefined
          ? undefined
          : props.highlight?.rings.get(block.id);
      const description =
        block === undefined
          ? words("Column {col}, row {row}", {
              col: String(col),
              row: String(row),
            })
          : words("Column {col}, row {row}: {block}", {
              block: kind.describeObject(state, block.id, words),
              col: String(col),
              row: String(row),
            });
      const over = dragOver?.col === col && dragOver?.row === row;

      cells.push(
        <td
          aria-label={description}
          aria-selected={here ? "true" : "false"}
          class="world-cell"
          data-carried={isCarried ? "" : undefined}
          data-col={col}
          data-cursor={here ? "" : undefined}
          data-object={block?.id}
          data-drop={over ? "" : undefined}
          data-pinned={
            block !== undefined && props.pinned.has(block.id) ? "" : undefined
          }
          data-ring={ring}
          data-row={row}
          data-shade={(col + row) % 2 === 0 ? "light" : "dark"}
          key={`${col},${row}`}
          onDragOver={(event) => {
            if (props.editable) {
              event.preventDefault();
              setDragOver({ col, row });
            }
          }}
          onDragLeave={() => setDragOver(null)}
          onDrop={(event) => {
            event.preventDefault();
            setDragOver(null);
            const shape = event.dataTransfer?.getData("text/x-carnap-shape");

            if (
              shape !== undefined &&
              (SHAPES as readonly string[]).includes(shape)
            ) {
              props.onPaletteDrop(shape as BlockShape, { col, row });
            }
          }}
          onPointerDown={(event) => onPointerDown(event, { col, row })}
          onPointerMove={onPointerMove}
          onPointerUp={(event) => onPointerUp(event, { col, row })}
          onPointerCancel={onPointerCancel}
          // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: in a table with role="grid" a cell is a gridcell; saying so lets it carry aria-selected.
          role="gridcell"
          tabIndex={here ? 0 : -1}
        >
          <div class="world-square">
            {block === undefined ? null : <Glyph glyph={blockGlyph(block)} />}
            {block === undefined ||
            props.badges?.get(block.id) === undefined ? null : (
              <span aria-hidden="true" class="world-binding">
                {props.badges.get(block.id)}
              </span>
            )}
            {block !== undefined && props.pinned.has(block.id) ? (
              <span aria-hidden="true" class="world-pin" />
            ) : null}
            {ghost === undefined ? null : (
              <span class="world-ghost">
                <Glyph glyph={blockGlyph(ghost)} />
              </span>
            )}
          </div>
        </td>,
      );
    }

    rows.push(
      <tr key={row}>
        <th class="world-axis world-axis-row" scope="row">
          {row}
        </th>
        {cells}
      </tr>,
    );
  }

  return (
    <div class="world-board-frame" ref={frameRef}>
      <table
        aria-label={props.label}
        aria-readonly={props.editable ? undefined : "true"}
        class="world-grid"
        data-carrying={carry === null ? undefined : ""}
        data-choosing={props.choosing ? "" : undefined}
        onKeyDown={props.onKeyDown}
        ref={gridRef}
        // biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: the ARIA grid pattern is a table with role="grid"; the table's own markup carries the rows and headers.
        role="grid"
      >
        <thead>{head}</thead>
        <tbody>{rows}</tbody>
      </table>
      <Arrows board={gridRef} pairs={props.highlight?.pairs ?? []} />
      {dragGhost === null || dragged === undefined ? null : (
        <span
          aria-hidden="true"
          class="world-drag-ghost"
          style={{
            height: `${dragGhost.size}px`,
            left: `${dragGhost.x}px`,
            top: `${dragGhost.y}px`,
            width: `${dragGhost.size}px`,
          }}
        >
          <Glyph glyph={blockGlyph(dragged)} />
        </span>
      )}
    </div>
  );
}

/**
 * The pairs a two-place subformula is true of, as arrows from the first
 * object to the second, drawn over the board. Positions are measured from the
 * rendered cells, so the overlay follows the board at any size.
 */
function Arrows({
  board,
  pairs,
}: {
  readonly board: { readonly current: HTMLTableElement | null };
  readonly pairs: readonly (readonly [string, string])[];
}) {
  const [box, setBox] = useState<{
    readonly height: number;
    readonly centres: ReadonlyMap<
      string,
      { x: number; y: number; r: number }
    >;
    readonly width: number;
  } | null>(null);
  const key = pairs.map((pair) => pair.join(">")).join(" ");

  useLayoutEffect(() => {
    const grid = board.current;

    if (grid === null || pairs.length === 0) {
      setBox(null);
      return;
    }

    const frame = grid.getBoundingClientRect();
    const centres = new Map<string, { x: number; y: number; r: number }>();

    for (const cell of grid.querySelectorAll<HTMLElement>("[data-object]")) {
      const rect = cell.getBoundingClientRect();
      centres.set(cell.dataset.object ?? "", {
        r: rect.width / 2,
        x: rect.left - frame.left + rect.width / 2,
        y: rect.top - frame.top + rect.height / 2,
      });
    }

    setBox({ centres, height: frame.height, width: frame.width });
  }, [key, board]);

  if (box === null || pairs.length === 0) {
    return null;
  }

  return (
    <svg
      aria-hidden="true"
      class="world-arrows"
      focusable="false"
      viewBox={`0 0 ${box.width} ${box.height}`}
    >
      <defs>
        <marker
          id="world-arrowhead"
          markerHeight="7"
          markerWidth="7"
          orient="auto-start-reverse"
          refX="6"
          refY="3.5"
        >
          <path class="world-arrowhead" d="M0,0 L7,3.5 L0,7 z" />
        </marker>
      </defs>
      {pairs.map(([from, to]) => {
        const a = box.centres.get(from);
        const b = box.centres.get(to);

        if (a === undefined || b === undefined) {
          return null;
        }

        if (from === to) {
          return (
            <circle
              class="world-arrow world-arrow-loop"
              cx={a.x + a.r * 0.55}
              cy={a.y - a.r * 0.55}
              key={`${from}>${to}`}
              r={a.r * 0.35}
            />
          );
        }

        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const length = Math.hypot(dx, dy);
        const trim = (radius: number): number => (radius * 0.55) / length;
        // A gentle bow, so a pair and its converse do not draw one line.
        const mx = (a.x + b.x) / 2 - dy * 0.12;
        const my = (a.y + b.y) / 2 + dx * 0.12;

        return (
          <path
            class="world-arrow"
            d={`M${a.x + dx * trim(a.r)},${a.y + dy * trim(a.r)} Q${mx},${my} ${b.x - dx * trim(b.r)},${b.y - dy * trim(b.r)}`}
            key={`${from}>${to}`}
            marker-end="url(#world-arrowhead)"
          />
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// The palette: shape, size, names, and the editing buttons.
// ---------------------------------------------------------------------------

const SHAPE_LABEL: Readonly<Record<BlockShape, WorldStringId>> = {
  cube: "Cube",
  dodec: "Dodec",
  tet: "Tet",
};
const SIZE_LABEL: Readonly<Record<BlockSize, WorldStringId>> = {
  large: "Large",
  medium: "Medium",
  small: "Small",
};

interface PaletteProps {
  readonly canRedo: boolean;
  readonly canUndo: boolean;
  /**
   * Distinguish's author preview: copy the world being edited over the
   * other, since the two usually start alike and differ in one detail.
   */
  readonly copyAcross?: {
    readonly label: string;
    readonly onClick: () => void;
  };
  /** The block the palette edits, or the attributes a new block gets. */
  readonly current: { readonly shape: BlockShape; readonly size: BlockSize };
  readonly hasBlock: boolean;
  readonly locked: boolean;
  readonly onAdd: () => void;
  readonly onNames: () => void;
  readonly onRedo: () => void;
  readonly onRemove: () => void;
  readonly onShape: (shape: BlockShape) => void;
  readonly onSize: (size: BlockSize) => void;
  readonly onUndo: () => void;
  readonly words: Words;
}

/** A block of this shape and size, as the palette draws it. */
function sample(shape: BlockShape, size: BlockSize) {
  return blockGlyph({ col: 1, id: "", names: [], row: 1, shape, size });
}

/**
 * Icon-only, like the proof editors' toolbars: the glyph is the whole face,
 * the name is the `aria-label`, and the tooltip carries the key. The shapes
 * are drawn as blocks, and the sizes as the current shape at each size, so a
 * button shows what pressing it makes.
 */
function Palette(props: PaletteProps) {
  const { words, current } = props;
  const tool = (
    label: string,
    key: string,
    icon: ToolbarIconName,
    onClick: () => void,
    disabled: boolean,
  ) => (
    <button
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      title={`${label} (${key})`}
      type="button"
    >
      <ToolbarIcon name={icon} />
    </button>
  );

  return (
    <div class="proof-toolbar world-palette">
      <fieldset class="world-palette-group">
        <legend class="visually-hidden">{words("Shape")}</legend>
        {SHAPES.map((shape) => (
          <button
            aria-label={words(SHAPE_LABEL[shape])}
            aria-pressed={current.shape === shape ? "true" : "false"}
            class="world-tool-shape"
            disabled={props.locked}
            draggable={!props.locked}
            key={shape}
            onClick={() => props.onShape(shape)}
            onDragStart={(event) => {
              event.dataTransfer?.setData("text/x-carnap-shape", shape);
              if (event.dataTransfer) {
                event.dataTransfer.effectAllowed = "copy";
              }
            }}
            title={`${words(SHAPE_LABEL[shape])} (${shape[0]})`}
            type="button"
          >
            <Glyph glyph={sample(shape, "large")} />
          </button>
        ))}
      </fieldset>
      <span aria-hidden="true" class="proof-toolbar-sep" />
      <fieldset class="world-palette-group">
        <legend class="visually-hidden">{words("Size")}</legend>
        {SIZES.map((size) => (
          <button
            aria-label={words(SIZE_LABEL[size])}
            aria-pressed={current.size === size ? "true" : "false"}
            class="world-tool-size"
            disabled={props.locked}
            key={size}
            onClick={() => props.onSize(size)}
            title={`${words(SIZE_LABEL[size])} (${size[0]})`}
            type="button"
          >
            <Glyph glyph={sample(current.shape, size)} />
          </button>
        ))}
      </fieldset>
      <span aria-hidden="true" class="proof-toolbar-sep" />
      {tool(
        words("Add block"),
        "+",
        "add-block",
        props.onAdd,
        props.hasBlock,
      )}
      {tool(
        words("Names"),
        "n",
        "name",
        props.onNames,
        !props.hasBlock || props.locked,
      )}
      {tool(
        words("Remove block"),
        "Delete",
        "remove-block",
        props.onRemove,
        !props.hasBlock || props.locked,
      )}
      <span aria-hidden="true" class="proof-toolbar-sep" />
      {tool(words("Undo"), "Ctrl-Z", "undo", props.onUndo, !props.canUndo)}
      {tool(
        words("Redo"),
        "Ctrl-Shift-Z",
        "redo",
        props.onRedo,
        !props.canRedo,
      )}
      {props.copyAcross === undefined ? null : (
        <>
          <span aria-hidden="true" class="proof-toolbar-sep" />
          <button
            class="world-copy-across"
            onClick={props.copyAcross.onClick}
            type="button"
          >
            {props.copyAcross.label}
          </button>
        </>
      )}
    </div>
  );
}

interface NamesProps {
  readonly available: readonly string[];
  readonly block: BlocksState["objects"][number];
  readonly onClose: () => void;
  readonly onToggle: (name: string) => void;
  readonly state: BlocksState;
  readonly words: Words;
  readonly kind: Blocks;
}

/** The names menu: one checkbox per name the language has. */
function NamesMenu(props: NamesProps) {
  const ref = useRef<HTMLFieldSetElement>(null);

  useLayoutEffect(() => {
    ref.current?.querySelector<HTMLInputElement>("input")?.focus();
  }, []);

  return (
    <fieldset
      class="world-names"
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          props.onClose();
        }
      }}
      ref={ref}
    >
      <legend>
        {props.words("Names for {block}", {
          block: props.kind.describeObject(
            props.state,
            props.block.id,
            props.words,
          ),
        })}
      </legend>
      {props.available.map((name) => {
        const holder = props.state.objects.find(
          (block) =>
            block.id !== props.block.id && block.names.includes(name),
        );

        return (
          <label class="world-name-option" key={name}>
            <input
              checked={props.block.names.includes(name)}
              disabled={holder !== undefined}
              onChange={() => props.onToggle(name)}
              type="checkbox"
            />
            <span class="world-name-token">{name}</span>
          </label>
        );
      })}
      <button class="world-tool" onClick={props.onClose} type="button">
        OK
      </button>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// The table: every object, as native controls.
// ---------------------------------------------------------------------------

interface TableProps {
  readonly available: readonly string[];
  readonly editable: boolean;
  readonly onAdd: () => void;
  readonly onMove: (move: BlocksMove) => void;
  readonly pinned: ReadonlySet<string>;
  readonly state: BlocksState;
  readonly words: Words;
}

function ObjectTable(props: TableProps) {
  const { words, state } = props;
  const numbers = Array.from({ length: BOARD_SIZE }, (_, index) => index + 1);

  return (
    <div class="world-table-wrap">
      <table class="world-table">
        <caption class="visually-hidden">{words("The world")}</caption>
        <thead>
          <tr>
            <th scope="col">{words("Names")}</th>
            <th scope="col">{words("Shape")}</th>
            <th scope="col">{words("Size")}</th>
            <th scope="col">{words("Column")}</th>
            <th scope="col">{words("Row")}</th>
            <th scope="col">
              <span class="visually-hidden">{words("Remove block")}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {state.objects.map((block) => {
            const locked = !props.editable || props.pinned.has(block.id);
            const label = (field: WorldStringId): string =>
              `${words(field)}: ${words("Column {col}, row {row}", {
                col: String(block.col),
                row: String(block.row),
              })}`;

            return (
              <tr
                data-pinned={props.pinned.has(block.id) ? "" : undefined}
                key={block.id}
              >
                <td>
                  <input
                    aria-label={label("Names")}
                    class="world-table-names"
                    disabled={locked}
                    onChange={(event) => {
                      const names = (
                        event.currentTarget as HTMLInputElement
                      ).value
                        .split(/[\s,]+/)
                        .filter((name) => name.length > 0);
                      const unknown = names.filter(
                        (name) => !props.available.includes(name),
                      );

                      if (unknown.length > 0) {
                        (event.currentTarget as HTMLInputElement).value =
                          block.names.join(", ");
                        return;
                      }

                      props.onMove({ id: block.id, names, type: "names" });
                    }}
                    type="text"
                    value={block.names.join(", ")}
                  />
                </td>
                <td>
                  <select
                    aria-label={label("Shape")}
                    disabled={locked}
                    onChange={(event) =>
                      props.onMove({
                        id: block.id,
                        shape: (event.currentTarget as HTMLSelectElement)
                          .value as BlockShape,
                        type: "shape",
                      })
                    }
                    value={block.shape}
                  >
                    {SHAPES.map((shape) => (
                      <option key={shape} value={shape}>
                        {words(SHAPE_LABEL[shape])}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    aria-label={label("Size")}
                    disabled={locked}
                    onChange={(event) =>
                      props.onMove({
                        id: block.id,
                        size: (event.currentTarget as HTMLSelectElement)
                          .value as BlockSize,
                        type: "size",
                      })
                    }
                    value={block.size}
                  >
                    {SIZES.map((size) => (
                      <option key={size} value={size}>
                        {words(SIZE_LABEL[size])}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    aria-label={label("Column")}
                    disabled={locked}
                    onChange={(event) =>
                      props.onMove({
                        col: Number(
                          (event.currentTarget as HTMLSelectElement).value,
                        ),
                        id: block.id,
                        row: block.row,
                        type: "move",
                      })
                    }
                    value={String(block.col)}
                  >
                    {numbers.map((value) => (
                      <option key={value} value={String(value)}>
                        {value}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <select
                    aria-label={label("Row")}
                    disabled={locked}
                    onChange={(event) =>
                      props.onMove({
                        col: block.col,
                        id: block.id,
                        row: Number(
                          (event.currentTarget as HTMLSelectElement).value,
                        ),
                        type: "move",
                      })
                    }
                    value={String(block.row)}
                  >
                    {numbers.map((value) => (
                      <option key={value} value={String(value)}>
                        {value}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <button
                    aria-label={label("Remove block")}
                    class="world-tool world-tool-remove"
                    disabled={locked}
                    onClick={() =>
                      props.onMove({ id: block.id, type: "remove" })
                    }
                    type="button"
                  >
                    ×
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {state.objects.length === 0 ? (
        <p class="world-empty">{words("No blocks yet.")}</p>
      ) : null}
      {props.editable ? (
        <button class="world-tool" onClick={props.onAdd} type="button">
          {words("Add block")}
        </button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The sentence panel.
// ---------------------------------------------------------------------------

function TruthMark({
  value,
  target,
  words,
}: {
  readonly value: TruthValue;
  readonly target?: boolean;
  readonly words: Words;
}) {
  const text =
    value === null
      ? words("Cannot be evaluated in this world")
      : value
        ? words("True in this world")
        : words("False in this world");
  const met =
    target === undefined || value === null ? undefined : value === target;

  return (
    <span
      class="world-truth"
      data-met={met === undefined ? undefined : String(met)}
      data-role="truth"
      data-value={value === null ? "none" : String(value)}
      title={text}
    >
      <span aria-hidden="true">
        {value === null ? "?" : value ? "T" : "F"}
      </span>
      <span class="visually-hidden">{text}</span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// The element.
// ---------------------------------------------------------------------------

const SHORTCUTS: readonly {
  readonly action: WorldStringId;
  readonly icon?: ToolbarIconName;
  readonly keys: readonly string[];
}[] = [
  { action: "Move between squares", keys: ["←", "→", "↑", "↓"] },
  { action: "Pick up or drop a block", keys: ["Enter", "Space"] },
  { action: "Put a carried block back", keys: ["Esc"] },
  { action: "Make it a tet, cube, or dodec", keys: ["t", "c", "d"] },
  { action: "Make it small, medium, or large", keys: ["s", "m", "l"] },
  { action: "Name it", icon: "name", keys: ["n"] },
  { action: "Add a block here", icon: "add-block", keys: ["Insert", "+"] },
  { action: "Remove it", icon: "remove-block", keys: ["Delete"] },
  { action: "Undo the last change", icon: "undo", keys: ["Ctrl-Z"] },
];

const INTRO: readonly WorldStringId[] = [
  "Drag a block to move it, or drag a shape from the palette onto a square to add one.",
  "The table lists every block and can do everything the board does.",
  "Point at part of a sentence to see what it is true of.",
];

/**
 * The help's opening lines for distinguish's author preview, where there is
 * no table and nothing to highlight, but two boards.
 */
const PAIR_INTRO: readonly WorldStringId[] = [
  "Drag a block to move it, or drag a shape from the palette onto a square to add one.",
  "Click a board, or move into it with Tab, to make it the one the palette edits.",
];

/** The help for the evaluation game, whose board is played on, not edited. */
const GAME_INTRO: readonly WorldStringId[] = [
  "Claim each sentence true or false, then defend your claim against the computer, one part at a time.",
  "When the game asks for a block, click or tap it on the board.",
];

const GAME_SHORTCUTS: typeof SHORTCUTS = [
  { action: "Move between squares", keys: ["←", "→", "↑", "↓"] },
  { action: "Choose the block here", keys: ["Enter", "Space"] },
  { action: "Take back your last move", icon: "undo", keys: ["Ctrl-Z"] },
];

type Side = "a" | "b";

/** The editing state of the distinguish world the palette is not editing. */
interface Parked {
  readonly world: BlocksState;
  readonly past: BlocksState[];
  readonly future: BlocksState[];
  readonly cursor: Cursor;
}

let nextBlock = 0;

/** A fresh id for a block the editor adds, unlike any authored `o1…on`. */
function freshId(state: BlocksState): string {
  let id: string;

  do {
    nextBlock += 1;
    id = `n${Date.now().toString(36)}${nextBlock}`;
  } while (state.objects.some((block) => block.id === id));

  return id;
}

class CarnapWorld extends CarnapExerciseElement<WorldStringId> {
  private data: WorldPublicData | null = null;
  private resolved: ResolvedWorld | null = null;
  private kind: Blocks | null = null;
  private mount: HTMLElement | null = null;
  private helpDialog: HTMLDialogElement | null = null;

  private world: BlocksState | null = null;
  private past: BlocksState[] = [];
  private future: BlocksState[] = [];
  private marks: (boolean | null)[] = [];
  private sentence = "";
  /** The evaluation game: each sentence's game so far, and the one shown. */
  private games: (WorldGameAnswer | null)[] = [];
  private activeGame: number | null = null;
  private gameWorld: WorldStructure | null = null;
  /** Move focus to the game's next control after the next render. */
  private focusGame = false;

  private cursor: Cursor = { col: 1, row: 1 };
  private carry: Carry | null = null;
  private focusCursor = false;
  private tab: "board" | "table" = "board";
  private namesOpen = false;
  private newShape: BlockShape = "cube";
  private newSize: BlockSize = "small";
  private announcement = "";
  private highlight: Highlight | null = null;
  /** The author preview: the start world is editable and copyable as source. */
  private preview = false;
  /**
   * Distinguish's author preview edits both worlds. The one the palette is
   * editing is `world`, with its history and cursor, exactly as in build;
   * the other waits here, and `activate` swaps them.
   */
  private parked: Parked | null = null;
  private active: Side = "a";

  private readonly words: Words = (id, values) => this.t(id, values);
  /**
   * The tag of the panels' own headings — "Sentences", "Laws", "The game" —
   * one rank below the exercise's, which the server chose from the lesson's
   * outline (`exerciseHeadingLevels`) and is read back here off its heading.
   */
  private panelHeading: "h3" | "h4" | "h5" | "h6" = "h3";

  protected enhance(): void {
    const root = this.shadowRoot;
    const data = this.publicData;

    if (root === null || this.mode !== "answer" || !isWorldPublicData(data)) {
      return;
    }

    const resolved = resolveWorld(data);

    if (resolved === null || resolved.kind.id !== "blocks") {
      return;
    }

    this.data = data;
    this.resolved = resolved;
    this.kind = asBlocks(resolved.kind);
    const rank = Number(
      root.querySelector(".exercise-heading")?.tagName.slice(1),
    );
    this.panelHeading =
      `h${Math.min((rank || 2) + 1, 6)}` as typeof this.panelHeading;
    this.preview = isAuthorPreview(this);
    this.restore(data, resolved);

    const body = root.querySelector<HTMLElement>("[data-role='body']");

    if (body === null) {
      return;
    }

    const style = document.createElement("style");
    style.textContent = `${TOOLBAR_STYLES}\n${islandStyles}\n${HELP_DIALOG_STYLES}`;
    root.appendChild(style);

    body.replaceChildren();
    this.mount = body;
    this.rerender();

    const game = data.variant === "game";

    this.helpDialog = createHelpDialog({
      close: this.t("Close help"),
      intro: (game
        ? GAME_INTRO
        : this.parked === null
          ? INTRO
          : PAIR_INTRO
      ).map((id) => this.t(id)),
      keyboard: this.t("Keyboard"),
      shortcuts: (game ? GAME_SHORTCUTS : SHORTCUTS).map((shortcut) => ({
        action: this.t(shortcut.action),
        keys: shortcut.keys,
        ...(shortcut.icon === undefined ? {} : { icon: shortcut.icon }),
      })),
      title: this.t(
        game ? "Playing the evaluation game" : "Using the world editor",
      ),
    });
    root.appendChild(this.helpDialog);

    if (this.editable || game) {
      mountHelpTrigger(
        this,
        this.t("Usage and keyboard shortcuts"),
        (trigger) => {
          if (this.helpDialog !== null) {
            openHelpDialog(this.helpDialog, trigger);
          }
        },
      );
    }

    this.buildCheck();

    if (this.world !== null) {
      mountCopySource(
        this,
        { copied: this.t("Copied."), label: this.t("Copy as source") },
        () => this.worldSource(),
      );
    }

    root.querySelector("fieldset")?.removeAttribute("aria-busy");
    this.dataset.enhanced = "true";
  }

  disconnectedCallback(): void {
    if (this.mount !== null) {
      render(null, this.mount);
    }
  }

  /** The prior answer, or the exercise's own start. */
  private restore(data: WorldPublicData, resolved: ResolvedWorld): void {
    const prior = (this.priorAnswer ?? {}) as WorldAnswerData;
    const kind = asBlocks(resolved.kind);

    this.world =
      data.variant === "distinguish"
        ? null
        : ((prior.world === undefined
            ? null
            : kind.parseState(prior.world)) ??
          (resolved.start as BlocksState));

    if (
      data.variant === "distinguish" &&
      this.preview &&
      resolved.worlds !== null
    ) {
      this.world = resolved.worlds.a as BlocksState;
      this.parked = {
        cursor: { col: 1, row: 1 },
        future: [],
        past: [],
        world: resolved.worlds.b as BlocksState,
      };
    }
    this.marks = data.sentences.map((_, index) => {
      const mark = prior.values?.[index];
      return typeof mark === "boolean" ? mark : null;
    });
    this.sentence = typeof prior.sentence === "string" ? prior.sentence : "";

    if (data.variant === "game") {
      const world = worldStructure(
        resolved.kind,
        resolved.start,
        resolved.vocabulary,
      );
      this.gameWorld = world;
      // A stored game that no longer replays (the exercise was corrected
      // under it) is dropped rather than shown half-understood.
      this.games = resolved.sentences.map((sentence, index) => {
        const game = prior.games?.[index];

        return game === undefined ||
          game === null ||
          playGame(sentence.formula, world, game).state.type === "invalid"
          ? null
          : game;
      });
      const started = this.games.findIndex((game) => game !== null);
      this.activeGame = started === -1 ? null : started;
    }
  }

  private get editable(): boolean {
    const variant = this.data?.variant;
    return (
      variant === "build" ||
      variant === "counterexample" ||
      (this.preview && (variant === "evaluate" || variant === "distinguish"))
    );
  }

  /** Whether live truth values may be shown: full feedback, never evaluate's. */
  private get liveTruth(): boolean {
    const variant = this.data?.variant;

    return (
      this.feedback === "full" &&
      variant !== "game" &&
      (variant !== "evaluate" || this.preview)
    );
  }

  private buildCheck(): void {
    if (this.feedback === "none") {
      return;
    }

    const bar = this.querySelector<HTMLElement>(".exercise-actions");

    if (bar === null) {
      return;
    }

    const check = document.createElement("button");
    check.type = "button";
    check.className = "world-check";
    check.textContent = this.t("Check");
    check.addEventListener("click", () => this.runCheck());
    bar.insertBefore(
      check,
      bar.querySelector<HTMLElement>('button[type="submit"]'),
    );
  }

  private runCheck(): void {
    const data = this.data;
    const resolved = this.resolved;

    if (data === null || resolved === null) {
      return;
    }

    const verdict = judgeWorld(
      data,
      this.judged(resolved),
      this.currentAnswer(),
    );

    // A sentence that cannot be judged already says why under the input, as
    // it is typed; the status line points there rather than repeat it.
    this.setCheckStatus(
      this.notedInline(verdict)
        ? this.t("See the note under your sentence.")
        : describeWorldVerdict(
            verdict,
            resolved,
            this.words,
            this.showsDetail,
          ),
      verdict.ok,
    );
    this.setMark(verdict.ok ? "ok" : "idle");
  }

  /**
   * Whether distinguish's live note under the input is showing this verdict:
   * with full feedback, a sentence that says nothing about either world yet
   * (unreadable, open, or outside the vocabulary or the restriction).
   */
  private notedInline(verdict: WorldVerdict): boolean {
    return (
      this.feedback === "full" &&
      verdict.type === "distinguish" &&
      !verdict.ok &&
      !verdict.empty &&
      verdict.inA === null
    );
  }

  private edited(): void {
    this.setCheckStatus("");
    this.setMark("idle");
    this.syncAnswer();
    this.rerender();
  }

  private announce(text: string): void {
    // A repeated sentence would not be re-read by a live region that sees no
    // change, so an identical announcement is nudged with a trailing space.
    this.announcement = text === this.announcement.trim() ? `${text} ` : text;
  }

  // --- The two worlds of distinguish's author preview -------------------

  /** Make `side` the world the palette edits. */
  private readonly activate = (side: Side): void => {
    const parked = this.parked;
    const world = this.world;

    if (side === this.active || parked === null || world === null) {
      return;
    }

    this.parked = {
      cursor: this.cursor,
      future: this.future,
      past: this.past,
      world,
    };
    this.world = parked.world;
    this.past = parked.past;
    this.future = parked.future;
    this.cursor = parked.cursor;
    this.active = side;
    this.carry = null;
    this.namesOpen = false;
    this.rerender();
  };

  /** Distinguish's two worlds as the preview has them, or null elsewhere. */
  private editedWorlds(): { a: BlocksState; b: BlocksState } | null {
    const parked = this.parked;
    const world = this.world;

    if (parked === null || world === null) {
      return null;
    }

    return this.active === "a"
      ? { a: world, b: parked.world }
      : { a: parked.world, b: world };
  }

  /** The exercise as it is judged: over the edited worlds, in the preview. */
  private judged(resolved: ResolvedWorld): ResolvedWorld {
    const worlds = this.editedWorlds();
    return worlds === null ? resolved : { ...resolved, worlds };
  }

  /** Copy the world being edited over the other one, undoably there. */
  private readonly copyAcross = (): void => {
    const parked = this.parked;
    const world = this.world;

    if (parked === null || world === null) {
      return;
    }

    this.parked = {
      ...parked,
      future: [],
      past: [...parked.past.slice(-(HISTORY_LIMIT - 1)), parked.world],
      world,
    };
    this.announce(
      this.active === "a"
        ? this.t("World B is now a copy of world A.")
        : this.t("World A is now a copy of world B."),
    );
    this.edited();
  };

  // --- Editing ------------------------------------------------------------

  /** Apply one move through the kind, the pins, and the history. */
  private readonly apply = (move: BlocksMove): boolean => {
    const kind = this.kind;
    const world = this.world;
    const resolved = this.resolved;

    if (kind === null || world === null || resolved === null) {
      return false;
    }

    const next = kind.apply(world, move);

    if (kind.isRefusal(next)) {
      this.announce(kind.describeProblem(world, next, this.words));
      this.rerender();
      return false;
    }

    if (!this.preview) {
      const broken = kind.pinViolations(
        resolved.start as BlocksState,
        next,
        resolved.pinned,
      );

      if (broken.length > 0) {
        this.announce(
          kind.objectSentence(world, broken[0] ?? "", "pinned", this.words),
        );
        this.rerender();
        return false;
      }
    }

    this.announce(kind.describeMove(world, move, this.words));
    this.past = [...this.past.slice(-(HISTORY_LIMIT - 1)), world];
    this.future = [];
    this.world = next;
    this.edited();
    return true;
  };

  private readonly undo = (): void => {
    const previous = this.past.at(-1);

    if (previous === undefined || this.world === null) {
      return;
    }

    this.future = [this.world, ...this.future];
    this.past = this.past.slice(0, -1);
    this.world = previous;
    this.carry = null;
    this.announce(this.t("Undid the last change."));
    this.edited();
  };

  private readonly redo = (): void => {
    const next = this.future[0];

    if (next === undefined || this.world === null) {
      return;
    }

    this.past = [...this.past, this.world];
    this.future = this.future.slice(1);
    this.world = next;
    this.edited();
  };

  private blockAtCursor() {
    return this.world?.objects.find(
      (block) =>
        block.col === this.cursor.col && block.row === this.cursor.row,
    );
  }

  private addAt(at: Cursor, shape: BlockShape, size: BlockSize): void {
    const world = this.world;

    if (world === null) {
      return;
    }

    this.apply({
      block: {
        col: at.col,
        id: freshId(world),
        names: [],
        row: at.row,
        shape,
        size,
      },
      type: "add",
    });
  }

  private readonly addHere = (): void => {
    this.addAt(this.cursor, this.newShape, this.newSize);
  };

  private readonly setShape = (shape: BlockShape): void => {
    const block = this.blockAtCursor();
    this.newShape = shape;

    if (block === undefined) {
      this.rerender();
      return;
    }

    this.apply({ id: block.id, shape, type: "shape" });
  };

  private readonly setSize = (size: BlockSize): void => {
    const block = this.blockAtCursor();
    this.newSize = size;

    if (block === undefined) {
      this.rerender();
      return;
    }

    this.apply({ id: block.id, size, type: "size" });
  };

  private readonly dragMove = (id: string, to: Cursor): void => {
    this.carry = null;
    this.cursor = to;
    this.apply({ col: to.col, id, row: to.row, type: "move" });
  };

  private readonly paletteDrop = (shape: BlockShape, to: Cursor): void => {
    this.cursor = to;
    this.addAt(to, shape, this.newSize);
  };

  private readonly removeHere = (): void => {
    const block = this.blockAtCursor();

    if (block !== undefined) {
      this.apply({ id: block.id, type: "remove" });
    }
  };

  private readonly toggleName = (name: string): void => {
    const block = this.blockAtCursor();

    if (block === undefined) {
      return;
    }

    const names = block.names.includes(name)
      ? block.names.filter((held) => held !== name)
      : [...block.names, name];

    this.apply({ id: block.id, names, type: "names" });
  };

  /**
   * A click or tap on a square moves the cursor there, and drops a block
   * carried from the keyboard. It never picks one up: a mouse or a finger
   * moves a block by dragging it.
   */
  private readonly onCellPointer = (cell: Cursor): void => {
    const world = this.world;

    if (world === null || !this.editable) {
      this.cursor = cell;
      const block = world?.objects.find(
        (candidate) =>
          candidate.col === cell.col && candidate.row === cell.row,
      );

      if (block !== undefined && this.choosingObject()) {
        this.chooseInGame(block.id);
        return;
      }

      this.rerender();
      return;
    }

    const block = world.objects.find(
      (candidate) => candidate.col === cell.col && candidate.row === cell.row,
    );

    this.cursor = cell;
    this.focusCursor = true;
    this.namesOpen = false;

    if (this.carry !== null) {
      const carried = this.carry;
      this.carry = null;

      if (block?.id === carried.id) {
        this.rerender();
        return;
      }

      this.apply({
        col: cell.col,
        id: carried.id,
        row: cell.row,
        type: "move",
      });
      this.rerender();
      return;
    }

    this.rerender();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    const world = this.world;
    const kind = this.kind;

    if (world === null || kind === null) {
      return;
    }

    const move = (dc: number, dr: number): void => {
      this.cursor = {
        col: Math.min(BOARD_SIZE, Math.max(1, this.cursor.col + dc)),
        row: Math.min(BOARD_SIZE, Math.max(1, this.cursor.row + dr)),
      };
      this.focusCursor = true;
      this.namesOpen = false;
    };
    const block = this.blockAtCursor();
    const ctrl = event.ctrlKey || event.metaKey;
    let handled = true;

    switch (event.key) {
      case "ArrowLeft":
        move(-1, 0);
        break;
      case "ArrowRight":
        move(1, 0);
        break;
      case "ArrowUp":
        move(0, -1);
        break;
      case "ArrowDown":
        move(0, 1);
        break;
      case "Home":
        this.cursor = { ...this.cursor, col: 1 };
        this.focusCursor = true;
        break;
      case "End":
        this.cursor = { ...this.cursor, col: BOARD_SIZE };
        this.focusCursor = true;
        break;
      case "Enter":
      case " ":
        if (!this.editable) {
          if (block !== undefined && this.choosingObject()) {
            this.chooseInGame(block.id);
            event.preventDefault();
            return;
          }

          break;
        }

        if (this.carry !== null) {
          const carried = this.carry;
          this.carry = null;
          this.apply({
            col: this.cursor.col,
            id: carried.id,
            row: this.cursor.row,
            type: "move",
          });
        } else if (block !== undefined) {
          this.carry = { id: block.id };
          this.announce(
            kind.objectSentence(world, block.id, "picked-up", this.words),
          );
        }
        break;
      case "Escape":
        if (this.carry !== null) {
          const carried = world.objects.find((b) => b.id === this.carry?.id);
          this.carry = null;

          if (carried !== undefined) {
            this.cursor = { col: carried.col, row: carried.row };
            this.announce(
              kind.objectSentence(world, carried.id, "put-back", this.words),
            );
          }
        } else {
          handled = false;
        }
        break;
      case "Delete":
      case "Backspace":
        if (this.editable) {
          this.removeHere();
        }
        break;
      case "Insert":
      case "+":
        if (this.editable && block === undefined) {
          this.addHere();
        }
        break;
      case "t":
      case "c":
      case "d":
        if (this.editable && !ctrl) {
          this.setShape(
            event.key === "t" ? "tet" : event.key === "c" ? "cube" : "dodec",
          );
        } else {
          handled = false;
        }
        break;
      case "s":
      case "m":
      case "l":
        if (this.editable && !ctrl) {
          this.setSize(
            event.key === "s"
              ? "small"
              : event.key === "m"
                ? "medium"
                : "large",
          );
        } else {
          handled = false;
        }
        break;
      case "n":
        if (this.editable && !ctrl && block !== undefined) {
          this.namesOpen = true;
        } else {
          handled = false;
        }
        break;
      case "?":
        if (this.helpDialog !== null) {
          openHelpDialog(this.helpDialog, event.target as HTMLElement);
        }
        break;
      case "z":
      case "Z":
        if (ctrl && this.data?.variant === "game") {
          this.back();
          event.preventDefault();
          return;
        }

        if (ctrl && this.editable) {
          if (event.shiftKey) {
            this.redo();
          } else {
            this.undo();
          }
        } else {
          handled = false;
        }
        break;
      case "y":
        if (ctrl && this.editable) {
          this.redo();
        } else {
          handled = false;
        }
        break;
      default:
        handled = false;
    }

    if (handled) {
      event.preventDefault();
      this.rerender();
    }
  };

  private readonly setHighlight = (highlight: Highlight | null): void => {
    this.highlight = highlight;

    if (highlight !== null) {
      this.announce(highlightAnnouncement(highlight, this.words));
    }

    this.rerender();
  };

  /** The world as it stands, as the directive's object lines. */
  private worldSource(): string | null {
    const world = this.world;
    const kind = this.kind;
    const resolved = this.resolved;

    if (world === null || kind === null || resolved === null) {
      return null;
    }

    const worlds = this.editedWorlds();

    if (worlds !== null) {
      const side = (key: string, state: BlocksState) =>
        state.objects.map(
          (block) =>
            `| ${key} ${kind.objectKey} : ${kind.formatObject(state, block.id)}`,
        );

      return [...side("A", worlds.a), ...side("B", worlds.b)].join("\n");
    }

    const lines = world.objects.map((block) => {
      const key = resolved.pinned.has(block.id)
        ? `pinned ${kind.objectKey}`
        : kind.objectKey;
      return `| ${key} : ${kind.formatObject(world, block.id)}`;
    });

    return lines.join("\n");
  }

  private currentAnswer(): WorldAnswerData {
    switch (this.data?.variant) {
      case "evaluate":
        return { values: [...this.marks] };
      case "distinguish":
        return { sentence: this.sentence };
      case "game":
        return { games: [...this.games] };
      default:
        return this.world === null ? {} : { world: this.world };
    }
  }

  /** Its Check grades the work in the browser. */
  protected override get gradesLocally(): boolean {
    return true;
  }

  protected getAnswer(): unknown {
    return this.currentAnswer();
  }

  // --- Rendering ----------------------------------------------------------

  private rerender(): void {
    const mount = this.mount;
    const data = this.data;
    const resolved = this.resolved;
    const kind = this.kind;

    if (
      mount === null ||
      data === null ||
      resolved === null ||
      kind === null
    ) {
      return;
    }

    render(
      data.variant === "distinguish"
        ? this.distinguishView(data, resolved, kind)
        : this.worldView(data, resolved, kind),
      mount,
    );
    this.focusCursor = false;

    if (this.focusGame) {
      this.focusGame = false;
      mount.querySelector<HTMLElement>("[data-game-focus]")?.focus();
    }
  }

  private worldView(
    data: WorldPublicData,
    resolved: ResolvedWorld,
    kind: Blocks,
  ) {
    const world = this.world ?? (resolved.start as BlocksState);
    const words = this.words;
    const editable = this.editable;
    const physical = kind.problems(world).length === 0;
    const values =
      this.liveTruth && physical ? truthValues(resolved, world) : null;
    const block = this.blockAtCursor();
    const pinnedHere =
      !this.preview && block !== undefined && resolved.pinned.has(block.id);
    const budget =
      data.budget === undefined
        ? null
        : words("Changes: {used} of {limit}", {
            limit: String(data.budget),
            used: String(kind.distance(resolved.start as BlocksState, world)),
          });
    const pinned = this.preview ? new Set<string>() : resolved.pinned;
    const available = languageNames(resolved.language);

    return (
      <div class="world-layout" data-editable={editable ? "" : undefined}>
        <div class="world-stage">
          {editable ? (
            <div class="world-tabs" role="tablist">
              {(["board", "table"] as const).map((tab) => (
                <button
                  aria-selected={this.tab === tab ? "true" : "false"}
                  class="world-tab"
                  key={tab}
                  onClick={() => {
                    this.tab = tab;
                    this.rerender();
                  }}
                  role="tab"
                  type="button"
                >
                  {words(tab === "board" ? "Board" : "Table")}
                </button>
              ))}
            </div>
          ) : null}
          {this.tab === "board" || !editable ? (
            <div class="world-board-panel">
              {editable ? (
                <Palette
                  canRedo={this.future.length > 0}
                  canUndo={this.past.length > 0}
                  current={
                    block === undefined
                      ? { shape: this.newShape, size: this.newSize }
                      : { shape: block.shape, size: block.size }
                  }
                  hasBlock={block !== undefined}
                  locked={pinnedHere}
                  onAdd={this.addHere}
                  onNames={() => {
                    this.namesOpen = true;
                    this.rerender();
                  }}
                  onRedo={this.redo}
                  onRemove={this.removeHere}
                  onShape={this.setShape}
                  onSize={this.setSize}
                  onUndo={this.undo}
                  words={words}
                />
              ) : null}
              <Board
                badges={this.gameBadges()}
                carry={this.carry}
                choosing={this.choosingObject()}
                cursor={this.cursor}
                editable={editable}
                focusCursor={this.focusCursor}
                highlight={this.highlight}
                kind={kind}
                label={words("The world")}
                onCellPointer={this.onCellPointer}
                onDragMove={this.dragMove}
                onKeyDown={this.onKeyDown}
                onPaletteDrop={this.paletteDrop}
                pinned={pinned}
                state={world}
                words={words}
              />
              {this.namesOpen && block !== undefined ? (
                <NamesMenu
                  available={available}
                  block={block}
                  kind={kind}
                  onClose={() => {
                    this.namesOpen = false;
                    this.focusCursor = true;
                    this.rerender();
                  }}
                  onToggle={this.toggleName}
                  state={world}
                  words={words}
                />
              ) : null}
              {/* Why the palette is dimmed. The line is kept whenever the
                  world has a pinned block, so the board does not jump as
                  the cursor passes over one. */}
              {editable && pinned.size > 0 ? (
                <p class="world-cursor-note">
                  {pinnedHere && block !== undefined
                    ? kind.objectSentence(world, block.id, "pinned", words)
                    : null}
                </p>
              ) : null}
            </div>
          ) : (
            <ObjectTable
              available={available}
              editable={editable}
              onAdd={() => {
                const free = this.firstFreeSquare(world);

                if (free !== null) {
                  this.addAt(free, this.newShape, this.newSize);
                }
              }}
              onMove={this.apply}
              pinned={pinned}
              state={world}
              words={words}
            />
          )}
          {budget === null ? null : <p class="world-budget">{budget}</p>}
        </div>
        <div class="world-panel">
          {data.variant === "game"
            ? this.gamePanel(resolved)
            : this.sentencePanel(data, resolved, values)}
        </div>
        <p aria-live="polite" class="visually-hidden">
          {this.announcement}
        </p>
      </div>
    );
  }

  private sentencePanel(
    data: WorldPublicData,
    resolved: ResolvedWorld,
    values: ReturnType<typeof truthValues> | null,
  ) {
    const words = this.words;
    const Heading = this.panelHeading;
    const evaluate = data.variant === "evaluate";
    const world = this.world ?? (resolved.start as BlocksState);
    const highlighting =
      this.feedback === "full" && (!evaluate || this.preview);

    return (
      <>
        <Heading class="world-panel-heading">{words("Sentences")}</Heading>
        <ol class="world-sentences">
          {resolved.sentences.map((sentence, index) => {
            const target =
              sentence.target === undefined
                ? null
                : data.variant === "counterexample"
                  ? sentence.target
                    ? words("Premise")
                    : words("Conclusion")
                  : sentence.target
                    ? words("Make true")
                    : words("Make false");
            const mark = this.marks[index] ?? null;

            return (
              <li
                class="world-sentence"
                data-index={index}
                data-target={
                  sentence.target === undefined
                    ? undefined
                    : String(sentence.target)
                }
                key={sentence.text}
              >
                {target === null ? null : (
                  <span class="world-target">{target}</span>
                )}
                <FormulaView
                  enabled={highlighting && values !== null}
                  kind={resolved.kind}
                  onHighlight={this.setHighlight}
                  resolved={resolved}
                  state={world}
                  text={sentence.text}
                  words={words}
                />
                {evaluate && !this.preview ? (
                  <fieldset class="world-marks">
                    <legend class="visually-hidden">
                      {words("{sentence}: your mark", {
                        sentence: sentence.text,
                      })}
                    </legend>
                    {[true, false].map((value) => (
                      <button
                        aria-pressed={mark === value ? "true" : "false"}
                        class="world-mark"
                        key={String(value)}
                        onClick={() => {
                          this.marks[index] = mark === value ? null : value;
                          this.edited();
                        }}
                        type="button"
                      >
                        {words(value ? "True" : "False")}
                      </button>
                    ))}
                  </fieldset>
                ) : values === null ? (
                  <span class="world-truth" data-role="truth" />
                ) : (
                  <TruthMark
                    {...(sentence.target === undefined
                      ? {}
                      : { target: sentence.target })}
                    value={values.sentences[index] ?? null}
                    words={words}
                  />
                )}
              </li>
            );
          })}
        </ol>
        {resolved.laws.length === 0 ? null : (
          <>
            <Heading class="world-panel-heading">{words("Laws")}</Heading>
            <ul class="world-laws">
              {resolved.laws.map((law, index) => (
                <li class="world-sentence world-law" key={law.text}>
                  <FormulaView
                    enabled={highlighting && values !== null}
                    kind={resolved.kind}
                    onHighlight={this.setHighlight}
                    resolved={resolved}
                    state={world}
                    text={law.text}
                    words={words}
                  />
                  {values === null ? (
                    <span class="world-truth" data-role="truth" />
                  ) : (
                    <TruthMark
                      target
                      value={values.laws[index] ?? null}
                      words={words}
                    />
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </>
    );
  }

  private distinguishView(
    data: WorldPublicData,
    resolved: ResolvedWorld,
    kind: Blocks,
  ) {
    const words = this.words;
    const judged = this.judged(resolved);
    const worlds = judged.worlds;
    const parked = this.parked;
    const block = this.blockAtCursor();
    const verdict =
      this.feedback === "full" && this.sentence.trim() !== ""
        ? judgeDistinguish(data, judged, this.sentence)
        : null;
    const ignore = () => undefined;
    const figure = (
      side: Side,
      state: BlocksState,
      label: string,
      value: TruthValue | undefined,
    ) => {
      // Only the author preview edits here. A board the palette is not
      // editing takes it over at the first click, drag, key, or focus.
      const editing = parked !== null;
      const active = editing && side === this.active;
      const via =
        <A extends unknown[]>(handler: (...args: A) => void) =>
        (...args: A): void => {
          this.activate(side);
          handler(...args);
        };

      return (
        <figure
          class="world-figure"
          data-active={active ? "" : undefined}
          key={side}
          onFocusCapture={editing ? () => this.activate(side) : undefined}
        >
          <figcaption class="world-figure-label">
            <span>{label}</span>
            {active ? (
              <span class="world-figure-editing">{words("Editing")}</span>
            ) : null}
            {value === undefined ? null : (
              <TruthMark value={value} words={words} />
            )}
          </figcaption>
          <Board
            carry={active ? this.carry : null}
            cursor={
              active ? this.cursor : (parked?.cursor ?? { col: 0, row: 0 })
            }
            editable={editing}
            focusCursor={active && this.focusCursor}
            highlight={null}
            kind={kind}
            label={label}
            onCellPointer={editing ? via(this.onCellPointer) : ignore}
            onDragMove={editing ? via(this.dragMove) : ignore}
            onKeyDown={editing ? via(this.onKeyDown) : ignore}
            onPaletteDrop={editing ? via(this.paletteDrop) : ignore}
            pinned={new Set()}
            state={state}
            words={words}
          />
          {active && this.namesOpen && block !== undefined ? (
            <NamesMenu
              available={languageNames(resolved.language)}
              block={block}
              kind={kind}
              onClose={() => {
                this.namesOpen = false;
                this.focusCursor = true;
                this.rerender();
              }}
              onToggle={this.toggleName}
              state={state}
              words={words}
            />
          ) : null}
          <ul class="world-object-list">
            {state.objects.map((object) => (
              <li class="world-object" key={object.id}>
                {kind.describeObject(state, object.id, words)}
              </li>
            ))}
          </ul>
        </figure>
      );
    };
    const shown = (value: TruthValue): TruthValue | undefined =>
      verdict === null || verdict.errors.length > 0 ? undefined : value;
    const restriction = data.restriction;
    const errorText =
      verdict !== null && this.notedInline(verdict)
        ? describeWorldVerdict(verdict, judged, words)
        : "";

    return (
      <div class="world-layout world-layout-pair">
        {parked === null ? null : (
          <Palette
            canRedo={this.future.length > 0}
            canUndo={this.past.length > 0}
            copyAcross={{
              label:
                this.active === "a"
                  ? words("Copy world A into world B")
                  : words("Copy world B into world A"),
              onClick: this.copyAcross,
            }}
            current={
              block === undefined
                ? { shape: this.newShape, size: this.newSize }
                : { shape: block.shape, size: block.size }
            }
            hasBlock={block !== undefined}
            locked={false}
            onAdd={this.addHere}
            onNames={() => {
              this.namesOpen = true;
              this.rerender();
            }}
            onRedo={this.redo}
            onRemove={this.removeHere}
            onShape={this.setShape}
            onSize={this.setSize}
            onUndo={this.undo}
            words={words}
          />
        )}
        <div class="world-pair">
          {worlds === null
            ? null
            : [
                figure(
                  "a",
                  worlds.a as BlocksState,
                  words("World A"),
                  shown(verdict?.inA ?? null),
                ),
                figure(
                  "b",
                  worlds.b as BlocksState,
                  words("World B"),
                  shown(verdict?.inB ?? null),
                ),
              ]}
        </div>
        <div class="world-panel">
          <label class="world-answer-label" for="world-sentence">
            {words("Your sentence")}
          </label>
          <input
            autocomplete="off"
            class="world-answer"
            id="world-sentence"
            onInput={(event) => {
              this.sentence = (event.currentTarget as HTMLInputElement).value;
              this.edited();
            }}
            spellcheck={false}
            type="text"
            value={this.sentence}
          />
          {errorText === "" ? null : (
            <p class="world-answer-note" role="status">
              {errorText}
            </p>
          )}
          {restriction?.symbols !== undefined ? (
            <p class="world-restriction">
              {words("Allowed symbols: {symbols}", {
                symbols: restriction.symbols.join(" "),
              })}
            </p>
          ) : restriction?.without !== undefined ? (
            <p class="world-restriction">
              {words("Not allowed: {symbols}", {
                symbols: restriction.without.join(" "),
              })}
            </p>
          ) : null}
        </div>
        {parked === null ? null : (
          <p aria-live="polite" class="visually-hidden">
            {this.announcement}
          </p>
        )}
      </div>
    );
  }

  // --- The evaluation game ------------------------------------------------

  /** A sentence's game replayed, or null when it has no claim yet. */
  private played(index: number): PlayedGame | null {
    const game = this.games[index] ?? null;
    const sentence = this.resolved?.sentences[index];

    return game === null || sentence === undefined || this.gameWorld === null
      ? null
      : playGame(sentence.formula, this.gameWorld, game);
  }

  private activePlayed(): PlayedGame | null {
    return this.activeGame === null ? null : this.played(this.activeGame);
  }

  /** Whether the game shown is waiting for the student to choose a block. */
  private choosingObject(): boolean {
    return this.activePlayed()?.state.type === "choose-object";
  }

  /** The variables bound so far in the game shown, by their blocks' ids. */
  private gameBadges(): ReadonlyMap<string, string> | undefined {
    const played = this.activePlayed();
    const state = played?.state;
    const last = played?.steps.at(-1);
    const position =
      state !== undefined && state.type !== "invalid"
        ? state.position
        : last !== undefined && last.type !== "parts"
          ? last.to
          : undefined;

    if (position === undefined) {
      return undefined;
    }

    const bound = new Map<string, string>();

    for (const [variable, id] of position.bindings) {
      bound.set(variable, id);
    }

    const badges = new Map<string, string>();

    for (const [variable, id] of bound) {
      const held = badges.get(id);
      badges.set(id, held === undefined ? variable : `${held}, ${variable}`);
    }

    return badges;
  }

  /** The game's lines in words, as the panel shows them. */
  private gameLinesFor(index: number, played: PlayedGame) {
    const resolved = this.resolved;
    const sentence = resolved?.sentences[index];

    if (resolved === null || sentence === undefined) {
      return [];
    }

    return gameLines(
      played,
      {
        kind: resolved.kind,
        state: resolved.start,
        text: gameText(sentence.text, resolved),
        words: this.words,
      },
      this.showsDetail,
    );
  }

  /**
   * Change the game shown and announce what it added: the student's own move,
   * the computer's replies, and how it ended or what it asks for next.
   */
  private updateGame(index: number, game: WorldGameAnswer | null): void {
    const before = this.activeGame === index ? this.activePlayed() : null;
    const told =
      before === null ? 0 : this.gameLinesFor(index, before).length;

    this.games[index] = game;
    this.activeGame = index;

    const after = this.played(index);

    if (after !== null) {
      const lines = this.gameLinesFor(index, after)
        .slice(told)
        .map((line) => line.text);
      const prompt = this.gamePrompt(after);
      this.announce([...lines, ...(prompt === "" ? [] : [prompt])].join(" "));
    }

    if (after?.state.type === "choose-object") {
      this.focusCursor = true;
    } else {
      this.focusGame = true;
    }

    this.edited();
  }

  /** A claim about a sentence: its game starts over, or is shown again. */
  private readonly claimGame = (index: number, claim: boolean): void => {
    const game = this.games[index] ?? null;

    if (game?.claim === claim) {
      this.activeGame = index;
      this.rerender();
      return;
    }

    this.activeGame = null;
    this.updateGame(index, { choices: [], claim });
    this.focusGame = false;
  };

  private readonly chooseInGame = (choice: GameChoice): void => {
    const index = this.activeGame;
    const game = index === null ? null : (this.games[index] ?? null);

    if (index === null || game === null) {
      return;
    }

    this.updateGame(index, { ...game, choices: [...game.choices, choice] });
  };

  /** Take back the student's last move; past the first, the claim itself. */
  private readonly back = (): void => {
    const index = this.activeGame;
    const game = index === null ? null : (this.games[index] ?? null);

    if (index === null || game === null) {
      return;
    }

    this.games[index] =
      game.choices.length === 0
        ? null
        : { ...game, choices: game.choices.slice(0, -1) };
    this.announce(this.t("Took back your last move."));
    this.focusGame = true;
    this.edited();
  };

  private gamePrompt(played: PlayedGame): string {
    const state = played.state;

    if (state.type === "choose-object") {
      return this.t("Choose a block for {variable} on the board.", {
        variable: state.variable,
      });
    }

    return state.type === "choose-parts"
      ? this.t("Choose what you will defend.")
      : "";
  }

  private gamePanel(resolved: ResolvedWorld) {
    const words = this.words;
    const Heading = this.panelHeading;
    const index = this.activeGame;
    const sentence = index === null ? undefined : resolved.sentences[index];
    const played = this.activePlayed();

    return (
      <>
        <Heading class="world-panel-heading">{words("Sentences")}</Heading>
        <ol class="world-sentences">
          {resolved.sentences.map((row, rowIndex) => {
            const claim = this.games[rowIndex]?.claim;
            const state = this.played(rowIndex)?.state;
            const result =
              state?.type === "over" ? (state.won ? "won" : "lost") : null;

            return (
              <li
                class="world-sentence world-game-row"
                data-active={rowIndex === index ? "" : undefined}
                data-index={rowIndex}
                key={row.text}
              >
                <span class="world-formula">{row.text}</span>
                <span class="world-game-claim">
                  <fieldset class="world-marks">
                    <legend class="visually-hidden">
                      {words("{sentence}: your claim", {
                        sentence: row.text,
                      })}
                    </legend>
                    {[true, false].map((value) => (
                      <button
                        aria-pressed={claim === value ? "true" : "false"}
                        class="world-mark"
                        key={String(value)}
                        onClick={() => this.claimGame(rowIndex, value)}
                        type="button"
                      >
                        {words(value ? "True" : "False")}
                      </button>
                    ))}
                  </fieldset>
                  {result === null ? null : (
                    <span class="world-game-result" data-result={result}>
                      {words(result === "won" ? "Won" : "Lost")}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ol>
        <section class="world-game">
          <Heading class="world-panel-heading">{words("The game")}</Heading>
          {index === null || sentence === undefined || played === null ? (
            <p class="world-game-empty">
              {words("Claim a sentence true or false to start its game.")}
            </p>
          ) : (
            this.gameBody(index, sentence.text, played, resolved)
          )}
        </section>
      </>
    );
  }

  private gameBody(
    index: number,
    text: string,
    played: PlayedGame,
    resolved: ResolvedWorld,
  ) {
    const words = this.words;
    const state = played.state;
    const lines = this.gameLinesFor(index, played);
    const note = lossNote(played, words, this.showsDetail);
    const position = state.type === "invalid" ? null : state.position;

    return (
      <>
        <p class="world-game-sentence">
          <GameSentence
            path={position?.path ?? []}
            resolved={resolved}
            text={text}
          />
        </p>
        <ol class="world-game-moves">
          {lines.map((line, lineIndex) => (
            <li data-lost={line.lostHere ? "" : undefined} key={lineIndex}>
              {line.text}
              {line.lostHere ? " " : null}
              {line.lostHere ? (
                <span class="world-game-lost-here">
                  {words("This choice lost the game.")}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
        {note === "" ? null : <p class="world-game-note">{note}</p>}
        {state.type === "choose-object" ? (
          <p class="world-game-prompt">{this.gamePrompt(played)}</p>
        ) : null}
        {state.type === "choose-parts" ? (
          <fieldset class="world-game-options">
            <legend class="world-game-prompt">
              {this.gamePrompt(played)}
            </legend>
            {state.options.map((option, optionIndex) => (
              <button
                class="world-tool"
                data-game-focus={optionIndex === 0 ? "" : undefined}
                key={option.join(",")}
                onClick={() => this.chooseInGame(option)}
                type="button"
              >
                {partValuesText(
                  option,
                  state.position,
                  gameText(text, resolved),
                  words,
                  false,
                )}
              </button>
            ))}
          </fieldset>
        ) : null}
        <div class="proof-toolbar world-game-actions">
          <button
            aria-label={words("Take back your last move")}
            data-game-focus={state.type === "choose-parts" ? undefined : ""}
            onClick={this.back}
            title={`${words("Take back your last move")} (Ctrl-Z)`}
            type="button"
          >
            <ToolbarIcon name="undo" />
          </button>
        </div>
      </>
    );
  }

  private firstFreeSquare(world: BlocksState): Cursor | null {
    for (let row = 1; row <= BOARD_SIZE; row += 1) {
      for (let col = 1; col <= BOARD_SIZE; col += 1) {
        if (
          !world.objects.some(
            (block) => block.col === col && block.row === row,
          )
        ) {
          return { col, row };
        }
      }
    }

    return null;
  }
}

register("carnap-world", CarnapWorld);
