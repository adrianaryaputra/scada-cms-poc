/**
 * @file Manages the application's state, including HMI component configurations,
 * device variable values (tagDatabase), and undo/redo functionality.
 *
 * @module js/stateManager
 *
 * @description
 * The state managed by this module primarily consists of:
 * 1.  **HMI Component Configurations**: The properties and layout of all HMI components
 *     currently on the Konva.js canvas. This includes their type, position (x, y),
 *     unique ID, and other specific attributes (e.g., colors, text, linked device/variable).
 *     Stored as part of the `state` object in `undoStack`/`redoStack`.
 * 2.  **Device Variable Values (Tag Database)**: A live record of the current values
 *     for variables associated with configured devices. This acts as a client-side
 *     cache of device data. The structure is `tagDatabase[deviceId][variableName] = value`.
 *
 * The module provides mechanisms to:
 * - Save snapshots of the current application state (HMI components + tagDatabase).
 * - Restore the application to a previously saved state.
 * - Implement undo and redo functionality based on these state snapshots.
 * - Get and set individual device variable values, triggering UI updates for
 *   linked HMI components and the device manager UI.
 *
 * Key Interactions:
 * - `componentFactory`: Used for recreating HMI components during state restoration.
 * - `Konva.Layer` & `Konva.Transformer`: Accessed to get HMI component data for saving,
 *   and to clear/repopulate components during restoration.
 * - `deviceManager.updateLiveVariableValueInManagerUI`: Called to update the variable display
 *   in the device manager UI when a tag value changes.
 * - `ProjectManager.setDirty`: Called to mark the project as modified when the state changes.
 */

import { updateLiveVariableValueInManagerUI } from "./deviceManager.js";
import ProjectManager from "./projectManager.js";

// --- Module-Level State Variables ---

/**
 * Stores snapshots of the application state for undo operations.
 * Each element is a stringified JSON object: `{ components: Array<object>, tags: object }`.
 * - `components`: An array of serialized HMI component data. Each object includes
 *   `id`, `x`, `y`, `componentType`, and other `attrs`.
 * - `tags`: A snapshot of the `tagDatabase` at that point in time.
 * @private
 * @type {Array<string>}
 */
let undoStack = [];

/**
 * Stores snapshots of the application state for redo operations.
 * Structure is identical to `undoStack`. Populated when an undo action occurs.
 * @private
 * @type {Array<string>}
 */
let redoStack = [];

/**
 * A live database storing the current values of all device variables (tags).
 * Structure: `tagDatabase[deviceId: string][variableName: string]: any`
 * This object is updated by `setDeviceVariableValue` and read by `getDeviceVariableValue`
 * and HMI components (indirectly via their `updateState` methods).
 * @private
 * @type {Object<string, Object<string, *>>}
 */
let tagDatabase = {};

// --- References to other modules and DOM elements ---
// These are initialized by `initStateManager`.

/**
 * Reference to the `componentFactory` module.
 * @private
 * @type {import('./componentFactory.js').componentFactory | null}
 */
let componentFactoryRef = null;

/**
 * Reference to the main Konva.Layer where HMI components are drawn.
 * @private
 * @type {import('konva/lib/Layer').Layer | null}
 */
let layerRef = null;

/**
 * Reference to the Konva.Transformer used for selecting and manipulating components.
 * @private
 * @type {import('konva/lib/shapes/Transformer').Transformer | null}
 */
let trRef = null;

/**
 * Reference to the DOM element for the Undo button.
 * @private
 * @type {HTMLButtonElement | null}
 */
let undoBtnRef = null;

/**
 * Reference to the DOM element for the Redo button.
 * @private
 * @type {HTMLButtonElement | null}
 */
let redoBtnRef = null;

// --- Initialization ---

/**
 * Initializes the StateManager with necessary references.
 * This function should be called once during application startup.
 * It stores references to other modules and Konva objects required for state
 * operations and sets up the initial undo/redo state.
 *
 * @param {import('./componentFactory.js').componentFactory} factory - Reference to the `componentFactory` for recreating components.
 * @param {import('konva/lib/Layer').Layer} layer - Reference to the main Konva.Layer for HMI components.
 * @param {import('konva/lib/shapes/Transformer').Transformer} tr - Reference to the Konva.Transformer for selections.
 * @param {HTMLButtonElement} undoBtn - The DOM element for the application's undo button.
 * @param {HTMLButtonElement} redoBtn - The DOM element for the application's redo button.
 */
