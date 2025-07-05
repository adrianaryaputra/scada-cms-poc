/**
 * @file Manages the Konva.js stage, layers, shapes, and interactions for the HMI canvas.
 * This includes grid drawing, snapping logic, selection handling, context menu integration,
 * and drag-and-drop functionality for HMI components.
 * @module js/konvaManager
 */
import { GRID_SIZE } from "./config.js";
import { saveState, getCurrentState } from "./stateManager.js";

// --- Module-level Konva Objects ---
/** @type {Konva.Stage} Main stage for the HMI canvas. */
let stage;
/** @type {Konva.Layer} Layer for HMI components. */
let layer;
/** @type {Konva.Transformer} Transformer for resizing/rotating selected components. */
let tr;
/** @type {Konva.Layer} Layer for drawing guidelines during drag/resize. */
let guideLayer;
/** @type {Konva.Layer} Layer for drawing the background grid. */
let gridLayer;

// --- Selection and Dragging State ---
/** @type {Konva.Rect} Rectangle used for marquee selection. */
let selectionRectangle;
/** @type {number} Starting X coordinate for marquee selection. */
let x1;
/** @type {number} Starting Y coordinate for marquee selection. */
let y1;
/** @type {object|null} Stores the starting positions of nodes during a drag operation. */
let dragStartPositions = null;

// --- FOR TESTING PURPOSES ONLY ---
/** @private For testing */
export let _konvaObjectsForTesting = {};
// --- END FOR TESTING PURPOSES ONLY ---

// --- External Module References & Callbacks ---
/** @type {function} Callback to uiManager to hide the context menu. */
let uiHideContextMenuFunc;
/** @type {function} Callback to uiManager to populate the context menu. */
let uiPopulateContextMenuFunc;
/** @type {function} Callback to uiManager to handle node selection changes. */
let uiSelectNodesFunc;
/** @type {function(): boolean} Function from app.js to get current simulation mode state. */
let isSimulationModeFunc;
/**
 * @type {{node: Konva.Node|null}}
 * Reference object (passed from uiManager or app.js) to hold the Konva node
 * currently targeted by the context menu. Allows konvaManager to update it.
 */
let currentContextMenuNodeRef;
/** @type {function(): Array<string>} Function from stateManager to get the undo stack. */
let getUndoStackFunc;

// --- DOM Element References ---
/** @type {HTMLElement} The main container element for the Konva stage. */
let containerEl;
/** @type {HTMLElement} The DOM element for the context menu. */
let contextMenuEl;

/**
 * Initializes the KonvaManager with necessary DOM element IDs, and callbacks from other modules.
 * Sets up the Konva Stage, layers (grid, main, guide), transformer, and event listeners.
 *
 * @export
 * @param {string} containerElementId - The ID of the HTML div element that will contain the Konva stage.
 * @param {string} contextMenuElementId - The ID of the HTML div element for the context menu.
 * @param {function(): boolean} getIsSimulationModeFunc - Function to get the current simulation mode state.
 * @param {function} hideContextMenuFunc - Callback function from uiManager to hide the context menu.
 * @param {function} populateContextMenuFunc - Callback function from uiManager to populate the context menu.
 * @param {function} selectNodesFunc - Callback function from uiManager to handle node selection.
 * @param {object} setContextMenuNode - (DEPRECATED/REPLACED by currentContextMenuNodeRef) Original function to set context menu node.
 * @param {object} getContextMenuNode - (DEPRECATED/REPLACED by currentContextMenuNodeRef) Original function to get context menu node.
 * @param {function} getUndoStack - Function from stateManager to get the undo stack (for context menu save logic).
 * @returns {object} An object containing references to key Konva objects and manager functions
 *                   (e.g., stage, layer, tr, getHmiLayoutAsJson, clearCanvas).
 */
