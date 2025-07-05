/**
 * @file Manages device configurations, communication with the server via Socket.IO,
 * and the UI for device and variable management.
 * @module js/deviceManager
 *
 * @description
 * The DeviceManager is responsible for:
 * - Maintaining a local cache (`localDeviceCache`) of device configurations.
 * - Synchronizing this cache with the server via Socket.IO events (`initial_device_list`,
 *   `device_added`, `device_updated`, `device_deleted`).
 * - Handling device status updates (`device_status_update`, `device_statuses`) and
 *   live variable updates (`device_variable_update`) from the server.
 * - Providing UI elements (modals and forms) for users to add, edit, and delete devices,
 *   as well as manage variables for each device.
 * - Emitting events to the server for device modifications (`add_device`, `edit_device`, `delete_device`)
 *   and data writes (`write_to_device`).
 * - Interacting with `stateManager` to update or clear device-related state when devices
 *   or variables change.
 * - Interacting with `ProjectManager` to mark the project as dirty when configurations change.
 * - Launching `topicExplorer` for MQTT topic exploration.
 *
 * The module heavily relies on DOM manipulation for its UI aspects and Socket.IO for
 * real-time communication.
 */
import {
    setDeviceVariableValue,
    getDeviceVariableValue,
    deleteDeviceState as deleteDeviceStateFromManager,
} from "./stateManager.js";
import { openTopicExplorer } from "./topicExplorer.js";
import ProjectManager from "./projectManager.js";

// SVG Icons for UI buttons
const ICON_EDIT = `
<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="inline-block align-middle">
  <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
  <path d="M4 20h4l10.5 -10.5a2.828 2.828 0 1 0 -4 -4l-10.5 10.5v4" />
  <path d="M13.5 6.5l4 4" />
</svg>`;

const ICON_DELETE = `
<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="inline-block align-middle">
  <path stroke="none" d="M0 0h24v24H0z" fill="none"/>
  <path d="M4 7l16 0" />
  <path d="M10 11l0 6" />
  <path d="M14 11l0 6" />
  <path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12" />
  <path d="M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3" />
</svg>`;

/**
 * Local cache of device configurations.
 * Each object in the array represents a device and its settings.
 * Example: `[{ id: 'dev1', name: 'Pump Control', type: 'mqtt', host: 'broker.example.com', ... , variables: [], connected: false }]`
 * @type {Array<object>}
 * @private
 */
let localDeviceCache = [];

/**
 * Active Socket.IO client instance for `/devices` namespace.
 * @type {import('socket.io-client').Socket | null}
 * @private
 */
let socket = null;

/**
 * Callback function from `ProjectManager` to mark the project as dirty.
 * Called when device configurations change.
 * @type {function(boolean): void | null}
 * @private
 */
let pmSetDirtyFuncRef = null;

// --- Cached DOM Elements for UI Management ---
// These are populated by `_cacheDomElements`.
let deviceManagerModal, closeDeviceManagerModal, addDeviceBtn, deviceList;
let deviceFormModal, deviceForm, deviceFormTitle, cancelDeviceForm, deviceIdInput, deviceNameInput, deviceTypeInput;
let mqttFields, modbusTcpFields, modbusRtuFields;
let variableManagerModal, closeVariableManagerModal, variableManagerTitle, variableListTbody, addNewVariableBtnInVarManager, closeVariableManagerModalBottom;
let variableFormModal, variableFormTitle, variableForm, cancelVariableFormBtn, saveVariableFormBtn;
let varFormDeviceId, varFormVarId, varFormName, varFormDataType, varFormDescription;
let varFormEnableSubscribe, varFormSubscribeOptions, varFormSubscribeTopic, varFormJsonPathSubscribe, varFormQosSubscribe;
let varFormEnablePublish, varFormPublishOptions, varFormPublishTopic, varFormQosPublish, varFormRetainPublish;
let varFormExploreTopicBtn;
// --- End Cached DOM Elements ---

/**
 * Caches references to all necessary DOM elements for the Device Manager UI.
 * This function is called once during `initDeviceManager`.
 * @private
 */
function _cacheDomElements() {
    deviceManagerModal = document.getElementById("device-manager-modal");
    closeDeviceManagerModal = document.getElementById("close-device-manager-modal");
    addDeviceBtn = document.getElementById("add-device-btn");
    deviceList = document.getElementById("device-list");

    deviceFormModal = document.getElementById("device-form-modal");
    deviceForm = document.getElementById("device-form");
    deviceFormTitle = document.getElementById("device-form-title");
    cancelDeviceForm = document.getElementById("cancel-device-form");
    deviceIdInput = document.getElementById("device-id");
    deviceNameInput = document.getElementById("device-name");
    deviceTypeInput = document.getElementById("device-type");

    mqttFields = document.getElementById("mqtt-fields");
    modbusTcpFields = document.getElementById("modbus-tcp-fields");
    modbusRtuFields = document.getElementById("modbus-rtu-fields");

    variableManagerModal = document.getElementById("variable-manager-modal");
    closeVariableManagerModal = document.getElementById("close-variable-manager-modal");
    variableManagerTitle = document.getElementById("variable-manager-title");
    variableListTbody = document.getElementById("variable-list-tbody");
    addNewVariableBtnInVarManager = document.getElementById("add-new-variable-btn");
    closeVariableManagerModalBottom = document.getElementById("close-variable-manager-modal-bottom");

    variableFormModal = document.getElementById("variable-form-modal");
    variableFormTitle = document.getElementById("variable-form-title");
    variableForm = document.getElementById("variable-form");
    cancelVariableFormBtn = document.getElementById("cancel-variable-form");
    saveVariableFormBtn = document.getElementById("save-variable-form");
    varFormDeviceId = document.getElementById("variable-form-device-id");
    varFormVarId = document.getElementById("variable-form-var-id");
    varFormName = document.getElementById("var-form-name");
    varFormDataType = document.getElementById("var-form-datatype");
    varFormDescription = document.getElementById("var-form-description");
    varFormEnableSubscribe = document.getElementById("var-form-enable-subscribe");
    varFormSubscribeOptions = document.getElementById("var-form-subscribe-options");
    varFormSubscribeTopic = document.getElementById("var-form-subscribe-topic");
    varFormJsonPathSubscribe = document.getElementById("var-form-jsonpath-subscribe");
    varFormQosSubscribe = document.getElementById("var-form-qos-subscribe");
    varFormEnablePublish = document.getElementById("var-form-enable-publish");
    varFormPublishOptions = document.getElementById("var-form-publish-options");
    varFormPublishTopic = document.getElementById("var-form-publish-topic");
    varFormQosPublish = document.getElementById("var-form-qos-publish");
    varFormRetainPublish = document.getElementById("var-form-retain-publish");
    varFormExploreTopicBtn = document.getElementById("var-form-explore-topic-btn");
}


/**
 * Initializes the DeviceManager module.
 * Sets up Socket.IO connection, caches DOM elements, attaches event listeners,
 * and registers handlers for server-sent Socket.IO events related to devices.
 *
 * @param {import('socket.io-client').Socket} socketInstance - Active Socket.IO client for `/devices` namespace.
 * @param {function(boolean): void} projectManagerSetDirtyFunc - Callback from `ProjectManager` to mark project as dirty.
 */
