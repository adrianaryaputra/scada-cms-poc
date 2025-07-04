/**
 * @file Defines the ModbusTcpDevice class for communication
 * with devices using the Modbus TCP protocol.
 * @extends Device
 */

const Device = require("./baseDevice");
const ModbusRTU = require("modbus-serial"); // modbus-serial library handles both RTU and TCP

/**
 * Represents a Modbus TCP device.
 * Handles connection, disconnection, and data interaction via Modbus TCP.
 * @class ModbusTcpDevice
 * @extends {Device}
 */
class ModbusTcpDevice extends Device {
    /**
     * Creates an instance of ModbusTcpDevice.
     * @param {object} config - Device configuration. Expected to contain `host`, `port`,
     *                          and optionally `unitId`, `timeout`.
     * @param {string} [config.host="127.0.0.1"] - The hostname or IP address of the Modbus TCP server.
     * @param {number} [config.port=502] - The port number for Modbus TCP.
     * @param {number} [config.unitId=1] - The Modbus unit ID (slave ID).
     * @param {number} [config.timeout=2000] - Modbus communication timeout in milliseconds.
     * @param {SocketIO.Server} [socketIoInstance=null] - Socket.IO server instance.
     */
    constructor(config, socketIoInstance) {
        super(config, socketIoInstance);
        /**
         * @type {ModbusRTU}
         * @private
         * The Modbus client instance. Handles TCP connections as well.
         */
        this.client = new ModbusRTU();

        /** @type {string} Hostname or IP address of the Modbus TCP server. */
        this.host = this.config.host || "127.0.0.1";
        /** @type {number} Port number for Modbus TCP communication. */
        this.port = this.config.port || 502;
        /** @type {number} The Modbus unit ID to target. */
        this.unitId = this.config.unitId || 1;
        /** @type {number} Timeout for Modbus operations. */
        this.timeout = this.config.timeout || 2000;

        this.client.setTimeout(this.timeout);
    }

    /**
     * Connects to the Modbus TCP server.
     * Updates and emits connection status.
     * @override
     * @async
     */
    async connect() {
        if (this.connected) {
            console.log(`[${this.name}] Already connected to ${this.host}:${this.port}.`);
            return;
        }
        console.log(`[${this.name}] Attempting to connect to Modbus TCP at ${this.host}:${this.port}.`);
        try {
            // Close if previously open, to handle potential stale state
            if (this.client.isOpen) {
                console.log(`[${this.name}] Client was open, attempting to close before reconnecting.`);
                await new Promise((resolveClose, rejectClose) => {
                    this.client.close((err) => {
                        if (err) {
                            console.warn(`[${this.name}] Error closing previous TCP connection: ${err.message}`);
                            // Decide if you want to reject or resolve in this case.
                            // For now, we'll resolve to allow the new connection attempt.
                        } else {
                            console.log(`[${this.name}] Previous TCP connection closed.`);
                        }
                        resolveClose();
                    });
                });
            }

            await new Promise((resolve, reject) => {
                this.client.connectTCP(this.host, { port: this.port }, (err) => {
                    if (err) {
                        // this._updateStatusAndEmit(false); // Moved to catch block
                        return reject(err);
                    }
                    // Only set connected to true and setID on successful callback
                    this.client.setID(this.unitId);
                    this._updateStatusAndEmit(true);
                    console.log(`[${this.name}] Successfully connected to Modbus TCP at ${this.host}:${this.port}.`);
                    resolve();
                });
            });
        } catch (error) {
            console.error(`[${this.name}] Failed to connect to Modbus TCP at ${this.host}:${this.port}:`, error.message);
            this._updateStatusAndEmit(false); // Centralized error handling for status
        }
    }

    /**
     * Disconnects from the Modbus TCP server.
     * Updates and emits connection status.
     * @override
     * @async
     */
    async disconnect() {
        if (!this.connected && !this.client.isOpen) {
            console.log(`[${this.name}] Already disconnected from ${this.host}:${this.port}.`);
            return;
        }
        console.log(`[${this.name}] Disconnecting from Modbus TCP at ${this.host}:${this.port}.`);
        try {
            if (this.client.isOpen) {
                // For TCP, client.close() is typically synchronous or uses a callback.
                // No promise is returned directly by the library for close in many versions.
                this.client.close(() => {
                     // console.log(`[${this.name}] Modbus TCP client closed callback invoked.`);
                });
            }
            this._updateStatusAndEmit(false);
            console.log(`[${this.name}] Successfully disconnected from Modbus TCP at ${this.host}:${this.port}.`);
        } catch (error) { // This catch might not be effective if .close is sync and throws
            console.error(`[${this.name}] Error disconnecting from Modbus TCP at ${this.host}:${this.port}:`, error.message);
            this._updateStatusAndEmit(false);
        }
    }

    /**
     * Reads data from the Modbus TCP device.
     * Placeholder - actual implementation needed based on polling requirements and
     * variable definitions in the device configuration.
     * @override
     * @todo Implement actual Modbus TCP data reading.
     */
    readData() {
        // TODO: Implement Modbus TCP data reading logic (similar to RTU's TODO but using TCP client)
        super.readData();
    }

    /**
     * Writes data to the Modbus TCP device.
     * Placeholder - actual implementation needed, including determining Modbus function codes.
     * @override
     * @async
     * @param {string|number} address - The Modbus address (e.g., register number).
     * @param {*} value - The value to write.
     * @param {object} [options={}] - Optional parameters for the write operation (e.g., `unitId`, `functionCode`).
     * @returns {Promise<void>}
     * @todo Implement actual Modbus TCP data writing.
     */
    async writeData(address, value, options = {}) {
        // TODO: Implement Modbus TCP data writing logic (similar to RTU's TODO but using TCP client)
        return super.writeData(address, value, options);
    }
}

module.exports = ModbusTcpDevice;
