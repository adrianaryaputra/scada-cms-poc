// Variabel-variabel ini akan diinisialisasi dan dikelola dalam modul ini.
let undoStack = [];
let redoStack = [];
let tagDatabase = {};

// Referensi ke elemen UI dan modul lain akan diteruskan saat inisialisasi.
let componentFactoryRef;
let layerRef;
let trRef;
let undoBtnRef;
let redoBtnRef;

export function initStateManager(factory, layer, tr, undoBtn, redoBtn, getDeviceByIdFunc) { // getDeviceByIdFunc is passed but currently unused in this module
    componentFactoryRef = factory;
    layerRef = layer;
    trRef = tr;
    undoBtnRef = undoBtn;
    redoBtnRef = redoBtn;
    // The getDeviceByIdFunc parameter is kept in the function signature for now,
    // in case future state logic needs it, but it's not stored or used within stateManager currently.

    // Panggil saveState awal untuk membuat state dasar
    saveState();
    updateUndoRedoButtons();
}

export function getTagDatabase() {
    return tagDatabase;
}

export function getUndoStack() {
    return undoStack;
}

export function getRedoStack() {
    return redoStack;
}


export function saveState() {
    const state = { components: [], tags: { ...tagDatabase } };
    if (layerRef) { // Pastikan layerRef sudah diinisialisasi
        layerRef.find(".hmi-component").forEach((node) => {
            const cleanAttrs = {
                componentType: node.attrs.componentType,
                address: node.attrs.address,
                label: node.attrs.label,
                shapeType: node.attrs.shapeType,
                offColor: node.attrs.offColor,
                onColor: node.attrs.onColor,
                offText: node.attrs.offText,
                onText: node.attrs.onText,
                states: node.attrs.states,
                units: node.attrs.units,
                decimalPlaces: node.attrs.decimalPlaces,
                text: node.attrs.text,
                fontSize: node.attrs.fontSize,
                fill: node.attrs.fill,
                width: node.attrs.width,
                align: node.attrs.align,
            };
            const componentData = {
                id: node.id(),
                x: node.x(),
                y: node.y(),
                ...cleanAttrs,
            };
            Object.keys(componentData).forEach(
                (key) =>
                    componentData[key] === undefined &&
                    delete componentData[key]
            );
            state.components.push(componentData);
        });
    }
    undoStack.push(JSON.stringify(state));
    redoStack = []; // Setiap state baru menghapus redo stack
    updateUndoRedoButtons();
    console.log("State saved. Undo stack size:", undoStack.length);

}

export function restoreState(stateString) {
    const state = JSON.parse(stateString);
    const oldTagDatabase = { ...tagDatabase }; // Simpan tagDatabase lama untuk perbandingan

    if (layerRef && componentFactoryRef && trRef) { // Pastikan referensi sudah ada
        layerRef.find(".hmi-component").forEach((node) => node.destroy());
        trRef.nodes([]);
        tagDatabase = { ...state.tags };

        // Perbarui langganan MQTT berdasarkan perubahan alamat
        const newAddresses = new Set(state.components.map(c => c.address));
        // const oldAddresses = new Set(Object.keys(oldTagDatabase)); // Keep for logic if needed, but not for sub/unsub
        // const newAddresses = new Set(state.components.map(c => c.address)); // Keep for logic if needed

        // Client-side subscription logic removed. Server manages subscriptions.
        // oldAddresses.forEach(addr => {
        //     if (!newAddresses.has(addr) && mqttFuncsRef?.unsubscribeFromComponentAddress) { // mqttFuncsRef is no longer for this
        //         // mqttFuncsRef.unsubscribeFromComponentAddress(addr);
        //     }
        // });

        state.components.forEach((componentData) => {
            const component = componentFactoryRef.create(
                componentData.componentType,
                componentData
            );
            layerRef.add(component);
            // Client-side subscription logic removed.
            // if (!oldAddresses.has(componentData.address) && mqttFuncsRef?.subscribeToComponentAddress) { // mqttFuncsRef is no longer for this
            //      // mqttFuncsRef.subscribeToComponentAddress(componentData.address);
            // }
        });
    }
    updateUndoRedoButtons();
}

export function handleUndo() {
    if (undoStack.length <= 1) return; // Tidak bisa undo state awal
    const currentState = undoStack.pop();
    redoStack.push(currentState);
    const lastState = undoStack[undoStack.length - 1];
    restoreState(lastState);
    console.log("Undo. Undo stack size:", undoStack.length, "Redo stack size:", redoStack.length);
}

export function handleRedo() {
    if (redoStack.length === 0) return;
    const nextState = redoStack.pop();
    undoStack.push(nextState);
    restoreState(nextState);
    console.log("Redo. Undo stack size:", undoStack.length, "Redo stack size:", redoStack.length);

}

export function getCurrentState() {
    const state = { components: [], tags: { ...tagDatabase } };
     if (layerRef) {
        layerRef.find(".hmi-component").forEach((node) => {
            const cleanAttrs = {
                componentType: node.attrs.componentType,
                address: node.attrs.address,
                label: node.attrs.label,
                shapeType: node.attrs.shapeType,
                offColor: node.attrs.offColor,
                onColor: node.attrs.onColor,
                offText: node.attrs.offText,
                onText: node.attrs.onText,
                states: node.attrs.states,
                units: node.attrs.units,
                decimalPlaces: node.attrs.decimalPlaces,
                 text: node.attrs.text,
                fontSize: node.attrs.fontSize,
                fill: node.attrs.fill,
                width: node.attrs.width,
                align: node.attrs.align,
            };
            const componentData = {
                id: node.id(),
                x: node.x(),
                y: node.y(),
                ...cleanAttrs,
            };
            Object.keys(componentData).forEach(
                (key) =>
                    componentData[key] === undefined &&
                    delete componentData[key]
            );
            state.components.push(componentData);
        });
    }
    return JSON.stringify(state);
}

export function updateUndoRedoButtons() {
    if (undoBtnRef && redoBtnRef) { // Pastikan referensi sudah ada
        undoBtnRef.disabled = undoStack.length <= 1;
        redoBtnRef.disabled = redoStack.length === 0;
    }
}

// Fungsi untuk memperbarui tag database, berguna saat komponen dibuat atau address diubah
export function updateTagDatabase(address, value) {
    if (!(address in tagDatabase)) {
        tagDatabase[address] = value;
    }
}

export function deleteFromTagDatabase(address) {
    delete tagDatabase[address];
}

export function getComponentAddressValue(address) {
    return tagDatabase[address];
}

export function setComponentAddressValue(address, value) {
    tagDatabase[address] = value;
}

// Fungsi untuk mengganti address di tagDatabase (misal saat diedit di context menu)
export function replaceTagAddress(oldAddress, newAddress) {
    if (oldAddress !== newAddress && tagDatabase.hasOwnProperty(oldAddress)) {
        tagDatabase[newAddress] = tagDatabase[oldAddress];
        delete tagDatabase[oldAddress];
        // Client-side subscription logic removed. Server manages subscriptions.
        // if (mqttFuncsRef) { // mqttFuncsRef is no longer for this
        //     // mqttFuncsRef.unsubscribeFromComponentAddress(oldAddress);
        //     // mqttFuncsRef.subscribeToComponentAddress(newAddress);
        // }
        return true; // Berhasil diganti
    }
    return false; // Tidak ada perubahan atau oldAddress tidak ada
}