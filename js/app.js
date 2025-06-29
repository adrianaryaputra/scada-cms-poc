/**
 * app.js - Main application entry point.
 * Initializes all core modules and sets up global event listeners.
 * Coordinates the overall application structure and flow.
 */

import { GRID_SIZE } from './config.js';
import { addMessageToChatLog } from './utils.js'; // Only addMessageToChatLog is directly used by app.js
import {
    initStateManager,
    saveState,
    handleUndo as smHandleUndo, // Renamed for clarity
    handleRedo as smHandleRedo, // Renamed for clarity
    getUndoStack // Used by KonvaManager
} from './stateManager.js';
import { componentFactory, initComponentFactory } from './componentFactory.js';
import { initKonvaManager } from './konvaManager.js';
import { initUiManager } from './uiManager.js';
import { initDeviceManager, getDeviceById } from './deviceManager.js'; // getDeviceById is passed around
import ProjectManager from './projectManager.js'; // Import ProjectManager (nama baru)
import { initAiAssistant } from './aiAssistant.js';
import { initTopicExplorer } from './topicExplorer.js';

// --- Application State Variables ---
let isSimulationMode = false; // Tracks if the application is in simulation or design mode
let simulationInterval;       // Interval ID for the simulation loop
let chatHistory = [];         // Stores the history of the AI assistant chat

// --- Module References ---
// These will hold references to initialized modules or their exported interfaces
let konvaRefs = {};     // References related to Konva (stage, layers, etc.)
let uiManagerRefs = {}; // References to UI manager functions (e.g., for context menu)

// --- DOM Element Caching (for elements directly used in this file) ---
// Elements for AI Assistant are cached here as initAiAssistant is called from app.js
const chatLog = document.getElementById("chat-log");
const chatInput = document.getElementById("chat-input");
const sendChatBtn = document.getElementById("send-chat-btn");

