/**
 * StokPintar — SRI BARADA INDRA SAKTI
 * Aplikasi Web Manajemen Stok Harian & Resume Otomatis Bulanan
 * Mendukung Dual-Engine:
 * 1. Backend Node.js + Express + SQLite (/api/...) saat dijalankan via `npm start`
 * 2. Local Relational Engine (localStorage) otomatis jika dibuka langsung di browser
 */

const ALL_STOCK_REASONS = ['Pemasangan', 'Dijual', 'Rusak', 'Dismantle', 'Restok'];

const REASONS = {
  IN: ['Restok', 'Dismantle'],
  DISMANTLE: ['Dismantle'],
  OUT: ['Pemasangan', 'Dijual', 'Rusak']
};

const CUSTOMER_CATEGORIES = {
  IN: [
    'Pemasangan Baru (PSB)',
    'Reaktivasi Pelanggan Lama',
    'Tambah Titik / Upgrade Paket',
    'Migrasi / Pindah Alamat Masuk'
  ],
  OUT: [
    'Berhenti Berlangganan (Dismantle)',
    'Pindah Rumah / Area Tidak Tercover',
    'Isolir Permanen / Cabut',
    'Pindah Provider / Lainnya'
  ]
};

function isDismantleReason(reason) {
  return String(reason || '').toLowerCase().includes('dismantle');
}

function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const tablePagination = {
  tx: { page: 1, pageSize: '10' },
  monthlyItems: { page: 1, pageSize: '10' },
  items: { page: 1, pageSize: '10' }
};

function paginateRows(rows, key) {
  const state = tablePagination[key] || { page: 1, pageSize: '10' };
  const total = rows.length;
  if (state.pageSize === 'ALL') {
    state.page = 1;
    return { items: rows, page: 1, totalPages: 1, startIdx: total > 0 ? 1 : 0, endIdx: total, total };
  }
  const size = Math.max(1, parseInt(state.pageSize, 10) || 10);
  const totalPages = Math.max(1, Math.ceil(total / size));
  if (state.page > totalPages) state.page = totalPages;
  if (state.page < 1) state.page = 1;
  const start = (state.page - 1) * size;
  const sliced = rows.slice(start, start + size);
  return {
    items: sliced,
    page: state.page,
    totalPages,
    startIdx: total > 0 ? start + 1 : 0,
    endIdx: Math.min(start + sliced.length, total),
    total
  };
}

function renderTablePagination(containerId, key, info, renderFn) {
  const container = document.getElementById(containerId);
  if (!container) return;
  if (!info || info.total === 0) {
    container.innerHTML = '';
    return;
  }
  const state = tablePagination[key];
  const isAll = state.pageSize === 'ALL';
  container.innerHTML = `
    <div class="table-pagination-info">
      Menampilkan <strong>${info.startIdx}–${info.endIdx}</strong> dari <strong>${info.total}</strong> data
    </div>
    ${
      !isAll && info.totalPages > 1
        ? `<div class="table-pagination-controls">
            <button type="button" class="btn btn-outline btn-sm" data-pg-action="prev" ${info.page <= 1 ? 'disabled' : ''}>‹ Sebelumnya</button>
            <span class="table-pagination-page">Hal ${info.page} / ${info.totalPages}</span>
            <button type="button" class="btn btn-outline btn-sm" data-pg-action="next" ${info.page >= info.totalPages ? 'disabled' : ''}>Berikutnya ›</button>
          </div>`
        : ''
    }
  `;
  const prevBtn = container.querySelector('[data-pg-action="prev"]');
  const nextBtn = container.querySelector('[data-pg-action="next"]');
  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      if (state.page > 1) {
        state.page--;
        renderFn();
      }
    });
  }
  if (nextBtn) {
    nextBtn.addEventListener('click', () => {
      if (state.page < info.totalPages) {
        state.page++;
        renderFn();
      }
    });
  }
}

// ==================== HAK AKSES 5 ROLE PENGGUNA ====================
// 1. superadmin : Akses full (Stok Barang, Pelanggan GMDP/GENAP, Kelola Pengguna)
// 2. admin      : Melihat dan edit pelanggan GMDP dan GENAP saja
// 3. teknisi    : Melihat dan edit Stok Barang saja
// 4. spesial    : Melihat dan edit semua (Stok & Pelanggan), tapi tidak bisa tambah akses pengguna baru
// 5. viewer     : Hanya melihat Stok Barang dan Export saja (tidak bisa edit/hapus/input)
function normalizeRole(role) {
  const r = String(role || '').toLowerCase();
  if (['superadmin', 'admin', 'teknisi', 'spesial', 'viewer'].includes(r)) return r;
  if (r === 'staff') return 'teknisi';
  return 'teknisi';
}

function canAccessStock(role) {
  const r = normalizeRole(role);
  return ['superadmin', 'teknisi', 'spesial', 'viewer'].includes(r);
}

function canEditStock(role) {
  const r = normalizeRole(role);
  return ['superadmin', 'teknisi', 'spesial'].includes(r);
}

function canAccessCustomers(role) {
  const r = normalizeRole(role);
  return ['superadmin', 'admin', 'spesial'].includes(r);
}

function canManageUsers(role) {
  return normalizeRole(role) === 'superadmin';
}

function canAccessLogs(role) {
  return ['superadmin', 'spesial'].includes(normalizeRole(role));
}

function isCurrentPlatformAdmin() {
  if (!currentUser) return false;
  if (currentUser.is_platform_admin) return true;
  return normalizeRole(currentUser.role) === 'superadmin' && Number(currentUser.workspace_id || 1) === 1;
}

function formatRoleBadge(role) {
  const r = normalizeRole(role);
  const map = {
    superadmin: { label: '👑 SUPERADMIN (Akses Full)', badgeClass: 'badge-dismantle' },
    admin: { label: '🏢 ADMIN (Pelanggan GMDP & GENAP)', badgeClass: 'badge-info' },
    teknisi: { label: '🔧 TEKNISI (Stok Barang)', badgeClass: 'badge-in' },
    spesial: { label: '⭐ SPESIAL (Semua Tanpa Tambah User)', badgeClass: 'badge-warning' },
    viewer: { label: '👁️ VIEWER (Lihat & Export Stok)', badgeClass: 'badge-info' }
  };
  return map[r] || map.teknisi;
}

// ==================== ADAPTER DATABASE PRODUKSI (API SERVER + LOCAL DB) ====================
class DataService {
  constructor() {
    this.isServerMode = true;
    this.serverDbMode = 'supabase';
    this.serverReady = false;
    this.token = sessionStorage.getItem('stokpintar_token') || null;
    this.STORAGE_KEY = 'stokpintar_prod_db_v2';
  }

