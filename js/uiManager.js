/**
 * uiManager.js - Manages UI elements, interactions, context menus, and mode toggling.
 */
import {
    saveState,
    // getCurrentState, // Not directly used by uiManager, but kept for context
    handleUndo,
    handleRedo,
    deleteDeviceVariableState
} from './stateManager.js';
import { componentFactory } from './componentFactory.js';
import { getDevices } from './deviceManager.js';
import { GRID_SIZE } from './config.js'; // Used for paste offset

// Module-level variables for DOM elements and state
let modeToggleEl, modeLabelEl, deleteBtnEl, addComponentPanelEl, contextMenuEl,
    contextMenuTitleEl, contextMenuContentEl, closeContextMenuBtnEl,
    aiPopupChatEl, aiFabEl, closeAiPopupBtnEl, aiSettingsBtnEl, aiSettingsPanelEl,
    closeAiSettingsBtnEl, geminiApiKeyInputEl;

let konvaRefsForUi = {}; // References to Konva stage, layers, transformer
let isSimulationModeState = false; // Local cache of simulation mode
let currentContextMenuNode = null; // The Konva node currently targeted by the context menu
let clipboard = null; // Stores copied Konva nodes' data
let pasteOffset = 0; // Offset for pasting components to avoid exact overlap

// Functions passed from other modules (primarily konvaManager)
let konvaHandleContextMenuClose;
let konvaSelectNodes; // Function from konvaManager to select nodes

// Functions passed from app.js
let getIsSimulationModeFunc;
let setIsSimulationModeFunc;

/**
 * Sets the Konva node currently targeted by the context menu.
 * Exported for use by konvaManager.
 * @param {Konva.Node|null} node - The Konva node or null.
 */
export function setCurrentContextMenuNode(node) {
    currentContextMenuNode = node;
}

/**
 * Gets the Konva node currently targeted by the context menu.
 * Exported for use by konvaManager.
 * @returns {Konva.Node|null}
 */
export function getCurrentContextMenuNode() {
    return currentContextMenuNode;
}

/**
 * Allows konvaManager to set its references (stage, layer, tr) for uiManager to use.
 * This is part of a common pattern for handling inter-module dependencies after initialization.
 * @param {object} konvaRefs - Object containing Konva references.
 */
export function setKonvaRefs(konvaRefs) {
    konvaRefsForUi = konvaRefs;
    if (konvaRefs && konvaRefs.handleContextMenuCloseForSaveState) {
        // Used to notify konvaManager to save state when context menu is hidden,
        // ensuring changes made in the menu are part of the undo stack.
        konvaHandleContextMenuClose = konvaRefs.handleContextMenuCloseForSaveState;
    }
}

/**
 * Initializes the UI Manager.
 * Caches DOM elements and sets up initial UI state and event listeners.
 * @param {object} kr - Initially empty object, will be populated by konvaManager and passed back via setKonvaRefs.
 * @param {function} getSimModeFunc - Function to get the current simulation mode state from app.js.
 * @param {function} setSimModeFunc - Function to set the simulation mode state in app.js.
 * @param {function} getDeviceByIdFunc - Function from deviceManager to get device details (used by context menu).
 * @returns {object} An interface of functions that other modules can use to interact with the UI.
 */
export function initUiManager(
    kr, // konvaRefs are passed initially empty, then set via setKonvaRefs
    getSimModeFunc,
    setSimModeFunc,
    getDeviceByIdFunc // Currently unused directly in setupEventListeners, but available
) {
    konvaRefsForUi = kr; // Store initial (likely empty) konvaRefs
    getIsSimulationModeFunc = getSimModeFunc;
    setIsSimulationModeFunc = setSimModeFunc;
    // konvaHandleContextMenuClose and konvaSelectNodes will be set later if konvaRefs has them.

    // Cache all relevant DOM elements for performance and cleaner access
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

    isSimulationModeState = getIsSimulationModeFunc(); // Get initial simulation mode

    setupEventListeners(); // Setup all event listeners for UI elements

    // Initialize delete button state
    if (deleteBtnEl) {
        deleteBtnEl.disabled = true;
        deleteBtnEl.classList.add("btn-disabled");
    }

    // Return the public interface for uiManager
    return {
        hideContextMenu,
        populateContextMenu,
        selectNodes, // This will be the uiManager's own selectNodes function
        setCurrentContextMenuNode,
        getCurrentContextMenuNode,
        setKonvaRefs, // Allow other modules (konvaManager) to provide konvaRefs
    };
}

