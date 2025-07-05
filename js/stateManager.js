/**
 * @file Manages the application's state, including HMI component configurations,
 * device variable values (tagDatabase), and undo/redo functionality.
 *
 * The state managed by this module primarily consists of:
 * 1.  **HMI Component Configurations**: The properties and layout of all HMI components
 *     currently on the Konva.js canvas. This includes their type, position (x, y),
 *     unique ID, and other specific attributes (e.g., colors, text, linked device/variable).
 * 2.  **Device Variable Values (Tag Database)**: A live record of the current values
 *     for variables associated with configured devices. This acts as a client-side
 *     cache of device data.
 *
 * The module provides mechanisms to:
 * - Save snapshots of the current application state (components + tags).
 * - Restore the application to a previously saved state.
 * - Implement undo and redo functionality based on these state snapshots.
 * - Get and set individual device variable values, triggering UI updates for
 *   linked HMI components.
 *
 * It interacts closely with `componentFactory` (for recreating components during state restoration),
 * `konvaManager` (indirectly, via layer and transformer references, to access HMI components),
 * `deviceManager` (to update live variable displays in the UI), and `ProjectManager`
 * (to mark the project as "dirty" when state changes).
 * @module js/stateManager
 */

import { updateLiveVariableValueInManagerUI } from "./deviceManager.js";
import ProjectManager from "./projectManager.js";

// --- Module-Level State Variables ---

/**
 * Stores snapshots of the application state (as stringified JSON) for undo operations.
 * Each element in the array represents a previous state of the HMI components and tagDatabase.
 * @private
 * @type {Array<string>}
 */
let undoStack = [];

/**
 * Stores snapshots of the application state (as stringified JSON) for redo operations.
 * This stack is populated when an undo action is performed.
 * @private
 * @type {Array<string>}
 */
let redoStack = [];

/**
 * A live database (object) storing the current values of all device variables (tags).
 * The structure is hierarchical: `tagDatabase[deviceId][variableName] = value`.
 * This object is updated by `setDeviceVariableValue` and read by `getDeviceVariableValue`
 * and HMI components.
 * @private
 * @type {Object<string, Object<string, *>>}
 */
let tagDatabase = {};

// --- References to other modules and DOM elements ---
// These are initialized by `initStateManager`.

/**
 * Reference to the componentFactory module.
 * @private
 * @type {object}
 */
let componentFactoryRef;
/**
 * Reference to the main Konva.Layer where HMI components are drawn.
 * @private
 * @type {Konva.Layer}
 */
let layerRef;
/**
 * Reference to the Konva.Transformer used for selecting and manipulating components.
 * @private
 * @type {Konva.Transformer}
 */
let trRef;
/**
 * Reference to the DOM element for the Undo button.
 * @private
 * @type {HTMLElement}
 */
let undoBtnRef;
/**
 * Reference to the DOM element for the Redo button.
 * @private
 * @type {HTMLElement}
 */
let redoBtnRef;

// --- Initialization ---

/**
 * Initializes the StateManager with necessary references from other modules (like `componentFactory`)
 * and Konva objects (main layer, transformer). It also takes references to the undo and redo
 * button DOM elements to manage their enabled/disabled states.
 * This function should be called once during application startup.
 * An initial state (typically empty) is saved to start the undo history.
 *
 * @export
 * @param {object} factory - Reference to the `componentFactory` module, used for recreating components
 *                           when restoring a state.
 * @param {Konva.Layer} layer - Reference to the main Konva.Layer where HMI components are rendered.
 *                              Used for accessing components to save or restore their state.
 * @param {Konva.Transformer} tr - Reference to the Konva.Transformer used for component selection.
 *                                 Needed to clear selections when restoring state.
 * @param {HTMLElement} undoBtn - The DOM element for the application's undo button.
 * @param {HTMLElement} redoBtn - The DOM element for the application's redo button.
 */
