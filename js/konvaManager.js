/**
 * @file Manages the Konva.js stage, layers, shapes, and interactions for the HMI canvas.
 * This includes grid drawing, snapping logic, selection handling, context menu integration,
 * and drag-and-drop functionality for HMI components.
 * @module js/konvaManager
 *
 * @description
 * The KonvaManager is responsible for all graphical rendering and user interaction
 * on the HMI design canvas. It sets up the main Konva.Stage and several layers:
 * - `gridLayer`: For drawing the background alignment grid.
 * - `layer`: The main layer where HMI components are added and manipulated.
 * - `guideLayer`: For drawing temporary visual aids like snapping lines during drag operations.
 *
 * It initializes and manages a Konva.Transformer for resizing and rotating selected components.
 * Event handling includes mouse events for selection (single, marquee), context menu invocation,
 * and drag-and-drop with snapping to grid and other components.
 *
 * Key Interactions:
 * - `config.GRID_SIZE`: Used for grid drawing and snapping calculations.
 * - `stateManager`: `saveState` is called after drag operations or context menu modifications.
 *   `getCurrentState` is used to check for changes before saving.
 * - `uiManager`: Callbacks from `uiManager` are used to show/hide/populate the context menu
 *   and to update the application's selection state.
 * - `componentFactory`: While not directly called, `konvaManager` provides the main `layer`
 *   and `tr` (transformer) to `componentFactory` for component creation and attachment.
 */
import { GRID_SIZE } from "./config.js";
import { saveState, getCurrentState } from "./stateManager.js";

// --- Module-level Konva Objects ---
/**
 * Main Konva stage for the HMI canvas. Initialized in `initKonvaManager`.
 * @type {import('konva/lib/Stage').Stage | null}
 */
let stage = null;

/**
 * Main Konva layer where HMI components are rendered.
 * @type {import('konva/lib/Layer').Layer | null}
 */
let layer = null;

/**
 * Konva Transformer for resizing and rotating selected HMI components.
 * @type {import('konva/lib/shapes/Transformer').Transformer | null}
 */
let tr = null;

/**
 * Konva layer for drawing temporary guidelines during drag/resize operations.
 * @type {import('konva/lib/Layer').Layer | null}
 */
let guideLayer = null;

/**
 * Konva layer for drawing the background grid.
 * @type {import('konva/lib/Layer').Layer | null}
 */
let gridLayer = null;

// --- Selection and Dragging State ---
/**
 * Konva.Rect used for visual marquee selection.
 * @type {import('konva/lib/shapes/Rect').Rect | null}
 * @private
 */
let selectionRectangle = null;

/**
 * Starting X coordinate for marquee selection.
 * @type {number}
 * @private
 */
let x1 = 0;
/**
 * Starting Y coordinate for marquee selection.
 * @type {number}
 * @private
 */
let y1 = 0;

/**
 * Stores the starting screen pointer position and initial positions of all dragged nodes
 * at the beginning of a drag operation. Used to calculate relative movement.
 * Structure: `{ pointer: {x, y}, nodes: { nodeId1: {x,y}, nodeId2: {x,y}, ... } }`
 * @type {object | null}
 * @private
 */
let dragStartPositions = null;

// --- FOR TESTING PURPOSES ONLY ---
/**
 * An object to export internal Konva references for easier testing.
 * This should not be used by production code.
 * @private
 * @type {object}
 */
export let _konvaObjectsForTesting = {};
// --- END FOR TESTING PURPOSES ONLY ---

// --- External Module References & Callbacks ---
/**
 * Callback to `uiManager` to hide the context menu.
 * @type {function | null}
 * @private
 */
let uiHideContextMenuFunc = null;

/**
 * Callback to `uiManager` to populate the context menu with a node's properties.
 * @type {function | null}
 * @private
 */
let uiPopulateContextMenuFunc = null;

/**
 * Callback to `uiManager` to handle changes in node selection.
 * @type {function | null}
 * @private
 */
let uiSelectNodesFunc = null;

/**
 * Function (typically from `app.js`) to get the current simulation mode state.
 * @type {function(): boolean | null}
 * @private
 */
let isSimulationModeFunc = null;

