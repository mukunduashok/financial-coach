// tests/e2e/js/bills.spec.js
import { test, expect } from "./fixtures.js";

function daysFromNowStr(n) {
	const d = new Date();
	d.setDate(d.getDate() + n);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Seed a recurring pattern directly into the DB via page.evaluate. */
async function seedPattern(page, overrides = {}) {
	const nextDueDate = overrides.next_due_date ?? daysFromNowStr(3);
	await page.evaluate(
		async ([nextDue, opts]) => {
			const acct = await window.DB.createAccount({ name: "Test Bank", account_type: "savings" });
			window.DB._exec(
				`INSERT INTO recurring_patterns
          (description_pattern, amount, frequency_days, last_seen, confidence, is_active,
           next_due_date, reminder_days_before, is_reminder_enabled, account_id, created_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, 3, ?, ?, datetime('now'))`,
				[
					opts.description_pattern ?? "Netflix Subscription",
					opts.amount ?? 499,
					opts.frequency_days ?? 30,
					opts.last_seen ?? "2026-05-01",
					opts.confidence ?? 0.9,
					nextDue,
					opts.is_reminder_enabled ?? 1,
					acct.id,
				],
			);
		},
		[nextDueDate, overrides],
	);
}

/** Navigate to a hash route and wait for the screen to render. */
async function navigateTo(page, hash) {
	await page.evaluate((h) => {
		window.location.hash = h;
	}, hash);
	await page.waitForTimeout(600);
}

// ---------------------------------------------------------------------------
// Upcoming Bills Widget (Dashboard)
// ---------------------------------------------------------------------------
test.describe("Upcoming Bills Widget (Dashboard)", () => {
	test("shows Upcoming Bills card on dashboard", async ({ pwaPage }) => {
		await navigateTo(pwaPage, "#/");
		const text = await pwaPage.innerText("body");
		expect(text.toLowerCase()).toContain("upcoming bills");
	});

	test("shows empty state when no upcoming bills", async ({ pwaPage }) => {
		// Fresh DB — no patterns seeded
		await navigateTo(pwaPage, "#/");
		const text = await pwaPage.innerText("body");
		expect(text.toLowerCase()).toMatch(/no upcoming bills/);
	});

	test("shows bill with urgent styling when due in <3 days", async ({ pwaPage }) => {
		await seedPattern(pwaPage, { next_due_date: daysFromNowStr(1) });
		await navigateTo(pwaPage, "#/settings");
		await navigateTo(pwaPage, "#/");
		const urgentEl = pwaPage.locator(".bill-row--urgent");
		await expect(urgentEl.first()).toBeVisible({ timeout: 3000 });
	});
});

// ---------------------------------------------------------------------------
// Bills & Reminders Tab (Transactions)
// ---------------------------------------------------------------------------
test.describe("Bills & Reminders Tab (Transactions)", () => {
	test("shows Bills & Reminders tab on transactions screen", async ({ pwaPage }) => {
		await navigateTo(pwaPage, "#/transactions");
		const tabBtn = pwaPage.getByRole("button", { name: /bills & reminders/i });
		await expect(tabBtn).toBeVisible({ timeout: 3000 });
	});

	test("Bills & Reminders tab shows empty state when no patterns", async ({ pwaPage }) => {
		await navigateTo(pwaPage, "#/transactions");
		const tabBtn = pwaPage.getByRole("button", { name: /bills & reminders/i });
		await tabBtn.click();
		await pwaPage.waitForTimeout(400);
		const text = await pwaPage.innerText("body");
		expect(text.toLowerCase()).toMatch(/no recurring patterns/);
	});

	test("Bills & Reminders tab shows management panel with seeded pattern", async ({
		pwaPage,
	}) => {
		await seedPattern(pwaPage, { description_pattern: "Netflix Subscription" });
		await navigateTo(pwaPage, "#/transactions");
		const tabBtn = pwaPage.getByRole("button", { name: /bills & reminders/i });
		await tabBtn.click();
		await pwaPage.waitForTimeout(600);
		const text = await pwaPage.innerText("body");
		expect(text).toContain("Netflix Subscription");
		const mgmtRows = pwaPage.locator(".bill-mgmt-row");
		expect(await mgmtRows.count()).toBeGreaterThanOrEqual(1);
	});
});
