const { chromium } = require("playwright");

const AUTH = {
  token: "9c770be152d347b8940f039ffb81f623",
  user: { id: "001ef7e6958d4956bd20209690abd7d6", username: "visualtestacct12", elo: 1000, currency: 0, equipped_skin: "classic", xp: 0, level: 1 },
};

async function main() {
  const width = process.argv[2] ? parseInt(process.argv[2]) : 1600;
  const height = process.argv[3] ? parseInt(process.argv[3]) : 1000;
  const outPath = process.argv[4] || "hub_screenshot.png";

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width, height } });
  await page.goto("http://localhost:5173/");
  await page.evaluate((auth) => {
    localStorage.setItem("evoChessAuth", JSON.stringify(auth));
  }, AUTH);
  await page.reload();
  await page.waitForTimeout(2500);
  await page.screenshot({ path: outPath });
  await browser.close();
  console.log("saved", outPath, `${width}x${height}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
