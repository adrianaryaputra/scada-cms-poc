import { setDeviceVariableValue, getDeviceVariableValue, deleteDeviceState as deleteDeviceStateFromManager } from './stateManager.js';
import { openTopicExplorer } from './topicExplorer.js'; // Import openTopicExplorer
// import { getLayer } from './konvaManager.js'; // getLayer might not be needed if Konva updates via stateManager

// SVG Icons
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

let localDeviceCache = [];
let socket = null;

// DOM Elements
let deviceManagerModal, closeDeviceManagerModal, addDeviceBtn, deviceList;
let deviceFormModal, deviceForm, deviceFormTitle, cancelDeviceForm, deviceIdInput, deviceNameInput, deviceTypeInput, mqttFields, modbusTcpFields, modbusRtuFields;
let variableManagerModal, closeVariableManagerModal, variableManagerTitle, variableListTbody, addNewVariableBtnInVarManager, closeVariableManagerModalBottom;

// Variable Form Modal Elements
let variableFormModal, variableFormTitle, variableForm, cancelVariableFormBtn, saveVariableFormBtn,
    varFormDeviceId, varFormVarId, varFormName, varFormDataType, varFormDescription,
    varFormEnableSubscribe, varFormSubscribeOptions, varFormSubscribeTopic, varFormJsonPathSubscribe, varFormQosSubscribe,
    varFormEnablePublish, varFormPublishOptions, varFormPublishTopic, varFormQosPublish, varFormRetainPublish,
    varFormExploreTopicBtn; // Tombol Explore baru