export function initDeviceManager(socketInstance, projectManagerSetDirtyFunc) {
    if (!socketInstance || typeof socketInstance.on !== "function" || typeof socketInstance.emit !== "function") {
        console.error("[DeviceManager] Valid Socket.IO client instance not provided.");
        const deviceManagerBtn = document.getElementById("device-manager-btn");
        if (deviceManagerBtn) {
            deviceManagerBtn.disabled = true;
            deviceManagerBtn.title = "Device communication failed to initialize.";
        }
        // Optionally, display a more prominent error to the user in the UI.
        return;
    }
    socket = socketInstance;
    pmSetDirtyFuncRef = projectManagerSetDirtyFunc;

    _cacheDomElements();

    // Validate that crucial DOM elements were found
    if (!deviceManagerModal || !deviceFormModal || !deviceList || !deviceForm || !variableManagerModal || !variableFormModal) {
        console.error("[DeviceManager] One or more crucial UI elements for Device/Variable Manager are missing from the DOM.");
        const deviceManagerBtn = document.getElementById("device-manager-btn");
        if (deviceManagerBtn) {
            deviceManagerBtn.textContent = "Device/Var UI Error";
            deviceManagerBtn.disabled = true;
            deviceManagerBtn.title = "Device/Variable Manager UI elements not found.";
        }
        return;
    }

    // --- Setup Event Listeners ---
    // Main Device Manager button
    const mainDeviceManagerBtn = document.getElementById("device-manager-btn");
    if (mainDeviceManagerBtn) mainDeviceManagerBtn.addEventListener("click", _openDeviceManagerModal);
    else console.warn("[DeviceManager] 'device-manager-btn' not found.");

    // Device Manager Modal listeners
    if (closeDeviceManagerModal) closeDeviceManagerModal.addEventListener("click", _closeDeviceManagerModal);
    if (addDeviceBtn) addDeviceBtn.addEventListener("click", () => _openDeviceFormModal());

    // Device Form Modal listeners
    if (cancelDeviceForm) cancelDeviceForm.addEventListener("click", _closeDeviceFormModal);
    if (deviceForm) deviceForm.addEventListener("submit", _handleDeviceFormSubmit);
    if (deviceTypeInput) deviceTypeInput.addEventListener("change", _toggleDeviceSpecificFormFields);

    // Variable Manager Modal listeners
    if (closeVariableManagerModal) closeVariableManagerModal.addEventListener("click", _closeVariableManagerModal);
    if (closeVariableManagerModalBottom) closeVariableManagerModalBottom.addEventListener("click", _closeVariableManagerModal);
    if (addNewVariableBtnInVarManager) {
        addNewVariableBtnInVarManager.addEventListener("click", () => {
            const currentDeviceId = variableManagerModal.dataset.deviceId;
            if (currentDeviceId) {
                _openVariableFormModal(currentDeviceId);
            } else {
                console.error("[DeviceManager] Device ID not found on Variable Manager modal when trying to add new variable.");
                alert("Error: Device context lost. Cannot add variable.");
            }
        });
    }

    // Variable Form Modal listeners
    if (cancelVariableFormBtn) cancelVariableFormBtn.addEventListener("click", _closeVariableFormModal);
    if (variableForm) variableForm.addEventListener("submit", _handleVariableFormSubmit);
    if (varFormEnableSubscribe) {
        varFormEnableSubscribe.addEventListener("change", (e) => {
            if (varFormSubscribeOptions) varFormSubscribeOptions.style.display = e.target.checked ? "block" : "none";
        });
    }
    if (varFormEnablePublish) {
        varFormEnablePublish.addEventListener("change", (e) => {
            if (varFormPublishOptions) varFormPublishOptions.style.display = e.target.checked ? "block" : "none";
        });
    }
    if (varFormExploreTopicBtn) {
        varFormExploreTopicBtn.addEventListener("click", () => {
            const deviceIdForExplorer = varFormDeviceId.value;
            const deviceForExplorer = getDeviceById(deviceIdForExplorer);
            if (deviceForExplorer) {
                const formElementsForExplorer = {
                    querySelector: (selector) => {
                        if (selector === ".variable-subscribe-topic") return varFormSubscribeTopic;
                        if (selector === ".variable-jsonpath-subscribe") return varFormJsonPathSubscribe;
                        return null;
                    },
                };
                openTopicExplorer(deviceIdForExplorer, deviceForExplorer.name, formElementsForExplorer, varFormSubscribeTopic.value);
            } else {
                alert("Device ID not found. Cannot open Topic Explorer.");
            }
        });
    }
    // Note: MQTT variable row listeners (add/remove/toggle) are commented out as this UI was removed/changed.
    // If there was an equivalent in the new Variable Form, it would be here.

    // --- Socket.IO Event Handlers ---
    socket.on("connect", () => {
        console.log("[DeviceManager] Successfully connected to server's /devices namespace.");
        _renderDeviceList(); // Request fresh list or render based on current cache
    });

    socket.on("disconnect", (reason) => {
        console.warn(`[DeviceManager] Disconnected from /devices namespace: ${reason}`);
        localDeviceCache.forEach((d) => d.connected = false); // Mark all as disconnected
        _renderDeviceList();
    });

    socket.on("connect_error", (err) => {
        console.error(`[DeviceManager] Connection error to /devices namespace: ${err.message}`);
        localDeviceCache.forEach((d) => d.connected = false);
        _renderDeviceList();
    });

    socket.on("initial_device_list", (serverDevices) => {
        console.log("[DeviceManager] Received initial_device_list:", serverDevices);
        if (Array.isArray(serverDevices)) {
            // Basic validation for each device object can be added here if needed
            localDeviceCache = serverDevices.filter(device => device && device.id); // Ensure valid devices
        } else {
            console.warn("[DeviceManager] initial_device_list from server was not an array. Clearing local cache.", serverDevices);
            localDeviceCache = [];
        }
        _renderDeviceList();
    });

    socket.on("device_added", (device) => {
        console.log("[DeviceManager] Received device_added:", device);
        if (device && device.id) {
            if (!localDeviceCache.find((d) => d.id === device.id)) {
                localDeviceCache.push(device);
            } else { // Should ideally not happen if server manages IDs, but handle as update
                localDeviceCache = localDeviceCache.map((d) => d.id === device.id ? device : d);
            }
            _renderDeviceList();
            if (pmSetDirtyFuncRef && ProjectManager && !ProjectManager.getIsLoadingProject()) {
                pmSetDirtyFuncRef(true);
            }
        } else {
            console.warn("[DeviceManager] Received malformed device_added event data:", device);
        }
    });

    socket.on("device_updated", (updatedDevice) => {
        console.log("[DeviceManager] Received device_updated:", updatedDevice);
        if (updatedDevice && updatedDevice.id) {
            localDeviceCache = localDeviceCache.map((d) => d.id === updatedDevice.id ? updatedDevice : d);
            _renderDeviceList();
            if (pmSetDirtyFuncRef && ProjectManager && !ProjectManager.getIsLoadingProject()) {
                pmSetDirtyFuncRef(true);
            }
            // If Variable Manager is open for this device, refresh it
            if (variableManagerModal && !variableManagerModal.classList.contains("hidden") && variableManagerModal.dataset.deviceId === updatedDevice.id) {
                _openVariableManagerModal(updatedDevice.id);
            }
        } else {
            console.warn("[DeviceManager] Received malformed device_updated event data:", updatedDevice);
        }
    });

    socket.on("device_deleted", (deletedDeviceId) => {
        console.log("[DeviceManager] Received device_deleted for ID:", deletedDeviceId);
        if (deletedDeviceId) {
            localDeviceCache = localDeviceCache.filter((d) => d.id !== deletedDeviceId);
            deleteDeviceStateFromManager(deletedDeviceId);
            _renderDeviceList();
            if (pmSetDirtyFuncRef && ProjectManager && !ProjectManager.getIsLoadingProject()) {
                pmSetDirtyFuncRef(true);
            }
            // If Variable Manager was open for the deleted device, close it
            if (variableManagerModal && !variableManagerModal.classList.contains("hidden") && variableManagerModal.dataset.deviceId === deletedDeviceId) {
                _closeVariableManagerModal();
            }
        } else {
            console.warn("[DeviceManager] Received device_deleted event with no ID.");
        }
    });

    socket.on("device_status_update", (statusUpdate) => {
        // console.debug("[DeviceManager] Received device_status_update:", statusUpdate);
        if (statusUpdate && statusUpdate.deviceId) {
            const device = localDeviceCache.find((d) => d.id === statusUpdate.deviceId);
            if (device) {
                device.connected = statusUpdate.connected;
                _renderDeviceList();
            }
        } else {
             console.warn("[DeviceManager] Received malformed device_status_update:", statusUpdate);
        }
    });

    socket.on("device_statuses", (statuses) => {
        // console.debug("[DeviceManager] Received device_statuses:", statuses);
        if (Array.isArray(statuses)) {
            statuses.forEach((statusUpdate) => {
                if (statusUpdate && statusUpdate.id) {
                    const device = localDeviceCache.find((d) => d.id === statusUpdate.id);
                    if (device) device.connected = statusUpdate.connected;
                }
            });
            _renderDeviceList();
        }
    });

    socket.on("device_variable_update", (data) => {
        // console.debug("[DeviceManager] Received device_variable_update:", data);
        if (data && data.deviceId && typeof data.variableName !== "undefined" && typeof data.value !== "undefined") {
            setDeviceVariableValue(data.deviceId, data.variableName, data.value);
        } else {
            console.warn("[DeviceManager] Received malformed device_variable_update:", data);
        }
    });

    socket.on("operation_error", (error) => {
        console.error("[DeviceManager] Server operation_error:", error);
        if (error && error.message) {
            // Avoid alerting for benign "not found for deletion" errors if they are expected during clears
            if (!(error.message.includes("not found for deletion") || error.message.includes("DEVICE_NOT_FOUND"))) {
                alert(`Server Error: ${error.message}`);
            }
        } else {
            alert("An unspecified server error occurred.");
        }
    });

    _renderDeviceList(); // Initial render based on (likely empty) cache
    console.log("[DeviceManager] Initialization complete.");
}

