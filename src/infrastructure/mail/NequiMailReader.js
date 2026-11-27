import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { parseNequiEmail } from "./NequiEmailParser.js";

// Lector IMAP: se conecta a un buzón, busca correos recientes y extrae los
// candidatos a pago recibido de Nequi. No conoce reglas de negocio ni la BD.
export class NequiMailReader {
  constructor(cfg = {}) {
    this.cfg = cfg;
  }

  get configured() {
    return !!(this.cfg && this.cfg.enabled);
  }

  async fetchPaymentCandidates() {
    const cfg = this.cfg || {};
    if (!this.configured) {
      return { configured: false, scanned: 0, candidates: [] };
    }

    const client = new ImapFlow({
      host: cfg.imapHost,
      port: cfg.imapPort,
      secure: cfg.imapSecure,
      auth: { user: cfg.imapUser, pass: cfg.imapPass },
      logger: false,
    });

    const candidates = [];
    let scanned = 0;

    await client.connect();
    try {
      const lock = await client.getMailboxLock(cfg.mailbox);
      try {
        const since = new Date(Date.now() - Math.max(1, cfg.sinceDays) * 86400000);
        const fromFilter = String(cfg.fromFilter || "").toLowerCase();

        for await (const msg of client.fetch({ since }, { source: true, envelope: true, uid: true })) {
          scanned++;
          let parsed;
          try {
            parsed = await simpleParser(msg.source);
          } catch {
            continue;
          }

          const from = parsed.from?.text || msg.envelope?.from?.[0]?.address || "";
          if (fromFilter && !String(from).toLowerCase().includes(fromFilter)) continue;

          const mailDate = parsed.date || msg.envelope?.date || new Date();
          const result = parseNequiEmail({
            subject: parsed.subject || "",
            text: parsed.text || "",
            html: typeof parsed.html === "string" ? parsed.html : "",
            date: mailDate,
            from,
          });

          if (result && result.isPayment) {
            const messageId =
              parsed.messageId ||
              `${from}|${mailDate.toISOString()}|${result.amount}`;
            candidates.push({
              amount: result.amount,
              detectedDate: result.detectedDate,
              detectedTime: result.detectedTime || "",
              snippet: result.snippet,
              from: result.from,
              payerName: result.payerName,
              subject: String(parsed.subject || "").slice(0, 200),
              messageId: String(messageId).slice(0, 300),
            });
          }
        }
      } finally {
        lock.release();
      }
    } finally {
      try {
        await client.logout();
      } catch {
        try { client.close(); } catch { /* ignore */ }
      }
    }

    return { configured: true, scanned, candidates };
  }
}
