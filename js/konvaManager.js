import { GRID_SIZE } from "./config.js";
import { saveState, getCurrentState } from "./stateManager.js"; // Untuk context menu save

// Variabel-variabel ini akan dikelola dalam modul ini
let stage, layer, tr, guideLayer, gridLayer;
let selectionRectangle;
let x1, y1;
let dragStartPositions = null; // Dikelola di sini

// Referensi ke fungsi/variabel dari modul lain atau elemen UI
let uiHideContextMenuFunc;
let uiPopulateContextMenuFunc;
let uiSelectNodesFunc; // Fungsi selectNodes dari uiManager akan di-pass ke sini
let isSimulationModeFunc; // Fungsi untuk mendapatkan status mode simulasi
let currentContextMenuNodeRef; // Objek untuk menyimpan node context menu saat ini
let getUndoStackFunc; // Untuk akses undoStack di hideContextMenu

// Elemen DOM yang dibutuhkan
let containerEl;
let contextMenuEl;

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

function drawGrid(dotted = false) {
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

function getDragStartPositions() {
    return dragStartPositions;
}

function setDragStartPositions(positions) {
    dragStartPositions = positions;
}
function clearDragStartPositions() {
    dragStartPositions = null;
}

function getLineGuideStops(skipShape) {
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

function getObjectSnappingEdges(node) {
    const box = node.getClientRect();
    const absPos = node.absolutePosition();
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

function drawGuides(guides) {
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

export function handleDragMove(e) {
    // Dijadikan export agar bisa di-pass ke componentFactory
    if (!dragStartPositions) {
        return;
    }

    const activeNode = e.target;
    const initialNodePos = dragStartPositions.nodes[activeNode.id()];
    const initialPointerPos = dragStartPositions.pointer;
    const currentPointerPos = stage.getPointerPosition();

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

function setupEventListeners() {
    window.addEventListener("keydown", (e) => {
        if (e.key !== "Shift" || isSimulationModeFunc()) return;
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
    currentContextMenuNodeRef.node = null; // Reset setelah ditutup
}

// Getter untuk layer dan tr jika dibutuhkan oleh app.js atau modul lain
export function getLayer() {
    return layer;
}
export function getTransformer() {
    return tr;
}
export function getGuideLayer() {
    return guideLayer;
}
export function getStage() {
    return stage;
}

// Fungsi untuk mendapatkan konfigurasi HMI sebagai JSON
export function getHmiLayoutAsJson() {
    if (!layer) {
        // Menggunakan 'layer' yang sudah didefinisikan di scope modul
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

// Fungsi untuk membersihkan semua komponen HMI dari canvas
export function clearCanvas() {
    if (!layer || !tr) {
        console.error("Layer atau Transformer Konva belum diinisialisasi.");
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
