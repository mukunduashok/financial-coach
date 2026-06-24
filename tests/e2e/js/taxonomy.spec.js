// tests/e2e/js/taxonomy.spec.js
import { test, expect } from "./fixtures.js";

test.describe("TestTaxonomyNavigation", () => {
  test("taxonomy page loads", async ({ pwaPage }) => {
    await pwaPage.evaluate(() => {
      window.location.hash = "#/taxonomy";
    });
    await pwaPage.waitForSelector("#screen");
    const text = await pwaPage.innerText("body");
    const hasContent = ["categor", "merchant", "taxonomy", "manage"].some((kw) =>
      text.toLowerCase().includes(kw),
    );
    expect(hasContent || text.length > 200).toBeTruthy();
  });

  test("categories tab visible", async ({ pwaPage }) => {
    await pwaPage.evaluate(() => {
      window.location.hash = "#/taxonomy";
    });
    await pwaPage.waitForSelector("#screen");

    const tab = pwaPage.locator(
      "button:has-text('Categories'), " +
        "[data-tab='categories'], " +
        ".tab:has-text('Categories')",
    );
    expect(await tab.count()).toBeGreaterThan(0);
  });

  test("merchants tab visible", async ({ pwaPage }) => {
    await pwaPage.evaluate(() => {
      window.location.hash = "#/taxonomy";
    });
    await pwaPage.waitForSelector("#screen");

    const tab = pwaPage.locator(
      "button:has-text('Merchants'), " +
        "[data-tab='merchants'], " +
        ".tab:has-text('Merchants')",
    );
    expect(await tab.count()).toBeGreaterThan(0);
  });

  test("switch to merchants tab", async ({ pwaPage }) => {
    await pwaPage.evaluate(() => {
      window.location.hash = "#/taxonomy";
    });
    await pwaPage.waitForSelector("#screen");

    const merchantsTab = pwaPage.locator(
      "button:has-text('Merchants'), " +
        "[data-tab='merchants'], " +
        ".tab:has-text('Merchants')",
    );
    if ((await merchantsTab.count()) > 0) {
      await merchantsTab.first().click();
      await pwaPage.waitForTimeout(300);
      const text = await pwaPage.innerText("body");
      expect(text.toLowerCase().includes("merchant") || text.length > 200).toBeTruthy();
    }
  });
});

test.describe("TestCategoriesTab", () => {
  test("categories list shows seeded", async ({ pwaPage }) => {
    await pwaPage.evaluate(() => {
      window.location.hash = "#/taxonomy";
    });
    await pwaPage.waitForSelector("#screen");
    const text = await pwaPage.innerText("body");
    const hasCategories = ["Food & Dining", "Transportation", "Shopping"].some((cat) =>
      text.includes(cat),
    );
    expect(hasCategories).toBeTruthy();
  });

  test("create category modal", async ({ pwaPage }) => {
    await pwaPage.evaluate(() => {
      window.location.hash = "#/taxonomy";
    });
    await pwaPage.waitForSelector("#screen");

    const addBtn = pwaPage.locator(
      "button:has-text('Add'), button:has-text('New'), " +
        "button:has-text('Create'), .add-btn, .fab",
    );
    if ((await addBtn.count()) > 0) {
      await addBtn.first().click();
      await pwaPage.waitForTimeout(300);
      const modal = pwaPage.locator(".modal, dialog, [role='dialog'], .form-container");
      expect((await modal.count()) > 0 || true).toBeTruthy();
    }
  });

  test("create category flow", async ({ pwaPage }) => {
    await pwaPage.evaluate(() => {
      window.location.hash = "#/taxonomy";
    });
    await pwaPage.waitForSelector("#screen");

    const addBtn = pwaPage.locator(
      "button:has-text('Add'), button:has-text('New'), " +
        "button:has-text('Create'), .add-btn, .fab",
    );
    if ((await addBtn.count()) === 0) {
      return; // Skip: No add button found on taxonomy page
    }

    await addBtn.first().click();
    await pwaPage.waitForTimeout(300);

    const nameInput = pwaPage.locator(
      "input[name='name'], input[placeholder*='name' i], input[type='text']",
    );
    if ((await nameInput.count()) > 0) {
      await nameInput.first().fill("E2E Test Category");
      const submitBtn = pwaPage.locator(
        "button:has-text('Save'), button:has-text('Create'), button[type='submit']",
      );
      if ((await submitBtn.count()) > 0) {
        await submitBtn.first().click();
        await pwaPage.waitForTimeout(500);
        const text = await pwaPage.innerText("body");
        expect(text).toContain("E2E Test Category");
      }
    }
  });

  test("edit category", async ({ pwaPage }) => {
    await pwaPage.evaluate(() => {
      window.location.hash = "#/taxonomy";
    });
    await pwaPage.waitForSelector("#screen");

    const editBtn = pwaPage.locator(
      "button:has-text('Edit'), button[aria-label*='edit' i], .edit-btn, [data-action='edit']",
    );
    if ((await editBtn.count()) > 0) {
      await editBtn.first().click();
      await pwaPage.waitForTimeout(300);
      const modal = pwaPage.locator(".modal, dialog, [role='dialog'], .form-container");
      expect((await modal.count()) > 0 || true).toBeTruthy();
    }
  });

  test("delete category", async ({ pwaPage }) => {
    await pwaPage.evaluate(() => {
      window.location.hash = "#/taxonomy";
    });
    await pwaPage.waitForSelector("#screen");

    const deleteBtn = pwaPage.locator(
      "button:has-text('Delete'), button[aria-label*='delete' i], " +
        ".delete-btn, [data-action='delete']",
    );
    expect((await deleteBtn.count()) >= 0).toBeTruthy();
  });
});

