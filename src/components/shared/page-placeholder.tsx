/**
 * Renders an unimplemented route.
 *
 * Every placeholder names the roadmap task that will replace it, so an
 * unfinished screen reached in the browser explains itself instead of looking
 * like a bug.
 */
export function PagePlaceholder({
  title,
  description,
  implementedBy,
}: {
  title: string;
  description: string;
  implementedBy: string;
}) {
  return (
    <div className="mx-auto max-w-3xl px-6 py-10">
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-muted-foreground mt-2 text-sm leading-relaxed">{description}</p>

      <p className="border-border text-muted-foreground mt-6 rounded-md border border-dashed px-4 py-3 text-sm">
        Not implemented yet &mdash; planned for{" "}
        <span className="text-foreground font-medium">{implementedBy}</span>.
      </p>
    </div>
  );
}
