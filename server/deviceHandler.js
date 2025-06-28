// server/deviceHandler.js
const mqtt = require('mqtt'); // Import MQTT library

// Helper function for MQTT topic matching (basic wildcard support)
// Supports '#' (multi-level) at the end and '+' (single-level) in segments.
function mqttWildcardMatch(topic, filter) {
    if (filter === '#') return true; // Wildcard '#' matches everything.
    if (filter === topic) return true; // Exact match.

    const topicSegments = topic.split('/');
    const filterSegments = filter.split('/');

    const topicSegmentsLength = topicSegments.length;
    const filterSegmentsLength = filterSegments.length;

    for (let i = 0; i < filterSegmentsLength; i++) {
        const filterSegment = filterSegments[i];

        if (filterSegment === '#') {
            // '#' wildcard must be the last character in the filter.
            // It matches all remaining levels in the topic.
            return i === filterSegmentsLength - 1;
        }

        // If filter is longer than topic (and not ended with '#'), no match.
        if (i >= topicSegmentsLength) return false;

        const topicSegment = topicSegments[i];
        if (filterSegment !== '+' && filterSegment !== topicSegment) {
            // Segments don't match, and filter segment is not a single-level wildcard '+'.
            return false;
        }
    }

    // If the filter didn't end with '#', topic and filter must have the same number of segments.
    return topicSegmentsLength === filterSegmentsLength;
}


// Base class/interface for all device types
class Device {
    constructor(config) {
        this.id = config.id;
        this.name = config.name;
        this.type = config.type;
        this.config = config; // Store the full configuration
        this.connected = false;
        // this.io is expected to be set by subclasses if they need to emit directly
    }

    connect() {
        throw new Error("Connect method must be implemented by subclasses");
    }

    disconnect() {
        throw new Error("Disconnect method must be implemented by subclasses");
    }

    readData() {
        // To be implemented by specific device types if they support polling
        console.warn(`[${this.name}] Read data not implemented for type ${this.type}`);
    }

    writeData(address, value) {
        // To be implemented by specific device types
        console.warn(`[${this.name}] Write data not implemented for type ${this.type}`);
    }

    // Helper to emit generic device data (e.g., from polled devices)
    _emitDeviceDataToSocket(address, value) {
        if (this.io) {
            this.io.of('/devices').emit('device_data', {
                deviceId: this.id,
                address: address, // Could be a register, a generic topic part, etc.
                value: value,
                timestamp: new Date().toISOString()
            });
        }
    }

    // Helper to emit updates for named variables (common for MQTT)
    _emitVariableUpdateToSocket(variableName, value) {
        if (this.io) {
            this.io.of('/devices').emit('device_variable_update', {
                deviceId: this.id,
                variableName: variableName,
                value: value,
                timestamp: new Date().toISOString()
            });
        }
    }

    _updateStatusAndEmit(isConnected) {
        this.connected = isConnected;
        // const statusMessage = `Device ${this.name} (${this.id}) status: ${this.connected ? 'Connected' : 'Disconnected'}`;
        // console.log(statusMessage); // Logging handled by connect/disconnect messages or higher levels.
        if (this.io) {
            this.io.of('/devices').emit('device_status_update', {
                deviceId: this.id,
                name: this.name,
                connected: this.connected,
                type: this.type,
                timestamp: new Date().toISOString()
            });
            // Also emit to the 'device_statuses' event for a more general update
            this.io.of('/devices').emit('device_statuses', [{ id: this.id, name: this.name, type: this.type, connected: this.connected }]);
        }
    }
}

class MqttDevice extends Device {
    constructor(config, socketIoInstance) {
        super(config);
        this.io = socketIoInstance; // Socket.IO instance for emitting updates
        this.client = null; // MQTT client instance
        this.topicToVariableMap = new Map(); // Maps subscribed topics to variable configurations
        this.temporarySubscriptions = new Map(); // Maps socketId to a Set of subscribed filters (topics/wildcards)
        this.config.variables = Array.isArray(this.config.variables) ? this.config.variables : [];
    }

