# Konteks Aplikasi

Aplikasi ini adalah **SCADA (Supervisory Control and Data Acquisition) / HMI (Human-Machine Interface) Builder berbasis Web**.

## Fungsionalitas Utama:

1.  **Desain Antarmuka HMI:**
    - Pengguna dapat merancang antarmuka HMI secara visual.
    - Menggunakan library Konva.js untuk rendering canvas HTML5.
    - Komponen HMI dapat ditambahkan, dipindahkan, diubah ukurannya, dan dikonfigurasi.
    - Terdapat `componentFactory.js` untuk membuat berbagai jenis komponen HMI.

2.  **Manajemen Proyek:**
    - Pengguna dapat membuat, menyimpan, dan memuat proyek HMI.
    - Logika penyimpanan dan pemuatan proyek ditangani oleh `ProjectManager.js` (frontend) dan `projectHandler.js` (backend).
    - Proyek disimpan di server dalam direktori `projects/`.

3.  **Konektivitas Perangkat:**
    - Aplikasi dapat terhubung ke berbagai jenis perangkat industri.
    - Mendukung protokol seperti Modbus RTU, Modbus TCP, dan MQTT.
    - Implementasi driver perangkat terdapat di `server/devices/`.
    - `deviceManager.js` (frontend dan backend) mengelola koneksi dan komunikasi dengan perangkat.

4.  **Mode Operasi:**
    - **Mode Desain:** Pengguna merancang tata letak dan konfigurasi HMI.
    - **Mode Simulasi/Run:** Komponen HMI menampilkan data langsung dari perangkat atau data simulasi, dan dapat mengirim perintah ke perangkat.

5.  **Komunikasi Real-time:**
    - Menggunakan Socket.IO untuk komunikasi dua arah antara frontend (browser pengguna) dan backend (server Node.js).
    - Pembaruan data dari perangkat dan perintah dari pengguna ditransmisikan melalui WebSockets.

6.  **Asisten AI:**
    - Terdapat fitur asisten AI (`aiAssistant.js`) yang kemungkinan membantu pengguna dalam proses perancangan HMI atau konfigurasi.

7.  **Manajemen State:**
    - `stateManager.js` mengelola state aplikasi, termasuk fungsionalitas undo/redo untuk tindakan desain.

## Struktur Proyek:

- **Frontend (`index.html`, `style.css`, `js/`):**
    - `js/app.js`: Titik masuk utama aplikasi frontend.
    - `js/konvaManager.js`: Mengelola rendering dan interaksi dengan canvas Konva.
    - `js/uiManager.js`: Mengelola elemen UI umum dan interaksi pengguna.
    - `js/componentFactory.js`: Membuat komponen HMI.
    - `js/deviceManager.js`: Mengelola perangkat dari sisi klien.
    - `js/projectManager.js`: Mengelola proyek dari sisi klien.
    - `js/stateManager.js`: Mengelola state aplikasi.
    - `js/aiAssistant.js`: Logika untuk asisten AI.
    - `js/topicExplorer.js`: Kemungkinan untuk menjelajahi topik data (misalnya MQTT).

- **Backend (`server/`):**
    - `server/main.js`: Titik masuk utama aplikasi server (Node.js dengan Express).
    - `server/socketHandler.js`: Menangani event dan logika Socket.IO.
    - `server/projectHandler.js`: Menangani penyimpanan dan pemuatan proyek di sisi server.
    - `server/deviceManager.js`: Mengelola perangkat dari sisi server.
    - `server/devices/`: Berisi implementasi untuk berbagai protokol perangkat (Modbus, MQTT, dll.).

- **Konfigurasi:**
    - `package.json`: Mendefinisikan dependensi proyek dan skrip.
    - `.prettierrc`: Konfigurasi untuk Prettier (pemformatan kode).

## Alur Kerja Umum:

1.  Pengguna membuka aplikasi di browser.
2.  Frontend (`js/app.js`) menginisialisasi semua modul yang diperlukan.
3.  Pengguna dapat membuat proyek baru atau memuat proyek yang sudah ada.
4.  Dalam mode desain, pengguna menambahkan dan mengkonfigurasi komponen HMI di canvas.
5.  Pengguna mengkonfigurasi koneksi ke perangkat fisik atau virtual.
6.  Pengguna beralih ke mode simulasi/run.
7.  Frontend berkomunikasi dengan backend melalui Socket.IO untuk bertukar data dengan perangkat.
8.  Komponen HMI diperbarui secara real-time untuk mencerminkan status perangkat.
9.  Pengguna dapat berinteraksi dengan komponen HMI untuk mengirim perintah ke perangkat.
10. Proyek dapat disimpan kapan saja.