/**
 * Opens the main Device Manager modal, which lists all configured devices.
 * @private
 */
function _openDeviceManagerModal() {
    if (deviceManagerModal) deviceManagerModal.classList.remove("hidden");
    else console.error("[DeviceManager] deviceManagerModal element not found to open.");
}

/**
 * Closes the main Device Manager modal.
 * @private
 */
function _closeDeviceManagerModal() {
    if (deviceManagerModal) deviceManagerModal.classList.add("hidden");
    else console.error("[DeviceManager] deviceManagerModal element not found to close.");
}

/**
 * Opens the Device Form modal.
 * If `device` data is provided, the form is populated for editing an existing device.
 * Otherwise, it's set up for adding a new device.
 *
 * @param {object | null} [device=null] - The device object to edit. If `null`, form is for a new device.
 *                                      Expected device object structure: `{ id: string, name: string, type: string, ...typeSpecificProps }`
 * @private
 */
function _openDeviceFormModal(device = null) {
    if (!deviceFormModal || !deviceForm || !deviceIdInput || !deviceNameInput || !deviceTypeInput || !deviceFormTitle) {
        console.error("[DeviceManager] Crucial device form modal elements not found.");
        return;
    }
    deviceForm.reset(); // Clear previous form data

    // Hide all device-specific fieldsets initially
    if (mqttFields) mqttFields.style.display = "none";
    const mqttVariablesSection = document.getElementById("mqtt-variables-section"); // Re-query as it might not be cached if init failed partially
    if (mqttVariablesSection) mqttVariablesSection.style.display = "none";
    if (modbusTcpFields) modbusTcpFields.style.display = "none";
    if (modbusRtuFields) modbusRtuFields.style.display = "none";


    if (device && typeof device === "object" && device.id) { // Editing existing device
        deviceFormTitle.textContent = `Edit Device: ${device.name || device.id}`;
        deviceIdInput.value = device.id;
        deviceIdInput.readOnly = true; // Prevent ID change during edit
        deviceNameInput.value = device.name || "";
        deviceTypeInput.value = device.type || "";

        // Populate type-specific fields
        switch (device.type) {
            case "mqtt":
                if (document.getElementById("mqtt-protocol")) document.getElementById("mqtt-protocol").value = device.protocol || "mqtt";
                if (document.getElementById("mqtt-host")) document.getElementById("mqtt-host").value = device.host || "";
                if (document.getElementById("mqtt-port")) document.getElementById("mqtt-port").value = device.port || "";
                if (document.getElementById("mqtt-username")) document.getElementById("mqtt-username").value = device.username || "";
                if (document.getElementById("mqtt-password")) document.getElementById("mqtt-password").value = device.password || ""; // Handle password with care
                if (document.getElementById("mqtt-basepath")) document.getElementById("mqtt-basepath").value = device.basepath || "";
                // Note: MQTT variables are managed in a separate modal now, not listed here.
                break;
            case "modbus-tcp":
                if (document.getElementById("modbus-tcp-host")) document.getElementById("modbus-tcp-host").value = device.host || "";
                if (document.getElementById("modbus-tcp-port")) document.getElementById("modbus-tcp-port").value = device.port || "502";
                if (document.getElementById("modbus-tcp-unit-id")) document.getElementById("modbus-tcp-unit-id").value = device.unitId || "1";
                break;
            case "modbus-rtu":
                if (document.getElementById("modbus-rtu-serial-port")) document.getElementById("modbus-rtu-serial-port").value = device.serialPort || "";
                if (document.getElementById("modbus-rtu-baud-rate")) document.getElementById("modbus-rtu-baud-rate").value = device.baudRate || "9600";
                if (document.getElementById("modbus-rtu-unit-id")) document.getElementById("modbus-rtu-unit-id").value = device.unitId || "1";
                break;
            // 'internal' type has no specific fields in this form.
        }
    } else { // Adding new device
        deviceFormTitle.textContent = "Add New Device";
        deviceIdInput.value = ""; // Will be auto-generated if left empty or can be user-defined
        deviceIdInput.readOnly = false;
    }

    _toggleDeviceSpecificFormFields(); // Show fields for the current (or default) device type
    deviceFormModal.classList.remove("hidden");
}