/**
 * Toggles the application between Design and Simulation mode.
 * Updates UI elements and component draggability accordingly.
 * @param {boolean} isSimulation - True for simulation mode, false for design mode.
 */
function setMode(isSimulation) {
    setIsSimulationModeFunc(isSimulation); // Update central simulation mode state
    isSimulationModeState = isSimulation;  // Update local cache

    if (konvaRefsForUi.tr) konvaRefsForUi.tr.nodes([]); // Clear transformer selection
    hideContextMenu(); // Hide context menu when mode changes

    // Update Konva layer components' draggability and transformer visibility
    if (konvaRefsForUi.layer) {
        konvaRefsForUi.layer.find(".hmi-component").forEach((node) => node.draggable(!isSimulation));
        if (konvaRefsForUi.tr) konvaRefsForUi.tr.visible(!isSimulation);
    }

    // Toggle visibility of UI panels based on mode
    if (addComponentPanelEl) addComponentPanelEl.style.display = isSimulation ? "none" : "block";
    if (aiPopupChatEl) aiPopupChatEl.classList.add("hidden"); // Hide AI chat in sim mode
    if (aiFabEl) aiFabEl.style.display = isSimulation ? "none" : "block"; // Hide AI FAB in sim mode
    if (modeLabelEl) modeLabelEl.textContent = isSimulation ? "Mode Simulasi" : "Mode Desain";
}

/**
 * Selects Konva nodes and updates the transformer and delete button state.
 * This is the uiManager's own implementation, used internally and potentially by konvaManager.
 * @param {Array<Konva.Node>} [nodesToSelect=[]] - Array of Konva nodes to select.
 */
export function selectNodes(nodesToSelect = []) {
    if (isSimulationModeState) return; // No selection in simulation mode
    if (!konvaRefsForUi.tr || !konvaRefsForUi.layer) return; // Ensure Konva refs are available

    // Adjust transformer aspect ratio based on selected node type (e.g., for labels)
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
    konvaRefsForUi.layer.find(".hmi-component").forEach((n) => {
        const isSelected = nodesToSelect.includes(n);
        n.draggable(isSelected && !isSimulationModeState); // Ensure draggability respects sim mode
    });

    hideContextMenu(); // Hide context menu when selection changes
}

/**
 * Handles the copy operation for selected Konva nodes.
 * Stores serialized node data in the clipboard.
 */
function handleCopy() {
    // console.debug("handleCopy triggered");
    if (!konvaRefsForUi.tr || isSimulationModeState) return; // No copy in sim mode or if no transformer
    const selectedNodes = konvaRefsForUi.tr.nodes();
    if (selectedNodes.length === 0) {
        clipboard = null;
        return;
    }
    pasteOffset = 0; // Reset paste offset for a new copy action
    clipboard = selectedNodes.map((node) => {
        const properties = { ...node.attrs };
        // Remove properties that should be unique or reset for pasted components
        delete properties.id;
        // Keep deviceId and variableName for potential re-binding, but address (legacy) might need review
        // delete properties.address; // Consider if legacy address should be cleared
        return {
            componentType: properties.componentType,
            properties: properties, // Store all other properties
        };
    });
    // console.debug(`${clipboard.length} element(s) copied.`);
}

/**
 * Handles the paste operation.
 * Creates new components from clipboard data and adds them to the Konva layer.
 */