  async detectMode() {
    if (window.location.protocol === 'file:') {
      this.isServerMode = false;
      this.serverReady = false;
      this.ensureLocalSeed();
      return false;
    }
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      const res = await fetch('/api/health', {
        signal: controller.signal
      });
      clearTimeout(timeout);
      if (res.ok) {
        const info = await res.json().catch(() => ({}));
        this.serverDbMode = info.mode || 'supabase';
        this.serverReady = Boolean(info.ok);
        this.isServerMode = true;
        return true;
      }
    } catch (_) {
      // Tetap gunakan Server Mode agar data tidak disimpan ke localStorage/disk lokal
    }
    this.isServerMode = true;
    this.serverReady = false;
    return true;
  }

  ensureLocalSeed() {
    const raw = localStorage.getItem(this.STORAGE_KEY);
    if (raw) return JSON.parse(raw);

    const initialData = {
      base_customers: 0,
      base_gmdp: 0,
      base_genap: 0,
      users: [
        { id: 1, username: 'superadmin', password: 'super123', full_name: 'Superadmin Sri Barada', role: 'superadmin' },
        { id: 2, username: 'admin', password: 'admin123', full_name: 'Admin Pelanggan (GMDP & GENAP)', role: 'admin' },
        { id: 3, username: 'teknisi', password: 'teknisi123', full_name: 'Teknisi Stok Barang', role: 'teknisi' },
        { id: 4, username: 'spesial', password: 'spesial123', full_name: 'Akun Spesial Operasional', role: 'spesial' },
        { id: 5, username: 'viewer', password: 'viewer123', full_name: 'Viewer Stok Barang (Lihat & Export)', role: 'viewer' }
      ],
      items: [],
      transactions: [],
      customer_logs: []
    };

    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(initialData));
    return initialData;
  }

  getLocalDb() {
    return this.ensureLocalSeed();
  }

  saveLocalDb(db) {
    localStorage.setItem(this.STORAGE_KEY, JSON.stringify(db));
  }

  async apiFetch(url, options = {}) {
    const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    let res;
    try {
      res = await fetch(url, { ...options, headers });
    } catch (netErr) {
      throw new Error(
        `Gagal terhubung ke server (${url}). Pastikan server berjalan (npm start) atau deployment Vercel sudah aktif dan koneksi internet stabil.`
      );
    }
    const text = await res.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch (_) {
      data = { error: `Server mengembalikan respons tidak valid (HTTP ${res.status}).` };
    }
    if (!res.ok) {
      if (res.status === 402 && data.code === 'SUBSCRIPTION_EXPIRED') {
        if (typeof switchView === 'function' && currentUser) {
          switchView('subscription');
        }
      }
      if ((res.status === 401 || res.status === 403) && this.token && !url.includes('/api/auth/login')) {
        if (data.code !== 'QUOTA_EXCEEDED' && data.code !== 'WORKSPACE_DISABLED') {
          forceAutoLogout('Sesi login Anda telah berakhir (batas 2 jam). Silakan login kembali.');
        }
      }
      throw new Error(data.error || 'Terjadi kesalahan pada server.');
    }
    return data;
  }

  // ---- AUTH ----
  async login(username, password) {
    if (this.isServerMode) {
      const data = await this.apiFetch('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
      });
      this.token = data.token;
      currentSubscriptionCtx = data.subscription || null;
      sessionStorage.setItem('stokpintar_token', data.token);
      sessionStorage.setItem('stokpintar_user', JSON.stringify(data.user));
      sessionStorage.setItem('stokpintar_login_at', String(Date.now()));
      return data.user;
    }

    const db = this.getLocalDb();
    const user = db.users.find(
      (u) => u.username.toLowerCase() === username.trim().toLowerCase() && u.password === password
    );
    if (!user) throw new Error('Username atau password salah.');
    const safeUser = { id: user.id, username: user.username, full_name: user.full_name, role: user.role };
    sessionStorage.setItem('stokpintar_user', JSON.stringify(safeUser));
    sessionStorage.setItem('stokpintar_login_at', String(Date.now()));
    return safeUser;
  }

  getCurrentUser() {
    const raw = sessionStorage.getItem('stokpintar_user');
    return raw ? JSON.parse(raw) : null;
  }

  logout() {
    this.token = null;
    sessionStorage.removeItem('stokpintar_token');
    sessionStorage.removeItem('stokpintar_user');
    sessionStorage.removeItem('stokpintar_login_at');
    localStorage.removeItem('stokpintar_token');
    localStorage.removeItem('stokpintar_user');
    localStorage.removeItem('stokpintar_login_at');
  }

  // ---- ITEMS ----
  async getItems() {
    if (this.isServerMode) return this.apiFetch('/api/items');
    const db = this.getLocalDb();
    return [...db.items].sort((a, b) => a.name.localeCompare(b.name));
  }

  async saveItem(payload) {
    if (this.isServerMode) {
      if (payload.id) {
        return this.apiFetch(`/api/items/${payload.id}`, {
          method: 'PUT',
          body: JSON.stringify(payload)
        });
      }
      return this.apiFetch('/api/items', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
    }

    const db = this.getLocalDb();
    const skuNorm = payload.sku.trim().toUpperCase();
    const duplicate = db.items.find((i) => i.sku === skuNorm && i.id !== Number(payload.id));
    if (duplicate) throw new Error('Kode SKU sudah digunakan oleh barang lain.');

    if (payload.id) {
      const idx = db.items.findIndex((i) => i.id === Number(payload.id));
      if (idx === -1) throw new Error('Barang tidak ditemukan.');
      db.items[idx] = {
        ...db.items[idx],
        sku: skuNorm,
        name: payload.name.trim(),
        category: payload.category.trim(),
        unit: payload.unit,
        min_stock: Number(payload.min_stock) || 0,
        price: Number(payload.price) || 0
      };
      this.saveLocalDb(db);
      return db.items[idx];
    } else {
      const nextId = db.items.reduce((max, i) => Math.max(max, i.id), 0) + 1;
      const initStock = Math.max(0, Number(payload.initial_stock) || 0);
      const newItem = {
        id: nextId,
        sku: skuNorm,
        name: payload.name.trim(),
        category: payload.category.trim(),
        unit: payload.unit || 'Pcs',
        min_stock: Math.max(0, Number(payload.min_stock) || 0),
        price: Math.max(0, Number(payload.price) || 0),
        initial_stock: initStock,
        current_stock: initStock
      };
      db.items.push(newItem);
      this.saveLocalDb(db);
      return newItem;
    }
  }

  async deleteItem(id) {
    if (this.isServerMode) {
      return this.apiFetch(`/api/items/${id}`, { method: 'DELETE' });
    }
    const db = this.getLocalDb();
    db.items = db.items.filter((i) => i.id !== Number(id));
    db.transactions = db.transactions.filter((t) => t.item_id !== Number(id));
    this.saveLocalDb(db);
    return { success: true };
  }

  async bulkDeleteItems(ids) {
    const validIds = (ids || []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0);
    if (validIds.length === 0) throw new Error('Pilih minimal 1 barang yang ingin dihapus.');
    if (this.isServerMode) {
      return this.apiFetch('/api/items/bulk-delete', {
        method: 'POST',
        body: JSON.stringify({ ids: validIds })
      });
    }
    const idSet = new Set(validIds);
    const db = this.getLocalDb();
    db.items = db.items.filter((i) => !idSet.has(Number(i.id)));
    db.transactions = db.transactions.filter((t) => !idSet.has(Number(t.item_id)));
    this.saveLocalDb(db);
    return { success: true, deleted_count: validIds.length };
  }

  // ---- TRANSACTIONS ----
  async getTransactions(filters = {}) {
    let rows = [];
    if (this.isServerMode) {
      const params = new URLSearchParams();
      if (filters.date) params.set('date', filters.date);
      if (filters.month) params.set('month', filters.month);
      if (filters.type && ['IN', 'OUT'].includes(filters.type)) params.set('type', filters.type);
      if (filters.type === 'DISMANTLE') params.set('type', 'IN');
      rows = await this.apiFetch(`/api/transactions?${params.toString()}`);
    } else {
      const db = this.getLocalDb();
      rows = db.transactions.map((t) => {
        const item = db.items.find((i) => i.id === Number(t.item_id)) || {};
        const user = db.users.find((u) => u.id === Number(t.user_id)) || {};
        return {
          ...t,
          sku: item.sku || '-',
          item_name: item.name || 'Barang Terhapus',
          unit: item.unit || 'Pcs',
          user_name: user.full_name || 'Petugas'
        };
      });

      if (filters.date) {
        rows = rows.filter((t) => t.date === filters.date);
      }
      if (filters.month) {
        rows = rows.filter((t) => String(t.date || '').startsWith(filters.month));
      }
      if (filters.type === 'IN' || filters.type === 'OUT') {
        rows = rows.filter((t) => t.type === filters.type);
      }
      rows.sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
    }

    if (filters.type === 'DISMANTLE') {
      rows = rows.filter((t) => t.type === 'IN' && isDismantleReason(t.reason));
    }

    return rows;
  }

  async addTransaction(payload) {
    if (this.isServerMode) {
      return this.apiFetch('/api/transactions', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
    }

    const db = this.getLocalDb();
    const item = db.items.find((i) => i.id === Number(payload.item_id));
    if (!item) throw new Error('Barang tidak ditemukan.');

    const qty = Number(payload.quantity);
    if (!qty || qty <= 0) throw new Error('Jumlah barang harus lebih dari 0.');

    if (payload.type === 'OUT' && item.current_stock < qty) {
      throw new Error(`Stok tidak mencukupi! Stok "${item.name}" saat ini hanya ${item.current_stock} ${item.unit}.`);
    }

    item.current_stock = payload.type === 'IN' ? item.current_stock + qty : item.current_stock - qty;
    const nextId = db.transactions.reduce((max, t) => Math.max(max, t.id), 0) + 1;
    const currentUser = this.getCurrentUser() || { id: 1 };

    const isSold = payload.type === 'OUT' && String(payload.reason || '').toLowerCase().includes('dijual');
    const sellPrice = isSold ? Math.max(0, parseFloat(payload.sell_price) || 0) : 0;

    const newTx = {
      id: nextId,
      item_id: item.id,
      type: payload.type,
      quantity: qty,
      reason: payload.reason,
      date: payload.date,
      notes: payload.notes || '',
      sell_price: sellPrice,
      total_sell_price: isSold ? sellPrice * qty : 0,
      user_id: currentUser.id
    };
    db.transactions.push(newTx);
    this.saveLocalDb(db);
    return newTx;
  }

  async deleteTransaction(id) {
    if (this.isServerMode) {
      return this.apiFetch(`/api/transactions/${id}`, { method: 'DELETE' });
    }

    const db = this.getLocalDb();
    const tx = db.transactions.find((t) => t.id === Number(id));
    if (!tx) throw new Error('Transaksi tidak ditemukan.');

    const item = db.items.find((i) => i.id === Number(tx.item_id));
    if (item) {
      const reverted = tx.type === 'IN' ? item.current_stock - tx.quantity : item.current_stock + tx.quantity;
      if (reverted < 0) throw new Error('Tidak dapat menghapus transaksi karena stok akhir akan menjadi minus.');
      item.current_stock = reverted;
    }

    db.transactions = db.transactions.filter((t) => t.id !== Number(id));
    this.saveLocalDb(db);
    return { success: true };
  }

  async bulkDeleteTransactions(ids) {
    const validIds = (ids || []).map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0);
    if (validIds.length === 0) throw new Error('Pilih minimal 1 transaksi yang ingin dihapus.');
    if (this.isServerMode) {
      return this.apiFetch('/api/transactions/bulk-delete', {
        method: 'POST',
        body: JSON.stringify({ ids: validIds })
      });
    }

    const idSet = new Set(validIds);
    const db = this.getLocalDb();
    const targetTxs = db.transactions.filter((t) => idSet.has(Number(t.id)));
    if (targetTxs.length === 0) throw new Error('Transaksi yang dipilih tidak ditemukan.');

    const deltaByItem = {};
    targetTxs.forEach((tx) => {
      const d = tx.type === 'IN' ? -Number(tx.quantity || 0) : Number(tx.quantity || 0);
      deltaByItem[tx.item_id] = (deltaByItem[tx.item_id] || 0) + d;
    });

    for (const item of db.items) {
      if (deltaByItem[item.id]) {
        const nextStock = Number(item.current_stock || 0) + deltaByItem[item.id];
        if (nextStock < 0) {
          throw new Error(`Tidak dapat menghapus transaksi terpilih karena stok "${item.name}" akan menjadi minus.`);
        }
      }
    }

    db.items.forEach((item) => {
      if (deltaByItem[item.id]) {
        item.current_stock = Number(item.current_stock || 0) + deltaByItem[item.id];
      }
    });
    db.transactions = db.transactions.filter((t) => !idSet.has(Number(t.id)));
    this.saveLocalDb(db);
    return { success: true, deleted_count: targetTxs.length };
  }

  // ---- MONTHLY RESUME ----
  async getMonthlyReport(month) {
    if (this.isServerMode) {
      return this.apiFetch(`/api/reports/monthly?month=${encodeURIComponent(month)}`);
    }

    const db = this.getLocalDb();
    const startOfMonth = `${month}-01`;
    const items = [...db.items].sort((a, b) => a.name.localeCompare(b.name));
    const allTransactions = [...db.transactions].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);

    const itemSummaries = items.map((item) => {
      const txBefore = allTransactions.filter((t) => t.item_id === item.id && t.date < startOfMonth);
      const netBefore = txBefore.reduce((acc, t) => acc + (t.type === 'IN' ? t.quantity : -t.quantity), 0);
      const openingStock = item.initial_stock + netBefore;

      const txInMonth = allTransactions.filter((t) => t.item_id === item.id && t.date.startsWith(month));

      let totalIn = 0;
      let dismantleInCount = 0;
      let totalOut = 0;
      let installCount = 0;
      let soldCount = 0;
      let damagedCount = 0;
      let returnCount = 0;
      let otherOutCount = 0;

      txInMonth.forEach((t) => {
        if (t.type === 'IN') {
          totalIn += t.quantity;
          if (isDismantleReason(t.reason)) {
            dismantleInCount += t.quantity;
          }
        } else {
          totalOut += t.quantity;
          const r = t.reason.toLowerCase();
          if (r.includes('pemasangan') || r.includes('pasang')) installCount += t.quantity;
          else if (r.includes('dijual') || r.includes('terjual')) soldCount += t.quantity;
          else if (r.includes('rusak') || r.includes('kadaluarsa')) damagedCount += t.quantity;
          else if (r.includes('retur')) returnCount += t.quantity;
          else otherOutCount += t.quantity;
        }
      });

      const closingStock = openingStock + totalIn - totalOut;
      return {
        item_id: item.id,
        sku: item.sku,
        name: item.name,
        category: item.category,
        unit: item.unit,
        price: item.price,
        opening_stock: openingStock,
        total_in: totalIn,
        dismantle_in_count: dismantleInCount,
        regular_in_count: totalIn - dismantleInCount,
        total_out: totalOut,
        install_count: installCount,
        sold_count: soldCount,
        damaged_count: damagedCount,
        return_count: returnCount,
        other_out_count: otherOutCount,
        net_change: totalIn - totalOut,
        closing_stock: closingStock,
        stock_value: closingStock * item.price,
        tx_count: txInMonth.length
      };
    });

    const monthTx = allTransactions.filter((t) => t.date.startsWith(month));
    const reasonBreakdown = {};
    const dailyBreakdownMap = {};

    monthTx.forEach((t) => {
      const key = `${t.type}::${t.reason}`;
      if (!reasonBreakdown[key]) {
        reasonBreakdown[key] = { type: t.type, reason: t.reason, total_quantity: 0, tx_count: 0 };
      }
      reasonBreakdown[key].total_quantity += t.quantity;
      reasonBreakdown[key].tx_count += 1;

      if (!dailyBreakdownMap[t.date]) {
        dailyBreakdownMap[t.date] = { date: t.date, total_in: 0, dismantle_in: 0, total_out: 0, tx_count: 0 };
      }
      if (t.type === 'IN') {
        dailyBreakdownMap[t.date].total_in += t.quantity;
        if (isDismantleReason(t.reason)) {
          dailyBreakdownMap[t.date].dismantle_in += t.quantity;
        }
      } else {
        dailyBreakdownMap[t.date].total_out += t.quantity;
      }
      dailyBreakdownMap[t.date].tx_count += 1;
    });

    const totals = itemSummaries.reduce(
      (acc, row) => {
        acc.opening_stock += row.opening_stock;
        acc.total_in += row.total_in;
        acc.dismantle_in_count += row.dismantle_in_count;
        acc.total_out += row.total_out;
        acc.install_count += row.install_count;
        acc.sold_count += row.sold_count;
        acc.damaged_count += row.damaged_count;
        acc.closing_stock += row.closing_stock;
        acc.total_stock_value += row.stock_value;
        return acc;
      },
      {
        opening_stock: 0,
        total_in: 0,
        dismantle_in_count: 0,
        total_out: 0,
        install_count: 0,
        sold_count: 0,
        damaged_count: 0,
        closing_stock: 0,
        total_stock_value: 0
      }
    );

    return {
      month,
      totals,
      items: itemSummaries,
      reasons: Object.values(reasonBreakdown),
      daily: Object.values(dailyBreakdownMap).sort((a, b) => a.date.localeCompare(b.date))
    };
  }

  // ---- USERS ----
  async getUsers() {
    if (this.isServerMode) return this.apiFetch('/api/users');
    const db = this.getLocalDb();
    return db.users.map(({ password, ...u }) => u);
  }

  async addUser(payload) {
    if (this.isServerMode) {
      return this.apiFetch('/api/users', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
    }
    const db = this.getLocalDb();
    const exists = db.users.find((u) => u.username.toLowerCase() === payload.username.trim().toLowerCase());
    if (exists) throw new Error('Username sudah terdaftar.');
    const nextId = db.users.reduce((max, u) => Math.max(max, u.id), 0) + 1;
    const validRole = normalizeRole(payload.role);
    const newUser = {
      id: nextId,
      username: payload.username.trim().toLowerCase(),
      password: payload.password,
      full_name: payload.full_name.trim(),
      role: validRole
    };
    db.users.push(newUser);
    this.saveLocalDb(db);
    return newUser;
  }

  async deleteUser(id) {
    if (this.isServerMode) {
      return this.apiFetch(`/api/users/${id}`, { method: 'DELETE' });
    }
    const current = this.getCurrentUser();
    if (current && Number(id) === current.id) {
      throw new Error('Tidak dapat menghapus akun Anda sendiri yang sedang login.');
    }
    const db = this.getLocalDb();
    db.users = db.users.filter((u) => u.id !== Number(id));
    this.saveLocalDb(db);
    return { success: true };
  }

  async updateUserPassword(id, newPassword) {
    if (!newPassword || newPassword.trim().length < 4) {
      throw new Error('Password minimal 4 karakter.');
    }
    if (this.isServerMode) {
      return this.apiFetch(`/api/users/${id}/password`, {
        method: 'PUT',
        body: JSON.stringify({ password: newPassword.trim() })
      });
    }
    const db = this.getLocalDb();
    const user = db.users.find((u) => u.id === Number(id));
    if (!user) throw new Error('Pengguna tidak ditemukan.');
    user.password = newPassword.trim();
    this.saveLocalDb(db);
    return { success: true };
  }

  // ---- ACTIVITY LOGS ----
  async getActivityLogs(filters = {}) {
    if (this.isServerMode) {
      const params = new URLSearchParams();
      if (filters.action_type && filters.action_type !== 'ALL') params.set('action_type', filters.action_type);
      if (filters.date) params.set('date', filters.date);
      return this.apiFetch(`/api/logs?${params.toString()}`);
    }
    const raw = localStorage.getItem('stokpintar_activity_logs_v1');
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 2);
    const cutoffMs = cutoff.getTime();
    let rows = (raw ? JSON.parse(raw) : []).filter((r) => {
      const ts = new Date(r.created_at || 0).getTime();
      return !Number.isNaN(ts) && ts >= cutoffMs;
    });
    localStorage.setItem('stokpintar_activity_logs_v1', JSON.stringify(rows));
    if (filters.action_type && filters.action_type !== 'ALL') {
      rows = rows.filter((r) => r.action_type === filters.action_type);
    }
    if (filters.date) {
      rows = rows.filter((r) => String(r.created_at || '').startsWith(filters.date));
    }
    return rows;
  }

  async recordExportLog(target, detail) {
    if (this.isServerMode) {
      if (!this.token) return;
      try {
        await this.apiFetch('/api/logs/export', {
          method: 'POST',
          body: JSON.stringify({ target, detail })
        });
      } catch (_) {
        // Jangan gagalkan proses download file jika pencatatan log gagal
      }
      return;
    }
    const u = this.getCurrentUser();
    if (!u) return;
    const raw = localStorage.getItem('stokpintar_activity_logs_v1');
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - 2);
    const cutoffMs = cutoff.getTime();
    const rows = (raw ? JSON.parse(raw) : []).filter((r) => {
      const ts = new Date(r.created_at || 0).getTime();
      return !Number.isNaN(ts) && ts >= cutoffMs;
    });
    rows.unshift({
      id: Date.now(),
      user_id: u.id,
      username: u.username,
      full_name: u.full_name,
      role: u.role,
      action_type: 'EXPORT',
      target: target || 'Export Data',
      detail: detail || '',
      created_at: new Date().toISOString()
    });
    localStorage.setItem('stokpintar_activity_logs_v1', JSON.stringify(rows.slice(0, 300)));
  }

  exportFullBackup() {
    return {
      system: 'StokPintar — SRI BARADA INDRA SAKTI (Produksi Resmi)',
      exported_at: new Date().toISOString(),
      inventory_db: this.getLocalDb(),
      folder_gmdp: this.ensureCompanyFolderSeed('GMDP'),
      folder_genap: this.ensureCompanyFolderSeed('GENAP')
    };
  }

  async exportAllSystemData() {
    let baseData;
    if (this.mode === 'api') {
      baseData = await this.apiFetch('/api/database/export');
    } else {
      const localDb = this.getLocalDb();
      const safeUsers = (localDb.users || []).map(({ password, password_hash, ...rest }) => rest);
      baseData = {
        system: 'StokPintar — SRI BARADA INDRA SAKTI (Produksi Resmi)',
        exported_at: new Date().toISOString(),
        exported_by: currentUser ? currentUser.full_name || currentUser.username : 'Superadmin',
        inventory_db: {
          items: localDb.items || [],
          transactions: localDb.transactions || [],
          users: safeUsers
        },
        activity_logs: await this.getActivityLogs()
      };
    }

    return {
      ...baseData,
      folder_gmdp: this.ensureCompanyFolderSeed('GMDP'),
      folder_genap: this.ensureCompanyFolderSeed('GENAP')
    };
  }

  importFullBackup(backupObj) {
    if (!backupObj || !backupObj.inventory_db) {
      throw new Error('File backup tidak valid.');
    }
    this.saveLocalDb(backupObj.inventory_db);
    if (backupObj.folder_gmdp) this.saveCompanyFolderDb('GMDP', backupObj.folder_gmdp);
    if (backupObj.folder_genap) this.saveCompanyFolderDb('GENAP', backupObj.folder_genap);
    return { success: true };
  }

  mergeCustomerFolder(company, incomingFolder) {
    if (!incomingFolder || typeof incomingFolder !== 'object') return 0;
    const current = this.ensureCompanyFolderSeed(company);
    const existingLogs = Array.isArray(current.customer_logs) ? current.customer_logs : [];
    const logKeys = new Set(
      existingLogs.map(
        (l) => `${l.date || ''}|${l.type || ''}|${Number(l.count || 0)}|${String(l.customer_name || '').trim()}|${String(l.notes || '').trim()}`
      )
    );
    let addedLogs = 0;
    let nextId = existingLogs.reduce((m, l) => Math.max(m, Number(l.id) || 0), 0) + 1;
    (Array.isArray(incomingFolder.customer_logs) ? incomingFolder.customer_logs : []).forEach((l) => {
      if (!l) return;
      const key = `${l.date || ''}|${l.type || ''}|${Number(l.count || 0)}|${String(l.customer_name || '').trim()}|${String(l.notes || '').trim()}`;
      if (!logKeys.has(key)) {
        logKeys.add(key);
        existingLogs.push({ ...l, id: nextId++ });
        addedLogs++;
      }
    });
    current.customer_logs = existingLogs;

    if (incomingFolder.monthly_manual && typeof incomingFolder.monthly_manual === 'object') {
      current.monthly_manual = current.monthly_manual || {};
      Object.keys(incomingFolder.monthly_manual).forEach((monthKey) => {
        if (!current.monthly_manual[monthKey]) {
          current.monthly_manual[monthKey] = incomingFolder.monthly_manual[monthKey];
        }
      });
    }
    this.saveCompanyFolderDb(company, current);
    return addedLogs;
  }

  async importMergeBackup(backupObj) {
    if (!backupObj || typeof backupObj !== 'object') {
      throw new Error('Format file JSON tidak valid.');
    }
    const inv = backupObj.inventory_db && typeof backupObj.inventory_db === 'object' ? backupObj.inventory_db : backupObj;
    const hasInventory = Array.isArray(inv.items) || Array.isArray(inv.transactions);
    const hasFolders = Boolean(backupObj.folder_gmdp || backupObj.folder_genap);
    if (!hasInventory && !hasFolders) {
      throw new Error('File JSON tidak mengandung data barang, transaksi, atau folder pelanggan.');
    }

    let summary = {
      added_items: 0,
      skipped_items: 0,
      added_transactions: 0,
      skipped_transactions: 0,
      added_customer_logs: 0
    };

    if (hasInventory) {
      if (this.mode === 'api') {
        const res = await this.apiFetch('/api/database/import-merge', {
          method: 'POST',
          body: JSON.stringify({
            items: Array.isArray(inv.items) ? inv.items : [],
            transactions: Array.isArray(inv.transactions) ? inv.transactions : []
          })
        });
        summary.added_items = res.added_items || 0;
        summary.skipped_items = res.skipped_items || 0;
        summary.added_transactions = res.added_transactions || 0;
        summary.skipped_transactions = res.skipped_transactions || 0;
      } else {
        const db = this.getLocalDb();
        const skuMap = new Map();
        const oldIdToItem = new Map();
        const preExistingIds = new Set();
        db.items.forEach((it) => {
          skuMap.set(String(it.sku || '').trim().toUpperCase(), it);
          preExistingIds.add(it.id);
        });
        let nextItemId = db.items.reduce((m, i) => Math.max(m, Number(i.id) || 0), 0) + 1;

        (Array.isArray(inv.items) ? inv.items : []).forEach((it) => {
          const sku = String(it && it.sku ? it.sku : '').trim().toUpperCase();
          const name = String(it && it.name ? it.name : '').trim();
          if (!sku || !name) {
            summary.skipped_items++;
            return;
          }
          if (skuMap.has(sku)) {
            if (it.id != null) oldIdToItem.set(String(it.id), skuMap.get(sku));
            summary.skipped_items++;
            return;
          }
          const newItem = {
            ...it,
            id: nextItemId++,
            sku,
            name,
            category: String(it.category || 'Lainnya').trim(),
            unit: String(it.unit || 'Pcs').trim(),
            min_stock: Math.max(0, parseInt(it.min_stock, 10) || 0),
            initial_stock: Math.max(0, parseInt(it.initial_stock, 10) || 0),
            current_stock:
              it.current_stock !== undefined && it.current_stock !== null
                ? Math.max(0, parseInt(it.current_stock, 10) || 0)
                : Math.max(0, parseInt(it.initial_stock, 10) || 0)
          };
          db.items.push(newItem);
          skuMap.set(sku, newItem);
          if (it.id != null) oldIdToItem.set(String(it.id), newItem);
          summary.added_items++;
        });

        const txKeys = new Set(
          db.transactions.map(
            (t) =>
              `${t.date || ''}|${t.item_id}|${t.type || ''}|${Number(t.quantity || 0)}|${String(t.reason || '').trim()}|${String(t.notes || '').trim()}`
          )
        );
        let nextTxId = db.transactions.reduce((m, t) => Math.max(m, Number(t.id) || 0), 0) + 1;

        (Array.isArray(inv.transactions) ? inv.transactions : []).forEach((tx) => {
          if (!tx) {
            summary.skipped_transactions++;
            return;
          }
          const txSku = String(tx.sku || '').trim().toUpperCase();
          let targetItem = txSku ? skuMap.get(txSku) : null;
          if (!targetItem && tx.item_id != null) targetItem = oldIdToItem.get(String(tx.item_id)) || null;
          if (!targetItem) {
            summary.skipped_transactions++;
            return;
          }
          const type = String(tx.type || '').toUpperCase();
          const qty = parseInt(tx.quantity, 10);
          const dateStr = String(tx.date || '').slice(0, 10);
          const reason = String(tx.reason || '').trim();
          const notes = String(tx.notes || '').trim();
          const key = `${dateStr}|${targetItem.id}|${type}|${qty}|${reason}|${notes}`;
          if (!['IN', 'OUT'].includes(type) || !Number.isFinite(qty) || qty <= 0 || !dateStr || !reason || txKeys.has(key)) {
            summary.skipped_transactions++;
            return;
          }
          txKeys.add(key);
          db.transactions.push({
            ...tx,
            id: nextTxId++,
            item_id: targetItem.id,
            sku: targetItem.sku,
            item_name: targetItem.name,
            unit: targetItem.unit,
            type,
            quantity: qty,
            date: dateStr,
            reason,
            notes
          });
          if (preExistingIds.has(targetItem.id)) {
            targetItem.current_stock =
              type === 'IN' ? targetItem.current_stock + qty : Math.max(0, targetItem.current_stock - qty);
          }
          summary.added_transactions++;
        });

        this.saveLocalDb(db);
      }
    }

    if (backupObj.folder_gmdp) summary.added_customer_logs += this.mergeCustomerFolder('GMDP', backupObj.folder_gmdp);
    if (backupObj.folder_genap) summary.added_customer_logs += this.mergeCustomerFolder('GENAP', backupObj.folder_genap);

    return summary;
  }

  clearAllTransactions() {
    const db = this.getLocalDb();
    db.transactions = [];
    db.items.forEach((i) => {
      i.current_stock = i.initial_stock || 0;
    });
    this.saveLocalDb(db);

    ['GMDP', 'GENAP'].forEach((c) => {
      const fDb = this.ensureCompanyFolderSeed(c);
      fDb.customer_logs = [];
      fDb.monthly_manual = {};
      this.saveCompanyFolderDb(c, fDb);
    });
    return { success: true };
  }

  // ---- MANAJEMEN DAFTAR BEBERAPA EMAIL PENERIMA BACKUP ----
  getBackupEmailSettings() {
    const key = 'stokpintar_backup_emails_v1';
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);

    const initial = {
      smtp_sender: '',
      smtp_password: '',
      last_sent_info: '',
      emails: [
        { id: 1, label: 'Email Backup Utama Sri Barada', email: 'backup.sribarada@gmail.com', selected: true },
        { id: 2, label: 'Email Pimpinan / Owner', email: 'owner.sribarada@gmail.com', selected: true },
        { id: 3, label: 'Email Admin Operasional', email: 'admin.sribarada@gmail.com', selected: true }
      ]
    };
    localStorage.setItem(key, JSON.stringify(initial));
    return initial;
  }

  saveBackupEmailSettings(settings) {
    localStorage.setItem('stokpintar_backup_emails_v1', JSON.stringify(settings));
  }

  addBackupEmails(label, emailInput) {
    const settings = this.getBackupEmailSettings();
    const parts = String(emailInput || '')
      .split(/[,;\s]+/)
      .map((s) => s.trim().toLowerCase())
      .filter((s) => s && s.includes('@'));

    if (parts.length === 0) {
      throw new Error('Masukkan minimal satu alamat email yang valid (mengandung @).');
    }

    let nextId = settings.emails.reduce((max, e) => Math.max(max, e.id), 0) + 1;
    parts.forEach((addr, idx) => {
      const exists = settings.emails.find((e) => e.email.toLowerCase() === addr);
      if (!exists) {
        settings.emails.push({
          id: nextId++,
          label: parts.length > 1 ? `${label.trim()} (${idx + 1})` : label.trim(),
          email: addr,
          selected: true
        });
      }
    });

    this.saveBackupEmailSettings(settings);
    return settings;
  }

  toggleBackupEmail(id, selected) {
    const settings = this.getBackupEmailSettings();
    const target = settings.emails.find((e) => e.id === Number(id));
    if (target) {
      target.selected = Boolean(selected);
      this.saveBackupEmailSettings(settings);
    }
    return settings;
  }

  toggleAllBackupEmails(selected) {
    const settings = this.getBackupEmailSettings();
    settings.emails.forEach((e) => {
      e.selected = Boolean(selected);
    });
    this.saveBackupEmailSettings(settings);
    return settings;
  }

  deleteBackupEmail(id) {
    const settings = this.getBackupEmailSettings();
    settings.emails = settings.emails.filter((e) => e.id !== Number(id));
    this.saveBackupEmailSettings(settings);
    return settings;
  }

  saveSmtpConfig(senderEmail, appPassword) {
    const settings = this.getBackupEmailSettings();
    settings.smtp_sender = String(senderEmail || '').trim();
    settings.smtp_password = String(appPassword || '').trim();
    this.saveBackupEmailSettings(settings);
    return settings;
  }

  recordLastBackupSent(infoText) {
    const settings = this.getBackupEmailSettings();
    settings.last_sent_info = infoText;
    this.saveBackupEmailSettings(settings);
  }

  async sendBackupViaServerSmtp(recipients, backupData, summaryText) {
    const settings = this.getBackupEmailSettings();
    return this.apiFetch('/api/backup/send-email', {
      method: 'POST',
      body: JSON.stringify({
        recipients,
        smtp_sender: settings.smtp_sender,
        smtp_password: settings.smtp_password,
        backup_data: backupData,
        summary_text: summaryText
      })
    });
  }

  // ---- FOLDER PELANGGAN TERPISAH: GMDP & GENAP (PRODUKSI RESMI) ----
  getFolderStorageKey(company) {
    const c = String(company || 'GMDP').toUpperCase() === 'GENAP' ? 'GENAP' : 'GMDP';
    return `stokpintar_prod_${c.toLowerCase()}_v1`;
  }

  ensureCompanyFolderSeed(company) {
    const c = String(company || 'GMDP').toUpperCase() === 'GENAP' ? 'GENAP' : 'GMDP';
    const key = this.getFolderStorageKey(c);
    const raw = localStorage.getItem(key);
    if (raw) return JSON.parse(raw);

    const yyyy = String(new Date().getFullYear());
    const folderData = {
      company: c,
      base_customers: 0,
      monthly_manual: {},
      yearly_manual: {
        [yyyy]: { year: yyyy, manual_opening: null, manual_in: null, manual_out: null, notes: '' }
      },
      customer_logs: []
    };

    localStorage.setItem(key, JSON.stringify(folderData));
    return folderData;
  }

  saveCompanyFolderDb(company, data) {
    const key = this.getFolderStorageKey(company);
    localStorage.setItem(key, JSON.stringify(data));
  }

  async getFolderSummary(company, month) {
    const comp = String(company || 'GMDP').toUpperCase() === 'GENAP' ? 'GENAP' : 'GMDP';
    const year = (month || getCurrentMonthStr()).slice(0, 4);

    if (this.isServerMode) {
      return this.apiFetch(
        `/api/folder/${comp}/summary?year=${encodeURIComponent(year)}&month=${encodeURIComponent(month)}`
      );
    }

    const fDb = this.ensureCompanyFolderSeed(comp);
    const baseCustomers = Number(fDb.base_customers || 0);
    const allLogs = [...(fDb.customer_logs || [])].sort((a, b) => a.date.localeCompare(b.date) || a.id - b.id);
    const monthlyOverrides = fDb.monthly_manual || {};
    const yearlyOverrides = fDb.yearly_manual || {};
    const deletedMonths = new Set(fDb.deleted_months || []);
    const deletedYears = new Set(fDb.deleted_years || []);

    const curY = new Date().getFullYear();
    const yearSet = new Set([String(curY - 2), String(curY - 1), String(curY), String(year)]);
    Object.keys(yearlyOverrides).forEach((y) => yearSet.add(y));
    Object.keys(monthlyOverrides).forEach((m) => yearSet.add(m.slice(0, 4)));
    allLogs.forEach((l) => {
      if (l.date && l.date.length >= 4) yearSet.add(l.date.slice(0, 4));
    });
    const sortedYears = Array.from(yearSet)
      .filter((y) => !deletedYears.has(y))
      .sort();
    if (sortedYears.length === 0) sortedYears.push(String(year));

    let runningCustomers = baseCustomers;
    const allYearsMonthlyMap = {};
    const yearlyTraffic = [];

    sortedYears.forEach((yStr) => {
      const yOverride = yearlyOverrides[yStr];
      if (
        yOverride &&
        yOverride.manual_opening !== null &&
        yOverride.manual_opening !== undefined &&
        yOverride.manual_opening !== ''
      ) {
        runningCustomers = Number(yOverride.manual_opening);
      }

      const yearOpening = runningCustomers;
      let yearInSum = 0;
      let yearOutSum = 0;
      const monthsInYear = [];

      for (let m = 1; m <= 12; m++) {
        const mStr = `${yStr}-${String(m).padStart(2, '0')}`;
        if (deletedMonths.has(mStr)) {
          continue;
        }
        const mOverride = monthlyOverrides[mStr];
        const logsInM = allLogs.filter((l) => l.date.startsWith(mStr));
        const logIn = logsInM.filter((l) => l.type === 'IN').reduce((s, l) => s + l.count, 0);
        const logOut = logsInM.filter((l) => l.type === 'OUT').reduce((s, l) => s + l.count, 0);

        const isManualMonth = Boolean(mOverride);
        if (
          isManualMonth &&
          mOverride.manual_opening !== null &&
          mOverride.manual_opening !== undefined &&
          mOverride.manual_opening !== ''
        ) {
          runningCustomers = Number(mOverride.manual_opening);
        }

        const mOpen = runningCustomers;
        const mIn = isManualMonth ? Number(mOverride.manual_in) : logIn;
        const mOut = isManualMonth ? Number(mOverride.manual_out) : logOut;
        const mNet = mIn - mOut;
        const mClose = mOpen + mNet;
        runningCustomers = mClose;

        yearInSum += mIn;
        yearOutSum += mOut;

        monthsInYear.push({
          month: mStr,
          opening_customers: mOpen,
          customers_in: mIn,
          customers_out: mOut,
          net_growth: mNet,
          closing_customers: mClose,
          is_manual: isManualMonth,
          manual_opening: isManualMonth ? mOverride.manual_opening : null,
          notes: isManualMonth ? mOverride.notes || '' : ''
        });
      }

      allYearsMonthlyMap[yStr] = monthsInYear;

      const hasManualYearInOut =
        yOverride &&
        yOverride.manual_in !== null &&
        yOverride.manual_in !== undefined &&
        yOverride.manual_in !== '' &&
        yOverride.manual_out !== null &&
        yOverride.manual_out !== undefined &&
        yOverride.manual_out !== '';

      const finalYearIn = hasManualYearInOut ? Number(yOverride.manual_in) : yearInSum;
      const finalYearOut = hasManualYearInOut ? Number(yOverride.manual_out) : yearOutSum;
      const finalYearNet = finalYearIn - finalYearOut;
      const finalYearClose = hasManualYearInOut ? yearOpening + finalYearNet : runningCustomers;
      if (hasManualYearInOut) {
        runningCustomers = finalYearClose;
      }

      yearlyTraffic.push({
        year: yStr,
        opening_customers: yearOpening,
        customers_in: finalYearIn,
        customers_out: finalYearOut,
        net_growth: finalYearNet,
        closing_customers: finalYearClose,
        is_manual: Boolean(
          hasManualYearInOut ||
            (yOverride &&
              yOverride.manual_opening !== null &&
              yOverride.manual_opening !== undefined &&
              yOverride.manual_opening !== '')
        ),
        manual_opening: yOverride ? yOverride.manual_opening : null,
        manual_in: hasManualYearInOut ? Number(yOverride.manual_in) : null,
        manual_out: hasManualYearInOut ? Number(yOverride.manual_out) : null,
        notes: yOverride ? yOverride.notes || '' : ''
      });
    });

    const monthlyTraffic = allYearsMonthlyMap[year] || [];
    const deletedMonthsInYear = Array.from(deletedMonths).filter((m) => m.startsWith(year));
    const monthLogs = [...allLogs]
      .filter((l) => l.date.startsWith(month))
      .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);

    const dailyMap = {};
    allLogs
      .filter((l) => l.date && l.date.startsWith(month))
      .forEach((l) => {
        if (!dailyMap[l.date]) {
          dailyMap[l.date] = { date: l.date, customers_in: 0, customers_out: 0, net_growth: 0, tx_count: 0 };
        }
        if (l.type === 'IN') dailyMap[l.date].customers_in += Number(l.count || 0);
        else dailyMap[l.date].customers_out += Number(l.count || 0);
        dailyMap[l.date].net_growth = dailyMap[l.date].customers_in - dailyMap[l.date].customers_out;
        dailyMap[l.date].tx_count += 1;
      });
    const dailyTraffic = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));

    return {
      company: comp,
      folder_path: `Database Pelanggan ${comp}`,
      base_customers: baseCustomers,
      current_total_customers: runningCustomers,
      year,
      selected_month: month,
      available_years: sortedYears,
      deleted_months_count: deletedMonthsInYear.length,
      monthly_traffic: monthlyTraffic,
      yearly_traffic: yearlyTraffic,
      daily_traffic: dailyTraffic,
      month_logs: monthLogs
    };
  }

  async setFolderBaseCustomers(company, baseVal) {
    const comp = String(company || 'GMDP').toUpperCase() === 'GENAP' ? 'GENAP' : 'GMDP';
    const val = Math.max(0, parseInt(baseVal, 10) || 0);
    if (this.isServerMode) {
      return this.apiFetch(`/api/folder/${comp}/base`, {
        method: 'PUT',
        body: JSON.stringify({ base_customers: val })
      });
    }
    const fDb = this.ensureCompanyFolderSeed(comp);
    fDb.base_customers = val;
    this.saveCompanyFolderDb(comp, fDb);
    return { base_customers: val };
  }

  async addFolderLog(company, payload) {
    const comp = String(company || 'GMDP').toUpperCase() === 'GENAP' ? 'GENAP' : 'GMDP';
    if (this.isServerMode) {
      return this.apiFetch(`/api/folder/${comp}/logs`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
    }
    const fDb = this.ensureCompanyFolderSeed(comp);
    if (!fDb.customer_logs) fDb.customer_logs = [];
    const cnt = parseInt(payload.count, 10);
    if (!cnt || cnt <= 0) throw new Error('Jumlah pelanggan harus lebih dari 0.');
    const nextId = fDb.customer_logs.reduce((max, l) => Math.max(max, l.id), 0) + 1;
    const currentUser = this.getCurrentUser() || { full_name: 'Petugas' };
    const newLog = {
      id: nextId,
      type: payload.type,
      count: cnt,
      category: payload.category,
      customer_info: payload.customer_info || '',
      date: payload.date,
      user_name: currentUser.full_name || 'Petugas'
    };
    fDb.customer_logs.push(newLog);
    if (fDb.deleted_months && payload.date) {
      fDb.deleted_months = fDb.deleted_months.filter((m) => m !== payload.date.slice(0, 7));
    }
    this.saveCompanyFolderDb(comp, fDb);
    return newLog;
  }

  async deleteFolderLog(company, id) {
    const comp = String(company || 'GMDP').toUpperCase() === 'GENAP' ? 'GENAP' : 'GMDP';
    if (this.isServerMode) {
      return this.apiFetch(`/api/folder/${comp}/logs/${id}`, { method: 'DELETE' });
    }
    const fDb = this.ensureCompanyFolderSeed(comp);
    fDb.customer_logs = (fDb.customer_logs || []).filter((l) => l.id !== Number(id));
    this.saveCompanyFolderDb(comp, fDb);
    return { success: true };
  }

  async saveManualMonth(company, payload) {
    const comp = String(company || 'GMDP').toUpperCase() === 'GENAP' ? 'GENAP' : 'GMDP';
    if (this.isServerMode) {
      return this.apiFetch(`/api/folder/${comp}/monthly-manual`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
    }
    const fDb = this.ensureCompanyFolderSeed(comp);
    if (!fDb.monthly_manual) fDb.monthly_manual = {};
    if (!fDb.yearly_manual) fDb.yearly_manual = {};

    const openVal =
      payload.manual_opening === '' || payload.manual_opening === null || payload.manual_opening === undefined
        ? null
        : Math.max(0, parseInt(payload.manual_opening, 10) || 0);
    const inVal = Math.max(0, parseInt(payload.manual_in, 10) || 0);
    const outVal = Math.max(0, parseInt(payload.manual_out, 10) || 0);

    fDb.monthly_manual[payload.month] = {
      month: payload.month,
      manual_opening: openVal,
      manual_in: inVal,
      manual_out: outVal,
      notes: payload.notes || ''
    };

    if (fDb.deleted_months) {
      fDb.deleted_months = fDb.deleted_months.filter((m) => m !== payload.month);
    }

    const yStr = payload.month.slice(0, 4);
    if (!fDb.yearly_manual[yStr]) {
      fDb.yearly_manual[yStr] = { year: yStr, manual_opening: null, manual_in: null, manual_out: null, notes: '' };
    }
    if (fDb.deleted_years) {
      fDb.deleted_years = fDb.deleted_years.filter((y) => y !== yStr);
    }

    this.saveCompanyFolderDb(comp, fDb);
    return { success: true };
  }

  async deleteManualMonth(company, month) {
    const comp = String(company || 'GMDP').toUpperCase() === 'GENAP' ? 'GENAP' : 'GMDP';
    if (this.isServerMode) {
      return this.apiFetch(`/api/folder/${comp}/monthly-manual/${encodeURIComponent(month)}`, {
        method: 'DELETE'
      });
    }
    const fDb = this.ensureCompanyFolderSeed(comp);
    if (fDb.monthly_manual) {
      delete fDb.monthly_manual[month];
    }
    this.saveCompanyFolderDb(comp, fDb);
    return { success: true };
  }

  async deleteMonthCompletely(company, month) {
    const comp = String(company || 'GMDP').toUpperCase() === 'GENAP' ? 'GENAP' : 'GMDP';
    if (this.isServerMode) {
      return this.apiFetch(`/api/folder/${comp}/months/${encodeURIComponent(month)}`, {
        method: 'DELETE'
      });
    }
    const fDb = this.ensureCompanyFolderSeed(comp);
    if (fDb.monthly_manual) {
      delete fDb.monthly_manual[month];
    }
    if (fDb.customer_logs) {
      fDb.customer_logs = fDb.customer_logs.filter((l) => !l.date.startsWith(month));
    }
    if (!fDb.deleted_months) fDb.deleted_months = [];
    if (!fDb.deleted_months.includes(month)) {
      fDb.deleted_months.push(month);
    }
    this.saveCompanyFolderDb(comp, fDb);
    return { success: true };
  }

  async restoreDeletedMonths(company, year) {
    const comp = String(company || 'GMDP').toUpperCase() === 'GENAP' ? 'GENAP' : 'GMDP';
    if (this.isServerMode) {
      return this.apiFetch(`/api/folder/${comp}/months/restore`, {
        method: 'POST',
        body: JSON.stringify({ year })
      });
    }
    const fDb = this.ensureCompanyFolderSeed(comp);
    if (fDb.deleted_months) {
      fDb.deleted_months = fDb.deleted_months.filter((m) => !m.startsWith(String(year)));
    }
    this.saveCompanyFolderDb(comp, fDb);
    return { success: true };
  }

  async saveManualYear(company, payload) {
    const comp = String(company || 'GMDP').toUpperCase() === 'GENAP' ? 'GENAP' : 'GMDP';
    if (this.isServerMode) {
      return this.apiFetch(`/api/folder/${comp}/yearly-manual`, {
        method: 'POST',
        body: JSON.stringify(payload)
      });
    }
    const fDb = this.ensureCompanyFolderSeed(comp);
    if (!fDb.yearly_manual) fDb.yearly_manual = {};

    const yStr = String(payload.year).trim();
    const openVal =
      payload.manual_opening === '' || payload.manual_opening === null || payload.manual_opening === undefined
        ? null
        : Math.max(0, parseInt(payload.manual_opening, 10) || 0);
    const inVal =
      payload.manual_in === '' || payload.manual_in === null || payload.manual_in === undefined
        ? null
        : Math.max(0, parseInt(payload.manual_in, 10) || 0);
    const outVal =
      payload.manual_out === '' || payload.manual_out === null || payload.manual_out === undefined
        ? null
        : Math.max(0, parseInt(payload.manual_out, 10) || 0);

    fDb.yearly_manual[yStr] = {
      year: yStr,
      manual_opening: openVal,
      manual_in: inVal,
      manual_out: outVal,
      notes: payload.notes || ''
    };
    if (fDb.deleted_years) {
      fDb.deleted_years = fDb.deleted_years.filter((y) => y !== yStr);
    }

    this.saveCompanyFolderDb(comp, fDb);
    return { success: true };
  }

  async deleteManualYear(company, year) {
    const comp = String(company || 'GMDP').toUpperCase() === 'GENAP' ? 'GENAP' : 'GMDP';
    if (this.isServerMode) {
      return this.apiFetch(`/api/folder/${comp}/yearly-manual/${encodeURIComponent(year)}`, {
        method: 'DELETE'
      });
    }
    const yStr = String(year);
    const fDb = this.ensureCompanyFolderSeed(comp);
    if (fDb.yearly_manual) {
      delete fDb.yearly_manual[yStr];
    }
    if (fDb.monthly_manual) {
      Object.keys(fDb.monthly_manual).forEach((m) => {
        if (m.startsWith(yStr)) delete fDb.monthly_manual[m];
      });
    }
    if (fDb.customer_logs) {
      fDb.customer_logs = fDb.customer_logs.filter((l) => !l.date.startsWith(yStr));
    }
    if (!fDb.deleted_years) fDb.deleted_years = [];
    if (!fDb.deleted_years.includes(yStr)) {
      fDb.deleted_years.push(yStr);
    }
    this.saveCompanyFolderDb(comp, fDb);
    return { success: true };
  }
}

// ==================== CONTROLLER UI UTAMA ====================
const dbService = new DataService();
let currentUser = null;
let cachedItems = [];
let currentMonthlyReport = null;
let cachedDailyTransactions = [];
let cachedDailyMonthItems = null;
let currentDailyFilterMonth = '';
let currentSubscriptionCtx = null;
let cachedSaasPlans = [];
let publicBillingCycle = 'monthly';
let customerBillingCycle = 'monthly';
let selectedCheckoutPlanCode = null;

function getTodayStr() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function getCurrentMonthStr() {
  return getTodayStr().slice(0, 7);
}

function formatRupiah(num) {
  return 'Rp ' + Number(num || 0).toLocaleString('id-ID');
}

function formatDateID(dateStr) {
  if (!dateStr) return '-';
  const [y, m, d] = dateStr.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  return `${d} ${months[Number(m) - 1]} ${y}`;
}

function formatMonthNameID(monthStr) {
  if (!monthStr) return '-';
  const [y, m] = monthStr.split('-');
  const months = [
    'Januari',
    'Februari',
    'Maret',
    'April',
    'Mei',
    'Juni',
    'Juli',
    'Agustus',
    'September',
    'Oktober',
    'November',
    'Desember'
  ];
  return `${months[Number(m) - 1]} ${y}`;
}

function showToast(msg, type = 'success') {
  const container = document.getElementById('toast-container');
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

const SESSION_MAX_AGE_MS = 2 * 60 * 60 * 1000; // 2 jam
let sessionCheckTimer = null;

function isSessionExpired() {
  const loginAt = Number(sessionStorage.getItem('stokpintar_login_at') || 0);
  if (!loginAt) return false;
  return Date.now() - loginAt >= SESSION_MAX_AGE_MS;
}

function forceAutoLogout(message) {
  document.documentElement.classList.remove('auth-booting');
  if (sessionCheckTimer) {
    clearInterval(sessionCheckTimer);
    sessionCheckTimer = null;
  }
  dbService.logout();
  currentUser = null;
  const appScreen = document.getElementById('app-screen');
  const loginScreen = document.getElementById('login-screen');
  if (appScreen) appScreen.classList.add('hidden');
  if (loginScreen) loginScreen.classList.remove('hidden');
  if (message) {
    showToast(message, 'error');
  }
}

function startSessionExpiryWatcher() {
  if (sessionCheckTimer) {
    clearInterval(sessionCheckTimer);
    sessionCheckTimer = null;
  }
  if (!sessionStorage.getItem('stokpintar_login_at')) {
    sessionStorage.setItem('stokpintar_login_at', String(Date.now()));
  }
  if (isSessionExpired()) {
    forceAutoLogout('Sesi login Anda telah mencapai batas 2 jam. Silakan login kembali.');
    return;
  }
  sessionCheckTimer = setInterval(() => {
    if (currentUser && isSessionExpired()) {
      forceAutoLogout('Sesi login Anda telah mencapai batas 2 jam. Silakan login kembali.');
    }
  }, 30000);
}

function initLucideIcons() {
  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }
}

function closeMobileSidebar() {
  const sidebar = document.getElementById('app-sidebar');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (sidebar) sidebar.classList.remove('mobile-open');
  if (backdrop) backdrop.classList.add('hidden');
}

window.addEventListener('load', initLucideIcons);

// Inisialisasi Saat Halaman Dimuat
document.addEventListener('DOMContentLoaded', async () => {
  // Bersihkan sisa sesi lama di localStorage agar keluar browser selalu otomatis logout
  localStorage.removeItem('stokpintar_token');
  localStorage.removeItem('stokpintar_user');
  localStorage.removeItem('stokpintar_login_at');
  const isServer = await dbService.detectMode();
  const badgeText = isServer
    ? dbService.serverReady
      ? '🟢 Sudah Terhubung Gess — Sri Barada Indra Sakti'
      : '⚠️ Server Aktif — SUPABASE_URL / KEY Belum Diisi di .env / Vercel'
    : '🔒 Mode Lokal Offline';

  document.getElementById('connection-badge').textContent = badgeText;
  document.getElementById('storage-mode-indicator').textContent = badgeText;
  document.getElementById('current-date-display').textContent = `📅 Hari Ini: ${formatDateID(getTodayStr())}`;

  document.getElementById('tx-date').value = getTodayStr();
  document.getElementById('filter-date').value = '';
  populateDailyFilterYearOptions(new Date().getFullYear());
  document.getElementById('report-month').value = getCurrentMonthStr();
  syncMonthlyPickersFromInput();
  document.getElementById('cust-month').value = getCurrentMonthStr();
  document.getElementById('cust-date').value = getTodayStr();

  populateReasonOptions('IN');
  populateCustomerCategoryOptions('IN');
  bindEvents();
  initLucideIcons();
  initLiquidWaterCursor();
  loadPublicPlans();

  const rememberedUsername = localStorage.getItem('stokpintar_remembered_username');
  if (rememberedUsername) {
    const userInput = document.getElementById('login-username');
    const remCb = document.getElementById('remember-username');
    if (userInput) userInput.value = rememberedUsername;
    if (remCb) remCb.checked = true;
  }

  if (isServer && dbService.token) {
    if (isSessionExpired()) {
      forceAutoLogout('Sesi login Anda telah mencapai batas 2 jam. Silakan login kembali.');
      return;
    }
    const cachedSessionUser = dbService.getCurrentUser();
    if (cachedSessionUser) {
      currentUser = cachedSessionUser;
      enterApp();
    }
    try {
      const me = await dbService.apiFetch('/api/auth/me');
      if (me && me.user) {
        currentUser = me.user;
        currentSubscriptionCtx = me.subscription || null;
        sessionStorage.setItem('stokpintar_user', JSON.stringify(me.user));
        if (!cachedSessionUser) {
          enterApp();
        } else {
          renderTrialStatusBanner(currentSubscriptionCtx);
          document.querySelectorAll('.platform-admin-only').forEach((el) => {
            el.classList.toggle('hidden', !isCurrentPlatformAdmin());
          });
        }
        return;
      }
    } catch (_) {
      forceAutoLogout();
      return;
    }
  }

  const savedUser = !isServer ? dbService.getCurrentUser() : null;
  if (savedUser) {
    if (isSessionExpired()) {
      forceAutoLogout('Sesi login Anda telah mencapai batas 2 jam. Silakan login kembali.');
      return;
    }
    currentUser = savedUser;
    enterApp();
    return;
  }

  document.documentElement.classList.remove('auth-booting');
});

function bindEvents() {
  // Toggle Show/Hide Password
  const togglePwdBtn = document.getElementById('toggle-login-password');
  if (togglePwdBtn) {
    togglePwdBtn.addEventListener('click', () => {
      const pwdEl = document.getElementById('login-password');
      if (!pwdEl) return;
      const isHidden = pwdEl.type === 'password';
      pwdEl.type = isHidden ? 'text' : 'password';
      togglePwdBtn.innerHTML = isHidden
        ? '<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>'
        : '<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
    });
  }

  // Login Form
  document.getElementById('login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const errBox = document.getElementById('login-error');
    errBox.classList.add('hidden');
    const username = document.getElementById('login-username').value;
    const password = document.getElementById('login-password').value;
    const rememberCb = document.getElementById('remember-username');
    const submitBtn = document.getElementById('btn-login-submit');
    const spinner = document.getElementById('login-btn-spinner');
    const btnText = document.getElementById('login-btn-text');

    if (submitBtn) submitBtn.disabled = true;
    if (spinner) spinner.classList.remove('hidden');
    if (btnText) btnText.textContent = 'Memproses...';

    try {
      currentUser = await dbService.login(username, password);
      if (rememberCb && rememberCb.checked) {
        localStorage.setItem('stokpintar_remembered_username', username.trim());
      } else {
        localStorage.removeItem('stokpintar_remembered_username');
      }
      enterApp();
    } catch (err) {
      errBox.textContent = err.message;
      errBox.classList.remove('hidden');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
      if (spinner) spinner.classList.add('hidden');
      if (btnText) btnText.textContent = 'Masuk ke Sistem';
    }
  });

  // Sidebar Collapse / Expand & Mobile Drawer
  const toggleSidebarBtn = document.getElementById('btn-toggle-sidebar');
  if (toggleSidebarBtn) {
    toggleSidebarBtn.addEventListener('click', () => {
      const sidebar = document.getElementById('app-sidebar');
      if (sidebar) sidebar.classList.toggle('is-collapsed');
    });
  }

  const mobileMenuBtn = document.getElementById('btn-mobile-menu');
  const sidebarBackdrop = document.getElementById('sidebar-backdrop');
  if (mobileMenuBtn) {
    mobileMenuBtn.addEventListener('click', () => {
      document.getElementById('low-stock-popover')?.classList.add('hidden');
      const sidebar = document.getElementById('app-sidebar');
      if (sidebar) sidebar.classList.toggle('mobile-open');
      if (sidebarBackdrop) sidebarBackdrop.classList.toggle('hidden');
    });
  }
  if (sidebarBackdrop) {
    sidebarBackdrop.addEventListener('click', closeMobileSidebar);
  }
  const closeMobileMenuBtn = document.getElementById('btn-close-mobile-menu');
  if (closeMobileMenuBtn) {
    closeMobileMenuBtn.addEventListener('click', closeMobileSidebar);
  }
  const bnavMoreBtn = document.getElementById('btn-bnav-more');
  if (bnavMoreBtn) {
    bnavMoreBtn.addEventListener('click', () => {
      document.getElementById('low-stock-popover')?.classList.add('hidden');
      const sidebar = document.getElementById('app-sidebar');
      if (sidebar) sidebar.classList.add('mobile-open');
      if (sidebarBackdrop) sidebarBackdrop.classList.remove('hidden');
    });
  }
  document.querySelectorAll('.mobile-bnav-item[data-view]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const view = btn.getAttribute('data-view');
      closeMobileSidebar();
      switchView(view);
    });
  });

  const lowStockBell = document.getElementById('btn-low-stock-notif');
  const lowStockPopover = document.getElementById('low-stock-popover');
  const btnNotifGotoItems = document.getElementById('btn-notif-goto-items');
  if (lowStockBell && lowStockPopover) {
    lowStockBell.addEventListener('click', (e) => {
      e.stopPropagation();
      lowStockPopover.classList.toggle('hidden');
    });
    lowStockPopover.addEventListener('click', (e) => e.stopPropagation());
    document.addEventListener('click', () => {
      lowStockPopover.classList.add('hidden');
    });
  }
  if (btnNotifGotoItems) {
    btnNotifGotoItems.addEventListener('click', () => {
      if (lowStockPopover) lowStockPopover.classList.add('hidden');
      const role = normalizeRole(currentUser ? currentUser.role : 'teknisi');
      if (canAccessStock(role)) {
        const searchEl = document.getElementById('search-item');
        if (searchEl) searchEl.value = '';
        switchView('items');
      }
    });
  }

  // Logout
  document.getElementById('btn-logout').addEventListener('click', () => {
    if (sessionCheckTimer) {
      clearInterval(sessionCheckTimer);
      sessionCheckTimer = null;
    }
    dbService.logout();
    currentUser = null;
    document.getElementById('app-screen').classList.add('hidden');
    document.getElementById('login-screen').classList.remove('hidden');
  });

  // Sidebar Navigation
  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => {
      const view = btn.getAttribute('data-view');
      closeMobileSidebar();
      switchView(view);
    });
  });

  // Radio Jenis Mutasi (IN / DISMANTLE / OUT)
  document.querySelectorAll('input[name="tx-mode"]').forEach((radio) => {
    radio.addEventListener('change', (e) => {
      const mode = e.target.value;
      document.getElementById('label-type-in').classList.toggle('active', mode === 'IN');
      document.getElementById('label-type-dismantle').classList.toggle('active', mode === 'DISMANTLE');
      document.getElementById('label-type-out').classList.toggle('active', mode === 'OUT');
      populateReasonOptions(mode);
    });
  });

  // Sinkronisasi otomatis jika user memilih Alasan / Kategori Mutasi langsung dari dropdown
  document.getElementById('tx-reason').addEventListener('change', (e) => {
    const r = e.target.value;
    let targetMode = 'OUT';
    if (r === 'Restok') targetMode = 'IN';
    else if (r === 'Dismantle') targetMode = 'DISMANTLE';

    const radio = document.querySelector(`input[name="tx-mode"][value="${targetMode}"]`);
    if (radio) radio.checked = true;
    document.getElementById('label-type-in').classList.toggle('active', targetMode === 'IN');
    document.getElementById('label-type-dismantle').classList.toggle('active', targetMode === 'DISMANTLE');
    document.getElementById('label-type-out').classList.toggle('active', targetMode === 'OUT');
    updateSellPriceFieldVisibility();
  });

  const txQtyInput = document.getElementById('tx-quantity');
  const txSellPriceInput = document.getElementById('tx-sell-price');
  if (txQtyInput) txQtyInput.addEventListener('input', updateSellTotalHint);
  if (txSellPriceInput) txSellPriceInput.addEventListener('input', updateSellTotalHint);

  // Pencarian Barang di Form Input Mutasi Stok Harian
  const txItemSearch = document.getElementById('tx-item-search');
  if (txItemSearch) {
    txItemSearch.addEventListener('input', () => renderTxItemOptions(true));
  }

  // Info stok saat pilih barang
  document.getElementById('tx-item').addEventListener('change', (e) => {
    const itemId = Number(e.target.value);
    const hint = document.getElementById('tx-item-stock-hint');
    const item = cachedItems.find((i) => i.id === itemId);
    if (item) {
      hint.innerHTML = `Sisa stok saat ini: <strong>${item.current_stock} ${item.unit}</strong> (Min: ${item.min_stock} ${item.unit})`;
    } else {
      hint.textContent = 'Pilih barang untuk melihat sisa stok saat ini.';
    }
  });

  // Submit Form Transaksi Stok Harian
  document.getElementById('tx-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const reason = document.getElementById('tx-reason').value;
    const isInReason = reason === 'Restok' || reason === 'Dismantle';
    const type = isInReason ? 'IN' : 'OUT';
    const date = document.getElementById('tx-date').value;
    const quantity = document.getElementById('tx-quantity').value;
    const item_id = document.getElementById('tx-item').value;
    const notes = document.getElementById('tx-notes').value;
    const sell_price = reason === 'Dijual' ? document.getElementById('tx-sell-price')?.value || 0 : 0;

    try {
      await dbService.addTransaction({ item_id, type, quantity, reason, date, notes, sell_price });
      showToast(`Transaksi stok (${reason}) berhasil disimpan!`);
      document.getElementById('tx-quantity').value = '';
      document.getElementById('tx-notes').value = '';
      const sellEl = document.getElementById('tx-sell-price');
      if (sellEl) sellEl.value = '';
      updateSellTotalHint();
      await refreshDailyView();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Filter Riwayat Transaksi Harian
  const filterTxSearch = document.getElementById('filter-tx-search');
  if (filterTxSearch) {
    filterTxSearch.addEventListener('input', () => {
      tablePagination.tx.page = 1;
      renderDailyTransactionsTable();
    });
  }
  const txPageSizeSelect = document.getElementById('tx-page-size');
  if (txPageSizeSelect) {
    txPageSizeSelect.addEventListener('change', (e) => {
      tablePagination.tx.pageSize = e.target.value;
      tablePagination.tx.page = 1;
      renderDailyTransactionsTable();
    });
  }
  const filterMonthSelect = document.getElementById('filter-month-select');
  const filterYearSelect = document.getElementById('filter-year-select');
  if (filterMonthSelect) {
    filterMonthSelect.addEventListener('change', () => syncDailyMonthFilterFromSelects());
  }
  if (filterYearSelect) {
    filterYearSelect.addEventListener('change', () => {
      if (filterMonthSelect && filterMonthSelect.value) {
        syncDailyMonthFilterFromSelects();
      }
    });
  }
  document.getElementById('filter-date').addEventListener('change', () => refreshDailyView());
  document.getElementById('filter-type').addEventListener('change', () => refreshDailyView());
  document.getElementById('btn-show-all-dates').addEventListener('click', () => {
    document.getElementById('filter-date').value = '';
    if (filterMonthSelect) filterMonthSelect.value = '';
    refreshDailyView();
  });

  // Filter & Aksi Resume Bulanan
  document.getElementById('report-month').addEventListener('change', () => {
    syncMonthlyPickersFromInput();
    refreshMonthlyView();
  });
  const reportMonthSelect = document.getElementById('report-month-select');
  const reportYearSelect = document.getElementById('report-year-select');
  if (reportMonthSelect) {
    reportMonthSelect.addEventListener('change', () => syncReportMonthInputFromSelects());
  }
  if (reportYearSelect) {
    reportYearSelect.addEventListener('change', () => syncReportMonthInputFromSelects());
  }
  const searchMonthlyItem = document.getElementById('search-monthly-item');
  if (searchMonthlyItem) {
    searchMonthlyItem.addEventListener('input', () => {
      tablePagination.monthlyItems.page = 1;
      renderMonthlyItemsTable();
    });
  }
  const monthlyItemsPageSizeSelect = document.getElementById('monthly-items-page-size');
  if (monthlyItemsPageSizeSelect) {
    monthlyItemsPageSizeSelect.addEventListener('change', (e) => {
      tablePagination.monthlyItems.pageSize = e.target.value;
      tablePagination.monthlyItems.page = 1;
      renderMonthlyItemsTable();
    });
  }
  document.getElementById('btn-export-csv').addEventListener('click', exportMonthlyToCSV);
  document.getElementById('btn-print-report').addEventListener('click', () => window.print());

  // Filter Stok Per Kategori (Stok Harian & Resume Bulanan)
  const dailyCatFilter = document.getElementById('daily-category-filter');
  const dailyCatSearch = document.getElementById('daily-category-search');
  if (dailyCatFilter) dailyCatFilter.addEventListener('change', () => renderDailyCategoryStockView());
  if (dailyCatSearch) dailyCatSearch.addEventListener('input', () => renderDailyCategoryStockView());

  const monthlyCatFilter = document.getElementById('monthly-category-filter');
  const monthlyCatSearch = document.getElementById('monthly-category-search');
  if (monthlyCatFilter) monthlyCatFilter.addEventListener('change', () => renderMonthlyCategoryStockView());
  if (monthlyCatSearch) monthlyCatSearch.addEventListener('input', () => renderMonthlyCategoryStockView());

  const btnExportDailyExcel = document.getElementById('btn-export-daily-excel');
  if (btnExportDailyExcel) {
    btnExportDailyExcel.addEventListener('click', exportDailyTransactionsToExcel);
  }

  const selectAllTxCb = document.getElementById('select-all-tx');
  if (selectAllTxCb) {
    selectAllTxCb.addEventListener('change', (e) => {
      const checked = e.target.checked;
      document.querySelectorAll('.tx-select-cb').forEach((cb) => {
        cb.checked = checked;
      });
      updateBulkDeleteTxUI();
    });
  }

  const btnBulkDeleteTx = document.getElementById('btn-bulk-delete-tx');
  if (btnBulkDeleteTx) {
    btnBulkDeleteTx.addEventListener('click', handleBulkDeleteTx);
  }

  // Pencarian & Modal Master Barang
  const itemsCatFilter = document.getElementById('items-category-filter');
  if (itemsCatFilter) {
    itemsCatFilter.addEventListener('change', () => {
      tablePagination.items.page = 1;
      const cat = itemsCatFilter.value;
      renderCategoryStockGrid(
        'items-category-stock-grid',
        cat === 'ALL' ? cachedItems : cachedItems.filter((i) => (i.category || 'Lainnya').trim() === cat),
        true
      );
      renderItemsTable();
    });
  }
  document.getElementById('search-item').addEventListener('input', () => {
    tablePagination.items.page = 1;
    renderItemsTable();
  });
  const itemsPageSizeSelect = document.getElementById('items-page-size');
  if (itemsPageSizeSelect) {
    itemsPageSizeSelect.addEventListener('change', (e) => {
      tablePagination.items.pageSize = e.target.value;
      tablePagination.items.page = 1;
      renderItemsTable();
    });
  }
  document.getElementById('btn-reset-category-filter').addEventListener('click', () => {
    tablePagination.items.page = 1;
    document.getElementById('search-item').value = '';
    if (itemsCatFilter) itemsCatFilter.value = 'ALL';
    renderCategoryStockGrid('items-category-stock-grid', cachedItems, true);
    renderItemsTable();
  });
  document.getElementById('btn-open-item-modal').addEventListener('click', () => openItemModal());

  const selectAllItemsCb = document.getElementById('select-all-items');
  if (selectAllItemsCb) {
    selectAllItemsCb.addEventListener('change', (e) => {
      const checked = e.target.checked;
      document.querySelectorAll('.item-select-cb').forEach((cb) => {
        cb.checked = checked;
      });
      updateBulkDeleteItemsUI();
    });
  }

  const btnBulkDeleteItems = document.getElementById('btn-bulk-delete-items');
  if (btnBulkDeleteItems) {
    btnBulkDeleteItems.addEventListener('click', handleBulkDeleteItems);
  }
  document.getElementById('btn-close-item-modal').addEventListener('click', closeItemModal);
  document.getElementById('btn-cancel-item').addEventListener('click', closeItemModal);

  document.getElementById('item-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const payload = {
      id: document.getElementById('item-id').value || null,
      sku: document.getElementById('item-sku').value,
      category: document.getElementById('item-category').value,
      name: document.getElementById('item-name').value,
      unit: document.getElementById('item-unit').value,
      price: 0,
      min_stock: document.getElementById('item-min-stock').value,
      initial_stock: document.getElementById('item-initial-stock').value
    };

    try {
      await dbService.saveItem(payload);
      showToast('Data master barang berhasil disimpan!');
      closeItemModal();
      await refreshItemsView();
      await refreshDailyView();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Form Tambah Pengguna (Admin)
  document.getElementById('user-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const full_name = document.getElementById('user-fullname').value;
    const username = document.getElementById('user-username').value;
    const password = document.getElementById('user-password').value;
    const role = document.getElementById('user-role').value;

    try {
      await dbService.addUser({ full_name, username, password, role });
      showToast('Akun pengguna baru berhasil ditambahkan!');
      document.getElementById('user-form').reset();
      await refreshUsersView();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Backup, Restore & Pemeliharaan Database Produksi
  const btnExportAllDb = document.getElementById('btn-export-all-db');
  if (btnExportAllDb) {
    btnExportAllDb.addEventListener('click', async () => {
      try {
        const fullData = await dbService.exportAllSystemData();
        const blob = new Blob([JSON.stringify(fullData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `Export_Semua_Data_Sistem_${getTodayStr()}.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
        const itemCount = fullData.inventory_db?.items?.length || 0;
        const txCount = fullData.inventory_db?.transactions?.length || 0;
        showToast(`Semua data sistem berhasil di-export (${itemCount} barang, ${txCount} transaksi)!`);
      } catch (err) {
        showToast(err.message || 'Gagal meng-export semua data sistem.', 'error');
      }
    });
  }

  const btnBackup = document.getElementById('btn-backup-db');
  if (btnBackup) {
    btnBackup.addEventListener('click', () => {
      const backupData = dbService.exportFullBackup();
      const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `Backup_Sistem_Sri_Barada_${getTodayStr()}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      showToast('File Backup Database berhasil diunduh!');
    });
  }

  const inputImportMerge = document.getElementById('input-import-merge-db');
  if (inputImportMerge) {
    inputImportMerge.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (ev) => {
        try {
          const parsed = JSON.parse(ev.target.result);
          if (
            !confirm(
              `Import & gabungkan data dari "${file.name}" tanpa menghapus data yang sudah ada?`
            )
          ) {
            return;
          }
          const res = await dbService.importMergeBackup(parsed);
          showToast(
            `Import selesai! +${res.added_items} barang, +${res.added_transactions} transaksi, +${res.added_customer_logs} log pelanggan (data lama tetap aman).`
          );
          await refreshDailyView();
        } catch (err) {
          showToast(err.message || 'Gagal mengimport database: Format file tidak sesuai.', 'error');
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    });
  }

  const inputRestore = document.getElementById('input-restore-db');
  if (inputRestore) {
    inputRestore.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async (ev) => {
        try {
          const parsed = JSON.parse(ev.target.result);
          dbService.importFullBackup(parsed);
          showToast('Database berhasil dipulihkan dari file backup!');
          await refreshDailyView();
        } catch (err) {
          showToast('Gagal memulihkan database: Format file tidak sesuai.', 'error');
        }
      };
      reader.readAsText(file);
      e.target.value = '';
    });
  }

  const btnClearTx = document.getElementById('btn-clear-transactions');
  if (btnClearTx) {
    btnClearTx.addEventListener('click', async () => {
      if (
        !confirm(
          'Apakah Anda yakin ingin mengosongkan seluruh riwayat transaksi stok & pelanggan? (Master barang & akun pengguna tetap aman).'
        )
      )
        return;
      dbService.clearAllTransactions();
      showToast('Seluruh riwayat transaksi telah dikosongkan.');
      await refreshDailyView();
    });
  }

  // Form Tambah Email Penerima Backup & Kirim Multi-Email
  const backupEmailForm = document.getElementById('backup-email-form');
  if (backupEmailForm) {
    backupEmailForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const label = document.getElementById('backup-email-label').value;
      const addr = document.getElementById('backup-email-address').value;
      try {
        dbService.addBackupEmails(label, addr);
        backupEmailForm.reset();
        renderBackupEmailsList();
        showToast('Alamat email penerima backup berhasil ditambahkan!');
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  const checkAllEmails = document.getElementById('check-all-backup-emails');
  if (checkAllEmails) {
    checkAllEmails.addEventListener('change', (e) => {
      dbService.toggleAllBackupEmails(e.target.checked);
      renderBackupEmailsList();
    });
  }

  const btnToggleSmtp = document.getElementById('btn-toggle-smtp-config');
  if (btnToggleSmtp) {
    btnToggleSmtp.addEventListener('click', () => {
      document.getElementById('smtp-config-panel').classList.toggle('hidden');
    });
  }

  const btnSaveSmtp = document.getElementById('btn-save-smtp-config');
  if (btnSaveSmtp) {
    btnSaveSmtp.addEventListener('click', () => {
      const sender = document.getElementById('smtp-sender-email').value;
      const pass = document.getElementById('smtp-app-password').value;
      dbService.saveSmtpConfig(sender, pass);
      showToast('Konfigurasi SMTP pengirim berhasil disimpan!');
    });
  }

  const btnSendGmail = document.getElementById('btn-send-backup-gmail');
  if (btnSendGmail) {
    btnSendGmail.addEventListener('click', () => handleSendBackupEmail('GMAIL'));
  }

  const btnSendMailto = document.getElementById('btn-send-backup-mailto');
  if (btnSendMailto) {
    btnSendMailto.addEventListener('click', () => handleSendBackupEmail('MAILTO'));
  }

  const btnSendSmtp = document.getElementById('btn-send-backup-smtp');
  if (btnSendSmtp) {
    btnSendSmtp.addEventListener('click', () => handleSendBackupEmail('SMTP'));
  }

  // ==================== EVENT FOLDER PELANGGAN TERPISAH (GMDP & GENAP) ====================
  document.getElementById('btn-switch-folder-gmdp').addEventListener('click', () => switchView('gmdp'));
  document.getElementById('btn-switch-folder-genap').addEventListener('click', () => switchView('genap'));

  document.querySelectorAll('input[name="cust-type"]').forEach((radio) => {
    radio.addEventListener('change', (e) => {
      const val = e.target.value;
      document.getElementById('label-cust-in').classList.toggle('active', val === 'IN');
      document.getElementById('label-cust-out').classList.toggle('active', val === 'OUT');
      populateCustomerCategoryOptions(val);
    });
  });

  document.getElementById('cust-year-select').addEventListener('change', (e) => {
    const selectedYear = e.target.value;
    const curMonthVal = document.getElementById('cust-month').value || getCurrentMonthStr();
    const mm = curMonthVal.slice(5, 7) || '01';
    document.getElementById('cust-month').value = `${selectedYear}-${mm}`;
    refreshCustomersView();
  });

  document.getElementById('cust-month').addEventListener('change', () => refreshCustomersView());
  document.getElementById('cust-filter-date').addEventListener('change', () => refreshCustomersView());
  document.getElementById('cust-filter-type').addEventListener('change', () => refreshCustomersView());
  document.getElementById('btn-cust-all-dates').addEventListener('click', () => {
    document.getElementById('cust-filter-date').value = '';
    refreshCustomersView();
  });

  document.getElementById('cust-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const type = document.querySelector('input[name="cust-type"]:checked').value;
    const date = document.getElementById('cust-date').value;
    const count = document.getElementById('cust-count').value;
    const category = document.getElementById('cust-category').value;
    const customer_info = document.getElementById('cust-info').value;

    try {
      await dbService.addFolderLog(activeCustomerFolder, { type, count, category, customer_info, date });
      showToast(
        `Update harian pelanggan ${activeCustomerFolder} (${type === 'IN' ? 'Masuk' : 'Keluar'}) berhasil disimpan!`
      );
      document.getElementById('cust-count').value = '1';
      document.getElementById('cust-info').value = '';
      if (date && date.slice(0, 7) !== document.getElementById('cust-month').value) {
        document.getElementById('cust-month').value = date.slice(0, 7);
      }
      await refreshCustomersView();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('btn-set-base-customers').addEventListener('click', async () => {
    const curBase = document.getElementById('base-folder-label').textContent || '80';
    const input = prompt(
      `Masukkan jumlah Pelanggan Awal (Eksisting) untuk ${activeCustomerFolder}:`,
      curBase
    );
    if (input === null) return;
    try {
      await dbService.setFolderBaseCustomers(activeCustomerFolder, input);
      showToast(`Pelanggan awal ${activeCustomerFolder} berhasil diperbarui!`);
      await refreshCustomersView();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Modal Tambah / Edit Bulan Manual
  document.getElementById('btn-open-month-modal').addEventListener('click', () => openManualMonthModal());
  document.getElementById('btn-close-month-modal').addEventListener('click', closeManualMonthModal);
  document.getElementById('btn-cancel-month-modal').addEventListener('click', closeManualMonthModal);

  document.getElementById('manual-month-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const yStr = String(document.getElementById('mm-year').value).trim();
    const mStr = String(document.getElementById('mm-month').value).padStart(2, '0');
    const monthKey = `${yStr}-${mStr}`;
    const manual_opening = document.getElementById('mm-opening').value;
    const manual_in = document.getElementById('mm-in').value;
    const manual_out = document.getElementById('mm-out').value;
    const notes = document.getElementById('mm-notes').value;

    try {
      await dbService.saveManualMonth(activeCustomerFolder, {
        month: monthKey,
        manual_opening,
        manual_in,
        manual_out,
        notes
      });
      closeManualMonthModal();
      document.getElementById('cust-month').value = monthKey;
      showToast(`Data Bulan ${formatMonthNameID(monthKey)} di ${activeCustomerFolder} berhasil disimpan!`);
      await refreshCustomersView();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  // Modal Tambah / Edit Tahun Manual
  document.getElementById('btn-open-year-modal').addEventListener('click', () => openManualYearModal());
  document.getElementById('btn-close-year-modal').addEventListener('click', closeManualYearModal);
  document.getElementById('btn-cancel-year-modal').addEventListener('click', closeManualYearModal);

  document.getElementById('manual-year-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const year = String(document.getElementById('my-year').value).trim();
    const manual_opening = document.getElementById('my-opening').value;
    const manual_in = document.getElementById('my-in').value;
    const manual_out = document.getElementById('my-out').value;
    const notes = document.getElementById('my-notes').value;

    try {
      await dbService.saveManualYear(activeCustomerFolder, {
        year,
        manual_opening,
        manual_in,
        manual_out,
        notes
      });
      closeManualYearModal();
      const curMonthVal = document.getElementById('cust-month').value || getCurrentMonthStr();
      const mm = curMonthVal.slice(5, 7) || '01';
      document.getElementById('cust-month').value = `${year}-${mm}`;
      showToast(`Data Tahun ${year} di ${activeCustomerFolder} berhasil disimpan!`);
      await refreshCustomersView();
    } catch (err) {
      showToast(err.message, 'error');
    }
  });

  document.getElementById('btn-export-cust-csv').addEventListener('click', exportCustomersToCSV);
  document.getElementById('btn-export-cust-yearly-csv').addEventListener('click', exportYearlyCustomersToCSV);
  document.getElementById('btn-print-cust').addEventListener('click', () => window.print());

  // ==================== SAAS PUBLIC NAV, REGISTER, SUBSCRIPTION & ADMIN ====================
  document.querySelectorAll('.public-nav-btn').forEach((btn) => {
    btn.addEventListener('click', () => switchPublicTab(btn.getAttribute('data-pub-tab')));
  });
  const btnToReg = document.getElementById('btn-switch-to-register');
  if (btnToReg) btnToReg.addEventListener('click', () => switchPublicTab('register'));
  const btnToLogin = document.getElementById('btn-switch-to-login');
  if (btnToLogin) btnToLogin.addEventListener('click', () => switchPublicTab('login'));

  document.querySelectorAll('.billing-toggle-btn[data-cycle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      publicBillingCycle = btn.getAttribute('data-cycle') || 'monthly';
      document.querySelectorAll('.billing-toggle-btn[data-cycle]').forEach((b) => {
        b.classList.toggle('active', b === btn);
      });
      renderPricingCards('public-plans-grid', publicBillingCycle, true);
    });
  });

  document.querySelectorAll('.billing-toggle-btn[data-sub-cycle]').forEach((btn) => {
    btn.addEventListener('click', () => {
      customerBillingCycle = btn.getAttribute('data-sub-cycle') || 'monthly';
      document.querySelectorAll('.billing-toggle-btn[data-sub-cycle]').forEach((b) => {
        b.classList.toggle('active', b === btn);
      });
      renderPricingCards('sub-plans-grid', customerBillingCycle, false);
      if (selectedCheckoutPlanCode) selectPlanForCheckout(selectedCheckoutPlanCode);
    });
  });

  const regForm = document.getElementById('register-form');
  if (regForm) {
    regForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const errBox = document.getElementById('register-error');
      const submitBtn = document.getElementById('btn-register-submit');
      if (errBox) errBox.classList.add('hidden');
      if (submitBtn) {
        submitBtn.disabled = true;
        submitBtn.textContent = 'Mendaftarkan Workspace...';
      }
      try {
        const res = await dbService.apiFetch('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({
            company_name: document.getElementById('reg-company').value,
            full_name: document.getElementById('reg-fullname').value,
            email: document.getElementById('reg-email').value,
            username: document.getElementById('reg-username').value,
            password: document.getElementById('reg-password').value
          })
        });
        dbService.token = res.token;
        currentUser = res.user;
        currentSubscriptionCtx = {
          effective_status: 'TRIAL',
          days_remaining: 10,
          trial_notice: { level: 'info', message: res.message || 'Selamat datang! Anda mendapatkan akses gratis selama 10 hari.' }
        };
        sessionStorage.setItem('stokpintar_token', res.token);
        sessionStorage.setItem('stokpintar_user', JSON.stringify(res.user));
        sessionStorage.setItem('stokpintar_login_at', String(Date.now()));
        showToast(res.message || 'Selamat datang! Anda mendapatkan akses gratis selama 10 hari.');
        enterApp();
      } catch (err) {
        if (errBox) {
          errBox.textContent = err.message;
          errBox.classList.remove('hidden');
        }
      } finally {
        if (submitBtn) {
          submitBtn.disabled = false;
          submitBtn.textContent = 'Mulai Uji Coba Gratis 10 Hari';
        }
      }
    });
  }

  const btnTrialUpgrade = document.getElementById('btn-trial-upgrade');
  if (btnTrialUpgrade) {
    btnTrialUpgrade.addEventListener('click', () => switchView('subscription'));
  }

  const checkoutForm = document.getElementById('checkout-form');
  if (checkoutForm) {
    checkoutForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!selectedCheckoutPlanCode) return;
      const btn = document.getElementById('btn-submit-checkout');
      if (btn) btn.disabled = true;
      try {
        const res = await dbService.apiFetch('/api/saas/checkout', {
          method: 'POST',
          body: JSON.stringify({
            plan_code: selectedCheckoutPlanCode,
            billing_cycle: customerBillingCycle,
            payment_method: document.getElementById('co-method').value,
            proof_note: document.getElementById('co-note').value
          })
        });
        checkoutForm.classList.add('hidden');
        document.getElementById('co-note').value = '';
        showToast(res.instructions || `Pesanan ${res.payment.order_id} dibuat (Status: PENDING).`);
        await refreshSubscriptionView();
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  }

  const btnCancelCheckout = document.getElementById('btn-cancel-checkout');
  if (btnCancelCheckout) {
    btnCancelCheckout.addEventListener('click', () => {
      document.getElementById('checkout-form')?.classList.add('hidden');
      selectedCheckoutPlanCode = null;
    });
  }

  const btnRefreshSaasAdmin = document.getElementById('btn-refresh-saas-admin');
  if (btnRefreshSaasAdmin) {
    btnRefreshSaasAdmin.addEventListener('click', () => refreshSaasAdminView());
  }

  // Edit Manual Langganan & Sinkronisasi Sisa Hari (dalam view-subscription)
  const msCycleEl = document.getElementById('ms-billing-cycle');
  const msStartEl = document.getElementById('ms-start-date');
  const msEndEl = document.getElementById('ms-end-date');
  const manualSubForm = document.getElementById('manual-sub-edit-form');

  const msPlanSelectEl = document.getElementById('ms-plan-code');
  if (msPlanSelectEl) {
    msPlanSelectEl.addEventListener('change', () => syncManualPlanPriceInputs());
  }
  if (msCycleEl) {
    msCycleEl.addEventListener('change', () => syncManualSubEndDateFromCycle());
  }
  if (msStartEl) {
    msStartEl.addEventListener('change', () => syncManualSubEndDateFromCycle());
  }
  if (msEndEl) {
    msEndEl.addEventListener('change', () => updateManualSubDaysPreview());
  }
  if (manualSubForm) {
    manualSubForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      const wsId = (currentUser && currentUser.workspace_id) || 1;
      const btn = document.getElementById('btn-save-manual-sub');
      if (btn) btn.disabled = true;
      try {
        const selectedCode = document.getElementById('ms-plan-code').value;
        const targetPlan = cachedSaasPlans.find((p) => p.code === selectedCode);
        const monthlyRaw = (document.getElementById('ms-price-monthly')?.value || '').trim();
        const yearlyRaw = (document.getElementById('ms-price-yearly')?.value || '').trim();

        if (targetPlan && (monthlyRaw !== '' || yearlyRaw !== '')) {
          await dbService.apiFetch(`/api/admin/saas/plans/${targetPlan.id}`, {
            method: 'PUT',
            body: JSON.stringify({
              name: targetPlan.name,
              price_monthly: monthlyRaw !== '' ? Number(monthlyRaw) : targetPlan.price_monthly,
              price_yearly: yearlyRaw !== '' ? Number(yearlyRaw) : targetPlan.price_yearly,
              max_warehouses: targetPlan.max_warehouses,
              max_users: targetPlan.max_users,
              is_recommended: Boolean(targetPlan.is_recommended),
              is_active: targetPlan.is_active !== false
            })
          });
        }

        await dbService.apiFetch(`/api/admin/saas/subscriptions/${wsId}`, {
          method: 'PUT',
          body: JSON.stringify({
            plan_code: selectedCode,
            billing_cycle: document.getElementById('ms-billing-cycle').value,
            status: document.getElementById('ms-status').value,
            current_period_start: document.getElementById('ms-start-date').value,
            current_period_end: document.getElementById('ms-end-date').value,
            notes: document.getElementById('ms-notes').value || 'Edit manual dari interface Langganan / Paket'
          })
        });
        showToast('Harga paket & masa aktif langganan berhasil diperbarui!');
        document.getElementById('ms-notes').value = '';
        await loadPublicPlans();
        await refreshSubscriptionView();
      } catch (err) {
        showToast(err.message, 'error');
      } finally {
        if (btn) btn.disabled = false;
      }
    });
  }

  const btnDeleteSelectedPlan = document.getElementById('btn-delete-selected-plan');
  if (btnDeleteSelectedPlan) {
    btnDeleteSelectedPlan.addEventListener('click', async () => {
      const code = document.getElementById('ms-plan-code')?.value;
      const targetPlan = cachedSaasPlans.find((p) => p.code === code);
      if (!targetPlan) {
        showToast('Pilih paket yang ingin dihapus terlebih dahulu.', 'error');
        return;
      }
      await deleteAdminPlan(targetPlan.id, targetPlan.name);
      await refreshSubscriptionView();
    });
  }

  const btnDeleteCurrentSub = document.getElementById('btn-delete-current-sub');
  if (btnDeleteCurrentSub) {
    btnDeleteCurrentSub.addEventListener('click', async () => {
      const wsId = (currentUser && currentUser.workspace_id) || 1;
      await deleteCustomerSub(wsId, 'Workspace Saat Ini');
      await refreshSubscriptionView();
    });
  }

  const btnToggleSubAddPlan = document.getElementById('btn-toggle-sub-add-plan');
  const subAddPlanForm = document.getElementById('sub-add-plan-form');
  if (btnToggleSubAddPlan && subAddPlanForm) {
    btnToggleSubAddPlan.addEventListener('click', () => {
      subAddPlanForm.classList.toggle('hidden');
    });
  }
  if (subAddPlanForm) {
    subAddPlanForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await dbService.apiFetch('/api/admin/saas/plans', {
          method: 'POST',
          body: JSON.stringify({
            code: document.getElementById('sub-new-plan-code').value,
            name: document.getElementById('sub-new-plan-name').value,
            price_monthly: Number(document.getElementById('sub-new-plan-monthly').value),
            price_yearly: Number(document.getElementById('sub-new-plan-yearly').value),
            max_warehouses: Number(document.getElementById('sub-new-plan-wh').value),
            max_users: Number(document.getElementById('sub-new-plan-users').value),
            features: ['Manajemen produk', 'Stok masuk dan keluar', 'Laporan stok']
          })
        });
        showToast('Paket & harga baru berhasil ditambahkan!');
        subAddPlanForm.reset();
        subAddPlanForm.classList.add('hidden');
        await loadPublicPlans();
        await refreshSubscriptionView();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  const saAddPlanForm = document.getElementById('sa-add-plan-form');
  if (saAddPlanForm) {
    saAddPlanForm.addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await dbService.apiFetch('/api/admin/saas/plans', {
          method: 'POST',
          body: JSON.stringify({
            code: document.getElementById('new-plan-code').value,
            name: document.getElementById('new-plan-name').value,
            price_monthly: Number(document.getElementById('new-plan-monthly').value),
            price_yearly: Number(document.getElementById('new-plan-yearly').value),
            max_warehouses: Number(document.getElementById('new-plan-wh').value),
            max_users: Number(document.getElementById('new-plan-users').value),
            features: ['Manajemen produk', 'Stok masuk dan keluar', 'Laporan stok']
          })
        });
        showToast('Paket baru berhasil ditambahkan ke database!');
        saAddPlanForm.reset();
        await loadPublicPlans();
        await refreshSaasAdminView();
      } catch (err) {
        showToast(err.message, 'error');
      }
    });
  }

  // Filter & Aksi Log Aktivitas (Superadmin & Spesial)
  const logSearch = document.getElementById('log-search');
  const logFilterAction = document.getElementById('log-filter-action');
  const logFilterDate = document.getElementById('log-filter-date');
  const btnRefreshLogs = document.getElementById('btn-refresh-logs');
  const btnExportLogsCsv = document.getElementById('btn-export-logs-csv');
  if (logSearch) logSearch.addEventListener('input', () => renderLogsTable());
  if (logFilterAction) logFilterAction.addEventListener('change', () => refreshLogsView());
  if (logFilterDate) logFilterDate.addEventListener('change', () => refreshLogsView());
  if (btnRefreshLogs) btnRefreshLogs.addEventListener('click', () => refreshLogsView());
  if (btnExportLogsCsv) btnExportLogsCsv.addEventListener('click', exportLogsToCSV);
}

function populateCustomerCategoryOptions(type) {
  const select = document.getElementById('cust-category');
  if (!select) return;
  select.innerHTML = '';
  (CUSTOMER_CATEGORIES[type] || CUSTOMER_CATEGORIES.IN).forEach((c) => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = c;
    select.appendChild(opt);
  });
}

function formatRupiah(amount) {
  return `Rp ${Math.round(Number(amount || 0)).toLocaleString('id-ID')}`;
}

function updateSellTotalHint() {
  const hint = document.getElementById('tx-sell-total-hint');
  if (!hint) return;
  const qty = Math.max(0, parseFloat(document.getElementById('tx-quantity')?.value) || 0);
  const price = Math.max(0, parseFloat(document.getElementById('tx-sell-price')?.value) || 0);
  const total = qty * price;
  hint.innerHTML = `Total Penjualan: <strong>${formatRupiah(total)}</strong>`;
}

function updateSellPriceFieldVisibility() {
  const group = document.getElementById('tx-sell-price-group');
  const reasonEl = document.getElementById('tx-reason');
  const priceInput = document.getElementById('tx-sell-price');
  if (!group || !reasonEl) return;

  const isSold = String(reasonEl.value || '').toLowerCase() === 'dijual';
  group.classList.toggle('hidden', !isSold);
  if (!isSold && priceInput) {
    priceInput.value = '';
  }
  updateSellTotalHint();
}

function populateReasonOptions(mode) {
  const select = document.getElementById('tx-reason');
  select.innerHTML = '';
  ALL_STOCK_REASONS.forEach((r) => {
    const opt = document.createElement('option');
    opt.value = r;
    opt.textContent = r;
    select.appendChild(opt);
  });

  if (mode === 'IN') {
    select.value = 'Restok';
  } else if (mode === 'DISMANTLE') {
    select.value = 'Dismantle';
  } else if (mode === 'OUT') {
    select.value = 'Pemasangan';
  }
  updateSellPriceFieldVisibility();
}

async function enterApp() {
  startSessionExpiryWatcher();
  if (!currentUser) return;

  document.documentElement.classList.remove('auth-booting');
  document.getElementById('login-screen').classList.add('hidden');
  document.getElementById('app-screen').classList.remove('hidden');
  initLucideIcons();

  const role = normalizeRole(currentUser.role);
  currentUser.role = role;

  document.getElementById('current-user-name').textContent = currentUser.full_name;
  document.getElementById('current-user-role').textContent = role.toUpperCase();
  document.getElementById('current-user-avatar').textContent = currentUser.full_name.charAt(0).toUpperCase();

  const allowStock = canAccessStock(role);
  const allowStockEdit = canEditStock(role);
  const allowCust = canAccessCustomers(role);
  const allowUsers = canManageUsers(role);
  const allowLogs = canAccessLogs(role);
  const isPlatAdmin = isCurrentPlatformAdmin();

  document.querySelectorAll('.nav-stock-only').forEach((el) => {
    el.classList.toggle('hidden', !allowStock);
  });
  document.querySelectorAll('.nav-cust-only').forEach((el) => {
    el.classList.toggle('hidden', !allowCust);
  });
  document.querySelectorAll('.superadmin-only').forEach((el) => {
    el.classList.toggle('hidden', !allowUsers);
  });
  document.querySelectorAll('.log-access-only').forEach((el) => {
    el.classList.toggle('hidden', !allowLogs);
  });
  document.querySelectorAll('.stock-edit-only').forEach((el) => {
    el.classList.toggle('hidden', !allowStockEdit);
  });
  document.querySelectorAll('.platform-admin-only').forEach((el) => {
    el.classList.toggle('hidden', !isPlatAdmin);
  });

  renderTrialStatusBanner(currentSubscriptionCtx);

  if (currentSubscriptionCtx && currentSubscriptionCtx.effective_status === 'EXPIRED') {
    switchView('subscription');
    return;
  }

  // Cek apakah dibuka dari URL folder langsung (?folder=GMDP atau ?folder=GENAP)
  const params = new URLSearchParams(window.location.search);
  const folderParam = (params.get('folder') || '').toUpperCase();
  if (folderParam === 'GMDP' && allowCust) {
    switchView('gmdp');
  } else if (folderParam === 'GENAP' && allowCust) {
    switchView('genap');
  } else if (allowStock) {
    switchView('daily');
  } else {
    switchView('gmdp');
  }
}

async function switchView(viewName) {
  const role = normalizeRole(currentUser ? currentUser.role : 'teknisi');

  // Proteksi hak akses per halaman
  if (['daily', 'monthly', 'items'].includes(viewName) && !canAccessStock(role)) {
    viewName = 'gmdp';
  }
  if (['gmdp', 'genap'].includes(viewName) && !canAccessCustomers(role)) {
    viewName = 'daily';
  }
  if (viewName === 'users' && !canManageUsers(role)) {
    viewName = canAccessStock(role) ? 'daily' : 'gmdp';
  }
  if (viewName === 'logs' && !canAccessLogs(role)) {
    viewName = canAccessStock(role) ? 'daily' : 'gmdp';
  }
  if (viewName === 'saas-admin' && !isCurrentPlatformAdmin()) {
    viewName = canAccessStock(role) ? 'daily' : 'subscription';
  }

  document.querySelectorAll('.nav-item').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-view') === viewName);
  });
  document.querySelectorAll('.mobile-bnav-item[data-view]').forEach((btn) => {
    btn.classList.toggle('active', btn.getAttribute('data-view') === viewName);
  });

  document.querySelectorAll('.view-section').forEach((sec) => sec.classList.add('hidden'));

  if (viewName === 'gmdp' || viewName === 'genap') {
    activeCustomerFolder = viewName.toUpperCase();
    document.getElementById('view-customers').classList.remove('hidden');
  } else {
    const targetSec = document.getElementById(`view-${viewName}`);
    if (targetSec) targetSec.classList.remove('hidden');
  }

  const titles = {
    daily: [
      'Update Stok Harian — Sri Barada Indra Sakti',
      'Catat barang masuk baru, barang masuk dismantle, dan barang keluar setiap hari'
    ],
    monthly: [
      'Resume Otomatis Bulanan — Sri Barada Indra Sakti',
      'Rekapitulasi stok awal, masuk baru, masuk dismantle, keluar, dan stok akhir per bulan'
    ],
    items: ['Master Data Barang', 'Daftar katalog perangkat & material instalasi, SKU, dan batas stok minimum'],
    users: [
      'Manajemen Pengguna & Sistem (Khusus Superadmin)',
      'Kelola hak akses Superadmin, Admin, Teknisi, Spesial, dan Viewer'
    ],
    logs: [
      'Log Aktivitas Pengguna — Login, Edit & Export',
      'Pantau riwayat login, perubahan data, dan aktivitas export (Khusus Superadmin & Spesial)'
    ],
    subscription: [
      'Langganan & Paket Workspace',
      'Pantau masa aktif trial/langganan, kuota penggunaan, tagihan, dan upgrade paket'
    ],
    'saas-admin': [
      'Platform Super Admin SaaS',
      'Kelola seluruh pelanggan workspace, paket berlangganan, harga, dan verifikasi pembayaran'
    ],
    gmdp: [
      'Pelanggan GMDP — Sri Barada Indra Sakti',
      'Database mandiri khusus pelanggan perusahaan GMDP (Update Harian, Edit Manual Bulan/Tahun & Trafik)'
    ],
    genap: [
      'Pelanggan GENAP — Sri Barada Indra Sakti',
      'Database mandiri khusus pelanggan perusahaan GENAP (Update Harian, Edit Manual Bulan/Tahun & Trafik)'
    ]
  };

  const [title, subtitle] = titles[viewName] || titles.daily;
  document.getElementById('page-title').textContent = title;
  document.getElementById('page-subtitle').textContent = subtitle;
  const breadcrumbEl = document.getElementById('breadcrumb-current');
  if (breadcrumbEl) {
    const shortLabels = {
      daily: 'Update Stok Harian',
      monthly: 'Resume Bulanan',
      items: 'Master Data Barang',
      users: 'Kelola Pengguna',
      logs: 'Log Aktivitas',
      gmdp: 'Pelanggan GMDP',
      genap: 'Pelanggan GENAP'
    };
    breadcrumbEl.textContent = shortLabels[viewName] || title;
  }
  initLucideIcons();

  if (viewName === 'daily') await refreshDailyView();
  if (viewName === 'monthly') await refreshMonthlyView();
  if (viewName === 'items') await refreshItemsView();
  if (viewName === 'users' && canManageUsers(role)) await refreshUsersView();
  if (viewName === 'logs' && canAccessLogs(role)) await refreshLogsView();
  if (viewName === 'subscription') await refreshSubscriptionView();
  if (viewName === 'saas-admin' && isCurrentPlatformAdmin()) await refreshSaasAdminView();
  if (viewName === 'gmdp' || viewName === 'genap') await refreshCustomersView();
}

