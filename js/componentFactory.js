/**
 * @file Factory module for creating HMI (Human-Machine Interface) components using Konva.js.
 * @module js/componentFactory
 *
 * @description
 * This module centralizes the creation logic for all HMI components, ensuring consistency
 * and providing a single point for managing component types and their default behaviors.
 * It uses Konva.js for rendering graphical elements.
 *
 * Key Responsibilities:
 * - Initializing with references to shared Konva objects (layer, transformer, stage) and
 *   callback functions from other managers (e.g., for selection, drag handling).
 * - Providing a `create(type, props)` method to instantiate components by type.
 * - Defining specific creation functions for each component type (e.g., `createBitLamp`, `createBitSwitch`).
 * - Setting up default properties and allowing overrides via `props`.
 * - Attaching common event handlers (drag, click for selection) and component-specific
 *   event handlers (e.g., click for a BitSwitch in simulation mode).
 * - Defining an `updateState` method on each component to refresh its visual appearance
 *   based on data from the `stateManager`.
 *
 * Dependencies:
 * - `config.js` (for GRID_SIZE, though not directly used in current logic here).
 * - `stateManager.js` (for `saveState`, `getDeviceVariableValue`).
 * - `deviceManager.js` (for `writeDataToServer` when components need to send data).
 * - Konva.js (for all graphical elements and interactions).
 * - References from `konvaManager` and `uiManager` (passed during `initComponentFactory`).
 */

import { GRID_SIZE } from "./config.js";
import { saveState, getDeviceVariableValue } from "./stateManager.js";
import { writeDataToServer } from "./deviceManager.js";

/**
 * Handles standardized click logic for component selection when in design mode.
 * - If Shift key is pressed, toggles the clicked component's selection state within the existing selection.
 * - Otherwise, selects only the clicked component (or deselects if it was the only one selected).
 * This function is not intended for simulation mode, where components might have distinct click behaviors.
 *
 * @private
 * @param {import('konva/lib/Group').Group} group - The Konva.Group (HMI component) that was clicked.
 * @param {import('konva/lib/types').KonvaEventObject<MouseEvent>} event - The Konva click event object.
 * @param {function(): boolean} isSimulationModeFunc - Function returning `true` if in simulation mode.
 * @param {import('konva/lib/shapes/Transformer').Transformer} transformer - The Konva.Transformer for selection.
 * @param {function(Array<import('konva/lib/Node').Node>): void} selectNodesCallback - Callback (from `uiManager.selectNodes`) to update selection state.
 * @returns {boolean} `true` if the event was handled (selection logic applied or right-click ignored),
 *                    `false` if in simulation mode (implying component should handle its own simulation click).
 */
function handleComponentSelectionClick(
    group,
    event,
    isSimulationModeFunc,
    transformer,
    selectNodesCallback,
) {
    if (event.evt.button === 2) return true; // Ignore right-click, handled by context menu

    if (isSimulationModeFunc && isSimulationModeFunc()) {
        // In simulation mode, components handle their own clicks (e.g., BitSwitch toggling).
        // This helper is for design-mode selection.
        return false;
    }

    const isSelected = transformer.nodes().includes(group);
    if (!event.evt.shiftKey) { // Not a shift-click
        if (selectNodesCallback) selectNodesCallback(isSelected ? [] : [group]);
    } else { // Shift-click for multi-select/deselect
        const currentSelection = transformer.nodes().slice(); // Copy current selection
        if (isSelected) { // Already selected, so deselect
            const index = currentSelection.indexOf(group);
            if (index > -1) currentSelection.splice(index, 1);
        } else { // Not selected, so add to selection
            currentSelection.push(group);
        }
        if (selectNodesCallback) selectNodesCallback(currentSelection);
    }
    return true; // Event handled by selection logic
}

// --- Module-level References (Injected via initComponentFactory) ---