/**
 * Closes the Device Form modal.
 * @private
 */
function _closeDeviceFormModal() {
    if (deviceFormModal) deviceFormModal.classList.add("hidden");
    else console.error("[DeviceManager] deviceFormModal element not found to close.");
}

/**
 * Shows or hides device-specific fieldsets in the Device Form based on the selected device type.
 * @private
 */
function _toggleDeviceSpecificFormFields() {
    if (!deviceTypeInput) {
        console.warn("[DeviceManager] deviceTypeInput not found for _toggleDeviceSpecificFormFields.");
        return;
    }
    const selectedType = deviceTypeInput.value;

    if (mqttFields) mqttFields.style.display = selectedType === "mqtt" ? "block" : "none";
    // The 'mqtt-variables-section' was part of the device form but is now managed by the Variable Manager.
    // If it still exists in the DOM for some reason, ensure it's hidden unless type is MQTT and it's relevant.
    const mqttVariablesSection = document.getElementById("mqtt-variables-section");
    if (mqttVariablesSection) mqttVariablesSection.style.display = "none"; // Generally hide, as variables are separate.

    if (modbusTcpFields) modbusTcpFields.style.display = selectedType === "modbus-tcp" ? "block" : "none";
    if (modbusRtuFields) modbusRtuFields.style.display = selectedType === "modbus-rtu" ? "block" : "none";

    // If type is 'internal' or any other type without specific fields, all specific sections should be hidden.
    if (selectedType === "internal" || (selectedType !== "mqtt" && selectedType !== "modbus-tcp" && selectedType !== "modbus-rtu")) {
        if (mqttFields) mqttFields.style.display = "none";
        if (modbusTcpFields) modbusTcpFields.style.display = "none";
        if (modbusRtuFields) modbusRtuFields.style.display = "none";
    }
}

/**
 * Handles the submission of the Device Form (for adding or editing a device).
 * Collects data from common and type-specific form fields, validates basic inputs (name, type),
 * generates a unique ID if adding a new device without one, and then emits either
 * `add_device` or `edit_device` Socket.IO event to the server.
 *
 * @param {Event} e - The form submission event.
 * @private
 */
function _handleDeviceFormSubmit(e) {
    e.preventDefault();
    if (!deviceIdInput || !deviceNameInput || !deviceTypeInput || !socket) {
        console.error("[DeviceManager] Critical form elements or socket missing for device submission.");
        return;
    }

    const id = deviceIdInput.value.trim();
    const name = deviceNameInput.value.trim();
    const type = deviceTypeInput.value;

    if (!name || !type) {
        alert("Device Name and Type are required fields.");
        return;
    }

    const isEditing = !!(id && localDeviceCache.some((d) => d.id === id));
    const generatedId = `device-${crypto.randomUUID()}`; // Generate UUID for new devices

    const deviceData = {
        id: isEditing ? id : (id || generatedId), // Use existing ID if editing, or provided ID, or generate new
        name: name,
        type: type,
        variables: isEditing ? (localDeviceCache.find(d => d.id === id)?.variables || []) : [], // Preserve existing variables on edit
    };

    if (!isEditing && !id) { // If adding new and ID was empty, reflect generated ID in form (optional)
        // deviceIdInput.value = deviceData.id; // Can be confusing if user expects their input or empty
    }


    // Populate type-specific properties
    switch (type) {
        case "mqtt":
            deviceData.protocol = document.getElementById("mqtt-protocol")?.value || "mqtt";
            deviceData.host = document.getElementById("mqtt-host")?.value.trim() || "";
            deviceData.port = document.getElementById("mqtt-port")?.value.trim() || ""; // Default MQTT port usually 1883, but let server handle if empty
            deviceData.username = document.getElementById("mqtt-username")?.value || ""; // No trim, username might have spaces
            deviceData.password = document.getElementById("mqtt-password")?.value || ""; // No trim
            deviceData.basepath = document.getElementById("mqtt-basepath")?.value.trim() || "";
            break;
        case "modbus-tcp":
            deviceData.host = document.getElementById("modbus-tcp-host")?.value.trim() || "";
            deviceData.port = document.getElementById("modbus-tcp-port")?.value.trim() || "502";
            deviceData.unitId = document.getElementById("modbus-tcp-unit-id")?.value.trim() || "1";
            break;
        case "modbus-rtu":
            deviceData.serialPort = document.getElementById("modbus-rtu-serial-port")?.value.trim() || "";
            deviceData.baudRate = document.getElementById("modbus-rtu-baud-rate")?.value.trim() || "9600";
            deviceData.unitId = document.getElementById("modbus-rtu-unit-id")?.value.trim() || "1";
            break;
        case "internal":
            // No specific fields for internal type in this form.
            break;
        default:
            console.warn(`[DeviceManager] Submitting device with unhandled type: ${type}. No type-specific properties will be added.`);
    }

    if (isEditing) {
        console.log("[DeviceManager] Emitting edit_device:", deviceData);
        socket.emit("edit_device", deviceData);
    } else {
        if (localDeviceCache.some((d) => d.id === deviceData.id)) {
            alert(`Error: Device with ID ${deviceData.id} already exists. Please use a unique ID or edit the existing device.`);
            if (deviceIdInput && !deviceIdInput.readOnly) deviceIdInput.focus();
            return;
        }
        console.log("[DeviceManager] Emitting add_device:", deviceData);
        socket.emit("add_device", deviceData);
    }
    _closeDeviceFormModal();
}

/**
 * Sends a request to the server to delete a device by its ID.
 * Prompts for confirmation before sending the request.
 *
 * @param {string} id - The ID of the device to delete.
 * @private
 */
function _requestDeleteDevice(id) {
    // Confirmation is now handled by the caller in _renderDeviceList's event listener.
    if (socket && socket.connected) {
        console.log(`[DeviceManager] Requesting deletion of device ID: ${id}`);
        socket.emit("delete_device", id);
    } else {
        console.error("[DeviceManager] Cannot delete device: Server is not connected.");
        alert("Cannot delete device: Server is not connected.");
    }
}

/**
 * Renders the list of devices in the Device Manager modal.
 * Each device item includes its name, type, connection status, and action buttons
 * (Manage Variables, Edit, Delete). Event listeners are attached to these buttons.
 * This function is called when the device list needs to be refreshed (e.g., after
 * initial load, or when devices are added, updated, or deleted).
 *
 * @private
 */
