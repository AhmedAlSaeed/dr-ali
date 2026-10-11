import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { Accreditation, ConflictOfInterest } from "@/lib/deck";

/** The deck's Conflict of Interest and Accreditation slides, re-authored as web content. */
export function Disclosures({
  coi,
  accreditation,
  providedBy,
}: {
  coi?: ConflictOfInterest;
  accreditation?: Accreditation;
  providedBy?: string;
}) {
  if (!coi && !accreditation) return null;
  return (
    <section id="disclosures" className="flex flex-col gap-4">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">Accreditation & disclosures</h2>
        {providedBy && <Badge variant="muted">{providedBy}</Badge>}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {coi && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{coi.title}</CardTitle>
              <p className="text-muted-foreground text-sm">{coi.subtitle}</p>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="overflow-hidden rounded-lg border">
                <table className="w-full border-collapse text-sm">
                  <thead className="bg-muted/50">
                    <tr>
                      {coi.columns.map((c, i) => (
                        <th
                          key={c}
                          className={
                            "px-3 py-2 font-medium " + (i === 0 ? "text-left" : "text-center")
                          }
                        >
                          {c}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {coi.rows.map((row, r) => (
                      <tr key={r} className="border-t">
                        {row.map((cell, i) => (
                          <td
                            key={i}
                            className={
                              "px-3 py-2 align-middle " +
                              (i === 0 ? "" : "text-muted-foreground text-center")
                            }
                          >
                            {cell}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <ul className="text-muted-foreground flex flex-col gap-1 text-xs">
                {coi.footnotes.map((f) => (
                  <li key={f}>{f}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {accreditation && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{accreditation.title}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {accreditation.sections.map((sec) => (
                <div key={sec.heading} className="flex flex-col gap-1">
                  <h3 className="text-sm font-medium">{sec.heading}</h3>
                  <p className="text-muted-foreground text-sm">{sec.body}</p>
                  <Separator className="mt-2" />
                </div>
              ))}
            </CardContent>
          </Card>
        )}
      </div>
    </section>
  );
}
