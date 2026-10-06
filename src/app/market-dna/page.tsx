import { Suspense } from "react";
import { MarketDna } from "./market-dna";

export const metadata = {
  title: "Market DNA — Theme Night GM",
  description: "Compare what two markets love, side by side, from Qloo's taste graph: what only one city loves, what both share, and how far each pick over-indexes locally.",
};

export default function MarketDnaPage() {
  return (
    <Suspense>
      <MarketDna />
    </Suspense>
  );
}