export function initStateManager(factory, layer, tr, undoBtn, redoBtn) {
    componentFactoryRef = factory;
    layerRef = layer;
    trRef = tr;
    undoBtnRef = undoBtn;
    redoBtnRef = redoBtn;

    saveState(); // Save the initial (empty) state.
    updateUndoRedoButtons(); // Update UI buttons based on initial stack state.
}

// --- Getters for State Data ---

/**
 * Returns a reference to the current `tagDatabase` object.
 * The `tagDatabase` stores live device variable values:
 * `{ deviceId: { variableName1: value1, ... }, ... }`.
 *
 * @returns {Object<string, Object<string, *>>} The current tag database.
 */
export function getTagDatabase() {
    return tagDatabase;
}

/**
 * Returns the current undo stack.
 * Each element is a stringified JSON representation of a past application state
 * (`{ components: Array<object>, tags: object }`).
 * Useful for debugging or advanced state manipulation.
 *
 * @returns {Array<string>} The undo stack.
 */
export function getUndoStack() {
    return undoStack;
}

/**
 * Returns the current redo stack.
 * Structure is identical to `getUndoStack()`. Populated when `handleUndo` is called.
 *
 * @returns {Array<string>} The redo stack.
 */
export function getRedoStack() {
    return redoStack;
}

// --- Core State Manipulation: Save, Restore, Undo, Redo ---

/**
 * Saves the current application state (HMI components and tagDatabase) to the undo stack.
 *
 * The saved state object is: `{ components: Array<object>, tags: object }`
 * - `components`: Array of serialized HMI component data (id, x, y, attrs).
 * - `tags`: A deep copy of the current `tagDatabase`.
 *
 * Effects:
 * - Clears the `redoStack`.
 * - Updates undo/redo UI buttons.
 * - Marks the project as "dirty" via `ProjectManager.setDirty(true)`.
 *
 * Called after significant user actions that modify HMI layout or properties.
 * Tag changes from devices typically don't add to the undo stack directly via this function.
 */
export function saveState() {
    if (!layerRef) {
        console.warn("[StateManager] layerRef not available for saveState. State might be incomplete.");
        // Still proceed to save tags and manage stacks, but component part will be empty.
    }

    const state = {
        components: [],
        tags: JSON.parse(JSON.stringify(tagDatabase)) // Ensure a deep copy of tags
    };

    if (layerRef) {
        layerRef.find(".hmi-component").forEach((node) => {
            const attrsToSave = { ...node.attrs };
            // Potential future optimization: Exclude large or unserializable Konva internal properties if any.
            // delete attrsToSave.someKonvaInternalProperty;

            const componentData = {
                id: node.id(),
                x: node.x(),
                y: node.y(),
                ...attrsToSave, // Includes componentType, deviceId, variableName, etc.
            };

            if (!componentData.componentType) {
                console.warn(
                    `[StateManager] Component with ID ${node.id()} is missing componentType in attrs during saveState. Setting to 'Unknown'.`,
                );
                componentData.componentType = "Unknown"; // Fallback
            }
            state.components.push(componentData);
        });
    }

    undoStack.push(JSON.stringify(state));
    redoStack = []; // Any new state change clears the redo stack.
    updateUndoRedoButtons();

    if (ProjectManager && typeof ProjectManager.setDirty === "function") {
        ProjectManager.setDirty(true);
    } else {
        console.warn("[StateManager] ProjectManager.setDirty is not available.");
    }
}

/**
 * Restores the application state from a given JSON string.
 * Used by undo/redo and project loading.
 *
 * Process:
 * 1. Parses `stateString` into `{ components: Array<object>, tags: object }`.
 * 2. Clears existing HMI components from `layerRef` and selections from `trRef`.
 * 3. Restores `tagDatabase` from `state.tags`.
 * 4. Recreates HMI components using `componentFactoryRef.create()` from `state.components`.
 * 5. Updates undo/redo buttons and repaints `layerRef`.
 *
 * Logs an error and aborts if `stateString` is invalid or critical references are missing.
 *
 * @param {string} stateString - A stringified JSON object of the application state to restore.
 *                               Must conform to the structure saved by `saveState()`.
 */