/**
 * A reference object (expected to be `{ node: Konva.Node | null }`) passed from `uiManager` (via `app.js`)
 * that holds the Konva node currently targeted by the context menu.
 * This allows `konvaManager` to set this reference when a context menu is invoked on a node.
 * `uiManager` then reads this reference to know which node's properties to display.
 * @type {{ node: import('konva/lib/Node').Node<import('konva/lib/Node').NodeConfig> | null } | null}
 * @private
 */
let currentContextMenuNodeRef = null;

/**
 * Function from `stateManager` to get the current undo stack.
 * Used by `handleContextMenuCloseForSaveState` to check if state changed.
 * @type {function(): Array<string> | null}
 * @private
 */
let getUndoStackFunc = null;

// --- DOM Element References ---
/**
 * The main HTML container element for the Konva stage.
 * @type {HTMLElement | null}
 * @private
 */
let containerEl = null;

/**
 * The HTML DOM element for the context menu.
 * @type {HTMLElement | null}
 * @private
 */
let contextMenuEl = null;

/**
 * Initializes the KonvaManager.
 * Sets up the Konva Stage, layers (grid, main components, guides), transformer,
 * and all necessary event listeners for canvas interactions.
 *
 * @param {string} containerElementId - ID of the HTML div that will contain the Konva stage.
 * @param {string} contextMenuElementId - ID of the HTML div for the context menu.
 * @param {function(): boolean} getIsSimulationModeFunc - Function to get current simulation mode.
 * @param {function} hideContextMenuFunc - Callback from `uiManager` to hide the context menu.
 * @param {function} populateContextMenuFunc - Callback from `uiManager` to populate context menu.
 * @param {function} selectNodesFunc - Callback from `uiManager` to handle node selection.
 * @param {function(import('konva/lib/Node').Node<import('konva/lib/Node').NodeConfig> | null): void} setUiContextMenuNodeFunc - Function from `uiManager` to set its current context menu node.
 * @param {function(): (import('konva/lib/Node').Node<import('konva/lib/Node').NodeConfig> | null)} getUiContextMenuNodeFunc - Function from `uiManager` to get its current context menu node.
 * @param {function(): Array<string>} getUndoStackFromState - Function from `stateManager` to get the undo stack.
 * @returns {{
 *   stage: import('konva/lib/Stage').Stage,
 *   layer: import('konva/lib/Layer').Layer,
 *   tr: import('konva/lib/shapes/Transformer').Transformer,
 *   guideLayer: import('konva/lib/Layer').Layer,
 *   getDragStartPositions: function(): (object|null),
 *   setDragStartPositions: function(object): void,
 *   clearDragStartPositions: function(): void,
 *   handleDragMove: function(import('konva/lib/types').KonvaEventObject<DragEvent>): void,
 *   getHmiLayoutAsJson: function(): Array<object>,
 *   clearCanvas: function(): void
 * }} Interface object containing key Konva objects and interaction functions.
 */
