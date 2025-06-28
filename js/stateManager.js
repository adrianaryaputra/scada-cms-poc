/**
 * stateManager.js - Manages the application's state, including HMI component configurations,
 * device variable values (tagDatabase), and undo/redo functionality.
 */

// Module-level variables for state management
let undoStack = []; // Stores snapshots of application state for undo operations
let redoStack = []; // Stores snapshots for redo operations
let tagDatabase = {}; // Stores current values of device variables: { deviceId: { variableName: value } }

// References to other modules and DOM elements, initialized in initStateManager
let componentFactoryRef;
let layerRef; // Konva layer reference
let trRef;    // Konva transformer reference
let undoBtnRef; // DOM reference to the undo button
let redoBtnRef; // DOM reference to the redo button

/**
 * Initializes the state manager with necessary references.
 * @param {object} factory - Reference to the componentFactory.
 * @param {object} layer - Reference to the Konva layer.
 * @param {object} tr - Reference to the Konva transformer.
 * @param {HTMLElement} undoBtn - DOM element for the undo button.
 * @param {HTMLElement} redoBtn - DOM element for the redo button.
 * @param {function} getDeviceByIdFunc - Function to get device details by ID (currently unused here but kept for potential future use).
 */
export function initStateManager(factory, layer, tr, undoBtn, redoBtn, getDeviceByIdFunc) {
    componentFactoryRef = factory;
    layerRef = layer;
    trRef = tr;
    undoBtnRef = undoBtn;
    redoBtnRef = redoBtn;
    // Note: getDeviceByIdFunc is passed but not currently used within stateManager.
    // It's kept in the signature for potential future enhancements where state logic might need device-specific info.

    saveState(); // Save the initial (empty) state
    updateUndoRedoButtons();
}

/**
 * Returns the current tagDatabase.
 * @returns {object} The current tag database.
 */
export function getTagDatabase() {
    return tagDatabase;
}

/**
 * Returns the current undo stack.
 * @returns {Array<string>} The undo stack (array of stringified states).
 */
export function getUndoStack() {
    return undoStack;
}

/**
 * Returns the current redo stack.
 * @returns {Array<string>} The redo stack.
 */
export function getRedoStack() {
    return redoStack;
}

/**
 * Saves the current state of HMI components and the tagDatabase to the undo stack.
 * Clears the redo stack.
 */
export function saveState() {
    const state = { components: [], tags: { ...tagDatabase } }; // Deep copy tags
    if (layerRef) {
        layerRef.find(".hmi-component").forEach((node) => {
            // Extract relevant attributes for serialization.
            // Note: 'address' is saved for legacy reasons or components not yet fully using deviceId/variableName.
            // Prefer deviceId and variableName for new components.
            const componentAttrs = {
                componentType: node.attrs.componentType,
                deviceId: node.attrs.deviceId,         // Preferred
                variableName: node.attrs.variableName, // Preferred
                address: node.attrs.address,           // Legacy/Fallback
                label: node.attrs.label,
                shapeType: node.attrs.shapeType,
                offColor: node.attrs.offColor,
                onColor: node.attrs.onColor,
                offText: node.attrs.offText,
                onText: node.attrs.onText,
                states: node.attrs.states, // For components like WordLamp
                units: node.attrs.units,
                decimalPlaces: node.attrs.decimalPlaces,
                // Attributes for LabelComponent
                text: node.attrs.text,
                fontSize: node.attrs.fontSize,
                fill: node.attrs.fill,
                width: node.attrs.width,
                align: node.attrs.align,
            };

            const componentData = {
                id: node.id(),
                x: node.x(),
                y: node.y(),
                ...componentAttrs,
            };
            // Remove undefined properties to keep the state clean
            Object.keys(componentData).forEach(
                (key) => componentData[key] === undefined && delete componentData[key]
            );
            state.components.push(componentData);
        });
    }
    undoStack.push(JSON.stringify(state));
    redoStack = []; // Any new state change clears the redo stack
    updateUndoRedoButtons();
    // console.log("State saved. Undo stack size:", undoStack.length);
}

/**
 * Restores the application state from a given state string (typically from undo/redo stack).
 * @param {string} stateString - The stringified state to restore.
 */
export function restoreState(stateString) {
    const state = JSON.parse(stateString);
    // const oldTagDatabase = { ...tagDatabase }; // Kept for potential comparison if needed for complex migrations

    if (layerRef && componentFactoryRef && trRef) {
        // Clear existing components and selections
        layerRef.find(".hmi-component").forEach((node) => node.destroy());
        trRef.nodes([]); // Clear transformer selection

        tagDatabase = { ...state.tags }; // Restore tagDatabase from the saved state

        // Recreate components from the saved state data
        state.components.forEach((componentData) => {
            const component = componentFactoryRef.create(
                componentData.componentType,
                componentData // Pass all saved attributes including x, y, id
            );
            if (component) {
                layerRef.add(component);
            }
        });
        // Note: Client-side MQTT subscription logic was previously here but has been removed.
        // The server now manages MQTT subscriptions based on device configurations and client requests.
    }
    updateUndoRedoButtons();
    // Repaint the layer after restoring components
    if (layerRef) layerRef.batchDraw();
}

/**
 * Handles the undo action. Restores the previous state from the undo stack.
 */
