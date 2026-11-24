try {
  require('dotenv').config();
} catch (_) {
  // dotenv opsional jika environment variables sudah diset oleh host (Vercel)
}

const express = require('express');
const cors = require('cors');
const path = require('path');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'rahasia-stok-barang-2026-aman';

const SUPABASE_URL = (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '').trim();
const SUPABASE_SERVICE_ROLE_KEY = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();

function inspectSupabaseKeyRole(key) {
  if (!key) return 'missing';
  if (key.startsWith('sb_publishable_')) return 'publishable';
  if (key.startsWith('sb_secret_')) return 'service_role';
  const parts = key.split('.');
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
      return payload.role || 'unknown';
    } catch (_) {
      return 'unknown';
    }
  }
  return 'unknown';
}

const supabaseKeyRole = inspectSupabaseKeyRole(SUPABASE_SERVICE_ROLE_KEY);
const isValidServiceKey =
  Boolean(SUPABASE_SERVICE_ROLE_KEY) && supabaseKeyRole !== 'anon' && supabaseKeyRole !== 'publishable';
const isSupabaseConfigured = Boolean(SUPABASE_URL && isValidServiceKey);

const supabase = isSupabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false }
    })
  : null;

let supabaseSeedPromise = null;
async function ensureSupabaseReady() {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    const err = new Error(
      'Konfigurasi Supabase belum lengkap. Pastikan SUPABASE_URL dan SUPABASE_SERVICE_ROLE_KEY sudah diisi di .env atau Environment Variables Vercel.'
    );
    err.statusCode = 500;
    throw err;
  }

  if (!isValidServiceKey) {
    const err = new Error(
      `SUPABASE_SERVICE_ROLE_KEY berisi key dengan role "${supabaseKeyRole}" (Anon/Publishable). Ganti dengan Service Role / Secret Key Supabase.`
    );
    err.statusCode = 500;
    throw err;
  }

  if (!supabaseSeedPromise) {
    supabaseSeedPromise = (async () => {
      const { data: existingUsers, error: userErr } = await supabase.from('users').select('id').limit(1);
      if (userErr) throw userErr;

      if (!existingUsers || existingUsers.length === 0) {
        const defaultUsers = [
          {
            username: 'superadmin',
            password_hash: bcrypt.hashSync('super123', 10),
            full_name: 'Superadmin Sri Barada',
            role: 'superadmin'
          },
          {
            username: 'admin',
            password_hash: bcrypt.hashSync('admin123', 10),
            full_name: 'Admin Pelanggan (GMDP & GENAP)',
            role: 'admin'
          },
          {
            username: 'teknisi',
            password_hash: bcrypt.hashSync('teknisi123', 10),
            full_name: 'Teknisi Stok Barang',
            role: 'teknisi'
          },
          {
            username: 'spesial',
            password_hash: bcrypt.hashSync('spesial123', 10),
            full_name: 'Akun Spesial Operasional',
            role: 'spesial'
          },
          {
            username: 'viewer',
            password_hash: bcrypt.hashSync('viewer123', 10),
            full_name: 'Viewer Stok Barang (Lihat & Export)',
            role: 'viewer'
          }
        ];
        const { error: insUserErr } = await supabase.from('users').insert(defaultUsers);
        if (insUserErr) throw insUserErr;
      } else {
        // Pastikan akun default 'viewer' tersedia jika database sudah ada sebelumnya
        try {
          const { data: viewerUser } = await supabase
            .from('users')
            .select('id')
            .eq('username', 'viewer')
            .maybeSingle();
          if (!viewerUser) {
            await supabase.from('users').insert({
              username: 'viewer',
              password_hash: bcrypt.hashSync('viewer123', 10),
              full_name: 'Viewer Stok Barang (Lihat & Export)',
              role: 'viewer'
            });
          }
        } catch (_) {
          // Abaikan jika constraint role di Supabase belum diperbarui ke 'viewer'
        }
      }

      const { data: existingItems, error: itemErr } = await supabase.from('items').select('id').limit(1);
      if (itemErr) throw itemErr;

      if (!existingItems || existingItems.length === 0) {
        const defaultItems = [
          { sku: 'SBI-ONT-01', name: 'Modem ONT Dual Band AC1200', category: 'Perangkat Instalasi', unit: 'Unit', min_stock: 5, price: 0, initial_stock: 0, current_stock: 0 },
          { sku: 'SBI-RTR-02', name: 'Router WiFi Mesh Gigabit', category: 'Perangkat Instalasi', unit: 'Unit', min_stock: 5, price: 0, initial_stock: 0, current_stock: 0 },
          { sku: 'SBI-KBL-03', name: 'Kabel Fiber Dropcore 1 Core', category: 'Material Kabel', unit: 'Roll', min_stock: 3, price: 0, initial_stock: 0, current_stock: 0 },
          { sku: 'SBI-ACC-04', name: 'Fast Connector SC-UPC', category: 'Aksesoris Jaringan', unit: 'Pack', min_stock: 5, price: 0, initial_stock: 0, current_stock: 0 },
          { sku: 'SBI-ADP-05', name: 'Adaptor Power 12V 1.5A', category: 'Suku Cadang', unit: 'Pcs', min_stock: 5, price: 0, initial_stock: 0, current_stock: 0 }
        ];
        await supabase.from('items').insert(defaultItems);
      }

      await supabase
        .from('folder_settings')
        .upsert(
          [
            { company: 'GMDP', base_customers: 0 },
            { company: 'GENAP', base_customers: 0 }
          ],
          { onConflict: 'company', ignoreDuplicates: true }
        );
    })().catch((err) => {
      supabaseSeedPromise = null;
      throw err;
    });
  }

  return supabaseSeedPromise;
}

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Middleware Autentikasi JWT
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Sesi login tidak ditemukan. Silakan login kembali.' });
  }
  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Token tidak valid atau telah berakhir.' });
    }
    req.user = user;
    next();
  });
}

