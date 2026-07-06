// tests/e2e/js/settings.spec.js
import { test, expect } from "./fixtures.js";

async function goSettings(page) {
  await page.evaluate(() => {
    window.location.hash = "#/settings";
  });
  await page.waitForSelector("#screen");
}

async function getOptionValues(locator) {
  const count = await locator.count();
  return await Promise.all(
    Array.from({ length: count }, (_, i) => locator.nth(i).getAttribute("value")),
  );
}

async function getOptionTexts(locator) {
  const count = await locator.count();
  return await Promise.all(Array.from({ length: count }, (_, i) => locator.nth(i).innerText()));
}

test.describe("TestSettingsPage", () => {
  test.beforeEach(async ({ pwaPage }) => {
    await goSettings(pwaPage);
  });

  test("settings page loads", async ({ pwaPage }) => {
    const text = await pwaPage.innerText("body");
    expect(text.toLowerCase()).toContain("settings");
  });

  test("settings form fields exist", async ({ pwaPage }) => {
    const providerSelect = pwaPage.locator("#ai-provider");
    expect(await providerSelect.count()).toBe(1);
    const options = providerSelect.locator("option");
    const optionTexts = await getOptionTexts(options);
    expect(optionTexts.some((t) => t.toLowerCase().includes("groq"))).toBeTruthy();
    expect(optionTexts.some((t) => t.toLowerCase().includes("openai"))).toBeTruthy();
    expect(optionTexts.some((t) => t.toLowerCase().includes("ollama"))).toBeTruthy();

    const apiKeyInput = pwaPage.locator("#ai-api-key");
    expect(await apiKeyInput.count()).toBe(1);
    expect(await apiKeyInput.getAttribute("type")).toBe("password");

    const modelSelect = pwaPage.locator("#ai-model");
    expect(await modelSelect.count()).toBe(1);
  });

  test("settings action buttons exist", async ({ pwaPage }) => {
    const saveBtn = pwaPage.locator("button:has-text('Save Settings')");
    expect(await saveBtn.count()).toBe(1);

    const testBtn = pwaPage.locator("button:has-text('Test Connection')");
    expect(await testBtn.count()).toBe(1);

    // Privacy notice is an info-notice icon (aria-label), not visible text
    const privacyNotice = pwaPage.locator("[aria-label='Privacy notice']");
    expect(await privacyNotice.count()).toBeGreaterThan(0);
    // Tooltip text (visibility:hidden, use textContent not innerText)
    const tooltip = privacyNotice.locator(".info-notice-tooltip");
    const tooltipText = (await tooltip.textContent()) ?? "";
    expect(
      ["raw data", "masked", "masking", "automatically masked"].some((phrase) =>
        tooltipText.toLowerCase().includes(phrase),
      ),
    ).toBeTruthy();
  });

  test("provider change updates models", async ({ pwaPage }) => {
    await pwaPage.selectOption("#ai-provider", "groq");
    await pwaPage.waitForTimeout(300);
    const groqModels = pwaPage.locator("#ai-model-options option");
    const groqValues = await getOptionValues(groqModels);

    await pwaPage.selectOption("#ai-provider", "openai");
    await pwaPage.waitForTimeout(300);
    const openaiModels = pwaPage.locator("#ai-model-options option");
    const openaiValues = await getOptionValues(openaiModels);

    expect(groqValues).not.toEqual(openaiValues);
  });

  test("api key hidden for ollama", async ({ pwaPage }) => {
    await pwaPage.selectOption("#ai-provider", "ollama");
    await pwaPage.waitForTimeout(300);

    const keyField = pwaPage.locator("#api-key-field");
    expect(await keyField.count()).toBe(1);
    const display = await keyField.evaluate((el) => getComputedStyle(el).display);
    expect(display).toBe("none");
  });

  test("save settings shows toast", async ({ pwaPage }) => {
    await pwaPage.selectOption("#ai-provider", "groq");
    await pwaPage.waitForTimeout(300);

    await pwaPage.locator("button:has-text('Save Settings')").click();
    await pwaPage.waitForTimeout(500);

    const bodyText = await pwaPage.innerText("body");
    expect(
      bodyText.toLowerCase().includes("saved") ||
        bodyText.toLowerCase().includes("settings saved"),
    ).toBeTruthy();
  });
});

test.describe("TestSettingsNavigation", () => {
  test("settings accessible from overflow menu", async ({ pwaPage }) => {
    await pwaPage.setViewportSize({ width: 375, height: 667 });

    await pwaPage.evaluate(() => {
      window.location.hash = "#/";
    });
    await pwaPage.waitForSelector("#screen");

    const moreBtn = pwaPage.locator(".nav-more-btn");
    if (!(await moreBtn.isVisible())) {
      return; // Skip: Overflow menu button not visible at current viewport
    }
    await moreBtn.click();
    await pwaPage.waitForTimeout(300);

    const settingsBtn = pwaPage.locator(
      '.nav-overflow-menu .nav-overflow-item[data-route="#/settings"]',
    );
    expect(await settingsBtn.count()).toBe(1);
    await settingsBtn.click();
    await pwaPage.waitForSelector("#ai-provider");

    const text = await pwaPage.innerText("body");
    expect(text.toLowerCase()).toContain("settings");
  });

  test("settings route direct navigation", async ({ pwaPage }) => {
    await goSettings(pwaPage);

    const text = await pwaPage.innerText("body");
    expect(text.toLowerCase()).toContain("ai settings");
  });
});