export function restoreState(stateString) {
    let state;
    try {
        state = JSON.parse(stateString);
    } catch (error) {
        console.error("[StateManager] Error parsing state string for restoreState:", error, "State string:", stateString);
        return; // Abort if parsing fails
    }

    if (!state || typeof state.components === "undefined" || typeof state.tags === "undefined") {
        console.error(
            "[StateManager] Invalid state object structure provided to restoreState. State:",
            state,
            "Original string:",
            stateString,
        );
        return;
    }

    if (!layerRef || !componentFactoryRef || !trRef) {
        console.error("[StateManager] Critical references (layer, factory, or transformer) missing for restoreState.");
        return;
    }

    // Clear existing components and selections
    layerRef.find(".hmi-component").forEach((node) => node.destroy());
    trRef.nodes([]);

    // Restore tagDatabase from the saved state (ensure deep copy if state.tags might be mutated elsewhere)
    tagDatabase = JSON.parse(JSON.stringify(state.tags));

    // Recreate components from the saved state data
    state.components.forEach((componentData) => {
        if (!componentData.componentType) {
            console.warn(
                "[StateManager] Skipping component in restoreState due to missing componentType:",
                componentData,
            );
            return; // Skip this component
        }
        try {
            const component = componentFactoryRef.create(
                componentData.componentType,
                componentData, // Pass all saved attributes including x, y, id
            );
            if (component) {
                layerRef.add(component);
            } else {
                console.warn(
                    `[StateManager] Failed to create component of type ${componentData.componentType} during restoreState. Factory returned null/undefined.`,
                );
            }
        } catch (e) {
            console.error(`[StateManager] Error creating component type ${componentData.componentType} during restoreState:`, e, "Component Data:", componentData);
        }
    });

    updateUndoRedoButtons();
    layerRef.batchDraw(); // Repaint the layer after restoring components
}

/**
 * Handles the "undo" action.
 * If `undoStack` has states to revert to (more than the initial state):
 * 1. Pops the current state from `undoStack`.
 * 2. Pushes this popped (current) state onto `redoStack`.
 * 3. Retrieves the new last state from `undoStack` (the state to revert to).
 * 4. Calls `restoreState()` with this retrieved state.
 * Does nothing if `undoStack` has one or zero elements (initial empty state).
 */
export function handleUndo() {
    if (undoStack.length <= 1) { // Cannot undo the initial empty state
        console.log("[StateManager] Undo stack empty or at initial state. Nothing to undo.");
        return;
    }
    const currentState = undoStack.pop();
    if (currentState) { // Ensure pop was successful
        redoStack.push(currentState);
        const lastState = undoStack[undoStack.length - 1];
        if (lastState) {
            restoreState(lastState);
        } else {
            console.error("[StateManager] Undo resulted in an empty previous state in undoStack.");
        }
    } else {
        console.error("[StateManager] Failed to pop current state from undoStack.");
    }
}

/**
 * Handles the "redo" action.
 * If `redoStack` has states:
 * 1. Pops the next state from `redoStack`.
 * 2. Pushes this state onto `undoStack` (it's now the current state).
 * 3. Calls `restoreState()` with this state.
 * Does nothing if `redoStack` is empty.
 */
export function handleRedo() {
    if (redoStack.length === 0) {
        console.log("[StateManager] Redo stack empty. Nothing to redo.");
        return;
    }
    const nextState = redoStack.pop();
    if (nextState) { // Ensure pop was successful
        undoStack.push(nextState);
        restoreState(nextState);
    } else {
        console.error("[StateManager] Failed to pop next state from redoStack.");
    }
}

/**
 * Returns the current state of the application as a stringified JSON object.
 * Captures HMI components and `tagDatabase` state, similar to `saveState()`,
 * but does *not* modify `undoStack`, `redoStack`, or project dirty status.
 * Useful for exporting or providing context (e.g., to AI assistant)
 * without affecting undo/redo history.
 *
 * @returns {string} Stringified JSON of current state (`{ components: [], tags: {} }`).
 *                   Returns minimal empty state string on error or if `layerRef` is unavailable.
 */
export function getCurrentState() {
    const state = {
        components: [],
        tags: JSON.parse(JSON.stringify(tagDatabase)) // Deep copy
    };

    if (layerRef) {
        layerRef.find(".hmi-component").forEach((node) => {
            const attrsToSave = { ...node.attrs };
            const componentData = {
                id: node.id(),
                x: node.x(),
                y: node.y(),
                ...attrsToSave,
            };

            if (!componentData.componentType) {
                console.warn(
                    `[StateManager] Component with ID ${node.id()} is missing componentType in attrs during getCurrentState. Setting to 'Unknown'.`,
                );
                componentData.componentType = "Unknown";
            }
            state.components.push(componentData);
        });
    } else {
        console.warn(
            "[StateManager] layerRef not available for getCurrentState. Component state will be empty.",
        );
    }

    try {
        return JSON.stringify(state);
    } catch (error) {
        console.error("[StateManager] Error stringifying current state:", error);
        return JSON.stringify({ components: [], tags: {} }); // Fallback to minimal valid state
    }
}

