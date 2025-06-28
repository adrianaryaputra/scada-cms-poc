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
        // console.log(`[DeviceManager] Device ${deviceConfig.name || deviceConfig.id} already initialized.`);
        return activeDevices.get(deviceConfig.id);
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
        default:
            console.error(`[DeviceManager] Unsupported device type: '${deviceConfig.type}' for device ${deviceConfig.name || deviceConfig.id}`);
            return null;
    }

    if (deviceInstance) {
        // console.log(`[DeviceManager] Initializing device: ${deviceInstance.name} (Type: ${deviceInstance.type}, ID: ${deviceInstance.id})`);
        activeDevices.set(deviceConfig.id, deviceInstance);
        try {
            deviceInstance.connect(); // Attempt to connect the device
        } catch (error) {
            console.error(`[DeviceManager - ${deviceInstance.name}] Error during initial connect: ${error.message}`);
            // Device remains in activeDevices but might be in a disconnected state.
            // The device's connect method itself should handle emitting its connection status.
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
        // console.log(`[DeviceManager] Removing device: ${device.name} (ID: ${deviceId})`);
        try {
            // The device's disconnect method should handle status updates and resource cleanup.
            if (typeof device.disconnect === 'function') {
                device.disconnect();
            } else {
                console.warn(`[DeviceManager - ${device.name}] Device type does not have a disconnect method.`);
            }
        } catch (error) {
            console.error(`[DeviceManager - ${device.name}] Error during disconnect call for removal: ${error.message}`);
        } finally {
            activeDevices.delete(deviceId); // Remove from map regardless of disconnect outcome
            // console.log(`[DeviceManager] Device ${device.name} (ID: ${deviceId}) removed from active list.`);
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