test.describe("TestSettingsDataManagement", () => {
  test.beforeEach(async ({ pwaPage }) => {
    await goSettings(pwaPage);
  });

  test("settings has data management section", async ({ pwaPage }) => {
    const text = await pwaPage.innerText("body");
    expect(text.toLowerCase()).toContain("data management");
  });

  test("settings has export data button", async ({ pwaPage }) => {
    const exportBtn = pwaPage.locator("button:has-text('Export Data')");
    expect(await exportBtn.count()).toBe(1);
  });

  test("settings has export csv button", async ({ pwaPage }) => {
    const csvBtn = pwaPage.locator("button:has-text('Export CSV')");
    expect(await csvBtn.count()).toBe(1);
  });

  test("settings has import backup input", async ({ pwaPage }) => {
    const fileInput = pwaPage.locator("input[type='file'][accept='.db,.sqlite,.sqlite3']");
    expect(await fileInput.count()).toBe(1);
  });
});

test.describe("TestProviderDropdownOptions", () => {
  test("provider dropdown contains gemini and azure", async ({ pwaPage }) => {
    await goSettings(pwaPage);

    const providerSelect = pwaPage.locator("#ai-provider");
    const options = providerSelect.locator("option");
    const values = await getOptionValues(options);
    const texts = await getOptionTexts(options);
    expect(
      values.some((v) => (v || "").toLowerCase().includes("gemini")) ||
        texts.some((t) => t.toLowerCase().includes("gemini")),
    ).toBeTruthy();
    expect(
      values.some((v) => (v || "").toLowerCase().includes("azure")) ||
        texts.some((t) => t.toLowerCase().includes("azure")),
    ).toBeTruthy();
  });
});

test.describe("TestAzureProviderSettings", () => {
  test.beforeEach(async ({ pwaPage }) => {
    await goSettings(pwaPage);
  });

  test("azure fields hidden by default", async ({ pwaPage }) => {
    const azureFields = pwaPage.locator("#azure-fields");
    expect(await azureFields.count()).toBe(1);
    const display = await azureFields.evaluate((el) => getComputedStyle(el).display);
    expect(display).toBe("none");
  });

  test("azure fields shown when azure selected", async ({ pwaPage }) => {
    await pwaPage.selectOption("#ai-provider", "azure");
    await pwaPage.waitForTimeout(300);

    const azureFields = pwaPage.locator("#azure-fields");
    const display = await azureFields.evaluate((el) => getComputedStyle(el).display);
    expect(display).not.toBe("none");

    expect(await pwaPage.locator("#azure-resource-name").count()).toBe(1);
    expect(await pwaPage.locator("#azure-deployment-name").count()).toBe(1);
    expect(await pwaPage.locator("#azure-api-version").count()).toBe(1);
  });

  test("azure fields hidden when switching away", async ({ pwaPage }) => {
    await pwaPage.selectOption("#ai-provider", "azure");
    await pwaPage.waitForTimeout(300);

    await pwaPage.selectOption("#ai-provider", "groq");
    await pwaPage.waitForTimeout(300);

    const azureFields = pwaPage.locator("#azure-fields");
    const display = await azureFields.evaluate((el) => getComputedStyle(el).display);
    expect(display).toBe("none");
  });

  test("model dropdown disabled for azure", async ({ pwaPage }) => {
    await pwaPage.selectOption("#ai-provider", "azure");
    await pwaPage.waitForTimeout(300);

    const modelSel = pwaPage.locator("#ai-model");
    const isDisabled = await modelSel.evaluate((el) => el.disabled);
    expect(isDisabled).toBe(true);
  });

  test("azure fields hidden for gemini", async ({ pwaPage }) => {
    await pwaPage.selectOption("#ai-provider", "gemini");
    await pwaPage.waitForTimeout(300);

    const azureFields = pwaPage.locator("#azure-fields");
    const display = await azureFields.evaluate((el) => getComputedStyle(el).display);
    expect(display).toBe("none");

    const modelSel = pwaPage.locator("#ai-model");
    const isDisabled = await modelSel.evaluate((el) => el.disabled);
    expect(isDisabled).toBe(false);
  });
});