function _renderDeviceList() {
    if (!deviceList) {
        console.warn("[DeviceManager] Device list DOM element not found. Cannot render devices.");
        return;
    }

    deviceList.innerHTML = ""; // Clear existing list
    const serverOnline = socket && socket.connected;

    if (!Array.isArray(localDeviceCache) || localDeviceCache.length === 0) {
        let message = "No devices configured.";
        if (!serverOnline && socket) message = "Attempting to connect to the server... Devices will appear once connected.";
        else if (!socket) message = "Device communication module not initialized.";
        deviceList.innerHTML = `<p class="text-gray-500 p-4 text-center">${message}</p>`;
        return;
    }

    localDeviceCache.forEach((device) => {
        if (typeof device !== "object" || device === null || !device.id) {
            console.warn("[DeviceManager] Skipping malformed device data in _renderDeviceList:", device);
            return;
        }

        const isDeviceOnline = device.connected || false;
        let statusTitle, statusColorClass;

        if (!serverOnline) {
            statusTitle = "Server Offline";
            statusColorClass = "bg-gray-400"; // Neutral color for server offline
        } else if (isDeviceOnline) {
            statusTitle = "Device Connected";
            statusColorClass = "bg-green-500";
        } else {
            statusTitle = "Device Disconnected";
            statusColorClass = "bg-red-500";
        }

        let typeSpecificInfo = "";
        if (device.type === "mqtt" && device.host) typeSpecificInfo = `(${device.host}:${device.port || 'N/A'})`;
        else if (device.type === "modbus-tcp" && device.host) typeSpecificInfo = `(${device.host}:${device.port || '502'}, Unit: ${device.unitId || '1'})`;
        else if (device.type === "modbus-rtu" && device.serialPort) typeSpecificInfo = `(${device.serialPort}, Unit: ${device.unitId || '1'})`;

        const deviceElement = document.createElement("div");
        deviceElement.className = "bg-gray-700 p-3 rounded-lg flex justify-between items-center mb-2 shadow";
        deviceElement.innerHTML = `
            <div class="flex items-center flex-grow">
                <span class="device-status w-3 h-3 rounded-full mr-3 flex-shrink-0 ${statusColorClass}" title="${statusTitle}"></span>
                <div class="flex-grow">
                    <h3 class="font-bold text-white">${device.name || "Unnamed Device"}</h3>
                    <p class="text-sm text-gray-400">Type: ${device.type || "N/A"} ${typeSpecificInfo}</p>
                </div>
            </div>
            <div class="space-x-2 flex-shrink-0">
                <button class="variable-manager-btn bg-sky-600 hover:bg-sky-700 text-white font-semibold py-1 px-3 rounded-md text-xs" data-id="${device.id}" title="Manage Variables">Variables</button>
                <button class="edit-device-btn text-yellow-400 hover:text-yellow-300 p-1" data-id="${device.id}" title="Edit Device">${ICON_EDIT}</button>
                <button class="delete-device-btn text-red-400 hover:text-red-300 p-1" data-id="${device.id}" title="Delete Device">${ICON_DELETE}</button>
            </div>
        `;
        deviceList.appendChild(deviceElement);

        // Attach event listeners to the newly created buttons
        deviceElement.querySelector(".variable-manager-btn")?.addEventListener("click", (e) => _openVariableManagerModal(e.currentTarget.dataset.id));
        deviceElement.querySelector(".edit-device-btn")?.addEventListener("click", (e) => {
            const deviceToEdit = localDeviceCache.find(d => d.id === e.currentTarget.dataset.id);
            if (deviceToEdit) _openDeviceFormModal(deviceToEdit);
        });
        deviceElement.querySelector(".delete-device-btn")?.addEventListener("click", (e) => {
            if (confirm(`Are you sure you want to delete device "${device.name || device.id}"? This will remove it from the server.`)) {
                _requestDeleteDevice(e.currentTarget.dataset.id);
            }
        });
    });
}

// --- Variable Manager Modal Functions ---

/**
 * Opens the Variable Manager modal for a specific device.
 * Populates the modal with the device's variables, including their current values
 * fetched from `stateManager`.
 *
 * @param {string} deviceId - The ID of the device whose variables are to be managed.
 * @private
 */
function _openVariableManagerModal(deviceId) {
    if (!variableManagerModal || !variableListTbody || !variableManagerTitle) {
        console.error("[DeviceManager] Variable Manager modal elements not found.");
        return;
    }
    const device = getDeviceById(deviceId);
    if (!device) {
        alert("Device not found! Cannot open Variable Manager.");
        return;
    }

    variableManagerTitle.textContent = `Variable Manager: ${device.name || device.id}`;
    variableManagerModal.dataset.deviceId = deviceId; // Store deviceId for "Add New Variable"
    variableListTbody.innerHTML = ""; // Clear previous variable list

    if (Array.isArray(device.variables) && device.variables.length > 0) {
        device.variables.forEach((variable) => {
            const row = variableListTbody.insertRow();
            row.className = "hover:bg-gray-700/50 transition-colors duration-150";

            const nameCell = row.insertCell();
            nameCell.className = "px-4 py-3 whitespace-nowrap text-sm text-white font-medium";
            nameCell.textContent = variable.name || "N/A";

            const detailsCell = row.insertCell(); // Combined cell for type, description, topic
            detailsCell.className = "px-4 py-3 text-sm text-gray-300";
            let detailsHtml = `<div><span class="font-semibold">Type:</span> ${variable.dataType || "N/A"}</div>`;
            if (variable.description) {
                detailsHtml += `<div class="text-xs text-gray-400">${variable.description}</div>`;
            }
            if (device.type === "mqtt") {
                if (variable.enableSubscribe && variable.subscribeTopic) {
                    detailsHtml += `<div class="text-xs mt-1"><span class="font-semibold text-blue-400">Sub:</span> ${variable.subscribeTopic} (QoS ${variable.qosSubscribe || 0}) ${variable.jsonPathSubscribe ? `Path: ${variable.jsonPathSubscribe}` : ''}</div>`;
                }
                if (variable.enablePublish && variable.publishTopic) {
                    detailsHtml += `<div class="text-xs mt-1"><span class="font-semibold text-green-400">Pub:</span> ${variable.publishTopic} (QoS ${variable.qosPublish || 0}, Retain: ${variable.retainPublish ? "Yes" : "No"})</div>`;
                }
            }
            detailsCell.innerHTML = detailsHtml;


            const valueCell = row.insertCell(); // Cell for live value
            valueCell.className = "px-4 py-3 whitespace-nowrap text-sm text-cyan-300 variable-value-preview";
            valueCell.dataset.deviceId = device.id; // For live update targeting
            valueCell.dataset.variableName = variable.name;
            let currentValue = getDeviceVariableValue(device.id, variable.name);
            if (typeof currentValue === "object" && currentValue !== null) {
                try {
                    currentValue = JSON.stringify(currentValue);
                    if (currentValue.length > 30) currentValue = `${currentValue.substring(0, 27)}...`;
                } catch (e) { currentValue = "[Object]"; }
            } else if (currentValue === undefined) currentValue = "-";
            else if (typeof currentValue === "boolean") currentValue = currentValue ? "True" : "False";
            valueCell.textContent = currentValue;

            const actionsCell = row.insertCell(); // Cell for action buttons
            actionsCell.className = "px-4 py-3 whitespace-nowrap text-sm text-right";
            actionsCell.innerHTML = `
                <button class="edit-variable-btn text-yellow-400 hover:text-yellow-300 p-1" data-device-id="${device.id}" data-var-id="${variable.varId || ""}" title="Edit Variable">${ICON_EDIT}</button>
                <button class="delete-variable-btn text-red-400 hover:text-red-300 p-1 ml-1" data-device-id="${device.id}" data-var-id="${variable.varId || ""}" title="Delete Variable">${ICON_DELETE}</button>
            `;
        });

        // Attach event listeners to new buttons in the table
        variableListTbody.querySelectorAll(".edit-variable-btn").forEach(btn =>
            btn.addEventListener("click", (e) => _openVariableFormModal(e.currentTarget.dataset.deviceId, e.currentTarget.dataset.varId))
        );
        variableListTbody.querySelectorAll(".delete-variable-btn").forEach(btn =>
            btn.addEventListener("click", (e) => _deleteVariable(e.currentTarget.dataset.deviceId, e.currentTarget.dataset.varId))
        );

    } else if (device.type !== "mqtt" && device.type !== "internal") {
        variableListTbody.innerHTML = `<tr><td colspan="4" class="px-4 py-3 text-sm text-gray-400 text-center">Variable management for '${device.type}' devices is not applicable here.</td></tr>`;
    } else { // MQTT or Internal but no variables
        variableListTbody.innerHTML = `<tr><td colspan="4" class="px-4 py-3 text-sm text-gray-400 text-center">No variables configured for this ${device.type} device.</td></tr>`;
    }

    variableManagerModal.classList.remove("hidden");
}

