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
app.disable('x-powered-by');
app.set('trust proxy', 1);
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
const isValidSupabaseUrl = /^https:\/\/.+\.supabase\.co\/?$/i.test(SUPABASE_URL);
const isValidServiceKey =
  Boolean(SUPABASE_SERVICE_ROLE_KEY) && supabaseKeyRole !== 'anon' && supabaseKeyRole !== 'publishable';
const isSupabaseConfigured = Boolean(SUPABASE_URL && isValidSupabaseUrl && isValidServiceKey);

const supabase = isSupabaseConfigured
  ? createClient(SUPABASE_URL.replace(/\/+$/, ''), SUPABASE_SERVICE_ROLE_KEY, {
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

  if (!isValidSupabaseUrl) {
    const err = new Error(
      'Format SUPABASE_URL tidak valid. Harus berupa Project URL Supabase (contoh: https://xxxx.supabase.co), bukan URL dashboard atau postgres://.'
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
          },
          {
            username: 'barada',
            password_hash: bcrypt.hashSync('barada!@#', 10),
            full_name: 'Barada Superadmin',
            role: 'superadmin'
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
        // Pastikan akun superadmin 'barada' tersedia & memiliki role superadmin
        try {
          const { data: baradaUser } = await supabase
            .from('users')
            .select('id, role')
            .eq('username', 'barada')
            .maybeSingle();
          if (!baradaUser) {
            await supabase.from('users').insert({
              username: 'barada',
              password_hash: bcrypt.hashSync('barada!@#', 10),
              full_name: 'Barada Superadmin',
              role: 'superadmin'
            });
          } else if (baradaUser.role !== 'superadmin') {
            await supabase
              .from('users')
              .update({ role: 'superadmin' })
              .eq('id', baradaUser.id);
          }
        } catch (_) {}
      }

      const { error: itemErr } = await supabase.from('items').select('id').limit(1);
      if (itemErr) throw itemErr;

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

// Security Headers Middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  next();
});

// Rate Limiter ringan untuk proteksi brute-force Login & Register
const authRateMap = new Map();
function authRateLimiter(req, res, next) {
  const ip = req.ip || req.headers['x-forwarded-for'] || 'unknown';
  const now = Date.now();
  const windowMs = 15 * 60 * 1000; // 15 menit
  const maxAttempts = 20;
  const entry = authRateMap.get(ip) || { count: 0, resetAt: now + windowMs };
  if (now > entry.resetAt) {
    entry.count = 0;
    entry.resetAt = now + windowMs;
  }
  entry.count += 1;
  authRateMap.set(ip, entry);
  if (authRateMap.size > 2000) authRateMap.clear();

  if (entry.count > maxAttempts) {
    return res.status(429).json({
      error: 'Terlalu banyak percobaan login/daftar dari IP ini. Silakan coba lagi dalam 15 menit.'
    });
  }
  next();
}

const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
app.use(
  cors(
    allowedOrigins.length > 0
      ? {
          origin: (origin, cb) => {
            if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
            cb(new Error('Origin tidak diizinkan oleh kebijakan CORS.'));
          }
        }
      : undefined
  )
);
app.use(express.json({ limit: '2mb' }));
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

let lastLogCleanupAt = 0;
const LOG_RETENTION_MONTHS = 2;
const LOG_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // cek maksimal tiap 6 jam

async function cleanupOldActivityLogs(force = false) {
  if (!isSupabaseConfigured || !supabase) return;
  const now = Date.now();
  if (!force && now - lastLogCleanupAt < LOG_CLEANUP_INTERVAL_MS) return;
  lastLogCleanupAt = now;
  try {
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - LOG_RETENTION_MONTHS);
    await supabase.from('activity_logs').delete().lt('created_at', cutoff.toISOString());
  } catch (_) {
    // Abaikan jika tabel activity_logs belum dibuat
  }
}

async function writeActivityLog({ user, action_type, target, detail }) {
  if (!isSupabaseConfigured || !supabase || !user) return;
  try {
    await cleanupOldActivityLogs(false);
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
app.use('/api/auth/register', authRateLimiter);
const registerSaasRoutes = require('./saas');
const saas = registerSaasRoutes(app, {
  supabase,
  ensureSupabaseReady,
  asyncHandler,
  authenticateToken,
  bcrypt,
  jwt,
  JWT_SECRET,
  writeActivityLog
});

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
  authRateLimiter,
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

    const wsId = Number(user.workspace_id || 1);
    const isPlatAdmin = await saas.isPlatformAdminUser(user);
    const subCtx = await saas.getWorkspaceSubscriptionContext(wsId);

    const payload = {
      id: user.id,
      username: user.username,
      full_name: user.full_name,
      role: user.role,
      workspace_id: wsId,
      is_platform_admin: isPlatAdmin
    };
    const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '2h' });

    await writeActivityLog({
      user: payload,
      action_type: 'LOGIN',
      target: 'Autentikasi',
      detail: `Login berhasil sebagai ${payload.role}`
    });

    res.json({ token, user: payload, subscription: subCtx });
  })
);

app.get(
  '/api/auth/me',
  authenticateToken,
  asyncHandler(async (req, res) => {
    await ensureSupabaseReady();
    const { data: user, error } = await supabase
      .from('users')
      .select('id, username, full_name, role, workspace_id')
      .eq('id', req.user.id)
      .maybeSingle();
    if (error) throw error;
    if (!user) {
      return res.status(401).json({ error: 'Akun sudah tidak aktif. Silakan login kembali.' });
    }
    const wsId = Number(user.workspace_id || 1);
    const isPlatAdmin = await saas.isPlatformAdminUser(user);
    const subCtx = await saas.getWorkspaceSubscriptionContext(wsId);
    res.json({
      user: {
        ...user,
        workspace_id: wsId,
        is_platform_admin: isPlatAdmin
      },
      subscription: subCtx
    });
  })
);

// ==================== ENDPOINT MASTER BARANG ====================
function normalizeItemNotifMode(mode) {
  const m = String(mode || 'all').toLowerCase();
  if (m === 'zero_only' || m === 'none') return m;
  return 'all';
}

async function getItemNotifPrefs(wsId = 1) {
  const { data } = await supabase
    .from('activity_logs')
    .select('*')
    .eq('target', 'ITEM_NOTIF_PREFS')
    .order('id', { ascending: false })
    .limit(10);
  for (const row of data || []) {
    try {
      const parsed = JSON.parse(row.detail || '{}');
      if (!parsed.workspace_id || Number(parsed.workspace_id) === Number(wsId)) {
        return { rowId: row.id, prefs: parsed.prefs || {} };
      }
    } catch (_) {}
  }
  return { rowId: null, prefs: {} };
}

async function saveItemNotifPref(wsId, user, itemId, mode) {
  const cleanMode = normalizeItemNotifMode(mode);
  const { rowId, prefs } = await getItemNotifPrefs(wsId);
  const nextPrefs = { ...prefs, [String(itemId)]: cleanMode };
  const payloadStr = JSON.stringify({ workspace_id: Number(wsId || 1), prefs: nextPrefs });
  if (rowId) {
    await supabase.from('activity_logs').update({ detail: payloadStr }).eq('id', rowId);
  } else {
    await supabase.from('activity_logs').insert({
      user_id: user ? user.id : null,
      username: user ? user.username : 'system',
      full_name: user ? user.full_name : 'Sistem',
      role: user ? user.role : 'superadmin',
      action_type: 'EDIT',
      target: 'ITEM_NOTIF_PREFS',
      detail: payloadStr
    });
  }
  return cleanMode;
}

app.get(
  '/api/items',
  authenticateToken,
  asyncHandler(async (req, res) => {
    await ensureSupabaseReady();
    const wsId = Number(req.user.workspace_id || 1);
    const [{ data, error }, { prefs }] = await Promise.all([
      supabase.from('items').select('*').eq('workspace_id', wsId).order('name', { ascending: true }),
      getItemNotifPrefs(wsId).catch(() => ({ prefs: {} }))
    ]);
    if (error) throw error;
    const enriched = (data || []).map((it) => ({
      ...it,
      notif_mode: normalizeItemNotifMode(prefs[String(it.id)])
    }));
    res.json(enriched);
  })
);