test.describe("TestGeminiProviderSettings", () => {
  test("gemini appears in provider dropdown", async ({ pwaPage }) => {
    await goSettings(pwaPage);

    const providerSelect = pwaPage.locator("#ai-provider");
    const options = providerSelect.locator("option");
    const values = await getOptionValues(options);
    expect(values).toContain("gemini");
  });

  test("gemini model dropdown populated", async ({ pwaPage }) => {
    await goSettings(pwaPage);

    await pwaPage.selectOption("#ai-provider", "gemini");
    await pwaPage.waitForTimeout(300);

    const modelOptions = pwaPage.locator("#ai-model-options option");
    const modelValues = await getOptionValues(modelOptions);
    expect(modelValues.some((v) => (v || "").toLowerCase().includes("gemini"))).toBeTruthy();
  });

  test("gemini requires api key field", async ({ pwaPage }) => {
    await goSettings(pwaPage);

    await pwaPage.selectOption("#ai-provider", "gemini");
    await pwaPage.waitForTimeout(300);

    const keyField = pwaPage.locator("#api-key-field");
    expect(await keyField.count()).toBe(1);
    const display = await keyField.evaluate((el) => getComputedStyle(el).display);
    expect(display).not.toBe("none");
  });
});

test.describe("TestSettingsXSSProtection", () => {
  // Note: escapeHtml() escapes < > & but NOT " — values containing double quotes
  // will break the HTML attribute delimiter. That is a known bug (tracked in GitHub Issues).
  // These tests use values with < > & only to verify the working escaping.

  test("api key with HTML angle-bracket injection renders safely", async ({ pwaPage }) => {
    // No inner double quotes — tests < > escaping (the core XSS vector)
    const maliciousKey = "<script>alert(xss)</script>";
    await pwaPage.evaluate((key) => {
      localStorage.setItem(
        "fincoach-ai-settings",
        JSON.stringify({ provider: "groq", apiKey: key, model: "llama-3.3-70b-versatile" }),
      );
    }, maliciousKey);

    await goSettings(pwaPage);

    // Input value should round-trip correctly — browser decodes &lt; back to <
    const apiKeyInput = pwaPage.locator("#ai-api-key");
    const inputValue = await apiKeyInput.inputValue();
    expect(inputValue).toBe(maliciousKey);

    // Page structure must remain intact — no script injected
    const bodyText = await pwaPage.innerText("body");
    expect(bodyText.toLowerCase()).toContain("settings");
    expect(bodyText.toLowerCase()).toContain("api key");
  });

  test("azure resource/deployment names with HTML angle brackets render safely", async ({
    pwaPage,
  }) => {
    const maliciousResource = "res<img src=x>";
    const maliciousDeployment = "dep<b>bold</b>";
    // Playwright evaluate only accepts a single arg — wrap in object
    await pwaPage.evaluate(({ resource, deployment }) => {
      localStorage.setItem(
        "fincoach-ai-settings",
        JSON.stringify({
          provider: "azure",
          apiKey: "my-azure-key",
          azureResourceName: resource,
          azureDeploymentName: deployment,
          azureApiVersion: "2024-12-01-preview",
        }),
      );
    }, { resource: maliciousResource, deployment: maliciousDeployment });

    await goSettings(pwaPage);

    // Azure fields must be visible (provider is azure)
    const azureFields = pwaPage.locator("#azure-fields");
    const display = await azureFields.evaluate((el) => getComputedStyle(el).display);
    expect(display).not.toBe("none");

    // Inputs must round-trip correctly — < > are escaped then decoded by browser
    const resourceInput = pwaPage.locator("#azure-resource-name");
    const deploymentInput = pwaPage.locator("#azure-deployment-name");
    expect(await resourceInput.inputValue()).toBe(maliciousResource);
    expect(await deploymentInput.inputValue()).toBe(maliciousDeployment);

    // Page structure must be intact
    const bodyText = await pwaPage.innerText("body");
    expect(bodyText.toLowerCase()).toContain("resource name");
  });

  test("model name with HTML angle brackets renders safely", async ({ pwaPage }) => {
    const maliciousModel = "<img src=x onerror=alert(1)>";
    await pwaPage.evaluate((model) => {
      localStorage.setItem(
        "fincoach-ai-settings",
        JSON.stringify({ provider: "groq", apiKey: "sk-test", model }),
      );
    }, maliciousModel);

    await goSettings(pwaPage);

    const modelInput = pwaPage.locator("#ai-model");
    const modelValue = await modelInput.inputValue();
    expect(modelValue).toBe(maliciousModel);

    // Page structure must be intact — no injected HTML tag executed
    const bodyText = await pwaPage.innerText("body");
    expect(bodyText.toLowerCase()).toContain("settings");
  });
});

