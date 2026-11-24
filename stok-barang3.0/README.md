# StokPintar — Aplikasi Web Update Stok Harian & Resume Otomatis Bulanan

Aplikasi manajemen inventaris dan stok barang berbasis web dengan sistem **Multi-User Login (Admin & Staff)**, pencatatan **Barang Masuk & Barang Keluar Harian** beserta alasan mutasi (Terjual, Rusak/Kadaluarsa, Retur, Restock Supplier, Pemakaian Internal), serta **Resume Otomatis Bulanan**.

---

## ✨ Fitur Utama

1. **Autentikasi & Multi-User dengan Peran (Role-Based Access Control)**
   - **Administrator (`admin` / `admin123`)**: Akses penuh untuk mengelola Master Barang (tambah/edit/hapus), mengelola akun pengguna, mencatat transaksi harian, menghapus transaksi yang salah, dan mencetak/mengunduh resume bulanan.
   - **Staff Operasional (`staff` / `staff123`)**: Fokus pada pencatatan mutasi stok harian (Barang Masuk & Barang Keluar), memantau sisa stok, dan melihat resume bulanan tanpa bisa mengubah/menghapus master barang.

2. **Update Stok Harian (Barang Masuk & Keluar)**
   - Input cepat per tanggal dengan validasi stok otomatis (mencegah stok keluar melebihi sisa stok gudang).
   - Pilihan alasan terstruktur:
     - **Barang Masuk (+)**: `Pembelian / Restock Supplier`, `Retur dari Pelanggan`, `Hasil Produksi / Perakitan`, `Koreksi / Penyesuaian Masuk`.
     - **Barang Keluar (-)**: `Terjual`, `Rusak / Kadaluarsa`, `Retur ke Supplier`, `Pemakaian Internal`, `Koreksi / Penyesuaian Keluar`.
   - Peringatan otomatis (**Low Stock Alert**) jika stok barang berada di bawah batas minimum.

3. **Resume Otomatis Setiap Bulan**
   - Pilih periode bulan mana saja (`YYYY-MM`) dan sistem secara otomatis menghitung:
     - **Stok Awal Bulan** (akumulasi stok sebelum tanggal 1 bulan tersebut)
     - **Total Barang Masuk (+)** selama bulan tersebut
     - **Total Barang Keluar (-)** selama bulan tersebut beserta rincian **Terjual**, **Rusak**, dan **Retur/Lainnya**
     - **Perubahan Bersih (Net Change)** dan **Stok Akhir Bulan**
     - **Estimasi Nilai Persediaan Akhir (Rp)**
   - Visualisasi rekap berdasarkan alasan transaksi & tabel pergerakan stok per tanggal.
   - **Export ke CSV / Excel** satu klik dan **Cetak Laporan / Simpan PDF**.

---

## 🚀 Cara Menjalankan Aplikasi

Aplikasi ini dirancang dengan arsitektur **Dual-Mode** sehingga Anda dapat langsung menggunakannya sekarang juga maupun menjalankannya sebagai server penuh Node.js + SQLite:

### Cara 1: Langsung Pakai Tanpa Instalasi (Instant Browser Mode)
Buka langsung file berikut di browser Anda (Chrome / Edge / Firefox):
- `public/index.html`

> Saat dibuka langsung, aplikasi otomatis mengaktifkan **Database Lokal Browser (`localStorage`)** lengkap dengan data awal contoh sehingga seluruh fitur (Login, Input Harian, Resume Bulanan, Export CSV) langsung berfungsi 100%.

### Cara 2: Mode Server Penuh (Node.js + Express + SQLite)
Jika Anda ingin menjalankan backend server dengan database file SQLite (`data/inventory.db`):

1. Pastikan **Node.js** sudah terinstal di komputer Anda. Jika belum, buka PowerShell/Terminal dan jalankan:
   ```powershell
   winget install OpenJS.NodeJS.LTS
   ```
2. Masuk ke direktori proyek dan instal dependensi:
   ```powershell
   cd "C:\Users\barada indra sakti\.gemini\antigravity\scratch\stok-barang"
   npm install
   ```
3. Jalankan server:
   ```powershell
   npm start
   ```
4. Buka di browser: `http://localhost:3000`