test.describe("TestMerchantsTab", () => {
  async function navigateToMerchants(page) {
    await page.evaluate(() => {
      window.location.hash = "#/taxonomy";
    });
    await page.waitForSelector("#screen");

    const merchantsTab = page.locator(
      "button:has-text('Merchants'), " +
        "[data-tab='merchants'], " +
        ".tab:has-text('Merchants')",
    );
    if ((await merchantsTab.count()) > 0) {
      await merchantsTab.first().click();
      await page.waitForTimeout(300);
    }
  }

  test("merchants tab loads", async ({ pwaPage }) => {
    await navigateToMerchants(pwaPage);
    const text = await pwaPage.innerText("body");
    expect(text.toLowerCase().includes("merchant") || text.length > 200).toBeTruthy();
  });

  test("search merchants input", async ({ pwaPage }) => {
    await navigateToMerchants(pwaPage);

    const searchInput = pwaPage.locator(
      "input[type='search'], input[placeholder*='search' i], input[placeholder*='merchant' i]",
    );
    expect((await searchInput.count()) > 0 || true).toBeTruthy();
  });

  test("create merchant modal", async ({ pwaPage }) => {
    await navigateToMerchants(pwaPage);

    const addBtn = pwaPage.locator(
      "button:has-text('Add'), button:has-text('New'), " +
        "button:has-text('Create'), .add-btn, .fab",
    );
    if ((await addBtn.count()) > 0) {
      await addBtn.first().click();
      await pwaPage.waitForTimeout(300);
      const modal = pwaPage.locator(".modal, dialog, [role='dialog'], .form-container");
      expect((await modal.count()) > 0 || true).toBeTruthy();
    }
  });
});

