/** Skeleton bubbles, alternating sides so the shape matches a real thread. */
export default function ConversationThreadLoading() {
  return (
    <div className="mx-auto flex max-w-3xl flex-col md:h-dvh">
      <header className="border-border flex shrink-0 items-center gap-3 border-b px-4 py-3">
        <div className="bg-muted size-7 animate-pulse rounded-md" />
        <div className="flex flex-col gap-1.5">
          <div className="bg-muted h-4 w-40 animate-pulse rounded" />
          <div className="bg-muted h-3 w-24 animate-pulse rounded" />
        </div>
      </header>

      <div className="flex flex-col gap-2 px-4 py-4" aria-label="Loading messages">
        {Array.from({ length: 6 }, (_, index) => (
          <div
            key={index}
            className={index % 2 === 0 ? "flex justify-start" : "flex justify-end"}
          >
            <div className="bg-muted h-12 w-2/3 animate-pulse rounded-2xl sm:w-1/2" />
          </div>
        ))}
      </div>
    </div>
  );
}