export function initKonvaManager(
    containerElementId,
    contextMenuElementId,
    getIsSimulationModeFunc,
    hideContextMenuFunc, // dari uiManager
    populateContextMenuFunc, // dari uiManager
    selectNodesFunc, // dari uiManager
    setContextMenuNode, // fungsi untuk set currentContextMenuNode di uiManager
    getContextMenuNode, // fungsi untuk get currentContextMenuNode dari uiManager
    getUndoStack, // dari stateManager
) {
    containerEl = document.getElementById(containerElementId);
    contextMenuEl = document.getElementById(contextMenuElementId);
    isSimulationModeFunc = getIsSimulationModeFunc;
    uiHideContextMenuFunc = hideContextMenuFunc;
    uiPopulateContextMenuFunc = populateContextMenuFunc;
    uiSelectNodesFunc = selectNodesFunc;
    currentContextMenuNodeRef = { node: null }; // Inisialisasi sebagai objek

    // Fungsi untuk mengupdate node di uiManager (jika diperlukan)
    // Atau kita bisa langsung memanipulasi currentContextMenuNodeRef.node
    // dan uiManager akan mengambilnya dari getContextMenuNodeWrapper
    // Ini akan disederhanakan saat uiManager dibuat.
    // Untuk sekarang, kita asumsikan app.js akan menyediakan fungsi ini jika diperlukan,
    // atau kita bisa langsung set currentContextMenuNodeRef.node.
    // Kita akan coba set langsung dulu.

    getUndoStackFunc = getUndoStack;

    stage = new Konva.Stage({
        container: containerElementId,
        width: containerEl.clientWidth,
        height: containerEl.clientHeight,
    });

    gridLayer = new Konva.Layer();
    layer = new Konva.Layer();
    guideLayer = new Konva.Layer();
    stage.add(gridLayer, layer, guideLayer);
    drawGrid();

    tr = new Konva.Transformer({
        keepRatio: true, // Default, akan diubah oleh selectNodes jika perlu
        ignoreStroke: true,
    });
    layer.add(tr);

    // --- FOR TESTING PURPOSES ONLY ---
    _konvaObjectsForTesting.stage = stage;
    _konvaObjectsForTesting.layer = layer;
    _konvaObjectsForTesting.gridLayer = gridLayer;
    _konvaObjectsForTesting.guideLayer = guideLayer;
    _konvaObjectsForTesting.tr = tr;
    // --- END FOR TESTING PURPOSES ONLY ---

    new ResizeObserver(() => {
        if (stage && containerEl) {
            stage.width(containerEl.clientWidth);
            stage.height(containerEl.clientHeight);
            drawGrid();
        }
    }).observe(containerEl);

    setupEventListeners();

    // Ekspor referensi yang mungkin dibutuhkan oleh modul lain (seperti componentFactory)
    return {
        stage,
        layer,
        tr,
        guideLayer,
        getDragStartPositions,
        setDragStartPositions,
        clearDragStartPositions,
        handleDragMove,
        getHmiLayoutAsJson, // Ditambahkan dari langkah sebelumnya
        clearCanvas, // Ditambahkan sekarang
    };
}

/**
 * Draws the background grid on the `gridLayer`.
 * The grid can be solid or dotted. The grid color and line width are fixed.
 * This function is called during initialization and on stage resize.
 * @param {boolean} [dotted=false] - If true, draws a dotted grid; otherwise, a solid grid.
 * @private
 */
function drawGrid(dotted = false) {
    if (!gridLayer || !stage) return; // Guard clause if called before full initialization
    gridLayer.destroyChildren();
    const width = stage.width();
    const height = stage.height();

    for (let i = 0; i < width / GRID_SIZE; i++) {
        gridLayer.add(
            new Konva.Line({
                points: [
                    Math.round(i * GRID_SIZE) + 0.5,
                    0,
                    Math.round(i * GRID_SIZE) + 0.5,
                    height,
                ],
                stroke: "rgba(255, 255, 255, 0.1)",
                strokeWidth: 1,
                dash: dotted ? [1, 19] : [],
            }),
        );
    }

    for (let i = 0; i < height / GRID_SIZE; i++) {
        gridLayer.add(
            new Konva.Line({
                points: [
                    0,
                    Math.round(i * GRID_SIZE) + 0.5,
                    width,
                    Math.round(i * GRID_SIZE) + 0.5,
                ],
                stroke: "rgba(255, 255, 255, 0.1)",
                strokeWidth: 1,
                dash: dotted ? [1, 19] : [],
            }),
        );
    }
}

