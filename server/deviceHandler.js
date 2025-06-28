// server/deviceHandler.js

// Base class/interface for all device types
class Device {
    constructor(config) {
        this.id = config.id;
        this.name = config.name;
        this.type = config.type;
        this.config = config; // Store the full configuration
        this.connected = false;
    }

    connect() {
        throw new Error("Connect method must be implemented by subclasses");
    }

    disconnect() {
        throw new Error("Disconnect method must be implemented by subclasses");
    }

    readData() {
        // To be implemented by specific device types if they support polling
        console.warn(`Read data not implemented for ${this.name} (${this.type})`);
    }

    writeData(address, value) {
        // To be implemented by specific device types
        console.warn(`Write data not implemented for ${this.name} (${this.type})`);
    }

    // Method to be called when data is received from the physical device
    onData(data) {
        // This method should be overridden or handled by an event emitter
        // For now, we'll assume it emits an event or calls a callback
        console.log(`Data received from ${this.name}:`, data);
        // In a real scenario, this would emit an event to socketHandler
        // e.g., this.emit('data', { deviceId: this.id, data });
    }

    // Method to update connection status and potentially emit an event
    updateStatus(isConnected) {
        this.connected = isConnected;
        console.log(`Device ${this.name} status updated: ${this.connected ? 'Connected' : 'Disconnected'}`);
        // In a real scenario, this would emit an event to socketHandler
        // e.g., this.emit('status', { deviceId: this.id, connected: this.connected });
    }
}

class MqttDevice extends Device {
    constructor(config, socketIoInstance) {
        super(config);
        this.client = null; // MQTT client instance
        this.io = socketIoInstance; // Socket.IO instance for emitting data to clients
        // MQTT specific config: host, port, username, password, basepath, protocol
    }

    connect() {
        // Logic to connect to MQTT broker (using a library like mqtt.js)
        // This is a simplified example. A real implementation would use an MQTT library.
        console.log(`Attempting to connect MQTT device: ${this.name} to ${this.config.host}:${this.config.port}`);

        // Placeholder for actual MQTT connection
        // Example using a hypothetical MQTT library structure
        // this.client = new MqttClient({ host: this.config.host, port: this.config.port, ... });
        // this.client.on('connect', () => {
        //     this.updateStatus(true);
        //     this._subscribeToTopics();
        // });
        // this.client.on('error', (err) => {
        //     console.error(`MQTT connection error for ${this.name}:`, err);
        //     this.updateStatus(false);
        // });
        // this.client.on('message', (topic, message) => {
        //     this.onData({ topic, value: message.toString() });
        //     // Emit data to web clients via Socket.IO
        //     if (this.io) {
        //         this.io.of('/devices').emit('device_data', {
        //             deviceId: this.id,
        //             address: topic, // Assuming topic is the address
        //             value: message.toString()
        //         });
        //     }
        // });
        // this.client.connect();

        // Simulate connection for now
        setTimeout(() => {
            this.updateStatus(true);
            console.log(`MQTT device ${this.name} connected (simulated).`);
            // Simulate receiving a message
            setTimeout(() => {
                const simulatedTopic = `${this.config.basepath || 'hmi'}/${this.id}/status`;
                const simulatedValue = Math.random() * 100;
                this.onData({ topic: simulatedTopic, value: simulatedValue });
                 if (this.io) {
                    this.io.of('/devices').emit('device_data', {
                        deviceId: this.id,
                        address: simulatedTopic,
                        value: simulatedValue.toFixed(2)
                    });
                }
            }, 2000);
        }, 1000);
    }

    _subscribeToTopics() {
        // Logic to subscribe to relevant MQTT topics based on device config or HMI components
        // e.g., if HMI components are linked to this device and have addresses (topics)
        // This would require access to the HMI's tag database or component configurations
        console.log(`MQTT device ${this.name}: Subscribing to topics (placeholder).`);
        // Example: this.client.subscribe(`${this.config.basepath || 'hmi'}/${this.id}/#`);
    }

    disconnect() {
        if (this.client) {
            // this.client.end(); // Method to disconnect from MQTT broker
            console.log(`MQTT device ${this.name} disconnected.`);
        }
        this.updateStatus(false);
    }

    writeData(address, value) {
        if (this.client && this.connected) {
            // this.client.publish(address, value.toString());
            console.log(`MQTT: Writing to ${address} for device ${this.name}: ${value} (simulated)`);
        } else {
            console.warn(`MQTT device ${this.name} not connected or client not initialized. Cannot write data.`);
        }
    }
}

// Placeholder for other device types
class ModbusRtuDevice extends Device {
    constructor(config, socketIoInstance) {
        super(config);
        this.io = socketIoInstance;
        // Modbus RTU specific config: serialPort, baudRate, etc.
    }

    connect() {
        console.log(`Modbus RTU device ${this.name} connecting (simulated).`);
        // Simulate connection
        setTimeout(() => this.updateStatus(true), 500);
    }

    disconnect() {
        console.log(`Modbus RTU device ${this.name} disconnected (simulated).`);
        this.updateStatus(false);
    }
}

class ModbusTcpDevice extends Device {
    constructor(config, socketIoInstance) {
        super(config);
        this.io = socketIoInstance;
        // Modbus TCP specific config: ipAddress, port, unitId, etc.
    }

    connect() {
        console.log(`Modbus TCP device ${this.name} connecting (simulated).`);
        // Simulate connection
        setTimeout(() => this.updateStatus(true), 500);
    }

    disconnect() {
        console.log(`Modbus TCP device ${this.name} disconnected (simulated).`);
        this.updateStatus(false);
    }
}


const activeDevices = new Map(); // Stores active device instances: deviceId -> DeviceObject

// Function to create and manage device instances
// socketIoInstance is the main Socket.IO server instance, passed from main.js
function initializeDevice(deviceConfig, socketIoInstance) {
    if (activeDevices.has(deviceConfig.id)) {
        console.log(`Device ${deviceConfig.name} already initialized.`);
        return activeDevices.get(deviceConfig.id);
    }

    let deviceInstance;
    switch (deviceConfig.type) {
        case 'mqtt':
            deviceInstance = new MqttDevice(deviceConfig, socketIoInstance);
            break;
        case 'modbus-rtu':
            deviceInstance = new ModbusRtuDevice(deviceConfig, socketIoInstance);
            break;
        case 'modbus-tcp':
            deviceInstance = new ModbusTcpDevice(deviceConfig, socketIoInstance);
            break;
        // Add cases for S7, OPC-UA, etc.
        default:
            console.error(`Unsupported device type: ${deviceConfig.type}`);
            return null;
    }

    if (deviceInstance) {
        activeDevices.set(deviceConfig.id, deviceInstance);
        deviceInstance.connect(); // Attempt to connect the device
    }
    return deviceInstance;
}

function getDeviceInstance(deviceId) {
    return activeDevices.get(deviceId);
}

function getAllDeviceInstances() {
    return Array.from(activeDevices.values());
}

function removeDevice(deviceId) {
    const device = activeDevices.get(deviceId);
    if (device) {
        device.disconnect();
        activeDevices.delete(deviceId);
        console.log(`Device ${deviceId} removed and disconnected.`);
    }
}

module.exports = {
    initializeDevice,
    getDeviceInstance,
    getAllDeviceInstances,
    removeDevice,
    // Potentially export device classes if needed elsewhere, though typically managed here
    // MqttDevice, ModbusRtuDevice, ModbusTcpDevice
};
