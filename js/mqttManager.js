// Pastikan Paho MQTT Client sudah dimuat secara global atau impor jika memungkinkan
// import Paho from 'paho-mqtt'; // Jika menggunakan npm package

let mqttClient = null;
let mqttConnected = false;
let mqttReconnectInterval = null;

// Fungsi ini akan dipanggil dari app.js untuk menginisialisasi dengan elemen UI dan state
export function initMqtt(uiUpdateStatus, getLayer, getTagDatabase, getMqttElements) {
    const { mqttHostInput, mqttPortInput, mqttConnectBtn } = getMqttElements();

    function connectMqttInternal(host, port, username, password) {
        if (mqttClient && mqttClient.isConnected()) {
            mqttClient.disconnect();
        }

        const clientId = "hmi_client_" + Math.random().toString(16).substr(2, 8);
        // const uri = `ws://${host}:${port}/mqtt`; // Assuming WebSocket for browser, Paho client handles this

        uiUpdateStatus(`Menghubungkan ke MQTT broker di ${host}:${port}...`, 0);

        mqttClient = new Paho.MQTT.Client(host, Number(port), "/mqtt", clientId);

        mqttClient.onConnectionLost = (responseObject) => onConnectionLostInternal(responseObject, host, port, uiUpdateStatus);
        mqttClient.onMessageArrived = (message) => onMessageArrivedInternal(message, getLayer, getTagDatabase);

        const connectOptions = {
            onSuccess: () => onConnectSuccessInternal(uiUpdateStatus, getLayer, mqttConnectBtn),
            onFailure: (responseObject) => onConnectFailureInternal(responseObject, uiUpdateStatus, mqttConnectBtn),
            cleanSession: true,
            reconnect: false, // We'll handle reconnect manually
            useSSL: port === 8883 || port === 8084, // asumsi port SSL umum
        };

        if (username) {
            connectOptions.userName = username;
        }
        if (password) {
            connectOptions.password = password;
        }

        try {
            mqttClient.connect(connectOptions);
        } catch (e) {
            console.error("MQTT Connect Error:", e);
            uiUpdateStatus(`Gagal koneksi MQTT: ${e.message}`, 5000);
            mqttConnected = false;
            mqttConnectBtn.textContent = "Connect";
            mqttConnectBtn.classList.remove("bg-red-600", "hover:bg-red-700");
            mqttConnectBtn.classList.add("bg-blue-600", "hover:bg-blue-700");
        }
    }

    function onConnectSuccessInternal(uiUpdateStatus, getLayer, mqttConnectBtn) {
        mqttConnected = true;
        uiUpdateStatus("Terhubung ke MQTT broker!", 3000);
        mqttConnectBtn.textContent = "Disconnect";
        mqttConnectBtn.classList.remove("bg-blue-600", "hover:bg-blue-700");
        mqttConnectBtn.classList.add("bg-red-600", "hover:bg-red-700");
        clearInterval(mqttReconnectInterval); // Hentikan interval reconnect jika berhasil terhubung

        const layer = getLayer();
        if (layer) {
            layer.find(".hmi-component").forEach(node => {
                if (node.attrs.address) {
                    mqttClient.subscribe(node.attrs.address);
                    console.log(`Subscribed to ${node.attrs.address}`);
                }
            });
        }
    }

    function onConnectFailureInternal(responseObject, uiUpdateStatus, mqttConnectBtn) {
        mqttConnected = false;
        uiUpdateStatus(`Koneksi MQTT gagal: ${responseObject.errorMessage}`, 5000);
        mqttConnectBtn.textContent = "Connect";
        mqttConnectBtn.classList.remove("bg-red-600", "hover:bg-red-700");
        mqttConnectBtn.classList.add("bg-blue-600", "hover:bg-blue-700");
    }

    function onConnectionLostInternal(responseObject, host, port, uiUpdateStatus) {
        mqttConnected = false;
        if (responseObject.errorCode !== 0) {
            uiUpdateStatus(`Koneksi MQTT terputus: ${responseObject.errorMessage}. Mencoba menghubungkan kembali...`, 0);
            if (mqttReconnectInterval) clearInterval(mqttReconnectInterval); // Hapus interval lama jika ada
            mqttReconnectInterval = setInterval(() => {
                // Kita butuh host dan port terbaru dari input fields, jadi panggil getMqttElements lagi
                const { mqttHostInput: currentHostInput, mqttPortInput: currentPortInput } = getMqttElements();
                connectMqttInternal(currentHostInput.value, currentPortInput.value);
            }, 5000);
        }
    }

    function onMessageArrivedInternal(message, getLayer, getTagDatabase) {
        const tagDatabase = getTagDatabase();
        tagDatabase[message.destinationName] = parseFloat(message.payloadString); // Asumsi payload adalah angka
        const layer = getLayer();
        if (layer) {
            layer.find(".hmi-component").forEach(n => n.updateState?.());
        }
    }

    mqttConnectBtn.addEventListener("click", () => {
        if (mqttConnected) {
            if (mqttClient) {
                mqttClient.disconnect();
            }
            mqttConnected = false;
            mqttConnectBtn.textContent = "Connect";
            mqttConnectBtn.classList.remove("bg-red-600", "hover:bg-red-700");
            mqttConnectBtn.classList.add("bg-blue-600", "hover:bg-blue-700");
            uiUpdateStatus("Terputus dari MQTT broker.", 3000);
            clearInterval(mqttReconnectInterval);
        } else {
            const host = mqttHostInput.value;
            const port = mqttPortInput.value;
            connectMqttInternal(host, port);
        }
    });

    // Fungsi untuk melakukan subscribe saat komponen baru ditambahkan atau addressnya diubah
    function subscribeToComponentAddress(address) {
        if (mqttConnected && mqttClient && address) {
            mqttClient.subscribe(address);
            console.log(`Subscribed to ${address}`);
        }
    }

    // Fungsi untuk unsubscribe saat komponen dihapus atau addressnya diubah
    function unsubscribeFromComponentAddress(address) {
        if (mqttConnected && mqttClient && address) {
            mqttClient.unsubscribe(address);
            console.log(`Unsubscribed from ${address}`);
        }
    }

    // Ekspor fungsi yang mungkin perlu dipanggil dari luar modul ini
    return { subscribeToComponentAddress, unsubscribeFromComponentAddress };
}
