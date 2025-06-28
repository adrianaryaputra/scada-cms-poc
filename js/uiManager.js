import {
    saveState,
    getCurrentState,
    getUndoStack,
    replaceTagAddress,
    deleteFromTagDatabase
} from './stateManager.js';
import { componentFactory } from './componentFactory.js'; // Untuk addComponentPanel
import { mqttFunctions } from './app.js'; // Cara impor mqttFunctions perlu diperbaiki
                                        // Idealnya, app.js mengekspor getter atau mqttFunctions di-pass saat init.
                                        // Untuk sementara, kita coba impor langsung, tapi ini bisa jadi circular dependency.
                                        // Akan lebih baik jika app.js mem-pass mqttFunctions ke initUiManager.

// Referensi ke elemen DOM dan state/modul lain
let modeToggleEl, modeLabelEl, deleteBtnEl, addComponentPanelEl, contextMenuEl,
    contextMenuTitleEl, contextMenuContentEl, closeContextMenuBtnEl,
    aiPopupChatEl, aiFabEl, closeAiPopupBtnEl, aiSettingsBtnEl, aiSettingsPanelEl,
    closeAiSettingsBtnEl, geminiApiKeyInputEl;

let konvaRefsForUi; // Untuk mengakses tr, layer dari KonvaManager
let isSimulationModeState; // Boolean, bukan fungsi getter
let currentContextMenuNode = null; // Dikelola di sini
let clipboard = null;
let pasteOffset = 0;

// Fungsi yang akan diimpor/dipanggil dari modul lain
let konvaHandleContextMenuClose; // Dari konvaManager
let konvaSelectNodes; // Fungsi selectNodes yang sebenarnya ada di konvaManager atau app.js (akan dipusatkan)
let getIsSimulationModeFunc; // Dari app.js
let setIsSimulationModeFunc; // Dari app.js


export function initUiManager(
    konvaRefs, // { stage, layer, tr, guideLayer, handleContextMenuCloseForSaveState, selectNodes }
    getSimModeFunc, // () => isSimulationMode
    setSimModeFunc, // (value) => { isSimulationMode = value; }
    getMqttFuncs // () => mqttFunctions dari app.js
) {
    konvaRefsForUi = konvaRefs;
    getIsSimulationModeFunc = getSimModeFunc;
    setIsSimulationModeFunc = setSimModeFunc; // Fungsi untuk update state simulasi di app.js
    konvaHandleContextMenuClose = konvaRefs.handleContextMenuCloseForSaveState;
    konvaSelectNodes = konvaRefs.selectNodes; // Asumsi konvaManager mengekspor selectNodes atau app.js menyediakan wrapper

    // Cache elemen DOM
    modeToggleEl = document.getElementById("mode-toggle");
    modeLabelEl = document.getElementById("mode-label");
    deleteBtnEl = document.getElementById("delete-btn"); // Perlu dicek apakah tombol ini ada
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

    isSimulationModeState = getIsSimulationModeFunc(); // Dapatkan nilai awal

    setupEventListeners(getMqttFuncs);

    // Pastikan deleteBtn ada sebelum mencoba mengakses propertinya
    if (deleteBtnEl) {
        deleteBtnEl.disabled = true; // Default state
        deleteBtnEl.classList.add("btn-disabled");
    }
}

function setMode(isSimulation) {
    setIsSimulationModeFunc(isSimulation); // Update state di app.js
    isSimulationModeState = isSimulation; // Update state lokal

    if (konvaRefsForUi.tr) konvaRefsForUi.tr.nodes([]);
    hideContextMenu(); // Panggil versi lokal

    if (konvaRefsForUi.layer) {
        konvaRefsForUi.layer.find(".hmi-component").forEach((node) => node.draggable(!isSimulation));
        if (konvaRefsForUi.tr) konvaRefsForUi.tr.visible(!isSimulation);
    }

    if (addComponentPanelEl) addComponentPanelEl.style.display = isSimulation ? "none" : "block";
    if (aiPopupChatEl) aiPopupChatEl.classList.add("hidden");
    if (aiFabEl) aiFabEl.style.display = isSimulation ? "none" : "block";
    if (modeLabelEl) modeLabelEl.textContent = isSimulation ? "Mode Simulasi" : "Mode Desain";

    // Interval simulasi akan dikelola di app.js karena akses ke layer.find
    // Atau, app.js bisa memanggil fungsi start/stopSimulation di sini.
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
    hideContextMenu(); // Panggil versi lokal
}


