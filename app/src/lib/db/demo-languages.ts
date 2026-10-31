import "server-only";
import type { Kysely } from "kysely";
import type { Database } from "./schema";
import { acquireSeedLock, finishSeedLock, releaseSeedLock } from "./seed-lock";

/** Translations of the default site texts, so the demo's home page is fully translated. */
const SITE_TEXTS: Record<string, Record<string, string>> = {
  ar: {
    "setting.site_tagline": "وكلاء هاتف بالذكاء الاصطناعي للدعم والحجوزات والمتابعة",
    "setting.home_hero_title": "وكلاء هاتف بالذكاء الاصطناعي يجيبون ويحجزون ويتابعون.",
    "setting.home_hero_subtitle":
      "أنشئ وكيلًا صوتيًا في دقائق، وزوّده بقاعدة معارفك وتقويمك، ودعه يتولى المكالمات الواردة والحجوزات والمتابعات التي وافق عليها العملاء، مع الإفصاح عن الذكاء الاصطناعي وسجلات الموافقة والتحقق من قوائم عدم الاتصال.",
    "setting.footer_text": "وكلاء صوتيون بالذكاء الاصطناعي يجيبون على المكالمات ويحجزون المواعيد ويتابعون، مع أدوات الموافقة والامتثال المدمجة.",
    "setting.copyright_text": "© {year} {site_name}. جميع الحقوق محفوظة.",
    "setting.cookie_consent_text": "نستخدم ملفات تعريف الارتباط لإبقائك مسجلًا الدخول ولفهم كيفية استخدام الموقع. باستمرارك في التصفح فإنك توافق على استخدامنا لها.",
  },
  hi: {
    "setting.site_tagline": "सपोर्ट, बुकिंग और फ़ॉलो-अप के लिए AI फ़ोन एजेंट",
    "setting.home_hero_title": "AI फ़ोन एजेंट जो कॉल उठाते हैं, बुकिंग करते हैं और फ़ॉलो-अप करते हैं।",
    "setting.home_hero_subtitle":
      "मिनटों में वॉइस एजेंट बनाएँ, उसे अपना नॉलेज बेस और कैलेंडर दें, और उसे इनबाउंड कॉल, बुकिंग और सहमति से होने वाले फ़ॉलो-अप संभालने दें। AI डिस्क्लोज़र, सहमति रिकॉर्ड और डू-नॉट-कॉल जाँच पहले से शामिल हैं।",
    "setting.footer_text": "AI वॉइस एजेंट जो कॉल का जवाब देते हैं, अपॉइंटमेंट बुक करते हैं और फ़ॉलो-अप करते हैं, सहमति और कंप्लायंस टूल्स के साथ।",
    "setting.copyright_text": "© {year} {site_name}. सर्वाधिकार सुरक्षित।",
    "setting.cookie_consent_text": "हम आपको साइन इन रखने और साइट के इस्तेमाल को समझने के लिए कुकी का इस्तेमाल करते हैं। आगे बढ़कर आप कुकी के इस्तेमाल से सहमत होते हैं।",
  },
};

interface LanguagePack {
  language: { code: string; name: string; native_name: string; direction: "ltr" | "rtl" };
  translations: Record<string, string>;
}

/** Install the bundled Hindi and Arabic packs on a demo site (once, guarded by a settings row). */
export async function seedDemoLanguages(db: Kysely<Database>): Promise<void> {
  const lock = await acquireSeedLock(db, "demo_languages_seeded_at");
  if (!lock) return;
  try {
    await installPacks(db);
  } catch (err) {
    await releaseSeedLock(db, lock);
    throw err;
  }
  await finishSeedLock(db, lock);
}

async function installPacks(db: Kysely<Database>): Promise<void> {
  const packs = [(await import("../../../languages/hi.json")).default, (await import("../../../languages/ar.json")).default] as LanguagePack[];
  for (const [index, pack] of packs.entries()) {
    const { code, name, native_name, direction } = pack.language;
    const exists = await db.selectFrom("languages").select("code").where("code", "=", code).executeTakeFirst();
    if (exists) continue;
    const rows = Object.entries({ ...pack.translations, ...SITE_TEXTS[code] }).map(([key, value]) => ({ lang: code, key, value }));
    await db.transaction().execute(async (trx) => {
      await trx.insertInto("languages").values({ code, name, native_name, direction, is_active: 1, sort_order: (index + 1) * 10 }).execute();
      for (let i = 0; i < rows.length; i += 200) await trx.insertInto("translations").values(rows.slice(i, i + 200)).execute();
    });
  }
}
