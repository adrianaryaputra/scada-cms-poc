/**
 * @file Manages UI elements, interactions, context menus, mode toggling,
 * project management modals, and notifications for the HMI application.
 * @module js/uiManager
 *
 * @description
 * The UIManager is responsible for:
 * - Caching DOM elements for efficient access.
 * - Setting up and managing event listeners for various UI interactions (buttons, inputs, keyboard shortcuts).
 * - Handling the display and logic of the main application modes (Design vs. Simulation).
 * - Managing the context menu for HMI components, including populating it with relevant properties
 *   and handling property changes.
 * - Implementing copy/paste functionality for HMI components.
 * - Controlling the visibility and interaction of various modals:
 *   - Load Project Modal: Fetches and displays available projects from the server.
 *   - Save Project Modal: Allows naming and saving the current project (new or as).
 *   - Confirmation Modal: A generic modal for user confirmations.
 * - Displaying toast notifications for feedback to the user.
 * - Managing the AI assistant's chat popup and settings panel visibility.
 * - Persisting the Gemini API key using localStorage.
 *
 * Key Interactions:
 * - `stateManager`: Calls `saveState`, `handleUndo`, `handleRedo`, `deleteDeviceVariableState`.
 * - `componentFactory`: Uses `componentFactory.create` for pasting components.
 * - `deviceManager`: Uses `getDevices` to populate device lists in the context menu.
 * - `konvaManager` (via `konvaRefsForUi` and `konvaHandleContextMenuClose`): Interacts for
 *   selection (`tr.nodes`), component draggability, context menu closure notifications.
 * - `ProjectManager` (via `projectManagerRef`): Calls methods for new, save, load, import, export
 *   project operations and checks `isProjectDirty`.
 * - `app.js` (via `getIsSimulationModeFunc`, `setIsSimulationModeFunc`): Gets and sets the global simulation mode.
 */
import {
    saveState,
    handleUndo,
    handleRedo,
    deleteDeviceVariableState,
} from "./stateManager.js";
import { componentFactory } from "./componentFactory.js";
import { getDevices } from "./deviceManager.js";
import { GRID_SIZE } from "./config.js";

// --- Module-Level Variables for DOM Elements and State ---
// These are populated by `_cacheDomElements()`.

// Main UI controls
let modeToggleEl, modeLabelEl, deleteBtnEl, addComponentPanelEl;

// Context Menu
let contextMenuEl, contextMenuTitleEl, contextMenuContentEl, closeContextMenuBtnEl;

// AI Assistant UI
let aiPopupChatEl, aiFabEl, closeAiPopupBtnEl, aiSettingsBtnEl, aiSettingsPanelEl, closeAiSettingsBtnEl, geminiApiKeyInputEl;

// Konva & UI Interaction State
let konvaRefsForUi = {}; // Holds references to Konva stage, layers, transformer from konvaManager
let isSimulationModeState = false; // Local cache of the application's simulation mode
let currentContextMenuNode = null; // Konva node currently targeted by the context menu
let clipboard = null; // Stores data of copied Konva nodes for paste
let pasteOffset = 0; // Offset for pasting components to avoid exact overlap

// Callbacks from other modules
let konvaHandleContextMenuClose; // Callback from konvaManager, called when context menu closes to potentially save state

// Functions passed from app.js (or other central module)
let getIsSimulationModeFunc; // Function to get the global simulation mode state
let setIsSimulationModeFunc; // Function to set the global simulation mode state
let projectManagerRef = null; // Reference to the ProjectManager instance

// Load Project Modal Elements
let loadProjectModalEl, loadProjectListContainerEl, closeLoadProjectModalBtnEl, cancelLoadProjectBtnEl, confirmLoadProjectBtnEl;
let selectedProjectToLoad = null; // Name of the project selected in the load modal

// Toast Notification Element
let toastContainerEl = null;

// Save Project Modal Elements
let saveProjectModalEl, saveProjectModalTitleEl, saveProjectNameInputEl, closeSaveProjectModalBtnEl, cancelSaveProjectBtnEl, confirmSaveProjectBtnEl;

// General Confirmation Modal Elements
let confirmationModalEl, confirmationModalTitleEl, confirmationMessageEl, confirmOkBtnEl, confirmCancelBtnEl;
// --- End Module-Level Variables ---

/**
 * Sets the Konva node currently targeted by the context menu.
 * This function is exported for use by `konvaManager` when it detects a contextmenu event on a node.
 *
 * @param {import('konva/lib/Node').Node<import('konva/lib/Node').NodeConfig> | null} node - The Konva node that the context menu should target, or `null` to clear.
 */
export function setCurrentContextMenuNode(node) {
    currentContextMenuNode = node;
}

/**
 * Caches references to all relevant DOM elements used by the UI manager.
 * This is called once during `initUiManager` to improve performance by avoiding repeated DOM lookups.
 * @private
 */
function _cacheDomElements() {
    modeToggleEl = document.getElementById("mode-toggle");
    modeLabelEl = document.getElementById("mode-label");
    deleteBtnEl = document.getElementById("delete-btn");
    addComponentPanelEl = document.getElementById("add-component-panel");

    contextMenuEl = document.getElementById("context-menu");
    contextMenuTitleEl = document.getElementById("context-menu-title");
    contextMenuContentEl = document.getElementById("context-menu-content");
    closeContextMenuBtnEl = document.getElementById("close-context-menu");

    aiPopupChatEl = document.getElementById("ai-popup-chat");
    aiFabEl = document.getElementById("ai-fab");
    closeAiPopupBtnEl = document.getElementById("close-ai-popup");
    aiSettingsBtnEl = document.getElementById("ai-settings-btn");
    aiSettingsPanelEl = document.getElementById("ai-settings-panel");
    closeAiSettingsBtnEl = document.getElementById("close-ai-settings");
    geminiApiKeyInputEl = document.getElementById("gemini-api-key");

    loadProjectModalEl = document.getElementById("load-project-modal");
    loadProjectListContainerEl = document.getElementById("load-project-list-container");
    closeLoadProjectModalBtnEl = document.getElementById("close-load-project-modal-btn");
    cancelLoadProjectBtnEl = document.getElementById("cancel-load-project-btn");
    confirmLoadProjectBtnEl = document.getElementById("confirm-load-project-btn");

    toastContainerEl = document.getElementById("toast-container");

    saveProjectModalEl = document.getElementById("save-project-modal");
    saveProjectModalTitleEl = document.getElementById("save-project-modal-title");
    saveProjectNameInputEl = document.getElementById("save-project-name-input");
    closeSaveProjectModalBtnEl = document.getElementById("close-save-project-modal-btn");
    cancelSaveProjectBtnEl = document.getElementById("cancel-save-project-btn");
    confirmSaveProjectBtnEl = document.getElementById("confirm-save-project-btn");

    confirmationModalEl = document.getElementById("confirmation-modal");
    confirmationModalTitleEl = document.getElementById("confirmation-modal-title");
    confirmationMessageEl = document.getElementById("confirmation-message");
    confirmOkBtnEl = document.getElementById("confirm-ok-btn");
    confirmCancelBtnEl = document.getElementById("confirm-cancel-btn");
}

