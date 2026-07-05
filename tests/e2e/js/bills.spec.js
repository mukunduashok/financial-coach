// tests/e2e/js/bills.spec.js
//
// Covers the transaction-based "Follow-ups & Reminders" model (FINCO-22) that
// replaced the old auto-detected recurring-pattern Bills UI. Follow-ups are
// created/edited from a transaction's edit modal and managed in the
// "Bills & Reminders" tab on the Transactions screen; pending follow-ups due
// soon also surface in the dashboard "Upcoming Bills" widget.
import { test, expect } from "./fixtures.js";

/** ISO YYYY-MM-DD offset from today. */
function daysFromNowStr(n) {
	const d = new Date();
	d.setDate(d.getDate() + n);
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Navigate to a hash route and wait for the screen to render. */
async function navigateTo(page, hash) {
	await page.evaluate((h) => {
		window.location.hash = h;
	}, hash);
	await page.waitForTimeout(600);
}

/** Seed one transaction via the DB and return its id. */
async function seedTransaction(page, overrides = {}) {
	return page.evaluate(async (opts) => {
		const acct = await window.DB.createAccount({
			name: opts.account_name ?? "Test Bank",
			account_type: "savings",
		});
		const tx = await window.DB.createTransaction({
			date: opts.date ?? new Date().toISOString().split("T")[0],
			amount: opts.amount ?? -499,
			description: opts.description ?? "Netflix Subscription",
			transaction_type: opts.transaction_type ?? "expense",
			account_id: acct.id,
			category_id: null,
		});
		return tx.id;
	}, overrides);
}

/** Seed a transaction and attach a follow-up in one step; returns { txId, followUpId }. */
async function seedFollowUp(page, txOverrides = {}, followUpData = {}) {
	return page.evaluate(
		async ([txOpts, fuData]) => {
			const acct = await window.DB.createAccount({
				name: txOpts.account_name ?? "Test Bank",
				account_type: "savings",
			});
			const tx = await window.DB.createTransaction({
				date: txOpts.date ?? new Date().toISOString().split("T")[0],
				amount: txOpts.amount ?? -499,
				description: txOpts.description ?? "Netflix Subscription",
				transaction_type: txOpts.transaction_type ?? "expense",
				account_id: acct.id,
				category_id: null,
			});
			const fu = await window.API.createFollowUp(tx.id, {
				title: fuData.title ?? null,
				follow_up_type: fuData.follow_up_type ?? "bill",
				due_date: fuData.due_date ?? null,
				is_recurring: fuData.is_recurring ?? false,
				recurrence: fuData.recurrence ?? null,
				notes: fuData.notes ?? null,
			});
			return { txId: tx.id, followUpId: fu.id };
		},
		[txOverrides, followUpData],
	);
}

/** Switch to the Bills & Reminders tab on the transactions screen. */
async function openBillsTab(page) {
	await navigateTo(page, "#/transactions");
	const tabBtn = page.getByRole("button", { name: /bills & reminders/i });
	await tabBtn.click();
	await page.waitForTimeout(500);
}

// ---------------------------------------------------------------------------
// Bills & Reminders tab — structure & empty state
// ---------------------------------------------------------------------------
test.describe("Bills & Reminders tab", () => {
	test("tab is present on the transactions screen", async ({ pwaPage }) => {
		await navigateTo(pwaPage, "#/transactions");
		const tabBtn = pwaPage.getByRole("button", { name: /bills & reminders/i });
		await expect(tabBtn).toBeVisible({ timeout: 3000 });
	});

	test("shows empty-state guidance when no follow-ups exist", async ({ pwaPage }) => {
		await openBillsTab(pwaPage);
		const text = await pwaPage.innerText("body");
		expect(text.toLowerCase()).toContain("no follow-ups here yet");
		expect(await pwaPage.locator(".bill-mgmt-row").count()).toBe(0);
	});

	test("lists a seeded follow-up as a management row", async ({ pwaPage }) => {
		await seedFollowUp(
			pwaPage,
			{ description: "Netflix Subscription" },
			{ follow_up_type: "bill", due_date: daysFromNowStr(3) },
		);
		await openBillsTab(pwaPage);
		const rows = pwaPage.locator(".bill-mgmt-row");
		await expect(rows.first()).toBeVisible({ timeout: 3000 });
		expect(await rows.count()).toBe(1);
		expect(await pwaPage.innerText("body")).toContain("Netflix Subscription");
	});
});

// ---------------------------------------------------------------------------
// Create follow-up from the transaction edit modal
// ---------------------------------------------------------------------------
test.describe("Follow-up creation via edit modal", () => {
	test("toggling the flag, setting due date + type, and saving adds it to the tab", async ({
		pwaPage,
	}) => {
		await seedTransaction(pwaPage, { description: "Electricity Board" });
		await navigateTo(pwaPage, "#/transactions");

		// Open the edit modal for the first transaction row.
		await pwaPage.locator(".tx-item").first().click();
		await pwaPage.waitForSelector("#edit-followup-enabled", { timeout: 3000 });

		// Enable follow-up tracking, then fill the form fields it reveals.
		await pwaPage.locator("#edit-followup-enabled").check();
		await expect(pwaPage.locator("#edit-followup-form")).toBeVisible();
		await pwaPage.selectOption("#edit-followup-type", "bill");
		await pwaPage.fill("#edit-followup-title", "Monthly electricity");
		await pwaPage.fill("#edit-followup-due", daysFromNowStr(4));
		await pwaPage.locator("[data-action='save-transaction']").click();
		await pwaPage.waitForTimeout(600);

		// Verify it persisted via the API.
		const count = await pwaPage.evaluate(async () => {
			const list = await window.API.getFollowUps({});
			return list.length;
		});
		expect(count).toBe(1);

		// And that it shows up in the Bills & Reminders tab.
		await openBillsTab(pwaPage);
		expect(await pwaPage.innerText("body")).toContain("Monthly electricity");
		expect(await pwaPage.locator(".bill-mgmt-row").count()).toBe(1);
	});

	test("re-opening the modal shows the existing follow-up pre-filled", async ({ pwaPage }) => {
		await seedFollowUp(
			pwaPage,
			{ description: "Gym Membership" },
			{ title: "Renew gym", follow_up_type: "reminder", due_date: daysFromNowStr(5) },
		);
		await navigateTo(pwaPage, "#/transactions");
		await pwaPage.locator(".tx-item").first().click();
		await pwaPage.waitForSelector("#edit-followup-enabled", { timeout: 3000 });

		expect(await pwaPage.locator("#edit-followup-enabled").isChecked()).toBe(true);
		expect(await pwaPage.inputValue("#edit-followup-title")).toBe("Renew gym");
		expect(await pwaPage.inputValue("#edit-followup-type")).toBe("reminder");
	});

	test("unchecking the flag and saving removes the follow-up", async ({ pwaPage }) => {
		await seedFollowUp(
			pwaPage,
			{ description: "Old Reminder" },
			{ title: "Delete me", follow_up_type: "reminder", due_date: daysFromNowStr(2) },
		);
		await navigateTo(pwaPage, "#/transactions");
		await pwaPage.locator(".tx-item").first().click();
		await pwaPage.waitForSelector("#edit-followup-enabled", { timeout: 3000 });

		await pwaPage.locator("#edit-followup-enabled").uncheck();
		await pwaPage.locator("[data-action='save-transaction']").click();
		await pwaPage.waitForTimeout(600);

		const count = await pwaPage.evaluate(async () => {
			const list = await window.API.getFollowUps({});
			return list.length;
		});
		expect(count).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Follow-up row actions — mark done / reopen / remove
// ---------------------------------------------------------------------------
test.describe("Follow-up row actions", () => {
	test("mark done shows the done state, reopen returns it to pending", async ({ pwaPage }) => {
		await seedFollowUp(
			pwaPage,
			{ description: "One-off bill" },
			{ follow_up_type: "bill", due_date: daysFromNowStr(2), is_recurring: false },
		);
		await openBillsTab(pwaPage);

		// Mark done → row disappears from the default "pending" filter.
		await pwaPage.locator("[data-action='mark-followup-done']").first().click();
		await pwaPage.waitForTimeout(500);
		expect(await pwaPage.locator(".bill-mgmt-row").count()).toBe(0);

		// Under the "Done" filter it reappears with a green Done badge.
		await pwaPage.locator("[data-action='filter-followups'][data-filter='done']").click();
		await pwaPage.waitForTimeout(500);
		const doneBadge = pwaPage.locator(".bill-days-badge.bill-row--ok");
		await expect(doneBadge.first()).toBeVisible({ timeout: 3000 });
		expect((await doneBadge.first().innerText()).toLowerCase()).toContain("done");

		// Reopen → returns to pending (no rows under "Done").
		await pwaPage.locator("[data-action='reopen-followup']").first().click();
		await pwaPage.waitForTimeout(500);
		expect(await pwaPage.locator(".bill-mgmt-row").count()).toBe(0);

		await pwaPage.locator("[data-action='filter-followups'][data-filter='pending']").click();
		await pwaPage.waitForTimeout(500);
		expect(await pwaPage.locator(".bill-mgmt-row").count()).toBe(1);
	});

	test("remove deletes the follow-up from the tab", async ({ pwaPage }) => {
		await seedFollowUp(
			pwaPage,
			{ description: "Removable" },
			{ follow_up_type: "reminder", due_date: daysFromNowStr(3) },
		);
		await openBillsTab(pwaPage);
		expect(await pwaPage.locator(".bill-mgmt-row").count()).toBe(1);

		await pwaPage.locator("[data-action='remove-followup']").first().click();
		await pwaPage.waitForTimeout(500);
		expect(await pwaPage.locator(".bill-mgmt-row").count()).toBe(0);
		expect((await pwaPage.innerText("body")).toLowerCase()).toContain("no follow-ups here yet");
	});
});

// ---------------------------------------------------------------------------
// Inline editing — due date & recurring toggle
// ---------------------------------------------------------------------------
test.describe("Follow-up inline editing", () => {
	test("editing the due date inline persists the new value", async ({ pwaPage }) => {
		const { followUpId } = await seedFollowUp(
			pwaPage,
			{ description: "Date change" },
			{ follow_up_type: "bill", due_date: daysFromNowStr(2) },
		);
		await openBillsTab(pwaPage);

		const newDate = daysFromNowStr(9);
		const dateInput = pwaPage.locator("input[data-change='followup-due-date']").first();
		await dateInput.fill(newDate);
		await dateInput.dispatchEvent("change");
		await pwaPage.waitForTimeout(500);

		const persisted = await pwaPage.evaluate(async (id) => {
			const fu = await window.API.getFollowUps({});
			return fu.find((f) => f.id === id)?.due_date;
		}, followUpId);
		expect(persisted).toBe(newDate);
	});

	test("toggling recurring reveals the recurrence selector and persists", async ({ pwaPage }) => {
		const { followUpId } = await seedFollowUp(
			pwaPage,
			{ description: "Make recurring" },
			{ follow_up_type: "bill", due_date: daysFromNowStr(3), is_recurring: false },
		);
		await openBillsTab(pwaPage);

		const toggle = pwaPage.locator("input[data-change='toggle-followup-recurring']").first();
		await toggle.check();
		await pwaPage.waitForTimeout(500);

		// Recurrence <select> is now rendered for the row.
		await expect(
			pwaPage.locator("select[data-change='followup-recurrence']").first(),
		).toBeVisible({ timeout: 3000 });

		const isRecurring = await pwaPage.evaluate(async (id) => {
			const fu = await window.API.getFollowUps({});
			return fu.find((f) => f.id === id)?.is_recurring;
		}, followUpId);
		expect(isRecurring).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// UI refresh after edits (FINCO-22 follow-ups) — the bills panel must reflect
// changes immediately, without switching filter chips / tabs.
// ---------------------------------------------------------------------------
test.describe("Bills panel refreshes after edits", () => {
	test("editing the due date via the edit modal refreshes the panel without a tab switch", async ({
		pwaPage,
	}) => {
		// Seed a follow-up due in 2 days → urgent "2d" badge initially.
		await seedFollowUp(
			pwaPage,
			{ description: "Modal date change" },
			{ follow_up_type: "bill", due_date: daysFromNowStr(2) },
		);
		await openBillsTab(pwaPage);

		// Sanity: the row starts on the near-term due date with an urgent badge.
		const dateInput = pwaPage.locator("input[data-change='followup-due-date']").first();
		expect(await dateInput.inputValue()).toBe(daysFromNowStr(2));
		await expect(
			pwaPage.locator(".bill-days-badge.bill-row--urgent").first(),
		).toBeVisible({ timeout: 3000 });

		// Launch the transaction edit modal from the row's "Open" button.
		await pwaPage.locator("[data-action='open-tx-from-followup']").first().click();
		await pwaPage.waitForSelector("#edit-followup-due", { timeout: 3000 });

		// Change the follow-up due date to 20 days out and save.
		const newDate = daysFromNowStr(20);
		await pwaPage.fill("#edit-followup-due", newDate);
		await pwaPage.locator("[data-action='save-transaction']").click();
		await pwaPage.waitForTimeout(600);

		// WITHOUT touching any filter chip / tab, the panel row must reflect the
		// new due date and the badge must flip from urgent (2d) to ok (20d).
		const refreshedInput = pwaPage.locator("input[data-change='followup-due-date']").first();
		await expect
			.poll(async () => refreshedInput.inputValue(), { timeout: 3000 })
			.toBe(newDate);
		await expect(pwaPage.locator(".bill-days-badge.bill-row--ok").first()).toBeVisible({
			timeout: 3000,
		});
		expect((await pwaPage.locator(".bill-days-badge").first().innerText()).toLowerCase()).toContain(
			"20d",
		);
		expect(await pwaPage.locator(".bill-days-badge.bill-row--urgent").count()).toBe(0);
	});

	test("inline due-date edit refreshes the badge without a tab switch", async ({ pwaPage }) => {
		await seedFollowUp(
			pwaPage,
			{ description: "Inline refresh" },
			{ follow_up_type: "bill", due_date: daysFromNowStr(2) },
		);
		await openBillsTab(pwaPage);

		// Starts urgent (2d).
		await expect(
			pwaPage.locator(".bill-days-badge.bill-row--urgent").first(),
		).toBeVisible({ timeout: 3000 });

		// Change the due date inline to 20 days out.
		const newDate = daysFromNowStr(20);
		const dateInput = pwaPage.locator("input[data-change='followup-due-date']").first();
		await dateInput.fill(newDate);
		await dateInput.dispatchEvent("change");
		await pwaPage.waitForTimeout(500);

		// Panel re-renders: badge flips to ok (20d), no tab switch performed.
		await expect(pwaPage.locator(".bill-days-badge.bill-row--ok").first()).toBeVisible({
			timeout: 3000,
		});
		expect((await pwaPage.locator(".bill-days-badge").first().innerText()).toLowerCase()).toContain(
			"20d",
		);
		expect(await pwaPage.locator(".bill-days-badge.bill-row--urgent").count()).toBe(0);
	});
});

// ---------------------------------------------------------------------------
// Filter chips
// ---------------------------------------------------------------------------
test.describe("Follow-up filter chips", () => {
	test("Pending / Done / All chips filter the list", async ({ pwaPage }) => {
		// One pending, one done.
		await seedFollowUp(
			pwaPage,
			{ description: "Pending item", account_name: "Acct A" },
			{ follow_up_type: "reminder", due_date: daysFromNowStr(4) },
		);
		const { followUpId: doneId } = await seedFollowUp(
			pwaPage,
			{ description: "Done item", account_name: "Acct B" },
			{ follow_up_type: "bill", due_date: daysFromNowStr(1), is_recurring: false },
		);
		await pwaPage.evaluate((id) => window.API.markFollowUpDone(id), doneId);

		await openBillsTab(pwaPage);

		// Default (pending) shows only the pending item.
		expect(await pwaPage.locator(".bill-mgmt-row").count()).toBe(1);
		expect(await pwaPage.innerText("body")).toContain("Pending item");

		// Done filter shows only the done item.
		await pwaPage.locator("[data-action='filter-followups'][data-filter='done']").click();
		await pwaPage.waitForTimeout(500);
		expect(await pwaPage.locator(".bill-mgmt-row").count()).toBe(1);
		expect(await pwaPage.innerText("body")).toContain("Done item");

		// All filter shows both.
		await pwaPage.locator("[data-action='filter-followups'][data-filter='all']").click();
		await pwaPage.waitForTimeout(500);
		expect(await pwaPage.locator(".bill-mgmt-row").count()).toBe(2);
	});
});

// ---------------------------------------------------------------------------
// Colour coding — overdue (red) vs done (green)
// ---------------------------------------------------------------------------
test.describe("Follow-up colour coding", () => {
	test("overdue pending follow-up carries the urgent (red) badge class", async ({ pwaPage }) => {
		await seedFollowUp(
			pwaPage,
			{ description: "Overdue bill" },
			{ follow_up_type: "bill", due_date: daysFromNowStr(-2) },
		);
		await openBillsTab(pwaPage);
		const badge = pwaPage.locator(".bill-days-badge.bill-row--urgent");
		await expect(badge.first()).toBeVisible({ timeout: 3000 });
		expect((await badge.first().innerText()).toLowerCase()).toContain("overdue");
	});

	test("completed follow-up carries the ok (green) Done badge class", async ({ pwaPage }) => {
		const { followUpId } = await seedFollowUp(
			pwaPage,
			{ description: "Completed bill" },
			{ follow_up_type: "bill", due_date: daysFromNowStr(1), is_recurring: false },
		);
		await pwaPage.evaluate((id) => window.API.markFollowUpDone(id), followUpId);
		await openBillsTab(pwaPage);
		await pwaPage.locator("[data-action='filter-followups'][data-filter='done']").click();
		await pwaPage.waitForTimeout(500);
		const badge = pwaPage.locator(".bill-days-badge.bill-row--ok");
		await expect(badge.first()).toBeVisible({ timeout: 3000 });
	});
});

// ---------------------------------------------------------------------------
// Dashboard "Upcoming Bills" widget
// ---------------------------------------------------------------------------
test.describe("Dashboard Upcoming Bills widget", () => {
	test("shows the Upcoming Bills card", async ({ pwaPage }) => {
		await navigateTo(pwaPage, "#/");
		expect((await pwaPage.innerText("body")).toLowerCase()).toContain("upcoming bills");
	});

	test("shows empty state when no follow-ups are due soon", async ({ pwaPage }) => {
		await navigateTo(pwaPage, "#/");
		expect((await pwaPage.innerText("body")).toLowerCase()).toMatch(/no upcoming bills/);
	});

	test("shows a pending follow-up that is due soon", async ({ pwaPage }) => {
		await seedFollowUp(
			pwaPage,
			{ description: "Broadband bill" },
			{ follow_up_type: "bill", due_date: daysFromNowStr(1) },
		);
		// Re-render the dashboard after seeding.
		await navigateTo(pwaPage, "#/settings");
		await navigateTo(pwaPage, "#/");
		const urgentEl = pwaPage.locator(".bill-row--urgent");
		await expect(urgentEl.first()).toBeVisible({ timeout: 3000 });
	});
});