function handlePaste() {
    // console.debug("handlePaste triggered");
    if (!clipboard || clipboard.length === 0 || !konvaRefsForUi.layer || isSimulationModeState) return;

    pasteOffset += GRID_SIZE; // Increment offset for subsequent pastes
    const newNodes = [];
    clipboard.forEach((item) => {
        const newProps = { ...item.properties };
        newProps.x = (newProps.x || 0) + pasteOffset;
        newProps.y = (newProps.y || 0) + pasteOffset;
        // Clear potentially problematic bindings for pasted components, forcing user to re-bind
        delete newProps.deviceId;
        delete newProps.variableName;
        delete newProps.address; // Also clear legacy address

        const newComponent = componentFactory.create(item.componentType, newProps);
        if (newComponent) {
            konvaRefsForUi.layer.add(newComponent);
            newNodes.push(newComponent);
        }
    });

    if (newNodes.length > 0) {
        saveState(); // Save state after adding new components
        selectNodes(newNodes); // Select the newly pasted components
        // console.debug(`${newNodes.length} element(s) pasted.`);
    }
}

/**
 * Hides the context menu and clears the current context menu node.
 * Notifies konvaManager if a save state is needed (e.g., changes were made in the menu).
 */
export function hideContextMenu() {
    if (currentContextMenuNode && typeof konvaHandleContextMenuClose === 'function') {
        // This callback might be set by konvaManager to trigger a saveState
        // if the context menu was used to modify a node.
        konvaHandleContextMenuClose();
    }
    if (contextMenuEl) contextMenuEl.style.display = "none";
    currentContextMenuNode = null;
}


// --- Helper functions for populateContextMenu ---
function _createDeviceVariableBindingsHTML(attrs) {
    if (attrs.componentType === 'label') return ''; // Labels don't bind to device data

    const devices = getDevices(); // Array of device config objects from deviceManager
    let deviceOptionsHtml = '<option value="">-- Select Device --</option>';
    deviceOptionsHtml += devices.map(d =>
        `<option value="${d.id}" ${attrs.deviceId === d.id ? 'selected' : ''}>${d.name} (ID: ${d.id.substring(0,8)})</option>`
    ).join('');

    let variableOptionsHtml = '<option value="">-- Select Variable --</option>';
    if (attrs.deviceId) {
        const selectedDevice = devices.find(d => d.id === attrs.deviceId);
        if (selectedDevice && Array.isArray(selectedDevice.variables)) {
            variableOptionsHtml += selectedDevice.variables
                .map(v => `<option value="${v.name}" ${attrs.variableName === v.name ? 'selected' : ''}>${v.name}</option>`)
                .join('');
        }
    }

    return `
        <div class="mb-2">
            <label class="font-bold text-cyan-200">Device</label>
            <select data-prop="deviceId" id="context-menu-device-select" class="w-full bg-gray-600 p-1 rounded mt-1 text-xs">
                ${deviceOptionsHtml}
            </select>
        </div>
        <div class="mb-2">
            <label class="font-bold text-cyan-200">Variable</label>
            <select data-prop="variableName" id="context-menu-variable-select" class="w-full bg-gray-600 p-1 rounded mt-1 text-xs" ${!attrs.deviceId ? 'disabled' : ''}>
                ${variableOptionsHtml}
            </select>
        </div>`;
}

function _createCommonPropertiesHTML(attrs) {
    return `
        <div class="mb-2">
            <label class="font-bold">Label</label>
            <input type="text" data-prop="label" value="${attrs.label || ""}" class="w-full bg-gray-600 p-1 rounded mt-1 text-xs">
        </div>`;
}