export function initStateManager(factory, layer, tr, undoBtn, redoBtn) {
    componentFactoryRef = factory;
    layerRef = layer;
    trRef = tr;
    undoBtnRef = undoBtn;
    redoBtnRef = redoBtn;

    saveState(); // Save the initial (empty) state of the application.
    updateUndoRedoButtons(); // Update UI buttons based on initial stack state.
}

// --- Getters for State Data ---

/**
 * Returns a reference to the current `tagDatabase` object.
 * The `tagDatabase` stores the live values of device variables, structured as:
 * `{ deviceId: { variableName1: value1, variableName2: value2, ... }, ... }`.
 *
 * @export
 * @returns {Object<string, Object<string, *>>} The current tag database.
 */
export function getTagDatabase() {
    return tagDatabase;
}

/**
 * Returns the current undo stack. Each element in the array is a stringified JSON
 * representation of a past application state (HMI components and tagDatabase).
 * This can be useful for debugging or for more advanced state manipulation features.
 *
 * @export
 * @returns {Array<string>} The undo stack, where each element is a JSON string of a past state.
 */
export function getUndoStack() {
    return undoStack;
}

/**
 * Returns the current redo stack. Each element is a stringified JSON representation
 * of a "future" state that was undone. This stack is populated when `handleUndo` is called.
 *
 * @export
 * @returns {Array<string>} The redo stack, where each element is a JSON string of a state that can be redone.
 */
export function getRedoStack() {
    return redoStack;
}

// --- Core State Manipulation: Save, Restore, Undo, Redo ---

/**
 * Saves the current application state to the undo stack.
 * The state captured includes:
 * 1.  A list of all HMI components on the Konva layer, serializing their `id`, `x`, `y`
 *     coordinates, and all other attributes (`node.attrs`). This includes `componentType`,
 *     `deviceId`, `variableName`, and any component-specific properties.
 * 2.  A deep copy of the current `tagDatabase`, which holds the live values of device variables.
 *
 * When a new state is saved:
 * - The `redoStack` is cleared, as any previous "redo" path is invalidated.
 * - The undo/redo UI buttons are updated to reflect the new stack sizes.
 * - The project is marked as "dirty" via `ProjectManager.setDirty(true)`.
 *
 * This function is crucial for the undo/redo mechanism and for ensuring that changes
 * can be reverted. It should be called after any significant user action that modifies
 * the HMI layout, component properties, or potentially when important tag values change
 * programmatically if that change should be undoable (though typically tag changes from
 * devices are not added to the undo stack directly by this function).
 *
 * @export
 */
export function saveState() {
    const state = { components: [], tags: { ...tagDatabase } }; // Deep copy tags for snapshot
    if (layerRef) {
        layerRef.find(".hmi-component").forEach((node) => {
            const attrsToSave = { ...node.attrs };
            // Future: Exclude any large or unserializable Konva internal properties if necessary.
            // delete attrsToSave.someKonvaInternalProperty;

            const componentData = {
                id: node.id(),
                x: node.x(),
                y: node.y(),
                ...attrsToSave, // Includes componentType, deviceId, variableName, etc.
            };

            if (!componentData.componentType) {
                console.warn(
                    `Component with ID ${node.id()} is missing componentType in attrs during saveState. Setting to 'Unknown'.`,
                );
                componentData.componentType = "Unknown";
            }
            state.components.push(componentData);
        });
    }
    undoStack.push(JSON.stringify(state));
    redoStack = []; // Any new state change clears the redo stack
    updateUndoRedoButtons();

    if (ProjectManager && typeof ProjectManager.setDirty === "function") {
        ProjectManager.setDirty(true);
    }
}