export function handleUndo() {
    if (undoStack.length <= 1) return; // Cannot undo the initial empty state
    const currentState = undoStack.pop();
    redoStack.push(currentState);
    const lastState = undoStack[undoStack.length - 1];
    restoreState(lastState);
    // console.log("Undo. Undo stack size:", undoStack.length, "Redo stack size:", redoStack.length);
}

/**
 * Handles the redo action. Restores the next state from the redo stack.
 */
export function handleRedo() {
    if (redoStack.length === 0) return; // Nothing to redo
    const nextState = redoStack.pop();
    undoStack.push(nextState);
    restoreState(nextState);
    // console.log("Redo. Undo stack size:", undoStack.length, "Redo stack size:", redoStack.length);
}

/**
 * Returns the current state of the application as a stringified JSON.
 * (Similar to saveState but doesn't modify undo/redo stacks)
 * @returns {string} Stringified current state.
 */
export function getCurrentState() {
    const state = { components: [], tags: { ...tagDatabase } };
     if (layerRef) {
        layerRef.find(".hmi-component").forEach((node) => {
            const componentAttrs = {
                componentType: node.attrs.componentType,
                deviceId: node.attrs.deviceId,
                variableName: node.attrs.variableName,
                address: node.attrs.address, // Legacy
                label: node.attrs.label,
                shapeType: node.attrs.shapeType,
                offColor: node.attrs.offColor,
                onColor: node.attrs.onColor,
                offText: node.attrs.offText,
                onText: node.attrs.onText,
                states: node.attrs.states,
                units: node.attrs.units,
                decimalPlaces: node.attrs.decimalPlaces,
                text: node.attrs.text,
                fontSize: node.attrs.fontSize,
                fill: node.attrs.fill,
                width: node.attrs.width,
                align: node.attrs.align,
            };
            const componentData = {
                id: node.id(),
                x: node.x(),
                y: node.y(),
                ...componentAttrs,
            };
            Object.keys(componentData).forEach(
                (key) => componentData[key] === undefined && delete componentData[key]
            );
            state.components.push(componentData);
        });
    }
    return JSON.stringify(state);
}

/**
 * Updates the enabled/disabled state of undo/redo buttons based on stack sizes.
 */
export function updateUndoRedoButtons() {
    if (undoBtnRef && redoBtnRef) {
        undoBtnRef.disabled = undoStack.length <= 1; // Initial state is not undoable
        redoBtnRef.disabled = redoStack.length === 0;
    }
}

// --- Device Variable State Management (Modern Approach) ---

/**
 * Gets the value of a specific variable for a given device.
 * @param {string} deviceId - The ID of the device.
 * @param {string} variableName - The name of the variable.
 * @returns {*} The value of the variable, or undefined if not found.
 */
export function getDeviceVariableValue(deviceId, variableName) {
    if (tagDatabase[deviceId]) {
        return tagDatabase[deviceId][variableName];
    }
    return undefined;
}

/**
 * Sets the value of a specific variable for a given device in the tagDatabase.
 * Notifies relevant HMI components to update their state.
 * @param {string} deviceId - The ID of the device.
 * @param {string} variableName - The name of the variable.
 * @param {*} value - The new value of the variable.
 */
export function setDeviceVariableValue(deviceId, variableName, value) {
    if (!tagDatabase[deviceId]) {
        tagDatabase[deviceId] = {};
    }
    tagDatabase[deviceId][variableName] = value;
    // console.debug(`Set variable value: Device ${deviceId}, Var ${variableName} =`, value);

    // Notify relevant HMI components on the Konva layer to update their visual state.
    // This implements a simple observer pattern: stateManager is the subject, components are observers.
    if (layerRef) {
        layerRef.find('.hmi-component').forEach(node => {
            // Components are expected to have deviceId and variableName attributes if they bind to device data.
            if (node.attrs.deviceId === deviceId && node.attrs.variableName === variableName) {
                node.updateState?.(); // Call the component's own updateState method, if it exists.
            }
        });
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
    if (tagDatabase[deviceId] && tagDatabase[deviceId].hasOwnProperty(variableName)) {
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
    console.warn("[DEPRECATED] getComponentAddressValue called. Please update to use getDeviceVariableValue(deviceId, variableName). This function may not work correctly with the new device-scoped tagDatabase.");
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
export function setComponentAddressValue(address, value, deviceId = "_global") { // Legacy support
    console.warn(`[DEPRECATED] setComponentAddressValue called for address: ${address}. Please update to use setDeviceVariableValue(deviceId, variableName).`);
    if (deviceId && deviceId !== "_global") {
        // If a deviceId is provided, try to use the new system, assuming 'address' might be the 'variableName'.
        console.warn(`Attempting to map legacy setComponentAddressValue(address="${address}") to setDeviceVariableValue(deviceId="${deviceId}", variableName="${address}"). Ensure this mapping is correct.`);
        setDeviceVariableValue(deviceId, address, value);
    } else {
        // If truly global or no deviceId, this writes to the root of tagDatabase.
        // This is problematic as it can overwrite device-specific objects if 'address' collides with a 'deviceId'.
        console.error(`[DANGEROUS] Legacy setComponentAddressValue is writing to tagDatabase['${address}']. This can corrupt device-specific data if '${address}' matches a device ID. This functionality will be removed.`);
        tagDatabase[address] = value;
    }
}