// ==================== RENDER VIEW 1: STOK HARIAN ====================
function renderTxItemOptions(autoSelectSingle = false) {
  const itemSelect = document.getElementById('tx-item');
  if (!itemSelect) return;
  const searchInput = document.getElementById('tx-item-search');
  const keyword = (searchInput ? searchInput.value : '').trim().toLowerCase();
  const currentSelected = itemSelect.value;

  const filtered = cachedItems.filter((item) => {
    if (!keyword) return true;
    return (
      (item.sku || '').toLowerCase().includes(keyword) ||
      (item.name || '').toLowerCase().includes(keyword) ||
      (item.category || '').toLowerCase().includes(keyword)
    );
  });

  if (filtered.length === 0) {
    itemSelect.innerHTML = '<option value="">-- Barang tidak ditemukan --</option>';
  } else {
    const placeholder = keyword
      ? `-- Pilih Barang (${filtered.length} ditemukan) --`
      : '-- Pilih Barang --';
    itemSelect.innerHTML = `<option value="">${placeholder}</option>`;
    filtered.forEach((item) => {
      const opt = document.createElement('option');
      opt.value = item.id;
      opt.textContent = `[${item.sku}] ${item.name} — Stok: ${item.current_stock} ${item.unit}`;
      itemSelect.appendChild(opt);
    });
  }

  if (autoSelectSingle && keyword && filtered.length === 1) {
    itemSelect.value = String(filtered[0].id);
  } else if (currentSelected && filtered.some((i) => String(i.id) === String(currentSelected))) {
    itemSelect.value = currentSelected;
  }
  itemSelect.dispatchEvent(new Event('change'));
}