app.post(
  '/api/items',
  authenticateToken,
  requireAdmin,
  saas.requireActiveSubscription,
  asyncHandler(async (req, res) => {
    await ensureSupabaseReady();
    const wsId = Number(req.user.workspace_id || 1);
    const { sku, name, category, unit, min_stock, price, initial_stock, notif_mode } = req.body;
    if (!sku || !name || !category) {
      return res.status(400).json({ error: 'SKU, Nama Barang, dan Kategori wajib diisi.' });
    }

    const initStock = Math.max(0, parseInt(initial_stock, 10) || 0);
    const minStockVal = Math.max(0, parseInt(min_stock, 10) || 0);
    const priceVal = Math.max(0, parseFloat(price) || 0);

    const { data, error } = await supabase
      .from('items')
      .insert({
        workspace_id: wsId,
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
    const savedMode = await saveItemNotifPref(wsId, req.user, data.id, notif_mode).catch(() => 'all');
    await writeActivityLog({
      user: req.user,
      action_type: 'EDIT',
      target: 'Master Barang',
      detail: `Tambah barang: [${data.sku}] ${data.name}`
    });
    res.status(201).json({ ...data, notif_mode: savedMode });
  })
);

app.put(
  '/api/items/:id',
  authenticateToken,
  requireAdmin,
  saas.requireActiveSubscription,
  asyncHandler(async (req, res) => {
    await ensureSupabaseReady();
    const wsId = Number(req.user.workspace_id || 1);
    const { id } = req.params;
    const { sku, name, category, unit, min_stock, price, notif_mode } = req.body;

    const { data: existing, error: findErr } = await supabase
      .from('items')
      .select('*')
      .eq('id', id)
      .eq('workspace_id', wsId)
      .maybeSingle();
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
    let savedMode = 'all';
    if (notif_mode !== undefined) {
      savedMode = await saveItemNotifPref(wsId, req.user, updated.id, notif_mode).catch(() => 'all');
    } else {
      const { prefs } = await getItemNotifPrefs(wsId).catch(() => ({ prefs: {} }));
      savedMode = normalizeItemNotifMode(prefs[String(updated.id)]);
    }
    await writeActivityLog({
      user: req.user,
      action_type: 'EDIT',
      target: 'Master Barang',
      detail: `Edit barang: [${updated.sku}] ${updated.name}`
    });
    res.json({ ...updated, notif_mode: savedMode });
  })
);

app.put(
  '/api/items/:id/notif-mode',
  authenticateToken,
  requireAdmin,
  asyncHandler(async (req, res) => {
    await ensureSupabaseReady();
    const wsId = Number(req.user.workspace_id || 1);
    const { id } = req.params;
    const { notif_mode } = req.body || {};
    const savedMode = await saveItemNotifPref(wsId, req.user, id, notif_mode);
    res.json({ success: true, id: Number(id), notif_mode: savedMode });
  })
);

app.delete(
  '/api/items/:id',
  authenticateToken,
  requireAdmin,
  saas.requireActiveSubscription,
  asyncHandler(async (req, res) => {
    await ensureSupabaseReady();
    const wsId = Number(req.user.workspace_id || 1);
    const { id } = req.params;
    if (needsDeleteApproval(req.user)) {
      const { data: existingItem } = await supabase
        .from('items')
        .select('id, sku, name')
        .eq('id', id)
        .eq('workspace_id', wsId)
        .maybeSingle();
      if (!existingItem) return res.status(404).json({ error: 'Barang tidak ditemukan.' });
      const queued = await queueDeleteRequest({
        user: req.user,
        entity: 'item',
        label: `Hapus Barang: [${existingItem.sku}] ${existingItem.name}`,
        payload: { id: Number(id) }
      });
      return res.status(202).json(queued);
    }
    const { error } = await supabase.from('items').delete().eq('id', id).eq('workspace_id', wsId);
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
  saas.requireActiveSubscription,
  asyncHandler(async (req, res) => {
    await ensureSupabaseReady();
    const wsId = Number(req.user.workspace_id || 1);
    const rawIds = Array.isArray(req.body.ids) ? req.body.ids : [];
    const validIds = Array.from(
      new Set(rawIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))
    );
    if (validIds.length === 0) {
      return res.status(400).json({ error: 'Pilih minimal 1 barang yang ingin dihapus.' });
    }
    if (needsDeleteApproval(req.user)) {
      const queued = await queueDeleteRequest({
        user: req.user,
        entity: 'items_bulk',
        label: `Hapus Massal ${validIds.length} Barang (ID: ${validIds.join(', ')})`,
        payload: { ids: validIds }
      });
      return res.status(202).json(queued);
    }
    const { error } = await supabase.from('items').delete().in('id', validIds).eq('workspace_id', wsId);
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
    const wsId = Number(req.user.workspace_id || 1);
    const { date, month, type, item_id } = req.query;

    let q = supabase
      .from('transactions')
      .select('*, items(sku, name, unit), users(full_name, role)')
      .eq('workspace_id', wsId)
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
      sell_price: Number(t.sell_price || 0),
      total_sell_price: Number(t.total_sell_price || 0),
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
  saas.requireActiveSubscription,
  asyncHandler(async (req, res) => {
    await ensureSupabaseReady();
    const wsId = Number(req.user.workspace_id || 1);
    const { item_id, type, quantity, reason, date, notes, sell_price } = req.body;
    const qty = parseInt(quantity, 10);

    if (!item_id || !['IN', 'OUT'].includes(type) || !qty || qty <= 0 || !reason || !date) {
      return res.status(400).json({ error: 'Data transaksi tidak lengkap atau jumlah tidak valid.' });
    }

    // Cegah simpan ganda akibat klik berulang dalam jeda <= 5 detik
    const fiveSecAgo = new Date(Date.now() - 5000).toISOString();
    const { data: recentDup } = await supabase
      .from('transactions')
      .select('*, items(sku, name, unit), users(full_name)')
      .eq('workspace_id', wsId)
      .eq('item_id', item_id)
      .eq('type', type)
      .eq('quantity', qty)
      .eq('reason', reason)
      .eq('date', date)
      .eq('notes', notes || '')
      .eq('user_id', req.user.id)
      .gte('created_at', fiveSecAgo)
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (recentDup) {
      return res.status(200).json({
        id: recentDup.id,
        item_id: recentDup.item_id,
        type: recentDup.type,
        quantity: recentDup.quantity,
        reason: recentDup.reason,
        date: recentDup.date,
        notes: recentDup.notes,
        sell_price: Number(recentDup.sell_price || 0),
        total_sell_price: Number(recentDup.total_sell_price || 0),
        user_id: recentDup.user_id,
        created_at: recentDup.created_at,
        sku: recentDup.items ? recentDup.items.sku : '',
        item_name: recentDup.items ? recentDup.items.name : '',
        unit: recentDup.items ? recentDup.items.unit : '',
        user_name: recentDup.users ? recentDup.users.full_name : req.user.full_name,
        deduplicated: true
      });
    }

    const isSoldReason = type === 'OUT' && String(reason).toLowerCase().includes('dijual');
    const sellPriceVal = isSoldReason ? Math.max(0, parseFloat(sell_price) || 0) : 0;
    const totalSellPriceVal = isSoldReason ? sellPriceVal * qty : 0;

    const { data: item, error: itemErr } = await supabase
      .from('items')
      .select('*')
      .eq('id', item_id)
      .eq('workspace_id', wsId)
      .maybeSingle();
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
        workspace_id: wsId,
        item_id,
        type,
        quantity: qty,
        reason,
        date,
        notes: notes || '',
        sell_price: sellPriceVal,
        total_sell_price: totalSellPriceVal,
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
      detail: `Transaksi ${type} (${reason}): ${item.name} x${qty} (${date})${
        isSoldReason && sellPriceVal > 0 ? ` — Harga Jual: Rp ${totalSellPriceVal.toLocaleString('id-ID')}` : ''
      }`
    });

    if (type === 'OUT') {
      triggerWhatsAppStockAlertIfNeeded(wsId, item, newStock, req.user).catch(() => {});
    }

    res.status(201).json({
      id: created.id,
      item_id: created.item_id,
      type: created.type,
      quantity: created.quantity,
      reason: created.reason,
      date: created.date,
      notes: created.notes,
      sell_price: Number(created.sell_price || 0),
      total_sell_price: Number(created.total_sell_price || 0),
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
  saas.requireActiveSubscription,
  asyncHandler(async (req, res) => {
    await ensureSupabaseReady();
    const wsId = Number(req.user.workspace_id || 1);
    const { id } = req.params;

    const { data: tx, error: txErr } = await supabase
      .from('transactions')
      .select('*')
      .eq('id', id)
      .eq('workspace_id', wsId)
      .maybeSingle();
    if (txErr) throw txErr;
    if (!tx) return res.status(404).json({ error: 'Transaksi tidak ditemukan.' });

    const { data: item, error: itemErr } = await supabase.from('items').select('*').eq('id', tx.item_id).maybeSingle();
    if (itemErr) throw itemErr;

    if (needsDeleteApproval(req.user)) {
      const queued = await queueDeleteRequest({
        user: req.user,
        entity: 'transaction',
        label: `Hapus Transaksi ${tx.type}: ${item ? item.name : `Item #${tx.item_id}`} x${tx.quantity} (${tx.date})`,
        payload: { id: Number(id) }
      });
      return res.status(202).json(queued);
    }

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
  saas.requireActiveSubscription,
  asyncHandler(async (req, res) => {
    await ensureSupabaseReady();
    const wsId = Number(req.user.workspace_id || 1);
    const rawIds = Array.isArray(req.body.ids) ? req.body.ids : [];
    const validIds = Array.from(
      new Set(rawIds.map((id) => Number(id)).filter((id) => Number.isInteger(id) && id > 0))
    );
    if (validIds.length === 0) {
      return res.status(400).json({ error: 'Pilih minimal 1 transaksi yang ingin dihapus.' });
    }

    if (needsDeleteApproval(req.user)) {
      const queued = await queueDeleteRequest({
        user: req.user,
        entity: 'transactions_bulk',
        label: `Hapus Massal ${validIds.length} Transaksi (ID: ${validIds.join(', ')})`,
        payload: { ids: validIds }
      });
      return res.status(202).json(queued);
    }

    const { data: txs, error: txErr } = await supabase
      .from('transactions')
      .select('*')
      .in('id', validIds)
      .eq('workspace_id', wsId);
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
    const wsId = Number(req.user.workspace_id || 1);
    const month = req.query.month || new Date().toISOString().slice(0, 7);
    const startOfMonth = `${month}-01`;

    const [itemsRes, txRes] = await Promise.all([
      supabase.from('items').select('*').eq('workspace_id', wsId).order('name', { ascending: true }),
      supabase
        .from('transactions')
        .select('*')
        .eq('workspace_id', wsId)
        .order('date', { ascending: true })
        .order('id', { ascending: true })
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
      let soldRevenue = 0;
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
          else if (r.includes('dijual') || r.includes('terjual')) {
            soldCount += t.quantity;
            soldRevenue += Number(t.total_sell_price || 0);
          }
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
        sold_revenue: soldRevenue,
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
        acc.total_sold_revenue += row.sold_revenue || 0;
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
        total_sold_revenue: 0,
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
    const wsId = Number(req.user.workspace_id || 1);
    const { data, error } = await supabase
      .from('users')
      .select('id, username, full_name, role, workspace_id, created_at')
      .eq('workspace_id', wsId)
      .order('id', { ascending: true });
    if (error) throw error;
    res.json(data || []);
  })
);

app.post(
  '/api/users',
  authenticateToken,
  requireSuperadmin,
  saas.requireActiveSubscription,
  asyncHandler(async (req, res) => {
    await ensureSupabaseReady();
    const wsId = Number(req.user.workspace_id || 1);
    const ctx = req.subscriptionCtx;
    if (ctx && ctx.usage && ctx.usage.users_used >= ctx.usage.max_users) {
      return res.status(403).json({
        error: `Kuota maksimal ${ctx.usage.max_users} pengguna pada paket Anda telah tercapai. Upgrade paket untuk menambah anggota.`,
        code: 'QUOTA_EXCEEDED'
      });
    }

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
        workspace_id: wsId,
        username: uname,
        password_hash: bcrypt.hashSync(password, 10),
        full_name: full_name.trim(),
        role: validRole
      })
      .select('id, username, full_name, role, workspace_id, created_at')
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
    const wsId = Number(req.user.workspace_id || 1);
    const { error } = await supabase
      .from('users')
      .update({ password_hash: newHash })
      .eq('id', id)
      .eq('workspace_id', wsId);
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
    const wsId = Number(req.user.workspace_id || 1);
    const { error } = await supabase.from('users').delete().eq('id', id).eq('workspace_id', wsId);
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
    await cleanupOldActivityLogs(true);
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
    folder_path: `Supabase Cloud • ${company}`,
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

    if (needsDeleteApproval(req.user)) {
      const queued = await queueDeleteRequest({
        user: req.user,
        entity: 'folder_log',
        label: `Hapus Log Pelanggan ${company}: ${logRow ? `${logRow.date} (${logRow.type} ${logRow.count})` : `ID ${req.params.id}`}`,
        payload: { company, id: Number(req.params.id) }
      });
      return res.status(202).json(queued);
    }

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
    if (needsDeleteApproval(req.user)) {
      const queued = await queueDeleteRequest({
        user: req.user,
        entity: 'folder_monthly_manual',
        label: `Hapus Data Bulanan Manual ${company}: ${req.params.month}`,
        payload: { company, month: req.params.month }
      });
      return res.status(202).json(queued);
    }
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
    if (needsDeleteApproval(req.user)) {
      const queued = await queueDeleteRequest({
        user: req.user,
        entity: 'folder_month',
        label: `Hapus Bulan ${m} dari ${company}`,
        payload: { company, month: m }
      });
      return res.status(202).json(queued);
    }

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
    if (needsDeleteApproval(req.user)) {
      const queued = await queueDeleteRequest({
        user: req.user,
        entity: 'folder_yearly_manual',
        label: `Hapus Pengaturan Tahun Manual ${req.params.year} (${company})`,
        payload: { company, year: req.params.year }
      });
      return res.status(202).json(queued);
    }
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
  await ensureSupabaseReady();
  const wsId = Number(req.user.workspace_id || 1);
  const { recipients, smtp_sender, smtp_password, backup_data, summary_text } = req.body || {};
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return res.status(400).json({ error: 'Daftar email penerima masih kosong.' });
  }
  const savedSched = (await getSavedBackupSchedule(wsId).catch(() => null)) || {};
  const finalSender = String(smtp_sender || savedSched.smtp_sender || '').trim();
  const finalPassword = String(smtp_password || savedSched.smtp_password || '').trim();

  if (!finalSender || !finalPassword) {
    return res.status(400).json({
      error: 'Silakan isi Email Pengirim & App Password Gmail pada tombol "⚙️ Pengaturan SMTP Server" terlebih dahulu.'
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
        user: finalSender,
        pass: finalPassword
      }
    });

    let payloadToSend = backup_data;
    if (!payloadToSend || !payloadToSend.inventory_db) {
      const fullData = await buildFullWorkspaceExport(wsId);
      payloadToSend = {
        system: 'StokPintar — SRI BARADA INDRA SAKTI (Produksi Resmi)',
        exported_at: new Date().toISOString(),
        exported_by: req.user.full_name || req.user.username,
        inventory_db: {
          items: fullData.items,
          transactions: fullData.transactions,
          users: fullData.users
        },
        folder_gmdp: fullData.folder_gmdp,
        folder_genap: fullData.folder_genap,
        activity_logs: fullData.activity_logs
      };
    }

    const wib = getNowWibParts();
    const fileName = `Backup_Sistem_Sri_Barada_${wib.dateStr}.json`;

    await transporter.sendMail({
      from: `"Sistem StokPintar — Sri Barada Indra Sakti" <${finalSender}>`,
      to: recipients.join(', '),
      subject: `[BACKUP DATABASE] Sri Barada Indra Sakti — ${wib.dateStr}`,
      text: summary_text || 'Terlampir file backup penuh database Sistem Sri Barada Indra Sakti.',
      attachments: [
        {
          filename: fileName,
          content: JSON.stringify(payloadToSend, null, 2),
          contentType: 'application/json'
        }
      ]
    });

    res.json({ success: true, recipients_count: recipients.length });
  } catch (err) {
    const msg = String(err && err.message ? err.message : '');
    if (msg.includes('535') || msg.toLowerCase().includes('invalid login') || err.code === 'EAUTH') {
      return res.status(400).json({
        error:
          'Login Gmail SMTP ditolak. Pastikan menggunakan App Password Gmail 16 digit (bukan password login Gmail biasa) dan Verifikasi 2 Langkah aktif.'
      });
    }
    res.status(500).json({ error: `Gagal mengirim email SMTP: ${msg}` });
  }
});

// ==================== JADWAL KIRIM BACKUP EMAIL OTOMATIS ====================
function getNowWibParts() {
  const now = new Date();
  const wibMs = now.getTime() + 7 * 60 * 60 * 1000;
  const w = new Date(wibMs);
  const dateStr = w.toISOString().slice(0, 10);
  const hh = String(w.getUTCHours()).padStart(2, '0');
  const mm = String(w.getUTCMinutes()).padStart(2, '0');
  const timeStr = `${hh}:${mm}`;
  const dayOfWeek = w.getUTCDay(); // 0=Minggu .. 6=Sabtu
  return { dateStr, timeStr, dayOfWeek, minutesOfDay: w.getUTCHours() * 60 + w.getUTCMinutes() };
}

async function getSavedBackupSchedule(wsId = 1) {
  const { data } = await supabase
    .from('activity_logs')
    .select('*')
    .eq('target', 'BACKUP_EMAIL_SCHEDULE')
    .order('id', { ascending: false })
    .limit(10);
  const rows = Array.isArray(data) ? data : [];
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.detail || '{}');
      if (!parsed.workspace_id || Number(parsed.workspace_id) === Number(wsId)) {
        return { rowId: row.id, ...parsed };
      }
    } catch (_) {}
  }
  return null;
}

async function saveBackupScheduleRow(wsId, user, scheduleObj) {
  const existing = await getSavedBackupSchedule(wsId);
  const payloadStr = JSON.stringify({ ...scheduleObj, workspace_id: Number(wsId || 1) });
  if (existing && existing.rowId) {
    const { error } = await supabase.from('activity_logs').update({ detail: payloadStr }).eq('id', existing.rowId);
    if (error) throw error;
    return scheduleObj;
  }
  const { error } = await supabase.from('activity_logs').insert({
    user_id: user ? user.id : null,
    username: user ? user.username : 'system',
    full_name: user ? user.full_name : 'Sistem Otomatis',
    role: user ? user.role : 'superadmin',
    action_type: 'EDIT',
    target: 'BACKUP_EMAIL_SCHEDULE',
    detail: payloadStr
  });
  if (error) throw error;
  return scheduleObj;
}

async function buildFullWorkspaceExport(wsId) {
  const [
    itemsRes,
    txRes,
    usersRes,
    logsRes,
    fSettingsRes,
    fLogsRes,
    fMonthlyManualRes,
    fDeletedMonthsRes,
    fYearlyManualRes,
    fDeletedYearsRes
  ] = await Promise.all([
    supabase.from('items').select('*').eq('workspace_id', wsId).order('id', { ascending: true }).limit(10000),
    supabase
      .from('transactions')
      .select('*, items(sku, name, unit), users(full_name)')
      .eq('workspace_id', wsId)
      .order('date', { ascending: false })
      .order('id', { ascending: false })
      .limit(10000),
    supabase
      .from('users')
      .select('id, workspace_id, username, password_hash, full_name, role, created_at')
      .eq('workspace_id', wsId)
      .order('id', { ascending: true }),
    supabase
      .from('activity_logs')
      .select('*')
      .order('id', { ascending: false })
      .limit(500),
    supabase.from('folder_settings').select('*'),
    supabase.from('folder_logs').select('*').order('date', { ascending: false }).order('id', { ascending: false }).limit(10000),
    supabase.from('folder_monthly_manual').select('*'),
    supabase.from('folder_deleted_months').select('*'),
    supabase.from('folder_yearly_manual').select('*'),
    supabase.from('folder_deleted_years').select('*')
  ]);

  if (itemsRes.error) throw itemsRes.error;
  if (txRes.error) throw txRes.error;
  if (usersRes.error) throw usersRes.error;
  if (logsRes.error) throw logsRes.error;
  if (fSettingsRes.error) throw fSettingsRes.error;
  if (fLogsRes.error) throw fLogsRes.error;
  if (fMonthlyManualRes.error) throw fMonthlyManualRes.error;
  if (fDeletedMonthsRes.error) throw fDeletedMonthsRes.error;
  if (fYearlyManualRes.error) throw fYearlyManualRes.error;
  if (fDeletedYearsRes.error) throw fDeletedYearsRes.error;

  const buildFolderBackup = (companyName) => {
    const sett = (fSettingsRes.data || []).find((s) => String(s.company || '').toUpperCase() === companyName);
    const monthlyManual = {};
    (fMonthlyManualRes.data || [])
      .filter((m) => String(m.company || '').toUpperCase() === companyName)
      .forEach((m) => {
        monthlyManual[m.month] = {
          manual_opening: m.manual_opening,
          manual_in: m.manual_in,
          manual_out: m.manual_out,
          notes: m.notes || ''
        };
      });
    const yearlyManual = {};
    (fYearlyManualRes.data || [])
      .filter((y) => String(y.company || '').toUpperCase() === companyName)
      .forEach((y) => {
        yearlyManual[y.year] = {
          manual_opening: y.manual_opening,
          manual_in: y.manual_in,
          manual_out: y.manual_out,
          notes: y.notes || ''
        };
      });
    return {
      company: companyName,
      base_customers: sett ? Number(sett.base_customers || 0) : 0,
      customer_logs: (fLogsRes.data || []).filter((l) => String(l.company || '').toUpperCase() === companyName),
      monthly_manual: monthlyManual,
      deleted_months: (fDeletedMonthsRes.data || [])
        .filter((d) => String(d.company || '').toUpperCase() === companyName)
        .map((d) => d.month),
      yearly_manual: yearlyManual,
      deleted_years: (fDeletedYearsRes.data || [])
        .filter((d) => String(d.company || '').toUpperCase() === companyName)
        .map((d) => d.year)
    };
  };

  const transactions = (txRes.data || []).map((t) => ({
    id: t.id,
    workspace_id: t.workspace_id,
    item_id: t.item_id,
    sku: t.items ? t.items.sku : '',
    item_name: t.items ? t.items.name : '',
    unit: t.items ? t.items.unit : '',
    type: t.type,
    quantity: t.quantity,
    reason: t.reason,
    date: t.date,
    notes: t.notes,
    sell_price: Number(t.sell_price || 0),
    total_sell_price: Number(t.total_sell_price || 0),
    user_id: t.user_id,
    user_name: t.users ? t.users.full_name : '',
    created_at: t.created_at
  }));

  return {
    items: itemsRes.data || [],
    transactions,
    users: usersRes.data || [],
    activity_logs: logsRes.data || [],
    folder_gmdp: buildFolderBackup('GMDP'),
    folder_genap: buildFolderBackup('GENAP')
  };
}

app.get(
  '/api/backup/schedule',
  authenticateToken,
  requireSuperadmin,
  asyncHandler(async (req, res) => {
    await ensureSupabaseReady();
    const wsId = Number(req.user.workspace_id || 1);
    const saved = await getSavedBackupSchedule(wsId);
    res.json({
      enabled: Boolean(saved && saved.enabled),
      frequency: (saved && saved.frequency) || 'daily',
      day_of_week: saved && saved.day_of_week !== undefined ? Number(saved.day_of_week) : 1,
      time_wib: (saved && saved.time_wib) || '23:00',
      smtp_sender: (saved && saved.smtp_sender) || '',
      has_smtp_password: Boolean(saved && saved.smtp_password),
      recipients: Array.isArray(saved && saved.recipients) ? saved.recipients : [],
      last_sent_date: (saved && saved.last_sent_date) || null,
      last_sent_at: (saved && saved.last_sent_at) || null
    });
  })
);

app.post(
  '/api/backup/schedule',
  authenticateToken,
  requireSuperadmin,
  asyncHandler(async (req, res) => {
    await ensureSupabaseReady();
    const wsId = Number(req.user.workspace_id || 1);
    const prev = (await getSavedBackupSchedule(wsId)) || {};
    const { enabled, frequency, day_of_week, time_wib, smtp_sender, smtp_password, recipients } = req.body || {};

    const cleanTime = /^\d{2}:\d{2}$/.test(String(time_wib || '')) ? String(time_wib) : '23:00';
    const cleanFreq = frequency === 'weekly' ? 'weekly' : 'daily';
    const cleanDay = Math.min(6, Math.max(0, parseInt(day_of_week, 10) || 0));
    const cleanRecipients = Array.isArray(recipients)
      ? recipients.map((e) => String(e || '').trim().toLowerCase()).filter((e) => e.includes('@'))
      : prev.recipients || [];
    const sender = String(smtp_sender || prev.smtp_sender || '').trim();
    const pass = String(smtp_password || prev.smtp_password || '').trim();

    if (enabled && (!sender || !pass || cleanRecipients.length === 0)) {
      return res.status(400).json({
        error: 'Untuk mengaktifkan jadwal otomatis, isi Email Pengirim, App Password SMTP, dan centang minimal 1 email penerima.'
      });
    }

    const updated = {
      enabled: Boolean(enabled),
      frequency: cleanFreq,
      day_of_week: cleanDay,
      time_wib: cleanTime,
      smtp_sender: sender,
      smtp_password: pass,
      recipients: cleanRecipients,
      last_sent_date: prev.last_sent_date || null,
      last_sent_at: prev.last_sent_at || null
    };

    await saveBackupScheduleRow(wsId, req.user, updated);
    await writeActivityLog({
      user: req.user,
      action_type: 'EDIT',
      target: 'Jadwal Backup Email',
      detail: updated.enabled
        ? `Aktifkan backup email otomatis (${updated.frequency} pukul ${updated.time_wib} WIB ke ${cleanRecipients.length} email)`
        : 'Nonaktifkan jadwal backup email otomatis'
    });

    res.json({
      success: true,
      enabled: updated.enabled,
      frequency: updated.frequency,
      day_of_week: updated.day_of_week,
      time_wib: updated.time_wib,
      recipients: updated.recipients,
      last_sent_date: updated.last_sent_date,
      last_sent_at: updated.last_sent_at
    });
  })
);

async function runScheduledBackupJob(wsId, force = false) {
  const sched = await getSavedBackupSchedule(wsId);
  if (!sched || (!sched.enabled && !force)) {
    return { skipped: true, reason: 'Jadwal backup email belum diaktifkan.' };
  }
  if (!sched.smtp_sender || !sched.smtp_password || !Array.isArray(sched.recipients) || sched.recipients.length === 0) {
    return { skipped: true, reason: 'Konfigurasi SMTP atau daftar penerima belum lengkap.' };
  }

  const wib = getNowWibParts();
  if (!force) {
    if (sched.last_sent_date === wib.dateStr) {
      return { skipped: true, reason: `Backup hari ini (${wib.dateStr}) sudah terkirim.` };
    }
    if (sched.frequency === 'weekly' && Number(sched.day_of_week) !== wib.dayOfWeek) {
      return { skipped: true, reason: 'Bukan hari jadwal mingguan.' };
    }
    const [sh, sm] = String(sched.time_wib || '23:00').split(':').map((n) => parseInt(n, 10) || 0);
    if (wib.minutesOfDay < sh * 60 + sm) {
      return { skipped: true, reason: `Belum memasuki waktu jadwal (${sched.time_wib} WIB).` };
    }
  }

  const nodemailer = require('nodemailer');
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: sched.smtp_sender.trim(), pass: sched.smtp_password.trim() }
  });

  const fullData = await buildFullWorkspaceExport(wsId);
  const backupPayload = {
    system: 'StokPintar — SRI BARADA INDRA SAKTI (Produksi Resmi)',
    exported_at: new Date().toISOString(),
    exported_by: force ? 'Uji Kirim Jadwal Backup' : 'Jadwal Otomatis Server',
    inventory_db: {
      items: fullData.items,
      transactions: fullData.transactions,
      users: fullData.users
    },
    folder_gmdp: fullData.folder_gmdp,
    folder_genap: fullData.folder_genap,
    activity_logs: fullData.activity_logs
  };

  const fileName = `Backup_Sistem_Sri_Barada_${wib.dateStr}.json`;
  const summaryText = [
    `BACKUP DATABASE OTOMATIS — SRI BARADA INDRA SAKTI`,
    `Tanggal (WIB): ${wib.dateStr} ${wib.timeStr} WIB`,
    `Total Jenis Barang: ${fullData.items.length}`,
    `Total Transaksi Stok: ${fullData.transactions.length}`,
    `Data Pelanggan GMDP: ${fullData.folder_gmdp.customer_logs.length} log (Awal: ${fullData.folder_gmdp.base_customers})`,
    `Data Pelanggan GENAP: ${fullData.folder_genap.customer_logs.length} log (Awal: ${fullData.folder_genap.base_customers})`,
    `Total Akun Pengguna (+ Password Hash): ${fullData.users.length} akun`,
    ``,
    `File backup lengkap terlampir: ${fileName}`
  ].join('\n');

  await transporter.sendMail({
    from: `"Sistem StokPintar — Sri Barada Indra Sakti" <${sched.smtp_sender.trim()}>`,
    to: sched.recipients.join(', '),
    subject: `[BACKUP OTOMATIS] Sri Barada Indra Sakti — ${wib.dateStr}`,
    text: summaryText,
    attachments: [
      {
        filename: fileName,
        content: JSON.stringify(backupPayload, null, 2),
        contentType: 'application/json'
      }
    ]
  });

  sched.last_sent_date = wib.dateStr;
  sched.last_sent_at = new Date().toISOString();
  await saveBackupScheduleRow(wsId, null, sched);

  return { success: true, sent_to: sched.recipients.length, date_wib: wib.dateStr };
}

app.post(
  '/api/backup/run-scheduled',
  authenticateToken,
  requireSuperadmin,
  asyncHandler(async (req, res) => {
    await ensureSupabaseReady();
    const wsId = Number(req.user.workspace_id || 1);
    const force = Boolean(req.body && req.body.force);
    try {
      const result = await runScheduledBackupJob(wsId, force);
      if (result.skipped && force) {
        return res.status(400).json({ error: result.reason });
      }
      res.json(result);
    } catch (err) {
      const msg = String(err && err.message ? err.message : '');
      if (msg.includes('535') || msg.toLowerCase().includes('invalid login') || err.code === 'EAUTH') {
        return res.status(400).json({
          error:
            'Login Gmail SMTP ditolak. Pastikan menggunakan App Password Gmail 16 digit (bukan password login Gmail biasa) dan Verifikasi 2 Langkah aktif.'
        });
      }
      throw err;
    }
  })
);

app.get(
  '/api/cron/backup',
  asyncHandler(async (req, res) => {
    const cronSecret = process.env.CRON_SECRET || '';
    const isVercelCron = req.headers['x-vercel-cron'] === '1';
    const authHeader = String(req.headers.authorization || '');
    if (cronSecret && !isVercelCron && authHeader !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'Unauthorized cron call.' });
    }

    await ensureSupabaseReady();
    const result = await runScheduledBackupJob(1, Boolean(req.query.force));
    res.json(result);
  })
);

