/**
 * @file Defines the ModbusRtuDevice class for communication
 * with devices using the Modbus RTU protocol over a serial connection.
 * @extends Device
 */

const Device = require("./baseDevice");
const ModbusRTU = require("modbus-serial");

/**
 * Represents a Modbus RTU device.
 * Handles connection, disconnection, and potentially data reading/writing
 * using the Modbus RTU protocol.
 * @class ModbusRtuDevice
 * @extends {Device}
 */
class ModbusRtuDevice extends Device {
    /**
     * Creates an instance of ModbusRtuDevice.
     * @param {object} config - Device configuration. Expected to contain properties like
     *                          `serialPort`, `baudRate`, `unitId`, `timeout`.
     * @param {string} config.serialPort - The serial port name (e.g., "/dev/ttyUSB0", "COM3").
     * @param {number} [config.baudRate=9600] - The baud rate for serial communication.
     * @param {number} [config.unitId=1] - The Modbus slave ID to communicate with.
     * @param {number} [config.timeout=1000] - Modbus communication timeout in milliseconds.
     * @param {SocketIO.Server} [socketIoInstance=null] - Socket.IO server instance for emitting updates.
     */
    constructor(config, socketIoInstance) {
        super(config, socketIoInstance); // Pass ioInstance to parent
        /**
         * @type {ModbusRTU}
         * @private
         * The Modbus RTU client instance from the 'modbus-serial' library.
         */
        this.client = new ModbusRTU();

        // Initialize Modbus RTU specific properties from config or defaults
        /** @type {string} The name of the serial port. */
        this.portName = this.config.serialPort || "/dev/ttyUSB0";
        /** @type {number} The baud rate for serial communication. */
        this.baudRate = this.config.baudRate || 9600;
        /** @type {number} The Modbus unit ID (slave ID) this device will target by default. */
        this.unitId = this.config.unitId || 1;
        /** @type {number} Timeout for Modbus operations in milliseconds. */
        this.timeout = this.config.timeout || 1000;

        this.client.setTimeout(this.timeout);
    }

    /**
     * Connects to the Modbus RTU device by opening the specified serial port.
     * Updates and emits connection status.
     * @override
     * @async
     */
    async connect() {
        if (this.connected) {
            console.log(`[${this.name}] Already connected to ${this.portName}.`);
            return;
        }
        console.log(`[${this.name}] Attempting to connect to Modbus RTU on ${this.portName} at ${this.baudRate} baud.`);
        try {
            // Close if previously open, to handle potential stale state
            if (this.client.isOpen) {
                await this.client.close(() => {}); // modbus-serial close needs a callback
            }
            await this.client.connectRTUBuffered(this.portName, { baudRate: this.baudRate });
            this._updateStatusAndEmit(true);
            console.log(`[${this.name}] Successfully connected to Modbus RTU on ${this.portName}.`);
        } catch (error) {
            console.error(`[${this.name}] Failed to connect to Modbus RTU on ${this.portName}:`, error.message);
            this._updateStatusAndEmit(false);
            // Optionally re-throw or handle specific error types if needed for DeviceManager
        }
    }

    /**
     * Disconnects from the Modbus RTU device by closing the serial port.
     * Updates and emits connection status.
     * @override
     * @async
     */
    async disconnect() {
        if (!this.connected && !this.client.isOpen) {
            console.log(`[${this.name}] Already disconnected from ${this.portName}.`);
            return;
        }
        console.log(`[${this.name}] Disconnecting from Modbus RTU on ${this.portName}.`);
        try {
            if (this.client.isOpen) {
                await new Promise((resolve, reject) => {
                    this.client.close((err) => {
                        if (err) return reject(err);
                        resolve();
                    });
                });
            }
            this._updateStatusAndEmit(false);
            console.log(`[${this.name}] Successfully disconnected from Modbus RTU on ${this.portName}.`);
        } catch (error) {
            console.error(`[${this.name}] Error disconnecting from Modbus RTU on ${this.portName}:`, error.message);
            // Even on error, update status to false as connection is likely lost/unusable
            this._updateStatusAndEmit(false);
        }
    }

    /**
     * Placeholder for Modbus RTU data reading logic.
     * This method should be implemented to read data based on the device's
     * specific configuration of variables or polling jobs.
     * @override
     * @todo Implement actual Modbus RTU data reading.
     */
    readData() {
        // TODO: Implement Modbus RTU data reading logic based on variable definitions
        // This will likely involve iterating through configured variables/registers
        // and using this.client.readHoldingRegisters(), readCoils(), etc.
        // Example:
        // if (!this.connected || !this.client) {
        //     console.warn(`[${this.name}] Cannot read data: Not connected.`);
        //     return;
        // }
        // this.config.variables.forEach(async (variable) => {
        //     try {
        //         this.client.setID(variable.unitId || this.unitId);
        //         // Based on variable.functionCode (FC1, FC2, FC3, FC4)
        //         // const data = await this.client.readHoldingRegisters(variable.address, variable.quantity);
        //         // this._emitVariableUpdateToSocket(variable.name, data.data[0]); // Or process data
        //     } catch (error) {
        //         console.error(`[${this.name}] Error reading variable ${variable.name}:`, error.message);
        //         this._updateStatusAndEmit(false); // Consider if a read error means disconnect
        //     }
        // });
        super.readData(); // Calls console.warn from base class for now
    }

    /**
     * Placeholder for Modbus RTU data writing logic.
     * This method should be implemented to write data to the device, determining
     * the correct Modbus function code (e.g., Write Single Register, Write Single Coil)
     * based on the provided address, value, and options.
     * @override
     * @async
     * @param {string|number} address - The Modbus address (register number or coil number).
     * @param {*} value - The value to write.
     * @param {object} [options={}] - Options for the write operation, which might include
     *                                `unitId` (if different from default) or `functionCode`.
     * @returns {Promise<void>}
     * @todo Implement actual Modbus RTU data writing.
     */
    async writeData(address, value, options = {}) {
        // TODO: Implement Modbus RTU data writing logic
        // Needs to determine function code (e.g., writeSingleRegister, writeSingleCoil)
        // based on address, options, or variable definition.
        // Example:
        // if (!this.connected || !this.client) {
        //     console.warn(`[${this.name}] Cannot write data: Not connected.`);
        //     return Promise.reject(new Error("Not connected"));
        // }
        // const unitId = options.unitId || this.unitId;
        // this.client.setID(unitId);
        // try {
        //     // if (options.functionCode === 'FC6' || options.type === 'register') {
        //     //     await this.client.writeRegister(address, value);
        //     // } else if (options.functionCode === 'FC5' || options.type === 'coil') {
        //     //     await this.client.writeCoil(address, value);
        //     // } else {
        //     //     throw new Error(`Unsupported function code or type for writeData: ${options.functionCode || options.type}`);
        //     // }
        //     // console.log(`[${this.name}] Successfully wrote ${value} to address ${address} (Unit ID: ${unitId})`);
        //     // Optionally, re-read or emit an update if the write doesn't trigger a read or if confirmation is needed.
        // } catch (error) {
        //     console.error(`[${this.name}] Error writing ${value} to address ${address} (Unit ID: ${unitId}):`, error.message);
        //     this._updateStatusAndEmit(false); // Consider if a write error means disconnect
        //     return Promise.reject(error);
        // }
        return super.writeData(address, value); // Calls console.warn from base class for now
    }
}

module.exports = ModbusRtuDevice;
