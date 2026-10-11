import { useEffect, useState } from "react";
import { CasePage } from "@/components/CasePage";
import { IndexPage } from "@/components/IndexPage";
import { loadDeck, type Deck } from "@/lib/deck";

function useHashRoute() {
  const [hash, setHash] = useState(() => window.location.hash || "#/");
  useEffect(() => {
    const onChange = () => setHash(window.location.hash || "#/");
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash;
}

export default function App() {
  const [deck, setDeck] = useState<Deck | null>(null);
  const [error, setError] = useState<string | null>(null);
  const route = useHashRoute();

  useEffect(() => {
    loadDeck().then(setDeck).catch((e: Error) => setError(e.message));
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "instant" as ScrollBehavior });
  }, [route]);

  if (error) {
    return (
      <div className="mx-auto max-w-xl px-6 py-24 text-center">
        <h1 className="text-lg font-semibold">Could not load the deck</h1>
        <p className="text-muted-foreground mt-2 text-sm">{error}</p>
        <p className="text-muted-foreground mt-4 text-sm">
          Run <code className="bg-muted rounded px-1.5 py-0.5">npm run extract</code> to generate
          <code className="bg-muted ml-1 rounded px-1.5 py-0.5">public/content.json</code>.
        </p>
      </div>
    );
  }
  if (!deck) {
    return <div className="text-muted-foreground px-6 py-24 text-center text-sm">Loading deck…</div>;
  }

  const back = () => (window.location.hash = "#/");
  const caseMatch = route.match(/^#\/c\/(\d+)/);

  if (caseMatch) {
    const n = Number(caseMatch[1]);
    const entry = deck.cases.find((c) => c.n === n);
    if (!entry) {
      window.location.hash = "#/";
      return null;
    }
    return (
      <CasePage
        key={`case-${entry.n}`}
        deck={deck}
        cases={deck.cases}
        positions={entry.slides}
        label={`Case ${entry.n}`}
        caseN={entry.n}
        onExit={back}
        prevHref={entry.n > 1 ? `#/c/${entry.n - 1}` : null}
        nextHref={entry.n < deck.cases.length ? `#/c/${entry.n + 1}` : null}
      />
    );
  }

  return <IndexPage deck={deck} />;
}