/**
 * Updates the enabled/disabled state of the undo and redo UI buttons.
 * - Undo button disabled if `undoStack` has <= 1 state (initial state not undoable).
 * - Redo button disabled if `redoStack` is empty.
 * Relies on `undoBtnRef` and `redoBtnRef` being initialized.
 */
export function updateUndoRedoButtons() {
    if (undoBtnRef) {
        undoBtnRef.disabled = undoStack.length <= 1;
    } else {
        // console.warn("[StateManager] undoBtnRef not available for updateUndoRedoButtons.");
    }
    if (redoBtnRef) {
        redoBtnRef.disabled = redoStack.length === 0;
    } else {
        // console.warn("[StateManager] redoBtnRef not available for updateUndoRedoButtons.");
    }
}

// --- Device Variable State Management (Tag Database) ---

/**
 * Retrieves the current value of a specific variable for a device from `tagDatabase`.
 * `tagDatabase` structure: `tagDatabase[deviceId][variableName]`.
 *
 * @param {string} deviceId - ID of the device.
 * @param {string} variableName - Name of the variable.
 * @returns {*} The variable's current value, or `undefined` if not found.
 */
export function getDeviceVariableValue(deviceId, variableName) {
    if (tagDatabase[deviceId] && typeof tagDatabase[deviceId] === 'object') {
        return tagDatabase[deviceId][variableName];
    }
    return undefined;
}

/**
 * Sets the value of a specific device variable in `tagDatabase`.
 * After updating, it iterates through HMI components on `layerRef`. If a component
 * is linked to the specified `deviceId` and `variableName`, its `updateState()`
 * method is called to refresh its visual representation.
 * Also calls `updateLiveVariableValueInManagerUI` to update the Device Manager UI.
 *
 * @param {string} deviceId - ID of the device.
 * @param {string} variableName - Name of the variable to update.
 * @param {*} value - The new value for the variable.
 */
export function setDeviceVariableValue(deviceId, variableName, value) {
    if (typeof deviceId !== 'string' || typeof variableName !== 'string') {
        console.error("[StateManager] Invalid deviceId or variableName for setDeviceVariableValue.", { deviceId, variableName });
        return;
    }

    if (!tagDatabase[deviceId]) {
        tagDatabase[deviceId] = {};
    }
    // const oldValue = tagDatabase[deviceId][variableName]; // For debugging if needed
    tagDatabase[deviceId][variableName] = value;

    // console.debug(
    //     `[StateManager] Set variable: Device ${deviceId}, Var ${variableName} = ${value} (Old: ${oldValue})`
    // );

    // Notify relevant HMI components on the Konva layer to update their visual state.
    if (layerRef) {
        // let foundComponent = false; // For debugging specific component updates
        layerRef.find(".hmi-component").forEach((node) => {
            if (
                node.attrs.deviceId === deviceId &&
                node.attrs.variableName === variableName
            ) {
                // foundComponent = true;
                // console.log( // For debugging specific component updates
                //     `[StateManager] Notifying component ID ${node.id()} (Type: ${node.attrs.componentType}) for ${deviceId}.${variableName}`
                // );
                node.updateState?.(); // Call the component's own updateState method.
            }
        });
        // if (!foundComponent) { // For debugging if no component seems to update
        //     console.log(
        //         `[StateManager] No component found on layer matching update for DeviceID: ${deviceId}, VarName: ${variableName}.`
        //     );
        // }
    } else {
        console.warn(
            "[StateManager] layerRef is not available. Cannot notify components to update.",
        );
    }

    // Attempt to update the value in the Variable Manager UI if it's open
    if (typeof updateLiveVariableValueInManagerUI === "function") {
        updateLiveVariableValueInManagerUI(deviceId, variableName, value);
    } else {
        console.warn(
            "updateLiveVariableValueInManagerUI is not available to stateManager at this point.",
        );
    }
}

/**
 * Deletes all variable states associated with a given `deviceId` from the `tagDatabase`.
 * This is typically called when a device is removed from the system.
 *
 * @export
 * @param {string} deviceId - The ID of the device whose entire variable state (all its variables)
 *                            should be removed from the `tagDatabase`.
 */
export function deleteDeviceState(deviceId) {
    if (tagDatabase[deviceId]) {
        delete tagDatabase[deviceId];
        // console.log(`State for device ${deviceId} deleted from tagDatabase.`);
    }
}