function _createBitLampPropertiesHTML(attrs) {
    return `
        <div class="mb-1">
            <label class="font-bold">Shape</label>
            <select data-prop="shapeType" class="w-full bg-gray-600 p-1 rounded mt-1 text-xs">
                <option value="circle" ${attrs.shapeType === "circle" ? "selected" : ""}>Circle</option>
                <option value="rect" ${attrs.shapeType === "rect" ? "selected" : ""}>Rectangle</option>
            </select>
        </div>
        <div class="mb-1">
            <label class="font-bold">ON Color</label>
            <input type="color" data-prop="onColor" value="${attrs.onColor || '#00FF00'}" class="w-full h-8 bg-gray-600 p-0 rounded mt-1">
        </div>
        <div class="mb-1">
            <label class="font-bold">OFF Color</label>
            <input type="color" data-prop="offColor" value="${attrs.offColor || '#FF0000'}" class="w-full h-8 bg-gray-600 p-0 rounded mt-1">
        </div>`;
}

function _createNumericDisplayPropertiesHTML(attrs) {
    return `
        <div class="mb-1">
            <label class="font-bold">Units</label>
            <input type="text" data-prop="units" value="${attrs.units || ''}" class="w-full bg-gray-600 p-1 rounded mt-1 text-xs">
        </div>
        <div class="mb-1">
            <label class="font-bold">Decimal Places</label>
            <input type="number" data-prop="decimalPlaces" value="${attrs.decimalPlaces || 0}" min="0" class="w-full bg-gray-600 p-1 rounded mt-1 text-xs">
        </div>`;
}

function _createBitSwitchPropertiesHTML(attrs) {
    return `
        <div class="mb-1">
            <label class="font-bold">OFF Text</label>
            <input type="text" data-prop="offText" value="${attrs.offText || "OFF"}" class="w-full bg-gray-600 p-1 rounded mt-1 text-xs">
        </div>
        <div class="mb-1">
            <label class="font-bold">ON Text</label>
            <input type="text" data-prop="onText" value="${attrs.onText || "ON"}" class="w-full bg-gray-600 p-1 rounded mt-1 text-xs">
        </div>
        <div class="mb-1">
            <label class="font-bold">ON Color</label>
            <input type="color" data-prop="onColor" value="${attrs.onColor || '#00FF00'}" class="w-full h-8 bg-gray-600 p-0 rounded mt-1">
        </div>
        <div class="mb-1">
            <label class="font-bold">OFF Color</label>
            <input type="color" data-prop="offColor" value="${attrs.offColor || '#CCCCCC'}" class="w-full h-8 bg-gray-600 p-0 rounded mt-1">
        </div>`;
}

function _createWordLampPropertiesHTML(attrs) {
    // For WordLamp, 'states' is an array of objects. For simplicity, we might only allow editing predefined sets or a JSON representation.
    // Current implementation shows a default, not editable via simple fields here.
    // A more complex editor would be needed for `attrs.states`.
    const defaultStates = JSON.stringify([{ value: 0, text: "STOPPED", color: "#d9534f" },{ value: 1, text: "RUNNING", color: "#5cb85c" }]);
    const isDefaultSelected = JSON.stringify(attrs.states) === defaultStates;
    return `
        <div class="mb-1">
            <label class="font-bold">States Definition</label>
            <select data-prop="states" class="w-full bg-gray-600 p-1 rounded mt-1 text-xs">
                <option value='${defaultStates}' ${isDefaultSelected ? "selected" : ""}>Default (STOPPED/RUNNING)</option>
                <!-- Add other predefined states or a textarea for JSON input if needed -->
            </select>
            <small class="text-gray-400 text-xs">Editing custom states requires direct JSON modification or an advanced editor.</small>
        </div>`;
}

