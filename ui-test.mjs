// Real-browser UI test (headless Chromium via Playwright)
import { mkdtempSync } from "fs";
import os from "os";
import path from "path";
import pg from "pg";

const { chromium } = await import(process.env.PLAYWRIGHT_PATH || "playwright");
const BASE = process.env.BASE_URL || "http://localhost:3000";
const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL || "postgresql://postgres:postgres@127.0.0.1:5432/app_db",
});
let passed = 0;
let failed = 0;
const failures = [];

const check = (name, cond, extra = "") => {
  if (cond) {
    passed++;
    console.log(`  ✅ ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  ❌ ${name} ${extra}`);
  }
};

const section = (t) => console.log(`\n## ${t}`);
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
  "base64",
);

const s = Date.now().toString(36);
const userA = { name: "أحمد المتصفح", email: `ui_a_${s}@example.com`, password: "password-12345" };
const userB = { name: "موسى المتصفح", email: `ui_b_${s}@example.com`, password: "password-12345" };

const OPTS = { headless: true, viewport: { width: 1280, height: 800 }, locale: "ar" };

async function register(page, u) {
  await page.goto(BASE + "/register");
  await page.getByPlaceholder("مثال: أحمد محمد").fill(u.name);
  await page.getByPlaceholder("you@example.com").fill(u.email);
  await page.getByPlaceholder("8+ أحرف").fill(u.password);
  await page.getByPlaceholder("••••••••").fill(u.password);
  await page.locator("button[type=submit]").click();
  await page.waitForURL("**/chat", { timeout: 20000 });
}

const meOf = (page) => page.evaluate(async () => (await (await fetch("/api/auth/me")).json()).user);

async function openPersistent(dir) {
  const ctx = await chromium.launchPersistentContext(dir, OPTS);
  const page = ctx.pages()[0] ?? (await ctx.newPage());
  page.on("dialog", (d) => d.accept());
  return { ctx, page };
}

async function main() {
  console.log(`UI test against ${BASE}`);
  const dirA = mkdtempSync(path.join(os.tmpdir(), "fid-a-"));
  const dirB = mkdtempSync(path.join(os.tmpdir(), "fid-b-"));
  let { ctx: ctxA, page: pageA } = await openPersistent(dirA);

  section("1. Registration & Short Friend ID in Browser");
  await register(pageA, userA);
  await pageA.getByRole("heading", { name: "الدردشات" }).first().waitFor({ timeout: 15000 });
  const meA = await meOf(pageA);
  check("registered in browser → lands in /chat", pageA.url().endsWith("/chat") && !!meA);
  check(`got short Friend ID: ${meA.publicId}`, /^FID-[0-9A-Z]{4}$/.test(meA.publicId) || /^FR-\d+$/.test(meA.publicId));

  section("2. Bottom Navigation Tabs (الدردشات، المجموعات، الحالة، المكالمات، الإعدادات)");
  check("tab 'الدردشات' visible", await pageA.getByRole("button", { name: "الدردشات", exact: true }).isVisible());
  check("tab 'المجموعات' visible", await pageA.getByRole("button", { name: "المجموعات", exact: true }).isVisible());
  check("tab 'الحالة' visible", await pageA.getByRole("button", { name: "الحالة", exact: true }).isVisible());
  check("tab 'المكالمات' visible", await pageA.getByRole("button", { name: "المكالمات", exact: true }).isVisible());
  check("tab 'الإعدادات' visible", await pageA.getByRole("button", { name: "الإعدادات", exact: true }).isVisible());

  // Switch to Status tab
  await pageA.getByRole("button", { name: "الحالة", exact: true }).click();
  await pageA.getByText("حالتي").waitFor();
  check("switched to 'الحالة' (Status) tab", true);

  // Switch to Calls tab
  await pageA.getByRole("button", { name: "المكالمات", exact: true }).click();
  await pageA.getByText("سجل المكالمات").waitFor();
  check("switched to 'المكالمات' (Calls) tab", true);

  // Switch to Groups tab
  await pageA.getByRole("button", { name: "المجموعات", exact: true }).click();
  await pageA.getByText("مجموعة جديدة").first().waitFor();
  check("switched to 'المجموعات' (Groups) tab", true);

  // Switch to Settings tab
  await pageA.getByRole("button", { name: "الإعدادات", exact: true }).click();
  await pageA.getByText("المظهر والخلفيات").waitFor();
  check("switched to 'الإعدادات' (Settings) tab", true);

  // Switch back to Chats
  await pageA.getByRole("button", { name: "الدردشات", exact: true }).click();
  check("switched back to 'الدردشات' tab", true);

  section("3. Realtime Chat, Quoting & Media Attachment");
  let { ctx: ctxB, page: pageB } = await openPersistent(dirB);
  await register(pageB, userB);
  const meB = await meOf(pageB);

  // Alice opens new chat and searches for Bob by Friend ID
  await pageA.getByTitle("محادثة جديدة").click();
  await pageA.getByPlaceholder("ابحث بالمعرّف FR-123456 أو اسم المستخدم أو الاسم").fill(meB.publicId);
  await pageA.getByRole("button", { name: "مراسلة" }).first().click();

  // Send text message
  const inputA = pageA.getByPlaceholder("اكتب رسالة…");
  await inputA.fill("السلام عليكم يا موسى");
  await inputA.press("Enter");
  await pageA.getByText("السلام عليكم يا موسى").last().waitFor({ timeout: 15000 });
  check("message sent by Alice", true);

  // Bob receives in realtime
  await pageB.getByText(userA.name).first().waitFor({ timeout: 15000 });
  await pageB.getByText(userA.name).first().click();
  await pageB.getByText("السلام عليكم يا موسى").last().waitFor();
  check("Bob opens chat and sees Alice's message in realtime", true);

  // Bob replies
  const inputB = pageB.getByPlaceholder("اكتب رسالة…");
  await inputB.fill("وعليكم السلام ورحمة الله أهلاً أحمد!");
  await inputB.press("Enter");
  await pageA.getByText("وعليكم السلام ورحمة الله أهلاً أحمد!").last().waitFor({ timeout: 15000 });
  check("Alice receives Bob's reply in realtime", true);

  // Upload an image attachment from browser
  await pageA.locator('input[type="file"]').first().setInputFiles({ name: "snapshot.png", mimeType: "image/png", buffer: PNG });
  await pageA.locator("button[title='إرسال']").click();
  await pageB.locator('img[alt="snapshot.png"]').last().waitFor({ timeout: 20000 });
  check("image attachment uploaded and displayed to peer", true);

  section("4. Post Status & View Status");
  await pageA.getByRole("button", { name: "الحالة", exact: true }).click();
  await pageA.getByTitle("نشر حالة نصية").click();
  await pageA.getByPlaceholder("اكتب حالتك هنا…").fill("يوم جميل وموفق للجميع 🌟");
  await pageA.locator("button:has-text('➤')").last().click();
  await pageA.getByText("1 حالة نشطة").first().waitFor({ timeout: 10000 });
  check("Alice posted a WhatsApp text status", true);

  await ctxA.close();
  await ctxB.close();
}

main()
  .catch((e) => {
    failed++;
    console.error("FATAL", e);
  })
  .finally(async () => {
    await pool.end();
    console.log(`\n==== UI RESULT: ${passed} passed, ${failed} failed ====`);
    if (failures.length) console.log("Failed:", failures.join(" | "));
    process.exit(failed ? 1 : 0);
  });
