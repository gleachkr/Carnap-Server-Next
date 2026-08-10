/*
 * Vendored from gleachkr/ProofML (src/proof.mjs), which has no npm package
 * and no LICENSE file; imported here with the author's permission (gleachkr
 * is this project's owner). Display-only custom elements — <proof-tree>,
 * <proof-forest>, <proof-proposition>, <proof-inference> — that lay out a
 * proof tree with fitch-bar struts (layout computed client-side via
 * ResizeObserver). Kept verbatim; not linted/formatted (Biome scopes *.ts only).
 * Source: https://github.com/gleachkr/ProofML/blob/main/src/proof.mjs
 */
function mergeBoxes(box1, box2) {
  const leftEdge = Math.min(box1.x, box2.x)
  const bottomEdge = Math.min(box1.y, box2.y)
  return new DOMRect(
    leftEdge,
    bottomEdge,
    Math.max(box1.right - leftEdge, box2.right - leftEdge),
    Math.max(box1.top - bottomEdge, box2.top - bottomEdge),
  )
}

class Tree extends HTMLElement {
  constructor() {
    super()
    this.attachShadow({ mode: "open" })
  }

  connectedCallback() {
    if (!this.initialized) {
      this.styleSheet = document.createElement("style")

      this.forestSlot = document.createElement("slot")
      this.forestSlot.setAttribute("name", "forest")

      this.propositionSlot = document.createElement("slot")
      this.propositionSlot.setAttribute("name", "proposition")

      this.inferenceSlot = document.createElement("slot")
      this.inferenceSlot.setAttribute("name", "inference")

      this.node = document.createElement("div")
      this.node.id = "node"

      this.leftStrut = document.createElement("div")
      this.leftStrut.id = "left-strut"

      this.rightStrut = document.createElement("div")
      this.rightStrut.id = "right-strut"

      this.propWrapper = document.createElement("div")
      this.propWrapper.id = "prop-wrapper"

      this.shadowRoot.appendChild(this.styleSheet)
      this.shadowRoot.appendChild(this.forestSlot)
      this.shadowRoot.appendChild(this.node)

      this.node.appendChild(this.leftStrut)
      this.node.appendChild(this.propWrapper)
      this.node.appendChild(this.rightStrut)

      this.propWrapper.appendChild(this.propositionSlot)

      this.rightStrut.appendChild(this.inferenceSlot)
      this.inferenceOffsetX = 0
      this.inferenceOffsetY = 0

      this.listener = new ResizeObserver(() => {
        this.dispatchEvent(new Event("proofml-resize", { "bubbles": true }))
        this.handleResize()
      })

      this.propositionSlot.addEventListener("slotchange", () => {
        this.listener.disconnect()
        this.propositionSlot.assignedElements().forEach(elt => this.listener.observe(elt))
        this.handleResize()
      })

      this.addEventListener("proofml-resize", ev => {
        if (ev.target != this) {
          this.handleResize()
          ev.stopPropagation()
        }
      })

      this.addEventListener("proofml-forest-child-change", ev => {
        this.styleSheet.textContent = this.getStyleContent()
        ev.stopPropagation()
      })

      this.initialized = true;
    }

    this.inForest = this.parentElement.tagName == "PROOF-FOREST"
    this.styleSheet.textContent = this.getStyleContent()
  }

  getPropClientRect() {
    return this.propositionSlot.assignedElements()
      .map(elt => elt.getBoundingClientRect())
      .reduce(mergeBoxes)
  }

  isForestInhabited() {
    return this.forestSlot.assignedElements()
      .map(elt => [...elt.children])
      .flat()
      .length > 0
  }

