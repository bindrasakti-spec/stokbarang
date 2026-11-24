const crypto = require('crypto');

const TRIAL_DAYS = 10;

function addDaysIso(baseDate, days) {
  const d = new Date(baseDate.getTime());
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

function getTrialNotice(status, daysRemaining, billingCycle) {
  if (status === 'EXPIRED') {
    return {
      level: 'danger',
      message: 'Masa uji coba Anda telah berakhir. Pilih paket untuk melanjutkan.'
    };
  }
  if (status !== 'TRIAL' || billingCycle !== 'trial') {
    return null;
  }
  if (daysRemaining >= 10) {
    return {
      level: 'info',
      message: 'Selamat datang! Anda mendapatkan akses gratis selama 10 hari.'
    };
  }
  if (daysRemaining === 7) {
    return {
      level: 'info',
      message: 'Masa uji coba Anda tersisa 7 hari.'
    };
  }
  if (daysRemaining === 1) {
    return {
      level: 'warning',
      message: 'Besok masa uji coba Anda berakhir.'
    };
  }
  if (daysRemaining <= 3) {
    return {
      level: 'warning',
      message: `Masa uji coba Anda segera berakhir (${daysRemaining} hari tersisa).`
    };
  }
  return {
    level: 'info',
    message: `Masa uji coba gratis tersisa ${daysRemaining} hari.`
  };
}

module.exports = function registerSaasRoutes(app, deps) {
  const {
    supabase,
    ensureSupabaseReady,
    asyncHandler,
    authenticateToken,
    bcrypt,
    jwt,
    JWT_SECRET,
    writeActivityLog
  } = deps;

  async function writeSubscriptionAudit({
    workspace_id,
    actor_user_id = null,
    actor_username = 'system',
    action,
    old_status = '',
    new_status = '',
    old_plan_code = '',
    new_plan_code = '',
    notes = ''
  }) {
    try {
      await supabase.from('subscription_audit_logs').insert({
        workspace_id,
        actor_user_id,
        actor_username,
        action,
        old_status,
        new_status,
        old_plan_code,
        new_plan_code,
        notes
      });
    } catch (_) {
      // Abaikan jika tabel audit belum dibuat
    }
  }

  async function isPlatformAdminUser(user) {
    if (!user) return false;
    if (String(user.role || '').toLowerCase() === 'superadmin' && Number(user.workspace_id || 1) === 1) {
      return true;
    }
    try {
      const { data, error } = await supabase
        .from('platform_admins')
        .select('id')
        .or(`user_id.eq.${Number(user.id) || 0},username.eq.${String(user.username || '').toLowerCase()}`)
        .limit(1)
        .maybeSingle();
      if (!error && data) return true;
    } catch (_) {
      // Abaikan jika tabel platform_admins belum dibuat
    }
    return false;
  }

  async function requirePlatformAdmin(req, res, next) {
    await ensureSupabaseReady();
    const ok = await isPlatformAdminUser(req.user);
    if (!ok) {
      return res.status(403).json({ error: 'Akses ditolak. Khusus Platform Super Admin.' });
    }
    next();
  }

  async function getWorkspaceSubscriptionContext(workspaceId) {
    const wsId = Number(workspaceId) || 1;
    const { data: workspace } = await supabase.from('workspaces').select('*').eq('id', wsId).maybeSingle();
    const { data: sub } = await supabase
      .from('workspace_subscriptions')
      .select('*, subscription_plans(*)')
      .eq('workspace_id', wsId)
      .maybeSingle();

    const { count: usersCount } = await supabase
      .from('users')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', wsId);

    if (!sub) {
      return {
        workspace: workspace || { id: wsId, name: 'Workspace Utama', is_active: true },
        subscription: null,
        plan: null,
        effective_status: 'ACTIVE',
        days_remaining: 365,
        is_operational_allowed: workspace ? workspace.is_active !== false : true,
        trial_notice: null,
        usage: {
          users_used: usersCount || 1,
          max_users: 999,
          warehouses_used: 1,
          max_warehouses: 999
        }
      };
    }

    const plan = sub.subscription_plans || null;
    const nowMs = Date.now();
    let effectiveStatus = sub.status;
    let daysRemaining = 0;

    if (sub.status === 'TRIAL' && sub.trial_ends_at) {
      const endMs = new Date(sub.trial_ends_at).getTime();
      const diffMs = endMs - nowMs;
      daysRemaining = Math.max(0, Math.ceil(diffMs / 86400000));
      if (diffMs <= 0) {
        effectiveStatus = 'EXPIRED';
        await supabase
          .from('workspace_subscriptions')
          .update({ status: 'EXPIRED', updated_at: new Date().toISOString() })
          .eq('id', sub.id);
        await writeSubscriptionAudit({
          workspace_id: wsId,
          action: 'TRIAL_EXPIRED',
          old_status: 'TRIAL',
          new_status: 'EXPIRED',
          old_plan_code: plan ? plan.code : '',
          new_plan_code: plan ? plan.code : '',
          notes: 'Masa uji coba 10 hari berakhir otomatis (server-side check).'
        });
      }
    } else if (sub.status === 'ACTIVE' && sub.current_period_end) {
      const endMs = new Date(sub.current_period_end).getTime();
      const diffMs = endMs - nowMs;
      daysRemaining = Math.max(0, Math.ceil(diffMs / 86400000));
      if (diffMs <= 0) {
        effectiveStatus = 'EXPIRED';
        await supabase
          .from('workspace_subscriptions')
          .update({ status: 'EXPIRED', updated_at: new Date().toISOString() })
          .eq('id', sub.id);
        await writeSubscriptionAudit({
          workspace_id: wsId,
          action: 'SUBSCRIPTION_EXPIRED',
          old_status: 'ACTIVE',
          new_status: 'EXPIRED',
          old_plan_code: plan ? plan.code : '',
          new_plan_code: plan ? plan.code : '',
          notes: 'Masa aktif langganan berakhir otomatis (server-side check).'
        });
      }
    }

    const wsActive = workspace ? workspace.is_active !== false : true;
    const isOperationalAllowed = wsActive && ['TRIAL', 'ACTIVE'].includes(effectiveStatus);

    return {
      workspace: workspace || { id: wsId, name: 'Workspace Utama', is_active: true },
      subscription: { ...sub, status: effectiveStatus },
      plan,
      effective_status: effectiveStatus,
      days_remaining: daysRemaining,
      is_operational_allowed: isOperationalAllowed,
      trial_notice: getTrialNotice(effectiveStatus, daysRemaining, sub.billing_cycle),
      usage: {
        users_used: usersCount || 0,
        max_users: plan ? Number(plan.max_users || 3) : 999,
        warehouses_used: Number(sub.warehouses_used || 1),
        max_warehouses: plan ? Number(plan.max_warehouses || 1) : 999
      }
    };
  }

  async function requireActiveSubscription(req, res, next) {
    try {
      await ensureSupabaseReady();
      const ctx = await getWorkspaceSubscriptionContext(req.user.workspace_id || 1);
      if (!ctx.workspace || ctx.workspace.is_active === false) {
        return res.status(403).json({
          error: 'Akun workspace Anda sedang dinonaktifkan oleh admin platform.',
          code: 'WORKSPACE_DISABLED'
        });
      }
      if (!ctx.is_operational_allowed) {
        return res.status(402).json({
          error: 'Masa uji coba atau langganan Anda telah berakhir. Pilih paket untuk melanjutkan.',
          code: 'SUBSCRIPTION_EXPIRED'
        });
      }
      req.subscriptionCtx = ctx;
      next();
    } catch (err) {
      next(err);
    }
  }

  async function activateSubscriptionFromPayment(payment, actorUsername = 'payment_gateway') {
    const now = new Date();
    const { data: sub } = await supabase
      .from('workspace_subscriptions')
      .select('*, subscription_plans(code)')
      .eq('workspace_id', payment.workspace_id)
      .maybeSingle();

    const { data: targetPlan } = await supabase
      .from('subscription_plans')
      .select('*')
      .eq('id', payment.plan_id)
      .single();

    const daysToAdd = payment.billing_cycle === 'yearly' ? 365 : 30;
    let startBase = now;
    if (
      sub &&
      sub.status === 'ACTIVE' &&
      sub.current_period_end &&
      new Date(sub.current_period_end).getTime() > now.getTime()
    ) {
      startBase = new Date(sub.current_period_end);
    }

    const periodStart = sub && sub.status === 'ACTIVE' && sub.current_period_start ? sub.current_period_start : now.toISOString();
    const periodEnd = addDaysIso(startBase, daysToAdd);

    if (sub) {
      await supabase
        .from('workspace_subscriptions')
        .update({
          plan_id: targetPlan.id,
          status: 'ACTIVE',
          billing_cycle: payment.billing_cycle,
          current_period_start: periodStart,
          current_period_end: periodEnd,
          updated_at: now.toISOString()
        })
        .eq('id', sub.id);
    } else {
      await supabase.from('workspace_subscriptions').insert({
        workspace_id: payment.workspace_id,
        plan_id: targetPlan.id,
        status: 'ACTIVE',
        billing_cycle: payment.billing_cycle,
        current_period_start: periodStart,
        current_period_end: periodEnd,
        warehouses_used: 1
      });
    }

    await supabase
      .from('subscription_payments')
      .update({
        status: 'PAID',
        verified_by: actorUsername,
        verified_at: now.toISOString()
      })
      .eq('id', payment.id);

    await supabase
      .from('subscription_invoices')
      .update({
        status: 'PAID',
        paid_at: now.toISOString()
      })
      .eq('payment_id', payment.id);

    await writeSubscriptionAudit({
      workspace_id: payment.workspace_id,
      actor_username: actorUsername,
      action: 'PAYMENT_VERIFIED_ACTIVATED',
      old_status: sub ? sub.status : 'NONE',
      new_status: 'ACTIVE',
      old_plan_code: sub && sub.subscription_plans ? sub.subscription_plans.code : '',
      new_plan_code: targetPlan.code,
      notes: `Pembayaran ${payment.order_id} (${payment.billing_cycle}) diverifikasi. Aktif s/d ${periodEnd.slice(0, 10)}`
    });
  }

  // ==================== 1. PUBLIC PRICING PLANS ====================
  app.get(
    '/api/saas/plans',
    asyncHandler(async (req, res) => {
      await ensureSupabaseReady();
      const { data, error } = await supabase
        .from('subscription_plans')
        .select('*')
        .eq('is_active', true)
        .order('sort_order', { ascending: true });
      if (error) throw error;
      res.json(data || []);
    })
  );

  // ==================== 2. SELF-SERVICE SIGNUP + 10-DAY FREE TRIAL ====================
  app.post(
    '/api/auth/register',
    asyncHandler(async (req, res) => {
      await ensureSupabaseReady();
      const { company_name, full_name, email, username, password } = req.body || {};
      if (!company_name || !full_name || !email || !username || !password) {
        return res.status(400).json({ error: 'Nama perusahaan, nama lengkap, email, username, dan password wajib diisi.' });
      }
      if (String(password).trim().length < 4) {
        return res.status(400).json({ error: 'Password minimal 4 karakter.' });
      }

      const uname = String(username).trim().toLowerCase();
      const cleanEmail = String(email).trim().toLowerCase();

      const { data: existingUser } = await supabase.from('users').select('id').ilike('username', uname).maybeSingle();
      if (existingUser) {
        return res.status(400).json({ error: 'Username sudah terdaftar. Silakan gunakan username lain.' });
      }

      // 1. Buat Workspace baru
      const { data: ws, error: wsErr } = await supabase
        .from('workspaces')
        .insert({
          name: String(company_name).trim(),
          owner_email: cleanEmail,
          is_active: true
        })
        .select()
        .single();
      if (wsErr) throw wsErr;

      // 2. Buat User Owner Workspace (role superadmin di dalam workspace-nya)
      const { data: newUser, error: userErr } = await supabase
        .from('users')
        .insert({
          username: uname,
          password_hash: bcrypt.hashSync(String(password), 10),
          full_name: String(full_name).trim(),
          role: 'superadmin',
          workspace_id: ws.id,
          email: cleanEmail
        })
        .select('id, username, full_name, role, workspace_id, email')
        .single();

      if (userErr) {
        await supabase.from('workspaces').delete().eq('id', ws.id);
        throw userErr;
      }

      await supabase.from('workspaces').update({ owner_user_id: newUser.id }).eq('id', ws.id);

      // 3. Mulai Free Trial 10 Hari (server-side timestamp)
      const { data: trialPlan } = await supabase
        .from('subscription_plans')
        .select('id, code')
        .eq('code', 'business')
        .maybeSingle();

      const now = new Date();
      const trialEnd = addDaysIso(now, TRIAL_DAYS);

      const { data: createdSub, error: subErr } = await supabase
        .from('workspace_subscriptions')
        .insert({
          workspace_id: ws.id,
          plan_id: trialPlan ? trialPlan.id : null,
          status: 'TRIAL',
          billing_cycle: 'trial',
          trial_started_at: now.toISOString(),
          trial_ends_at: trialEnd,
          warehouses_used: 1
        })
        .select()
        .single();
      if (subErr) throw subErr;

      await writeSubscriptionAudit({
        workspace_id: ws.id,
        actor_user_id: newUser.id,
        actor_username: newUser.username,
        action: 'TRIAL_STARTED',
        old_status: 'NONE',
        new_status: 'TRIAL',
        new_plan_code: trialPlan ? trialPlan.code : 'business',
        notes: `Registrasi workspace "${ws.name}" dengan Free Trial 10 hari s/d ${trialEnd.slice(0, 10)}`
      });

      const payload = {
        id: newUser.id,
        username: newUser.username,
        full_name: newUser.full_name,
        role: newUser.role,
        workspace_id: ws.id,
        is_platform_admin: false
      };
      const token = jwt.sign(payload, JWT_SECRET, { expiresIn: '2h' });

      await writeActivityLog({
        user: payload,
        action_type: 'LOGIN',
        target: 'Registrasi SaaS',
        detail: `Daftar akun & mulai Free Trial 10 hari (${ws.name})`
      });

      res.status(201).json({
        token,
        user: payload,
        subscription: createdSub,
        message: 'Selamat datang! Anda mendapatkan akses gratis selama 10 hari.'
      });
    })
  );

  // ==================== 3. CUSTOMER SUBSCRIPTION DASHBOARD & CHECKOUT ====================
  app.get(
    '/api/saas/my-subscription',
    authenticateToken,
    asyncHandler(async (req, res) => {
      await ensureSupabaseReady();
      const wsId = req.user.workspace_id || 1;
      const ctx = await getWorkspaceSubscriptionContext(wsId);

      const [paymentsRes, invoicesRes] = await Promise.all([
        supabase
          .from('subscription_payments')
          .select('*, subscription_plans(name, code)')
          .eq('workspace_id', wsId)
          .order('created_at', { ascending: false })
          .limit(30),
        supabase
          .from('subscription_invoices')
          .select('*')
          .eq('workspace_id', wsId)
          .order('issued_at', { ascending: false })
          .limit(30)
      ]);

      res.json({
        ...ctx,
        payments: paymentsRes.data || [],
        invoices: invoicesRes.data || []
      });
    })
  );

  app.post(
    '/api/saas/checkout',
    authenticateToken,
    asyncHandler(async (req, res) => {
      await ensureSupabaseReady();
      const wsId = req.user.workspace_id || 1;
      const { plan_code, billing_cycle, payment_method, proof_note } = req.body || {};

      if (!['monthly', 'yearly'].includes(billing_cycle)) {
        return res.status(400).json({ error: 'Periode langganan harus monthly atau yearly.' });
      }
      if (!['manual_transfer', 'midtrans', 'xendit'].includes(payment_method || 'manual_transfer')) {
        return res.status(400).json({ error: 'Metode pembayaran tidak valid.' });
      }

      const { data: plan, error: planErr } = await supabase
        .from('subscription_plans')
        .select('*')
        .eq('code', String(plan_code || '').toLowerCase())
        .eq('is_active', true)
        .maybeSingle();

      if (planErr) throw planErr;
      if (!plan) {
        return res.status(404).json({ error: 'Paket langganan tidak ditemukan atau tidak aktif.' });
      }

      const amount = billing_cycle === 'yearly' ? Number(plan.price_yearly) : Number(plan.price_monthly);
      const { data: sub } = await supabase
        .from('workspace_subscriptions')
        .select('id')
        .eq('workspace_id', wsId)
        .maybeSingle();

      const orderId = `IMS-${wsId}-${Date.now()}`;
      const invoiceNumber = `INV-${wsId}-${new Date().toISOString().slice(0, 10).replace(/-/g, '')}-${String(
        Date.now()
      ).slice(-4)}`;

      const method = payment_method || 'manual_transfer';
      const hasMidtrans = Boolean((process.env.MIDTRANS_SERVER_KEY || '').trim());
      const hasXendit = Boolean((process.env.XENDIT_SECRET_KEY || '').trim());
      const gatewayConfigured =
        (method === 'midtrans' && hasMidtrans) || (method === 'xendit' && hasXendit);

      const { data: payment, error: payErr } = await supabase
        .from('subscription_payments')
        .insert({
          workspace_id: wsId,
          subscription_id: sub ? sub.id : null,
          plan_id: plan.id,
          order_id: orderId,
          amount,
          billing_cycle,
          payment_method: method,
          proof_note: String(proof_note || ''),
          status: 'PENDING'
        })
        .select()
        .single();
      if (payErr) throw payErr;

      const { data: invoice, error: invErr } = await supabase
        .from('subscription_invoices')
        .insert({
          invoice_number: invoiceNumber,
          workspace_id: wsId,
          payment_id: payment.id,
          plan_name: plan.name,
          billing_cycle,
          amount,
          status: 'PENDING'
        })
        .select()
        .single();
      if (invErr) throw invErr;

      await writeSubscriptionAudit({
        workspace_id: wsId,
        actor_user_id: req.user.id,
        actor_username: req.user.username,
        action: 'CHECKOUT_CREATED',
        new_plan_code: plan.code,
        notes: `Order ${orderId} (${method}, ${billing_cycle}) sebesar Rp ${amount.toLocaleString('id-ID')} berstatus PENDING`
      });

      res.status(201).json({
        payment,
        invoice,
        plan,
        gateway_configured: gatewayConfigured,
        instructions:
          method === 'manual_transfer'
            ? 'Silakan lakukan transfer sesuai nominal tagihan. Status langganan akan aktif setelah diverifikasi oleh Admin Platform.'
            : gatewayConfigured
            ? 'Order dibuat dan menunggu callback verifikasi dari payment gateway.'
            : 'Payment gateway belum dikonfigurasi pada server. Order disimpan sebagai PENDING untuk verifikasi manual oleh Admin Platform.'
      });
    })
  );

  // ==================== 4. PAYMENT GATEWAY WEBHOOKS (MIDTRANS & XENDIT) ====================
  app.post(
    '/api/saas/webhook/midtrans',
    asyncHandler(async (req, res) => {
      await ensureSupabaseReady();
      const serverKey = (process.env.MIDTRANS_SERVER_KEY || '').trim();
      if (!serverKey) {
        return res.status(503).json({ error: 'MIDTRANS_SERVER_KEY belum dikonfigurasi.' });
      }

      const { order_id, status_code, gross_amount, signature_key, transaction_status, transaction_id } = req.body || {};
      const expectedSig = crypto
        .createHash('sha512')
        .update(`${order_id}${status_code}${gross_amount}${serverKey}`)
        .digest('hex');

      if (!signature_key || signature_key !== expectedSig) {
        return res.status(401).json({ error: 'Invalid Midtrans signature.' });
      }

      const { data: payment } = await supabase
        .from('subscription_payments')
        .select('*')
        .eq('order_id', order_id)
        .maybeSingle();

      if (!payment) return res.status(404).json({ error: 'Order tidak ditemukan.' });

      if (['settlement', 'capture'].includes(transaction_status)) {
        if (payment.status !== 'PAID') {
          await supabase
            .from('subscription_payments')
            .update({ payment_gateway_ref: transaction_id || '' })
            .eq('id', payment.id);
          await activateSubscriptionFromPayment(payment, 'midtrans_webhook');
        }
      } else if (['deny', 'cancel', 'expire'].includes(transaction_status)) {
        const mapped = transaction_status === 'expire' ? 'EXPIRED' : 'FAILED';
        await supabase.from('subscription_payments').update({ status: mapped }).eq('id', payment.id);
        await supabase.from('subscription_invoices').update({ status: mapped }).eq('payment_id', payment.id);
      }

      res.json({ received: true });
    })
  );

  app.post(
    '/api/saas/webhook/xendit',
    asyncHandler(async (req, res) => {
      await ensureSupabaseReady();
      const expectedToken = (process.env.XENDIT_CALLBACK_TOKEN || '').trim();
      if (!expectedToken) {
        return res.status(503).json({ error: 'XENDIT_CALLBACK_TOKEN belum dikonfigurasi.' });
      }

      const receivedToken = req.headers['x-callback-token'];
      if (receivedToken !== expectedToken) {
        return res.status(401).json({ error: 'Invalid Xendit callback token.' });
      }

      const { external_id, status, id: gatewayId } = req.body || {};
      const { data: payment } = await supabase
        .from('subscription_payments')
        .select('*')
        .eq('order_id', external_id)
        .maybeSingle();

      if (!payment) return res.status(404).json({ error: 'Order tidak ditemukan.' });

      if (status === 'PAID' || status === 'SETTLED') {
        if (payment.status !== 'PAID') {
          await supabase
            .from('subscription_payments')
            .update({ payment_gateway_ref: gatewayId || '' })
            .eq('id', payment.id);
          await activateSubscriptionFromPayment(payment, 'xendit_webhook');
        }
      } else if (status === 'EXPIRED') {
        await supabase.from('subscription_payments').update({ status: 'EXPIRED' }).eq('id', payment.id);
        await supabase.from('subscription_invoices').update({ status: 'EXPIRED' }).eq('payment_id', payment.id);
      }

      res.json({ received: true });
    })
  );

  // ==================== 5. PLATFORM SUPER ADMIN PANEL ====================
  app.get(
    '/api/admin/saas/stats',
    authenticateToken,
    requirePlatformAdmin,
    asyncHandler(async (req, res) => {
      const [wsRes, subsRes, payRes] = await Promise.all([
        supabase.from('workspaces').select('id, created_at, is_active'),
        supabase.from('workspace_subscriptions').select('status, billing_cycle'),
        supabase.from('subscription_payments').select('amount, status, created_at')
      ]);

      const workspaces = wsRes.data || [];
      const subs = subsRes.data || [];
      const payments = payRes.data || [];

      const nowMonth = new Date().toISOString().slice(0, 7);
      const totalCustomers = workspaces.length;
      const totalTrial = subs.filter((s) => s.status === 'TRIAL').length;
      const totalActive = subs.filter((s) => s.status === 'ACTIVE').length;
      const totalExpired = subs.filter((s) => s.status === 'EXPIRED').length;
      const totalPaidSubs = subs.filter((s) => s.status === 'ACTIVE' && s.billing_cycle !== 'trial').length;
      const totalRevenue = payments
        .filter((p) => p.status === 'PAID')
        .reduce((sum, p) => sum + Number(p.amount || 0), 0);
      const newCustomersThisMonth = workspaces.filter((w) => String(w.created_at || '').startsWith(nowMonth)).length;

      // Pertumbuhan pelanggan per bulan (6 bulan terakhir)
      const growthMap = {};
      workspaces.forEach((w) => {
        const m = String(w.created_at || '').slice(0, 7);
        if (m) growthMap[m] = (growthMap[m] || 0) + 1;
      });
      const monthlyGrowth = Object.entries(growthMap)
        .sort((a, b) => a[0].localeCompare(b[0]))
        .slice(-6)
        .map(([month, count]) => ({ month, count }));

      res.json({
        total_customers: totalCustomers,
        total_trial: totalTrial,
        total_paid: totalPaidSubs,
        total_active: totalActive,
        total_expired: totalExpired,
        total_revenue: totalRevenue,
        new_customers: newCustomersThisMonth,
        pending_payments: payments.filter((p) => p.status === 'PENDING').length,
        monthly_growth: monthlyGrowth
      });
    })
  );

  app.get(
    '/api/admin/saas/customers',
    authenticateToken,
    requirePlatformAdmin,
    asyncHandler(async (req, res) => {
      const [wsRes, subsRes, usersRes] = await Promise.all([
        supabase.from('workspaces').select('*').order('id', { ascending: false }),
        supabase.from('workspace_subscriptions').select('*, subscription_plans(id, code, name)'),
        supabase.from('users').select('id, workspace_id, email, username')
      ]);

      const subsByWs = {};
      (subsRes.data || []).forEach((s) => {
        subsByWs[s.workspace_id] = s;
      });

      const usersCountByWs = {};
      (usersRes.data || []).forEach((u) => {
        usersCountByWs[u.workspace_id] = (usersCountByWs[u.workspace_id] || 0) + 1;
      });

      const list = (wsRes.data || []).map((w) => {
        const sub = subsByWs[w.id] || null;
        return {
          ...w,
          users_count: usersCountByWs[w.id] || 0,
          subscription: sub,
          plan_name: sub && sub.subscription_plans ? sub.subscription_plans.name : '-',
          plan_code: sub && sub.subscription_plans ? sub.subscription_plans.code : '',
          sub_status: sub ? sub.status : 'NONE'
        };
      });

      res.json(list);
    })
  );

  app.put(
    '/api/admin/saas/customers/:workspaceId/toggle',
    authenticateToken,
    requirePlatformAdmin,
    asyncHandler(async (req, res) => {
      const wsId = Number(req.params.workspaceId);
      const { data: ws } = await supabase.from('workspaces').select('*').eq('id', wsId).maybeSingle();
      if (!ws) return res.status(404).json({ error: 'Workspace tidak ditemukan.' });

      const nextActive = !ws.is_active;
      await supabase.from('workspaces').update({ is_active: nextActive }).eq('id', wsId);

      await writeSubscriptionAudit({
        workspace_id: wsId,
        actor_user_id: req.user.id,
        actor_username: req.user.username,
        action: nextActive ? 'WORKSPACE_ACTIVATED' : 'WORKSPACE_DEACTIVATED',
        notes: `Status workspace diubah menjadi ${nextActive ? 'Aktif' : 'Nonaktif'} oleh Platform Admin`
      });

      res.json({ success: true, is_active: nextActive });
    })
  );

  app.get(
    '/api/admin/saas/plans',
    authenticateToken,
    requirePlatformAdmin,
    asyncHandler(async (req, res) => {
      const { data, error } = await supabase
        .from('subscription_plans')
        .select('*')
        .order('sort_order', { ascending: true });
      if (error) throw error;
      res.json(data || []);
    })
  );

  app.post(
    '/api/admin/saas/plans',
    authenticateToken,
    requirePlatformAdmin,
    asyncHandler(async (req, res) => {
      const {
        code,
        name,
        target_audience,
        description,
        price_monthly,
        price_yearly,
        max_warehouses,
        max_users,
        features,
        is_recommended,
        is_active
      } = req.body || {};

      if (!code || !name) {
        return res.status(400).json({ error: 'Kode paket dan nama paket wajib diisi.' });
      }

      const { data, error } = await supabase
        .from('subscription_plans')
        .insert({
          code: String(code).trim().toLowerCase(),
          name: String(name).trim(),
          target_audience: String(target_audience || ''),
          description: String(description || ''),
          price_monthly: Math.max(0, Number(price_monthly) || 0),
          price_yearly: Math.max(0, Number(price_yearly) || 0),
          max_warehouses: Math.max(1, parseInt(max_warehouses, 10) || 1),
          max_users: Math.max(1, parseInt(max_users, 10) || 1),
          features: Array.isArray(features) ? features : [],
          is_recommended: Boolean(is_recommended),
          is_active: is_active !== false
        })
        .select()
        .single();
      if (error) return res.status(400).json({ error: error.message });
      res.status(201).json(data);
    })
  );

  app.put(
    '/api/admin/saas/plans/:id',
    authenticateToken,
    requirePlatformAdmin,
    asyncHandler(async (req, res) => {
      const { id } = req.params;
      const {
        name,
        target_audience,
        description,
        price_monthly,
        price_yearly,
        max_warehouses,
        max_users,
        features,
        is_recommended,
        is_active
      } = req.body || {};

      const { data, error } = await supabase
        .from('subscription_plans')
        .update({
          name,
          target_audience,
          description,
          price_monthly: Math.max(0, Number(price_monthly) || 0),
          price_yearly: Math.max(0, Number(price_yearly) || 0),
          max_warehouses: Math.max(1, parseInt(max_warehouses, 10) || 1),
          max_users: Math.max(1, parseInt(max_users, 10) || 1),
          features: Array.isArray(features) ? features : [],
          is_recommended: Boolean(is_recommended),
          is_active: Boolean(is_active),
          updated_at: new Date().toISOString()
        })
        .eq('id', id)
        .select()
        .single();
      if (error) return res.status(400).json({ error: error.message });
      res.json(data);
    })
  );

  app.delete(
    '/api/admin/saas/plans/:id',
    authenticateToken,
    requirePlatformAdmin,
    asyncHandler(async (req, res) => {
      const planId = Number(req.params.id);
      const { data: plan } = await supabase.from('subscription_plans').select('*').eq('id', planId).maybeSingle();
      if (!plan) return res.status(404).json({ error: 'Paket tidak ditemukan.' });

      const { count: payCount } = await supabase
        .from('subscription_payments')
        .select('id', { count: 'exact', head: true })
        .eq('plan_id', planId);

      // Lepas referensi di workspace_subscriptions & subscriptions agar aman dihapus
      await supabase.from('workspace_subscriptions').update({ plan_id: null }).eq('plan_id', planId);
      await supabase.from('subscriptions').update({ plan_id: null }).eq('plan_id', planId);

      if ((payCount || 0) > 0) {
        const { error: softErr } = await supabase
          .from('subscription_plans')
          .update({ is_active: false, updated_at: new Date().toISOString() })
          .eq('id', planId);
        if (softErr) throw softErr;
        return res.json({
          success: true,
          soft_deleted: true,
          message: `Paket "${plan.name}" dinonaktifkan karena sudah memiliki riwayat pembayaran.`
        });
      }

      const { error: delErr } = await supabase.from('subscription_plans').delete().eq('id', planId);
      if (delErr) throw delErr;
      res.json({ success: true, soft_deleted: false, message: `Paket "${plan.name}" berhasil dihapus.` });
    })
  );

  app.delete(
    '/api/admin/saas/subscriptions/:workspaceId',
    authenticateToken,
    requirePlatformAdmin,
    asyncHandler(async (req, res) => {
      const wsId = Number(req.params.workspaceId);
      const { data: sub } = await supabase
        .from('workspace_subscriptions')
        .select('*, subscription_plans(code)')
        .eq('workspace_id', wsId)
        .maybeSingle();

      if (!sub) {
        return res.status(404).json({ error: 'Data langganan untuk workspace ini tidak ditemukan.' });
      }

      const { error: delErr } = await supabase.from('workspace_subscriptions').delete().eq('workspace_id', wsId);
      if (delErr) throw delErr;
      await supabase.from('subscriptions').delete().eq('workspace_id', wsId);

      await writeSubscriptionAudit({
        workspace_id: wsId,
        actor_user_id: req.user.id,
        actor_username: req.user.username,
        action: 'ADMIN_SUBSCRIPTION_DELETED',
        old_status: sub.status,
        new_status: 'DELETED',
        old_plan_code: sub.subscription_plans ? sub.subscription_plans.code : '',
        notes: 'Langganan dihapus secara manual oleh Platform Super Admin'
      });

      res.json({ success: true, message: 'Langganan berhasil dihapus.' });
    })
  );

  app.put(
    '/api/admin/saas/subscriptions/:workspaceId',
    authenticateToken,
    requirePlatformAdmin,
    asyncHandler(async (req, res) => {
      const wsId = Number(req.params.workspaceId);
      const { plan_code, status, billing_cycle, current_period_start, current_period_end, extend_days, trial_days, notes } =
        req.body || {};

      const { data: sub } = await supabase
        .from('workspace_subscriptions')
        .select('*, subscription_plans(code)')
        .eq('workspace_id', wsId)
        .maybeSingle();

      const { data: plan } = plan_code
        ? await supabase.from('subscription_plans').select('*').eq('code', plan_code).maybeSingle()
        : { data: null };

      const now = new Date();
      const updates = { updated_at: now.toISOString() };
      if (plan) updates.plan_id = plan.id;
      if (status && ['TRIAL', 'ACTIVE', 'PAST_DUE', 'EXPIRED', 'CANCELLED'].includes(status)) {
        updates.status = status;
      }
      if (billing_cycle && ['trial', 'monthly', 'yearly'].includes(billing_cycle)) {
        updates.billing_cycle = billing_cycle;
      }

      if (current_period_start) {
        const sIso = new Date(`${String(current_period_start).slice(0, 10)}T00:00:00.000Z`).toISOString();
        updates.current_period_start = sIso;
        if ((updates.billing_cycle || (sub && sub.billing_cycle)) === 'trial') {
          updates.trial_started_at = sIso;
        }
      }

      if (current_period_end) {
        const eIso = new Date(`${String(current_period_end).slice(0, 10)}T23:59:59.000Z`).toISOString();
        updates.current_period_end = eIso;
        if ((updates.billing_cycle || (sub && sub.billing_cycle)) === 'trial') {
          updates.trial_ends_at = eIso;
        }
      } else if (Number(extend_days) > 0) {
        const base =
          sub && sub.current_period_end && new Date(sub.current_period_end).getTime() > now.getTime()
            ? new Date(sub.current_period_end)
            : now;
        updates.current_period_start = (sub && sub.current_period_start) || now.toISOString();
        updates.current_period_end = addDaysIso(base, Number(extend_days));
        if (!updates.status) updates.status = 'ACTIVE';
        if (!updates.billing_cycle) {
          updates.billing_cycle = (sub && sub.billing_cycle !== 'trial' && sub.billing_cycle) || 'monthly';
        }
      }

      if (Number(trial_days) > 0) {
        updates.trial_started_at = (sub && sub.trial_started_at) || now.toISOString();
        updates.trial_ends_at = addDaysIso(now, Number(trial_days));
        if (!updates.status) updates.status = 'TRIAL';
      }

      // Pastikan row workspace tersedia sebelum upsert subscription
      const { data: existingWs } = await supabase.from('workspaces').select('id').eq('id', wsId).maybeSingle();
      if (!existingWs) {
        const { error: wsInsErr } = await supabase.from('workspaces').insert({
          id: wsId,
          name: wsId === 1 ? 'Workspace Utama' : `Workspace ${wsId}`,
          is_active: true
        });
        if (wsInsErr) throw wsInsErr;
      }

      if (sub) {
        const { error: updErr } = await supabase.from('workspace_subscriptions').update(updates).eq('id', sub.id);
        if (updErr) throw updErr;
      } else {
        const { error: insErr } = await supabase.from('workspace_subscriptions').insert({
          workspace_id: wsId,
          ...updates
        });
        if (insErr) throw insErr;
      }

      await writeSubscriptionAudit({
        workspace_id: wsId,
        actor_user_id: req.user.id,
        actor_username: req.user.username,
        action: 'ADMIN_SUBSCRIPTION_UPDATED',
        old_status: sub ? sub.status : 'NONE',
        new_status: updates.status || (sub ? sub.status : ''),
        old_plan_code: sub && sub.subscription_plans ? sub.subscription_plans.code : '',
        new_plan_code: plan ? plan.code : '',
        notes: notes || 'Perubahan subscription oleh Platform Super Admin'
      });

      res.json({ success: true });
    })
  );

  app.get(
    '/api/admin/saas/payments',
    authenticateToken,
    requirePlatformAdmin,
    asyncHandler(async (req, res) => {
      const { data, error } = await supabase
        .from('subscription_payments')
        .select('*, workspaces(name, owner_email), subscription_plans(name, code)')
        .order('created_at', { ascending: false })
        .limit(100);
      if (error) throw error;
      res.json(data || []);
    })
  );

  app.post(
    '/api/admin/saas/payments/:id/verify',
    authenticateToken,
    requirePlatformAdmin,
    asyncHandler(async (req, res) => {
      const { id } = req.params;
      const { decision } = req.body || {}; // 'PAID' | 'FAILED'
      if (!['PAID', 'FAILED'].includes(decision)) {
        return res.status(400).json({ error: 'Keputusan harus PAID atau FAILED.' });
      }

      const { data: payment } = await supabase.from('subscription_payments').select('*').eq('id', id).maybeSingle();
      if (!payment) return res.status(404).json({ error: 'Data pembayaran tidak ditemukan.' });

      if (decision === 'PAID') {
        await activateSubscriptionFromPayment(payment, req.user.username);
      } else {
        await supabase
          .from('subscription_payments')
          .update({
            status: 'FAILED',
            verified_by: req.user.username,
            verified_at: new Date().toISOString()
          })
          .eq('id', payment.id);
        await supabase.from('subscription_invoices').update({ status: 'FAILED' }).eq('payment_id', payment.id);
      }

      res.json({ success: true, status: decision });
    })
  );

  return {
    getWorkspaceSubscriptionContext,
    requireActiveSubscription,
    isPlatformAdminUser
  };
};
