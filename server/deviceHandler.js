// server/deviceHandler.js
const mqtt = require('mqtt'); // Import MQTT library

// Helper function for MQTT topic matching (basic wildcard support)
// Supports '#' at the end and '+' in segments
function mqttWildcardMatch(topic, filter) {
    if (filter === '#') return true; // Matches everything
    if (filter === topic) return true;

    const topicSegments = topic.split('/');
    const filterSegments = filter.split('/');

    const T = topicSegments.length;
    const F = filterSegments.length;

    for (let i = 0; i < F; i++) {
        if (filterSegments[i] === '#') {
            // '#' must be the last char in filter and matches remaining segments
            // It matches if current filter segment is the last one
            // OR if the topic is longer or equal in length at this point.
            return i === filterSegments.length - 1;
        }
        if (i >= T) return false; // Topic is shorter than filter (and no #)

        if (filterSegments[i] !== '+' && filterSegments[i] !== topicSegments[i]) {
            return false; // Segments don't match and not a single-level wildcard
        }
    }
    return T === F; // If filter didn't end with #, lengths must match
}


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

    _emitDeviceDataToSocket(address, value) {
        if (this.io) {
            this.io.of('/devices').emit('device_data', {
                deviceId: this.id,
                address: address,
                value: value,
            });
        }
    }

    _emitVariableUpdateToSocket(variableName, value) {
        if (this.io) {
            this.io.of('/devices').emit('device_variable_update', {
                deviceId: this.id,
                variableName: variableName,
                value: value,
            });
        }
    }

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
            this.io.of('/devices').emit('device_statuses', [{id: this.id, connected: this.connected}]);
        }
    }
}

class MqttDevice extends Device {
    constructor(config, socketIoInstance) {
        super(config);
        this.io = socketIoInstance;
        this.client = null;
        this.variableValues = {};
        this.topicToVariableMap = new Map();
        this.temporarySubscriptions = new Map(); // socketId -> Set of subscribed filters (strings)
        this.config.variables = Array.isArray(this.config.variables) ? this.config.variables : [];
    }

