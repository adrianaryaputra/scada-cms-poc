// server/deviceHandler.js
const mqtt = require('mqtt'); // Import MQTT library

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
    // This will be triggered by the MQTT client's 'message' event for MqttDevice
    _handleIncomingData(topic, message) {
        console.log(`[${this.name}] Data received on topic '${topic}': ${message.toString()}`);
        if (this.io) {
            this.io.of('/devices').emit('device_data', {
                deviceId: this.id,
                address: topic, // Topic is the address for MQTT
                value: message.toString(), // Convert buffer to string
            });
        }
    }

    // Method to update connection status and emit an event via Socket.IO
    _updateStatusAndEmit(isConnected) {
        this.connected = isConnected;
        const statusMessage = `Device ${this.name} (${this.id}) status: ${this.connected ? 'Connected' : 'Disconnected'}`;
        console.log(statusMessage);
        if (this.io) {
            this.io.of('/devices').emit('device_status_update', {
                deviceId: this.id,
                name: this.name,
                connected: this.connected,
                type: this.type,
                timestamp: new Date().toISOString()
            });
             // Also emit to the general device_statuses for consistency with existing client logic
            this.io.of('/devices').emit('device_statuses', [{id: this.id, connected: this.connected}]);
        }
    }
}

class MqttDevice extends Device {
    constructor(config, socketIoInstance) {
        super(config);
        this.client = null;
        this.io = socketIoInstance;
        // Default topics to subscribe to. Can be expanded or made more dynamic.
        this.subscriptions = new Set();
        if (this.config.basepath) {
            this.subscriptions.add(`${this.config.basepath}/#`); // Subscribe to all under basepath
        } else {
            this.subscriptions.add(`hmi/${this.id}/#`); // Default device-specific wildcard
        }
        // Add more specific topics based on HMI component configuration if available globally
        // For example, by iterating through serverSideDeviceStore from socketHandler,
        // finding components linked to this device, and adding their addresses.
        // This part needs a more robust global state or event mechanism if topics are highly dynamic.
    }

    connect() {
        if (this.client && this.client.connected) {
            console.log(`[${this.name}] Already connected.`);
            return;
        }

        // Construct connection URL: protocol://host:port
        // The mqtt library handles ws, wss, mqtt, mqtts based on the URL prefix.
        const protocol = this.config.protocol || 'mqtt'; // Default to mqtt if not specified
        const connectUrl = `${protocol}://${this.config.host}:${this.config.port}`;

        const options = {
            clientId: this.config.clientId || `hmi_server_${this.id}_${Date.now()}`, // Ensure unique client ID
            username: this.config.username,
            password: this.config.password,
            clean: true, // Clean session
            connectTimeout: 4000, // Milliseconds
            reconnectPeriod: 1000, // Milliseconds, interval between two reconnections
                                   // Default is 1000. 0 to disable auto reconnect.
            // For SSL/TLS, the mqtt library uses properties like `ca`, `cert`, `key`, `rejectUnauthorized`
            // These would need to be added to deviceConfig if secure connection is needed.
            // For WSS, the URL protocol `wss://` should suffice.
        };

        console.log(`[${this.name}] Attempting to connect to MQTT broker at ${connectUrl}`);
        this.client = mqtt.connect(connectUrl, options);

        this.client.on('connect', () => {
            this._updateStatusAndEmit(true);
            this._subscribeToTopics();
        });

        this.client.on('error', (err) => {
            console.error(`[${this.name}] MQTT Connection Error:`, err.message);
            // The 'close' event will usually follow, which handles status update.
            // If not, ensure status is updated:
            if (!this.client.connected && this.connected) { // Check if status is desynced
                 this._updateStatusAndEmit(false);
            }
        });

        this.client.on('reconnect', () => {
            console.log(`[${this.name}] Reconnecting to MQTT broker...`);
            // Status is effectively disconnected during reconnect attempts
            if (this.connected) this._updateStatusAndEmit(false);
        });

        this.client.on('close', () => {
            console.log(`[${this.name}] MQTT connection closed.`);
            this._updateStatusAndEmit(false);
        });

        this.client.on('offline', () => {
            console.log(`[${this.name}] MQTT client offline.`);
            this._updateStatusAndEmit(false);
        });

        this.client.on('message', (topic, message) => {
            // message is Buffer, call superclass's method or handle here
            this._handleIncomingData(topic, message);
        });
    }

    _subscribeToTopics() {
        if (!this.client || !this.client.connected) {
            console.warn(`[${this.name}] Cannot subscribe, MQTT client not connected.`);
            return;
        }
        this.subscriptions.forEach(topic => {
            this.client.subscribe(topic, { qos: 0 }, (err) => { // QoS 0 for simplicity
                if (err) {
                    console.error(`[${this.name}] Failed to subscribe to ${topic}:`, err);
                } else {
                    console.log(`[${this.name}] Subscribed to ${topic}`);
                }
            });
        });
    }

    // Call this if subscription set changes while connected
    updateSubscriptions(newTopicsSet) {
        if (!this.client || !this.client.connected) return;

        const topicsToUnsub = new Set([...this.subscriptions].filter(x => !newTopicsSet.has(x)));
        const topicsToSub = new Set([...newTopicsSet].filter(x => !this.subscriptions.has(x)));

        topicsToUnsub.forEach(topic => {
            this.client.unsubscribe(topic, err => {
                if (err) console.error(`[${this.name}] Error unsubscribing from ${topic}:`, err);
                else console.log(`[${this.name}] Unsubscribed from ${topic}`);
            });
        });

        topicsToSub.forEach(topic => {
            this.client.subscribe(topic, { qos: 0 }, err => {
                if (err) console.error(`[${this.name}] Error subscribing to ${topic}:`, err);
                else console.log(`[${this.name}] Subscribed to ${topic}`);
            });
        });
        this.subscriptions = newTopicsSet;
    }


    disconnect() {
        if (this.client) {
            this.client.end(true, () => { // true for force, run callback once disconnected
                console.log(`[${this.name}] MQTT client disconnected successfully.`);
                this._updateStatusAndEmit(false); // Ensure status is updated after explicit disconnect
                this.client = null;
            });
        } else {
            this._updateStatusAndEmit(false); // Already disconnected or never connected
        }
    }

    writeData(address, value) {
        if (this.client && this.client.connected) {
            this.client.publish(address, String(value), { qos: 0, retain: false }, (err) => {
                if (err) {
                    console.error(`[${this.name}] MQTT publish error to ${address}:`, err);
                } else {
                    console.log(`[${this.name}] Published to ${address}: ${value}`);
                }
            });
        } else {
            console.warn(`[${this.name}] MQTT client not connected. Cannot write to ${address}.`);
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
