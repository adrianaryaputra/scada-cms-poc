import { GRID_SIZE } from './config.js'; // Jika GRID_SIZE digunakan oleh komponen
import {
    saveState,
    updateTagDatabase,
    getComponentAddressValue,
    setComponentAddressValue
} from './stateManager.js';

// Variabel yang mungkin dibutuhkan oleh componentFactory,
// seperti layer, tr, isSimulationMode, dll., akan diteruskan saat inisialisasi atau sebagai argumen.
let layerRef;
let trRef;
let guideLayerRef;
let isSimulationModeRef; // Ini adalah boolean, jadi bisa langsung di-pass nilainya
let stageRef; // Untuk getPointerPosition
let dragStartPositionsRef; // Untuk drag multi-select
let setDragStartPositionsRef;
let clearDragStartPositionsRef;
let selectNodesFuncRef; // Referensi ke fungsi selectNodes di uiManager
let handleDragMoveFuncRef; // Referensi ke fungsi handleDragMove di konvaManager

export function initComponentFactory(layer, tr, guideLayer, getIsSimulationMode, getStage, getDragStartPositions, setDragStartPositions, clearDragStartPositions, selectNodesFunc, handleDragMoveFunc) {
    layerRef = layer;
    trRef = tr;
    guideLayerRef = guideLayer;
    isSimulationModeRef = getIsSimulationMode; // Ini adalah fungsi untuk mendapatkan nilai boolean terkini
    stageRef = getStage; // Ini adalah fungsi untuk mendapatkan stage terkini
    dragStartPositionsRef = getDragStartPositions;
    setDragStartPositionsRef = setDragStartPositions;
    clearDragStartPositionsRef = clearDragStartPositions;
    selectNodesFuncRef = selectNodesFunc;
    handleDragMoveFuncRef = handleDragMoveFunc;

}