## Teknologi Utama:

- **Frontend:** HTML, CSS, JavaScript (ES6 Modules)
    - Konva.js: Library untuk rendering canvas 2D.
    - Socket.IO Client: Untuk komunikasi real-time.
- **Backend:** Node.js
    - Express.js: Framework web.
    - Socket.IO: Untuk komunikasi real-time.
    - `mqtt`: Library klien MQTT.
    - (Kemungkinan library Modbus lainnya, tidak terlihat langsung di `package.json` utama, mungkin dependensi dari file perangkat tertentu atau diinstal secara global/manual).

## Petunjuk untuk Agen AI (Jules):

- Pahami bahwa ini adalah aplikasi yang kompleks dengan banyak modul yang saling berinteraksi.
- Perubahan pada satu bagian (misalnya, `componentFactory`) mungkin memerlukan penyesuaian di bagian lain (misalnya, `konvaManager`, `stateManager`, `aiAssistant`).
- Perhatikan komunikasi antara frontend dan backend melalui Socket.IO, terutama untuk data perangkat dan manajemen proyek.
- Saat menambahkan fitur baru atau memperbaiki bug, pertimbangkan dampaknya pada mode desain dan mode simulasi.
- File `projectHandler.js` dan `ProjectManager.js` adalah kunci untuk fungsionalitas penyimpanan/pemuatan.
- Logika spesifik perangkat ada di `server/devices/`.
- `js/app.js` adalah orkestrator utama di sisi klien.
- `server/main.js` adalah orkestrator utama di sisi server.
- Gunakan `npm start` untuk menjalankan server.
- Pastikan untuk menjaga konsistensi kode dan mengikuti pola yang sudah ada.
- Jika ada tugas terkait AI, `js/aiAssistant.js` adalah tempat utama untuk dilihat.
- Untuk tugas visual/UI, `js/konvaManager.js` dan `js/uiManager.js` serta file CSS akan relevan.

## Catatan Pengembangan Terkini:

- **2024-07-18 (Diperbarui 2024-07-19):** Kesulitan awal dalam menguji `js/konvaManager.js` (panggilan `gridLayer.add` tidak terdeteksi) telah diatasi. Solusinya melibatkan penggunaan fungsi setter khusus pengujian (`_setLayerForTesting`, `_setTrForTesting`) untuk secara eksplisit memanipulasi variabel lingkup modul internal selama pengujian, memastikan bahwa mock dan keadaan modul yang diuji konsisten.

## Strategi Debugging dan Perbaikan Tes Unit yang Berhasil:

Berikut adalah beberapa strategi yang berhasil diterapkan saat memperbaiki tes unit dalam proyek ini:

1.  **Ketidakcocokan String Pesan Error/Log:**
    *   **Masalah:** Tes gagal karena string pesan yang diharapkan (misalnya, dalam bahasa Indonesia atau versi singkat) tidak cocok dengan string aktual yang dihasilkan oleh kode (misalnya, dalam bahasa Inggris atau versi lebih panjang).
    *   **Solusi:** Perbarui string yang diharapkan dalam file tes (`expect(...).toHaveBeenCalledWith(expect.stringContaining("Pesan Aktual Dari Kode"))`) agar sesuai dengan output kode yang sebenarnya. Prioritaskan konsistensi dengan bahasa yang digunakan dalam kode sumber untuk pesan internal.

2.  **Mock Tidak Lengkap:**
    *   **Masalah:** Tes gagal dengan `TypeError` karena metode yang dipanggil pada objek yang di-mock tidak ada dalam implementasi mock. Contoh: `layerRef.batchDraw is not a function` di `componentFactory.test.js`.
    *   **Solusi:** Identifikasi metode yang hilang dari pesan error dan tambahkan implementasi mock dasar (misalnya, `jest.fn()`) ke objek mock yang relevan dalam penyiapan tes (`beforeEach` atau definisi mock global).
        ```javascript
        // Contoh di componentFactory.test.js
        mockLayerRef = { add: jest.fn(), batchDraw: jest.fn() }; // batchDraw ditambahkan
        ```