/**
 * Gets the Konva node currently targeted by the context menu.
 * Exported for use by `konvaManager`.
 * @returns {import('konva/lib/Node').Node<import('konva/lib/Node').NodeConfig> | null} The current context menu target node.
 */
export function getCurrentContextMenuNode() {
    return currentContextMenuNode;
}

/**
 * Allows `konvaManager` to set its references (e.g., stage, layer, transformer, specific callbacks)
 * for `uiManager` to use, typically after `konvaManager` itself has been initialized.
 * This is part of a dependency injection pattern where modules provide interfaces to each other.
 *
 * @param {object} konvaRefs - Object containing references from `konvaManager`.
 *                             Expected to include `handleContextMenuCloseForSaveState` (function).
 */
export function setKonvaRefs(konvaRefs) {
    konvaRefsForUi = konvaRefs; // Stores stage, layer, tr, etc.
    if (konvaRefs && typeof konvaRefs.handleContextMenuCloseForSaveState === "function") {
        // This callback from konvaManager is invoked when uiManager hides the context menu,
        // allowing konvaManager to trigger a saveState if necessary (e.g., if properties were changed).
        konvaHandleContextMenuClose = konvaRefs.handleContextMenuCloseForSaveState;
    }
}

/**
 * Initializes the UI Manager.
 * Caches DOM elements, sets up initial UI state (e.g., simulation mode label, button states),
 * and attaches all necessary event listeners for UI interactions.
 *
 * @param {object} initialKonvaRefs - Initially empty object, will be populated by `konvaManager`
 *                                    and passed back to `uiManager` via `setKonvaRefs`.
 * @param {function(): boolean} getSimModeFunc - Function to get the current simulation mode state (from `app.js`).
 * @param {function(boolean): void} setSimModeFunc - Function to set the simulation mode state (in `app.js`).
 * @param {function(string): object} getDeviceByIdFunc - Function from `deviceManager` to get device details (for context menu).
 * @param {object} projectManagerInstance - Reference to the initialized `ProjectManager` instance.
 * @returns {{
 *   hideContextMenu: function(): void,
 *   populateContextMenu: function(object): void,
 *   selectNodes: function(Array<object>=): void,
 *   setCurrentContextMenuNode: function(object|null): void,
 *   getCurrentContextMenuNode: function(): (object|null),
 *   setKonvaRefs: function(object): void
 * }} An interface of functions that other modules can use to interact with the UI.
 *     Includes additional test-specific functions if `process.env.NODE_ENV === "test"`.
 */
export function initUiManager(
    initialKonvaRefs,
    getSimModeFunc,
    setSimModeFunc,
    getDeviceByIdFunc, // Currently available, but context menu directly calls deviceManager.getDevices()
    projectManagerInstance,
) {
    konvaRefsForUi = initialKonvaRefs; // Store initial (potentially empty) konvaRefs
    getIsSimulationModeFunc = getSimModeFunc;
    setIsSimulationModeFunc = setSimModeFunc;
    projectManagerRef = projectManagerInstance;

    _cacheDomElements();

    if (typeof getIsSimulationModeFunc === 'function') {
        isSimulationModeState = getIsSimulationModeFunc();
    } else {
        console.error("[UIManager] getIsSimulationModeFunc not provided during init. Defaulting to false.");
        isSimulationModeState = false;
    }


    _setupAllEventListeners();

    if (deleteBtnEl) { // Initialize delete button state
        deleteBtnEl.disabled = true;
        deleteBtnEl.classList.add("btn-disabled");
    }
    if(modeLabelEl && typeof setIsSimulationModeFunc === 'function') { // Initialize mode label
         setMode(isSimulationModeState); // Call setMode to initialize label and UI state
    }


    const publicInterface = {
        hideContextMenu,
        populateContextMenu,
        selectNodes,
        setCurrentContextMenuNode,
        getCurrentContextMenuNode,
        setKonvaRefs,
    };

    // Expose test-specific helpers if in a test environment
    if (typeof process !== 'undefined' && process.env?.NODE_ENV === "test") {
        publicInterface.handleCopyForTest = handleCopy;
        publicInterface.handlePasteForTest = handlePaste;
        publicInterface.getClipboardForTest = () => clipboard;
        publicInterface.getPasteOffsetForTest = () => pasteOffset;
        publicInterface.resetClipboardForTest = () => { clipboard = null; pasteOffset = 0; };
    }

    console.log("[UIManager] Initialized.");
    return publicInterface;
}

/**
 * Toggles the application between Design and Simulation modes.
 * Updates UI elements (labels, panel visibility) and HMI component properties (draggability) accordingly.
 *
 * @param {boolean} isSimMode - `true` to switch to Simulation mode, `false` for Design mode.
 * @private
 */
function setMode(isSimMode) {
    if (typeof setIsSimulationModeFunc !== 'function') {
        console.error("[UIManager] setIsSimulationModeFunc is not available to set mode.");
        return;
    }
    setIsSimulationModeFunc(isSimMode);
    isSimulationModeState = isSimMode;

    if (konvaRefsForUi.tr) konvaRefsForUi.tr.nodes([]); // Clear transformer selection on mode change
    hideContextMenu(); // Hide context menu

    // Update Konva components' draggability and transformer visibility
    if (konvaRefsForUi.layer) {
        konvaRefsForUi.layer.find(".hmi-component").forEach(node => node.draggable(!isSimMode));
        if (konvaRefsForUi.tr) konvaRefsForUi.tr.visible(!isSimMode);
    }

    // Toggle visibility of UI panels based on mode
    if (addComponentPanelEl) addComponentPanelEl.style.display = isSimMode ? "none" : "block";
    if (aiPopupChatEl) aiPopupChatEl.classList.add("hidden"); // Always hide AI chat initially on mode switch
    if (aiFabEl) aiFabEl.style.display = isSimMode ? "none" : "block"; // FAB might be hidden in sim mode
    if (modeLabelEl) modeLabelEl.textContent = isSimMode ? "Mode: Simulation" : "Mode: Design";
}