/**
 * Gets the stored starting positions of nodes during a drag operation.
 * @returns {object|null} The drag start positions object, or null if not dragging.
 */
function getDragStartPositions() {
    return dragStartPositions;
}

/**
 * Sets the starting positions of nodes for a drag operation.
 * @param {object} positions - An object containing pointer position and node positions.
 */
function setDragStartPositions(positions) {
    dragStartPositions = positions;
}

/**
 * Clears the stored drag start positions, typically called on dragend.
 */
function clearDragStartPositions() {
    dragStartPositions = null;
}

/**
 * Calculates potential snapping line positions from existing HMI components and stage boundaries/center.
 * These are used to draw visual guidelines and assist in snapping.
 * @param {Konva.Node} skipShape - The shape currently being dragged, to be excluded from guide calculation.
 * @returns {{vertical: Array<number>, horizontal: Array<number>}} Object containing arrays of vertical and horizontal guide stop coordinates.
 * @private
 */
function getLineGuideStops(skipShape) {
    if (!stage) return { vertical: [], horizontal: [] };
    const vertical = [0, stage.width() / 2, stage.width()];
    const horizontal = [0, stage.height() / 2, stage.height()];
    stage.find(".hmi-component").forEach((guideItem) => {
        if (guideItem === skipShape) return;
        const box = guideItem.getClientRect();
        vertical.push(box.x, box.x + box.width, box.x + box.width / 2);
        horizontal.push(box.y, box.y + box.height, box.y + box.height / 2);
    });
    return {
        vertical: vertical.flat(),
        horizontal: horizontal.flat(),
    };
}

/**
 * Determines the snapping edges (start, center, end for both vertical and horizontal) of a given Konva node.
 * These edges are used to check for alignment with `getLineGuideStops`.
 * @param {Konva.Node} node - The Konva node for which to calculate snapping edges.
 * @returns {{vertical: Array<object>, horizontal: Array<object>}}
 *          An object containing arrays of vertical and horizontal edge definitions.
 *          Each edge object has `guide` (coordinate), `offset`, and `snap` ('start', 'center', 'end') properties.
 * @private
 */
function getObjectSnappingEdges(node) {
    if (!node) return { vertical: [], horizontal: [] };
    const box = node.getClientRect(); // Requires node to be on a layer to have a clientRect
    const absPos = node.absolutePosition();
    // If node is not on a layer, absPos might be {x:0, y:0} and box might be all zeros.
    // This can happen if a component is created but not yet added, though typically this function
    // is called during drag of an already added component.
    if (!absPos) return { vertical: [], horizontal: []}; // Should not happen for a node being dragged
    return {
        vertical: [
            {
                guide: Math.round(box.x),
                offset: Math.round(absPos.x - box.x),
                snap: "start",
            },
            {
                guide: Math.round(box.x + box.width / 2),
                offset: Math.round(absPos.x - box.x - box.width / 2),
                snap: "center",
            },
            {
                guide: Math.round(box.x + box.width),
                offset: Math.round(absPos.x - box.x - box.width),
                snap: "end",
            },
        ],
        horizontal: [
            {
                guide: Math.round(box.y),
                offset: Math.round(absPos.y - box.y),
                snap: "start",
            },
            {
                guide: Math.round(box.y + box.height / 2),
                offset: Math.round(absPos.y - box.y - box.height / 2),
                snap: "center",
            },
            {
                guide: Math.round(box.y + box.height),
                offset: Math.round(absPos.y - box.y - box.height),
                snap: "end",
            },
        ],
    };
}

/**
 * Draws visual guideline (red dashed lines) on the `guideLayer`.
 * @param {Array<object>} guides - An array of guide objects, each with a `points` property (e.g., `[x1, y1, x2, y2]`).
 * @private
 */