// ==================== NOTIFIKASI STOK HABIS KE WHATSAPP ====================
function normalizeWaNumbersList(rawInput) {
  const arr = Array.isArray(rawInput) ? rawInput : String(rawInput || '').split(/[,;\n]+/);
  return Array.from(
    new Set(
      arr
        .map((n) => String(n || '').replace(/[^0-9]/g, ''))
        .map((n) => (n.startsWith('0') ? `62${n.slice(1)}` : n))
        .filter((n) => n.length >= 9)
    )
  );
}

async function getWhatsAppSettings(wsId = 1) {
  const { data } = await supabase
    .from('activity_logs')
    .select('*')
    .eq('target', 'WA_LOW_STOCK_SETTINGS')
    .order('id', { ascending: false })
    .limit(10);
  for (const row of data || []) {
    try {
      const parsed = JSON.parse(row.detail || '{}');
      if (!parsed.workspace_id || Number(parsed.workspace_id) === Number(wsId)) {
        return { rowId: row.id, ...parsed };
      }
    } catch (_) {}
  }
  return null;
}

async function saveWhatsAppSettingsRow(wsId, user, obj) {
  const existing = await getWhatsAppSettings(wsId);
  const payloadStr = JSON.stringify({ ...obj, workspace_id: Number(wsId || 1) });
  if (existing && existing.rowId) {
    const { error } = await supabase.from('activity_logs').update({ detail: payloadStr }).eq('id', existing.rowId);
    if (error) throw error;
    return obj;
  }
  const { error } = await supabase.from('activity_logs').insert({
    user_id: user ? user.id : null,
    username: user ? user.username : 'system',
    full_name: user ? user.full_name : 'Sistem Otomatis',
    role: user ? user.role : 'superadmin',
    action_type: 'EDIT',
    target: 'WA_LOW_STOCK_SETTINGS',
    detail: payloadStr
  });
  if (error) throw error;
  return obj;
}

