
import {
    saveState,
    getCurrentState,
    handleUndo,
    handleRedo,
    deleteDeviceVariableState
} from './stateManager.js';
import { componentFactory } from './componentFactory.js';
import { getDevices } from './deviceManager.js';

// Referensi ke elemen DOM dan state/modul lain
let modeToggleEl, modeLabelEl, deleteBtnEl, addComponentPanelEl, contextMenuEl,
    contextMenuTitleEl, contextMenuContentEl, closeContextMenuBtnEl,
    aiPopupChatEl, aiFabEl, closeAiPopupBtnEl, aiSettingsBtnEl, aiSettingsPanelEl,
    closeAiSettingsBtnEl, geminiApiKeyInputEl;

let konvaRefsForUi;
let isSimulationModeState;
let currentContextMenuNode = null;
let clipboard = null;
let pasteOffset = 0;

let konvaHandleContextMenuClose;
let konvaSelectNodes;
let getIsSimulationModeFunc;
let setIsSimulationModeFunc;

function setCurrentContextMenuNode(node) {
    currentContextMenuNode = node;
}

function getCurrentContextMenuNode() {
    return currentContextMenuNode;
}

function setKonvaRefs(konvaRefs) {
    konvaRefsForUi = konvaRefs;
    if (konvaRefs && konvaRefs.handleContextMenuCloseForSaveState) {
        konvaHandleContextMenuClose = konvaRefs.handleContextMenuCloseForSaveState;
    }
}

export function initUiManager(
    konvaRefs,
    getSimModeFunc,
    setSimModeFunc,
    getDeviceByIdFunc // Renamed from getMqttDeviceFunc
) {
    konvaRefsForUi = konvaRefs;
    getIsSimulationModeFunc = getSimModeFunc;
    setIsSimulationModeFunc = setSimModeFunc;
    konvaHandleContextMenuClose = konvaRefs.handleContextMenuCloseForSaveState;
    konvaSelectNodes = konvaRefs.selectNodes;

    // Cache elemen DOM
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

    isSimulationModeState = getIsSimulationModeFunc();

    setupEventListeners(getDeviceByIdFunc); // Pass renamed function

    if (deleteBtnEl) {
        deleteBtnEl.disabled = true;
        deleteBtnEl.classList.add("btn-disabled");
    }

    return {
        hideContextMenu,
        populateContextMenu,
        selectNodes,
        setCurrentContextMenuNode,
        getCurrentContextMenuNode,
        setKonvaRefs,
    };
}

function setMode(isSimulation) {
    setIsSimulationModeFunc(isSimulation);
    isSimulationModeState = isSimulation;

    if (konvaRefsForUi.tr) konvaRefsForUi.tr.nodes([]);
    hideContextMenu();

    if (konvaRefsForUi.layer) {
        konvaRefsForUi.layer.find(".hmi-component").forEach((node) => node.draggable(!isSimulation));
        if (konvaRefsForUi.tr) konvaRefsForUi.tr.visible(!isSimulation);
    }

    if (addComponentPanelEl) addComponentPanelEl.style.display = isSimulation ? "none" : "block";
    if (aiPopupChatEl) aiPopupChatEl.classList.add("hidden");
    if (aiFabEl) aiFabEl.style.display = isSimulation ? "none" : "block";
    if (modeLabelEl) modeLabelEl.textContent = isSimulation ? "Mode Simulasi" : "Mode Desain";
}

export function selectNodes(nodes = []) {
    if (isSimulationModeState) return;
    if (!konvaRefsForUi.tr || !konvaRefsForUi.layer) return;

    if (nodes.length === 1 && nodes[0].attrs.componentType === "label") {
        konvaRefsForUi.tr.keepRatio(false);
    } else {
        konvaRefsForUi.tr.keepRatio(true);
    }

    konvaRefsForUi.tr.nodes(nodes);

    if (deleteBtnEl) {
        deleteBtnEl.disabled = nodes.length === 0;
        deleteBtnEl.classList.toggle("btn-disabled", nodes.length === 0);
    }

    konvaRefsForUi.layer.find(".hmi-component").forEach((n) => {
        const isSelected = nodes.includes(n);
        n.draggable(isSelected);
    });

    hideContextMenu();
}

