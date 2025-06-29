/**
 * deviceManager.js - Manages active device instances, including initialization (factory),
 * retrieval, and removal of devices.
 */

// Import specific device classes
const MqttDevice = require('./devices/mqttDevice');
const ModbusRtuDevice = require('./devices/modbusRtuDevice');
const ModbusTcpDevice = require('./devices/modbusTcpDevice');
// Import BaseDevice if needed for type checking, though not directly instantiated here.
// const Device = require('./devices/baseDevice');

// Stores active device instances, keyed by deviceId
const activeDevices = new Map();

/**
 * Initializes a device based on its configuration.
 * If a device with the same ID is already initialized, returns the existing instance.
 * Otherwise, creates a new device instance, connects it, and stores it.
 * This function acts as a Factory for device objects.
 * @param {object} deviceConfig - The configuration object for the device.
 * @param {object} socketIoInstance - The Socket.IO server instance, passed to device constructors for event emission.
 * @returns {import('./devices/baseDevice')|null} The initialized device instance or null if type is unsupported.
 */
function initializeDevice(deviceConfig, socketIoInstance) {
    if (!deviceConfig || !deviceConfig.id || !deviceConfig.type) {
        console.error('[DeviceManager] Invalid deviceConfig provided for initialization:', deviceConfig);
        return null;
    }

    if (activeDevices.has(deviceConfig.id)) {
        console.log(`[DeviceManager] Device ${deviceConfig.name || deviceConfig.id} (ID: ${deviceConfig.id}) already exists. Removing old instance before re-initializing with new config.`);
        removeDevice(deviceConfig.id); // Disconnects and removes from activeDevices map
        // Now, activeDevices.has(deviceConfig.id) will be false, so the function will proceed to create a new one.
    }

    let deviceInstance;
    // console.log(`[DeviceManager] Initializing device type: ${deviceConfig.type.toLowerCase()}`);
    switch (deviceConfig.type.toLowerCase()) { // Normalize type to lowercase for robust matching
        case 'mqtt':
            deviceInstance = new MqttDevice(deviceConfig, socketIoInstance);
            break;
        case 'modbus-rtu':
            deviceInstance = new ModbusRtuDevice(deviceConfig, socketIoInstance);
            break;
        case 'modbus-tcp':
            deviceInstance = new ModbusTcpDevice(deviceConfig, socketIoInstance);
            break;
        case 'internal': // Handle Internal Device
            // For internal devices, we don't create a class instance in the same way.
            // We can return the config itself, perhaps with a flag or default status.
            // The main purpose is to have it in activeDevices and managed by socketHandler.
            console.log(`[DeviceManager] Initializing Internal Device: ${deviceConfig.name || deviceConfig.id}`);
            // Mark as 'connected' conceptually, as there's no physical connection to manage.
            // Add a flag to easily identify it as a virtual/internal device if needed by other parts.
            deviceInstance = { ...deviceConfig, connected: true, isInternal: true };
            break;
        default:
            console.error(`[DeviceManager] Unsupported device type: '${deviceConfig.type}' for device ${deviceConfig.name || deviceConfig.id}`);
            return null;
    }

    if (deviceInstance) {
        activeDevices.set(deviceConfig.id, deviceInstance);
        // Only attempt to connect if it's not an internal device and has a connect method
        if (deviceConfig.type.toLowerCase() !== 'internal' && typeof deviceInstance.connect === 'function') {
            // console.log(`[DeviceManager] Connecting device: ${deviceInstance.name} (Type: ${deviceInstance.type}, ID: ${deviceInstance.id})`);
            try {
                deviceInstance.connect(); // Attempt to connect the device
            } catch (error) {
                console.error(`[DeviceManager - ${deviceInstance.name}] Error during initial connect: ${error.message}`);
            }
        } else if (deviceConfig.type.toLowerCase() === 'internal') {
            // For internal devices, emit its 'status' as connected immediately if socketIoInstance is available
            // This is usually handled by the device class itself, so we emulate it here.
            if (socketIoInstance && typeof socketIoInstance.of === 'function') {
                 const devicesNamespace = socketIoInstance.of('/devices');
                 devicesNamespace.emit('device_status_update', { deviceId: deviceConfig.id, connected: true, name: deviceConfig.name });
            }
        }
    }
    return deviceInstance;
}

/**
 * Retrieves an active device instance by its ID.
 * @param {string} deviceId - The ID of the device to retrieve.
 * @returns {import('./devices/baseDevice')|undefined} The device instance, or undefined if not found.
 */
function getDeviceInstance(deviceId) {
    return activeDevices.get(deviceId);
}

/**
 * Retrieves all active device instances.
 * @returns {Array<import('./devices/baseDevice')>} An array of all active device instances.
 */
function getAllDeviceInstances() {
    return Array.from(activeDevices.values());
}

/**
 * Disconnects and removes a device from active management.
 * @param {string} deviceId - The ID of the device to remove.
 */
function removeDevice(deviceId) {
    const device = activeDevices.get(deviceId);
    if (device) {
        // console.log(`[DeviceManager] Removing device: ${device.name || device.id} (ID: ${deviceId})`);
        try {
            // The device's disconnect method should handle status updates and resource cleanup.
            // Internal devices (plain objects) won't have a disconnect method.
            if (typeof device.disconnect === 'function') {
                device.disconnect();
            } else if (device.isInternal) {
                // console.log(`[DeviceManager] Internal device ${device.name || device.id} does not require disconnect.`);
            } else {
                console.warn(`[DeviceManager - ${device.name || device.id}] Device type does not have a disconnect method or is not marked internal.`);
            }
        } catch (error) {
            console.error(`[DeviceManager - ${device.name || device.id}] Error during disconnect call for removal: ${error.message}`);
        } finally {
            activeDevices.delete(deviceId); // Remove from map regardless of disconnect outcome
            // console.log(`[DeviceManager] Device ${device.name || device.id} (ID: ${deviceId}) removed from active list.`);
        }
    } else {
        // console.warn(`[DeviceManager] Attempted to remove non-existent device with ID: ${deviceId}`);
    }
}

module.exports = {
    initializeDevice,
    getDeviceInstance,
    getAllDeviceInstances,
    removeDevice,
};