/** @type {import('konva/lib/Layer').Layer | null} Main Konva layer for components. */
let layerRef = null;
/** @type {import('konva/lib/shapes/Transformer').Transformer | null} Konva Transformer for selections. */
let trRef = null;
/** @type {import('konva/lib/Layer').Layer | null} Layer for visual aids (snap lines). */
let guideLayerRef = null;
/** @type {function(): boolean | null} Function returning current simulation mode. */
let isSimulationModeRef = null;
/** @type {function(): (import('konva/lib/Stage').Stage|null) | null} Function returning Konva stage. */
let stageRef = null;
/** @type {function(): (object|null) | null} Function returning drag start positions. */
let dragStartPositionsRef = null;
/** @type {function(object): void | null} Function to set drag start positions. */
let setDragStartPositionsRef = null;
/** @type {function(): void | null} Function to clear drag start positions. */
let clearDragStartPositionsRef = null;
/** @type {function(Array<import('konva/lib/Node').Node>): void | null} Ref to uiManager's selectNodes. */
let selectNodesFuncRef = null;
/** @type {function(import('konva/lib/types').KonvaEventObject<DragEvent>): void | null} Ref to konvaManager's handleDragMove. */
let handleDragMoveFuncRef = null;

/**
 * Initializes the component factory with necessary references to other modules and Konva objects.
 * Must be called once at application startup before creating any HMI components.
 *
 * @param {import('konva/lib/Layer').Layer} layer - Main Konva.Layer for HMI components.
 * @param {import('konva/lib/shapes/Transformer').Transformer} tr - Konva.Transformer for component selection/manipulation.
 * @param {import('konva/lib/Layer').Layer} guideLayer - Konva.Layer for drawing visual aids (e.g., snap lines).
 * @param {function(): boolean} getIsSimulationMode - Function that returns `true` if in simulation mode.
 * @param {function(): import('konva/lib/Stage').Stage} getStage - Function that returns the main Konva.Stage.
 * @param {function(): object} getDragStartPositions - From `konvaManager`, returns node start positions on drag.
 * @param {function(object): void} setDragStartPositions - From `konvaManager`, sets node start positions.
 * @param {function(): void} clearDragStartPositions - From `konvaManager`, clears stored drag positions.
 * @param {function(Array<import('konva/lib/Node').Node>): void} selectNodesFunc - Callback from `uiManager` to handle node selection.
 * @param {function(import('konva/lib/types').KonvaEventObject<DragEvent>): void} handleDragMoveFunc - Callback from `konvaManager` for drag movements with snapping.
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
    console.log("[ComponentFactory] Initialized with necessary references.");
}

/**
 * @namespace componentFactory
 * @description Main factory object for creating HMI components.
 * Contains methods to instantiate various HMI component types, configure them,
 * and set up common event handling. Relies on references initialized by `initComponentFactory`.
 */