function handleCopy() {
    console.log("handleCopy");
    if (!konvaRefsForUi.tr) return;
    const selectedNodes = konvaRefsForUi.tr.nodes();
    if (selectedNodes.length === 0) {
        clipboard = null;
        return;
    }
    pasteOffset = 0; // Reset paste offset
    clipboard = selectedNodes.map((node) => {
        const properties = { ...node.attrs };
        delete properties.id; // Hapus id agar unik saat paste
        delete properties.address; // Hapus address agar unik saat paste
        return {
            componentType: properties.componentType,
            properties: properties,
        };
    });
    // updateStatus (dari utils.js) akan dipanggil dari app.js jika diperlukan
    console.log(`${clipboard.length} elemen disalin.`);
}

function handlePaste() {
    console.log("handlePaste");
    if (!clipboard || clipboard.length === 0 || !konvaRefsForUi.layer) return;
    const GRID_SIZE_ref = 20; // Ambil dari config.js atau pass saat init
    pasteOffset += GRID_SIZE_ref;
    const newNodes = [];
    clipboard.forEach((item) => {
        const newProps = { ...item.properties };
        newProps.x = (newProps.x || 0) + pasteOffset; // Pastikan x dan y ada
        newProps.y = (newProps.y || 0) + pasteOffset;
        const newComponent = componentFactory.create(item.componentType, newProps);
        if (newComponent) {
            konvaRefsForUi.layer.add(newComponent);
            newNodes.push(newComponent);
        }
    });

    if (newNodes.length > 0) {
        saveState();
        selectNodes(newNodes); // Panggil versi lokal
        console.log(`${newNodes.length} elemen ditempel.`);
        // Client-side subscription logic removed. Server will handle subscriptions.
    }
}

function hideContextMenu() {
    if (currentContextMenuNode && typeof konvaHandleContextMenuClose === 'function') {
        konvaHandleContextMenuClose();
    }
    if (contextMenuEl) contextMenuEl.style.display = "none";
    currentContextMenuNode = null;
}

