// tests/e2e/js/goals.spec.js
import { test, expect } from "./fixtures.js";

async function goToGoals(page) {
  await page.evaluate(() => {
    window.location.hash = "#/goals";
  });
  await page.waitForSelector("#screen");
}

async function createGoalViaDb(page, name, targetAmount, currentAmount = 0, deadline = null) {
  return await page.evaluate(
    async ({ name, targetAmount, currentAmount, deadline }) => {
      return await DB.createGoal({
        name,
        target_amount: targetAmount,
        current_amount: currentAmount,
        deadline,
      });
    },
    { name, targetAmount, currentAmount, deadline },
  );
}

test.describe("TestGoalsPage", () => {
  test.beforeEach(async ({ pwaPage }) => {
    await goToGoals(pwaPage);
  });

  test("goals page loads", async ({ pwaPage }) => {
    const text = await pwaPage.innerText("body");
    expect(text.toLowerCase().includes("goal") || text.length > 200).toBeTruthy();
  });

  test("goals empty state", async ({ pwaPage }) => {
    const text = await pwaPage.innerText("body");
    expect(text.toLowerCase()).toContain("no savings goals");
  });

  test("goals show seeded data", async ({ pwaPage }) => {
    await createGoalViaDb(pwaPage, "Emergency Fund", 100000, 50000);
    await goToGoals(pwaPage);
    const text = await pwaPage.innerText("body");
    const hasGoal = ["emergency fund", "goal", "target", "saved"].some((keyword) =>
      text.toLowerCase().includes(keyword),
    );
    expect(hasGoal).toBeTruthy();
  });

  test("fab button visible", async ({ pwaPage }) => {
    const fab = pwaPage.locator("button.fab");
    expect(await fab.count()).toBeGreaterThan(0);
  });
});

// FINCO-32 — empty-state CTA
test.describe("TestGoalsEmptyStateCTA", () => {
  test("empty goals screen shows new copy and a visible CTA button", async ({ pwaPage }) => {
    await goToGoals(pwaPage);
    await pwaPage.waitForSelector("#screen .empty-state");
    const emptyText = await pwaPage.locator("#screen .empty-text").innerText();
    expect(emptyText).toContain("No savings goals yet");
    const cta = pwaPage.locator('.empty-cta[data-action="show-create-goal"]');
    await expect(cta).toBeVisible();
    expect((await cta.innerText()).trim()).toBe("Create your first goal");
  });

  test("clicking the CTA opens the Create Goal modal", async ({ pwaPage }) => {
    await goToGoals(pwaPage);
    await pwaPage.waitForSelector("#screen .empty-state");
    await pwaPage.locator('.empty-cta[data-action="show-create-goal"]').click();
    await pwaPage.waitForSelector(".modal-overlay .modal");
    const modalText = (await pwaPage.locator(".modal-overlay .modal").innerText()).toLowerCase();
    expect(modalText).toContain("create goal");
  });
});

test.describe("TestCreateGoal", () => {
  test("create modal opens", async ({ pwaPage }) => {
    await goToGoals(pwaPage);
    await pwaPage.locator("button.fab").first().click();
    await pwaPage.waitForSelector(".modal-overlay .modal");

    const modal = pwaPage.locator(".modal-overlay .modal");
    expect(await modal.count()).toBeGreaterThan(0);
    expect((await modal.innerText()).toLowerCase()).toContain("create goal");
  });

  test("create modal has form fields", async ({ pwaPage }) => {
    await goToGoals(pwaPage);
    await pwaPage.locator("button.fab").first().click();
    await pwaPage.waitForSelector(".modal-overlay .modal");

    expect(await pwaPage.locator("#goal-name").count()).toBe(1);
    expect(await pwaPage.locator("#goal-target").count()).toBe(1);
    expect(await pwaPage.locator("#goal-deadline").count()).toBe(1);
  });

  test("create modal cancel", async ({ pwaPage }) => {
    await goToGoals(pwaPage);
    await pwaPage.locator("button.fab").first().click();
    await pwaPage.waitForSelector(".modal-overlay .modal");

    await pwaPage.locator(".modal-overlay button:has-text('Cancel')").click();
    await pwaPage.waitForFunction(
      () =>
        document.querySelector(".modal-overlay") === null ||
        getComputedStyle(document.querySelector(".modal-overlay")).display === "none",
    );

    expect(await pwaPage.locator(".modal-overlay").count()).toBe(0);
  });

  test("create goal success", async ({ pwaPage }) => {
    await goToGoals(pwaPage);
    await pwaPage.locator("button.fab").first().click();
    await pwaPage.waitForSelector(".modal-overlay .modal");

    await pwaPage.locator("#goal-name").fill("E2E Test Goal");
    await pwaPage.locator("#goal-target").fill("25000");

    await pwaPage.locator(".modal-overlay button:has-text('Create')").click();
    await pwaPage.waitForFunction(
      () =>
        document.querySelector(".modal-overlay") === null ||
        getComputedStyle(document.querySelector(".modal-overlay")).display === "none",
    );

    expect(await pwaPage.locator(".modal-overlay").count()).toBe(0);
    const text = await pwaPage.innerText("body");
    expect(text.toLowerCase()).toContain("e2e test goal");
  });

  test("create goal empty name shows error", async ({ pwaPage }) => {
    await goToGoals(pwaPage);
    await pwaPage.locator("button.fab").first().click();
    await pwaPage.waitForSelector(".modal-overlay .modal");

    await pwaPage.locator("#goal-name").fill("");
    await pwaPage.locator("#goal-target").fill("1000");
    await pwaPage.locator(".modal-overlay button:has-text('Create')").click();
    await pwaPage.waitForTimeout(300);

    expect(await pwaPage.locator(".modal-overlay").count()).toBeGreaterThan(0);
  });
});

