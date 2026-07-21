/**
 * Unit tests for static/js/utils.js — PII masking utility.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithTimeout, maskPII, validateGmailSender } from "../../static/js/utils.js";

describe("maskPII", () => {
  // ---------------------------------------------------------------------------
  // Passthrough cases
  // ---------------------------------------------------------------------------
  it("returns null unchanged", () => {
    expect(maskPII(null)).toBeNull();
  });

  it("returns undefined unchanged", () => {
    expect(maskPII(undefined)).toBeUndefined();
  });

  it("returns empty string unchanged", () => {
    expect(maskPII("")).toBe("");
  });

  it("leaves non-PII text unchanged", () => {
    expect(maskPII("Grocery at Swiggy")).toBe("Grocery at Swiggy");
  });

  // ---------------------------------------------------------------------------
  // Phone numbers
  // ---------------------------------------------------------------------------
  it("masks standalone 10-digit Indian mobile number", () => {
    expect(maskPII("9876543210")).toBe("*******210");
  });

  it("masks phone number embedded in a sentence", () => {
    expect(maskPII("Call 9876543210 now")).toBe("Call *******210 now");
  });

  it("masks partial phone with uppercase X", () => {
    expect(maskPII("98765XXXXX")).toBe("[PHONE]");
  });

  it("masks partial phone with lowercase x", () => {
    expect(maskPII("98765xxxxx")).toBe("[PHONE]");
  });

  it("masks partial phone with asterisks", () => {
    expect(maskPII("98765*****")).toBe("[PHONE]");
  });

  // ---------------------------------------------------------------------------
  // Email addresses
  // ---------------------------------------------------------------------------
  it("masks email local part keeping first char and domain", () => {
    expect(maskPII("user@bank.com")).toBe("us**@bank.com");
  });

  it("masks email with single char local part", () => {
    expect(maskPII("a@b.com")).toBe("a**@b.com");
  });

  // ---------------------------------------------------------------------------
  // PAN cards
  // ---------------------------------------------------------------------------
  it("masks PAN card number", () => {
    expect(maskPII("ABCDE1234F")).toBe("[PAN]");
  });

  it("masks PAN in a sentence", () => {
    expect(maskPII("PAN: ABCDE1234F")).toBe("PAN: [PAN]");
  });

  // ---------------------------------------------------------------------------
  // Aadhaar
  // ---------------------------------------------------------------------------
  it("masks Aadhaar in bank-masked format with spaces", () => {
    expect(maskPII("XXXX XXXX 1234")).toBe("[AADHAAR]");
  });

  it("masks Aadhaar in bank-masked format with hyphens", () => {
    expect(maskPII("XXXX-XXXX-1234")).toBe("[AADHAAR]");
  });

  // ---------------------------------------------------------------------------
  // Salutation + name
  // ---------------------------------------------------------------------------
  it("masks first name after salutation", () => {
    expect(maskPII("Dear Mr. Ashok")).toBe("Dear Mr. As***");
  });

  it("masks full name after salutation", () => {
    expect(maskPII("Dear Ms. Priya Sharma")).toBe("Dear Ms. Pr*** Sh****");
  });

  // ---------------------------------------------------------------------------
  // Labelled name fields
  // ---------------------------------------------------------------------------
  it("masks name after To: label", () => {
    expect(maskPII("To: John Doe")).toBe("To: Jo** Do*");
  });

  it("masks name after From: label", () => {
    expect(maskPII("From: Ramesh Kumar")).toBe("From: Ra**** Ku***");
  });

  // ---------------------------------------------------------------------------
  // 11-digit phone with leading zero
  // ---------------------------------------------------------------------------
  it("masks 11-digit phone with leading zero", () => {
    expect(maskPII("09876543210")).toBe("0*******210");
  });

  it("masks 11-digit phone with leading zero in a sentence", () => {
    const result = maskPII("Call me at 09876543210 please");
    expect(result).not.toContain("09876543210");
    expect(result).toContain("0*******210");
  });

  // ---------------------------------------------------------------------------
  // 12-digit phone with country code 91
  // ---------------------------------------------------------------------------
  it("masks 12-digit phone with country code 91", () => {
    expect(maskPII("919876543210")).toBe("91*******210");
  });

  it("masks 12-digit phone with country code 91 in a sentence", () => {
    const result = maskPII("My number is 919876543210");
    expect(result).not.toContain("919876543210");
    expect(result).toContain("91*******210");
  });

  // ---------------------------------------------------------------------------
  // Full unmasked Aadhaar
  // ---------------------------------------------------------------------------
  it("masks full Aadhaar number with spaces", () => {
    expect(maskPII("1234 5678 9012")).toBe("[AADHAAR]");
  });

  it("masks full Aadhaar number with hyphens", () => {
    expect(maskPII("1234-5678-9012")).toBe("[AADHAAR]");
  });

  it("masks full Aadhaar in a sentence", () => {
    const result = maskPII("Aadhaar: 1234 5678 9012");
    expect(result).not.toContain("1234 5678 9012");
    expect(result).toContain("[AADHAAR]");
  });

  // ---------------------------------------------------------------------------
  // Transfer / Received / Sent — no colon
  // ---------------------------------------------------------------------------
  it("masks name in 'Transfer from Ashok Kumar'", () => {
    const result = maskPII("Transfer from Ashok Kumar");
    expect(result).not.toContain("Ashok");
    expect(result).not.toContain("Kumar");
    expect(result).toContain("Transfer from");
  });

  it("masks name in 'Received from Priya'", () => {
    const result = maskPII("Received from Priya");
    expect(result).not.toContain("Priya");
    expect(result).toContain("Received from");
  });

  it("masks name in 'Sent to Ramesh'", () => {
    const result = maskPII("Sent to Ramesh");
    expect(result).not.toContain("Ramesh");
    expect(result).toContain("Sent to");
  });

  it("masks name in 'Payment to Anita Sharma'", () => {
    const result = maskPII("Payment to Anita Sharma");
    expect(result).not.toContain("Anita");
    expect(result).not.toContain("Sharma");
    expect(result).toContain("Payment to");
  });

  // ---------------------------------------------------------------------------
  // Multiple PII types in one string
  // ---------------------------------------------------------------------------
  it("masks both phone and email in same string", () => {
    const result = maskPII("Phone: 9876543210, Email: foo@bar.com");
    expect(result).not.toContain("9876543210");
    expect(result).not.toContain("foo@bar.com");
    expect(result).toContain("*******210");
    expect(result).toContain("fo**@bar.com");
    expect(result).toContain("Phone: ");
    expect(result).toContain("Email: ");
  });

  it("masks UPI handles", () => {
    expect(maskPII("paytm-blinkit@ptybl")).toBe("pa***@[UPI]");
  });

  it("masks labelled account identifiers", () => {
    expect(maskPII("Account No: 123456789012")).toBe("Account No: [REDACTED]");
  });

  it("masks labelled UPI references", () => {
    expect(maskPII("UPI Ref: 1234ABCD5678")).toBe("UPI Ref: [REDACTED]");
  });

  it("masks labelled bank or source names", () => {
    expect(maskPII("Bank/Source: HDFC Savings")).toBe("Bank/Source: HD** Sa*****");
  });
});

// ---------------------------------------------------------------------------
// fetchWithTimeout — BUG-NET-01
// ---------------------------------------------------------------------------
describe("fetchWithTimeout", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("resolves when fetch succeeds within timeout", async () => {
    const mockResponse = { ok: true, status: 200 };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(mockResponse));

    const result = await fetchWithTimeout("https://example.com");

    expect(result).toEqual(mockResponse);
  });

  it("rejects with AbortError when timeout expires", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation((_url, opts) => {
        return new Promise((_resolve, reject) => {
          opts?.signal?.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted", "AbortError"));
          });
        });
      }),
    );

    const promise = fetchWithTimeout("https://example.com", {}, 50);
    vi.advanceTimersByTime(50);

    await expect(promise).rejects.toThrow();
  });

  it("passes url and options to fetch", async () => {
    const mockResponse = { ok: true, status: 201 };
    const mockFetch = vi.fn().mockResolvedValue(mockResponse);
    vi.stubGlobal("fetch", mockFetch);

    await fetchWithTimeout("https://example.com", { method: "POST" });

    expect(mockFetch).toHaveBeenCalledWith(
      "https://example.com",
      expect.objectContaining({ method: "POST", signal: expect.any(AbortSignal) }),
    );
  });

  it("clears the timer on success", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");

    await fetchWithTimeout("https://example.com");

    expect(clearTimeoutSpy).toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// validateGmailSender — SEC-HIGH-1 Gmail query injection prevention
// ---------------------------------------------------------------------------
describe("validateGmailSender", () => {
  it("accepts a plain email address", () => {
    expect(validateGmailSender("alerts@hdfc.bank.in")).toBe(true);
  });

  it("accepts a domain-glob pattern (*@domain.net)", () => {
    expect(validateGmailSender("*@hdfcbank.net")).toBe(true);
  });

  it("accepts another valid email address", () => {
    expect(validateGmailSender("noreply@sbi.co.in")).toBe(true);
  });

  it("rejects a Gmail query injection attempt with special chars", () => {
    expect(validateGmailSender("bank@evil.com) OR (is:unread")).toBe(false);
  });

  it("rejects a value with no @ sign", () => {
    expect(validateGmailSender("notanemail")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(validateGmailSender("")).toBe(false);
  });

  it("rejects a local part containing a space", () => {
    expect(validateGmailSender("a b@example.com")).toBe(false);
  });

  it("rejects a value with no local part (starts with @)", () => {
    expect(validateGmailSender("@example.com")).toBe(false);
  });

  it("rejects a domain with no TLD (no dot after @)", () => {
    expect(validateGmailSender("user@domain")).toBe(false);
  });
});
