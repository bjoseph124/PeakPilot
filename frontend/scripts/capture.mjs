/** Reproducible work-sample exports and browser smoke tests against a running app. */
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const output = resolve(process.env.OUTPUT_DIR || "../artifacts");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROME_PATH
    ? { executablePath: process.env.CHROME_PATH }
    : {}),
});
const errors = [];
const warnings = [];
const page = await browser.newPage({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
});
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
  if (message.type() === "warning") warnings.push(message.text());
});

async function settled() {
  await page
    .getByRole("button", { name: "Run Optimization", exact: true })
    .waitFor({ timeout: 120000 });
  await page.locator(".results[aria-busy=false]").waitFor({ timeout: 120000 });
  if (await page.locator(".error-banner").count())
    throw new Error(await page.locator(".error-banner").innerText());
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(350);
}

try {
  await page.goto(process.env.APP_URL || "http://127.0.0.1:3000", {
    waitUntil: "networkidle",
  });
  await settled();
  // Regression: resetting while already at defaults must not leave day="",
  // which would match all 2,880 timestamps in what should be a daily chart.
  const resetRequest = page.waitForResponse(
    (r) => r.url().endsWith("/api/simulate") && r.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  const resetData = await (await resetRequest).json();
  await settled();
  if (
    (await page
      .getByRole("combobox", { name: "Chart date", exact: true })
      .inputValue()) !== resetData.period.focus_date
  )
    throw new Error("Reset-at-defaults left an invalid chart date.");
  const desktop = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    documentWidth: document.documentElement.scrollWidth,
    documentHeight: document.documentElement.scrollHeight,
    panels: [...document.querySelectorAll(".panel")].map((p) => ({
      text: p.querySelector("h2")?.textContent,
      bottom: p.getBoundingClientRect().bottom,
    })),
  }));
  await page.screenshot({
    path: resolve(output, "layout-review.png"),
    fullPage: true,
  });
  if (desktop.documentWidth > 1920 || desktop.documentHeight > 1080)
    throw new Error(`Desktop overflow: ${JSON.stringify(desktop)}`);
  await page.screenshot({
    path: resolve(output, "peakpilot-dashboard-1920.png"),
    fullPage: false,
  });
  await page.emulateMedia({ media: "screen" });
  await page.pdf({
    path: resolve(output, "peakpilot-dashboard.pdf"),
    width: "1920px",
    height: "1080px",
    printBackground: true,
    margin: { top: 0, bottom: 0, left: 0, right: 0 },
  });

  const initial = await page.locator(".kpi-grid").innerText();
  await page
    .getByRole("button", { name: "Day-ahead forecast", exact: true })
    .click();
  if (
    (await page
      .getByRole("button", { name: "Day-ahead forecast", exact: true })
      .getAttribute("aria-pressed")) !== "false"
  )
    throw new Error("Forecast toggle failed.");
  await page
    .getByRole("button", { name: "Day-ahead forecast", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Chart date", exact: true })
    .selectOption("2025-06-02");
  await page.getByRole("button", { name: "Next day", exact: true }).click();
  if (
    (await page
      .getByRole("combobox", { name: "Chart date", exact: true })
      .inputValue()) !== "2025-06-03"
  )
    throw new Error("Date navigation failed.");

  // Changing a slider must issue a real request and alter calculated metrics.
  const request = page.waitForResponse(
    (r) => r.url().endsWith("/api/simulate") && r.request().method() === "POST",
  );
  await page.locator("#capacity_kwh").fill("750");
  const response = await request;
  if (!response.ok() || (await response.json()).battery.capacity_kwh !== 750)
    throw new Error("Scenario request did not use changed capacity.");
  await settled();
  if ((await page.locator(".kpi-grid").innerText()) === initial)
    throw new Error("Capacity control did not update metrics.");
  await page
    .getByRole("combobox", { name: "Commercial property", exact: true })
    .selectOption("retail");
  await settled();
  if (
    !(await page.locator(".summary-line").innerText()).includes("Retail center")
  )
    throw new Error("Building control failed.");

  for (const name of [
    "Load Intelligence",
    "Battery Optimization",
    "Financial Analysis",
    "Scenario Explorer",
    "Settings",
  ]) {
    await page
      .getByRole("navigation")
      .getByRole("button", { name, exact: true })
      .click();
    await page.getByRole("heading", { name, exact: true, level: 1 }).waitFor();
  }
  await page
    .getByRole("button", { name: "Read methodology", exact: true })
    .click();
  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Escape");
  await page.getByRole("dialog").waitFor({ state: "detached" });
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Export results", exact: true })
    .click();
  const download = await downloadPromise;
  await download.saveAs(resolve(output, "verified-retail-results.json"));

  await page
    .getByRole("navigation")
    .getByRole("button", { name: "Overview", exact: false })
    .click();
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await settled();
  await page.setViewportSize({ width: 1600, height: 1000 });
  await page.waitForTimeout(400);
  const medium = await page.evaluate(() => ({
    width: document.documentElement.scrollWidth,
    height: document.documentElement.scrollHeight,
  }));
  if (medium.width > 1600 || medium.height > 1000)
    throw new Error(`1600px overflow: ${JSON.stringify(medium)}`);
  await page.screenshot({
    path: resolve(output, "peakpilot-dashboard-1600.png"),
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  if (
    await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)
  )
    throw new Error("Mobile horizontal overflow.");
  await page.screenshot({
    path: resolve(output, "peakpilot-mobile.png"),
    fullPage: true,
  });

  const retina = await browser.newPage({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 2,
  });
  await retina.goto(process.env.APP_URL || "http://127.0.0.1:3000", {
    waitUntil: "networkidle",
  });
  await retina
    .locator(".results[aria-busy=false]")
    .waitFor({ timeout: 120000 });
  await retina.evaluate(() => document.fonts.ready);
  await retina.waitForTimeout(350);
  await retina.screenshot({
    path: resolve(output, "peakpilot-dashboard-3840.png"),
  });
  if (errors.length) throw new Error(`Browser errors: ${errors.join("\n")}`);
  const report = {
    status: "passed",
    desktop,
    medium,
    browserErrors: errors,
    browserWarnings: [...new Set(warnings)],
    checks: [
      "real API data",
      "reset at default parameters",
      "capacity recalculation",
      "building recalculation",
      "forecast toggle",
      "date navigation",
      "all navigation views",
      "methodology dialog",
      "JSON export",
      "1920×1080 layout",
      "1600×1000 layout",
      "390px mobile layout",
    ],
    exports: [
      "peakpilot-dashboard-1920.png",
      "peakpilot-dashboard-1600.png",
      "peakpilot-dashboard-3840.png",
      "peakpilot-dashboard.pdf",
      "peakpilot-mobile.png",
    ],
  };
  await writeFile(
    resolve(output, "browser-verification.json"),
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