async function sendWhatsAppMessage(settings, messageText) {
  const numbers = normalizeWaNumbersList(settings.wa_numbers || []);
  const tokenOrUrl = String(settings.wa_api_token || '').trim();
  const provider = settings.wa_provider === 'webhook' ? 'webhook' : 'fonnte';

  if (numbers.length === 0) throw new Error('Nomor WhatsApp tujuan belum diisi.');
  if (!tokenOrUrl) throw new Error('Token API Fonnte / URL Webhook WhatsApp belum diisi.');

  if (provider === 'webhook') {
    const resp = await fetch(tokenOrUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ targets: numbers, target: numbers.join(','), message: messageText })
    });
    if (!resp.ok) {
      throw new Error(`Webhook WhatsApp merespons HTTP ${resp.status}`);
    }
    return { sent_to: numbers.length };
  }

  // Default: Fonnte API (https://api.fonnte.com/send)
  const form = new URLSearchParams();
  form.set('target', numbers.join(','));
  form.set('message', messageText);
  const resp = await fetch('https://api.fonnte.com/send', {
    method: 'POST',
    headers: { Authorization: tokenOrUrl },
    body: form
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || data.status === false) {
    throw new Error(data.reason || data.detail || `Gagal mengirim via Fonnte (HTTP ${resp.status})`);
  }
  return { sent_to: numbers.length };
}