/**
 * Selects one or more Konva nodes on the canvas.
 * Updates the Konva Transformer to show resize/rotate handles for the selected nodes.
 * Manages the enabled/disabled state of the delete button based on selection.
 * Makes only the selected nodes draggable (in design mode).
 *
 * @param {Array<import('konva/lib/Node').Node<import('konva/lib/Node').NodeConfig>>} [nodesToSelect=[]] - Array of Konva nodes to select.
 *        If empty, deselects all.
 */
export function selectNodes(nodesToSelect = []) {
    if (isSimulationModeState) return; // No selection changes in simulation mode
    if (!konvaRefsForUi.tr || !konvaRefsForUi.layer) {
        console.warn("[UIManager] Konva Transformer or Layer not available for selectNodes.");
        return;
    }

    // Adjust transformer's keepRatio for single label selection (allows non-uniform scaling)
    if (nodesToSelect.length === 1 && nodesToSelect[0].attrs.componentType === "label") {
        konvaRefsForUi.tr.keepRatio(false);
    } else {
        konvaRefsForUi.tr.keepRatio(true);
    }
    konvaRefsForUi.tr.nodes(nodesToSelect); // Update transformer with selected nodes

    // Update delete button state
    if (deleteBtnEl) {
        deleteBtnEl.disabled = nodesToSelect.length === 0;
        deleteBtnEl.classList.toggle("btn-disabled", nodesToSelect.length === 0);
    }

    // Make only selected nodes draggable (in design mode)
    konvaRefsForUi.layer.find(".hmi-component").forEach(node => {
        const isSelected = nodesToSelect.includes(node);
        // Draggable only if selected AND in design mode
        node.draggable(isSelected && !isSimulationModeState);
    });

    hideContextMenu(); // Hide context menu when selection changes
}

/**
 * Handles the "Copy" operation (Ctrl+C or Cmd+C).
 * Serializes the currently selected Konva nodes (via the transformer) and stores their
 * data (type and properties, excluding unique ID and data bindings) in an internal clipboard.
 * Resets the paste offset for subsequent pastes.
 * @private
 */
function handleCopy() {
    if (!konvaRefsForUi.tr || isSimulationModeState) return; // No copy in sim mode or if no transformer

    const selectedNodes = konvaRefsForUi.tr.nodes();
    if (selectedNodes.length === 0) {
        clipboard = null; // Clear clipboard if nothing is selected
        return;
    }

    pasteOffset = 0; // Reset paste offset for a new set of copied items
    clipboard = selectedNodes.map((node) => {
        const properties = { ...node.attrs };
        // Exclude properties that should be unique or reset for pasted components
        delete properties.id;
        // Clear data bindings; user should re-bind pasted components
        delete properties.deviceId;
        delete properties.variableName;
        delete properties.address; // Also clear legacy address if present
        return {
            componentType: properties.componentType,
            properties: properties, // Store all other relevant properties
        };
    });
    // console.debug(`[UIManager] ${clipboard.length} element(s) copied to clipboard.`);
}

/**
 * Handles the "Paste" operation (Ctrl+V or Cmd+V).
 * If there's data in the internal clipboard, it creates new HMI components based on this data,
 * applying an offset to their positions to avoid exact overlap. Data bindings (`deviceId`,
 * `variableName`, `address`) are cleared from pasted components, requiring the user to re-configure them.
 * The new components are added to the Konva layer, the application state is saved, and the
 * newly pasted components are selected.
 * @private
 */
function handlePaste() {
    if (!clipboard || clipboard.length === 0 || !konvaRefsForUi.layer || isSimulationModeState) {
        return; // Nothing to paste, layer not ready, or in simulation mode
    }

    pasteOffset += GRID_SIZE; // Increment offset for this paste operation
    const newNodes = [];

    clipboard.forEach((item) => {
        if (!item.componentType || !item.properties) {
            console.warn("[UIManager] Invalid item in clipboard during paste:", item);
            return;
        }
        const newProps = { ...item.properties };
        newProps.x = (newProps.x || 0) + pasteOffset; // Apply offset
        newProps.y = (newProps.y || 0) + pasteOffset;

        // Data bindings are explicitly NOT copied for pasted components. User must re-bind.
        // (Already deleted during copy, but double-check here if structure changes)
        delete newProps.deviceId;
        delete newProps.variableName;
        delete newProps.address;

        try {
            const newComponent = componentFactory.create(item.componentType, newProps);
            if (newComponent) {
                konvaRefsForUi.layer.add(newComponent);
                newNodes.push(newComponent);
            }
        } catch (error) {
            console.error(`[UIManager] Error creating component type '${item.componentType}' during paste:`, error);
        }
    });

    if (newNodes.length > 0) {
        saveState(); // Save state after adding new components
        selectNodes(newNodes); // Select the newly pasted components
        // console.debug(`[UIManager] ${newNodes.length} element(s) pasted.`);
    }
}

/**
 * Hides the context menu. If a Konva node was targeted by the context menu (meaning
 * its properties might have been edited), it calls `konvaHandleContextMenuClose`,
 * which is a callback from `konvaManager` that might trigger a `saveState`.
 * Finally, it clears the reference to the current context menu node.
 */
export function hideContextMenu() {
    if (currentContextMenuNode && typeof konvaHandleContextMenuClose === "function") {
        konvaHandleContextMenuClose(); // Notify konvaManager (which might save state)
    }
    if (contextMenuEl) contextMenuEl.style.display = "none";
    currentContextMenuNode = null; // Clear the reference
}

// --- Context Menu Content Generation Helpers ---
// These functions generate HTML strings for different sections of the context menu
// based on the properties (attrs) of the selected HMI component.

/** @private Creates HTML for device and variable binding selectors. */
function _createDeviceVariableBindingsHTML(attrs) {
    if (attrs.componentType === "label") return ""; // Labels don't bind to device data

    const devices = getDevices();
    let deviceOptionsHtml = '<option value="">-- Select Device --</option>' +
        devices.map(d => `<option value="${d.id}" ${attrs.deviceId === d.id ? "selected" : ""}>${d.name} (ID: ${d.id.substring(0, 8)})</option>`).join("");

    let variableOptionsHtml = '<option value="">-- Select Variable --</option>';
    if (attrs.deviceId) {
        const selectedDevice = devices.find(d => d.id === attrs.deviceId);
        if (selectedDevice?.variables) {
            variableOptionsHtml += selectedDevice.variables
                .map(v => `<option value="${v.name}" ${attrs.variableName === v.name ? "selected" : ""}>${v.name}</option>`).join("");
        }
    }

    return `
        <div class="mb-2">
            <label class="font-bold text-cyan-200">Device</label>
            <select data-prop="deviceId" id="context-menu-device-select" class="w-full bg-gray-600 p-1 rounded mt-1 text-xs">${deviceOptionsHtml}</select>
        </div>
        <div class="mb-2">
            <label class="font-bold text-cyan-200">Variable</label>
            <select data-prop="variableName" id="context-menu-variable-select" class="w-full bg-gray-600 p-1 rounded mt-1 text-xs" ${!attrs.deviceId ? "disabled" : ""}>${variableOptionsHtml}</select>
        </div>`;
}