test.describe("TestGoogleDriveSyncSection", () => {
  test.beforeEach(async ({ pwaPage }) => {
    await goSettings(pwaPage);
  });

  test("google drive sync section heading is visible", async ({ pwaPage }) => {
    const heading = pwaPage.locator(".gdrive-section h2");
    expect(await heading.count()).toBe(1);
    const text = await heading.innerText();
    expect(text.toLowerCase()).toContain("google drive");
  });

  test("gdrive section shows help text mentioning backup and encryption", async ({ pwaPage }) => {
    const section = pwaPage.locator(".gdrive-section");
    expect(await section.count()).toBe(1);
    const text = await section.innerText();
    expect(text.toLowerCase()).toContain("back up");
    expect(text.toLowerCase()).toContain("encrypt");
  });

  test("gdrive shows not-connected status when gmail not connected", async ({ pwaPage }) => {
    const statusSpan = pwaPage.locator(".gdrive-status.gdrive-disconnected");
    expect(await statusSpan.count()).toBe(1);
    const text = await statusSpan.innerText();
    expect(text.toLowerCase()).toContain("not connected");
  });

  test("gdrive shows connect button when not connected", async ({ pwaPage }) => {
    const connectBtn = pwaPage.locator("button[data-action='gdrive-connect']");
    expect(await connectBtn.count()).toBe(1);
    const text = await connectBtn.innerText();
    expect(text.toLowerCase()).toContain("connect");
  });

  test("gdrive sync button absent when not connected", async ({ pwaPage }) => {
    const syncBtn = pwaPage.locator("button[data-action='gdrive-sync']");
    expect(await syncBtn.count()).toBe(0);
  });

  test("gdrive auto-sync toggle absent when not connected", async ({ pwaPage }) => {
    const toggle = pwaPage.locator("input[data-action='gdrive-toggle-auto']");
    expect(await toggle.count()).toBe(0);
  });

  test("gdrive disable-sync button absent when not connected", async ({ pwaPage }) => {
    const disconnectBtn = pwaPage.locator("button[data-action='gdrive-disconnect']");
    expect(await disconnectBtn.count()).toBe(0);
  });
});

test.describe("TestGoogleDriveSyncConnected", () => {
  test.beforeEach(async ({ pwaPage }) => {
    // Mock Drive API so renderSettings() resolves getLastModified() instantly
    // (avoids real network call that outlasts the page render wait)
    await pwaPage.route(/googleapis\.com\/drive\/v3\/files/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ files: [] }),
      });
    });
    // Inject a fake Gmail token AND enable Drive sync so the full "active" UI renders
    await pwaPage.evaluate(() => {
      localStorage.setItem(
        "fincoach-gmail-settings",
        JSON.stringify({
          accessToken: "fake-access-token",
          refreshToken: "fake-refresh-token",
          email: "testuser@example.com",
          tokenExpiry: Date.now() + 3_600_000,
        }),
      );
      localStorage.setItem("fincoach-gdrive-enabled", "true");
    });
    await goSettings(pwaPage);
    // Wait for async renderSettings() to complete (getLastModified resolves via mock)
    await pwaPage.waitForSelector("button[data-action='gdrive-sync']", { timeout: 5000 });
  });

  test("gdrive shows active status with email when gmail connected and drive enabled", async ({
    pwaPage,
  }) => {
    const statusSpan = pwaPage.locator(".gdrive-status.gdrive-connected");
    expect(await statusSpan.count()).toBe(1);
    const text = await statusSpan.innerText();
    expect(text.toLowerCase()).toContain("active");
    expect(text).toContain("testuser@example.com");
  });

  test("gdrive shows sync button when drive enabled", async ({ pwaPage }) => {
    const syncBtn = pwaPage.locator("button[data-action='gdrive-sync']");
    expect(await syncBtn.count()).toBe(1);
  });

  test("gdrive shows auto-sync toggle when drive enabled", async ({ pwaPage }) => {
    const toggle = pwaPage.locator("input[data-action='gdrive-toggle-auto']");
    expect(await toggle.count()).toBe(1);
    expect(await toggle.getAttribute("type")).toBe("checkbox");
  });

  test("gdrive shows disable-sync button when drive enabled", async ({ pwaPage }) => {
    const disconnectBtn = pwaPage.locator("button[data-action='gdrive-disconnect']");
    expect(await disconnectBtn.count()).toBe(1);
  });

  test("gdrive shows reconnect button alongside disable when drive enabled", async ({ pwaPage }) => {
    // A Reconnect button (data-action="gdrive-connect") is shown for re-authorization
    const reconnectBtn = pwaPage.locator("button[data-action='gdrive-connect']");
    expect(await reconnectBtn.count()).toBe(1);
    const text = await reconnectBtn.innerText();
    expect(text.toLowerCase()).toContain("reconnect");
  });

  test("gdrive shows last-synced line when drive enabled", async ({ pwaPage }) => {
    const lastSync = pwaPage.locator(".gdrive-last-sync");
    expect(await lastSync.count()).toBe(1);
    const text = await lastSync.innerText();
    expect(text.toLowerCase()).toContain("last synced");
  });
});