async function triggerWhatsAppStockAlertIfNeeded(wsId, item, newStock, actorUser) {
  const settings = await getWhatsAppSettings(wsId);
  if (!settings || !settings.enabled) return;
  const { prefs } = await getItemNotifPrefs(wsId).catch(() => ({ prefs: {} }));
  const itemMode = normalizeItemNotifMode(prefs[String(item.id)]);
  if (itemMode === 'none') return;
  const zeroOnly = itemMode === 'zero_only' || settings.notify_on_zero_only !== false;
  const isZero = Number(newStock) <= 0;
  const isLow = Number(newStock) <= Number(item.min_stock || 0);
  if (zeroOnly ? !isZero : !isLow) return;

  const wib = getNowWibParts();
  const header = isZero ? '🚨 *PERINGATAN STOK HABIS (0)*' : '⚠️ *PERINGATAN STOK MENIPIS*';
  const msg = [
    header,
    `Sistem StokPintar — Sri Barada Indra Sakti`,
    `Waktu: ${wib.dateStr} ${wib.timeStr} WIB`,
    ``,
    `• Barang : *${item.name}*`,
    `• SKU    : ${item.sku}`,
    `• Kategori: ${item.category || '-'}`,
    `• Sisa Stok: *${newStock} ${item.unit || 'Unit'}* (Min: ${item.min_stock})`,
    `• Petugas: ${actorUser ? actorUser.full_name || actorUser.username : '-'}`,
    ``,
    `Mohon segera lakukan restok barang tersebut.`
  ].join('\n');

  await sendWhatsAppMessage(settings, msg);
}

app.get(
  '/api/notifications/whatsapp',
  authenticateToken,
  requireSuperadmin,
  asyncHandler(async (req, res) => {
    await ensureSupabaseReady();
    const wsId = Number(req.user.workspace_id || 1);
    const saved = (await getWhatsAppSettings(wsId)) || {};
    res.json({
      enabled: Boolean(saved.enabled),
      notify_on_zero_only: saved.notify_on_zero_only !== false,
      wa_provider: saved.wa_provider || 'fonnte',
      wa_numbers: Array.isArray(saved.wa_numbers) ? saved.wa_numbers.join(', ') : saved.wa_numbers || '',
      has_token: Boolean(saved.wa_api_token)
    });
  })
);

app.post(
  '/api/notifications/whatsapp',
  authenticateToken,
  requireSuperadmin,
  asyncHandler(async (req, res) => {
    await ensureSupabaseReady();
    const wsId = Number(req.user.workspace_id || 1);
    const prev = (await getWhatsAppSettings(wsId)) || {};
    const { enabled, notify_on_zero_only, wa_provider, wa_numbers, wa_api_token } = req.body || {};

    const numbers = normalizeWaNumbersList(wa_numbers);
    const token = String(wa_api_token || prev.wa_api_token || '').trim();
    if (enabled && (numbers.length === 0 || !token)) {
      return res.status(400).json({
        error: 'Untuk mengaktifkan notifikasi otomatis WA, isi Nomor WhatsApp tujuan dan Token API Fonnte / URL Webhook.'
      });
    }

    const updated = {
      enabled: Boolean(enabled),
      notify_on_zero_only: notify_on_zero_only !== false,
      wa_provider: wa_provider === 'webhook' ? 'webhook' : 'fonnte',
      wa_numbers: numbers,
      wa_api_token: token
    };
    await saveWhatsAppSettingsRow(wsId, req.user, updated);
    await writeActivityLog({
      user: req.user,
      action_type: 'EDIT',
      target: 'Notifikasi WhatsApp',
      detail: updated.enabled
        ? `Aktifkan notifikasi WA stok habis ke ${numbers.length} nomor`
        : 'Nonaktifkan notifikasi WA otomatis'
    });
    res.json({ success: true, enabled: updated.enabled, numbers_count: numbers.length });
  })
);

