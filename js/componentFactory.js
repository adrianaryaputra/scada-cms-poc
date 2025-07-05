/**
 * @file Factory module for creating HMI (Human-Machine Interface) components using Konva.js.
 * It handles the instantiation, default properties, and basic event handling for various components.
 * This module centralizes the creation logic for all HMI components, ensuring consistency
 * and providing a single point for managing component types and their default behaviors.
 * @module js/componentFactory
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

/**
 * Handles standardized click logic for component selection in design mode.
 * If Shift key is pressed, it toggles the clicked component's selection state
 * within the existing selection. Otherwise, it selects only the clicked component
 * or deselects all if the clicked component was already the only one selected.
 * This function is not intended for use in simulation mode where components
 * might have their own click behaviors.
 *
 * @private
 * @param {Konva.Group} group - The Konva.Group representing the HMI component that was clicked.
 * @param {Konva.KonvaEventObject<MouseEvent>} event - The Konva click event object.
 * @param {function(): boolean} isSimulationModeFunc - A function that returns `true` if in simulation mode.
 * @param {Konva.Transformer} transformer - The Konva.Transformer instance used for selection.
 * @param {function(Array<Konva.Node>): void} selectNodesCallback - A callback function (typically from `uiManager.selectNodes`)
 *                                                                 to update the application's selection state.
 * @returns {boolean} `true` if the event was handled (e.g., right-click ignored, or selection logic applied),
 *                    `false` if in simulation mode and the component should handle its own simulation click.
 */
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
 * This function must be called once during application setup, typically in `app.js`,
 * before any HMI components can be created. It stores references to shared Konva objects
 * (like the main layer, transformer, stage) and callback functions from other managers
 * (like `konvaManager` for drag handling, `uiManager` for selection) that are essential
 * for the components' functionality and interactivity.
 *
 * @export
 * @param {Konva.Layer} layer - The main Konva.Layer instance where all HMI components will be added.
 * @param {Konva.Transformer} tr - The Konva.Transformer instance used for selecting and transforming components.
 * @param {Konva.Layer} guideLayer - The Konva.Layer instance used for drawing visual aids like snap lines during dragging.
 * @param {function(): boolean} getIsSimulationMode - A function that returns `true` if the application is in simulation mode, `false` otherwise.
 * @param {function(): Konva.Stage} getStage - A function that returns the main Konva.Stage instance.
 * @param {function(): object} getDragStartPositions - A function from `konvaManager` that returns the starting positions of nodes at the beginning of a drag operation.
 * @param {function(object): void} setDragStartPositions - A function from `konvaManager` to set the starting positions of nodes for a drag operation.
 * @param {function(): void} clearDragStartPositions - A function from `konvaManager` to clear the stored drag start positions.
 * @param {function(Array<Konva.Node>): void} selectNodesFunc - A callback function, typically from `uiManager`, to handle the selection of Konva nodes.
 * @param {function(Konva.KonvaEventObject<DragEvent>): void} handleDragMoveFunc - A callback function, typically from `konvaManager`, to handle drag movements, including snapping logic.
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
 * This object contains methods to instantiate various types of HMI components,
 * configure them with default and user-provided properties, and set up
 * common event handling. It relies on references initialized by `initComponentFactory`.
 *
 * @public
 * @namespace componentFactory
 */