/** @private Creates HTML for common properties like 'label'. */
function _createCommonPropertiesHTML(attrs) {
    return `
        <div class="mb-2">
            <label class="font-bold">Label</label>
            <input type="text" data-prop="label" value="${attrs.label || ""}" class="w-full bg-gray-600 p-1 rounded mt-1 text-xs">
        </div>`;
}

/** @private Creates HTML specific to BitLamp properties (shape, colors). */
function _createBitLampPropertiesHTML(attrs) {
    return `
        <div class="mb-1"><label class="font-bold">Shape</label><select data-prop="shapeType" class="w-full bg-gray-600 p-1 rounded mt-1 text-xs"><option value="circle" ${attrs.shapeType === "circle" ? "selected" : ""}>Circle</option><option value="rect" ${attrs.shapeType === "rect" ? "selected" : ""}>Rectangle</option></select></div>
        <div class="mb-1"><label class="font-bold">ON Color</label><input type="color" data-prop="onColor" value="${attrs.onColor || "#00FF00"}" class="w-full h-8 bg-gray-600 p-0 rounded mt-1"></div>
        <div class="mb-1"><label class="font-bold">OFF Color</label><input type="color" data-prop="offColor" value="${attrs.offColor || "#FF0000"}" class="w-full h-8 bg-gray-600 p-0 rounded mt-1"></div>`;
}

/** @private Creates HTML specific to NumericDisplay properties (units, decimal places). */
function _createNumericDisplayPropertiesHTML(attrs) {
    return `
        <div class="mb-1"><label class="font-bold">Units</label><input type="text" data-prop="units" value="${attrs.units || ""}" class="w-full bg-gray-600 p-1 rounded mt-1 text-xs"></div>
        <div class="mb-1"><label class="font-bold">Decimal Places</label><input type="number" data-prop="decimalPlaces" value="${attrs.decimalPlaces ?? 0}" min="0" class="w-full bg-gray-600 p-1 rounded mt-1 text-xs"></div>`;
}

/** @private Creates HTML specific to BitSwitch properties (texts, colors). */
function _createBitSwitchPropertiesHTML(attrs) {
    return `
        <div class="mb-1"><label class="font-bold">OFF Text</label><input type="text" data-prop="offText" value="${attrs.offText || "OFF"}" class="w-full bg-gray-600 p-1 rounded mt-1 text-xs"></div>
        <div class="mb-1"><label class="font-bold">ON Text</label><input type="text" data-prop="onText" value="${attrs.onText || "ON"}" class="w-full bg-gray-600 p-1 rounded mt-1 text-xs"></div>
        <div class="mb-1"><label class="font-bold">ON Color</label><input type="color" data-prop="onColor" value="${attrs.onColor || "#00FF00"}" class="w-full h-8 bg-gray-600 p-0 rounded mt-1"></div>
        <div class="mb-1"><label class="font-bold">OFF Color</label><input type="color" data-prop="offColor" value="${attrs.offColor || "#CCCCCC"}" class="w-full h-8 bg-gray-600 p-0 rounded mt-1"></div>`;
}

/** @private Creates HTML specific to WordLamp properties (states definition). */
function _createWordLampPropertiesHTML(attrs) {
    const defaultStates = JSON.stringify([{ value: 0, text: "STOPPED", color: "#d9534f" }, { value: 1, text: "RUNNING", color: "#5cb85c" }]);
    const currentStatesString = JSON.stringify(attrs.states || []); // Ensure attrs.states is an array for stringify
    const isDefaultSelected = currentStatesString === defaultStates;
    // Note: This simple select is for demonstration. A robust solution for editing 'states' array would need a more complex UI.
    return `
        <div class="mb-1">
            <label class="font-bold">States Definition</label>
            <select data-prop="states" class="w-full bg-gray-600 p-1 rounded mt-1 text-xs">
                <option value='${defaultStates}' ${isDefaultSelected ? "selected" : ""}>Default (STOPPED/RUNNING)</option>
            </select>
            <small class="text-gray-400 text-xs">Custom states editing requires advanced editor or direct JSON modification.</small>
        </div>`;
}

/** @private Creates HTML specific to Label properties (text, font, color, etc.). */
function _createLabelPropertiesHTML(attrs) {
    return `
        <div class="mb-1"><label class="font-bold">Text</label><input type="text" data-prop="text" value="${attrs.text || "Label"}" class="w-full bg-gray-600 p-1 rounded mt-1 text-xs"></div>
        <div class="mb-1"><label class="font-bold">Font Size</label><input type="number" data-prop="fontSize" value="${attrs.fontSize || 16}" min="1" class="w-full bg-gray-600 p-1 rounded mt-1 text-xs"></div>
        <div class="mb-1"><label class="font-bold">Text Color</label><input type="color" data-prop="fill" value="${attrs.fill || "#FFFFFF"}" class="w-full h-8 bg-gray-600 p-0 rounded mt-1"></div>
        <div class="mb-1"><label class="font-bold">Width (auto if 0)</label><input type="number" data-prop="width" value="${attrs.width || 0}" min="0" class="w-full bg-gray-600 p-1 rounded mt-1 text-xs"></div>
        <div class="mb-1"><label class="font-bold">Alignment</label><select data-prop="align" class="w-full bg-gray-600 p-1 rounded mt-1 text-xs"><option value="left" ${attrs.align === "left" ? "selected" : ""}>Left</option><option value="center" ${attrs.align === "center" ? "selected" : ""}>Center</option><option value="right" ${attrs.align === "right" ? "selected" : ""}>Right</option></select></div>`;
}
// --- End Context Menu Content Generation Helpers ---

/**
 * Populates the context menu with properties of the given Konva node.
 * It sets the menu title, generates HTML for device/variable bindings (if applicable),
 * common properties (like label), and component-specific properties, then displays the menu.
 *
 * @param {import('konva/lib/Node').Node<import('konva/lib/Node').NodeConfig>} node - The Konva node whose properties are to be displayed.
 */
