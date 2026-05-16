import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.39.0";

const supabase = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
);

const anthropic = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY")! });
const SLACK_BOT_TOKEN      = Deno.env.get("SLACK_BOT_TOKEN")!;
const SLACK_SIGNING_SECRET = Deno.env.get("SLACK_SIGNING_SECRET")!;
const CATERING_CHANNEL_ID  = "C0AMNUKEN85";

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
    .map((b) => b.toString(16).padStart(2, "0")).join("");
  return computedSig === slackSignature;
}

async function slackPost(channel: string, text: string, thread_ts?: string) {
  const body: Record<string, string> = { channel, text };
  if (thread_ts) body.thread_ts = thread_ts;
  await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
    body: JSON.stringify(body),
  });
}

async function downloadSlackImage(url: string): Promise<{ base64: string; mimeType: string }> {
  const res         = await fetch(url, { headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` } });
  const arrayBuffer = await res.arrayBuffer();
  const bytes       = new Uint8Array(arrayBuffer);
  const base64      = btoa(String.fromCharCode(...bytes));
  const mimeType    = res.headers.get("content-type") || "image/jpeg";
  return { base64, mimeType };
}

async function extractReceiptData(imageUrl: string) {
  const { base64, mimeType } = await downloadSlackImage(imageUrl);
  const message = await anthropic.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 1000,
    messages: [{
      role: "user",
      content: [
        { type: "image", source: { type: "base64", media_type: mimeType as "image/jpeg", data: base64 } },
        { type: "text", text: `This is a Chick-fil-A catering order receipt. Extract the following and return ONLY valid JSON with no extra text or markdown:
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
If a field is not visible, use "N/A".` },
      ],
    }],
  });
  const rawText = (message.content[0] as { text: string }).text.trim();
  try { return JSON.parse(rawText); }
  catch {
    const match = rawText.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
    throw new Error("Could not parse receipt data.");
  }
}

async function saveOrder(data: Record<string, string>, submittedBy: string) {
  const { error } = await supabase.from("catering_orders").insert({
    guest_name: data.guest_name, phone: data.phone, order_date: data.order_date,
    pickup_time: data.pickup_or_delivery_time, items: data.items,
    total_amount: data.total_amount, order_number: data.order_number,
    notes: data.notes, submitted_by: submittedBy, follow_up_status: "Pending",
  });
  if (error) throw new Error(error.message);
}

async function getSlackUserName(userId: string): Promise<string> {
  try {
    const res  = await fetch(`https://slack.com/api/users.info?user=${userId}`, {
      headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` },
    });
    const json = await res.json();
    return json.user?.real_name || json.user?.name || userId;
  } catch { return userId; }
}

async function sendDailyReminder() {
  const today = new Date().toLocaleDateString("en-US", {
    timeZone: "America/Puerto_Rico", month: "2-digit", day: "2-digit", year: "numeric",
  });
  const { data: orders } = await supabase
    .from("catering_orders").select("*")
    .ilike("pickup_time", `%${today}%`)
    .order("pickup_time", { ascending: true });

  const dateFormatted = new Date().toLocaleDateString("es-PR", {
    timeZone: "America/Puerto_Rico", weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
  const dateStr = dateFormatted.charAt(0).toUpperCase() + dateFormatted.slice(1);

  if (!orders || orders.length === 0) {
    await slackPost(CATERING_CHANNEL_ID, `🐔 *Buenos días!* No hay órdenes de catering para hoy — *${dateStr}*.`);
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
  try {
    const body = await req.text();

    let parsed: Record<string, unknown> = {};
    try { parsed = JSON.parse(body); } catch { return new Response("OK"); }

    // Slack URL verification — respond immediately, no auth needed
    if (parsed["type"] === "url_verification") {
      const challenge = parsed["challenge"] ?? "";
      return new Response(
        JSON.stringify({ challenge }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // Daily reminder trigger
    if (parsed["type"] === "daily_reminder") {
      await sendDailyReminder();
      return new Response("OK");
    }

    // Verify all other requests are from Slack
    const valid = await verifySlackSignature(req, body);
    if (!valid) return new Response("Unauthorized", { status: 401 });

    const event = parsed["event"] as Record<string, unknown> | undefined;
    if (!event || event["channel"] !== CATERING_CHANNEL_ID) return new Response("OK");

    const files = event["files"] as Array<Record<string, string>> | undefined;
    if (!files?.length) return new Response("OK");

    const imageFiles = files.filter((f) => f["mimetype"]?.startsWith("image/"));
    if (!imageFiles.length) return new Response("OK");

    EdgeRuntime.waitUntil((async () => {
      const submittedBy = await getSlackUserName(event["user"] as string);
      await slackPost(event["channel"] as string, "📋 Procesando recibo...", event["ts"] as string);
      for (const file of imageFiles) {
        try {
          const imageUrl = file["url_private_download"] || file["url_private"];
          const data     = await extractReceiptData(imageUrl);
          await saveOrder(data, submittedBy);
          await slackPost(event["channel"] as string, "✅ Orden de catering registrada.", event["ts"] as string);
        } catch (err) {
          await slackPost(
            event["channel"] as string,
            "⚠️ No pude leer este recibo. Asegúrate de que la foto esté clara e intenta de nuevo.",
            event["ts"] as string
          );
          console.error("Error:", err);
        }
      }
    })());

    return new Response("OK");
  } catch (err) {
    console.error("Handler error:", err);
    return new Response("OK");
  }
});
