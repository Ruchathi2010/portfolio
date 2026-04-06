/**
 * ═══════════════════════════════════════════════════════════════
 *  CLOUDFLARE WORKER — M-PESA STK PUSH
 *  File: mpesa-worker.js
 *  Deploy to: Cloudflare Workers (workers.cloudflare.com)
 * ═══════════════════════════════════════════════════════════════
 *
 *  WHAT THIS DOES:
 *  1. POST /stk-push  → sends a payment prompt to the customer's phone
 *  2. POST /callback  → Safaricom calls this when payment completes
 *                       → updates your Supabase order status to 'paid'
 *
 *  SETUP STEPS:
 *  ─────────────────────────────────────────────────────────────
 *  1. Go to workers.cloudflare.com → Create Worker → paste this code
 *  2. Add these Secret environment variables (Settings → Variables):
 *       CONSUMER_KEY      = your Daraja consumer key
 *       CONSUMER_SECRET   = your Daraja consumer secret
 *       SHORTCODE         = your Paybill or Till number (e.g. 174379 for sandbox)
 *       PASSKEY           = your Lipa na M-Pesa Online passkey
 *       SUPABASE_URL      = https://abgmvftptdkrztfflxbn.supabase.co
 *       SUPABASE_SERVICE_KEY = your Supabase service_role key (NOT anon key)
 *                              Found: Supabase Dashboard → Settings → API → service_role
 *  3. Deploy the Worker. Copy the URL (e.g. https://mpesa.yourname.workers.dev)
 *  4. In shop.html, set: const MPESA_WORKER_URL = 'https://mpesa.yourname.workers.dev'
 *  5. Register the callback URL in Safaricom Daraja portal:
 *       Callback URL = https://mpesa.yourname.workers.dev/callback
 *
 *  SANDBOX TESTING:
 *  ─────────────────────────────────────────────────────────────
 *  Use shortcode: 174379
 *  Test phone:    254708374149
 *  STK PIN:       any 4 digits
 *  Sandbox URL:   https://sandbox.safaricom.co.ke
 *  When ready:    switch API_BASE to https://api.safaricom.co.ke
 * ═══════════════════════════════════════════════════════════════
 */

// Toggle this to false when going live
const SANDBOX = true;
const API_BASE = SANDBOX
  ? 'https://sandbox.safaricom.co.ke'
  : 'https://api.safaricom.co.ke';

/* ─────────────────────────────────────────────────────────────
   CORS headers — allows your shop page to call this worker
───────────────────────────────────────────────────────────── */
const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function cors(body, status = 200){
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS }
  });
}

/* ─────────────────────────────────────────────────────────────
   MAIN REQUEST HANDLER
───────────────────────────────────────────────────────────── */
export default {
  async fetch(request, env) {

    // Handle CORS preflight
    if(request.method === 'OPTIONS'){
      return new Response(null, { status: 204, headers: CORS });
    }

    const url = new URL(request.url);

    if(url.pathname === '/stk-push' && request.method === 'POST'){
      return handleStkPush(request, env);
    }
    if(url.pathname === '/callback' && request.method === 'POST'){
      return handleCallback(request, env);
    }
    if(url.pathname === '/health'){
      return cors({ ok: true, sandbox: SANDBOX });
    }

    return cors({ error: 'Not found' }, 404);
  }
};

/* ─────────────────────────────────────────────────────────────
   STEP 1: STK PUSH — send payment prompt to customer's phone
   Body: { phone: "254711618115", amount: 18500, ref: "#JM-ABC123" }
───────────────────────────────────────────────────────────── */
async function handleStkPush(request, env){
  let body;
  try { body = await request.json(); }
  catch { return cors({ error: 'Invalid JSON' }, 400); }

  const { phone, amount, ref } = body;

  // ── Validate inputs ──
  if(!phone || !amount || !ref){
    return cors({ error: 'phone, amount, and ref are required' }, 400);
  }

  // Normalise phone: strip +, spaces, leading 0 → must be 2547XXXXXXXX
  const cleanPhone = String(phone)
    .replace(/\D/g, '')
    .replace(/^0/, '254')
    .replace(/^\+/, '');

  if(!/^2547\d{8}$/.test(cleanPhone)){
    return cors({ error: `Invalid Safaricom number: ${phone}. Must be 07XX XXX XXX format.` }, 400);
  }

  const roundedAmount = Math.round(Number(amount));
  if(isNaN(roundedAmount) || roundedAmount < 1){
    return cors({ error: 'Amount must be a positive number' }, 400);
  }

  // ── Get OAuth access token ──
  const token = await getMpesaToken(env);
  if(!token){ return cors({ error: 'Failed to get M-Pesa token — check API credentials' }, 500); }

  // ── Build STK Push request ──
  const timestamp = new Date().toISOString()
    .replace(/[^0-9]/g, '')
    .slice(0, 14);

  const password = btoa(env.SHORTCODE + env.PASSKEY + timestamp);

  const stkPayload = {
    BusinessShortCode: env.SHORTCODE,
    Password:          password,
    Timestamp:         timestamp,
    TransactionType:   'CustomerPayBillOnline',
    Amount:            roundedAmount,
    PartyA:            cleanPhone,
    PartyB:            env.SHORTCODE,
    PhoneNumber:       cleanPhone,
    CallBackURL:       `${new URL(request.url).origin}/callback`,
    AccountReference:  ref.slice(0, 12),   // max 12 chars
    TransactionDesc:   'James.dev Shop'
  };

  try {
    const res  = await fetch(`${API_BASE}/mpesa/stkpush/v1/processrequest`, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type':  'application/json'
      },
      body: JSON.stringify(stkPayload)
    });

    const data = await res.json();

    if(data.ResponseCode === '0'){
      // STK Push sent successfully
      return cors({
        success:           true,
        checkoutRequestId: data.CheckoutRequestID,
        message:           'Payment prompt sent to ' + cleanPhone
      });
    } else {
      return cors({
        error:   data.ResponseDescription || 'STK Push failed',
        code:    data.ResponseCode,
        rawData: data
      }, 400);
    }

  } catch(e){
    return cors({ error: 'Network error calling Safaricom API: ' + e.message }, 500);
  }
}