export function populateContextMenu(node) {
    if (!node || !contextMenuTitleEl || !contextMenuContentEl || !contextMenuEl) {
        console.warn("[UIManager] Cannot populate context menu: Node or essential DOM elements missing.");
        return;
    }
    setCurrentContextMenuNode(node); // Update the reference to the currently active node
    const attrs = node.attrs;
    contextMenuTitleEl.textContent = `Edit: ${attrs.label || attrs.componentType || "Component"}`;

    let html = _createDeviceVariableBindingsHTML(attrs);
    html += _createCommonPropertiesHTML(attrs);

    switch (attrs.componentType) {
        case "bit-lamp":        html += _createBitLampPropertiesHTML(attrs); break;
        case "numeric-display": html += _createNumericDisplayPropertiesHTML(attrs); break;
        case "bit-switch":      html += _createBitSwitchPropertiesHTML(attrs); break;
        case "word-lamp":       html += _createWordLampPropertiesHTML(attrs); break;
        case "label":           html += _createLabelPropertiesHTML(attrs); break;
        default: html += `<p class="text-xs text-gray-400">No specific properties for this component type.</p>`;
    }

    contextMenuContentEl.innerHTML = html;
    contextMenuEl.style.display = "block"; // Show the populated context menu
}

/**
 * Central function to set up all event listeners for UI elements.
 * This delegates to more specific setup functions for different UI areas (mode toggle, context menu, etc.).
 * @private
 */
function _setupAllEventListeners() {
    _setupModeToggleListeners();
    _setupContextMenuListeners();
    _setupComponentPanelListeners();
    _setupDeleteButtonListeners();
    _setupKeyboardShortcutListeners();
    _setupAIPopupListeners();
    _setupProjectManagementListeners();
    _setupModalListeners(); // Includes Save, Load, Confirm modals
    _setupGeminiApiKeyListener();
}

/**
 * Sets up event listener for the Design/Simulation mode toggle switch.
 * @private
 */
function _setupModeToggleListeners() {
    if (modeToggleEl) {
        modeToggleEl.addEventListener("change", (e) => setMode(e.target.checked));
    }
}

/**
 * Sets up event listeners for the context menu inputs.
 * When a property in the context menu is changed, it updates the corresponding
 * attribute on the `currentContextMenuNode` and calls its `updateState()` method.
 * If `deviceId` is changed, it also repopulates the context menu to update variable list.
 * @private
 */
function _setupContextMenuListeners() {
    if (contextMenuEl && contextMenuContentEl) {
        // General input listener for most fields
        contextMenuEl.addEventListener("input", (e) => {
            if (!currentContextMenuNode || !e.target?.dataset?.prop) return;

            const target = e.target;
            const prop = target.dataset.prop;
            let value = target.type === "number" ? parseFloat(target.value) : target.value;
            if (target.type === "checkbox") value = target.checked;

            currentContextMenuNode.setAttr(prop, value);
            // If deviceId changes, variableName should be cleared and menu repopulated
            if (prop === "deviceId") {
                currentContextMenuNode.setAttr("variableName", ""); // Clear variable
                populateContextMenu(currentContextMenuNode); // Repopulate to update variable dropdown
            }
            currentContextMenuNode.updateState?.(); // Trigger visual update on component
        });

        // Specific change listener for select elements (like variableName, shapeType, align)
        // This is needed because 'input' event might not fire consistently for all select changes in all browsers.
        contextMenuContentEl.addEventListener("change", (e) => {
            if (!currentContextMenuNode || !e.target?.dataset?.prop || e.target.tagName !== 'SELECT') return;
            const target = e.target;
            const prop = target.dataset.prop;
            currentContextMenuNode.setAttr(prop, target.value);
            currentContextMenuNode.updateState?.();
        });
    }
    if (closeContextMenuBtnEl) {
        closeContextMenuBtnEl.addEventListener("click", hideContextMenu);
    }
}

/**
 * Sets up event listener for the "Add Component" panel.
 * When a button with a `data-component` attribute is clicked, it creates a new
 * component of that type using `componentFactory` and adds it to the Konva layer.
 * @private
 */
function _setupComponentPanelListeners() {
    if (addComponentPanelEl) {
        addComponentPanelEl.addEventListener("click", (e) => {
            if (e.target.matches("button[data-component]")) {
                const type = e.target.dataset.component;
                if (componentFactory && typeof componentFactory.create === 'function' && konvaRefsForUi.layer) {
                    const component = componentFactory.create(type);
                    if (component) {
                        konvaRefsForUi.layer.add(component);
                        saveState(); // Save state after adding
                    }
                } else {
                    console.warn("[UIManager] componentFactory or Konva layer not ready for adding component.");
                }
            }
        });
    }
}

/**
 * Sets up event listener for the global "Delete" button.
 * When clicked, it deletes all currently selected components (from `konvaRefsForUi.tr.nodes()`),
 * saves the state, clears their data bindings from `stateManager`, and updates selection.
 * @private
 */
function _setupDeleteButtonListeners() {
    if (deleteBtnEl) {
        deleteBtnEl.addEventListener("click", () => {
            if (!konvaRefsForUi.tr || isSimulationModeState) return; // No deletion in sim mode or if no transformer

            const nodesToDelete = konvaRefsForUi.tr.nodes();
            if (nodesToDelete.length > 0) {
                saveState(); // Save state before deletion for undo
                nodesToDelete.forEach((node) => {
                    // Clear associated state from stateManager if component was data-bound
                    if (node.attrs.deviceId && node.attrs.variableName) {
                        deleteDeviceVariableState(node.attrs.deviceId, node.attrs.variableName);
                    }
                    node.destroy(); // Remove from Konva layer
                });
                konvaRefsForUi.tr.nodes([]); // Clear transformer selection
                selectNodes([]); // Update UI selection state (e.g., disable delete button)
            }
        });
    }
}

/**
 * Sets up global keyboard shortcut listeners for actions like copy, paste, undo, redo, delete, and escape.
 * Ensures shortcuts don't interfere with text input fields.
 * @private
 */
function _setupKeyboardShortcutListeners() {
    window.addEventListener("keydown", (e) => {
        const activeEl = document.activeElement;
        // Ignore shortcuts if focus is on an input, textarea, or contentEditable element
        if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA" || activeEl.isContentEditable)) {
            return;
        }

        const isCtrlOrCmd = e.ctrlKey || e.metaKey;

        if (isCtrlOrCmd && !isSimulationModeState) { // Shortcuts for design mode
            switch (e.key.toLowerCase()) {
                case "c": e.preventDefault(); handleCopy(); break;
                case "v": e.preventDefault(); handlePaste(); break;
                case "z":
                    e.preventDefault();
                    if (e.shiftKey) handleRedo(); else handleUndo();
                    break;
            }
        }

        if (e.key === "Escape") {
            hideContextMenu(); // Hide context menu on Escape
            // Potentially other actions like closing modals could be added here
        }

        // Delete selected components with Delete/Backspace key (not in simulation mode)
        if ((e.key === "Delete" || e.key === "Backspace") &&
            konvaRefsForUi.tr && konvaRefsForUi.tr.nodes().length > 0 &&
            !isSimulationModeState && deleteBtnEl && !deleteBtnEl.disabled) {
            e.preventDefault(); // Prevent browser back navigation on Backspace
            deleteBtnEl.click(); // Trigger the delete button's action
        }
    });
}

