export function Bar({ className = '' }: { className?: string }) {
  return <div className={`animate-shimmer rounded-full bg-line ${className}`} />;
}

export function HomeSkeleton() {
  return (
    <div className="px-5 pt-5" aria-busy="true" aria-label="Loading">
      <div className="flex items-center gap-3">
        <div className="h-9 w-9 animate-shimmer rounded-full bg-line" />
        <div className="space-y-2">
          <Bar className="h-3 w-24" />
          <Bar className="h-3 w-36" />
        </div>
      </div>
      <Bar className="mt-10 h-8 w-40" />
      <Bar className="mt-3 h-8 w-64" />
      <div className="mt-8 h-28 animate-shimmer rounded-3xl border border-dashed border-line" />
    </div>
  );
}

export function SplitSkeleton() {
  return (
    <div className="mx-auto max-w-xl px-5 pt-6" aria-busy="true" aria-label="Loading the split">
      <div className="rounded-3xl border border-dashed border-line p-5">
        <Bar className="h-3 w-24" />
        <Bar className="mt-4 h-6 w-56" />
        <Bar className="mt-5 h-3 w-full" />
        <div className="mt-5 flex gap-8">
          <Bar className="h-8 w-16" />
          <Bar className="h-8 w-16" />
        </div>
      </div>
      {[0, 1, 2].map((i) => (
        <div key={i} className="mt-3 rounded-3xl border border-dashed border-line p-5">
          <div className="flex items-center justify-between">
            <Bar className="h-4 w-28" />
            <Bar className="h-7 w-12" />
          </div>
          <Bar className="mt-4 h-2.5 w-full" />
          <div className="mt-4 flex gap-2">
            <Bar className="h-8 w-40" />
            <Bar className="h-8 w-24" />
          </div>
        </div>
      ))}
    </div>
  );
}