function requireAdmin(req, res, next) {
  if (!['superadmin', 'teknisi', 'spesial'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Akses ditolak untuk pengelolaan Stok Barang.' });
  }
  next();
}

function requireSuperadmin(req, res, next) {
  if (req.user.role !== 'superadmin') {
    return res.status(403).json({ error: 'Akses ditolak. Fitur ini hanya untuk Superadmin.' });
  }
  next();
}

function requireLogAccess(req, res, next) {
  if (!['superadmin', 'spesial'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Akses ditolak. Log aktivitas hanya untuk Superadmin dan Spesial.' });
  }
  next();
}

async function writeActivityLog({ user, action_type, target, detail }) {
  if (!isSupabaseConfigured || !supabase || !user) return;
  try {
    await supabase.from('activity_logs').insert({
      user_id: user.id || null,
      username: user.username || '-',
      full_name: user.full_name || user.username || '-',
      role: user.role || '-',
      action_type,
      target: String(target || ''),
      detail: String(detail || '')
    });
  } catch (_) {
    // Abaikan jika tabel activity_logs belum dibuat agar tidak mengganggu proses utama
  }
}

function verifyPassword(plain, storedHash) {
  if (!storedHash) return false;
  if (String(storedHash).startsWith('$2')) {
    return bcrypt.compareSync(plain, storedHash);
  }
  return plain === storedHash;
}

// ==================== ENDPOINT HEALTH / INFO ====================
app.get('/api/health', (req, res) => {
  res.json({
    ok: isSupabaseConfigured,
    mode: isSupabaseConfigured ? 'supabase' : 'supabase-unconfigured',
    diagnostics: {
      hasUrl: Boolean(SUPABASE_URL),
      hasServiceRoleKey: Boolean(SUPABASE_SERVICE_ROLE_KEY),
      keyRole: supabaseKeyRole
    }
  });
});

// ==================== ENDPOINT AUTENTIKASI ====================
app.post(
  '/api/auth/login',
  asyncHandler(async (req, res) => {
    await ensureSupabaseReady();
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username dan password wajib diisi.' });
    }

    const uname = username.trim().toLowerCase();
    const { data: user, error } = await supabase.from('users').select('*').ilike('username', uname).maybeSingle();
    if (error) throw error;

    if (!user || !verifyPassword(password, user.password_hash)) {
      return res.status(401).json({ error: 'Username atau password salah.' });
    }

    const payload = {
      id: user.id,
      username: user.username,
      full_name: user.full_name,
      role: user.role
    };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '2h' });

    await writeActivityLog({
      user: payload,
      action_type: 'LOGIN',
      target: 'Autentikasi',
      detail: `Login berhasil sebagai ${payload.role}`
    });

    res.json({ token, user: payload });
  })
);

app.get(
  '/api/auth/me',
  authenticateToken,
  asyncHandler(async (req, res) => {
    await ensureSupabaseReady();
    const { data: user, error } = await supabase
      .from('users')
      .select('id, username, full_name, role')
      .eq('id', req.user.id)
      .maybeSingle();
    if (error) throw error;
    if (!user) {
      return res.status(401).json({ error: 'Akun sudah tidak aktif. Silakan login kembali.' });
    }
    res.json({ user });
  })
);

// ==================== ENDPOINT MASTER BARANG ====================
app.get(
  '/api/items',
  authenticateToken,
  asyncHandler(async (req, res) => {
    await ensureSupabaseReady();
    const { data, error } = await supabase.from('items').select('*').order('name', { ascending: true });
    if (error) throw error;
    res.json(data || []);
  })
);

app.post(
  '/api/items',
  authenticateToken,
  requireAdmin,
  asyncHandler(async (req, res) => {
    await ensureSupabaseReady();
    const { sku, name, category, unit, min_stock, price, initial_stock } = req.body;
    if (!sku || !name || !category) {
      return res.status(400).json({ error: 'SKU, Nama Barang, dan Kategori wajib diisi.' });
    }

    const initStock = Math.max(0, parseInt(initial_stock, 10) || 0);
    const minStockVal = Math.max(0, parseInt(min_stock, 10) || 0);
    const priceVal = Math.max(0, parseFloat(price) || 0);

    const { data, error } = await supabase
      .from('items')
      .insert({
        sku: sku.trim().toUpperCase(),
        name: name.trim(),
        category: category.trim(),
        unit: (unit || 'Pcs').trim(),
        min_stock: minStockVal,
        price: priceVal,
        initial_stock: initStock,
        current_stock: initStock
      })
      .select()
      .single();

    if (error) {
      return res.status(400).json({ error: 'Kode SKU sudah terdaftar atau data tidak valid.' });
    }
    await writeActivityLog({
      user: req.user,
      action_type: 'EDIT',
      target: 'Master Barang',
      detail: `Tambah barang: [${data.sku}] ${data.name}`
    });
    res.status(201).json(data);
  })
);