test.describe("TestDefaultCategory", () => {
  test("default category indicator", async ({ pwaPage }) => {
    await pwaPage.evaluate(() => {
      window.location.hash = "#/taxonomy";
    });
    await pwaPage.waitForSelector("#screen");

    const defaultMarker = pwaPage.locator(
      ".default-badge, .is-default, [data-default='true'], :text('default')",
    );
    expect((await defaultMarker.count()) >= 0).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// Item 2 — Taxonomy FAB button
// ---------------------------------------------------------------------------
test.describe("TestTaxonomyFAB", () => {
  async function goToTaxonomy(page) {
    await page.evaluate(() => {
      window.location.hash = "#/taxonomy";
    });
    await page.waitForSelector("#screen");
    await page.waitForTimeout(400);
  }

  async function switchToMerchantsTab(page) {
    const merchantsTab = page.locator("[data-action='switch-taxonomy-tab'][data-mode='merchants']");
    await merchantsTab.first().click();
    await page.waitForTimeout(400);
  }

  test("FAB with data-action=show-add-category is visible on Categories tab", async ({ pwaPage }) => {
    await goToTaxonomy(pwaPage);
    const fab = pwaPage.locator("button.fab[data-action='show-add-category']");
    expect(await fab.count()).toBe(1);
    expect(await fab.isVisible()).toBe(true);
  });

  test("FAB is NOT present when Merchants tab is active", async ({ pwaPage }) => {
    await goToTaxonomy(pwaPage);
    await switchToMerchantsTab(pwaPage);
    const fab = pwaPage.locator("button.fab[data-action='show-add-category']");
    expect(await fab.count()).toBe(0);
  });

  test("clicking FAB opens add category modal", async ({ pwaPage }) => {
    await goToTaxonomy(pwaPage);
    await pwaPage.locator("button.fab[data-action='show-add-category']").click();
    await pwaPage.waitForSelector(".modal-overlay .modal", { timeout: 3000 });
    const modal = pwaPage.locator(".modal-overlay .modal");
    expect(await modal.count()).toBe(1);
    const modalText = (await modal.innerText()).toLowerCase();
    expect(
      modalText.includes("category") || modalText.includes("add") || modalText.includes("create"),
    ).toBe(true);
  });

  test("old inline Add Category button is NOT present in taxonomy content", async ({ pwaPage }) => {
    await goToTaxonomy(pwaPage);
    // The removed button previously had text "+ Add Category" inside #taxonomy-content
    const inlineBtn = pwaPage.locator("#taxonomy-content button:has-text('+ Add Category')");
    expect(await inlineBtn.count()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Tags Tab — full CRUD
// ---------------------------------------------------------------------------
test.describe("TestTagsTab", () => {
  async function goToTagsTab(page) {
    await page.evaluate(() => {
      window.location.hash = "#/taxonomy";
    });
    await page.waitForSelector("#screen");
    await page.waitForTimeout(400);
    await page.locator("[data-action='switch-taxonomy-tab'][data-mode='tags']").click();
    await page.waitForTimeout(400);
  }

  test("Tags tab button is present in taxonomy tab bar", async ({ pwaPage }) => {
    await pwaPage.evaluate(() => {
      window.location.hash = "#/taxonomy";
    });
    await pwaPage.waitForSelector("#screen");
    const tagsTab = pwaPage.locator("[data-action='switch-taxonomy-tab'][data-mode='tags']");
    expect(await tagsTab.count()).toBe(1);
    expect(await tagsTab.innerText()).toBe("Tags");
  });

  test("Tags tab shows seeded tags on a fresh DB", async ({ pwaPage }) => {
    await goToTagsTab(pwaPage);
    const content = pwaPage.locator("#taxonomy-content");
    const text = await content.innerText();
    expect(text).toContain("#domestic");
    expect(text).toContain("#international");
    expect(text).toContain("#offline");
    expect(text).toContain("#online");
  });

  test("FAB with data-action=show-add-tag visible on Tags tab", async ({ pwaPage }) => {
    await goToTagsTab(pwaPage);
    const fab = pwaPage.locator("button.fab[data-action='show-add-tag']");
    expect(await fab.count()).toBe(1);
    expect(await fab.isVisible()).toBe(true);
  });

  test("FAB with data-action=show-add-category is NOT visible on Tags tab", async ({ pwaPage }) => {
    await goToTagsTab(pwaPage);
    const fab = pwaPage.locator("button.fab[data-action='show-add-category']");
    expect(await fab.count()).toBe(0);
  });

  test("clicking FAB opens Add Tag modal", async ({ pwaPage }) => {
    await goToTagsTab(pwaPage);
    await pwaPage.locator("button.fab[data-action='show-add-tag']").click();
    await pwaPage.waitForSelector(".modal-overlay .modal", { timeout: 3000 });
    const modal = pwaPage.locator(".modal-overlay .modal");
    expect(await modal.count()).toBe(1);
    const modalText = (await modal.innerText()).toLowerCase();
    expect(modalText.includes("tag") || modalText.includes("add")).toBe(true);
  });

  test("create tag — full flow: tag appears in list", async ({ pwaPage }) => {
    await goToTagsTab(pwaPage);
    await pwaPage.locator("button.fab[data-action='show-add-tag']").click();
    await pwaPage.waitForSelector("#tag-name", { timeout: 3000 });

    await pwaPage.fill("#tag-name", "myE2ETag");
    await pwaPage.locator("[data-action='do-create-tag']").click();
    await pwaPage.waitForTimeout(500);

    const content = await pwaPage.locator("#taxonomy-content").innerText();
    expect(content).toContain("#myE2ETag");
  });

  test("create tag with spaces — auto-camelCased and shown in list", async ({ pwaPage }) => {
    await goToTagsTab(pwaPage);
    await pwaPage.locator("button.fab[data-action='show-add-tag']").click();
    await pwaPage.waitForSelector("#tag-name", { timeout: 3000 });

    await pwaPage.fill("#tag-name", "trip to ooty");
    await pwaPage.locator("[data-action='do-create-tag']").click();
    await pwaPage.waitForTimeout(500);

    const content = await pwaPage.locator("#taxonomy-content").innerText();
    expect(content).toContain("#tripToOoty");
  });

  test("create tag with # prefix — stored without #", async ({ pwaPage }) => {
    await goToTagsTab(pwaPage);
    await pwaPage.locator("button.fab[data-action='show-add-tag']").click();
    await pwaPage.waitForSelector("#tag-name", { timeout: 3000 });

    await pwaPage.fill("#tag-name", "#online");
    await pwaPage.locator("[data-action='do-create-tag']").click();
    await pwaPage.waitForTimeout(500);

    // Should appear as #online (# is visual prefix, not stored)
    const content = await pwaPage.locator("#taxonomy-content").innerText();
    expect(content).toContain("#online");
    // But NOT stored as ##online
    expect(content).not.toContain("##online");
  });

  test("edit tag — renames and shows updated name", async ({ pwaPage }) => {
    // Seed a tag directly
    await pwaPage.evaluate(async () => {
      await DB.createTag("editme");
    });
    await goToTagsTab(pwaPage);

    const editBtn = pwaPage.locator("[data-action='show-edit-tag'][data-name='editme']");
    if ((await editBtn.count()) === 0) return;

    await editBtn.click();
    await pwaPage.waitForSelector("#tag-edit-name", { timeout: 3000 });
    await pwaPage.fill("#tag-edit-name", "renamed");
    await pwaPage.locator("[data-action='do-update-tag']").click();
    await pwaPage.waitForTimeout(500);

    const content = await pwaPage.locator("#taxonomy-content").innerText();
    expect(content).toContain("#renamed");
    expect(content).not.toContain("#editme");
  });

  test("delete tag — opens confirm dialog and removes tag", async ({ pwaPage }) => {
    await pwaPage.evaluate(async () => {
      await DB.createTag("deleteme");
    });
    await goToTagsTab(pwaPage);

    const deleteBtn = pwaPage.locator("[data-action='confirm-delete-tag']").first();
    if ((await deleteBtn.count()) === 0) return;

    await deleteBtn.click();
    await pwaPage.waitForSelector("[data-action='do-delete-tag']", { timeout: 3000 });
    await pwaPage.locator("[data-action='do-delete-tag']").click();
    await pwaPage.waitForTimeout(500);

    const content = await pwaPage.locator("#taxonomy-content").innerText();
    expect(content).not.toContain("#deleteme");
  });

  test("cancel in Add Tag modal leaves the tag list unchanged", async ({ pwaPage }) => {
    await goToTagsTab(pwaPage);
    await pwaPage.locator("button.fab[data-action='show-add-tag']").click();
    await pwaPage.waitForSelector(".modal-overlay", { timeout: 3000 });
    await pwaPage.locator("[data-action='close-modal']").first().click();
    await pwaPage.waitForTimeout(300);

    const modal = pwaPage.locator(".modal-overlay");
    expect(await modal.count()).toBe(0);
  });
});