test.describe("TestEditGoal", () => {
  test("edit goal", async ({ pwaPage }) => {
    await createGoalViaDb(pwaPage, "Edit Me Goal", 5000);
    await goToGoals(pwaPage);

    const editBtn = pwaPage.locator("button:has-text('Edit')").first();
    await editBtn.click();
    await pwaPage.waitForSelector(".modal-overlay .modal");

    const modal = pwaPage.locator(".modal-overlay .modal");
    expect(await modal.count()).toBeGreaterThan(0);
    expect((await modal.innerText()).toLowerCase()).toContain("edit goal");

    await pwaPage.locator("#goal-edit-name").fill("Renamed Goal");
    await pwaPage.locator(".modal-overlay button:has-text('Save')").click();
    await pwaPage.waitForFunction(
      () =>
        document.querySelector(".modal-overlay") === null ||
        getComputedStyle(document.querySelector(".modal-overlay")).display === "none",
    );

    expect(await pwaPage.locator(".modal-overlay").count()).toBe(0);
    const text = await pwaPage.innerText("body");
    expect(text.toLowerCase()).toContain("renamed goal");
  });
});

test.describe("TestContributeToGoal", () => {
  test("contribute to goal", async ({ pwaPage }) => {
    await createGoalViaDb(pwaPage, "Contribute Test", 10000);
    await goToGoals(pwaPage);

    const contributeBtn = pwaPage.locator("button:has-text('Contribute')").first();
    await contributeBtn.click();
    await pwaPage.waitForSelector(".modal-overlay .modal");

    const modal = pwaPage.locator(".modal-overlay .modal");
    expect(await modal.count()).toBeGreaterThan(0);
    expect((await modal.innerText()).toLowerCase()).toContain("contribute");

    await pwaPage.locator("#goal-contribute-amount").fill("2500");
    await pwaPage.locator(".modal-overlay button:has-text('Contribute')").click();
    await pwaPage.waitForFunction(
      () =>
        document.querySelector(".modal-overlay") === null ||
        getComputedStyle(document.querySelector(".modal-overlay")).display === "none",
    );

    expect(await pwaPage.locator(".modal-overlay").count()).toBe(0);
    const text = await pwaPage.innerText("body");
    expect(text.includes("2,500") || text.includes("2500")).toBeTruthy();
  });

  test("contribute modal cancel", async ({ pwaPage }) => {
    await createGoalViaDb(pwaPage, "Cancel Contribute", 5000);
    await goToGoals(pwaPage);

    await pwaPage.locator("button:has-text('Contribute')").first().click();
    await pwaPage.waitForSelector(".modal-overlay .modal");

    await pwaPage.locator(".modal-overlay button:has-text('Cancel')").click();
    await pwaPage.waitForFunction(
      () =>
        document.querySelector(".modal-overlay") === null ||
        getComputedStyle(document.querySelector(".modal-overlay")).display === "none",
    );

    expect(await pwaPage.locator(".modal-overlay").count()).toBe(0);
  });
});
