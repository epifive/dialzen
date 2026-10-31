import type { Person } from "./demo-voice-scripts";

/**
 * Names and fictional phone numbers of the voice demo seed. Numbers come from ranges reserved for
 * fiction or that are clearly sample data: NANP 555-01XX, Ofcom's drama range 07700 900XXX,
 * and "555" / "9999" blocks for the UAE and India. Pure.
 */

export type NameSet = "en" | "es" | "ar" | "hi" | "uk";

const NAMES: Record<NameSet, { first: string[]; last: string[]; latin?: Record<string, string> }> = {
  en: {
    first: ["Emily", "Michael", "Sarah", "David", "Jessica", "James", "Ashley", "Daniel", "Olivia", "Ethan", "Sophia", "Benjamin", "Chloe", "Ryan", "Grace", "Kevin", "Hannah", "Jason", "Megan", "Andrew", "Lauren", "Brandon", "Natalie", "Tyler", "Rachel", "Justin", "Amanda", "Eric", "Victoria", "Nathan", "Priya", "Arjun", "Mei", "Wei", "Hiro", "Yuki", "Fatima", "Amara", "Kwame", "Zoe", "Lily", "Noah", "Mason", "Ava", "Isabella", "Lucas", "Leo", "Maya", "Nina", "Owen", "Caleb", "Aaron", "Julia", "Claire", "Diana", "Marcus", "Tanya", "Rosa", "Samuel", "Ruth"],
    last: ["Johnson", "Chen", "Davis", "Miller", "Wilson", "Nguyen", "Patel", "Kim", "Thompson", "Garcia", "Martinez", "Anderson", "Taylor", "Lee", "Walker", "Hall", "Young", "King", "Wright", "Lopez", "Hill", "Scott", "Green", "Adams", "Baker", "Nelson", "Carter", "Mitchell", "Roberts", "Turner", "Phillips", "Campbell", "Parker", "Evans", "Edwards", "Collins", "Stewart", "Morris", "Murphy", "Cook", "Rogers", "Morgan", "Cooper", "Peterson", "Reed", "Bailey", "Bell", "Kelly", "Howard", "Ward", "Brooks", "Bennett", "Gray", "Hughes", "Price", "Sanders", "Ross", "Foster", "Tanaka", "Okafor", "Singh", "Shah", "Rossi", "Novak"],
  },
  es: {
    first: ["Lucía", "José", "María", "Carlos", "Ana", "Luis", "Sofía", "Miguel", "Gabriela", "Javier", "Valeria", "Diego", "Camila", "Andrés", "Daniela", "Fernando", "Isabel", "Ricardo", "Paola", "Manuel"],
    last: ["Hernández", "Ramírez", "González", "Flores", "Torres", "Morales", "Castillo", "Ortiz", "Rojas", "Mendoza", "Cruz", "Herrera", "Reyes", "Vargas", "Jiménez", "Ruiz", "Navarro", "Medina", "Aguilar", "Domínguez"],
  },
  ar: {
    first: ["عمر", "ليلى", "يوسف", "سارة", "خالد", "نورة", "أحمد", "ريم", "فيصل", "مريم", "حسن", "هدى", "سلطان", "فاطمة", "راشد", "عائشة"],
    last: ["حداد", "منصور", "الأمين", "الخطيب", "العتيبي", "السويدي", "الشامسي", "القاسمي", "الهاشمي", "الزعابي", "البلوشي", "المهيري"],
    latin: {
      عمر: "omar", ليلى: "layla", يوسف: "yousef", سارة: "sara", خالد: "khalid", نورة: "noura", أحمد: "ahmed", ريم: "reem", فيصل: "faisal", مريم: "maryam", حسن: "hassan", هدى: "huda", سلطان: "sultan", فاطمة: "fatima", راشد: "rashid", عائشة: "aisha",
      حداد: "haddad", منصور: "mansour", الأمين: "alamin", الخطيب: "alkhatib", العتيبي: "alotaibi", السويدي: "alsuwaidi", الشامسي: "alshamsi", القاسمي: "alqasimi", الهاشمي: "alhashimi", الزعابي: "alzaabi", البلوشي: "albalushi", المهيري: "almheiri",
    },
  },
  hi: {
    first: ["प्रिया", "राहुल", "अंजलि", "अमित", "सुनीता", "विकास", "नेहा", "रोहन", "पूजा", "अर्जुन"],
    last: ["शर्मा", "वर्मा", "गुप्ता", "पटेल", "यादव", "सिंह", "जोशी", "मेहता"],
    latin: { प्रिया: "priya", राहुल: "rahul", अंजलि: "anjali", अमित: "amit", सुनीता: "sunita", विकास: "vikas", नेहा: "neha", रोहन: "rohan", पूजा: "pooja", अर्जुन: "arjun", शर्मा: "sharma", वर्मा: "verma", गुप्ता: "gupta", पटेल: "patel", यादव: "yadav", सिंह: "singh", जोशी: "joshi", मेहता: "mehta" },
  },
  uk: {
    first: ["Oliver", "Charlotte", "Harry", "Amelia", "George", "Isla", "Jack", "Emily", "Thomas", "Sophie", "Rahul", "Anna", "Mark", "Priyanka", "Sven", "Elena", "Daniel", "Hannah"],
    last: ["Bennett", "Hughes", "Clarke", "Wright", "Turner", "Robinson", "Thompson", "Watson", "Price", "Edwards", "Menon", "Kowalski", "Stevens", "Nair", "Larsen", "Petrova", "O'Brien", "Fletcher"],
  },
};

