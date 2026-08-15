// supabase/functions/send-email/index.ts
//
// Sends the two email types ExpoShare needs:
//   - "moderation": a presentation was approved / rejected / had
//     changes requested / was hidden. Recipient's email is looked up
//     server-side via the Admin API (never exposed to the browser).
//   - "contact_reply": an admin replied to a contact-form message.
//     Recipient email comes straight from the message row.
//
// SETUP (required before this does anything):
//   1. Create a free account at https://resend.com and verify a
//      sending domain (or use their onboarding test domain while
//      developing).
//   2. supabase secrets set RESEND_API_KEY=your_resend_key
//   3. supabase secrets set SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
//      (Project Settings -> API -> service_role. This is only ever
//      read inside this server-side function, never shipped to the
//      browser -- that's the whole point of Edge Functions.)
//   4. Optionally: supabase secrets set NOTIFICATIONS_FROM_EMAIL="ExpoShare <notifications@yourdomain.com>"
//   5. supabase functions deploy send-email
//
// Until secrets are configured, this function returns a clear error
// and every caller in admin.js catches that error silently -- so
// missing email setup never blocks the in-app notification, which is
// always saved to the database regardless.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const FROM_EMAIL = Deno.env.get("NOTIFICATIONS_FROM_EMAIL") || "ExpoShare <onboarding@resend.dev>";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

const STATUS_LABEL: Record<string, string> = {
  approved: "approved",
  rejected: "rejected",
  changes_requested: "sent back for changes",
  hidden: "hidden"
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });

  if (!RESEND_API_KEY || !SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json({ error: "Email sending is not configured on the server yet." }, 500);
  }

  try {
    const body = await req.json();
    const { type } = body;

    let to: string;
    let subject: string;
    let html: string;

    if (type === "moderation") {
      const { user_id, title, status, note } = body;
      if (!user_id || !title || !status) return json({ error: "Missing fields for moderation email." }, 400);

      const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
      const { data: userRes, error: userErr } = await admin.auth.admin.getUserById(user_id);
      if (userErr || !userRes?.user?.email) return json({ error: "Could not resolve recipient email." }, 400);

      to = userRes.user.email;
      const statusText = STATUS_LABEL[status] || status;
      subject = `Your presentation "${title}" was ${statusText}`;
      html = `
        <p>Hi,</p>
        <p>Your presentation <strong>${escapeHtml(title)}</strong> was <strong>${escapeHtml(statusText)}</strong> on ExpoShare.</p>
        ${note ? `<p><strong>Reviewer note:</strong> ${escapeHtml(note)}</p>` : ""}
        <p>You can view the details from your ExpoShare profile.</p>
        <p style="color:#888;font-size:12px;">ExpoShare</p>
      `;
    } else if (type === "contact_reply") {
      const { to_email, name, original_message, reply } = body;
      if (!to_email || !reply) return json({ error: "Missing fields for contact reply email." }, 400);

      to = to_email;
      subject = "Reply from ExpoShare";
      html = `
        <p>Hi ${escapeHtml(name || "")},</p>
        <p>You received a reply to your message on ExpoShare:</p>
        <blockquote style="border-left:3px solid #B2D5E5;margin:0;padding-left:12px;color:#222;">${escapeHtml(reply)}</blockquote>
        ${original_message ? `<p style="color:#888;font-size:13px;margin-top:16px;">Your original message: ${escapeHtml(original_message)}</p>` : ""}
        <p style="color:#888;font-size:12px;">ExpoShare</p>
      `;
    } else {
      return json({ error: "Unknown email type." }, 400);
    }

    const resendRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ from: FROM_EMAIL, to, subject, html })
    });

    if (!resendRes.ok) {
      const errText = await resendRes.text();
      return json({ error: "Email provider rejected the request.", detail: errText }, 502);
    }

    return json({ success: true });
  } catch (err) {
    return json({ error: String(err) }, 500);
  }
});

function escapeHtml(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

function json(obj: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" }
  });
}