  adjustLabels() {
    //needed to compensate for CSS scaling. This assumes scaling is uniform.
    const scalefactor = this.offsetWidth / this.getBoundingClientRect().width

    const stems = this.forestSlot.assignedElements()
      .map(elt => [...elt.children])
      .flat()

    const rootbox = this.propWrapper.getBoundingClientRect()

    const offsetToProp = this.getPropClientRect().right - rootbox.right

    // Measure each premise's *conclusion line*, not its subtree. For a leaf
    // premise (a bare proof-proposition) its own box is that line; for a
    // proof-tree premise it's the inner prop-wrapper. If a proof-tree premise
    // hasn't run connectedCallback yet (propWrapper still undefined — the
    // usual state the first time a forest is created), we must NOT fall back
    // to its whole-subtree box. Skip such a premise and schedule a recompute
    // for once it's initialized, so the label lands correctly on first
    // creation instead of only after a later resize.
    let pending = false
    const stemboxes = stems.map(elt => {
      if (elt.tagName == "PROOF-TREE") {
        if (elt.propWrapper) return elt.propWrapper.getBoundingClientRect()
        pending = true
        return null
      }
      return elt.getBoundingClientRect()
    }).filter(Boolean)

    if (stemboxes.length == 0) {
      this.inferenceOffsetX = offsetToProp * scalefactor
    } else {
      const stembox = stemboxes.reduce(mergeBoxes)
      this.inferenceOffsetX = Math.max(offsetToProp, stembox.right - rootbox.right) * scalefactor
    }
    if (pending) requestAnimationFrame(() => this.handleResize())

    const labels = this.inferenceSlot.assignedElements()
    if (labels.length == 0) {
      this.inferenceOffsetY = 0
    } else {
      const labelbox = labels
        .map(elt => elt.getBoundingClientRect()).reduce(mergeBoxes)
      this.inferenceOffsetY = (rootbox.height - (labelbox.height / 2)) * scalefactor
    }
  }

  computeNodeMin() {
    const scalefactor = this.offsetWidth / this.getBoundingClientRect().width
    const error = Math.abs(this.propBelow - Math.floor(scalefactor * this.getPropClientRect().width))
    //making sure the update is big enough prevents resize thrashing
    if (isNaN(error) || error > 5) {
      this.propBelow = Math.floor(scalefactor * this.getPropClientRect().width)
    }
  }

  // Stretch the premises just enough that their conclusions span this
  // conclusion — sharing out only the *deficit*, so a narrow premise is left
  // alone when a wide sibling already covers the line (otherwise its bar floats
  // out past it). This works on conclusion widths (the proposition content, via
  // getPropClientRect / a range over a leaf's content) and never on subtree
  // widths, so a wide sub-proof can't widen the bars above it.
  distributePremiseWidths() {
    const forest = this.forestSlot.assignedElements()[0]
    const premises = forest ? [...forest.children] : []
    if (premises.length == 0) return
    const scalefactor = this.offsetWidth / this.getBoundingClientRect().width
    const naturals = premises.map(p => {
      try {
        if (typeof p.getPropClientRect == "function") return scalefactor * p.getPropClientRect().width
        const range = document.createRange()
        range.selectNodeContents(p)
        return scalefactor * range.getBoundingClientRect().width
      } catch (e) {
        return scalefactor * p.getBoundingClientRect().width
      }
    })
    const sum = naturals.reduce((a, b) => a + b, 0)
    if (sum == 0) return   // not laid out yet — a later resize pass will set these
    const share = Math.max(0, this.propBelow - sum) / premises.length
    premises.forEach((p, i) => {
      const target = Math.floor(naturals[i] + share)
      //avoid thrashing: only rewrite when it moves meaningfully
      if (p.propMin === undefined || Math.abs(p.propMin - target) > 5) {
        p.propMin = target
        p.style.setProperty("--prop-min", target + "px")
        // The premise's conclusion line just changed width, so its own
        // inference label offset (computed against the old width) is now stale.
        // A parent-driven width change doesn't reliably re-fire the premise's
        // ResizeObserver, so recompute its layout once the new width is in.
        // Bounded: the guard above stops firing once widths converge.
        if (typeof p.handleResize == "function") {
          requestAnimationFrame(() => p.handleResize())
        }
      }
    })
  }

  handleResize() {
    this.adjustLabels()
    this.computeNodeMin()
    this.distributePremiseWidths()
    this.styleSheet.textContent = this.getStyleContent()
  }