export const componentFactory = {
    create(type, props = {}) {
        const uniqueId = props.id || "hmi-id-" + crypto.randomUUID();
        const defaults = {
            x: 100,
            y: 100,
            address: `${type.substring(0, 3).toUpperCase()}_${uniqueId.substring(7, 11)}`,
        };
        const config = { ...defaults, ...props };
        updateTagDatabase(config.address, config.state || config.value || 0);
        return this.creator(type, uniqueId, config);
    },

    creator(type, id, config) {
        let group;
        switch (type) {
            case "bit-lamp":
                group = this.createBitLamp(id, config);
                break;
            case "bit-switch":
                group = this.createBitSwitch(id, config);
                break;
            case "word-lamp":
                group = this.createWordLamp(id, config);
                break;
            case "numeric-display":
                group = this.createNumericDisplay(id, config);
                break;
            case "label":
                group = this.createLabel(id, config);
                break;
            default:
                throw new Error(`Unknown component type: ${type}`);
        }
        if (group) {
            group.on("dragstart", (e) => {
                if (guideLayerRef) guideLayerRef.show();

                const currentDragStartPositions = {
                    pointer: stageRef().getPointerPosition(),
                    nodes: {},
                };
                trRef.nodes().forEach((node) => {
                    currentDragStartPositions.nodes[node.id()] = { x: node.x(), y: node.y() };
                });
                setDragStartPositionsRef(currentDragStartPositions);

            });
            group.on("dragend", () => {
                saveState(); // Dari stateManager
                if (guideLayerRef) guideLayerRef.hide();
                clearDragStartPositionsRef();
            });
            group.on("dragmove", (e) => {
                 if (handleDragMoveFuncRef) handleDragMoveFuncRef(e);
            });
        }
        return group;
    },

    createBitLamp(id, config) {
        const group = new Konva.Group({
            id: id,
            x: config.x,
            y: config.y,
            draggable: false, // Akan diatur oleh selectNodes
            name: "hmi-component",
        });
        group.setAttrs({
            componentType: "bit-lamp",
            label: "Indikator",
            shapeType: "circle",
            offColor: "#555555",
            onColor: "#22c55e",
            ...config,
        });
        const lampShape = new Konva.Circle({
            radius: 20,
            name: "lamp-shape",
        });
        group.add(lampShape);
        group.on("click", (e) => {
            if (e.evt.button === 2) return; // Abaikan klik kanan
            if (isSimulationModeRef()) return;
            const isSelected = trRef.nodes().indexOf(group) >= 0;
            if (!e.evt.shiftKey) {
                if (selectNodesFuncRef) selectNodesFuncRef(isSelected ? [] : [group]);
            } else {
                if (isSelected) {
                    const nodes = trRef.nodes().slice();
                    nodes.splice(nodes.indexOf(group), 1);
                    if (selectNodesFuncRef) selectNodesFuncRef(nodes);
                } else {
                    const nodes = trRef.nodes().concat([group]);
                    if (selectNodesFuncRef) selectNodesFuncRef(nodes);
                }
            }
        });

        group.updateState = function () {
            const state = getComponentAddressValue(this.attrs.address) || 0;
            const existingShape = this.findOne(".lamp-shape");
            let currentShapeType = existingShape instanceof Konva.Circle ? "circle" : "rect";
            if (this.attrs.shapeType !== currentShapeType) {
                existingShape.destroy();
                let newShape;
                if (this.attrs.shapeType === "circle") {
                    newShape = new Konva.Circle({ radius: 20 });
                } else {
                    newShape = new Konva.Rect({ width: 40, height: 40, offsetX: 20, offsetY: 20 });
                }
                newShape.name("lamp-shape");
                this.add(newShape);
                newShape.moveToBottom(); // Pastikan bentuk baru ada di belakang teks jika ada
            }
            this.findOne(".lamp-shape").fill(state === 1 ? this.attrs.onColor : this.attrs.offColor);
        };
        group.updateState();
        return group;
    },

    createBitSwitch(id, config) {
        const group = new Konva.Group({
            id: id,
            x: config.x,
            y: config.y,
            draggable: false,
            name: "hmi-component",
        });
        group.setAttrs({
            componentType: "bit-switch",
            label: "Saklar",
            offColor: "#d9534f",
            onColor: "#5cb85c",
            offText: "OFF",
            onText: "ON",
            ...config,
        });
        const background = new Konva.Rect({
            width: 80,
            height: 40,
            cornerRadius: 5,
            name: "background",
        });
        group.add(background);
        const text = new Konva.Text({
            width: 80,
            height: 40,
            align: "center",
            verticalAlign: "middle",
            fontSize: 16,
            fill: "white",
            fontStyle: "bold",
            name: "state-text",
        });
        group.add(text);
        group.on("click", (e) => {
            if (e.evt.button === 2) return; // Abaikan klik kanan
            if (isSimulationModeRef()) { // Hanya toggle state jika mode simulasi
                 const currentVal = getComponentAddressValue(group.attrs.address) || 0;
                 setComponentAddressValue(group.attrs.address, currentVal === 1 ? 0 : 1);
                 group.updateState(); // Langsung update tampilan setelah state diubah
                 return; // Jangan proses seleksi jika mode simulasi
            }
            // Logika seleksi untuk mode desain
            const isSelected = trRef.nodes().indexOf(group) >= 0;
            if (!e.evt.shiftKey) {
                if (selectNodesFuncRef) selectNodesFuncRef(isSelected ? [] : [group]);
            } else {
                if (isSelected) {
                    const nodes = trRef.nodes().slice();
                    nodes.splice(nodes.indexOf(group), 1);
                    if (selectNodesFuncRef) selectNodesFuncRef(nodes);
                } else {
                    const nodes = trRef.nodes().concat([group]);
                    if (selectNodesFuncRef) selectNodesFuncRef(nodes);
                }
            }
        });
        group.updateState = function () {
            const state = getComponentAddressValue(this.attrs.address) || 0;
            this.findOne(".background").fill(state === 1 ? this.attrs.onColor : this.attrs.offColor);
            this.findOne(".state-text").text(state === 1 ? this.attrs.onText : this.attrs.offText);
        };
        group.updateState();
        return group;
    },

    createWordLamp(id, config) {
        const group = new Konva.Group({
            id: id,
            x: config.x,
            y: config.y,
            draggable: false,
            name: "hmi-component",
        });
        group.setAttrs({
            componentType: "word-lamp",
            label: "Status Lamp",
            states: [
                { value: 0, text: "STOPPED", color: "#d9534f" },
                { value: 1, text: "RUNNING", color: "#5cb85c" },
            ],
            ...config,
        });
        const background = new Konva.Rect({
            width: 120,
            height: 40,
            fill: "#333",
            stroke: "#555",
            strokeWidth: 2,
            cornerRadius: 5,
            name: "background",
        });
        group.add(background);
        group.on("click", (e) => {
            if (e.evt.button === 2) return; // Abaikan klik kanan
            if (isSimulationModeRef()) return;
            const isSelected = trRef.nodes().indexOf(group) >= 0;
            if (!e.evt.shiftKey) {
                 if (selectNodesFuncRef) selectNodesFuncRef(isSelected ? [] : [group]);
            } else {
                if (isSelected) {
                    const nodes = trRef.nodes().slice();
                    nodes.splice(nodes.indexOf(group), 1);
                    if (selectNodesFuncRef) selectNodesFuncRef(nodes);
                } else {
                    const nodes = trRef.nodes().concat([group]);
                    if (selectNodesFuncRef) selectNodesFuncRef(nodes);
                }
            }
        });
        const text = new Konva.Text({
            width: 120,
            height: 40,
            align: "center",
            verticalAlign: "middle",
            fontSize: 16,
            fill: "white",
            fontStyle: "bold",
            name: "state-text",
        });
        group.add(text);
        group.updateState = function () {
            const value = getComponentAddressValue(this.attrs.address) || 0;
            const stateConfig = this.attrs.states.find((s) => s.value == value) || { text: "INVALID", color: "#f0ad4e" };
            this.findOne(".background").fill(stateConfig.color);
            this.findOne(".state-text").text(stateConfig.text);
        };
        group.updateState();
        return group;
    },

    createNumericDisplay(id, config) {
        const group = new Konva.Group({
            id: id,
            x: config.x,
            y: config.y,
            draggable: false,
            name: "hmi-component",
        });
        group.setAttrs({
            componentType: "numeric-display",
            label: "Suhu",
            units: "°C",
            decimalPlaces: 2,
            ...config,
        });
        const background = new Konva.Rect({
            width: 120,
            height: 50,
            fill: "#111",
            stroke: "#555",
            strokeWidth: 2,
            cornerRadius: 5,
        });
        group.add(background);
        group.on("click", (e) => {
            if (e.evt.button === 2) return; // Abaikan klik kanan
            if (isSimulationModeRef()) return;
            const isSelected = trRef.nodes().indexOf(group) >= 0;
            if (!e.evt.shiftKey) {
                if (selectNodesFuncRef) selectNodesFuncRef(isSelected ? [] : [group]);
            } else {
                if (isSelected) {
                    const nodes = trRef.nodes().slice();
                    nodes.splice(nodes.indexOf(group), 1);
                    if (selectNodesFuncRef) selectNodesFuncRef(nodes);
                } else {
                    const nodes = trRef.nodes().concat([group]);
                    if (selectNodesFuncRef) selectNodesFuncRef(nodes);
                }
            }
        });
        const valueText = new Konva.Text({
            y: 25,
            width: 120,
            align: "center",
            fontSize: 24,
            fill: "#22d3ee",
            fontStyle: "bold",
            name: "value-text",
        });
        group.add(valueText);
        const labelText = new Konva.Text({
            y: 5,
            width: 120,
            align: "center",
            fontSize: 12,
            fill: "#9ca3af",
            name: "label-text",
        });
        group.add(labelText);
        group.updateState = function () {
            const value = getComponentAddressValue(this.attrs.address) || 0;
            const val = parseFloat(value).toFixed(this.attrs.decimalPlaces);
            this.findOne(".value-text").text(val);
            this.findOne(".label-text").text(this.attrs.label + ` (${this.attrs.units})`);
        };
        group.updateState();
        return group;
    },

    createLabel(id, config) {
        const group = new Konva.Group({
            id: id,
            x: config.x,
            y: config.y,
            draggable: false,
            name: "hmi-component",
        });
        group.setAttrs({
            componentType: "label",
            text: "Label Teks",
            fontSize: 14,
            fill: "white",
            width: 100, // default width
            align: "center",
            ...config,
        });
        const labelText = new Konva.Text({
            text: group.attrs.text,
            fontSize: group.attrs.fontSize,
            fill: group.attrs.fill,
            width: group.attrs.width,
            align: group.attrs.align,
            name: "label-text",
        });
        group.add(labelText);
        group.on("transformend", function () {
            const textNode = this.findOne(".label-text");
            const newWidth = this.width() * this.scaleX();
            textNode.width(newWidth);
            this.setAttr("width", newWidth); // Simpan lebar baru
            this.scaleX(1); // Reset skala agar font tidak terdistorsi
            this.scaleY(1);
            saveState(); // Simpan state setelah transformasi
        });

        group.on("click", (e) => {
            if (e.evt.button === 2) return; // Abaikan klik kanan
            if (isSimulationModeRef()) return;
            const isSelected = trRef.nodes().indexOf(group) >= 0;
            if (!e.evt.shiftKey) {
                if (selectNodesFuncRef) selectNodesFuncRef(isSelected ? [] : [group]);
            } else {
                if (isSelected) {
                    const nodes = trRef.nodes().slice();
                    nodes.splice(nodes.indexOf(group), 1);
                    if (selectNodesFuncRef) selectNodesFuncRef(nodes);
                } else {
                    const nodes = trRef.nodes().concat([group]);
                    if (selectNodesFuncRef) selectNodesFuncRef(nodes);
                }
            }
        });
        group.updateState = function () {
            this.findOne(".label-text").text(this.attrs.text);
            this.findOne(".label-text").fontSize(this.attrs.fontSize);
            this.findOne(".label-text").fill(this.attrs.fill);
            this.findOne(".label-text").width(this.attrs.width);
            this.findOne(".label-text").align(this.attrs.align);
        };
        group.updateState();
        return group;
    },
};