app.put(
  '/api/items/:id',
  authenticateToken,
  requireAdmin,
  asyncHandler(async (req, res) => {
    await ensureSupabaseReady();
    const { id } = req.params;
    const { sku, name, category, unit, min_stock, price } = req.body;

    const { data: existing, error: findErr } = await supabase.from('items').select('*').eq('id', id).maybeSingle();
    if (findErr) throw findErr;
    if (!existing) return res.status(404).json({ error: 'Barang tidak ditemukan.' });

    const { data: updated, error: updErr } = await supabase
      .from('items')
      .update({
        sku: sku ? sku.trim().toUpperCase() : existing.sku,
        name: name ? name.trim() : existing.name,
        category: category ? category.trim() : existing.category,
        unit: unit ? unit.trim() : existing.unit,
        min_stock: min_stock !== undefined ? Math.max(0, parseInt(min_stock, 10) || 0) : existing.min_stock,
        price: price !== undefined ? Math.max(0, parseFloat(price) || 0) : existing.price
      })
      .eq('id', id)
      .select()
      .single();

    if (updErr) {
      return res.status(400).json({ error: 'Gagal mengubah data barang (SKU mungkin duplikat).' });
    }
    await writeActivityLog({
      user: req.user,
      action_type: 'EDIT',
      target: 'Master Barang',
      detail: `Edit barang: [${updated.sku}] ${updated.name}`
    });
    res.json(updated);
  })
);

app.delete(
  '/api/items/:id',
  authenticateToken,
  requireAdmin,
  asyncHandler(async (req, res) => {
    await ensureSupabaseReady();
    const { id } = req.params;
    const { error } = await supabase.from('items').delete().eq('id', id);
    if (error) throw error;
    await writeActivityLog({
      user: req.user,
      action_type: 'EDIT',
      target: 'Master Barang',
      detail: `Hapus barang ID ${id}`
    });
    res.json({ success: true });
  })
);

app.post(
  '/api/items/bulk-delete',
  authenticateToken,
  requireAdmin,
  asyncHandler(async (req, res) => {
    await ensureSupabaseReady();
    const rawIds = Array.isArray(req.body.ids) ? req.body.ids : [];
    const validIds = Array.from(
      new Set(rawIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))
    );
    if (validIds.length === 0) {
      return res.status(400).json({ error: 'Pilih minimal 1 barang yang ingin dihapus.' });
    }
    const { error } = await supabase.from('items').delete().in('id', validIds);
    if (error) throw error;
    await writeActivityLog({
      user: req.user,
      action_type: 'EDIT',
      target: 'Master Barang',
      detail: `Hapus massal ${validIds.length} barang (ID: ${validIds.join(', ')})`
    });
    res.json({ success: true, deleted_count: validIds.length });
  })
);

// ==================== ENDPOINT TRANSAKSI STOK HARIAN ====================
app.get(
  '/api/transactions',
  authenticateToken,
  asyncHandler(async (req, res) => {
    await ensureSupabaseReady();
    const { date, month, type, item_id } = req.query;

    let q = supabase
      .from('transactions')
      .select('*, items(sku, name, unit), users(full_name, role)')
      .order('date', { ascending: false })
      .order('id', { ascending: false });

    if (date) q = q.eq('date', date);
    if (month) q = q.like('date', `${month}%`);
    if (type && (type === 'IN' || type === 'OUT')) q = q.eq('type', type);
    if (item_id) q = q.eq('item_id', item_id);

    const { data, error } = await q;
    if (error) throw error;

    const rows = (data || []).map((t) => ({
      id: t.id,
      item_id: t.item_id,
      type: t.type,
      quantity: t.quantity,
      reason: t.reason,
      date: t.date,
      notes: t.notes,
      user_id: t.user_id,
      created_at: t.created_at,
      sku: t.items ? t.items.sku : '',
      item_name: t.items ? t.items.name : '',
      unit: t.items ? t.items.unit : '',
      user_name: t.users ? t.users.full_name : 'Petugas',
      user_role: t.users ? t.users.role : ''
    }));
    res.json(rows);
  })
);