/**
 * Closes the Variable Manager modal.
 * @private
 */
function _closeVariableManagerModal() {
    if (variableManagerModal) variableManagerModal.classList.add("hidden");
    else console.error("[DeviceManager] variableManagerModal element not found to close.");
}

/**
 * Opens the Variable Form modal for adding a new variable or editing an existing one
 * for a specific device.
 *
 * @param {string} deviceId - The ID of the device to which the variable belongs/will belong.
 * @param {string | null} [varIdToEdit=null] - The ID of the variable to edit. If `null`, the form
 *                                            is for adding a new variable.
 * @private
 */
function _openVariableFormModal(deviceId, varIdToEdit = null) {
    if (!variableFormModal || !variableForm || !varFormDeviceId || !varFormVarId || !variableFormTitle ||
        !varFormName || !varFormDataType || !varFormDescription || !varFormEnableSubscribe ||
        !varFormSubscribeOptions || !varFormSubscribeTopic || !varFormJsonPathSubscribe || !varFormQosSubscribe ||
        !varFormEnablePublish || !varFormPublishOptions || !varFormPublishTopic || !varFormQosPublish || !varFormRetainPublish) {
        console.error("[DeviceManager] Crucial variable form modal elements not found.");
        return;
    }
    variableForm.reset(); // Clear previous data
    varFormDeviceId.value = deviceId; // Hidden input to store current device context

    const device = getDeviceById(deviceId);
    if (!device) {
        alert("Device not found! Cannot open variable form.");
        _closeVariableFormModal(); // Close if device context is lost
        return;
    }

    // Show/hide MQTT-specific sections based on device type
    const subscribeSection = varFormEnableSubscribe.closest(".border-t.pt-4.mt-4"); // Find parent section
    const publishSection = varFormEnablePublish.closest(".border-t.pt-4.mt-4");   // Find parent section

    if (device.type === "internal") { // Internal devices don't have MQTT pub/sub
        if (subscribeSection) subscribeSection.style.display = "none";
        if (publishSection) publishSection.style.display = "none";
        if (varFormExploreTopicBtn) varFormExploreTopicBtn.style.display = "none";
    } else { // For MQTT (and potentially other future types that might use similar fields)
        if (subscribeSection) subscribeSection.style.display = "block";
        if (publishSection) publishSection.style.display = "block";
        if (varFormExploreTopicBtn) varFormExploreTopicBtn.style.display = "inline-block"; // Or "block"
    }


    if (varIdToEdit) { // Editing existing variable
        variableFormTitle.textContent = `Edit Variable for ${device.name}`;
        const variable = device.variables?.find((v) => v.varId === varIdToEdit);
        if (variable) {
            varFormVarId.value = variable.varId; // Hidden input for var ID being edited
            varFormName.value = variable.name || "";
            varFormDataType.value = variable.dataType || "string";
            varFormDescription.value = variable.description || "";

            if (device.type === "mqtt") { // Only populate MQTT fields if it's an MQTT device
                varFormEnableSubscribe.checked = variable.enableSubscribe || false;
                varFormSubscribeOptions.style.display = varFormEnableSubscribe.checked ? "block" : "none";
                varFormSubscribeTopic.value = variable.subscribeTopic || "";
                varFormJsonPathSubscribe.value = variable.jsonPathSubscribe || "";
                varFormQosSubscribe.value = (variable.qosSubscribe !== undefined ? variable.qosSubscribe.toString() : "0");

                varFormEnablePublish.checked = variable.enablePublish || false;
                varFormPublishOptions.style.display = varFormEnablePublish.checked ? "block" : "none";
                varFormPublishTopic.value = variable.publishTopic || "";
                varFormQosPublish.value = (variable.qosPublish !== undefined ? variable.qosPublish.toString() : "0");
                varFormRetainPublish.checked = variable.retainPublish || false;
            }
        } else {
            alert(`Variable with ID ${varIdToEdit} not found on device ${device.name}.`);
            _closeVariableFormModal();
            return;
        }
    } else { // Adding new variable
        variableFormTitle.textContent = `Add New Variable to ${device.name}`;
        varFormVarId.value = ""; // Clear varId for new variable
        // Ensure MQTT options are hidden by default if checkboxes are unchecked
        if (varFormSubscribeOptions) varFormSubscribeOptions.style.display = "none";
        if (varFormPublishOptions) varFormPublishOptions.style.display = "none";
    }

    variableFormModal.classList.remove("hidden");
    if(varFormName) varFormName.focus();
}


/**
 * Closes the Variable Form modal.
 * @private
 */
function _closeVariableFormModal() {
    if (variableFormModal) variableFormModal.classList.add("hidden");
    else console.error("[DeviceManager] variableFormModal element not found to close.");
}

/**
 * Handles the submission of the Variable Form (for adding or editing a variable).
 * Collects data, validates the variable name, updates the device's variable list in
 * `localDeviceCache`, and then emits an `edit_device` event to the server with the
 * entire updated device configuration.
 *
 * @param {Event} event - The form submission event.
 * @private
 */
