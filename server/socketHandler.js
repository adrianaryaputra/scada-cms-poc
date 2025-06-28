// server/socketHandler.js
const { initializeDevice, getDeviceInstance, getAllDeviceInstances, removeDevice } = require('./deviceHandler');

// In-memory store for device configurations.
// TODO: Replace with a persistent storage solution (e.g., JSON file, database).
let serverSideDeviceConfigs = [];

/**
 * Sets up Socket.IO event handlers for the /devices namespace.
 * @param {object} io - The Socket.IO server instance.
 */
function setupSocketHandlers(io) {
    const deviceNamespace = io.of('/devices');

    deviceNamespace.on('connection', (socket) => {
        // console.log(`Client ${socket.id} connected to /devices namespace`);

        // Send the current list of device configurations and their live statuses
        // to the newly connected client.
        socket.emit('initial_device_list', serverSideDeviceConfigs.map(devConfig => {
            const deviceInstance = getDeviceInstance(devConfig.id);
            return {
                ...devConfig,
                connected: deviceInstance?.connected || false,
                // Include other relevant status info if available, e.g., from deviceInstance.getStatus()
            };
        }));

        // --- Device CRUD Operations ---

        socket.on('add_device', (deviceConfig) => {
            // console.log(`[Socket ${socket.id}] Received 'add_device' request:`, deviceConfig);
            const existingDevice = serverSideDeviceConfigs.find(d => d.id === deviceConfig.id);
            if (!existingDevice) {
                serverSideDeviceConfigs.push(deviceConfig);
                const deviceInstance = initializeDevice(deviceConfig, io); // Pass io for device to emit updates

                // Broadcast the newly added device config and its status to all clients.
                deviceNamespace.emit('device_added', {
                    ...deviceConfig,
                    connected: deviceInstance?.connected || false
                });
                // TODO: Persist serverSideDeviceConfigs
            } else {
                socket.emit('operation_error', {
                    message: `Device with ID ${deviceConfig.id} already exists.`,
                    deviceId: deviceConfig.id
                });
            }
        });

        socket.on('edit_device', (deviceConfig) => {
            // console.log(`[Socket ${socket.id}] Received 'edit_device' request:`, deviceConfig);
            const index = serverSideDeviceConfigs.findIndex(d => d.id === deviceConfig.id);
            if (index > -1) {
                // Stop and remove the old device instance before re-initializing.
                removeDevice(deviceConfig.id);

                serverSideDeviceConfigs[index] = deviceConfig;
                const deviceInstance = initializeDevice(deviceConfig, io);

                deviceNamespace.emit('device_updated', {
                    ...deviceConfig,
                    connected: deviceInstance?.connected || false
                });
                // TODO: Persist serverSideDeviceConfigs
            } else {
                socket.emit('operation_error', {
                    message: `Device with ID ${deviceConfig.id} not found for editing.`,
                    deviceId: deviceConfig.id
                });
            }
        });

        socket.on('delete_device', (deviceId) => {
            // console.log(`[Socket ${socket.id}] Received 'delete_device' request for ID: ${deviceId}`);
            const index = serverSideDeviceConfigs.findIndex(d => d.id === deviceId);
            if (index > -1) {
                removeDevice(deviceId); // Disconnect and remove the device instance.
                serverSideDeviceConfigs.splice(index, 1);
                deviceNamespace.emit('device_deleted', deviceId);
                // TODO: Persist serverSideDeviceConfigs
            } else {
                socket.emit('operation_error', {
                    message: `Device with ID ${deviceId} not found for deletion.`,
                    deviceId: deviceId
                });
            }
        });

        // --- Device Interaction ---

        socket.on('request_device_data', (deviceId) => {
            // console.log(`[Socket ${socket.id}] Received 'request_device_data' for device: ${deviceId}`);
            const device = getDeviceInstance(deviceId);
            if (device && typeof device.readData === 'function') {
                // This is primarily for polled devices. MQTT devices push data automatically.
                // The readData method in the device should handle emitting data via socket.
                device.readData();
            } else if (device) {
                console.warn(`[SocketHandler] Device ${deviceId} (${device.type}) does not have a readData method or is not a polled type.`);
            } else {
                 socket.emit('operation_error', { message: `Device ${deviceId} not found for data request.`});
            }
        });

        socket.on('write_to_device', (data) => {
            // console.log(`[Socket ${socket.id}] Received 'write_to_device' request:`, data);
            const { deviceId, variableName, address, value } = data;
            const device = getDeviceInstance(deviceId);

            if (device && device.connected) {
                if (variableName && typeof device.writeVariable === 'function') {
                    device.writeVariable(variableName, value);
                } else if (address && typeof device.writeData === 'function') {
                    // Fallback for devices that use direct address writing (e.g., Modbus)
                    device.writeData(address, value);
                } else {
                    console.warn(`[SocketHandler] Device ${deviceId} (${device.type}) does not support the required write method (writeVariable or writeData).`);
                    socket.emit('operation_error', {
                        message: `Device ${deviceId} does not support the required write method for the provided parameters.`,
                        details: { deviceId, variableNameProvided: !!variableName, addressProvided: !!address }
                    });
                }
            } else {
                socket.emit('operation_error', {
                    message: `Device ${deviceId} not found or not connected. Cannot write.`,
                    details: { deviceId, connected: device?.connected }
                });
            }
        });

        // --- MQTT Temporary Subscriptions ---

        socket.on('client_temp_subscribe_request', ({ deviceId, topic }) => {
            // console.log(`[Socket ${socket.id}] Received 'client_temp_subscribe_request' for device ${deviceId}, topic: ${topic}`);
            const device = getDeviceInstance(deviceId);
            if (device && device.type === 'mqtt' && typeof device.handleTemporarySubscribe === 'function') {
                device.handleTemporarySubscribe(topic, socket.id);
            } else {
                socket.emit('operation_error', {
                    message: `Device ${deviceId} not found or does not support temporary MQTT subscriptions.`,
                    details: { deviceId, topic }
                });
            }
        });

        socket.on('client_temp_unsubscribe_request', ({ deviceId, topic }) => {
            // console.log(`[Socket ${socket.id}] Received 'client_temp_unsubscribe_request' for device ${deviceId}, topic: ${topic}`);
            const device = getDeviceInstance(deviceId);
            if (device && device.type === 'mqtt' && typeof device.handleTemporaryUnsubscribe === 'function') {
                // The device.handleTemporaryUnsubscribe method is responsible for broker unsubscription
                // only if the topic is no longer needed by any client or variable.
                device.handleTemporaryUnsubscribe(topic, socket.id, false); // isDisconnecting = false
            } else {
                // No explicit error message to client if device/topic wasn't tracked,
                // as it might be a redundant request or for a non-MQTT device.
                console.warn(`[SocketHandler] Could not process temp unsubscribe for device ${deviceId}, topic ${topic}. Device not found, not MQTT, or no unsubscribe handler.`);
            }
        });

        // --- Periodic Status Updates & Disconnect Handling ---

        // Periodically emit status updates for all devices.
        // This serves as a heartbeat and ensures clients have reasonably up-to-date statuses,
        // especially for devices that don't proactively report all status changes.
        // MqttDevice._updateStatusAndEmit also sends 'device_status_update' and 'device_statuses' on changes.
        const statusIntervalMs = 15000; // Emit all statuses every 15 seconds
        const statusInterval = setInterval(() => {
            const allDeviceStatuses = getAllDeviceInstances().map(d => ({
                id: d.id,
                name: d.name,
                type: d.type,
                connected: d.connected,
                // timestamp: new Date().toISOString() // Can be added if needed by client
            }));
            if (allDeviceStatuses.length > 0) {
                 socket.emit('device_statuses', allDeviceStatuses);
            }
        }, statusIntervalMs);

        // Enhanced disconnect handling
        const handleDisconnect = () => {
            // console.log(`Client ${socket.id} disconnected from /devices namespace.`);
            clearInterval(statusInterval);
            // console.log(`[Socket ${socket.id}] Cleared statusInterval due to disconnect.`);

            // Clean up any MQTT temporary subscriptions for this socket
            getAllDeviceInstances().forEach(device => {
                if (device.type === 'mqtt' &&
                    typeof device.temporarySubscriptions?.has === 'function' &&
                    device.temporarySubscriptions.has(socket.id) &&
                    typeof device.handleTemporaryUnsubscribe === 'function') {

                    // Iterate over a copy of the filters, as the original set might be modified
                    const tempFiltersForSocket = new Set(device.temporarySubscriptions.get(socket.id));
                    tempFiltersForSocket.forEach(filter => {
                        // console.log(`[Socket ${socket.id}] Cleaning up temp MQTT sub: Device ${device.id}, Filter ${filter}`);
                        device.handleTemporaryUnsubscribe(filter, socket.id, true); // isDisconnecting = true
                    });
                }
            });
        };

        // Replace default 'disconnect' listener if it exists, or just add ours.
        // This ensures we don't accidentally remove other important disconnect logic if added by Socket.IO itself.
        const existingDisconnectListeners = socket.listeners('disconnect');
        if (existingDisconnectListeners.length > 0) {
            socket.removeAllListeners('disconnect');
            socket.on('disconnect', () => {
                existingDisconnectListeners.forEach(listener => listener.call(socket)); // Call original listeners
                handleDisconnect(); // Call our custom disconnect logic
            });
        } else {
            socket.on('disconnect', handleDisconnect);
        }
    });

    // TODO: Load initial device configurations from persistent storage when server starts.
    // Example:
    // loadPersistedDeviceConfigs().then(configs => {
    //     serverSideDeviceConfigs = configs;
    //     serverSideDeviceConfigs.forEach(config => initializeDevice(config, io));
    // }).catch(err => console.error("Failed to load persisted device configs:", err));
}

/**
 * Example function for broadcasting generic device data.
 * This would typically be called from within a Device instance when it has new data.
 * @param {object} io - The Socket.IO server instance.
 * @param {string} deviceId - The ID of the device.
 * @param {object} data - The data payload (e.g., { address, value, timestamp }).
 */
function broadcastDeviceData(io, deviceId, data) {
    // Ensure data has a timestamp if not provided
    const payload = {
        deviceId,
        ...data,
        timestamp: data.timestamp || new Date().toISOString()
    };
    io.of('/devices').emit('device_data', payload);
}


module.exports = { setupSocketHandlers, broadcastDeviceData, serverSideDeviceStore: serverSideDeviceConfigs };