/**
 * Restores the application state from a given state string.
 * This function is used by the undo/redo system and when loading a project.
 * The process involves:
 * 1.  Parsing the `stateString` (expected to be JSON) into a state object.
 *     The state object should contain `components` (array) and `tags` (object).
 * 2.  Clearing all existing HMI components from the Konva layer and clearing any
 *     active selections in the transformer.
 * 3.  Restoring the `tagDatabase` with the `tags` data from the parsed state.
 * 4.  Iterating through the `components` data from the parsed state and recreating
 *     each HMI component using `componentFactoryRef.create()`.
 * 5.  Updating the undo/redo button states and repainting the Konva layer.
 *
 * If the `stateString` is invalid or critical references (like `layerRef` or
 * `componentFactoryRef`) are missing, an error is logged, and the restoration is aborted.
 *
 * @export
 * @param {string} stateString - A stringified JSON object representing the application state
 *                               to restore. This string should conform to the structure saved
 *                               by `saveState()` or `getCurrentState()`.
 */
export function restoreState(stateString) {
    try {
        const state = JSON.parse(stateString);
        if (
            !state ||
            typeof state.components === "undefined" ||
            typeof state.tags === "undefined"
        ) {
            console.error(
                "[StateManager] Invalid state string provided to restoreState:",
                stateString,
            );
            return;
        }

        if (layerRef && componentFactoryRef && trRef) {
            // Clear existing components and selections
            layerRef.find(".hmi-component").forEach((node) => node.destroy());
            trRef.nodes([]); // Clear transformer selection

            tagDatabase = { ...state.tags }; // Restore tagDatabase from the saved state

            // Recreate components from the saved state data
            state.components.forEach((componentData) => {
                if (!componentData.componentType) {
                    console.warn(
                        "[StateManager] Skipping component in restoreState due to missing componentType:",
                        componentData,
                    );
                    return;
                }
                const component = componentFactoryRef.create(
                    componentData.componentType,
                    componentData, // Pass all saved attributes including x, y, id
                );
                if (component) {
                    layerRef.add(component);
                } else {
                    console.warn(
                        `[StateManager] Failed to create component of type ${componentData.componentType} during restoreState.`,
                    );
                }
            });
        } else {
            console.error(
                "[StateManager] Critical references (layer, factory, transformer) missing for restoreState.",
            );
        }
        updateUndoRedoButtons();
        if (layerRef) layerRef.batchDraw(); // Repaint the layer after restoring components
    } catch (error) {
        console.error(
            "[StateManager] Error parsing or restoring state:",
            error,
            "State string:",
            stateString,
        );
        // Potentially notify user of failed state restoration
    }
}

/**
 * Handles the "undo" action.
 * If there are states in the `undoStack` (beyond the initial state), this function:
 * 1.  Removes (pops) the current state from the `undoStack`.
 * 2.  Pushes this removed (current) state onto the `redoStack`.
 * 3.  Retrieves the new last state from the `undoStack` (which is the state to revert to).
 * 4.  Calls `restoreState()` with this retrieved state to update the application.
 * It does nothing if the `undoStack` has one or zero elements, as the initial empty
 * state cannot be undone further.
 *
 * @export
 */
export function handleUndo() {
    if (undoStack.length <= 1) return; // Cannot undo the initial empty state
    const currentState = undoStack.pop();
    redoStack.push(currentState);
    const lastState = undoStack[undoStack.length - 1];
    restoreState(lastState);
}

/**
 * Handles the "redo" action.
 * If there are states in the `redoStack`, this function:
 * 1.  Removes (pops) the next state from the `redoStack`.
 * 2.  Pushes this state onto the `undoStack` (as it's now the current state).
 * 3.  Calls `restoreState()` with this state to update the application.
 * It does nothing if the `redoStack` is empty.
 *
 * @export
 */
export function handleRedo() {
    if (redoStack.length === 0) return; // Nothing to redo
    const nextState = redoStack.pop();
    undoStack.push(nextState);
    restoreState(nextState);
}