// --- Main Application Initialization ---
window.addEventListener("load", () => {
    // Cache DOM elements for Undo/Redo buttons
    const undoBtn = document.getElementById("undo-btn");
    const redoBtn = document.getElementById("redo-btn");

    // --- Simulation Mode Management ---
    // This function is passed to uiManager to control simulation state from UI components (e.g., toggle switch)
    const setIsSimulationModeAndInterval = (value) => {
        isSimulationMode = value;
        if (isSimulationMode) {
            // Start simulation loop: periodically update HMI components
            simulationInterval = setInterval(() => {
                if (konvaRefs.layer) { // Ensure Konva layer is available
                    konvaRefs.layer.find(".hmi-component").forEach((node) => node.updateState?.());
                }
            }, 200); // Simulation update interval (e.g., 200ms)
        } else {
            clearInterval(simulationInterval); // Stop simulation loop
        }
    };

    // --- Initialize UI and Core Logic Modules ---
    // Note: Order of initialization can be important due to dependencies.

    // 1. UI Manager: Handles user interface elements, layout, and general UI interactions.
    //    Dependencies: konvaRefs (passed initially empty, then set), getDeviceById.
    uiManagerRefs = initUiManager(
        konvaRefs,                     // Initially empty, will be populated by konvaManager and passed back
        () => isSimulationMode,        // Function to get current simulation mode state
        setIsSimulationModeAndInterval, // Function to set simulation mode state
        getDeviceById,                 // Function from deviceManager to get device details
        ProjectManager                 // Teruskan ProjectManager
    );

    // 2. Konva Manager: Manages the Konva stage, layers, shapes, and interactions.
    //    Dependencies: uiManagerRefs (for context menu), getUndoStack (for AI).
    konvaRefs = initKonvaManager(
        "container",                   // ID of the Konva container div
        "context-menu",                // ID of the context menu div
        () => isSimulationMode,        // Function to get current simulation mode state
        uiManagerRefs.hideContextMenu, // Function from uiManager
        uiManagerRefs.populateContextMenu, // Function from uiManager
        uiManagerRefs.selectNodes,     // Function from uiManager
        uiManagerRefs.setCurrentContextMenuNode, // Function from uiManager
        uiManagerRefs.getCurrentContextMenuNode, // Function from uiManager
        getUndoStack                   // Function from stateManager
    );

    // Pass fully populated konvaRefs to uiManager if it has a setter for it
    // This completes a common dependency-injection pattern where references are mutually exchanged post-init.
    if (uiManagerRefs.setKonvaRefs) {
        uiManagerRefs.setKonvaRefs(konvaRefs);
    }

    // 3. State Manager: Handles application state, including undo/redo and tag database.
    //    Dependencies: componentFactory, konvaRefs, DOM buttons, getDeviceById.
    initStateManager(
        componentFactory, // from componentFactory module
        konvaRefs.layer,
        konvaRefs.tr,     // Konva Transformer
        undoBtn,
        redoBtn,
        getDeviceById     // Function from deviceManager
    );

    // 4. Component Factory: Responsible for creating HMI components.
    //    Dependencies: konvaRefs, uiManagerRefs.selectNodes.
    initComponentFactory(
        konvaRefs.layer,
        konvaRefs.tr,
        konvaRefs.guideLayer,
        () => isSimulationMode,
        () => konvaRefs.stage, // Function to get Konva stage
        konvaRefs.getDragStartPositions,
        konvaRefs.setDragStartPositions,
        konvaRefs.clearDragStartPositions,
        uiManagerRefs.selectNodes, // Function from uiManager
        konvaRefs.handleDragMove // Function from konvaManager
    );

    // --- Initialize Networking and Feature Modules ---

    // 5. Device Manager & Topic Explorer: Handle communication with the server for device data and MQTT topics.
    //    A single Socket.IO connection is created and shared.
    const deviceSocket = io('/devices'); // Create client-side socket for the '/devices' namespace
    initDeviceManager(deviceSocket);    // Pass socket to DeviceManager
    initTopicExplorer(deviceSocket);    // Pass socket to TopicExplorer

    // 6. Layout Manager: Handles saving, loading, etc., of HMI layouts.
    //    Dependencies: konvaRefs (melalui uiManagerRefs atau langsung), stateManager (akan ditambahkan), componentFactory, deviceSocket.
    //    Untuk saat ini, kita pass konvaRefs.getHmiLayoutAsJson yang ada di dalam konvaRefs.
    //    stateManager tidak lagi di-pass karena fungsinya diimpor langsung oleh ProjectManager.
    ProjectManager.init( // Menggunakan ProjectManager
        konvaRefs,      // Berisi getHmiLayoutAsJson dan clearCanvas
        componentFactory, // componentFactory langsung
        deviceSocket    // Socket untuk komunikasi server
    );

    // 7. AI Assistant: Initializes the AI chat functionality.
    //    Dependencies: DOM elements, chatHistory, konvaRefs, getDeviceById.
    initAiAssistant(
        chatLog,      // DOM element for chat log
        chatInput,    // DOM element for chat input
        sendChatBtn,  // DOM element for send button
        () => chatHistory, // Function to get current chat history
        (newHistory) => { chatHistory = newHistory; }, // Function to update chat history
        konvaRefs,
        getDeviceById // Function from deviceManager
    );

    // --- Final Setup ---

    // Save the initial state of the application (e.g., empty canvas)
    saveState();

    // Add initial greeting message from AI assistant
    addMessageToChatLog(chatLog, chatHistory, "model", "Halo! Saya asisten AI Anda. Apa yang bisa saya bantu rancang hari ini?");

    // Attach event listeners for Undo/Redo buttons
    if (undoBtn) undoBtn.addEventListener("click", smHandleUndo);
    if (redoBtn) redoBtn.addEventListener("click", smHandleRedo);

    // --- Konfirmasi Sebelum Keluar Jika Ada Perubahan Belum Disimpan ---
    // Event listener untuk project management buttons dipindahkan ke uiManager.js
    window.addEventListener('beforeunload', (event) => {
        if (ProjectManager.isProjectDirty()) { // Menggunakan ProjectManager dan nama fungsi baru
            // Standar browser memerlukan returnValue untuk di-set.
            event.preventDefault();
            event.returnValue = '';
            // Browser akan menampilkan dialog konfirmasi generik.
            // Pesan kustom tidak lagi didukung oleh kebanyakan browser modern.
        }
    });
});

// Export GRID_SIZE for potential use by other modules (e.g., aiAssistant for layout calculations)
export { GRID_SIZE };