  getStyleContent() {
    return `
    #node {
      display:grid;
      grid-template-columns: 1fr max-content 1fr;
    }

    ::slotted([slot=forest]) {
      display:flex;
      /* center so the small leftover from rounding goes to the outer edges
         rather than between siblings (which would break the line). */
      justify-content:center;
    }

    ::slotted([slot=proposition]) {
      ${this.isForestInhabited() ? "" : "border-top: var(--border-width-internal-original) var(--border-style-internal) var(--border-color-internal);"}
    }

    #prop-wrapper {
      ${this.inForest ? "border-bottom: var(--border-width-internal) var(--border-style-internal) var(--border-color-internal);" : ""}
      /* width handed down by the parent's distributePremiseWidths: enough for
         the premises to span the conclusion, but no equal-share over-stretch. */
      min-width: var(--prop-min, 0px);
      display:flex;
      justify-content: center;
    }

    #left-strut, #right-strut {
      position:relative;
    }

    :host {
      display:inline-flex;
      flex-direction:column;
      justify-content:end;
      --border-width-internal: calc(var(--border-width-internal-original) * var(--hide-border, 1));
      --border-width-internal-original: var(--border-width, 1px);
      --border-color-internal: var(--border-color, black);
      --border-style-internal: var(--border-style, solid);
      --inference-size-internal: var(--inference-size, .6em);
      --kern-right-internal: var(--kern-right, 25px);
      --kern-left-internal: var(--kern-left, 25px);
    }

    ::slotted([slot=inference]) {
      position:absolute;
      bottom:${this.inferenceOffsetY}px;
      font-size: var(--inference-size-internal);
      left:${this.inferenceOffsetX}px;
      white-space: nowrap;
    }

    ${!this.inForest ? "" : `:host(:not(:first-child)) #left-strut {
      border-bottom: var(--border-width-internal) var(--border-style-internal) var(--border-color-internal);
      min-width: var(--kern-left-internal);
    }`}

    ${!this.inForest ? "" : `:host(:not(:last-child)) #right-strut {
      border-bottom: var(--border-width-internal) var(--border-style-internal) var(--border-color-internal);
      min-width: var(--kern-right-internal);
    }`}
  `}
}

class Forest extends HTMLElement {
  constructor() {
    super()
    this.attachShadow({ mode: "open" })
  }

  connectedCallback() {
    if (!this.initialized) {
      this.setAttribute("slot", "forest")
      this.styleSheet = document.createElement("style")

      this.mainSlot = document.createElement("slot")

      this.shadowRoot.appendChild(this.styleSheet)
      this.shadowRoot.appendChild(this.mainSlot)

      this.styleSheet.textContent = `
      :host {
        display:flex;
        justify-content:center;
        --hide-border:1;
        --border-width-internal: calc(var(--hide-border) * var(--border-width, 1px));
        --border-color-internal: var(--border-color, black);
        --border-style-internal: var(--border-style, solid);
        --foreign-spacing-internal: var(--foreign-spacing,15px)
      }

      ::slotted(proof-proposition) {
        padding: 0px 5px 0px 5px;
        border-bottom: var(--border-width-internal) var(--border-style-internal) var(--border-color-internal);
        /* a leaf premise's share, handed down by the parent (see Tree's
           distributePremiseWidths) — same role as #prop-wrapper's min-width. */
        min-width: var(--prop-min, 0px);
        display:flex;
        padding-right:var(--foreign-spacing-internal);
        padding-left:var(--foreign-spacing-internal);
        flex-direction:column-reverse;
        justify-content: end;
        align-items:center;
      }

      ::slotted(proof-proposition:first-child) {
        padding-left:0px;
        margin-left:calc(2*var(--foreign-spacing-internal));
      }

      ::slotted(proof-proposition:last-child) {
        padding-right:0px;
        margin-right:calc(2*var(--foreign-spacing-internal));
      }
      `

      this.listener = new ResizeObserver(() => {
        this.dispatchEvent(new Event("proofml-resize", { "bubbles": true }))
      })

      this.mainSlot.addEventListener("slotchange", () => {
        this.dispatchEvent(new Event("proofml-forest-child-change", { "bubbles": true }))
        this.listener.disconnect()
        const elts = this.mainSlot.assignedElements()
        elts.forEach(
          elt => this.listener.observe(elt)
        )
      })
      this.initialized = true;
    }
  }
}

class Inference extends HTMLElement {
  connectedCallback() {
    if (!this.initialized) {
      this.setAttribute("slot", "inference")
      this.initialized = true
    }
  }
}

class Proposition extends HTMLElement {
  connectedCallback() {
    if (this.parentElement.tagName == "PROOF-TREE") {
      this.setAttribute("slot", "proposition")
    } else {
      this.removeAttribute("slot")
    }
  }
}

window.customElements.define("proof-tree", Tree)
window.customElements.define("proof-proposition", Proposition)
window.customElements.define("proof-inference", Inference)
window.customElements.define("proof-forest", Forest)