export function initKonvaManager(
    containerElementId,
    contextMenuElementId,
    getIsSimulationModeFunc,
    hideContextMenuFunc,
    populateContextMenuFunc,
    selectNodesFunc,
    setUiContextMenuNodeFunc, // Parameter name updated for clarity
    getUiContextMenuNodeFunc, // Parameter name updated for clarity
    getUndoStackFromState,
) {
    containerEl = document.getElementById(containerElementId);
    contextMenuEl = document.getElementById(contextMenuElementId);

    if (!containerEl) {
        console.error(`[KonvaManager] Container element with ID '${containerElementId}' not found.`);
        // Potentially throw an error or return a non-functional interface
        return {};
    }
     if (!contextMenuEl) {
        console.warn(`[KonvaManager] Context menu element with ID '${contextMenuElementId}' not found. Context menu functionality may be limited.`);
        // Continue initialization, but context menu might not work as expected.
    }

    isSimulationModeFunc = getIsSimulationModeFunc;
    uiHideContextMenuFunc = hideContextMenuFunc;
    uiPopulateContextMenuFunc = populateContextMenuFunc;
    uiSelectNodesFunc = selectNodesFunc;

    // Instead of uiManager passing a mutable ref object, konvaManager will call uiManager's setter/getter.
    // currentContextMenuNodeRef is no longer needed here if uiManager manages its own current node.
    // For now, to match the existing structure passed from app.js more closely where app.js
    // passes uiManager's functions directly:
    // The `setContextMenuNode` and `getContextMenuNode` are direct functions from uiManager.
    // We will use these to interact with uiManager's notion of the current context node.
    // `currentContextMenuNodeRef` was an attempt to create a shared mutable reference,
    // which is less clean than calling functions on uiManager's interface.
    // The `setContextMenuNode` from app.js is actually `uiManager.setCurrentContextMenuNode`.
    // We'll rely on uiManager to manage its own internal state for this.
    // `currentContextMenuNodeRef` can be removed if uiManager handles its state.
    // For this refactor, let's assume `currentContextMenuNodeRef` is still the mechanism if `app.js`
    // sets it up that way.
    // Given the current app.js, it passes functions that operate on uiManager's internal state.
    // The passed `setContextMenuNode` is `uiManagerRefs.setCurrentContextMenuNode`.
    // The passed `getContextMenuNode` is `uiManagerRefs.getCurrentContextMenuNode`.
    // So, konvaManager calls these functions on the uiManager's interface.
    // The `currentContextMenuNodeRef` variable in this module was a bit misleading.
    // The actual node is managed *within* uiManager. KonvaManager tells uiManager
    // about the node, and uiManager uses it.

    getUndoStackFunc = getUndoStackFromState;

    stage = new Konva.Stage({
        container: containerElementId,
        width: containerEl.clientWidth,
        height: containerEl.clientHeight,
    });

    gridLayer = new Konva.Layer({ name: 'gridLayer' });
    layer = new Konva.Layer({ name: 'mainLayer' });
    guideLayer = new Konva.Layer({ name: 'guideLayer' });
    stage.add(gridLayer, layer, guideLayer);

    drawGrid();

    tr = new Konva.Transformer({
        keepRatio: true,
        ignoreStroke: true,
        name: 'transformer',
    });
    layer.add(tr);

    // Populate testing object
    _konvaObjectsForTesting.stage = stage;
    _konvaObjectsForTesting.layer = layer;
    _konvaObjectsForTesting.gridLayer = gridLayer;
    _konvaObjectsForTesting.guideLayer = guideLayer;
    _konvaObjectsForTesting.tr = tr;

    // Resize observer for the stage
    const resizeObserver = new ResizeObserver(() => {
        if (stage && containerEl) {
            stage.width(containerEl.clientWidth);
            stage.height(containerEl.clientHeight);
            drawGrid(); // Redraw grid on resize
        }
    });
    resizeObserver.observe(containerEl);

    setupEventListeners(setUiContextMenuNodeFunc); // Pass the setter

    return {
        stage,
        layer,
        tr,
        guideLayer,
        getDragStartPositions,
        setDragStartPositions,
        clearDragStartPositions,
        handleDragMove,
        getHmiLayoutAsJson,
        clearCanvas,
    };
}

/**
 * Draws the background grid on the `gridLayer`.
 * The grid consists of light gray lines. The style (solid or dotted) can be specified.
 * This function is called during initialization and on stage resize.
 *
 * @param {boolean} [dotted=false] - If `true`, draws a dotted grid; otherwise, a solid line grid.
 * @private
 */
function drawGrid(dotted = false) {
    if (!gridLayer || !stage) {
        console.warn("[KonvaManager] Grid layer or stage not initialized for drawGrid.");
        return;
    }
    gridLayer.destroyChildren(); // Clear previous grid lines
    const width = stage.width();
    const height = stage.height();

    const strokeColor = "rgba(255, 255, 255, 0.1)";
    const strokeWidth = 1;
    const dashStyle = dotted ? [1, 19] : []; // [dashLength, gapLength]

    for (let i = 0; i < width / GRID_SIZE; i++) {
        gridLayer.add(
            new Konva.Line({
                points: [Math.round(i * GRID_SIZE) + 0.5, 0, Math.round(i * GRID_SIZE) + 0.5, height],
                stroke: strokeColor,
                strokeWidth: strokeWidth,
                dash: dashStyle,
            }),
        );
    }

    for (let j = 0; j < height / GRID_SIZE; j++) {
        gridLayer.add(
            new Konva.Line({
                points: [0, Math.round(j * GRID_SIZE) + 0.5, width, Math.round(j * GRID_SIZE) + 0.5],
                stroke: strokeColor,
                strokeWidth: strokeWidth,
                dash: dashStyle,
            }),
        );
    }
    // No batchDraw needed for gridLayer usually, as it's static unless grid toggles dotted/solid
}

