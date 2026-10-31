export default function DashboardLoading() {
  return (
    <div className="animate-pulse" aria-busy="true" aria-live="polite">
      <div className="h-8 w-48 rounded-lg bg-line/70" />
      <div className="mt-2 h-4 w-72 max-w-full rounded bg-line/50" />
      <div className="mt-8 h-32 rounded-2xl border border-line bg-surface" />
      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
        <div className="h-80 rounded-xl border border-line bg-surface" />
        <div className="h-80 rounded-xl border border-line bg-surface" />
      </div>
    </div>
  );
}
