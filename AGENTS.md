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

- **2024-07-18:** Menghadapi kesulitan dalam membuat unit test untuk `js/konvaManager.js` menggunakan Jest. Secara spesifik, panggilan ke `gridLayer.add(new Konva.Line(...))` di dalam fungsi `drawGrid` tidak terdeteksi oleh `toHaveBeenCalled()` pada mock instance `gridLayer`, meskipun panggilan ke metode lain pada instance yang sama (seperti `destroyChildren()`) berhasil terdeteksi. Berbagai strategi debugging telah dicoba, termasuk memastikan mock instance yang benar digunakan (dengan mengekspor objek internal untuk pengujian) dan memverifikasi bahwa metode tersebut memang di-mock sebagai `jest.fn()`. Masalah ini untuk sementara ditunda untuk melanjutkan progres pada area lain.
