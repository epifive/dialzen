import "server-only";
import type { Insertable, Kysely } from "kysely";
import { seedDemoVoice } from "./demo-voice";
import { acquireSeedLock, finishSeedLock, releaseSeedLock } from "./seed-lock";
import type { Database, PaymentsTable } from "./schema";

/**
 * Sample users, payments and messages so a public demo's admin panel looks like a real, busy
 * site. Runs only once per database and uses multi-row inserts so it stays fast on remote
 * (cloud) databases. Workspaces, agents, numbers, contacts, campaigns and 60 days of calls come
 * from demo-voice.ts, in the same transaction.
 */

const DAY = 86_400_000;
const FIRST = ["Emma", "Liam", "Olivia", "Noah", "Ava", "Arjun", "Priya", "Lucas", "Mia", "Ethan", "Sofia", "Yuki", "Mateo", "Aisha", "Daniel", "Chloe", "Rahul", "Fatima", "Leo", "Hannah", "Omar", "Grace", "Kenji", "Isabella", "Samuel", "Zara", "Diego", "Nora", "Ravi", "Elena"];
const LAST = ["Johnson", "Patel", "Garcia", "Kim", "Rossi", "Silva", "Khan", "Nguyen", "Smith", "Tanaka", "Haddad", "Brown", "Sharma", "Lopez", "Novak", "Okafor", "Dubois"];
const DOMAINS = ["gmail.com", "outlook.com", "studio.io", "agency.co", "mail.com", "proton.me"];
type PaymentRow = Insertable<PaymentsTable>;

