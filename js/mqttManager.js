import { getTagDatabase, setTagValue } from './stateManager.js';
import { getLayer } from './konvaManager.js';

const mqttDevices = new Map(); // Menyimpan instance client MQTT berdasarkan ID device

// Fungsi untuk membuat dan mengelola instance device MQTT
export function createMqttDevice(device) {
    if (mqttDevices.has(device.id)) {
        console.log(`Device ${device.name} sudah ada.`);
        return mqttDevices.get(device.id);
    }

    const clientId = `hmi_client_${device.id}`;
    const client = new Paho.MQTT.Client(device.host, Number(device.port), "/mqtt", clientId);

    const deviceState = {
        id: device.id,
        name: device.name,
        client: client,
        connected: false,
        reconnectInterval: null,
    };

    client.onConnectionLost = (responseObject) => onConnectionLost(responseObject, deviceState, device);
    client.onMessageArrived = onMessageArrived;

    mqttDevices.set(device.id, deviceState);
    connectMqtt(deviceState, device);

    return deviceState;
}

function connectMqtt(deviceState, deviceConfig) {
    const connectOptions = {
        onSuccess: () => onConnectSuccess(deviceState),
        onFailure: (responseObject) => onConnectFailure(responseObject, deviceState),
        cleanSession: true,
        useSSL: Number(deviceConfig.port) === 8883 || Number(deviceConfig.port) === 8084,
    };

    try {
        console.log(`Menghubungkan ke ${deviceConfig.name} di ${deviceConfig.host}:${deviceConfig.port}...`);
        deviceState.client.connect(connectOptions);
    } catch (e) {
        console.error(`[${deviceState.name}] MQTT Connect Error:`, e);
        updateDeviceStatus(deviceState.id, false);
    }
}

function onConnectSuccess(deviceState) {
    console.log(`[${deviceState.name}] Terhubung ke MQTT broker.`);
    deviceState.connected = true;
    updateDeviceStatus(deviceState.id, true);
    clearInterval(deviceState.reconnectInterval);

    // Subscribe ke semua topik yang relevan saat koneksi berhasil
    const layer = getLayer();
    if (layer) {
        layer.find('.hmi-component').forEach(node => {
            if (node.attrs.deviceId === deviceState.id && node.attrs.address) {
                subscribeToTopic(deviceState, node.attrs.address);
            }
        });
    }
}

function onConnectFailure(responseObject, deviceState) {
    console.error(`[${deviceState.name}] Koneksi MQTT gagal: ${responseObject.errorMessage}`);
    deviceState.connected = false;
    updateDeviceStatus(deviceState.id, false);
}

function onConnectionLost(responseObject, deviceState, deviceConfig) {
    console.log(`[${deviceState.name}] Koneksi MQTT terputus: ${responseObject.errorMessage}.`);
    deviceState.connected = false;
    updateDeviceStatus(deviceState.id, false);
    // Implementasi reconnect logic jika diperlukan
    // deviceState.reconnectInterval = setInterval(() => connectMqtt(deviceState, deviceConfig), 5000);
}

function onMessageArrived(message) {
    const topic = message.destinationName;
    const value = parseFloat(message.payloadString);
    
    // Update state terpusat
    setTagValue(topic, value);

    // Update komponen di canvas
    const layer = getLayer();
    if (layer) {
        layer.find('.hmi-component').forEach(n => {
            // Cek apakah komponen ini terikat dengan topik yang pesannya masuk
            // Ini memerlukan cara untuk menautkan komponen ke device dan topik
            // Untuk sekarang, kita asumsikan address adalah topiknya
            if (n.attrs.address === topic) {
                n.updateState?.();
            }
        });
    }
}

export function disconnectMqttDevice(deviceId) {
    const deviceState = mqttDevices.get(deviceId);
    if (deviceState && deviceState.client.isConnected()) {
        deviceState.client.disconnect();
        console.log(`[${deviceState.name}] Terputus dari MQTT broker.`);
    }
    clearInterval(deviceState.reconnectInterval);
    mqttDevices.delete(deviceId);
    updateDeviceStatus(deviceId, false);
}

export function subscribeToTopic(deviceState, topic) {
    if (deviceState && deviceState.connected && topic) {
        deviceState.client.subscribe(topic);
        console.log(`[${deviceState.name}] Subscribed to ${topic}`);
    }
}

export function unsubscribeFromTopic(deviceState, topic) {
    if (deviceState && deviceState.connected && topic) {
        deviceState.client.unsubscribe(topic);
        console.log(`[${deviceState.name}] Unsubscribed from ${topic}`);
    }
}

// Fungsi untuk mengupdate UI status di Device Manager
function updateDeviceStatus(deviceId, isConnected) {
    const statusDot = document.querySelector(`.device-status[data-id="${deviceId}"]`);
    if (statusDot) {
        statusDot.classList.toggle('bg-green-500', isConnected);
        statusDot.classList.toggle('bg-red-500', !isConnected);
        statusDot.title = isConnected ? 'Connected' : 'Disconnected';
    }
}

export function getMqttDevice(deviceId) {
    return mqttDevices.get(deviceId);
}