function hideContextMenu() {
    if (currentContextMenuNode && typeof konvaHandleContextMenuClose === 'function') {
        konvaHandleContextMenuClose(); // Panggil fungsi dari konvaManager untuk save state jika perlu
    }
    if (contextMenuEl) contextMenuEl.style.display = "none";
    currentContextMenuNode = null;
}

function populateContextMenu(node) {
    if (!node || !contextMenuTitleEl || !contextMenuContentEl) return;
    currentContextMenuNode = node;
    const attrs = node.attrs;
    contextMenuTitleEl.textContent = `Edit ${attrs.componentType}`;
    let html = ``;
    html += `<div class="mb-2"><label class="font-bold text-cyan-200">Address (Tag)</label><input type="text" data-prop="address" value="${attrs.address}" class="w-full bg-gray-600 p-1 rounded mt-1 font-mono"></div>`;
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
        default:
            console.warn(`Tidak ada opsi konfigurasi untuk komponen ${attrs.componentType}`);
            return;
    }
    if (contextMenuContentEl) contextMenuContentEl.innerHTML = html;
}

function handleCopy() {
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
         // Panggil subscribe MQTT untuk komponen baru jika perlu
        const currentMqttFuncs = typeof getMqttFuncs === 'function' ? getMqttFuncs() : {};
        if (currentMqttFuncs.subscribeToComponentAddress) {
            newNodes.forEach(node => {
                if (node.attrs.address) currentMqttFuncs.subscribeToComponentAddress(node.attrs.address);
            });
        }
    }
}


function setupEventListeners(getMqttFuncs) {
    if (modeToggleEl) modeToggleEl.addEventListener("change", (e) => setMode(e.target.checked));

    if (contextMenuEl) {
        contextMenuEl.addEventListener("input", (e) => {
            if (!currentContextMenuNode) return;
            const prop = e.target.dataset.prop;
            let value = e.target.type === "number" ? parseFloat(e.target.value) : e.target.value;
            if (prop === "address") {
                const oldAddress = currentContextMenuNode.attrs.address;
                replaceTagAddress(oldAddress, value); // Dari stateManager
            }
            currentContextMenuNode.setAttr(prop, value);
            currentContextMenuNode.updateState?.();
            // Tidak perlu saveState() eksplisit di sini, akan dihandle oleh hideContextMenu -> konvaHandleContextMenuClose
        });
    }

    if (closeContextMenuBtnEl) closeContextMenuBtnEl.addEventListener("click", hideContextMenu);

    if (addComponentPanelEl) {
        addComponentPanelEl.addEventListener("click", (e) => {
            if (e.target.matches("button[data-component]")) {
                const type = e.target.dataset.component;
                const component = componentFactory.create(type); // Dari componentFactory.js
                if (component && konvaRefsForUi.layer) {
                    konvaRefsForUi.layer.add(component);
                    saveState(); // Dari stateManager.js
                    const currentMqttFuncs = typeof getMqttFuncs === 'function' ? getMqttFuncs() : {};
                    if (currentMqttFuncs.subscribeToComponentAddress && component.attrs.address) {
                        currentMqttFuncs.subscribeToComponentAddress(component.attrs.address);
                    }
                }
            }
        });
    }

    if (deleteBtnEl) {
        deleteBtnEl.addEventListener("click", () => {
            if (!konvaRefsForUi.tr) return;
            const nodesToDelete = konvaRefsForUi.tr.nodes();
            if (nodesToDelete.length > 0) {
                saveState(); // Dari stateManager.js
                const currentMqttFuncs = typeof getMqttFuncs === 'function' ? getMqttFuncs() : {};
                nodesToDelete.forEach((node) => {
                    if (currentMqttFuncs.unsubscribeFromComponentAddress && node.attrs.address) {
                        currentMqttFuncs.unsubscribeFromComponentAddress(node.attrs.address);
                    }
                    deleteFromTagDatabase(node.attrs.address); // Dari stateManager.js
                    node.destroy();
                });
            }
            selectNodes([]); // Panggil versi lokal
        });
    }

    // Event listener window keydown
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
        }

        if (e.key === "Escape") hideContextMenu();
        if ((e.key === "Delete" || e.key === "Backspace") && konvaRefsForUi.tr && konvaRefsForUi.tr.nodes().length > 0 && !isSimulationModeState) {
             if (deleteBtnEl) deleteBtnEl.click(); // Trigger klik tombol hapus
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

// Ekspor fungsi yang mungkin perlu dipanggil dari konvaManager atau app.js
export { hideContextMenu, populateContextMenu, currentContextMenuNode };