function _handleVariableFormSubmit(event) {
    event.preventDefault();
    if (!varFormDeviceId || !varFormName || !varFormDataType || !socket) {
        console.error("[DeviceManager] Critical variable form elements or socket missing for submission.");
        return;
    }

    const currentDeviceId = varFormDeviceId.value;
    const varId = varFormVarId.value; // Empty if new, populated if editing
    const name = varFormName.value.trim();

    if (!name) {
        alert("Variable Name is required.");
        if(varFormName) varFormName.focus();
        return;
    }

    const device = getDeviceById(currentDeviceId);
    if (!device) {
        alert("Device context lost. Cannot save variable.");
        return;
    }

    // Prevent adding variables to non-MQTT/non-internal types through this form if UI didn't hide options correctly
    if (device.type !== "mqtt" && device.type !== "internal") {
        alert(`Variable management for device type '${device.type}' is not supported via this form.`);
        return;
    }

    const variableData = {
        varId: varId || `var-${crypto.randomUUID()}`, // Generate new ID if adding
        name: name,
        description: varFormDescription?.value.trim() || "",
        dataType: varFormDataType.value,
    };

    if (device.type === "mqtt") { // Only include MQTT fields for MQTT devices
        variableData.enableSubscribe = varFormEnableSubscribe.checked;
        variableData.subscribeTopic = varFormSubscribeTopic.value.trim();
        variableData.jsonPathSubscribe = varFormJsonPathSubscribe.value.trim();
        variableData.qosSubscribe = parseInt(varFormQosSubscribe.value || "0", 10);
        variableData.enablePublish = varFormEnablePublish.checked;
        variableData.publishTopic = varFormPublishTopic.value.trim();
        variableData.qosPublish = parseInt(varFormQosPublish.value || "0", 10);
        variableData.retainPublish = varFormRetainPublish.checked;
    }
    // For 'internal' devices, only name, description, dataType are relevant from this form.

    if (!Array.isArray(device.variables)) device.variables = [];

    // Check for duplicate variable names *within the same device* when adding new or renaming existing
    const otherVariables = device.variables.filter(v => v.varId !== variableData.varId);
    if (otherVariables.some(v => v.name === variableData.name)) {
        alert(`A variable named "${variableData.name}" already exists for this device. Please use a unique name.`);
        if(varFormName) varFormName.focus();
        return;
    }

    if (varId) { // Editing existing variable
        const varIndex = device.variables.findIndex((v) => v.varId === varId);
        if (varIndex > -1) {
            device.variables[varIndex] = variableData;
        } else {
            console.error(`[DeviceManager] Variable with ID ${varId} not found for edit on device ${device.id}.`);
            alert("Error: Could not find the variable to update.");
            return;
        }
    } else { // Adding new variable
        device.variables.push(variableData);
    }

    if (socket.connected) {
        console.log("[DeviceManager] Emitting edit_device (for variable update):", device);
        socket.emit("edit_device", device); // Send the entire updated device config
        _closeVariableFormModal();
        // The server should respond with 'device_updated', which will trigger _renderDeviceList
        // and potentially refresh the variable manager if it's open for this device.
    } else {
        alert("Cannot save variable: Server is not connected.");
    }
}

/**
 * Deletes a variable from a device's configuration.
 * Prompts for confirmation, then removes the variable from the device's `variables` array
 * in `localDeviceCache`, and emits an `edit_device` event to the server with the
 * entire updated device configuration.
 *
 * @param {string} deviceId - The ID of the device from which to delete the variable.
 * @param {string} varId - The ID of the variable to delete.
 * @private
 */
function _deleteVariable(deviceId, varId) {
    // Confirmation is now handled by the caller in _openVariableManagerModal's event listener.

    const device = getDeviceById(deviceId);
    if (!device) {
        alert("Device not found. Cannot delete variable.");
        return;
    }
    if (device.type !== "mqtt" && device.type !== "internal") {
        alert(`Variable management for device type '${device.type}' is not supported here.`);
        return;
    }

    if (Array.isArray(device.variables)) {
        const initialLength = device.variables.length;
        device.variables = device.variables.filter((v) => v.varId !== varId);

        if (device.variables.length < initialLength) { // Variable was found and removed
            if (socket && socket.connected) {
                console.log("[DeviceManager] Emitting edit_device (for variable deletion):", device);
                socket.emit("edit_device", device); // Send the entire updated device config
                // Server should respond with 'device_updated', refreshing UI.
                // If VariableManager was open for this device, it will also refresh.
            } else {
                alert("Cannot delete variable: Server is not connected.");
                // Optionally revert local change if server communication fails, or mark as dirty.
            }
        } else {
            console.warn(`[DeviceManager] Variable ID ${varId} not found on device ${deviceId} for deletion.`);
            alert("Variable not found for deletion.");
        }
    } else {
        console.warn(`[DeviceManager] Device ${deviceId} has no variables array to delete from.`);
        alert("This device has no variables to delete.");
    }
}
// --- End Variable Manager Functions ---

/**
 * Retrieves the local cache of all configured devices.
 * The cache (`localDeviceCache`) is maintained by listening to Socket.IO events from the server
 * and represents the client's current understanding of available devices.
 *
 * @returns {Array<object>} An array of device configuration objects. Each object typically includes
 *                          `id`, `name`, `type`, connection status (`connected`), type-specific
 *                          properties (e.g., `host`, `port`), and a `variables` array.
 */
export function getDevices() {
    return localDeviceCache;
}

/**
 * Retrieves a specific device configuration from the local cache by its ID.
 *
 * @param {string} id - The unique ID of the device to retrieve.
 * @returns {object | null} The device configuration object if found; otherwise, `null`.
 */
export function getDeviceById(id) {
    if (!id) return null;
    return localDeviceCache.find((device) => device.id === id) || null;
}

/**
 * Sends a request to the server to write a value to a specific variable or address on a device.
 * The payload constructed depends on the device type:
 * - For "internal" devices, `nameOrAddress` is treated as `variableName`.
 * - For other device types, `nameOrAddress` is treated as a generic `address`.
 * The server-side device implementation handles the actual write operation.
 *
 * @param {string} deviceId - The unique ID of the target device.
 * @param {string} nameOrAddress - The name of the variable (for "internal" devices) or the
 *                                 address/identifier (for other types) to write to.
 * @param {*} value - The value to be written.
 */
export function writeDataToServer(deviceId, nameOrAddress, value) {
    if (!socket || !socket.connected) {
        console.error("[DeviceManager] Socket not connected. Cannot write data to server.");
        alert("Cannot write data: Server is not connected.");
        return;
    }

    const device = getDeviceById(deviceId);
    if (!device) {
        console.error(`[DeviceManager] Device with ID ${deviceId} not found. Cannot write data.`);
        alert(`Device ${deviceId} not found. Cannot write data.`);
        return;
    }

    const payload = { deviceId, value };
    if (device.type === "internal") {
        payload.variableName = nameOrAddress;
    } else {
        // For MQTT, Modbus, etc., the server expects 'address' or a specific structure
        // This assumes 'address' is a generic term for the target on the device.
        // The server-side implementation for each device type must interpret this correctly.
        payload.address = nameOrAddress;
    }

    console.log("[DeviceManager] Emitting write_to_device:", payload);
    socket.emit("write_to_device", payload);
}