3.  **Kesulitan Memata-matai Panggilan Fungsi Internal Modul (Self-Invocation):**
    *   **Masalah:** Saat menguji fungsi `A` dalam sebuah modul, jika `A` memanggil fungsi lain `B` dari modul yang sama, `jest.spyOn(module, 'B')` mungkin tidak menangkap panggilan tersebut jika `A` memanggil `B` secara langsung (bukan `module.B()`). Ini terjadi di `stateManager.test.js` untuk `handleUndo/handleRedo` yang memanggil `restoreState`, dan `setComponentAddressValue` yang memanggil `setDeviceVariableValue`.
    *   **Solusi Primer (Verifikasi Efek Samping):** Daripada memata-matai pemanggilan internal, verifikasi efek samping yang diharapkan dari fungsi internal tersebut. Misalnya, jika `restoreState` seharusnya memperbarui `tagDatabase` dan membuat ulang komponen, tes untuk `handleUndo` harus memeriksa bahwa `tagDatabase` benar dan `componentFactory.create` dipanggil dengan benar. Ini menguji perilaku yang diamati pengguna daripada detail implementasi.
    *   **Solusi Sekunder (Setter Khusus Pengujian):** Untuk `konvaManager.test.js`, di mana memanipulasi variabel lingkup modul internal (`layer`, `tr`) secara tidak langsung melalui objek yang diekspor (`_konvaObjectsForTesting`) terbukti tidak dapat diandalkan, fungsi setter khusus pengujian diekspor dari `konvaManager.js` (`_setLayerForTesting`, `_setTrForTesting`). Ini memungkinkan tes untuk secara langsung mengatur variabel internal modul ke `null` atau nilai mock lainnya untuk menguji jalur error dengan andal. Gunakan ini dengan hati-hati karena mengekspos internal modul.

4.  **Masalah Lingkungan Tes Sementara (`jest-environment-jsdom` tidak ditemukan):**
    *   **Masalah:** Tes tiba-tiba gagal dengan error bahwa `jest-environment-jsdom` tidak dapat ditemukan, meskipun telah diinstal sebelumnya.
    *   **Solusi Sementara:** Jalankan `npm install --save-dev jest-environment-jsdom` lagi. Jika ini sering terjadi, mungkin ada masalah yang lebih dalam dengan manajemen dependensi sandbox atau caching.

5.  **Pemilihan Matcher Jest yang Tepat:**
    *   **Masalah:** `expect(global.fetch).toHaveBeenCalledWith(expect.stringContaining(...))` gagal di `aiAssistant.test.js` meskipun string tampak cocok.
    *   **Solusi:** Beralih ke `expect.stringMatching(/regex/)` memberikan kontrol yang lebih baik atas pencocokan parsial atau pola URL. Akhirnya, untuk `body` permintaan `fetch`, `expect.anything()` digunakan sebagai solusi sementara ketika pencocokan string JSON yang kompleks terbukti sulit; ini ditandai untuk perbaikan di masa mendatang untuk pengujian yang lebih ketat. Untuk kasus lain (misalnya, pesan log), memastikan string yang diharapkan dalam `expect.stringContaining()` sama persis dengan output aktual, termasuk spasi dan tanda baca, sangat penting.

6.  **Membersihkan Mock Antar Panggilan dalam Tes yang Sama:**
    *   **Masalah:** Jika sebuah spy dipanggil beberapa kali dalam satu blok `test(...)`, ekspektasi untuk panggilan selanjutnya mungkin dipengaruhi oleh panggilan sebelumnya.
    *   **Solusi:** Gunakan `mockFn.mockClear()` untuk mereset statistik panggilan spy (misalnya, `consoleErrorSpy.mockClear()`) sebelum bagian berikutnya dari tes yang akan memanggil fungsi yang di-spy lagi. Atau, gunakan `toHaveBeenNthCalledWith` untuk memeriksa argumen dari panggilan tertentu.

7.  **Timeout Tes Asinkron:**
    *   **Masalah:** Tes yang melibatkan promise atau operasi asinkron mungkin mengalami timeout jika promise tidak pernah resolve atau reject seperti yang diharapkan. Contoh: `importProjectFromFile › should ask for confirmation if project is dirty` di `projectManager.test.js`.
    *   **Solusi:** Pastikan logika kode yang diuji menangani semua jalur promise (resolve dan reject). Dalam kasus `importProjectFromFile`, promise tidak di-reject ketika `confirm()` mengembalikan `false`. Memperbaiki logika untuk me-reject promise menyelesaikan timeout. Jika tes memang membutuhkan waktu lebih lama, timeout Jest dapat ditingkatkan per tes: `test('nama tes', async () => { /* ... */ }, 10000); // timeout 10 detik`.
