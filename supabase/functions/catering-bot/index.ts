import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.39.0";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });
const SLACK_BOT_TOKEN     = Deno.env.get("SLACK_BOT_TOKEN")!;
const SLACK_SIGNING_SECRET = Deno.env.get("SLACK_SIGNING_SECRET")!;
const CATERING_CHANNEL_ID  = "C0AMNUKEN85";

// ── Verify Slack signature ───────────────────────────────────────
async function verifySlackSignature(req: Request, body: string): Promise<boolean> {
  const timestamp      = req.headers.get("x-slack-request-timestamp");
  const slackSignature = req.headers.get("x-slack-signature");
  if (!timestamp || !slackSignature) return false;
  const sigBasestring = `v0:${timestamp}:${body}`;
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(SLACK_SIGNING_SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const signatureBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(sigBasestring));
  const computedSig = "v0=" + Array.from(new Uint8Array(signatureBuffer))
    .map(b => b.toString(16).padStart(2, "0")).join("");
  return computedSig === slackSignature;
}

// ── Post message to Slack ────────────────────────────────────────
async function slackPost(channel: string, text: string, thread_ts?: string) {
  const body: Record<string, string> = { channel, text };
  if (thread_ts) body.thread_ts = thread_ts;
  await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
    body: JSON.stringify(body),
  });
}

// ── Download image from Slack ────────────────────────────────────
async function downloadSlackImage(url: string): Promise<{ base64: string; mimeType: string }> {
  const res         = await fetch(url, { headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` } });
  const arrayBuffer = await res.arrayBuffer();
  const bytes       = new Uint8Array(arrayBuffer);
  const base64      = btoa(String.fromCharCode(...bytes));
  const mimeType    = res.headers.get("content-type") || "image/jpeg";
  return { base64, mimeType };
}

// ── Extract receipt data with Claude Vision ──────────────────────
async function extractReceiptData(imageUrl: string) {
  const { base64, mimeType } = await downloadSlackImage(imageUrl);
  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1000,
    messages: [{
      role: "user",
      content: [
        {
          type: "image",
          source: { type: "base64", media_type: mimeType as "image/jpeg", data: base64 },
        },
        {
          type: "text",
          text: `This is a Chick-fil-A catering order receipt. Extract the following and return ONLY valid JSON with no extra text or markdown:
{
  "guest_name": "full name of the guest",
  "phone": "phone number (format: XXX-XXX-XXXX)",
  "order_date": "date of the order (MM/DD/YYYY)",
  "pickup_or_delivery_time": "pickup or delivery datetime if visible",
  "items": "comma-separated list of items ordered",
  "total_amount": "total dollar amount (format: $XX.XX)",
  "order_number": "order or receipt number if visible",
  "notes": "any special instructions or notes"
}
If a field is not visible, use "N/A".`,
        },
      ],
    }],
  });

  const rawText = (message.content[0] as { text: string }).text.trim();
  try {
    return JSON.parse(rawText);
  } catch {
    const match = rawText.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("Could not parse receipt data.");
  }
}

// ── Save order to Supabase ───────────────────────────────────────
async function saveOrder(data: Record<string, string>, submittedBy: string) {
  const { error } = await supabase.from("catering_orders").insert({
    guest_name:       data.guest_name,
    phone:            data.phone,
    order_date:       data.order_date,
    pickup_time:      data.pickup_or_delivery_time,
    items:            data.items,
    total_amount:     data.total_amount,
    order_number:     data.order_number,
    notes:            data.notes,
    submitted_by:     submittedBy,
    follow_up_status: "Pending",
  });
  if (error) throw new Error(error.message);
}

// ── Get Slack user display name ──────────────────────────────────
async function getSlackUserName(userId: string): Promise<string> {
  try {
    const res  = await fetch(`https://slack.com/api/users.info?user=${userId}`, {
      headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
    });
    const json = await res.json();
    return json.user?.real_name || json.user?.name || userId;
  } catch {
    return userId;
  }
}

// ── 5am daily reminder ───────────────────────────────────────────
async function sendDailyReminder() {
  const today = new Date().toLocaleDateString("en-US", {
    timeZone: "America/Puerto_Rico",
    month: "2-digit", day: "2-digit", year: "numeric",
  });

  const { data: orders } = await supabase
    .from("catering_orders")
    .select("*")
    .ilike("pickup_time", `%${today}%`)
    .order("pickup_time", { ascending: true });

  const dateFormatted = new Date().toLocaleDateString("es-PR", {
    timeZone: "America/Puerto_Rico",
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
  const dateStr = dateFormatted.charAt(0).toUpperCase() + dateFormatted.slice(1);

  if (!orders || orders.length === 0) {
    await slackPost(
      CATERING_CHANNEL_ID,
      `🐔 *Buenos días!* No hay órdenes de catering para hoy — *${dateStr}*.`
    );
    return;
  }

  let message = `🐔 *Buenos días, equipo!* Órdenes de catering para hoy — *${dateStr}*\n\n`;
  orders.forEach((order: Record<string, string>, index: number) => {
    message += `*${index + 1}.* 👤 *${order.guest_name}*\n`;
    message += `   🕐 Hora de recogido: *${order.pickup_time}*\n`;
    message += `   🧾 Pedido: ${order.items}\n`;
    if (index < orders.length - 1) message += `\n`;
  });

  const count = orders.length;
  message += `\n_Por ahora: ${count} orden${count > 1 ? "es" : ""} de catering para hoy. Pueden llegar más si algún invitado llama._ ✅`;

  await slackPost(CATERING_CHANNEL_ID, message);
}

// ── Main handler ─────────────────────────────────────────────────
Deno.serve(async (req) => {
  const body   = await req.text();
  const parsed = JSON.parse(body);

  // Slack URL verification (one-time setup)
  if (parsed.type === "url_verification") {
    return new Response(JSON.stringify({ challenge: parsed.challenge }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Daily reminder trigger (called by Supabase cron)
  if (parsed.type === "daily_reminder") {
    await sendDailyReminder();
    return new Response("OK");
  }

  // Verify all other requests are from Slack
  const valid = await verifySlackSignature(req, body);
  if (!valid) return new Response("Unauthorized", { status: 401 });

  const event = parsed.event;

  // Only handle messages in #catering with image files
  if (!event || event.channel !== CATERING_CHANNEL_ID || !event.files?.length) {
    return new Response("OK");
  }

  const imageFiles = event.files.filter(
    (f: { mimetype: string }) => f.mimetype?.startsWith("image/")
  );
  if (!imageFiles.length) return new Response("OK");

  // Process in background so Slack doesn't time out
  EdgeRuntime.waitUntil((async () => {
    const submittedBy = await getSlackUserName(event.user);
    await slackPost(event.channel, "📋 Procesando recibo...", event.ts);

    for (const file of imageFiles) {
      try {
        const imageUrl = file.url_private_download || file.url_private;
        const data     = await extractReceiptData(imageUrl);
        await saveOrder(data, submittedBy);
        await slackPost(event.channel, "✅ Orden de catering registrada.", event.ts);
      } catch (err) {
        await slackPost(
          event.channel,
          "⚠️ No pude leer este recibo. Asegúrate de que la foto esté clara e intenta de nuevo.",
          event.ts
        );
        console.error("Error:", err);
      }
    }
  })());

  return new Response("OK");
});
