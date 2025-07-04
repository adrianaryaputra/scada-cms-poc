/**
 * @file Manages the application's state, including HMI component configurations,
 * device variable values (tagDatabase), and undo/redo functionality.
 *
 * The state includes:
 * - HMI component configurations on the canvas.
 * - Current values of device variables (tags).
 *
 * Undo/redo functionality is based on snapshots of this state.
 */

import { updateLiveVariableValueInManagerUI } from "./deviceManager.js";
import ProjectManager from "./projectManager.js";

// --- Module-Level State Variables ---

/**
 * @type {Array<string>} Stores snapshots of application state (stringified JSON) for undo operations.
 */
let undoStack = [];

/**
 * @type {Array<string>} Stores snapshots of application state (stringified JSON) for redo operations.
 */
let redoStack = [];

/**
 * @type {Object<string, Object<string, any>>}
 * Stores current values of device variables.
 * Structure: { deviceId: { variableName: value, variableName2: value2, ... }, ... }
 */
let tagDatabase = {};

// --- References to other modules and DOM elements ---
// These are initialized by `initStateManager`.

/** @type {import('./componentFactory.js').ComponentFactory} */
let componentFactoryRef;
/** @type {Konva.Layer} */
let layerRef;
/** @type {Konva.Transformer} */
let trRef;
/** @type {HTMLElement} */
let undoBtnRef;
/** @type {HTMLElement} */
let redoBtnRef;

// --- Initialization ---

/**
 * Initializes the StateManager with necessary references from other modules and DOM.
 * This function should be called once when the application starts.
 * @param {import('./componentFactory.js').ComponentFactory} factory - Reference to the componentFactory.
 * @param {Konva.Layer} layer - Reference to the Konva layer where HMI components are rendered.
 * @param {Konva.Transformer} tr - Reference to the Konva transformer for selected components.
 * @param {HTMLElement} undoBtn - DOM element for the undo button.
 * @param {HTMLElement} redoBtn - DOM element for the redo button.
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
 * Returns the current tagDatabase containing live variable values.
 * @returns {Object<string, Object<string, any>>} The current tag database.
 */
export function getTagDatabase() {
    return tagDatabase;
}

/**
 * Returns the current undo stack, containing stringified past states.
 * Useful for debugging or advanced state manipulation (e.g., AI assistant).
 * @returns {Array<string>} The undo stack.
 */
export function getUndoStack() {
    return undoStack;
}

/**
 * Returns the current redo stack, containing stringified future states (if any undo actions were performed).
 * @returns {Array<string>} The redo stack.
 */
export function getRedoStack() {
    return redoStack;
}

// --- Core State Manipulation: Save, Restore, Undo, Redo ---

/**
 * Saves the current state of all HMI components and the tagDatabase to the undo stack.
 * This action clears the redo stack, as a new timeline is started.
 * It also marks the project as "dirty" (requiring a save).
 *
 * The state includes component properties (id, x, y, and all attributes from `node.attrs`)
 * and a deep copy of the `tagDatabase`.
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
 * Restores the application state from a given state string (typically from the undo/redo stack or a loaded project).
 * This involves clearing existing components, recreating components from the saved state,
 * and restoring the `tagDatabase`.
 * @param {string} stateString - The stringified JSON state to restore.
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
 * Handles the undo action. Pops the current state from the undo stack, pushes it to the redo stack,
 * and restores the new last state from the undo stack.
 * Does nothing if there's only one state (the initial one) in the undo stack.
 */
export function handleUndo() {
    if (undoStack.length <= 1) return; // Cannot undo the initial empty state
    const currentState = undoStack.pop();
    redoStack.push(currentState);
    const lastState = undoStack[undoStack.length - 1];
    restoreState(lastState);
}

/**
 * Handles the redo action. Pops a state from the redo stack, pushes it to the undo stack,
 * and restores this state.
 * Does nothing if the redo stack is empty.
 */
export function handleRedo() {
    if (redoStack.length === 0) return; // Nothing to redo
    const nextState = redoStack.pop();
    undoStack.push(nextState);
    restoreState(nextState);
}

/**
 * Returns the current state of the application as a stringified JSON.
 * This is similar to `saveState` in terms of data capture but does not modify the undo/redo stacks
 * or mark the project as dirty. Useful for exporting or AI context.
 * @returns {string} Stringified JSON representing the current application state. Returns an empty state string on error.
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
 * Updates the enabled/disabled state of undo and redo buttons
 * based on the current sizes of the undo and redo stacks.
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
 * Gets the value of a specific variable for a given device from the `tagDatabase`.
 * @param {string} deviceId - The ID of the device.
 * @param {string} variableName - The name of the variable.
 * @returns {*} The value of the variable, or `undefined` if the device or variable is not found.
 */
export function getDeviceVariableValue(deviceId, variableName) {
    if (tagDatabase[deviceId]) {
        return tagDatabase[deviceId][variableName];
    }
    return undefined;
}

/**
 * Sets the value of a specific variable for a given device in the `tagDatabase`.
 * This function also triggers an update for any HMI components on the Konva layer
 * that are bound to this `deviceId` and `variableName` by calling their `updateState` method.
 * Additionally, it attempts to update the live value in the Variable Manager UI.
 * @param {string} deviceId - The ID of the device.
 * @param {string} variableName - The name of the variable.
 * @param {*} value - The new value of the variable.
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
 * Deletes all state (all variables) for a given device from the tagDatabase.
 * @param {string} deviceId - The ID of the device whose state is to be deleted.
 */
export function deleteDeviceState(deviceId) {
    if (tagDatabase[deviceId]) {
        delete tagDatabase[deviceId];
        // console.log(`State for device ${deviceId} deleted from tagDatabase.`);
    }
}

/**
 * Deletes the state for a specific variable of a given device from the tagDatabase.
 * @param {string} deviceId - The ID of the device.
 * @param {string} variableName - The name of the variable to delete.
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
// These functions operate on a flat address-based tag system and are being replaced by
// the deviceId/variableName-based system above.
// They are kept temporarily for backward compatibility or for components not yet updated.
// AVOID USING THESE FOR NEW DEVELOPMENT.

/**
 * LEGACY: Gets a component's value based on a direct address.
 * @deprecated Prefer getDeviceVariableValue.
 * @param {string} address - The legacy address.
 * @returns {*} The value at the address, or undefined.
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
 * LEGACY: Sets a component's value based on a direct address.
 * @deprecated Prefer setDeviceVariableValue.
 * @param {string} address - The legacy address.
 * @param {*} value - The value to set.
 * @param {string} [deviceId="_global"] - Optional deviceId; if provided and not "_global", will attempt to use setDeviceVariableValue.
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
