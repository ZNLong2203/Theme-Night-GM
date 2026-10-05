import { Suspense } from "react";
import { Studio } from "./studio";

export const metadata = { title: "Studio — Theme Night GM" };

export default function StudioPage() {
  return (
    <Suspense>
      <Studio />
    </Suspense>
  );
}
