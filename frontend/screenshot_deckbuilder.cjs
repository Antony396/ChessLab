const { chromium } = require("playwright");

const AUTH = {
  token: "38a32a6140b242108c81cf0158aa3eb2",
  user: { id: "324383a744534ebf85fc515bf4125871", username: "visualtestacct13", elo: 1000, currency: 0, equipped_skin: "classic", xp: 0, level: 1 },
};

async function main() {
  const width = process.argv[2] ? parseInt(process.argv[2]) : 1000;
  const height = process.argv[3] ? parseInt(process.argv[3]) : 1400;
  const outPath = process.argv[4] || "deckbuilder_screenshot.png";

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto("http://localhost:5173/");
  await page.evaluate((auth) => {
    localStorage.setItem("evoChessAuth", JSON.stringify(auth));
  }, AUTH);
  await page.reload();
  await page.waitForTimeout(2000);
  await page.click(".hub-trigger-pedestal", { force: true });
  await page.waitForTimeout(1000);
  await page.screenshot({ path: outPath, fullPage: true });
  await browser.close();
  console.log("saved", outPath, `${width}x${height}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