export function initDeviceManager(socketInstance) { // Parameter is already a socket instance
    if (!socketInstance || typeof socketInstance.on !== 'function' || typeof socketInstance.emit !== 'function') {
        console.error("Valid Socket.IO client instance not provided to initDeviceManager.");
        // Fallback or error display for the user that real-time features are unavailable.
        const deviceManagerBtn = document.getElementById('device-manager-btn');
        if(deviceManagerBtn) deviceManagerBtn.disabled = true;
        const HMIcontainer = document.getElementById('hmi-container'); // Or any main app container
        if (HMIcontainer) {
            const errorDiv = document.createElement('div');
            errorDiv.textContent = "Real-time device communication cannot be initialized. Some features may be unavailable.";
            errorDiv.style.color = "red";
            errorDiv.style.padding = "10px";
            errorDiv.style.backgroundColor = "lightyellow";
            errorDiv.style.border = "1px solid orange";
            HMIcontainer.prepend(errorDiv);
        } else {
            alert("Real-time device communication cannot be initialized. Some features may be unavailable.");
        }
        return;
    }
    socket = socketInstance; // Use the provided instance directly

    // Cache DOM elements
    deviceManagerModal = document.getElementById('device-manager-modal');
    closeDeviceManagerModal = document.getElementById('close-device-manager-modal');
    addDeviceBtn = document.getElementById('add-device-btn');
    deviceList = document.getElementById('device-list');

    deviceFormModal = document.getElementById('device-form-modal');
    deviceForm = document.getElementById('device-form');
    deviceFormTitle = document.getElementById('device-form-title');
    cancelDeviceForm = document.getElementById('cancel-device-form');
    deviceIdInput = document.getElementById('device-id');
    deviceNameInput = document.getElementById('device-name');
    deviceTypeInput = document.getElementById('device-type');

    // Device specific fieldsets
    mqttFields = document.getElementById('mqtt-fields');
    modbusTcpFields = document.getElementById('modbus-tcp-fields');
    modbusRtuFields = document.getElementById('modbus-rtu-fields');

    // MQTT Variables UI elements (inside device form)
    const addMqttVariableBtn = document.getElementById('add-mqtt-variable-btn');
    const mqttVariablesContainer = document.getElementById('mqtt-variables-container');

    // Variable Manager Modal elements
    variableManagerModal = document.getElementById('variable-manager-modal');
    closeVariableManagerModal = document.getElementById('close-variable-manager-modal');
    variableManagerTitle = document.getElementById('variable-manager-title');
    variableListTbody = document.getElementById('variable-list-tbody');
    addNewVariableBtnInVarManager = document.getElementById('add-new-variable-btn');
    closeVariableManagerModalBottom = document.getElementById('close-variable-manager-modal-bottom');

    // Cache Variable Form Modal Elements
    variableFormModal = document.getElementById('variable-form-modal');
    variableFormTitle = document.getElementById('variable-form-title');
    variableForm = document.getElementById('variable-form');
    cancelVariableFormBtn = document.getElementById('cancel-variable-form');
    saveVariableFormBtn = document.getElementById('save-variable-form');
    varFormDeviceId = document.getElementById('variable-form-device-id');
    varFormVarId = document.getElementById('variable-form-var-id');
    varFormName = document.getElementById('var-form-name');
    varFormDataType = document.getElementById('var-form-datatype');
    varFormDescription = document.getElementById('var-form-description');
    varFormEnableSubscribe = document.getElementById('var-form-enable-subscribe');
    varFormSubscribeOptions = document.getElementById('var-form-subscribe-options');
    varFormSubscribeTopic = document.getElementById('var-form-subscribe-topic');
    varFormJsonPathSubscribe = document.getElementById('var-form-jsonpath-subscribe');
    varFormQosSubscribe = document.getElementById('var-form-qos-subscribe');
    varFormEnablePublish = document.getElementById('var-form-enable-publish');
    varFormPublishOptions = document.getElementById('var-form-publish-options');
    varFormPublishTopic = document.getElementById('var-form-publish-topic');
    varFormQosPublish = document.getElementById('var-form-qos-publish');
    varFormRetainPublish = document.getElementById('var-form-retain-publish');
    varFormExploreTopicBtn = document.getElementById('var-form-explore-topic-btn');


    // Check if all crucial Modal and Form elements are found
    if (!deviceManagerModal || !deviceFormModal || !deviceList || !deviceForm || !variableManagerModal || !variableFormModal) {
        console.error("One or more crucial UI elements for Device Manager, Variable Manager or Variable Form are missing from the DOM.");
        const deviceManagerBtn = document.getElementById('device-manager-btn');
        if(deviceManagerBtn) {
             deviceManagerBtn.textContent = "Device/Var Manager Error";
             deviceManagerBtn.disabled = true;
             deviceManagerBtn.title = "Device/Var Manager UI elements not found.";
        }
        return;
    }

    // Event Listeners for static elements
    document.getElementById('device-manager-btn').addEventListener('click', openDeviceManager);
    if(closeDeviceManagerModal) closeDeviceManagerModal.addEventListener('click', closeDeviceManager);
    if(addDeviceBtn) addDeviceBtn.addEventListener('click', () => openDeviceForm()); // For adding new device
    if(cancelDeviceForm) cancelDeviceForm.addEventListener('click', closeDeviceForm);
    if(deviceForm) deviceForm.addEventListener('submit', handleFormSubmit);
    if(deviceTypeInput) deviceTypeInput.addEventListener('change', toggleDeviceFields);

    // MQTT Variables UI event listeners (within device form)
    if (addMqttVariableBtn) {
        addMqttVariableBtn.addEventListener('click', () => addVariableRow());
    }
    if (mqttVariablesContainer) {
        mqttVariablesContainer.addEventListener('click', function(event) {
            if (event.target.classList.contains('remove-mqtt-variable-btn')) {
                removeVariableRow(event.target);
            } else if (event.target.classList.contains('variable-enable-subscribe')) {
                const optionsDiv = event.target.closest('.mqtt-variable-row').querySelector('.variable-subscribe-options');
                if(optionsDiv) optionsDiv.style.display = event.target.checked ? 'block' : 'none';
            } else if (event.target.classList.contains('variable-enable-publish')) {
                 const optionsDiv = event.target.closest('.mqtt-variable-row').querySelector('.variable-publish-options');
                if(optionsDiv) optionsDiv.style.display = event.target.checked ? 'block' : 'none';
            }
        });
    }

    // Variable Manager event listeners
    if(closeVariableManagerModal) closeVariableManagerModal.addEventListener('click', closeVariableManager);
    if(closeVariableManagerModalBottom) closeVariableManagerModalBottom.addEventListener('click', closeVariableManager);
    if(addNewVariableBtnInVarManager) {
        addNewVariableBtnInVarManager.addEventListener('click', () => {
            const deviceId = variableManagerModal.dataset.deviceId;
            if (deviceId) {
                openVariableForm(deviceId);
            } else {
                console.error("Device ID not found on Variable Manager modal for adding new variable.");
                alert("Error: Device ID tidak ditemukan. Tidak bisa menambah variabel.");
            }
        });
    }

    // Variable Form event listeners
    if(cancelVariableFormBtn) cancelVariableFormBtn.addEventListener('click', closeVariableForm);
    if(variableForm) variableForm.addEventListener('submit', handleVariableFormSubmit);

    if(varFormEnableSubscribe) varFormEnableSubscribe.addEventListener('change', (e) => {
        if(varFormSubscribeOptions) varFormSubscribeOptions.style.display = e.target.checked ? 'block' : 'none';
    });
    if(varFormEnablePublish) varFormEnablePublish.addEventListener('change', (e) => {
        if(varFormPublishOptions) varFormPublishOptions.style.display = e.target.checked ? 'block' : 'none';
    });

    if(varFormExploreTopicBtn) {
        varFormExploreTopicBtn.addEventListener('click', () => {
            const deviceId = varFormDeviceId.value;
            const device = getDeviceById(deviceId);
            if (device) {
                // Prepare formElements for openTopicExplorer
                // The topicExplorer is designed to update a 'row' or a set of specific input elements.
                // We need to provide it with the correct input elements from the variable form modal.
                const formElementsForExplorer = {
                    // This structure mimics how it might have been used with a 'row' previously.
                    // We are directly giving the input elements.
                    querySelector: (selector) => {
                        if (selector === '.variable-subscribe-topic') return varFormSubscribeTopic;
                        if (selector === '.variable-jsonpath-subscribe') return varFormJsonPathSubscribe;
                        return null;
                    }
                };
                openTopicExplorer(deviceId, device.name, formElementsForExplorer, varFormSubscribeTopic.value);
            } else {
                alert("Device ID tidak ditemukan. Tidak bisa membuka Topic Explorer.");
            }
        });
    }


    // Socket.IO event listeners
    socket.on('connect', () => {
        console.log('Successfully connected to server /devices namespace');
        renderDeviceList();
    });

    socket.on('disconnect', (reason) => {
        console.log(`Disconnected from server /devices namespace: ${reason}`);
        localDeviceCache.forEach(d => d.connected = false);
        renderDeviceList();
    });

    socket.on('connect_error', (err) => {
        console.error('Connection error to /devices namespace:', err.message);
        localDeviceCache.forEach(d => d.connected = false);
        renderDeviceList();
    });

    socket.on('initial_device_list', (serverDevices) => {
        console.log('Received initial device list:', serverDevices);
        localDeviceCache = Array.isArray(serverDevices) ? serverDevices : [];
        renderDeviceList();
    });

    socket.on('device_added', (device) => {
        console.log('Device added by server:', device);
        if (!localDeviceCache.find(d => d.id === device.id)) {
            localDeviceCache.push(device);
        } else {
            localDeviceCache = localDeviceCache.map(d => d.id === device.id ? device : d);
        }
        renderDeviceList();
    });

    socket.on('device_updated', (updatedDevice) => {
        console.log('Device updated by server:', updatedDevice);
        localDeviceCache = localDeviceCache.map(d => d.id === updatedDevice.id ? updatedDevice : d);
        renderDeviceList(); // Re-renders the main device list

        // Check if the Variable Manager is open and showing the updated device
        if (variableManagerModal && !variableManagerModal.classList.contains('hidden') && variableManagerModal.dataset.deviceId === updatedDevice.id) {
            console.log('Refreshing Variable Manager for device ID:', updatedDevice.id);
            openVariableManager(updatedDevice.id); // Re-populate the variable table
        }
    });

    socket.on('device_deleted', (deletedDeviceId) => {
        console.log('Device deleted by server:', deletedDeviceId);
        localDeviceCache = localDeviceCache.filter(d => d.id !== deletedDeviceId);
        deleteDeviceStateFromManager(deletedDeviceId); // Also clear its state from stateManager
        renderDeviceList(); // Re-renders the main device list

        // Check if the Variable Manager is open and showing the deleted device
        if (variableManagerModal && !variableManagerModal.classList.contains('hidden') && variableManagerModal.dataset.deviceId === deletedDeviceId) {
            console.log('Closing Variable Manager because the device (ID:', deletedDeviceId, ') was deleted.');
            closeVariableManager();
        }
    });

    // Listen for individual device status updates (e.g., connect/disconnect)
    socket.on('device_status_update', (statusUpdate) => {
        console.log('Received device_status_update:', statusUpdate);
        const device = localDeviceCache.find(d => d.id === statusUpdate.deviceId);
        if (device) {
            device.connected = statusUpdate.connected;
            // Optionally update other fields if included, like device.name if it can change server-side
        }
        renderDeviceList(); // Re-render to show updated status
    });


    socket.on('device_statuses', (statuses) => {
        if (!Array.isArray(statuses)) return;
        statuses.forEach(statusUpdate => {
            const device = localDeviceCache.find(d => d.id === statusUpdate.id);
            if (device) {
                device.connected = statusUpdate.connected;
            }
        });
        renderDeviceList();
    });

    // Commenting out old 'device_data' listener as 'device_variable_update' is preferred
    /*
    socket.on('device_data', (data) => {
        // data = { deviceId, address, value, timestamp? }
        if(data && typeof data.address !== 'undefined' && typeof data.value !== 'undefined') {
            // This was the old way, stateManager.setComponentAddressValue might try to adapt
            // by treating address as variableName if deviceId is present.
            setComponentAddressValue(data.address, data.value, data.deviceId);
        }
    });
    */

    socket.on('device_variable_update', (data) => {
        // data = { deviceId, variableName, value, timestamp? }
        console.log('[DeviceManager] Received device_variable_update:', data); // DEBUG LOG
        if (data && typeof data.deviceId !== 'undefined' && typeof data.variableName !== 'undefined' && typeof data.value !== 'undefined') {
            console.log(`[DeviceManager] Calling setDeviceVariableValue with deviceId: ${data.deviceId}, variableName: ${data.variableName}, value: ${data.value}`); // DEBUG LOG
            setDeviceVariableValue(data.deviceId, data.variableName, data.value);
        } else {
            console.warn("[DeviceManager] Received malformed device_variable_update:", data);
        }
    });

    socket.on('operation_error', (error) => {
        console.error('Server operation error:', error.message);
        alert(`Server Error: ${error.message}`);
    });

    renderDeviceList(); // Initial render
}