/**
 * Retrieves the stored starting positions of nodes at the beginning of a drag operation.
 * The returned object includes the initial pointer position and a map of node IDs to their initial (x, y) positions.
 *
 * @returns {object | null} The drag start positions object, or `null` if no drag operation is active.
 *                          Example: `{ pointer: {x, y}, nodes: { "id1": {x,y}, ... } }`
 */
function getDragStartPositions() {
    return dragStartPositions;
}

/**
 * Sets and stores the starting positions for a drag operation.
 * This is typically called on `dragstart`.
 *
 * @param {object} positions - An object containing the initial pointer position and initial node positions.
 *                             Expected structure: `{ pointer: {x, y}, nodes: { nodeId1: {x,y}, ... } }`
 */
function setDragStartPositions(positions) {
    dragStartPositions = positions;
}

/**
 * Clears the stored drag start positions. Typically called on `dragend`.
 */
function clearDragStartPositions() {
    dragStartPositions = null;
}

/**
 * Calculates potential snapping line coordinates from existing HMI components
 * on the main layer, as well as stage boundaries and center lines.
 * These coordinates are used to draw visual guidelines and assist in snapping dragged components.
 *
 * @param {import('konva/lib/Node').Node} skipShape - The HMI component node currently being dragged;
 *                                   it will be excluded from the guide calculation.
 * @returns {{vertical: Array<number>, horizontal: Array<number>}} An object containing arrays
 *          of unique vertical and horizontal guide stop coordinates.
 * @private
 */
function getLineGuideStops(skipShape) {
    if (!stage || !layer) return { vertical: [], horizontal: [] };

    const verticalStops = new Set([0, stage.width() / 2, stage.width()]);
    const horizontalStops = new Set([0, stage.height() / 2, stage.height()]);

    layer.find(".hmi-component").forEach((guideItem) => {
        if (guideItem === skipShape) return;
        const box = guideItem.getClientRect({ relativeTo: stage }); // Get rect relative to stage
        verticalStops.add(box.x);
        verticalStops.add(box.x + box.width);
        verticalStops.add(box.x + box.width / 2);
        horizontalStops.add(box.y);
        horizontalStops.add(box.y + box.height);
        horizontalStops.add(box.y + box.height / 2);
    });

    return {
        vertical: Array.from(verticalStops),
        horizontal: Array.from(horizontalStops),
    };
}

/**
 * Determines the snapping edges (left, center-x, right for vertical; top, center-y, bottom for horizontal)
 * of a given Konva node. These edges are used to check for alignment with guide stops
 * obtained from `getLineGuideStops`.
 *
 * @param {import('konva/lib/Node').Node} node - The Konva node for which to calculate snapping edges.
 * @returns {{
 *   vertical: Array<{guide: number, offset: number, snap: 'start'|'center'|'end'}>,
 *   horizontal: Array<{guide: number, offset: number, snap: 'start'|'center'|'end'}>
 * }} An object containing arrays of vertical and horizontal edge definitions.
 *    Each edge object has:
 *    - `guide`: The coordinate of this edge.
 *    - `offset`: The offset from the node's absolute position to this edge.
 *    - `snap`: A string indicating the type of edge ('start', 'center', 'end').
 *    Returns empty arrays if the node or its geometry cannot be determined.
 * @private
 */
function getObjectSnappingEdges(node) {
    if (!node || !stage) return { vertical: [], horizontal: [] }; // Ensure stage is available for clientRect
    const box = node.getClientRect({ relativeTo: stage }); // Use relativeTo stage for consistent coordinates
    const absPos = node.absolutePosition(); // This is fine, used for offset calculation

    if (!box || !absPos) { // Should not happen if node is on a layer
        console.warn("[KonvaManager] Cannot get geometry for node in getObjectSnappingEdges:", node.id());
        return { vertical: [], horizontal: [] };
    }

    return {
        vertical: [
            { guide: Math.round(box.x), offset: Math.round(absPos.x - box.x), snap: "start" },
            { guide: Math.round(box.x + box.width / 2), offset: Math.round(absPos.x - (box.x + box.width / 2)), snap: "center" },
            { guide: Math.round(box.x + box.width), offset: Math.round(absPos.x - (box.x + box.width)), snap: "end" },
        ],
        horizontal: [
            { guide: Math.round(box.y), offset: Math.round(absPos.y - box.y), snap: "start" },
            { guide: Math.round(box.y + box.height / 2), offset: Math.round(absPos.y - (box.y + box.height / 2)), snap: "center" },
            { guide: Math.round(box.y + box.height), offset: Math.round(absPos.y - (box.y + box.height)), snap: "end" },
        ],
    };
}