// ===========================================================================
// BUG-PROD-01: GDrive backup API key checkbox visibility follows provider
// ===========================================================================
test.describe("TestBUGPROD01GDriveBackupApiKeyVisibility", () => {
	test.beforeEach(async ({ pwaPage }) => {
		await goSettings(pwaPage);
	});

	test("gdrive-backup-api-key-field hidden when ollama selected (no key required)", async ({
		pwaPage,
	}) => {
		await pwaPage.selectOption("#ai-provider", "ollama");
		await pwaPage.waitForTimeout(300);

		const field = pwaPage.locator("#gdrive-backup-api-key-field");
		expect(await field.count()).toBe(1);
		const display = await field.evaluate((el) => getComputedStyle(el).display);
		expect(display).toBe("none");
	});

	test("gdrive-backup-api-key-field visible when groq selected (key required)", async ({
		pwaPage,
	}) => {
		await pwaPage.selectOption("#ai-provider", "groq");
		await pwaPage.waitForTimeout(300);

		const field = pwaPage.locator("#gdrive-backup-api-key-field");
		expect(await field.count()).toBe(1);
		const display = await field.evaluate((el) => getComputedStyle(el).display);
		expect(display).toBe("block");
	});

	test("gdrive-backup-api-key-field visible when openai selected (key required)", async ({
		pwaPage,
	}) => {
		await pwaPage.selectOption("#ai-provider", "openai");
		await pwaPage.waitForTimeout(300);

		const field = pwaPage.locator("#gdrive-backup-api-key-field");
		const display = await field.evaluate((el) => getComputedStyle(el).display);
		expect(display).toBe("block");
	});

	test("gdrive-backup-api-key-field hides when switching from groq to ollama", async ({
		pwaPage,
	}) => {
		// Start with groq — field should be visible
		await pwaPage.selectOption("#ai-provider", "groq");
		await pwaPage.waitForTimeout(300);
		let display = await pwaPage
			.locator("#gdrive-backup-api-key-field")
			.evaluate((el) => getComputedStyle(el).display);
		expect(display).toBe("block");

		// Switch to ollama — field should hide
		await pwaPage.selectOption("#ai-provider", "ollama");
		await pwaPage.waitForTimeout(300);
		display = await pwaPage
			.locator("#gdrive-backup-api-key-field")
			.evaluate((el) => getComputedStyle(el).display);
		expect(display).toBe("none");
	});

	test("gdrive-backup-api-key-field shows when switching from ollama to gemini", async ({
		pwaPage,
	}) => {
		// Start with ollama — field should be hidden
		await pwaPage.selectOption("#ai-provider", "ollama");
		await pwaPage.waitForTimeout(300);
		let display = await pwaPage
			.locator("#gdrive-backup-api-key-field")
			.evaluate((el) => getComputedStyle(el).display);
		expect(display).toBe("none");

		// Switch to gemini (requires key) — field should show
		await pwaPage.selectOption("#ai-provider", "gemini");
		await pwaPage.waitForTimeout(300);
		display = await pwaPage
			.locator("#gdrive-backup-api-key-field")
			.evaluate((el) => getComputedStyle(el).display);
		expect(display).toBe("block");
	});
});

test.describe("TestGoogleDriveSyncDisabled", () => {
  test.beforeEach(async ({ pwaPage }) => {
    // Gmail connected but Drive sync not yet enabled — the "disabled" middle state
    await pwaPage.evaluate(() => {
      localStorage.setItem(
        "fincoach-gmail-settings",
        JSON.stringify({
          accessToken: "fake-access-token",
          refreshToken: "fake-refresh-token",
          email: "testuser@example.com",
          tokenExpiry: Date.now() + 3_600_000,
        }),
      );
      // GDRIVE_ENABLED_KEY intentionally NOT set
    });
    await goSettings(pwaPage);
  });

  test("gdrive shows disconnected status when drive not enabled", async ({ pwaPage }) => {
    const statusSpan = pwaPage.locator(".gdrive-status.gdrive-disconnected");
    expect(await statusSpan.count()).toBe(1);
    const text = await statusSpan.innerText();
    expect(text.toLowerCase()).toContain("disabled");
  });

  test("gdrive shows enable button when drive not enabled", async ({ pwaPage }) => {
    const enableBtn = pwaPage.locator("button[data-action='gdrive-enable']");
    expect(await enableBtn.count()).toBe(1);
  });

  test("gdrive sync button absent when drive not enabled", async ({ pwaPage }) => {
    const syncBtn = pwaPage.locator("button[data-action='gdrive-sync']");
    expect(await syncBtn.count()).toBe(0);
  });

  test("gdrive disable button absent when drive not enabled", async ({ pwaPage }) => {
    const disableBtn = pwaPage.locator("button[data-action='gdrive-disconnect']");
    expect(await disableBtn.count()).toBe(0);
  });

  test("clicking disable then enable toggles the Drive sync state", async ({ pwaPage }) => {
    // Mock Drive API for the enabled-state re-render
    await pwaPage.route(/googleapis\.com\/drive\/v3\/files/, async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ files: [] }),
      });
    });
    // Set enabled state before first navigation (beforeEach navigated in disabled state)
    // Navigate away then back to force re-render with the updated localStorage
    await pwaPage.evaluate(() => {
      localStorage.setItem("fincoach-gdrive-enabled", "true");
      window.location.hash = "#/";
    });
    await goSettings(pwaPage);
    // Wait for async renderSettings() to complete
    await pwaPage.waitForSelector("button[data-action='gdrive-disconnect']", { timeout: 5000 });
    expect(await pwaPage.locator("button[data-action='gdrive-disconnect']").count()).toBe(1);

    // Click Disable Drive Sync — renderSettings is awaited inside the handler
    await pwaPage.locator("button[data-action='gdrive-disconnect']").click();
    // After click, the UI should re-render showing the "disabled" state
    await pwaPage.waitForSelector("button[data-action='gdrive-enable']");
    expect(await pwaPage.locator("button[data-action='gdrive-enable']").count()).toBe(1);
    expect(await pwaPage.locator("button[data-action='gdrive-disconnect']").count()).toBe(0);
  });
});