/** The public address of the demo (its host may embed the showcase widget). */
function demoSiteUrl(): string {
  const site = process.env.SITE_URL?.trim();
  if (site && /^https?:\/\//.test(site)) return site.replace(/\/+$/, "");
  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  return vercel ? `https://${vercel}` : "";
}

export async function seedDemoData(db: Kysely<Database>): Promise<void> {
  // Sample data is seeded once an administrator exists (ADMIN_EMAIL/ADMIN_PASSWORD).
  const hasAdmin = await db.selectFrom("users").select("id").where("role", "=", "admin").orderBy("id").executeTakeFirst();
  if (!hasAdmin) return;
  // The settings row doubles as a lock: only the instance that holds it seeds (see seed-lock.ts).
  const lock = await acquireSeedLock(db, "demo_seeded_at");
  if (!lock) return;

  const started = Date.now();
  let seed = 42;
  const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const pick = <T,>(arr: readonly T[]) => arr[Math.floor(rand() * arr.length)];
  const now = Date.now();
  const iso = (msAgo: number) => new Date(now - msAgo).toISOString();

  try {
    await db.transaction().execute(async (trx) => {
      const paid = await trx.selectFrom("plans").select(["id", "price_monthly", "price_yearly"]).where("is_free", "=", 0).orderBy("sort_order").execute();
      if (paid.length < 2) return;
      const [pro, agency] = paid;
      const businessId = agency.id;

      // Settings that make every admin screen meaningful.
      for (const [key, value] of Object.entries({ offline_enabled: "1", currency: "USD" })) {
        const exists = await trx.selectFrom("settings").select("key").where("key", "=", key).executeTakeFirst();
        if (exists) await trx.updateTable("settings").set({ value }).where("key", "=", key).execute();
        else {
          try {
            await trx.insertInto("settings").values({ key, value }).execute();
          } catch {
            await trx.updateTable("settings").set({ value }).where("key", "=", key).execute();
          }
        }
      }

      const userRows = Array.from({ length: 45 }, (_, i) => {
        const created = iso(Math.floor(rand() * 60) * DAY + Math.floor(rand() * DAY));
        const plan = i % 3 === 0 ? (i % 9 === 0 ? businessId : pro.id) : null;
        const first = FIRST[i % FIRST.length];
        const last = pick(LAST);
        return {
          name: `${first} ${last}`,
          email: `${first}.${last}${i}@${pick(DOMAINS)}`.toLowerCase(),
          // Not a valid hash: sample users can never sign in.
          password_hash: "disabled",
          role: "user" as const,
          status: i === 7 ? ("banned" as const) : ("active" as const),
          plan_id: plan,
          plan_expires_at: plan ? iso(-(10 + Math.floor(rand() * 300)) * DAY) : null,
          stripe_customer_id: null,
          stripe_subscription_id: null,
          created_at: created,
          updated_at: created,
        };
      });
      // Insert oldest first so lists sorted by id also read in date order.
      userRows.sort((a, b) => a.created_at.localeCompare(b.created_at));
      await trx.insertInto("users").values(userRows).execute();
      const inserted = await trx
        .selectFrom("users")
        .select(["id", "email"])
        .where("email", "in", userRows.map((u) => u.email))
        .execute();
      const idByEmail = new Map(inserted.map((u) => [u.email, u.id]));
      const users = userRows.map((u) => ({ id: idByEmail.get(u.email)!, plan: u.plan_id }));

      let ref = 1000;
      const payments: PaymentRow[] = [];
      for (const u of users) {
        if (!u.plan) continue;
        for (let n = 0; n < 2; n++) {
          const yearly = rand() < 0.3;
          payments.push({
            user_id: u.id,
            plan_id: u.plan,
            amount: u.plan === businessId ? (yearly ? agency.price_yearly : agency.price_monthly) : yearly ? pro.price_yearly : pro.price_monthly,
            currency: "USD",
            billing_cycle: yearly ? "yearly" : "monthly",
            provider: pick(["stripe", "stripe", "paypal", "razorpay"] as const),
            provider_ref: `demo:${ref++}`,
            status: "paid",
            note: null,
            created_at: iso(Math.floor(rand() * 40) * DAY + 3_600_000),
          });
        }
      }
      const pendingTransfers = [
        { user: users[4].id, plan: pro.id, amount: pro.price_monthly, note: "UTR 4821 9930 1127", hoursAgo: 3 },
        { user: users[10].id, plan: businessId, amount: agency.price_monthly, note: "TRX-20261015-883", hoursAgo: 9 },
      ];
      for (const t of pendingTransfers) {
        payments.push({
          user_id: t.user,
          plan_id: t.plan,
          amount: t.amount,
          currency: "USD",
          billing_cycle: "monthly",
          provider: "offline",
          provider_ref: `demo:${ref++}`,
          status: "pending",
          note: t.note,
          created_at: iso(t.hoursAgo * 3_600_000),
        });
      }
      payments.sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
      await trx.insertInto("payments").values(payments).execute();

      // Workspaces, agents, numbers, contacts, campaigns, 60 days of calls, wallets and the audit log.
      const voice = Date.now();
      const counts = await seedDemoVoice(trx, { adminId: hasAdmin.id, siteUrl: demoSiteUrl(), rand });
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      console.log(`[dialzen] voice demo data: ${total} rows in ${Date.now() - voice} ms`, counts);

      await trx
        .insertInto("contact_messages")
        .values([
          { name: "Priya Sharma", email: "priya@studio.io", subject: "Hindi voice agent", message: "Can one agent answer in Hindi and switch to English when the caller does, and can the first message mention that it's an AI in both languages?", ip: null, is_read: 0, created_at: iso(2 * 3_600_000) },
          { name: "Daniel Brown", email: "daniel@agency.co", subject: "Agency plan question", message: "We run reception agents for about fifteen dental clinics. Can each clinic have its own workspace, number and calendar, with the widget in their colours?", ip: null, is_read: 0, created_at: iso(20 * 3_600_000) },
          { name: "Kenji Tanaka", email: "kenji@mail.com", subject: "Thank you", message: "The reminder agent confirmed 40 appointments last week and moved six of them without anyone on our side picking up the phone. Thanks!", ip: null, is_read: 1, created_at: iso(3 * DAY) },
        ])
        .execute();
    });
  } catch (err) {
    // Release the lock so the next request tries again instead of leaving an empty demo.
    await releaseSeedLock(db, lock);
    throw err;
  }
  await finishSeedLock(db, lock);
  console.log(`[dialzen] demo data seeded in ${Date.now() - started} ms`);
}
