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

export function AvailabilitySkeleton({ withHeader = false }: { withHeader?: boolean }) {
  return (
    <div className="mx-auto max-w-xl px-4 pt-5" aria-busy="true" aria-label="Loading availability">
      {withHeader && (
        <div className="mb-6 flex items-center gap-3 px-1">
          <div className="h-9 w-9 animate-shimmer rounded-full bg-line" />
          <div className="space-y-2">
            <Bar className="h-3 w-24" />
            <Bar className="h-3 w-36" />
          </div>
        </div>
      )}
      <div className="px-1">
        <Bar className="h-7 w-56" />
        <Bar className="mt-3 h-3 w-72" />
        <Bar className="mt-6 h-11 w-full" />
      </div>
      <div className="mt-6 grid grid-cols-[38px_repeat(7,minmax(0,1fr))] gap-y-2">
        <div />
        {Array.from({ length: 7 }, (_, i) => (
          <div key={i} className="flex flex-col items-center gap-1.5">
            <Bar className="h-2.5 w-6" />
            <Bar className="h-5 w-5" />
          </div>
        ))}
      </div>
      <div className="mt-3 ml-[38px] h-[520px] animate-shimmer rounded-xl border border-dashed border-line" />
    </div>
  );
}

export function ChatSkeleton() {
  const rows: Array<{ me: boolean; w: string; h: string }> = [
    { me: false, w: 'w-56', h: 'h-14' },
    { me: true, w: 'w-40', h: 'h-10' },
    { me: false, w: 'w-64', h: 'h-24' },
    { me: true, w: 'w-48', h: 'h-10' },
    { me: false, w: 'w-52', h: 'h-16' },
  ];
  return (
    <div className="flex h-full flex-col" aria-busy="true" aria-label="Loading your chat">
      <div className="flex flex-1 flex-col justify-end gap-3 px-4 pb-4">
        {rows.map((r, i) => (
          <div key={i} className={`flex items-end gap-2 ${r.me ? 'justify-end' : ''}`}>
            {!r.me && <div className="h-7 w-7 shrink-0 animate-shimmer rounded-full bg-line" />}
            <div
              className={`${r.w} ${r.h} animate-shimmer rounded-[20px] ${r.me ? 'rounded-br-md bg-line' : 'rounded-bl-md bg-panel'}`}
              style={{ animationDelay: `${i * 120}ms` }}
            />
          </div>
        ))}
      </div>
      <div className="border-t border-dashed border-line px-3 pt-2.5 pb-[max(12px,env(safe-area-inset-bottom))]">
        <div className="h-11 animate-shimmer rounded-[22px] border border-line bg-panel" />
      </div>
    </div>
  );
}

export function ProgressSkeleton() {
  return (
    <div className="mx-auto max-w-xl px-5 pt-6" aria-busy="true" aria-label="Loading progress">
      <Bar className="h-7 w-36" />
      <div className="mt-5 rounded-3xl border border-dashed border-line p-5">
        <div className="flex items-center justify-between">
          <Bar className="h-3 w-24" />
          <Bar className="h-6 w-24" />
        </div>
        <Bar className="mt-4 h-6 w-56" />
        <div className="mt-6 flex items-end justify-between">
          <Bar className="h-14 w-28" />
          <Bar className="h-8 w-24" />
        </div>
        <Bar className="mt-4 h-3.5 w-full" />
      </div>
      <Bar className="mt-8 h-3 w-24" />
      {[0, 1].map((i) => (
        <div key={i} className="mt-3 rounded-3xl border border-dashed border-line p-4">
          <div className="flex items-center gap-3.5">
            <div className="h-8 w-8 animate-shimmer rounded-full bg-line" />
            <Bar className="h-4 flex-1" />
            <Bar className="h-6 w-10" />
          </div>
          <Bar className="mt-4 h-9 w-full" />
        </div>
      ))}
      <Bar className="mt-8 h-3 w-16" />
      {[0, 1].map((i) => (
        <div key={i} className="mt-3 rounded-3xl border border-dashed border-line p-5">
          <div className="flex items-center justify-between">
            <Bar className="h-4 w-28" />
            <Bar className="h-7 w-12" />
          </div>
          <Bar className="mt-4 h-2.5 w-full" />
          <div className="mt-4 flex gap-2">
            <Bar className="h-7 w-36" />
            <Bar className="h-7 w-24" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function FeedStatusSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading calendar status">
      <div className="flex items-center gap-3">
        <div className="h-3 w-3 animate-shimmer rounded-full bg-line" />
        <Bar className="h-4 w-32" />
      </div>
      <div className="mt-5 grid grid-cols-2 gap-3">
        <div className="h-16 animate-shimmer rounded-2xl border border-dashed border-line" />
        <div className="h-16 animate-shimmer rounded-2xl border border-dashed border-line" />
      </div>
      <div className="mt-4 flex gap-2">
        <Bar className="h-7 w-28" />
        <Bar className="h-7 w-24" />
      </div>
    </div>
  );
}

export function UpcomingSkeleton() {
  return (
    <div className="mx-auto max-w-xl px-5 pt-6" aria-busy="true" aria-label="Loading what's due">
      <Bar className="h-7 w-36" />
      <Bar className="mt-3 h-3 w-56" />
      <div className="mt-6 h-20 animate-shimmer rounded-3xl border border-dashed border-line" />
      {[3, 2].map((n, g) => (
        <div key={g} className="mt-8">
          <Bar className="h-3 w-20" />
          {Array.from({ length: n }, (_, i) => (
            <div
              key={i}
              className="mt-3 flex items-start gap-3.5 rounded-3xl border border-dashed border-line p-4"
              style={{ animationDelay: `${i * 120}ms` }}
            >
              <div className="h-10 w-10 shrink-0 animate-shimmer rounded-full bg-line" />
              <div className="flex-1 space-y-2.5">
                <Bar className="h-4 w-4/5" />
                <div className="flex gap-2">
                  <Bar className="h-5 w-20" />
                  <Bar className="h-5 w-16" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