function _createLabelPropertiesHTML(attrs) {
    return `
        <div class="mb-1">
            <label class="font-bold">Text</label>
            <input type="text" data-prop="text" value="${attrs.text || "Label"}" class="w-full bg-gray-600 p-1 rounded mt-1 text-xs">
        </div>
        <div class="mb-1">
            <label class="font-bold">Font Size</label>
            <input type="number" data-prop="fontSize" value="${attrs.fontSize || 16}" min="1" class="w-full bg-gray-600 p-1 rounded mt-1 text-xs">
        </div>
        <div class="mb-1">
            <label class="font-bold">Text Color</label>
            <input type="color" data-prop="fill" value="${attrs.fill || '#FFFFFF'}" class="w-full h-8 bg-gray-600 p-0 rounded mt-1">
        </div>
        <div class="mb-1">
            <label class="font-bold">Width (auto if 0)</label>
            <input type="number" data-prop="width" value="${attrs.width || 0}" min="0" class="w-full bg-gray-600 p-1 rounded mt-1 text-xs">
        </div>
        <div class="mb-1">
            <label class="font-bold">Alignment</label>
            <select data-prop="align" class="w-full bg-gray-600 p-1 rounded mt-1 text-xs">
                <option value="left" ${attrs.align === "left" ? "selected" : ""}>Left</option>
                <option value="center" ${attrs.align === "center" ? "selected" : ""}>Center</option>
                <option value="right" ${attrs.align === "right" ? "selected" : ""}>Right</option>
            </select>
        </div>`;
}

/**
 * Populates the context menu with properties of the given Konva node.
 * @param {Konva.Node} node - The Konva node whose properties are to be displayed.
 */
export function populateContextMenu(node) {
    if (!node || !contextMenuTitleEl || !contextMenuContentEl) return;
    currentContextMenuNode = node; // Set the currently active node for the context menu
    const attrs = node.attrs;
    contextMenuTitleEl.textContent = `Edit ${attrs.componentType || 'Component'}`;

    let html = _createDeviceVariableBindingsHTML(attrs);
    html += _createCommonPropertiesHTML(attrs);

    // Add component-specific properties
    switch (attrs.componentType) {
        case "bit-lamp":
            html += _createBitLampPropertiesHTML(attrs);
            break;
        case "numeric-display":
            html += _createNumericDisplayPropertiesHTML(attrs);
            break;
        case "bit-switch":
            html += _createBitSwitchPropertiesHTML(attrs);
            break;
        case "word-lamp":
            html += _createWordLampPropertiesHTML(attrs);
            break;
        case "label":
            html += _createLabelPropertiesHTML(attrs);
            break;
        default:
            html += `<p class="text-xs text-gray-400">No specific properties for this component type.</p>`;
    }

    if (contextMenuContentEl) contextMenuContentEl.innerHTML = html;
    if (contextMenuEl) contextMenuEl.style.display = "block"; // Show the context menu
}


/**
 * Sets up all event listeners for UI elements.
 * Called once during initialization.
 */