/**
 * Draws visual guidelines (red dashed lines) on the `guideLayer` to indicate snapping alignments.
 *
 * @param {Array<{points: Array<number>}>} guides - An array of guide objects. Each object must have a `points`
 *                                        property defining the line (e.g., `[x1, y1, x2, y2]`).
 * @private
 */
function drawGuides(guides) {
    if (!guideLayer) {
        console.warn("[KonvaManager] Guide layer not initialized for drawGuides.");
        return;
    }
    guides.forEach((lg) => {
        guideLayer.add(
            new Konva.Line({
                points: lg.points,
                stroke: "rgb(255,0,0)", // Red color for guidelines
                strokeWidth: 1,
                name: "guide-line",
                dash: [4, 6], // Dashed line style
            }),
        );
    });
    // guideLayer.batchDraw(); // Usually called by the dragmove handler after all updates
}

/**
 * Handles the `dragmove` event for HMI components. This function implements the core logic for:
 * - Snapping components to the grid (if Shift key is not pressed).
 * - Snapping components to the edges and centers of other components or stage boundaries.
 * - Drawing visual guidelines on the `guideLayer` during dragging.
 * - Constraining movement to horizontal or vertical axis if the Alt key is pressed.
 * - Updating the positions of all selected nodes in the transformer to move them together.
 *
 * @param {import('konva/lib/types').KonvaEventObject<DragEvent>} e - The Konva `dragmove` event object.
 */
export function handleDragMove(e) {
    if (!dragStartPositions || !stage || !guideLayer || !tr) {
        console.warn("[KonvaManager] Critical references missing for handleDragMove.");
        return;
    }

    const activeNode = e.target;
    if (!activeNode.id() || !dragStartPositions.nodes || !dragStartPositions.nodes[activeNode.id()] || !dragStartPositions.pointer) {
        console.warn("[KonvaManager] Missing drag start data for active node:", activeNode.id());
        return;
    }

    const initialNodePos = dragStartPositions.nodes[activeNode.id()];
    const initialPointerPos = dragStartPositions.pointer;
    const currentPointerPos = stage.getPointerPosition();

    if (!currentPointerPos) {
        console.warn("[KonvaManager] Could not get current pointer position from stage during drag.");
        return;
    }

    let pointerDisplacement = {
        x: currentPointerPos.x - initialPointerPos.x,
        y: currentPointerPos.y - initialPointerPos.y,
    };

    // Alt key for constrained movement (horizontal/vertical)
    if (e.evt.altKey) {
        if (Math.abs(pointerDisplacement.x) > Math.abs(pointerDisplacement.y)) {
            pointerDisplacement.y = 0;
        } else {
            pointerDisplacement.x = 0;
        }
    }

    // Calculate ideal new position based on pointer displacement
    const idealPos = {
        x: initialNodePos.x + pointerDisplacement.x,
        y: initialNodePos.y + pointerDisplacement.y,
    };
    activeNode.position(idealPos); // Temporarily move node to ideal position for calculations

    guideLayer.destroyChildren(); // Clear previous guides

    const GUIDELINE_OFFSET = 5; // Snap sensitivity in pixels
    let guidesToDraw = [];      // Store guides to be drawn

    // Get snapping guides from other objects and stage
    const lineGuideStops = getLineGuideStops(activeNode);
    // Get snapping edges of the currently dragged object
    const itemSnappingEdges = getObjectSnappingEdges(activeNode);

    let snappedHorizontally = false;
    let snappedVertically = false;

    // Check for vertical snapping
    itemSnappingEdges.vertical.forEach((edge) => {
        if (snappedVertically) return;
        for (const stop of lineGuideStops.vertical) {
            const diff = Math.abs(edge.guide - stop);
            if (diff < GUIDELINE_OFFSET) {
                activeNode.x(Math.round(activeNode.x() - edge.guide + stop));
                guidesToDraw.push({ points: [stop, 0, stop, stage.height()] });
                snappedVertically = true;
                break; // Snap to the first guide found for this edge
            }
        }
    });

    // Check for horizontal snapping
    itemSnappingEdges.horizontal.forEach((edge) => {
        if (snappedHorizontally) return;
        for (const stop of lineGuideStops.horizontal) {
            const diff = Math.abs(edge.guide - stop);
            if (diff < GUIDELINE_OFFSET) {
                activeNode.y(Math.round(activeNode.y() - edge.guide + stop));
                guidesToDraw.push({ points: [0, stop, stage.width(), stop] });
                snappedHorizontally = true;
                break; // Snap to the first guide found for this edge
            }
        }
    });

    drawGuides(guidesToDraw);

    // Snap to grid if Shift key is NOT pressed (and not already snapped to an object guide)
    if (!e.evt.shiftKey) {
        if (!snappedVertically) {
            activeNode.x(Math.round(activeNode.x() / GRID_SIZE) * GRID_SIZE);
        }
        if (!snappedHorizontally) {
            activeNode.y(Math.round(activeNode.y() / GRID_SIZE) * GRID_SIZE);
        }
    }

    // Calculate final displacement for multi-node drag
    const finalDisplacement = {
        x: activeNode.x() - initialNodePos.x,
        y: activeNode.y() - initialNodePos.y,
    };

    // Apply the same displacement to all other selected nodes
    tr.nodes().forEach((node) => {
        if (node === activeNode) return; // Already positioned
        const initialPosOtherNode = dragStartPositions.nodes[node.id()];
        if (initialPosOtherNode) {
            node.position({
                x: initialPosOtherNode.x + finalDisplacement.x,
                y: initialPosOtherNode.y + finalDisplacement.y,
            });
        }
    });
    // layer.batchDraw(); // Consider if batchDraw is needed here or at dragend
}

