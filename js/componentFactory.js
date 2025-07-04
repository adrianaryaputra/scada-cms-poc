/**
 * @file Factory module for creating HMI (Human-Machine Interface) components using Konva.js.
 * It handles the instantiation, default properties, and basic event handling for various components.
 */

import { GRID_SIZE } from "./config.js"; // GRID_SIZE is not directly used in this file, but kept for potential future use with snapping logic.
import {
    saveState,
    // updateTagDatabase, // To be replaced or re-evaluated
    getDeviceVariableValue, // New state accessor
    // setComponentAddressValue // To be replaced by device/variable specific logic if components write directly
    // For now, components will call deviceManager.writeDataToServer which uses new variable structure
} from "./stateManager.js";
import { writeDataToServer } from "./deviceManager.js"; // For components that publish data

// Helper function for standardised component selection click logic
function handleComponentSelectionClick(
    group,
    event,
    isSimulationModeFunc,
    transformer,
    selectNodesCallback,
) {
    if (event.evt.button === 2) return true; // Indicate event handled (ignore right click)

    // If in simulation mode, selection logic is typically bypassed unless specifically handled by the component type
    if (isSimulationModeFunc && isSimulationModeFunc()) {
        // Allow components to define their own click behavior in simulation mode (e.g., BitSwitch)
        // If this helper is called, it means the component itself didn't fully handle the click in sim mode.
        return false;
    }

    const isSelected = transformer.nodes().indexOf(group) >= 0;
    if (!event.evt.shiftKey) {
        if (selectNodesCallback) selectNodesCallback(isSelected ? [] : [group]);
    } else {
        if (isSelected) {
            const nodes = transformer.nodes().slice();
            nodes.splice(nodes.indexOf(group), 1);
            if (selectNodesCallback) selectNodesCallback(nodes);
        } else {
            const nodes = transformer.nodes().concat([group]);
            if (selectNodesCallback) selectNodesCallback(nodes);
        }
    }
    return true; // Indicate event handled by selection logic
}

// --- Module-level References ---
// These are initialized by `initComponentFactory` and used by component creation methods.

/** @type {Konva.Layer} Reference to the main Konva layer where components are added. */
let layerRef;
/** @type {Konva.Transformer} Reference to the Konva Transformer for selecting and resizing components. */
let trRef;
/** @type {Konva.Layer} Reference to the guide layer for visual aids during dragging/resizing. */
let guideLayerRef;
/** @type {function(): boolean} Function that returns the current simulation mode state. */
let isSimulationModeRef;
/** @type {function(): Konva.Stage} Function that returns the Konva stage instance. */
let stageRef;
/** @type {function(): Object} Function that returns the starting positions of nodes during a drag operation. */
let dragStartPositionsRef;
/** @type {function(Object): void} Function to set the starting positions of nodes for dragging. */
let setDragStartPositionsRef;
/** @type {function(): void} Function to clear the stored drag start positions. */
let clearDragStartPositionsRef;
/** @type {function(Array<Konva.Node>): void} Reference to uiManager's selectNodes function. */
let selectNodesFuncRef;
/** @type {function(Event): void} Reference to konvaManager's handleDragMove function for snapping. */
let handleDragMoveFuncRef;

/**
 * Initializes the component factory with necessary references to other modules and Konva objects.
 * This must be called before any components can be created.
 *
 * @param {Konva.Layer} layer - The main Konva layer for components.
 * @param {Konva.Transformer} tr - The Konva Transformer.
 * @param {Konva.Layer} guideLayer - The layer for drawing guides (e.g., snap lines).
 * @param {function(): boolean} getIsSimulationMode - A function that returns true if in simulation mode, false otherwise.
 * @param {function(): Konva.Stage} getStage - A function that returns the Konva stage.
 * @param {function(): Object} getDragStartPositions - Function to get initial drag positions.
 * @param {function(Object): void} setDragStartPositions - Function to set initial drag positions.
 * @param {function(): void} clearDragStartPositions - Function to clear initial drag positions.
 * @param {function(Array<Konva.Node>): void} selectNodesFunc - Callback to uiManager's function to handle node selection.
 * @param {function(Event): void} handleDragMoveFunc - Callback to konvaManager's function to handle drag movement (e.g., for snapping).
 */
export function initComponentFactory(
    layer,
    tr,
    guideLayer,
    getIsSimulationMode,
    getStage,
    getDragStartPositions,
    setDragStartPositions,
    clearDragStartPositions,
    selectNodesFunc,
    handleDragMoveFunc,
) {
    layerRef = layer;
    trRef = tr;
    guideLayerRef = guideLayer;
    isSimulationModeRef = getIsSimulationMode;
    stageRef = getStage;
    dragStartPositionsRef = getDragStartPositions;
    setDragStartPositionsRef = setDragStartPositions;
    clearDragStartPositionsRef = clearDragStartPositions;
    selectNodesFuncRef = selectNodesFunc;
    handleDragMoveFuncRef = handleDragMoveFunc;
}

/**
 * Main factory object for creating HMI components.
 * @namespace componentFactory
 */