/* ─────────────────────────────────────────────────────────────
   STEP 2: CALLBACK — Safaricom calls this after customer enters PIN
   Updates the order status in Supabase to 'paid' or 'payment_failed'
───────────────────────────────────────────────────────────── */
async function handleCallback(request, env){
  let body;
  try { body = await request.json(); }
  catch { return new Response('OK', { status: 200 }); } // Always return 200 to Safaricom

  const cb  = body?.Body?.stkCallback;
  if(!cb)   return new Response('OK', { status: 200 });

  const checkoutId = cb.CheckoutRequestID;
  const resultCode = cb.ResultCode;

  console.log('[Callback] CheckoutID:', checkoutId, '| ResultCode:', resultCode);

  if(resultCode === 0){
    // ── PAYMENT SUCCESSFUL ──
    const items   = cb.CallbackMetadata?.Item || [];
    const getItem = name => items.find(i => i.Name === name)?.Value;

    const mpesaReceipt = getItem('MpesaReceiptNumber');
    const amount       = getItem('Amount');
    const phone        = getItem('PhoneNumber');

    // Update Supabase order: find by CheckoutRequestID (stored earlier)
    await updateOrderPaid(env, checkoutId, mpesaReceipt, amount, phone);

    console.log('[Callback] Payment SUCCESS — receipt:', mpesaReceipt);

  } else {
    // ── PAYMENT FAILED / CANCELLED ──
    await updateOrderFailed(env, checkoutId, resultCode);
    console.log('[Callback] Payment FAILED — code:', resultCode);
  }

  // Always return 200 — Safaricom retries if they get anything else
  return new Response(
    JSON.stringify({ ResultCode: 0, ResultDesc: 'Accepted' }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

/* ─────────────────────────────────────────────────────────────
   SUPABASE HELPERS — update order status after callback
───────────────────────────────────────────────────────────── */
async function updateOrderPaid(env, checkoutId, receipt, amount, phone){
  // We stored the checkoutRequestId in the orders table
  // Match by mpesa_checkout_id column
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/orders?mpesa_checkout_id=eq.${encodeURIComponent(checkoutId)}`,
    {
      method:  'PATCH',
      headers: {
        'apikey':        env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type':  'application/json',
        'Prefer':        'return=minimal'
      },
      body: JSON.stringify({
        status:          'paid',
        payment_status:  'paid',
        mpesa_receipt:   receipt,
        updated_at:      new Date().toISOString()
      })
    }
  );
  if(!res.ok){
    console.error('[Supabase PATCH paid] Status:', res.status, await res.text());
  }
}

async function updateOrderFailed(env, checkoutId, resultCode){
  const res = await fetch(
    `${env.SUPABASE_URL}/rest/v1/orders?mpesa_checkout_id=eq.${encodeURIComponent(checkoutId)}`,
    {
      method:  'PATCH',
      headers: {
        'apikey':        env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${env.SUPABASE_SERVICE_KEY}`,
        'Content-Type':  'application/json',
        'Prefer':        'return=minimal'
      },
      body: JSON.stringify({
        status:         'payment_failed',
        payment_status: 'failed',
        notes:          `M-Pesa failed — code ${resultCode}`,
        updated_at:     new Date().toISOString()
      })
    }
  );
  if(!res.ok){
    console.error('[Supabase PATCH failed] Status:', res.status, await res.text());
  }
}

/* ─────────────────────────────────────────────────────────────
   GET MPESA ACCESS TOKEN (cached for 1 hour via KV or just fresh)
───────────────────────────────────────────────────────────── */
async function getMpesaToken(env){
  const credentials = btoa(`${env.CONSUMER_KEY}:${env.CONSUMER_SECRET}`);
  try {
    const res  = await fetch(
      `${API_BASE}/oauth/v1/generate?grant_type=client_credentials`,
      { headers: { 'Authorization': `Basic ${credentials}` } }
    );
    const data = await res.json();
    return data.access_token || null;
  } catch(e){
    console.error('[Token error]', e.message);
    return null;
  }
}