function openDeviceManager() {
    if(deviceManagerModal) deviceManagerModal.classList.remove('hidden');
}

// Helper function to add a new variable row to the form (NO LONGER USED FOR DEVICE FORM, WILL BE ADAPTED/REPLACED FOR VARIABLE FORM)
/*
function addVariableRow(variableData = {}) {
    const container = document.getElementById('mqtt-variables-container');
    const template = document.getElementById('mqtt-variable-row-template');
    if (!container || !template) {
        console.error("MQTT variable container or template not found.");
        return;
    }

    const clone = template.content.cloneNode(true);
    const varRow = clone.querySelector('.mqtt-variable-row');

    if (variableData.varId) {
        varRow.querySelector('.variable-id').value = variableData.varId;
    } else {
         varRow.querySelector('.variable-id').value = `var-${crypto.randomUUID()}`; // Assign new ID if not present
    }
    varRow.querySelector('.variable-name').value = variableData.name || '';
    varRow.querySelector('.variable-description').value = variableData.description || '';
    varRow.querySelector('.variable-datatype').value = variableData.dataType || 'string';

    const enableSubCheckbox = varRow.querySelector('.variable-enable-subscribe');
    const subOptionsDiv = varRow.querySelector('.variable-subscribe-options');
    enableSubCheckbox.checked = variableData.enableSubscribe || false;
    subOptionsDiv.style.display = enableSubCheckbox.checked ? 'block' : 'none';
    varRow.querySelector('.variable-subscribe-topic').value = variableData.subscribeTopic || '';
    varRow.querySelector('.variable-jsonpath-subscribe').value = variableData.jsonPathSubscribe || '';
    varRow.querySelector('.variable-qos-subscribe').value = variableData.qosSubscribe || 0;

    const enablePubCheckbox = varRow.querySelector('.variable-enable-publish');
    const pubOptionsDiv = varRow.querySelector('.variable-publish-options');
    enablePubCheckbox.checked = variableData.enablePublish || false;
    pubOptionsDiv.style.display = enablePubCheckbox.checked ? 'block' : 'none';
    varRow.querySelector('.variable-publish-topic').value = variableData.publishTopic || '';
    varRow.querySelector('.variable-qos-publish').value = variableData.qosPublish || 0;
    varRow.querySelector('.variable-retain-publish').checked = variableData.retainPublish || false;

    // Add Explore button for subscribe topic
    const subTopicInput = varRow.querySelector('.variable-subscribe-topic');
    const exploreButton = document.createElement('button');
    exploreButton.type = 'button';
    exploreButton.textContent = 'Explore';
    exploreButton.classList.add('text-xs', 'bg-cyan-700', 'hover:bg-cyan-800', 'text-white', 'py-0.5', 'px-1.5', 'rounded', 'ml-1');
    exploreButton.addEventListener('click', (e) => {
        e.stopPropagation(); // Prevent row click or other parent events
        const currentDeviceId = deviceIdInput.value; // Get device ID from the main form
        const currentDeviceName = deviceNameInput.value;
        if (!currentDeviceId) {
            alert("Please save the device first or ensure Device ID is set to use Topic Explorer.");
            return;
        }
        openTopicExplorer(currentDeviceId, currentDeviceName, varRow, subTopicInput.value);
    });
    // Insert button after the subTopicInput's parent div for better layout, or adjust as needed
    subTopicInput.parentNode.classList.add('flex', 'items-center');
    subTopicInput.parentNode.appendChild(exploreButton);

    container.appendChild(clone);
}

// Helper function to remove a variable row (NO LONGER USED FOR DEVICE FORM)
/*
function removeVariableRow(buttonElement) {
    buttonElement.closest('.mqtt-variable-row').remove();
}
*/