const ascii = (s: string) =>
  s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");

export function makePerson(r: () => number, set: NameSet, phone: string, emailDomain = "example.com"): Person {
  const n = NAMES[set];
  const first = n.first[Math.floor(r() * n.first.length)];
  const last = n.last[Math.floor(r() * n.last.length)];
  const local = n.latin ? `${n.latin[first] ?? "client"}.${n.latin[last] ?? "x"}` : `${ascii(first)}.${ascii(last)}`;
  return { first, last, name: `${first} ${last}`, phone, email: `${local}${Math.floor(r() * 90) + 10}@${emailDomain}` };
}

/** Draws unused fictional numbers (one pool per workspace). */
export class PhonePool {
  private used = new Set<string>();
  constructor(
    private readonly r: () => number,
    private readonly make: (r: () => number) => string,
  ) {}
  take(): string {
    for (let i = 0; i < 500; i++) {
      const n = this.make(this.r);
      if (!this.used.has(n)) {
        this.used.add(n);
        return n;
      }
    }
    throw new Error("Demo phone pool exhausted");
  }
  reserve(n: string): void {
    this.used.add(n);
  }
}

const two = (r: () => number) => String(Math.floor(r() * 100)).padStart(2, "0");
const pickOf = <T>(r: () => number, list: readonly T[]) => list[Math.floor(r() * list.length)];

/** +1 <Bay Area code> 555-01XX. */
export const bayArea = (r: () => number) => `+1${pickOf(r, ["415", "628", "510", "650", "408", "925", "707", "831", "209", "916"])}55501${two(r)}`;
/** +1 <Chicago code> 555-01XX. */
export const chicago = (r: () => number) => `+1${pickOf(r, ["312", "773", "872", "630", "847"])}55501${two(r)}`;
/** UAE mobile 050 555 0XXX. */
export const uaeMobile = (r: () => number) => `+97150555${String(100 + Math.floor(r() * 900)).padStart(4, "0")}`;
/** UK mobile drama range 07700 900XXX. */
export const ukDrama = (r: () => number) => `+447700900${String(Math.floor(r() * 1000)).padStart(3, "0")}`;
/** India mobile 99999 0XXXX. */
export const indiaMobile = (r: () => number) => `+9199999${String(Math.floor(r() * 100_000)).padStart(5, "0")}`;