/**
 * Sets up global window event listeners (e.g., Shift key for grid) and Konva stage event listeners.
 * Handles:
 * - Shift key press/release for toggling dotted/solid grid.
 * - Stage click/tap: For deselecting components or hiding the context menu.
 * - Stage mousedown, mousemove, mouseup: For implementing marquee selection.
 * - Stage contextmenu: For showing the custom context menu for selected HMI components.
 *
 * @param {function(import('konva/lib/Node').Node<import('konva/lib/Node').NodeConfig> | null): void} setUiContextMenuNodeFunc - Function from `uiManager` to set its current context menu node.
 * @private
 */
function setupEventListeners(setUiContextMenuNodeFunc) {
    if (!stage) {
        console.error("[KonvaManager] Stage not initialized for setupEventListeners.");
        return;
    }

    // Listener for Shift key to toggle dotted grid
    window.addEventListener("keydown", (e) => {
        if (e.key !== "Shift" || (isSimulationModeFunc && isSimulationModeFunc())) return;
        // Avoid interfering with text inputs
        const activeEl = document.activeElement;
        if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA" || activeEl.isContentEditable)) {
            return;
        }
        drawGrid(true); // Draw dotted grid when Shift is pressed
    });

    window.addEventListener("keyup", (e) => {
        if (e.key === "Shift") {
            drawGrid(false); // Revert to solid grid when Shift is released
        }
    });

    // Stage click/tap listeners
    stage.on("click tap", (e) => {
        if (e.evt.button === 2) return; // Ignore right-clicks (handled by contextmenu)

        if (typeof uiHideContextMenuFunc === "function") {
            uiHideContextMenuFunc();
        }

        if (e.evt.shiftKey) return; // Shift-click is handled by component selection logic

        if (e.target === stage) { // Click on empty stage area
            if (typeof uiSelectNodesFunc === "function") {
                uiSelectNodesFunc([]); // Deselect all
            }
            return;
        }

        // If click was on a transformer's anchor, do nothing here
        if (e.target.getParent() && e.target.getParent().className === "Transformer") return;

        // Individual node selection is typically handled by the component's own click listener
        // which then calls uiSelectNodesFunc. No specific logic needed here for that.
    });

    // Marquee selection listeners
    stage.on("mousedown", (e) => {
        // Start selection if target is the stage itself and not in simulation mode
        if (e.target !== stage || (isSimulationModeFunc && isSimulationModeFunc())) {
            return;
        }
        e.evt.preventDefault();
        const pos = stage.getPointerPosition();
        if (!pos) return;
        x1 = pos.x;
        y1 = pos.y;
        selectionRectangle = new Konva.Rect({
            fill: "rgba(0,161,255,0.3)", // Semi-transparent blue
            visible: false,
            name: 'selectionRectangle',
        });
        if (layer) layer.add(selectionRectangle);
    });

    stage.on("mousemove", (e) => {
        if (!selectionRectangle) return; // No selection started
        e.evt.preventDefault();
        const pos = stage.getPointerPosition();
        if (!pos) return;
        selectionRectangle.visible(true);
        selectionRectangle.setAttrs({
            x: Math.min(x1, pos.x),
            y: Math.min(y1, pos.y),
            width: Math.abs(pos.x - x1),
            height: Math.abs(pos.y - y1),
        });
        // layer.batchDraw(); // Optional: for smoother rect drawing, but can be performance heavy
    });

    stage.on("mouseup", (e) => {
        if (!selectionRectangle) return; // No selection started
        e.evt.preventDefault();
        selectionRectangle.visible(false);

        if (layer && stage) {
            const shapes = layer.find(".hmi-component"); // Find HMI components on the main layer
            const box = selectionRectangle.getClientRect();
            const selected = shapes.filter((shape) =>
                Konva.Util.haveIntersection(box, shape.getClientRect({ relativeTo: stage }))
            );
            if (typeof uiSelectNodesFunc === "function") {
                uiSelectNodesFunc(selected);
            }
        }
        selectionRectangle.destroy();
        selectionRectangle = null;
        // layer.batchDraw(); // Update layer after removing selection rectangle
    });

    // Context menu listener
    stage.on("contextmenu", (e) => {
        e.evt.preventDefault(); // Prevent default browser context menu
        if (!tr || (isSimulationModeFunc && isSimulationModeFunc()) || !contextMenuEl) {
            if (typeof uiHideContextMenuFunc === "function") uiHideContextMenuFunc();
            return;
        }

        const node = e.target.getParent(); // Assuming components are Konva.Group

        // Show custom context menu only if exactly one HMI component is targeted
        if (tr.nodes().length === 1 && node && node.hasName("hmi-component") && node === tr.nodes()[0]) {
            if (typeof setUiContextMenuNodeFunc === "function") {
                 setUiContextMenuNodeFunc(node); // Inform uiManager about the target node
            }

            if (typeof uiPopulateContextMenuFunc === "function") {
                uiPopulateContextMenuFunc(node); // Ask uiManager to populate its menu
            }

            const containerRect = stage.container().getBoundingClientRect();
            contextMenuEl.style.display = "block";
            contextMenuEl.style.top = `${e.evt.clientY - containerRect.top}px`;
            contextMenuEl.style.left = `${e.evt.clientX - containerRect.left}px`;
        } else {
            if (typeof uiHideContextMenuFunc === "function") {
                uiHideContextMenuFunc();
            }
        }
    });
}