function getFilteredDailyTransactions() {
  const searchInput = document.getElementById('filter-tx-search');
  const keyword = (searchInput ? searchInput.value : '').trim().toLowerCase();

  return cachedDailyTransactions.filter((t) => {
    if (!keyword) return true;
    return (
      (t.item_name || '').toLowerCase().includes(keyword) ||
      (t.sku || '').toLowerCase().includes(keyword) ||
      (t.reason || '').toLowerCase().includes(keyword) ||
      (t.notes || '').toLowerCase().includes(keyword) ||
      (t.user_name || '').toLowerCase().includes(keyword)
    );
  });
}

function renderDailyTransactionsTable() {
  const tbody = document.getElementById('tx-table-body');
  if (!tbody) return;
  const filteredTransactions = getFilteredDailyTransactions();

  const allowEditStock = currentUser && canEditStock(currentUser.role);
  if (filteredTransactions.length === 0) {
    const emptyMsg = currentDailyFilterMonth
      ? `Tidak ada update / transaksi stok pada bulan ${formatMonthNameID(currentDailyFilterMonth)}.`
      : 'Belum ada transaksi stok pada filter/pencarian yang dipilih.';
    tbody.innerHTML = `<tr><td colspan="${allowEditStock ? 8 : 6}" class="text-center text-muted">${emptyMsg}</td></tr>`;
    renderTablePagination('tx-pagination', 'tx', { total: 0 }, renderDailyTransactionsTable);
    updateBulkDeleteTxUI();
    return;
  }

  const pageInfo = paginateRows(filteredTransactions, 'tx');

  tbody.innerHTML = pageInfo.items
    .map((t) => {
      const isDismantle = t.type === 'IN' && isDismantleReason(t.reason);
      const badgeClass = isDismantle ? 'badge-dismantle' : t.type === 'IN' ? 'badge-in' : 'badge-out';
      const badgeLabel = isDismantle ? '🔧 DISMANTLE' : t.type === 'IN' ? '📥 MASUK' : '📤 KELUAR';
      const qtyClass = isDismantle ? 'text-dismantle' : t.type === 'IN' ? 'text-success' : 'text-danger';

      return `
      <tr>
        <td class="${allowEditStock ? '' : 'hidden'} text-center">
          <input type="checkbox" class="tx-select-cb" value="${t.id}" onchange="updateBulkDeleteTxUI()" />
        </td>
        <td><strong>${formatDateID(t.date)}</strong></td>
        <td>
          <div><strong>${escapeHtml(t.item_name)}</strong></div>
          <div class="text-muted text-sm">${escapeHtml(t.sku)}</div>
        </td>
        <td>
          <span class="badge ${badgeClass}">${badgeLabel}</span>
        </td>
        <td>
          <strong class="${qtyClass}">
            ${t.type === 'IN' ? '+' : '-'}${t.quantity} ${escapeHtml(t.unit)}
          </strong>
        </td>
        <td>
          <div>${escapeHtml(t.reason)}</div>
          ${
            String(t.reason || '').toLowerCase().includes('dijual') && Number(t.total_sell_price || 0) > 0
              ? `<div class="text-sm text-success"><strong>${formatRupiah(t.total_sell_price)}</strong> <span class="text-muted">(${formatRupiah(t.sell_price)}/${escapeHtml(t.unit)})</span></div>`
              : ''
          }
        </td>
        <td>
          <div>${escapeHtml(t.notes || '-')}</div>
          <div class="text-muted text-sm">Oleh: ${escapeHtml(t.user_name || 'Petugas')}</div>
        </td>
        <td class="${allowEditStock ? '' : 'hidden'}">
          <button class="btn-icon-danger" onclick="handleDeleteTx(${t.id})" title="Batalkan & Kembalikan Stok">
            Hapus
          </button>
        </td>
      </tr>
    `;
    })
    .join('');
  renderTablePagination('tx-pagination', 'tx', pageInfo, renderDailyTransactionsTable);
  updateBulkDeleteTxUI();
}