/**
 * Sets up event listeners for the AI assistant chat popup and settings panel.
 * Handles toggling their visibility.
 * @private
 */
function _setupAIPopupListeners() {
    if (aiFabEl && aiPopupChatEl) aiFabEl.addEventListener("click", () => aiPopupChatEl.classList.toggle("hidden"));
    if (closeAiPopupBtnEl && aiPopupChatEl) closeAiPopupBtnEl.addEventListener("click", () => aiPopupChatEl.classList.add("hidden"));
    if (aiSettingsBtnEl && aiSettingsPanelEl) aiSettingsBtnEl.addEventListener("click", () => aiSettingsPanelEl.classList.remove("hidden"));
    if (closeAiSettingsBtnEl && aiSettingsPanelEl) closeAiSettingsBtnEl.addEventListener("click", () => aiSettingsPanelEl.classList.add("hidden"));
}

/**
 * Sets up event listener for the Gemini API Key input field.
 * Loads the saved API key from `localStorage` on initialization and saves changes back to `localStorage`.
 * @private
 */
function _setupGeminiApiKeyListener() {
    if (geminiApiKeyInputEl) {
        geminiApiKeyInputEl.value = localStorage.getItem("geminiApiKey") || "";
        geminiApiKeyInputEl.addEventListener("change", (e) => localStorage.setItem("geminiApiKey", e.target.value));
    }
}

/**
 * Sets up event listeners for project management buttons (New, Save, Save As, Load, Import, Export).
 * These listeners typically interact with `ProjectManager` methods or open relevant modals.
 * Confirmation for unsaved changes is handled before proceeding with destructive actions (New, Load, Import).
 * @private
 */
function _setupProjectManagementListeners() {
    const newProjectBtn = document.getElementById("new-project-btn");
    const saveProjectBtn = document.getElementById("save-project-btn");
    const saveProjectAsBtnEl = document.getElementById("save-project-as-btn");
    const loadProjectBtn = document.getElementById("load-project-btn");
    const importProjectInput = document.getElementById("import-project-input"); // File input
    const importProjectBtn = document.getElementById("import-project-btn");   // Button to trigger file input
    const exportProjectBtn = document.getElementById("export-project-btn");

    if (newProjectBtn && projectManagerRef) {
        newProjectBtn.addEventListener("click", async () => {
            console.log("[TEST_DEBUG] New project button clicked.");
            const dirty = projectManagerRef.isProjectDirty();
            console.log("[TEST_DEBUG] Project is dirty:", dirty);
            if (dirty) {
                console.log("[DEBUG_UIMANAGER] Condition 'dirty' is true. Preparing to call showConfirmationModal."); // Log baru
                console.log("[TEST_DEBUG] Calling showConfirmationModal...");
                const confirmed = await showConfirmationModal("Unsaved changes will be lost. Create new project?", "Confirm New Project");
                console.log("[TEST_DEBUG] Confirmation modal returned:", confirmed);
                if (!confirmed) { showToastImpl("New project creation cancelled.", "info"); return; }
            }
            projectManagerRef.newProject();
            showToastImpl("New project created.", "success");
        });
    }

    if (saveProjectBtn && projectManagerRef) {
        saveProjectBtn.addEventListener("click", async () => {
            const currentName = projectManagerRef.getCurrentProjectName();
            if (currentName) { // Project has a name, so direct save
                saveProjectBtn.disabled = true;
                const originalText = saveProjectBtn.textContent;
                saveProjectBtn.textContent = "Saving...";
                try {
                    await projectManagerRef.saveProjectToServer(currentName);
                    showToastImpl(`Project '${currentName}' saved successfully.`, "success");
                } catch (error) {
                    showToastImpl(`Failed to save project '${currentName}': ${error}`, "error");
                } finally {
                    saveProjectBtn.disabled = false;
                    saveProjectBtn.textContent = originalText;
                }
            } else { // No name, open "Save As" modal
                openSaveProjectModal("", false); // isSaveAs is false for initial save
            }
        });
    }

    if (saveProjectAsBtnEl && projectManagerRef) {
        saveProjectAsBtnEl.addEventListener("click", () => openSaveProjectModal(projectManagerRef.getCurrentProjectName(), true));
    }

    if (loadProjectBtn) { // projectManagerRef check is inside openLoadProjectModal
        loadProjectBtn.addEventListener("click", () => openLoadProjectModal());
    }

    if (importProjectBtn && importProjectInput && projectManagerRef) {
        importProjectBtn.addEventListener("click", () => importProjectInput.click()); // Trigger hidden file input
        importProjectInput.addEventListener("change", async (event) => {
            const file = event.target.files?.[0];
            if (file) {
                if (projectManagerRef.isProjectDirty()) {
                    const confirmed = await showConfirmationModal("Unsaved changes will be lost. Import new project?", "Confirm Import");
                    if (!confirmed) { showToastImpl("Project import cancelled.", "info"); event.target.value = null; return; }
                }
                try {
                    await projectManagerRef.importProjectFromFile(file);
                    // Success message is handled within importProjectFromFile or by projectManagerRef itself
                } catch (error) { // Catch errors from importProjectFromFile promise
                    showToastImpl(`Failed to import project: ${error}`, "error");
                }
            }
            event.target.value = null; // Reset file input
        });
    }

    if (exportProjectBtn && projectManagerRef) {
        exportProjectBtn.addEventListener("click", () => {
            try {
                projectManagerRef.exportProject();
                // Assuming exportProject itself handles success/failure feedback or throws on error
            } catch (e) {
                showToastImpl("Failed to export project.", "error");
                console.error("[UIManager] Error during project export:", e);
            }
        });
    }
}

/**
 * Sets up event listeners for all modals: Load Project, Save Project, and the generic Confirmation Modal.
 * This includes handling form submissions within these modals and interactions with close/cancel buttons.
 * @private
 */
