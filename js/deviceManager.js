import { createMqttDevice, disconnectMqttDevice, getMqttDevice } from './mqttManager.js';

let devices = [];

// DOM Elements
let deviceManagerModal, closeDeviceManagerModal, addDeviceBtn, deviceList;
let deviceFormModal, deviceForm, deviceFormTitle, cancelDeviceForm, deviceIdInput, deviceNameInput, deviceTypeInput, mqttFields;

export function initDeviceManager() {
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
    mqttFields = document.getElementById('mqtt-fields');

    // Event Listeners
    document.getElementById('device-manager-btn').addEventListener('click', openDeviceManager);
    closeDeviceManagerModal.addEventListener('click', closeDeviceManager);
    addDeviceBtn.addEventListener('click', () => openDeviceForm());
    cancelDeviceForm.addEventListener('click', closeDeviceForm);
    deviceForm.addEventListener('submit', handleFormSubmit);
    deviceTypeInput.addEventListener('change', toggleDeviceFields);

    loadDevices();
    renderDeviceList();
}

function openDeviceManager() {
    renderDeviceList(); // Refresh list every time the manager is opened
    deviceManagerModal.classList.remove('hidden');
}

function closeDeviceManager() {
    deviceManagerModal.classList.add('hidden');
}

function openDeviceForm(device = null) {
    deviceForm.reset();
    deviceIdInput.value = '';
    if (device) {
        deviceFormTitle.textContent = 'Edit Device';
        deviceIdInput.value = device.id;
        deviceNameInput.value = device.name;
        deviceTypeInput.value = device.type;
        if (device.type === 'mqtt') {
            document.getElementById('mqtt-host').value = device.host;
            document.getElementById('mqtt-port').value = device.port;
        }
    } else {
        deviceFormTitle.textContent = 'Tambah Device';
    }
    toggleDeviceFields();
    deviceFormModal.classList.remove('hidden');
}

function closeDeviceForm() {
    deviceFormModal.classList.add('hidden');
}

function toggleDeviceFields() {
    const selectedType = deviceTypeInput.value;
    if (selectedType === 'mqtt') {
        mqttFields.style.display = 'block';
    } else {
        mqttFields.style.display = 'none';
    }
}

function handleFormSubmit(e) {
    e.preventDefault();
    const deviceData = {
        id: deviceIdInput.value || `device-${crypto.randomUUID()}`,
        name: deviceNameInput.value,
        type: deviceTypeInput.value,
    };

    if (deviceData.type === 'mqtt') {
        deviceData.host = document.getElementById('mqtt-host').value;
        deviceData.port = document.getElementById('mqtt-port').value;
    } else if (deviceData.type === 'external') {
        // No specific fields for external devices yet
    }

    saveDevice(deviceData);
    renderDeviceList();
    closeDeviceForm();
}

function saveDevice(deviceData) {
    const isNewDevice = !devices.some(d => d.id === deviceData.id);
    const index = devices.findIndex(d => d.id === deviceData.id);

    if (index > -1) {
        // Disconnect the old instance if settings changed and it was an MQTT device
        if (devices[index].type === 'mqtt') {
            disconnectMqttDevice(deviceData.id);
        }
        devices[index] = deviceData;
    } else {
        devices.push(deviceData);
    }

    if (deviceData.type === 'mqtt') {
        createMqttDevice(deviceData);
    }
    
    // Persist devices to localStorage
    localStorage.setItem('devices', JSON.stringify(devices));
}

function deleteDevice(id) {
    const device = devices.find(d => d.id === id);
    if (device && device.type === 'mqtt') {
        disconnectMqttDevice(id);
    }
    devices = devices.filter(d => d.id !== id);
    localStorage.setItem('devices', JSON.stringify(devices));
    renderDeviceList();
}

function loadDevices() {
    const storedDevices = localStorage.getItem('devices');
    if (storedDevices) {
        devices = JSON.parse(storedDevices);
        // Connect all loaded MQTT devices
        devices.forEach(device => {
            if (device.type === 'mqtt') {
                createMqttDevice(device);
            }
        });
    }
}

function renderDeviceList() {
    deviceList.innerHTML = '';
    if (devices.length === 0) {
        deviceList.innerHTML = `<p class="text-gray-500">Belum ada device yang ditambahkan.</p>`;
        return;
    }

    devices.forEach(device => {
        let isConnected = false;
        let statusTitle = 'N/A';
        let statusColorClass = 'bg-gray-500'; // Default for non-MQTT or unknown status

        if (device.type === 'mqtt') {
            const mqttDevice = getMqttDevice(device.id);
            isConnected = mqttDevice ? mqttDevice.connected : false;
            statusTitle = isConnected ? 'Connected' : 'Disconnected';
            statusColorClass = isConnected ? 'bg-green-500' : 'bg-red-500';
        } else if (device.type === 'external') {
            // External devices don't have a direct connection status managed by mqttManager
            statusTitle = 'External Device';
            // Could use a different color or no color, e.g., bg-blue-500 or remove status dot
        }

        const deviceElement = document.createElement('div');
        deviceElement.className = 'bg-gray-700 p-3 rounded-lg flex justify-between items-center';

        let deviceInfoHtml = `<h3 class="font-bold">${device.name}</h3><p class="text-sm text-gray-400">Tipe: ${device.type}`;
        if (device.type === 'mqtt' && device.host) {
            deviceInfoHtml += ` (${device.host})`;
        }
        deviceInfoHtml += `</p>`;

        deviceElement.innerHTML = `
            <div class="flex items-center">
                <span class="device-status w-3 h-3 rounded-full mr-3 ${statusColorClass}" data-id="${device.id}" title="${statusTitle}"></span>
                <div>
                    ${deviceInfoHtml}
                </div>
            </div>
            <div class="space-x-2">
                <button class="edit-device-btn bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-1 px-2 rounded-lg" data-id="${device.id}">Edit</button>
                <button class="delete-device-btn bg-red-600 hover:bg-red-700 text-white font-bold py-1 px-2 rounded-lg" data-id="${device.id}">Hapus</button>
            </div>
        `;
        deviceList.appendChild(deviceElement);
    });

    // Add event listeners for the new buttons
    deviceList.querySelectorAll('.edit-device-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const device = devices.find(d => d.id === e.target.dataset.id);
            openDeviceForm(device);
        });
    });

    deviceList.querySelectorAll('.delete-device-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            if (confirm('Apakah Anda yakin ingin menghapus device ini?')) {
                deleteDevice(e.target.dataset.id);
            }
        });
    });
}

export function getDevices() {
    return devices;
}