function closeDeviceManager() {
    if(deviceManagerModal) deviceManagerModal.classList.add('hidden');
}

function openDeviceForm(device = null) {
    if (!deviceFormModal || !deviceForm) {
        console.error("Device form modal or form element not found.");
        return;
    }
    deviceForm.reset(); // Reset general form fields
    // START OF REMOVAL: MQTT variables are no longer managed in the device form
    // const mqttVariablesContainer = document.getElementById('mqtt-variables-container');
    // if (mqttVariablesContainer) {
    //     mqttVariablesContainer.innerHTML = ''; // Clear existing variable rows
    // }
    const mqttVariablesSection = document.getElementById('mqtt-variables-section'); // Assuming you wrap the section
    if (mqttVariablesSection) {
        mqttVariablesSection.style.display = 'none'; // Hide it
    }
    // END OF REMOVAL

    if (deviceIdInput) {
        deviceIdInput.value = '';
        deviceIdInput.readOnly = false;
    }

    if (device && typeof device === 'object') {
        if (deviceFormTitle) deviceFormTitle.textContent = 'Edit Device';
        if (deviceIdInput) {
            deviceIdInput.value = device.id || '';
            deviceIdInput.readOnly = true;
        }
        if (deviceNameInput) deviceNameInput.value = device.name || '';
        if (deviceTypeInput) deviceTypeInput.value = device.type || '';

        // Populate common device fields
        if (device.type === 'mqtt') {
            if(document.getElementById('mqtt-protocol')) document.getElementById('mqtt-protocol').value = device.protocol || 'mqtt';
            if(document.getElementById('mqtt-host')) document.getElementById('mqtt-host').value = device.host || '';
            if(document.getElementById('mqtt-port')) document.getElementById('mqtt-port').value = device.port || '';
            if(document.getElementById('mqtt-username')) document.getElementById('mqtt-username').value = device.username || '';
            if(document.getElementById('mqtt-password')) document.getElementById('mqtt-password').value = device.password || '';
            if(document.getElementById('mqtt-basepath')) document.getElementById('mqtt-basepath').value = device.basepath || '';

            // Populate MQTT variables - NO LONGER DONE HERE
            // if (Array.isArray(device.variables)) {
            //     device.variables.forEach(variableData => addVariableRow(variableData));
            // }
            // Instead, ensure the section is hidden if device type is MQTT
            const mqttVariablesSection = document.getElementById('mqtt-variables-section');
            if (mqttVariablesSection) {
                mqttVariablesSection.style.display = 'block'; // Show the placeholder message
            }
        } else if (device.type === 'modbus-tcp') {
            // Hide MQTT specific variable section if not MQTT device
            const mqttVariablesSection = document.getElementById('mqtt-variables-section');
            if (mqttVariablesSection) {
                mqttVariablesSection.style.display = 'none';
            }
            if(document.getElementById('modbus-tcp-host')) document.getElementById('modbus-tcp-host').value = device.host || '';
            if(document.getElementById('modbus-tcp-port')) document.getElementById('modbus-tcp-port').value = device.port || '502';
            if(document.getElementById('modbus-tcp-unit-id')) document.getElementById('modbus-tcp-unit-id').value = device.unitId || '1';
        } else if (device.type === 'modbus-rtu') {
            if(document.getElementById('modbus-rtu-serial-port')) document.getElementById('modbus-rtu-serial-port').value = device.serialPort || '';
            if(document.getElementById('modbus-rtu-baud-rate')) document.getElementById('modbus-rtu-baud-rate').value = device.baudRate || '9600';
            if(document.getElementById('modbus-rtu-unit-id')) document.getElementById('modbus-rtu-unit-id').value = device.unitId || '1';
        }
    } else { // This is for adding a new device
        if (deviceFormTitle) deviceFormTitle.textContent = 'Tambah Device';
        // Optionally add one empty variable row for new MQTT devices - NO LONGER DONE HERE
        // if (deviceTypeInput && deviceTypeInput.value === 'mqtt') {
        //     addVariableRow();
        // }
        // Hide MQTT variable section when adding a new device, until type is MQTT
        const mqttVariablesSection = document.getElementById('mqtt-variables-section');
        if (mqttVariablesSection) {
             mqttVariablesSection.style.display = (deviceTypeInput && deviceTypeInput.value === 'mqtt') ? 'block' : 'none';
        }
    }
    toggleDeviceFields(); // Ensure correct sections are visible based on device type
    if (deviceFormModal) deviceFormModal.classList.remove('hidden');
}


