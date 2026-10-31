import { Card, EmptyState, PageHeader, Pagination } from "@/components/admin/ui";
import { Badge } from "@/components/ui/badge";
import { getDb } from "@/lib/db";
import { formatDate } from "@/lib/utils";
import { MessageActions } from "./message-actions";

export const metadata = { title: "Messages" };

const PER_PAGE = 20;

export default async function AdminMessagesPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const page = Math.max(1, Number((await searchParams).page) || 1);
  const db = await getDb();
  const [total, messages] = await Promise.all([
    db.selectFrom("contact_messages").select((eb) => eb.fn.countAll<number>().as("n")).executeTakeFirst(),
    db
      .selectFrom("contact_messages")
      .selectAll()
      .orderBy("id", "desc")
      .limit(PER_PAGE)
      .offset((page - 1) * PER_PAGE)
      .execute(),
  ]);
  const pages = Math.max(1, Math.ceil(Number(total?.n ?? 0) / PER_PAGE));

  return (
    <>
      <PageHeader title="Messages" description="Messages sent from the contact page." />
      <Card padded={false}>
        {messages.length ? (
          <ul className="divide-y divide-line">
            {messages.map((m) => (
              <li key={m.id} className={m.is_read ? "px-5 py-4" : "bg-primary-soft/40 px-5 py-4"}>
                <details>
                  <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1">
                    {!m.is_read ? <Badge tone="primary">New</Badge> : null}
                    <span className="font-medium">{m.subject}</span>
                    <span className="text-sm text-muted">
                      {m.name} &lt;{m.email}&gt;
                    </span>
                    <span className="ml-auto text-xs text-muted">{formatDate(m.created_at, true)}</span>
                  </summary>
                  <p className="mt-3 max-w-[75ch] text-sm leading-relaxed whitespace-pre-line">{m.message}</p>
                  <div className="mt-4 flex flex-wrap items-center gap-2">
                    <a
                      href={`mailto:${m.email}?subject=${encodeURIComponent(`Re: ${m.subject}`)}`}
                      className="inline-flex h-8 items-center rounded-lg bg-primary px-3 text-sm font-medium text-white"
                    >
                      Reply by email
                    </a>
                    <MessageActions id={m.id} read={m.is_read === 1} />
                  </div>
                </details>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No messages yet">Messages from the contact page will appear here.</EmptyState>
        )}
        <Pagination page={page} pages={pages} href={(p) => `/admin/messages?page=${p}`} />
      </Card>
    </>
  );
}
