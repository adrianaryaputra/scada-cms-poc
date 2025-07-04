/**
 * @file Defines the MqttDevice class for communication with an MQTT broker.
 * It handles connecting to the broker, subscribing to topics based on device variable configurations,
 * processing incoming messages, publishing data, and managing temporary subscriptions
 * (e.g., for a topic explorer UI).
 * @extends Device
 */

const mqtt = require("mqtt"); // MQTT library
const Device = require("./baseDevice"); // Base Device class

/**
 * Matches a topic against a filter that can contain MQTT wildcards.
 * Supports:
 * - `#`: Multi-level wildcard (must be at the end of the filter).
 * - `+`: Single-level wildcard.
 *
 * @param {string} topic - The topic string to check (e.g., "sensor/+/temp").
 * @param {string} filter - The filter string to match against (e.g., "sensor/livingroom/temp").
 * @returns {boolean} True if the topic matches the filter, false otherwise.
 * @private
 */
function mqttWildcardMatch(topic, filter) {
    if (filter === "#") return true; // Wildcard '#' matches everything.
    if (filter === topic) return true; // Exact match.

    const topicSegments = topic.split("/");
    const filterSegments = filter.split("/");

    const topicSegmentsLength = topicSegments.length;
    const filterSegmentsLength = filterSegments.length;

    for (let i = 0; i < filterSegmentsLength; i++) {
        const filterSegment = filterSegments[i];

        if (filterSegment === "#") {
            // '#' wildcard must be the last character in the filter.
            // It matches all remaining levels in the topic.
            return i === filterSegmentsLength - 1;
        }

        // If filter is longer than topic (and not ended with '#'), no match.
        if (i >= topicSegmentsLength) return false;

        const topicSegment = topicSegments[i];
        if (filterSegment !== "+" && filterSegment !== topicSegment) {
            // Segments don't match, and filter segment is not a single-level wildcard '+'.
            return false;
        }
    }

    // If the filter didn't end with '#', topic and filter must have the same number of segments.
    return topicSegmentsLength === filterSegmentsLength;
}

/**
 * Safely retrieves a value from a nested object using a dot-separated path string.
 * Example: `_getValueFromPath(obj, "data.sensors[0].temperature")`
 *
 * @param {object} obj - The object to traverse.
 * @param {string} path - The dot-separated path to the desired value.
 * @returns {*} The value at the specified path, or `undefined` if the path is not found or an error occurs.
 * @private
 */
