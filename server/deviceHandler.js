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
    // Specific devices should implement how they handle incoming data if they need to map it
    // or can call a generic emitter like below.
    _emitDeviceDataToSocket(address, value) {
        // console.log(`[${this.name}] Emitting device data: Addr=${address}, Val=${value}`);
        if (this.io) {
            this.io.of('/devices').emit('device_data', { // This is the old generic event
                deviceId: this.id,
                address: address,
                value: value,
            });
        }
    }

    _emitVariableUpdateToSocket(variableName, value) {
        // console.log(`[${this.name}] Emitting variable update: Var=${variableName}, Val=${value}`);
        if (this.io) {
            this.io.of('/devices').emit('device_variable_update', {
                deviceId: this.id,
                variableName: variableName,
                value: value,
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
        super(config); // Base class constructor handles this.id, this.name, this.type, this.config, this.connected
        this.io = socketIoInstance; // Socket.IO instance for emitting data
        this.client = null;         // MQTT client instance

        this.variableValues = {}; // Stores current values of device variables { varName: value }
        this.topicToVariableMap = new Map(); // Maps subscribed topic string to variable config object
        this.temporarySubscriptions = new Map(); // Maps socketId to a Set of topics for temporary UI subscriptions

        // Ensure variables array exists in config
        this.config.variables = Array.isArray(this.config.variables) ? this.config.variables : [];
    }

    // Helper to extract value using basic dot notation
    _getValueFromPath(obj, path) {
        if (!path) return obj;
        try {
            const keys = path.split('.');
            let result = obj;
            for (const key of keys) {
                if (result && typeof result === 'object' && key in result) {
                    result = result[key];
                } else {
                    return undefined; // Path not found or invalid
                }
            }
            return result;
        } catch (e) {
            console.warn(`[${this.name}] Error accessing path "${path}" in object:`, obj, e);
            return undefined;
        }
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
            this._initializeVariableSubscriptions(); // Subscribe to defined variables
            this._resubscribeTemporaryTopics(); // Resubscribe any temporary topics
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

        this.client.on('message', (topic, messageBuffer) => {
            const messageString = messageBuffer.toString();

            // Check if it's a temporary subscription message
            let isTempSub = false;
            this.temporarySubscriptions.forEach((topics, socketId) => {
                if (topics.has(topic)) {
                    isTempSub = true;
                    if (this.io && this.io.sockets.sockets.get(socketId)) { // Check if socket still connected
                        this.io.to(socketId).emit('server_temp_message', {
                            deviceId: this.id,
                            topic: topic,
                            payloadString: messageString,
                        });
                         console.log(`[${this.name}] Relayed temp message on topic '${topic}' to socket ${socketId}`);
                    } else { // Socket disconnected, clean up its temp subs for this topic
                        topics.delete(topic);
                        if (topics.size === 0) {
                            this.temporarySubscriptions.delete(socketId);
                        }
                         // Check if this topic is still needed by other temp subs or persistent subs
                        if (!this._isTopicNeeded(topic)) {
                            this.client.unsubscribe(topic, (err) => {
                                if (err) console.error(`[${this.name}] Error unsubscribing from temp topic ${topic} after socket disconnect:`, err);
                                else console.log(`[${this.name}] Unsubscribed from temp topic ${topic} after socket disconnect.`);
                            });
                        }
                    }
                }
            });

            if (isTempSub && !this.topicToVariableMap.has(topic)) { // If only temp sub, don't process as variable
                return;
            }

            // Handle as a device variable message
            const variableConfig = this.topicToVariableMap.get(topic);
            if (variableConfig) {
                let valueToStore = messageString;
                try {
                    const jsonData = JSON.parse(messageString);
                    if (variableConfig.jsonPathSubscribe) {
                        valueToStore = this._getValueFromPath(jsonData, variableConfig.jsonPathSubscribe);
                        if (valueToStore === undefined) {
                             console.warn(`[${this.name}] JSONPath "${variableConfig.jsonPathSubscribe}" yielded undefined for topic ${topic}. Raw JSON:`, jsonData);
                             // Decide if you want to store raw JSON or nothing. For now, let's try storing raw if path fails.
                             valueToStore = jsonData;
                        }
                    } else {
                        valueToStore = jsonData; // Store the whole JSON object if no path
                    }
                } catch (e) {
                    // Not a JSON object, or error in parsing. Keep as string.
                    // console.log(`[${this.name}] Message on topic ${topic} is not JSON or path error. Storing as string.`);
                }

                this.variableValues[variableConfig.name] = valueToStore;
                this._emitVariableUpdateToSocket(variableConfig.name, valueToStore);
                // Optionally, also emit to the old generic 'device_data' if some components still use it by raw topic
                // this._emitDeviceDataToSocket(topic, valueToStore);
            } else if (!isTempSub) { // Not a temp sub and not in variable map
                 console.log(`[${this.name}] Received message on unmapped topic '${topic}': ${messageString}. This might be from a broader subscription like basepath/#.`);
                 // Decide if you want to emit these to a general 'device_data' event
                 // this._emitDeviceDataToSocket(topic, messageString);
            }
        });
    }

    _isTopicNeeded(topic) {
        // Check persistent variable subscriptions
        if (this.topicToVariableMap.has(topic)) return true;
        // Check other temporary subscriptions
        for (const topics of this.temporarySubscriptions.values()) {
            if (topics.has(topic)) return true;
        }
        return false;
    }

    _initializeVariableSubscriptions() {
        if (!this.client || !this.client.connected) {
            console.warn(`[${this.name}] Cannot initialize variable subscriptions, MQTT client not connected.`);
            return;
        }
        this.topicToVariableMap.clear(); // Clear previous mappings

        this.config.variables.forEach(variable => {
            if (variable.enableSubscribe && variable.subscribeTopic) {
                this.topicToVariableMap.set(variable.subscribeTopic, variable);
                const qos = typeof variable.qosSubscribe === 'number' ? variable.qosSubscribe : 0;
                this.client.subscribe(variable.subscribeTopic, { qos }, (err) => {
                    if (err) {
                        console.error(`[${this.name}] Failed to subscribe to variable topic ${variable.subscribeTopic}:`, err);
                    } else {
                        console.log(`[${this.name}] Subscribed to variable topic ${variable.subscribeTopic} for var '${variable.name}'`);
                    }
                });
            }
        });
    }

    _resubscribeTemporaryTopics() {
        if (!this.client || !this.client.connected) return;
        this.temporarySubscriptions.forEach((topics, socketId) => {
            topics.forEach(topic => {
                console.log(`[${this.name}] Re-subscribing to temporary topic ${topic} for socket ${socketId}`);
                this.client.subscribe(topic, { qos: 0 }, (err) => { // Assuming QoS 0 for temp subs
                    if (err) console.error(`[${this.name}] Error re-subscribing to temp topic ${topic}:`, err);
                });
            });
        });
    }

    // This method might be called if the device's variable configuration changes externally
    updateVariableDefinitions(newVariablesArray) {
        if (!this.client || !this.client.connected) {
            console.warn(`[${this.name}] Client not connected. Deferring variable definition update.`);
            this.config.variables = Array.isArray(newVariablesArray) ? newVariablesArray : [];
            // Subscriptions will be handled on next connect.
            return;
        }

        const oldTopicToVarMap = new Map(this.topicToVariableMap);
        this.config.variables = Array.isArray(newVariablesArray) ? newVariablesArray : [];
        this.topicToVariableMap.clear();

        const newTopicsToSubscribe = new Set();
        this.config.variables.forEach(variable => {
            if (variable.enableSubscribe && variable.subscribeTopic) {
                newTopicsToSubscribe.add(variable.subscribeTopic);
                this.topicToVariableMap.set(variable.subscribeTopic, variable);
            }
        });

        oldTopicToVarMap.forEach((oldVar, oldTopic) => {
            if (!newTopicsToSubscribe.has(oldTopic) && !this._isTopicNeeded(oldTopic)) { // Also check against temp subs
                this.client.unsubscribe(oldTopic, err => {
                    if (err) console.error(`[${this.name}] Error unsubscribing from old variable topic ${oldTopic}:`, err);
                    else console.log(`[${this.name}] Unsubscribed from old variable topic ${oldTopic}`);
                });
            }
        });

        newTopicsToSubscribe.forEach(newTopic => {
            if (!oldTopicToVarMap.has(newTopic)) { // Only subscribe if it's genuinely new or qos changed
                const variable = this.topicToVariableMap.get(newTopic); // Should exist
                const qos = typeof variable.qosSubscribe === 'number' ? variable.qosSubscribe : 0;
                this.client.subscribe(newTopic, { qos }, (err) => {
                    if (err) console.error(`[${this.name}] Failed to subscribe to new/updated variable topic ${newTopic}:`, err);
                    else console.log(`[${this.name}] Subscribed to new/updated variable topic ${newTopic} for var '${variable.name}'`);
                });
            }
            // TODO: Handle QoS changes for existing subscriptions if necessary (unsub then resub with new QoS)
        });
    }

    handleTemporarySubscribe(topic, socketId) {
        if (!this.client || !this.client.connected) {
            console.warn(`[${this.name}] MQTT client not connected. Cannot handle temporary subscribe for ${topic}.`);
            // Optionally, queue it or inform the client. For now, just log.
            return;
        }
        console.log(`[${this.name}] Socket ${socketId} requests temporary subscription to ${topic}`);
        if (!this.temporarySubscriptions.has(socketId)) {
            this.temporarySubscriptions.set(socketId, new Set());
        }
        const clientTopics = this.temporarySubscriptions.get(socketId);

        // Subscribe only if this topic isn't already covered by persistent or other temp subs
        const alreadySubscribedByClient = this.topicToVariableMap.has(topic) || this._isTopicNeededByOthersForTemp(topic, socketId);

        if (!alreadySubscribedByClient) {
             this.client.subscribe(topic, { qos: 0 }, (err) => { // Assuming QoS 0 for temp subs
                if (err) {
                    console.error(`[${this.name}] Error subscribing to temporary topic ${topic}:`, err);
                } else {
                    console.log(`[${this.name}] Subscribed to temporary topic ${topic} for socket ${socketId}`);
                }
            });
        } else {
             console.log(`[${this.name}] Topic ${topic} already subscribed (persistently or by other temp). Adding to socket ${socketId}'s list.`);
        }
        clientTopics.add(topic);
    }

     _isTopicNeededByOthersForTemp(topic, requestingSocketId) {
        for (const [socketId, topics] of this.temporarySubscriptions.entries()) {
            if (socketId !== requestingSocketId && topics.has(topic)) {
                return true;
            }
        }
        return false;
    }

    handleTemporaryUnsubscribe(topic, socketId) {
        console.log(`[${this.name}] Socket ${socketId} requests temporary unsubscribe from ${topic}`);
        const clientTopics = this.temporarySubscriptions.get(socketId);
        if (clientTopics) {
            clientTopics.delete(topic);
            if (clientTopics.size === 0) {
                this.temporarySubscriptions.delete(socketId);
            }
        }

        // Unsubscribe from broker only if no other socket needs this temp topic AND it's not a persistent variable topic
        if (!this._isTopicNeeded(topic)) {
            if (this.client && this.client.connected) {
                this.client.unsubscribe(topic, (err) => {
                    if (err) console.error(`[${this.name}] Error unsubscribing from temporary topic ${topic}:`, err);
                    else console.log(`[${this.name}] Unsubscribed from temporary topic ${topic}`);
                });
            }
        }
    }

    _unsubscribeAllTopics() {
        if (!this.client || (!this.client.connected && !this.client.disconnecting)) {
            // If not connected and not in the process of disconnecting, can't send unsubscribe.
            // Clearing local maps is still useful.
            this.topicToVariableMap.clear();
            this.temporarySubscriptions.forEach(topics => topics.clear());
            this.temporarySubscriptions.clear();
            return Promise.resolve();
        }

        const topicsToUnsubscribe = new Set();
        this.topicToVariableMap.forEach((varConfig, topic) => topicsToUnsubscribe.add(topic));
        this.temporarySubscriptions.forEach(socketTopics => {
            socketTopics.forEach(topic => topicsToUnsubscribe.add(topic));
        });

        const unsubscribePromises = [];
        topicsToUnsubscribe.forEach(topic => {
            unsubscribePromises.push(new Promise((resolve, reject) => {
                this.client.unsubscribe(topic, (err) => {
                    if (err) {
                        console.error(`[${this.name}] Error unsubscribing from ${topic} during disconnect:`, err);
                        reject(err); // Or resolve to not block others
                    } else {
                        console.log(`[${this.name}] Unsubscribed from ${topic} during disconnect.`);
                        resolve();
                    }
                });
            }));
        });

        this.topicToVariableMap.clear();
        this.temporarySubscriptions.forEach(topics => topics.clear());
        this.temporarySubscriptions.clear();

        return Promise.allSettled(unsubscribePromises);
    }


    async disconnect() {
        if (this.client) {
            console.log(`[${this.name}] Disconnecting MQTT client...`);
            await this._unsubscribeAllTopics(); // Wait for unsubscriptions
            this.client.end(true, () => {
                console.log(`[${this.name}] MQTT client disconnected successfully.`);
                this._updateStatusAndEmit(false);
                this.client = null;
            });
        } else {
            this._updateStatusAndEmit(false);
        }
    }

    writeVariable(variableName, value) { // Renamed from writeData
        const variableConfig = this.config.variables.find(v => v.name === variableName);
        if (!variableConfig) {
            console.warn(`[${this.name}] Variable '${variableName}' not defined. Cannot write.`);
            return;
        }
        if (!variableConfig.enablePublish || !variableConfig.publishTopic) {
            console.warn(`[${this.name}] Publishing not enabled or no publish topic for variable '${variableName}'.`);
            return;
        }

        if (this.client && this.client.connected) {
            const qos = typeof variableConfig.qosPublish === 'number' ? variableConfig.qosPublish : 0;
            const retain = typeof variableConfig.retainPublish === 'boolean' ? variableConfig.retainPublish : false;
            this.client.publish(variableConfig.publishTopic, String(value), { qos, retain }, (err) => {
                if (err) {
                    console.error(`[${this.name}] MQTT publish error to ${variableConfig.publishTopic} for var '${variableName}':`, err);
                } else {
                    console.log(`[${this.name}] Published to ${variableConfig.publishTopic} for var '${variableName}': ${value}`);
                }
            });
        } else {
            console.warn(`[${this.name}] MQTT client not connected. Cannot write variable '${variableName}'.`);
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
