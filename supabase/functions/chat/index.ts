import { createClient } from "jsr:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SECRET_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store"
};

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });

function normalizeText(value: unknown, max: number) {
  if (typeof value !== "string") return "";
  return Array.from(value.normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069]/g, "")
    .trim()).slice(0, max).join("");
}

function validRoom(value: string) {
  return /^[A-Za-z0-9_-]{6,48}$/.test(value);
}

function looksLikeAbusiveAscii(value: string) {
  const chars = [...value];
  if (chars.length < 36) return false;
  const symbolCount = chars.filter(ch => /[^\p{L}\p{N}\s.,!?;:'"-]/u.test(ch)).length;
  const lines = value.split("\n").length;
  if (lines > 4) return true;
  if (symbolCount / chars.length > 0.46) return true;
  if (/(.)\1{11,}/u.test(value)) return true;
  return false;
}

function safeIp(req: Request) {
  const cf = req.headers.get("cf-connecting-ip")?.trim();
  if (cf) return cf;
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const forwarded = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded) return forwarded;
  return "unknown";
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, "0")).join("");
}

async function limited(key: string, max: number, seconds: number) {
  const { data, error } = await admin.rpc("check_rate_limit", {
    p_key: key,
    p_max: max,
    p_window_seconds: seconds
  });
  if (error) throw error;
  return data === true;
}

async function maybePrune() {
  if (Math.random() < 0.03) await admin.rpc("prune_chat_data");
}

async function handleGet(req: Request) {
  const room = new URL(req.url).searchParams.get("room")?.trim() || "";
  if (!validRoom(room)) return response({ error: "Sala inválida." }, 400);
  const { data, error } = await admin
    .from("chat_messages")
    .select("id,room_id,client_id,name,content,created_at")
    .eq("room_id", room)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return response({ error: "Não foi possível carregar a sala." }, 500);
  return response({ messages: (data || []).reverse() });
}

async function handlePost(req: Request) {
  const ipHash = await sha256(safeIp(req) + ":chat-no-login-v1");
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") return response({ error: "JSON inválido." }, 400);

  const source = body as Record<string, unknown>;
  const room = normalizeText(source.room, 48);
  const name = normalizeText(source.name, 24);
  const message = normalizeText(source.message, 200);
  const clientId = normalizeText(source.clientId, 128);

  if (!validRoom(room)) return response({ error: "Sala inválida." }, 400);
  if (!name || name.length > 24) return response({ error: "Nome inválido." }, 400);
  if (!message || [...message].length > 200) return response({ error: "A mensagem deve ter de 1 a 200 caracteres." }, 400);
  if (!clientId || clientId.length < 8) return response({ error: "Sessão inválida." }, 400);
  if (looksLikeAbusiveAscii(message)) return response({ error: "Mensagem bloqueada: reduza caracteres repetidos/símbolos e mantenha o texto simples." }, 422);
  if (/(?:https?:\/\/|www\.)/i.test(message)) return response({ error: "Links não são permitidos neste chat." }, 422);

  const roomKey = await sha256(`${ipHash}:${room}`);
  const globalKey = await sha256(`${ipHash}:global`);
  const roomOk = await limited(roomKey, 8, 10);
  const globalOk = await limited(globalKey, 50, 60);
  if (!roomOk || !globalOk) return response({ error: "Você está enviando mensagens rápido demais. Espere um pouco." }, 429);

  const { data, error } = await admin
    .from("chat_messages")
    .insert({ room_id: room, client_id: clientId, name, content: message })
    .select("id,room_id,client_id,name,content,created_at")
    .single();

  if (error || !data) return response({ error: "Não foi possível enviar a mensagem." }, 500);

  await maybePrune();

  const topic = encodeURIComponent(`chat:${room}`);
  const broadcastUrl = `${supabaseUrl}/realtime/v1/api/broadcast/${topic}/events/message`;
  const broadcast = await fetch(broadcastUrl, {
    method: "POST",
    headers: { "apikey": serviceKey, "Content-Type": "application/json" },
    body: JSON.stringify(data)
  });
  if (!broadcast.ok) return response({ error: "Mensagem salva, mas a entrega em tempo real falhou. Atualize a sala." }, 202);

  return response({ message: data });
}

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers });
  try {
    if (req.method === "GET") return await handleGet(req);
    if (req.method === "POST") return await handlePost(req);
    return response({ error: "Método não permitido." }, 405);
  } catch {
    return response({ error: "Erro interno." }, 500);
  }
});