function _getValueFromPath(obj, path) {
    if (!path || typeof path !== "string") return obj; // Return original object if path is invalid/empty
    try {
        const keys = path.split(".").map(key => {
            // Handle array notation like sensors[0]
            const arrMatch = key.match(/^([^[]+)\[(\d+)\]$/);
            if (arrMatch) {
                return [arrMatch[1], parseInt(arrMatch[2], 10)];
            }
            return key;
        }).flat(); // Flatten in case of array notation results

        let result = obj;
        for (const key of keys) {
            if (result && typeof result === "object" && Object.prototype.hasOwnProperty.call(result, key)) {
                result = result[key];
            } else {
                return undefined; // Path not found
            }
        }
        return result;
    } catch (e) {
        // console.warn(`Error accessing path "${path}" in object:`, obj, e.message);
        return undefined;
    }
}

/**
 * Represents an MQTT-enabled device.
 * Connects to an MQTT broker, manages subscriptions based on configured variables,
 * and handles publishing of data.
 * @class MqttDevice
 * @extends {Device}
 */
class MqttDevice extends Device {
    /**
     * Creates an instance of MqttDevice.
     * @param {object} config - Device configuration. Expected to contain MQTT connection parameters
     *                          (host, port, protocol, username, password, clientId, connectTimeout, reconnectPeriod)
     *                          and an array `variables` defining data points.
     * @param {Array<object>} [config.variables=[]] - Array of variable configurations. Each variable can define
     *                                                subscribe/publish topics, QoS, JSON paths, etc.
     * @param {SocketIO.Server} [socketIoInstance=null] - Socket.IO server instance.
     */
    constructor(config, socketIoInstance) {
        super(config, socketIoInstance);
        /**
         * @type {mqtt.MqttClient | null}
         * @private
         * The MQTT client instance from the 'mqtt' library.
         */
        this.client = null;
        /**
         * @type {Map<string, object>}
         * @private
         * Maps subscribed MQTT topics directly to their corresponding variable configuration objects.
         * Used for efficient processing of incoming messages for defined HMI variables.
         */
        this.topicToVariableMap = new Map();
        /**
         * @type {Map<string, Set<string>>}
         * @private
         * Maps a client's socket ID to a Set of MQTT topic filters (which can include wildcards)
         * that the client has temporarily subscribed to (e.g., via a topic explorer UI).
         */
        this.temporarySubscriptions = new Map();

        /**
         * @type {Array<object>}
         * Ensures `this.config.variables` is always an array. Each object in the array
         * should define how a HMI variable maps to MQTT topics for subscribing and/or publishing.
         * Expected properties per variable object:
         *  - `name` (string): Unique name of the variable.
         *  - `enableSubscribe` (boolean): If true, subscribe to `subscribeTopic`.
         *  - `subscribeTopic` (string): The MQTT topic to subscribe to for this variable.
         *  - `jsonPathSubscribe` (string, optional): Dot-notation path to extract value from JSON payload.
         *  - `qosSubscribe` (number, optional): QoS level for subscription.
         *  - `enablePublish` (boolean): If true, allow publishing on `publishTopic`.
         *  - `publishTopic` (string): The MQTT topic to publish to for this variable.
         *  - `qosPublish` (number, optional): QoS level for publishing.
         *  - `retainPublish` (boolean, optional): Retain flag for publishing.
         */
        this.config.variables = Array.isArray(this.config.variables)
            ? this.config.variables
            : [];
    }

    /**
     * Connects to the MQTT broker using configuration parameters.
     * Sets up event listeners for the MQTT client (connect, error, message, etc.).
     * Initializes subscriptions for configured variables upon successful connection.
     * @override
     */
    connect() {
        if (this.client && this.client.connected) {
            console.log(`[${this.name}] Already connected to MQTT broker.`);
            return;
        }

        const protocol = this.config.protocol || "mqtt";
        const connectUrl = `${protocol}://${this.config.host}:${this.config.port}`;
        const options = {
            clientId:
                this.config.clientId ||
                `hmi_server_${this.id}_${Date.now()}`, // Use full device ID
            username: this.config.username,
            password: this.config.password,
            clean: true, // Clean session
            connectTimeout: this.config.connectTimeout || 4000, // ms
            reconnectPeriod: this.config.reconnectPeriod || 1000, // ms
        };

        // console.log(`[${this.name}] Attempting to connect to MQTT broker at ${connectUrl}`);
        this.client = mqtt.connect(connectUrl, options);

        this.client.on("connect", () => {
            // console.log(`[${this.name}] Successfully connected to MQTT broker.`);
            this._updateStatusAndEmit(true);
            this._initializeVariableSubscriptions();
            this._resubscribeTemporaryTopics();
        });

        this.client.on("error", (err) => {
            console.error(
                `[${this.name}] MQTT Connection Error: ${err.message}`,
            );
            if (this.client && !this.client.connected && this.connected) {
                this._updateStatusAndEmit(false);
            }
        });

        this.client.on("reconnect", () => {
            if (this.connected) this._updateStatusAndEmit(false);
        });

        this.client.on("close", () => {
            if (this.connected) this._updateStatusAndEmit(false);
        });

        this.client.on("offline", () => {
            if (this.connected) this._updateStatusAndEmit(false);
        });

        this.client.on("message", (topic, messageBuffer) => {
            const messageString = messageBuffer.toString();
            // console.debug(`[${this.name}] Raw MQTT message received - Topic: ${topic}, Message: ${messageString}`);

            let relayedToTemp = this._processTemporarySubscriptions(
                topic,
                messageString,
            );
            this._processVariableSubscriptions(
                topic,
                messageString,
                relayedToTemp,
            );
        });
    }

    /**
     * Processes an incoming MQTT message against temporary subscriptions.
     * If a match is found, the message is relayed to the corresponding client socket.
     * Manages cleanup of subscriptions for disconnected sockets.
     *
     * @param {string} topic - The topic of the incoming MQTT message.
     * @param {string} messageString - The payload of the MQTT message as a string.
     * @returns {boolean} True if the message was relayed to at least one temporary subscriber, false otherwise.
     * @private
     */
    _processTemporarySubscriptions(topic, messageString) {
        let relayedToAnySocket = false;
        const socketIdsForCleanup = [];

        this.temporarySubscriptions.forEach((subscribedFilters, socketId) => {
            const deviceNamespace = this.io.of("/devices");
            const socketClient =
                deviceNamespace &&
                deviceNamespace.sockets &&
                deviceNamespace.sockets.get(socketId);

            if (!socketClient) {
                socketIdsForCleanup.push(socketId);
                return;
            }

            subscribedFilters.forEach((filter) => {
                if (mqttWildcardMatch(topic, filter)) {
                    socketClient.emit("server_temp_message", {
                        deviceId: this.id,
                        topic: topic,
                        filter: filter,
                        payloadString: messageString,
                        timestamp: new Date().toISOString(),
                    });
                    relayedToAnySocket = true;
                }
            });
        });

        socketIdsForCleanup.forEach((socketId) => {
            this._clearTemporarySubscriptionsForSocket(socketId);
        });

        return relayedToAnySocket;
    }

    /**
     * Processes an incoming MQTT message against configured variable subscriptions.
     * If the topic matches a subscribed variable's topic, it extracts the value
     * (applying JSONPath if configured) and emits a `device_variable_update` event.
     *
     * @param {string} topic - The topic of the incoming MQTT message.
     * @param {string} messageString - The payload of the MQTT message as a string.
     * @param {boolean} relayedAsTempSub - True if this message was already relayed to a temporary subscription.
     *                                     Used to avoid redundant debug logging for unhandled messages.
     * @private
     */
    _processVariableSubscriptions(topic, messageString, relayedAsTempSub) {
        const variableConfig = this.topicToVariableMap.get(topic);
        if (variableConfig) {
            console.log(
                `[${this.name}] MQTT message received for variable '${variableConfig.name}' on topic '${topic}'`,
            ); // DEBUG LOG
            let value = messageString;
            // Use variableConfig.jsonPathSubscribe as this is what's saved from the client
            if (
                variableConfig.jsonPathSubscribe &&
                variableConfig.jsonPathSubscribe.trim() !== ""
            ) {
                try {
                    const messageObject = JSON.parse(messageString);
                    value = _getValueFromPath(
                        messageObject,
                        variableConfig.jsonPathSubscribe,
                    ); // Use the local helper
                    // console.log( // Optional: Verbose logging for JSONPath extraction
                    //     `[${this.name}] Extracted value using JSONPath '${variableConfig.jsonPathSubscribe}':`,
                    //     value,
                    // );
                } catch (e) {
                    console.warn(
                        `[${this.name}] Failed to parse JSON or extract path for var '${variableConfig.name}' using path '${variableConfig.jsonPathSubscribe}': ${e.message}. Payload: ${messageString}`,
                    );
                    return;
                }
            }
            this._emitVariableUpdateToSocket(variableConfig.name, value);
            // console.log( // Optional: Verbose logging for variable emission
            //     `[${this.name}] Emitted 'device_variable_update' for var '${variableConfig.name}' with value:`,
            //     value,
            // );
        } else if (!relayedAsTempSub) {
            // console.debug(`[${this.name}] Message on topic '${topic}' did not match any variable or active temporary subscription.`);
        }
    }

    /**
     * Clears all temporary subscriptions associated with a given socket ID.
     * This is typically called when a client socket disconnects.
     * It ensures that the MQTT client unsubscribes from topics on the broker
     * if no other client (permanent variable or other temporary subscriber) needs them.
     *
     * @param {string} socketId - The ID of the socket whose temporary subscriptions are to be cleared.
     * @private
     */
    _clearTemporarySubscriptionsForSocket(socketId) {
        const subscribedFilters = this.temporarySubscriptions.get(socketId);
        if (subscribedFilters) {
            subscribedFilters.forEach((filter) => {
                this.handleTemporaryUnsubscribe(filter, socketId, true); // isDisconnecting = true
            });
            this.temporarySubscriptions.delete(socketId);
        }
    }

    _isFilterNeeded(filterToCheck, excludingSocketId = null) {
        if (this.topicToVariableMap.has(filterToCheck)) return true;
        for (const [
            socketId,
            socketFilters,
        ] of this.temporarySubscriptions.entries()) {
            if (excludingSocketId && socketId === excludingSocketId) {
                continue;
            }
            if (socketFilters.has(filterToCheck)) return true;
        }
        return false;
    }

    /**
     * Subscribes to MQTT topics based on the `variables` array in the device configuration.
     * This is called upon initial connection to the broker.
     * It populates `this.topicToVariableMap` for quick lookup of incoming messages.
     * @private
     */
    _initializeVariableSubscriptions() {
        if (!this.client || !this.client.connected) {
            console.warn(
                `[${this.name}] Cannot initialize variable subscriptions, MQTT client not connected.`,
            );
            return;
        }
        this.topicToVariableMap.clear();

        this.config.variables.forEach((variable) => {
            if (variable.enableSubscribe && variable.subscribeTopic) {
                this.topicToVariableMap.set(variable.subscribeTopic, variable);
                const qos =
                    typeof variable.qosSubscribe === "number"
                        ? variable.qosSubscribe
                        : 0;
                this.client.subscribe(
                    variable.subscribeTopic,
                    { qos },
                    (err) => {
                        if (err) {
                            console.error(
                                `[${this.name}] Failed to subscribe to variable topic '${variable.subscribeTopic}': ${err.message}`,
                            );
                        }
                    },
                );
            }
        });
    }

    /**
     * Re-subscribes to all topics currently held in `this.temporarySubscriptions`.
     * This is typically called after an MQTT client reconnects to the broker to ensure
     * that dynamic subscriptions (e.g., from a topic explorer) are restored.
     * @private
     */
    _resubscribeTemporaryTopics() {
        if (!this.client || !this.client.connected) return;
        this.temporarySubscriptions.forEach((filters, socketId) => {
            filters.forEach((filter) => {
                this.client.subscribe(filter, { qos: 0 }, (err) => {
                    if (err)
                        console.error(
                            `[${this.name}] Error re-subscribing to temp filter '${filter}': ${err.message}`,
                        );
                });
            });
        });
    }

    /**
     * Updates the MQTT subscriptions based on a new set of variable definitions.
     * It compares the new variable topics with the old ones, unsubscribing from topics
     * no longer needed and subscribing to new ones.
     * This is typically called when the device configuration is updated by the user.
     *
     * @param {Array<object>} newVariablesArray - The new array of variable configuration objects.
     *                                            See constructor JSDoc for expected variable object structure.
     */
    updateVariableDefinitions(newVariablesArray) {
        if (!this.client || !this.client.connected) {
            console.warn(
                `[${this.name}] MQTT client not connected. Variable definitions will be updated upon reconnection.`,
            );
            this.config.variables = Array.isArray(newVariablesArray)
                ? newVariablesArray
                : [];
            return;
        }

        const oldTopicToVarMap = new Map(this.topicToVariableMap);
        this.config.variables = Array.isArray(newVariablesArray)
            ? newVariablesArray
            : [];
        this.topicToVariableMap.clear();

        const newTopicsToSubscribe = new Set();
        this.config.variables.forEach((variable) => {
            if (variable.enableSubscribe && variable.subscribeTopic) {
                newTopicsToSubscribe.add(variable.subscribeTopic);
                this.topicToVariableMap.set(variable.subscribeTopic, variable);
            }
        });

        oldTopicToVarMap.forEach((oldVarConfig, oldTopic) => {
            if (
                !newTopicsToSubscribe.has(oldTopic) &&
                !this._isFilterNeeded(oldTopic)
            ) {
                this.client.unsubscribe(oldTopic, (err) => {
                    if (err)
                        console.error(
                            `[${this.name}] Error unsubscribing from old variable topic '${oldTopic}': ${err.message}`,
                        );
                });
            }
        });

        newTopicsToSubscribe.forEach((newTopic) => {
            if (!oldTopicToVarMap.has(newTopic)) {
                const variable = this.topicToVariableMap.get(newTopic);
                const qos =
                    typeof variable.qosSubscribe === "number"
                        ? variable.qosSubscribe
                        : 0;
                this.client.subscribe(newTopic, { qos }, (err) => {
                    if (err)
                        console.error(
                            `[${this.name}] Failed to subscribe to new/updated variable topic '${newTopic}': ${err.message}`,
                        );
                });
            }
        });
    }

    /**
     * Handles a request from a client (via its socket ID) to temporarily subscribe to an MQTT topic filter.
     * If the MQTT client is not already subscribed to this filter (either for a permanent variable
     * or another temporary subscriber), it subscribes to the broker.
     * The subscription is tracked per `socketId`.
     *
     * @param {string} filterToSubscribe - The MQTT topic filter (can include wildcards) to subscribe to.
     * @param {string} socketId - The socket ID of the client requesting the subscription.
     */
    handleTemporarySubscribe(filterToSubscribe, socketId) {
        if (!this.client || !this.client.connected) {
            console.warn(
                `[${this.name}] MQTT client not connected. Cannot handle temporary subscribe for '${filterToSubscribe}'.`,
            );
            return;
        }

        if (!this.temporarySubscriptions.has(socketId)) {
            this.temporarySubscriptions.set(socketId, new Set());
        }
        const clientSubscribedFilters =
            this.temporarySubscriptions.get(socketId);

        if (clientSubscribedFilters.has(filterToSubscribe)) {
            return;
        }

        const needsBrokerSubscription =
            !this._isFilterNeeded(filterToSubscribe);

        if (needsBrokerSubscription) {
            this.client.subscribe(filterToSubscribe, { qos: 0 }, (err) => {
                if (err) {
                    console.error(
                        `[${this.name}] Error subscribing to temporary filter '${filterToSubscribe}' for MQTT broker: ${err.message}`,
                    );
                }
            });
        }
        clientSubscribedFilters.add(filterToSubscribe);
    }

    /**
     * Handles a request from a client to unsubscribe from a temporary MQTT topic filter.
     * If this device is no longer subscribed to the filter (neither for a permanent variable
     * nor any other temporary subscriber), it unsubscribes from the broker.
     *
     * @param {string} filterToUnsubscribe - The MQTT topic filter to unsubscribe from.
     * @param {string} socketId - The socket ID of the client requesting the unsubscription.
     * @param {boolean} [isDisconnecting=false] - True if this is part of a client socket disconnection cleanup.
     *                                            This affects how `_isFilterNeeded` checks for existing needs.
     * @private
     */
    handleTemporaryUnsubscribe(
        filterToUnsubscribe,
        socketId,
        isDisconnecting = false,
    ) {
        const clientSubscribedFilters =
            this.temporarySubscriptions.get(socketId);

        if (clientSubscribedFilters) {
            clientSubscribedFilters.delete(filterToUnsubscribe);
            if (clientSubscribedFilters.size === 0) {
                this.temporarySubscriptions.delete(socketId);
            }
        }

        if (
            !this._isFilterNeeded(
                filterToUnsubscribe,
                isDisconnecting ? socketId : null,
            )
        ) {
            if (this.client && this.client.connected) {
                this.client.unsubscribe(filterToUnsubscribe, (err) => {
                    if (err)
                        console.error(
                            `[${this.name}] Error unsubscribing from temporary filter '${filterToUnsubscribe}' on MQTT broker: ${err.message}`,
                        );
                });
            }
        }
    }

    /**
     * Unsubscribes from all currently active MQTT topics (both permanent variable topics
     * and temporary subscriptions). Clears internal tracking maps for these subscriptions.
     * This is typically called as part of the disconnection process.
     *
     * @returns {Promise<Array<PromiseSettledResult>>} A promise that resolves when all unsubscribe
     *                                                  attempts have settled.
     * @private
     */
    _unsubscribeAllTopics() {
        if (
            !this.client ||
            (!this.client.connected && !this.client.disconnecting)
        ) {
            this.topicToVariableMap.clear();
            this.temporarySubscriptions.forEach((filters) => filters.clear());
            this.temporarySubscriptions.clear();
            return Promise.resolve();
        }

        const filtersToUnsubscribe = new Set();
        this.topicToVariableMap.forEach((varConfig, topic) =>
            filtersToUnsubscribe.add(topic),
        );
        this.temporarySubscriptions.forEach((socketFilters) => {
            socketFilters.forEach((filter) => filtersToUnsubscribe.add(filter));
        });

        const unsubscribePromises = [];
        if (filtersToUnsubscribe.size > 0) {
            filtersToUnsubscribe.forEach((filter) => {
                unsubscribePromises.push(
                    new Promise((resolve, reject) => {
                        this.client.unsubscribe(filter, (err) => {
                            if (err) {
                                console.error(
                                    `[${this.name}] Error unsubscribing from '${filter}' during disconnect: ${err.message}`,
                                );
                                reject(err);
                            } else {
                                resolve();
                            }
                        });
                    }),
                );
            });
        }

        this.topicToVariableMap.clear();
        this.temporarySubscriptions.forEach((filters) => filters.clear());
        this.temporarySubscriptions.clear();

        return Promise.allSettled(unsubscribePromises);
    }

    /**
     * Disconnects from the MQTT broker.
     * This involves unsubscribing from all topics and then ending the client connection.
     * Updates and emits connection status.
     * @override
     * @async
     */
    async disconnect() {
        if (this.client) {
            await this._unsubscribeAllTopics();
            await new Promise((resolve) => setTimeout(resolve, 50));
            this.client.end(true, () => {
                this._updateStatusAndEmit(false);
                this.client = null;
            });
        } else {
            this._updateStatusAndEmit(false);
        }
    }

    /**
     * Publishes a value to the MQTT topic associated with a configured HMI variable.
     * This method looks up the variable's configuration to find its `publishTopic`,
     * QoS, and retain flag settings.
     *
     * @param {string} variableName - The name of the HMI variable whose value is to be published.
     * @param {*} value - The value to publish. It will be converted to a string for the MQTT payload.
     */
    writeVariable(variableName, value) {
        const variableConfig = this.config.variables.find(
            (v) => v.name === variableName,
        );
        if (!variableConfig) {
            console.warn(
                `[${this.name}] Variable '${variableName}' not defined. Cannot write.`,
            );
            return;
        }
        if (!variableConfig.enablePublish || !variableConfig.publishTopic) {
            console.warn(
                `[${this.name}] Publishing not enabled or no publish topic for variable '${variableName}'.`,
            );
            return;
        }

        if (this.client && this.client.connected) {
            const qos =
                typeof variableConfig.qosPublish === "number"
                    ? variableConfig.qosPublish
                    : 0;
            const retain =
                typeof variableConfig.retainPublish === "boolean"
                    ? variableConfig.retainPublish
                    : false;
            const payload = String(value);

            this.client.publish(
                variableConfig.publishTopic,
                payload,
                { qos, retain },
                (err) => {
                    if (err) {
                        console.error(
                            `[${this.name}] MQTT publish error to topic '${variableConfig.publishTopic}' for var '${variableName}': ${err.message}`,
                        );
                    }
                },
            );
        } else {
            console.warn(
                `[${this.name}] MQTT client not connected. Cannot write variable '${variableName}'.`,
            );
        }
    }
}

module.exports = MqttDevice;