// ===========================================================================
// Privacy & Security card — Session Expiry / Trusted Device
// ===========================================================================
test.describe("TestPrivacyAndSecurity", () => {
  test.beforeEach(async ({ pwaPage }) => {
    // Clear localStorage so each test starts from a known state
    await pwaPage.evaluate(() => localStorage.clear());
    await goSettings(pwaPage);
  });

  test("Privacy & Security section is visible in settings", async ({ pwaPage }) => {
    const text = await pwaPage.innerText("body");
    expect(text).toContain("Privacy");
    expect(text).toContain("Security");
  });

  test("trusted device checkbox exists and is unchecked by default", async ({ pwaPage }) => {
    const checkbox = pwaPage.locator('[data-action="toggle-trusted-device"]');
    expect(await checkbox.count()).toBe(1);
    expect(await checkbox.isChecked()).toBe(false);
  });

  test("default state shows 6-hours inactivity warning text", async ({ pwaPage }) => {
    const bodyText = await pwaPage.innerText("body");
    expect(bodyText).toContain("6 hours");
  });

  test("checking trusted device shows success toast", async ({ pwaPage }) => {
    const checkbox = pwaPage.locator('[data-action="toggle-trusted-device"]');
    await checkbox.check();
    await pwaPage.waitForSelector(".toast.success", { timeout: 3000 });
    const toastText = await pwaPage.locator(".toast.success").innerText();
    expect(toastText).toContain("Trusted device enabled");
  });

  test("checking trusted device sets TRUSTED_DEVICE_KEY in localStorage", async ({ pwaPage }) => {
    const checkbox = pwaPage.locator('[data-action="toggle-trusted-device"]');
    await checkbox.check();
    await pwaPage.waitForTimeout(300);
    const val = await pwaPage.evaluate(() => localStorage.getItem("fincoach-trusted-device"));
    expect(val).toBe("true");
  });

  test("unchecking trusted device shows info toast", async ({ pwaPage }) => {
    const checkbox = pwaPage.locator('[data-action="toggle-trusted-device"]');
    // Enable first
    await checkbox.check();
    await pwaPage.waitForTimeout(400);
    // Clear toasts
    await pwaPage.evaluate(() => {
      document.querySelectorAll(".toast").forEach((t) => t.remove());
    });
    // Disable
    await checkbox.uncheck();
    await pwaPage.waitForSelector(".toast.info", { timeout: 3000 });
    const toastText = await pwaPage.locator(".toast.info").innerText();
    expect(toastText).toContain("Trusted device disabled");
  });

  test("enabling trusted device updates status text to show indefinite persistence", async ({
    pwaPage,
  }) => {
    const checkbox = pwaPage.locator('[data-action="toggle-trusted-device"]');
    await checkbox.check();
    await pwaPage.waitForTimeout(400);
    const bodyText = await pwaPage.innerText("body");
    expect(bodyText).toContain("indefinitely");
  });
});

// ===========================================================================
// Gmail Auto-Sync Toggle
// ===========================================================================
test.describe("TestGmailAutoSyncToggle", () => {
	test("Gmail auto-sync toggle enables and disables in localStorage", async ({ pwaPage }) => {
		await goSettings(pwaPage);

		const checkbox = pwaPage.locator('[data-change="gmail-toggle-auto-sync"]');
		await expect(checkbox).toHaveCount(1);

		// Fresh context: auto-sync key is not set → checkbox starts unchecked
		await expect(checkbox).not.toBeChecked();

		// Click to enable auto-sync
		await checkbox.click();
		await pwaPage.waitForTimeout(200);

		const enabledVal = await pwaPage.evaluate(() =>
			localStorage.getItem("fincoach-gmail-auto-sync-enabled"),
		);
		expect(enabledVal).toBe("true");

		// Click to disable auto-sync
		await checkbox.click();
		await pwaPage.waitForTimeout(200);

		const disabledVal = await pwaPage.evaluate(() =>
			localStorage.getItem("fincoach-gmail-auto-sync-enabled"),
		);
		expect(disabledVal).toBeFalsy();
	});

	test("Gmail auto-sync checkbox reflects persisted localStorage state on reload", async ({
		pwaPage,
	}) => {
		// Pre-set the enabled flag before navigating to settings
		await pwaPage.evaluate(() => {
			localStorage.setItem("fincoach-gmail-auto-sync-enabled", "true");
		});

		await goSettings(pwaPage);

		const checkbox = pwaPage.locator('[data-change="gmail-toggle-auto-sync"]');
		await expect(checkbox).toBeChecked();
	});
});