export const componentFactory = {
    /**
     * Creates a new HMI component of a specified type with given properties.
     * Generates a unique ID if not provided, merges default properties with `props`,
     * and delegates to the internal `creator` method for actual instantiation.
     *
     * @param {string} type - The type of HMI component to create (e.g., "bit-lamp", "numeric-display").
     *                        Used to determine which specific creation function (`create<ComponentName>`) to call.
     * @param {object} [props={}] - Optional object containing properties to override component defaults.
     *                              Common properties: `id` (string), `x` (number), `y` (number),
     *                              `deviceId` (string, for data binding), `variableName` (string, for data binding),
     *                              `label` (string), and type-specific attributes (e.g., `onColor`, `units`).
     * @returns {import('konva/lib/Group').Group | null} The created Konva.Group (HMI component), or `null` on failure.
     * @throws {Error} If `type` is unknown.
     */
    create(type, props = {}) {
        const uniqueId = props.id || `hmi-id-${crypto.randomUUID()}`;
        const defaults = {
            x: 100, // Default x position
            y: 100, // Default y position
            deviceId: null, // For linking to a device
            variableName: null, // For linking to a specific device variable
            label: type, // Default label is the component type
        };
        const config = { ...defaults, ...props }; // Merge defaults with provided props

        // Note: Initial values for device-bound variables are typically pushed by the server
        // or set via UI, not directly during component creation here.
        // Components primarily reflect data from stateManager.

        return this.creator(type, uniqueId, config);
    },

    /**
     * Internal method that dispatches to specific component creation functions based on `type`.
     * Sets up common event handlers (drag, selection click) for all components and adds
     * the created component to the main Konva layer (`layerRef`).
     *
     * @private
     * @param {string} type - The HMI component type (e.g., "bit-lamp").
     * @param {string} id - The unique ID for this component instance.
     * @param {object} config - Fully resolved configuration object (defaults merged with props).
     * @returns {import('konva/lib/Group').Group | null} The created Konva.Group, or `null` if type is unknown.
     * @throws {Error} If `type` is not a recognized component type.
     */
    creator(type, id, config) {
        let group; // This will be the Konva.Group representing the HMI component
        switch (type) {
            case "bit-lamp":        group = this.createBitLamp(id, config); break;
            case "bit-switch":      group = this.createBitSwitch(id, config); break;
            case "word-lamp":       group = this.createWordLamp(id, config); break;
            case "numeric-display": group = this.createNumericDisplay(id, config); break;
            case "label":           group = this.createLabel(id, config); break;
            default:
                console.error(`[ComponentFactory] Unknown component type requested: ${type}`);
                throw new Error(`Unknown component type: ${type}`);
        }

        if (group) {
            // Common event handlers for all components
            group.on("dragstart", () => {
                if (guideLayerRef) guideLayerRef.show();
                if (stageRef && trRef && typeof setDragStartPositionsRef === 'function') {
                    const currentDragStartPositions = {
                        pointer: stageRef().getPointerPosition(),
                        nodes: {},
                    };
                    trRef.nodes().forEach((node) => {
                        currentDragStartPositions.nodes[node.id()] = { x: node.x(), y: node.y() };
                    });
                    setDragStartPositionsRef(currentDragStartPositions);
                }
            });
            group.on("dragend", () => {
                saveState(); // Save application state after drag
                if (guideLayerRef) guideLayerRef.hide();
                if (typeof clearDragStartPositionsRef === 'function') clearDragStartPositionsRef();
            });
            group.on("dragmove", (e) => {
                if (typeof handleDragMoveFuncRef === 'function') handleDragMoveFuncRef(e);
            });

            if (layerRef) {
                layerRef.add(group);
            } else {
                console.error("[ComponentFactory] layerRef not available. Cannot add component to layer.");
            }
        }
        return group;
    },

    /**
     * Creates a BitLamp HMI component.
     * Visualizes a boolean state (on/off) from a linked device variable.
     * Appearance (shape, color) changes based on the variable's value.
     *
     * @param {string} id - Unique ID for this BitLamp.
     * @param {object} config - Configuration object. Expected properties:
     *                          `x`, `y` (number): Position.
     *                          `deviceId` (string|null): Linked device ID.
     *                          `variableName` (string|null): Linked variable name.
     *                          `label` (string): Component label.
     *                          `shapeType` (string, "circle"|"rect"): Lamp shape. Default: "circle".
     *                          `offColor` (string): Color for 'off' state. Default: "#555555".
     *                          `onColor` (string): Color for 'on' state. Default: "#22c55e".
     *                          Other Konva.Group properties can be included.
     * @returns {import('konva/lib/Group').Group} The Konva.Group for the BitLamp.
     */
    createBitLamp(id, config) {
        const group = new Konva.Group({
            id: id, x: config.x, y: config.y,
            draggable: false, // Managed by selection logic
            name: "hmi-component", // For querying
        });
        group.setAttrs({
            componentType: "bit-lamp",
            shapeType: "circle", // Default shape
            offColor: "#555555", // Default off color
            onColor: "#22c55e",  // Default on color
            ...config, // User-provided config overrides defaults
        });

        let lampShape;
        if (group.attrs.shapeType === "rect") {
            lampShape = new Konva.Rect({ width: 40, height: 40, offsetX: 20, offsetY: 20, name: "lamp-shape" });
        } else { // Default to circle
            lampShape = new Konva.Circle({ radius: 20, name: "lamp-shape" });
        }
        group.add(lampShape);

        group.on("click", (e) => handleComponentSelectionClick(group, e, isSimulationModeRef, trRef, selectNodesFuncRef));

        /** Updates the BitLamp's visual state based on its linked variable. */
        group.updateState = function () {
            const val = getDeviceVariableValue(this.attrs.deviceId, this.attrs.variableName);
            const state = (val === true || val === 1 || String(val).toLowerCase() === "true" || String(val).toUpperCase() === "ON") ? 1 : 0;

            const currentShape = this.findOne(".lamp-shape");
            // Determine current shape type for comparison. _mockShapeType is for testing.
            const currentShapeTypeInNode = currentShape._mockShapeType || (currentShape instanceof Konva.Circle ? "circle" : "rect");

            // If shapeType attribute changed (e.g., via context menu), recreate the shape
            if (this.attrs.shapeType !== currentShapeTypeInNode) {
                currentShape.destroy();
                let newShapeInstance;
                if (this.attrs.shapeType === "circle") {
                    newShapeInstance = new Konva.Circle({ radius: 20, name: "lamp-shape" });
                } else { // rect
                    newShapeInstance = new Konva.Rect({ width: 40, height: 40, offsetX: 20, offsetY: 20, name: "lamp-shape" });
                }
                this.add(newShapeInstance);
                newShapeInstance.moveToBottom(); // Ensure shape is behind any potential labels (though BitLamp doesn't usually have them)
            }
            // Apply color based on state to the (potentially new) shape
            this.findOne(".lamp-shape").fill(state === 1 ? this.attrs.onColor : this.attrs.offColor);
        };
        group.updateState(); // Initial state update
        return group;
    },

    /**
     * Creates a BitSwitch HMI component.
     * Allows users to toggle a boolean state. In simulation mode, clicking writes the new state
     * to a linked device variable via `writeDataToServer`. Visually changes color and text.
     *
     * @param {string} id - Unique ID for this BitSwitch.
     * @param {object} config - Configuration object. Expected properties:
     *                          `x`, `y`, `deviceId`, `variableName`, `label`.
     *                          `offColor` (string): Background for 'off' state. Default: "#d9534f".
     *                          `onColor` (string): Background for 'on' state. Default: "#5cb85c".
     *                          `offText` (string): Text for 'off' state. Default: "OFF".
     *                          `onText` (string): Text for 'on' state. Default: "ON".
     * @returns {import('konva/lib/Group').Group} The Konva.Group for the BitSwitch.
     */
    createBitSwitch(id, config) {
        const group = new Konva.Group({ id: id, x: config.x, y: config.y, draggable: false, name: "hmi-component" });
        group.setAttrs({
            componentType: "bit-switch",
            label: "Switch", // Default label
            offColor: "#d9534f", onColor: "#5cb85c",
            offText: "OFF", onText: "ON",
            ...config,
        });

        const background = new Konva.Rect({ width: 80, height: 40, cornerRadius: 5, name: "background" });
        group.add(background);
        const text = new Konva.Text({
            width: 80, height: 40, align: "center", verticalAlign: "middle",
            fontSize: 16, fill: "white", fontStyle: "bold", name: "state-text",
        });
        group.add(text);

        group.on("click", (e) => {
            if (e.evt.button === 2) return; // Ignore right-click

            if (isSimulationModeRef && isSimulationModeRef()) { // Simulation mode behavior
                if (group.attrs.deviceId && group.attrs.variableName) {
                    const currentVal = getDeviceVariableValue(group.attrs.deviceId, group.attrs.variableName) || 0;
                    const newVal = (currentVal === 1 || String(currentVal).toLowerCase() === "true") ? 0 : 1;
                    writeDataToServer(group.attrs.deviceId, group.attrs.variableName, newVal);
                } else {
                    console.warn("[ComponentFactory] BitSwitch: deviceId or variableName not set. Cannot write data.");
                }
            } else { // Design mode behavior (selection)
                handleComponentSelectionClick(group, e, isSimulationModeRef, trRef, selectNodesFuncRef);
            }
        });

        /** Updates the BitSwitch's visual state. */
        group.updateState = function () {
            const val = getDeviceVariableValue(this.attrs.deviceId, this.attrs.variableName);
            const state = (val === true || val === 1 || String(val).toLowerCase() === "true" || String(val).toUpperCase() === "ON") ? 1 : 0;
            this.findOne(".background").fill(state === 1 ? this.attrs.onColor : this.attrs.offColor);
            this.findOne(".state-text").text(state === 1 ? this.attrs.onText : this.attrs.offText);
        };
        group.updateState();
        return group;
    },

    /**
     * Creates a WordLamp HMI component.
     * Displays text and background color based on a numeric/string value from a linked device variable,
     * matching against a configurable array of `states`.
     *
     * @param {string} id - Unique ID for this WordLamp.
     * @param {object} config - Configuration object. Expected properties:
     *                          `x`, `y`, `deviceId`, `variableName`, `label`.
     *                          `states` (Array<object>): State definitions. Each object:
     *                              `value` (number|string): Value to match.
     *                              `text` (string): Display text.
     *                              `color` (string): Background hex color.
     *                          Default states: `[{ value: 0, text: "STOPPED", color: "#d9534f" }, { value: 1, text: "RUNNING", color: "#5cb85c" }]`.
     * @returns {import('konva/lib/Group').Group} The Konva.Group for the WordLamp.
     */
    createWordLamp(id, config) {
        const group = new Konva.Group({ id: id, x: config.x, y: config.y, draggable: false, name: "hmi-component" });
        group.setAttrs({
            componentType: "word-lamp",
            label: "Status Indicator", // Default label
            states: [ // Default states
                { value: 0, text: "STOPPED", color: "#d9534f" },
                { value: 1, text: "RUNNING", color: "#5cb85c" },
            ],
            ...config,
        });

        const background = new Konva.Rect({
            width: 120, height: 40, fill: "#333", stroke: "#555",
            strokeWidth: 2, cornerRadius: 5, name: "background",
        });
        group.add(background);
        const text = new Konva.Text({
            width: 120, height: 40, align: "center", verticalAlign: "middle",
            fontSize: 16, fill: "white", fontStyle: "bold", name: "state-text",
        });
        group.add(text);

        group.on("click", (e) => handleComponentSelectionClick(group, e, isSimulationModeRef, trRef, selectNodesFuncRef));

        /** Updates the WordLamp's visual state. */
        group.updateState = function () {
            const val = getDeviceVariableValue(this.attrs.deviceId, this.attrs.variableName) ?? 0; // Default to 0 if undefined
            const numVal = Number(val); // Attempt to convert to number for numeric state matching
            const strVal = String(val).toLowerCase(); // For string state matching

            const stateConfig = this.attrs.states.find(s => s.value == numVal || String(s.value).toLowerCase() == strVal) ||
                                { text: "N/A", color: "#f0ad4e" }; // Fallback state
            this.findOne(".background").fill(stateConfig.color);
            this.findOne(".state-text").text(stateConfig.text);
        };
        group.updateState();
        return group;
    },

    /**
     * Creates a NumericDisplay HMI component.
     * Displays a numeric value from a linked device variable, formatted with decimal places and units.
     *
     * @param {string} id - Unique ID for this NumericDisplay.
     * @param {object} config - Configuration object. Expected properties:
     *                          `x`, `y`, `deviceId`, `variableName`, `label`.
     *                          `units` (string): Units to append (e.g., "°C"). Default: "°C".
     *                          `decimalPlaces` (number): Decimal places for formatting. Default: 2.
     * @returns {import('konva/lib/Group').Group} The Konva.Group for the NumericDisplay.
     */
    createNumericDisplay(id, config) {
        const group = new Konva.Group({ id: id, x: config.x, y: config.y, draggable: false, name: "hmi-component" });
        group.setAttrs({
            componentType: "numeric-display",
            label: "Value Display", // Default label
            units: "Value", // Default unit text
            decimalPlaces: 2, // Default decimal places
            ...config,
        });

        const background = new Konva.Rect({ width: 120, height: 50, fill: "#1f2937", stroke: "#4b5563", strokeWidth: 1, cornerRadius: 3, name: "background" });
        group.add(background);
        const valueText = new Konva.Text({
            y: 25, width: 120, align: "center", verticalAlign: "middle",
            fontSize: 22, fill: "#67e8f9", fontStyle: "bold", name: "value-text",
        });
        group.add(valueText);
        const labelText = new Konva.Text({
            y: 5, width: 120, align: "center",
            fontSize: 11, fill: "#9ca3af", name: "label-text",
        });
        group.add(labelText);

        group.on("click", (e) => handleComponentSelectionClick(group, e, isSimulationModeRef, trRef, selectNodesFuncRef));

        /** Updates the NumericDisplay's visual state. */
        group.updateState = function () {
            const val = getDeviceVariableValue(this.attrs.deviceId, this.attrs.variableName);
            const numVal = parseFloat(val);
            const displayVal = !isNaN(numVal) ? numVal.toFixed(this.attrs.decimalPlaces) : "---";
            this.findOne(".value-text").text(displayVal);
            this.findOne(".label-text").text(`${this.attrs.label} (${this.attrs.units})`);
        };
        group.updateState();
        return group;
    },

    /**
     * Creates a Label HMI component for displaying static text.
     * Supports transformations (scaling) via Konva Transformer, adjusting width and resetting scale.
     * Typically does not bind to device variables.
     *
     * @param {string} id - Unique ID for this Label.
     * @param {object} config - Configuration object. Expected properties:
     *                          `x`, `y`.
     *                          `text` (string): Text content. Default: "Static Label".
     *                          `fontSize` (number): Font size. Default: 14.
     *                          `fill` (string): Text color. Default: "#e5e7eb".
     *                          `width` (number): Text box width. Default: 150.
     *                          `align` (string, "left"|"center"|"right"): Text alignment. Default: "left".
     * @returns {import('konva/lib/Group').Group} The Konva.Group for the Label.
     */
    createLabel(id, config) {
        const group = new Konva.Group({ id: id, x: config.x, y: config.y, draggable: false, name: "hmi-component" });
        group.setAttrs({
            componentType: "label",
            text: "Static Label", // Default text
            fontSize: 14,         // Default font size
            fill: "#e5e7eb",      // Default text color (light gray)
            width: 150,           // Default width
            align: "left",       // Default alignment
            ...config,
        });

        const labelText = new Konva.Text({
            text: group.attrs.text, fontSize: group.attrs.fontSize, fill: group.attrs.fill,
            width: group.attrs.width, align: group.attrs.align, name: "label-text",
            padding: 2, // Small padding for better visual appearance
        });
        group.add(labelText);

        // Handle transformations to adjust text width and reset scale for crisp font
        group.on("transformend", function () {
            const textNode = this.findOne(".label-text");
            // Update width based on scale and then reset scale
            const newWidth = this.width() * this.scaleX();
            textNode.width(newWidth);
            this.width(newWidth); // Update group's width attr for consistency and future ref
            this.scaleX(1);    // Reset scale to avoid font distortion
            this.scaleY(1);
            if (layerRef) layerRef.batchDraw(); // Redraw layer
            saveState(); // Save state after transformation
        });

        group.on("click", (e) => handleComponentSelectionClick(group, e, isSimulationModeRef, trRef, selectNodesFuncRef));

        /** Updates the Label's visual state (text content and style). */
        group.updateState = function () { // For dynamic property changes via context menu
            const textNode = this.findOne(".label-text");
            textNode.text(this.attrs.text);
            textNode.fontSize(this.attrs.fontSize);
            textNode.fill(this.attrs.fill);
            textNode.width(this.attrs.width); // Update width if changed via props
            textNode.align(this.attrs.align);
        };
        // group.updateState(); // Initial call might be redundant if attrs are set directly
        return group;
    },
};