export const componentFactory = {
    /**
     * Creates a new HMI component of a specified type with given properties.
     * If an `id` is not provided in `props`, a unique ID will be generated.
     * Default properties are applied, then overridden by `props`.
     *
     * @param {string} type - The type of component to create (e.g., "bit-lamp", "bit-switch").
     * @param {object} [props={}] - Optional properties to override defaults for the new component.
     *                              These can include `id`, `x`, `y`, `deviceId`, `variableName`, `label`,
     *                              and other component-specific attributes.
     * @returns {Konva.Group | null} The created Konva.Group representing the component, or null if creation fails.
     */
    create(type, props = {}) {
        const uniqueId = props.id || "hmi-id-" + crypto.randomUUID();
        const defaults = {
            x: 100,
            y: 100,
            // address: `${type.substring(0, 3).toUpperCase()}_${uniqueId.substring(7, 11)}`, // Old way
            deviceId: null, // New: ID of the linked device
            variableName: null, // New: Name of the linked device variable
            label: type, // Default label based on type
        };
        const config = { ...defaults, ...props };

        // Initial value for a variable would be set by server push, not typically here.
        // updateTagDatabase(config.address, config.state || config.value || 0); // Old way
        // If a default value needs to be set in stateManager for a new component's variable,
        // it would be: setDeviceVariableValue(config.deviceId, config.variableName, initialValue);
        // But usually, components just reflect what's in the state, which is populated from the device.

        return this.creator(type, uniqueId, config);
    },

    /**
     * Internal creator method that dispatches to specific component creation functions
     * based on the `type`. It also sets up common event handlers (drag, etc.) for all components
     * and adds the component to the main layer.
     *
     * @param {string} type - The type of component to create.
     * @param {string} id - The unique ID for the component.
     * @param {object} config - The fully resolved configuration object for the component (defaults + props).
     * @returns {Konva.Group | null} The created Konva.Group or null.
     * @throws {Error} If the component type is unknown.
     * @private
     */
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
                    currentDragStartPositions.nodes[node.id()] = {
                        x: node.x(),
                        y: node.y(),
                    };
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

            // Tambahkan komponen ke layer utama
            if (layerRef) {
                layerRef.add(group);
                // console.log(`[ComponentFactory] Komponen ${group.id()} ditambahkan ke layerRef. Children di layer:`, layerRef.getChildren().length);
            } else {
                console.error(
                    "[ComponentFactory] layerRef tidak tersedia saat mencoba menambahkan komponen ke layer!",
                );
            }
        }
        return group;
    },

    /**
     * Creates a BitLamp component.
     * A BitLamp visually represents a boolean state (on/off) typically linked to a device variable.
     * It can be a circle or a rectangle, changing color based on the state.
     *
     * @param {string} id - The unique ID for this component.
     * @param {object} config - Configuration object containing properties like `x`, `y`, `deviceId`,
     *                          `variableName`, `label`, `shapeType`, `offColor`, `onColor`.
     * @returns {Konva.Group} The Konva.Group representing the BitLamp.
     */
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
            // label: "Indikator", // Default label now set in create()
            shapeType: "circle",
            offColor: "#555555",
            onColor: "#22c55e",
            ...config, // Includes deviceId, variableName, label from defaults/props
        });
        const lampShape = new Konva.Circle({
            radius: 20,
            name: "lamp-shape",
        });
        group.add(lampShape);
        group.on("click", (e) => {
            // BitLamp doesn't have special simulation mode click behavior, so directly use the helper.
            // The helper itself checks for simulation mode and right-click.
            handleComponentSelectionClick(
                group,
                e,
                isSimulationModeRef,
                trRef,
                selectNodesFuncRef,
            );
        });

        group.updateState = function () {
            const value = getDeviceVariableValue(
                this.attrs.deviceId,
                this.attrs.variableName,
            );
            const state =
                value === true ||
                value === 1 ||
                value === "1" ||
                value === "true" ||
                value === "ON"
                    ? 1
                    : 0; // Normalize to 0 or 1

            const existingShape = this.findOne(".lamp-shape");
            let currentShapeType =
                existingShape instanceof Konva.Circle ? "circle" : "rect";
            if (this.attrs.shapeType !== currentShapeType) {
                existingShape.destroy();
                let newShape;
                if (this.attrs.shapeType === "circle") {
                    newShape = new Konva.Circle({ radius: 20 });
                } else {
                    newShape = new Konva.Rect({
                        width: 40,
                        height: 40,
                        offsetX: 20,
                        offsetY: 20,
                    });
                }
                newShape.name("lamp-shape");
                this.add(newShape);
                newShape.moveToBottom(); // Pastikan bentuk baru ada di belakang teks jika ada
            }
            this.findOne(".lamp-shape").fill(
                state === 1 ? this.attrs.onColor : this.attrs.offColor,
            );
        };
        group.updateState();
        return group;
    },

    /**
     * Creates a BitSwitch component.
     * A BitSwitch allows users to toggle a boolean state (on/off) and write this state
     * back to a linked device variable during simulation mode.
     * It displays text (e.g., "ON"/"OFF") and changes color based on its state.
     *
     * @param {string} id - The unique ID for this component.
     * @param {object} config - Configuration object containing properties like `x`, `y`, `deviceId`,
     *                          `variableName`, `label`, `offColor`, `onColor`, `offText`, `onText`.
     * @returns {Konva.Group} The Konva.Group representing the BitSwitch.
     */
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
            if (e.evt.button === 2) return; // Abaikan klik kanan (sudah ada di helper, tapi aman di sini juga)

            if (isSimulationModeRef()) {
                // Logika spesifik BitSwitch untuk mode simulasi
                if (group.attrs.deviceId && group.attrs.variableName) {
                    const currentValue =
                        getDeviceVariableValue(
                            group.attrs.deviceId,
                            group.attrs.variableName,
                        ) || 0;
                    const newValue = currentValue === 1 ? 0 : 1;
                    writeDataToServer(
                        group.attrs.deviceId,
                        group.attrs.variableName,
                        newValue,
                    );
                } else {
                    console.warn(
                        "BitSwitch: deviceId or variableName not set. Cannot write data.",
                    );
                }
                // Tidak memanggil helper seleksi karena aksi sudah dilakukan.
            } else {
                // Mode Desain: Gunakan helper untuk logika seleksi
                handleComponentSelectionClick(
                    group,
                    e,
                    isSimulationModeRef,
                    trRef,
                    selectNodesFuncRef,
                );
            }
        });
        group.updateState = function () {
            const value = getDeviceVariableValue(
                this.attrs.deviceId,
                this.attrs.variableName,
            );
            const state =
                value === true ||
                value === 1 ||
                value === "1" ||
                value === "true" ||
                value === "ON"
                    ? 1
                    : 0;
            this.findOne(".background").fill(
                state === 1 ? this.attrs.onColor : this.attrs.offColor,
            );
            this.findOne(".state-text").text(
                state === 1 ? this.attrs.onText : this.attrs.offText,
            );
        };
        group.updateState();
        return group;
    },

    /**
     * Creates a WordLamp component.
     * A WordLamp displays different text and background colors based on a numeric value
     * from a linked device variable. It matches the variable's value against a list of configured states.
     *
     * @param {string} id - The unique ID for this component.
     * @param {object} config - Configuration object containing properties like `x`, `y`, `deviceId`,
     *                          `variableName`, `label`, and an array `states` where each state
     *                          has `value`, `text`, and `color`.
     * @returns {Konva.Group} The Konva.Group representing the WordLamp.
     */
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
            handleComponentSelectionClick(
                group,
                e,
                isSimulationModeRef,
                trRef,
                selectNodesFuncRef,
            );
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
            const value =
                getDeviceVariableValue(
                    this.attrs.deviceId,
                    this.attrs.variableName,
                ) || 0;
            // Normalize value for comparison, as it might come as string from some sources
            const numValue = Number(value);
            const stateConfig = this.attrs.states.find(
                (s) => s.value == numValue,
            ) ||
                this.attrs.states.find(
                    (s) =>
                        String(s.value).toLowerCase() ==
                        String(value).toLowerCase(),
                ) || { text: "INVALID", color: "#f0ad4e" }; // Fallback for string comparison
            this.findOne(".background").fill(stateConfig.color);
            this.findOne(".state-text").text(stateConfig.text);
        };
        group.updateState();
        return group;
    },

    /**
     * Creates a NumericDisplay component.
     * This component displays a numeric value from a linked device variable, formatted with units
     * and a specified number of decimal places. It also shows a label.
     *
     * @param {string} id - The unique ID for this component.
     * @param {object} config - Configuration object containing properties like `x`, `y`, `deviceId`,
     *                          `variableName`, `label`, `units`, `decimalPlaces`.
     * @returns {Konva.Group} The Konva.Group representing the NumericDisplay.
     */
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
            handleComponentSelectionClick(
                group,
                e,
                isSimulationModeRef,
                trRef,
                selectNodesFuncRef,
            );
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
            const value = getDeviceVariableValue(
                this.attrs.deviceId,
                this.attrs.variableName,
            );
            const numValue = parseFloat(value);
            const val = !isNaN(numValue)
                ? numValue.toFixed(this.attrs.decimalPlaces)
                : "---";
            this.findOne(".value-text").text(val);
            this.findOne(".label-text").text(
                this.attrs.label + ` (${this.attrs.units})`,
            );
        };
        group.updateState();
        return group;
    },

    /**
     * Creates a Label component.
     * This component displays static text on the canvas. The text content, font size, color,
     * width, and alignment can be configured. It supports transformation (resizing)
     * which updates its width.
     *
     * @param {string} id - The unique ID for this component.
     * @param {object} config - Configuration object containing properties like `x`, `y`,
     *                          `text`, `fontSize`, `fill`, `width`, `align`.
     * @returns {Konva.Group} The Konva.Group representing the Label.
     */
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
            handleComponentSelectionClick(
                group,
                e,
                isSimulationModeRef,
                trRef,
                selectNodesFuncRef,
            );
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