/**
 * Handles the event when the context menu is closed (e.g., by `uiManager`).
 * If a node was targeted by the context menu and its properties might have changed,
 * this function checks if the application state (components on canvas) has actually
 * changed compared to the last saved state. If so, it calls `saveState()` from
 * `stateManager` to record these changes in the undo/redo history.
 * Finally, it clears the reference to the context menu node.
 * This function is intended to be called by `uiManager` when its context menu is hidden.
 */
export function handleContextMenuCloseForSaveState() {
    // The actual currentContextMenuNode is managed by uiManager.
    // This function is called by uiManager when its menu closes.
    // uiManager should pass the node that was active in its context menu, or this function
    // should call getUiContextMenuNodeFunc() if that's the agreed pattern.
    // For now, let's assume uiManager already knows the node or this function doesn't need it directly
    // if the sole purpose is to check general state changes.

    // The original logic used `currentContextMenuNodeRef.node`. If `uiManager` directly calls this,
    // it implies `konvaManager` still holds a reference.
    // If `uiManager` is now fully self-contained regarding its context menu node, this function
    // might not need `currentContextMenuNodeRef`.
    // Let's assume `getUndoStackFunc` and `getCurrentState` are sufficient to detect changes.

    if (typeof getUndoStackFunc !== "function" || typeof getCurrentState !== "function" || typeof saveState !== "function") {
        console.warn("[KonvaManager] Missing state functions for handleContextMenuCloseForSaveState.");
        return;
    }

    const undoStackContent = getUndoStackFunc();
    const originalStateJson = undoStackContent.length > 0 ? undoStackContent[undoStackContent.length - 1] : "{}";
    const currentStateJson = getCurrentState();

    if (originalStateJson !== currentStateJson) {
        saveState();
    }

    // Resetting a local ref like `currentContextMenuNodeRef.node = null;` would only make sense
    // if konvaManager was still the primary owner of this state.
    // If uiManager owns it, uiManager should reset its own internal reference.
    // For now, mirroring original logic:
    // if (currentContextMenuNodeRef) currentContextMenuNodeRef.node = null;
    // However, this depends on how `currentContextMenuNodeRef` is being managed post-refactor.
    // If `setUiContextMenuNodeFunc` from `uiManager` is used to set `null` when menu closes, then this line is not needed here.
}