app.post(
  '/api/transactions',
  authenticateToken,
  requireAdmin,
  asyncHandler(async (req, res) => {
    await ensureSupabaseReady();
    const { item_id, type, quantity, reason, date, notes } = req.body;
    const qty = parseInt(quantity, 10);

    if (!item_id || !['IN', 'OUT'].includes(type) || !qty || qty <= 0 || !reason || !date) {
      return res.status(400).json({ error: 'Data transaksi tidak lengkap atau jumlah tidak valid.' });
    }

    const { data: item, error: itemErr } = await supabase.from('items').select('*').eq('id', item_id).maybeSingle();
    if (itemErr) throw itemErr;
    if (!item) return res.status(404).json({ error: 'Barang tidak ditemukan.' });

    if (type === 'OUT' && item.current_stock < qty) {
      return res.status(400).json({
        error: `Stok tidak mencukupi! Stok "${item.name}" saat ini hanya ${item.current_stock} ${item.unit}.`
      });
    }

    const newStock = type === 'IN' ? item.current_stock + qty : item.current_stock - qty;
    const { error: updErr } = await supabase.from('items').update({ current_stock: newStock }).eq('id', item_id);
    if (updErr) throw updErr;

    const { data: created, error: insErr } = await supabase
      .from('transactions')
      .insert({
        item_id,
        type,
        quantity: qty,
        reason,
        date,
        notes: notes || '',
        user_id: req.user.id
      })
      .select('*, items(sku, name, unit), users(full_name)')
      .single();

    if (insErr) {
      await supabase.from('items').update({ current_stock: item.current_stock }).eq('id', item_id);
      throw insErr;
    }

    await writeActivityLog({
      user: req.user,
      action_type: 'EDIT',
      target: 'Stok Harian',
      detail: `Transaksi ${type} (${reason}): ${item.name} x${qty} (${date})`
    });

    res.status(201).json({
      id: created.id,
      item_id: created.item_id,
      type: created.type,
      quantity: created.quantity,
      reason: created.reason,
      date: created.date,
      notes: created.notes,
      user_id: created.user_id,
      created_at: created.created_at,
      sku: created.items ? created.items.sku : item.sku,
      item_name: created.items ? created.items.name : item.name,
      unit: created.items ? created.items.unit : item.unit,
      user_name: created.users ? created.users.full_name : req.user.full_name
    });
  })
);

app.delete(
  '/api/transactions/:id',
  authenticateToken,
  requireAdmin,
  asyncHandler(async (req, res) => {
    await ensureSupabaseReady();
    const { id } = req.params;

    const { data: tx, error: txErr } = await supabase.from('transactions').select('*').eq('id', id).maybeSingle();
    if (txErr) throw txErr;
    if (!tx) return res.status(404).json({ error: 'Transaksi tidak ditemukan.' });

    const { data: item, error: itemErr } = await supabase.from('items').select('*').eq('id', tx.item_id).maybeSingle();
    if (itemErr) throw itemErr;

    const revertStock = tx.type === 'IN' ? item.current_stock - tx.quantity : item.current_stock + tx.quantity;
    if (revertStock < 0) {
      return res.status(400).json({ error: 'Tidak dapat menghapus transaksi karena stok akhir akan menjadi minus.' });
    }

    const { error: updErr } = await supabase.from('items').update({ current_stock: revertStock }).eq('id', tx.item_id);
    if (updErr) throw updErr;

    const { error: delErr } = await supabase.from('transactions').delete().eq('id', id);
    if (delErr) throw delErr;
    await writeActivityLog({
      user: req.user,
      action_type: 'EDIT',
      target: 'Stok Harian',
      detail: `Hapus transaksi ID ${id} (${item.name} x${tx.quantity})`
    });
    res.json({ success: true });
  })
);

app.post(
  '/api/transactions/bulk-delete',
  authenticateToken,
  requireAdmin,
  asyncHandler(async (req, res) => {
    await ensureSupabaseReady();
    const rawIds = Array.isArray(req.body.ids) ? req.body.ids : [];
    const validIds = Array.from(
      new Set(rawIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))
    );
    if (validIds.length === 0) {
      return res.status(400).json({ error: 'Pilih minimal 1 transaksi yang ingin dihapus.' });
    }

    const { data: txs, error: txErr } = await supabase.from('transactions').select('*').in('id', validIds);
    if (txErr) throw txErr;
    if (!txs || txs.length === 0) {
      return res.status(404).json({ error: 'Transaksi yang dipilih tidak ditemukan.' });
    }

    const deltaByItem = {};
    txs.forEach((tx) => {
      const d = tx.type === 'IN' ? -Number(tx.quantity || 0) : Number(tx.quantity || 0);
      deltaByItem[tx.item_id] = (deltaByItem[tx.item_id] || 0) + d;
    });

    const itemIds = Object.keys(deltaByItem).map((k) => Number(k));
    const { data: items, error: itemErr } = await supabase.from('items').select('*').in('id', itemIds);
    if (itemErr) throw itemErr;

    const newStockByItem = {};
    for (const item of items || []) {
      const nextStock = Number(item.current_stock || 0) + (deltaByItem[item.id] || 0);
      if (nextStock < 0) {
        return res.status(400).json({
          error: `Tidak dapat menghapus transaksi terpilih karena stok "${item.name}" akan menjadi minus (${nextStock}).`
        });
      }
      newStockByItem[item.id] = nextStock;
    }

    for (const itemId of Object.keys(newStockByItem)) {
      const { error: updErr } = await supabase
        .from('items')
        .update({ current_stock: newStockByItem[itemId] })
        .eq('id', Number(itemId));
      if (updErr) throw updErr;
    }

    const { error: delErr } = await supabase.from('transactions').delete().in('id', validIds);
    if (delErr) throw delErr;

    await writeActivityLog({
      user: req.user,
      action_type: 'EDIT',
      target: 'Stok Harian',
      detail: `Hapus massal ${txs.length} transaksi stok`
    });

    res.json({ success: true, deleted_count: txs.length });
  })
);

