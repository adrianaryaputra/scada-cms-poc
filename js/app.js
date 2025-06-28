import { GRID_SIZE } from './config.js';
import { updateStatus, addMessageToChatLog, addThinkingDetails, getCanvasContext, setLoadingState } from './utils.js';
import { getMqttDevice } from './mqttManager.js';
import {
    initStateManager,
    getTagDatabase,
    saveState,
    handleUndo as smHandleUndo,
    handleRedo as smHandleRedo,
    getUndoStack,
    // Fungsi state lain yang mungkin dibutuhkan aiAssistant
    replaceTagAddress,
    deleteFromTagDatabase
} from './stateManager.js';
import { componentFactory, initComponentFactory } from './componentFactory.js';
import { initKonvaManager } from './konvaManager.js';
import { initUiManager } from './uiManager.js';
import { initDeviceManager } from './deviceManager.js';
import { initAiAssistant } from './aiAssistant.js';

// --- Variabel Global Utama ---
let isSimulationMode = false;
let simulationInterval;
let chatHistory = []; // chatHistory tetap di app.js dan di-pass ke aiAssistant

// Referensi ke modul-modul
let konvaRefs = {};
let uiManagerRefs = {};
// Tidak perlu aiAssistantRefs jika tidak ada fungsi yang dipanggil dari app.js ke aiAssistant setelah init

// Cache elemen DOM yang masih dibutuhkan oleh app.js (misal untuk AI init)
const chatLog = document.getElementById("chat-log");
const chatInput = document.getElementById("chat-input");
const sendChatBtn = document.getElementById("send-chat-btn");

// --- EVENT HANDLERS & INITS ---
window.addEventListener("load", () => {
    const undoBtn = document.getElementById("undo-btn");
    const redoBtn = document.getElementById("redo-btn");

    const setIsSimulationModeAndInterval = (value) => {
        isSimulationMode = value;
        if (isSimulationMode) {
            simulationInterval = setInterval(() => {
                if (konvaRefs.layer) {
                    konvaRefs.layer.find(".hmi-component").forEach((n) => n.updateState?.());
                }
            }, 200);
        } else {
            clearInterval(simulationInterval);
        }
    };
    uiManagerRefs = initUiManager(
        konvaRefs,
        () => isSimulationMode,
        setIsSimulationModeAndInterval,
        getMqttDevice // Pass the function to get a device
    );

    konvaRefs = initKonvaManager(
        "container",
        "context-menu",
        () => isSimulationMode,
        uiManagerRefs.hideContextMenu,
        uiManagerRefs.populateContextMenu,
        uiManagerRefs.selectNodes,
        uiManagerRefs.setCurrentContextMenuNode,
        uiManagerRefs.getCurrentContextMenuNode,
        getUndoStack
    );

    if (uiManagerRefs.setKonvaRefs) {
        uiManagerRefs.setKonvaRefs(konvaRefs);
    }

    initStateManager(
        componentFactory,
        konvaRefs.layer,
        konvaRefs.tr,
        undoBtn,
        redoBtn,
        getMqttDevice // Pass the function to get a device
    );

    initComponentFactory(
        konvaRefs.layer,
        konvaRefs.tr,
        konvaRefs.guideLayer,
        () => isSimulationMode,
        () => konvaRefs.stage,
        konvaRefs.getDragStartPositions,
        konvaRefs.setDragStartPositions,
        uiManagerRefs.selectNodes,
        konvaRefs.handleDragMove
    );

    initAiAssistant(
        chatLog,
        chatInput,
        sendChatBtn,
        () => chatHistory,
        (newHistory) => { chatHistory = newHistory; },
        konvaRefs,
        getMqttDevice // Pass the function to get a device
    );

    initDeviceManager();

    saveState();
    addMessageToChatLog(chatLog, chatHistory, "model", "Halo! Saya asisten AI Anda. Apa yang bisa saya bantu rancang hari ini?");

    if(undoBtn) undoBtn.addEventListener("click", smHandleUndo);
    if(redoBtn) redoBtn.addEventListener("click", smHandleRedo);
});

// Ekspor GRID_SIZE untuk digunakan oleh AI prompt builder jika diperlukan (diimpor oleh aiAssistant.js)
export { GRID_SIZE };