function populateContextMenu(node) {
    if (!node || !contextMenuTitleEl || !contextMenuContentEl) return;
    currentContextMenuNode = node;
    const attrs = node.attrs;
    contextMenuTitleEl.textContent = `Edit ${attrs.componentType}`;

    const devices = getDevices(); // This is an array of device config objects
    let deviceOptionsHtml = '<option value="">-- Select Device --</option>';
    deviceOptionsHtml += devices.map(d => `<option value="${d.id}" ${attrs.deviceId === d.id ? 'selected' : ''}>${d.name} (ID: ${d.id.substring(0,8)})</option>`).join('');

    let variableOptionsHtml = '<option value="">-- Select Variable --</option>';
    if (attrs.deviceId) {
        const selectedDevice = devices.find(d => d.id === attrs.deviceId);
        if (selectedDevice && Array.isArray(selectedDevice.variables)) {
            variableOptionsHtml += selectedDevice.variables
                .map(v => `<option value="${v.name}" ${attrs.variableName === v.name ? 'selected' : ''}>${v.name}</option>`)
                .join('');
        }
    }

    let html = '';
    if (attrs.componentType !== 'label') { // Labels don't bind to data
        html += `<div class="mb-2">
                    <label class="font-bold text-cyan-200">Device</label>
                    <select data-prop="deviceId" id="context-menu-device-select" class="w-full bg-gray-600 p-1 rounded mt-1 text-xs">
                        ${deviceOptionsHtml}
                    </select>
                 </div>`;
        html += `<div class="mb-2">
                    <label class="font-bold text-cyan-200">Variable</label>
                    <select data-prop="variableName" id="context-menu-variable-select" class="w-full bg-gray-600 p-1 rounded mt-1 text-xs" ${!attrs.deviceId ? 'disabled' : ''}>
                        ${variableOptionsHtml}
                    </select>
                 </div>`;
        // The old "address" input is removed as it's now handled by device variables
    }
    html += `<div class="mb-2"><label class="font-bold">Label</label><input type="text" data-prop="label" value="${attrs.label || ""}" class="w-full bg-gray-600 p-1 rounded mt-1"></div>`;

    switch (attrs.componentType) {
        case "bit-lamp":
            html += `<div class="mb-1"><label class="font-bold">Bentuk</label><select data-prop="shapeType" class="w-full bg-gray-600 p-1 rounded mt-1"><option value="circle" ${attrs.shapeType === "circle" ? "selected" : ""}>Lingkaran</option><option value="rect" ${attrs.shapeType === "rect" ? "selected" : ""}>Persegi</option></select></div>`;
            html += `<div class="mb-1"><label class="font-bold">Warna ON</label><input type="color" data-prop="onColor" value="${attrs.onColor}" class="w-full h-8 bg-gray-600 p-0 rounded mt-1"></div>`;
            html += `<div class="mb-1"><label class="font-bold">Warna OFF</label><input type="color" data-prop="offColor" value="${attrs.offColor}" class="w-full h-8 bg-gray-600 p-0 rounded mt-1"></div>`;
            break;
        case "numeric-display":
            html += `<div class="mb-1"><label class="font-bold">Unit</label><input type="text" data-prop="units" value="${attrs.units}" class="w-full bg-gray-600 p-1 rounded mt-1"></div>`;
            html += `<div class="mb-1"><label class="font-bold">Desimal</label><input type="number" data-prop="decimalPlaces" value="${attrs.decimalPlaces}" class="w-full bg-gray-600 p-1 rounded mt-1"></div>`;
            break;
        case "bit-switch":
            html += `<div class="mb-1"><label class="font-bold">Teks OFF</label><input type="text" data-prop="offText" value="${attrs.offText}" class="w-full bg-gray-600 p-1 rounded mt-1"></div>`;
            html += `<div class="mb-1"><label class="font-bold">Teks ON</label><input type="text" data-prop="onText" value="${attrs.onText}" class="w-full bg-gray-600 p-1 rounded mt-1"></div>`;
            html += `<div class="mb-1"><label class="font-bold">Warna ON</label><input type="color" data-prop="onColor" value="${attrs.onColor}" class="w-full h-8 bg-gray-600 p-0 rounded mt-1"></div>`;
            html += `<div class="mb-1"><label class="font-bold">Warna OFF</label><input type="color" data-prop="offColor" value="${attrs.offColor}" class="w-full h-8 bg-gray-600 p-0 rounded mt-1"></div>`;
            break;
        case "word-lamp":
            html += `<div class="mb-1"><label class="font-bold">Status</label><select data-prop="states" class="w-full bg-gray-600 p-1 rounded mt-1"><option value='[{"value":0,"text":"STOPPED","color":"#d9534f"},{"value":1,"text":"RUNNING","color":"#5cb85c"}]' ${JSON.stringify(attrs.states) === JSON.stringify([{ value: 0, text: "STOPPED", color: "#d9534f" },{ value: 1, text: "RUNNING", color: "#5cb85c" },])? "selected": ""}>Default</option></select></div>`;
            break;
        case "label":
            html += `<div class="mb-1"><label class="font-bold">Teks</label><input type="text" data-prop="text" value="${attrs.text}" class="w-full bg-gray-600 p-1 rounded mt-1"></div>`;
            html += `<div class="mb-1"><label class="font-bold">Ukuran Font</label><input type="number" data-prop="fontSize" value="${attrs.fontSize}" class="w-full bg-gray-600 p-1 rounded mt-1"></div>`;
            html += `<div class="mb-1"><label class="font-bold">Warna Teks</label><input type="color" data-prop="fill" value="${attrs.fill}" class="w-full h-8 bg-gray-600 p-0 rounded mt-1"></div>`;
            html += `<div class="mb-1"><label class="font-bold">Lebar</label><input type="number" data-prop="width" value="${attrs.width}" class="w-full bg-gray-600 p-1 rounded mt-1"></div>`;
            html += `<div class="mb-1"><label class="font-bold">Perataan</label><select data-prop="align" class="w-full bg-gray-600 p-1 rounded mt-1"><option value="left" ${attrs.align === "left" ? "selected" : ""}>Kiri</option><option value="center" ${attrs.align === "center" ? "selected" : ""}>Tengah</option><option value="right" ${attrs.align === "right" ? "selected" : ""}>Kanan</option></select></div>`;
            break;
    }
    if (contextMenuContentEl) contextMenuContentEl.innerHTML = html;
}