/**
 * Deletes the state (value) for a specific variable of a given device from the `tagDatabase`.
 * This is useful if a variable is removed from a device's configuration.
 *
 * @export
 * @param {string} deviceId - The ID of the device.
 * @param {string} variableName - The name of the variable whose state should be deleted
 *                                from the specified device's entry in the `tagDatabase`.
 */
export function deleteDeviceVariableState(deviceId, variableName) {
    if (
        tagDatabase[deviceId] &&
        tagDatabase[deviceId].hasOwnProperty(variableName)
    ) {
        delete tagDatabase[deviceId][variableName];
        // console.log(`State for variable ${variableName} of device ${deviceId} deleted from tagDatabase.`);
    }
}

// --- Legacy Address-Based Functions (To be phased out) ---
// The following functions operate on an older, flat address-based system for accessing tag values.
// This system is being replaced by the more robust `deviceId` and `variableName` based approach.
// These functions are maintained for temporary backward compatibility with any components
// that have not yet been updated to use the new system.
// **AVOID USING THESE FUNCTIONS FOR NEW DEVELOPMENT OR WHEN UPDATING COMPONENTS.**

/**
 * LEGACY FUNCTION: Retrieves a component's value based on a direct, flat address string.
 * This function attempts to read directly from the root of the `tagDatabase` using the
 * provided `address` as the key. This is problematic as it can conflict with `deviceId` keys
 * in the new system and may lead to incorrect data retrieval or `undefined` values.
 *
 * @deprecated This function is deprecated. Use {@link getDeviceVariableValue} instead,
 *             which uses a `deviceId` and `variableName` for safer and more accurate data access.
 * @export
 * @param {string} address - The legacy address string used as a key in the `tagDatabase`.
 * @returns {*} The value associated with the `address` in the `tagDatabase`, or `undefined` if not found or if conflicts occur.
 */
export function getComponentAddressValue(address) {
    console.warn(
        "[DEPRECATED] getComponentAddressValue called. Please update to use getDeviceVariableValue(deviceId, variableName). This function may not work correctly with the new device-scoped tagDatabase.",
    );
    // This attempts to read from the root of tagDatabase, which might conflict with deviceId keys.
    // This will likely return undefined or incorrect data if tagDatabase is purely device-scoped.
    return tagDatabase[address];
}

/**
 * LEGACY FUNCTION: Sets a component's value based on a direct, flat address string.
 * If a `deviceId` (other than "_global") is provided, this function attempts to map
 * the call to the new `setDeviceVariableValue` function, assuming the `address`
 * parameter corresponds to the `variableName`.
 * If no `deviceId` or "_global" is provided, it writes directly to the root of the
 * `tagDatabase` using `address` as the key. This is highly problematic as it can
 * overwrite entire device-specific variable objects if the `address` happens to
 * match a `deviceId`.
 *
 * @deprecated This function is deprecated. Use {@link setDeviceVariableValue} instead,
 *             providing both `deviceId` and `variableName` for safe and correct updates.
 * @export
 * @param {string} address - The legacy address string.
 * @param {*} value - The value to set for the given address.
 * @param {string} [deviceId="_global"] - An optional device ID. If provided and not "_global",
 *                                        the function will attempt to use the new system with
 *                                        `address` as `variableName`.
 */
export function setComponentAddressValue(address, value, deviceId = "_global") {
    // Legacy support
    console.warn(
        `[DEPRECATED] setComponentAddressValue called for address: ${address}. Please update to use setDeviceVariableValue(deviceId, variableName).`,
    );
    if (deviceId && deviceId !== "_global") {
        // If a deviceId is provided, try to use the new system, assuming 'address' might be the 'variableName'.
        console.warn(
            `Attempting to map legacy setComponentAddressValue(address="${address}") to setDeviceVariableValue(deviceId="${deviceId}", variableName="${address}"). Ensure this mapping is correct for your component.`,
        );
        setDeviceVariableValue(deviceId, address, value); // Assuming address is variableName in this context
    } else {
        // If truly global or no deviceId, this writes to the root of tagDatabase.
        // This is problematic as it can overwrite device-specific objects if 'address' collides with a 'deviceId'.
        console.error(
            `[DANGEROUS OPERATION] Legacy setComponentAddressValue is writing to tagDatabase['${address}']. This can corrupt device-specific data if '${address}' matches a device ID. This functionality will be removed.`,
        );
        tagDatabase[address] = value; // Highly problematic: can overwrite an entire device's variable object
    }
}
