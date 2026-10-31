/**
 * The columns a contact CSV can be mapped to, and a best guess from the header row. Shared by the
 * import wizard (client) and the import itself (src/lib/contacts-import.ts).
 */

export const IMPORT_FIELDS = [
  "phone",
  "first_name",
  "last_name",
  "name",
  "email",
  "company",
  "timezone",
  "state",
  "country",
  "language",
  "tags",
  "consent_type",
  "consent_source",
  "consent_captured_at",
  "consent_ip",
  "consent_text",
  "consent_url",
  "consent_purpose",
  "custom",
] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];
/** One entry per CSV column: what it holds ("" = ignore the column). */
export type ImportMapping = Array<ImportField | "">;

const HEADER_GUESSES: Array<[RegExp, ImportField]> = [
  [/^(phone|phone ?number|mobile|mobile ?number|cell|cell ?phone|tel|telephone|number|msisdn|whatsapp|contact ?number)$/, "phone"],
  [/^(first ?name|firstname|given ?name|forename|fname)$/, "first_name"],
  [/^(last ?name|lastname|surname|family ?name|lname)$/, "last_name"],
  [/^(name|full ?name|contact ?name|customer ?name)$/, "name"],
  [/^(e-?mail|email ?address)$/, "email"],
  [/^(company|organi[sz]ation|business|account|company ?name)$/, "company"],
  [/^(time ?zone|tz|timezone)$/, "timezone"],
  [/^(state|region|province|us ?state)$/, "state"],
  [/^(country|country ?code)$/, "country"],
  [/^(language|lang|locale)$/, "language"],
  [/^(tags?|labels?|segments?)$/, "tags"],
  [/^(consent|consent ?type|consent ?kind|opt.?in ?type)$/, "consent_type"],
  [/^(consent ?source|source|opt.?in ?source|lead ?source)$/, "consent_source"],
  [/^(consent ?(date|time|at)|consent ?captured( ?at)?|captured ?at|opt.?in ?(date|time|at)|consented ?at)$/, "consent_captured_at"],
  [/^(consent ?ip|ip|ip ?address|opt.?in ?ip)$/, "consent_ip"],
  [/^(consent ?(text|wording|language|snapshot)|disclosure ?text|opt.?in ?text)$/, "consent_text"],
  [/^(consent ?url|source ?url|form ?url|page ?url|opt.?in ?url)$/, "consent_url"],
  [/^(consent ?purpose|purpose)$/, "consent_purpose"],
];

/** Best guess of what each column holds, from its header. Unknown headers become custom fields. */
export function suggestMapping(headers: string[]): ImportMapping {
  const used = new Set<ImportField>();
  return headers.map((h) => {
    const key = h.toLowerCase().replace(/[_.]+/g, " ").replace(/\s+/g, " ").trim();
    for (const [re, field] of HEADER_GUESSES) {
      if (re.test(key) && !used.has(field)) {
        used.add(field);
        return field;
      }
    }
    return key ? "custom" : "";
  });
}