    _getValueFromPath(obj, path) {
        if (!path || typeof path !== 'string') return obj;
        try {
            const keys = path.split('.');
            let result = obj;
            for (const key of keys) {
                if (result && typeof result === 'object' && key in result) {
                    result = result[key];
                } else {
                    return undefined; // Path not found
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
            // console.log(`[${this.name}] Already connected to MQTT broker.`);
            return;
        }

        const protocol = this.config.protocol || 'mqtt';
        const connectUrl = `${protocol}://${this.config.host}:${this.config.port}`;
        const options = {
            clientId: this.config.clientId || `hmi_server_${this.id.substring(0,8)}_${Date.now()}`,
            username: this.config.username,
            password: this.config.password,
            clean: true, // Clean session
            connectTimeout: this.config.connectTimeout || 4000, // ms
            reconnectPeriod: this.config.reconnectPeriod || 1000, // ms
        };

        // console.log(`[${this.name}] Attempting to connect to MQTT broker at ${connectUrl}`);
        this.client = mqtt.connect(connectUrl, options);

        this.client.on('connect', () => {
            // console.log(`[${this.name}] Successfully connected to MQTT broker.`);
            this._updateStatusAndEmit(true);
            this._initializeVariableSubscriptions();
            this._resubscribeTemporaryTopics(); // Resubscribe for any pre-existing temp subscriptions (e.g., server restart)
        });

        this.client.on('error', (err) => {
            console.error(`[${this.name}] MQTT Connection Error: ${err.message}`);
            if (this.client && !this.client.connected && this.connected) { // If was connected, now error means disconnected
                 this._updateStatusAndEmit(false);
            }
        });

        this.client.on('reconnect', () => {
            // console.log(`[${this.name}] Reconnecting to MQTT broker...`);
            if (this.connected) this._updateStatusAndEmit(false); // Mark as disconnected during reconnect attempts
        });

        this.client.on('close', () => {
            // console.log(`[${this.name}] MQTT connection closed.`);
            if (this.connected) this._updateStatusAndEmit(false);
        });

        this.client.on('offline', () => {
            // console.log(`[${this.name}] MQTT client offline.`);
            if (this.connected) this._updateStatusAndEmit(false);
        });

        this.client.on('message', (topic, messageBuffer) => {
            const messageString = messageBuffer.toString();
            // console.debug(`[${this.name}] Raw MQTT message received - Topic: ${topic}, Message: ${messageString}`);

            let relayedToTemp = this._processTemporarySubscriptions(topic, messageString);
            this._processVariableSubscriptions(topic, messageString, relayedToTemp);
        });
    }

    _processTemporarySubscriptions(topic, messageString) {
        let relayedToAnySocket = false;
        const socketIdsForCleanup = [];

        this.temporarySubscriptions.forEach((subscribedFilters, socketId) => {
            const deviceNamespace = this.io.of('/devices');
            const socketClient = deviceNamespace && deviceNamespace.sockets && deviceNamespace.sockets.get(socketId);

            if (!socketClient) {
                // console.log(`[${this.name}] SocketId ${socketId} for temp subs not connected. Marking for cleanup.`);
                socketIdsForCleanup.push(socketId);
                return; // Skip processing for this disconnected socket
            }

            subscribedFilters.forEach(filter => {
                if (mqttWildcardMatch(topic, filter)) {
                    // console.debug(`[${this.name}] Temp sub match: Topic '${topic}' with filter '${filter}' for socket ${socketId}.`);
                    socketClient.emit('server_temp_message', {
                        deviceId: this.id,
                        topic: topic,
                        filter: filter, // Let client know which filter matched
                        payloadString: messageString,
                        timestamp: new Date().toISOString()
                    });
                    relayedToAnySocket = true;
                }
            });
        });

        // Cleanup subscriptions for disconnected sockets
        socketIdsForCleanup.forEach(socketId => {
            this._clearTemporarySubscriptionsForSocket(socketId);
        });

        return relayedToAnySocket;
    }

    _processVariableSubscriptions(topic, messageString, relayedAsTempSub) {
        const variableConfig = this.topicToVariableMap.get(topic);
        if (variableConfig) {
            // console.debug(`[${this.name}] Variable sub match: Topic '${topic}' for var '${variableConfig.name}'.`);
            let value = messageString;
            if (variableConfig.jsonPath) {
                try {
                    const messageObject = JSON.parse(messageString);
                    value = this._getValueFromPath(messageObject, variableConfig.jsonPath);
                } catch (e) {
                    console.warn(`[${this.name}] Failed to parse JSON or extract path for var '${variableConfig.name}': ${e.message}`);
                    return; // Skip update if parsing/extraction fails
                }
            }
            // Potentially transform or validate value here based on variableConfig
            this._emitVariableUpdateToSocket(variableConfig.name, value);

        } else if (!relayedAsTempSub) {
            // console.debug(`[${this.name}] Message on topic '${topic}' did not match any variable or active temporary subscription.`);
        }
    }

    _clearTemporarySubscriptionsForSocket(socketId) {
        const subscribedFilters = this.temporarySubscriptions.get(socketId);
        if (subscribedFilters) {
            // console.log(`[${this.name}] Cleaning up temporary subscriptions for disconnected socket ${socketId}.`);
            subscribedFilters.forEach(filter => {
                // We must check if this filter is still needed by other sockets or variables
                // before actually unsubscribing from the MQTT broker.
                // The handleTemporaryUnsubscribe logic already does this check.
                this.handleTemporaryUnsubscribe(filter, socketId, true); // isDisconnecting = true
            });
            this.temporarySubscriptions.delete(socketId);
        }
    }


    _isFilterNeeded(filterToCheck, excludingSocketId = null) {
        // Check persistent variable subscriptions (exact match for topics)
        if (this.topicToVariableMap.has(filterToCheck)) return true;

        // Check other temporary subscriptions
        for (const [socketId, socketFilters] of this.temporarySubscriptions.entries()) {
            if (excludingSocketId && socketId === excludingSocketId) {
                continue; // Skip the socket that is being checked/removed
            }
            if (socketFilters.has(filterToCheck)) return true;
        }
        return false;
    }

    _initializeVariableSubscriptions() {
        if (!this.client || !this.client.connected) {
            console.warn(`[${this.name}] Cannot initialize variable subscriptions, MQTT client not connected.`);
            return;
        }
        this.topicToVariableMap.clear(); // Clear existing map

        this.config.variables.forEach(variable => {
            if (variable.enableSubscribe && variable.subscribeTopic) {
                this.topicToVariableMap.set(variable.subscribeTopic, variable);
                const qos = typeof variable.qosSubscribe === 'number' ? variable.qosSubscribe : 0;
                this.client.subscribe(variable.subscribeTopic, { qos }, (err) => {
                    if (err) {
                        console.error(`[${this.name}] Failed to subscribe to variable topic '${variable.subscribeTopic}': ${err.message}`);
                    } else {
                        // console.log(`[${this.name}] Subscribed to variable topic '${variable.subscribeTopic}' for var '${variable.name}'`);
                    }
                });
            }
        });
    }

    _resubscribeTemporaryTopics() {
        if (!this.client || !this.client.connected) return;
        this.temporarySubscriptions.forEach((filters, socketId) => {
            filters.forEach(filter => {
                // console.log(`[${this.name}] Re-subscribing to temporary filter '${filter}' for socket ${socketId}`);
                this.client.subscribe(filter, { qos: 0 }, (err) => { // Assuming QoS 0 for temp subs
                    if (err) console.error(`[${this.name}] Error re-subscribing to temp filter '${filter}': ${err.message}`);
                });
            });
        });
    }

    updateVariableDefinitions(newVariablesArray) {
        if (!this.client || !this.client.connected) {
            console.warn(`[${this.name}] MQTT client not connected. Variable definitions will be updated upon reconnection.`);
            this.config.variables = Array.isArray(newVariablesArray) ? newVariablesArray : [];
            // No need to clear topicToVariableMap yet, it will be rebuilt on connect.
            return;
        }

        const oldTopicToVarMap = new Map(this.topicToVariableMap);
        this.config.variables = Array.isArray(newVariablesArray) ? newVariablesArray : [];
        this.topicToVariableMap.clear(); // Rebuild this map

        const newTopicsToSubscribe = new Set();
        this.config.variables.forEach(variable => {
            if (variable.enableSubscribe && variable.subscribeTopic) {
                newTopicsToSubscribe.add(variable.subscribeTopic);
                this.topicToVariableMap.set(variable.subscribeTopic, variable); // Populate new map
            }
        });

        // Unsubscribe from topics that are no longer needed by variables
        oldTopicToVarMap.forEach((oldVarConfig, oldTopic) => {
            if (!newTopicsToSubscribe.has(oldTopic) && !this._isFilterNeeded(oldTopic)) {
                this.client.unsubscribe(oldTopic, err => {
                    if (err) console.error(`[${this.name}] Error unsubscribing from old variable topic '${oldTopic}': ${err.message}`);
                    // else console.log(`[${this.name}] Unsubscribed from old variable topic '${oldTopic}'`);
                });
            }
        });

        // Subscribe to new or changed variable topics
        newTopicsToSubscribe.forEach(newTopic => {
            if (!oldTopicToVarMap.has(newTopic)) { // Only subscribe if it's a new topic
                const variable = this.topicToVariableMap.get(newTopic);
                const qos = typeof variable.qosSubscribe === 'number' ? variable.qosSubscribe : 0;
                this.client.subscribe(newTopic, { qos }, (err) => {
                    if (err) console.error(`[${this.name}] Failed to subscribe to new/updated variable topic '${newTopic}': ${err.message}`);
                    // else console.log(`[${this.name}] Subscribed to new/updated variable topic '${newTopic}' for var '${variable.name}'`);
                });
            }
        });
    }

    handleTemporarySubscribe(filterToSubscribe, socketId) {
        if (!this.client || !this.client.connected) {
            console.warn(`[${this.name}] MQTT client not connected. Cannot handle temporary subscribe for '${filterToSubscribe}'.`);
            return;
        }
        // console.log(`[${this.name}] Socket ${socketId} requests temporary subscription to filter '${filterToSubscribe}'`);

        if (!this.temporarySubscriptions.has(socketId)) {
            this.temporarySubscriptions.set(socketId, new Set());
        }
        const clientSubscribedFilters = this.temporarySubscriptions.get(socketId);

        if (clientSubscribedFilters.has(filterToSubscribe)) {
            // console.log(`[${this.name}] Socket ${socketId} already subscribed to filter '${filterToSubscribe}'.`);
            return; // Already subscribed by this socket
        }

        // Subscribe to broker only if this filter isn't already covered by any subscription
        // (another temp client or a persistent variable topic).
        // _isFilterNeeded checks ALL subscriptions.
        const needsBrokerSubscription = !this._isFilterNeeded(filterToSubscribe);

        if (needsBrokerSubscription) {
             this.client.subscribe(filterToSubscribe, { qos: 0 }, (err) => { // Assuming QoS 0 for temp subs
                if (err) {
                    console.error(`[${this.name}] Error subscribing to temporary filter '${filterToSubscribe}' for MQTT broker: ${err.message}`);
                } else {
                    // console.log(`[${this.name}] Successfully subscribed to MQTT broker for temp filter '${filterToSubscribe}' for socket ${socketId}`);
                }
            });
        } else {
            //  console.log(`[${this.name}] Filter '${filterToSubscribe}' is already managed by another subscription. Adding to socket ${socketId}'s list.`);
        }
        clientSubscribedFilters.add(filterToSubscribe);
    }

    handleTemporaryUnsubscribe(filterToUnsubscribe, socketId, isDisconnecting = false) {
        // console.log(`[${this.name}] Socket ${socketId} requests temporary unsubscribe from filter '${filterToUnsubscribe}' (disconnecting: ${isDisconnecting})`);
        const clientSubscribedFilters = this.temporarySubscriptions.get(socketId);

        if (clientSubscribedFilters) {
            clientSubscribedFilters.delete(filterToUnsubscribe);
            if (clientSubscribedFilters.size === 0) {
                this.temporarySubscriptions.delete(socketId);
                // console.log(`[${this.name}] Socket ${socketId} has no more temporary subscriptions. Removed from tracking.`);
            }
        }

        // Unsubscribe from broker only if no other socket (excluding current if it's disconnecting)
        // AND no persistent variable needs this exact filter.
        if (!this._isFilterNeeded(filterToUnsubscribe, isDisconnecting ? socketId : null)) {
            if (this.client && this.client.connected) {
                this.client.unsubscribe(filterToUnsubscribe, (err) => {
                    if (err) console.error(`[${this.name}] Error unsubscribing from temporary filter '${filterToUnsubscribe}' on MQTT broker: ${err.message}`);
                    // else console.log(`[${this.name}] Unsubscribed from temporary filter '${filterToUnsubscribe}' on MQTT broker.`);
                });
            }
        } else {
            // console.log(`[${this.name}] Filter '${filterToUnsubscribe}' still needed by other subscriptions. Not unsubscribing from broker.`);
        }
    }

    _unsubscribeAllTopics() {
        if (!this.client || (!this.client.connected && !this.client.disconnecting)) {
            // console.log(`[${this.name}] MQTT client not available or already disconnected. Clearing local subscription maps.`);
            this.topicToVariableMap.clear();
            this.temporarySubscriptions.forEach(filters => filters.clear());
            this.temporarySubscriptions.clear();
            return Promise.resolve();
        }

        const filtersToUnsubscribe = new Set();
        // Add all variable subscription topics
        this.topicToVariableMap.forEach((varConfig, topic) => filtersToUnsubscribe.add(topic));
        // Add all unique temporary subscription filters
        this.temporarySubscriptions.forEach(socketFilters => {
            socketFilters.forEach(filter => filtersToUnsubscribe.add(filter));
        });

        const unsubscribePromises = [];
        if (filtersToUnsubscribe.size > 0) {
            // console.log(`[${this.name}] Unsubscribing from ${filtersToUnsubscribe.size} filters/topics during disconnect...`);
            filtersToUnsubscribe.forEach(filter => {
                unsubscribePromises.push(new Promise((resolve, reject) => {
                    this.client.unsubscribe(filter, (err) => {
                        if (err) {
                            console.error(`[${this.name}] Error unsubscribing from '${filter}' during disconnect: ${err.message}`);
                            reject(err); // Still resolve to not block Promise.allSettled
                        } else {
                            // console.log(`[${this.name}] Unsubscribed from '${filter}' during disconnect.`);
                            resolve();
                        }
                    });
                }));
            });
        }

        // Clear local tracking immediately
        this.topicToVariableMap.clear();
        this.temporarySubscriptions.forEach(filters => filters.clear());
        this.temporarySubscriptions.clear();

        return Promise.allSettled(unsubscribePromises);
    }

    async disconnect() {
        if (this.client) {
            // console.log(`[${this.name}] Disconnecting MQTT client...`);
            await this._unsubscribeAllTopics(); // Ensure all topics are unsubscribed before closing

            // Give a very short time for unsubscribe ACKs if any are pending,
            // though MQTT unsubscribe doesn't always have an ACK from broker in client libs.
            await new Promise(resolve => setTimeout(resolve, 50));

            this.client.end(true, () => { // true for force close, no new messages
                // console.log(`[${this.name}] MQTT client disconnected successfully.`);
                this._updateStatusAndEmit(false);
                this.client = null; // Nullify client after it's fully ended
            });
        } else {
             // console.log(`[${this.name}] disconnect() called but no active client.`);
            this._updateStatusAndEmit(false); // Ensure status is updated if called multiple times or client was null
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
            const payload = String(value); // Ensure payload is a string

            this.client.publish(variableConfig.publishTopic, payload, { qos, retain }, (err) => {
                if (err) {
                    console.error(`[${this.name}] MQTT publish error to topic '${variableConfig.publishTopic}' for var '${variableName}': ${err.message}`);
                } else {
                    // console.log(`[${this.name}] Published to topic '${variableConfig.publishTopic}' for var '${variableName}': ${payload}`);
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
        // console.log(`Modbus RTU device ${this.name} connecting (simulated).`);
        // Simulate connection delay
        setTimeout(() => this._updateStatusAndEmit(true), 500);
    }

    disconnect() {
        // console.log(`Modbus RTU device ${this.name} disconnected (simulated).`);
        this._updateStatusAndEmit(false);
    }
}

class ModbusTcpDevice extends Device {
    constructor(config, socketIoInstance) {
        super(config);
        this.io = socketIoInstance;
    }

    connect() {
        // console.log(`Modbus TCP device ${this.name} connecting (simulated).`);
        // Simulate connection delay
        setTimeout(() => this._updateStatusAndEmit(true), 500);
    }

    disconnect() {
        // console.log(`Modbus TCP device ${this.name} disconnected (simulated).`);
        this._updateStatusAndEmit(false);
    }
}


const activeDevices = new Map(); // Stores active device instances, keyed by deviceId

/**
 * Initializes a device based on its configuration.
 * If a device with the same ID is already initialized, returns the existing instance.
 * Otherwise, creates a new device instance, connects it, and stores it.
 * @param {object} deviceConfig - The configuration object for the device.
 * @param {object} socketIoInstance - The Socket.IO server instance.
 * @returns {Device|null} The initialized device instance or null if type is unsupported.
 */
function initializeDevice(deviceConfig, socketIoInstance) {
    if (activeDevices.has(deviceConfig.id)) {
        // console.log(`Device ${deviceConfig.name} (${deviceConfig.id}) already initialized.`);
        return activeDevices.get(deviceConfig.id);
    }

    let deviceInstance;
    switch (deviceConfig.type.toLowerCase()) { // Normalize type to lowercase
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
            console.error(`Unsupported device type: '${deviceConfig.type}' for device ${deviceConfig.name}`);
            return null;
    }

    if (deviceInstance) {
        // console.log(`Initializing device: ${deviceInstance.name} (Type: ${deviceInstance.type}, ID: ${deviceInstance.id})`);
        activeDevices.set(deviceConfig.id, deviceInstance);
        try {
            deviceInstance.connect(); // Attempt to connect the device
        } catch (error) {
            console.error(`[${deviceInstance.name}] Error during initial connect: ${error.message}`);
            // Device remains in activeDevices but might be in a disconnected state.
            // Status will be updated by the connect method itself.
        }
    }
    return deviceInstance;
}

function getDeviceInstance(deviceId) {
    return activeDevices.get(deviceId);
}

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
        // console.log(`Removing device: ${device.name} (ID: ${deviceId})`);
        // Disconnect should handle status updates.
        // Using a try-catch in case disconnect itself throws an error, though it should be robust.
        try {
            device.disconnect();
        } catch (error) {
            console.error(`[${device.name}] Error during disconnect call for removal: ${error.message}`);
            // Still attempt to remove from map even if disconnect errors out
        }
        activeDevices.delete(deviceId);
        // console.log(`Device ${device.name} (ID: ${deviceId}) removed.`);
    } else {
        // console.warn(`Attempted to remove non-existent device with ID: ${deviceId}`);
    }
}

module.exports = {
    initializeDevice,
    getDeviceInstance,
    getAllDeviceInstances,
    removeDevice,
    // For potential direct use or testing, though MqttDevice is not directly exported:
    // MqttDevice: MqttDevice
};