export const componentFactory = {
    /**
     * Creates a new HMI component of a specified type with given properties.
     * It first generates a unique ID for the component if one is not provided in `props`.
     * Then, it merges default properties (like initial position, label) with the `props`
     * passed by the caller. Finally, it delegates the actual instantiation and setup
     * to the internal `creator` method.
     *
     * @public
     * @param {string} type - The type of HMI component to create (e.g., "bit-lamp", "bit-switch", "numeric-display").
     *                        This type string is used to determine which specific creation function to call.
     * @param {object} [props={}] - An optional object containing properties to override the defaults for the new component.
     *                              Common properties include `id` (string), `x` (number), `y` (number),
     *                              `deviceId` (string, for data binding), `variableName` (string, for data binding),
     *                              `label` (string), and other attributes specific to the component type
     *                              (e.g., `onColor`, `offColor` for a BitLamp).
     * @returns {Konva.Group | null} The created Konva.Group object representing the HMI component,
     *                               or `null` if the component type is unknown or creation fails.
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
     * based on the `type`. It also sets up common event handlers (drag, click for selection)
     * for all components and adds the successfully created component to the main Konva layer.
     *
     * @private
     * @param {string} type - The type of HMI component to create (e.g., "bit-lamp"). This determines
     *                        which specific `create<ComponentName>` method is called.
     * @param {string} id - The unique ID assigned to this component instance.
     * @param {object} config - The fully resolved configuration object for the component,
     *                          which is a result of merging default properties with user-provided `props`.
     *                          This object is passed to the specific `create<ComponentName>` method.
     * @returns {Konva.Group | null} The created Konva.Group object representing the HMI component,
     *                               or `null` if the `type` is unknown or creation fails.
     * @throws {Error} If the component type is unknown and no corresponding creation method exists.
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
     * A BitLamp visually represents a boolean state (typically 0 or 1) derived from a linked device variable.
     * It can be rendered as a circle or a rectangle and changes its fill color based on the state (on/off).
     * The component also includes an `updateState` method to refresh its appearance based on the current
     * variable value from the `stateManager`.
     *
     * @param {string} id - The unique ID for this BitLamp instance.
     * @param {object} config - A configuration object for the BitLamp. Expected properties:
     *                          `x` (number): The x-coordinate of the component.
     *                          `y` (number): The y-coordinate of the component.
     *                          `deviceId` (string|null): The ID of the device this lamp is linked to.
     *                          `variableName` (string|null): The name of the variable on the linked device.
     *                          `label` (string): Text label for the component (often not directly visible on BitLamp itself but used in properties).
     *                          `shapeType` (string, "circle"|"rect"): The shape of the lamp. Defaults to "circle".
     *                          `offColor` (string): Hex color code for the lamp's 'off' state. Defaults to "#555555".
     *                          `onColor` (string): Hex color code for the lamp's 'on' state. Defaults to "#22c55e".
     *                          Additional Konva.Group properties can also be included.
     * @returns {Konva.Group} A Konva.Group object representing the BitLamp.
     */
    createBitLamp(id, config) {
        // console.log('[DEBUG_COMPONENT_FACTORY] Konva.Rect in createBitLamp:', Konva.Rect);
        // console.log('[DEBUG_COMPONENT_FACTORY] Konva.Circle in createBitLamp:', Konva.Circle);
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
            shapeType: "circle",
            offColor: "#555555",
            onColor: "#22c55e",
            ...config, // Includes deviceId, variableName, label from defaults/props
        });

        // Determine initial shape based on the final effective shapeType
        let lampShape;
        if (group.attrs.shapeType === "rect") {
            lampShape = new Konva.Rect({
                width: 40,
                height: 40,
                offsetX: 20, // Center the rect
                offsetY: 20, // Center the rect
                name: "lamp-shape",
            });
        } else { // Default to circle
            lampShape = new Konva.Circle({
                radius: 20,
                name: "lamp-shape",
            });
        }
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
            // Use _mockShapeType in test environment for reliability, otherwise fallback to instanceof
            let currentShapeTypeInNode = existingShape._mockShapeType
                ? existingShape._mockShapeType
                : (existingShape instanceof Konva.Circle) ? "circle" : "rect";

            console.log(`[DEBUG_updateState] Component ID: ${this.id()}, Attr shapeType: ${this.attrs.shapeType}, Detected currentShapeType: ${currentShapeTypeInNode}, existingShape mockType: ${existingShape._mockShapeType}`);

            if (this.attrs.shapeType !== currentShapeTypeInNode) {
                console.log(`[DEBUG_updateState] Component ID: ${this.id()} - Shape types differ. Recreating shape.`);
                existingShape.destroy();
                let newShape;
                if (this.attrs.shapeType === "circle") {
                    newShape = new Konva.Circle({ radius: 20, name: "lamp-shape" });
                } else {
                    newShape = new Konva.Rect({
                        width: 40,
                        height: 40,
                        offsetX: 20,
                        offsetY: 20,
                        name: "lamp-shape"
                    });
                }
                this.add(newShape);
                newShape.moveToBottom();
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
     * A BitSwitch allows users to toggle a boolean state (on/off). In simulation mode,
     * clicking the switch writes the new state back to a linked device variable via `writeDataToServer`.
     * It visually represents its state by changing its background color and displayed text (e.g., "ON"/"OFF").
     * The component includes an `updateState` method to refresh its appearance based on the current
     * variable value from the `stateManager`.
     *
     * @param {string} id - The unique ID for this BitSwitch instance.
     * @param {object} config - A configuration object for the BitSwitch. Expected properties:
     *                          `x` (number): The x-coordinate of the component.
     *                          `y` (number): The y-coordinate of the component.
     *                          `deviceId` (string|null): The ID of the device this switch is linked to.
     *                          `variableName` (string|null): The name of the variable on the linked device.
     *                          `label` (string): Text label for the component.
     *                          `offColor` (string): Hex color code for the switch's 'off' state background. Defaults to "#d9534f".
     *                          `onColor` (string): Hex color code for the switch's 'on' state background. Defaults to "#5cb85c".
     *                          `offText` (string): Text displayed when the switch is 'off'. Defaults to "OFF".
     *                          `onText` (string): Text displayed when the switch is 'on'. Defaults to "ON".
     *                          Additional Konva.Group properties can also be included.
     * @returns {Konva.Group} A Konva.Group object representing the BitSwitch.
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
     * (or a string that can be matched) from a linked device variable. It iterates through a
     * configurable array of `states` (each defining a `value`, `text`, and `color`)
     * and applies the visual properties of the first matching state.
     * Includes an `updateState` method to refresh its appearance based on the current variable value.
     *
     * @param {string} id - The unique ID for this WordLamp instance.
     * @param {object} config - A configuration object for the WordLamp. Expected properties:
     *                          `x` (number): The x-coordinate of the component.
     *                          `y` (number): The y-coordinate of the component.
     *                          `deviceId` (string|null): The ID of the device this lamp is linked to.
     *                          `variableName` (string|null): The name of the variable on the linked device.
     *                          `label` (string): Text label for the component.
     *                          `states` (Array<object>): An array of state objects. Each object should have:
     *                              `value` (number|string): The value to match against the device variable.
     *                              `text` (string): The text to display for this state.
     *                              `color` (string): Hex color code for the background for this state.
     *                          Defaults to `[{ value: 0, text: "STOPPED", color: "#d9534f" }, { value: 1, text: "RUNNING", color: "#5cb85c" }]`.
     *                          Additional Konva.Group properties can also be included.
     * @returns {Konva.Group} A Konva.Group object representing the WordLamp.
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
     * This component is designed to display a numeric value obtained from a linked device variable.
     * The displayed value can be formatted with a specific number of decimal places and appended with units.
     * It also shows a configurable label above the numeric value.
     * Includes an `updateState` method to refresh the displayed value based on the current variable
     * value from the `stateManager`.
     *
     * @param {string} id - The unique ID for this NumericDisplay instance.
     * @param {object} config - A configuration object for the NumericDisplay. Expected properties:
     *                          `x` (number): The x-coordinate of the component.
     *                          `y` (number): The y-coordinate of the component.
     *                          `deviceId` (string|null): The ID of the device this display is linked to.
     *                          `variableName` (string|null): The name of the variable on the linked device.
     *                          `label` (string): Text label displayed above the numeric value. Defaults to "Suhu".
     *                          `units` (string): Units to append to the numeric value (e.g., "°C", "PSI"). Defaults to "°C".
     *                          `decimalPlaces` (number): Number of decimal places to format the value to. Defaults to 2.
     *                          Additional Konva.Group properties can also be included.
     * @returns {Konva.Group} A Konva.Group object representing the NumericDisplay.
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
     * This component displays static text on the HMI canvas. Its appearance (text content,
     * font size, color, width, alignment) is configurable. The Label component supports
     * transformations (scaling) via the Konva Transformer; when transformed, its `width`
     * attribute is updated, and the scale is reset to avoid font distortion.
     * It includes an `updateState` method to refresh its text and style properties if they are changed.
     * Unlike other components, Labels typically do not bind to device variables.
     *
     * @param {string} id - The unique ID for this Label instance.
     * @param {object} config - A configuration object for the Label. Expected properties:
     *                          `x` (number): The x-coordinate of the component.
     *                          `y` (number): The y-coordinate of the component.
     *                          `text` (string): The text content to display. Defaults to "Label Teks".
     *                          `fontSize` (number): The font size in pixels. Defaults to 14.
     *                          `fill` (string): Hex color code for the text. Defaults to "white".
     *                          `width` (number): The width of the text box. Defaults to 100.
     *                          `align` (string, "left"|"center"|"right"): Text alignment within the width. Defaults to "center".
     *                          Additional Konva.Group properties can also be included.
     * @returns {Konva.Group} A Konva.Group object representing the Label.
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
