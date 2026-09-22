-- 00013: delivery receipts
--
-- Outbound WhatsApp messages now carry a Twilio StatusCallback; the
-- webhook (lib/whatsapp/status-callback.ts → delivery.ts) records queued → sent → delivered →
-- read on whatsapp_messages.status (text, no change needed) and, when a
-- message fails (e.g. 63016: sent outside WhatsApp's 24-hour window), raises
-- an alert of this new type so the nurse sees "WhatsApp message not
-- delivered" rather than a generic escalation.
--
-- The code falls back to type 'escalation' until this is applied.

ALTER TYPE alert_type ADD VALUE IF NOT EXISTS 'delivery_failed';
