/**
 * baseDevice.js - Defines the base Device class for all device types.
 * This class provides a common interface and shared functionalities.
 */

class Device {
    constructor(config) {
        this.id = config.id;
        this.name = config.name;
        this.type = config.type;
        this.config = config; // Store the full configuration
        this.connected = false;
        // this.io is expected to be set by subclasses if they need to emit directly,
        // typically passed in their constructor and assigned to this.io.
    }

    connect() {
        throw new Error("Connect method must be implemented by subclasses");
    }

    disconnect() {
        throw new Error("Disconnect method must be implemented by subclasses");
    }

    /**
     * Reads data from the device. Primarily for polled devices.
     * Subclasses should implement this if they support polling.
     * The method itself should handle emitting data to clients if successful.
     */
    readData() {
        console.warn(`[${this.name}] Read data not implemented for type ${this.type}`);
    }

    /**
     * Writes data to the device.
     * @param {string|number} address - The address (e.g., register, topic) to write to.
     * @param {*} value - The value to write.
     */
    writeData(address, value) {
        console.warn(`[${this.name}] Write data not implemented for type ${this.type}`);
    }

    /**
     * Helper to emit generic device data updates to clients via Socket.IO.
     * Used by subclasses after polling or receiving non-variable-specific data.
     * @param {string|number} address - The address or identifier for the data.
     * @param {*} value - The data value.
     * @protected
     */
    _emitDeviceDataToSocket(address, value) {
        if (this.io) {
            this.io.of('/devices').emit('device_data', {
                deviceId: this.id,
                address: address,
                value: value,
                timestamp: new Date().toISOString()
            });
        } else {
            console.warn(`[${this.name}] Socket.IO instance (this.io) not available. Cannot emit device_data.`);
        }
    }

    /**
     * Helper to emit named variable updates to clients via Socket.IO.
     * Commonly used by MQTT devices or devices with a clear variable structure.
     * @param {string} variableName - The name of the variable.
     * @param {*} value - The value of the variable.
     * @protected
     */
    _emitVariableUpdateToSocket(variableName, value) {
        if (this.io) {
            console.log(`[Device: ${this.name}] Attempting to emit 'device_variable_update' for var '${variableName}'. IO available.`); // DEBUG LOG
            this.io.of('/devices').emit('device_variable_update', {
                deviceId: this.id,
                variableName: variableName,
                value: value,
                timestamp: new Date().toISOString()
            });
        } else {
            console.warn(`[Device: ${this.name}] Socket.IO instance (this.io) not available. Cannot emit device_variable_update for var '${variableName}'.`);
        }
    }

    /**
     * Updates the connection status of the device and emits status updates to clients.
     * @param {boolean} isConnected - True if the device is connected, false otherwise.
     * @protected
     */
    _updateStatusAndEmit(isConnected) {
        this.connected = isConnected;
        // console.log(`Device ${this.name} (${this.id}) status: ${this.connected ? 'Connected' : 'Disconnected'}`);
        if (this.io) {
            const statusPayload = {
                deviceId: this.id,
                name: this.name,
                connected: this.connected,
                type: this.type,
                timestamp: new Date().toISOString()
            };
            this.io.of('/devices').emit('device_status_update', statusPayload);
            // Also emit to the 'device_statuses' event for a more general update list
            this.io.of('/devices').emit('device_statuses', [statusPayload]);
        } else {
            // console.warn(`[${this.name}] Socket.IO instance (this.io) not available. Cannot emit status update.`);
            // Log locally if io is not available, as status change is important.
            // console.log(`[${this.name}] Local Status Update: Connected = ${this.connected}`);
        }
    }
}

module.exports = Device;
