/**
 * mqttDevice.js - Defines the MqttDevice class for MQTT communication.
 */

const mqtt = require('mqtt'); // MQTT library
const Device = require('./baseDevice'); // Base Device class

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

// Helper function to safely get a value from a nested object using a dot-separated path.
function _getValueFromPath(obj, path) {
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
        // Log conservatively for path errors.
        // console.warn(`Error accessing path "${path}" in object:`, obj, e.message);
        return undefined;
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

    // Override _getValueFromPath to use the local helper or keep it as a private method.
    // For simplicity here, we'll assume it's a private method if not exposed/shared.
    // If it were more generic, it could be in a utils file.
    // _getValueFromPath = _getValueFromPath; // Or call it directly: _getValueFromPath(obj, path)

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
            this._resubscribeTemporaryTopics();
        });

        this.client.on('error', (err) => {
            console.error(`[${this.name}] MQTT Connection Error: ${err.message}`);
            if (this.client && !this.client.connected && this.connected) {
                 this._updateStatusAndEmit(false);
            }
        });

        this.client.on('reconnect', () => {
            if (this.connected) this._updateStatusAndEmit(false);
        });

        this.client.on('close', () => {
            if (this.connected) this._updateStatusAndEmit(false);
        });

        this.client.on('offline', () => {
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
                socketIdsForCleanup.push(socketId);
                return;
            }

            subscribedFilters.forEach(filter => {
                if (mqttWildcardMatch(topic, filter)) {
                    socketClient.emit('server_temp_message', {
                        deviceId: this.id,
                        topic: topic,
                        filter: filter,
                        payloadString: messageString,
                        timestamp: new Date().toISOString()
                    });
                    relayedToAnySocket = true;
                }
            });
        });

        socketIdsForCleanup.forEach(socketId => {
            this._clearTemporarySubscriptionsForSocket(socketId);
        });

        return relayedToAnySocket;
    }

    _processVariableSubscriptions(topic, messageString, relayedAsTempSub) {
        const variableConfig = this.topicToVariableMap.get(topic);
        if (variableConfig) {
            let value = messageString;
            if (variableConfig.jsonPath) {
                try {
                    const messageObject = JSON.parse(messageString);
                    value = _getValueFromPath(messageObject, variableConfig.jsonPath); // Use the local helper
                } catch (e) {
                    console.warn(`[${this.name}] Failed to parse JSON or extract path for var '${variableConfig.name}': ${e.message}`);
                    return;
                }
            }
            this._emitVariableUpdateToSocket(variableConfig.name, value);

        } else if (!relayedAsTempSub) {
            // console.debug(`[${this.name}] Message on topic '${topic}' did not match any variable or active temporary subscription.`);
        }
    }

    _clearTemporarySubscriptionsForSocket(socketId) {
        const subscribedFilters = this.temporarySubscriptions.get(socketId);
        if (subscribedFilters) {
            subscribedFilters.forEach(filter => {
                this.handleTemporaryUnsubscribe(filter, socketId, true); // isDisconnecting = true
            });
            this.temporarySubscriptions.delete(socketId);
        }
    }

    _isFilterNeeded(filterToCheck, excludingSocketId = null) {
        if (this.topicToVariableMap.has(filterToCheck)) return true;
        for (const [socketId, socketFilters] of this.temporarySubscriptions.entries()) {
            if (excludingSocketId && socketId === excludingSocketId) {
                continue;
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
        this.topicToVariableMap.clear();

        this.config.variables.forEach(variable => {
            if (variable.enableSubscribe && variable.subscribeTopic) {
                this.topicToVariableMap.set(variable.subscribeTopic, variable);
                const qos = typeof variable.qosSubscribe === 'number' ? variable.qosSubscribe : 0;
                this.client.subscribe(variable.subscribeTopic, { qos }, (err) => {
                    if (err) {
                        console.error(`[${this.name}] Failed to subscribe to variable topic '${variable.subscribeTopic}': ${err.message}`);
                    }
                });
            }
        });
    }

    _resubscribeTemporaryTopics() {
        if (!this.client || !this.client.connected) return;
        this.temporarySubscriptions.forEach((filters, socketId) => {
            filters.forEach(filter => {
                this.client.subscribe(filter, { qos: 0 }, (err) => {
                    if (err) console.error(`[${this.name}] Error re-subscribing to temp filter '${filter}': ${err.message}`);
                });
            });
        });
    }

    updateVariableDefinitions(newVariablesArray) {
        if (!this.client || !this.client.connected) {
            console.warn(`[${this.name}] MQTT client not connected. Variable definitions will be updated upon reconnection.`);
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

        oldTopicToVarMap.forEach((oldVarConfig, oldTopic) => {
            if (!newTopicsToSubscribe.has(oldTopic) && !this._isFilterNeeded(oldTopic)) {
                this.client.unsubscribe(oldTopic, err => {
                    if (err) console.error(`[${this.name}] Error unsubscribing from old variable topic '${oldTopic}': ${err.message}`);
                });
            }
        });

        newTopicsToSubscribe.forEach(newTopic => {
            if (!oldTopicToVarMap.has(newTopic)) {
                const variable = this.topicToVariableMap.get(newTopic);
                const qos = typeof variable.qosSubscribe === 'number' ? variable.qosSubscribe : 0;
                this.client.subscribe(newTopic, { qos }, (err) => {
                    if (err) console.error(`[${this.name}] Failed to subscribe to new/updated variable topic '${newTopic}': ${err.message}`);
                });
            }
        });
    }

    handleTemporarySubscribe(filterToSubscribe, socketId) {
        if (!this.client || !this.client.connected) {
            console.warn(`[${this.name}] MQTT client not connected. Cannot handle temporary subscribe for '${filterToSubscribe}'.`);
            return;
        }

        if (!this.temporarySubscriptions.has(socketId)) {
            this.temporarySubscriptions.set(socketId, new Set());
        }
        const clientSubscribedFilters = this.temporarySubscriptions.get(socketId);

        if (clientSubscribedFilters.has(filterToSubscribe)) {
            return;
        }

        const needsBrokerSubscription = !this._isFilterNeeded(filterToSubscribe);

        if (needsBrokerSubscription) {
             this.client.subscribe(filterToSubscribe, { qos: 0 }, (err) => {
                if (err) {
                    console.error(`[${this.name}] Error subscribing to temporary filter '${filterToSubscribe}' for MQTT broker: ${err.message}`);
                }
            });
        }
        clientSubscribedFilters.add(filterToSubscribe);
    }

    handleTemporaryUnsubscribe(filterToUnsubscribe, socketId, isDisconnecting = false) {
        const clientSubscribedFilters = this.temporarySubscriptions.get(socketId);

        if (clientSubscribedFilters) {
            clientSubscribedFilters.delete(filterToUnsubscribe);
            if (clientSubscribedFilters.size === 0) {
                this.temporarySubscriptions.delete(socketId);
            }
        }

        if (!this._isFilterNeeded(filterToUnsubscribe, isDisconnecting ? socketId : null)) {
            if (this.client && this.client.connected) {
                this.client.unsubscribe(filterToUnsubscribe, (err) => {
                    if (err) console.error(`[${this.name}] Error unsubscribing from temporary filter '${filterToUnsubscribe}' on MQTT broker: ${err.message}`);
                });
            }
        }
    }

    _unsubscribeAllTopics() {
        if (!this.client || (!this.client.connected && !this.client.disconnecting)) {
            this.topicToVariableMap.clear();
            this.temporarySubscriptions.forEach(filters => filters.clear());
            this.temporarySubscriptions.clear();
            return Promise.resolve();
        }

        const filtersToUnsubscribe = new Set();
        this.topicToVariableMap.forEach((varConfig, topic) => filtersToUnsubscribe.add(topic));
        this.temporarySubscriptions.forEach(socketFilters => {
            socketFilters.forEach(filter => filtersToUnsubscribe.add(filter));
        });

        const unsubscribePromises = [];
        if (filtersToUnsubscribe.size > 0) {
            filtersToUnsubscribe.forEach(filter => {
                unsubscribePromises.push(new Promise((resolve, reject) => {
                    this.client.unsubscribe(filter, (err) => {
                        if (err) {
                            console.error(`[${this.name}] Error unsubscribing from '${filter}' during disconnect: ${err.message}`);
                            reject(err);
                        } else {
                            resolve();
                        }
                    });
                }));
            });
        }

        this.topicToVariableMap.clear();
        this.temporarySubscriptions.forEach(filters => filters.clear());
        this.temporarySubscriptions.clear();

        return Promise.allSettled(unsubscribePromises);
    }

    async disconnect() {
        if (this.client) {
            await this._unsubscribeAllTopics();
            await new Promise(resolve => setTimeout(resolve, 50));
            this.client.end(true, () => {
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
            const payload = String(value);

            this.client.publish(variableConfig.publishTopic, payload, { qos, retain }, (err) => {
                if (err) {
                    console.error(`[${this.name}] MQTT publish error to topic '${variableConfig.publishTopic}' for var '${variableName}': ${err.message}`);
                }
            });
        } else {
            console.warn(`[${this.name}] MQTT client not connected. Cannot write variable '${variableName}'.`);
        }
    }
}

module.exports = MqttDevice;