function closeDeviceForm() {
    if(deviceFormModal) deviceFormModal.classList.add('hidden');
}

function toggleDeviceFields() {
    if (!deviceTypeInput) return;
    const selectedType = deviceTypeInput.value;

    if (mqttFields) mqttFields.style.display = selectedType === 'mqtt' ? 'block' : 'none';
    else console.warn("MQTT fields element not found");

    // Also toggle the (now placeholder) MQTT variables section visibility
    const mqttVariablesSection = document.getElementById('mqtt-variables-section');
    if (mqttVariablesSection) {
        mqttVariablesSection.style.display = selectedType === 'mqtt' ? 'block' : 'none';
    }

    if (modbusTcpFields) modbusTcpFields.style.display = selectedType === 'modbus-tcp' ? 'block' : 'none';
    else console.warn("Modbus TCP fields element not found");

    if (modbusRtuFields) modbusRtuFields.style.display = selectedType === 'modbus-rtu' ? 'block' : 'none';
    else console.warn("Modbus RTU fields element not found");
}

function handleFormSubmit(e) {
    e.preventDefault();
    if(!deviceIdInput || !deviceNameInput || !deviceTypeInput || !socket) {
        console.error("Form elements or socket missing for submission.");
        return;
    }

    const id = deviceIdInput.value.trim();
    const name = deviceNameInput.value.trim();
    const type = deviceTypeInput.value;

    if (!name || !type) {
        alert("Device Name and Type are required.");
        return;
    }

    const isEditing = !!(id && localDeviceCache.some(d => d.id === id));

    const deviceData = {
        id: id || `device-${crypto.randomUUID()}`,
        name: name,
        type: type,
    };

    if (!isEditing && !id) {
        deviceIdInput.value = deviceData.id;
    }

    // Populate type-specific data
    if (deviceData.type === 'mqtt') {
        deviceData.protocol = document.getElementById('mqtt-protocol')?.value || 'mqtt';
        deviceData.host = document.getElementById('mqtt-host')?.value.trim() || '';
        deviceData.port = document.getElementById('mqtt-port')?.value.trim() || '';
        deviceData.username = document.getElementById('mqtt-username')?.value || '';
        deviceData.password = document.getElementById('mqtt-password')?.value || '';
        deviceData.basepath = document.getElementById('mqtt-basepath')?.value.trim() || '';

        // MQTT Variables are no longer collected from the device form.
        // If editing, they are preserved from localDeviceCache. If new, it's an empty array.
        if (isEditing) {
            const existingDevice = localDeviceCache.find(d => d.id === deviceData.id);
            deviceData.variables = existingDevice ? existingDevice.variables : [];
        } else {
            deviceData.variables = []; // New device starts with no variables from this form
        }

    } else if (deviceData.type === 'modbus-tcp') {
        // Ensure variables array exists for non-MQTT types too, even if not managed by Variable Manager yet
        if (isEditing) {
            const existingDevice = localDeviceCache.find(d => d.id === deviceData.id);
            deviceData.variables = existingDevice ? existingDevice.variables : [];
        } else {
            deviceData.variables = [];
        }
        deviceData.host = document.getElementById('modbus-tcp-host')?.value.trim() || '';
        deviceData.port = document.getElementById('modbus-tcp-port')?.value.trim() || '502';
        deviceData.unitId = document.getElementById('modbus-tcp-unit-id')?.value.trim() || '1';
    } else if (deviceData.type === 'modbus-rtu') {
        // Ensure variables array exists for non-MQTT types too
        if (isEditing) {
            const existingDevice = localDeviceCache.find(d => d.id === deviceData.id);
            deviceData.variables = existingDevice ? existingDevice.variables : [];
        } else {
            deviceData.variables = [];
        }
        deviceData.serialPort = document.getElementById('modbus-rtu-serial-port')?.value.trim() || '';
        deviceData.baudRate = document.getElementById('modbus-rtu-baud-rate')?.value.trim() || '9600';
        deviceData.unitId = document.getElementById('modbus-rtu-unit-id')?.value.trim() || '1';
    } else { // For other device types, ensure variables array exists
        if (isEditing) {
            const existingDevice = localDeviceCache.find(d => d.id === deviceData.id);
            deviceData.variables = existingDevice ? existingDevice.variables : [];
        } else {
            deviceData.variables = [];
        }
    }


    if (isEditing) {
        socket.emit('edit_device', deviceData);
    } else {
        if (!deviceData.id) {
            alert("Device ID is missing. Cannot add device."); return;
        }
        if (localDeviceCache.some(d => d.id === deviceData.id)) {
            alert(`Device with ID ${deviceData.id} already exists. Please use a unique ID.`);
            if(deviceIdInput) deviceIdInput.focus();
            return;
        }
        socket.emit('add_device', deviceData);
    }
    closeDeviceForm();
}

function requestDeleteDevice(id) {
    if (socket && socket.connected) {
        socket.emit('delete_device', id);
    } else {
        alert("Cannot delete device: Server is not connected.");
    }
}

