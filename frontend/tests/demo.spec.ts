import { test, expect } from "@playwright/test";

test("original screens load sample data with no private/cloud connections", async ({
  page,
}) => {
  const failures: string[] = [];
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("response", (r) => {
    if (r.url().includes("/api/") && r.status() >= 400)
      failures.push(`${r.status()} ${r.url()}`);
  });
  page.on("request", (r) => {
    expect(new URL(r.url()).hostname).toMatch(/^(localhost|127\.0\.0\.1)$/);
  });
  await page.goto("/");
  await expect(
    page.getByText("Original H+H workflows.", { exact: false }),
  ).toBeVisible();
  const screens = [
    "Inventory",
    "Recipes & Costing",
    "Production Planner",
    "Consignment",
    "Wholesale POS",
    "Market Events",
    "Facility Tasks",
    "Timesheets",
    "Pre-Orders",
    "Settings & Users",
  ];
  for (const name of screens) {
    await page.getByRole("link", { name, exact: true }).click();
    await expect(
      page.getByRole("navigation", { name: "Primary navigation" }),
    ).toBeVisible();
    await expect(page.locator("main")).toBeVisible();
    await page.waitForLoadState('networkidle');
    await page.screenshot({
      path: `test-results/screens/${name.replaceAll(/[^a-z]/gi, "-")}.png`,
      fullPage: true,
    });
  }
  expect(failures).toEqual([]);
  expect(errors).toEqual([]);
});

test("facility completion survives navigation but resets on refresh", async ({
  page,
}) => {
  await page.goto("/tasks");
  const action = page.getByRole("button", {
    name: "Mark Sanitize preparation surfaces as completed",
    exact: true,
  });
  await action.click();
  await expect(
    page.getByRole("button", {
      name: "Mark Sanitize preparation surfaces as pending",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Inventory", exact: true }).click();
  await page.getByRole("link", { name: "Facility Tasks", exact: true }).click();
  await expect(
    page.getByRole("button", {
      name: "Mark Sanitize preparation surfaces as pending",
      exact: true,
    }),
  ).toBeVisible();
  await page.reload();
  await expect(action).toBeVisible();
});

test("wholesale sale creates invoice and changes stock in the original interface", async ({
  page,
}) => {
  await page.goto("/resellers");
  await page
    .getByPlaceholder("e.g. Ms. Anna Dolores")
    .fill("Sample browser customer");
  await page
    .getByRole("button", { name: "+ Add to Order", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: /Confirm.*Log Sale/ }).click();
  await expect(page.getByText(/Sample browser customer/).first()).toBeVisible();
  await expect(page.getByText(/HH-INVS-/).first()).toBeVisible();
  await page.screenshot({
    path: "test-results/screens/wholesale-invoice.png",
    fullPage: true,
  });
});

test("mobile navigation exposes the original application", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Open navigation", exact: true })
    .click();
  const drawer = page.getByRole("dialog", {
    name: "Quick navigation",
    exact: true,
  });
  await expect(drawer).toBeVisible();
  await drawer.getByRole("link", { name: "Inventory", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Inventory & stock control",
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: "test-results/screens/mobile-inventory.png",
    fullPage: true,
  });
});