function drawGuides(guides) {
    if (!guideLayer) return;
    guides.forEach((lg) => {
        guideLayer.add(
            new Konva.Line({
                points: lg.points,
                stroke: "rgb(255,0,0)",
                strokeWidth: 1,
                name: "guide-line",
                dash: [4, 6],
            }),
        );
    });
}

/**
 * Handles the drag move event for HMI components.
 * Implements snapping to grid and to other components' edges/centers.
 * Draws visual guidelines during dragging.
 * If Alt key is pressed, constrains movement to horizontal or vertical axis.
 * If Shift key is NOT pressed, snaps to the main grid.
 * Updates positions of all selected nodes in the transformer.
 *
 * @export
 * @param {Konva.KonvaEventObject<DragEvent>} e - The Konva dragmove event object.
 */
export function handleDragMove(e) {
    if (!dragStartPositions || !stage || !guideLayer || !tr) { // Add guard clauses for critical refs
        return;
    }

    const activeNode = e.target;
    // Ensure dragStartPositions and its nested properties are valid
    if (!dragStartPositions.nodes || !dragStartPositions.nodes[activeNode.id()] || !dragStartPositions.pointer) {
        console.warn("[KonvaManager] Missing drag start data for node:", activeNode.id());
        return;
    }
    const initialNodePos = dragStartPositions.nodes[activeNode.id()];
    const initialPointerPos = dragStartPositions.pointer;

    const currentPointerPos = stage.getPointerPosition();
    if (!currentPointerPos) { // Stage might not be fully ready or pointer is outside
        console.warn("[KonvaManager] Could not get current pointer position from stage.");
        return;
    }

    let pointerDisplacement = {
        x: currentPointerPos.x - initialPointerPos.x,
        y: currentPointerPos.y - initialPointerPos.y,
    };

    if (e.evt.altKey) {
        const absX = Math.abs(pointerDisplacement.x);
        const absY = Math.abs(pointerDisplacement.y);
        if (absX > absY) {
            pointerDisplacement.y = 0;
        } else {
            pointerDisplacement.x = 0;
        }
    }

    const idealPos = {
        x: initialNodePos.x + pointerDisplacement.x,
        y: initialNodePos.y + pointerDisplacement.y,
    };

    activeNode.position(idealPos);
    guideLayer.destroyChildren();
    const lineGuideStops = getLineGuideStops(activeNode);
    const itemBounds = getObjectSnappingEdges(activeNode);
    const GUIDELINE_OFFSET = 5;
    let guides = [];

    itemBounds.vertical.forEach((guideLine) => {
        lineGuideStops.vertical.forEach((stop) => {
            const diff = Math.abs(guideLine.guide - stop);
            if (diff < GUIDELINE_OFFSET) {
                activeNode.x(
                    Math.round(activeNode.x() - guideLine.guide + stop),
                );
                guides.push({ points: [stop, 0, stop, stage.height()] });
            }
        });
    });
    itemBounds.horizontal.forEach((guideLine) => {
        lineGuideStops.horizontal.forEach((stop) => {
            const diff = Math.abs(guideLine.guide - stop);
            if (diff < GUIDELINE_OFFSET) {
                activeNode.y(
                    Math.round(activeNode.y() - guideLine.guide + stop),
                );
                guides.push({ points: [0, stop, stage.width(), stop] });
            }
        });
    });
    drawGuides(guides);

    if (!e.evt.shiftKey) {
        activeNode.position({
            x: Math.round(activeNode.x() / GRID_SIZE) * GRID_SIZE,
            y: Math.round(activeNode.y() / GRID_SIZE) * GRID_SIZE,
        });
    }

    const finalDisplacement = {
        x: activeNode.x() - initialNodePos.x,
        y: activeNode.y() - initialNodePos.y,
    };

    tr.nodes().forEach((node) => {
        const initialPos = dragStartPositions.nodes[node.id()];
        if (initialPos) {
            node.position({
                x: initialPos.x + finalDisplacement.x,
                y: initialPos.y + finalDisplacement.y,
            });
        }
    });
}

/**
 * Sets up global and Konva stage event listeners.
 * Handles:
 * - Shift key for dotted grid.
 * - Stage click/tap for deselecting components or hiding context menu.
 * - Stage mousedown, mousemove, mouseup for marquee selection.
 * - Stage contextmenu for showing custom context menu.
 * @private
 */
