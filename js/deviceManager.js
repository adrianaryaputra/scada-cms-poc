import { setComponentAddressValue } from './stateManager.js';
// import { getLayer } from './konvaManager.js'; // getLayer might not be needed if Konva updates via stateManager

let localDeviceCache = [];
let socket = null;

// DOM Elements
let deviceManagerModal, closeDeviceManagerModal, addDeviceBtn, deviceList;
let deviceFormModal, deviceForm, deviceFormTitle, cancelDeviceForm, deviceIdInput, deviceNameInput, deviceTypeInput, mqttFields, modbusTcpFields, modbusRtuFields;

export function initDeviceManager(ioClient) { // Renamed 'io' to 'ioClient' for clarity
    if (typeof ioClient !== 'function') {
        console.error("Socket.IO client instance (io) not provided to initDeviceManager or is not a function.");
        // Fallback or error display for the user that real-time features are unavailable.
        const deviceManagerBtn = document.getElementById('device-manager-btn');
        if(deviceManagerBtn) deviceManagerBtn.disabled = true;
        // It's better to inform the user non-blockingly if possible
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
    socket = ioClient('/devices');

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

    // Device specific fieldsets - ensure these IDs exist in your HTML
    mqttFields = document.getElementById('mqtt-fields');
    modbusTcpFields = document.getElementById('modbus-tcp-fields');
    modbusRtuFields = document.getElementById('modbus-rtu-fields');

    // Check if all crucial Modal and Form elements are found
    if (!deviceManagerModal || !deviceFormModal || !deviceList || !deviceForm) {
        console.error("One or more crucial UI elements for Device Manager are missing from the DOM.");
        const deviceManagerBtn = document.getElementById('device-manager-btn');
        if(deviceManagerBtn) {
             deviceManagerBtn.textContent = "Device Manager Error";
             deviceManagerBtn.disabled = true;
             deviceManagerBtn.title = "Device Manager UI elements not found.";
        }
        return;
    }

    // Event Listeners for static elements
    document.getElementById('device-manager-btn').addEventListener('click', openDeviceManager);
    if(closeDeviceManagerModal) closeDeviceManagerModal.addEventListener('click', closeDeviceManager);
    if(addDeviceBtn) addDeviceBtn.addEventListener('click', () => openDeviceForm());
    if(cancelDeviceForm) cancelDeviceForm.addEventListener('click', closeDeviceForm);
    if(deviceForm) deviceForm.addEventListener('submit', handleFormSubmit);
    if(deviceTypeInput) deviceTypeInput.addEventListener('change', toggleDeviceFields);


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

    socket.on('device_updated', (device) => {
        console.log('Device updated by server:', device);
        localDeviceCache = localDeviceCache.map(d => d.id === device.id ? device : d);
        renderDeviceList();
    });

    socket.on('device_deleted', (deviceId) => {
        console.log('Device deleted by server:', deviceId);
        localDeviceCache = localDeviceCache.filter(d => d.id !== deviceId);
        renderDeviceList();
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

    socket.on('device_data', (data) => {
        // data = { deviceId, address, value, timestamp? }
        if(data && typeof data.address !== 'undefined' && typeof data.value !== 'undefined') {
            setComponentAddressValue(data.address, data.value, data.deviceId);
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

function closeDeviceManager() {
    if(deviceManagerModal) deviceManagerModal.classList.add('hidden');
}

function openDeviceForm(device = null) {
    if(!deviceFormModal || !deviceForm) {
        console.error("Device form modal or form element not found.");
        return;
    }
    deviceForm.reset();
    if(deviceIdInput) {
        deviceIdInput.value = '';
        deviceIdInput.readOnly = false;
    }

    if (device && typeof device === 'object') {
        if(deviceFormTitle) deviceFormTitle.textContent = 'Edit Device';
        if(deviceIdInput) {
            deviceIdInput.value = device.id || '';
            deviceIdInput.readOnly = true;
        }
        if(deviceNameInput) deviceNameInput.value = device.name || '';
        if(deviceTypeInput) deviceTypeInput.value = device.type || '';

        // Populate fields based on type
        if (device.type === 'mqtt') {
            if(document.getElementById('mqtt-protocol')) document.getElementById('mqtt-protocol').value = device.protocol || 'ws';
            if(document.getElementById('mqtt-host')) document.getElementById('mqtt-host').value = device.host || '';
            if(document.getElementById('mqtt-port')) document.getElementById('mqtt-port').value = device.port || '';
            if(document.getElementById('mqtt-username')) document.getElementById('mqtt-username').value = device.username || '';
            if(document.getElementById('mqtt-password')) document.getElementById('mqtt-password').value = device.password || '';
            if(document.getElementById('mqtt-basepath')) document.getElementById('mqtt-basepath').value = device.basepath || '';
        } else if (device.type === 'modbus-tcp') {
            if(document.getElementById('modbus-tcp-host')) document.getElementById('modbus-tcp-host').value = device.host || '';
            if(document.getElementById('modbus-tcp-port')) document.getElementById('modbus-tcp-port').value = device.port || '502';
            if(document.getElementById('modbus-tcp-unit-id')) document.getElementById('modbus-tcp-unit-id').value = device.unitId || '1';
        } else if (device.type === 'modbus-rtu') {
            if(document.getElementById('modbus-rtu-serial-port')) document.getElementById('modbus-rtu-serial-port').value = device.serialPort || '';
            if(document.getElementById('modbus-rtu-baud-rate')) document.getElementById('modbus-rtu-baud-rate').value = device.baudRate || '9600';
            if(document.getElementById('modbus-rtu-unit-id')) document.getElementById('modbus-rtu-unit-id').value = device.unitId || '1';
        }
    } else {
        if(deviceFormTitle) deviceFormTitle.textContent = 'Tambah Device';
    }
    toggleDeviceFields();
    deviceFormModal.classList.remove('hidden');
}

function closeDeviceForm() {
    if(deviceFormModal) deviceFormModal.classList.add('hidden');
}

function toggleDeviceFields() {
    if (!deviceTypeInput) return;
    const selectedType = deviceTypeInput.value;

    if (mqttFields) mqttFields.style.display = selectedType === 'mqtt' ? 'block' : 'none';
    else console.warn("MQTT fields element not found");

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
        deviceData.protocol = document.getElementById('mqtt-protocol')?.value || 'ws';
        deviceData.host = document.getElementById('mqtt-host')?.value.trim() || '';
        deviceData.port = document.getElementById('mqtt-port')?.value.trim() || '';
        deviceData.username = document.getElementById('mqtt-username')?.value || ''; // Passwords/usernames usually not trimmed
        deviceData.password = document.getElementById('mqtt-password')?.value || '';
        deviceData.basepath = document.getElementById('mqtt-basepath')?.value.trim() || '';
    } else if (deviceData.type === 'modbus-tcp') {
        deviceData.host = document.getElementById('modbus-tcp-host')?.value.trim() || '';
        deviceData.port = document.getElementById('modbus-tcp-port')?.value.trim() || '502';
        deviceData.unitId = document.getElementById('modbus-tcp-unit-id')?.value.trim() || '1';
    } else if (deviceData.type === 'modbus-rtu') {
        deviceData.serialPort = document.getElementById('modbus-rtu-serial-port')?.value.trim() || '';
        deviceData.baudRate = document.getElementById('modbus-rtu-baud-rate')?.value.trim() || '9600';
        deviceData.unitId = document.getElementById('modbus-rtu-unit-id')?.value.trim() || '1';
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
                <button class="edit-device-btn bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-1 px-2 rounded-lg" data-id="${device.id}">Edit</button>
                <button class="delete-device-btn bg-red-600 hover:bg-red-700 text-white font-bold py-1 px-2 rounded-lg" data-id="${device.id}">Hapus</button>
            </div>
        `;
        deviceList.appendChild(deviceElement);
    });

    // Re-attach event listeners for newly created buttons
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