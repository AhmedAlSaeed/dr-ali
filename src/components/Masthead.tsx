import type { Conference } from "@/lib/deck";

/** Conference identity: university logo, series name, speaker, date. */
export function Masthead({ conference, meta }: { conference?: Conference; meta?: string }) {
  if (!conference) return null;
  return (
    <header className="flex flex-row items-center gap-5 sm:gap-6">
      {conference.logo && (
        <img
          src={`${import.meta.env.BASE_URL}${conference.logo}`}
          alt={conference.institution}
          className="h-16 w-auto shrink-0 self-center opacity-95 sm:h-20"
        />
      )}

      <div className="min-w-0">
        <h1 className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl">
          {conference.title}
        </h1>
        <p className="mt-2 text-xl font-semibold tracking-tight sm:text-2xl">
          {conference.speaker}
        </p>
        <p className="text-muted-foreground mt-1 text-sm">
          {meta ? <span>{meta}</span> : null}
          {conference.date ? <span>{meta ? " · " : ""}{conference.date}</span> : null}
        </p>
      </div>
    </header>
  );
}