function renderDeviceList() {
    if (!deviceList) {
        console.warn("Device list DOM element not found. Cannot render devices.");
        return;
    }

    deviceList.innerHTML = '';
    const serverConnected = socket && socket.connected;

    if (!Array.isArray(localDeviceCache) || localDeviceCache.length === 0) {
        let msg = "No devices configured.";
        if (!serverConnected && socket) msg = "Attempting to connect to the server... Devices will appear once connected.";
        else if (!socket) msg = "Device communication module not initialized.";
        deviceList.innerHTML = `<p class="text-gray-500">${msg}</p>`;
        return;
    }

    localDeviceCache.forEach(device => {
        if(typeof device !== 'object' || !device.id) return; // Skip malformed device data

        const isDeviceConnected = device.connected || false;

        let statusTitle;
        let statusColorClass;

        if (!serverConnected) {
            statusTitle = 'Server Disconnected';
            statusColorClass = 'bg-orange-500';
        } else if (isDeviceConnected) {
            statusTitle = 'Connected';
            statusColorClass = 'bg-green-500';
        } else {
            statusTitle = 'Disconnected';
            statusColorClass = 'bg-red-500';
        }

        let deviceInfoHtml = `<h3 class="font-bold">${device.name || 'Unnamed Device'}</h3><p class="text-sm text-gray-400">Tipe: ${device.type || 'N/A'}`;
        if (device.type === 'mqtt' && device.host) {
            deviceInfoHtml += ` (${device.host}:${device.port})`;
        } else if (device.type === 'modbus-tcp' && device.host) {
            deviceInfoHtml += ` (${device.host}:${device.port}, Unit: ${device.unitId})`;
        } else if (device.type === 'modbus-rtu' && device.serialPort) {
            deviceInfoHtml += ` (${device.serialPort}, Unit: ${device.unitId})`;
        }
        deviceInfoHtml += `</p>`;

        const deviceElement = document.createElement('div');
        deviceElement.className = 'bg-gray-700 p-3 rounded-lg flex justify-between items-center';
        deviceElement.innerHTML = `
            <div class="flex items-center">
                <span class="device-status w-3 h-3 rounded-full mr-3 ${statusColorClass}" data-id="${device.id}" title="${statusTitle}"></span>
                <div>${deviceInfoHtml}</div>
            </div>
            <div class="space-x-2">
                <button class="variable-manager-btn bg-sky-600 hover:bg-sky-700 text-white font-bold py-1 px-2 rounded-lg" data-id="${device.id}" title="Variable Manager">Variabel</button>
                <button class="edit-device-btn bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-1 px-2 rounded-lg" data-id="${device.id}" title="Edit Device">Edit</button>
                <button class="delete-device-btn bg-red-600 hover:bg-red-700 text-white font-bold py-1 px-2 rounded-lg" data-id="${device.id}" title="Hapus Device">Hapus</button>
            </div>
        `;
        deviceList.appendChild(deviceElement);
    });

    // Re-attach event listeners for newly created buttons
    deviceList.querySelectorAll('.variable-manager-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            openVariableManager(e.currentTarget.dataset.id);
        });
    });

    deviceList.querySelectorAll('.edit-device-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const deviceToEdit = localDeviceCache.find(d => d.id === e.currentTarget.dataset.id);
            if (deviceToEdit) openDeviceForm(deviceToEdit);
        });
    });

    deviceList.querySelectorAll('.delete-device-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            if (confirm('Are you sure you want to request deletion of this device from the server?')) {
                requestDeleteDevice(e.currentTarget.dataset.id);
            }
        });
    });
}

