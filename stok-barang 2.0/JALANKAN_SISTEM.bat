@echo off
title Sistem Resmi StokPintar — SRI BARADA INDRA SAKTI
echo ============================================================
echo   SISTEM PRODUKSI RESMI — SRI BARADA INDRA SAKTI
echo   Manajemen Stok Barang Harian, Resume Bulanan ^& Pelanggan
echo ============================================================
echo.

where node >nul 2>nul
if %errorlevel%==0 (
  if not exist "node_modules" (
    echo Menginstal komponen server database...
    call npm install
  )
  echo Menjalankan Server Aplikasi (Supabase Cloud) di http://localhost:3000 ...
  start "" "http://localhost:3000"
  node server.js
) else (
  echo Membuka Aplikasi Sistem Produksi Resmi di Browser...
  start "" "%~dp0public\index.html"
)