// ===========================================================================
// iOS PWA OAuth Redirect Fallback
// ===========================================================================
test.describe("TestiOSPWAOAuthRedirect", () => {
	// Mirror btoa(encodeURIComponent(JSON.stringify(p))) used by the Worker callback page
	function encodePayload(payload) {
		return Buffer.from(encodeURIComponent(JSON.stringify(payload))).toString("base64");
	}

	// Navigate to the app with a ?gmail-oauth=1#<fragment> URL and wait for the app to boot
	async function gotoWithOAuth(page, fragment) {
		await page.addInitScript(() => {
			localStorage.setItem("fincoach-onboarded", "true");
		});
		await page.goto(`/?gmail-oauth=1#${fragment}`);
		await page.waitForSelector(".bottom-nav", { timeout: 30_000 });
		await page.waitForSelector("#screen");
	}

	test("success payload — URL cleaned, tokens saved, success toast shown", async ({ page }) => {
		const fragment = encodePayload({
			type: "gmail-oauth",
			status: "success",
			access_token: "test-access-token-123",
			refresh_token: "test-refresh-token-456",
			expires_in: 3600,
		});

		await gotoWithOAuth(page, fragment);

		// URL search must be cleaned — no ?gmail-oauth param remains
		const search = await page.evaluate(() => window.location.search);
		expect(search).not.toContain("gmail-oauth");

		// Router navigated to settings after OAuth callback processing
		const hash = await page.evaluate(() => window.location.hash);
		expect(hash).toBe("#/settings");

		// Tokens persisted in localStorage with correct keys
		const stored = await page.evaluate(() => {
			const raw = localStorage.getItem("fincoach-gmail-settings");
			return raw ? JSON.parse(raw) : null;
		});
		expect(stored).not.toBeNull();
		expect(stored.accessToken).toBe("test-access-token-123");
		expect(stored.refreshToken).toBe("test-refresh-token-456");

		// Success toast is visible on the settings screen
		await page.waitForSelector(".toast.success", { timeout: 5000 });
		const toastText = await page.locator(".toast.success").innerText();
		expect(toastText.toLowerCase()).toContain("gmail connected successfully");
	});

	test("error payload — URL cleaned, no tokens saved, error toast shown", async ({ page }) => {
		const fragment = encodePayload({
			type: "gmail-oauth",
			status: "error",
			error: "access_denied",
		});

		await gotoWithOAuth(page, fragment);

		// URL cleaned
		const search = await page.evaluate(() => window.location.search);
		expect(search).not.toContain("gmail-oauth");

		// No tokens stored
		const stored = await page.evaluate(() => localStorage.getItem("fincoach-gmail-settings"));
		expect(stored).toBeNull();

		// Error toast visible mentioning failure
		await page.waitForSelector(".toast.error", { timeout: 5000 });
		const toastText = await page.locator(".toast.error").innerText();
		expect(
			toastText.toLowerCase().includes("connection failed") ||
				toastText.toLowerCase().includes("access_denied"),
		).toBeTruthy();
	});

	test("malformed fragment — app loads without crash, URL cleaned, no tokens saved", async ({
		page,
	}) => {
		await page.addInitScript(() => {
			localStorage.setItem("fincoach-onboarded", "true");
		});
		await page.goto("/?gmail-oauth=1#notvalidbase64!!!");
		await page.waitForSelector(".bottom-nav", { timeout: 30_000 });
		await page.waitForSelector("#screen");

		// URL cleaned regardless of malformed payload
		const search = await page.evaluate(() => window.location.search);
		expect(search).not.toContain("gmail-oauth");

		// No tokens accidentally stored
		const stored = await page.evaluate(() => localStorage.getItem("fincoach-gmail-settings"));
		expect(stored).toBeNull();

		// App loaded without crashing
		const bodyText = await page.innerText("body");
		expect(bodyText.length).toBeGreaterThan(0);

		// No error toast — malformed payloads are silently ignored
		const errorToastCount = await page.locator(".toast.error").count();
		expect(errorToastCount).toBe(0);
	});

	test("normal load without OAuth params — dashboard loads, no side effects", async ({ page }) => {
		await page.addInitScript(() => {
			localStorage.setItem("fincoach-onboarded", "true");
		});
		await page.goto("/");
		await page.waitForSelector(".bottom-nav", { timeout: 30_000 });
		await page.waitForSelector("#screen");

		// No gmail-oauth in URL
		const search = await page.evaluate(() => window.location.search);
		expect(search).not.toContain("gmail-oauth");

		// Default route is the dashboard (hash may be "" or "#/" depending on router rewrite)
		const hash = await page.evaluate(() => window.location.hash);
		expect(hash === "#/" || hash === "").toBe(true);

		// No Gmail settings accidentally stored
		const gmailSettings = await page.evaluate(() =>
			localStorage.getItem("fincoach-gmail-settings"),
		);
		expect(gmailSettings).toBeNull();

		// Body has content — app loaded normally
		const bodyText = await page.innerText("body");
		expect(bodyText.length).toBeGreaterThan(0);

		// No OAuth-related toasts from the redirect handler
		const successToast = await page.locator(".toast.success").filter({ hasText: /gmail connected/i }).count();
		const errorToast = await page.locator(".toast.error").filter({ hasText: /connection failed/i }).count();
		expect(successToast).toBe(0);
		expect(errorToast).toBe(0);
	});
});