app.post(
  '/api/notifications/whatsapp/test',
  authenticateToken,
  requireSuperadmin,
  asyncHandler(async (req, res) => {
    await ensureSupabaseReady();
    const wsId = Number(req.user.workspace_id || 1);
    const saved = (await getWhatsAppSettings(wsId)) || {};
    const { wa_provider, wa_numbers, wa_api_token } = req.body || {};
    const effectiveSettings = {
      wa_provider: wa_provider || saved.wa_provider || 'fonnte',
      wa_numbers: wa_numbers ? normalizeWaNumbersList(wa_numbers) : saved.wa_numbers || [],
      wa_api_token: String(wa_api_token || saved.wa_api_token || '').trim()
    };

    const { data: items } = await supabase.from('items').select('*').eq('workspace_id', wsId).order('current_stock', { ascending: true });
    const zeroItems = (items || []).filter((i) => Number(i.current_stock || 0) <= 0);
    const lowItems = (items || []).filter((i) => Number(i.current_stock || 0) > 0 && Number(i.current_stock || 0) <= Number(i.min_stock || 0));
    const wib = getNowWibParts();

    const lines = [
      `📲 *LAPORAN STOK HABIS & MENIPIS — SRI BARADA INDRA SAKTI*`,
      `Waktu: ${wib.dateStr} ${wib.timeStr} WIB`,
      ``,
      `🚨 *Stok Habis (0): ${zeroItems.length} Barang*`,
      ...(zeroItems.length > 0
        ? zeroItems.slice(0, 20).map((i) => `- [${i.sku}] ${i.name}: 0 ${i.unit}`)
        : ['- Tidak ada barang stok 0']),
      ``,
      `⚠️ *Stok Menipis: ${lowItems.length} Barang*`,
      ...(lowItems.length > 0
        ? lowItems.slice(0, 15).map((i) => `- [${i.sku}] ${i.name}: ${i.current_stock}/${i.min_stock} ${i.unit}`)
        : ['- Tidak ada barang menipis'])
    ];

    const result = await sendWhatsAppMessage(effectiveSettings, lines.join('\n'));
    res.json({ success: true, sent_to: result.sent_to });
  })
);

