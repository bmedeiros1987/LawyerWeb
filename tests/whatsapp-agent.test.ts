import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildWhatsAppPairingLink,
  extractWhatsAppMessages,
  verifyWhatsAppSignature,
} from "@/lib/agent/whatsapp";

describe("WhatsApp Agent helpers", () => {
  it("verifica a assinatura HMAC do webhook sem aceitar assinatura adulterada", () => {
    const secret = "meta-app-secret-test";
    const body = JSON.stringify({ object: "whatsapp_business_account", entry: [] });
    const signature = "sha256=" + crypto.createHmac("sha256", secret).update(body).digest("hex");

    expect(verifyWhatsAppSignature(body, signature, secret)).toBe(true);
    expect(verifyWhatsAppSignature(body + "x", signature, secret)).toBe(false);
    expect(verifyWhatsAppSignature(body, null, secret)).toBe(false);
  });

  it("extrai somente os campos necessários de mensagens recebidas", () => {
    const payload = {
      object: "whatsapp_business_account",
      entry: [{
        id: "waba",
        changes: [{
          field: "messages",
          value: {
            metadata: { phone_number_id: "123456789" },
            contacts: [{ wa_id: "5511999999999", profile: { name: "Usuário Teste" } }],
            messages: [{
              id: "wamid.abc",
              from: "5511999999999",
              type: "text",
              text: { body: "Quais são meus prazos?" },
            }],
          },
        }],
      }],
    };

    expect(extractWhatsAppMessages(payload)).toEqual([{
      eventId: "wamid.abc",
      waId: "5511999999999",
      text: "Quais são meus prazos?",
      type: "text",
      displayName: "Usuário Teste",
      phoneNumberId: "123456789",
    }]);
    expect(extractWhatsAppMessages({ entry: [{ changes: [{ value: { messages: [{}] } }] }] })).toEqual([]);
  });

  it("gera link de pareamento para o número oficial sem expor o código fora da mensagem", () => {
    const link = buildWhatsAppPairingLink("+55 (61) 99999-0000", "abc_DEF-123");
    expect(link).toBe("https://wa.me/5561999990000?text=MBLZ%20abc_DEF-123");
  });
});