    _getValueFromPath(obj, path) {
        if (!path) return obj;
        try {
            const keys = path.split('.');
            let result = obj;
            for (const key of keys) {
                if (result && typeof result === 'object' && key in result) {
                    result = result[key];
                } else {
                    return undefined;
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

        const protocol = this.config.protocol || 'mqtt';
        const connectUrl = `${protocol}://${this.config.host}:${this.config.port}`;
        const options = {
            clientId: this.config.clientId || `hmi_server_${this.id}_${Date.now()}`,
            username: this.config.username,
            password: this.config.password,
            clean: true,
            connectTimeout: 4000,
            reconnectPeriod: 1000,
        };

        console.log(`[${this.name}] Attempting to connect to MQTT broker at ${connectUrl}`);
        this.client = mqtt.connect(connectUrl, options);

        this.client.on('connect', () => {
            this._updateStatusAndEmit(true);
            this._initializeVariableSubscriptions();
            this._resubscribeTemporaryTopics();
        });

        this.client.on('error', (err) => {
            console.error(`[${this.name}] MQTT Connection Error:`, err.message);
            if (this.client && !this.client.connected && this.connected) {
                 this._updateStatusAndEmit(false);
            }
        });

        this.client.on('reconnect', () => {
            console.log(`[${this.name}] Reconnecting to MQTT broker...`);
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

        // Di dalam MqttDevice class, method connect(), this.client.on('message', ...)
        this.client.on('message', (topic, messageBuffer) => {
            const messageString = messageBuffer.toString();
            console.log(`[${this.name}] RAW MESSAGE RECEIVED: Topic: ${topic}, Message: ${messageString}`); // LOG 1
            let relayedAsTempSub = false;

            const socketIds = Array.from(this.temporarySubscriptions.keys());
            console.log(`[${this.name}] Current temporary subscriber socket IDs:`, socketIds); // LOG 2

            // ... (sebelum loop for const socketId ...)
            console.log(`[${this.name}] All connected socket IDs on server:`, Array.from(this.io.sockets.sockets.keys())); // LOG BARU
            // ... (lanjutkan dengan loop for const socketId ...)

            for (const socketId of socketIds) {
                const subscribedFilters = this.temporarySubscriptions.get(socketId);
                if (!subscribedFilters) {
                    console.log(`[${this.name}] No filters found for socketId ${socketId}, skipping.`); // LOG 3
                    continue;
                }
                console.log(`[${this.name}] SocketId ${socketId} has filters:`, Array.from(subscribedFilters)); // LOG 4

                const deviceNamespaceInstance = this.io.of('/devices');
                const socketClient = deviceNamespaceInstance && deviceNamespaceInstance.sockets && deviceNamespaceInstance.sockets.get(socketId);
                if (!socketClient) {
                    console.log(`[${this.name}] SocketId ${socketId} NOT CONNECTED. Cleaning up its filters.`); // LOG 5
                    // ... (logika cleanup seperti yang sudah ada) ...
                    const filtersToRemove = Array.from(subscribedFilters);
                    filtersToRemove.forEach(filter => {
                        subscribedFilters.delete(filter);
                        if (!this._isFilterNeeded(filter)) {
                            if (this.client && this.client.connected) {
                                this.client.unsubscribe(filter, (err) => {
                                    if (err) console.error(`[${this.name}] Error unsubscribing from temp filter ${filter} after socket ${socketId} disconnect:`, err);
                                    else console.log(`[${this.name}] Unsubscribed from temp filter ${filter} after socket ${socketId} disconnect.`);
                                });
                            }
                        }
                    });
                    if (subscribedFilters.size === 0) {
                        this.temporarySubscriptions.delete(socketId);
                    }
                    continue;
                }

                console.log(`[${this.name}] SocketId ${socketId} IS CONNECTED. Checking its filters against topic: ${topic}`); // LOG 6
                Array.from(subscribedFilters).forEach(filter => {
                    console.log(`[${this.name}]   Checking filter: '${filter}' against topic: '${topic}'`); // LOG 7
                    if (mqttWildcardMatch(topic, filter)) {
                        console.log(`[${this.name}]   MATCH! Filter '${filter}' matches topic '${topic}'. Emitting server_temp_message to socket ${socketId}.`); // LOG 8
                        relayedAsTempSub = true;
                        socketClient.emit('server_temp_message', {
                            deviceId: this.id,
                            topic: topic,
                            filter: filter,
                            payloadString: messageString,
                        });
                    } else {
                        console.log(`[${this.name}]   NO MATCH for filter: '${filter}'`); // LOG 9
                    }
                });
            }

            if (relayedAsTempSub) {
                console.log(`[${this.name}] Message was relayed as temp sub. Is it also a variable? ${this.topicToVariableMap.has(topic)}`); // LOG 10
                if (!this.topicToVariableMap.has(topic)) {
                    return;
                }
            }

            const variableConfig = this.topicToVariableMap.get(topic);
            if (variableConfig) {
                console.log(`[${this.name}] Processing as variable: ${variableConfig.name}`); // LOG 11
                // ... (sisa logika variabel) ...
            } else if (!relayedAsTempSub) {
                console.log(`[${this.name}] Message NOT relayed as temp sub AND not a variable. Final unmapped log for topic '${topic}'.`); // LOG 12
            }
        });
    }

    _isFilterNeeded(filterToCheck) { // Checks if a specific filter string is needed by any subscription
        // Check persistent variable subscriptions (exact match)
        if (this.topicToVariableMap.has(filterToCheck)) return true;

        // Check other temporary subscriptions
        for (const socketFilters of this.temporarySubscriptions.values()) {
            if (socketFilters.has(filterToCheck)) return true;
        }
        return false;
    }

    _initializeVariableSubscriptions() {
        if (!this.client || !this.client.connected) {
            console.warn(`[${this.name}] Cannot initialize variable subscriptions, MQTT client not connected.`);
            return;
        }
        this.topicToVariableMap.clear();

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
        this.temporarySubscriptions.forEach((filters, socketId) => { // Changed 'topics' to 'filters' for clarity
            filters.forEach(filter => { // Changed 'topic' to 'filter'
                console.log(`[${this.name}] Re-subscribing to temporary filter ${filter} for socket ${socketId}`);
                this.client.subscribe(filter, { qos: 0 }, (err) => {
                    if (err) console.error(`[${this.name}] Error re-subscribing to temp filter ${filter}:`, err);
                });
            });
        });
    }

    updateVariableDefinitions(newVariablesArray) {
        if (!this.client || !this.client.connected) {
            console.warn(`[${this.name}] Client not connected. Deferring variable definition update.`);
            this.config.variables = Array.isArray(newVariablesArray) ? newVariablesArray : [];
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
            // Use _isFilterNeeded to check if the exact oldTopic is used by any temp sub
            if (!newTopicsToSubscribe.has(oldTopic) && !this._isFilterNeeded(oldTopic)) {
                this.client.unsubscribe(oldTopic, err => {
                    if (err) console.error(`[${this.name}] Error unsubscribing from old variable topic ${oldTopic}:`, err);
                    else console.log(`[${this.name}] Unsubscribed from old variable topic ${oldTopic}`);
                });
            }
        });

        newTopicsToSubscribe.forEach(newTopic => {
            if (!oldTopicToVarMap.has(newTopic)) {
                const variable = this.topicToVariableMap.get(newTopic);
                const qos = typeof variable.qosSubscribe === 'number' ? variable.qosSubscribe : 0;
                this.client.subscribe(newTopic, { qos }, (err) => {
                    if (err) console.error(`[${this.name}] Failed to subscribe to new/updated variable topic ${newTopic}:`, err);
                    else console.log(`[${this.name}] Subscribed to new/updated variable topic ${newTopic} for var '${variable.name}'`);
                });
            }
        });
    }

    handleTemporarySubscribe(filterToSubscribe, socketId) { // Changed 'topic' to 'filterToSubscribe'
        if (!this.client || !this.client.connected) {
            console.warn(`[${this.name}] MQTT client not connected. Cannot handle temporary subscribe for ${filterToSubscribe}.`);
            return;
        }
        console.log(`[${this.name}] Socket ${socketId} requests temporary subscription to filter ${filterToSubscribe}`);
        if (!this.temporarySubscriptions.has(socketId)) {
            this.temporarySubscriptions.set(socketId, new Set());
        }
        const clientSubscribedFilters = this.temporarySubscriptions.get(socketId);

        // Check if this exact filter is already subscribed by any means (another temp client or a variable)
        const isAlreadyGloballySubscribed = this._isFilterNeeded(filterToSubscribe);

        if (!isAlreadyGloballySubscribed) {
             this.client.subscribe(filterToSubscribe, { qos: 0 }, (err) => {
                if (err) {
                    console.error(`[${this.name}] Error subscribing to temporary filter ${filterToSubscribe}:`, err);
                } else {
                    console.log(`[${this.name}] Subscribed to temporary filter ${filterToSubscribe} for socket ${socketId}`);
                }
            });
        } else {
             console.log(`[${this.name}] Filter ${filterToSubscribe} already subscribed by this or another client/variable. Adding to socket ${socketId}'s list.`);
        }
        clientSubscribedFilters.add(filterToSubscribe); // Add the filter to this socket's list
    }

    // _isTopicNeededByOthersForTemp is effectively replaced by checking _isFilterNeeded globally
    // and then seeing if the current socket is the only one holding it.
    // Keeping the old one for now if it's used elsewhere, but its direct use in handleTemporarySubscribe isn't ideal.

    handleTemporaryUnsubscribe(filterToUnsubscribe, socketId) { // Changed 'topic' to 'filterToUnsubscribe'
        console.log(`[${this.name}] Socket ${socketId} requests temporary unsubscribe from filter ${filterToUnsubscribe}`);
        const clientSubscribedFilters = this.temporarySubscriptions.get(socketId);
        if (clientSubscribedFilters) {
            clientSubscribedFilters.delete(filterToUnsubscribe);
            if (clientSubscribedFilters.size === 0) {
                this.temporarySubscriptions.delete(socketId);
            }
        }

        // Unsubscribe from broker only if no other socket needs this temp filter AND it's not a persistent variable topic
        if (!this._isFilterNeeded(filterToUnsubscribe)) {
            if (this.client && this.client.connected) {
                this.client.unsubscribe(filterToUnsubscribe, (err) => {
                    if (err) console.error(`[${this.name}] Error unsubscribing from temporary filter ${filterToUnsubscribe}:`, err);
                    else console.log(`[${this.name}] Unsubscribed from temporary filter ${filterToUnsubscribe}`);
                });
            }
        }
    }

    _unsubscribeAllTopics() { // This name is fine, it unsubscribes all stored filters/topics
        if (!this.client || (!this.client.connected && !this.client.disconnecting)) {
            this.topicToVariableMap.clear();
            this.temporarySubscriptions.forEach(filters => filters.clear());
            this.temporarySubscriptions.clear();
            return Promise.resolve();
        }

        const filtersToUnsubscribe = new Set();
        this.topicToVariableMap.forEach((varConfig, topic) => filtersToUnsubscribe.add(topic)); // These are exact topics
        this.temporarySubscriptions.forEach(socketFilters => {
            socketFilters.forEach(filter => filtersToUnsubscribe.add(filter)); // These can be wildcards
        });

        const unsubscribePromises = [];
        filtersToUnsubscribe.forEach(filter => {
            unsubscribePromises.push(new Promise((resolve, reject) => {
                this.client.unsubscribe(filter, (err) => {
                    if (err) {
                        console.error(`[${this.name}] Error unsubscribing from ${filter} during disconnect:`, err);
                        reject(err);
                    } else {
                        console.log(`[${this.name}] Unsubscribed from ${filter} during disconnect.`);
                        resolve();
                    }
                });
            }));
        });

        this.topicToVariableMap.clear();
        this.temporarySubscriptions.forEach(filters => filters.clear());
        this.temporarySubscriptions.clear();

        return Promise.allSettled(unsubscribePromises);
    }

    async disconnect() {
        if (this.client) {
            console.log(`[${this.name}] Disconnecting MQTT client...`);
            await this._unsubscribeAllTopics();
            this.client.end(true, () => {
                console.log(`[${this.name}] MQTT client disconnected successfully.`);
                this._updateStatusAndEmit(false);
                this.client = null;
            });
        } else {
            this._updateStatusAndEmit(false);
        }
    }

    writeVariable(variableName, value) {
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
    }

    connect() {
        console.log(`Modbus RTU device ${this.name} connecting (simulated).`);
        setTimeout(() => this._updateStatusAndEmit(true), 500);
    }

    disconnect() {
        console.log(`Modbus RTU device ${this.name} disconnected (simulated).`);
        this._updateStatusAndEmit(false);
    }
}

class ModbusTcpDevice extends Device {
    constructor(config, socketIoInstance) {
        super(config);
        this.io = socketIoInstance;
    }

    connect() {
        console.log(`Modbus TCP device ${this.name} connecting (simulated).`);
        setTimeout(() => this._updateStatusAndEmit(true), 500);
    }

    disconnect() {
        console.log(`Modbus TCP device ${this.name} disconnected (simulated).`);
        this._updateStatusAndEmit(false);
    }
}


const activeDevices = new Map();

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
        default:
            console.error(`Unsupported device type: ${deviceConfig.type}`);
            return null;
    }

    if (deviceInstance) {
        activeDevices.set(deviceConfig.id, deviceInstance);
        deviceInstance.connect();
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
};