function _setupModalListeners() {
    // --- Save Project Modal ---
    if (closeSaveProjectModalBtnEl) closeSaveProjectModalBtnEl.addEventListener("click", hideSaveProjectModal);
    if (cancelSaveProjectBtnEl) cancelSaveProjectBtnEl.addEventListener("click", hideSaveProjectModal);
    if (confirmSaveProjectBtnEl && projectManagerRef && saveProjectNameInputEl) {
        const originalConfirmText = confirmSaveProjectBtnEl.textContent;
        confirmSaveProjectBtnEl.addEventListener("click", async () => {
            const projectName = saveProjectNameInputEl.value.trim();
            if (projectName === "") {
                showToastImpl("Project name cannot be empty.", "warning");
                saveProjectNameInputEl.focus();
                return;
            }
            confirmSaveProjectBtnEl.disabled = true;
            confirmSaveProjectBtnEl.textContent = "Saving...";
            try {
                // Check if project name already exists (if not saving over current project)
                const currentPName = projectManagerRef.getCurrentProjectName();
                if (!currentPName || currentPName.toLowerCase() !== projectName.toLowerCase()) {
                    const available = await projectManagerRef.getAvailableProjectsFromServer();
                    if (available.some(p => p.toLowerCase() === projectName.toLowerCase())) {
                        const confirmedOverwrite = await showConfirmationModal(`Project "${projectName}" already exists. Overwrite?`, "Confirm Overwrite");
                        if (!confirmedOverwrite) {
                            showToastImpl("Save cancelled.", "info");
                            confirmSaveProjectBtnEl.disabled = false;
                            confirmSaveProjectBtnEl.textContent = originalConfirmText;
                            return;
                        }
                    }
                }
                await projectManagerRef.saveProjectToServer(projectName);
                showToastImpl(`Project '${projectName}' saved successfully to server.`, "success");
                hideSaveProjectModal();
            } catch (error) {
                showToastImpl(`Failed to save project: ${error}`, "error");
            } finally {
                confirmSaveProjectBtnEl.disabled = false;
                confirmSaveProjectBtnEl.textContent = originalConfirmText;
            }
        });
    }

    // --- Load Project Modal ---
    if (closeLoadProjectModalBtnEl) closeLoadProjectModalBtnEl.addEventListener("click", hideLoadProjectModal);
    if (cancelLoadProjectBtnEl) cancelLoadProjectBtnEl.addEventListener("click", hideLoadProjectModal);
    if (confirmLoadProjectBtnEl && projectManagerRef) {
        const originalLoadText = confirmLoadProjectBtnEl.textContent;
        confirmLoadProjectBtnEl.addEventListener("click", async () => {
            if (selectedProjectToLoad) {
                if (projectManagerRef.isProjectDirty()) {
                    const confirmed = await showConfirmationModal("Unsaved changes will be lost. Load selected project?", "Confirm Load");
                    if (!confirmed) { showToastImpl("Load project cancelled.", "info"); return; }
                }
                confirmLoadProjectBtnEl.disabled = true;
                confirmLoadProjectBtnEl.textContent = "Loading...";
                try {
                    await projectManagerRef.loadProjectFromServer(selectedProjectToLoad);
                    showToastImpl(`Project '${selectedProjectToLoad}' loaded successfully.`, "success");
                    hideLoadProjectModal();
                } catch (error) {
                    showToastImpl(`Failed to load project '${selectedProjectToLoad}': ${error}`, "error");
                } finally {
                    // Ensure button is re-enabled only if modal is still visible (e.g. error occurred)
                    if (confirmLoadProjectBtnEl && loadProjectModalEl && !loadProjectModalEl.classList.contains("hidden")) {
                         confirmLoadProjectBtnEl.disabled = false;
                         confirmLoadProjectBtnEl.textContent = originalLoadText;
                    }
                }
            } else {
                showToastImpl("Please select a project to load.", "warning");
            }
        });
    }
    // Note: Generic Confirmation Modal listeners are set dynamically in `showConfirmationModal`.
}

/** @private Hides the Load Project modal and resets the selected project. */
function hideLoadProjectModal() {
    if (loadProjectModalEl) loadProjectModalEl.classList.add("hidden");
    selectedProjectToLoad = null; // Reset selection
    if(confirmLoadProjectBtnEl) confirmLoadProjectBtnEl.disabled = true; // Disable confirm until new selection
}

/**
 * Opens the Load Project modal. Fetches available projects from the server
 * via `projectManagerRef` and populates a list for user selection.
 * @private
 */
async function openLoadProjectModal() {
    if (!loadProjectModalEl || !loadProjectListContainerEl || !projectManagerRef) {
        console.error("[UIManager] Load Project modal elements or ProjectManager not available.");
        showToast("Cannot open Load Project dialog at this time.", "error");
        return;
    }

    loadProjectListContainerEl.innerHTML = '<p class="text-gray-400 text-sm p-2">Loading project list...</p>';
    if (confirmLoadProjectBtnEl) confirmLoadProjectBtnEl.disabled = true; // Disable confirm until a project is selected
    loadProjectModalEl.classList.remove("hidden");

    try {
        const availableProjects = await projectManagerRef.getAvailableProjectsFromServer();
        if (availableProjects && availableProjects.length > 0) {
            let listHtml = '<ul class="space-y-1">';
            availableProjects.forEach((projectName) => {
                listHtml += `<li><label class="block p-2 rounded-md hover:bg-gray-700 cursor-pointer"><input type="radio" name="project-to-load" value="${projectName}" class="mr-2 project-load-radio">${projectName}</label></li>`;
            });
            listHtml += "</ul>";
            loadProjectListContainerEl.innerHTML = listHtml;

            // Add event listeners to newly created radio buttons
            const radioButtons = loadProjectListContainerEl.querySelectorAll(".project-load-radio");
            radioButtons.forEach(radio => {
                radio.addEventListener("change", (event) => {
                    if (event.target.checked) {
                        selectedProjectToLoad = event.target.value;
                        if (confirmLoadProjectBtnEl) confirmLoadProjectBtnEl.disabled = false;
                    }
                });
            });
        } else {
            loadProjectListContainerEl.innerHTML = '<p class="text-gray-400 text-sm p-2">No projects found on the server.</p>';
        }
    } catch (error) {
        console.error("[UIManager] Failed to get project list:", error);
        loadProjectListContainerEl.innerHTML = `<p class="text-red-400 text-sm p-2">Failed to load projects: ${error}</p>`;
    }
}

/** @private Hides the Save Project modal and clears its input field. */
function hideSaveProjectModal() {
    if (saveProjectModalEl) saveProjectModalEl.classList.add("hidden");
    if (saveProjectNameInputEl) saveProjectNameInputEl.value = "";
}

/**
 * Opens the Save Project modal.
 * @param {string} [currentName=""] - The current name of the project, if any (for "Save As").
 * @param {boolean} [isSaveAs=false] - `true` if invoked for "Save As", `false` for initial save of new project.
 * @private
 */
