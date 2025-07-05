/**
 * @file app.js
 * @description Main application entry point. Initializes all core modules,
 * sets up global event listeners, and coordinates the overall application structure and flow.
 *
 * The initialization sequence is crucial due to inter-module dependencies.
 * Generally, modules providing interfaces (like UI and Konva managers) are initialized,
 * then their references are passed to modules that consume them.
 *
 * Key Application Parts:
 * - Simulation Mode: Toggles between design and real-time simulation.
 * - Module Initialization: Sets up UI, Konva graphics, state management, component creation,
 *   device communication, project handling, and AI assistance.
 * - Global Event Handling: Manages undo/redo actions and prompts for unsaved changes.
 */

import { GRID_SIZE } from "./config.js";
import { addMessageToChatLog } from "./utils.js";
import {
    initStateManager,
    saveState,
    handleUndo as smHandleUndo,
    handleRedo as smHandleRedo,
    getUndoStack,
} from "./stateManager.js";
import { componentFactory, initComponentFactory } from "./componentFactory.js";
import { initKonvaManager } from "./konvaManager.js";
import { initUiManager } from "./uiManager.js";
import { initDeviceManager, getDeviceById } from "./deviceManager.js";
import ProjectManager from "./projectManager.js";
import { initAiAssistant } from "./aiAssistant.js";
import { initTopicExplorer } from "./topicExplorer.js";

// --- Application State Variables ---

/**
 * @type {boolean} Tracks if the application is in simulation or design mode.
 * @private
 */
let isSimulationMode = false;

/**
 * @type {number|undefined} Interval ID for the simulation loop.
 * @private
 */
let simulationInterval;

/**
 * @type {Array<object>} Stores the history of the AI assistant chat.
 * Each object typically has `role` and `parts`.
 * @private
 */
let chatHistory = [];

// --- DOM Element References (Cached for performance) ---
// Elements directly used or passed by app.js

/** @type {HTMLElement|null} The chat log display area. */
const chatLog = document.getElementById("chat-log");

/** @type {HTMLInputElement|null} The chat input field. */
const chatInput = document.getElementById("chat-input");

/** @type {HTMLButtonElement|null} The button to send chat messages. */
const sendChatBtn = document.getElementById("send-chat-btn");

/** @type {HTMLButtonElement|null} The undo button. */
const undoBtn = document.getElementById("undo-btn");

/** @type {HTMLButtonElement|null} The redo button. */
const redoBtn = document.getElementById("redo-btn");