// ==================== ENDPOINT RESUME OTOMATIS BULANAN ====================
app.get(
  '/api/reports/monthly',
  authenticateToken,
  asyncHandler(async (req, res) => {
    await ensureSupabaseReady();
    const month = req.query.month || new Date().toISOString().slice(0, 7);
    const startOfMonth = `${month}-01`;

    const [itemsRes, txRes] = await Promise.all([
      supabase.from('items').select('*').order('name', { ascending: true }),
      supabase.from('transactions').select('*').order('date', { ascending: true }).order('id', { ascending: true })
    ]);
    if (itemsRes.error) throw itemsRes.error;
    if (txRes.error) throw txRes.error;

    const items = itemsRes.data || [];
    const allTransactions = txRes.data || [];

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
          if (t.reason.toLowerCase().includes('dismantle')) {
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
        if (t.reason.toLowerCase().includes('dismantle')) {
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

    res.json({
      month,
      totals,
      items: itemSummaries,
      reasons: Object.values(reasonBreakdown),
      daily: Object.values(dailyBreakdownMap).sort((a, b) => a.date.localeCompare(b.date))
    });
  })
);

// ==================== ENDPOINT MANAJEMEN USER (SUPERADMIN) ====================
app.get(
  '/api/users',
  authenticateToken,
  requireSuperadmin,
  asyncHandler(async (req, res) => {
    await ensureSupabaseReady();
    const { data, error } = await supabase
      .from('users')
      .select('id, username, full_name, role, created_at')
      .order('id', { ascending: true });
    if (error) throw error;
    res.json(data || []);
  })
);

app.post(
  '/api/users',
  authenticateToken,
  requireSuperadmin,
  asyncHandler(async (req, res) => {
    await ensureSupabaseReady();
    const { username, password, full_name, role } = req.body;
    if (!username || !password || !full_name) {
      return res.status(400).json({ error: 'Username, Password, dan Nama Lengkap wajib diisi.' });
    }

    const r = String(role || 'teknisi').toLowerCase();
    const validRole = ['superadmin', 'admin', 'teknisi', 'spesial', 'viewer'].includes(r) ? r : 'teknisi';
    const uname = username.trim().toLowerCase();

    const { data, error } = await supabase
      .from('users')
      .insert({
        username: uname,
        password_hash: bcrypt.hashSync(password, 10),
        full_name: full_name.trim(),
        role: validRole
      })
      .select('id, username, full_name, role, created_at')
      .single();

    if (error) {
      return res.status(400).json({ error: 'Username sudah terdaftar. Gunakan username lain.' });
    }
    await writeActivityLog({
      user: req.user,
      action_type: 'EDIT',
      target: 'Kelola Pengguna',
      detail: `Tambah pengguna: ${data.username} (${data.role})`
    });
    res.status(201).json(data);
  })
);

app.put(
  '/api/users/:id/password',
  authenticateToken,
  requireSuperadmin,
  asyncHandler(async (req, res) => {
    await ensureSupabaseReady();
    const { id } = req.params;
    const { password } = req.body;
    if (!password || String(password).trim().length < 4) {
      return res.status(400).json({ error: 'Password minimal 4 karakter.' });
    }

    const newHash = bcrypt.hashSync(String(password).trim(), 10);
    const { error } = await supabase.from('users').update({ password_hash: newHash }).eq('id', id);
    if (error) throw error;
    await writeActivityLog({
      user: req.user,
      action_type: 'EDIT',
      target: 'Kelola Pengguna',
      detail: `Ubah password user ID ${id}`
    });
    res.json({ success: true });
  })
);

app.delete(
  '/api/users/:id',
  authenticateToken,
  requireSuperadmin,
  asyncHandler(async (req, res) => {
    await ensureSupabaseReady();
    const { id } = req.params;
    if (parseInt(id, 10) === Number(req.user.id)) {
      return res.status(400).json({ error: 'Anda tidak dapat menghapus akun Anda sendiri yang sedang aktif.' });
    }
    const { error } = await supabase.from('users').delete().eq('id', id);
    if (error) throw error;
    await writeActivityLog({
      user: req.user,
      action_type: 'EDIT',
      target: 'Kelola Pengguna',
      detail: `Hapus user ID ${id}`
    });
    res.json({ success: true });
  })
);

// ==================== ENDPOINT LOG AKTIVITAS (SUPERADMIN & SPESIAL) ====================
app.get(
  '/api/logs',
  authenticateToken,
  requireLogAccess,
  asyncHandler(async (req, res) => {
    await ensureSupabaseReady();
    const { action_type, date } = req.query;
    const limit = Math.min(500, Math.max(10, parseInt(req.query.limit, 10) || 300));

    let q = supabase
      .from('activity_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit);

    if (action_type && ['LOGIN', 'EDIT', 'EXPORT'].includes(String(action_type).toUpperCase())) {
      q = q.eq('action_type', String(action_type).toUpperCase());
    }
    if (date) {
      q = q.gte('created_at', `${date}T00:00:00`).lte('created_at', `${date}T23:59:59.999`);
    }

    const { data, error } = await q;
    if (error) throw error;
    res.json(data || []);
  })
);

app.post(
  '/api/logs/export',
  authenticateToken,
  asyncHandler(async (req, res) => {
    await ensureSupabaseReady();
    const { target, detail } = req.body || {};
    await writeActivityLog({
      user: req.user,
      action_type: 'EXPORT',
      target: target || 'Export Data',
      detail: detail || 'Mengunduh file export'
    });
    res.json({ success: true });
  })
);

// ==================== ENDPOINT FOLDER TERPISAH: GMDP & GENAP ====================
function normalizeCompany(companyParam) {
  return String(companyParam || 'GMDP').toUpperCase() === 'GENAP' ? 'GENAP' : 'GMDP';
}

function buildFolderSummary({
  company,
  year,
  month,
  baseCustomers,
  allLogs,
  monthlyOverrides,
  yearlyOverrides,
  deletedMonths,
  deletedYears
}) {
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
    if (yOverride && yOverride.manual_opening !== null && yOverride.manual_opening !== undefined) {
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
      if (isManualMonth && mOverride.manual_opening !== null && mOverride.manual_opening !== undefined) {
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
        notes: isManualMonth ? mOverride.notes || '' : ''
      });
    }

    allYearsMonthlyMap[yStr] = monthsInYear;

    const hasManualYearInOut =
      yOverride &&
      yOverride.manual_in !== null &&
      yOverride.manual_in !== undefined &&
      yOverride.manual_out !== null &&
      yOverride.manual_out !== undefined;

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
        hasManualYearInOut || (yOverride && yOverride.manual_opening !== null && yOverride.manual_opening !== undefined)
      ),
      notes: yOverride ? yOverride.notes || '' : ''
    });
  });

  const monthlyTraffic = allYearsMonthlyMap[year] || [];
  const deletedMonthsInYear = Array.from(deletedMonths).filter((m) => m.startsWith(year));
  const monthLogs = [...allLogs]
    .filter((l) => l.date.startsWith(month))
    .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);

  // Rekap Trafik Penambahan Harian untuk bulan terpilih
  const dailyMap = {};
  allLogs
    .filter((l) => l.date && l.date.startsWith(month))
    .forEach((l) => {
      if (!dailyMap[l.date]) {
        dailyMap[l.date] = {
          date: l.date,
          customers_in: 0,
          customers_out: 0,
          net_growth: 0,
          tx_count: 0
        };
      }
      if (l.type === 'IN') {
        dailyMap[l.date].customers_in += Number(l.count || 0);
      } else {
        dailyMap[l.date].customers_out += Number(l.count || 0);
      }
      dailyMap[l.date].net_growth = dailyMap[l.date].customers_in - dailyMap[l.date].customers_out;
      dailyMap[l.date].tx_count += 1;
    });
  const dailyTraffic = Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));

  return {
    company,
    folder_path: `Supabase Cloud • folder_${company.toLowerCase()}`,
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

app.get(
  '/api/folder/:company/summary',
  authenticateToken,
  asyncHandler(async (req, res) => {
    await ensureSupabaseReady();
    const company = normalizeCompany(req.params.company);
    const year = req.query.year || String(new Date().getFullYear());
    const month = req.query.month || `${year}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;

    const [settingRes, logsRes, mManualRes, yManualRes, delMRes, delYRes] = await Promise.all([
      supabase.from('folder_settings').select('base_customers').eq('company', company).maybeSingle(),
      supabase
        .from('folder_logs')
        .select('*')
        .eq('company', company)
        .order('date', { ascending: true })
        .order('id', { ascending: true }),
      supabase.from('folder_monthly_manual').select('*').eq('company', company),
      supabase.from('folder_yearly_manual').select('*').eq('company', company),
      supabase.from('folder_deleted_months').select('month').eq('company', company),
      supabase.from('folder_deleted_years').select('year').eq('company', company)
    ]);

    if (settingRes.error) throw settingRes.error;
    if (logsRes.error) throw logsRes.error;
    if (mManualRes.error) throw mManualRes.error;
    if (yManualRes.error) throw yManualRes.error;
    if (delMRes.error) throw delMRes.error;
    if (delYRes.error) throw delYRes.error;

    const baseCustomers = settingRes.data ? Number(settingRes.data.base_customers || 0) : 0;
    const monthlyOverrides = {};
    (mManualRes.data || []).forEach((r) => {
      monthlyOverrides[r.month] = r;
    });
    const yearlyOverrides = {};
    (yManualRes.data || []).forEach((r) => {
      yearlyOverrides[r.year] = r;
    });
    const deletedMonths = new Set((delMRes.data || []).map((r) => r.month));
    const deletedYears = new Set((delYRes.data || []).map((r) => r.year));

    res.json(
      buildFolderSummary({
        company,
        year,
        month,
        baseCustomers,
        allLogs: logsRes.data || [],
        monthlyOverrides,
        yearlyOverrides,
        deletedMonths,
        deletedYears
      })
    );
  })
);

app.put(
  '/api/folder/:company/base',
  authenticateToken,
  asyncHandler(async (req, res) => {
    await ensureSupabaseReady();
    const company = normalizeCompany(req.params.company);
    const val = Math.max(0, parseInt(req.body.base_customers, 10) || 0);

    const { error } = await supabase
      .from('folder_settings')
      .upsert({ company, base_customers: val }, { onConflict: 'company' });
    if (error) throw error;
    await writeActivityLog({
      user: req.user,
      action_type: 'EDIT',
      target: `Pelanggan ${company}`,
      detail: `Ubah pelanggan awal menjadi ${val}`
    });
    res.json({ base_customers: val });
  })
);

app.post(
  '/api/folder/:company/logs',
  authenticateToken,
  asyncHandler(async (req, res) => {
    await ensureSupabaseReady();
    const company = normalizeCompany(req.params.company);
    const { type, count, category, customer_info, date } = req.body;
    const cnt = parseInt(count, 10);
    if (!['IN', 'OUT'].includes(type) || !cnt || cnt <= 0 || !category || !date) {
      return res.status(400).json({ error: 'Data update pelanggan harian tidak lengkap.' });
    }

    const logMonth = date.slice(0, 7);
    await supabase
      .from('folder_deleted_months')
      .delete()
      .eq('company', company)
      .eq('month', logMonth);
    await supabase
      .from('folder_deleted_years')
      .delete()
      .eq('company', company)
      .eq('year', date.slice(0, 4));

    const { data: created, error } = await supabase
      .from('folder_logs')
      .insert({
        company,
        type,
        count: cnt,
        category,
        customer_info: customer_info || '',
        date,
        user_name: req.user.full_name || 'Petugas'
      })
      .select()
      .single();
    if (error) throw error;

    // Jika bulan ini memiliki data manual, ikut tambahkan ke resume bulanan agar tetap sinkron
    const { data: existingManual } = await supabase
      .from('folder_monthly_manual')
      .select('*')
      .eq('company', company)
      .eq('month', logMonth)
      .maybeSingle();

    if (existingManual) {
      const updatedIn = type === 'IN' ? Number(existingManual.manual_in || 0) + cnt : Number(existingManual.manual_in || 0);
      const updatedOut = type === 'OUT' ? Number(existingManual.manual_out || 0) + cnt : Number(existingManual.manual_out || 0);
      await supabase
        .from('folder_monthly_manual')
        .update({ manual_in: updatedIn, manual_out: updatedOut })
        .eq('company', company)
        .eq('month', logMonth);
    }

    await writeActivityLog({
      user: req.user,
      action_type: 'EDIT',
      target: `Pelanggan ${company}`,
      detail: `Update harian ${type} (${category}) x${cnt} tanggal ${date}`
    });

    res.status(201).json(created);
  })
);

app.delete(
  '/api/folder/:company/logs/:id',
  authenticateToken,
  asyncHandler(async (req, res) => {
    await ensureSupabaseReady();
    const company = normalizeCompany(req.params.company);

    const { data: logRow } = await supabase
      .from('folder_logs')
      .select('*')
      .eq('company', company)
      .eq('id', req.params.id)
      .maybeSingle();

    const { error } = await supabase.from('folder_logs').delete().eq('company', company).eq('id', req.params.id);
    if (error) throw error;

    if (logRow && logRow.date) {
      const logMonth = logRow.date.slice(0, 7);
      const { data: existingManual } = await supabase
        .from('folder_monthly_manual')
        .select('*')
        .eq('company', company)
        .eq('month', logMonth)
        .maybeSingle();

      if (existingManual) {
        const cnt = Number(logRow.count || 0);
        const updatedIn =
          logRow.type === 'IN'
            ? Math.max(0, Number(existingManual.manual_in || 0) - cnt)
            : Number(existingManual.manual_in || 0);
        const updatedOut =
          logRow.type === 'OUT'
            ? Math.max(0, Number(existingManual.manual_out || 0) - cnt)
            : Number(existingManual.manual_out || 0);
        await supabase
          .from('folder_monthly_manual')
          .update({ manual_in: updatedIn, manual_out: updatedOut })
          .eq('company', company)
          .eq('month', logMonth);
      }
    }

    res.json({ success: true });
  })
);

app.post(
  '/api/folder/:company/monthly-manual',
  authenticateToken,
  asyncHandler(async (req, res) => {
    await ensureSupabaseReady();
    const company = normalizeCompany(req.params.company);
    const { month, manual_opening, manual_in, manual_out, notes } = req.body;
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ error: 'Format bulan harus YYYY-MM.' });
    }
    const openVal =
      manual_opening === '' || manual_opening === null || manual_opening === undefined
        ? null
        : Math.max(0, parseInt(manual_opening, 10) || 0);
    const inVal = Math.max(0, parseInt(manual_in, 10) || 0);
    const outVal = Math.max(0, parseInt(manual_out, 10) || 0);

    const { error } = await supabase.from('folder_monthly_manual').upsert(
      {
        company,
        month,
        manual_opening: openVal,
        manual_in: inVal,
        manual_out: outVal,
        notes: notes || ''
      },
      { onConflict: 'company,month' }
    );
    if (error) throw error;

    await supabase.from('folder_deleted_months').delete().eq('company', company).eq('month', month);
    await supabase.from('folder_deleted_years').delete().eq('company', company).eq('year', month.slice(0, 4));
    await supabase
      .from('folder_yearly_manual')
      .upsert({ company, year: month.slice(0, 4) }, { onConflict: 'company,year', ignoreDuplicates: true });
    await writeActivityLog({
      user: req.user,
      action_type: 'EDIT',
      target: `Pelanggan ${company}`,
      detail: `Simpan/Edit bulan manual ${month} (Masuk: ${inVal}, Keluar: ${outVal})`
    });
    res.json({ success: true });
  })
);

app.delete(
  '/api/folder/:company/monthly-manual/:month',
  authenticateToken,
  asyncHandler(async (req, res) => {
    await ensureSupabaseReady();
    const company = normalizeCompany(req.params.company);
    const { error } = await supabase
      .from('folder_monthly_manual')
      .delete()
      .eq('company', company)
      .eq('month', req.params.month);
    if (error) throw error;
    res.json({ success: true });
  })
);

app.delete(
  '/api/folder/:company/months/:month',
  authenticateToken,
  asyncHandler(async (req, res) => {
    await ensureSupabaseReady();
    const company = normalizeCompany(req.params.company);
    const m = req.params.month;

    await supabase.from('folder_monthly_manual').delete().eq('company', company).eq('month', m);
    await supabase.from('folder_logs').delete().eq('company', company).like('date', `${m}%`);
    const { error } = await supabase
      .from('folder_deleted_months')
      .upsert({ company, month: m }, { onConflict: 'company,month' });
    if (error) throw error;
    res.json({ success: true });
  })
);

app.post(
  '/api/folder/:company/months/restore',
  authenticateToken,
  asyncHandler(async (req, res) => {
    await ensureSupabaseReady();
    const company = normalizeCompany(req.params.company);
    const y = String(req.body.year || '');
    const { error } = await supabase
      .from('folder_deleted_months')
      .delete()
      .eq('company', company)
      .like('month', `${y}%`);
    if (error) throw error;
    res.json({ success: true });
  })
);

app.post(
  '/api/folder/:company/yearly-manual',
  authenticateToken,
  asyncHandler(async (req, res) => {
    await ensureSupabaseReady();
    const company = normalizeCompany(req.params.company);
    const { year, manual_opening, manual_in, manual_out, notes } = req.body;
    if (!year || !/^\d{4}$/.test(String(year))) {
      return res.status(400).json({ error: 'Format tahun harus 4 digit (contoh: 2026).' });
    }
    const openVal =
      manual_opening === '' || manual_opening === null || manual_opening === undefined
        ? null
        : Math.max(0, parseInt(manual_opening, 10) || 0);
    const inVal =
      manual_in === '' || manual_in === null || manual_in === undefined
        ? null
        : Math.max(0, parseInt(manual_in, 10) || 0);
    const outVal =
      manual_out === '' || manual_out === null || manual_out === undefined
        ? null
        : Math.max(0, parseInt(manual_out, 10) || 0);

    const { error } = await supabase.from('folder_yearly_manual').upsert(
      {
        company,
        year: String(year),
        manual_opening: openVal,
        manual_in: inVal,
        manual_out: outVal,
        notes: notes || ''
      },
      { onConflict: 'company,year' }
    );
    if (error) throw error;
    res.json({ success: true });
  })
);

app.delete(
  '/api/folder/:company/yearly-manual/:year',
  authenticateToken,
  asyncHandler(async (req, res) => {
    await ensureSupabaseReady();
    const company = normalizeCompany(req.params.company);
    const { error } = await supabase
      .from('folder_yearly_manual')
      .delete()
      .eq('company', company)
      .eq('year', req.params.year);
    if (error) throw error;
    res.json({ success: true });
  })
);

// ==================== ENDPOINT KIRIM BACKUP DATABASE KE BEBERAPA EMAIL ====================
app.post('/api/backup/send-email', authenticateToken, requireSuperadmin, async (req, res) => {
  const { recipients, smtp_sender, smtp_password, backup_data, summary_text } = req.body;
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return res.status(400).json({ error: 'Daftar email penerima masih kosong.' });
  }
  if (!smtp_sender || !smtp_password) {
    return res.status(400).json({
      error: 'Silakan isi Email Pengirim & App Password pada tombol "⚙️ Pengaturan SMTP Server" terlebih dahulu.'
    });
  }

  let nodemailer;
  try {
    nodemailer = require('nodemailer');
  } catch (_) {
    return res.status(500).json({ error: 'Modul nodemailer belum terinstal. Jalankan npm install.' });
  }

  try {
    const transporter = nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: smtp_sender.trim(),
        pass: smtp_password.trim()
      }
    });

    const todayStr = new Date().toISOString().slice(0, 10);
    const fileName = `Backup_Sistem_Sri_Barada_${todayStr}.json`;

    await transporter.sendMail({
      from: `"Sistem StokPintar — Sri Barada Indra Sakti" <${smtp_sender.trim()}>`,
      to: recipients.join(', '),
      subject: `[BACKUP DATABASE] Sri Barada Indra Sakti — ${todayStr}`,
      text: summary_text || 'Terlampir file backup penuh database Sistem Sri Barada Indra Sakti.',
      attachments: [
        {
          filename: fileName,
          content: JSON.stringify(backup_data || {}, null, 2),
          contentType: 'application/json'
        }
      ]
    });

    res.json({ success: true, recipients_count: recipients.length });
  } catch (err) {
    res.status(500).json({ error: `Gagal mengirim email SMTP: ${err.message}` });
  }
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Server Error:', err);
  res.status(err.statusCode || 500).json({ error: err.message || 'Terjadi kesalahan pada server.' });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`====================================================`);
    console.log(`Server Manajemen Stok Barang berjalan di:`);
    console.log(`http://localhost:${PORT}`);
    console.log(
      `Database: ${isSupabaseConfigured ? 'Supabase Cloud (Tanpa Penyimpanan Disk Lokal)' : 'PERINGATAN: SUPABASE_URL / KEY belum diisi di .env'}`
    );
    console.log(`====================================================`);
  });
}

module.exports = app;
