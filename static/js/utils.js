/**
 * utils.js — Shared utility functions for Financial Coach PWA.
 */

/**
 * Masks PII in a text string before it is sent to an external LLM.
 * Raw data in IndexedDB is never touched — masking is prompt-build-time only.
 *
 * Handles: Indian mobile numbers, partial phones, email addresses,
 * PAN cards, Aadhaar, salutation+name patterns, labelled name fields.
 * Name detection is best-effort via regex (not NER).
 *
 * @param {string|null|undefined} text
 * @returns {string|null|undefined} — same type as input
 */
export function maskPII(text) {
  if (!text) return text;

  // Helper: mask a name — show first 2 chars, rest as asterisks (min 1)
  const maskName = (name) => name.slice(0, 2) + "*".repeat(Math.max(1, name.length - 2));

  return (
    text
      // 10-digit Indian mobile numbers (start 6-9)
      .replace(/\b([6-9]\d{6})(\d{3})\b/g, (_m, prefix, last3) => "*".repeat(prefix.length) + last3)
      // Partially masked phones like "98765XXXXX" or "98765*****"
      .replace(/(?<!\w)\d{5}[Xx*]{5}(?!\w)/g, "[PHONE]")
      // Email addresses — mask local part, keep domain
      .replace(
        /([a-zA-Z0-9]{1,2})[a-zA-Z0-9._%+-]*@([a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/g,
        (_m, first, domain) => `${first}**@${domain}`,
      )
      // PAN card (Indian): 5 uppercase letters, 4 digits, 1 uppercase letter
      .replace(/\b[A-Z]{5}[0-9]{4}[A-Z]\b/g, "[PAN]")
      // Aadhaar in bank-masked format: "XXXX XXXX 1234" or "XXXX-XXXX-1234"
      .replace(/\bXXXX[\s-]XXXX[\s-]\d{4}\b/gi, "[AADHAAR]")
      // Full Aadhaar number: "1234 5678 9012" or "1234-5678-9012"
      .replace(/\b(\d{4})[\s-](\d{4})[\s-](\d{4})\b/g, "[AADHAAR]")
      // 12-digit phone with country code 91 prefix
      .replace(
        /\b91([6-9]\d{6})(\d{3})\b/g,
        (_m, prefix, last3) => `91${"*".repeat(prefix.length)}${last3}`,
      )
      // 11-digit phone with leading zero
      .replace(
        /\b0([6-9]\d{6})(\d{3})\b/g,
        (_m, prefix, last3) => `0${"*".repeat(prefix.length)}${last3}`,
      )
      // "Transfer from Name", "Received from Priya", "Sent to Ramesh Kumar" (no colon)
      .replace(
        /\b((?:Transfer|Received|Payment|Sent)\s+(?:from|to)\s+)([A-Z][a-z]{2,})(\s+[A-Z][a-z]{2,})?/gi,
        (_m, keyword, first, last) => {
          const mFirst = maskName(first);
          const mLast = last ? ` ${maskName(last.trim())}` : "";
          return `${keyword}${mFirst}${mLast}`;
        },
      )
      // Salutation + name: "Dear Mr. Ashok" or "Dear Mr. Ashok Kumar"
      .replace(
        /\b(Dear\s+(?:Mr\.|Mrs\.|Ms\.|Dr\.|Sir|Madam))\s+([A-Z][a-z]+)(\s+[A-Z][a-z]+)?/g,
        (_m, salutation, first, last) => {
          const mFirst = maskName(first);
          const mLast = last ? ` ${maskName(last.trim())}` : "";
          return `${salutation} ${mFirst}${mLast}`;
        },
      )
      // Labelled name fields: "To: John Doe", "From: Ramesh Kumar", "Account holder: Jane"
      .replace(
        /\b((?:To|From|Account\s+holder|Payee|Beneficiary|Name)\s*:\s*)([A-Z][a-z]{2,})(\s+[A-Z][a-z]{2,})?/g,
        (_m, prefix, first, last) => {
          const mFirst = maskName(first);
          const mLast = last ? ` ${maskName(last.trim())}` : "";
          return `${prefix}${mFirst}${mLast}`;
        },
      )
  );
}

/**
 * Wraps fetch with an AbortController timeout.
 * Throws a DOMException with name "AbortError" if the request exceeds timeoutMs.
 *
 * @param {string|URL} url
 * @param {RequestInit} [options]
 * @param {number} [timeoutMs=30000]
 * @returns {Promise<Response>}
 */
export async function fetchWithTimeout(url, options = {}, timeoutMs = 30000) {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(id);
  }
}

/**
 * Validates a Gmail sender value before inserting it into a Gmail API query.
 * Accepts email addresses and domain-glob patterns (e.g. *@hdfc.net).
 * Rejects anything containing Gmail query meta-characters.
 * @param {string} value
 * @returns {boolean}
 */
export function validateGmailSender(value) {
  return /^[\w.*+-]+@[\w.-]+\.[a-z]{2,}$/i.test(value);
}