/**
 * Updates the displayed value of a specific variable within the Variable Manager UI
 * if it is currently open and showing variables for the relevant device.
 * This function is typically called by `stateManager` when a `device_variable_update`
 * event is received from the server, ensuring the UI reflects live data.
 * Long string values or stringified JSON objects are truncated for display.
 *
 * @param {string} deviceId - The ID of the device to which the variable belongs.
 * @param {string} variableName - The name of the variable whose display needs updating.
 * @param {*} newValue - The new value of the variable.
 */
export function updateLiveVariableValueInManagerUI(deviceId, variableName, newValue) {
    if (variableManagerModal && !variableManagerModal.classList.contains("hidden") &&
        variableManagerModal.dataset.deviceId === deviceId && variableListTbody) {
        const valueCell = variableListTbody.querySelector(
            `td.variable-value-preview[data-device-id="${deviceId}"][data-variable-name="${variableName}"]`
        );
        if (valueCell) {
            let displayValue = newValue;
            if (typeof displayValue === "object" && displayValue !== null) {
                try {
                    displayValue = JSON.stringify(displayValue);
                    if (displayValue.length > 30) displayValue = `${displayValue.substring(0, 27)}...`;
                } catch (e) { displayValue = "[Object]"; }
            } else if (displayValue === undefined) {
                displayValue = "-";
            } else if (typeof displayValue === "boolean") {
                displayValue = displayValue ? "True" : "False";
            }
            valueCell.textContent = displayValue;
        }
    }
}

/**
 * Retrieves all current device configurations from the local cache, creating a deep copy.
 * This is intended for use in project export operations to ensure that only configuration
 * data (not live runtime state beyond `connected` status if included by server) is exported
 * and to prevent unintended modifications to the live cache.
 *
 * @returns {Array<object>} An array of device configuration objects. Returns an empty array
 *                          if deep copying fails or `localDeviceCache` is invalid.
 */
export function getAllDeviceConfigsForExport() {
    try {
        // Assuming localDeviceCache contains objects that are serializable
        return JSON.parse(JSON.stringify(localDeviceCache));
    } catch (error) {
        console.error("[DeviceManager] Failed to deep copy localDeviceCache for export:", error);
        // Fallback to a shallow copy if deep copy fails, though this is less safe.
        // Or return empty array to prevent potential issues with partially copied data.
        return Array.isArray(localDeviceCache) ? [...localDeviceCache] : [];
    }
}

/**
 * Clears all devices from the client-side cache and requests their deletion from the server.
 * This involves:
 * 1. Iterating through `localDeviceCache`.
 * 2. For each device, calling `deleteDeviceStateFromManager` to clear its state in `stateManager`.
 * 3. Emitting a `delete_device` Socket.IO event to the server for each device.
 * 4. Clearing `localDeviceCache`.
 * 5. Re-rendering the (now empty) device list in the UI.
 * Typically used when clearing the entire project or starting a new one.
 */
export function clearAllClientDevices() {
    if (Array.isArray(localDeviceCache) && localDeviceCache.length > 0) {
        const deviceIdsToRemove = localDeviceCache.map((d) => d.id); // Get IDs before modifying cache

        deviceIdsToRemove.forEach((id) => {
            if (typeof deleteDeviceStateFromManager === "function") {
                deleteDeviceStateFromManager(id);
            }
            _requestDeleteDevice(id); // Send delete request to server
        });

        localDeviceCache = []; // Clear the local cache
        console.log("[DeviceManager] All client devices cleared, and delete requests sent to server.");
    } else {
        console.log("[DeviceManager] No client devices to clear.");
    }
    _renderDeviceList(); // Update the UI
}

/**
 * Clears the local device cache (`localDeviceCache`) and associated device states from
 * `stateManager` *without* sending delete requests to the server.
 * This is primarily used when loading a new project, as the server will typically
 * provide a fresh list of devices for the new project, making individual server-side
 * deletions for the old project's devices unnecessary.
 * After clearing, it updates the UI to reflect the empty device list.
 */
export function clearLocalDeviceCacheAndState() {
    if (Array.isArray(localDeviceCache) && localDeviceCache.length > 0) {
        localDeviceCache.forEach((device) => {
            if (typeof deleteDeviceStateFromManager === "function") {
                deleteDeviceStateFromManager(device.id);
            }
        });
        localDeviceCache = [];
        console.log("[DeviceManager] Local device cache and associated client state cleared (no server notification).");
    } else {
        // console.log("[DeviceManager] No local devices in cache to clear from client state.");
    }
    _renderDeviceList(); // Update UI
}

/**
 * Initializes or replaces all client-side devices based on a provided array of device configurations.
 * This function is typically used when loading a project from a file or server.
 * The process:
 * 1. Calls `clearAllClientDevices()` to remove existing devices from client and server.
 * 2. Iterates through the `deviceConfigsArray`. For each configuration:
 *    - Ensures it has an ID (generates one if missing, though project data should have IDs).
 *    - Emits an `add_device` Socket.IO event to the server.
 * The server is expected to process these `add_device` requests and respond with
 * `device_added` events (or an `initial_device_list` if the load triggers a full refresh),
 * which will then repopulate `localDeviceCache` and update the UI via `_renderDeviceList`.
 *
 * @async
 * @param {Array<object>} deviceConfigsArray - An array of device configuration objects
 *                                           that should become the new set of active devices.
 * @returns {Promise<void>} A promise that resolves when all `add_device` requests have been sent.
 *                          Rejects with an error message if the socket is not connected.
 */
export async function initializeDevicesFromConfigs(deviceConfigsArray) {
    console.log("[DeviceManager] Initializing devices from configurations array:", deviceConfigsArray);

    // 1. Clear all existing client devices (which also sends delete requests to server for current devices).
    clearAllClientDevices();

    // Optional: A brief delay might be considered if there's a need to ensure server processes deletions
    // before adding new ones, but typically, the server should handle this gracefully.
    // await new Promise(resolve => setTimeout(resolve, 200)); // Example delay

    // 2. For each new device configuration, send 'add_device' to the server.
    // The server's response (`device_added` or `initial_device_list`) will update the client.
    if (socket && socket.connected) {
        if (Array.isArray(deviceConfigsArray)) {
            deviceConfigsArray.forEach((config) => {
                if (!config || typeof config !== 'object') {
                    console.warn("[DeviceManager] Skipping invalid device config during initialization:", config);
                    return;
                }
                if (!config.id) { // Should ideally not happen with valid project data
                    config.id = `device-${crypto.randomUUID()}`;
                    console.warn(`[DeviceManager] Device config was missing ID, new ID generated: ${config.id}`, config);
                }
                console.log(`[DeviceManager] Sending 'add_device' to server for config ID: ${config.id}`);
                socket.emit("add_device", config);
            });
        } else {
            console.warn("[DeviceManager] initializeDevicesFromConfigs called with non-array data:", deviceConfigsArray);
        }
        return Promise.resolve();
    } else {
        const errorMsg = "[DeviceManager] Socket not connected. Cannot initialize devices from configs.";
        console.error(errorMsg);
        alert("Error: Cannot initialize devices as the server is not connected.");
        return Promise.reject(errorMsg);
    }
    // UI update (_renderDeviceList) will be triggered by server's responses.
}
