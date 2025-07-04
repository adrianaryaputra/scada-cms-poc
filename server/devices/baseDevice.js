/**
 * @file Defines the base Device class for all physical or virtual device types.
 * This class provides a common interface, shared functionalities, and defines methods
 * that subclasses must implement (e.g., connect, disconnect).
 * It also includes helper methods for emitting data and status updates via Socket.IO.
 */

/**
 * Represents a generic device. This class is intended to be subclassed.
 * @class Device
 */
class Device {
    /**
     * Creates an instance of a Device.
     * @param {object} config - The device configuration object.
     * @param {string} config.id - The unique ID of the device.
     * @param {string} config.name - The human-readable name of the device.
     * @param {string} config.type - The type of the device (e.g., "mqtt", "modbus-tcp").
     * @param {SocketIO.Server} [ioInstance=null] - Optional Socket.IO server instance for emitting updates.
     *                                            If provided, it will be assigned to `this.io`.
     *                                            Subclasses or the DeviceManager are responsible for setting this.
     */
    constructor(config, ioInstance = null) {
        /** @type {string} Unique identifier for the device. */
        this.id = config.id;
        /** @type {string} User-friendly name for the device. */
        this.name = config.name;
        /** @type {string} Type of the device (e.g., 'mqtt', 'modbus-tcp'). */
        this.type = config.type;
        /** @type {object} The full configuration object for the device. */
        this.config = config;
        /** @type {boolean} Current connection status of the device. */
        this.connected = false;
        /**
         * @type {SocketIO.Server | null}
         * Socket.IO server instance used for emitting messages to clients.
         * This should be set by the subclass or the managing service (e.g., DeviceManager)
         * if real-time updates to clients are required.
         */
        this.io = ioInstance;
    }

    /**
     * Connects to the physical or virtual device.
     * This method MUST be implemented by subclasses.
     * @abstract
     * @throws {Error} If not implemented by a subclass.
     */
    connect() {
        throw new Error("Connect method must be implemented by subclasses");
    }

    /**
     * Disconnects from the device.
     * This method MUST be implemented by subclasses.
     * @abstract
     * @throws {Error} If not implemented by a subclass.
     */
    disconnect() {
        throw new Error("Disconnect method must be implemented by subclasses");
    }

    /**
     * Reads data from the device. This is primarily relevant for polled devices (e.g., Modbus).
     * Subclasses should implement this if they support polling-based data acquisition.
     * The implementation should handle the actual data reading and, if successful,
     * emit the data to clients (e.g., using `_emitVariableUpdateToSocket` or `_emitDeviceDataToSocket`).
     * @abstract
     */
    readData() {
        console.warn(
            `[${this.name}] readData method not implemented for device type ${this.type}. Polling will not occur.`,
        );
    }

    /**
     * Writes data to the device.
     * Subclasses must implement this method to support writing data to the physical or virtual device.
     * @abstract
     * @param {string|number} address - The specific address, register, topic, or identifier to write to on the device.
     * @param {*} value - The value to write to the device.
     * @param {object} [options={}] - Optional parameters for the write operation, specific to the device type.
     * @returns {Promise<void>} A promise that resolves when the write operation is complete or acknowledged.
     * @throws {Error} If not implemented or if the write operation fails.
     */
    async writeData(address, value, options = {}) { // Made async to suggest Promise return for real implementations
        console.warn(
            `[${this.name}] writeData method not implemented for device type ${this.type}. Cannot write to address '${address}'.`,
        );
        // To maintain a consistent return type for awaiters, even in the base non-implementation:
        return Promise.resolve();
    }

    /**
     * Helper method to emit generic device data updates (typically address-value pairs) to clients via Socket.IO.
     * This is often used by subclasses after polling raw data or receiving non-variable-specific data.
     * Requires `this.io` to be set.
     * @param {string|number} address - The address or identifier of the data point.
     * @param {*} value - The data value.
     * @protected
     */
    _emitDeviceDataToSocket(address, value) {
        if (this.io) {
            this.io.of("/devices").emit("device_data", {
                deviceId: this.id,
                address: address,
                value: value,
                timestamp: new Date().toISOString(),
            });
        } else {
            console.warn(
                `[${this.name}] Socket.IO instance (this.io) not available. Cannot emit device_data for address '${address}'.`,
            );
        }
    }

    /**
     * Helper method to emit named variable updates to clients via Socket.IO.
     * This is commonly used by devices that have a clear, named variable structure (e.g., MQTT devices).
     * Requires `this.io` to be set.
     * @param {string} variableName - The name of the variable that has been updated.
     * @param {*} value - The new value of the variable.
     * @protected
     */
    _emitVariableUpdateToSocket(variableName, value) {
        if (this.io) {
            // console.log( // Kept for very specific debugging if needed
            //     `[Device: ${this.name}] Emitting 'device_variable_update' for var '${variableName}' with value:`, value
            // );
            this.io.of("/devices").emit("device_variable_update", {
                deviceId: this.id,
                variableName: variableName,
                value: value,
                timestamp: new Date().toISOString(),
            });
        } else {
            console.warn(
                `[Device: ${this.name}] Socket.IO instance (this.io) not available. Cannot emit device_variable_update for var '${variableName}'.`,
            );
        }
    }

    /**
     * Updates the internal connection status of the device and emits this status update to clients via Socket.IO.
     * Requires `this.io` to be set for client notifications.
     * @param {boolean} isConnected - True if the device is now connected, false otherwise.
     * @protected
     */
    _updateStatusAndEmit(isConnected) {
        this.connected = isConnected;
        if (this.io) {
            const statusPayload = {
                deviceId: this.id,
                name: this.name,
                connected: this.connected,
                type: this.type,
                timestamp: new Date().toISOString(),
            };
            this.io.of("/devices").emit("device_status_update", statusPayload);
            // Also emit to the 'device_statuses' event for a more general update list
            // Consider if emitting to two different events for the same status is necessary or if one suffices.
            // For now, keeping existing behavior.
            this.io.of("/devices").emit("device_statuses", [statusPayload]);
        } else {
            console.warn(`[${this.name}] Socket.IO instance (this.io) not available. Cannot emit status update for device ID ${this.id}. Current connection status: ${this.connected}`);
        }
    }
}

module.exports = Device;