// --- Variable Manager Functions ---
function openVariableManager(deviceId) {
    if (!variableManagerModal || !variableListTbody || !variableManagerTitle) {
        console.error("Variable Manager modal elements not found.");
        return;
    }
    const device = getDeviceById(deviceId);
    if (!device) {
        alert("Device not found!");
        return;
    }

    variableManagerTitle.textContent = `Variable Manager for ${device.name || 'Unnamed Device'}`;
    variableManagerModal.dataset.deviceId = deviceId; // Store deviceId for "Add Variable" button
    variableListTbody.innerHTML = ''; // Clear previous variables

    if (device.type === 'mqtt' && Array.isArray(device.variables) && device.variables.length > 0) {
        device.variables.forEach(variable => {
            const row = variableListTbody.insertRow();
            row.className = "hover:bg-gray-700/50";

            // Nama Variabel
            const nameCell = row.insertCell();
            nameCell.className = "px-4 py-3 whitespace-nowrap text-sm text-white";
            nameCell.textContent = variable.name || 'N/A';

            // Data Type Setting
            const dataTypeCell = row.insertCell();
            dataTypeCell.className = "px-4 py-3 whitespace-nowrap text-sm text-gray-300";
            let dataTypeHtml = `<span class="font-semibold">Type:</span> ${variable.dataType || 'N/A'}`;
            if (variable.description) {
                dataTypeHtml += `<br><span class="text-xs text-gray-400">Desc: ${variable.description}</span>`;
            }
            dataTypeCell.innerHTML = dataTypeHtml;

            // Subscribe Setting
            const subscribeCell = row.insertCell();
            subscribeCell.className = "px-4 py-3 whitespace-nowrap text-sm text-gray-300";
            let subscribeHtml = '<span class="text-xs text-gray-500">Not Subscribed</span>';
            if (variable.enableSubscribe) {
                subscribeHtml = `<span class="font-semibold">Topic:</span> ${variable.subscribeTopic || 'N/A'}`;
                subscribeHtml += `<br><span class="text-xs text-gray-400">QoS: ${variable.qosSubscribe !== undefined ? variable.qosSubscribe : 'N/A'}`;
                if (variable.jsonPathSubscribe) {
                    subscribeHtml += `, JSONPath: ${variable.jsonPathSubscribe}`;
                }
                subscribeHtml += `</span>`;
            }
            subscribeCell.innerHTML = subscribeHtml;

            // Publish Setting
            const publishCell = row.insertCell();
            publishCell.className = "px-4 py-3 whitespace-nowrap text-sm text-gray-300";
            let publishHtml = '<span class="text-xs text-gray-500">Not Publishing</span>';
            if (variable.enablePublish) {
                publishHtml = `<span class="font-semibold">Topic:</span> ${variable.publishTopic || 'N/A'}`;
                publishHtml += `<br><span class="text-xs text-gray-400">QoS: ${variable.qosPublish !== undefined ? variable.qosPublish : 'N/A'}, Retain: ${variable.retainPublish ? 'Yes' : 'No'}</span>`;
            }
            publishCell.innerHTML = publishHtml;

            // Value Preview Cell
            const valueCell = row.insertCell();
            valueCell.className = "px-4 py-3 whitespace-nowrap text-sm text-cyan-300 variable-value-preview"; // Added a class for easier selection if needed
            valueCell.dataset.deviceId = device.id;
            valueCell.dataset.variableName = variable.name;
            let currentValue = getDeviceVariableValue(device.id, variable.name);
            if (typeof currentValue === 'object' && currentValue !== null) {
                try {
                    currentValue = JSON.stringify(currentValue);
                     // Truncate if too long
                    if (currentValue.length > 30) {
                        currentValue = currentValue.substring(0, 27) + "...";
                    }
                } catch (e) {
                    currentValue = '[Object]' // Fallback for non-serializable objects, though unlikely for basic JSON
                }
            } else if (currentValue === undefined) {
                currentValue = "-";
            } else if (typeof currentValue === 'boolean') {
                currentValue = currentValue ? 'True' : 'False';
            }
            valueCell.textContent = currentValue;

            // Actions Cell (with Icons)
            const actionsCell = row.insertCell();
            actionsCell.className = "px-4 py-3 whitespace-nowrap text-sm text-right";
            actionsCell.innerHTML = `
                <button class="edit-variable-btn text-yellow-400 hover:text-yellow-300 p-1" data-device-id="${device.id}" data-var-id="${variable.varId || ''}" title="Edit Variabel">
                    ${ICON_EDIT}
                </button>
                <button class="delete-variable-btn text-red-400 hover:text-red-300 p-1 ml-1" data-device-id="${device.id}" data-var-id="${variable.varId || ''}" title="Hapus Variabel">
                    ${ICON_DELETE}
                </button>
            `;

        });
        // Add event listeners for the new Edit/Delete buttons
        variableListTbody.querySelectorAll('.edit-variable-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const devId = e.currentTarget.dataset.deviceId;
                const varId = e.currentTarget.dataset.varId;
                openVariableForm(devId, varId);
            });
        });
        variableListTbody.querySelectorAll('.delete-variable-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const devId = e.currentTarget.dataset.deviceId;
                const varId = e.currentTarget.dataset.varId;
                deleteVariable(devId, varId);
            });
        });
    } else if (device.type !== 'mqtt') { // For non-MQTT devices
         variableListTbody.innerHTML = `<tr><td colspan="6" class="px-4 py-3 text-sm text-gray-400 text-center">Manajemen variabel untuk tipe device '${device.type}' belum didukung di tampilan ini.</td></tr>`;
    } else { // MQTT device but no variables
        variableListTbody.innerHTML = `<tr><td colspan="6" class="px-4 py-3 text-sm text-gray-400 text-center">No variables configured for this MQTT device.</td></tr>`;
    }

    variableManagerModal.classList.remove('hidden');
}

function closeVariableManager() {
    if (variableManagerModal) {
        variableManagerModal.classList.add('hidden');
    }
}

function openVariableForm(deviceId, varIdToEdit = null) {
    if (!variableFormModal || !variableForm || !varFormDeviceId || !varFormVarId || !variableFormTitle) {
        console.error("Variable form modal elements not found.");
        return;
    }
    variableForm.reset(); // Reset form fields
    varFormDeviceId.value = deviceId;
    varFormVarId.value = varIdToEdit || '';

    const device = getDeviceById(deviceId);
    if (!device) {
        alert("Device not found for variable form!");
        return;
    }

    if (varIdToEdit) {
        variableFormTitle.textContent = `Edit Variabel untuk ${device.name}`;
        const variable = device.variables.find(v => v.varId === varIdToEdit);
        if (variable) {
            // Populate form with variable data
            varFormName.value = variable.name || '';
            varFormDataType.value = variable.dataType || 'string';
            varFormDescription.value = variable.description || '';

            varFormEnableSubscribe.checked = variable.enableSubscribe || false;
            if(varFormSubscribeOptions) varFormSubscribeOptions.style.display = varFormEnableSubscribe.checked ? 'block' : 'none';
            varFormSubscribeTopic.value = variable.subscribeTopic || '';
            varFormJsonPathSubscribe.value = variable.jsonPathSubscribe || '';
            varFormQosSubscribe.value = variable.qosSubscribe !== undefined ? variable.qosSubscribe.toString() : '0';

            varFormEnablePublish.checked = variable.enablePublish || false;
            if(varFormPublishOptions) varFormPublishOptions.style.display = varFormEnablePublish.checked ? 'block' : 'none';
            varFormPublishTopic.value = variable.publishTopic || '';
            varFormQosPublish.value = variable.qosPublish !== undefined ? variable.qosPublish.toString() : '0';
            varFormRetainPublish.checked = variable.retainPublish || false;
        } else {
            alert(`Variabel dengan ID ${varIdToEdit} tidak ditemukan.`);
            closeVariableForm();
            return;
        }
    } else {
        variableFormTitle.textContent = `Tambah Variabel Baru untuk ${device.name}`;
        // Ensure options are hidden for new form
        if(varFormSubscribeOptions) varFormSubscribeOptions.style.display = 'none';
        if(varFormPublishOptions) varFormPublishOptions.style.display = 'none';
    }

    variableFormModal.classList.remove('hidden');
}