function setupEventListeners() {
    // Mode Toggle (Design/Simulation)
    if (modeToggleEl) {
        modeToggleEl.addEventListener("change", (e) => setMode(e.target.checked));
    }

    // Context Menu Interactions
    if (contextMenuEl) {
        // Handle input changes within the context menu
        contextMenuEl.addEventListener("input", (e) => {
            if (!currentContextMenuNode) return;
            const target = e.target;
            const prop = target.dataset.prop;
            if (!prop) return;

            let value = target.type === "number" ? parseFloat(target.value) : target.value;
            if (target.type === "checkbox") value = target.checked;

            // Special handling if deviceId changes: re-populate to update variable dropdown
            if (prop === 'deviceId') {
                currentContextMenuNode.setAttr('variableName', ''); // Clear selected variable
                currentContextMenuNode.setAttr(prop, value);       // Set new deviceId
                populateContextMenu(currentContextMenuNode); // Re-populate the entire menu
            } else {
                currentContextMenuNode.setAttr(prop, value);
            }
            currentContextMenuNode.updateState?.(); // Trigger visual update of the component
            // saveState(); // Consider if state should be saved on every input or on menu close
        });

        // Handle 'change' for select elements more reliably (deviceId, variableName)
        contextMenuContentEl.addEventListener('change', (e) => {
            if (!currentContextMenuNode) return;
            const target = e.target;
            const prop = target.dataset.prop;

            if (prop === 'deviceId') { // Already handled by 'input' listener's re-population
                // currentContextMenuNode.setAttr('deviceId', target.value);
                // currentContextMenuNode.setAttr('variableName', '');
                // populateContextMenu(currentContextMenuNode); // This would be redundant if input also fires
            } else if (prop === 'variableName') {
                currentContextMenuNode.setAttr('variableName', target.value);
            } else if (target.tagName === 'SELECT' && prop) { // Catch other selects if any
                 currentContextMenuNode.setAttr(prop, target.value);
            }
            currentContextMenuNode.updateState?.();
        });
    }
    if (closeContextMenuBtnEl) {
        closeContextMenuBtnEl.addEventListener("click", hideContextMenu);
    }

    // Add Component Panel
    if (addComponentPanelEl) {
        addComponentPanelEl.addEventListener("click", (e) => {
            if (e.target.matches("button[data-component]")) {
                const type = e.target.dataset.component;
                const component = componentFactory.create(type); // Default position, etc.
                if (component && konvaRefsForUi.layer) {
                    konvaRefsForUi.layer.add(component);
                    saveState(); // Save state after adding a new component
                }
            }
        });
    }

    // Delete Button
    if (deleteBtnEl) {
        deleteBtnEl.addEventListener("click", () => {
            if (!konvaRefsForUi.tr || isSimulationModeState) return;
            const nodesToDelete = konvaRefsForUi.tr.nodes();
            if (nodesToDelete.length > 0) {
                saveState(); // Save state before destroying nodes for undo
                nodesToDelete.forEach((node) => {
                    const deviceId = node.attrs.deviceId;
                    const variableName = node.attrs.variableName;
                    // If the component was bound to a device variable, clear that variable's state
                    if (deviceId && variableName) {
                        deleteDeviceVariableState(deviceId, variableName);
                    }
                    node.destroy(); // Remove node from Konva layer
                });
                konvaRefsForUi.tr.nodes([]); // Clear transformer
                selectNodes([]); // Update selection state (which also updates delete button)
            }
        });
    }

    // Global Keyboard Shortcuts
    window.addEventListener("keydown", (e) => {
        const activeEl = document.activeElement;
        // Ignore keyboard shortcuts if an input field or textarea is focused
        if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA" || activeEl.isContentEditable)) return;

        if ((e.ctrlKey || e.metaKey) && !isSimulationModeState) { // Shortcuts for design mode
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
            hideContextMenu();
            // Optionally, could also clear selection: if (konvaRefsForUi.tr) selectNodes([]);
        }
        if ((e.key === "Delete" || e.key === "Backspace") &&
            konvaRefsForUi.tr && konvaRefsForUi.tr.nodes().length > 0 &&
            !isSimulationModeState) {
             if (deleteBtnEl && !deleteBtnEl.disabled) deleteBtnEl.click();
        }
    });

    // AI Popup Listeners
    if (aiFabEl) aiFabEl.addEventListener("click", () => aiPopupChatEl?.classList.toggle("hidden"));
    if (closeAiPopupBtnEl) closeAiPopupBtnEl.addEventListener("click", () => aiPopupChatEl?.classList.add("hidden"));
    if (aiSettingsBtnEl) aiSettingsBtnEl.addEventListener("click", () => aiSettingsPanelEl?.classList.remove("hidden"));
    if (closeAiSettingsBtnEl) closeAiSettingsBtnEl.addEventListener("click", () => aiSettingsPanelEl?.classList.add("hidden"));

    // Gemini API Key Persistence
    if (geminiApiKeyInputEl) {
        geminiApiKeyInputEl.value = localStorage.getItem("geminiApiKey") || "";
        geminiApiKeyInputEl.addEventListener("change", (e) => localStorage.setItem("geminiApiKey", e.target.value));
    }
}