function setupEventListeners(getDeviceByIdFunc) { // Renamed parameter
    if (modeToggleEl) modeToggleEl.addEventListener("change", (e) => setMode(e.target.checked));

    if (contextMenuEl) {
        contextMenuEl.addEventListener("input", (e) => {
            if (!currentContextMenuNode) return;

            const prop = e.target.dataset.prop;
            let value = e.target.type === "number" ? parseFloat(e.target.value) : e.target.value;

            // If deviceId changed, clear variableName and repopulate variable dropdown
            if (prop === 'deviceId') {
                currentContextMenuNode.setAttr('variableName', ''); // Clear selected variable
                currentContextMenuNode.setAttr(prop, value); // Set new deviceId
                populateContextMenu(currentContextMenuNode); // Re-populate to update variable dropdown
                                                          // This will cause a recursive call if not handled, but input event should be fine
            } else {
                currentContextMenuNode.setAttr(prop, value);
            }

            currentContextMenuNode.updateState?.();
            // saveState(); // Consider calling saveState() immediately or on context menu close
        });

        // Add change listener specifically for device select to update variable select
        // This is needed because 'input' event might not fire reliably for select changes in all browsers
        // and we need to ensure the variable dropdown is updated.
        contextMenuContentEl.addEventListener('change', (e) => {
            if (!currentContextMenuNode) return;
            const target = e.target;
            if (target.id === 'context-menu-device-select') {
                 currentContextMenuNode.setAttr('deviceId', target.value);
                 currentContextMenuNode.setAttr('variableName', ''); // Clear selected variable
                 // Re-render the context menu content to update the variable dropdown
                 populateContextMenu(currentContextMenuNode);
            } else if (target.id === 'context-menu-variable-select') {
                currentContextMenuNode.setAttr('variableName', target.value);
            }
            currentContextMenuNode.updateState?.();
        });
    }

    if (closeContextMenuBtnEl) closeContextMenuBtnEl.addEventListener("click", hideContextMenu);

    if (addComponentPanelEl) {
        addComponentPanelEl.addEventListener("click", (e) => {
            if (e.target.matches("button[data-component]")) {
                const type = e.target.dataset.component;
                const component = componentFactory.create(type);
                if (component && konvaRefsForUi.layer) {
                    konvaRefsForUi.layer.add(component);
                    saveState();
                }
            }
        });
    }

    if (deleteBtnEl) {
        deleteBtnEl.addEventListener("click", () => {
            if (!konvaRefsForUi.tr) return;
            const nodesToDelete = konvaRefsForUi.tr.nodes();
            if (nodesToDelete.length > 0) {
                saveState(); // Important to save state before destroying
                nodesToDelete.forEach((node) => {
                    const deviceId = node.attrs.deviceId;
                    const variableName = node.attrs.variableName;
                    // Client-side unsubscription logic removed.
                    // Server will handle this based on the component being removed from the saved state.
                    if (deviceId && variableName) {
                        deleteDeviceVariableState(deviceId, variableName);
                    }
                    node.destroy();
                });
            }
            selectNodes([]);
        });
    }

    window.addEventListener("keydown", (e) => {
        const activeEl = document.activeElement;
        if (activeEl && (activeEl.tagName === "INPUT" || activeEl.tagName === "TEXTAREA")) return;

        if ((e.ctrlKey || e.metaKey) && !isSimulationModeState) {
            if (e.key.toLowerCase() === "c") {
                e.preventDefault();
                handleCopy();
            }
            if (e.key.toLowerCase() === "v") {
                e.preventDefault();
                handlePaste();
            }
            if (e.key.toLowerCase() === "z") {
                if (e.shiftKey) {
                    e.preventDefault();
                    handleRedo();
                } else {
                    e.preventDefault();
                    handleUndo();
                }
            }
        }

        if (e.key === "Escape") hideContextMenu();
        if ((e.key === "Delete" || e.key === "Backspace") && konvaRefsForUi.tr && konvaRefsForUi.tr.nodes().length > 0 && !isSimulationModeState) {
             if (deleteBtnEl) deleteBtnEl.click();
        }
    });

    // AI Popup listeners
    if (aiFabEl) aiFabEl.addEventListener("click", () => aiPopupChatEl?.classList.toggle("hidden"));
    if (closeAiPopupBtnEl) closeAiPopupBtnEl.addEventListener("click", () => aiPopupChatEl?.classList.add("hidden"));
    if (aiSettingsBtnEl) aiSettingsBtnEl.addEventListener("click", () => aiSettingsPanelEl?.classList.remove("hidden"));
    if (closeAiSettingsBtnEl) closeAiSettingsBtnEl.addEventListener("click", () => aiSettingsPanelEl?.classList.add("hidden"));
    if (geminiApiKeyInputEl) {
        geminiApiKeyInputEl.value = localStorage.getItem("geminiApiKey") || "";
        geminiApiKeyInputEl.addEventListener("change", (e) => localStorage.setItem("geminiApiKey", e.target.value));
    }
}