// ==================== HUBUNGKAN PERANGKAT WHATSAPP VIA BARCODE QR ====================
async function checkWaDeviceStatus(provider, tokenOrUrl) {
  const clean = String(tokenOrUrl || '').trim();
  if (!clean) throw new Error('Token API Fonnte atau URL Gateway WhatsApp belum diisi.');

  if (provider === 'webhook') {
    const base = clean.replace(/\/+$/, '');
    const resp = await fetch(`${base}/status`);
    const data = await resp.json().catch(() => ({}));
    return {
      connected: Boolean(data.connected || data.status === 'connect' || data.device_status === 'connect'),
      device: data.device || data.phone || '',
      name: data.name || ''
    };
  }

  const resp = await fetch('https://api.fonnte.com/device', {
    method: 'POST',
    headers: { Authorization: clean }
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok || data.status === false) {
    throw new Error(data.reason || data.detail || `Gagal memeriksa perangkat Fonnte (HTTP ${resp.status})`);
  }
  return {
    connected: String(data.device_status || '').toLowerCase() === 'connect',
    device: data.device || '',
    name: data.name || ''
  };
}

app.post(
  '/api/notifications/whatsapp/qr',
  authenticateToken,
  requireSuperadmin,
  asyncHandler(async (req, res) => {
    await ensureSupabaseReady();
    const wsId = Number(req.user.workspace_id || 1);
    const saved = (await getWhatsAppSettings(wsId)) || {};
    const provider = (req.body && req.body.wa_provider) || saved.wa_provider || 'fonnte';
    const tokenOrUrl = String((req.body && req.body.wa_api_token) || saved.wa_api_token || '').trim();
    if (!tokenOrUrl) {
      return res.status(400).json({ error: 'Isi Token Device Fonnte atau URL Gateway WhatsApp terlebih dahulu.' });
    }

    if (provider === 'webhook') {
      const base = tokenOrUrl.replace(/\/+$/, '');
      const resp = await fetch(`${base}/qr`);
      const contentType = String(resp.headers.get('content-type') || '');
      if (contentType.startsWith('image/')) {
        const buf = Buffer.from(await resp.arrayBuffer());
        return res.json({ connected: false, qr_src: `data:${contentType};base64,${buf.toString('base64')}` });
      }
      const data = await resp.json().catch(() => ({}));
      if (data.connected) {
        return res.json({ connected: true, device: data.device || '', name: data.name || '' });
      }
      const qrRaw = data.qr_base64 || data.url || data.qr || '';
      if (!qrRaw) {
        return res.status(400).json({ error: data.error || 'Gateway tidak mengembalikan QR barcode.' });
      }
      const qrSrc = qrRaw.startsWith('data:') || qrRaw.startsWith('http') ? qrRaw : `data:image/png;base64,${qrRaw}`;
      return res.json({ connected: false, qr_src: qrSrc });
    }

    const devStatus = await checkWaDeviceStatus('fonnte', tokenOrUrl).catch(() => ({ connected: false }));
    if (devStatus.connected) {
      return res.json({ connected: true, device: devStatus.device, name: devStatus.name });
    }

    const qrResp = await fetch('https://api.fonnte.com/qr', {
      method: 'POST',
      headers: { Authorization: tokenOrUrl }
    });
    const qrData = await qrResp.json().catch(() => ({}));
    if (!qrResp.ok || qrData.status === false) {
      return res.status(400).json({
        error: qrData.reason || qrData.detail || 'Gagal meminta QR Barcode dari Fonnte.'
      });
    }
    const qrRaw = qrData.url || qrData.qr || '';
    if (!qrRaw) {
      return res.status(400).json({ error: 'QR Barcode belum tersedia. Coba ulangi beberapa detik lagi.' });
    }
    const qrSrc = qrRaw.startsWith('data:') || qrRaw.startsWith('http') ? qrRaw : `data:image/png;base64,${qrRaw}`;
    res.json({ connected: false, qr_src: qrSrc });
  })
);

app.post(
  '/api/notifications/whatsapp/status',
  authenticateToken,
  requireSuperadmin,
  asyncHandler(async (req, res) => {
    await ensureSupabaseReady();
    const wsId = Number(req.user.workspace_id || 1);
    const saved = (await getWhatsAppSettings(wsId)) || {};
    const provider = (req.body && req.body.wa_provider) || saved.wa_provider || 'fonnte';
    const tokenOrUrl = String((req.body && req.body.wa_api_token) || saved.wa_api_token || '').trim();
    const status = await checkWaDeviceStatus(provider, tokenOrUrl);
    res.json(status);
  })
);

app.post(
  '/api/notifications/whatsapp/disconnect',
  authenticateToken,
  requireSuperadmin,
  asyncHandler(async (req, res) => {
    await ensureSupabaseReady();
    const wsId = Number(req.user.workspace_id || 1);
    const saved = (await getWhatsAppSettings(wsId)) || {};
    const provider = (req.body && req.body.wa_provider) || saved.wa_provider || 'fonnte';
    const tokenOrUrl = String((req.body && req.body.wa_api_token) || saved.wa_api_token || '').trim();
    if (!tokenOrUrl) {
      return res.status(400).json({ error: 'Token API / URL Gateway belum diisi.' });
    }
    if (provider === 'webhook') {
      const base = tokenOrUrl.replace(/\/+$/, '');
      await fetch(`${base}/disconnect`, { method: 'POST' });
    } else {
      await fetch('https://api.fonnte.com/disconnect', {
        method: 'POST',
        headers: { Authorization: tokenOrUrl }
      });
    }
    res.json({ success: true, connected: false });
  })
);

// ==================== ENDPOINT IMPORT GABUNG DATABASE (.JSON) TANPA HAPUS DATA EXISTING ====================
app.post(
  '/api/database/import-merge',
  authenticateToken,
  requireSuperadmin,
  saas.requireActiveSubscription,
  asyncHandler(async (req, res) => {
    await ensureSupabaseReady();
    const wsId = Number(req.user.workspace_id || 1);
    const body = req.body || {};
    const inv = body.inventory_db && typeof body.inventory_db === 'object' ? body.inventory_db : body;
    const rawItems = Array.isArray(inv.items) ? inv.items : [];
    const rawTransactions = Array.isArray(inv.transactions) ? inv.transactions : [];

    if (rawItems.length === 0 && rawTransactions.length === 0) {
      return res.status(400).json({ error: 'File JSON tidak memiliki data barang maupun transaksi.' });
    }

    const { data: existingItems, error: itemsErr } = await supabase
      .from('items')
      .select('*')
      .eq('workspace_id', wsId);
    if (itemsErr) throw itemsErr;

    const skuMap = new Map();
    const preExistingIds = new Set();
    (existingItems || []).forEach((it) => {
      const k = String(it.sku || '').trim().toUpperCase();
      if (k) skuMap.set(k, { ...it });
      preExistingIds.add(it.id);
    });

    const oldIdToItem = new Map();
    let addedItems = 0;
    let skippedItems = 0;

    for (const it of rawItems) {
      const sku = String(it && it.sku ? it.sku : '').trim().toUpperCase();
      const name = String(it && it.name ? it.name : '').trim();
      if (!sku || !name) {
        skippedItems++;
        continue;
      }

      if (skuMap.has(sku)) {
        const existingItem = skuMap.get(sku);
        if (it.id != null) oldIdToItem.set(String(it.id), existingItem);
        skippedItems++;
        continue;
      }

      const initStock = Math.max(0, parseInt(it.initial_stock, 10) || 0);
      const currStock =
        it.current_stock !== undefined && it.current_stock !== null
          ? Math.max(0, parseInt(it.current_stock, 10) || 0)
          : initStock;
      const minStockVal = Math.max(0, parseInt(it.min_stock, 10) || 0);
      const priceVal = Math.max(0, parseFloat(it.price) || 0);

      const { data: inserted, error: insItemErr } = await supabase
        .from('items')
        .insert({
          workspace_id: wsId,
          sku,
          name,
          category: String(it.category || 'Lainnya').trim(),
          unit: String(it.unit || 'Pcs').trim(),
          min_stock: minStockVal,
          price: priceVal,
          initial_stock: initStock,
          current_stock: currStock
        })
        .select()
        .single();

      if (insItemErr || !inserted) {
        skippedItems++;
        continue;
      }

      skuMap.set(sku, inserted);
      if (it.id != null) oldIdToItem.set(String(it.id), inserted);
      addedItems++;
    }

    const { data: existingTx, error: txErr } = await supabase
      .from('transactions')
      .select('item_id, type, quantity, reason, date, notes')
      .eq('workspace_id', wsId);
    if (txErr) throw txErr;

    const existingTxKeys = new Set(
      (existingTx || []).map(
        (t) =>
          `${t.date || ''}|${t.item_id}|${t.type || ''}|${Number(t.quantity || 0)}|${String(t.reason || '').trim()}|${String(t.notes || '').trim()}`
      )
    );

    let addedTransactions = 0;
    let skippedTransactions = 0;

    for (const tx of rawTransactions) {
      if (!tx) {
        skippedTransactions++;
        continue;
      }
      const txSku = String(tx.sku || '').trim().toUpperCase();
      let targetItem = txSku ? skuMap.get(txSku) : null;
      if (!targetItem && tx.item_id != null) {
        targetItem = oldIdToItem.get(String(tx.item_id)) || null;
      }
      if (!targetItem) {
        skippedTransactions++;
        continue;
      }

      const type = String(tx.type || '').toUpperCase();
      const qty = parseInt(tx.quantity, 10);
      const dateStr = String(tx.date || '').slice(0, 10);
      const reason = String(tx.reason || '').trim();
      const notes = String(tx.notes || '').trim();

      if (!['IN', 'OUT'].includes(type) || !Number.isFinite(qty) || qty <= 0 || !dateStr || !reason) {
        skippedTransactions++;
        continue;
      }

      const sig = `${dateStr}|${targetItem.id}|${type}|${qty}|${reason}|${notes}`;
      if (existingTxKeys.has(sig)) {
        skippedTransactions++;
        continue;
      }

      const sellPriceVal = Math.max(0, parseFloat(tx.sell_price) || 0);
      const totalSellVal =
        tx.total_sell_price !== undefined && tx.total_sell_price !== null
          ? Math.max(0, parseFloat(tx.total_sell_price) || 0)
          : sellPriceVal * qty;

      const { error: insTxErr } = await supabase.from('transactions').insert({
        workspace_id: wsId,
        item_id: targetItem.id,
        type,
        quantity: qty,
        reason,
        date: dateStr,
        notes,
        sell_price: sellPriceVal,
        total_sell_price: totalSellVal,
        user_id: req.user.id
      });

      if (insTxErr) {
        skippedTransactions++;
        continue;
      }

      existingTxKeys.add(sig);
      addedTransactions++;

      if (preExistingIds.has(targetItem.id)) {
        const nextStock = type === 'IN' ? targetItem.current_stock + qty : Math.max(0, targetItem.current_stock - qty);
        const { error: updErr } = await supabase
          .from('items')
          .update({ current_stock: nextStock })
          .eq('id', targetItem.id)
          .eq('workspace_id', wsId);
        if (!updErr) {
          targetItem.current_stock = nextStock;
        }
      }
    }

    let addedCustomerLogs = 0;
    const mergeFolderToSupabase = async (companyName, folderObj) => {
      if (!folderObj || typeof folderObj !== 'object') return;
      const comp = normalizeCompany(companyName);
      if (Number(folderObj.base_customers || 0) > 0) {
        const { data: currSett } = await supabase
          .from('folder_settings')
          .select('base_customers')
          .eq('company', comp)
          .maybeSingle();
        if (!currSett || Number(currSett.base_customers || 0) === 0) {
          await supabase
            .from('folder_settings')
            .upsert({ company: comp, base_customers: Math.max(0, parseInt(folderObj.base_customers, 10) || 0) }, { onConflict: 'company' });
        }
      }

      const incomingLogs = Array.isArray(folderObj.customer_logs) ? folderObj.customer_logs : [];
      if (incomingLogs.length > 0) {
        const { data: existingLogs } = await supabase.from('folder_logs').select('date, type, count, category, customer_info').eq('company', comp);
        const logKeys = new Set(
          (existingLogs || []).map(
            (l) => `${l.date || ''}|${l.type || ''}|${Number(l.count || 0)}|${String(l.category || '').trim()}|${String(l.customer_info || '').trim()}`
          )
        );
        const toInsert = [];
        incomingLogs.forEach((l) => {
          if (!l || !l.date || !['IN', 'OUT'].includes(String(l.type || '').toUpperCase())) return;
          const t = String(l.type).toUpperCase();
          const c = Math.max(1, parseInt(l.count, 10) || 1);
          const cat = String(l.category || 'Lainnya').trim();
          const info = String(l.customer_info || l.customer_name || l.notes || '').trim();
          const key = `${String(l.date).slice(0, 10)}|${t}|${c}|${cat}|${info}`;
          if (!logKeys.has(key)) {
            logKeys.add(key);
            toInsert.push({
              company: comp,
              type: t,
              count: c,
              category: cat,
              customer_info: info,
              date: String(l.date).slice(0, 10),
              user_name: String(l.user_name || req.user.full_name || 'Petugas')
            });
          }
        });
        if (toInsert.length > 0) {
          const { error: fInsErr } = await supabase.from('folder_logs').insert(toInsert);
          if (!fInsErr) addedCustomerLogs += toInsert.length;
        }
      }

      if (folderObj.monthly_manual && typeof folderObj.monthly_manual === 'object') {
        const { data: existingMM } = await supabase.from('folder_monthly_manual').select('month').eq('company', comp);
        const existingMonths = new Set((existingMM || []).map((m) => m.month));
        const mmRows = Object.keys(folderObj.monthly_manual)
          .filter((mKey) => !existingMonths.has(mKey))
          .map((mKey) => {
            const v = folderObj.monthly_manual[mKey] || {};
            return {
              company: comp,
              month: mKey,
              manual_opening: v.manual_opening ?? null,
              manual_in: Number(v.manual_in || 0),
              manual_out: Number(v.manual_out || 0),
              notes: String(v.notes || '')
            };
          });
        if (mmRows.length > 0) {
          await supabase.from('folder_monthly_manual').insert(mmRows);
        }
      }
    };

    if (body.folder_gmdp) await mergeFolderToSupabase('GMDP', body.folder_gmdp);
    if (body.folder_genap) await mergeFolderToSupabase('GENAP', body.folder_genap);

    await writeActivityLog({
      user: req.user,
      action_type: 'EDIT',
      target: 'Manajemen Database',
      detail: `Import Gabung Database (.json): +${addedItems} barang (${skippedItems} dilewati), +${addedTransactions} transaksi (${skippedTransactions} dilewati), +${addedCustomerLogs} log pelanggan`
    });

    res.json({
      success: true,
      added_items: addedItems,
      skipped_items: skippedItems,
      added_transactions: addedTransactions,
      skipped_transactions: skippedTransactions,
      added_customer_logs: addedCustomerLogs
    });
  })
);

// ==================== ENDPOINT EXPORT SEMUA DATA SISTEM (.JSON) ====================
app.get(
  '/api/database/export',
  authenticateToken,
  requireSuperadmin,
  asyncHandler(async (req, res) => {
    await ensureSupabaseReady();
    const wsId = Number(req.user.workspace_id || 1);

    const fullData = await buildFullWorkspaceExport(wsId);

    await writeActivityLog({
      user: req.user,
      action_type: 'EXPORT',
      target: 'Manajemen Database',
      detail: `Export semua data sistem (.json): ${fullData.items.length} barang, ${fullData.transactions.length} transaksi, ${fullData.folder_gmdp.customer_logs.length} log GMDP, ${fullData.folder_genap.customer_logs.length} log GENAP`
    });

    res.json({
      system: 'StokPintar — SRI BARADA INDRA SAKTI (Produksi Resmi)',
      exported_at: new Date().toISOString(),
      exported_by: req.user.full_name || req.user.username,
      inventory_db: {
        items: fullData.items,
        transactions: fullData.transactions,
        users: fullData.users
      },
      folder_gmdp: fullData.folder_gmdp,
      folder_genap: fullData.folder_genap,
      activity_logs: fullData.activity_logs
    });
  })
);

// ==================== SISTEM PERSETUJUAN HAPUS DATA (TEKNISI & ADMIN -> SUPERADMIN) ====================
function needsDeleteApproval(user) {
  const r = String(user && user.role ? user.role : '').toLowerCase();
  return r === 'teknisi' || r === 'admin';
}

async function queueDeleteRequest({ user, entity, label, payload }) {
  const wsId = Number(user.workspace_id || 1);
  const detailObj = {
    workspace_id: wsId,
    status: 'PENDING',
    entity,
    label,
    payload: payload || {},
    requested_at: new Date().toISOString()
  };
  const { data, error } = await supabase
    .from('activity_logs')
    .insert({
      user_id: user.id || null,
      username: user.username || '-',
      full_name: user.full_name || user.username || '-',
      role: user.role || '-',
      action_type: 'EDIT',
      target: 'DELETE_REQUEST',
      detail: JSON.stringify(detailObj)
    })
    .select('id')
    .single();
  if (error) throw error;
  return {
    pending_approval: true,
    request_id: data ? data.id : null,
    message: 'Permintaan hapus data telah dikirim dan menunggu persetujuan Superadmin.'
  };
}

async function executeApprovedDelete(wsId, reqMeta, superadminUser) {
  const { entity, payload = {} } = reqMeta;
  if (entity === 'item') {
    const { error } = await supabase.from('items').delete().eq('id', payload.id).eq('workspace_id', wsId);
    if (error) throw error;
  } else if (entity === 'items_bulk') {
    const validIds = Array.isArray(payload.ids) ? payload.ids : [];
    if (validIds.length > 0) {
      const { error } = await supabase.from('items').delete().in('id', validIds).eq('workspace_id', wsId);
      if (error) throw error;
    }
  } else if (entity === 'transaction') {
    const { data: tx } = await supabase
      .from('transactions')
      .select('*')
      .eq('id', payload.id)
      .eq('workspace_id', wsId)
      .maybeSingle();
    if (!tx) throw new Error('Transaksi sudah tidak ditemukan.');
    const { data: item } = await supabase.from('items').select('*').eq('id', tx.item_id).maybeSingle();
    if (item) {
      const revertStock = tx.type === 'IN' ? item.current_stock - tx.quantity : item.current_stock + tx.quantity;
      if (revertStock < 0) throw new Error('Tidak dapat disetujui karena stok akhir akan menjadi minus.');
      const { error: updErr } = await supabase.from('items').update({ current_stock: revertStock }).eq('id', tx.item_id);
      if (updErr) throw updErr;
    }
    const { error: delErr } = await supabase.from('transactions').delete().eq('id', payload.id);
    if (delErr) throw delErr;
  } else if (entity === 'transactions_bulk') {
    const validIds = Array.isArray(payload.ids) ? payload.ids : [];
    const { data: txs } = await supabase.from('transactions').select('*').in('id', validIds).eq('workspace_id', wsId);
    if (txs && txs.length > 0) {
      const deltaByItem = {};
      txs.forEach((tx) => {
        const d = tx.type === 'IN' ? -Number(tx.quantity || 0) : Number(tx.quantity || 0);
        deltaByItem[tx.item_id] = (deltaByItem[tx.item_id] || 0) + d;
      });
      const itemIds = Object.keys(deltaByItem).map((k) => Number(k));
      const { data: items } = await supabase.from('items').select('*').in('id', itemIds);
      for (const item of items || []) {
        const nextStock = Number(item.current_stock || 0) + (deltaByItem[item.id] || 0);
        if (nextStock < 0) throw new Error(`Stok "${item.name}" akan menjadi minus (${nextStock}).`);
        const { error: updErr } = await supabase.from('items').update({ current_stock: nextStock }).eq('id', item.id);
        if (updErr) throw updErr;
      }
      const { error: delErr } = await supabase.from('transactions').delete().in('id', validIds);
      if (delErr) throw delErr;
    }
  } else if (entity === 'folder_log') {
    const comp = normalizeCompany(payload.company);
    const { data: logRow } = await supabase
      .from('folder_logs')
      .select('*')
      .eq('company', comp)
      .eq('id', payload.id)
      .maybeSingle();
    const { error } = await supabase.from('folder_logs').delete().eq('company', comp).eq('id', payload.id);
    if (error) throw error;
    if (logRow && logRow.date) {
      const logMonth = logRow.date.slice(0, 7);
      const { data: existingManual } = await supabase
        .from('folder_monthly_manual')
        .select('*')
        .eq('company', comp)
        .eq('month', logMonth)
        .maybeSingle();
      if (existingManual) {
        await supabase
          .from('folder_monthly_manual')
          .update({
            manual_in:
              logRow.type === 'IN' ? Math.max(0, Number(existingManual.manual_in || 0) - logRow.count) : existingManual.manual_in,
            manual_out:
              logRow.type === 'OUT' ? Math.max(0, Number(existingManual.manual_out || 0) - logRow.count) : existingManual.manual_out
          })
          .eq('company', comp)
          .eq('month', logMonth);
      }
    }
  } else if (entity === 'folder_monthly_manual') {
    const comp = normalizeCompany(payload.company);
    const { error } = await supabase.from('folder_monthly_manual').delete().eq('company', comp).eq('month', payload.month);
    if (error) throw error;
  } else if (entity === 'folder_month') {
    const comp = normalizeCompany(payload.company);
    await supabase.from('folder_monthly_manual').delete().eq('company', comp).eq('month', payload.month);
    await supabase.from('folder_logs').delete().eq('company', comp).like('date', `${payload.month}%`);
    const { error } = await supabase
      .from('folder_deleted_months')
      .upsert({ company: comp, month: payload.month }, { onConflict: 'company,month' });
    if (error) throw error;
  } else if (entity === 'folder_yearly_manual') {
    const comp = normalizeCompany(payload.company);
    const { error } = await supabase.from('folder_yearly_manual').delete().eq('company', comp).eq('year', payload.year);
    if (error) throw error;
  } else {
    throw new Error('Jenis penghapusan tidak dikenali.');
  }

  await writeActivityLog({
    user: superadminUser,
    action_type: 'EDIT',
    target: 'Persetujuan Hapus',
    detail: `Menyetujui penghapusan: ${reqMeta.label || entity}`
  });
}

app.get(
  '/api/delete-requests',
  authenticateToken,
  requireSuperadmin,
  asyncHandler(async (req, res) => {
    await ensureSupabaseReady();
    const wsId = Number(req.user.workspace_id || 1);
    const { data, error } = await supabase
      .from('activity_logs')
      .select('*')
      .eq('target', 'DELETE_REQUEST')
      .order('id', { ascending: false })
      .limit(100);
    if (error) throw error;

    const list = (data || [])
      .map((row) => {
        let parsed = {};
        try {
          parsed = JSON.parse(row.detail || '{}');
        } catch (_) {}
        return {
          id: row.id,
          username: row.username,
          full_name: row.full_name,
          role: row.role,
          created_at: row.created_at,
          workspace_id: parsed.workspace_id || 1,
          status: parsed.status || 'PENDING',
          entity: parsed.entity || '',
          label: parsed.label || row.detail,
          payload: parsed.payload || {},
          resolved_by: parsed.resolved_by || null,
          resolved_at: parsed.resolved_at || null
        };
      })
      .filter((r) => Number(r.workspace_id || 1) === wsId);
    res.json({
      requests: list,
      pending_count: list.filter((r) => r.status === 'PENDING').length
    });
  })
);

app.post(
  '/api/delete-requests/:id/approve',
  authenticateToken,
  requireSuperadmin,
  asyncHandler(async (req, res) => {
    await ensureSupabaseReady();
    const wsId = Number(req.user.workspace_id || 1);
    const { data: row, error } = await supabase
      .from('activity_logs')
      .select('*')
      .eq('id', req.params.id)
      .eq('target', 'DELETE_REQUEST')
      .maybeSingle();
    if (error) throw error;
    if (!row) return res.status(404).json({ error: 'Permintaan hapus tidak ditemukan.' });

    let parsed = {};
    try {
      parsed = JSON.parse(row.detail || '{}');
    } catch (_) {}
    if (parsed.workspace_id && Number(parsed.workspace_id) !== wsId) {
      return res.status(404).json({ error: 'Permintaan hapus tidak ditemukan.' });
    }
    if (parsed.status !== 'PENDING') {
      return res.status(400).json({ error: `Permintaan ini sudah berstatus ${parsed.status}.` });
    }

    await executeApprovedDelete(wsId, parsed, req.user);

    const updatedDetail = {
      ...parsed,
      status: 'APPROVED',
      resolved_by: req.user.username,
      resolved_at: new Date().toISOString()
    };
    await supabase.from('activity_logs').update({ detail: JSON.stringify(updatedDetail) }).eq('id', row.id);
    res.json({ success: true, status: 'APPROVED' });
  })
);

app.post(
  '/api/delete-requests/:id/reject',
  authenticateToken,
  requireSuperadmin,
  asyncHandler(async (req, res) => {
    await ensureSupabaseReady();
    const wsId = Number(req.user.workspace_id || 1);
    const { data: row, error } = await supabase
      .from('activity_logs')
      .select('*')
      .eq('id', req.params.id)
      .eq('target', 'DELETE_REQUEST')
      .maybeSingle();
    if (error) throw error;
    if (!row) return res.status(404).json({ error: 'Permintaan hapus tidak ditemukan.' });

    let parsed = {};
    try {
      parsed = JSON.parse(row.detail || '{}');
    } catch (_) {}
    if (parsed.workspace_id && Number(parsed.workspace_id) !== wsId) {
      return res.status(404).json({ error: 'Permintaan hapus tidak ditemukan.' });
    }
    if (parsed.status !== 'PENDING') {
      return res.status(400).json({ error: `Permintaan ini sudah berstatus ${parsed.status}.` });
    }

    const updatedDetail = {
      ...parsed,
      status: 'REJECTED',
      resolved_by: req.user.username,
      resolved_at: new Date().toISOString()
    };
    await supabase.from('activity_logs').update({ detail: JSON.stringify(updatedDetail) }).eq('id', row.id);
    await writeActivityLog({
      user: req.user,
      action_type: 'EDIT',
      target: 'Persetujuan Hapus',
      detail: `Menolak penghapusan: ${parsed.label || parsed.entity}`
    });
    res.json({ success: true, status: 'REJECTED' });
  })
);

// Global error handler
app.use((err, req, res, next) => {
  console.error('Server Error:', err);
  const rawMsg = String(err && err.message ? err.message : '');
  if (rawMsg.toLowerCase().includes('fetch failed')) {
    return res.status(502).json({
      error:
        'Gagal terhubung ke server Supabase (fetch failed). Pastikan SUPABASE_URL benar (https://xxxx.supabase.co) dan project Supabase tidak dalam status Paused.'
    });
  }
  res.status(err.statusCode || 500).json({ error: rawMsg || 'Terjadi kesalahan pada server.' });
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
