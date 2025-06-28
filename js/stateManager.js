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

// // Fungsi untuk memperbarui tag database, berguna saat komponen dibuat atau address diubah
// export function updateTagDatabase(address, value) { // To be replaced by setDeviceVariableValue
//     if (!(address in tagDatabase)) {
//         tagDatabase[address] = value;
//     }
// }

// export function deleteFromTagDatabase(address) { // To be replaced by more specific deletion
//     delete tagDatabase[address];
// }


// New functions for variable-based state
export function getDeviceVariableValue(deviceId, variableName) {
    if (tagDatabase[deviceId]) {
        return tagDatabase[deviceId][variableName];
    }
    return undefined;
}

export function setDeviceVariableValue(deviceId, variableName, value) {
    if (!tagDatabase[deviceId]) {
        tagDatabase[deviceId] = {};
    }
    tagDatabase[deviceId][variableName] = value;
    // console.log(`Set variable value: Device ${deviceId}, Var ${variableName} =`, value, tagDatabase);

    // Notify relevant components to update.
    // This requires components to be findable by deviceId and variableName.
    // Or, a more generic event can be dispatched that components listen to if they are active.
    if (layerRef) {
        layerRef.find('.hmi-component').forEach(node => {
            // Assumption: components will have deviceId and variableName attributes
            if (node.attrs.deviceId === deviceId && node.attrs.variableName === variableName) {
                node.updateState?.(); // Trigger component's own update method
            }
        });
    }
}

export function deleteDeviceState(deviceId) {
    if (tagDatabase[deviceId]) {
        delete tagDatabase[deviceId];
        console.log(`State for device ${deviceId} deleted.`);
    }
}

export function deleteDeviceVariableState(deviceId, variableName) {
    if (tagDatabase[deviceId] && tagDatabase[deviceId].hasOwnProperty(variableName)) {
        delete tagDatabase[deviceId][variableName];
        console.log(`State for variable ${variableName} of device ${deviceId} deleted.`);
    }
}


// // Fungsi untuk mengganti address di tagDatabase (misal saat diedit di context menu)
// // This function is likely obsolete as direct address manipulation is replaced by variable binding.
// export function replaceTagAddress(oldAddress, newAddress) {
//     if (oldAddress !== newAddress && tagDatabase.hasOwnProperty(oldAddress)) {
//         tagDatabase[newAddress] = tagDatabase[oldAddress];
//         delete tagDatabase[oldAddress];
//         // Client-side subscription logic removed. Server manages subscriptions.
//         return true; // Berhasil diganti
//     }
//     return false; // Tidak ada perubahan atau oldAddress tidak ada
// }

// Old functions (to be phased out or removed if no longer used by other modules after refactor)
// For now, let's keep them but comment out their direct usage if possible,
// or make them call the new functions with some default/global deviceId if that makes sense.
export function getComponentAddressValue(address) { // Legacy support or for non-device-specific global tags
    // This might represent a global variable not tied to a device.
    // Or, if all tags become device-bound, this needs a deviceId.
    // For now, let's assume it might access a "global" device or a flat part of tagDatabase.
    return tagDatabase[address]; // This will break if tagDatabase is purely device-scoped.
                                 // Needs decision: are there global tags or are all tags device variables?
                                 // Assuming for now all data comes via device variables.
     console.warn("getComponentAddressValue (legacy) called. Ensure this is intended for non-device-specific tags or update to getDeviceVariableValue.");
     return undefined;
}

export function setComponentAddressValue(address, value, deviceId = "_global") { // Legacy support
    // If deviceId is provided and it's not the placeholder, use new method.
    if (deviceId && deviceId !== "_global") {
        setDeviceVariableValue(deviceId, address, value); // Assuming address here might be used as variableName for legacy
    } else {
        // If truly global, tagDatabase structure needs to accommodate it, e.g. tagDatabase["_global"][address]
        // For now, this will put it at the root, which might conflict with device IDs.
        // This indicates a need for clearer separation if global tags are to be supported alongside device variables.
        console.warn(`setComponentAddressValue (legacy) called for address: ${address}. Consider scoping to a device or specific global context.`);
        tagDatabase[address] = value; // This is potentially problematic.
    }
}