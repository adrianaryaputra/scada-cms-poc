// server/socketHandler.js
const { initializeDevice, getDeviceInstance, getAllDeviceInstances, removeDevice } = require('./deviceHandler');

// This will be populated from localStorage or a database in a real app
let serverSideDeviceStore = [];

function setupSocketHandlers(io) {
    const deviceNamespace = io.of('/devices');

    deviceNamespace.on('connection', (socket) => {
        console.log(`Client ${socket.id} connected to /devices namespace`);

        // Send current list of devices to newly connected client
        socket.emit('initial_device_list', serverSideDeviceStore.map(dev => ({...dev, connected: getDeviceInstance(dev.id)?.connected || false }) ));

        // Handle device CRUD operations
        socket.on('add_device', (deviceConfig) => {
            console.log('Received add_device request:', deviceConfig);
            const existingDevice = serverSideDeviceStore.find(d => d.id === deviceConfig.id);
            if (!existingDevice) {
                serverSideDeviceStore.push(deviceConfig);
                const deviceInstance = initializeDevice(deviceConfig, io); // Pass io for data emission
                // Broadcast updated device list to all clients in the namespace
                deviceNamespace.emit('device_added', {...deviceConfig, connected: deviceInstance?.connected || false});
                // Persist serverSideDeviceStore (e.g., to a file or DB)
            } else {
                // Handle error: device already exists or send update
                socket.emit('operation_error', { message: `Device with ID ${deviceConfig.id} already exists.` });
            }
        });

        socket.on('edit_device', (deviceConfig) => {
            console.log('Received edit_device request:', deviceConfig);
            const index = serverSideDeviceStore.findIndex(d => d.id === deviceConfig.id);
            if (index > -1) {
                // Disconnect and remove old instance
                removeDevice(deviceConfig.id);

                serverSideDeviceStore[index] = deviceConfig;
                const deviceInstance = initializeDevice(deviceConfig, io);
                deviceNamespace.emit('device_updated', {...deviceConfig, connected: deviceInstance?.connected || false});
                // Persist serverSideDeviceStore
            } else {
                socket.emit('operation_error', { message: `Device with ID ${deviceConfig.id} not found for editing.` });
            }
        });

        socket.on('delete_device', (deviceId) => {
            console.log('Received delete_device request for ID:', deviceId);
            const index = serverSideDeviceStore.findIndex(d => d.id === deviceId);
            if (index > -1) {
                removeDevice(deviceId);
                serverSideDeviceStore.splice(index, 1);
                deviceNamespace.emit('device_deleted', deviceId);
                // Persist serverSideDeviceStore
            } else {
                socket.emit('operation_error', { message: `Device with ID ${deviceId} not found for deletion.` });
            }
        });

        socket.on('request_device_data', (deviceId) => {
            const device = getDeviceInstance(deviceId);
            if (device) {
                // This is more for polled devices. MQTT pushes data.
                // For now, just acknowledge. Real implementation might trigger a read.
                console.log(`Data request for ${deviceId}. Device type: ${device.type}`);
            }
        });

        socket.on('write_to_device', (data) => { // This event name might become ambiguous.
                                                 // Consider renaming to 'write_to_device_address' or similar if keeping.
                                                 // For now, we'll assume MqttDevice.writeData was a typo and it meant writeVariable.
            // data = { deviceId, address, value } OR { deviceId, variableName, value }
            console.log('Received write_to_device (or variable) request:', data);
            const device = getDeviceInstance(data.deviceId);
            if (device && device.connected) {
                if (data.variableName && typeof device.writeVariable === 'function') {
                    device.writeVariable(data.variableName, data.value);
                } else if (data.address && typeof device.writeData === 'function') { // Fallback for non-Mqtt or older direct address writes
                    device.writeData(data.address, data.value);
                } else {
                    console.warn(`[SocketHandler] Device ${data.deviceId} does not support required write method.`);
                    socket.emit('operation_error', { message: `Device ${data.deviceId} does not support the required write method.` });
                }
            } else {
                socket.emit('operation_error', {
                    message: `Device ${data.deviceId} not found or not connected. Cannot write.`
                });
            }
        });

        socket.on('disconnect', () => {
            console.log(`Client ${socket.id} disconnected from /devices namespace`);
            // Clean up any temporary subscriptions for this socket
            getAllDeviceInstances().forEach(device => {
                if (device.type === 'mqtt' && typeof device.temporarySubscriptions?.has === 'function' && device.temporarySubscriptions.has(socket.id)) {
                    const tempTopicsForSocket = new Set(device.temporarySubscriptions.get(socket.id)); // Iterate over a copy
                    tempTopicsForSocket.forEach(topic => {
                        if (typeof device.handleTemporaryUnsubscribe === 'function') {
                            device.handleTemporaryUnsubscribe(topic, socket.id);
                        }
                    });
                }
            });
        });

        // Event handlers for MQTT Temporary Subscriptions
        socket.on('client_temp_subscribe_request', ({ deviceId, topic }) => {
            console.log(`[Socket ${socket.id}] Received client_temp_subscribe_request for device ${deviceId}, topic ${topic}`);
            const device = getDeviceInstance(deviceId);
            if (device && device.type === 'mqtt' && typeof device.handleTemporarySubscribe === 'function') {
                device.handleTemporarySubscribe(topic, socket.id);
            } else {
                socket.emit('operation_error', { message: `Device ${deviceId} not found or does not support temporary subscriptions.` });
            }
        });

        socket.on('client_temp_unsubscribe_request', ({ deviceId, topic }) => {
            console.log(`[Socket ${socket.id}] Received client_temp_unsubscribe_request for device ${deviceId}, topic ${topic}`);
            const device = getDeviceInstance(deviceId);
            if (device && device.type === 'mqtt' && typeof device.handleTemporaryUnsubscribe === 'function') {
                device.handleTemporaryUnsubscribe(topic, socket.id);
            } else {
                // No error message needed if device/topic wasn't tracked for this socket anyway
                console.warn(`[Socket ${socket.id}] Could not process temp unsubscribe for device ${deviceId}, topic ${topic}. Device not found or incorrect type.`);
            }
        });


        // Periodically emit status updates for all devices
        // This is a simple way to keep clients updated. More sophisticated would be event-driven from Device instances.
        // Note: MqttDevice now also emits 'device_status_update' and 'device_statuses' on change.
        // This interval ensures even non-MQTT devices or polled devices could have their status broadcasted.
        const statusInterval = setInterval(() => {
            const deviceStatuses = getAllDeviceInstances().map(d => ({
                id: d.id,
                connected: d.connected,
                name: d.name, // Adding name and type for richer status updates
                type: d.type
            }));
            if (deviceStatuses.length > 0) {
                 socket.emit('device_statuses', deviceStatuses);
            }
        }, 5000); // Emit status every 5 seconds

        // Clear interval when the specific socket disconnects
        const originalDisconnectHandler = socket.listeners('disconnect')[0]; // Get the first (and likely only) disconnect handler
        socket.removeAllListeners('disconnect'); // Remove existing to avoid multiple calls to clearInterval
        socket.on('disconnect', () => {
            if (originalDisconnectHandler) {
                originalDisconnectHandler(); // Call the original logic (logging, temp sub cleanup)
            }
            clearInterval(statusInterval);
            console.log(`[Socket ${socket.id}] Cleared statusInterval.`);
        });

    });

    // Load initial devices from storage (e.g., a JSON file or database)
    // For now, we'll keep it in memory and assume devices are added via UI
    // In a real app, you'd load persisted devices here and initialize them:
    // loadPersistedDevices().forEach(config => initializeDevice(config, io));
    // And serverSideDeviceStore would be initialized with these.
}

// Example of how device data could be pushed from deviceHandler to clients
// This function would be called by a device instance (e.g., MqttDevice on message)
// This is illustrative; actual implementation hooks into Device class events or callbacks.
function broadcastDeviceData(io, deviceId, data) {
    // data typically { address, value, timestamp }
    io.of('/devices').emit('device_data', { deviceId, ...data });
}


module.exports = { setupSocketHandlers, broadcastDeviceData, serverSideDeviceStore };