/**
 * Returns the current state of the application as a stringified JSON object.
 * This function captures the current HMI components and `tagDatabase` state,
 * similar to `saveState()`, but it does *not* modify the `undoStack` or `redoStack`,
 * nor does it mark the project as dirty. This is primarily useful for operations
 * like exporting the current project or providing context to other modules (e.g., an AI assistant)
 * without affecting the undo/redo history.
 *
 * @export
 * @returns {string} A stringified JSON representation of the current application state.
 *                   Returns a stringified minimal empty state (`{ components: [], tags: {} }`)
 *                   if an error occurs during stringification or if `layerRef` is unavailable.
 */
export function getCurrentState() {
    const state = { components: [], tags: { ...tagDatabase } };
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
                    `Component with ID ${node.id()} is missing componentType in attrs during getCurrentState. Setting to 'Unknown'.`,
                );
                componentData.componentType = "Unknown";
            }
            state.components.push(componentData);
        });
    } else {
        console.warn(
            "[StateManager] layerRef not available for getCurrentState. State will be incomplete.",
        );
    }
    try {
        return JSON.stringify(state);
    } catch (error) {
        console.error(
            "[StateManager] Error stringifying current state:",
            error,
        );
        return JSON.stringify({ components: [], tags: {} }); // Return minimal valid state
    }
}

/**
 * Updates the enabled/disabled state of the undo and redo UI buttons.
 * The undo button is disabled if the `undoStack` contains one or fewer states (as the
 * initial empty state is not considered undoable). The redo button is disabled if the
 * `redoStack` is empty. This function relies on `undoBtnRef` and `redoBtnRef`
 * (references to the button DOM elements) being correctly initialized by `initStateManager`.
 *
 * @export
 */
export function updateUndoRedoButtons() {
    if (undoBtnRef && redoBtnRef) {
        undoBtnRef.disabled = undoStack.length <= 1; // Initial state is not undoable
        redoBtnRef.disabled = redoStack.length === 0;
    } else {
        // This might happen if called before initStateManager, though unlikely with current flow.
        // console.warn("[StateManager] Undo/Redo buttons not available for updateUndoRedoButtons.");
    }
}

// --- Device Variable State Management (Tag Database) ---

/**
 * Retrieves the current value of a specific variable for a given device from the `tagDatabase`.
 * The `tagDatabase` stores values in a nested structure: `tagDatabase[deviceId][variableName]`.
 *
 * @export
 * @param {string} deviceId - The ID of the device for which to retrieve the variable value.
 * @param {string} variableName - The name of the variable whose value is to be retrieved.
 * @returns {*} The current value of the variable. Returns `undefined` if the `deviceId`
 *              or `variableName` does not exist in the `tagDatabase`.
 */
export function getDeviceVariableValue(deviceId, variableName) {
    if (tagDatabase[deviceId]) {
        return tagDatabase[deviceId][variableName];
    }
    return undefined;
}

/**
 * Sets the value of a specific variable for a given device within the `tagDatabase`.
 * After updating the value in the `tagDatabase`, this function iterates through all
 * HMI components on the Konva layer. If a component is found to be linked to the
 * specified `deviceId` and `variableName` (via its `attrs`), its `updateState()`
 * method is called to refresh its visual representation.
 * Additionally, it calls `updateLiveVariableValueInManagerUI` to attempt to update
 * the value displayed in the Variable Manager UI, if it's open for that device.
 *
 * @export
 * @param {string} deviceId - The ID of the device for which the variable value is being set.
 * @param {string} variableName - The name of the variable to update.
 * @param {*} value - The new value for the variable.
 */
export function setDeviceVariableValue(deviceId, variableName, value) {
    if (!tagDatabase[deviceId]) {
        tagDatabase[deviceId] = {};
    }
    const oldValue = tagDatabase[deviceId][variableName];
    tagDatabase[deviceId][variableName] = value;

    // console.log( // Keep this for debugging real-time updates if needed
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