function setupEventListeners() {
    // Listener for Shift key to toggle dotted grid
    window.addEventListener("keydown", (e) => {
        if (e.key !== "Shift" || (isSimulationModeFunc && isSimulationModeFunc())) return;
        const activeEl = document.activeElement;
        if (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA")
            return;
        drawGrid(true); // Draw dotted grid
    });

    window.addEventListener("keyup", (e) => {
        if (e.key === "Shift") {
            drawGrid(false); // Draw solid grid
        }
    });

    stage.on("click tap", (e) => {
        if (e.evt.button === 2) return; // Abaikan klik kanan
        if (typeof uiHideContextMenuFunc === "function")
            uiHideContextMenuFunc();

        if (e.evt.shiftKey) return;
        if (e.target === stage) {
            if (typeof uiSelectNodesFunc === "function") uiSelectNodesFunc([]);
            return;
        }
        if (e.target.getParent().className === "Transformer") return;
        // Seleksi individual node sudah dihandle di dalam createComponent di componentFactory
    });

    stage.on("mousedown", (e) => {
        if (e.target !== stage || isSimulationModeFunc()) return;
        e.evt.preventDefault();
        const pos = stage.getPointerPosition();
        x1 = pos.x;
        y1 = pos.y;
        selectionRectangle = new Konva.Rect({
            fill: "rgba(0,161,255,0.3)",
            visible: false,
        });
        layer.add(selectionRectangle);
    });

    stage.on("mousemove", (e) => {
        if (!selectionRectangle) return;
        e.evt.preventDefault();
        const pos = stage.getPointerPosition();
        selectionRectangle.visible(true);
        selectionRectangle.width(pos.x - x1);
        selectionRectangle.height(pos.y - y1);
        selectionRectangle.x(x1);
        selectionRectangle.y(y1);
    });

    stage.on("mouseup", (e) => {
        if (!selectionRectangle) return;
        e.evt.preventDefault();
        selectionRectangle.visible(false);
        const shapes = stage.find(".hmi-component");
        const box = selectionRectangle.getClientRect();
        const selected = shapes.filter((shape) =>
            Konva.Util.haveIntersection(box, shape.getClientRect()),
        );
        if (typeof uiSelectNodesFunc === "function")
            uiSelectNodesFunc(selected);
        selectionRectangle.destroy();
        selectionRectangle = null;
    });

    stage.on("contextmenu", (e) => {
        e.evt.preventDefault();
        const node = e.target.getParent();
        // Hanya tampilkan context menu jika satu node HMI dipilih dan bukan mode simulasi
        if (
            tr.nodes().length === 1 &&
            node &&
            node.hasName("hmi-component") &&
            !isSimulationModeFunc()
        ) {
            currentContextMenuNodeRef.node = node; // Set node di sini
            if (typeof uiPopulateContextMenuFunc === "function")
                uiPopulateContextMenuFunc(node);

            const containerRect = stage.container().getBoundingClientRect();
            if (contextMenuEl) {
                contextMenuEl.style.display = "block";
                contextMenuEl.style.top =
                    e.evt.clientY - containerRect.top + "px";
                contextMenuEl.style.left =
                    e.evt.clientX - containerRect.left + "px";
            }
        } else {
            if (typeof uiHideContextMenuFunc === "function")
                uiHideContextMenuFunc();
        }
    });
}

// Fungsi ini akan dipanggil oleh uiManager ketika context menu ditutup
export function handleContextMenuCloseForSaveState() {
    if (currentContextMenuNodeRef.node) {
        const undoStackContent = getUndoStackFunc ? getUndoStackFunc() : [];
        const originalState =
            undoStackContent.length > 0
                ? undoStackContent[undoStackContent.length - 1]
                : "{}";
        const currentState = getCurrentState(); // Dari stateManager
        if (originalState !== currentState) {
            saveState(); // Dari stateManager
        }
    }
    currentContextMenuNodeRef.node = null; // Reset after closing
}

/**
 * Gets the main Konva layer where HMI components are added.
 * @export
 * @returns {Konva.Layer|undefined} The main Konva layer, or undefined if not initialized.
 */
export function getLayer() {
    return layer;
}

/**
 * Gets the Konva Transformer used for HMI components.
 * @export
 * @returns {Konva.Transformer|undefined} The Konva Transformer, or undefined if not initialized.
 */
export function getTransformer() {
    return tr;
}

/**
 * Gets the Konva layer used for drawing guidelines.
 * @export
 * @returns {Konva.Layer|undefined} The guide layer, or undefined if not initialized.
 */
export function getGuideLayer() {
    return guideLayer;
}

/**
 * Gets the main Konva Stage.
 * @export
 * @returns {Konva.Stage|undefined} The Konva Stage, or undefined if not initialized.
 */
export function getStage() {
    return stage;
}

/**
 * Serializes the current HMI layout (all components on the main layer) into a JSON-compatible array.
 * Each component's data includes its id, x, y, componentType, and other relevant attributes.
 * @export
 * @returns {Array<object>} An array of HMI component data objects. Returns an empty array if the layer is not initialized.
 */
export function getHmiLayoutAsJson() {
    if (!layer) {
        console.error("Layer Konva belum diinisialisasi di konvaManager.");
        return [];
    }

    const components = [];
    // Temukan semua node yang merupakan komponen HMI.
    // Asumsi semua komponen HMI memiliki nama 'hmi-component'.
    const hmiNodes = layer.find(".hmi-component");

    hmiNodes.forEach((node) => {
        // Buat salinan dari attrs untuk menghindari modifikasi objek asli secara tidak sengaja
        // dan untuk memastikan kita hanya menyimpan data yang relevan.
        const nodeAttrs = { ...node.attrs };

        // Atribut dasar yang selalu ada
        const componentData = {
            id: node.id(),
            x: node.x(),
            y: node.y(),
            componentType: nodeAttrs.componentType, // Pastikan ini selalu ada
        };

        // Hapus atribut yang tidak perlu atau yang sudah diekstrak secara eksplisit
        delete nodeAttrs.draggable; // Diatur oleh mode/seleksi
        delete nodeAttrs.name; // 'hmi-component' hanya untuk seleksi

        // Gabungkan sisa atribut yang relevan
        // Ini akan mencakup hal-hal seperti label, deviceId, variableName, warna, teks, dll.
        // yang disimpan di attrs oleh componentFactory atau diubah via context menu.
        for (const key in nodeAttrs) {
            // Hindari menyalin atribut internal Konva atau yang sangat besar jika ada
            // Untuk saat ini, kita salin semua yang ada di attrs selain yang sudah dihapus.
            // Jika ada masalah dengan ukuran atau data yang tidak relevan, filter lebih lanjut bisa ditambahkan di sini.
            if (
                Object.hasOwnProperty.call(nodeAttrs, key) &&
                componentData[key] === undefined
            ) {
                componentData[key] = nodeAttrs[key];
            }
        }

        if (!componentData.componentType) {
            console.warn(
                `Node ${node.id()} tidak memiliki componentType di attrs. Komponen ini mungkin tidak bisa dimuat ulang dengan benar.`,
            );
            // Pertimbangkan untuk tidak memasukkan komponen ini jika componentType tidak ada
            // return; // Melewatkan node ini
        }

        components.push(componentData);
    });

    return components;
}

/**
 * Clears all HMI components from the main Konva layer and resets the transformer.
 * This is used when creating a new project or loading a project.
 * @export
 */
export function clearCanvas() {
    if (!layer || !tr) {
        console.error("Layer atau Transformer Konva belum diinisialisasi untuk clearCanvas.");
        return;
    }
    // Hapus semua node yang merupakan hmi-component
    layer.find(".hmi-component").forEach((node) => {
        node.destroy();
    });
    // Kosongkan transformer
    tr.nodes([]);
    // Gambar ulang layer untuk mencerminkan perubahan
    layer.batchDraw();
    console.log("Canvas HMI telah dibersihkan.");
}
