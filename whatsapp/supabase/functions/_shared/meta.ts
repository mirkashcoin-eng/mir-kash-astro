// Meta WhatsApp Cloud API — send one approved template message.
// The access token + API version come from function secrets (never hard-coded).

const API_VERSION = Deno.env.get("META_API_VERSION") || "v21.0";

export interface SendResult {
  ok: boolean;
  messageId?: string;
  status: number;
  request: unknown;
  response: unknown;
}

export async function sendTemplate(opts: {
  phoneNumberId: string;
  to: string;
  templateName: string;
  language: string;
  bodyParams: string[];
}): Promise<SendResult> {
  const token = Deno.env.get("META_ACCESS_TOKEN");
  const body = {
    messaging_product: "whatsapp",
    to: opts.to,
    type: "template",
    template: {
      name: opts.templateName,
      language: { code: opts.language },
      components: [
        {
          type: "body",
          parameters: opts.bodyParams.map((text) => ({ type: "text", text })),
        },
      ],
    },
  };

  const url = `https://graph.facebook.com/${API_VERSION}/${opts.phoneNumberId}/messages`;
  let status = 0;
  let json: any = {};
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Authorization": `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    status = res.status;
    json = await res.json().catch(() => ({}));
  } catch (err) {
    return { ok: false, status: 0, request: body, response: { error: String(err) } };
  }

  const messageId = json?.messages?.[0]?.id;
  return { ok: status >= 200 && status < 300 && !!messageId, messageId, status, request: body, response: json };
}