// ===========================================================================
// Sample Data Loader (dev/testing helper)
// ===========================================================================
test.describe("TestSampleDataLoader", () => {
	test("load-sample-data button is shown on an empty database", async ({ pwaPage }) => {
		await goSettings(pwaPage);
		const loadBtn = pwaPage.locator("button[data-action='load-sample-data']");
		await expect(loadBtn).toHaveCount(1);
		const bodyText = await pwaPage.innerText("body");
		expect(bodyText.toLowerCase()).toContain("sample data");
	});

	test("clicking load-sample-data populates accounts and transactions", async ({ pwaPage }) => {
		pwaPage.on("dialog", (d) => d.accept());
		await goSettings(pwaPage);

		await pwaPage.locator("button[data-action='load-sample-data']").click();
		// The handler awaits the load then calls location.reload(). Wait until that reload has
		// fully settled before navigating — the Sample Data card is only rendered on an empty
		// DB, so its disappearance confirms the reload finished and the data is persisted.
		// (Navigating via the hash while the reload is still in flight would discard the hash.)
		await expect(pwaPage.locator("button[data-action='load-sample-data']")).toHaveCount(0, {
			timeout: 30_000,
		});
		await pwaPage.waitForSelector(".bottom-nav", { timeout: 30_000 });

		// Accounts screen shows the seeded HDFC Savings account.
		await pwaPage.evaluate(() => {
			window.location.hash = "#/accounts";
		});
		await pwaPage.waitForSelector("#screen");
		await expect(pwaPage.locator("body")).toContainText("HDFC Savings", { timeout: 10_000 });

		// Transactions screen has the seeded rows.
		await pwaPage.evaluate(() => {
			window.location.hash = "#/transactions";
		});
		await pwaPage.waitForSelector("#screen");
		await expect(pwaPage.locator("body")).toContainText(/rent/i, { timeout: 10_000 });
	});

	test("load-sample-data button is hidden when the database already has data", async ({
		pwaPage,
	}) => {
		await pwaPage.evaluate(async () => {
			await window.API.createAccount({
				name: "Existing Account",
				balance: 0,
				account_type: "checking",
			});
		});
		await goSettings(pwaPage);
		const loadBtn = pwaPage.locator("button[data-action='load-sample-data']");
		await expect(loadBtn).toHaveCount(0);
	});
});

// ===========================================================================
// Legal Footer — Privacy Policy and Terms of Service links
// ===========================================================================
test.describe("TestLegalFooter", () => {
	test.beforeEach(async ({ pwaPage }) => {
		await goSettings(pwaPage);
		await pwaPage.waitForSelector(".settings-legal-footer");
	});

	test("Privacy Policy link is visible in the settings footer", async ({ pwaPage }) => {
		const link = pwaPage.locator(".settings-legal-footer a:has-text('Privacy Policy')");
		expect(await link.count()).toBe(1);
		expect(await link.isVisible()).toBe(true);
	});

	test("Terms of Service link is visible in the settings footer", async ({ pwaPage }) => {
		const link = pwaPage.locator(".settings-legal-footer a:has-text('Terms of Service')");
		expect(await link.count()).toBe(1);
		expect(await link.isVisible()).toBe(true);
	});

	test("Privacy Policy link has correct href and opens in new tab", async ({ pwaPage }) => {
		const link = pwaPage.locator(".settings-legal-footer a:has-text('Privacy Policy')");
		expect(await link.getAttribute("href")).toBe("/privacy.html");
		expect(await link.getAttribute("target")).toBe("_blank");
	});

	test("Terms of Service link has correct href and opens in new tab", async ({ pwaPage }) => {
		const link = pwaPage.locator(".settings-legal-footer a:has-text('Terms of Service')");
		expect(await link.getAttribute("href")).toBe("/terms.html");
		expect(await link.getAttribute("target")).toBe("_blank");
	});
});
