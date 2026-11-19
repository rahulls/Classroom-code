// WhatsApp in v1 is manual (R9): the module prepares the text and a wa.me link, the tutor sends it from
// the Business app and marks it sent. A future API provider plugs in behind this interface.

export interface WhatsAppSender {
  /** Manual: returns the link to open. An API adapter would send and return null. */
  prepare(toE164: string, text: string): { waLink: string | null };
}

export const waLink = (toE164: string, text: string) => `https://wa.me/${toE164.replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;

export const manualWhatsApp: WhatsAppSender = {
  prepare: (to, text) => ({ waLink: waLink(to, text) }),
};

export const whatsapp: WhatsAppSender = manualWhatsApp;