window.updateBulkDeleteTxUI = function () {
  const allCbs = Array.from(document.querySelectorAll('.tx-select-cb'));
  const checkedCbs = allCbs.filter((cb) => cb.checked);
  const countEl = document.getElementById('selected-tx-count');
  const btnEl = document.getElementById('btn-bulk-delete-tx');
  const selectAllEl = document.getElementById('select-all-tx');

  if (countEl) countEl.textContent = String(checkedCbs.length);
  if (btnEl) btnEl.disabled = checkedCbs.length === 0;
  if (selectAllEl) {
    selectAllEl.checked = allCbs.length > 0 && checkedCbs.length === allCbs.length;
    selectAllEl.indeterminate = checkedCbs.length > 0 && checkedCbs.length < allCbs.length;
  }
};

async function handleBulkDeleteTx() {
  const checkedIds = Array.from(document.querySelectorAll('.tx-select-cb:checked')).map((cb) => Number(cb.value));
  if (checkedIds.length === 0) {
    showToast('Centang minimal 1 transaksi yang ingin dihapus.', 'error');
    return;
  }
  if (!confirm(`Yakin ingin membatalkan & menghapus ${checkedIds.length} transaksi terpilih sekaligus? Stok barang akan dikembalikan.`)) {
    return;
  }
  try {
    await dbService.bulkDeleteTransactions(checkedIds);
    showToast(`${checkedIds.length} transaksi berhasil dihapus & stok dikembalikan.`);
    await refreshDailyView();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function populateDailyFilterYearOptions(selectedYear) {
  const yearSelect = document.getElementById('filter-year-select');
  if (!yearSelect) return;

  const currentYear = new Date().getFullYear();
  const targetYear = Number(selectedYear) || currentYear;
  const minYear = Math.min(2020, currentYear - 5, targetYear);
  const maxYear = Math.max(2030, currentYear + 3, targetYear);

  yearSelect.innerHTML = '';
  for (let y = minYear; y <= maxYear; y++) {
    const opt = document.createElement('option');
    opt.value = String(y);
    opt.textContent = String(y);
    yearSelect.appendChild(opt);
  }
  yearSelect.value = String(targetYear);
}

function syncDailyMonthFilterFromSelects() {
  const monthSelect = document.getElementById('filter-month-select');
  const yearSelect = document.getElementById('filter-year-select');
  const filterDateEl = document.getElementById('filter-date');
  if (!monthSelect || !yearSelect || !filterDateEl) return;

  const m = monthSelect.value;
  const y = yearSelect.value || String(new Date().getFullYear());
  filterDateEl.value = m ? `${y}-${m}` : '';
  refreshDailyView();
}

async function refreshDailyView() {
  cachedItems = await dbService.getItems();
  const filterMonth = document.getElementById('filter-date').value;
  const filterType = document.getElementById('filter-type').value;

  renderTxItemOptions(false);

  const allTransactions = await dbService.getTransactions({
    month: filterMonth || undefined,
    type: filterType
  });
  cachedDailyTransactions = allTransactions;

  // Statistik berdasarkan filter bulan atau keseluruhan jika semua bulan
  const txForStat = filterMonth
    ? await dbService.getTransactions({ month: filterMonth })
    : await dbService.getTransactions({});

  let inQty = 0,
    inCount = 0,
    dismantleQty = 0,
    dismantleCount = 0,
    outQty = 0,
    outCount = 0;

  txForStat.forEach((t) => {
    if (t.type === 'IN') {
      inQty += t.quantity;
      inCount++;
      if (isDismantleReason(t.reason)) {
        dismantleQty += t.quantity;
        dismantleCount++;
      }
    } else {
      outQty += t.quantity;
      outCount++;
    }
  });

  const labelScope = filterMonth ? formatMonthNameID(filterMonth) : 'Semua Bulan';
  const lowStockItems = cachedItems.filter((i) => i.current_stock <= i.min_stock);

  currentDailyFilterMonth = filterMonth || '';
  if (currentDailyFilterMonth) {
    if (txForStat.length === 0) {
      cachedDailyMonthItems = [];
    } else {
      const monthReport = await dbService.getMonthlyReport(currentDailyFilterMonth);
      cachedDailyMonthItems = (monthReport.items || []).map((r) => ({
        id: r.item_id,
        sku: r.sku,
        name: r.name,
        category: r.category,
        unit: r.unit,
        current_stock: Number(r.closing_stock || 0)
      }));
    }
  } else {
    cachedDailyMonthItems = null;
  }

  populateCategoryFilterSelect(
    'daily-category-filter',
    cachedDailyMonthItems !== null ? cachedDailyMonthItems : cachedItems
  );
  renderDailyCategoryStockView();

  document.getElementById('stat-today-in').textContent = `+${inQty}`;
  document.getElementById('stat-today-in-tx').textContent = `${inCount} transaksi masuk (${labelScope})`;
  document.getElementById('stat-today-dismantle').textContent = `+${dismantleQty}`;
  document.getElementById('stat-today-dismantle-tx').textContent = `${dismantleCount} masuk dismantle (${labelScope})`;
  document.getElementById('stat-today-out').textContent = `-${outQty}`;
  document.getElementById('stat-today-out-tx').textContent = `${outCount} transaksi keluar (${labelScope})`;
  document.getElementById('stat-low-stock').textContent = lowStockItems.length;
  updateLowStockNotifications(cachedItems);

  const banner = document.getElementById('low-stock-banner');
  if (lowStockItems.length > 0) {
    banner.classList.remove('hidden');
    document.getElementById('low-stock-list').textContent = lowStockItems
      .map((i) => `${i.name} (Sisa ${i.current_stock} ${i.unit}, Min ${i.min_stock})`)
      .join(' • ');
  } else {
    banner.classList.add('hidden');
  }

  renderDailyTransactionsTable();
}

window.handleDeleteTx = async function (id) {
  if (!confirm('Hapus transaksi ini? Stok barang akan dikembalikan secara otomatis.')) return;
  try {
    await dbService.deleteTransaction(id);
    showToast('Transaksi berhasil dihapus dan stok telah disesuaikan.');
    await refreshDailyView();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

// ==================== RENDER VIEW 2: RESUME OTOMATIS BULANAN ====================
function populateReportYearOptions(selectedYear) {
  const yearSelect = document.getElementById('report-year-select');
  if (!yearSelect) return;

  const currentYear = new Date().getFullYear();
  const targetYear = Number(selectedYear) || currentYear;
  const minYear = Math.min(2020, currentYear - 5, targetYear);
  const maxYear = Math.max(2030, currentYear + 3, targetYear);

  yearSelect.innerHTML = '';
  for (let y = minYear; y <= maxYear; y++) {
    const opt = document.createElement('option');
    opt.value = String(y);
    opt.textContent = String(y);
    yearSelect.appendChild(opt);
  }
  yearSelect.value = String(targetYear);
}

function syncMonthlyPickersFromInput() {
  const monthInput = document.getElementById('report-month');
  const monthSelect = document.getElementById('report-month-select');
  const yearSelect = document.getElementById('report-year-select');
  if (!monthInput || !monthSelect || !yearSelect) return;

  const val = monthInput.value || getCurrentMonthStr();
  const parts = val.split('-');
  if (parts.length === 2) {
    const [year, month] = parts;
    populateReportYearOptions(year);
    monthSelect.value = month;
    yearSelect.value = year;
  }
}

function syncReportMonthInputFromSelects() {
  const monthInput = document.getElementById('report-month');
  const monthSelect = document.getElementById('report-month-select');
  const yearSelect = document.getElementById('report-year-select');
  if (!monthInput || !monthSelect || !yearSelect) return;

  const year = yearSelect.value || String(new Date().getFullYear());
  const month = monthSelect.value || '01';
  monthInput.value = `${year}-${month}`;
  refreshMonthlyView();
}

function renderMonthlyItemsTable() {
  if (!currentMonthlyReport) return;
  const itemsTbody = document.getElementById('monthly-items-tbody');
  if (!itemsTbody) return;

  const searchInput = document.getElementById('search-monthly-item');
  const keyword = (searchInput ? searchInput.value : '').trim().toLowerCase();
  const rows = (currentMonthlyReport.items || []).filter((row) => {
    if (!keyword) return true;
    return (
      (row.sku || '').toLowerCase().includes(keyword) ||
      (row.name || '').toLowerCase().includes(keyword) ||
      (row.category || '').toLowerCase().includes(keyword)
    );
  });

  if (rows.length === 0) {
    itemsTbody.innerHTML = `<tr><td colspan="13" class="text-center text-muted">Tidak ada barang yang sesuai dengan pencarian "${escapeHtml(keyword)}".</td></tr>`;
    renderTablePagination('monthly-items-pagination', 'monthlyItems', { total: 0 }, renderMonthlyItemsTable);
    return;
  }

  const pageInfo = paginateRows(rows, 'monthlyItems');

  itemsTbody.innerHTML = pageInfo.items
    .map((row) => {
      const dism = row.dismantle_in_count || 0;
      const regIn = row.total_in - dism;
      const inst = row.install_count || 0;
      const sold = row.sold_count || 0;
      const dmg = row.damaged_count || 0;
      const netStr = row.net_change > 0 ? `+${row.net_change}` : `${row.net_change}`;
      const netClass = row.net_change > 0 ? 'text-success' : row.net_change < 0 ? 'text-danger' : '';
      return `
        <tr>
          <td><code>${escapeHtml(row.sku)}</code></td>
          <td><strong>${escapeHtml(row.name)}</strong> <span class="text-muted text-sm">(${escapeHtml(row.unit)})</span></td>
          <td>${escapeHtml(row.category)}</td>
          <td class="text-right">${row.opening_stock}</td>
          <td class="text-right text-success">+${regIn}</td>
          <td class="text-right text-dismantle"><strong>+${dism}</strong></td>
          <td class="text-right text-success"><strong>+${row.total_in}</strong></td>
          <td class="text-right">${inst}</td>
          <td class="text-right">${sold}</td>
          <td class="text-right">${dmg}</td>
          <td class="text-right text-danger"><strong>-${row.total_out}</strong></td>
          <td class="text-right ${netClass}">${netStr}</td>
          <td class="text-right"><strong>${row.closing_stock} ${escapeHtml(row.unit)}</strong></td>
        </tr>
      `;
    })
    .join('');
  renderTablePagination('monthly-items-pagination', 'monthlyItems', pageInfo, renderMonthlyItemsTable);
}

async function refreshMonthlyView() {
  const month = document.getElementById('report-month').value || getCurrentMonthStr();
  syncMonthlyPickersFromInput();
  const report = await dbService.getMonthlyReport(month);
  currentMonthlyReport = report;

  document.getElementById('print-period-label').textContent = `Periode Bulan: ${formatMonthNameID(month)}`;
  document.getElementById('print-meta-label').textContent = `Dicetak oleh: ${
    currentUser ? currentUser.full_name : '-'
  } pada ${formatDateID(getTodayStr())} • SRI BARADA INDRA SAKTI`;

  const dismantleTotal = report.totals.dismantle_in_count || 0;
  const regularInTotal = report.totals.total_in - dismantleTotal;
  const installTotal = report.totals.install_count || 0;
  const soldTotal = report.totals.sold_count || 0;
  const damagedTotal = report.totals.damaged_count || 0;

  document.getElementById('rep-opening-stock').textContent = report.totals.opening_stock.toLocaleString('id-ID');
  document.getElementById('rep-total-in').textContent = `+${report.totals.total_in.toLocaleString('id-ID')}`;
  document.getElementById('rep-in-breakdown').textContent = `Restok: ${regularInTotal} | Dismantle: ${dismantleTotal}`;
  document.getElementById('rep-total-dismantle').textContent = `+${dismantleTotal.toLocaleString('id-ID')}`;
  document.getElementById('rep-total-out').textContent = `-${report.totals.total_out.toLocaleString('id-ID')}`;
  const soldRevenue = report.totals.total_sold_revenue || 0;
  document.getElementById(
    'rep-out-breakdown'
  ).textContent = `Pemasangan: ${installTotal} | Dijual: ${soldTotal}${
    soldRevenue > 0 ? ` (${formatRupiah(soldRevenue)})` : ''
  } | Rusak: ${damagedTotal}`;
  document.getElementById('rep-closing-stock').textContent = report.totals.closing_stock.toLocaleString('id-ID');
  document.getElementById('rep-stock-value').textContent = 'Total sisa stok fisik di akhir bulan';

  // Render Total Stok Barang per Kategori di Resume Bulanan
  populateCategoryFilterSelect('monthly-category-filter', report.items || []);
  renderMonthlyCategoryStockView();

  // Breakdown Alasan Mutasi
  const reasonContainer = document.getElementById('reason-breakdown-container');
  if (report.reasons.length === 0) {
    reasonContainer.innerHTML = `<p class="text-muted">Belum ada mutasi stok pada bulan ${formatMonthNameID(month)}.</p>`;
  } else {
    const maxQty = Math.max(...report.reasons.map((r) => r.total_quantity), 1);
    reasonContainer.innerHTML = report.reasons
      .map((r) => {
        const pct = Math.round((r.total_quantity / maxQty) * 100);
        const isIn = r.type === 'IN';
        const isDismantle = isIn && isDismantleReason(r.reason);
        const badgeClass = isDismantle ? 'badge-dismantle' : isIn ? 'badge-in' : 'badge-out';
        const badgeText = isDismantle ? 'DISMANTLE (+)' : isIn ? 'RESTOK (+)' : 'KELUAR (-)';
        const barClass = isDismantle ? 'dismantle' : isIn ? 'in' : 'out';

        return `
          <div class="reason-item">
            <div class="reason-header">
              <span>
                <span class="badge ${badgeClass}">${badgeText}</span>
                <strong>${r.reason}</strong> (${r.tx_count}x transaksi)
              </span>
              <strong>${isIn ? '+' : '-'}${r.total_quantity} unit</strong>
            </div>
            <div class="progress-track">
              <div class="progress-fill ${barClass}" style="width: ${pct}%"></div>
            </div>
          </div>
        `;
      })
      .join('');
  }

  // Tabel Ringkasan per Tanggal
  const dailyTbody = document.getElementById('daily-summary-tbody');
  if (report.daily.length === 0) {
    dailyTbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">Tidak ada aktivitas di bulan ini.</td></tr>`;
  } else {
    dailyTbody.innerHTML = report.daily
      .map((d) => {
        const dism = d.dismantle_in || 0;
        const regIn = d.total_in - dism;
        const net = d.total_in - d.total_out;
        return `
          <tr>
            <td><strong>${formatDateID(d.date)}</strong></td>
            <td>${d.tx_count} transaksi</td>
            <td class="text-success">+${regIn}</td>
            <td class="text-dismantle"><strong>+${dism}</strong></td>
            <td class="text-danger">-${d.total_out}</td>
            <td><strong>${net >= 0 ? '+' + net : net}</strong></td>
          </tr>
        `;
      })
      .join('');
  }

  // Tabel Utama Resume Per Barang
  renderMonthlyItemsTable();

  const t = report.totals;
  const totalDism = t.dismantle_in_count || 0;
  const totalRegIn = t.total_in - totalDism;
  const totalNet = t.total_in - t.total_out;
  document.getElementById('monthly-items-tfoot').innerHTML = `
    <tr>
      <td colspan="3">TOTAL KESELURUHAN (${formatMonthNameID(month)})</td>
      <td class="text-right">${t.opening_stock}</td>
      <td class="text-right text-success">+${totalRegIn}</td>
      <td class="text-right text-dismantle">+${totalDism}</td>
      <td class="text-right text-success">+${t.total_in}</td>
      <td class="text-right">${t.install_count || 0}</td>
      <td class="text-right">${t.sold_count || 0}</td>
      <td class="text-right">${t.damaged_count || 0}</td>
      <td class="text-right text-danger">-${t.total_out}</td>
      <td class="text-right">${totalNet >= 0 ? '+' + totalNet : totalNet}</td>
      <td class="text-right">${t.closing_stock}</td>
    </tr>
  `;
}

function exportDailyTransactionsToExcel() {
  const rowsData = getFilteredDailyTransactions();
  if (!rowsData || rowsData.length === 0) {
    showToast('Tidak ada data transaksi harian pada filter saat ini untuk diekspor.', 'error');
    return;
  }

  const filterDate = document.getElementById('filter-date')?.value || '';
  const filterType = document.getElementById('filter-type')?.value || 'ALL';
  const scopeTag = filterDate ? filterDate : `Semua_Bulan_${filterType}`;

  const headers = [
    'Tanggal',
    'Kode SKU',
    'Nama Barang',
    'Tipe Mutasi',
    'Jumlah',
    'Satuan',
    'Alasan / Kategori',
    'Harga Satuan Jual (Rp)',
    'Total Harga Jual (Rp)',
    'Catatan',
    'Petugas'
  ];

  const csvRows = rowsData.map((t) => {
    const isDismantle = t.type === 'IN' && isDismantleReason(t.reason);
    const tipeLabel = isDismantle ? 'MASUK DISMANTLE (+)' : t.type === 'IN' ? 'BARANG MASUK (+)' : 'BARANG KELUAR (-)';
    const signedQty = t.type === 'IN' ? t.quantity : -t.quantity;
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

    return [
      esc(t.date),
      esc(t.sku),
      esc(t.item_name),
      esc(tipeLabel),
      signedQty,
      esc(t.unit),
      esc(t.reason),
      Number(t.sell_price || 0),
      Number(t.total_sell_price || 0),
      esc(t.notes || '-'),
      esc(t.user_name || 'Petugas')
    ].join(',');
  });

  const csvString = '\uFEFF' + [headers.join(','), ...csvRows].join('\n');
  const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const fileName = `Riwayat_Transaksi_Harian_Sri_Barada_${scopeTag}.csv`;

  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', fileName);
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  dbService.recordExportLog('Stok Harian', `Export Excel Riwayat Transaksi (${fileName})`);
  showToast(`File ${fileName} berhasil diunduh!`);
}

function populateCategoryFilterSelect(selectId, items) {
  const select = document.getElementById(selectId);
  if (!select) return;
  const currentVal = select.value || 'ALL';
  const categories = Array.from(
    new Set((items || []).map((i) => (i.category || 'Lainnya').trim()).filter(Boolean))
  ).sort((a, b) => a.localeCompare(b));

  select.innerHTML = '<option value="ALL">Semua Kategori</option>';
  categories.forEach((cat) => {
    const opt = document.createElement('option');
    opt.value = cat;
    opt.textContent = cat;
    select.appendChild(opt);
  });

  select.value = currentVal !== 'ALL' && categories.includes(currentVal) ? currentVal : 'ALL';
}

function renderDailyCategoryStockView() {
  const totalBadge = document.getElementById('total-all-stock-badge');
  const gridEl = document.getElementById('daily-category-stock-grid');

  if (currentDailyFilterMonth && Array.isArray(cachedDailyMonthItems) && cachedDailyMonthItems.length === 0) {
    if (totalBadge) {
      totalBadge.textContent = `Tidak ada update (${formatMonthNameID(currentDailyFilterMonth)})`;
    }
    if (gridEl) {
      gridEl.innerHTML = `<p class="text-muted">Tidak ada update stok pada bulan ${formatMonthNameID(
        currentDailyFilterMonth
      )}.</p>`;
    }
    return;
  }

  const sourceItems = cachedDailyMonthItems !== null ? cachedDailyMonthItems : cachedItems;
  const catFilter = document.getElementById('daily-category-filter')?.value || 'ALL';
  const keyword = (document.getElementById('daily-category-search')?.value || '').trim().toLowerCase();

  const filtered = sourceItems.filter((item) => {
    const itemCat = (item.category || 'Lainnya').trim();
    const matchCat = catFilter === 'ALL' || itemCat === catFilter;
    const matchKeyword =
      !keyword ||
      itemCat.toLowerCase().includes(keyword) ||
      (item.name || '').toLowerCase().includes(keyword) ||
      (item.sku || '').toLowerCase().includes(keyword);
    return matchCat && matchKeyword;
  });

  const totalUnits = filtered.reduce((sum, i) => sum + Number(i.current_stock || 0), 0);
  if (totalBadge) {
    const monthSuffix = currentDailyFilterMonth ? ` (${formatMonthNameID(currentDailyFilterMonth)})` : '';
    const prefix =
      catFilter === 'ALL' && !keyword
        ? currentDailyFilterMonth
          ? 'Total Stok Bulan Terpilih'
          : 'Total Fisik Gudang'
        : 'Total Stok Terfilter';
    totalBadge.textContent = `${prefix}${monthSuffix}: ${totalUnits.toLocaleString('id-ID')} Unit`;
  }

  renderCategoryStockGrid('daily-category-stock-grid', filtered, false);
}

function renderMonthlyCategoryStockView() {
  if (!currentMonthlyReport) return;
  const month = currentMonthlyReport.month;
  const allItems = currentMonthlyReport.items || [];
  const catFilter = document.getElementById('monthly-category-filter')?.value || 'ALL';
  const keyword = (document.getElementById('monthly-category-search')?.value || '').trim().toLowerCase();

  const filtered = allItems.filter((item) => {
    const itemCat = (item.category || 'Lainnya').trim();
    const matchCat = catFilter === 'ALL' || itemCat === catFilter;
    const matchKeyword =
      !keyword ||
      itemCat.toLowerCase().includes(keyword) ||
      (item.name || '').toLowerCase().includes(keyword) ||
      (item.sku || '').toLowerCase().includes(keyword);
    return matchCat && matchKeyword;
  });

  const filteredClosing = filtered.reduce((sum, i) => sum + Number(i.closing_stock || 0), 0);
  const monthlyTotalBadge = document.getElementById('monthly-total-stock-badge');
  if (monthlyTotalBadge) {
    const label = catFilter === 'ALL' && !keyword ? `Total Stok Akhir (${formatMonthNameID(month)})` : `Stok Akhir Terfilter`;
    monthlyTotalBadge.textContent = `${label}: ${filteredClosing.toLocaleString('id-ID')} Unit`;
  }

  renderMonthlyCategoryStockGrid('monthly-category-stock-grid', filtered);
}

function exportMonthlyToCSV() {
  if (!currentMonthlyReport) return;
  const month = currentMonthlyReport.month;
  const headers = [
    'SKU',
    'Nama Barang',
    'Kategori',
    'Satuan',
    'Stok Awal Bulan',
    'Restok (+)',
    'Dismantle (+)',
    'Total Masuk (+)',
    'Keluar Pemasangan',
    'Keluar Dijual',
    'Keluar Rusak',
    'Total Keluar (-)',
    'Perubahan Bersih',
    'Stok Akhir Bulan'
  ];

  const rows = currentMonthlyReport.items.map((r) => {
    const dism = r.dismantle_in_count || 0;
    const regIn = r.total_in - dism;
    return [
      r.sku,
      `"${r.name.replace(/"/g, '""')}"`,
      `"${r.category}"`,
      r.unit,
      r.opening_stock,
      regIn,
      dism,
      r.total_in,
      r.install_count || 0,
      r.sold_count || 0,
      r.damaged_count || 0,
      r.total_out,
      r.net_change,
      r.closing_stock
    ];
  });

  const csvContent =
    'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `Resume_Stok_Sri_Barada_Indra_Sakti_${month}.csv`);
  document.body.appendChild(link);
  link.click();
  link.remove();
  dbService.recordExportLog('Resume Bulanan', `Export CSV Resume Bulanan (${month})`);
  showToast(`File Resume_Stok_Sri_Barada_Indra_Sakti_${month}.csv berhasil diunduh!`);
}

// ==================== RENDER TOTAL STOK PER KATEGORI ====================
function renderMonthlyCategoryStockGrid(containerId, reportItems) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (!reportItems || reportItems.length === 0) {
    container.innerHTML = `<p class="text-muted">Belum ada data barang untuk dikelompokkan per kategori.</p>`;
    return;
  }

  const categoryMap = {};
  reportItems.forEach((item) => {
    const cat = (item.category || 'Lainnya').trim();
    if (!categoryMap[cat]) {
      categoryMap[cat] = {
        category: cat,
        opening_stock: 0,
        total_in: 0,
        total_out: 0,
        closing_stock: 0,
        items: []
      };
    }
    categoryMap[cat].opening_stock += Number(item.opening_stock || 0);
    categoryMap[cat].total_in += Number(item.total_in || 0);
    categoryMap[cat].total_out += Number(item.total_out || 0);
    categoryMap[cat].closing_stock += Number(item.closing_stock || 0);
    categoryMap[cat].items.push(item);
  });

  const categories = Object.values(categoryMap).sort((a, b) => a.category.localeCompare(b.category));
  const colors = ['#2563eb', '#16a34a', '#7c3aed', '#0d9488', '#d97706', '#dc2626'];

  container.innerHTML = categories
    .map((c, idx) => {
      const borderColor = colors[idx % colors.length];
      const itemRows = c.items
        .map(
          (i) => `
          <div class="category-stock-item-row">
            <span>${i.name}</span>
            <strong>${i.closing_stock} ${i.unit}</strong>
          </div>
        `
        )
        .join('');

      return `
        <div class="category-stock-card" style="border-left-color: ${borderColor}">
          <div class="category-stock-header">
            <span class="category-stock-name">🏷️ ${c.category}</span>
          </div>
          <div class="category-stock-total" style="color: ${borderColor}">
            ${c.closing_stock.toLocaleString('id-ID')} <span style="font-size:13px;font-weight:600;color:#64748b">Stok Akhir</span>
          </div>
          <div class="text-muted text-sm" style="margin-bottom: 6px">
            Awal: <strong>${c.opening_stock}</strong> | Masuk: <strong class="text-success">+${c.total_in}</strong> | Keluar: <strong class="text-danger">-${c.total_out}</strong>
          </div>
          <div class="category-stock-items">
            ${itemRows}
          </div>
        </div>
      `;
    })
    .join('');
}

function renderCategoryStockGrid(containerId, items, clickableFilter = false) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (!items || items.length === 0) {
    container.innerHTML = `<p class="text-muted">Belum ada data barang untuk dikelompokkan per kategori.</p>`;
    return;
  }

  const categoryMap = {};
  items.forEach((item) => {
    const cat = (item.category || 'Lainnya').trim();
    if (!categoryMap[cat]) {
      categoryMap[cat] = {
        category: cat,
        total_stock: 0,
        items: []
      };
    }
    categoryMap[cat].total_stock += Number(item.current_stock || 0);
    categoryMap[cat].items.push(item);
  });

  const categories = Object.values(categoryMap).sort((a, b) => a.category.localeCompare(b.category));
  const colors = ['#2563eb', '#16a34a', '#7c3aed', '#0d9488', '#d97706', '#dc2626'];

  container.innerHTML = categories
    .map((c, idx) => {
      const borderColor = colors[idx % colors.length];
      const safeCat = c.category.replace(/'/g, "\\'");
      const clickAttr = clickableFilter ? `onclick="filterItemsByCategory('${safeCat}')"` : '';
      const itemRows = c.items
        .map(
          (i) => `
          <div class="category-stock-item-row">
            <span>${i.name}</span>
            <strong>${i.current_stock} ${i.unit}</strong>
          </div>
        `
        )
        .join('');

      return `
        <div class="category-stock-card ${clickableFilter ? 'clickable' : ''}" style="border-left-color: ${borderColor}" ${clickAttr}>
          <div class="category-stock-header">
            <span class="category-stock-name">🏷️ ${c.category}</span>
          </div>
          <div class="category-stock-total" style="color: ${borderColor}">
            ${c.total_stock.toLocaleString('id-ID')} <span style="font-size:13px;font-weight:600;color:#64748b">Total Stok</span>
          </div>
          <div class="category-stock-items">
            ${itemRows}
          </div>
        </div>
      `;
    })
    .join('');
}

window.filterItemsByCategory = function (categoryName) {
  const searchInput = document.getElementById('search-item');
  const catSelect = document.getElementById('items-category-filter');
  if (catSelect) catSelect.value = categoryName;
  if (searchInput) {
    searchInput.value = categoryName;
    renderItemsTable();
    showToast(`Menampilkan kategori: ${categoryName}`);
  }
};

function updateLowStockNotifications(items) {
  const lowItems = (items || []).filter((i) => Number(i.current_stock || 0) <= Number(i.min_stock || 0));
  const notifBell = document.getElementById('btn-low-stock-notif');
  const notifCount = document.getElementById('notif-low-count');
  const popoverBadge = document.getElementById('notif-popover-badge');
  const popoverList = document.getElementById('low-stock-popover-list');

  if (notifBell) {
    notifBell.classList.toggle('has-alerts', lowItems.length > 0);
  }
  if (notifCount) {
    notifCount.classList.toggle('hidden', lowItems.length === 0);
    notifCount.textContent = String(lowItems.length);
  }
  if (popoverBadge) {
    popoverBadge.textContent = `${lowItems.length} Barang`;
    popoverBadge.className = `badge ${lowItems.length > 0 ? 'badge-warning' : 'badge-success'}`;
  }
  if (popoverList) {
    if (lowItems.length === 0) {
      popoverList.innerHTML = `<div class="notif-empty">✅ Semua stok barang dalam kondisi aman di atas batas minimum.</div>`;
    } else {
      popoverList.innerHTML = lowItems
        .map((item) => {
          const isZero = Number(item.current_stock || 0) === 0;
          const safeSku = String(item.sku || '').replace(/'/g, "\\'");
          return `
            <button type="button" class="notif-item" onclick="openLowStockItem('${safeSku}')">
              <div>
                <div class="notif-item-title">${item.name}</div>
                <div class="notif-item-sub">${item.sku} • ${item.category}</div>
              </div>
              <div class="notif-item-stock">
                <span class="badge ${isZero ? 'badge-out' : 'badge-warning'}">
                  ${isZero ? 'Habis (0)' : `Sisa ${item.current_stock} ${item.unit}`}
                </span>
                <div class="notif-item-sub">Min: ${item.min_stock} ${item.unit}</div>
              </div>
            </button>
          `;
        })
        .join('');
    }
  }
}

window.openLowStockItem = function (sku) {
  const popover = document.getElementById('low-stock-popover');
  if (popover) popover.classList.add('hidden');
  const searchEl = document.getElementById('search-item');
  if (searchEl) searchEl.value = sku || '';
  switchView('items');
};

// ==================== RENDER VIEW 3: MASTER DATA BARANG ====================
async function refreshItemsView() {
  cachedItems = await dbService.getItems();
  updateLowStockNotifications(cachedItems);
  populateCategoryFilterSelect('items-category-filter', cachedItems);
  const catFilter = document.getElementById('items-category-filter')?.value || 'ALL';
  const itemsToShow =
    catFilter === 'ALL' ? cachedItems : cachedItems.filter((i) => (i.category || 'Lainnya').trim() === catFilter);
  renderCategoryStockGrid('items-category-stock-grid', itemsToShow, true);
  renderItemsTable();
}

function renderItemsTable() {
  const keyword = (document.getElementById('search-item').value || '').trim().toLowerCase();
  const catFilter = document.getElementById('items-category-filter')?.value || 'ALL';
  const allowEditStock = currentUser && canEditStock(currentUser.role);
  const filtered = cachedItems.filter((i) => {
    const itemCat = (i.category || 'Lainnya').trim();
    const matchCat = catFilter === 'ALL' || itemCat === catFilter;
    const matchKw =
      !keyword ||
      i.sku.toLowerCase().includes(keyword) ||
      i.name.toLowerCase().includes(keyword) ||
      itemCat.toLowerCase().includes(keyword);
    return matchCat && matchKw;
  });

  const tbody = document.getElementById('items-table-body');
  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${allowEditStock ? 9 : 7}" class="text-center text-muted">Tidak ada barang yang cocok dengan pencarian.</td></tr>`;
    renderTablePagination('items-pagination', 'items', { total: 0 }, renderItemsTable);
    updateBulkDeleteItemsUI();
    return;
  }

  const pageInfo = paginateRows(filtered, 'items');

  tbody.innerHTML = pageInfo.items
    .map((item) => {
      let statusBadge = `<span class="badge badge-in">Aman</span>`;
      if (item.current_stock === 0) {
        statusBadge = `<span class="badge badge-out">Habis (0)</span>`;
      } else if (item.current_stock <= item.min_stock) {
        statusBadge = `<span class="badge badge-warning">Menipis</span>`;
      }

      return `
        <tr>
          <td class="${allowEditStock ? '' : 'hidden'} text-center">
            <input type="checkbox" class="item-select-cb" value="${item.id}" onchange="updateBulkDeleteItemsUI()" />
          </td>
          <td><code>${escapeHtml(item.sku)}</code></td>
          <td><strong>${escapeHtml(item.name)}</strong></td>
          <td>${escapeHtml(item.category)}</td>
          <td>${escapeHtml(item.unit)}</td>
          <td class="text-right">${item.min_stock} ${escapeHtml(item.unit)}</td>
          <td class="text-right"><strong>${item.current_stock} ${escapeHtml(item.unit)}</strong></td>
          <td>${statusBadge}</td>
          <td class="${allowEditStock ? '' : 'hidden'}">
            <button class="btn-icon-edit" onclick="openItemModal(${item.id})">Edit</button>
            <button class="btn-icon-danger" onclick="handleDeleteItem(${item.id})">Hapus</button>
          </td>
        </tr>
      `;
    })
    .join('');
  renderTablePagination('items-pagination', 'items', pageInfo, renderItemsTable);
  updateBulkDeleteItemsUI();
}

window.updateBulkDeleteItemsUI = function () {
  const allCbs = Array.from(document.querySelectorAll('.item-select-cb'));
  const checkedCbs = allCbs.filter((cb) => cb.checked);
  const countEl = document.getElementById('selected-items-count');
  const btnEl = document.getElementById('btn-bulk-delete-items');
  const selectAllEl = document.getElementById('select-all-items');

  if (countEl) countEl.textContent = String(checkedCbs.length);
  if (btnEl) btnEl.disabled = checkedCbs.length === 0;
  if (selectAllEl) {
    selectAllEl.checked = allCbs.length > 0 && checkedCbs.length === allCbs.length;
    selectAllEl.indeterminate = checkedCbs.length > 0 && checkedCbs.length < allCbs.length;
  }
};

async function handleBulkDeleteItems() {
  const checkedIds = Array.from(document.querySelectorAll('.item-select-cb:checked')).map((cb) => Number(cb.value));
  if (checkedIds.length === 0) {
    showToast('Centang minimal 1 barang yang ingin dihapus.', 'error');
    return;
  }
  if (
    !confirm(
      `Yakin ingin menghapus ${checkedIds.length} barang yang ditandai beserta seluruh riwayat transaksinya?`
    )
  ) {
    return;
  }
  try {
    await dbService.bulkDeleteItems(checkedIds);
    showToast(`${checkedIds.length} barang berhasil dihapus bersamaan.`);
    await refreshItemsView();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

window.openItemModal = function (itemId = null) {
  const modal = document.getElementById('item-modal');
  const form = document.getElementById('item-form');
  form.reset();

  if (itemId) {
    const item = cachedItems.find((i) => i.id === Number(itemId));
    if (!item) return;
    document.getElementById('item-modal-title').textContent = `Edit Barang: ${item.sku}`;
    document.getElementById('item-id').value = item.id;
    document.getElementById('item-sku').value = item.sku;
    document.getElementById('item-category').value = item.category;
    document.getElementById('item-name').value = item.name;
    document.getElementById('item-unit').value = item.unit;
    document.getElementById('item-min-stock').value = item.min_stock;
    document.getElementById('initial-stock-group').classList.add('hidden');
  } else {
    document.getElementById('item-modal-title').textContent = 'Tambah Barang Baru';
    document.getElementById('item-id').value = '';
    document.getElementById('initial-stock-group').classList.remove('hidden');
  }

  modal.classList.remove('hidden');
};

function closeItemModal() {
  document.getElementById('item-modal').classList.add('hidden');
}

window.handleDeleteItem = async function (id) {
  if (!confirm('Hapus barang ini beserta seluruh riwayat transaksinya?')) return;
  try {
    await dbService.deleteItem(id);
    showToast('Barang berhasil dihapus.');
    await refreshItemsView();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

// ==================== RENDER VIEW 4: MANAJEMEN PENGGUNA & BACKUP MULTI-EMAIL (SUPERADMIN) ====================
async function refreshUsersView() {
  const users = await dbService.getUsers();
  const tbody = document.getElementById('users-table-body');

  tbody.innerHTML = users
    .map((u) => {
      const rb = formatRoleBadge(u.role);
      return `
    <tr>
      <td><strong>${u.username}</strong></td>
      <td>${u.full_name}</td>
      <td>
        <span class="badge ${rb.badgeClass}">
          ${rb.label}
        </span>
      </td>
      <td>
        <button class="btn-icon-edit" onclick="handleChangePassword(${u.id}, '${u.username}')">🔑 Ubah Password</button>
        ${
          u.id === currentUser.id
            ? '<span class="text-muted text-sm">Akun Aktif</span>'
            : `<button class="btn-icon-danger" onclick="handleDeleteUser(${u.id})">Hapus</button>`
        }
      </td>
    </tr>
  `;
    })
    .join('');

  renderBackupEmailsList();
}

function renderBackupEmailsList() {
  const settings = dbService.getBackupEmailSettings();
  const emails = settings.emails || [];

  const countEl = document.getElementById('backup-email-count');
  if (countEl) countEl.textContent = emails.length;

  const senderInput = document.getElementById('smtp-sender-email');
  const passInput = document.getElementById('smtp-app-password');
  if (senderInput) senderInput.value = settings.smtp_sender || '';
  if (passInput) passInput.value = settings.smtp_password || '';

  const lastSentEl = document.getElementById('last-backup-sent-info');
  if (lastSentEl && settings.last_sent_info) {
    lastSentEl.innerHTML = `✅ <strong>Riwayat Pengiriman Terakhir:</strong> ${settings.last_sent_info}`;
  }

  const checkAll = document.getElementById('check-all-backup-emails');
  if (checkAll) {
    checkAll.checked = emails.length > 0 && emails.every((e) => e.selected);
  }

  const tbody = document.getElementById('backup-emails-tbody');
  if (!tbody) return;

  if (emails.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="text-center text-muted">Belum ada email penerima backup. Tambahkan alamat email di form sebelah kiri.</td></tr>`;
    return;
  }

  tbody.innerHTML = emails
    .map(
      (e) => `
    <tr>
      <td>
        <input
          type="checkbox"
          ${e.selected ? 'checked' : ''}
          onchange="handleToggleBackupEmail(${e.id}, this.checked)"
        />
      </td>
      <td><strong>${e.label}</strong></td>
      <td><code>${e.email}</code></td>
      <td>
        <button class="btn-icon-danger" onclick="handleDeleteBackupEmail(${e.id})">Hapus</button>
      </td>
    </tr>
  `
    )
    .join('');
}

window.handleToggleBackupEmail = function (id, checked) {
  dbService.toggleBackupEmail(id, checked);
  renderBackupEmailsList();
};

window.handleDeleteBackupEmail = function (id) {
  if (!confirm('Hapus alamat email penerima backup ini?')) return;
  dbService.deleteBackupEmail(id);
  renderBackupEmailsList();
  showToast('Alamat email penerima dihapus.');
};

async function generateBackupEmailSummary(backupData, fileName) {
  const items = (backupData.inventory_db && backupData.inventory_db.items) || [];
  const gmdpSummary = await dbService.getFolderSummary('GMDP', getCurrentMonthStr());
  const genapSummary = await dbService.getFolderSummary('GENAP', getCurrentMonthStr());

  const catMap = {};
  let totalStockUnits = 0;
  items.forEach((i) => {
    const c = i.category || 'Lainnya';
    catMap[c] = (catMap[c] || 0) + Number(i.current_stock || 0);
    totalStockUnits += Number(i.current_stock || 0);
  });

  const catLines = Object.entries(catMap)
    .map(([cat, qty]) => `  - ${cat}: ${qty} Unit`)
    .join('\n');

  const lines = [
    'LAPORAN BACKUP DATABASE RESMI — SRI BARADA INDRA SAKTI',
    `Tanggal Backup : ${formatDateID(getTodayStr())}`,
    `Nama File Backup: ${fileName}`,
    '====================================================',
    '',
    `1. RINGKASAN STOK BARANG GUDANG (Total Fisik: ${totalStockUnits} Unit)`,
    catLines || '  - Belum ada stok barang',
    '',
    '2. RINGKASAN MONITORING PELANGGAN (2 FOLDER TERPISAH)',
    `  - Pelanggan GMDP : ${gmdpSummary.current_total_customers} Pelanggan Aktif`,
    `  - Pelanggan GENAP: ${genapSummary.current_total_customers} Pelanggan Aktif`,
    `  - Total Gabungan        : ${
      gmdpSummary.current_total_customers + genapSummary.current_total_customers
    } Pelanggan`,
    '',
    '====================================================',
    'CATATAN LAMPIRAN:',
    `File backup lengkap (${fileName}) telah diunduh otomatis ke komputer Anda.`,
    'Lampirkan file tersebut pada email ini untuk menyimpan salinan penuh database di kotak masuk email penerima.'
  ];

  return lines.join('\n');
}

function triggerBackupFileDownload(backupData, fileName) {
  const blob = new Blob([JSON.stringify(backupData, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

async function handleSendBackupEmail(mode) {
  const settings = dbService.getBackupEmailSettings();
  const selectedEmails = (settings.emails || []).filter((e) => e.selected).map((e) => e.email);

  if (selectedEmails.length === 0) {
    showToast('Pilih (centang) minimal 1 alamat email penerima terlebih dahulu!', 'error');
    return;
  }

  const fileName = `Backup_Sistem_Sri_Barada_${getTodayStr()}.json`;
  const backupData = dbService.exportFullBackup();
  const summaryText = await generateBackupEmailSummary(backupData, fileName);
  const subject = `[BACKUP DATABASE] Sri Barada Indra Sakti — ${formatDateID(getTodayStr())}`;
  const toList = selectedEmails.join(',');

  if (mode === 'SMTP') {
    if (!dbService.isServerMode) {
      showToast(
        'Mode Server belum aktif. Mengalihkan ke pengiriman Gmail Web + Download File Backup otomatis...',
        'error'
      );
      mode = 'GMAIL';
    } else {
      try {
        await dbService.sendBackupViaServerSmtp(selectedEmails, backupData, summaryText);
        const info = `Dikirim via Server SMTP ke ${selectedEmails.length} email (${toList}) pada ${formatDateID(
          getTodayStr()
        )}`;
        dbService.recordLastBackupSent(info);
        renderBackupEmailsList();
        showToast(`Backup berhasil dikirim otomatis ke ${selectedEmails.length} alamat email!`);
        return;
      } catch (err) {
        showToast(err.message, 'error');
        return;
      }
    }
  }

  // Unduh file .json backup secara otomatis agar siap dilampirkan
  triggerBackupFileDownload(backupData, fileName);

  const info = `Disiapkan & dikirim ke ${selectedEmails.length} email (${toList}) pada ${formatDateID(getTodayStr())}`;
  dbService.recordLastBackupSent(info);
  renderBackupEmailsList();

  if (mode === 'GMAIL') {
    const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(
      toList
    )}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(summaryText)}`;
    window.open(gmailUrl, '_blank');
    showToast(`Membuka Gmail untuk ${selectedEmails.length} email penerima & mengunduh file ${fileName}!`);
  } else {
    const mailtoUrl = `mailto:${toList}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(summaryText)}`;
    window.location.href = mailtoUrl;
    showToast(`Membuka aplikasi Email untuk ${selectedEmails.length} email penerima & mengunduh file ${fileName}!`);
  }
}

window.handleChangePassword = async function (id, username) {
  const newPass = prompt(`Masukkan password baru untuk pengguna "${username}" (minimal 4 karakter):`);
  if (newPass === null) return;
  try {
    await dbService.updateUserPassword(id, newPass);
    showToast(`Password untuk pengguna "${username}" berhasil diperbarui!`);
  } catch (err) {
    showToast(err.message, 'error');
  }
};

window.handleDeleteUser = async function (id) {
  if (!confirm('Hapus akun pengguna ini?')) return;
  try {
    await dbService.deleteUser(id);
    showToast('Akun pengguna berhasil dihapus.');
    await refreshUsersView();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

// ==================== RENDER FOLDER TERPISAH PELANGGAN (GMDP / GENAP) ====================
let currentCustomerSummary = null;
let activeCustomerFolder = 'GMDP';

async function refreshCustomersView() {
  const month = document.getElementById('cust-month').value || getCurrentMonthStr();
  const summary = await dbService.getFolderSummary(activeCustomerFolder, month);
  currentCustomerSummary = summary;

  const isGenap = activeCustomerFolder === 'GENAP';
  const folderBanner = document.getElementById('folder-identity-banner');
  folderBanner.classList.toggle('folder-genap', isGenap);

  document.getElementById('folder-icon-box').textContent = isGenap ? '' : '';
  const codeBadge = document.getElementById('folder-code-badge');
  codeBadge.textContent = `DATABASE PELANGGAN ${activeCustomerFolder}`;
  codeBadge.className = `badge ${isGenap ? 'badge-genap' : 'badge-gmdp'}`;
  document.getElementById('folder-path-label').textContent = summary.folder_path;
  document.getElementById('folder-title-heading').textContent = `Pelanggan Perusahaan ${activeCustomerFolder}`;
  document.getElementById(
    'folder-desc-text'
  ).textContent = `Seluruh data pelanggan ${activeCustomerFolder} tersimpan secara mandiri sehingga tidak tercampur dengan perusahaan lain.`;

  // Isi dropdown tahun yang tersedia
  const yearSelect = document.getElementById('cust-year-select');
  yearSelect.innerHTML = (summary.available_years || [summary.year])
    .map((y) => `<option value="${y}" ${y === summary.year ? 'selected' : ''}>${y}</option>`)
    .join('');

  const shortMonths = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
  const fullMonths = [
    'Januari',
    'Februari',
    'Maret',
    'April',
    'Mei',
    'Juni',
    'Juli',
    'Agustus',
    'September',
    'Oktober',
    'November',
    'Desember'
  ];

  const scopeLabel = activeCustomerFolder;
  document.getElementById('base-folder-label').textContent = summary.base_customers;
  document.getElementById('cust-chart-scope').textContent = scopeLabel;
  document.getElementById('cust-table-scope').textContent = scopeLabel;
  document.getElementById('cust-yearly-chart-scope').textContent = scopeLabel;
  document.getElementById('cust-yearly-table-scope').textContent = scopeLabel;
  document.getElementById('cust-chart-year').textContent = summary.year;
  document.getElementById('cust-table-year').textContent = summary.year;
  document.getElementById('cust-form-folder-label').textContent = activeCustomerFolder;
  document.getElementById('btn-submit-folder-name').textContent = activeCustomerFolder;
  document.getElementById('cust-logs-folder-label').textContent = activeCustomerFolder;

  document.getElementById(
    'print-cust-header-title'
  ).textContent = `LAPORAN PELANGGAN ${activeCustomerFolder} — SRI BARADA INDRA SAKTI`;
  document.getElementById(
    'print-cust-period-label'
  ).textContent = `Perusahaan: ${activeCustomerFolder} | Tahun: ${summary.year} | Bulan Fokus: ${formatMonthNameID(month)}`;

  const selectedMonthStats = summary.monthly_traffic.find((m) => m.month === month) || {
    opening_customers: summary.base_customers,
    customers_in: 0,
    customers_out: 0,
    net_growth: 0,
    closing_customers: summary.current_total_customers
  };

  const todayStr = getTodayStr();
  const todayIn = summary.month_logs
    .filter((l) => l.date === todayStr && l.type === 'IN')
    .reduce((s, l) => s + l.count, 0);
  const todayOut = summary.month_logs
    .filter((l) => l.date === todayStr && l.type === 'OUT')
    .reduce((s, l) => s + l.count, 0);

  // Render Kartu KPI Folder Aktif
  document.getElementById('cust-kpi-title-total').textContent = `Jumlah Seluruh Pelanggan ${activeCustomerFolder}`;
  document.getElementById('cust-total-active').textContent = `${selectedMonthStats.closing_customers.toLocaleString(
    'id-ID'
  )} Pelanggan`;
  document.getElementById(
    'cust-total-active-meta'
  ).textContent = `Awal bulan: ${selectedMonthStats.opening_customers} plg | Total akhir folder: ${summary.current_total_customers} plg`;

  document.getElementById('cust-month-in').textContent = `+${selectedMonthStats.customers_in}`;
  document.getElementById('cust-today-in-meta').textContent = `Hari ini (${formatDateID(
    todayStr
  )}): +${todayIn} masuk (${activeCustomerFolder})`;

  document.getElementById('cust-month-out').textContent = `-${selectedMonthStats.customers_out}`;
  document.getElementById('cust-today-out-meta').textContent = `Hari ini (${formatDateID(
    todayStr
  )}): -${todayOut} keluar (${activeCustomerFolder})`;

  const net = selectedMonthStats.net_growth;
  const netEl = document.getElementById('cust-month-net');
  const netMeta = document.getElementById('cust-month-trend-meta');
  const pct =
    selectedMonthStats.opening_customers > 0
      ? ((net / selectedMonthStats.opening_customers) * 100).toFixed(1)
      : '0.0';

  if (net > 0) {
    netEl.textContent = `📈 +${net}`;
    netEl.className = 'stat-value text-success';
    netMeta.textContent = `Trafik ${activeCustomerFolder} NAIK +${pct}% (${formatMonthNameID(month)})`;
  } else if (net < 0) {
    netEl.textContent = `📉 ${net}`;
    netEl.className = 'stat-value text-danger';
    netMeta.textContent = `Trafik ${activeCustomerFolder} TURUN ${pct}% (${formatMonthNameID(month)})`;
  } else {
    netEl.textContent = `➖ 0`;
    netEl.className = 'stat-value';
    netMeta.textContent = `Trafik ${activeCustomerFolder} STABIL (0%) (${formatMonthNameID(month)})`;
  }

  // Tampilkan tombol Pulihkan Bulan Terhapus jika ada bulan yang dihapus di tahun ini
  const btnRestoreMonths = document.getElementById('btn-restore-deleted-months');
  if (btnRestoreMonths) {
    const delCount = Number(summary.deleted_months_count || 0);
    btnRestoreMonths.classList.toggle('hidden', delCount === 0);
    if (delCount > 0) {
      btnRestoreMonths.textContent = `🔄 Pulihkan Bulan Terhapus (${delCount})`;
    }
  }

  // Render Grafik Visual Bulanan
  const maxBar = Math.max(
    ...summary.monthly_traffic.map((m) => Math.max(m.customers_in, m.customers_out)),
    5
  );

  const chartEl = document.getElementById('customer-traffic-chart');
  if (summary.monthly_traffic.length === 0) {
    chartEl.innerHTML = `<p class="text-muted">Seluruh bulan pada tahun ${summary.year} telah dihapus. Klik "Pulihkan Bulan Terhapus" atau "Input / Edit Bulan Manual" untuk menambahkan bulan.</p>`;
  } else {
    chartEl.innerHTML = summary.monthly_traffic
      .map((m) => {
        const mIdx = Math.max(0, Math.min(11, Number(m.month.slice(5, 7)) - 1));
        const inHeight = Math.max(Math.round((m.customers_in / maxBar) * 85), 4);
        const outHeight = Math.max(Math.round((m.customers_out / maxBar) * 85), 4);
        const isActive = m.month === month;
        const netVal = m.net_growth;
        const netColor = netVal > 0 ? 'text-success' : netVal < 0 ? 'text-danger' : 'text-muted';
        const netIcon = netVal > 0 ? '▲' : netVal < 0 ? '▼' : '•';

        return `
          <div class="traffic-month-card ${isActive ? 'active-month' : ''}" onclick="selectCustomerMonth('${
          m.month
        }')" style="cursor:pointer" title="Klik untuk fokus ke ${fullMonths[mIdx]} ${summary.year}">
            <div class="traffic-total-pill">${m.closing_customers} Plg</div>
            <div class="traffic-bars-wrap">
              <div class="t-bar-group">
                <span class="t-bar-val text-success">+${m.customers_in}</span>
                <div class="t-bar in" style="height: ${inHeight}px"></div>
              </div>
              <div class="t-bar-group">
                <span class="t-bar-val text-danger">-${m.customers_out}</span>
                <div class="t-bar out" style="height: ${outHeight}px"></div>
              </div>
            </div>
            <div class="traffic-net-label ${netColor}">${netIcon} ${netVal > 0 ? '+' + netVal : netVal}</div>
            <div class="traffic-month-name">${shortMonths[mIdx]} ${m.is_manual ? '✏️' : ''}</div>
          </div>
        `;
      })
      .join('');
  }

  // Render Grafik Trafik Penambahan Harian Pelanggan (Bulan Terpilih)
  const dailyScopeEl = document.getElementById('cust-daily-chart-scope');
  const dailyMonthEl = document.getElementById('cust-daily-chart-month');
  const dailyBadgeEl = document.getElementById('cust-daily-traffic-badge');
  const dailyChartEl = document.getElementById('customer-daily-traffic-chart');
  if (dailyScopeEl) dailyScopeEl.textContent = scopeLabel;
  if (dailyMonthEl) dailyMonthEl.textContent = formatMonthNameID(month);

  let dailyTraffic = Array.isArray(summary.daily_traffic) ? summary.daily_traffic : [];
  if (dailyTraffic.length === 0 && Array.isArray(summary.month_logs) && summary.month_logs.length > 0) {
    const dMap = {};
    summary.month_logs.forEach((l) => {
      if (!dMap[l.date]) {
        dMap[l.date] = { date: l.date, customers_in: 0, customers_out: 0, net_growth: 0, tx_count: 0 };
      }
      if (l.type === 'IN') dMap[l.date].customers_in += Number(l.count || 0);
      else dMap[l.date].customers_out += Number(l.count || 0);
      dMap[l.date].net_growth = dMap[l.date].customers_in - dMap[l.date].customers_out;
      dMap[l.date].tx_count += 1;
    });
    dailyTraffic = Object.values(dMap).sort((a, b) => a.date.localeCompare(b.date));
  }

  if (dailyBadgeEl) {
    const totalDailyIn = dailyTraffic.reduce((s, d) => s + Number(d.customers_in || 0), 0);
    const totalDailyOut = dailyTraffic.reduce((s, d) => s + Number(d.customers_out || 0), 0);
    dailyBadgeEl.textContent = `${dailyTraffic.length} Hari Aktif (+${totalDailyIn} / -${totalDailyOut})`;
  }

  if (dailyChartEl) {
    const activeFilterDate = document.getElementById('cust-filter-date')?.value || '';
    if (dailyTraffic.length === 0) {
      dailyChartEl.innerHTML = `<p class="text-muted">Belum ada update harian pelanggan pada bulan ${formatMonthNameID(
        month
      )}. Tambahkan melalui form "Update Harian Pelanggan" di bawah.</p>`;
    } else {
      const maxDailyBar = Math.max(
        ...dailyTraffic.map((d) => Math.max(d.customers_in, d.customers_out)),
        5
      );
      dailyChartEl.innerHTML = dailyTraffic
        .map((d) => {
          const inH = Math.max(Math.round((d.customers_in / maxDailyBar) * 85), 4);
          const outH = Math.max(Math.round((d.customers_out / maxDailyBar) * 85), 4);
          const netD = d.net_growth;
          const netColor = netD > 0 ? 'text-success' : netD < 0 ? 'text-danger' : 'text-muted';
          const netIcon = netD > 0 ? '▲' : netD < 0 ? '▼' : '•';
          const isActiveDay = activeFilterDate === d.date;
          const [, mNum, dayNum] = d.date.split('-');
          const dayLabel = `${dayNum} ${shortMonths[Math.max(0, Math.min(11, Number(mNum) - 1))]}`;

          return `
            <div class="traffic-month-card ${isActiveDay ? 'active-month' : ''}" onclick="selectCustomerDailyDate('${
            d.date
          }')" style="cursor:pointer" title="Klik untuk melihat riwayat tanggal ${formatDateID(d.date)}">
              <div class="traffic-total-pill">${d.tx_count}x Update</div>
              <div class="traffic-bars-wrap">
                <div class="t-bar-group">
                  <span class="t-bar-val text-success">+${d.customers_in}</span>
                  <div class="t-bar in" style="height: ${inH}px"></div>
                </div>
                <div class="t-bar-group">
                  <span class="t-bar-val text-danger">-${d.customers_out}</span>
                  <div class="t-bar out" style="height: ${outH}px"></div>
                </div>
              </div>
              <div class="traffic-net-label ${netColor}">${netIcon} ${netD > 0 ? '+' + netD : netD}</div>
              <div class="traffic-month-name">${dayLabel}</div>
            </div>
          `;
        })
        .join('');
    }
  }

  // Render Tabel Resume Trafik Bulanan (dengan tombol Edit & Hapus Manual di tiap baris)
  const monthlyTbody = document.getElementById('cust-monthly-tbody');
  let yearTotalIn = 0;
  let yearTotalOut = 0;

  if (summary.monthly_traffic.length === 0) {
    monthlyTbody.innerHTML = `<tr><td colspan="9" class="text-center text-muted">Tidak ada bulan aktif pada tahun ${summary.year}.</td></tr>`;
  } else {
    monthlyTbody.innerHTML = summary.monthly_traffic
      .map((m) => {
        const mIdx = Math.max(0, Math.min(11, Number(m.month.slice(5, 7)) - 1));
        yearTotalIn += m.customers_in;
        yearTotalOut += m.customers_out;

        const g = m.net_growth;
        const gPct = m.opening_customers > 0 ? ((g / m.opening_customers) * 100).toFixed(1) : '0.0';
        let trendBadge = `<span class="badge badge-info">➖ STABIL (0%)</span>`;
        if (g > 0) {
          trendBadge = `<span class="badge badge-in">📈 NAIK +${g} (+${gPct}%)</span>`;
        } else if (g < 0) {
          trendBadge = `<span class="badge badge-out">📉 TURUN ${g} (${gPct}%)</span>`;
        }

        const modeBadge = m.is_manual
          ? `<span class="badge badge-warning" title="${m.notes || 'Diinput secara manual'}">✏️ Manual</span>`
          : `<span class="badge badge-info">🔄 Otomatis Harian</span>`;

        return `
          <tr class="${m.month === month ? 'active-row' : ''}">
            <td>
              <strong>${fullMonths[mIdx]} ${summary.year}</strong>
              ${m.notes ? `<div class="text-muted text-sm">${m.notes}</div>` : ''}
            </td>
            <td>${modeBadge}</td>
            <td class="text-right">${m.opening_customers.toLocaleString('id-ID')}</td>
            <td class="text-right text-success"><strong>+${m.customers_in}</strong></td>
            <td class="text-right text-danger"><strong>-${m.customers_out}</strong></td>
            <td class="text-right ${g > 0 ? 'text-success' : g < 0 ? 'text-danger' : ''}">
              <strong>${g > 0 ? '+' + g : g}</strong>
            </td>
            <td class="text-center">${trendBadge}</td>
            <td class="text-right"><strong>${m.closing_customers.toLocaleString('id-ID')} Pelanggan</strong></td>
            <td class="no-print">
              <button class="btn-icon-edit" onclick="openManualMonthModal('${m.month}')">✏️ Edit</button>
              <button class="btn-icon-danger" onclick="handleDeleteMonth('${m.month}')" title="Hapus bulan ini secara manual">🗑️ Hapus</button>
            </td>
          </tr>
        `;
      })
      .join('');
  }

  const firstM = summary.monthly_traffic[0];
  const lastM = summary.monthly_traffic[summary.monthly_traffic.length - 1];
  const yearOpening = firstM ? firstM.opening_customers : summary.base_customers;
  const yearClosing = lastM ? lastM.closing_customers : summary.current_total_customers;
  const yearNet = yearTotalIn - yearTotalOut;

  document.getElementById('cust-monthly-tfoot').innerHTML = `
    <tr>
      <td colspan="2">TOTAL / RESUME TAHUN ${summary.year} (${scopeLabel})</td>
      <td class="text-right">${yearOpening.toLocaleString('id-ID')}</td>
      <td class="text-right text-success">+${yearTotalIn}</td>
      <td class="text-right text-danger">-${yearTotalOut}</td>
      <td class="text-right">${yearNet >= 0 ? '+' + yearNet : yearNet}</td>
      <td class="text-center">
        <strong>${yearNet > 0 ? '📈 TOTAL NAIK' : yearNet < 0 ? '📉 TOTAL TURUN' : '➖ TETAP'}</strong>
      </td>
      <td class="text-right">${yearClosing.toLocaleString('id-ID')} Pelanggan</td>
      <td class="no-print"></td>
    </tr>
  `;

  // ==================== RENDER GRAFIK & TABEL RESUME SETIAP TAHUNNYA (YEARLY TRAFFIC) ====================
  const yearlyList = summary.yearly_traffic || [];
  const maxYearBar = Math.max(
    ...yearlyList.map((y) => Math.max(y.customers_in, y.customers_out)),
    10
  );

  const yearlyChartEl = document.getElementById('customer-yearly-chart');
  yearlyChartEl.innerHTML = yearlyList
    .map((y) => {
      const inH = Math.max(Math.round((y.customers_in / maxYearBar) * 85), 4);
      const outH = Math.max(Math.round((y.customers_out / maxYearBar) * 85), 4);
      const isActY = y.year === summary.year;
      const g = y.net_growth;
      const gPct = y.opening_customers > 0 ? ((g / y.opening_customers) * 100).toFixed(1) : '0.0';
      const netColor = g > 0 ? 'text-success' : g < 0 ? 'text-danger' : 'text-muted';
      const netIcon = g > 0 ? '📈 NAIK' : g < 0 ? '📉 TURUN' : '➖ STABIL';

      return `
        <div class="yearly-traffic-card ${isActY ? 'active-year' : ''}" onclick="selectCustomerYear('${
        y.year
      }')" title="Klik untuk melihat detail trafik bulanan Tahun ${y.year}">
          <div class="yearly-title">Tahun ${y.year} ${y.is_manual ? '✏️' : ''}</div>
          <div class="traffic-total-pill">${y.closing_customers} Pelanggan Akhir</div>
          <div class="traffic-bars-wrap">
            <div class="t-bar-group">
              <span class="t-bar-val text-success">+${y.customers_in}</span>
              <div class="t-bar yearly-bar in" style="height: ${inH}px"></div>
            </div>
            <div class="t-bar-group">
              <span class="t-bar-val text-danger">-${y.customers_out}</span>
              <div class="t-bar yearly-bar out" style="height: ${outH}px"></div>
            </div>
          </div>
          <div class="traffic-net-label ${netColor}">
            ${netIcon} ${g > 0 ? '+' + g : g} (${g > 0 ? '+' + gPct : gPct}%)
          </div>
          <div class="yearly-sub-pill">Awal Tahun: ${y.opening_customers} Plg</div>
        </div>
      `;
    })
    .join('');

  // Render Tabel Resume Setiap Tahunnya
  const yearlyTbody = document.getElementById('cust-yearly-tbody');
  let allTimeIn = 0;
  let allTimeOut = 0;

  yearlyTbody.innerHTML = yearlyList
    .map((y) => {
      allTimeIn += y.customers_in;
      allTimeOut += y.customers_out;

      const g = y.net_growth;
      const gPct = y.opening_customers > 0 ? ((g / y.opening_customers) * 100).toFixed(1) : '0.0';
      let trendBadge = `<span class="badge badge-info">➖ STABIL (0%)</span>`;
      if (g > 0) {
        trendBadge = `<span class="badge badge-in">📈 NAIK +${g} (+${gPct}%)</span>`;
      } else if (g < 0) {
        trendBadge = `<span class="badge badge-out">📉 TURUN ${g} (${gPct}%)</span>`;
      }

      const modeBadge = y.is_manual
        ? `<span class="badge badge-warning">✏️ Manual Tahunan</span>`
        : `<span class="badge badge-info">🔄 Akumulasi Bulan</span>`;

      return `
        <tr>
          <td style="cursor:pointer" onclick="selectCustomerYear('${y.year}')">
            <strong>Tahun ${y.year}</strong>
            ${y.notes ? `<div class="text-muted text-sm">${y.notes}</div>` : ''}
          </td>
          <td>${modeBadge}</td>
          <td class="text-right">${y.opening_customers.toLocaleString('id-ID')}</td>
          <td class="text-right text-success"><strong>+${y.customers_in}</strong></td>
          <td class="text-right text-danger"><strong>-${y.customers_out}</strong></td>
          <td class="text-right ${g > 0 ? 'text-success' : g < 0 ? 'text-danger' : ''}">
            <strong>${g > 0 ? '+' + g : g}</strong>
          </td>
          <td class="text-center">${trendBadge}</td>
          <td class="text-right"><strong>${y.closing_customers.toLocaleString('id-ID')} Pelanggan</strong></td>
          <td class="no-print">
            <button class="btn-icon-edit" onclick="openManualYearModal('${y.year}')">✏️ Edit</button>
            <button class="btn-icon-danger" onclick="handleDeleteYear('${y.year}')">Hapus</button>
          </td>
        </tr>
      `;
    })
    .join('');

  const firstY = yearlyList[0];
  const lastY = yearlyList[yearlyList.length - 1];
  const openAllTime = firstY ? firstY.opening_customers : summary.base_customers;
  const closeAllTime = lastY ? lastY.closing_customers : summary.current_total_customers;
  const allTimeNet = allTimeIn - allTimeOut;

  document.getElementById('cust-yearly-tfoot').innerHTML = `
    <tr>
      <td colspan="2">AKUMULASI SELURUH TAHUN (${scopeLabel})</td>
      <td class="text-right">${openAllTime.toLocaleString('id-ID')}</td>
      <td class="text-right text-success">+${allTimeIn}</td>
      <td class="text-right text-danger">-${allTimeOut}</td>
      <td class="text-right">${allTimeNet >= 0 ? '+' + allTimeNet : allTimeNet}</td>
      <td class="text-center">
        <strong>${allTimeNet > 0 ? '📈 PERTUMBUHAN NAIK' : allTimeNet < 0 ? '📉 PERTUMBUHAN TURUN' : '➖ STABIL'}</strong>
      </td>
      <td class="text-right">${closeAllTime.toLocaleString('id-ID')} Pelanggan</td>
      <td class="no-print"></td>
    </tr>
  `;

  // Render Tabel Riwayat Harian Bulan Terpilih
  const filterDate = document.getElementById('cust-filter-date').value;
  const filterType = document.getElementById('cust-filter-type').value;
  let logs = [...summary.month_logs];
  if (filterDate) logs = logs.filter((l) => l.date === filterDate);
  if (filterType !== 'ALL') logs = logs.filter((l) => l.type === filterType);

  const logsTbody = document.getElementById('cust-logs-tbody');
  if (logs.length === 0) {
    logsTbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">Belum ada catatan harian pelanggan di ${activeCustomerFolder} pada bulan ini.</td></tr>`;
  } else {
    logsTbody.innerHTML = logs
      .map(
        (l) => `
      <tr>
        <td><strong>${formatDateID(l.date)}</strong></td>
        <td>
          <span class="badge ${l.type === 'IN' ? 'badge-in' : 'badge-out'}">
            ${l.type === 'IN' ? '🟢 MASUK' : '🔴 KELUAR'}
          </span>
        </td>
        <td>
          <strong class="${l.type === 'IN' ? 'text-success' : 'text-danger'}">
            ${l.type === 'IN' ? '+' : '-'}${l.count} Pelanggan
          </strong>
        </td>
        <td>${l.category}</td>
        <td>
          <div>${l.customer_info || '-'}</div>
          <div class="text-muted text-sm">Oleh: ${l.user_name || 'Petugas'}</div>
        </td>
        <td>
          <button class="btn-icon-danger" onclick="handleDeleteCustLog(${l.id})">Hapus</button>
        </td>
      </tr>
    `
      )
      .join('');
  }
}

// ==================== MODAL HANDLERS: EDIT BULAN & TAHUN MANUAL ====================
window.openManualMonthModal = function (monthStr = null) {
  const modal = document.getElementById('manual-month-modal');
  const form = document.getElementById('manual-month-form');
  form.reset();

  document.getElementById('modal-month-folder-name').textContent = activeCustomerFolder;
  const targetM = monthStr || document.getElementById('cust-month').value || getCurrentMonthStr();
  const [y, m] = targetM.split('-');

  document.getElementById('mm-year').value = y;
  document.getElementById('mm-month').value = m;

  if (currentCustomerSummary && currentCustomerSummary.monthly_traffic) {
    const existing = currentCustomerSummary.monthly_traffic.find((row) => row.month === targetM);
    if (existing) {
      document.getElementById('mm-opening').value =
        existing.manual_opening !== null && existing.manual_opening !== undefined ? existing.manual_opening : '';
      document.getElementById('mm-in').value = existing.customers_in;
      document.getElementById('mm-out').value = existing.customers_out;
      document.getElementById('mm-notes').value = existing.notes || '';
    }
  }

  modal.classList.remove('hidden');
};

function closeManualMonthModal() {
  document.getElementById('manual-month-modal').classList.add('hidden');
}

window.handleResetManualMonth = async function (monthStr) {
  if (!confirm(`Kembalikan data bulan ${formatMonthNameID(monthStr)} ke perhitungan otomatis harian?`)) return;
  try {
    await dbService.deleteManualMonth(activeCustomerFolder, monthStr);
    showToast(`Data manual bulan ${formatMonthNameID(monthStr)} telah direset.`);
    await refreshCustomersView();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

window.handleDeleteMonth = async function (monthStr) {
  if (
    !confirm(
      `Hapus bulan ${formatMonthNameID(monthStr)} beserta datanya dari daftar ${activeCustomerFolder}?`
    )
  )
    return;
  try {
    await dbService.deleteMonthCompletely(activeCustomerFolder, monthStr);
    showToast(`Bulan ${formatMonthNameID(monthStr)} berhasil dihapus dari ${activeCustomerFolder}.`);
    await refreshCustomersView();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

window.handleRestoreDeletedMonths = async function () {
  const curYear = currentCustomerSummary ? currentCustomerSummary.year : String(new Date().getFullYear());
  try {
    await dbService.restoreDeletedMonths(activeCustomerFolder, curYear);
    showToast(`Seluruh bulan pada Tahun ${curYear} telah ditampilkan kembali.`);
    await refreshCustomersView();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

window.openManualYearModal = function (yearStr = null) {
  const modal = document.getElementById('manual-year-modal');
  const form = document.getElementById('manual-year-form');
  form.reset();

  document.getElementById('modal-year-folder-name').textContent = activeCustomerFolder;
  const targetY = yearStr || (currentCustomerSummary ? currentCustomerSummary.year : String(new Date().getFullYear()));
  document.getElementById('my-year').value = targetY;

  if (currentCustomerSummary && currentCustomerSummary.yearly_traffic) {
    const existing = currentCustomerSummary.yearly_traffic.find((row) => row.year === String(targetY));
    if (existing) {
      document.getElementById('my-opening').value =
        existing.manual_opening !== null && existing.manual_opening !== undefined ? existing.manual_opening : '';
      document.getElementById('my-in').value =
        existing.manual_in !== null && existing.manual_in !== undefined ? existing.manual_in : '';
      document.getElementById('my-out').value =
        existing.manual_out !== null && existing.manual_out !== undefined ? existing.manual_out : '';
      document.getElementById('my-notes').value = existing.notes || '';
    }
  }

  modal.classList.remove('hidden');
};

function closeManualYearModal() {
  document.getElementById('manual-year-modal').classList.add('hidden');
}

window.handleDeleteYear = async function (yearStr) {
  if (!confirm(`Hapus pengaturan tahun manual ${yearStr} dari ${activeCustomerFolder}?`)) return;
  try {
    await dbService.deleteManualYear(activeCustomerFolder, yearStr);
    showToast(`Data manual Tahun ${yearStr} dihapus.`);
    await refreshCustomersView();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

window.selectCustomerYear = function (yearStr) {
  const curMonthInput = document.getElementById('cust-month').value || getCurrentMonthStr();
  const mm = curMonthInput.slice(5, 7) || '01';
  document.getElementById('cust-month').value = `${yearStr}-${mm}`;
  refreshCustomersView();
  showToast(`Menampilkan trafik bulanan ${activeCustomerFolder} Tahun ${yearStr}`);
};

window.selectCustomerMonth = function (monthStr) {
  document.getElementById('cust-month').value = monthStr;
  refreshCustomersView();
};

window.selectCustomerDailyDate = function (dateStr) {
  const filterEl = document.getElementById('cust-filter-date');
  if (!filterEl) return;
  filterEl.value = filterEl.value === dateStr ? '' : dateStr;
  refreshCustomersView();
};

window.handleDeleteCustLog = async function (id) {
  if (!confirm('Hapus data update pelanggan harian ini?')) return;
  try {
    await dbService.deleteFolderLog(activeCustomerFolder, id);
    showToast('Data riwayat pelanggan berhasil dihapus.');
    await refreshCustomersView();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

function exportCustomersToCSV() {
  if (!currentCustomerSummary) return;
  const s = currentCustomerSummary;
  const headers = [
    'Perusahaan',
    'Periode Bulan',
    'Mode Data',
    'Pelanggan Awal Bulan',
    'Pelanggan Masuk (+)',
    'Pelanggan Keluar (-)',
    'Pertumbuhan Bersih',
    'Status Trafik',
    'Total Seluruh Pelanggan Akhir Bulan',
    'Catatan'
  ];

  const rows = s.monthly_traffic.map((m) => [
    s.company,
    m.month,
    m.is_manual ? 'MANUAL' : 'OTOMATIS HARIAN',
    m.opening_customers,
    m.customers_in,
    m.customers_out,
    m.net_growth,
    m.net_growth > 0 ? 'NAIK' : m.net_growth < 0 ? 'TURUN' : 'STABIL',
    m.closing_customers,
    `"${(m.notes || '').replace(/"/g, '""')}"`
  ]);

  const csvContent =
    'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `Resume_Bulanan_Folder_${s.company}_${s.year}.csv`);
  document.body.appendChild(link);
  link.click();
  link.remove();
  dbService.recordExportLog(`Pelanggan ${s.company}`, `Export CSV Bulanan Tahun ${s.year}`);
  showToast(`File Resume_Bulanan_Folder_${s.company}_${s.year}.csv berhasil diunduh!`);
}

function exportYearlyCustomersToCSV() {
  if (!currentCustomerSummary || !currentCustomerSummary.yearly_traffic) return;
  const s = currentCustomerSummary;
  const headers = [
    'Perusahaan',
    'Tahun',
    'Mode Data',
    'Pelanggan Awal Tahun',
    'Masuk Setahun (+)',
    'Keluar Setahun (-)',
    'Pertumbuhan Bersih Tahunan',
    'Status Trafik Tahunan',
    'Total Seluruh Pelanggan Akhir Tahun',
    'Catatan'
  ];

  const rows = s.yearly_traffic.map((y) => [
    s.company,
    y.year,
    y.is_manual ? 'MANUAL TAHUNAN' : 'AKUMULASI BULANAN',
    y.opening_customers,
    y.customers_in,
    y.customers_out,
    y.net_growth,
    y.net_growth > 0 ? 'NAIK' : y.net_growth < 0 ? 'TURUN' : 'STABIL',
    y.closing_customers,
    `"${(y.notes || '').replace(/"/g, '""')}"`
  ]);

  const csvContent =
    'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');
  const encodedUri = encodeURI(csvContent);
  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', `Resume_Tahunan_Folder_${s.company}.csv`);
  document.body.appendChild(link);
  link.click();
  link.remove();
  dbService.recordExportLog(`Pelanggan ${s.company}`, `Export CSV Tahunan ${s.company}`);
  showToast(`File Resume_Tahunan_Folder_${s.company}.csv berhasil diunduh!`);
}

// ==================== RENDER VIEW 5: LOG AKTIVITAS (SUPERADMIN & SPESIAL) ====================
let cachedActivityLogs = [];

async function refreshLogsView() {
  const role = normalizeRole(currentUser ? currentUser.role : 'teknisi');
  if (!canAccessLogs(role)) return;

  const action_type = document.getElementById('log-filter-action')?.value || 'ALL';
  const date = document.getElementById('log-filter-date')?.value || '';

  try {
    cachedActivityLogs = await dbService.getActivityLogs({ action_type, date });
    renderLogsTable();
  } catch (err) {
    showToast(err.message, 'error');
  }
}

function getFilteredActivityLogs() {
  const keyword = (document.getElementById('log-search')?.value || '').trim().toLowerCase();
  return (cachedActivityLogs || []).filter((l) => {
    if (!keyword) return true;
    return (
      (l.username || '').toLowerCase().includes(keyword) ||
      (l.full_name || '').toLowerCase().includes(keyword) ||
      (l.role || '').toLowerCase().includes(keyword) ||
      (l.target || '').toLowerCase().includes(keyword) ||
      (l.detail || '').toLowerCase().includes(keyword)
    );
  });
}

function formatLogDateTimeID(isoStr) {
  if (!isoStr) return '-';
  const d = new Date(isoStr);
  if (Number.isNaN(d.getTime())) return isoStr;
  return d.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  });
}

function renderLogsTable() {
  const filtered = getFilteredActivityLogs();
  const tbody = document.getElementById('logs-table-body');
  if (!tbody) return;

  const loginCount = filtered.filter((l) => l.action_type === 'LOGIN').length;
  const editCount = filtered.filter((l) => l.action_type === 'EDIT').length;
  const exportCount = filtered.filter((l) => l.action_type === 'EXPORT').length;

  const elTotal = document.getElementById('log-stat-total');
  const elLogin = document.getElementById('log-stat-login');
  const elEdit = document.getElementById('log-stat-edit');
  const elExport = document.getElementById('log-stat-export');
  if (elTotal) elTotal.textContent = filtered.length.toLocaleString('id-ID');
  if (elLogin) elLogin.textContent = loginCount.toLocaleString('id-ID');
  if (elEdit) elEdit.textContent = editCount.toLocaleString('id-ID');
  if (elExport) elExport.textContent = exportCount.toLocaleString('id-ID');

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">Belum ada log aktivitas yang cocok dengan filter.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered
    .map((l) => {
      const roleInfo = formatRoleBadge(l.role);
      let actBadge = `<span class="badge badge-info">${escapeHtml(l.action_type)}</span>`;
      if (l.action_type === 'LOGIN') actBadge = `<span class="badge badge-in">🔑 LOGIN</span>`;
      else if (l.action_type === 'EDIT') actBadge = `<span class="badge badge-dismantle">✏️ EDIT</span>`;
      else if (l.action_type === 'EXPORT') actBadge = `<span class="badge badge-warning">📥 EXPORT</span>`;

      return `
        <tr>
          <td><strong>${formatLogDateTimeID(l.created_at)}</strong></td>
          <td>
            <div><strong>${escapeHtml(l.full_name || '-')}</strong></div>
            <div class="text-muted text-sm">@${escapeHtml(l.username || '-')}</div>
          </td>
          <td><span class="badge ${roleInfo.badgeClass}">${escapeHtml(String(l.role || '').toUpperCase())}</span></td>
          <td>${actBadge}</td>
          <td><strong>${escapeHtml(l.target || '-')}</strong></td>
          <td>${escapeHtml(l.detail || '-')}</td>
        </tr>
      `;
    })
    .join('');
}

function exportLogsToCSV() {
  const rowsData = getFilteredActivityLogs();
  if (!rowsData || rowsData.length === 0) {
    showToast('Tidak ada data log aktivitas untuk diekspor.', 'error');
    return;
  }

  const headers = ['Waktu', 'Username', 'Nama Lengkap', 'Role', 'Aktivitas', 'Modul / Target', 'Keterangan'];
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csvRows = rowsData.map((l) =>
    [
      esc(formatLogDateTimeID(l.created_at)),
      esc(l.username),
      esc(l.full_name),
      esc(String(l.role || '').toUpperCase()),
      esc(l.action_type),
      esc(l.target),
      esc(l.detail)
    ].join(',')
  );

  const csvString = '\uFEFF' + [headers.join(','), ...csvRows].join('\n');
  const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const fileName = `Log_Aktivitas_Sri_Barada_${getTodayStr()}.csv`;

  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', fileName);
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  dbService.recordExportLog('Log Aktivitas', `Export CSV Log Aktivitas (${rowsData.length} baris)`);
  showToast(`File ${fileName} berhasil diunduh!`);
}

// ==================== INTERACTIVE LIQUID WATER CURSOR EFFECT ====================
function initLiquidWaterCursor() {
  const canvas = document.getElementById('liquid-cursor-canvas');
  if (!canvas) return;

  const isFinePointer = window.matchMedia && window.matchMedia('(pointer: fine)').matches;
  const prefersReduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!isFinePointer || prefersReduced) {
    canvas.style.display = 'none';
    return;
  }

  const ctx = canvas.getContext('2d', { alpha: true });
  if (!ctx) return;

  let width = window.innerWidth;
  let height = window.innerHeight;
  let dpr = Math.min(window.devicePixelRatio || 1, 2);

  function resizeCanvas() {
    width = window.innerWidth;
    height = window.innerHeight;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  resizeCanvas();

  const MAX_RIPPLES = 24;
  const ripples = [];

  let targetX = -200;
  let targetY = -200;
  let smoothX = -200;
  let smoothY = -200;
  let lastSpawnX = -200;
  let lastSpawnY = -200;
  let velX = 0;
  let velY = 0;
  let cursorVisible = false;
  let auraOpacity = 0;
  let rafId = null;

  function isLoginScreenVisible() {
    const loginScreen = document.getElementById('login-screen');
    return Boolean(loginScreen && !loginScreen.classList.contains('hidden'));
  }

  function spawnRipple(x, y, opts = {}) {
    if (ripples.length >= MAX_RIPPLES) {
      ripples.shift();
    }
    ripples.push({
      x,
      y,
      radius: opts.startRadius || 4,
      maxRadius: opts.maxRadius || 38,
      alpha: opts.alpha || 0.28,
      lineWidth: opts.lineWidth || 1.4,
      speed: opts.speed || 0.065,
      stretch: opts.stretch || 1,
      angle: opts.angle || 0,
      isClick: Boolean(opts.isClick)
    });
  }

  function startLoop() {
    if (rafId === null) {
      rafId = requestAnimationFrame(renderFrame);
    }
  }

  function renderFrame() {
    ctx.clearRect(0, 0, width, height);

    if (!isLoginScreenVisible()) {
      ripples.length = 0;
      auraOpacity = 0;
      cursorVisible = false;
      rafId = null;
      return;
    }

    // Smooth liquid inertia
    const dx = targetX - smoothX;
    const dy = targetY - smoothY;
    smoothX += dx * 0.22;
    smoothY += dy * 0.22;
    velX = velX * 0.82 + dx * 0.18;
    velY = velY * 0.82 + dy * 0.18;

    const speed = Math.hypot(velX, velY);
    const targetAura = cursorVisible ? Math.min(1, 0.35 + speed * 0.04) : 0;
    auraOpacity += (targetAura - auraOpacity) * 0.12;

    // 1. Liquid water shadow + subtle specular light reflection
    if (auraOpacity > 0.01 && smoothX > -100 && smoothY > -100) {
      const moveAngle = Math.atan2(velY, velX);
      const stretchX = 1 + Math.min(0.45, speed * 0.018);
      const stretchY = 1 / Math.sqrt(stretchX);
      const auraRadius = 56;

      ctx.save();
      ctx.translate(smoothX, smoothY);
      ctx.rotate(moveAngle);
      ctx.scale(stretchX, stretchY);

      const grad = ctx.createRadialGradient(0, 0, 2, 0, 0, auraRadius);
      grad.addColorStop(0, `rgba(56, 189, 248, ${(0.11 * auraOpacity).toFixed(4)})`);
      grad.addColorStop(0.45, `rgba(79, 70, 229, ${(0.06 * auraOpacity).toFixed(4)})`);
      grad.addColorStop(1, 'rgba(56, 189, 248, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, auraRadius, 0, Math.PI * 2);
      ctx.fill();

      // Subtle light reflection droplet
      const reflGrad = ctx.createRadialGradient(-8, -8, 1, -8, -8, 18);
      reflGrad.addColorStop(0, `rgba(255, 255, 255, ${(0.18 * auraOpacity).toFixed(4)})`);
      reflGrad.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = reflGrad;
      ctx.beginPath();
      ctx.arc(-8, -8, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // 2. Expanding water ripples
    for (let i = ripples.length - 1; i >= 0; i--) {
      const r = ripples[i];
      const remaining = r.maxRadius - r.radius;
      r.radius += Math.max(0.35, remaining * r.speed);
      const progress = Math.min(1, r.radius / r.maxRadius);
      const currentAlpha = r.alpha * (1 - progress) * (1 - progress * 0.35);

      if (currentAlpha <= 0.005 || r.radius >= r.maxRadius) {
        ripples.splice(i, 1);
        continue;
      }

      ctx.save();
      ctx.translate(r.x, r.y);
      if (r.stretch !== 1) {
        ctx.rotate(r.angle);
        ctx.scale(r.stretch, 1 / Math.sqrt(r.stretch));
      }

      // Outer soft blue water ring
      ctx.beginPath();
      ctx.arc(0, 0, r.radius, 0, Math.PI * 2);
      ctx.strokeStyle = r.isClick
        ? `rgba(37, 99, 235, ${currentAlpha.toFixed(4)})`
        : `rgba(56, 189, 248, ${currentAlpha.toFixed(4)})`;
      ctx.lineWidth = r.lineWidth * (1 - progress * 0.4);
      ctx.stroke();

      // Inner light reflection ring
      if (r.radius > 8) {
        ctx.beginPath();
        ctx.arc(0, 0, r.radius * 0.72, -0.8, 1.1);
        ctx.strokeStyle = `rgba(255, 255, 255, ${(currentAlpha * 0.55).toFixed(4)})`;
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.restore();
    }

    const stillMoving = Math.abs(dx) > 0.3 || Math.abs(dy) > 0.3 || auraOpacity > 0.015;
    if (ripples.length > 0 || stillMoving || cursorVisible) {
      rafId = requestAnimationFrame(renderFrame);
    } else {
      rafId = null;
    }
  }

  function onMouseMove(e) {
    if (!isLoginScreenVisible()) {
      cursorVisible = false;
      return;
    }
    targetX = e.clientX;
    targetY = e.clientY;
    if (!cursorVisible) {
      smoothX = targetX;
      smoothY = targetY;
      lastSpawnX = targetX;
      lastSpawnY = targetY;
      cursorVisible = true;
    }

    const dist = Math.hypot(targetX - lastSpawnX, targetY - lastSpawnY);
    if (dist >= 20) {
      const angle = Math.atan2(targetY - lastSpawnY, targetX - lastSpawnX);
      const stretch = 1 + Math.min(0.35, dist * 0.008);
      spawnRipple(targetX, targetY, {
        startRadius: 5,
        maxRadius: Math.min(54, 28 + dist * 0.35),
        alpha: 0.24,
        lineWidth: 1.3,
        speed: 0.07,
        stretch,
        angle,
        isClick: false
      });
      lastSpawnX = targetX;
      lastSpawnY = targetY;
    }
    startLoop();
  }

  function onMouseDown(e) {
    if (!isLoginScreenVisible() || e.button !== 0) return;
    const x = e.clientX;
    const y = e.clientY;
    spawnRipple(x, y, {
      startRadius: 6,
      maxRadius: 72,
      alpha: 0.34,
      lineWidth: 1.8,
      speed: 0.085,
      isClick: true
    });
    spawnRipple(x, y, {
      startRadius: 2,
      maxRadius: 46,
      alpha: 0.22,
      lineWidth: 1.2,
      speed: 0.065,
      isClick: true
    });
    startLoop();
  }

  function onMouseLeave() {
    cursorVisible = false;
    startLoop();
  }

  window.addEventListener('resize', resizeCanvas, { passive: true });
  window.addEventListener('mousemove', onMouseMove, { passive: true });
  window.addEventListener('mousedown', onMouseDown, { passive: true });
  document.addEventListener('mouseleave', onMouseLeave, { passive: true });
  window.addEventListener('pagehide', () => {
    if (rafId !== null) cancelAnimationFrame(rafId);
    window.removeEventListener('resize', resizeCanvas);
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mousedown', onMouseDown);
    document.removeEventListener('mouseleave', onMouseLeave);
  });
}

// ==================== SAAS SUBSCRIPTION, PRICING & SUPER ADMIN ====================
function switchPublicTab(tab) {
  const authContainer = document.getElementById('public-auth-container');
  const pricingSec = document.getElementById('public-pricing-section');
  const loginCard = document.querySelector('#public-auth-container .login-card:not(#register-card-panel)');
  const regCard = document.getElementById('register-card-panel');

  document.querySelectorAll('.public-nav-btn').forEach((b) => {
    b.classList.toggle('active', b.getAttribute('data-pub-tab') === tab);
  });

  if (tab === 'pricing' || tab === 'features') {
    if (authContainer) authContainer.classList.add('hidden');
    if (pricingSec) pricingSec.classList.remove('hidden');
    loadPublicPlans();
    return;
  }

  if (pricingSec) pricingSec.classList.add('hidden');
  if (authContainer) authContainer.classList.remove('hidden');

  if (tab === 'register') {
    if (loginCard) loginCard.classList.add('hidden');
    if (regCard) regCard.classList.remove('hidden');
  } else {
    if (regCard) regCard.classList.add('hidden');
    if (loginCard) loginCard.classList.remove('hidden');
  }
}

async function loadPublicPlans() {
  if (!dbService.isServerMode) return;
  try {
    const res = await fetch('/api/saas/plans', { cache: 'no-store' });
    if (res.ok) {
      cachedSaasPlans = await res.json();
      renderPricingCards('public-plans-grid', publicBillingCycle, true);
    }
  } catch (_) {}
}

function renderPricingCards(containerId, cycle, isPublic) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (!cachedSaasPlans || cachedSaasPlans.length === 0) {
    container.innerHTML = `<p class="text-muted">Memuat daftar paket...</p>`;
    return;
  }

  container.innerHTML = cachedSaasPlans
    .map((p) => {
      const price = cycle === 'yearly' ? Number(p.price_yearly || 0) : Number(p.price_monthly || 0);
      const cycleText = cycle === 'yearly' ? '/tahun' : '/bulan';
      const features = Array.isArray(p.features) ? p.features : [];
      const ctaHtml = isPublic
        ? `<button type="button" class="btn btn-primary btn-block" onclick="switchPublicTab('register')">Mulai Free Trial 10 Hari</button>`
        : `<button type="button" class="btn btn-primary btn-block" onclick="selectPlanForCheckout('${p.code}')">Pilih ${p.name}</button>`;

      const activePlanCode =
        !isPublic && currentSubscriptionCtx && currentSubscriptionCtx.plan ? currentSubscriptionCtx.plan.code : '';
      const activeCycle =
        !isPublic && currentSubscriptionCtx && currentSubscriptionCtx.subscription
          ? currentSubscriptionCtx.subscription.billing_cycle
          : '';
      const isCurrentActive = Boolean(!isPublic && activePlanCode === p.code && activeCycle === cycle);
      const badgeHtml = isCurrentActive
        ? '<span class="pricing-rec-badge" style="background:#10b981">AKTIF SAAT INI</span>'
        : p.is_recommended
        ? '<span class="pricing-rec-badge">REKOMENDASI</span>'
        : '';

      return `
        <div class="pricing-card ${p.is_recommended || isCurrentActive ? 'recommended' : ''}">
          ${badgeHtml}
          <div>
            <h3>${p.name}</h3>
            <p class="text-muted text-sm">${p.target_audience || p.description || ''}</p>
            <div class="pricing-price">${formatRupiah(price)} <span>${cycleText}</span></div>
            <p class="text-muted text-sm">${p.description || ''}</p>
            <ul class="pricing-features">
              ${features.map((f) => `<li>${f}</li>`).join('')}
            </ul>
          </div>
          ${ctaHtml}
        </div>
      `;
    })
    .join('');
}

function renderTrialStatusBanner(subCtx) {
  const banner = document.getElementById('trial-status-banner');
  const titleEl = document.getElementById('trial-banner-title');
  const msgEl = document.getElementById('trial-banner-msg');
  if (!banner || !titleEl || !msgEl) return;

  if (!subCtx || !subCtx.trial_notice) {
    banner.classList.add('hidden');
    return;
  }

  banner.classList.remove('hidden', 'banner-warning', 'banner-danger');
  if (subCtx.trial_notice.level === 'warning') banner.classList.add('banner-warning');
  if (subCtx.trial_notice.level === 'danger') banner.classList.add('banner-danger');

  titleEl.textContent =
    subCtx.effective_status === 'EXPIRED'
      ? '⚠️ Langganan / Uji Coba Berakhir'
      : `🎁 Free Trial 10 Hari (${subCtx.days_remaining} hari tersisa)`;
  msgEl.textContent = subCtx.trial_notice.message;
}

window.selectPlanForCheckout = function (planCode) {
  selectedCheckoutPlanCode = planCode;
  const plan = cachedSaasPlans.find((p) => p.code === planCode);
  const form = document.getElementById('checkout-form');
  if (!plan || !form) return;

  const amount = customerBillingCycle === 'yearly' ? Number(plan.price_yearly) : Number(plan.price_monthly);
  document.getElementById('co-plan-name').textContent = plan.name;
  document.getElementById('co-cycle-label').textContent = customerBillingCycle === 'yearly' ? 'Tahunan' : 'Bulanan';
  document.getElementById('co-amount').textContent = formatRupiah(amount);
  form.classList.remove('hidden');
  form.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
};

function syncManualPlanPriceInputs() {
  const planCodeEl = document.getElementById('ms-plan-code');
  const pmEl = document.getElementById('ms-price-monthly');
  const pyEl = document.getElementById('ms-price-yearly');
  if (!planCodeEl || !pmEl || !pyEl) return;
  const plan = cachedSaasPlans.find((p) => p.code === planCodeEl.value);
  if (plan) {
    pmEl.value = Number(plan.price_monthly || 0);
    pyEl.value = Number(plan.price_yearly || 0);
  }
}

function addDaysToDateStr(dateStr, days) {
  const base = dateStr ? new Date(`${dateStr}T00:00:00`) : new Date();
  base.setDate(base.getDate() + days);
  const yyyy = base.getFullYear();
  const mm = String(base.getMonth() + 1).padStart(2, '0');
  const dd = String(base.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function updateManualSubDaysPreview() {
  const endEl = document.getElementById('ms-end-date');
  const previewEl = document.getElementById('manual-sub-days-preview');
  if (!endEl || !previewEl) return;
  if (!endEl.value) {
    previewEl.textContent = 'Sisa Waktu: 0 Hari';
    return;
  }
  const endMs = new Date(`${endEl.value}T23:59:59`).getTime();
  const daysLeft = Math.max(0, Math.ceil((endMs - Date.now()) / 86400000));
  previewEl.textContent = `Sisa Waktu: ${daysLeft} Hari`;
  previewEl.className = `badge ${daysLeft > 7 ? 'badge-in' : daysLeft > 0 ? 'badge-warning' : 'badge-out'}`;
}

function syncManualSubEndDateFromCycle() {
  const cycleEl = document.getElementById('ms-billing-cycle');
  const startEl = document.getElementById('ms-start-date');
  const endEl = document.getElementById('ms-end-date');
  if (!cycleEl || !startEl || !endEl) return;

  const startStr = startEl.value || getTodayStr();
  startEl.value = startStr;
  const days = cycleEl.value === 'yearly' ? 365 : cycleEl.value === 'monthly' ? 30 : 10;
  endEl.value = addDaysToDateStr(startStr, days);
  updateManualSubDaysPreview();
}

async function refreshSubscriptionView() {
  if (!dbService.isServerMode) return;
  document.querySelectorAll('.platform-admin-only').forEach((el) => {
    el.classList.toggle('hidden', !isCurrentPlatformAdmin());
  });
  try {
    const [subData, plans] = await Promise.all([
      dbService.apiFetch('/api/saas/my-subscription'),
      fetch('/api/saas/plans', { cache: 'no-store' }).then((r) => r.json())
    ]);
    currentSubscriptionCtx = subData;
    cachedSaasPlans = Array.isArray(plans) ? plans : [];

    const sub = subData.subscription || {};
    const plan = subData.plan || {};
    const status = subData.effective_status || 'ACTIVE';

    if (sub.billing_cycle === 'monthly' || sub.billing_cycle === 'yearly') {
      customerBillingCycle = sub.billing_cycle;
      document.querySelectorAll('.billing-toggle-btn[data-sub-cycle]').forEach((b) => {
        b.classList.toggle('active', b.getAttribute('data-sub-cycle') === customerBillingCycle);
      });
    }

    renderTrialStatusBanner(subData);
    renderPricingCards('sub-plans-grid', customerBillingCycle, false);

    const badgeClass =
      status === 'ACTIVE' ? 'badge-in' : status === 'TRIAL' ? 'badge-info' : 'badge-out';
    const cycleLabel =
      sub.billing_cycle === 'yearly' ? 'Tahunan' : sub.billing_cycle === 'monthly' ? 'Bulanan' : 'Trial';

    document.getElementById('sub-plan-name').textContent = `${plan.name || 'Workspace Utama'} (${cycleLabel})`;
    document.getElementById('sub-status-badge-wrap').innerHTML = `<span class="badge ${badgeClass}">${status}</span> • ${
      subData.workspace ? subData.workspace.name : ''
    }`;
    const daysLeftNum = Number(subData.days_remaining || 0);
    document.getElementById('sub-days-left').textContent =
      daysLeftNum > 0 ? `Kurang ${daysLeftNum} Hari` : '0 Hari (Berakhir)';

    const startStr = (sub.current_period_start || sub.trial_started_at || '').slice(0, 10) || '-';
    const endStr = (sub.current_period_end || sub.trial_ends_at || '').slice(0, 10) || '-';
    document.getElementById('sub-period-dates').textContent = `Mulai: ${startStr} | Berakhir: ${endStr}`;

    // Isi form Edit Manual jika user adalah Platform Admin
    const msPlanEl = document.getElementById('ms-plan-code');
    const msCycleEl = document.getElementById('ms-billing-cycle');
    const msStatusEl = document.getElementById('ms-status');
    const msStartEl = document.getElementById('ms-start-date');
    const msEndEl = document.getElementById('ms-end-date');
    if (msPlanEl && cachedSaasPlans.length > 0) {
      msPlanEl.innerHTML = cachedSaasPlans
        .map((p) => `<option value="${p.code}">${p.name}</option>`)
        .join('');
      if (plan.code) msPlanEl.value = plan.code;
    }
    if (msCycleEl) msCycleEl.value = sub.billing_cycle || 'monthly';
    if (msStatusEl) msStatusEl.value = status;
    if (msStartEl) msStartEl.value = startStr !== '-' ? startStr : getTodayStr();
    if (msEndEl) msEndEl.value = endStr !== '-' ? endStr : addDaysToDateStr(getTodayStr(), 30);
    syncManualPlanPriceInputs();
    updateManualSubDaysPreview();

    const usage = subData.usage || { warehouses_used: 1, max_warehouses: 1, users_used: 1, max_users: 3 };
    document.getElementById('sub-warehouses-usage').textContent = `${usage.warehouses_used} / ${
      usage.max_warehouses >= 999 ? '∞' : usage.max_warehouses
    }`;
    document.getElementById('sub-users-usage').textContent = `${usage.users_used} / ${
      usage.max_users >= 999 ? '∞' : usage.max_users
    }`;

    const whPct = Math.min(100, Math.round((usage.warehouses_used / Math.max(1, usage.max_warehouses)) * 100));
    const usrPct = Math.min(100, Math.round((usage.users_used / Math.max(1, usage.max_users)) * 100));
    document.getElementById('sub-warehouses-bar').style.width = `${whPct}%`;
    document.getElementById('sub-users-bar').style.width = `${usrPct}%`;

    const payTbody = document.getElementById('sub-payments-tbody');
    const payments = subData.payments || [];
    payTbody.innerHTML =
      payments.length === 0
        ? `<tr><td colspan="4" class="text-center text-muted">Belum ada transaksi pembayaran.</td></tr>`
        : payments
            .map((p) => {
              const stClass = p.status === 'PAID' ? 'badge-in' : p.status === 'PENDING' ? 'badge-warning' : 'badge-out';
              return `<tr>
                <td><code>${p.order_id}</code></td>
                <td>${p.subscription_plans ? p.subscription_plans.name : '-'} (${p.billing_cycle})</td>
                <td><strong>${formatRupiah(p.amount)}</strong></td>
                <td><span class="badge ${stClass}">${p.status}</span></td>
              </tr>`;
            })
            .join('');

    const invTbody = document.getElementById('sub-invoices-tbody');
    const invoices = subData.invoices || [];
    invTbody.innerHTML =
      invoices.length === 0
        ? `<tr><td colspan="4" class="text-center text-muted">Belum ada invoice.</td></tr>`
        : invoices
            .map((inv) => {
              const stClass = inv.status === 'PAID' ? 'badge-in' : inv.status === 'PENDING' ? 'badge-warning' : 'badge-out';
              return `<tr>
                <td><code>${inv.invoice_number}</code></td>
                <td>${inv.plan_name} (${inv.billing_cycle})</td>
                <td><strong>${formatRupiah(inv.amount)}</strong></td>
                <td><span class="badge ${stClass}">${inv.status}</span></td>
              </tr>`;
            })
            .join('');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

async function refreshSaasAdminView() {
  if (!dbService.isServerMode || !isCurrentPlatformAdmin()) return;
  try {
    const [stats, payments, customers, plans] = await Promise.all([
      dbService.apiFetch('/api/admin/saas/stats'),
      dbService.apiFetch('/api/admin/saas/payments'),
      dbService.apiFetch('/api/admin/saas/customers'),
      dbService.apiFetch('/api/admin/saas/plans')
    ]);

    document.getElementById('sa-stat-customers').textContent = stats.total_customers || 0;
    document.getElementById('sa-stat-new').textContent = `Baru bulan ini: ${stats.new_customers || 0}`;
    document.getElementById('sa-stat-active').textContent = stats.total_active || 0;
    document.getElementById('sa-stat-paid').textContent = `Paket berbayar: ${stats.total_paid || 0}`;
    document.getElementById('sa-stat-trial').textContent = stats.total_trial || 0;
    document.getElementById('sa-stat-expired').textContent = `Expired: ${stats.total_expired || 0}`;
    document.getElementById('sa-stat-revenue').textContent = formatRupiah(stats.total_revenue || 0);
    document.getElementById('sa-stat-pending').textContent = `Menunggu verifikasi: ${stats.pending_payments || 0}`;

    const payTbody = document.getElementById('sa-payments-tbody');
    payTbody.innerHTML =
      payments.length === 0
        ? `<tr><td colspan="7" class="text-center text-muted">Belum ada pembayaran masuk.</td></tr>`
        : payments
            .map((p) => {
              const stClass = p.status === 'PAID' ? 'badge-in' : p.status === 'PENDING' ? 'badge-warning' : 'badge-out';
              const actions =
                p.status === 'PENDING'
                  ? `<button class="btn-icon-edit" onclick="verifyAdminPayment(${p.id}, 'PAID')">Setujui</button>
                     <button class="btn-icon-danger" onclick="verifyAdminPayment(${p.id}, 'FAILED')">Tolak</button>`
                  : `<span class="text-muted text-sm">${escapeHtml(p.verified_by || '-')}</span>`;
              return `<tr>
                <td><code>${escapeHtml(p.order_id)}</code></td>
                <td><strong>${escapeHtml(p.workspaces ? p.workspaces.name : '-')}</strong><div class="text-muted text-sm">${escapeHtml(p.workspaces ? p.workspaces.owner_email : '')}</div></td>
                <td>${escapeHtml(p.subscription_plans ? p.subscription_plans.name : '-')} (${escapeHtml(p.billing_cycle)})</td>
                <td><strong>${formatRupiah(p.amount)}</strong></td>
                <td>${escapeHtml(p.payment_method)}<div class="text-muted text-sm">${escapeHtml(p.proof_note || '-')}</div></td>
                <td><span class="badge ${stClass}">${escapeHtml(p.status)}</span></td>
                <td>${actions}</td>
              </tr>`;
            })
            .join('');

    const custTbody = document.getElementById('sa-customers-tbody');
    custTbody.innerHTML =
      customers.length === 0
        ? `<tr><td colspan="6" class="text-center text-muted">Belum ada workspace terdaftar.</td></tr>`
        : customers
            .map((c) => {
              const sub = c.subscription || {};
              const endStr = (sub.current_period_end || sub.trial_ends_at || '').slice(0, 10) || '-';
              const stClass =
                c.sub_status === 'ACTIVE' ? 'badge-in' : c.sub_status === 'TRIAL' ? 'badge-info' : 'badge-out';
              return `<tr>
                <td><strong>${escapeHtml(c.name)}</strong> ${c.is_active ? '' : '<span class="badge badge-out">NONAKTIF</span>'}<div class="text-muted text-sm">${escapeHtml(c.owner_email || '-')}</div></td>
                <td>${escapeHtml(c.plan_name)}</td>
                <td><span class="badge ${stClass}">${escapeHtml(c.sub_status)}</span></td>
                <td>${c.users_count}</td>
                <td>${escapeHtml(endStr)}</td>
                <td>
                  <button class="btn-icon-edit" onclick="promptEditCustomerSub(${c.id}, '${escapeHtml(c.plan_code || 'business')}')">Atur Paket</button>
                  <button class="btn-icon-danger" onclick="toggleWorkspaceStatus(${c.id})">${c.is_active ? 'Nonaktifkan' : 'Aktifkan'}</button>
                  <button class="btn-icon-danger" onclick="deleteCustomerSub(${c.id}, '${escapeHtml(String(c.name || '').replace(/'/g, "\\'"))}')">Hapus Sub</button>
                </td>
              </tr>`;
            })
            .join('');

    const planTbody = document.getElementById('sa-plans-tbody');
    planTbody.innerHTML = plans
      .map(
        (p) => `<tr>
        <td><code>${escapeHtml(p.code)}</code></td>
        <td><input type="text" class="sa-plan-input" id="sp-name-${p.id}" value="${escapeHtml(p.name)}" /></td>
        <td><input type="number" class="sa-plan-input" id="sp-pm-${p.id}" value="${p.price_monthly}" /></td>
        <td><input type="number" class="sa-plan-input" id="sp-py-${p.id}" value="${p.price_yearly}" /></td>
        <td><input type="number" class="sa-plan-input" id="sp-wh-${p.id}" value="${p.max_warehouses}" /></td>
        <td><input type="number" class="sa-plan-input" id="sp-us-${p.id}" value="${p.max_users}" /></td>
        <td>
          <button class="btn btn-primary btn-sm" onclick="saveAdminPlan(${p.id}, ${p.is_recommended}, ${p.is_active})">Simpan</button>
          <button class="btn-icon-danger" onclick="deleteAdminPlan(${p.id}, '${String(p.name || '').replace(/'/g, "\\'")}')">Hapus</button>
        </td>
      </tr>`
      )
      .join('');
  } catch (err) {
    showToast(err.message, 'error');
  }
}

window.verifyAdminPayment = async function (paymentId, decision) {
  if (!confirm(`Ubah status pembayaran ini menjadi ${decision}?`)) return;
  try {
    await dbService.apiFetch(`/api/admin/saas/payments/${paymentId}/verify`, {
      method: 'POST',
      body: JSON.stringify({ decision })
    });
    showToast(`Pembayaran berhasil diverifikasi (${decision}).`);
    await refreshSaasAdminView();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

window.toggleWorkspaceStatus = async function (wsId) {
  try {
    const res = await dbService.apiFetch(`/api/admin/saas/customers/${wsId}/toggle`, { method: 'PUT' });
    showToast(`Workspace ${res.is_active ? 'diaktifkan' : 'dinonaktifkan'}.`);
    await refreshSaasAdminView();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

window.promptEditCustomerSub = async function (wsId, currentPlan) {
  const planCode = prompt('Masukkan kode paket (starter / business / enterprise):', currentPlan || 'business');
  if (planCode === null) return;
  const extendDays = prompt('Tambahkan masa aktif (hari, contoh 30 atau 0 jika tidak menambah):', '30');
  if (extendDays === null) return;
  try {
    await dbService.apiFetch(`/api/admin/saas/subscriptions/${wsId}`, {
      method: 'PUT',
      body: JSON.stringify({
        plan_code: planCode.trim().toLowerCase(),
        extend_days: parseInt(extendDays, 10) || 0
      })
    });
    showToast('Langganan pelanggan berhasil diperbarui.');
    await refreshSaasAdminView();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

window.saveAdminPlan = async function (planId, isRecommended, isActive) {
  try {
    await dbService.apiFetch(`/api/admin/saas/plans/${planId}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: document.getElementById(`sp-name-${planId}`).value,
        price_monthly: Number(document.getElementById(`sp-pm-${planId}`).value),
        price_yearly: Number(document.getElementById(`sp-py-${planId}`).value),
        max_warehouses: Number(document.getElementById(`sp-wh-${planId}`).value),
        max_users: Number(document.getElementById(`sp-us-${planId}`).value),
        is_recommended: isRecommended,
        is_active: isActive
      })
    });
    showToast('Paket berhasil disimpan ke database!');
    await loadPublicPlans();
    await refreshSaasAdminView();
  } catch (err) {
    showToast(err.message, 'error');
  }
};

window.deleteAdminPlan = async function (planId, planName) {
  if (!confirm(`Yakin ingin menghapus paket "${planName || planId}"?`)) return;
  try {
    const res = await dbService.apiFetch(`/api/admin/saas/plans/${planId}`, { method: 'DELETE' });
    showToast(res.message || 'Paket berhasil dihapus.');
    await loadPublicPlans();
    if (!document.getElementById('view-saas-admin')?.classList.contains('hidden')) {
      await refreshSaasAdminView();
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
};

window.deleteCustomerSub = async function (wsId, wsName) {
  if (!confirm(`Yakin ingin menghapus data langganan untuk "${wsName || `Workspace ${wsId}`}"? (Data barang tidak akan terhapus)`)) return;
  try {
    const res = await dbService.apiFetch(`/api/admin/saas/subscriptions/${wsId}`, { method: 'DELETE' });
    showToast(res.message || 'Langganan berhasil dihapus.');
    if (!document.getElementById('view-saas-admin')?.classList.contains('hidden')) {
      await refreshSaasAdminView();
    }
  } catch (err) {
    showToast(err.message, 'error');
  }
};