// --- Main Application Initialization ---
window.addEventListener("load", () => {
    /**
     * @function setIsSimulationModeAndInterval
     * @description Sets the simulation mode and manages the simulation interval.
     * When entering simulation mode, it starts an interval to periodically call `updateState()`
     * on all HMI components on the Konva layer. Exiting simulation mode clears this interval.
     * @param {boolean} value - True to enter simulation mode, false to exit.
     * @private
     */
    const setIsSimulationModeAndInterval = (value) => {
        isSimulationMode = value;
        if (isSimulationMode) {
            simulationInterval = setInterval(() => {
                // konvaRefs.layer might not be available immediately if init order changes slightly
                if (konvaManagerInterface && konvaManagerInterface.layer) {
                    konvaManagerInterface.layer
                        .find(".hmi-component")
                        .forEach((node) => node.updateState?.());
                }
            }, 200); // Simulation update interval (e.g., 200ms)
        } else {
            clearInterval(simulationInterval);
        }
    };

    // --- Module Initialization ---
    // The order is important due to dependencies. Modules exporting interfaces
    // are generally initialized before those that consume them.

    // 1. DeviceManager and TopicExplorer (Networking and Backend Communication)
    //    - Establishes socket connection.
    //    - `ProjectManager.setDirty` is passed as a callback for device changes.
    //    - `getDeviceById` is used by stateManager, uiManager, and aiAssistant.
    const deviceSocket = io("/devices"); // Socket for device and project communication
    initDeviceManager(deviceSocket, ProjectManager.setDirty.bind(ProjectManager));
    initTopicExplorer(deviceSocket);

    // 2. UI Manager: Handles UI elements, interactions, context menus, and mode toggling.
    //    - Receives callbacks for simulation mode and device info.
    //    - Receives ProjectManager for project operations.
    //    - Its interface (`uiManagerInterface`) is used by KonvaManager.
    //    - `konvaManagerInterface` is passed (initially empty) and later populated.
    let konvaManagerInterface = {}; // Will be populated by initKonvaManager
    const uiManagerInterface = initUiManager(
        konvaManagerInterface, // Passed as a reference, will be populated by konvaManager
        () => isSimulationMode,
        setIsSimulationModeAndInterval,
        getDeviceById,
        ProjectManager,
    );

    // 3. Konva Manager: Manages the Konva stage, layers, shapes, and interactions.
    //    - Uses functions from `uiManagerInterface` for context menu and selection.
    //    - Uses `getUndoStack` from `stateManager` for AI context.
    //    - Its interface (`konvaManagerInterface`) provides Konva objects (stage, layer, tr)
    //      and functions needed by `componentFactory`, `stateManager`, `ProjectManager`, and `aiAssistant`.
    konvaManagerInterface = initKonvaManager(
        "container",
        "context-menu",
        () => isSimulationMode,
        uiManagerInterface.hideContextMenu,
        uiManagerInterface.populateContextMenu,
        uiManagerInterface.selectNodes,
        uiManagerInterface.setCurrentContextMenuNode,
        uiManagerInterface.getCurrentContextMenuNode,
        getUndoStack,
    );

    // Complete the dependency cycle: Provide the fully initialized konvaManagerInterface to uiManager.
    if (uiManagerInterface.setKonvaRefs) {
        uiManagerInterface.setKonvaRefs(konvaManagerInterface);
    }

    // 4. State Manager: Handles application state, undo/redo, and the tag database.
    //    - Depends on `componentFactory` for recreating components.
    //    - Uses Konva layer and transformer from `konvaManagerInterface`.
    //    - Uses `getDeviceById` from `deviceManager`.
    initStateManager(
        componentFactory, // componentFactory object itself
        konvaManagerInterface.layer,
        konvaManagerInterface.tr,
        undoBtn,
        redoBtn,
        getDeviceById,
    );

    // 5. Component Factory: Responsible for creating HMI components.
    //    - Uses Konva objects from `konvaManagerInterface`.
    //    - Uses `selectNodes` from `uiManagerInterface`.
    //    - Uses simulation mode status.
    initComponentFactory(
        konvaManagerInterface.layer,
        konvaManagerInterface.tr,
        konvaManagerInterface.guideLayer,
        () => isSimulationMode,
        () => konvaManagerInterface.stage,
        konvaManagerInterface.getDragStartPositions,
        konvaManagerInterface.setDragStartPositions,
        konvaManagerInterface.clearDragStartPositions,
        uiManagerInterface.selectNodes,
        konvaManagerInterface.handleDragMove,
    );

    // 6. Project Manager: Handles saving, loading, importing, and exporting projects.
    //    - Uses `konvaManagerInterface` for HMI layout.
    //    - Uses `componentFactory` for creating components on load/import.
    //    - Uses `deviceSocket` for server communication.
    ProjectManager.init(konvaManagerInterface, componentFactory, deviceSocket);

    // 7. AI Assistant: Manages chat functionality and AI-driven HMI modifications.
    //    - Uses DOM elements for chat UI.
    //    - Manages `chatHistory`.
    //    - Uses `konvaManagerInterface` for canvas context.
    //    - Uses `getDeviceById` for component property suggestions.
    initAiAssistant(
        chatLog,
        chatInput,
        sendChatBtn,
        () => chatHistory,
        (newHistory) => {
            chatHistory = newHistory;
        },
        konvaManagerInterface,
        getDeviceById,
    );

    // --- Final Application Setup ---

    // Save the initial state (e.g., empty canvas) for undo history.
    saveState();

    // Add initial greeting message from AI assistant to the chat.
    if (chatLog) {
        addMessageToChatLog(
            chatLog,
            chatHistory,
            "model",
            "Halo! Saya asisten AI Anda. Apa yang bisa saya bantu rancang hari ini?",
        );
    }

    // Attach event listeners for Undo/Redo buttons.
    if (undoBtn) undoBtn.addEventListener("click", smHandleUndo);
    if (redoBtn) redoBtn.addEventListener("click", smHandleRedo);

    // Add a global event listener to confirm before leaving if there are unsaved changes.
    window.addEventListener("beforeunload", (event) => {
        if (ProjectManager.isProjectDirty()) {
            event.preventDefault(); // Required to trigger the browser's built-in confirmation dialog.
            event.returnValue = ""; // Required for some browsers.
            // Custom messages in the dialog are largely unsupported by modern browsers for security reasons.
        }
    });

    console.log("Aplikasi HMI berhasil diinisialisasi.");
});

// Export GRID_SIZE for potential use by other modules (e.g., aiAssistant for layout calculations)
// No other exports are needed from app.js as it serves as the main entry and coordinator.
export { GRID_SIZE };