function openSaveProjectModal(currentName = "", isSaveAs = false) {
    if (!saveProjectModalEl || !saveProjectNameInputEl || !saveProjectModalTitleEl) {
        console.error("[UIManager] Save Project modal elements not available.");
        showToast("Cannot open Save Project dialog at this time.", "error");
        return;
    }
    saveProjectNameInputEl.value = currentName;
    if (isSaveAs) {
        saveProjectModalTitleEl.textContent = currentName ? `Save Project As (Current: ${currentName})` : "Save Project As...";
    } else { // Initial save for a new, unnamed project
        saveProjectModalTitleEl.textContent = "Save New Project";
    }
    saveProjectModalEl.classList.remove("hidden");
    saveProjectNameInputEl.focus();
    saveProjectNameInputEl.select();
}


// --- Generic Confirmation Modal Functions ---
// These are designed to be reusable for various confirmation needs.

/** @private Hides the generic confirmation modal and cleans up its event listeners. */
function hideConfirmationModal() {
    if (confirmationModalEl) confirmationModalEl.classList.add("hidden");
    // Clean up dynamically added, single-use event listeners
    if (confirmOkBtnEl?.currentClickListener) {
        confirmOkBtnEl.removeEventListener("click", confirmOkBtnEl.currentClickListener);
        delete confirmOkBtnEl.currentClickListener;
    }
    if (confirmCancelBtnEl?.currentClickListener) {
        confirmCancelBtnEl.removeEventListener("click", confirmCancelBtnEl.currentClickListener);
        delete confirmCancelBtnEl.currentClickListener;
    }
}

/**
 * Displays a generic confirmation modal with a specified message and title.
 * Returns a Promise that resolves to `true` if the user confirms (clicks OK),
 * or `false` if the user cancels (clicks Cancel or closes the modal).
 *
 * @param {string} message - The confirmation question/message to display.
 * @param {string} [title="Confirm"] - The title for the modal.
 * @param {string} [okText="OK"] - Text for the confirmation button.
 * @param {string} [cancelText="Cancel"] - Text for the cancellation button.
 * @returns {Promise<boolean>} A promise resolving to `true` (confirmed) or `false` (cancelled).
 *                             Falls back to `window.confirm` if modal elements are not found.
 */
export function showConfirmationModal(message, title = "Confirm", okText = "OK", cancelText = "Cancel") {
    if (!confirmationModalEl || !confirmationMessageEl || !confirmOkBtnEl || !confirmCancelBtnEl || !confirmationModalTitleEl) {
        console.error("[UIManager] Confirmation modal elements not fully available. Falling back to window.confirm.");
        return Promise.resolve(window.confirm(message)); // Fallback
    }

    console.log("[DEBUG_UIMANAGER_MODAL] showConfirmationModal called with message:", message, "title:", title);
    console.log("[DEBUG_UIMANAGER_MODAL] confirmationMessageEl ID:", confirmationMessageEl ? confirmationMessageEl.id : "null");
    confirmationModalTitleEl.textContent = title;
    confirmationMessageEl.textContent = message;
    confirmOkBtnEl.textContent = okText;
    confirmCancelBtnEl.textContent = cancelText;

    console.log("[DEBUG_UIMANAGER_MODAL] confirmationModalEl classList BEFORE remove:", confirmationModalEl ? confirmationModalEl.classList.toString() : "null");
    if (confirmationModalEl) confirmationModalEl.classList.remove("hidden");
    console.log("[DEBUG_UIMANAGER_MODAL] confirmationModalEl classList AFTER remove:", confirmationModalEl ? confirmationModalEl.classList.toString() : "null");

    return new Promise((resolve) => {
        // Remove any old listeners to prevent multiple resolutions
        if (confirmOkBtnEl.currentClickListener) confirmOkBtnEl.removeEventListener("click", confirmOkBtnEl.currentClickListener);
        if (confirmCancelBtnEl.currentClickListener) confirmCancelBtnEl.removeEventListener("click", confirmCancelBtnEl.currentClickListener);

        confirmOkBtnEl.currentClickListener = () => { hideConfirmationModal(); resolve(true); };
        confirmCancelBtnEl.currentClickListener = () => { hideConfirmationModal(); resolve(false); };

        confirmOkBtnEl.addEventListener("click", confirmOkBtnEl.currentClickListener, { once: true });
        confirmCancelBtnEl.addEventListener("click", confirmCancelBtnEl.currentClickListener, { once: true });
        // Consider adding listener for a potential 'x' close button on the modal as well, resolving to false.
    });
}
// --- End Confirmation Modal Functions ---


// --- Toast Notification Functions ---

/** @private Creates a toast notification DOM element with the given message and type. */
function _createToastElement(message, type) {
    const toast = document.createElement("div");
    // Base classes + type-specific class for styling (e.g., toast-success, toast-error)
    toast.className = `toast toast-${type} p-3 rounded-md shadow-lg text-white mb-2`;
    // Basic styling fallback if CSS classes are not fully defined
    if (type === 'success') toast.style.backgroundColor = 'rgba(74, 222, 128, 0.9)'; // green-400
    else if (type === 'error') toast.style.backgroundColor = 'rgba(248, 113, 113, 0.9)'; // red-400
    else if (type === 'warning') toast.style.backgroundColor = 'rgba(251, 191, 36, 0.9)'; // amber-400
    else toast.style.backgroundColor = 'rgba(96, 165, 250, 0.9)'; // blue-400 (info)

    toast.textContent = message;
    return toast;
}

/**
 * Displays a toast notification at the bottom-right of the screen.
 *
 * @param {string} message - The message to display in the toast.
 * @param {'info' | 'success' | 'error' | 'warning'} [type='info'] - The type of notification, influencing its appearance.
 * @param {number} [duration=3000] - Duration in milliseconds for the toast to be visible.
 */
export function showToastImpl(message, type = "info", duration = 3000) { // Added export
    if (!toastContainerEl) {
        console.error("[UIManager] Toast container element not found. Cannot display toast.");
        alert(`${type.toUpperCase()}: ${message}`); // Fallback to alert
        return;
    }

    const toast = _createToastElement(message, type);
    toastContainerEl.appendChild(toast);

    // Animate in (e.g., fade in and slide up)
    setTimeout(() => toast.classList.add("show"), 10); // Small delay for CSS transition

    // Animate out and remove after duration
    setTimeout(() => {
        toast.classList.remove("show");
        // Remove the element after the fade-out transition completes
        toast.addEventListener("transitionend", () => {
            if (toast.parentNode === toastContainerEl) toastContainerEl.removeChild(toast);
        }, { once: true });
        // Fallback removal if transitionend doesn't fire (e.g. display:none directly)
        setTimeout(() => {
            if (toast.parentNode === toastContainerEl) toastContainerEl.removeChild(toast);
        }, duration + 500); // Ensure removal after transition + buffer
    }, duration);
}
// --- End Toast Notification Functions ---
