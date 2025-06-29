// js/layoutManager.js
import { saveState, /* resetHistory */ } from './stateManager.js'; // Import langsung

let konvaManagerRef = null; // Akan diisi saat inisialisasi
// stateManagerRef tidak lagi diperlukan jika fungsi diimpor langsung
let componentFactoryRef = null; // Akan diisi saat inisialisasi
let socketRef = null; // Akan diisi saat inisialisasi

let currentLayoutName = null;
let isDirty = false;

const LayoutManager = {
    // Hapus stateManager dari parameter init
    init(konvaManager, componentFactory, socket) {
        konvaManagerRef = konvaManager;
        componentFactoryRef = componentFactory;
        socketRef = socket;
        console.log("LayoutManager initialized");

        // Event listener untuk menandai layout sebagai 'dirty' ketika ada perubahan state
        // Ini bisa diintegrasikan lebih baik dengan event dari stateManager jika ada
        // Untuk sekarang, kita bisa memanggil setDirty(true) secara manual dari tempat lain
        // atau meng-hook ke saveState di stateManager.
    },

    getCurrentLayoutAsJson() {
        if (konvaManagerRef && typeof konvaManagerRef.getHmiLayoutAsJson === 'function') {
            return konvaManagerRef.getHmiLayoutAsJson();
        }
        console.error("KonvaManager atau getHmiLayoutAsJson tidak tersedia.");
        return [];
    },

    setDirty(status) {
        isDirty = status;
        // Mungkin update UI untuk menunjukkan status dirty (misalnya, tanda bintang di judul)
        console.log("Layout dirty status:", isDirty);
    },

    isLayoutDirty() {
        return isDirty;
    },

    getCurrentLayoutName() {
        return currentLayoutName;
    },

    setCurrentLayoutName(name) {
        currentLayoutName = name;
    },

    newLayout() {
        if (isDirty) {
            if (!confirm("Ada perubahan yang belum disimpan. Apakah Anda yakin ingin membuat layout baru? Perubahan akan hilang.")) {
                return;
            }
        }
        if (konvaManagerRef && typeof konvaManagerRef.clearCanvas === 'function') {
            konvaManagerRef.clearCanvas();
        } else {
            console.error("konvaManagerRef atau clearCanvas tidak tersedia.");
            return;
        }

        // if (typeof resetHistory === 'function') { // Jika resetHistory sudah diimpor
        //     resetHistory();
        // } else {
            // console.warn("resetHistory tidak tersedia untuk newLayout.");
            // Untuk sementara, kita bisa memanggil saveState untuk membuat state awal yang kosong
            if (typeof saveState === 'function') { // saveState diimpor langsung
                 saveState(); // Ini akan menyimpan state kosong sebagai awal undo
            }
        // }
        this.setCurrentLayoutName(null);
        this.setDirty(false);
        console.log("Layout baru telah dibuat.");
        // Mungkin perlu emit event atau callback jika ada modul lain yang perlu tahu
    },

    exportLayout() {
        const layoutData = this.getCurrentLayoutAsJson();
        if (!layoutData || layoutData.length === 0) {
            alert("Tidak ada komponen HMI untuk diekspor.");
            return;
        }

        const layoutName = this.getCurrentLayoutName() || "hmi-layout";
        const filename = `${layoutName.replace(/\s+/g, '_')}_${new Date().toISOString().slice(0,10)}.json`;
        const jsonData = JSON.stringify(layoutData, null, 2); // null, 2 untuk pretty print

        const blob = new Blob([jsonData], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        console.log(`Layout diekspor sebagai ${filename}`);
    },

    saveLayoutToServer(layoutName) {
        if (!layoutName || layoutName.trim() === '') {
            alert("Nama layout tidak boleh kosong.");
            return Promise.reject("Nama layout kosong");
        }
        if (!socketRef) {
            console.error("Socket.IO client tidak terinisialisasi di LayoutManager.");
            return Promise.reject("Socket tidak terinisialisasi");
        }

        const layoutData = this.getCurrentLayoutAsJson();
        console.log(`Menyimpan layout '${layoutName}' ke server...`, layoutData);

        return new Promise((resolve, reject) => {
            socketRef.emit('layout:save', { name: layoutName, data: layoutData });

            // Listener untuk konfirmasi atau error
            const ackListener = (response) => {
                if (response.success) {
                    console.log(`Layout '${response.name}' berhasil disimpan di server.`);
                    this.setCurrentLayoutName(response.name);
                    this.setDirty(false);
                    resolve(response);
                } else {
                    // Ini mungkin tidak akan terpanggil jika server mengirim 'operation_error'
                    console.error(`Gagal menyimpan layout di server:`, response.message);
                    reject(response.message || 'Unknown error saving layout');
                }
                removeListeners(); // Hapus listener setelah selesai
            };

            const errorListener = (error) => {
                console.error('Error dari server saat menyimpan layout:', error);
                reject(error.message || 'Server operation error');
                removeListeners();
            };

            const removeListeners = () => {
                socketRef.off('layout:saved_ack', ackListener);
                socketRef.off('operation_error', errorListener); // Mungkin perlu lebih spesifik
            };

            socketRef.on('layout:saved_ack', ackListener);
            // Perlu cara untuk membedakan operation_error untuk save ini vs yang lain.
            // Untuk sementara, kita bisa asumsikan operation_error berikutnya adalah untuk ini.
            // Atau, server bisa mengirimkan error dengan konteks yang lebih spesifik.
            // Idealnya, server membalas dengan ID request atau callback socket.emit.
            // Socket.IO emit dengan callback adalah cara yang lebih baik:
            // socketRef.emit('layout:save', { name: layoutName, data: layoutData }, (response) => { ... });
            // Namun, ini memerlukan perubahan di server handler untuk memanggil callback.
            // Untuk saat ini, kita gunakan listener terpisah dan timeout.

            // Timeout jika tidak ada respons dari server
            const timeoutId = setTimeout(() => {
                console.error("Timeout saat menyimpan layout. Tidak ada respons dari server.");
                reject("Timeout: Server tidak merespons.");
                removeListeners();
            }, 10000); // Timeout 10 detik

            // Pastikan timeout dibersihkan jika respons diterima
            const originalResolve = resolve;
            const originalReject = reject;
            resolve = (val) => { clearTimeout(timeoutId); originalResolve(val); };
            reject = (err) => { clearTimeout(timeoutId); originalReject(err); };
        });
    },

    loadLayoutFromServer(layoutName) {
        if (!layoutName || layoutName.trim() === '') {
            alert("Nama layout untuk dimuat tidak boleh kosong.");
            return Promise.reject("Nama layout kosong");
        }
        if (!socketRef) {
            console.error("Socket.IO client tidak terinisialisasi di LayoutManager.");
            return Promise.reject("Socket tidak terinisialisasi");
        }

        console.log(`Memuat layout '${layoutName}' dari server...`);
        if (this.isLayoutDirty()) {
            if (!confirm("Ada perubahan yang belum disimpan. Apakah Anda yakin ingin memuat layout baru? Perubahan saat ini akan hilang.")) {
                return Promise.reject("Load dibatalkan oleh pengguna.");
            }
        }

        return new Promise((resolve, reject) => {
            socketRef.emit('layout:load', { name: layoutName });

            const dataListener = (response) => {
                if (response.name === layoutName) { // Pastikan ini respons untuk request kita
                    console.log(`Layout '${response.name}' berhasil dimuat:`, response.data);

                    if (konvaManagerRef && typeof konvaManagerRef.clearCanvas === 'function') {
                        konvaManagerRef.clearCanvas();
                    } else {
                        console.error("konvaManagerRef atau clearCanvas tidak tersedia.");
                        // Lanjutkan mencoba memuat komponen, tapi canvas mungkin tidak bersih
                    }

                    if (componentFactoryRef && typeof componentFactoryRef.create === 'function') {
                        console.log("[LayoutManager] Mencoba membuat ulang komponen dari data yang dimuat:", response.data); // LOG TAMBAHAN
                        response.data.forEach(componentData => {
                            try {
                                console.log("[LayoutManager] Membuat komponen:", componentData.componentType, JSON.stringify(componentData)); // LOG TAMBAHAN
                                const component = componentFactoryRef.create(componentData.componentType, componentData);
                                if (component) {
                                    console.log("[LayoutManager] Komponen dibuat:", component.id(), "di X:", component.x(), "Y:", component.y(), "Attrs:", JSON.stringify(component.attrs)); // LOG TAMBAHAN
                                    // componentFactory seharusnya sudah menambahkan ke layer
                                } else {
                                    console.warn("[LayoutManager] ComponentFactory mengembalikan null/undefined untuk:", componentData);
                                }
                            } catch (e) {
                                console.error(`[LayoutManager] Gagal membuat komponen saat memuat layout: ${componentData.componentType}`, e);
                            }
                        });
                        // Setelah semua komponen dibuat, gambar ulang layer
                        if (konvaManagerRef && konvaManagerRef.layer) {
                            console.log("[LayoutManager] Memanggil batchDraw pada layer setelah memuat semua komponen."); // LOG TAMBAHAN
                            konvaManagerRef.layer.batchDraw();
                        } else {
                             console.error("[LayoutManager] konvaManagerRef.layer tidak tersedia untuk batchDraw setelah memuat komponen."); // LOG TAMBAHAN
                        }
                    } else {
                        console.error("[LayoutManager] componentFactoryRef atau create tidak tersedia."); // LOG TAMBAHAN
                        reject("Gagal membuat komponen: factory tidak tersedia.");
                        removeListeners();
                        return;
                    }

                    this.setCurrentLayoutName(response.name);
                    this.setDirty(false);
                    // Reset history undo/redo setelah memuat layout baru
                    if (typeof saveState === 'function') { // saveState diimpor langsung
                        saveState();
                    }
                    resolve(response.data);
                }
                removeListeners();
            };

            const errorListener = (error) => {
                // Hanya tangani jika error relevan dengan load ini
                // Ini masih kurang ideal tanpa konteks error yang lebih baik dari server
                console.error(`Error dari server saat memuat layout '${layoutName}':`, error);
                reject(error.message || `Gagal memuat layout '${layoutName}'.`);
                removeListeners();
            };

            const removeListeners = () => {
                socketRef.off('layout:loaded_data', dataListener);
                socketRef.off('operation_error', errorListener);
            };

            socketRef.on('layout:loaded_data', dataListener);
            socketRef.on('operation_error', errorListener); // Ini bisa menangkap error lain juga

            const timeoutId = setTimeout(() => {
                console.error(`Timeout saat memuat layout '${layoutName}'.`);
                reject("Timeout: Server tidak merespons permintaan load.");
                removeListeners();
            }, 10000);

            const originalResolve = resolve;
            const originalReject = reject;
            resolve = (val) => { clearTimeout(timeoutId); originalResolve(val); };
            reject = (err) => { clearTimeout(timeoutId); originalReject(err); };
        });
    },

    getAvailableLayoutsFromServer() {
        if (!socketRef) {
            console.error("Socket.IO client tidak terinisialisasi di LayoutManager.");
            return Promise.reject("Socket tidak terinisialisasi");
        }
        console.log("Meminta daftar layout dari server...");
        return new Promise((resolve, reject) => {
            socketRef.emit('layout:list');

            const listListener = (layoutNames) => {
                console.log("Daftar layout diterima:", layoutNames);
                resolve(layoutNames);
                removeListeners();
            };

            const errorListener = (error) => {
                console.error('Error dari server saat meminta daftar layout:', error);
                reject(error.message || 'Gagal mendapatkan daftar layout.');
                removeListeners();
            };

            const removeListeners = () => {
                socketRef.off('layout:list_results', listListener);
                socketRef.off('operation_error', errorListener);
            };

            socketRef.on('layout:list_results', listListener);
            socketRef.on('operation_error', errorListener);

            const timeoutId = setTimeout(() => {
                console.error("Timeout saat meminta daftar layout.");
                reject("Timeout: Server tidak merespons permintaan daftar layout.");
                removeListeners();
            }, 10000);

            const originalResolve = resolve;
            const originalReject = reject;
            resolve = (val) => { clearTimeout(timeoutId); originalResolve(val); };
            reject = (err) => { clearTimeout(timeoutId); originalReject(err); };
        });
    },

    importLayoutFromFile(file) {
        if (!file) {
            alert("Tidak ada file yang dipilih untuk diimpor.");
            return Promise.reject("Tidak ada file yang dipilih.");
        }

        console.log(`Mengimpor layout dari file: ${file.name}`);
        if (this.isLayoutDirty()) {
            if (!confirm("Ada perubahan yang belum disimpan. Apakah Anda yakin ingin mengimpor layout baru? Perubahan saat ini akan hilang.")) {
                return Promise.reject("Impor dibatalkan oleh pengguna.");
            }
        }

        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = (event) => {
                try {
                    const layoutData = JSON.parse(event.target.result);

                    if (!Array.isArray(layoutData)) {
                        throw new Error("Format file layout tidak valid. Data harus berupa array komponen.");
                    }

                    if (konvaManagerRef && typeof konvaManagerRef.clearCanvas === 'function') {
                        konvaManagerRef.clearCanvas();
                    } else {
                        console.error("konvaManagerRef atau clearCanvas tidak tersedia saat impor.");
                        // Lanjutkan mencoba memuat, tapi canvas mungkin tidak bersih
                    }

                    if (componentFactoryRef && typeof componentFactoryRef.create === 'function') {
                        layoutData.forEach(componentData => {
                            try {
                                componentFactoryRef.create(componentData.componentType, componentData);
                            } catch (e) {
                                console.error(`Gagal membuat komponen saat impor: ${componentData.componentType}`, e);
                            }
                        });
                        if (konvaManagerRef && konvaManagerRef.layer) {
                            konvaManagerRef.layer.batchDraw();
                        }
                    } else {
                        console.error("componentFactoryRef atau create tidak tersedia saat impor.");
                        reject("Gagal membuat komponen dari file: factory tidak tersedia.");
                        return;
                    }

                    this.setCurrentLayoutName(file.name.replace(/\.json$/i, '')); // Gunakan nama file (tanpa .json) sebagai nama layout sementara
                    this.setDirty(true); // Layout yang diimpor dianggap 'dirty' sampai disimpan ke server

                    if (typeof saveState === 'function') {
                        saveState(); // Reset history undo/redo
                    }

                    console.log(`Layout dari file '${file.name}' berhasil diimpor dan dirender.`);
                    alert(`Layout '${file.name}' berhasil diimpor. Anda mungkin ingin menyimpannya ke server.`);
                    resolve(layoutData);

                } catch (error) {
                    console.error("Gagal mem-parse atau memproses file layout:", error);
                    alert(`Gagal mengimpor layout: ${error.message}`);
                    reject(error.message);
                }
            };

            reader.onerror = (event) => {
                console.error("Error saat membaca file:", event.target.error);
                alert("Gagal membaca file layout.");
                reject(event.target.error);
            };

            reader.readAsText(file);
        });
    }
};

export default LayoutManager;