function closeVariableForm() {
    if (variableFormModal) {
        variableFormModal.classList.add('hidden');
    }
}

function handleVariableFormSubmit(event) {
    event.preventDefault();
    const deviceId = varFormDeviceId.value;
    const varId = varFormVarId.value; // Empty if new, populated if editing
    const name = varFormName.value.trim();

    if (!name) {
        alert("Nama variabel harus diisi.");
        varFormName.focus();
        return;
    }

    const device = getDeviceById(deviceId);
    if (!device) {
        alert("Device tidak ditemukan. Tidak bisa menyimpan variabel.");
        return;
    }
    if (device.type !== 'mqtt') {
        alert(`Manajemen variabel saat ini hanya didukung untuk device MQTT dari UI ini.`);
        return;
    }


    const variableData = {
        varId: varId || `var-${crypto.randomUUID()}`, // Assign new ID if varId is empty (new variable)
        name: name,
        description: varFormDescription.value.trim(),
        dataType: varFormDataType.value,
        enableSubscribe: varFormEnableSubscribe.checked,
        subscribeTopic: varFormSubscribeTopic.value.trim(),
        jsonPathSubscribe: varFormJsonPathSubscribe.value.trim(),
        qosSubscribe: parseInt(varFormQosSubscribe.value || '0', 10),
        enablePublish: varFormEnablePublish.checked,
        publishTopic: varFormPublishTopic.value.trim(),
        qosPublish: parseInt(varFormQosPublish.value || '0', 10),
        retainPublish: varFormRetainPublish.checked
    };

    if (!Array.isArray(device.variables)) {
        device.variables = [];
    }

    if (varId) { // Editing existing variable
        const varIndex = device.variables.findIndex(v => v.varId === varId);
        if (varIndex > -1) {
            device.variables[varIndex] = variableData;
        } else {
            alert(`Error: Variabel dengan ID ${varId} tidak ditemukan untuk diedit.`);
            return;
        }
    } else { // Adding new variable
        // Check for duplicate variable name for the same device (optional but good practice)
        if (device.variables.some(v => v.name === variableData.name)) {
            alert(`Variabel dengan nama "${variableData.name}" sudah ada untuk device ini.`);
            varFormName.focus();
            return;
        }
        device.variables.push(variableData);
    }

    // Emit edit_device with the updated device object (including all its variables)
    if (socket && socket.connected) {
        console.log("Updating device with new/modified variable:", device);
        socket.emit('edit_device', device); // Server should handle this and update the device
        closeVariableForm();
        // openVariableManager(deviceId); // Re-open to refresh, or wait for 'device_updated' event
    } else {
        alert("Tidak dapat menyimpan variabel: Server tidak terhubung.");
    }
}

function deleteVariable(deviceId, varId) {
    if (!confirm('Apakah Anda yakin ingin menghapus variabel ini?')) {
        return;
    }

    const device = getDeviceById(deviceId);
    if (!device) {
        alert("Device tidak ditemukan. Tidak bisa menghapus variabel.");
        return;
    }
     if (device.type !== 'mqtt') {
        alert(`Manajemen variabel saat ini hanya didukung untuk device MQTT dari UI ini.`);
        return;
    }

    if (Array.isArray(device.variables)) {
        const initialLength = device.variables.length;
        device.variables = device.variables.filter(v => v.varId !== varId);

        if (device.variables.length < initialLength) { // Variable was found and removed
            if (socket && socket.connected) {
                console.log("Updating device after deleting variable:", device);
                socket.emit('edit_device', device);
                // openVariableManager(deviceId); // Re-open to refresh, or wait for 'device_updated'
            } else {
                alert("Tidak dapat menghapus variabel: Server tidak terhubung.");
                // Potentially revert local change if server update fails, or handle more gracefully
            }
        } else {
            alert("Variabel tidak ditemukan untuk dihapus.");
        }
    } else {
        alert("Tidak ada variabel untuk dihapus pada device ini.");
    }
}
// --- End Variable Manager Functions ---

export function getDevices() {
    return localDeviceCache;
}

export function getDeviceById(id) {
    return localDeviceCache.find(device => device.id === id) || null;
}

export function writeDataToServer(deviceId, address, value) {
    if (socket && socket.connected) {
        socket.emit('write_to_device', { deviceId, address, value });
    } else {
        console.error("Socket not connected. Cannot write data.");
        alert("Cannot write data: Server is not connected.");
    }
}

export function updateLiveVariableValueInManagerUI(deviceId, variableName, newValue) {
    if (variableManagerModal && !variableManagerModal.classList.contains('hidden') && variableManagerModal.dataset.deviceId === deviceId) {
        const valueCell = variableListTbody.querySelector(`td[data-device-id="${deviceId}"][data-variable-name="${variableName}"]`);
        if (valueCell) {
            let displayValue = newValue;
            if (typeof displayValue === 'object' && displayValue !== null) {
                try {
                    displayValue = JSON.stringify(displayValue);
                    if (displayValue.length > 30) { // Truncate if too long
                        displayValue = displayValue.substring(0, 27) + "...";
                    }
                } catch (e) {
                    displayValue = '[Object]';
                }
            } else if (displayValue === undefined) {
                displayValue = "-";
            } else if (typeof displayValue === 'boolean') {
                displayValue = displayValue ? 'True' : 'False';
            }
            valueCell.textContent = displayValue;
        }
    }
}