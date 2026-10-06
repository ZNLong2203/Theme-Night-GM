import { ImageResponse } from "next/og";

// The card shown when a Theme Night GM link is shared (Devpost, Slack, social). Plan pages inherit it.
export const alt = "Theme Night GM: your emptiest Tuesday, programmed with taste";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const STEPS = ["Read the room", "Size the fandom", "Fit the audience", "Build the night", "Ship it with receipts"];

/** The site's display face, fetched at build time; the card still renders in the default font if this fails. */
async function barlow(weight: number): Promise<ArrayBuffer | null> {
  try {
    const css = await (await fetch(`https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@${weight}`)).text();
    const url = css.match(/src: url\((.+?)\) format\('(?:opentype|truetype)'\)/)?.[1];
    return url ? await (await fetch(url)).arrayBuffer() : null;
  } catch {
    return null;
  }
}

export default async function Image() {
  const [bold, medium] = await Promise.all([barlow(800), barlow(500)]);
  const display = bold ? "Barlow Condensed" : "sans-serif";
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "60px 72px",
          background: "radial-gradient(circle at 88% 8%, #33250b 0%, #080b12 58%)",
          color: "#e9edf6",
          fontFamily: display,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 28, fontWeight: 500, color: "#8b96ae", letterSpacing: 5 }}>
          <div style={{ width: 16, height: 16, borderRadius: 8, background: "#ffb547" }} />
          THEME NIGHT GM · AGENTS, BUT WITH TASTE
        </div>
        <div style={{ display: "flex", flexDirection: "column", fontSize: bold ? 92 : 64, fontWeight: 800, lineHeight: 0.95, whiteSpace: "nowrap" }}>
          <span>YOUR EMPTIEST TUESDAY,</span>
          <span style={{ color: "#ffb547" }}>PROGRAMMED WITH TASTE.</span>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ display: "flex", fontSize: 32, fontWeight: 500, color: "#8b96ae" }}>
            An AI promotions agent that turns weak home dates into theme nights your city already loves, measured with Qloo&apos;s
            taste graph.
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            {STEPS.map((step, i) => (
              <div
                key={step}
                style={{
                  display: "flex",
                  flexShrink: 0,
                  padding: "6px 16px",
                  borderRadius: 999,
                  border: `2px solid ${i === 4 ? "#3ddc97" : "#2e3a55"}`,
                  fontSize: 24,
                  fontWeight: 500,
                  color: i === 4 ? "#3ddc97" : "#e9edf6",
                }}
              >
                {`0${i + 1}  ${step}`}
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        ...(bold ? [{ name: "Barlow Condensed", data: bold, weight: 800 as const, style: "normal" as const }] : []),
        ...(medium ? [{ name: "Barlow Condensed", data: medium, weight: 500 as const, style: "normal" as const }] : []),
      ],
    },
  );
}