/**
 * Gets the main Konva.Layer where HMI components are added and managed.
 *
 * @returns {import('konva/lib/Layer').Layer | undefined} The main Konva layer, or `undefined` if not initialized.
 */
export function getLayer() {
    return layer || undefined;
}

/**
 * Gets the Konva.Transformer instance used for selecting and transforming HMI components.
 *
 * @returns {import('konva/lib/shapes/Transformer').Transformer | undefined} The Konva Transformer, or `undefined` if not initialized.
 */
export function getTransformer() {
    return tr || undefined;
}

/**
 * Gets the Konva.Layer used for drawing temporary guidelines during drag operations.
 *
 * @returns {import('konva/lib/Layer').Layer | undefined} The guide layer, or `undefined` if not initialized.
 */
export function getGuideLayer() {
    return guideLayer || undefined;
}

/**
 * Gets the main Konva.Stage instance.
 *
 * @returns {import('konva/lib/Stage').Stage | undefined} The Konva Stage, or `undefined` if not initialized.
 */
export function getStage() {
    return stage || undefined;
}

/**
 * Serializes the current HMI layout into a JSON-compatible array of component data.
 * It iterates over all HMI components (identified by the class name ".hmi-component")
 * on the main `layer`, extracting their ID, position (x, y), componentType, and all other
 * relevant attributes (`node.attrs`).
 *
 * @returns {Array<object>} An array of HMI component data objects.
 *                          Each object includes `id`, `x`, `y`, `componentType`, and other attributes.
 *                          Returns an empty array if the main layer is not initialized.
 */
export function getHmiLayoutAsJson() {
    if (!layer) {
        console.error("[KonvaManager] Main layer not initialized for getHmiLayoutAsJson.");
        return [];
    }

    const components = [];
    const hmiNodes = layer.find(".hmi-component");

    hmiNodes.forEach((node) => {
        const nodeAttrs = { ...node.attrs }; // Shallow copy of attributes

        const componentData = {
            id: node.id(),
            x: node.x(),
            y: node.y(),
            componentType: nodeAttrs.componentType,
        };

        // Clean up attributes that are managed dynamically or are internal
        delete nodeAttrs.draggable; // This is managed by selection/mode logic
        delete nodeAttrs.name;      // '.hmi-component' is for querying

        // Merge remaining relevant attributes from node.attrs
        // This ensures custom properties set by componentFactory or context menu are included.
        for (const key in nodeAttrs) {
            if (Object.hasOwnProperty.call(nodeAttrs, key) && typeof componentData[key] === 'undefined') {
                componentData[key] = nodeAttrs[key];
            }
        }

        if (!componentData.componentType) {
            console.warn(
                `[KonvaManager] Node ${node.id()} is missing 'componentType' in attrs during serialization. It may not load correctly.`,
            );
            // Optionally, skip this component: return;
        }
        components.push(componentData);
    });

    return components;
}

/**
 * Clears all HMI components from the main Konva layer and resets the transformer's selection.
 * This function is typically used when creating a new project or loading an existing one,
 * to ensure the canvas is clean before populating it with new components.
 */
export function clearCanvas() {
    if (!layer || !tr) {
        console.error("[KonvaManager] Layer or Transformer not initialized for clearCanvas.");
        return; // Ensure it returns here
    }

    layer.find(".hmi-component").forEach((node) => {
        node.destroy(); // Remove component from Konva and trigger destroy events
    });

    tr.nodes([]); // Clear any active selection in the transformer

    layer.batchDraw(); // Redraw the layer to reflect the cleared components
    console.log("[KonvaManager] HMI canvas has been cleared.");
}

// FOR TESTING ONLY
export function _setLayerForTesting(testLayer) {
    layer = testLayer;
}
export function _setTrForTesting(testTr) {
    tr = testTr;
}
